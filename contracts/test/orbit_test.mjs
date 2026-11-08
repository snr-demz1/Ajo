import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrbitContractHarness, CircleStatus, ReputationTier } from '../src/harness.mjs';

describe('Orbit Protocol: Core Contract Logic & Invariants', () => {

  it('1. should require collateral to create and join circle, sorting payout by reputation score', () => {
    const contract = new OrbitContractHarness();
    const stakeAmt = 10000000000000000000000000n; // 10 NEAR

    // Set Alice reputation to 500 (default)
    contract.setCaller("alice.near", stakeAmt);
    const circle_id = contract.createCircle({
      name: "Entrepreneurs Circle",
      contribution_amount: stakeAmt.toString(),
      round_duration_ms: 86400000,
      total_members: 2
    });

    // Set Bob reputation to 800 (higher reputation)
    const bobProfile = contract._getOrCreateProfile("bob.near");
    bobProfile.reputation_score = 800;

    // Bob joins with required collateral
    contract.setCaller("bob.near", stakeAmt);
    contract.joinCircle({ circle_id });

    const circle = contract.circles.get(circle_id);
    assert.equal(circle.status, CircleStatus.Active);
    assert.equal(circle.current_round, 1);

    // Anti-creator bias: Bob has higher reputation (800 > 500), so Bob is scheduled FIRST!
    assert.deepEqual(circle.payout_order, ["bob.near", "alice.near"]);
  });

  it('2. should enforce exact deposits and allow permissionless keeper claims', () => {
    const contract = new OrbitContractHarness();
    const amount = 5000000000000000000000000n; // 5 NEAR

    contract.setCaller("alice.near", amount);
    const circle_id = contract.createCircle({
      name: "Weekly Circle",
      contribution_amount: amount.toString(),
      round_duration_ms: 86400000,
      total_members: 2
    });

    contract.setCaller("bob.near", amount);
    contract.joinCircle({ circle_id });

    // Underfunded deposit fails
    contract.setCaller("alice.near", amount - 1n);
    assert.throws(() => contract.deposit({ circle_id }), /Exact round contribution required/);

    // Overfunded deposit also fails (no silent absorption)
    contract.setCaller("alice.near", amount + 1n);
    assert.throws(() => contract.deposit({ circle_id }), /Exact round contribution required/);

    // Both deposit exact amount
    contract.setCaller("alice.near", amount);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near", amount);
    contract.deposit({ circle_id });

    // Third-party keeper claims permissionlessly on behalf of circle!
    contract.setCaller("autonomous-keeper.near");
    contract.claimPayout({ circle_id });

    // Payout went to scheduled recipient, NOT the keeper!
    assert.equal(contract.transfers.length, 1);
    const scheduled = contract.circles.get(circle_id).payout_order[0];
    assert.equal(contract.transfers[0].to, scheduled);
    assert.equal(contract.transfers[0].amount, amount * 2n);
    assert.equal(contract.transfers[0].triggered_by, "autonomous-keeper.near");
  });

  it('3. should seize collateral, slash reputation (-150), and cover pot when member defaults', () => {
    const contract = new OrbitContractHarness();
    const amount = 10000000000000000000000000n; // 10 NEAR

    contract.setCaller("alice.near", amount);
    const circle_id = contract.createCircle({
      name: "Tanda Circle",
      contribution_amount: amount.toString(),
      round_duration_ms: 60000, // 1 minute
      total_members: 2
    });

    contract.setCaller("bob.near", amount);
    contract.joinCircle({ circle_id });

    // Alice deposits on time
    contract.setCaller("alice.near", amount);
    contract.deposit({ circle_id });

    // Bob fails to deposit; deadline expires
    assert.throws(() => contract.reportDefault({ circle_id, defaulter_id: "bob.near" }), /Round deadline has not expired/);
    contract.advanceTime(70000); // 70 seconds pass

    // Keeper reports default
    contract.setCaller("keeper.near");
    contract.reportDefault({ circle_id, defaulter_id: "bob.near" });

    // Bob's collateral is seized to cover his round share in the pot!
    const circle = contract.circles.get(circle_id);
    assert.equal(circle.total_pot, amount * 2n); // Alice's deposit + Bob's seized collateral
    assert.equal(circle.member_collateral["bob.near"], 0n);
    assert.ok(circle.defaulted_members.includes("bob.near"));

    // Bob's reputation is slashed: 500 - 150 = 350
    const bobProfile = contract.getReputationProfile({ account_id: "bob.near" });
    assert.equal(bobProfile.reputation_score, 350);
    assert.equal(bobProfile.missed_payments, 1);
  });

  it('4. should complete rotation, refund collateral to faithful members, and boost tiers', () => {
    const contract = new OrbitContractHarness();
    const amount = 5000000000000000000000000n;

    contract.setCaller("alice.near", amount);
    const circle_id = contract.createCircle({
      name: "Faithful Susu",
      contribution_amount: amount.toString(),
      round_duration_ms: 86400000,
      total_members: 2
    });

    contract.setCaller("bob.near", amount);
    contract.joinCircle({ circle_id });

    // Round 1
    contract.setCaller("alice.near", amount);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near", amount);
    contract.deposit({ circle_id });
    contract.setCaller("keeper.near");
    contract.claimPayout({ circle_id });

    // Round 2
    contract.setCaller("alice.near", amount);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near", amount);
    contract.deposit({ circle_id });
    contract.setCaller("keeper.near");
    contract.claimPayout({ circle_id });

    const circle = contract.circles.get(circle_id);
    assert.equal(circle.status, CircleStatus.Completed);

    // Both members received pot payout + their collateral refunded!
    const refunds = contract.transfers.filter(t => t.type === "collateral_refund");
    assert.equal(refunds.length, 2);

    // Reputations boosted: 500 + 2*15 (deposits) + 50 (completion) = 580 (Silver Tier)
    const aliceP = contract.getReputationProfile({ account_id: "alice.near" });
    assert.equal(aliceP.reputation_score, 580);
    assert.equal(aliceP.tier, ReputationTier.Silver);
    assert.equal(aliceP.circles_completed, 1);
  });

  it('5. should execute getReputationProfile as a strictly read-only view with zero storage writes', () => {
    const contract = new OrbitContractHarness();
    // Query account that has never interacted with contract
    const freshProfile = contract.getReputationProfile({ account_id: "stranger.near" });
    assert.equal(freshProfile.account_id, "stranger.near");
    assert.equal(freshProfile.reputation_score, 500);
    assert.equal(freshProfile.tier, ReputationTier.Bronze);
    // Verified: no write occurred in underlying storage map
    assert.equal(contract.reputation.has("stranger.near"), false);
  });

});
