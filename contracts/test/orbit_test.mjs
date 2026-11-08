import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Core State and Model Implementation for Unit Testing
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
    this.transfers = [];
  }

  setCaller(account_id, deposit = 0n) {
    this.current_caller = account_id;
    this.current_deposit = BigInt(deposit);
  }

  ensureProfile(accountId) {
    if (!this.reputation.has(accountId)) {
      this.reputation.set(accountId, {
        account_id: accountId,
        circles_completed: 0,
        on_time_payments: 0,
        missed_payments: 0,
        reputation_score: 500,
        tier: ReputationTier.Bronze,
        badge_minted: true
      });
    }
    return this.reputation.get(accountId);
  }

  updateTier(profile) {
    if (profile.reputation_score >= 850) profile.tier = ReputationTier.Platinum;
    else if (profile.reputation_score >= 700) profile.tier = ReputationTier.Gold;
    else if (profile.reputation_score >= 550) profile.tier = ReputationTier.Silver;
    else profile.tier = ReputationTier.Bronze;
  }

  createCircle({ name, contribution_amount, round_duration_ms, total_members }) {
    if (total_members < 2) throw new Error("Circle must require at least 2 members.");
    this.circle_counter += 1n;
    const circle_id = `circle_${this.circle_counter.toString()}`;

    const new_circle = {
      id: circle_id,
      name,
      creator: this.current_caller,
      contribution_amount: BigInt(contribution_amount),
      round_duration_ms,
      total_members,
      members: [this.current_caller],
      payout_order: [this.current_caller],
      current_round: 0,
      status: CircleStatus.Pending,
      total_pot: 0n,
      round_paid_members: {},
      payout_claimed: {}
    };

    this.circles.set(circle_id, new_circle);
    this.ensureProfile(this.current_caller);
    return circle_id;
  }

  joinCircle({ circle_id }) {
    const circle = this.circles.get(circle_id);
    if (!circle) throw new Error("Circle not found.");
    if (circle.status !== CircleStatus.Pending) throw new Error("Circle is not accepting new members.");
    if (circle.members.includes(this.current_caller)) throw new Error("Already a member of this circle.");

    circle.members.push(this.current_caller);
    circle.payout_order.push(this.current_caller);
    this.ensureProfile(this.current_caller);

    if (circle.members.length >= circle.total_members) {
      circle.status = CircleStatus.Active;
      circle.current_round = 1;
      circle.round_paid_members[1] = [];
    }
  }

  deposit({ circle_id }) {
    const circle = this.circles.get(circle_id);
    if (!circle) throw new Error("Circle not found.");
    if (circle.status !== CircleStatus.Active) throw new Error("Circle is not currently active.");
    if (!circle.members.includes(this.current_caller)) throw new Error("You are not a member of this circle.");

    if (this.current_deposit < circle.contribution_amount) {
      throw new Error("Insufficient deposit.");
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

    // Reputation reward
    const profile = this.ensureProfile(this.current_caller);
    profile.on_time_payments += 1;
    profile.reputation_score = Math.min(1000, profile.reputation_score + 15);
    this.updateTier(profile);
  }

  claimPayout({ circle_id }) {
    const circle = this.circles.get(circle_id);
    if (!circle) throw new Error("Circle not found.");
    if (circle.status !== CircleStatus.Active) throw new Error("Circle is not active.");

    const round = circle.current_round;
    const scheduled_recipient = circle.payout_order[round - 1];

    if (this.current_caller !== scheduled_recipient) {
      throw new Error(`Only scheduled recipient (${scheduled_recipient}) can claim for round ${round}.`);
    }

    if (circle.payout_claimed[round]) {
      throw new Error(`Payout for round ${round} already claimed.`);
    }

    const paid_members = circle.round_paid_members[round] || [];
    if (paid_members.length < circle.total_members) {
      throw new Error(`Cannot claim pot yet. Incomplete deposits.`);
    }

    const pot_to_pay = circle.total_pot;
    circle.payout_claimed[round] = true;
    circle.total_pot = 0n;

    this.transfers.push({
      to: scheduled_recipient,
      amount: pot_to_pay,
      round: round
    });

    if (round >= circle.total_members) {
      circle.status = CircleStatus.Completed;
      for (const member of circle.members) {
        const p = this.ensureProfile(member);
        p.circles_completed += 1;
        p.reputation_score = Math.min(1000, p.reputation_score + 50);
        this.updateTier(p);
      }
    } else {
      circle.current_round = round + 1;
      circle.round_paid_members[circle.current_round] = [];
    }
  }
}

// ==========================================
// TEST SUITE
// ==========================================
describe('Orbit Protocol: Core Contract Logic', () => {
  it('should initialize circle and auto-activate when full', () => {
    const contract = new OrbitContractHarness();
    contract.setCaller("alice.near");

    const circle_id = contract.createCircle({
      name: "Entrepreneurs Circle",
      contribution_amount: "5000000000000000000000000", // 5 NEAR
      round_duration_ms: 86400000,
      total_members: 3
    });

    assert.equal(circle_id, "circle_1");
    let circle = contract.circles.get(circle_id);
    assert.equal(circle.status, CircleStatus.Pending);
    assert.equal(circle.members.length, 1);

    // Member 2 joins
    contract.setCaller("bob.near");
    contract.joinCircle({ circle_id });
    circle = contract.circles.get(circle_id);
    assert.equal(circle.status, CircleStatus.Pending);

    // Member 3 joins -> triggers auto-activation
    contract.setCaller("charlie.near");
    contract.joinCircle({ circle_id });
    circle = contract.circles.get(circle_id);
    assert.equal(circle.status, CircleStatus.Active);
    assert.equal(circle.current_round, 1);
    assert.deepEqual(circle.payout_order, ["alice.near", "bob.near", "charlie.near"]);
  });

  it('should enforce deposits, calculate pot, and boost on-time reputation', () => {
    const contract = new OrbitContractHarness();
    contract.setCaller("alice.near");
    const depositAmt = 5000000000000000000000000n; // 5 NEAR

    const circle_id = contract.createCircle({
      name: "Weekly Susu",
      contribution_amount: depositAmt.toString(),
      round_duration_ms: 604800000,
      total_members: 2
    });

    contract.setCaller("bob.near");
    contract.joinCircle({ circle_id });

    // Non-member deposit attempt
    contract.setCaller("mallory.near", depositAmt);
    assert.throws(() => contract.deposit({ circle_id }), /You are not a member/);

    // Underfunded deposit attempt
    contract.setCaller("alice.near", depositAmt - 1n);
    assert.throws(() => contract.deposit({ circle_id }), /Insufficient deposit/);

    // Alice deposits valid amount
    contract.setCaller("alice.near", depositAmt);
    contract.deposit({ circle_id });
    const aliceProfile = contract.ensureProfile("alice.near");
    assert.equal(aliceProfile.on_time_payments, 1);
    assert.equal(aliceProfile.reputation_score, 515); // 500 base + 15

    // Bob deposits valid amount
    contract.setCaller("bob.near", depositAmt);
    contract.deposit({ circle_id });

    const circle = contract.circles.get(circle_id);
    assert.equal(circle.total_pot, depositAmt * 2n);
  });

  it('should disburse round 1 payout only to Alice and advance round to Bob', () => {
    const contract = new OrbitContractHarness();
    const depositAmt = 10000000000000000000000000n; // 10 NEAR

    contract.setCaller("alice.near");
    const circle_id = contract.createCircle({
      name: "Bi-Weekly Tanda",
      contribution_amount: depositAmt.toString(),
      round_duration_ms: 1000,
      total_members: 2
    });

    contract.setCaller("bob.near");
    contract.joinCircle({ circle_id });

    // Bob tries to claim early before deposits
    contract.setCaller("bob.near");
    assert.throws(() => contract.claimPayout({ circle_id }), /Only scheduled recipient \(alice\.near\)/);

    // Both deposit
    contract.setCaller("alice.near", depositAmt);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near", depositAmt);
    contract.deposit({ circle_id });

    // Alice claims
    contract.setCaller("alice.near");
    contract.claimPayout({ circle_id });

    assert.equal(contract.transfers.length, 1);
    assert.equal(contract.transfers[0].to, "alice.near");
    assert.equal(contract.transfers[0].amount, depositAmt * 2n);

    // Circle advances to round 2
    const circle = contract.circles.get(circle_id);
    assert.equal(circle.current_round, 2);
    assert.equal(circle.total_pot, 0n);
  });

  it('should complete circle, award completion bonus, and upgrade reputation tiers', () => {
    const contract = new OrbitContractHarness();
    const depositAmt = 10000000000000000000000000n;

    contract.setCaller("alice.near");
    const circle_id = contract.createCircle({
      name: "Ajo Circle",
      contribution_amount: depositAmt.toString(),
      round_duration_ms: 1000,
      total_members: 2
    });

    contract.setCaller("bob.near");
    contract.joinCircle({ circle_id });

    // Round 1
    contract.setCaller("alice.near", depositAmt);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near", depositAmt);
    contract.deposit({ circle_id });
    contract.setCaller("alice.near");
    contract.claimPayout({ circle_id });

    // Round 2
    contract.setCaller("alice.near", depositAmt);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near", depositAmt);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near");
    contract.claimPayout({ circle_id });

    const circle = contract.circles.get(circle_id);
    assert.equal(circle.status, CircleStatus.Completed);

    // Check Bob got paid in Round 2
    assert.equal(contract.transfers.length, 2);
    assert.equal(contract.transfers[1].to, "bob.near");
    assert.equal(contract.transfers[1].amount, depositAmt * 2n);

    // Check reputations: 500 base + 2*15 (payments) + 50 (completion) = 580 (Silver Tier)
    const aliceProfile = contract.ensureProfile("alice.near");
    const bobProfile = contract.ensureProfile("bob.near");

    assert.equal(aliceProfile.reputation_score, 580);
    assert.equal(aliceProfile.tier, ReputationTier.Silver);
    assert.equal(aliceProfile.circles_completed, 1);

    assert.equal(bobProfile.reputation_score, 580);
    assert.equal(bobProfile.tier, ReputationTier.Silver);
    assert.equal(bobProfile.circles_completed, 1);
  });
});
