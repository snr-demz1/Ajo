import { NearBindgen, near, call, view, initialize, LookupMap, UnorderedMap } from "near-sdk-js";
import { Circle, CircleStatus, ReputationProfile, ReputationTier, AccountId } from "./types";

@NearBindgen({})
export class OrbitProtocol {
  circles: UnorderedMap<Circle> = new UnorderedMap<Circle>("c");
  reputation: LookupMap<ReputationProfile> = new LookupMap<ReputationProfile>("r");
  circle_counter: bigint = 0n;

  @initialize({})
  init(): void {
    this.circle_counter = 0n;
  }

  // ----------------------------------------------------
  // CIRCLE LIFECYCLE
  // ----------------------------------------------------

  @call({})
  create_circle({
    name,
    contribution_amount,
    round_duration_ms,
    total_members
  }: {
    name: string;
    contribution_amount: string;
    round_duration_ms: number;
    total_members: number;
  }): string {
    const caller = near.signerAccountId();
    if (total_members < 2) {
      near.panicUtf8("Circle must require at least 2 members.");
    }

    this.circle_counter += 1n;
    const circle_id = `circle_${this.circle_counter.toString()}`;

    const new_circle: Circle = {
      id: circle_id,
      name,
      creator: caller,
      contribution_amount,
      round_duration_ms,
      total_members,
      members: [caller],
      payout_order: [caller],
      current_round: 0,
      round_start_time: 0,
      status: CircleStatus.Pending,
      total_pot: "0",
      round_paid_members: {},
      payout_claimed: {}
    };

    this.circles.set(circle_id, new_circle);
    this._ensure_profile(caller);

    near.log(`Circle ${circle_id} created by ${caller}`);
    return circle_id;
  }

  @call({})
  join_circle({ circle_id }: { circle_id: string }): void {
    const caller = near.signerAccountId();
    const circle = this.circles.get(circle_id);
    if (!circle) {
      near.panicUtf8("Circle not found.");
    }

    if (circle.status !== CircleStatus.Pending) {
      near.panicUtf8("Circle is not accepting new members.");
    }

    if (circle.members.includes(caller)) {
      near.panicUtf8("Already a member of this circle.");
    }

    circle.members.push(caller);
    circle.payout_order.push(caller);
    this._ensure_profile(caller);

    // Auto-start if max members joined
    if (circle.members.length >= circle.total_members) {
      circle.status = CircleStatus.Active;
      circle.current_round = 1;
      circle.round_start_time = Number(near.blockTimestamp() / 1_000_000n);
      circle.round_paid_members[1] = [];
      near.log(`Circle ${circle_id} is now full and ACTIVE! Round 1 started.`);
    }

    this.circles.set(circle_id, circle);
  }

  @call({ payableFunction: true })
  deposit({ circle_id }: { circle_id: string }): void {
    const caller = near.signerAccountId();
    const deposit_val = near.attachedDeposit();
    const circle = this.circles.get(circle_id);

    if (!circle) {
      near.panicUtf8("Circle not found.");
    }

    if (circle.status !== CircleStatus.Active) {
      near.panicUtf8("Circle is not currently active.");
    }

    if (!circle.members.includes(caller)) {
      near.panicUtf8("You are not a member of this circle.");
    }

    const required_amount = BigInt(circle.contribution_amount);
    if (deposit_val < required_amount) {
      near.panicUtf8(`Insufficient deposit. Required: ${required_amount.toString()} yoctoNEAR`);
    }

    const round = circle.current_round;
    if (!circle.round_paid_members[round]) {
      circle.round_paid_members[round] = [];
    }

    if (circle.round_paid_members[round].includes(caller)) {
      near.panicUtf8("You have already contributed for this round.");
    }

    circle.round_paid_members[round].push(caller);
    circle.total_pot = (BigInt(circle.total_pot) + deposit_val).toString();

    // Reward reputation for paying on time
    this._reward_reputation(caller);

    this.circles.set(circle_id, circle);
    near.log(`Member ${caller} contributed for Round ${round} of Circle ${circle_id}`);
  }

  @call({})
  claim_payout({ circle_id }: { circle_id: string }): void {
    const circle = this.circles.get(circle_id);
    if (!circle) {
      near.panicUtf8("Circle not found.");
    }

    if (circle.status !== CircleStatus.Active) {
      near.panicUtf8("Circle is not active.");
    }

    const round = circle.current_round;
    const recipient_index = round - 1;
    const scheduled_recipient = circle.payout_order[recipient_index];

    const caller = near.signerAccountId();
    if (caller !== scheduled_recipient) {
      near.panicUtf8(`Only scheduled recipient (${scheduled_recipient}) can claim for round ${round}.`);
    }

    if (circle.payout_claimed[round]) {
      near.panicUtf8(`Payout for round ${round} already claimed.`);
    }

    // Verify all members have paid for this round
    const paid_members = circle.round_paid_members[round] || [];
    if (paid_members.length < circle.total_members) {
      near.panicUtf8(`Cannot claim pot yet. Only ${paid_members.length}/${circle.total_members} members have deposited.`);
    }

    const pot_to_pay = BigInt(circle.total_pot);
    circle.payout_claimed[round] = true;
    circle.total_pot = "0";

    // Advance to next round or complete
    if (round >= circle.total_members) {
      circle.status = CircleStatus.Completed;
      for (const member of circle.members) {
        this._complete_circle_reputation(member);
      }
      near.log(`Circle ${circle_id} is fully COMPLETED!`);
    } else {
      circle.current_round = round + 1;
      circle.round_start_time = Number(near.blockTimestamp() / 1_000_000n);
      circle.round_paid_members[circle.current_round] = [];
      near.log(`Round ${round} completed. Round ${circle.current_round} begins.`);
    }

    this.circles.set(circle_id, circle);

    // Transfer the pot to the recipient
    const promise = near.promiseBatchCreate(scheduled_recipient);
    near.promiseBatchActionTransfer(promise, pot_to_pay);
  }

  // ----------------------------------------------------
  // REPUTATION & SOULBOUND PASS
  // ----------------------------------------------------

  @view({})
  get_reputation_profile({ account_id }: { account_id: AccountId }): ReputationProfile {
    return this._ensure_profile(account_id);
  }

  @view({})
  get_circle({ circle_id }: { circle_id: string }): Circle | null {
    return this.circles.get(circle_id);
  }

  @view({})
  get_all_circles(): Circle[] {
    const list: Circle[] = [];
    const count = Number(this.circle_counter);
    for (let i = 1; i <= count; i++) {
      const c = this.circles.get(`circle_${i}`);
      if (c) list.push(c);
    }
    return list;
  }

  // ----------------------------------------------------
  // INTERNAL HELPERS
  // ----------------------------------------------------

  private _ensure_profile(account_id: AccountId): ReputationProfile {
    let profile = this.reputation.get(account_id);
    if (!profile) {
      profile = {
        account_id,
        circles_completed: 0,
        on_time_payments: 0,
        missed_payments: 0,
        reputation_score: 500, // Base starting trust score
        tier: ReputationTier.Bronze,
        badge_minted: true
      };
      this.reputation.set(account_id, profile);
    }
    return profile;
  }

  private _reward_reputation(account_id: AccountId): void {
    const profile = this._ensure_profile(account_id);
    profile.on_time_payments += 1;
    profile.reputation_score = Math.min(1000, profile.reputation_score + 15);
    this._update_tier(profile);
    this.reputation.set(account_id, profile);
  }

  private _complete_circle_reputation(account_id: AccountId): void {
    const profile = this._ensure_profile(account_id);
    profile.circles_completed += 1;
    profile.reputation_score = Math.min(1000, profile.reputation_score + 50);
    this._update_tier(profile);
    this.reputation.set(account_id, profile);
  }

  private _update_tier(profile: ReputationProfile): void {
    if (profile.reputation_score >= 850) {
      profile.tier = ReputationTier.Platinum;
    } else if (profile.reputation_score >= 700) {
      profile.tier = ReputationTier.Gold;
    } else if (profile.reputation_score >= 550) {
      profile.tier = ReputationTier.Silver;
    } else {
      profile.tier = ReputationTier.Bronze;
    }
  }
}
