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
  ftTransfer,
  u128FromString,
  u128ToString,
  u128Compare,
  u128Add,
  u128Sub,
  u128MulSmall,
  u128Div2,
  u128IsZero,
  getJsonString,
  getJsonNumber
} from "./near_runtime";

// Stablecoin circles use base units (6 decimals: 1_000_000 = 1 USDC). Native NEAR circles keep the 1 NEAR floor.
const MIN_FT_BASE_UNITS = "1000000";
const SILVER_SCORE: i32 = 550;

// Minimum contribution: 1 NEAR (10^24 yoctoNEAR) to prevent sybil score farming with dust circles
const MIN_CONTRIBUTION_YOCTO = "1000000000000000000000000";

function computeTier(score: i32): string {
  if (score >= 850) return "Platinum";
  if (score >= 700) return "Gold";
  if (score >= 550) return "Silver";
  return "Bronze";
}

function collateralBpsForScore(score: i32): i32 {
  if (score >= SILVER_SCORE) return 5000;
  return 10000;
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
  const bps = collateralBpsForScore(score);
  return (
    '{"account_id":"' + accountId +
    '","circles_completed":' + completed.toString() +
    ',"on_time_payments":' + onTime.toString() +
    ',"missed_payments":' + missed.toString() +
    ',"reputation_score":' + score.toString() +
    ',"tier":"' + tier +
    '","collateral_bps":' + bps.toString() +
    ',"collateral_slashed_total":"' + slashed + '"}'
  );
}

function writeNft(accountId: string): void {
  const raw = storageRead("rep:" + accountId, "0|0|0|500|0");
  const parts = raw.split("|");
  const score = i32(I64.parseInt(parts[3]));
  const bps = collateralBpsForScore(score);
  const tier = computeTier(score);
  const existed = storageHasKey("nft:minted:" + accountId);
  const json =
    '{"token_id":"' + accountId +
    '","owner_id":"' + accountId +
    '","soulbound":true,"metadata":{"title":"Ajo Reputation Pass","description":"Non-transferable credit pass. The score sets how much collateral this account must lock.","extra":"score=' +
    score.toString() + ";tier=" + tier + ";collateral_bps=" + bps.toString() +
    '"}}';
  storageWrite("nft:" + accountId, json);
  if (!existed) {
    storageWrite("nft:minted:" + accountId, "1");
    const supply = I64.parseInt(storageRead("nft_supply", "0")) + 1;
    storageWrite("nft_supply", supply.toString());
  }
}

function ensureProfileWritten(accountId: string): void {
  const key = "rep:" + accountId;
  if (storageRead(key, "").length == 0) {
    storageWrite(key, "0|0|0|500|0");
  }
  writeNft(accountId);
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
  writeNft(accountId);
}

function fieldAt(p: Array<string>, index: i32, fallback: string): string {
  if (index < 0 || index >= p.length) return fallback;
  return p[index];
}

function circleToken(p: Array<string>): string {
  return fieldAt(p, 15, "");
}

function assertCanUseCredit(accountId: string): void {
  assertCondition(
    storageHasKey("nft:minted:" + accountId),
    "Credit collateral requires a minted soulbound reputation pass."
  );
  assertCondition(
    getScoreReadOnly(accountId) >= SILVER_SCORE,
    "Credit collateral requires a Silver soulbound pass (score >= 550)."
  );
}

function pay(token: string, recipient: string, amount: Uint8Array): void {
  if (u128IsZero(amount) || recipient.length == 0) return;
  if (token.length == 0) {
    transferNear(recipient, amount);
  } else {
    ftTransfer(token, recipient, amount);
  }
}

function clearMemberBookkeeping(circleId: string, member: string): void {
  storageRemove("mdue:" + circleId + ":" + member);
  storageRemove("crd:" + circleId + ":" + member);
}

function refundVoucherStake(circleId: string, member: string, token: string): void {
  const whoKey = "vwho:" + circleId + ":" + member;
  const colKey = "vcol:" + circleId + ":" + member;
  const who = storageRead(whoKey, "");
  const amt = u128FromString(storageRead(colKey, "0"));
  storageRemove(whoKey);
  storageRemove(colKey);
  if (who.length > 0) pay(token, who, amt);
}

function confiscateVoucher(circleId: string, member: string): Uint8Array {
  const colKey = "vcol:" + circleId + ":" + member;
  const amt = u128FromString(storageRead(colKey, "0"));
  storageRemove(colKey);
  storageRemove("vwho:" + circleId + ":" + member);
  return amt;
}

// Returns false without moving funds when own collateral plus the voucher lock cannot cover one round.
function coverDefault(circleId: string, defaulterId: string, need: Uint8Array): bool {
  const colKey = "col:" + circleId + ":" + defaulterId;
  const own = u128FromString(storageRead(colKey, "0"));
  const vcolKey = "vcol:" + circleId + ":" + defaulterId;
  const vouched = u128FromString(storageRead(vcolKey, "0"));
  if (u128Compare(u128Add(own, vouched), need) < 0) return false;

  let fromOwn = own;
  if (u128Compare(own, need) > 0) fromOwn = need;
  const fromVoucher = u128Sub(need, fromOwn);
  storageWrite(colKey, u128ToString(u128Sub(own, fromOwn)));
  if (!u128IsZero(fromVoucher)) {
    storageWrite(vcolKey, u128ToString(u128Sub(vouched, fromVoucher)));
    const voucher = storageRead("vwho:" + circleId + ":" + defaulterId, "");
    if (voucher.length > 0) {
      updateProfile(voucher, 0, 0, 1, -150, u128ToString(fromVoucher));
    }
  }
  return true;
}

function memberCovered(circleId: string, member: string, required: Uint8Array): bool {
  const own = u128FromString(storageRead("col:" + circleId + ":" + member, "0"));
  const vouched = u128FromString(storageRead("vcol:" + circleId + ":" + member, "0"));
  return u128Compare(u128Add(own, vouched), required) >= 0;
}

function tryActivate(circleId: string, p: Array<string>): void {
  if (p[11] != "Pending") return;
  const members = splitCsv(p[6]);
  const totalMembers = i32(I64.parseInt(p[5]));
  if (members.length < totalMembers) return;
  const required = u128FromString(p[3]);
  for (let i = 0; i < members.length; i++) {
    if (!memberCovered(circleId, members[i], required)) return;
  }

  const payoutOrder = new Array<string>();
  for (let i = 0; i < members.length; i++) payoutOrder.push(members[i]);
  for (let i = 0; i < payoutOrder.length; i++) {
    for (let j = i + 1; j < payoutOrder.length; j++) {
      if (getScoreReadOnly(payoutOrder[j]) > getScoreReadOnly(payoutOrder[i])) {
        const tmp = payoutOrder[i];
        payoutOrder[i] = payoutOrder[j];
        payoutOrder[j] = tmp;
      }
    }
  }
  p[7] = joinCsv(payoutOrder);
  p[8] = "1";
  const now = blockTimestampMs();
  const durationMs = u64(I64.parseInt(p[4]));
  p[9] = now.toString();
  p[10] = (now + durationMs).toString();
  p[11] = "Active";
  storageWrite("cp:" + circleId + ":1", "");
  log("Circle " + circleId + " activated! Payout order: " + joinCsv(payoutOrder));
}

function lockMembership(
  circleId: string,
  member: string,
  full: Uint8Array,
  useCredit: bool,
  token: string,
  deposit: Uint8Array
): void {
  if (useCredit) {
    ensureProfileWritten(member);
    assertCanUseCredit(member);
  } else {
    ensureProfileWritten(member);
  }
  const memberDue = useCredit ? u128Div2(full) : full;
  const memberDueStr = u128ToString(memberDue);
  if (token.length == 0) {
    if (useCredit) {
      assertCondition(
        u128Compare(deposit, memberDue) == 0,
        "Credit stake is half of (N-1)*contribution: " + memberDueStr + " yoctoNEAR. A voucher locks the rest."
      );
    } else {
      assertCondition(
        u128Compare(deposit, memberDue) == 0,
        "Exact collateral stake of (N-1)*contribution required: " + memberDueStr + " yoctoNEAR."
      );
    }
    storageWrite("col:" + circleId + ":" + member, memberDueStr);
  } else {
    assertCondition(
      u128IsZero(deposit),
      "Stablecoin circles lock collateral through ft_transfer_call, not attached NEAR."
    );
    storageWrite("col:" + circleId + ":" + member, "0");
  }
  storageWrite("mdue:" + circleId + ":" + member, memberDueStr);
  if (useCredit) storageWrite("crd:" + circleId + ":" + member, "1");
}

function applyFtCollateral(circleId: string, member: string, amount: Uint8Array, token: string): void {
  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");
  const p = raw.split("|");
  assertCondition(p[11] == "Pending", "Collateral can only be locked while the circle is Pending.");
  assertCondition(circleToken(p) == token, "Token is not the circle stablecoin.");
  const members = splitCsv(p[6]);
  assertCondition(arrayContains(members, member), "Sender is not a member of this circle.");
  const mdue = u128FromString(storageRead("mdue:" + circleId + ":" + member, "0"));
  const own = u128FromString(storageRead("col:" + circleId + ":" + member, "0"));
  const next = u128Add(own, amount);
  assertCondition(u128Compare(next, mdue) == 0, "Stablecoin collateral must bring the member lock to exactly their share.");
  storageWrite("col:" + circleId + ":" + member, u128ToString(next));
  tryActivate(circleId, p);
  storageWrite("c:" + circleId, p.join("|"));
}

function applyVouch(circleId: string, member: string, voucher: string, amount: Uint8Array, token: string): void {
  assertCondition(voucher != member, "A member cannot vouch for themselves.");
  assertCondition(isSafeIdentifier(voucher), "Invalid voucher account ID.");
  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");
  const p = raw.split("|");
  assertCondition(p[11] == "Pending", "Vouching is only open while the circle is Pending.");
  assertCondition(circleToken(p) == token, "Token is not the circle stablecoin.");
  const members = splitCsv(p[6]);
  assertCondition(arrayContains(members, member), "Target is not a member of this circle.");
  assertCondition(storageRead("crd:" + circleId + ":" + member, "0") == "1", "Member is not using credit collateral.");
  assertCondition(storageRead("vwho:" + circleId + ":" + member, "").length == 0, "Member already has a voucher.");
  const mdue = u128FromString(storageRead("mdue:" + circleId + ":" + member, "0"));
  const own = u128FromString(storageRead("col:" + circleId + ":" + member, "0"));
  assertCondition(u128Compare(own, mdue) == 0, "Member must lock their own half before a voucher can lock the rest.");
  const required = u128FromString(p[3]);
  const gap = u128Sub(required, mdue);
  assertCondition(u128Compare(amount, gap) == 0, "Voucher must lock the exact remaining collateral: " + u128ToString(gap));
  ensureProfileWritten(voucher);
  storageWrite("vwho:" + circleId + ":" + member, voucher);
  storageWrite("vcol:" + circleId + ":" + member, u128ToString(gap));
  tryActivate(circleId, p);
  storageWrite("c:" + circleId, p.join("|"));
}

function applyDeposit(caller: string, circleId: string, depositVal: Uint8Array, token: string): void {
  assertCondition(isSafeIdentifier(caller), "Invalid caller account ID.");
  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");
  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");
  const p = raw.split("|");
  assertCondition(circleToken(p) == token, token.length == 0
    ? "This circle settles in " + circleToken(p) + ". Deposit with ft_transfer_call."
    : "Attached NEAR is not the contribution. Use ft_transfer_call.");
  assertCondition(p[11] == "Active", "Circle is not active.");
  const members = splitCsv(p[6]);
  assertCondition(arrayContains(members, caller), "You are not a member of this circle.");
  const defaulted = splitCsv(p[13]);
  assertCondition(!arrayContains(defaulted, caller), "Defaulters are banned from deposits.");
  const requiredStr = p[2];
  const requiredBytes = u128FromString(requiredStr);
  assertCondition(
    u128Compare(depositVal, requiredBytes) == 0,
    "Exact round contribution required: " + requiredStr + (token.length == 0 ? " yoctoNEAR." : " base units.")
  );
  const roundStr = p[8];
  const paidKey = "cp:" + circleId + ":" + roundStr;
  const paidMembers = splitCsv(storageRead(paidKey, ""));
  assertCondition(!arrayContains(paidMembers, caller), "Already contributed for this round.");
  paidMembers.push(caller);
  storageWrite(paidKey, joinCsv(paidMembers));
  const newPotBytes = u128Add(u128FromString(p[12]), depositVal);
  p[12] = u128ToString(newPotBytes);
  storageWrite("c:" + circleId, p.join("|"));
  const now = blockTimestampMs();
  const deadline = u64(I64.parseInt(p[10]));
  if (now <= deadline && !arrayContains(defaulted, caller)) {
    updateProfile(caller, 0, 1, 0, 15, "0");
    log("On-time deposit confirmed for " + caller + " in Round " + roundStr + " (+15 Rep).");
  } else {
    log("Late deposit recorded for " + caller + " in Round " + roundStr + " (+0 Rep).");
  }
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

  const token = fieldAt(p, 15, "");
  let creditJson = "[";
  let creditCount: i32 = 0;
  let vouchersJson = "{";
  let voucherCount: i32 = 0;
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (storageRead("crd:" + circleId + ":" + m, "0") == "1") {
      if (creditCount > 0) creditJson += ",";
      creditJson += '"' + m + '"';
      creditCount++;
    }
    const voucher = storageRead("vwho:" + circleId + ":" + m, "");
    if (voucher.length > 0) {
      if (voucherCount > 0) vouchersJson += ",";
      const vAmt = storageRead("vcol:" + circleId + ":" + m, "0");
      vouchersJson += '"' + m + '":{"voucher":"' + voucher + '","amount":"' + vAmt + '"}';
      voucherCount++;
    }
  }
  creditJson += "]";
  vouchersJson += "}";

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
    ',"paid_recipients":' + jsonStringArray(paidRecipients) +
    ',"token_id":"' + token +
    '","credit_members":' + creditJson +
    ',"vouchers":' + vouchersJson + '}'
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
  const tokenId = getJsonString(input, "token_id");
  const useCredit = getJsonNumber(input, "credit", 0) == 1;

  assertCondition(isSafeIdentifier(caller), "Invalid caller account ID.");
  assertCondition(
    isSafeText(name),
    "Circle name must be 2-64 safe characters (letters, numbers, spaces, -_#.) without pipes, quotes, or backslashes."
  );
  assertCondition(isSafeDigits(contributionStr), "Contribution amount must be a valid integer string.");
  assertCondition(totalMembers >= 2 && totalMembers <= 20, "Circle must require between 2 and 20 members.");
  assertCondition(durationMs >= 60000, "Round duration must be at least 60000 ms (1 minute).");
  if (tokenId.length > 0) {
    assertCondition(isSafeIdentifier(tokenId), "Invalid token account ID.");
  }

  const contributionBytes = u128FromString(contributionStr);
  if (tokenId.length == 0) {
    const minContributionBytes = u128FromString(MIN_CONTRIBUTION_YOCTO);
    assertCondition(
      u128Compare(contributionBytes, minContributionBytes) >= 0,
      "Minimum contribution is 1 NEAR (10^24 yoctoNEAR) to prevent sybil farming."
    );
  } else {
    const minFt = u128FromString(MIN_FT_BASE_UNITS);
    assertCondition(
      u128Compare(contributionBytes, minFt) >= 0,
      "Minimum stablecoin contribution is 1000000 base units."
    );
  }

  // Full anti-ghosting collateral stays (N-1)*C. Credit members lock half of that; a voucher locks the rest.
  const requiredCollateralBytes = u128MulSmall(contributionBytes, u32(totalMembers - 1));
  const requiredCollateralStr = u128ToString(requiredCollateralBytes);

  const count = I64.parseInt(storageRead("counter", "0")) + 1;
  storageWrite("counter", count.toString());
  const circleId = "circle_" + count.toString();

  let record =
    name + "|" +
    caller + "|" +
    contributionStr + "|" +
    requiredCollateralStr + "|" +
    durationMs.toString() + "|" +
    totalMembers.toString() + "|" +
    caller + "|" +
    caller + "|" +
    "0|0|0|Pending|0||";
  if (tokenId.length > 0) record += "|" + tokenId;

  storageWrite("c:" + circleId, record);
  lockMembership(circleId, caller, requiredCollateralBytes, useCredit, tokenId, deposit);

  log("Circle " + circleId + " created by " + caller + " with full collateral target " + requiredCollateralStr);
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

  const useCredit = getJsonNumber(input, "credit", 0) == 1;
  const requiredCollateralBytes = u128FromString(p[3]);
  const token = circleToken(p);
  members.push(caller);
  p[6] = joinCsv(members);
  p[7] = joinCsv(members);
  lockMembership(circleId, caller, requiredCollateralBytes, useCredit, token, deposit);
  tryActivate(circleId, p);
  storageWrite("c:" + circleId, p.join("|"));
  valueReturn("true");
}

export function deposit(): void {
  const input = getInputString();
  const caller = predecessorAccountId();
  const depositVal = attachedDepositBytes();
  const circleId = getJsonString(input, "circle_id");
  applyDeposit(caller, circleId, depositVal, "");
  valueReturn("true");
}

export function vouch(): void {
  const input = getInputString();
  const caller = predecessorAccountId();
  const deposit = attachedDepositBytes();
  const circleId = getJsonString(input, "circle_id");
  const memberId = getJsonString(input, "member_id");
  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");
  assertCondition(isSafeIdentifier(memberId), "Invalid member_id format.");
  const raw = storageRead("c:" + circleId, "");
  assertCondition(raw.length > 0, "Circle not found.");
  assertCondition(circleToken(raw.split("|")).length == 0, "This circle uses a stablecoin. Vouch with ft_transfer_call.");
  applyVouch(circleId, memberId, caller, deposit, "");
  valueReturn("true");
}

export function ft_on_transfer(): void {
  const input = getInputString();
  const token = predecessorAccountId();
  const sender = getJsonString(input, "sender_id");
  const amountStr = getJsonString(input, "amount");
  const msg = getJsonString(input, "msg");
  assertCondition(isSafeIdentifier(token), "Invalid token account ID.");
  assertCondition(isSafeIdentifier(sender), "Invalid sender account ID.");
  assertCondition(isSafeDigits(amountStr), "Fungible token amount must be a valid integer string.");
  const amount = u128FromString(amountStr);
  const parts = msg.split(":");
  assertCondition(parts.length >= 2, "msg must be collateral:circle_id, deposit:circle_id, or vouch:circle_id:member_id.");
  const action = parts[0];
  const circleId = parts[1];
  assertCondition(isSafeIdentifier(circleId), "Invalid circle_id format.");
  if (action == "collateral") {
    applyFtCollateral(circleId, sender, amount, token);
  } else if (action == "deposit") {
    applyDeposit(sender, circleId, amount, token);
  } else if (action == "vouch") {
    assertCondition(parts.length >= 3, "vouch msg requires vouch:circle_id:member_id.");
    const memberId = parts[2];
    assertCondition(isSafeIdentifier(memberId), "Invalid member_id format.");
    applyVouch(circleId, memberId, sender, amount, token);
  } else {
    assertCondition(false, "Unknown ft_on_transfer action.");
  }
  valueReturn('"0"');
}

export function nft_transfer(): void {
  assertCondition(false, "Soulbound: reputation pass cannot be transferred.");
}

export function nft_transfer_call(): void {
  assertCondition(false, "Soulbound: reputation pass cannot be transferred.");
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

  // Slash reputation (-150 pts)
  updateProfile(defaulterId, 0, 0, 1, -150, requiredStr);

  if (!coverDefault(circleId, defaulterId, requiredBytes)) {
    // Own collateral plus any voucher lock cannot cover this round.
    p[11] = "Terminated";
    storageWrite("c:" + circleId, p.join("|"));
    log("Circle " + circleId + " TERMINATED: defaulter " + defaulterId + " collateral exhausted.");
    valueReturn('"Terminated"');
    return;
  }

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

  const token = circleToken(p);
  // Transfer pot to the honest recipient
  pay(token, recipient, potBytes);

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

    // Sweep any leftover defaulter collateral, including a voucher lock that was not fully seized
    let bonusPoolBytes = u128FromString("0");
    for (let i = 0; i < defaulted.length; i++) {
      const defColKey = "col:" + circleId + ":" + defaulted[i];
      const remCol = u128FromString(storageRead(defColKey, "0"));
      if (!u128IsZero(remCol)) {
        bonusPoolBytes = u128Add(bonusPoolBytes, remCol);
      }
      storageRemove(defColKey);
      clearMemberBookkeeping(circleId, defaulted[i]);
      bonusPoolBytes = u128Add(bonusPoolBytes, confiscateVoucher(circleId, defaulted[i]));
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
        clearMemberBookkeeping(circleId, m);
        if (!u128IsZero(refundBytes)) {
          pay(token, m, refundBytes);
        }
        refundVoucherStake(circleId, m, token);
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

  // Refund caller's collateral and any voucher lock, then clean up storage keys
  const token = circleToken(p);
  const colKey = "col:" + circleId + ":" + caller;
  const refundBytes = u128FromString(storageRead(colKey, "0"));
  storageRemove(colKey);
  clearMemberBookkeeping(circleId, caller);
  pay(token, caller, refundBytes);
  refundVoucherStake(circleId, caller, token);

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
  const token = circleToken(p);
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const colKey = "col:" + circleId + ":" + m;
    const refundBytes = u128FromString(storageRead(colKey, "0"));
    storageRemove(colKey);
    clearMemberBookkeeping(circleId, m);
    pay(token, m, refundBytes);
    refundVoucherStake(circleId, m, token);
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
    const token = circleToken(p);
    if (caller == creator) {
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const colKey = "col:" + circleId + ":" + m;
        const refundBytes = u128FromString(storageRead(colKey, "0"));
        storageRemove(colKey);
        clearMemberBookkeeping(circleId, m);
        pay(token, m, refundBytes);
        refundVoucherStake(circleId, m, token);
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
      clearMemberBookkeeping(circleId, caller);
      pay(token, caller, refundBytes);
      refundVoucherStake(circleId, caller, token);
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

  // Prevent redundant re-settlement on an already-settled Terminated circle
  let hasFundsToSettle = !u128IsZero(u128FromString(p[12]));
  if (!hasFundsToSettle) {
    for (let i = 0; i < members.length; i++) {
      if (
        storageHasKey("col:" + circleId + ":" + members[i]) ||
        storageHasKey("vcol:" + circleId + ":" + members[i])
      ) {
        hasFundsToSettle = true;
        break;
      }
    }
  }
  assertCondition(hasFundsToSettle, "Terminated circle has already been settled and refunded.");

  // Seize remaining collateral of all defaulted members (plus any current-round pot share from defaulters) into recoveryPool
  let recoveryPool = u128FromString("0");
  for (let i = 0; i < defaulted.length; i++) {
    const defId = defaulted[i];
    const dKey = "col:" + circleId + ":" + defId;
    const dCol = u128FromString(storageRead(dKey, "0"));
    if (!u128IsZero(dCol)) {
      recoveryPool = u128Add(recoveryPool, dCol);
    }
    storageRemove(dKey);
    clearMemberBookkeeping(circleId, defId);
    recoveryPool = u128Add(recoveryPool, confiscateVoucher(circleId, defId));
    if (arrayContains(paidThisRound, defId)) {
      recoveryPool = u128Add(recoveryPool, contributionBytes);
    }
  }

  // Refund every honest member's collateral + current-round deposit + prior-round contributions if unpaid
  const priorRoundsCount = round > 1 ? u32(round - 1) : 0;
  const priorContributionPerHonest = u128MulSmall(contributionBytes, priorRoundsCount);

  const honestMembers = new Array<string>();
  const honestRefunds = new Array<Uint8Array>();

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (!arrayContains(defaulted, m)) {
      const colKey = "col:" + circleId + ":" + m;
      let refundBytes = u128FromString(storageRead(colKey, "0"));
      storageRemove(colKey);
      clearMemberBookkeeping(circleId, m);

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

      honestMembers.push(m);
      honestRefunds.push(refundBytes);
    }
  }

  const token = circleToken(p);
  // Strict Conservation of Value: sweep any remaining recoveryPool to honest members so 0 units are ever stranded
  if (!u128IsZero(recoveryPool)) {
    if (honestRefunds.length > 0) {
      honestRefunds[0] = u128Add(honestRefunds[0], recoveryPool);
    } else {
      pay(token, p[1], recoveryPool);
    }
  }

  for (let i = 0; i < honestMembers.length; i++) {
    pay(token, honestMembers[i], honestRefunds[i]);
    refundVoucherStake(circleId, honestMembers[i], token);
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

export function nft_token(): void {
  const input = getInputString();
  const tokenId = getJsonString(input, "token_id");
  assertCondition(isSafeIdentifier(tokenId), "Invalid token_id format.");
  const raw = storageRead("nft:" + tokenId, "");
  if (raw.length == 0) {
    valueReturn("null");
  } else {
    valueReturn(raw);
  }
}

export function nft_total_supply(): void {
  valueReturn('"' + storageRead("nft_supply", "0") + '"');
}

export function nft_supply_for_owner(): void {
  const input = getInputString();
  const accountId = getJsonString(input, "account_id");
  assertCondition(isSafeIdentifier(accountId), "Invalid account_id format.");
  valueReturn(storageHasKey("nft:minted:" + accountId) ? '"1"' : '"0"');
}

export function nft_tokens_for_owner(): void {
  const input = getInputString();
  const accountId = getJsonString(input, "account_id");
  assertCondition(isSafeIdentifier(accountId), "Invalid account_id format.");
  if (!storageHasKey("nft:minted:" + accountId)) {
    valueReturn("[]");
    return;
  }
  valueReturn("[" + storageRead("nft:" + accountId, "null") + "]");
}

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
