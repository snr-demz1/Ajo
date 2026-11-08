# Orbit Protocol 🌐⭕

> **Decentralized Rotating Savings & Credit Associations (ROSCAs) with Soulbound Financial Passes on NEAR Protocol**

Submitted for the **[NEAR Hackathon: Build Beyond Boundaries](https://nearhackathon.com/)** (Nov 1 – Nov 14, 2026).

---

## 🏆 Target Hackathon Tracks

1. **Real-World Money (Primary):** Digitize informal community savings practiced by over 1 billion people worldwide (*Ajo* in Nigeria, *Tandas* in Mexico, *Susu* in Ghana, *Chit Funds* in India). Solves trust, escrow security, and transparency without requiring crypto literacy.
2. **Social Money (Secondary):** Group-coordinated capital pools, collaborative financial commitments, and peer accountability without centralized intermediaries.
3. **NFTs That Do Something (Tertiary):** Dynamic Soulbound Reputation Pass (`ReputationProfile`) that upgrades on-chain based on payment reliability, providing an unforgeable, portable credit credential.

---

## 💡 The Problem
In traditional informal savings circles:
- **Organizer Fraud:** The person collecting physical money can flee with the entire pot.
- **Defaulters:** A member who claims the pot in Round 1 may ghost subsequent monthly payments.
- **Invisible Credit:** People reliably contribute hundreds of dollars monthly for decades, yet commercial banks still deem them "unbanked" with zero credit history.

---

## 🚀 The Orbit Solution
- **Mathematical Escrow:** Funds are locked in a NEAR smart contract. No organizer, administrator, or individual member can siphon money. Payouts are programmatically disbursed only to the scheduled member.
- **Dynamic Soulbound Credential:** Every participant holds an on-chain reputation profile tracking total circles completed, on-time payments, and credit tier (`Bronze`, `Silver`, `Gold`, `Platinum`).
- **Zero Friction with NEAR:** Built for seamless user onboarding using FastAuth (email/passkey login) and stablecoins, avoiding volatile crypto friction.

---

## 🏗️ Technical Architecture

```
                      ┌────────────────────────────────────────┐
                      │             Web Frontend               │
                      │    (Circle Discovery, Deposit, Passes) │
                      └───────────────────┬────────────────────┘
                                          │ NEAR RPC / Wallet
                      ┌───────────────────▼────────────────────┐
                      │        Orbit Protocol Contract         │
                      │             (near-sdk-js)              │
                      ├────────────────────────────────────────┤
                      │ • Circle Escrow & State Machine        │
                      │ • Turn Allocation & Auto-Payout        │
                      │ • Soulbound Reputation Engine          │
                      └───────────────────┬────────────────────┘
                                          │ Updates
                      ┌───────────────────▼────────────────────┐
                      │    Dynamic On-Chain Credit Pass        │
                      │ (Score: 0-1000 | Bronze->Platinum)     │
                      └────────────────────────────────────────┘
```

---

## 🛠️ Repository Structure

```
├── contracts/
│   ├── src/
│   │   ├── index.ts      # Core Orbit smart contract logic (near-sdk-js)
│   │   └── types.ts      # Circle, ReputationProfile, & Tier definitions
│   ├── package.json      # Contract build & test scripts
│   └── README.md
├── frontend/             # Interactive UI for creating circles & viewing passes
├── package.json          # Root scripts
└── README.md             # Project documentation
```

---

## 🧪 Smart Contract Methods

### Circle Operations
- `create_circle(name, contribution_amount, round_duration_ms, total_members)`
- `join_circle(circle_id)`
- `deposit(circle_id)` *(payable)*
- `claim_payout(circle_id)`

### Views
- `get_circle(circle_id)`
- `get_all_circles()`
- `get_reputation_profile(account_id)`

---

## 👥 Hackathon Submission Checklist
- [x] Initialized Git repository
- [x] Production-ready Smart Contract logic on NEAR
- [x] Documented Problem, Solution, & Track Fit
- [ ] Deploy contract to NEAR Testnet
- [ ] Connect interactive frontend demo
- [ ] Record 2-minute video walkthrough
- [ ] Publish public post on X tagging `@NEARProtocol` and `#NEARHackathon`
- [ ] Complete submission form on [nearhackathon.com](https://nearhackathon.com)
