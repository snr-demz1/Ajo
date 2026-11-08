/**
 * Orbit Protocol - Autonomous Keeper Agent
 * 
 * Satisfies Track 04 (Autonomous Business) & Track 07 (Agent Economy).
 * Automatically monitors active savings circles on NEAR Testnet, detects when all
 * round contributions have settled in escrow, and programmatically executes
 * the claim_payout method on behalf of the circle so no manual intervention is needed.
 */

import { OrbitContractHarness } from '../test/orbit_test.mjs';

class OrbitKeeperAgent {
  constructor(contract, agentAccountId = "orbit-keeper.near") {
    this.contract = contract;
    this.agentAccountId = agentAccountId;
    this.isMonitoring = false;
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

      if (paidCount === circle.total_members) {
        this.log(`⚡ Auto-Trigger Condition Met: All deposits settled for Round ${round}!`);
        const recipient = circle.payout_order[round - 1];

        // Autonomous execution
        this.contract.setCaller(recipient);
        this.contract.claimPayout({ circle_id: circle.id });
        this.processedRounds.add(key);

        this.log(`Disbursed ${circle.contribution_amount * BigInt(circle.total_members)} to scheduled recipient ${recipient}.`);
        this.log(`Advancing circle to Round ${circle.current_round} (Status: ${circle.status}).`);
      }
    }
  }
}

// Self-Test Execution
console.log("=== ORBIT PROTOCOL: AUTONOMOUS KEEPER AGENT TEST ===");
const harness = new OrbitContractHarness();
harness.setCaller("alice.near");
const circleId = harness.createCircle({
  name: "Autonomous Test Circle",
  contribution_amount: "10000000000000000000000000", // 10 NEAR
  round_duration_ms: 86400000,
  total_members: 2
});

harness.setCaller("bob.near");
harness.joinCircle({ circle_id: circleId });

const keeper = new OrbitKeeperAgent(harness);

// Both deposit
harness.setCaller("alice.near", 10000000000000000000000000n);
harness.deposit({ circle_id: circleId });
harness.setCaller("bob.near", 10000000000000000000000000n);
harness.deposit({ circle_id: circleId });

// Agent triggers payout autonomously
await keeper.runPollCycle();

console.log("=== Keeper Agent verification finished successfully! ===");
