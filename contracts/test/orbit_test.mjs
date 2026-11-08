import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OrbitContractHarness, CircleStatus, ReputationTier } from "../src/harness.mjs";

const ONE_NEAR = 1_000_000_000_000_000_000_000_000n;
const FIVE_NEAR = 5n * ONE_NEAR;
const TEN_NEAR = 10n * ONE_NEAR;

describe("Orbit Protocol: Compiled WASM Smart Contract & Security Invariants", () => {

  it("1. should require (N-1)*contribution collateral and sort payout_order by on-chain reputation score", () => {
    const contract = new OrbitContractHarness();

    // First, Bob and Dave complete a fast 2-member circle so Bob earns higher on-chain reputation (580 > 500)
    contract.setCaller("bob.near", FIVE_NEAR);
    const warmupId = contract.createCircle({
      name: "Warmup Circle",
      contribution_amount: FIVE_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 2
    });
    contract.setCaller("dave.near", FIVE_NEAR);
    contract.joinCircle({ circle_id: warmupId });

    for (let r = 1; r <= 2; r++) {
      contract.setCaller("bob.near", FIVE_NEAR);
      contract.deposit({ circle_id: warmupId });
      contract.setCaller("dave.near", FIVE_NEAR);
      contract.deposit({ circle_id: warmupId });
      contract.setCaller("keeper.near", 0n);
      contract.claimPayout({ circle_id: warmupId });
    }
    assert.equal(contract.getReputationProfile({ account_id: "bob.near" }).reputation_score, 580);

    // Now Alice (score 500) creates a new circle; Bob (score 580) joins
    contract.setCaller("alice.near", TEN_NEAR);
    const circle_id = contract.createCircle({
      name: "Entrepreneurs Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 86400000,
      total_members: 2
    });

    contract.setCaller("bob.near", TEN_NEAR);
    contract.joinCircle({ circle_id });

    const circle = contract.circles.get(circle_id);
    assert.equal(circle.status, CircleStatus.Active);
    assert.equal(circle.current_round, 1);

    // Anti-creator bias: Bob has higher on-chain reputation (580 > 500), so Bob is scheduled FIRST!
    assert.deepEqual(circle.payout_order, ["bob.near", "alice.near"]);
  });

  it("2. should enforce exact deposits and allow permissionless keeper claims", () => {
    const contract = new OrbitContractHarness();

    contract.setCaller("alice.near", FIVE_NEAR);
    const circle_id = contract.createCircle({
      name: "Weekly Circle",
      contribution_amount: FIVE_NEAR.toString(),
      round_duration_ms: 86400000,
      total_members: 2
    });

    contract.setCaller("bob.near", FIVE_NEAR);
    contract.joinCircle({ circle_id });

    // Underfunded deposit fails
    contract.setCaller("alice.near", FIVE_NEAR - 1n);
    assert.throws(() => contract.deposit({ circle_id }), /Exact round contribution required/);

    // Overfunded deposit also fails
    contract.setCaller("alice.near", FIVE_NEAR + 1n);
    assert.throws(() => contract.deposit({ circle_id }), /Exact round contribution required/);

    // Both deposit exact amount
    contract.setCaller("alice.near", FIVE_NEAR);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near", FIVE_NEAR);
    contract.deposit({ circle_id });

    // Third-party keeper claims permissionlessly on behalf of circle
    contract.setCaller("autonomous-keeper.near", 0n);
    contract.claimPayout({ circle_id });

    // Payout went to scheduled recipient, NOT the keeper
    assert.equal(contract.transfers.length, 1);
    const scheduled = contract.circles.get(circle_id).payout_order[0];
    assert.equal(contract.transfers[0].to, scheduled);
    assert.equal(contract.transfers[0].amount, FIVE_NEAR * 2n);
    assert.equal(contract.transfers[0].triggered_by, "autonomous-keeper.near");
  });

  it("3. should seize collateral, slash reputation (-150), and cover pot when member defaults", () => {
    const contract = new OrbitContractHarness();

    contract.setCaller("alice.near", TEN_NEAR);
    const circle_id = contract.createCircle({
      name: "Tanda Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 2
    });

    contract.setCaller("bob.near", TEN_NEAR);
    contract.joinCircle({ circle_id });

    // Alice deposits on time
    contract.setCaller("alice.near", TEN_NEAR);
    contract.deposit({ circle_id });

    // Bob fails to deposit; before deadline reportDefault panics
    assert.throws(() => contract.reportDefault({ circle_id, defaulter_id: "bob.near" }), /Round deadline has not expired/);
    contract.advanceTime(70000);

    // Keeper reports default
    contract.setCaller("keeper.near", 0n);
    contract.reportDefault({ circle_id, defaulter_id: "bob.near" });

    // Bob's collateral is seized to cover his round share in the pot
    const circle = contract.circles.get(circle_id);
    assert.equal(circle.total_pot, TEN_NEAR * 2n);
    assert.equal(circle.member_collateral["bob.near"], 0n);
    assert.ok(circle.defaulted_members.includes("bob.near"));

    // Bob's reputation is slashed: 500 - 150 = 350
    const bobProfile = contract.getReputationProfile({ account_id: "bob.near" });
    assert.equal(bobProfile.reputation_score, 350);
    assert.equal(bobProfile.missed_payments, 1);
  });

  it("4. should complete rotation, refund collateral to faithful members, and boost tiers", () => {
    const contract = new OrbitContractHarness();

    contract.setCaller("alice.near", FIVE_NEAR);
    const circle_id = contract.createCircle({
      name: "Faithful Susu",
      contribution_amount: FIVE_NEAR.toString(),
      round_duration_ms: 86400000,
      total_members: 2
    });

    contract.setCaller("bob.near", FIVE_NEAR);
    contract.joinCircle({ circle_id });

    // Round 1
    contract.setCaller("alice.near", FIVE_NEAR);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near", FIVE_NEAR);
    contract.deposit({ circle_id });
    contract.setCaller("keeper.near", 0n);
    contract.claimPayout({ circle_id });

    // Round 2
    contract.setCaller("alice.near", FIVE_NEAR);
    contract.deposit({ circle_id });
    contract.setCaller("bob.near", FIVE_NEAR);
    contract.deposit({ circle_id });
    contract.setCaller("keeper.near", 0n);
    contract.claimPayout({ circle_id });

    const circle = contract.circles.get(circle_id);
    assert.equal(circle.status, CircleStatus.Completed);

    // Total transfers: Round 1 pot (10 NEAR), Round 2 pot (10 NEAR), Alice collateral refund (5 NEAR), Bob collateral refund (5 NEAR)
    assert.equal(contract.transfers.length, 4);

    // Reputations boosted: 500 + 2*15 (deposits) + 50 (completion) = 580 (Silver Tier)
    const aliceP = contract.getReputationProfile({ account_id: "alice.near" });
    assert.equal(aliceP.reputation_score, 580);
    assert.equal(aliceP.tier, ReputationTier.Silver);
    assert.equal(aliceP.circles_completed, 1);
  });

  it("5. should execute getReputationProfile as a strictly read-only view with zero storage writes", () => {
    const contract = new OrbitContractHarness();
    const storageSizeBefore = contract.storage.size;

    const freshProfile = contract.getReputationProfile({ account_id: "stranger.near" });
    assert.equal(freshProfile.account_id, "stranger.near");
    assert.equal(freshProfile.reputation_score, 500);
    assert.equal(freshProfile.tier, ReputationTier.Bronze);
    assert.equal(contract.storage.size, storageSizeBefore);
  });

  it("6. [Attack Scenario A] Round-1 recipient ghosting yields 0 profit and honest members never lose funds", () => {
    const contract = new OrbitContractHarness();
    // 3-member circle, 10 NEAR contribution -> required collateral is (3 - 1) * 10 = 20 NEAR
    const requiredCollateral = 2n * TEN_NEAR;

    // 1x collateral must be rejected for a 3-member circle
    contract.setCaller("alice.near", TEN_NEAR);
    assert.throws(
      () =>
        contract.createCircle({
          name: "Undercollateralized Attempt",
          contribution_amount: TEN_NEAR.toString(),
          round_duration_ms: 60000,
          total_members: 3
        }),
      /Exact collateral stake/
    );

    // Create 3-member circle with full (N-1)*C = 20 NEAR collateral
    contract.setCaller("alice.near", requiredCollateral);
    const circle_id = contract.createCircle({
      name: "3-Member Anti-Ghosting Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 3
    });

    contract.setCaller("bob.near", requiredCollateral);
    contract.joinCircle({ circle_id });
    contract.setCaller("charlie.near", requiredCollateral);
    contract.joinCircle({ circle_id });

    // Round 1: all 3 deposit 10 NEAR; Alice collects 30 NEAR pot
    for (const m of ["alice.near", "bob.near", "charlie.near"]) {
      contract.setCaller(m, TEN_NEAR);
      contract.deposit({ circle_id });
    }
    contract.setCaller("keeper.near", 0n);
    const r1Winner = contract.claimPayout({ circle_id });
    assert.equal(r1Winner, "alice.near");

    // Round 2: Alice ghosts! Bob and Charlie deposit 10 NEAR
    contract.setCaller("bob.near", TEN_NEAR);
    contract.deposit({ circle_id });
    contract.setCaller("charlie.near", TEN_NEAR);
    contract.deposit({ circle_id });

    contract.advanceTime(70000);
    contract.setCaller("keeper.near", 0n);
    contract.reportDefault({ circle_id, defaulter_id: "alice.near" });
    const r2Winner = contract.claimPayout({ circle_id });
    assert.equal(r2Winner, "bob.near");

    // Round 3: Alice ghosts again! Bob and Charlie deposit 10 NEAR
    contract.setCaller("bob.near", TEN_NEAR);
    contract.deposit({ circle_id });
    contract.setCaller("charlie.near", TEN_NEAR);
    contract.deposit({ circle_id });

    contract.advanceTime(70000);
    contract.setCaller("keeper.near", 0n);
    contract.reportDefault({ circle_id, defaulter_id: "alice.near" });
    const r3Winner = contract.claimPayout({ circle_id });
    assert.equal(r3Winner, "charlie.near");

    const finalCircle = contract.circles.get(circle_id);
    assert.equal(finalCircle.status, CircleStatus.Completed);

    // Check Alice's net profit: put in 20 NEAR collateral + 10 NEAR Round 1 deposit = 30 NEAR; received 30 NEAR -> profit == 0!
    const aliceReceived = contract.transfers
      .filter((t) => t.to === "alice.near")
      .reduce((acc, t) => acc + t.amount, 0n);
    const alicePaid = requiredCollateral + TEN_NEAR;
    assert.equal(aliceReceived - alicePaid, 0n);

    // Check Bob and Charlie each received 30 NEAR pot + 20 NEAR collateral refund = 50 NEAR (100% whole!)
    const bobReceived = contract.transfers
      .filter((t) => t.to === "bob.near")
      .reduce((acc, t) => acc + t.amount, 0n);
    const charlieReceived = contract.transfers
      .filter((t) => t.to === "charlie.near")
      .reduce((acc, t) => acc + t.amount, 0n);
    assert.equal(bobReceived, 3n * TEN_NEAR + requiredCollateral);
    assert.equal(charlieReceived, 3n * TEN_NEAR + requiredCollateral);
  });

  it("7. [Attack Scenario A2] withdraw_on_termination refunds 100% of honest members' collateral and deposits", () => {
    const contract = new OrbitContractHarness();
    const requiredCollateral = 2n * TEN_NEAR;

    contract.setCaller("alice.near", requiredCollateral);
    const circle_id = contract.createCircle({
      name: "Terminated Recovery Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 3
    });
    contract.setCaller("bob.near", requiredCollateral);
    contract.joinCircle({ circle_id });
    contract.setCaller("charlie.near", requiredCollateral);
    contract.joinCircle({ circle_id });

    // Round 1 completes normally (Alice receives 30 NEAR)
    for (const m of ["alice.near", "bob.near", "charlie.near"]) {
      contract.setCaller(m, TEN_NEAR);
      contract.deposit({ circle_id });
    }
    contract.setCaller("keeper.near", 0n);
    contract.claimPayout({ circle_id });

    // Round 2: Bob and Charlie deposit 10 NEAR, Alice ghosts, deadline expires
    contract.setCaller("bob.near", TEN_NEAR);
    contract.deposit({ circle_id });
    contract.setCaller("charlie.near", TEN_NEAR);
    contract.deposit({ circle_id });
    contract.advanceTime(70000);

    // Honest members opt to terminate and withdraw immediately
    contract.setCaller("bob.near", 0n);
    contract.withdrawOnTermination({ circle_id });

    const circle = contract.circles.get(circle_id);
    assert.equal(circle.status, CircleStatus.Terminated);
    assert.equal(circle.total_pot, 0n);

    // Bob and Charlie each put in 20 NEAR collateral + 10 NEAR R1 + 10 NEAR R2 = 40 NEAR, and get all 40 NEAR back!
    const bobTotal = contract.transfers
      .filter((t) => t.to === "bob.near")
      .reduce((acc, t) => acc + t.amount, 0n);
    const charlieTotal = contract.transfers
      .filter((t) => t.to === "charlie.near")
      .reduce((acc, t) => acc + t.amount, 0n);
    assert.equal(bobTotal, 4n * TEN_NEAR);
    assert.equal(charlieTotal, 4n * TEN_NEAR);
  });

  it("8. [Attack Scenario B] Defaulting recipient is skipped in claim_payout and never receives the pot", () => {
    const contract = new OrbitContractHarness();

    contract.setCaller("alice.near", TEN_NEAR);
    const circle_id = contract.createCircle({
      name: "Skip Defaulter Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 2
    });
    contract.setCaller("bob.near", TEN_NEAR);
    contract.joinCircle({ circle_id });

    // Alice is scheduled for Round 1 (payout_order[0] === "alice.near"), but Alice defaults in Round 1!
    contract.setCaller("bob.near", TEN_NEAR);
    contract.deposit({ circle_id });

    contract.advanceTime(70000);
    contract.setCaller("keeper.near", 0n);
    contract.reportDefault({ circle_id, defaulter_id: "alice.near" });

    // Now claimPayout is called: Alice MUST be skipped and Bob receives the 20 NEAR pot!
    const actualRecipient = contract.claimPayout({ circle_id });
    assert.equal(actualRecipient, "bob.near");

    const aliceTransfers = contract.transfers.filter((t) => t.to === "alice.near");
    assert.equal(aliceTransfers.length, 0);
  });

  it("9. [Attack Scenario C & Deadline Check] Rejects 1-yoctoNEAR sybil dust circles and denies +15 rep on late deposits", () => {
    const contract = new OrbitContractHarness();

    // 1 yoctoNEAR circle creation must fail
    contract.setCaller("sybil.near", 1n);
    assert.throws(
      () =>
        contract.createCircle({
          name: "Sybil Dust Circle",
          contribution_amount: "1",
          round_duration_ms: 60000,
          total_members: 2
        }),
      /Minimum contribution is 1 NEAR/
    );

    // Late deposit check: depositing after round_deadline gives +0 reputation
    contract.setCaller("alice.near", ONE_NEAR);
    const circle_id = contract.createCircle({
      name: "Deadline Check Circle",
      contribution_amount: ONE_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 2
    });
    contract.setCaller("bob.near", ONE_NEAR);
    contract.joinCircle({ circle_id });

    // Advance past round_deadline before Alice deposits
    contract.advanceTime(70000);
    contract.setCaller("alice.near", ONE_NEAR);
    contract.deposit({ circle_id });

    const aliceProfile = contract.getReputationProfile({ account_id: "alice.near" });
    assert.equal(aliceProfile.reputation_score, 500); // No +15 bonus for late deposit!
    assert.equal(aliceProfile.on_time_payments, 0);
  });

});
