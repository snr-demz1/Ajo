/**
 * Orbit Protocol - Autonomous Keeper Agent
 *
 * Automatically monitors active savings circles on the compiled NEAR WASM contract.
 * When all round contributions settle in escrow, the keeper triggers `claim_payout`
 * permissionlessly so funds are sent directly to the next honest recipient.
 * Also monitors deadlines to trigger `report_default` if a member misses a round.
 */

import { OrbitContractHarness } from "./harness.mjs";

export class OrbitKeeperAgent {
  constructor(contract, agentAccountId = "orbit-keeper.testnet") {
    this.contract = contract;
    this.agentAccountId = agentAccountId;
    this.processedRounds = new Set();
  }

  log(msg) {
    console.log(`[Keeper Agent | ${new Date().toISOString()}] ${msg}`);
  }

  async runPollCycle() {
    this.log("Scanning active circles via get_circles view...");
    const circles = this.contract.getCircles({ from_index: 0, limit: 50 });

    for (const circle of circles) {
      if (circle.status !== "Active") continue;

      const round = circle.current_round;
      const key = `${circle.id}_round_${round}`;
      if (this.processedRounds.has(key)) continue;

      const paidList = circle.round_paid_members[round] || [];
      const paidCount = paidList.length;
      this.log(`Circle "${circle.name}" [${circle.id}]: Round ${round} status: ${paidCount}/${circle.total_members} paid.`);

      // Condition 1: All deposits settled -> Trigger permissionless payout
      if (paidCount === circle.total_members) {
        this.log(`All round deposits settled! Executing permissionless claim_payout...`);
        this.contract.setCaller(this.agentAccountId, 0n);
        const recipient = this.contract.claimPayout({ circle_id: circle.id });
        this.processedRounds.add(key);

        const updated = this.contract.getCircle({ circle_id: circle.id });
        this.log(`Disbursed pot to honest recipient ${recipient}.`);
        this.log(`Circle now at Round ${updated.current_round} (Status: ${updated.status}).`);
        continue;
      }

      // Condition 2: Round deadline expired and member missed payment -> Report default
      if (this.contract.mock_time_ms > circle.round_deadline) {
        for (const member of circle.members) {
          if (!paidList.includes(member)) {
            this.log(`Default detected: Member ${member} missed Round ${round} deadline. Seizing collateral...`);
            this.contract.setCaller(this.agentAccountId, 0n);
            const outcome = this.contract.reportDefault({ circle_id: circle.id, defaulter_id: member });
            this.log(`Member ${member} default processed (${outcome}): collateral seized & reputation slashed.`);
          }
        }
      }
    }
  }
}

// Standalone verification execution against compiled WASM
if (process.argv[1] && process.argv[1].endsWith("keeper_agent.mjs")) {
  console.log("=== ORBIT PROTOCOL: AUTONOMOUS KEEPER AGENT TEST (WASM VM) ===");
  const harness = new OrbitContractHarness();

  // 2-member circle: required collateral is (2 - 1) * 10 NEAR = 10 NEAR
  const TEN_NEAR = 10000000000000000000000000n;
  harness.setCaller("alice.testnet", TEN_NEAR);
  const circleId = harness.createCircle({
    name: "Autonomous Test Circle",
    contribution_amount: TEN_NEAR.toString(),
    round_duration_ms: 86400000,
    total_members: 2
  });

  harness.setCaller("bob.testnet", TEN_NEAR);
  harness.joinCircle({ circle_id: circleId });

  const keeper = new OrbitKeeperAgent(harness);

  // Both deposit for Round 1
  harness.setCaller("alice.testnet", TEN_NEAR);
  harness.deposit({ circle_id: circleId });
  harness.setCaller("bob.testnet", TEN_NEAR);
  harness.deposit({ circle_id: circleId });

  // Keeper triggers payout permissionlessly
  await keeper.runPollCycle();

  console.log("=== Keeper Agent WASM verification finished successfully! ===");
}
