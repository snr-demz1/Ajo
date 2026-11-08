# Orbit Protocol 🌐⭕

> **Decentralized Rotating Savings & Credit Associations (ROSCAs) with `(N - 1) × C` Anti-Ghosting Collateral & Soulbound Reputation on NEAR Protocol**

Submitted for the **[NEAR Hackathon: Build Beyond Boundaries](https://nearhackathon.com/)** (Nov 1 – Nov 14, 2026).

---

## 🔗 Live NEAR Testnet Deployment & On-Chain Proof

Orbit Protocol is compiled to WebAssembly (`contracts/build/orbit_contract.wasm`, 23,290 bytes) and deployed live on **NEAR Testnet**:

* **Contract Account ID:** [`orbit-v2-24284.testnet`](https://testnet.nearblocks.io/address/orbit-v2-24284.testnet)
* **Testnet Participant Accounts:** [`alice-orbit-24284.testnet`](https://testnet.nearblocks.io/address/alice-orbit-24284.testnet), [`bob-orbit-24284.testnet`](https://testnet.nearblocks.io/address/bob-orbit-24284.testnet)
* **Deployment Manifest:** [`contracts/testnet_deployment.json`](./contracts/testnet_deployment.json)

| On-Chain Action | Method | NEAR Testnet Transaction Hash |
| :--- | :--- | :--- |
| **1. Deploy Compiled WASM** | `DeployContract` | [`9mqN3WgAmWPvB4yoKv4zrSSwoThLQJQivLJ1wL48hwHa`](https://testnet.nearblocks.io/txns/9mqN3WgAmWPvB4yoKv4zrSSwoThLQJQivLJ1wL48hwHa) |
| **2. Initialize Contract** | `init` | [`D8iyHkJm6ED2pa7Wxe8WFAH2HMNQd1WLiCFVQ4Hmr81x`](https://testnet.nearblocks.io/txns/D8iyHkJm6ED2pa7Wxe8WFAH2HMNQd1WLiCFVQ4Hmr81x) |
| **3. Create Circle #1 (1 NEAR + 1 NEAR Collateral)** | `create_circle` | [`DtVYTcghwo95ueTyt2Q5jdNvZJF335n1P7e7ZS56afZk`](https://testnet.nearblocks.io/txns/DtVYTcghwo95ueTyt2Q5jdNvZJF335n1P7e7ZS56afZk) |
| **4. Join & Activate Circle #1** | `join_circle` | [`AmgiCRMkrkYhorDnzsSWtkuac8R7ha3QRvnQ1LwMqhmm`](https://testnet.nearblocks.io/txns/AmgiCRMkrkYhorDnzsSWtkuac8R7ha3QRvnQ1LwMqhmm) |
| **5. Round 1 Deposit (Alice)** | `deposit` | [`5n3qnU7YqV8PxNJXmQ8xRfT8i5kHcje3NZ3D5XWYEjHb`](https://testnet.nearblocks.io/txns/5n3qnU7YqV8PxNJXmQ8xRfT8i5kHcje3NZ3D5XWYEjHb) |
| **6. Round 1 Deposit (Bob)** | `deposit` | [`AghauNdkYTHRpbzNBzRT9sNuoNK2fhiEa4TSCLZaG5dv`](https://testnet.nearblocks.io/txns/AghauNdkYTHRpbzNBzRT9sNuoNK2fhiEa4TSCLZaG5dv) |
| **7. Permissionless Round 1 Pot Disbursement** | `claim_payout` | [`4vyRWpemEeAmQxk2vwe2pwcgFdFRBt5wGtnbTW6hurUA`](https://testnet.nearblocks.io/txns/4vyRWpemEeAmQxk2vwe2pwcgFdFRBt5wGtnbTW6hurUA) |
| **8. Circle #2 Active Round 1 Deposit** | `deposit` | [`ATjhqPzVrL1Fa6DGd5HWwpztW2EbZqj6wmYs6Fc7ytQt`](https://testnet.nearblocks.io/txns/ATjhqPzVrL1Fa6DGd5HWwpztW2EbZqj6wmYs6Fc7ytQt) |

---

## ⚡ How Orbit Solves Traditional ROSCA Failures

Over 1 billion people save hundreds of billions of dollars annually in informal rotating savings clubs (*Ajo* in Nigeria, *Tandas* in Mexico, *Susu* in Ghana, *Chit Funds* in India). Orbit eliminates the four failure modes of informal cash circles:

| Vulnerability | Orbit On-Chain Mechanism (`contracts/src/index.ts`) |
| :--- | :--- |
| **1. Early-Recipient Ghosting (Scenario A)** | **Full `(N - 1) × C` Anti-Ghosting Collateral:** Every participant stakes `(total_members - 1) × contribution_amount` upon creating or joining a circle. Even if the Round 1 recipient collects the `N × C` pot and ghosts all remaining `N - 1` rounds, their net profit is `N·C - C - (N-1)·C = 0` (`profit ≤ 0`), and their seized collateral funds all remaining rounds for honest members. |
| **2. Locked Funds on Termination** | **`withdraw_on_termination({ circle_id })`:** If a circle terminates after a round deadline expires, honest members can immediately withdraw 100% of their collateral, current-round deposits, and prior-round recovery shares (`0` locked funds). |
| **3. Defaulting Member Receiving Pot (Scenario B)** | **Defaulter Payout Skipping:** `claim_payout` checks `defaulted_members` and `paid_recipients` and **never** routes a pot to a member who has defaulted; the pot goes strictly to the next unpaid honest member, and any leftover defaulter collateral is swept to honest members on completion. |
| **4. Sybil Score Farming & Late Deposits (Scenario C)** | **1 NEAR Floor & Deadline Check:** `create_circle` enforces `contribution_amount >= 1 NEAR` (`10^24` yoctoNEAR) to prevent 1-yoctoNEAR dust circles, and `deposit` only awards the `+15` reputation bonus if `block_timestamp <= round_deadline` and the caller has not defaulted. |

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

### Step 2: Run the 9 WASM Invariant Tests & Autonomous Keeper Agent
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
  ✔ Orbit Protocol: Compiled WASM Smart Contract & Security Invariants (pass 9 | fail 0)

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
  1. **Live NEAR Testnet RPC Sync:** On load, the app queries `https://rpc.testnet.near.org` (`call_function` on `orbit-v2-24284.testnet`) to fetch live circles (`get_circles`) and reputation profiles (`get_reputation_profile`), with a local interactive simulator fallback when offline.
  2. **Real Explorer Links:** The *Verified Protocol Activity* ledger links directly to the confirmed transactions on `https://testnet.nearblocks.io/txns/...`.
  3. **Interactive Circle Lifecycle:** Test sign-ups, round deposits (`+15` reputation), default collateral seizure (`report_default`, `-150` reputation), defaulter payout skipping (`claim_payout`), and termination refunds (`withdraw_on_termination`).

---

## 🏗️ Repository Structure

```text
├── .github/workflows/
│   └── build.yml                   # CI workflow: compiles WASM & runs test suite
├── contracts/
│   ├── build/
│   │   └── orbit_contract.wasm     # Compiled NEAR WebAssembly smart contract binary
│   ├── scripts/
│   │   └── deploy_testnet.mjs      # Live NEAR Testnet deployment & verification script
│   ├── src/
│   │   ├── index.ts                # Orbit smart contract implementation (AssemblyScript)
│   │   ├── near_runtime.ts         # NEAR VM host bindings & 128-bit u128 math
│   │   ├── types.ts                # Data model definitions
│   │   ├── harness.mjs             # Node WebAssembly VM host executing orbit_contract.wasm
│   │   └── keeper_agent.mjs        # Autonomous keeper polling get_circles & claiming pots
│   ├── test/
│   │   └── orbit_test.mjs          # 9 security & economic invariant tests against WASM
│   ├── package.json                # Contract build configuration
│   └── testnet_deployment.json     # Public NEAR Testnet deployment manifest & tx hashes
├── frontend/
│   └── index.html                  # Consumer fintech UI wired to rpc.testnet.near.org
├── LICENSE                         # MIT Open-Source License
├── package.json                    # Root scripts & dependencies
└── README.md                       # Documentation & verification guide
```

---

## 📜 License
MIT License — Copyright (c) 2026 Orbit Protocol Contributors
