export type AccountId = string;

export enum CircleStatus {
  Pending = "Pending",
  Active = "Active",
  Completed = "Completed",
  Terminated = "Terminated"
}

export enum ReputationTier {
  Bronze = "Bronze",
  Silver = "Silver",
  Gold = "Gold",
  Platinum = "Platinum"
}

export interface ReputationProfile {
  account_id: AccountId;
  circles_completed: number;
  on_time_payments: number;
  missed_payments: number;
  reputation_score: number; // 0 to 1000
  tier: ReputationTier;
  badge_minted: boolean;
}

export interface Circle {
  id: string;
  name: string;
  creator: AccountId;
  contribution_amount: string; // in yoctoNEAR (or FT token units)
  round_duration_ms: number;
  total_members: number;
  members: AccountId[];
  payout_order: AccountId[];
  current_round: number;
  round_start_time: number; // timestamp in ms
  status: CircleStatus;
  total_pot: string;
  round_paid_members: Record<number, AccountId[]>;
  payout_claimed: Record<number, boolean>;
}
