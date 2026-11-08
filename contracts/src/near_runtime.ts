// NEAR Protocol VM Host Bindings & u128 Utilities for AssemblyScript

@external("env", "input")
export declare function env_input(register_id: u64): void;

@external("env", "read_register")
export declare function env_read_register(register_id: u64, ptr: u64): void;

@external("env", "register_len")
export declare function env_register_len(register_id: u64): u64;

@external("env", "predecessor_account_id")
export declare function env_predecessor_account_id(register_id: u64): void;

@external("env", "attached_deposit")
export declare function env_attached_deposit(balance_ptr: u64): void;

@external("env", "block_timestamp")
export declare function env_block_timestamp(): u64;

@external("env", "storage_write")
export declare function env_storage_write(key_len: u64, key_ptr: u64, value_len: u64, value_ptr: u64, register_id: u64): u64;

@external("env", "storage_read")
export declare function env_storage_read(key_len: u64, key_ptr: u64, register_id: u64): u64;

@external("env", "storage_has_key")
export declare function env_storage_has_key(key_len: u64, key_ptr: u64): u64;

@external("env", "value_return")
export declare function env_value_return(value_len: u64, value_ptr: u64): void;

@external("env", "log_utf8")
export declare function env_log_utf8(len: u64, ptr: u64): void;

@external("env", "panic_utf8")
export declare function env_panic_utf8(len: u64, ptr: u64): void;

@external("env", "promise_batch_create")
export declare function env_promise_batch_create(account_id_len: u64, account_id_ptr: u64): u64;

@external("env", "promise_batch_action_transfer")
export declare function env_promise_batch_action_transfer(promise_index: u64, amount_ptr: u64): void;

// ------------------------------------------------------------
// High-Level NEAR Host Wrappers
// ------------------------------------------------------------

export function readRegisterString(register_id: u64): string {
  const len = env_register_len(register_id);
  if (len == 0 || len == u64.MAX_VALUE) return "";
  const buf = new ArrayBuffer(i32(len));
  env_read_register(register_id, u64(changetype<usize>(buf)));
  return String.UTF8.decode(buf);
}

export function getInputString(): string {
  env_input(0);
  return readRegisterString(0);
}

export function predecessorAccountId(): string {
  env_predecessor_account_id(1);
  return readRegisterString(1);
}

export function attachedDepositBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  env_attached_deposit(u64(bytes.dataStart));
  return bytes;
}

export function blockTimestampMs(): u64 {
  return env_block_timestamp() / 1_000_000;
}

export function log(msg: string): void {
  const buf = String.UTF8.encode(msg);
  env_log_utf8(u64(buf.byteLength), u64(changetype<usize>(buf)));
}

export function assertCondition(cond: bool, msg: string): void {
  if (!cond) {
    const buf = String.UTF8.encode(msg);
    env_panic_utf8(u64(buf.byteLength), u64(changetype<usize>(buf)));
    unreachable();
  }
}

export function customAbort(
  message: string | null,
  fileName: string | null,
  lineNumber: u32,
  columnNumber: u32
): void {
  const m = message !== null ? changetype<string>(message) : "abort";
  const f = fileName !== null ? changetype<string>(fileName) : "";
  const full = m + " at " + f + ":" + lineNumber.toString() + ":" + columnNumber.toString();
  const buf = String.UTF8.encode(full);
  env_panic_utf8(u64(buf.byteLength), u64(changetype<usize>(buf)));
  unreachable();
}

export function valueReturn(jsonStr: string): void {
  const buf = String.UTF8.encode(jsonStr);
  env_value_return(u64(buf.byteLength), u64(changetype<usize>(buf)));
}

export function storageRead(key: string, defaultVal: string = ""): string {
  const keyBuf = String.UTF8.encode(key);
  const exists = env_storage_read(u64(keyBuf.byteLength), u64(changetype<usize>(keyBuf)), 2);
  if (exists == 0) return defaultVal;
  return readRegisterString(2);
}

export function storageHasKey(key: string): bool {
  const keyBuf = String.UTF8.encode(key);
  return env_storage_has_key(u64(keyBuf.byteLength), u64(changetype<usize>(keyBuf))) == 1;
}

export function storageWrite(key: string, val: string): void {
  const keyBuf = String.UTF8.encode(key);
  const valBuf = String.UTF8.encode(val);
  env_storage_write(
    u64(keyBuf.byteLength),
    u64(changetype<usize>(keyBuf)),
    u64(valBuf.byteLength),
    u64(changetype<usize>(valBuf)),
    3
  );
}

export function transferNear(recipient: string, amountBytes: Uint8Array): void {
  const recBuf = String.UTF8.encode(recipient);
  const promiseIdx = env_promise_batch_create(u64(recBuf.byteLength), u64(changetype<usize>(recBuf)));
  env_promise_batch_action_transfer(promiseIdx, u64(amountBytes.dataStart));
}

// ------------------------------------------------------------
// 128-bit Unsigned Integer (yoctoNEAR) Arithmetic on Uint8Array(16)
// ------------------------------------------------------------

export function u128FromString(s: string): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) continue;
    let carry: u32 = u32(c - 48);
    for (let j = 0; j < 16; j++) {
      const val: u32 = u32(bytes[j]) * 10 + carry;
      bytes[j] = u8(val & 0xFF);
      carry = val >> 8;
    }
  }
  return bytes;
}

export function u128ToString(bytes: Uint8Array): string {
  const temp = new Uint8Array(16);
  for (let i = 0; i < 16; i++) temp[i] = bytes[i];
  const chars = new Array<i32>();
  while (true) {
    let isZero = true;
    for (let i = 0; i < 16; i++) {
      if (temp[i] != 0) {
        isZero = false;
        break;
      }
    }
    if (isZero) break;
    let rem: u32 = 0;
    for (let i = 15; i >= 0; i--) {
      const cur: u32 = (rem << 8) | u32(temp[i]);
      temp[i] = u8(cur / 10);
      rem = cur % 10;
    }
    chars.push(48 + i32(rem));
  }
  if (chars.length == 0) return "0";
  chars.reverse();
  return String.fromCharCodes(chars);
}

export function u128Compare(a: Uint8Array, b: Uint8Array): i32 {
  for (let i = 15; i >= 0; i--) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

export function u128Add(a: Uint8Array, b: Uint8Array): Uint8Array {
  const res = new Uint8Array(16);
  let carry: u32 = 0;
  for (let i = 0; i < 16; i++) {
    const sum: u32 = u32(a[i]) + u32(b[i]) + carry;
    res[i] = u8(sum & 0xFF);
    carry = sum >> 8;
  }
  return res;
}

export function u128Sub(a: Uint8Array, b: Uint8Array): Uint8Array {
  const res = new Uint8Array(16);
  let borrow: i32 = 0;
  for (let i = 0; i < 16; i++) {
    let diff: i32 = i32(a[i]) - i32(b[i]) - borrow;
    if (diff < 0) {
      diff += 256;
      borrow = 1;
    } else {
      borrow = 0;
    }
    res[i] = u8(diff);
  }
  return res;
}

export function u128MulSmall(a: Uint8Array, factor: u32): Uint8Array {
  const res = new Uint8Array(16);
  let carry: u32 = 0;
  for (let i = 0; i < 16; i++) {
    const prod: u32 = u32(a[i]) * factor + carry;
    res[i] = u8(prod & 0xFF);
    carry = prod >> 8;
  }
  return res;
}

export function u128IsZero(a: Uint8Array): bool {
  for (let i = 0; i < 16; i++) {
    if (a[i] != 0) return false;
  }
  return true;
}

// ------------------------------------------------------------
// Lightweight JSON Field Extractors
// ------------------------------------------------------------

export function getJsonString(json: string, key: string): string {
  const pattern = '"' + key + '"';
  const idx = json.indexOf(pattern);
  if (idx == -1) return "";
  const colonIdx = json.indexOf(":", idx + pattern.length);
  if (colonIdx == -1) return "";
  const firstQuote = json.indexOf('"', colonIdx + 1);
  if (firstQuote == -1) return "";
  const secondQuote = json.indexOf('"', firstQuote + 1);
  if (secondQuote == -1) return "";
  return json.substring(firstQuote + 1, secondQuote);
}

export function getJsonNumber(json: string, key: string, defaultVal: i64 = 0): i64 {
  const pattern = '"' + key + '"';
  const idx = json.indexOf(pattern);
  if (idx == -1) return defaultVal;
  const colonIdx = json.indexOf(":", idx + pattern.length);
  if (colonIdx == -1) return defaultVal;
  let i = colonIdx + 1;
  while (i < json.length && (json.charCodeAt(i) == 32 || json.charCodeAt(i) == 34)) i++;
  let numStr = "";
  while (i < json.length) {
    const c = json.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      numStr += String.fromCharCode(c);
      i++;
    } else {
      break;
    }
  }
  if (numStr.length == 0) return defaultVal;
  return I64.parseInt(numStr);
}
