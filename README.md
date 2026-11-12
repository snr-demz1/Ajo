# Orbit Protocol 🌐⭕

> **Decentralized Rotating Savings & Credit Associations (ROSCAs) with `(N - 1) × C` Anti-Ghosting Collateral & Soulbound Reputation on NEAR Protocol**

Submitted for the **[NEAR Hackathon: Build Beyond Boundaries](https://nearhackathon.com/)** (Nov 1 – Nov 14, 2026).
* **Primary Track:** Real-World Money (`realworld`)
* **Secondary Track:** Social Money (`social`)

---

## 🔗 Live NEAR Testnet Deployment & On-Chain Proof

Orbit Protocol is compiled to native WebAssembly (`contracts/build/orbit_contract.wasm`, 27,480 bytes) and deployed live on **NEAR Testnet**:

* **Contract Account ID:** [`orbit-v2-20234.testnet`](https://testnet.nearblocks.io/address/orbit-v2-20234.testnet)
* **Testnet Participant Accounts:** [`alice-orbit-20234.testnet`](https://testnet.nearblocks.io/address/alice-orbit-20234.testnet), [`bob-orbit-20234.testnet`](https://testnet.nearblocks.io/address/bob-orbit-20234.testnet)
* **Deployment Manifest:** [`contracts/testnet_deployment.json`](./contracts/testnet_deployment.json)

| On-Chain Action | Method | NEAR Testnet Transaction Hash |
| :--- | :--- | :--- |
| **1. Deploy Compiled WASM (27,480 bytes)** | `DeployContract` | [`8B94PG26DE2xhuKisDbYZJRuBeJAUkmQCwCCkhne3ZEH`](https://testnet.nearblocks.io/txns/8B94PG26DE2xhuKisDbYZJRuBeJAUkmQCwCCkhne3ZEH) |
| **2. Initialize Contract (Re-Init Guarded)** | `init` | [`8hxakoF1xKxGECVs4mqT9axuax3wqNLYNT62tGVFYVg`](https://testnet.nearblocks.io/txns/8hxakoF1xKxGECVs4mqT9axuax3wqNLYNT62tGVFYVg) |
| **3. Create Circle #1 (1 NEAR + 1 NEAR Collateral)** | `create_circle` | [`BCg7pmsEUKnQbFfXwianXWbcqp9vNDDQHLfFfBnUAzFe`](https://testnet.nearblocks.io/txns/BCg7pmsEUKnQbFfXwianXWbcqp9vNDDQHLfFfBnUAzFe) |
| **4. Join & Activate Circle #1** | `join_circle` | [`HMSzwKeyurr7Lnu8v5MdBtKC5zcxQMtDqw7tHq3arMYV`](https://testnet.nearblocks.io/txns/HMSzwKeyurr7Lnu8v5MdBtKC5zcxQMtDqw7tHq3arMYV) |
| **5. Round 1 Deposit (Alice)** | `deposit` | [`J6Ky5EZNGtgH1xwA19e6H6Zun6zQ6Y6iD4YDcqon5kXR`](https://testnet.nearblocks.io/txns/J6Ky5EZNGtgH1xwA19e6H6Zun6zQ6Y6iD4YDcqon5kXR) |
| **6. Round 1 Deposit (Bob)** | `deposit` | [`FSKoqTsx3hqEMajPbG5bY4CVSABC1y8resYhcEykuLE`](https://testnet.nearblocks.io/txns/FSKoqTsx3hqEMajPbG5bY4CVSABC1y8resYhcEykuLE) |
| **7. Permissionless Round 1 Pot Disbursement** | `claim_payout` | [`Aba5qdyWFcVWy2rgqQvrBXCsow563DLqyiLXQTndQbS8`](https://testnet.nearblocks.io/txns/Aba5qdyWFcVWy2rgqQvrBXCsow563DLqyiLXQTndQbS8) |
| **8. Circle #2 Active Round 1 Deposit** | `deposit` | [`4SiGEWRnQ8UZQkxMtzMMXmSpwF5UJ9TU5asmvJdJzLAU`](https://testnet.nearblocks.io/txns/4SiGEWRnQ8UZQkxMtzMMXmSpwF5UJ9TU5asmvJdJzLAU) |

---

## ⚡ How Orbit Solves Traditional ROSCA & Smart Contract Security Failures

Over 1 billion people save hundreds of billions of dollars annually in informal rotating savings clubs (*Ajo* in Nigeria, *Tandas* in Mexico, *Susu* in Ghana, *Chit Funds* in India). Orbit enforces mathematical, economic, and smart-contract invariants on-chain:

| Vulnerability | Orbit On-Chain Mechanism (`contracts/src/index.ts`) |
| :--- | :--- |
| **1. Early-Recipient Ghosting (Scenario A)** | **Full `(N - 1) × C` Anti-Ghosting Collateral:** Every participant stakes `(total_members - 1) × contribution_amount` upon creating or joining a circle. Even if the Round 1 recipient collects the `N × C` pot and ghosts all remaining `N - 1` rounds, their net profit is `N·C - C - (N-1)·C = 0` (`profit ≤ 0`), and their seized collateral funds all remaining rounds for honest members. |
| **2. Locked Funds on Termination (Scenario A2)** | **`withdraw_on_termination`:** If an active circle defaults unrecoverably or expires past its deadline, honest members can trigger atomic termination to immediately withdraw 100% of their collateral and uncollected deposits (`0` locked funds). |
| **3. Defaulting Member Receiving Pot (Scenario B)** | **Defaulter Payout Skipping:** `claim_payout` strictly checks `defaulted_members` and `paid_recipients` and **never** routes a pot to a defaulter; the pot goes strictly to the next unpaid honest member. |
| **4. Sybil Score Farming & Late Deposits (Scenario C)** | **1 NEAR Floor & Deadline Enforcement:** `create_circle` enforces `contribution_amount >= 1 NEAR` (`10^24` yoctoNEAR) to prevent 1-yoctoNEAR dust circles, and `deposit` only awards the `+15` reputation bonus if `block_timestamp <= round_deadline`. |
| **5. Delimiter Injection & Overflow (E1, E2, E3)** | **Strict Sanitization & U128 Caps:** `isSafeText` and `isSafeIdentifier` reject `|`, `"`, `\`, `,`, and control characters across all entrypoints. Numeric inputs are capped at 36 digits to prevent `u128` overflow. `init()` checks `!storageHasKey("counter")` to prevent re-initialization attacks. |
| **6. Cancel Griefing in Pending Circles (G1)** | **Creator-Only Cancel & Individual Member Exit:** `cancel_pending_circle` is restricted strictly to the circle creator with a 100% refund. Non-creator joined members call `leave_pending_circle` to safely exit with their collateral without destroying the circle for other prospective members. |
| **7. Storage State Exhaustion (G2)** | **Automatic Storage Reclamation (`storageRemove`):** NEAR Protocol requires 1 NEAR per 100 KB of state storage. Orbit cleans up `col:...` storage keys upon circle cancellation, member exits, and circle completion, preventing unbounded state bloat. |

> [!NOTE]
> **Economic Design Note on Collateral & Financial Inclusion:**
> In fully trustless, permissionless environments, `(N - 1) × C` collateral is mathematically necessary to make ghosting zero-profit (`profit ≤ 0`). However, in emerging markets where unbanked users may lack upfront capital, Orbit's Soulbound Reputation passport provides an evolutionary bridge: as users build on-chain credit scores through verified on-time deposits (+15) and circle completions (+50), future circle templates can safely offer *graduated reputation collateral* (e.g. 50% or 0% collateral for Silver/Gold tiers), backed by decentralized social vouching.

---

## 🤖 Machine & Judge Verification Guide (Do X → See Y)

Every command below runs out of the box on Windows, macOS, and Linux without external dependencies.

### Step 1: Compile the Smart Contract to WebAssembly
* **Do X:**
  ```bash
  npm --prefix contracts run build
  ```
* **See Y:**
  Compiles `contracts/src/index.ts` and `contracts/src/near_runtime.ts` via AssemblyScript (`asc`) into `contracts/build/orbit_contract.wasm` (27,480 bytes) with exit code `0`.

### Step 2: Run the 15 WASM Invariant Tests & Autonomous Keeper Agent
`contracts/src/harness.mjs` loads and executes the compiled `contracts/build/orbit_contract.wasm` binary directly inside Node's native `WebAssembly` VM (instantiating fresh WASM instances, enforcing NEAR host registers, `u128` little-endian deposits, atomic state rollback on panic, `storageRemove` state deletion, and `ProhibitedInView` read-only enforcement on `@view` methods).

* **Do X:**
  ```bash
  npm test
  ```
* **See Y:**
  ```text
  ▶ Orbit Protocol: Compiled WASM Smart Contract & Security Invariants
    ✔ 1. should require (N-1)*contribution collateral and sort payout_order by on-chain reputation score (16.4ms)
    ✔ 2. should enforce exact deposits and allow permissionless keeper claims (6.6ms)
    ✔ 3. should seize collateral, slash reputation (-150), and cover pot when member defaults (5.5ms)
    ✔ 4. should complete rotation, refund collateral to faithful members, and boost tiers (5.1ms)
    ✔ 5. should execute getReputationProfile as a strictly read-only view with zero storage writes (2.4ms)
    ✔ 6. [Attack Scenario A] Round-1 recipient ghosting yields 0 profit and honest members never lose funds (7.3ms)
    ✔ 7. [Attack Scenario A2] withdraw_on_termination refunds 100% of honest members' collateral and deposits (6.5ms)
    ✔ 8. [Attack Scenario B] Defaulting recipient is skipped in claim_payout and never receives the pot (3.6ms)
    ✔ 9. [Attack Scenario C & Deadline Check] Rejects 1-yoctoNEAR sybil dust circles and denies +15 rep on late deposits (3.4ms)
    ✔ 10. [Exploit E1] Blocks pipe (|) delimiter injection in circle name from forging state or draining escrow (3.4ms)
    ✔ 11. [Exploit E2] Guards init() against re-initialization so griefers cannot reset counter or overwrite circles (4.0ms)
    ✔ 12. [Exploit E3] Rejects quotes, backslashes, and control characters so get_circles JSON never breaks (4.0ms)
    ✔ 13. [Exploit E4 & G1 Defense] Allows creator to cancel Pending circle with 100% refund, blocks non-creator cancellation (3.7ms)
    ✔ 14. [G1 Cancel Griefing Defense] Non-creator member calls leave_pending_circle to exit without destroying circle (5.3ms)
    ✔ 15. [G2 Storage Cleanup] Deletes collateral storage keys on cancellation and completion to reclaim state (3.1ms)
  ✔ Orbit Protocol: Compiled WASM Smart Contract & Security Invariants (pass 15 | fail 0)

  === ORBIT PROTOCOL: AUTONOMOUS KEEPER AGENT TEST (WASM VM) ===
  [Keeper Agent] Scanning active circles via get_circles view...
  [Keeper Agent] Circle "Autonomous Test Circle" [circle_1]: Round 1 status: 2/2 paid.
  [Keeper Agent] All round deposits settled! Executing permissionless claim_payout...
  [Keeper Agent] Disbursed pot to honest recipient alice.testnet.
  [Keeper Agent] Circle now at Round 2 (Status: Active).
  === Keeper Agent WASM verification finished successfully! ===
  ```

### Step 3: Run the Keeper Agent Against Live NEAR Testnet
The Autonomous Keeper Agent includes a live network monitor mode that connects directly to NEAR Testnet RPC:
* **Do X:**
  ```bash
  npm run keeper:testnet
  ```
* **See Y:**
  ```text
  === ORBIT PROTOCOL: AUTONOMOUS KEEPER AGENT (LIVE NEAR TESTNET) ===
  [Keeper Agent] Connected to RPC: https://rpc.testnet.near.org
  [Keeper Agent] Monitoring Target Contract: orbit-v2-20234.testnet
  [Keeper Agent] Found 2 circle(s) on NEAR Testnet.
  [Keeper Agent] Circle "Lagos Tech Founders Ajo" [circle_1]: Status=Active, Round 2/2, Deposits=0/2
  [Keeper Agent] Circle "Nairobi Susu Savings" [circle_2]: Status=Active, Round 1/2, Deposits=1/2
  === Keeper Agent Testnet poll cycle completed successfully! ===
  ```

### Step 4: Open the Frontend Connected to NEAR Testnet RPC
* **Do X:**
  Open `frontend/index.html` in any browser.
* **See Y:**
  1. **Live NEAR Testnet RPC Sync (Multi-RPC Failover):** On load, the app queries `https://rpc.testnet.near.org` (with automatic failover to `https://test.rpc.fastnear.com`) on `orbit-v2-20234.testnet` to fetch live circles (`get_circles`) and reputation profiles (`get_reputation_profile`).
  2. **Autonomous Keeper Agent Console (`orbit-keeper.testnet`):** Embedded directly in the dashboard with live execution logs, **Auto-Settle Ready Pots (Auto-Pilot)**, **"⚡ Run Keeper Poll Now"**, and **"🚀 1-Click Auto-Settle Demo"** to demonstrate permissionless `claim_payout` and `report_default` automation end-to-end.
  3. **Verifiable Soulbound Credit Passport (`Verify JSON ↗`):** Clicking the metallic Soulbound Credential card opens the live `orbit-sbt-v1` on-chain JSON payload (`rep:<account_id>`) and tier progression roadmap (`Bronze` → `Silver` → `Gold` → `Platinum`).
  4. **Honest Dual Write Mode (Local Simulator vs. Live In-Browser Testnet Signer):**
     * Using the pre-loaded demo personas explicitly labels actions `(Simulated)` with toast notifications clarifying `Simulated locally`.
     * Clicking **"✨ Sign Up / Live Signer"** with **"Provision Live NEAR Testnet Account (10 NEAR Faucet)"** checked uses `near-api-js` in the browser to generate an Ed25519 keypair, fund a real `.testnet` account via `https://helper.testnet.near.org/account`, and sign live on-chain transactions (`create_circle`, `join_circle`, `deposit`, `claim_payout`, `cancel_pending_circle`, `leave_pending_circle`, `withdraw_on_termination`) directly from the browser. Keypairs are persisted safely in local storage and can be backed up via the **"🔑 Export Key"** button.

---

## 🏗️ Repository Structure

```text
├── .github/workflows/
│   └── build.yml                   # CI workflow: compiles WASM & runs 15-test suite
├── contracts/
│   ├── build/
│   │   └── orbit_contract.wasm     # Compiled NEAR WebAssembly smart contract binary (27,480 bytes)
│   ├── scripts/
│   │   └── deploy_testnet.mjs      # Live NEAR Testnet deployment & verification script
│   ├── src/
│   │   ├── index.ts                # Orbit smart contract implementation (AssemblyScript)
│   │   ├── near_runtime.ts         # NEAR VM host bindings & 128-bit u128 math
│   │   ├── types.ts                # Data model definitions
│   │   ├── harness.mjs             # Node WebAssembly VM host executing orbit_contract.wasm
│   │   └── keeper_agent.mjs        # Autonomous keeper polling get_circles & claiming pots
│   ├── test/
│   │   └── orbit_test.mjs          # 15 security, exploit, & economic invariant tests against WASM
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
