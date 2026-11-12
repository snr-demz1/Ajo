import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OrbitContractHarness, CircleStatus, ReputationTier } from "../src/harness.mjs";
import { OrbitKeeperAgent } from "../src/keeper_agent.mjs";

const ONE_NEAR = 1_000_000_000_000_000_000_000_000n;
const FIVE_NEAR = 5n * ONE_NEAR;
const TEN_NEAR = 10n * ONE_NEAR;

describe("Ajo: Compiled WASM Smart Contract & Security Invariants", () => {

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

  it("10. [Exploit E1] Blocks pipe (|) delimiter injection in circle name from forging state or draining escrow", () => {
    const contract = new OrbitContractHarness();

    contract.setCaller("attacker.testnet", ONE_NEAR);
    assert.throws(
      () =>
        contract.createCircle({
          name: "xx|attacker.testnet|1|0|60000|0|attacker.testnet|attacker.testnet|1|0|0|Active|120000000000000000000000000||",
          contribution_amount: ONE_NEAR.toString(),
          round_duration_ms: 60000,
          total_members: 2
        }),
      /Circle name must be 2-64 safe characters/
    );
  });

  it("11. [Exploit E2] Guards init() against re-initialization so griefers cannot reset counter or overwrite circles", () => {
    const contract = new OrbitContractHarness();

    contract.setCaller("alice.near", TEN_NEAR);
    const circleId = contract.createCircle({
      name: "Protected Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 2
    });
    assert.equal(circleId, "circle_1");

    // Griefer attempts to call init() to reset counter
    contract.setCaller("griefer.testnet", 0n);
    assert.throws(() => contract.init(), /Contract is already initialized/);

    // Original circle_1 remains intact
    const circle = contract.getCircle({ circle_id: "circle_1" });
    assert.equal(circle.name, "Protected Circle");
    assert.equal(circle.creator, "alice.near");
  });

  it("12. [Exploit E3] Rejects quotes, backslashes, and control characters so get_circles JSON never breaks", () => {
    const contract = new OrbitContractHarness();

    contract.setCaller("alice.near", ONE_NEAR);
    assert.throws(
      () =>
        contract.createCircle({
          name: 'Bad "Quote" Circle',
          contribution_amount: ONE_NEAR.toString(),
          round_duration_ms: 60000,
          total_members: 2
        }),
      /Circle name must be 2-64 safe characters/
    );

    assert.throws(
      () =>
        contract.createCircle({
          name: "Bad \\Backslash Circle",
          contribution_amount: ONE_NEAR.toString(),
          round_duration_ms: 60000,
          total_members: 2
        }),
      /Circle name must be 2-64 safe characters/
    );

    // Valid circle works and getCircles() returns valid parsed objects
    contract.createCircle({
      name: "Clean Circle #1",
      contribution_amount: ONE_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 2
    });
    const list = contract.getCircles({ from_index: 0, limit: 10 });
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Clean Circle #1");
  });

  it("13. [Exploit E4 & G1 Defense] Allows creator to cancel Pending circle with 100% refund, blocks non-creator cancellation", () => {
    const contract = new OrbitContractHarness();
    // 20-member, 10-NEAR circle requires 19 * 10 = 190 NEAR collateral
    const collateral190 = 19n * TEN_NEAR;

    contract.setCaller("alice.near", collateral190);
    const circle_id = contract.createCircle({
      name: "Large 20 Member Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 86400000,
      total_members: 20
    });

    // Random non-creator griefer cannot cancel Alice's pending circle
    contract.setCaller("griefer.near", 0n);
    assert.throws(() => contract.cancelPendingCircle({ circle_id }), /Only the circle creator can cancel a pending circle/);

    // Alice (creator) cancels the pending circle via cancel_pending_circle
    contract.setCaller("alice.near", 0n);
    contract.cancelPendingCircle({ circle_id });

    const circle = contract.getCircle({ circle_id });
    assert.equal(circle.status, CircleStatus.Terminated);
    assert.equal(circle.member_collateral["alice.near"] ?? 0n, 0n);

    // Verify Alice received all 190 NEAR back
    const aliceRefund = contract.transfers
      .filter((t) => t.to === "alice.near")
      .reduce((acc, t) => acc + t.amount, 0n);
    assert.equal(aliceRefund, collateral190);
  });

  it("14. [G1 Cancel Griefing Defense] Non-creator member calls leave_pending_circle to exit without destroying circle", () => {
    const contract = new OrbitContractHarness();
    // 3-member circle: 2 * 10 = 20 NEAR collateral each
    const collateral20 = 2n * TEN_NEAR;

    contract.setCaller("alice.near", collateral20);
    const circle_id = contract.createCircle({
      name: "Community Savings Club",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 86400000,
      total_members: 3
    });

    // Bob joins
    contract.setCaller("bob.near", collateral20);
    contract.joinCircle({ circle_id });

    // Bob attempts to cancel whole circle -> BLOCKED (only creator can cancel)
    assert.throws(
      () => contract.cancelPendingCircle({ circle_id }),
      /Only the circle creator can cancel a pending circle/
    );

    // Bob calls leave_pending_circle: Bob exits and recovers his 20 NEAR, circle stays Pending!
    const beforeTransfers = contract.transfers.length;
    contract.leavePendingCircle({ circle_id });

    const bobRefund = contract.transfers
      .slice(beforeTransfers)
      .filter((t) => t.to === "bob.near")
      .reduce((acc, t) => acc + t.amount, 0n);
    assert.equal(bobRefund, collateral20);

    // Circle remains Pending and open for new members; Alice's collateral remains safe
    const circle = contract.getCircle({ circle_id });
    assert.equal(circle.status, CircleStatus.Pending);
    assert.equal(circle.members.length, 1);
    assert.deepEqual(circle.members, ["alice.near"]);

    // Carol can now join in Bob's place
    contract.setCaller("carol.near", collateral20);
    contract.joinCircle({ circle_id });
    assert.equal(contract.getCircle({ circle_id }).members.length, 2);
  });

  it("15. [G2 Storage Cleanup] Deletes collateral storage keys on cancellation and completion to reclaim state", () => {
    const contract = new OrbitContractHarness();

    contract.setCaller("alice.near", FIVE_NEAR);
    const circle_id = contract.createCircle({
      name: "Cleanup Circle",
      contribution_amount: FIVE_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 2
    });

    // Storage key exists while circle is active
    const colKey = `col:${circle_id}:alice.near`;
    assert.equal(contract.storage.has(colKey), true);

    // Cancel pending circle
    contract.cancelPendingCircle({ circle_id });

    // Storage key was removed via storageRemove() to reclaim trie storage
    assert.equal(contract.storage.has(colKey), false);
  });

  it("16. [Exploit H1] Prevents JSON key-value confusion when a field value equals a JSON key name", () => {
    const contract = new OrbitContractHarness();

    // Even if `name` is literally "round_duration_ms" and `total_members` appears before `round_duration_ms`,
    // token-aware JSON parsing only matches keys followed by ':' and never confuses values with keys
    contract.setCaller("alice.near", ONE_NEAR);
    const circle_id = contract._invoke(
      "create_circle",
      {
        name: "round_duration_ms",
        total_members: 2,
        round_duration_ms: 60000,
        contribution_amount: ONE_NEAR.toString()
      },
      false
    );
    const circle = contract.getCircle({ circle_id });
    assert.equal(circle.name, "round_duration_ms");
    assert.equal(circle.total_members, 2);
    assert.equal(circle.round_duration_ms, 60000);
  });

  it("17. [Invariant H2] Enforces 100% conservation of value on Round-1 termination and blocks double-settlement", () => {
    const contract = new OrbitContractHarness();
    const requiredCollateral = 2n * TEN_NEAR;

    // 3 members each stake 20 NEAR collateral (60 NEAR total collateral)
    contract.setCaller("alice.near", requiredCollateral);
    const circle_id = contract.createCircle({
      name: "Round1 Conservation Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 3
    });
    contract.setCaller("bob.near", requiredCollateral);
    contract.joinCircle({ circle_id });
    contract.setCaller("charlie.near", requiredCollateral);
    contract.joinCircle({ circle_id });

    // Round 1: Bob deposits 10 NEAR; Alice and Charlie miss the deadline
    contract.setCaller("bob.near", TEN_NEAR);
    contract.deposit({ circle_id });
    contract.advanceTime(70000);

    // Keeper reports Alice's default (10 NEAR seized into pot), thenCharlie still hasn't paid -> Bob calls withdraw_on_termination
    contract.setCaller("keeper.near", 0n);
    contract.reportDefault({ circle_id, defaulter_id: "alice.near" });

    contract.setCaller("bob.near", 0n);
    contract.withdrawOnTermination({ circle_id });

    // Total funds put into the contract: 3 * 20 NEAR collateral + 10 NEAR Bob deposit = 70 NEAR
    const totalIn = 3n * requiredCollateral + TEN_NEAR;
    const totalOut = contract.transfers.reduce((acc, t) => acc + t.amount, 0n);
    assert.equal(totalOut, totalIn, "Every single yoctoNEAR must be accounted for with 0 stranded funds");

    // Calling withdraw_on_termination a second time on the already-settled circle must be rejected
    assert.throws(
      () => contract.withdrawOnTermination({ circle_id }),
      /Terminated circle has already been settled and refunded/
    );
  });

  it("18. [Keeper Agent] Automatically slashes expired-round defaulters and settles payout in a single poll cycle", async () => {
    const contract = new OrbitContractHarness();
    const keeper = new OrbitKeeperAgent(contract, "autonomous-keeper.testnet");

    contract.setCaller("alice.near", TEN_NEAR);
    const circle_id = contract.createCircle({
      name: "Keeper Auto-Slash Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 2
    });
    contract.setCaller("bob.near", TEN_NEAR);
    contract.joinCircle({ circle_id });

    // Alice deposits on time; Bob misses the deadline
    contract.setCaller("alice.near", TEN_NEAR);
    contract.deposit({ circle_id });
    contract.advanceTime(70000);

    // Single keeper poll cycle detects expired deadline, calls report_default on Bob, and immediately claims payout for Alice
    await keeper.runPollCycle();

    const updated = contract.getCircle({ circle_id });
    assert.equal(updated.status, CircleStatus.Completed);
    const aliceReceived = contract.transfers
      .filter((t) => t.to === "alice.near")
      .reduce((acc, t) => acc + t.amount, 0n);
    // Alice received 20 NEAR Round 1 pot + 10 NEAR collateral refund = 30 NEAR
    assert.equal(aliceReceived, 3n * TEN_NEAR);
  });

  it("19. [Credit] Silver pass locks half, voucher locks the rest, and ghosting still pays honest members", () => {
    const contract = new OrbitContractHarness();
    const required = 2n * TEN_NEAR;
    const half = TEN_NEAR;

    // Bronze cannot open a credit line.
    contract.setCaller("alice.near", half);
    assert.throws(
      () =>
        contract.createCircle({
          name: "Bronze Credit",
          contribution_amount: TEN_NEAR.toString(),
          round_duration_ms: 60000,
          total_members: 3,
          credit: 1
        }),
      /Silver soulbound pass/
    );

    // Warm Bob to Silver (580) and mint his pass.
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
    const transferStart = contract.transfers.length;

    contract.setCaller("alice.near", required);
    const circle_id = contract.createCircle({
      name: "Vouched Circle",
      contribution_amount: TEN_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 3
    });
    contract.setCaller("bob.near", half);
    contract.joinCircle({ circle_id, credit: 1 });
    contract.setCaller("charlie.near", required);
    contract.joinCircle({ circle_id });
    assert.equal(contract.getCircle({ circle_id }).status, CircleStatus.Pending);

    contract.setCaller("vera.near", half);
    contract.vouch({ circle_id, member_id: "bob.near" });
    const live = contract.getCircle({ circle_id });
    assert.equal(live.status, CircleStatus.Active);
    assert.equal(live.payout_order[0], "bob.near");

    for (const m of ["alice.near", "bob.near", "charlie.near"]) {
      contract.setCaller(m, TEN_NEAR);
      contract.deposit({ circle_id });
    }
    contract.setCaller("keeper.near", 0n);
    assert.equal(contract.claimPayout({ circle_id }), "bob.near");

    // Bob ghosts the remaining two rounds. His half is seized, then Vera's half.
    for (let round = 0; round < 2; round++) {
      contract.setCaller("alice.near", TEN_NEAR);
      contract.deposit({ circle_id });
      contract.setCaller("charlie.near", TEN_NEAR);
      contract.deposit({ circle_id });
      contract.advanceTime(70000);
      contract.setCaller("keeper.near", 0n);
      contract.reportDefault({ circle_id, defaulter_id: "bob.near" });
      contract.claimPayout({ circle_id });
    }

    const received = (id) =>
      contract.transfers.slice(transferStart).filter((t) => t.to === id).reduce((acc, t) => acc + t.amount, 0n);

    // Honest members get their pot and their full collateral back.
    assert.equal(received("alice.near"), 3n * TEN_NEAR + required);
    assert.equal(received("charlie.near"), 3n * TEN_NEAR + required);
    // Bob's profit is exactly Vera's loss. Together they extract nothing.
    const bobNet = received("bob.near") - (half + TEN_NEAR);
    const veraNet = received("vera.near") - half;
    assert.equal(bobNet + veraNet, 0n);
    assert.equal(veraNet, -half);
    assert.equal(contract.getCircle({ circle_id }).status, CircleStatus.Completed);
  });

  it("20. [Soulbound NFT] Reputation pass is non-transferable and publishes the collateral rate", () => {
    const contract = new OrbitContractHarness();
    assert.equal(contract.nftToken({ token_id: "alice.near" }), null);

    contract.setCaller("alice.near", ONE_NEAR);
    contract.createCircle({
      name: "Pass Circle",
      contribution_amount: ONE_NEAR.toString(),
      round_duration_ms: 60000,
      total_members: 2
    });

    const pass = contract.nftToken({ token_id: "alice.near" });
    assert.equal(pass.owner_id, "alice.near");
    assert.equal(pass.soulbound, true);
    assert.equal(pass.metadata.extra.includes("collateral_bps=10000"), true);
    assert.throws(() => contract.nftTransfer(), /Soulbound/);
    assert.equal(contract.nftToken({ token_id: "alice.near" }).owner_id, "alice.near");
  });

  it("21. [Stablecoin] Circle collateral and the pot move as fungible-token calls, not NEAR", () => {
    const contract = new OrbitContractHarness();
    const unit = 1_000_000n;
    const token = "usdc.testnet";

    contract.setCaller("alice.near", 0n);
    const circle_id = contract.createCircle({
      name: "USDC Circle",
      contribution_amount: unit.toString(),
      round_duration_ms: 60000,
      total_members: 2,
      token_id: token
    });
    assert.equal(contract.getCircle({ circle_id }).status, CircleStatus.Pending);

    contract.setCaller(token, 1n);
    contract.ftOnTransfer({ sender_id: "alice.near", amount: unit, msg: `collateral:${circle_id}` });
    contract.setCaller("bob.near", 0n);
    contract.joinCircle({ circle_id });
    contract.setCaller(token, 1n);
    contract.ftOnTransfer({ sender_id: "bob.near", amount: unit, msg: `collateral:${circle_id}` });
    assert.equal(contract.getCircle({ circle_id }).status, CircleStatus.Active);

    contract.setCaller("alice.near", unit);
    assert.throws(() => contract.deposit({ circle_id }), /ft_transfer_call/);

    contract.setCaller(token, 1n);
    contract.ftOnTransfer({ sender_id: "alice.near", amount: unit, msg: `deposit:${circle_id}` });
    contract.ftOnTransfer({ sender_id: "bob.near", amount: unit, msg: `deposit:${circle_id}` });
    contract.setCaller("keeper.near", 0n);
    contract.claimPayout({ circle_id });

    assert.equal(contract.transfers.length, 0);
    const payout = contract.functionCalls.find((c) => c.method === "ft_transfer");
    assert.ok(payout);
    assert.equal(payout.to, token);
    assert.equal(payout.args.includes('"amount":"2000000"'), true);
  });

});
