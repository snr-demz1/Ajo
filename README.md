# Orbit Protocol 🌐⭕

> **Decentralized Rotating Savings & Credit Associations (ROSCAs) with `(N - 1) × C` Anti-Ghosting Collateral & Soulbound Reputation on NEAR Protocol**

Submitted for the **[NEAR Hackathon: Build Beyond Boundaries](https://nearhackathon.com/)** (Nov 1 – Nov 14, 2026).

---

## 🔗 Live NEAR Testnet Deployment & On-Chain Proof

Orbit Protocol is compiled to WebAssembly (`contracts/build/orbit_contract.wasm`, 25,750 bytes) and deployed live on **NEAR Testnet**:

* **Contract Account ID:** [`orbit-v2-63536.testnet`](https://testnet.nearblocks.io/address/orbit-v2-63536.testnet)
* **Testnet Participant Accounts:** [`alice-orbit-63536.testnet`](https://testnet.nearblocks.io/address/alice-orbit-63536.testnet), [`bob-orbit-63536.testnet`](https://testnet.nearblocks.io/address/bob-orbit-63536.testnet)
* **Deployment Manifest:** [`contracts/testnet_deployment.json`](./contracts/testnet_deployment.json)

| On-Chain Action | Method | NEAR Testnet Transaction Hash |
| :--- | :--- | :--- |
| **1. Deploy Compiled WASM (25,750 bytes)** | `DeployContract` | [`FyUZcBf82aejN36toBQjhv3U76p15qdxnzuUmqcu79X9`](https://testnet.nearblocks.io/txns/FyUZcBf82aejN36toBQjhv3U76p15qdxnzuUmqcu79X9) |
| **2. Initialize Contract (Re-Init Guarded)** | `init` | [`FwMJhzXYhXeEDi8Qjqhbct4nDHYohTwd7sQjx4jDmPub`](https://testnet.nearblocks.io/txns/FwMJhzXYhXeEDi8Qjqhbct4nDHYohTwd7sQjx4jDmPub) |
| **3. Create Circle #1 (1 NEAR + 1 NEAR Collateral)** | `create_circle` | [`8RHE88LNRqAnxhe6qAqeJARxsBbTDgXPrWF79o2qQWgK`](https://testnet.nearblocks.io/txns/8RHE88LNRqAnxhe6qAqeJARxsBbTDgXPrWF79o2qQWgK) |
| **4. Join & Activate Circle #1** | `join_circle` | [`38ssRdDeZNkGeqyaw8MyksqwycX4e7ViFw7MtDaDnqJs`](https://testnet.nearblocks.io/txns/38ssRdDeZNkGeqyaw8MyksqwycX4e7ViFw7MtDaDnqJs) |
| **5. Round 1 Deposit (Alice)** | `deposit` | [`BvdzsBvyu4z2cs4NLSVUA4KUXuBRtJPwM8srzFt5Tt5o`](https://testnet.nearblocks.io/txns/BvdzsBvyu4z2cs4NLSVUA4KUXuBRtJPwM8srzFt5Tt5o) |
| **6. Round 1 Deposit (Bob)** | `deposit` | [`56fhPpPziivjKddp5hWaqg1BJDLn7Akhay1dTASn4kxt`](https://testnet.nearblocks.io/txns/56fhPpPziivjKddp5hWaqg1BJDLn7Akhay1dTASn4kxt) |
| **7. Permissionless Round 1 Pot Disbursement** | `claim_payout` | [`4qdPH9QPKrGyAfNBDFCvgB6JFSkfv3FovpXoiUucPaxo`](https://testnet.nearblocks.io/txns/4qdPH9QPKrGyAfNBDFCvgB6JFSkfv3FovpXoiUucPaxo) |
| **8. Circle #2 Active Round 1 Deposit** | `deposit` | [`6HbQHf45CpNNp3ofeDFG1zCZgXYqSkNwyDq4i52jRkWc`](https://testnet.nearblocks.io/txns/6HbQHf45CpNNp3ofeDFG1zCZgXYqSkNwyDq4i52jRkWc) |

---

## ⚡ How Orbit Solves Traditional ROSCA & Smart Contract Security Failures

Over 1 billion people save hundreds of billions of dollars annually in informal rotating savings clubs (*Ajo* in Nigeria, *Tandas* in Mexico, *Susu* in Ghana, *Chit Funds* in India). Orbit enforces economic and smart-contract invariants on-chain:

| Vulnerability | Orbit On-Chain Mechanism (`contracts/src/index.ts`) |
| :--- | :--- |
| **1. Early-Recipient Ghosting (Scenario A)** | **Full `(N - 1) × C` Anti-Ghosting Collateral:** Every participant stakes `(total_members - 1) × contribution_amount` upon creating or joining a circle. Even if the Round 1 recipient collects the `N × C` pot and ghosts all remaining `N - 1` rounds, their net profit is `N·C - C - (N-1)·C = 0` (`profit ≤ 0`), and their seized collateral funds all remaining rounds for honest members. |
| **2. Locked Funds on Termination or Pending Stalls (Scenario A2 & E4)** | **`cancel_pending_circle` & `withdraw_on_termination`:** Joined members can cancel a `Pending` circle (if remaining seats never fill) or settle a `Terminated` / expired `Active` circle to immediately recover 100% of their collateral and deposits (`0` locked funds). |
| **3. Defaulting Member Receiving Pot (Scenario B)** | **Defaulter Payout Skipping:** `claim_payout` checks `defaulted_members` and `paid_recipients` and **never** routes a pot to a member who has defaulted; the pot goes strictly to the next unpaid honest member. |
| **4. Sybil Score Farming & Late Deposits (Scenario C)** | **1 NEAR Floor & Deadline Check:** `create_circle` enforces `contribution_amount >= 1 NEAR` (`10^24` yoctoNEAR) to prevent 1-yoctoNEAR dust circles, and `deposit` only awards the `+15` reputation bonus if `block_timestamp <= round_deadline`. |
| **5. Storage Delimiter & JSON Injection (E1, E2, E3)** | **Strict Character Whitelisting & Init Guard:** `isSafeText` and `isSafeIdentifier` reject `|`, `"`, `\`, `,`, and control characters across all entrypoints, preventing pipe-delimiter state forgery and JSON syntax DoS; `init()` checks `!storageHasKey("counter")` to prevent re-initialization attacks. |

---

## 🤖 Machine & Judge Verification Guide (Do X → See Y)

Every command below runs locally out of the box on Windows, macOS, and Linux.

### Step 1: Compile the Smart Contract to WebAssembly
* **Do X:**
  ```bash
  npm --prefix contracts run build
  ```
* **See Y:**
  Compiles `contracts/src/index.ts` and `contracts/src/near_runtime.ts` via AssemblyScript (`asc`) into `contracts/build/orbit_contract.wasm` with exit code `0`.

### Step 2: Run the 13 WASM Invariant Tests & Autonomous Keeper Agent
`contracts/src/harness.mjs` loads and executes the compiled `contracts/build/orbit_contract.wasm` binary directly inside Node's `WebAssembly` VM (instantiating a fresh WASM instance per call, enforcing NEAR host registers, `u128` little-endian deposits, atomic state rollback on panic, and `ProhibitedInView` read-only enforcement on `@view` methods).

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
    ✔ 13. [Exploit E4] Allows cancelling a Pending circle to refund 100% of staked collateral (and blocks non-member griefers)
  ✔ Orbit Protocol: Compiled WASM Smart Contract & Security Invariants (pass 13 | fail 0)

  === ORBIT PROTOCOL: AUTONOMOUS KEEPER AGENT TEST (WASM VM) ===
  [Keeper Agent] Scanning active circles via get_circles view...
  [Keeper Agent] Circle "Autonomous Test Circle" [circle_1]: Round 1 status: 2/2 paid.
  [Keeper Agent] All round deposits settled! Executing permissionless claim_payout...
  [Keeper Agent] Disbursed pot to honest recipient alice.testnet.
  [Keeper Agent] Circle now at Round 2 (Status: Active).
  === Keeper Agent WASM verification finished successfully! ===
  ```

### Step 3: Open the Frontend Connected to NEAR Testnet RPC
* **Do X:**
  Open `frontend/index.html` in any browser.
* **See Y:**
  1. **Live NEAR Testnet RPC Sync:** On load, the app queries `https://rpc.testnet.near.org` (`call_function` on `orbit-v2-63536.testnet`) to fetch live circles (`get_circles`) and reputation profiles (`get_reputation_profile`).
  2. **Honest Dual Write Mode (Local Simulator vs. Live In-Browser Testnet Signer):**
     * Using the pre-loaded demo personas explicitly labels actions `(Simulated)` with toast notifications clarifying `Simulated locally`.
     * Clicking **"✨ Sign Up / Live Signer"** with **"Provision Live NEAR Testnet Account (10 NEAR Faucet)"** checked uses `near-api-js` in the browser to generate an Ed25519 keypair, fund a real `.testnet` account via `https://helper.testnet.near.org/account`, and sign live on-chain transactions (`create_circle`, `deposit`, `claim_payout`, `cancel_pending_circle`, `withdraw_on_termination`) directly from the browser.

---

## 🏗️ Repository Structure

```text
├── .github/workflows/
│   └── build.yml                   # CI workflow: compiles WASM & runs 13-test suite
├── contracts/
│   ├── build/
│   │   └── orbit_contract.wasm     # Compiled NEAR WebAssembly smart contract binary (25,750 bytes)
│   ├── scripts/
│   │   └── deploy_testnet.mjs      # Live NEAR Testnet deployment & verification script
│   ├── src/
│   │   ├── index.ts                # Orbit smart contract implementation (AssemblyScript)
│   │   ├── near_runtime.ts         # NEAR VM host bindings & 128-bit u128 math
│   │   ├── types.ts                # Data model definitions
│   │   ├── harness.mjs             # Node WebAssembly VM host executing orbit_contract.wasm
│   │   └── keeper_agent.mjs        # Autonomous keeper polling get_circles & claiming pots
│   ├── test/
│   │   └── orbit_test.mjs          # 13 security, exploit, & economic invariant tests against WASM
│   ├── package.json                # Contract build configuration
│   └── testnet_deployment.json     # Public NEAR Testnet deployment manifest & tx hashes
├── frontend/
│   └── index.html                  # Consumer fintech UI wired to rpc.testnet.near.org + near-api-js
├── LICENSE                         # MIT Open-Source License
├── package.json                    # Root scripts & dependencies
└── README.md                       # Documentation & verification guide
```

---

## 📜 License
MIT License — Copyright (c) 2026 Orbit Protocol Contributors
