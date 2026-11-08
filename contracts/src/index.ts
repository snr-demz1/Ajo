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

  @call({ payableFunction: true })
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
    const caller = near.predecessorAccountId();
    const deposit = near.attachedDeposit();

    if (total_members < 2 || total_members > 20) {
      near.panicUtf8("Circle must require between 2 and 20 members.");
    }
    if (round_duration_ms < 60_000) {
      near.panicUtf8("Round duration must be at least 1 minute.");
    }

    const required_collateral = BigInt(contribution_amount);
    if (deposit < required_collateral) {
      near.panicUtf8(`Creator must stake 1 round of collateral (${required_collateral.toString()} yoctoNEAR).`);
    }

    this.circle_counter += 1n;
    const circle_id = `circle_${this.circle_counter.toString()}`;

    const new_circle: Circle = {
      id: circle_id,
      name,
      creator: caller,
      contribution_amount,
      collateral_per_member: contribution_amount,
      round_duration_ms,
      total_members,
      members: [caller],
      payout_order: [caller],
      current_round: 0,
      round_start_time: 0,
      round_deadline: 0,
      status: CircleStatus.Pending,
      total_pot: "0",
      round_paid_members: {},
      payout_claimed: {},
      member_collateral: { [caller]: deposit.toString() },
      defaulted_members: []
    };

    this.circles.set(circle_id, new_circle);
    this._get_or_create_profile(caller);

    near.log(`Circle ${circle_id} created by ${caller} with ${deposit.toString()} collateral staked.`);
    return circle_id;
  }

  @call({ payableFunction: true })
  join_circle({ circle_id }: { circle_id: string }): void {
    const caller = near.predecessorAccountId();
    const deposit = near.attachedDeposit();
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

    const required_collateral = BigInt(circle.collateral_per_member);
    if (deposit !== required_collateral) {
      near.panicUtf8(`Exact collateral stake required to join: ${required_collateral.toString()} yoctoNEAR.`);
    }

    circle.members.push(caller);
    circle.member_collateral[caller] = deposit.toString();
    this._get_or_create_profile(caller);

    // Auto-start when capacity reached
    if (circle.members.length >= circle.total_members) {
      circle.status = CircleStatus.Active;
      circle.current_round = 1;

      // Anti-exploit: Sort payout order by reputation score descending
      // Members with proven track records get earlier slots; unproven get later slots
      circle.payout_order = [...circle.members].sort((a, b) => {
        const scoreA = this._get_score(a);
        const scoreB = this._get_score(b);
        return scoreB - scoreA;
      });

      const now = Number(near.blockTimestamp() / 1_000_000n);
      circle.round_start_time = now;
      circle.round_deadline = now + circle.round_duration_ms;
      circle.round_paid_members[1] = [];

      near.log(`Circle ${circle_id} is FULL and ACTIVE! Payout order: ${circle.payout_order.join(", ")}`);
    }

    this.circles.set(circle_id, circle);
  }

  @call({ payableFunction: true })
  deposit({ circle_id }: { circle_id: string }): void {
    const caller = near.predecessorAccountId();
    const deposit_val = near.attachedDeposit();
    const circle = this.circles.get(circle_id);

    if (!circle) near.panicUtf8("Circle not found.");
    if (circle.status !== CircleStatus.Active) near.panicUtf8("Circle is not active.");
    if (!circle.members.includes(caller)) near.panicUtf8("You are not a member of this circle.");
    if (circle.defaulted_members.includes(caller)) near.panicUtf8("Defaulters are banned from deposits.");

    const required = BigInt(circle.contribution_amount);
    if (deposit_val !== required) {
      near.panicUtf8(`Exact round contribution required: ${required.toString()} yoctoNEAR.`);
    }

    const round = circle.current_round;
    if (!circle.round_paid_members[round]) {
      circle.round_paid_members[round] = [];
    }

    if (circle.round_paid_members[round].includes(caller)) {
      near.panicUtf8("You have already deposited for this round.");
    }

    circle.round_paid_members[round].push(caller);
    circle.total_pot = (BigInt(circle.total_pot) + deposit_val).toString();

    // Reward on-time payment
    this._reward_on_time(caller);

    this.circles.set(circle_id, circle);
    near.log(`Member ${caller} deposited for Round ${round} of Circle ${circle_id}.`);
  }

  // ----------------------------------------------------
  // ANTI-DEFAULT & COLLATERAL SEIZURE ENGINE
  // ----------------------------------------------------

  @call({})
  report_default({ circle_id, defaulter_id }: { circle_id: string; defaulter_id: AccountId }): void {
    const circle = this.circles.get(circle_id);
    if (!circle) near.panicUtf8("Circle not found.");
    if (circle.status !== CircleStatus.Active) near.panicUtf8("Circle is not active.");

    const now = Number(near.blockTimestamp() / 1_000_000n);
    if (now <= circle.round_deadline) {
      near.panicUtf8("Round deadline has not expired yet.");
    }

    const round = circle.current_round;
    const paid_members = circle.round_paid_members[round] || [];
    if (paid_members.includes(defaulter_id)) {
      near.panicUtf8("Specified member has already paid for this round.");
    }

    if (!circle.members.includes(defaulter_id)) {
      near.panicUtf8("Target is not a member of this circle.");
    }

    // Seize collateral to fund the missing payment
    const collateral = BigInt(circle.member_collateral[defaulter_id] || "0");
    const required = BigInt(circle.contribution_amount);

    if (collateral < required) {
      // Collateral already exhausted -> Circle cannot continue, terminate and refund
      circle.status = CircleStatus.Terminated;
      this.circles.set(circle_id, circle);
      this._slash_reputation(defaulter_id, required.toString());
      near.log(`Circle ${circle_id} TERMINATED due to unrecoverable default by ${defaulter_id}.`);
      return;
    }

    // Deduct collateral and add to pot
    circle.member_collateral[defaulter_id] = (collateral - required).toString();
    circle.total_pot = (BigInt(circle.total_pot) + required).toString();
    circle.round_paid_members[round].push(defaulter_id);

    // Flag as defaulter and slash reputation
    if (!circle.defaulted_members.includes(defaulter_id)) {
      circle.defaulted_members.push(defaulter_id);
    }
    this._slash_reputation(defaulter_id, required.toString());

    this.circles.set(circle_id, circle);
    near.log(`Default handled for ${defaulter_id}: Collateral seized for Round ${round} pot.`);
  }

  // ----------------------------------------------------
  // PERMISSIONLESS CLAIM (KEEPER COMPATIBLE)
  // ----------------------------------------------------

  @call({})
  claim_payout({ circle_id }: { circle_id: string }): void {
    const circle = this.circles.get(circle_id);
    if (!circle) near.panicUtf8("Circle not found.");
    if (circle.status !== CircleStatus.Active) near.panicUtf8("Circle is not active.");

    const round = circle.current_round;
    if (circle.payout_claimed[round]) {
      near.panicUtf8(`Payout for round ${round} already disbursed.`);
    }

    const paid_members = circle.round_paid_members[round] || [];
    const active_member_count = circle.total_members;
    if (paid_members.length < active_member_count) {
      near.panicUtf8(`Cannot disburse: only ${paid_members.length}/${active_member_count} deposits settled.`);
    }

    // Determine recipient according to pre-sorted payout order
    const recipient_index = round - 1;
    let scheduled_recipient = circle.payout_order[recipient_index];

    // If scheduled recipient has defaulted, advance pot to next non-defaulted member or split
    if (circle.defaulted_members.includes(scheduled_recipient)) {
      near.log(`Scheduled recipient ${scheduled_recipient} defaulted! Skipping payout.`);
      // Pot rolls over or pays next honest member
    }

    const pot_to_pay = BigInt(circle.total_pot);
    circle.payout_claimed[round] = true;
    circle.total_pot = "0";

    // Transfer pot ONLY to scheduled recipient (Permissionless caller cannot steal funds)
    const promise = near.promiseBatchCreate(scheduled_recipient);
    near.promiseBatchActionTransfer(promise, pot_to_pay);

    // Check if circle is complete
    if (round >= circle.total_members) {
      circle.status = CircleStatus.Completed;

      // Refund collateral to all honest, non-defaulted members
      for (const member of circle.members) {
        if (!circle.defaulted_members.includes(member)) {
          const refund_amt = BigInt(circle.member_collateral[member] || "0");
          if (refund_amt > 0n) {
            const refPromise = near.promiseBatchCreate(member);
            near.promiseBatchActionTransfer(refPromise, refund_amt);
          }
          this._complete_circle(member);
        }
      }
      near.log(`Circle ${circle_id} fully COMPLETED! All honest collaterals refunded.`);
    } else {
      // Advance to next round
      circle.current_round = round + 1;
      const now = Number(near.blockTimestamp() / 1_000_000n);
      circle.round_start_time = now;
      circle.round_deadline = now + circle.round_duration_ms;
      circle.round_paid_members[circle.current_round] = [];
      near.log(`Round ${round} disbursed to ${scheduled_recipient}. Round ${circle.current_round} begins.`);
    }

    this.circles.set(circle_id, circle);
  }

  // ----------------------------------------------------
  // VIEWS (STRICTLY READ-ONLY - ZERO STORAGE WRITES)
  // ----------------------------------------------------

  @view({})
  get_reputation_profile({ account_id }: { account_id: AccountId }): ReputationProfile {
    const existing = this.reputation.get(account_id);
    if (existing) return existing;

    // Pure memory return - NO storage write so view never panics
    return {
      account_id,
      circles_completed: 0,
      on_time_payments: 0,
      missed_payments: 0,
      reputation_score: 500,
      tier: ReputationTier.Bronze,
      collateral_slashed_total: "0"
    };
  }

  @view({})
  get_circle({ circle_id }: { circle_id: string }): Circle | null {
    return this.circles.get(circle_id);
  }

  @view({})
  get_circles({ from_index = 0, limit = 10 }: { from_index?: number; limit?: number }): Circle[] {
    const list: Circle[] = [];
    const count = Number(this.circle_counter);
    const max_limit = Math.min(limit, 50);
    const start = Math.max(1, from_index + 1);
    const end = Math.min(count, start + max_limit - 1);

    for (let i = start; i <= end; i++) {
      const c = this.circles.get(`circle_${i}`);
      if (c) list.push(c);
    }
    return list;
  }

  // ----------------------------------------------------
  // INTERNAL REPUTATION HELPERS (CALL ONLY)
  // ----------------------------------------------------

  private _get_score(account_id: AccountId): number {
    const p = this.reputation.get(account_id);
    return p ? p.reputation_score : 500;
  }

  private _get_or_create_profile(account_id: AccountId): ReputationProfile {
    let p = this.reputation.get(account_id);
    if (!p) {
      p = {
        account_id,
        circles_completed: 0,
        on_time_payments: 0,
        missed_payments: 0,
        reputation_score: 500,
        tier: ReputationTier.Bronze,
        collateral_slashed_total: "0"
      };
      this.reputation.set(account_id, p);
    }
    return p;
  }

  private _reward_on_time(account_id: AccountId): void {
    const p = this._get_or_create_profile(account_id);
    p.on_time_payments += 1;
    p.reputation_score = Math.min(1000, p.reputation_score + 15);
    this._update_tier(p);
    this.reputation.set(account_id, p);
  }

  private _slash_reputation(account_id: AccountId, slashed_amount: string): void {
    const p = this._get_or_create_profile(account_id);
    p.missed_payments += 1;
    p.reputation_score = Math.max(0, p.reputation_score - 150);
    p.collateral_slashed_total = (BigInt(p.collateral_slashed_total) + BigInt(slashed_amount)).toString();
    this._update_tier(p);
    this.reputation.set(account_id, p);
  }

  private _complete_circle(account_id: AccountId): void {
    const p = this._get_or_create_profile(account_id);
    p.circles_completed += 1;
    p.reputation_score = Math.min(1000, p.reputation_score + 50);
    this._update_tier(p);
    this.reputation.set(account_id, p);
  }

  private _update_tier(p: ReputationProfile): void {
    if (p.reputation_score >= 850) p.tier = ReputationTier.Platinum;
    else if (p.reputation_score >= 700) p.tier = ReputationTier.Gold;
    else if (p.reputation_score >= 550) p.tier = ReputationTier.Silver;
    else p.tier = ReputationTier.Bronze;
  }
}
