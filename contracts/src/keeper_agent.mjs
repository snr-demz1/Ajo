/**
 * Orbit Protocol - Autonomous Keeper Agent
 * 
 * Satisfies Track 08 (Real-World Money) and Track 12 (Social Money).
 * Automatically monitors active savings circles on NEAR.
 * When all round contributions settle in escrow, the keeper triggers `claim_payout`
 * permissionlessly so funds are sent directly to the scheduled recipient without human delay.
 * Also monitors deadlines to trigger `report_default` if a member is delinquent.
 */

import { OrbitContractHarness } from './harness.mjs';

export class OrbitKeeperAgent {
  constructor(contract, agentAccountId = "orbit-keeper.near") {
    this.contract = contract;
    this.agentAccountId = agentAccountId;
    this.processedRounds = new Set();
  }

  log(msg) {
    console.log(`[🤖 Keeper Agent | ${new Date().toISOString()}] ${msg}`);
  }

  async runPollCycle() {
    this.log("Scanning active circles on NEAR...");
    const circles = Array.from(this.contract.circles.values());

    for (const circle of circles) {
      if (circle.status !== "Active") continue;

      const round = circle.current_round;
      const key = `${circle.id}_round_${round}`;
      if (this.processedRounds.has(key)) continue;

      const paidCount = (circle.round_paid_members[round] || []).length;
      this.log(`Circle "${circle.name}" [${circle.id}]: Round ${round} status: ${paidCount}/${circle.total_members} paid.`);

      // Condition 1: All deposits settled -> Trigger permissionless payout
      if (paidCount === circle.total_members) {
        this.log(`⚡ Auto-Trigger: All round deposits settled! Executing permissionless claim...`);
        const recipient = circle.payout_order[round - 1];

        // Permissionless execution: Keeper calls with its own account!
        // The contract verifies and routes payout ONLY to `recipient`.
        this.contract.setCaller(this.agentAccountId);
        this.contract.claimPayout({ circle_id: circle.id });
        this.processedRounds.add(key);

        this.log(`Disbursed pot to scheduled recipient ${recipient}.`);
        this.log(`Circle advanced to Round ${circle.current_round} (Status: ${circle.status}).`);
        continue;
      }

      // Condition 2: Round deadline expired and member missed payment -> Report default
      if (this.contract.mock_time_ms > circle.round_deadline) {
        for (const member of circle.members) {
          if (!circle.round_paid_members[round].includes(member)) {
            this.log(`⚠️ Default Detected: Member ${member} missed Round ${round} deadline. Seizing collateral...`);
            this.contract.setCaller(this.agentAccountId);
            this.contract.reportDefault({ circle_id: circle.id, defaulter_id: member });
            this.log(`Member ${member} collateral seized and reputation slashed.`);
          }
        }
      }
    }
  }
}

// Standalone verification execution
if (process.argv[1].endsWith('keeper_agent.mjs')) {
  console.log("=== ORBIT PROTOCOL: AUTONOMOUS KEEPER AGENT TEST ===");
  const harness = new OrbitContractHarness();
  
  // Alice creates circle with 1 round collateral (10 NEAR)
  harness.setCaller("alice.near", 10000000000000000000000000n);
  const circleId = harness.createCircle({
    name: "Autonomous Test Circle",
    contribution_amount: "10000000000000000000000000",
    round_duration_ms: 86400000,
    total_members: 2
  });

  // Bob joins with 1 round collateral (10 NEAR)
  harness.setCaller("bob.near", 10000000000000000000000000n);
  harness.joinCircle({ circle_id: circleId });

  const keeper = new OrbitKeeperAgent(harness);

  // Both deposit for Round 1
  harness.setCaller("alice.near", 10000000000000000000000000n);
  harness.deposit({ circle_id: circleId });
  harness.setCaller("bob.near", 10000000000000000000000000n);
  harness.deposit({ circle_id: circleId });

  // Keeper triggers payout permissionlessly (without impersonating anyone!)
  await keeper.runPollCycle();

  console.log("=== Keeper Agent verification finished successfully! ===");
}
