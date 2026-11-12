# Orbit Protocol 🌐⭕

> **Decentralized Rotating Savings & Credit Associations (ROSCAs) with `(N - 1) × C` Anti-Ghosting Collateral & Soulbound Reputation on NEAR Protocol**

Submitted for the **[NEAR Hackathon: Build Beyond Boundaries](https://nearhackathon.com/)** (Nov 1 – Nov 14, 2026).
* **Primary Track:** Real-World Money (`realworld`)
* **Secondary Track:** Social Money (`social`)

---

## 🔗 Live NEAR Testnet Deployment & On-Chain Proof

Orbit Protocol is compiled to native WebAssembly (`contracts/build/orbit_contract.wasm`, 28,260 bytes) and deployed live on **NEAR Testnet**:

* **Contract Account ID:** [`orbit-v2-87299.testnet`](https://testnet.nearblocks.io/address/orbit-v2-87299.testnet)
* **Testnet Participant Accounts:** [`alice-orbit-87299.testnet`](https://testnet.nearblocks.io/address/alice-orbit-87299.testnet), [`bob-orbit-87299.testnet`](https://testnet.nearblocks.io/address/bob-orbit-87299.testnet)
* **Deployment Manifest:** [`contracts/testnet_deployment.json`](./contracts/testnet_deployment.json)

| On-Chain Action | Method | NEAR Testnet Transaction Hash |
| :--- | :--- | :--- |
| **1. Deploy Compiled WASM (28,260 bytes)** | `DeployContract` | [`C6mUBA645sQfaqGbxRYQoojfzEdhrwwyhSWEoJ1YAKQs`](https://testnet.nearblocks.io/txns/C6mUBA645sQfaqGbxRYQoojfzEdhrwwyhSWEoJ1YAKQs) |
| **2. Initialize Contract (Re-Init Guarded)** | `init` | [`8knkXDCrWHmUy7jrJF6L9MUTFj8VgjVbc5iKbwUDZv2d`](https://testnet.nearblocks.io/txns/8knkXDCrWHmUy7jrJF6L9MUTFj8VgjVbc5iKbwUDZv2d) |
| **3. Create Circle #1 (1 NEAR + 1 NEAR Collateral)** | `create_circle` | [`3hmSWSZ4up44HzFZWJhWWVZHsTWfvyEYZwx36VBMGmef`](https://testnet.nearblocks.io/txns/3hmSWSZ4up44HzFZWJhWWVZHsTWfvyEYZwx36VBMGmef) |
| **4. Join & Activate Circle #1** | `join_circle` | [`2iiGpP7WPgC4SUSuv25VyfEPSqqEXLZqioF3R1L1RKDV`](https://testnet.nearblocks.io/txns/2iiGpP7WPgC4SUSuv25VyfEPSqqEXLZqioF3R1L1RKDV) |
| **5. Round 1 Deposit (Alice)** | `deposit` | [`9b7KjeyoBm5PVftttVyScRHmmgWq13hp1gTRA6XBaEvR`](https://testnet.nearblocks.io/txns/9b7KjeyoBm5PVftttVyScRHmmgWq13hp1gTRA6XBaEvR) |
| **6. Round 1 Deposit (Bob)** | `deposit` | [`2LPrSJ85WgfsEgffNuTUxVMgQE8n1qw7Co9DL3b1tjMR`](https://testnet.nearblocks.io/txns/2LPrSJ85WgfsEgffNuTUxVMgQE8n1qw7Co9DL3b1tjMR) |
| **7. Permissionless Round 1 Pot Disbursement** | `claim_payout` | [`911pM3bBRsiNXYw8QyTLSRyUeCY1ywTjLwHgWqGkr9Rw`](https://testnet.nearblocks.io/txns/911pM3bBRsiNXYw8QyTLSRyUeCY1ywTjLwHgWqGkr9Rw) |
| **8. Circle #2 Active Round 1 Deposit** | `deposit` | [`5xWfwLtbjd9Tn6V5tLWqRgTESTSXDzkFtuxsWaH9dUvT`](https://testnet.nearblocks.io/txns/5xWfwLtbjd9Tn6V5tLWqRgTESTSXDzkFtuxsWaH9dUvT) |

---

## ⚡ How Orbit Solves Traditional ROSCA & Smart Contract Security Failures

Over 1 billion people save hundreds of billions of dollars annually in informal rotating savings clubs (*Ajo* in Nigeria, *Tandas* in Mexico, *Susu* in Ghana, *Chit Funds* in India). Orbit enforces mathematical, economic, and smart-contract invariants on-chain:

| Vulnerability | Orbit On-Chain Mechanism (`contracts/src/index.ts` & `near_runtime.ts`) |
| :--- | :--- |
| **1. Early-Recipient Ghosting (Scenario A)** | **Full `(N - 1) × C` Anti-Ghosting Collateral:** Every participant stakes `(total_members - 1) × contribution_amount` upon creating or joining a circle. Even if the Round 1 recipient collects the `N × C` pot and ghosts all remaining `N - 1` rounds, their net profit is `N·C - C - (N-1)·C = 0` (`profit ≤ 0`), and their seized collateral funds all remaining rounds for honest members. |
| **2. Locked Funds on Termination (Scenario A2 & H2)** | **`withdraw_on_termination` & Strict Conservation of Value:** If an active circle defaults unrecoverably or expires past its deadline, honest members can trigger atomic termination to immediately withdraw 100% of their collateral and uncollected deposits (`sum(out) == sum(in)`, `0` stranded funds), with a strict guard against double-settlement. |
| **3. Defaulting Member Receiving Pot (Scenario B)** | **Defaulter Payout Skipping:** `claim_payout` strictly checks `defaulted_members` and `paid_recipients` and **never** routes a pot to a defaulter; the pot goes strictly to the next unpaid honest member. |
| **4. Sybil Score Farming & Late Deposits (Scenario C)** | **1 NEAR Floor & Deadline Enforcement:** `create_circle` enforces `contribution_amount >= 1 NEAR` (`10^24` yoctoNEAR) to prevent 1-yoctoNEAR dust circles, and `deposit` only awards the `+15` reputation bonus if `block_timestamp <= round_deadline`. |
| **5. Delimiter Injection, Key Confusion & Overflow (E1–E3, H1)** | **Token-Aware JSON Parsing & Strict Sanitization:** `findJsonKeyValueStart` strictly distinguishes JSON keys (followed by `:`) from string values. `isSafeText` and `isSafeIdentifier` reject `|`, `"`, `\`, `,`, and control characters across all entrypoints. Numeric inputs are capped at 36 digits (`u128`) and 18 digits (`i64`) to prevent overflow. `init()` checks `!storageHasKey("counter")` to prevent re-initialization. |
| **6. Cancel Griefing in Pending Circles (G1)** | **Creator-Only Cancel & Individual Member Exit:** `cancel_pending_circle` is restricted strictly to the circle creator with a 100% refund. Non-creator joined members call `leave_pending_circle` to safely exit with their collateral without destroying the circle for other prospective members. |
| **7. Storage State Exhaustion (G2)** | **Automatic Storage Reclamation (`storageRemove`):** NEAR Protocol requires 1 NEAR per 100 KB of state storage. Orbit cleans up `col:...` and `cp:...` storage keys upon circle cancellation, member exits, termination, and completion, preventing unbounded state bloat. |

> [!NOTE]
> **Economic Design Note on Collateral & Financial Inclusion:**
> In fully trustless, permissionless environments, `(N - 1) × C` collateral is mathematically necessary to make ghosting zero-profit (`profit ≤ 0`). However, in emerging markets where unbanked users may lack upfront capital, Orbit's Soulbound Reputation passport provides an evolutionary bridge: as users build on-chain credit scores through verified on-time deposits (+15) and circle completions (+50), future circle templates can safely offer *graduated reputation collateral* (e.g. 50% or 0% collateral for Silver/Gold/Platinum tiers), backed by decentralized social vouching.

---

## 🤖 Machine & Judge Verification Guide (Do X → See Y)

Every command below runs out of the box on Windows, macOS, and Linux without external dependencies.

### Step 1: Compile the Smart Contract to WebAssembly
* **Do X:**
  ```bash
  npm --prefix contracts run build
  ```
* **See Y:**
  Compiles `contracts/src/index.ts` and `contracts/src/near_runtime.ts` via AssemblyScript (`asc`) into `contracts/build/orbit_contract.wasm` (28,260 bytes) with exit code `0`.

### Step 2: Run the 18 WASM Invariant Tests & Autonomous Keeper Agent
`contracts/src/harness.mjs` loads and executes the compiled `contracts/build/orbit_contract.wasm` binary directly inside Node's native `WebAssembly` VM (instantiating fresh WASM instances, enforcing NEAR host registers, `u128` little-endian deposits, atomic state rollback on panic, `storageRemove` state deletion, and `ProhibitedInView` read-only enforcement on `@view` methods).

* **Do X:**
  ```bash
  npm test
  ```
* **See Y:**
  ```text
  ▶ Orbit Protocol: Compiled WASM Smart Contract & Security Invariants
    ✔ 1. should require (N-1)*contribution collateral and sort payout_order by on-chain reputation score
    ✔ 2. should enforce exact deposits and allow permissionless keeper claims
    ✔ 3. should seize collateral, slash reputation (-150), and cover pot when member defaults
    ✔ 4. should complete rotation, refund collateral to faithful members, and boost tiers
    ✔ 5. should execute getReputationProfile as a strictly read-only view with zero storage writes
    ✔ 6. [Attack Scenario A] Round-1 recipient ghosting yields 0 profit and honest members never lose funds
    ✔ 7. [Attack Scenario A2] withdraw_on_termination refunds 100% of honest members' collateral and deposits
    ✔ 8. [Attack Scenario B] Defaulting recipient is skipped in claim_payout and never receives the pot
    ✔ 9. [Attack Scenario C & Deadline Check] Rejects 1-yoctoNEAR sybil dust circles and denies +15 rep on late deposits
    ✔ 10. [Exploit E1] Blocks pipe (|) delimiter injection in circle name from forging state or draining escrow
    ✔ 11. [Exploit E2] Guards init() against re-initialization so griefers cannot reset counter or overwrite circles
    ✔ 12. [Exploit E3] Rejects quotes, backslashes, and control characters so get_circles JSON never breaks
    ✔ 13. [Exploit E4 & G1 Defense] Allows creator to cancel Pending circle with 100% refund, blocks non-creator cancellation
    ✔ 14. [G1 Cancel Griefing Defense] Non-creator member calls leave_pending_circle to exit without destroying circle
    ✔ 15. [G2 Storage Cleanup] Deletes collateral storage keys on cancellation and completion to reclaim state
    ✔ 16. [Exploit H1] Prevents JSON key-value confusion when a field value equals a JSON key name
    ✔ 17. [Invariant H2] Enforces 100% conservation of value on Round-1 termination and blocks double-settlement
    ✔ 18. [Keeper Agent] Automatically slashes expired-round defaulters and settles payout in a single poll cycle
  ✔ Orbit Protocol: Compiled WASM Smart Contract & Security Invariants (pass 18 | fail 0)

  === ORBIT PROTOCOL: AUTONOMOUS KEEPER AGENT TEST (WASM VM) ===
  [Keeper Agent] Scanning active circles via get_circles view...
  [Keeper Agent] Circle "Autonomous Test Circle" [circle_1]: Round 1 status: 2/2 paid.
  [Keeper Agent] All round deposits settled! Executing permissionless claim_payout...
  [Keeper Agent] Disbursed pot to honest recipient alice.testnet.
  [Keeper Agent] Circle now at Round 2 (Status: Active).
  === Keeper Agent WASM verification finished successfully! ===
  ```

### Step 3: Run the Keeper Agent Against Live NEAR Testnet
The Autonomous Keeper Agent includes a live network monitor mode that connects directly to NEAR Testnet RPC (and optionally signs on-chain `claim_payout` transactions when `NEAR_KEEPER_ACCOUNT_ID` and `NEAR_KEEPER_PRIVATE_KEY` are provided):
* **Do X:**
  ```bash
  npm run keeper:testnet
  ```
* **See Y:**
  ```text
  === ORBIT PROTOCOL: AUTONOMOUS KEEPER AGENT (LIVE NEAR TESTNET) ===
  [Keeper Agent] Connected to RPC: https://rpc.testnet.near.org
  [Keeper Agent] Monitoring Target Contract: orbit-v2-87299.testnet
  [Keeper Agent] Found 2 circle(s) on NEAR Testnet.
  [Keeper Agent] Circle "Lagos Tech Founders Ajo" [circle_1]: Status=Active, Round 2/2, Deposits=0/2
  [Keeper Agent] Circle "Nairobi Susu Savings" [circle_2]: Status=Active, Round 1/2, Deposits=1/2
  === Keeper Agent Testnet poll cycle completed successfully! ===
  ```

### Step 4: Open the Frontend Connected to NEAR Testnet RPC
* **Do X:**
  Open `frontend/index.html` in any browser.
* **See Y:**
  1. **Live NEAR Testnet RPC Sync:** On load, the app queries `https://rpc.testnet.near.org` (`call_function` on `orbit-v2-87299.testnet`) to fetch live circles (`get_circles`) and reputation profiles (`get_reputation_profile`).
  2. **Honest Dual Write Mode (Local Simulator vs. Live In-Browser Testnet Signer):**
     * Using the pre-loaded demo personas explicitly labels actions `(Simulated)` with toast notifications clarifying `Simulated locally`.
     * Clicking **"✨ Sign Up / Live Signer"** with **"Provision Live NEAR Testnet Account (10 NEAR Faucet)"** checked uses `near-api-js` in the browser to generate an Ed25519 keypair, fund a real `.testnet` account via `https://helper.testnet.near.org/account`, and sign live on-chain transactions (`create_circle`, `join_circle`, `deposit`, `claim_payout`, `report_default`, `cancel_pending_circle`, `leave_pending_circle`, `withdraw_on_termination`) directly from the browser. Keypairs are persisted safely in local storage and can be backed up via the **"🔑 Export Key"** button.

---

## 🏗️ Repository Structure

```text
├── .github/workflows/
│   └── build.yml                   # CI workflow: compiles WASM & runs 18-test suite
├── contracts/
│   ├── build/
│   │   └── orbit_contract.wasm     # Compiled NEAR WebAssembly smart contract binary (28,260 bytes)
│   ├── scripts/
│   │   └── deploy_testnet.mjs      # Live NEAR Testnet deployment & verification script
│   ├── src/
│   │   ├── index.ts                # Orbit smart contract implementation (AssemblyScript)
│   │   ├── near_runtime.ts         # NEAR VM host bindings, token-aware JSON parser & u128 math
│   │   ├── types.ts                # Data model definitions
│   │   ├── harness.mjs             # Node WebAssembly VM host executing orbit_contract.wasm
│   │   └── keeper_agent.mjs        # Autonomous keeper polling get_circles, slashing defaults & claiming pots
│   ├── test/
│   │   └── orbit_test.mjs          # 18 security, exploit, & economic invariant tests against WASM
│   ├── package.json                # Contract build configuration
│   └── testnet_deployment.json     # Public NEAR Testnet deployment manifest & tx hashes
├── frontend/
│   └── index.html                  # Consumer fintech UI wired to rpc.testnet.near.org + near-api-js
├── LICENSE                         # MIT Open-Source License
├── package.json                    # Root scripts & dependencies
├── submission.json                 # Standardized hackathon application payload
└── README.md                       # Documentation & verification guide
```

---

## 📜 License
MIT License — Copyright (c) 2026 Orbit Protocol Contributors
