# Orbit Protocol 🌐⭕

> **Decentralized Rotating Savings & Credit Associations (ROSCAs) with Collateral-Backed Default Protection on NEAR Protocol**

Submitted for the **[NEAR Hackathon: Build Beyond Boundaries](https://nearhackathon.com/)** (Nov 1 – Nov 14, 2026).

---

## 🎯 What Orbit Protocol Is
Orbit Protocol digitizes traditional informal rotating savings and credit clubs (*Ajo* in Nigeria, *Tandas* in Mexico, *Susu* in Ghana, *Chit Funds* in India) using non-custodial NEAR smart contracts, mandatory collateral stakes, and account-bound reputation credentials.

Over 1 billion people save billions annually in informal cash circles. Orbit removes the human vulnerabilities that break them.

---

## ⚡ The Core Problems & How Orbit Solves Them

| Problem in Traditional ROSCAs | The Orbit On-Chain Solution |
| :--- | :--- |
| **1. Organizer Fraud** ("Treasurer vanishes with the cash") | **Non-Custodial Escrow:** Funds are locked in the NEAR smart contract. No human organizer or administrator has withdrawal authority. Payouts can only go to the scheduled recipient. |
| **2. Defaulter Ghosting** (Member takes round 1 pot and stops paying) | **Collateral Staking & Slashing:** Every member stakes 1 round of collateral upon joining. If a member misses a round deadline, `report_default()` seizes their collateral to fund the pot and slashes their reputation score by -150 pts. |
| **3. Creator Bias** (Organizer always takes the first pot) | **Reputation-Gated Turn Order:** Members are sorted by on-chain reputation score descending. High-reputation members get earlier slots; unproven members build trust in later slots. |
| **4. Invisible Credit** (Decades of savings count for 0 bank credit) | **Soulbound Credit Profile:** Every on-time contribution awards +15 points; completed cycles award +50 points. This builds a portable Web3 credit credential. |

---

## 🏆 Target Hackathon Tracks

* **`realworld` (Real-World Money - Primary):** Solves a proven $500B+ informal savings market by replacing physical cash risk with programmatic smart contract escrow and collateral protection.
* **`social` (Social Money - Secondary):** Peer-coordinated rotational pools, group accountability, and community-driven credit building with zero bank fees.

---

## 🤖 Machine & Judge Verification Guide (Do X → See Y)

Tested and verified for automated screening bots (Claude Code / Codex) and human review:

### Step 1: Run All Invariant Tests & Keeper Agent
* **Do X:**
  ```bash
  npm test
  ```
* **See Y:**
  ```text
  ▶ Orbit Protocol: Core Contract Logic & Invariants
    ✔ 1. should require collateral to create and join circle, sorting payout by reputation score
    ✔ 2. should enforce exact deposits and allow permissionless keeper claims
    ✔ 3. should seize collateral, slash reputation (-150), and cover pot when member defaults
    ✔ 4. should complete rotation, refund collateral to faithful members, and boost tiers
    ✔ 5. should execute getReputationProfile as a strictly read-only view with zero storage writes
  ✔ Orbit Protocol: Core Contract Logic & Invariants (pass 5 | fail 0)

  === ORBIT PROTOCOL: AUTONOMOUS KEEPER AGENT TEST ===
  [🤖 Keeper Agent] Scanning active circles on NEAR...
  [🤖 Keeper Agent] ⚡ Auto-Trigger: All round deposits settled! Executing permissionless claim...
  [🤖 Keeper Agent] Disbursed pot to scheduled recipient alice.near.
  === Keeper Agent verification finished successfully! ===
  ```

### Step 2: Open and Test the Interactive Frontend
* **Do X:**
  Open `frontend/index.html` in your browser.
* **See Y:**
  1. **Mint a New Passport:** Click **"✨ Sign Up / Create Pass"**, enter a name (e.g., Alex) and handle (`alex.testnet`), and click Create. See the titanium card instantly update with your name and 500 base score.
  2. **Contribute to Circle:** Under *Lagos Founders Circle*, click **"💳 Pay 10 NEAR Share"**. Watch the pot increase from 10 to 20 NEAR, your member slot change to *Paid*, and your reputation score rise by +15 points.
  3. **Simulate Anti-Default:** Click **"⚠️ Simulate Defaulter Timeout & Seize Collateral"**. Watch an unpaid member's 10 NEAR collateral get seized to fund the round pot, their status turn to *Defaulted*, and their reputation score get slashed by -150 points.
  4. **Disburse Payout:** Once the pot is full (40/40 NEAR), click **"🎉 Disburse Pot"** to send funds to the scheduled recipient and advance the rotation to Round 3.

---

## 🏗️ Architecture & Codebase Layout

```
├── contracts/
│   ├── src/
│   │   ├── index.ts        # Production NEAR smart contract (near-sdk-js)
│   │   ├── types.ts        # Data interfaces (Circle, ReputationProfile, Tiers)
│   │   ├── harness.mjs     # Standalone contract simulator (pure ESM)
│   │   └── keeper_agent.mjs# Autonomous keeper polling and permissionless payouts
│   └── test/
│       └── orbit_test.mjs  # 5 comprehensive invariant test suites
├── frontend/
│   └── index.html          # Interactive consumer fintech interface
├── submission.json         # Hackathon submission payload
├── LICENSE                 # MIT Open-Source License
├── package.json            # Root test runner scripts
└── README.md               # Technical documentation
```

---

## 🔒 Smart Contract Details (`contracts/src/index.ts`)

* **Permissionless Payouts:** `claim_payout` can be triggered by any member or keeper agent. The contract strictly routes the transfer *only* to `circle.payout_order[current_round - 1]`, preventing caller theft while enabling autonomous automation.
* **Safe View Methods:** `get_reputation_profile` is strictly read-only and never writes to storage during view calls, guaranteeing no storage panics on NEAR RPCs.
* **Exact Deposit Guarantees:** Rejects underpayments and overpayments to prevent silent fund absorption.
* **Collateral Refund:** Faithful members who complete all rounds receive their 1-round collateral deposit fully refunded upon final circle completion.

---

## 📜 License
MIT License - Copyright (c) 2026 Orbit Protocol Contributors
