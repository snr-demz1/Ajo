// Orbit Protocol Contract Simulator & Test Harness
// Mirrors contracts/src/index.ts for pure Node.js verification

export const CircleStatus = {
  Pending: "Pending",
  Active: "Active",
  Completed: "Completed",
  Terminated: "Terminated"
};

export const ReputationTier = {
  Bronze: "Bronze",
  Silver: "Silver",
  Gold: "Gold",
  Platinum: "Platinum"
};

export class OrbitContractHarness {
  constructor() {
    this.circles = new Map();
    this.reputation = new Map();
    this.circle_counter = 0n;
    this.current_caller = "alice.near";
    this.current_deposit = 0n;
    this.mock_time_ms = 1000000;
    this.transfers = [];
  }

  setCaller(account_id, deposit = 0n) {
    this.current_caller = account_id;
    this.current_deposit = BigInt(deposit);
  }

  advanceTime(ms) {
    this.mock_time_ms += ms;
  }

  _getScore(accountId) {
    const p = this.reputation.get(accountId);
    return p ? p.reputation_score : 500;
  }

  _getOrCreateProfile(accountId) {
    if (!this.reputation.has(accountId)) {
      this.reputation.set(accountId, {
        account_id: accountId,
        circles_completed: 0,
        on_time_payments: 0,
        missed_payments: 0,
        reputation_score: 500,
        tier: ReputationTier.Bronze,
        collateral_slashed_total: 0n
      });
    }
    return this.reputation.get(accountId);
  }

  _updateTier(p) {
    if (p.reputation_score >= 850) p.tier = ReputationTier.Platinum;
    else if (p.reputation_score >= 700) p.tier = ReputationTier.Gold;
    else if (p.reputation_score >= 550) p.tier = ReputationTier.Silver;
    else p.tier = ReputationTier.Bronze;
  }

  createCircle({ name, contribution_amount, round_duration_ms, total_members }) {
    if (total_members < 2) throw new Error("Circle must require at least 2 members.");
    const required_collateral = BigInt(contribution_amount);
    if (this.current_deposit < required_collateral) {
      throw new Error(`Creator must stake 1 round of collateral (${required_collateral}).`);
    }

    this.circle_counter += 1n;
    const circle_id = `circle_${this.circle_counter.toString()}`;

    const new_circle = {
      id: circle_id,
      name,
      creator: this.current_caller,
      contribution_amount: BigInt(contribution_amount),
      collateral_per_member: BigInt(contribution_amount),
      round_duration_ms,
      total_members,
      members: [this.current_caller],
      payout_order: [this.current_caller],
      current_round: 0,
      round_start_time: 0,
      round_deadline: 0,
      status: CircleStatus.Pending,
      total_pot: 0n,
      round_paid_members: {},
      payout_claimed: {},
      member_collateral: { [this.current_caller]: this.current_deposit },
      defaulted_members: []
    };

    this.circles.set(circle_id, new_circle);
    this._getOrCreateProfile(this.current_caller);
    return circle_id;
  }

  joinCircle({ circle_id }) {
    const circle = this.circles.get(circle_id);
    if (!circle) throw new Error("Circle not found.");
    if (circle.status !== CircleStatus.Pending) throw new Error("Circle is not accepting new members.");
    if (circle.members.includes(this.current_caller)) throw new Error("Already a member of this circle.");

    if (this.current_deposit !== circle.collateral_per_member) {
      throw new Error(`Exact collateral stake required to join: ${circle.collateral_per_member}.`);
    }

    circle.members.push(this.current_caller);
    circle.member_collateral[this.current_caller] = this.current_deposit;
    this._getOrCreateProfile(this.current_caller);

    // Auto-activate when full
    if (circle.members.length >= circle.total_members) {
      circle.status = CircleStatus.Active;
      circle.current_round = 1;

      // Payout order sorted by reputation score descending
      circle.payout_order = [...circle.members].sort((a, b) => this._getScore(b) - this._getScore(a));

      circle.round_start_time = this.mock_time_ms;
      circle.round_deadline = this.mock_time_ms + circle.round_duration_ms;
      circle.round_paid_members[1] = [];
    }
  }

  deposit({ circle_id }) {
    const circle = this.circles.get(circle_id);
    if (!circle) throw new Error("Circle not found.");
    if (circle.status !== CircleStatus.Active) throw new Error("Circle is not active.");
    if (!circle.members.includes(this.current_caller)) throw new Error("You are not a member of this circle.");
    if (circle.defaulted_members.includes(this.current_caller)) throw new Error("Defaulters are banned from deposits.");

    if (this.current_deposit !== circle.contribution_amount) {
      throw new Error(`Exact round contribution required: ${circle.contribution_amount}.`);
    }

    const round = circle.current_round;
    if (!circle.round_paid_members[round]) {
      circle.round_paid_members[round] = [];
    }

    if (circle.round_paid_members[round].includes(this.current_caller)) {
      throw new Error("Already contributed for this round.");
    }

    circle.round_paid_members[round].push(this.current_caller);
    circle.total_pot += this.current_deposit;

    // Reward on-time payment
    const profile = this._getOrCreateProfile(this.current_caller);
    profile.on_time_payments += 1;
    profile.reputation_score = Math.min(1000, profile.reputation_score + 15);
    this._updateTier(profile);
  }

  reportDefault({ circle_id, defaulter_id }) {
    const circle = this.circles.get(circle_id);
    if (!circle) throw new Error("Circle not found.");
    if (circle.status !== CircleStatus.Active) throw new Error("Circle is not active.");

    if (this.mock_time_ms <= circle.round_deadline) {
      throw new Error("Round deadline has not expired yet.");
    }

    const round = circle.current_round;
    const paid = circle.round_paid_members[round] || [];
    if (paid.includes(defaulter_id)) throw new Error("Member has already paid for this round.");

    const collateral = circle.member_collateral[defaulter_id] || 0n;
    if (collateral < circle.contribution_amount) {
      circle.status = CircleStatus.Terminated;
      throw new Error("Collateral exhausted. Circle terminated.");
    }

    // Seize collateral to fund the round pot
    circle.member_collateral[defaulter_id] = collateral - circle.contribution_amount;
    circle.total_pot += circle.contribution_amount;
    circle.round_paid_members[round].push(defaulter_id);

    if (!circle.defaulted_members.includes(defaulter_id)) {
      circle.defaulted_members.push(defaulter_id);
    }

    // Slash reputation
    const p = this._getOrCreateProfile(defaulter_id);
    p.missed_payments += 1;
    p.reputation_score = Math.max(0, p.reputation_score - 150);
    p.collateral_slashed_total += circle.contribution_amount;
    this._updateTier(p);
  }

  // Permissionless claim: any caller / keeper can execute, pot only goes to scheduled_recipient
  claimPayout({ circle_id }) {
    const circle = this.circles.get(circle_id);
    if (!circle) throw new Error("Circle not found.");
    if (circle.status !== CircleStatus.Active) throw new Error("Circle is not active.");

    const round = circle.current_round;
    if (circle.payout_claimed[round]) throw new Error(`Payout for round ${round} already claimed.`);

    const paid = circle.round_paid_members[round] || [];
    if (paid.length < circle.total_members) {
      throw new Error(`Cannot claim pot yet: only ${paid.length}/${circle.total_members} paid.`);
    }

    const scheduled_recipient = circle.payout_order[round - 1];
    const pot_to_pay = circle.total_pot;
    circle.payout_claimed[round] = true;
    circle.total_pot = 0n;

    this.transfers.push({
      to: scheduled_recipient,
      amount: pot_to_pay,
      round: round,
      triggered_by: this.current_caller
    });

    if (round >= circle.total_members) {
      circle.status = CircleStatus.Completed;
      for (const member of circle.members) {
        if (!circle.defaulted_members.includes(member)) {
          const refund = circle.member_collateral[member] || 0n;
          if (refund > 0n) {
            this.transfers.push({
              to: member,
              amount: refund,
              type: "collateral_refund"
            });
          }
          const p = this._getOrCreateProfile(member);
          p.circles_completed += 1;
          p.reputation_score = Math.min(1000, p.reputation_score + 50);
          this._updateTier(p);
        }
      }
    } else {
      circle.current_round = round + 1;
      circle.round_start_time = this.mock_time_ms;
      circle.round_deadline = this.mock_time_ms + circle.round_duration_ms;
      circle.round_paid_members[circle.current_round] = [];
    }
  }

  // Strictly read-only view: never writes to storage!
  getReputationProfile({ account_id }) {
    const existing = this.reputation.get(account_id);
    if (existing) return existing;
    return {
      account_id,
      circles_completed: 0,
      on_time_payments: 0,
      missed_payments: 0,
      reputation_score: 500,
      tier: ReputationTier.Bronze,
      collateral_slashed_total: 0n
    };
  }
}
