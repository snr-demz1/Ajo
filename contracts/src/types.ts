export type AccountId = string;

export enum CircleStatus {
  Pending = "Pending",       // Waiting for members to join
  Active = "Active",         // Rounds in progress
  Completed = "Completed",   // All rounds successfully finished
  Terminated = "Terminated"  // Failed due to unresolved default; remaining funds refunded
}

export enum ReputationTier {
  Bronze = "Bronze",         // 0 - 549
  Silver = "Silver",         // 550 - 699
  Gold = "Gold",             // 700 - 849
  Platinum = "Platinum"      // 850 - 1000
}

export interface ReputationProfile {
  account_id: AccountId;
  circles_completed: number;
  on_time_payments: number;
  missed_payments: number;
  reputation_score: number;  // 0 to 1000
  tier: ReputationTier;
  collateral_slashed_total: string;
}

export interface Circle {
  id: string;
  name: string;
  creator: AccountId;
  contribution_amount: string;     // Exact amount per round in yoctoNEAR (>= 10^24)
  collateral_per_member: string;   // Required anti-ghosting collateral stake: (total_members - 1) * contribution_amount
  round_duration_ms: number;       // Duration of each round in milliseconds
  total_members: number;
  members: AccountId[];
  payout_order: AccountId[];       // Ordered by reputation score (highest score = earliest payout)
  current_round: number;           // 1 to total_members
  round_start_time: number;        // Timestamp in ms
  round_deadline: number;          // Timestamp in ms (start + duration)
  status: CircleStatus;
  total_pot: string;               // Current round's accumulated pot
  round_paid_members: Record<number, AccountId[]>;
  payout_claimed: Record<number, boolean>;
  member_collateral: Record<AccountId, string>; // Held collateral per member
  defaulted_members: AccountId[];
  paid_recipients: AccountId[];
}
