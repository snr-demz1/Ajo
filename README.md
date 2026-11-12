# Ajo 🌐⭕

> **Decentralized Rotating Savings & Credit Associations (ROSCAs) with `(N - 1) × C` Anti-Ghosting Collateral & Soulbound Reputation on NEAR Protocol**

Submitted for the **[NEAR Hackathon: Build Beyond Boundaries](https://nearhackathon.com/)** (Nov 1 – Nov 14, 2026).
* **Tracks:** Real-World Money (`realworld`), NFTs That Do Something (`nfts`), Social Money (`social`)

---

## 🔗 Live NEAR Testnet Deployment & On-Chain Proof

Ajo is compiled to native WebAssembly (`contracts/build/orbit_contract.wasm`, 36,925 bytes) and deployed live on **NEAR Testnet**:

* **Contract Account ID:** [`ajo-26192.testnet`](https://testnet.nearblocks.io/address/ajo-26192.testnet)
* **Testnet Participant Accounts:** [`alice-ajo-26192.testnet`](https://testnet.nearblocks.io/address/alice-ajo-26192.testnet), [`bob-ajo-26192.testnet`](https://testnet.nearblocks.io/address/bob-ajo-26192.testnet)
* **Deployment Manifest:** [`contracts/testnet_deployment.json`](./contracts/testnet_deployment.json)

| On-Chain Action | Method | NEAR Testnet Transaction Hash |
| :--- | :--- | :--- |
| **1. Deploy Compiled WASM (36,925 bytes)** | `DeployContract` | [`qGXo8V1cgxQ6VXKDJBRv72eWjEjQfPicpfzN7xHbzXE`](https://testnet.nearblocks.io/txns/qGXo8V1cgxQ6VXKDJBRv72eWjEjQfPicpfzN7xHbzXE) |
| **2. Initialize Contract (Re-Init Guarded)** | `init` | [`GMijkee9pkaLgUsZ1GYaRRMgakxgahgj8gW3MA2YXLUY`](https://testnet.nearblocks.io/txns/GMijkee9pkaLgUsZ1GYaRRMgakxgahgj8gW3MA2YXLUY) |
| **3. Create Circle #1 (1 NEAR + 1 NEAR Collateral)** | `create_circle` | [`BxpgfJnCpZzeKHaMeSa7EnCB4FcBBDKN1nx4eTJxUvRA`](https://testnet.nearblocks.io/txns/BxpgfJnCpZzeKHaMeSa7EnCB4FcBBDKN1nx4eTJxUvRA) |
| **4. Join & Activate Circle #1** | `join_circle` | [`2fCF2X3M9f9nBrx5kLDC4KdDQxZPgxHyfphh3qxtnbc6`](https://testnet.nearblocks.io/txns/2fCF2X3M9f9nBrx5kLDC4KdDQxZPgxHyfphh3qxtnbc6) |
| **5. Round 1 Deposit (Alice)** | `deposit` | [`9XrPVm8c6WRKC589SD1UP5Sw4pwMAMfRXyNFHxEFe9hg`](https://testnet.nearblocks.io/txns/9XrPVm8c6WRKC589SD1UP5Sw4pwMAMfRXyNFHxEFe9hg) |
| **6. Round 1 Deposit (Bob)** | `deposit` | [`3MBAagDNzdgbfS96cv5Dt2poZsGCMs1919tvbzECAHXi`](https://testnet.nearblocks.io/txns/3MBAagDNzdgbfS96cv5Dt2poZsGCMs1919tvbzECAHXi) |
| **7. Permissionless Round 1 Pot Disbursement** | `claim_payout` | [`2KGKa1L7G1Fe3DVikNMn36tBxAUztgcw3iGd6VA4Mkbj`](https://testnet.nearblocks.io/txns/2KGKa1L7G1Fe3DVikNMn36tBxAUztgcw3iGd6VA4Mkbj) |
| **8. Circle #2 Active Round 1 Deposit** | `deposit` | [`ACi6UFCvdHisyUPKh1pLAWtFxasAeZhycjD4wLPkcL8b`](https://testnet.nearblocks.io/txns/ACi6UFCvdHisyUPKh1pLAWtFxasAeZhycjD4wLPkcL8b) |

---

## ⚡ How Ajo Solves Traditional ROSCA & Smart Contract Security Failures

Over 1 billion people save hundreds of billions of dollars annually in informal rotating savings clubs (*Ajo* in Nigeria, *Tandas* in Mexico, *Susu* in Ghana, *Chit Funds* in India). Ajo enforces mathematical, economic, and smart-contract invariants on-chain:

| Vulnerability | Ajo On-Chain Mechanism (`contracts/src/index.ts` & `near_runtime.ts`) |
| :--- | :--- |
| **1. Early-Recipient Ghosting (Scenario A)** | **Full `(N - 1) × C` Anti-Ghosting Collateral:** Every participant stakes `(total_members - 1) × contribution_amount` upon creating or joining a circle. Even if the Round 1 recipient collects the `N × C` pot and ghosts all remaining `N - 1` rounds, their net profit is `N·C - C - (N-1)·C = 0` (`profit ≤ 0`), and their seized collateral funds all remaining rounds for honest members. |
| **2. Locked Funds on Termination (Scenario A2 & H2)** | **`withdraw_on_termination` & Strict Conservation of Value:** If an active circle defaults unrecoverably or expires past its deadline, honest members can trigger atomic termination to immediately withdraw 100% of their collateral and uncollected deposits (`sum(out) == sum(in)`, `0` stranded funds), with a strict guard against double-settlement. |
| **3. Defaulting Member Receiving Pot (Scenario B)** | **Defaulter Payout Skipping:** `claim_payout` strictly checks `defaulted_members` and `paid_recipients` and **never** routes a pot to a defaulter; the pot goes strictly to the next unpaid honest member. |
| **4. Sybil Score Farming & Late Deposits (Scenario C)** | **1 NEAR Floor & Deadline Enforcement:** `create_circle` enforces `contribution_amount >= 1 NEAR` (`10^24` yoctoNEAR) to prevent 1-yoctoNEAR dust circles, and `deposit` only awards the `+15` reputation bonus if `block_timestamp <= round_deadline`. |
| **5. Delimiter Injection, Key Confusion & Overflow (E1–E3, H1)** | **Token-Aware JSON Parsing & Strict Sanitization:** `findJsonKeyValueStart` strictly distinguishes JSON keys (followed by `:`) from string values. `isSafeText` and `isSafeIdentifier` reject `|`, `"`, `\`, `,`, and control characters across all entrypoints. Numeric inputs are capped at 36 digits (`u128`) and 18 digits (`i64`) to prevent overflow. `init()` checks `!storageHasKey("counter")` to prevent re-initialization. |
| **6. Cancel Griefing in Pending Circles (G1)** | **Creator-Only Cancel & Individual Member Exit:** `cancel_pending_circle` is restricted strictly to the circle creator with a 100% refund. Non-creator joined members call `leave_pending_circle` to safely exit with their collateral without destroying the circle for other prospective members. |
| **7. Storage State Exhaustion (G2)** | **Automatic Storage Reclamation (`storageRemove`):** NEAR Protocol requires 1 NEAR per 100 KB of state storage. Ajo cleans up `col:...` and `cp:...` storage keys upon circle cancellation, member exits, termination, and completion, preventing unbounded state bloat. |

> [!NOTE]
> **Economic Design Note on Collateral & Financial Inclusion:**
> **Credit that stays solvent.** Bronze still locks the full `(N - 1) × C`. A Silver soulbound pass (score ≥ 550) locks half, and `vouch` locks the other half before the circle can start. If that member is paid first and then ghosts, the contract seizes the member's half and then the voucher's half. Later honest members are still paid. The member's profit and the voucher's loss sum to zero. The pass is a non-transferable NFT (`nft_transfer` panics). Circles can also be denominated in a NEP-141 stablecoin: collateral, deposits, and the pot move through `ft_on_transfer` and `ft_transfer`.

---

## 🤖 Machine & Judge Verification Guide (Do X → See Y)

Every command below runs out of the box on Windows, macOS, and Linux without external dependencies.

### Step 1: Compile the Smart Contract to WebAssembly
* **Do X:**
  ```bash
  npm --prefix contracts run build
  ```
* **See Y:**
  Compiles `contracts/src/index.ts` and `contracts/src/near_runtime.ts` via AssemblyScript (`asc`) into `contracts/build/orbit_contract.wasm` (36,925 bytes) with exit code `0`.

### Step 2: Run the WASM invariant tests, the relay policy, and the keeper
`contracts/src/harness.mjs` loads and executes the compiled `contracts/build/orbit_contract.wasm` binary directly inside Node's native `WebAssembly` VM (instantiating fresh WASM instances, enforcing NEAR host registers, `u128` little-endian deposits, atomic state rollback on panic, `storageRemove` state deletion, and `ProhibitedInView` read-only enforcement on `@view` methods).

* **Do X:**
  ```bash
  npm test
  ```
* **See Y:**
  ```text
  ▶ Ajo: Compiled WASM Smart Contract & Security Invariants
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
  ✔ 19. [Credit] Silver pass locks half, voucher locks the rest, and ghosting still pays honest members
  ✔ 20. [Soulbound NFT] Reputation pass is non-transferable and publishes the collateral rate
  ✔ 21. [Stablecoin] Circle collateral and the pot move as fungible-token calls, not NEAR
  ✔ 22. [Gasless relay] sponsors round deposits and refuses collateral, vouch, and payout
  ✔ 23. [Intents] dry quote body cannot create a deposit address
  ✔ Ajo: Compiled WASM Smart Contract & Security Invariants (pass 21 | fail 0)

  === AJO: AUTONOMOUS KEEPER AGENT TEST (WASM VM) ===
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
  === AJO: AUTONOMOUS KEEPER AGENT (LIVE NEAR TESTNET) ===
  [Keeper Agent] Connected to RPC: https://rpc.testnet.near.org
  [Keeper Agent] Monitoring Target Contract: ajo-26192.testnet
  [Keeper Agent] Found 2 circle(s) on NEAR Testnet.
  [Keeper Agent] Circle "Lagos Tech Founders Ajo" [circle_1]: Status=Active, Round 2/2, Deposits=0/2
  [Keeper Agent] Circle "Nairobi Susu Savings" [circle_2]: Status=Active, Round 1/2, Deposits=1/2
  === Keeper Agent Testnet poll cycle completed successfully! ===
  ```

### Step 4: Open the Frontend Connected to NEAR Testnet RPC
* **Do X:**
  Open `frontend/index.html` in any browser.
* **See Y:**
  1. **Live NEAR Testnet RPC Sync:** On load, the app queries `https://rpc.testnet.near.org` (`call_function` on `ajo-26192.testnet`) to fetch live circles (`get_circles`) and reputation profiles (`get_reputation_profile`). The live views include `token_id`, `credit_members`, `vouchers`, and `collateral_bps`. Tests 19–21 run the credit, soulbound, and stablecoin rules against this same WASM.
   2. **Writes:** The page can simulate a circle locally, or sign with a testnet account from **Sign Up / Live Signer**. The simulator labels every write `Simulated locally`. The judge-facing proof of credit, the soulbound pass, and stablecoin payouts is `npm test`, tests 19–21.
   3. **Honest Dual Write Mode (Local Simulator vs. Live In-Browser Testnet Signer):**
     * Using the pre-loaded demo personas explicitly labels actions `(Simulated)` with toast notifications clarifying `Simulated locally`.
     * Clicking **"✨ Sign Up / Live Signer"** with **"Provision Live NEAR Testnet Account (10 NEAR Faucet)"** checked uses `near-api-js` in the browser to generate an Ed25519 keypair, fund a real `.testnet` account via `https://helper.testnet.near.org/account`, and sign live on-chain transactions (`create_circle`, `join_circle`, `deposit`, `claim_payout`, `report_default`, `cancel_pending_circle`, `leave_pending_circle`, `withdraw_on_termination`) directly from the browser. Keypairs are persisted safely in local storage and can be backed up via the **"🔑 Export Key"** button.

---

### Step 5: Check the gasless deposit policy
The relayer may sponsor gas for a round `deposit` only. It refuses `vouch`, `claim_payout`, and stablecoin messages that lock collateral.

* **Do X:**
  ```bash
  npm run relay:check
  ```
* **See Y:**
  ```text
  ok  orbit deposit: NEAR round deposit on the Ajo contract
  ok  stablecoin deposit message: stablecoin round deposit
  ok  collateral message: relayer only sponsors deposit messages on the stablecoin
  ok  vouch: relayer refuses vouch
  ok  claim payout: relayer refuses claim_payout
  Relay policy check passed. Only round deposits are sponsored.
  ```

### Step 6: Print a dry NEAR Intents quote
This asks 1Click for a USDC-to-USDC price with `dry: true`. A dry quote does not create a deposit address and does not move funds. Intents has no testnet. Use a mainnet account you control as `--recipient` before sending a live (non-dry) swap.

* **Do X:**
  ```bash
  npm run quote:offline
  ```
* **See Y:** A JSON body whose `dry` field is `true`, `amount` is `"1000000"`, and which contains no `depositAddress`.

* **Do X (live price, still dry):**
  ```bash
  npm run quote:dry -- --recipient=your-account.near --refund=your-account.near
  ```
* **See Y:** HTTP 201, an `amountOut`, and `depositAddress=absent`. The refund address is a checksummed origin-chain address. For ETH USDC that is an `0x` address, and the NEAR account only appears as `recipient`. No deposit address is created.

### Before the form
Prize NEAR is paid on mainnet to this implicit account:

`f8aec92dd5faeed524e7d36bf8fee541bd67776047435a2267aed831aefacddf`

That value is already in `submission.json`. Do not replace it with `ajo-26192.testnet` or any other testnet account. The private key stays off the repository. The launch post belongs on X, tagging `@NEARProtocol` and `#NEARHackathon`, and that status URL replaces `demoUrl`. Send the form once. If it was already sent, change fields at https://nearhackathon.com/request-changes.

## 🏗️ Repository Structure

```text
├── .github/workflows/
│   └── build.yml                   # CI workflow: compiles WASM & runs 18-test suite
├── contracts/
│   ├── build/
│   │   └── orbit_contract.wasm     # Compiled NEAR WebAssembly smart contract binary (36,925 bytes)
│   ├── scripts/
│   │   └── deploy_testnet.mjs      # Live NEAR Testnet deployment & verification script
│   ├── src/
│   │   ├── index.ts                # Ajo smart contract implementation (AssemblyScript)
│   │   ├── near_runtime.ts         # NEAR VM host bindings, token-aware JSON parser & u128 math
│   │   ├── types.ts                # Data model definitions
│   │   ├── harness.mjs             # Node WebAssembly VM host executing orbit_contract.wasm
│   │   ├── keeper_agent.mjs        # Autonomous keeper polling get_circles, slashing defaults & claiming pots
│   │   ├── relay_policy.mjs        # Gasless relayer policy: round deposits only
│   │   └── intents_quote.mjs       # Dry NEAR Intents USDC quote
│   ├── test/
│   │   ├── orbit_test.mjs          # 21 security, credit, NFT, and stablecoin tests against WASM
│   │   └── win_path.test.mjs       # Relay policy and dry-quote checks
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
MIT License — Copyright (c) 2026 Ajo Contributors
