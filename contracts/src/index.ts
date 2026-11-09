import {
  getInputString,
  predecessorAccountId,
  attachedDepositBytes,
  blockTimestampMs,
  log,
  assertCondition,
  valueReturn,
  storageRead,
  storageHasKey,
  storageWrite,
  storageRemove,
  transferNear,
  u128FromString,
  u128ToString,
  u128Compare,
  u128Add,
  u128Sub,
  u128MulSmall,
  u128IsZero,
  getJsonString,
  getJsonNumber
} from "./near_runtime";

// Minimum contribution: 1 NEAR (10^24 yoctoNEAR) to prevent sybil score farming with dust circles
const MIN_CONTRIBUTION_YOCTO = "1000000000000000000000000";

function computeTier(score: i32): string {
  if (score >= 850) return "Platinum";
  if (score >= 700) return "Gold";
  if (score >= 550) return "Silver";
  return "Bronze";
}

function splitCsv(s: string): Array<string> {
  const out = new Array<string>();
  if (s.length == 0) return out;
  const parts = s.split(",");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) out.push(parts[i]);
  }
  return out;
}

function joinCsv(arr: Array<string>): string {
  return arr.join(",");
}

function arrayContains(arr: Array<string>, item: string): bool {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == item) return true;
  }
  return false;
}

function jsonStringArray(arr: Array<string>): string {
  let out = "[";
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) out += ",";
    out += '"' + arr[i] + '"';
  }
  return out + "]";
}

// Strict input sanitization to prevent pipe ('|'), quote ('"'), backslash ('\\'), comma (','), and control-char injection
function isSafeText(s: string): bool {
  if (s.length < 2 || s.length > 64) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const isUpper = c >= 65 && c <= 90;
    const isLower = c >= 97 && c <= 122;
    const isDigit = c >= 48 && c <= 57;
    const isAllowedPunct = c == 32 || c == 95 || c == 45 || c == 35 || c == 46; // space, _, -, #, .
    if (!isUpper && !isLower && !isDigit && !isAllowedPunct) {
      return false;
    }
  }
  return true;
}

function isSafeIdentifier(s: string): bool {
  if (s.length < 2 || s.length > 64) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const isUpper = c >= 65 && c <= 90;
    const isLower = c >= 97 && c <= 122;
    const isDigit = c >= 48 && c <= 57;
    const isAllowedPunct = c == 95 || c == 45 || c == 46; // _, -, .
    if (!isUpper && !isLower && !isDigit && !isAllowedPunct) {
      return false;
    }
  }
  return true;
}

function isSafeDigits(s: string): bool {
  if (s.length < 1 || s.length > 36) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

// ------------------------------------------------------------
// Reputation Storage Helpers
// ------------------------------------------------------------

function getScoreReadOnly(accountId: string): i32 {
  const raw = storageRead("rep:" + accountId, "");
  if (raw.length == 0) return 500;
  const parts = raw.split("|");
  return i32(I64.parseInt(parts[3]));
}

function getProfileJsonReadOnly(accountId: string): string {
  const raw = storageRead("rep:" + accountId, "");
  let completed: i32 = 0;
  let onTime: i32 = 0;
  let missed: i32 = 0;
  let score: i32 = 500;
  let slashed = "0";

  if (raw.length > 0) {
    const parts = raw.split("|");
    completed = i32(I64.parseInt(parts[0]));
    onTime = i32(I64.parseInt(parts[1]));
    missed = i32(I64.parseInt(parts[2]));
    score = i32(I64.parseInt(parts[3]));
    slashed = parts[4];
  }

  const tier = computeTier(score);
  return (
    '{"account_id":"' + accountId +
    '","circles_completed":' + completed.toString() +
    ',"on_time_payments":' + onTime.toString() +
    ',"missed_payments":' + missed.toString() +
    ',"reputation_score":' + score.toString() +
    ',"tier":"' + tier +
    '","collateral_slashed_total":"' + slashed + '"}'
  );
}

function ensureProfileWritten(accountId: string): void {
  const key = "rep:" + accountId;
  if (storageRead(key, "").length == 0) {
    storageWrite(key, "0|0|0|500|0");
  }
}

function updateProfile(
  accountId: string,
  addCompleted: i32,
  addOnTime: i32,
  addMissed: i32,
  scoreDelta: i32,
  addSlashedYocto: string
): void {
  const key = "rep:" + accountId;
  const raw = storageRead(key, "0|0|0|500|0");
  const parts = raw.split("|");
  const completed = i32(I64.parseInt(parts[0])) + addCompleted;
  const onTime = i32(I64.parseInt(parts[1])) + addOnTime;
  const missed = i32(I64.parseInt(parts[2])) + addMissed;
  let score = i32(I64.parseInt(parts[3])) + scoreDelta;
  if (score > 1000) score = 1000;
  if (score < 0) score = 0;

  const slashedBytes = u128Add(u128FromString(parts[4]), u128FromString(addSlashedYocto));
  const slashedStr = u128ToString(slashedBytes);

  storageWrite(
    key,
    completed.toString() + "|" +
    onTime.toString() + "|" +
    missed.toString() + "|" +
    score.toString() + "|" +
    slashedStr
  );
}

// ------------------------------------------------------------
// Circle Storage Serialization
// Format of `c:<id>`:
// 0:name | 1:creator | 2:contribution_amount | 3:collateral_per_member |
// 4:round_duration_ms | 5:total_members | 6:members_csv | 7:payout_order_csv |
// 8:current_round | 9:round_start_time | 10:round_deadline | 11:status |
// 12:total_pot | 13:defaulted_csv | 14:paid_recipients_csv
// ------------------------------------------------------------

function buildCircleJson(circleId: string): string {
  const raw = storageRead("c:" + circleId, "");
  if (raw.length == 0) return "null";

  const p = raw.split("|");
  const name = p[0];
  const creator = p[1];
  const contribution = p[2];
  const collateralPerMember = p[3];
  const durationMs = p[4];
  const totalMembers = i32(I64.parseInt(p[5]));
  const members = splitCsv(p[6]);
  const payoutOrder = splitCsv(p[7]);
  const currentRound = i32(I64.parseInt(p[8]));
  const startTime = p[9];
  const deadline = p[10];
  const status = p[11];
  const totalPot = p[12];
  const defaulted = splitCsv(p[13]);
  const paidRecipients = splitCsv(p[14]);

  // Build round_paid_members & payout_claimed
  let roundPaidJson = "{";
  let claimedJson = "{";
  for (let r = 1; r <= totalMembers; r++) {
    const rStr = r.toString();
    const rPaidCsv = storageRead("cp:" + circleId + ":" + rStr, "");
    const rClaimed = storageRead("cc:" + circleId + ":" + rStr, "0") == "1";
    if (r > 1) {
      roundPaidJson += ",";
      claimedJson += ",";
    }
    roundPaidJson += '"' + rStr + '":' + jsonStringArray(splitCsv(rPaidCsv));
    claimedJson += '"' + rStr + '":' + (rClaimed ? "true" : "false");
  }
  roundPaidJson += "}";
  claimedJson += "}";

  // Build member_collateral
  let colJson = "{";
  for (let i = 0; i < members.length; i++) {
    if (i > 0) colJson += ",";
    const m = members[i];
    const colVal = storageRead("col:" + circleId + ":" + m, "0");
    colJson += '"' + m + '":"' + colVal + '"';
  }
  colJson += "}";

  return (
    '{"id":"' + circleId +
    '","name":"' + name +
    '","creator":"' + creator +
    '","contribution_amount":"' + contribution +
    '","collateral_per_member":"' + collateralPerMember +
    '","round_duration_ms":' + durationMs +
    ',"total_members":' + totalMembers.toString() +
    ',"members":' + jsonStringArray(members) +
    ',"payout_order":' + jsonStringArray(payoutOrder) +
    ',"current_round":' + currentRound.toString() +
    ',"round_start_time":' + startTime +
    ',"round_deadline":' + deadline +
    ',"status":"' + status +
    '","total_pot":"' + totalPot +
    '","round_paid_members":' + roundPaidJson +
    ',"payout_claimed":' + claimedJson +
    ',"member_collateral":' + colJson +
    ',"defaulted_members":' + jsonStringArray(defaulted) +
    ',"paid_recipients":' + jsonStringArray(paidRecipients) + '}'
  );
}

// ------------------------------------------------------------
// Exported Smart Contract Entrypoints
// ------------------------------------------------------------

export function init(): void {
  assertCondition(!storageHasKey("counter"), "Contract is already initialized.");
  storageWrite("counter", "0");
}

export function create_circle(): void {
  const input = getInputString();
  const caller = predecessorAccountId();
  const deposit = attachedDepositBytes();

  const name = getJsonString(input, "name");
  const contributionStr = getJsonString(input, "contribution_amount");
  const durationMs = getJsonNumber(input, "round_duration_ms", 0);
  const totalMembers = i32(getJsonNumber(input, "total_members", 0));

  assertCondition(isSafeIdentifier(caller), "Invalid caller account ID.");
  assertCondition(
    isSafeText(name),
    "Circle name must be 2-64 safe characters (letters, numbers, spaces, -_#.) without pipes, quotes, or backslashes."
  );
  assertCondition(isSafeDigits(contributionStr), "Contribution amount must be a valid integer string.");
  assertCondition(totalMembers >= 2 && totalMembers <= 20, "Circle must require between 2 and 20 members.");
  assertCondition(durationMs >= 60000, "Round duration must be at least 60000 ms (1 minute).");

  const contributionBytes = u128FromString(contributionStr);
  const minContributionBytes = u128FromString(MIN_CONTRIBUTION_YOCTO);
  assertCondition(
    u128Compare(contributionBytes, minContributionBytes) >= 0,
    "Minimum contribution is 1 NEAR (10^24 yoctoNEAR) to prevent sybil farming."
  );

  // Full anti-ghosting collateral: (total_members - 1) * contribution_amount
  // Guarantees that even the Round 1 recipient cannot profit by taking the pot and ghosting remaining rounds!
  const requiredCollateralBytes = u128MulSmall(contributionBytes, u32(totalMembers - 1));
  const requiredCollateralStr = u128ToString(requiredCollateralBytes);

  assertCondition(
    u128Compare(deposit, requiredCollateralBytes) == 0,
    "Exact collateral stake of (N-1)*contribution required: " + requiredCollateralStr + " yoctoNEAR."
  );

  const count = I64.parseInt(storageRead("counter", "0")) + 1;
  storageWrite("counter", count.toString());
  const circleId = "circle_" + count.toString();

  const record =
    name + "|" +
    caller + "|" +
    contributionStr + "|" +
    requiredCollateralStr + "|" +
    durationMs.toString() + "|" +
    totalMembers.toString() + "|" +
    caller + "|" +
    caller + "|" +
    "0|0|0|Pending|0||";

  storageWrite("c:" + circleId, record);
  storageWrite("col:" + circleId + ":" + caller, requiredCollateralStr);
  ensureProfileWritten(caller);

  log("Circle " + circleId + " created by " + caller + " with collateral " + requiredCollateralStr);
  valueReturn('"' + circleId + '"');
}

export function join_circle(): void {
  const input = getInputString();
  const caller = predecessorAccountId();
  const deposit = attachedDepositBytes();
  const circleId = getJsonString(input, "circle_id");

  assertCondition(isSafeIdentifier(caller), "Invalid caller account ID.");
  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");

  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");

  const p = raw.split("|");
  const status = p[11];
  assertCondition(status == "Pending", "Circle is not accepting new members.");

  const members = splitCsv(p[6]);
  assertCondition(!arrayContains(members, caller), "Already a member of this circle.");

  const requiredCollateralStr = p[3];
  const requiredCollateralBytes = u128FromString(requiredCollateralStr);
  assertCondition(
    u128Compare(deposit, requiredCollateralBytes) == 0,
    "Exact collateral stake required to join: " + requiredCollateralStr + " yoctoNEAR."
  );

  members.push(caller);
  storageWrite("col:" + circleId + ":" + caller, requiredCollateralStr);
  ensureProfileWritten(caller);

  const totalMembers = i32(I64.parseInt(p[5]));
  const durationMs = u64(I64.parseInt(p[4]));

  // Sort payout order by reputation score descending when full
  const payoutOrder = new Array<string>();
  for (let i = 0; i < members.length; i++) payoutOrder.push(members[i]);

  if (members.length >= totalMembers) {
    // Bubble sort descending by score
    for (let i = 0; i < payoutOrder.length; i++) {
      for (let j = i + 1; j < payoutOrder.length; j++) {
        if (getScoreReadOnly(payoutOrder[j]) > getScoreReadOnly(payoutOrder[i])) {
          const tmp = payoutOrder[i];
          payoutOrder[i] = payoutOrder[j];
          payoutOrder[j] = tmp;
        }
      }
    }
    p[8] = "1"; // current_round
    const now = blockTimestampMs();
    p[9] = now.toString();
    p[10] = (now + durationMs).toString();
    p[11] = "Active";
    storageWrite("cp:" + circleId + ":1", "");
    log("Circle " + circleId + " activated! Payout order: " + joinCsv(payoutOrder));
  }

  p[6] = joinCsv(members);
  p[7] = joinCsv(payoutOrder);
  storageWrite("c:" + circleId, p.join("|"));
  valueReturn("true");
}

export function deposit(): void {
  const input = getInputString();
  const caller = predecessorAccountId();
  const depositVal = attachedDepositBytes();
  const circleId = getJsonString(input, "circle_id");

  assertCondition(isSafeIdentifier(caller), "Invalid caller account ID.");
  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");

  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");

  const p = raw.split("|");
  assertCondition(p[11] == "Active", "Circle is not active.");

  const members = splitCsv(p[6]);
  assertCondition(arrayContains(members, caller), "You are not a member of this circle.");

  const defaulted = splitCsv(p[13]);
  assertCondition(!arrayContains(defaulted, caller), "Defaulters are banned from deposits.");

  const requiredStr = p[2];
  const requiredBytes = u128FromString(requiredStr);
  assertCondition(
    u128Compare(depositVal, requiredBytes) == 0,
    "Exact round contribution required: " + requiredStr + " yoctoNEAR."
  );

  const roundStr = p[8];
  const paidKey = "cp:" + circleId + ":" + roundStr;
  const paidMembers = splitCsv(storageRead(paidKey, ""));
  assertCondition(!arrayContains(paidMembers, caller), "Already contributed for this round.");

  paidMembers.push(caller);
  storageWrite(paidKey, joinCsv(paidMembers));

  // Add to round pot
  const newPotBytes = u128Add(u128FromString(p[12]), depositVal);
  p[12] = u128ToString(newPotBytes);
  storageWrite("c:" + circleId, p.join("|"));

  // Check deadline: only reward +15 reputation if deposited before or at round_deadline and not defaulted
  const now = blockTimestampMs();
  const deadline = u64(I64.parseInt(p[10]));
  if (now <= deadline && !arrayContains(defaulted, caller)) {
    updateProfile(caller, 0, 1, 0, 15, "0");
    log("On-time deposit confirmed for " + caller + " in Round " + roundStr + " (+15 Rep).");
  } else {
    log("Late deposit recorded for " + caller + " in Round " + roundStr + " (+0 Rep).");
  }

  valueReturn("true");
}

export function report_default(): void {
  const input = getInputString();
  const circleId = getJsonString(input, "circle_id");
  const defaulterId = getJsonString(input, "defaulter_id");

  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");
  assertCondition(isSafeIdentifier(defaulterId), "Invalid defaulter_id format.");

  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");

  const p = raw.split("|");
  assertCondition(p[11] == "Active", "Circle is not active.");

  const now = blockTimestampMs();
  const deadline = u64(I64.parseInt(p[10]));
  assertCondition(now > deadline, "Round deadline has not expired yet.");

  const members = splitCsv(p[6]);
  assertCondition(arrayContains(members, defaulterId), "Target is not a member of this circle.");

  const roundStr = p[8];
  const paidKey = "cp:" + circleId + ":" + roundStr;
  const paidMembers = splitCsv(storageRead(paidKey, ""));
  assertCondition(!arrayContains(paidMembers, defaulterId), "Member has already paid for this round.");

  const defaulted = splitCsv(p[13]);
  if (!arrayContains(defaulted, defaulterId)) {
    defaulted.push(defaulterId);
    p[13] = joinCsv(defaulted);
  }

  const requiredStr = p[2];
  const requiredBytes = u128FromString(requiredStr);
  const colKey = "col:" + circleId + ":" + defaulterId;
  const currentColBytes = u128FromString(storageRead(colKey, "0"));

  // Slash reputation (-150 pts)
  updateProfile(defaulterId, 0, 0, 1, -150, requiredStr);

  if (u128Compare(currentColBytes, requiredBytes) < 0) {
    // Collateral exhausted -> transition to Terminated so honest members can call withdraw_on_termination
    p[11] = "Terminated";
    storageWrite("c:" + circleId, p.join("|"));
    log("Circle " + circleId + " TERMINATED: defaulter " + defaulterId + " collateral exhausted.");
    valueReturn('"Terminated"');
    return;
  }

  // Seize 1 round of collateral to cover the pot
  const remainingColBytes = u128Sub(currentColBytes, requiredBytes);
  storageWrite(colKey, u128ToString(remainingColBytes));

  const newPotBytes = u128Add(u128FromString(p[12]), requiredBytes);
  p[12] = u128ToString(newPotBytes);

  paidMembers.push(defaulterId);
  storageWrite(paidKey, joinCsv(paidMembers));
  storageWrite("c:" + circleId, p.join("|"));

  log("Default resolved for " + defaulterId + ": seized " + requiredStr + " collateral for Round " + roundStr);
  valueReturn('"Covered"');
}

export function claim_payout(): void {
  const input = getInputString();
  const circleId = getJsonString(input, "circle_id");

  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");

  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");

  const p = raw.split("|");
  assertCondition(p[11] == "Active", "Circle is not active.");

  const totalMembers = i32(I64.parseInt(p[5]));
  const round = i32(I64.parseInt(p[8]));
  const roundStr = round.toString();

  assertCondition(storageRead("cc:" + circleId + ":" + roundStr, "0") != "1", "Payout already claimed for this round.");

  const paidMembers = splitCsv(storageRead("cp:" + circleId + ":" + roundStr, ""));
  assertCondition(paidMembers.length >= totalMembers, "Cannot claim pot yet: incomplete round deposits.");

  const payoutOrder = splitCsv(p[7]);
  const defaulted = splitCsv(p[13]);
  const paidRecipients = splitCsv(p[14]);

  // Select recipient: first non-defaulted member in payoutOrder who hasn't been paid yet!
  // Defaulters are NEVER paid the pot (fixes Bug B).
  let recipient = "";
  for (let i = 0; i < payoutOrder.length; i++) {
    const candidate = payoutOrder[i];
    if (!arrayContains(defaulted, candidate) && !arrayContains(paidRecipients, candidate)) {
      recipient = candidate;
      break;
    }
  }

  // Fallback if all honest members already received their round pot (e.g. final round belonged to a defaulter):
  // route to the first honest member
  if (recipient.length == 0) {
    for (let i = 0; i < payoutOrder.length; i++) {
      if (!arrayContains(defaulted, payoutOrder[i])) {
        recipient = payoutOrder[i];
        break;
      }
    }
  }
  assertCondition(recipient.length > 0, "No honest recipient available.");

  paidRecipients.push(recipient);
  p[14] = joinCsv(paidRecipients);

  const potBytes = u128FromString(p[12]);
  p[12] = "0";
  storageWrite("cc:" + circleId + ":" + roundStr, "1");

  // Transfer pot to the honest recipient
  transferNear(recipient, potBytes);

  // Check if all non-defaulted members have received their lump-sum payout
  const members = splitCsv(p[6]);
  let allHonestPaid = true;
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (!arrayContains(defaulted, m) && !arrayContains(paidRecipients, m)) {
      allHonestPaid = false;
      break;
    }
  }

  // Complete circle if we reached totalMembers OR all honest members have received their lump-sum payout
  if (round >= totalMembers || allHonestPaid) {
    p[11] = "Completed";

    // Sweep any leftover defaulter collateral
    let bonusPoolBytes = u128FromString("0");
    for (let i = 0; i < defaulted.length; i++) {
      const defColKey = "col:" + circleId + ":" + defaulted[i];
      const remCol = u128FromString(storageRead(defColKey, "0"));
      if (!u128IsZero(remCol)) {
        bonusPoolBytes = u128Add(bonusPoolBytes, remCol);
      }
      storageRemove(defColKey);
    }

    // Refund collateral to honest members and award +50 completion bonus
    let firstHonest = true;
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      if (!arrayContains(defaulted, m)) {
        const colKey = "col:" + circleId + ":" + m;
        let refundBytes = u128FromString(storageRead(colKey, "0"));
        if (firstHonest && !u128IsZero(bonusPoolBytes)) {
          refundBytes = u128Add(refundBytes, bonusPoolBytes);
          firstHonest = false;
        }
        storageRemove(colKey);
        if (!u128IsZero(refundBytes)) {
          transferNear(m, refundBytes);
        }
        updateProfile(m, 1, 0, 0, 50, "0");
      }
    }
    log("Circle " + circleId + " COMPLETED! Honest collaterals refunded and storage cleaned.");
  } else {
    const nextRound = round + 1;
    p[8] = nextRound.toString();
    const now = blockTimestampMs();
    const durationMs = u64(I64.parseInt(p[4]));
    p[9] = now.toString();
    p[10] = (now + durationMs).toString();
    storageWrite("cp:" + circleId + ":" + nextRound.toString(), "");
    log("Round " + roundStr + " disbursed to " + recipient + ". Advancing to Round " + nextRound.toString());
  }

  storageWrite("c:" + circleId, p.join("|"));
  valueReturn('"' + recipient + '"');
}

export function leave_pending_circle(): void {
  const input = getInputString();
  const caller = predecessorAccountId();
  const circleId = getJsonString(input, "circle_id");

  assertCondition(isSafeIdentifier(caller), "Invalid caller account ID.");
  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");

  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");

  const p = raw.split("|");
  assertCondition(p[11] == "Pending", "Only Pending circles can be left via leave_pending_circle.");

  const creator = p[1];
  assertCondition(caller != creator, "Creator cannot leave their own circle; call cancel_pending_circle instead.");

  const members = splitCsv(p[6]);
  assertCondition(arrayContains(members, caller), "Caller is not a member of this circle.");

  // Refund caller's collateral and clean up storage key
  const colKey = "col:" + circleId + ":" + caller;
  const refundBytes = u128FromString(storageRead(colKey, "0"));
  storageRemove(colKey);
  if (!u128IsZero(refundBytes)) {
    transferNear(caller, refundBytes);
  }

  // Remove caller from members and payout_order so other members can join
  const updatedMembers = new Array<string>();
  for (let i = 0; i < members.length; i++) {
    if (members[i] != caller) updatedMembers.push(members[i]);
  }
  p[6] = joinCsv(updatedMembers);
  p[7] = joinCsv(updatedMembers);
  storageWrite("c:" + circleId, p.join("|"));

  log("Member " + caller + " left pending circle " + circleId + ". Collateral refunded.");
  valueReturn("true");
}

export function cancel_pending_circle(): void {
  const input = getInputString();
  const caller = predecessorAccountId();
  const circleId = getJsonString(input, "circle_id");

  assertCondition(isSafeIdentifier(caller), "Invalid caller account ID.");
  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");

  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");

  const p = raw.split("|");
  assertCondition(p[11] == "Pending", "Only Pending circles can be cancelled via cancel_pending_circle.");

  const creator = p[1];
  assertCondition(
    caller == creator,
    "Only the circle creator can cancel a pending circle. Other members should call leave_pending_circle."
  );

  const members = splitCsv(p[6]);
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const colKey = "col:" + circleId + ":" + m;
    const refundBytes = u128FromString(storageRead(colKey, "0"));
    storageRemove(colKey);
    if (!u128IsZero(refundBytes)) {
      transferNear(m, refundBytes);
    }
  }

  p[11] = "Terminated";
  p[6] = "";
  p[7] = "";
  storageWrite("c:" + circleId, p.join("|"));
  log("Pending circle " + circleId + " cancelled by creator " + caller + ": all staked collaterals refunded and storage cleaned.");
  valueReturn("true");
}

export function withdraw_on_termination(): void {
  const input = getInputString();
  const caller = predecessorAccountId();
  const circleId = getJsonString(input, "circle_id");

  assertCondition(isSafeIdentifier(caller), "Invalid caller account ID.");
  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");

  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");

  const p = raw.split("|");
  const status = p[11];
  const members = splitCsv(p[6]);

  // If the circle is still Pending:
  // - Creator can terminate & refund everyone
  // - Other members leave and refund only themselves (preventing G1 cancel griefing)
  if (status == "Pending") {
    const creator = p[1];
    if (caller == creator) {
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const colKey = "col:" + circleId + ":" + m;
        const refundBytes = u128FromString(storageRead(colKey, "0"));
        storageRemove(colKey);
        if (!u128IsZero(refundBytes)) {
          transferNear(m, refundBytes);
        }
      }
      p[11] = "Terminated";
      p[6] = "";
      p[7] = "";
      storageWrite("c:" + circleId, p.join("|"));
      log("Pending circle " + circleId + " terminated by creator " + caller + ": all staked collaterals refunded.");
      valueReturn("true");
      return;
    } else {
      assertCondition(arrayContains(members, caller), "Caller is not a member of this pending circle.");
      const colKey = "col:" + circleId + ":" + caller;
      const refundBytes = u128FromString(storageRead(colKey, "0"));
      storageRemove(colKey);
      if (!u128IsZero(refundBytes)) {
        transferNear(caller, refundBytes);
      }
      const updatedMembers = new Array<string>();
      for (let i = 0; i < members.length; i++) {
        if (members[i] != caller) updatedMembers.push(members[i]);
      }
      p[6] = joinCsv(updatedMembers);
      p[7] = joinCsv(updatedMembers);
      storageWrite("c:" + circleId, p.join("|"));
      log("Member " + caller + " withdrew from pending circle " + circleId + " and left.");
      valueReturn("true");
      return;
    }
  }

  const defaulted = splitCsv(p[13]);
  const paidRecipients = splitCsv(p[14]);
  const round = i32(I64.parseInt(p[8]));
  const roundStr = p[8];
  const paidKey = "cp:" + circleId + ":" + roundStr;
  const paidThisRound = splitCsv(storageRead(paidKey, ""));
  const totalMembers = i32(I64.parseInt(p[5]));
  const contributionBytes = u128FromString(p[2]);

  if (status == "Active") {
    const now = blockTimestampMs();
    const deadline = u64(I64.parseInt(p[10]));
    assertCondition(
      now > deadline && paidThisRound.length < totalMembers,
      "Circle is Active and round deadline has not expired with missing payments."
    );
    // Mark members who missed the expired round as defaulted
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      if (!arrayContains(paidThisRound, m) && !arrayContains(defaulted, m)) {
        defaulted.push(m);
        updateProfile(m, 0, 0, 1, -150, p[2]);
      }
    }
    p[13] = joinCsv(defaulted);
    p[11] = "Terminated";
  } else {
    assertCondition(status == "Terminated", "Circle is not in Terminated state.");
  }

  // Seize remaining collateral of all defaulted members into a recovery pool
  let recoveryPool = u128FromString("0");
  for (let i = 0; i < defaulted.length; i++) {
    const dKey = "col:" + circleId + ":" + defaulted[i];
    const dCol = u128FromString(storageRead(dKey, "0"));
    if (!u128IsZero(dCol)) {
      recoveryPool = u128Add(recoveryPool, dCol);
    }
    storageRemove(dKey);
  }

  // Refund every honest member's collateral + current-round deposit + prior-round contributions if unpaid
  const priorRoundsCount = round > 1 ? u32(round - 1) : 0;
  const priorContributionPerHonest = u128MulSmall(contributionBytes, priorRoundsCount);

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (!arrayContains(defaulted, m)) {
      const colKey = "col:" + circleId + ":" + m;
      let refundBytes = u128FromString(storageRead(colKey, "0"));
      storageRemove(colKey);

      if (arrayContains(paidThisRound, m)) {
        refundBytes = u128Add(refundBytes, contributionBytes);
      }

      // If this honest member hasn't received a pot yet, compensate prior rounds from the recovery pool
      if (!arrayContains(paidRecipients, m) && priorRoundsCount > 0) {
        if (u128Compare(recoveryPool, priorContributionPerHonest) >= 0) {
          refundBytes = u128Add(refundBytes, priorContributionPerHonest);
          recoveryPool = u128Sub(recoveryPool, priorContributionPerHonest);
        } else if (!u128IsZero(recoveryPool)) {
          refundBytes = u128Add(refundBytes, recoveryPool);
          recoveryPool = u128FromString("0");
        }
      }

      if (!u128IsZero(refundBytes)) {
        transferNear(m, refundBytes);
      }
    }
  }

  // Clear current round paid list and pot so it cannot be withdrawn twice
  storageRemove(paidKey);
  p[12] = "0";
  storageWrite("c:" + circleId, p.join("|"));

  log("Terminated circle " + circleId + " settled: all honest collaterals and deposits refunded.");
  valueReturn("true");
}

// ------------------------------------------------------------
// Read-Only View Methods (Zero Storage Writes)
// ------------------------------------------------------------

export function get_reputation_profile(): void {
  const input = getInputString();
  const accountId = getJsonString(input, "account_id");
  assertCondition(isSafeIdentifier(accountId), "Invalid account_id format.");
  valueReturn(getProfileJsonReadOnly(accountId));
}

export function get_circle(): void {
  const input = getInputString();
  const circleId = getJsonString(input, "circle_id");
  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");
  valueReturn(buildCircleJson(circleId));
}

export function get_circles(): void {
  const input = getInputString();
  const fromIndex = i32(getJsonNumber(input, "from_index", 0));
  let limit = i32(getJsonNumber(input, "limit", 10));
  if (limit > 50) limit = 50;

  const total = i32(I64.parseInt(storageRead("counter", "0")));
  const start = fromIndex + 1;
  let end = start + limit - 1;
  if (end > total) end = total;

  let out = "[";
  let first = true;
  for (let i = start; i <= end; i++) {
    const cJson = buildCircleJson("circle_" + i.toString());
    if (cJson != "null") {
      if (!first) out += ",";
      out += cJson;
      first = false;
    }
  }
  out += "]";
  valueReturn(out);
}
