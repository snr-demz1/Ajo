// Orbit Protocol WASM VM Execution Harness
// Loads and executes the compiled `contracts/build/orbit_contract.wasm` directly in Node's WebAssembly VM,
// providing NEAR Protocol host bindings (registers, storage, u128 deposits, promises, and view enforcement).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.resolve(__dirname, "../build/orbit_contract.wasm");

export const CircleStatus = {
  Pending: "Pending",
  Active: "Active",
  Completed: "Completed",
  Terminated: "Terminated"
};

export const ReputationTier = {
  Bronze: "Bronze",
  Silver: "Silver",
  Gold: "Gold",
  Platinum: "Platinum"
};

function bigIntToLe16(val) {
  let v = BigInt(val);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function le16ToBigInt(bytes) {
  let v = 0n;
  for (let i = 15; i >= 0; i--) {
    v = (v << 8n) | BigInt(bytes[i]);
  }
  return v;
}

export class OrbitContractHarness {
  constructor() {
    if (!fs.existsSync(WASM_PATH)) {
      throw new Error(
        `Compiled WASM binary not found at ${WASM_PATH}. Run 'npm --prefix contracts run build' first.`
      );
    }

    this.wasmBytes = fs.readFileSync(WASM_PATH);
    this.wasmModule = new WebAssembly.Module(this.wasmBytes);

    this.storage = new Map();
    this.registers = new Map();
    this.promises = new Map();
    this.nextPromiseId = 1n;

    this.current_caller = "alice.testnet";
    this.current_deposit = 0n;
    this.mock_time_ms = 1_700_000_000_000;
    this.transfers = [];
    this.functionCalls = [];
    this.logs = [];
    this._returnValue = null;
    this._isView = false;

    const env = {
      input: (register_id) => {
        this.registers.set(register_id, this._inputBytes || new Uint8Array(0));
      },
      read_register: (register_id, ptr) => {
        const data = this.registers.get(register_id) || new Uint8Array(0);
        const mem = new Uint8Array(this.instance.exports.memory.buffer, Number(ptr), data.length);
        mem.set(data);
      },
      register_len: (register_id) => {
        const data = this.registers.get(register_id);
        return data ? BigInt(data.length) : 18446744073709551615n; // u64::MAX if not found
      },
      predecessor_account_id: (register_id) => {
        this.registers.set(register_id, new TextEncoder().encode(this.current_caller));
      },
      attached_deposit: (balance_ptr) => {
        const mem = new Uint8Array(this.instance.exports.memory.buffer, Number(balance_ptr), 16);
        mem.set(bigIntToLe16(this.current_deposit));
      },
      block_timestamp: () => {
        // NEAR block_timestamp is in nanoseconds (1 ms = 1,000,000 ns)
        return BigInt(this.mock_time_ms) * 1_000_000n;
      },
      storage_write: (key_len, key_ptr, value_len, value_ptr, register_id) => {
        if (this._isView) {
          throw new Error("HostError(ProhibitedInView { method_name: \"storage_write\" })");
        }
        const keyBytes = new Uint8Array(this.instance.exports.memory.buffer, Number(key_ptr), Number(key_len));
        const valBytes = new Uint8Array(this.instance.exports.memory.buffer, Number(value_ptr), Number(value_len));
        const key = new TextDecoder().decode(keyBytes);
        const existed = this.storage.has(key);
        if (existed) {
          this.registers.set(register_id, this.storage.get(key));
        }
        this.storage.set(key, new Uint8Array(valBytes));
        return existed ? 1n : 0n;
      },
      storage_read: (key_len, key_ptr, register_id) => {
        const keyBytes = new Uint8Array(this.instance.exports.memory.buffer, Number(key_ptr), Number(key_len));
        const key = new TextDecoder().decode(keyBytes);
        if (!this.storage.has(key)) return 0n;
        this.registers.set(register_id, this.storage.get(key));
        return 1n;
      },
      storage_has_key: (key_len, key_ptr) => {
        const keyBytes = new Uint8Array(this.instance.exports.memory.buffer, Number(key_ptr), Number(key_len));
        const key = new TextDecoder().decode(keyBytes);
        return this.storage.has(key) ? 1n : 0n;
      },
      storage_remove: (key_len, key_ptr, register_id) => {
        if (this._isView) {
          throw new Error("HostError(ProhibitedInView { method_name: \"storage_remove\" })");
        }
        const keyBytes = new Uint8Array(this.instance.exports.memory.buffer, Number(key_ptr), Number(key_len));
        const key = new TextDecoder().decode(keyBytes);
        if (!this.storage.has(key)) return 0n;
        const oldVal = this.storage.get(key);
        this.registers.set(register_id, oldVal);
        this.storage.delete(key);
        return 1n;
      },
      value_return: (value_len, value_ptr) => {
        const valBytes = new Uint8Array(this.instance.exports.memory.buffer, Number(value_ptr), Number(value_len));
        this._returnValue = new TextDecoder().decode(valBytes);
      },
      log_utf8: (len, ptr) => {
        const bytes = new Uint8Array(this.instance.exports.memory.buffer, Number(ptr), Number(len));
        this.logs.push(new TextDecoder().decode(bytes));
      },
      panic_utf8: (len, ptr) => {
        const bytes = new Uint8Array(this.instance.exports.memory.buffer, Number(ptr), Number(len));
        const msg = new TextDecoder().decode(bytes);
        throw new Error(`SmartContractPanic: ${msg}`);
      },
      promise_batch_create: (account_id_len, account_id_ptr) => {
        if (this._isView) {
          throw new Error("HostError(ProhibitedInView { method_name: \"promise_batch_create\" })");
        }
        const bytes = new Uint8Array(
          this.instance.exports.memory.buffer,
          Number(account_id_ptr),
          Number(account_id_len)
        );
        const accountId = new TextDecoder().decode(bytes);
        const idx = this.nextPromiseId++;
        this.promises.set(idx, accountId);
        return idx;
      },
      promise_batch_action_transfer: (promise_index, amount_ptr) => {
        if (this._isView) {
          throw new Error("HostError(ProhibitedInView { method_name: \"promise_batch_action_transfer\" })");
        }
        const to = this.promises.get(promise_index);
        const amountBytes = new Uint8Array(this.instance.exports.memory.buffer, Number(amount_ptr), 16);
        const amount = le16ToBigInt(amountBytes);
        this.transfers.push({
          to,
          amount,
          triggered_by: this.current_caller
        });
      },
      promise_batch_action_function_call: (
        promise_index,
        method_name_len,
        method_name_ptr,
        arguments_len,
        arguments_ptr,
        amount_ptr,
        gas
      ) => {
        if (this._isView) {
          throw new Error("HostError(ProhibitedInView { method_name: \"promise_batch_action_function_call\" })");
        }
        const decoder = new TextDecoder();
        const method = decoder.decode(
          new Uint8Array(this.instance.exports.memory.buffer, Number(method_name_ptr), Number(method_name_len))
        );
        const args = decoder.decode(
          new Uint8Array(this.instance.exports.memory.buffer, Number(arguments_ptr), Number(arguments_len))
        );
        const amountBytes = new Uint8Array(this.instance.exports.memory.buffer, Number(amount_ptr), 16);
        this.functionCalls.push({
          to: this.promises.get(promise_index),
          method,
          args,
          deposit: le16ToBigInt(amountBytes),
          gas: BigInt(gas),
          triggered_by: this.current_caller
        });
      }
    };

    this._env = env;
    this.instance = new WebAssembly.Instance(this.wasmModule, { env: this._env });
    this._invoke("init", {}, false);

    // Provide a convenient read-only Map-like view proxy over on-chain circle storage
    this.circles = {
      get: (circle_id) => this.getCircle({ circle_id })
    };
  }

  _invoke(methodName, argsObj = {}, isView = false) {
    this.instance = new WebAssembly.Instance(this.wasmModule, { env: this._env });
    const fn = this.instance.exports[methodName];
    if (typeof fn !== "function") {
      throw new Error(`WASM export '${methodName}' not found.`);
    }

    // Snapshot state for atomic rollback on panic
    const storageSnapshot = new Map(this.storage);
    const transfersLen = this.transfers.length;
    const callsLen = this.functionCalls.length;
    const prevIsView = this._isView;

    this._isView = isView;
    this._returnValue = null;
    this._inputBytes = new TextEncoder().encode(JSON.stringify(argsObj));

    try {
      fn();
      const raw = this._returnValue;
      return raw !== null ? JSON.parse(raw) : null;
    } catch (err) {
      // Atomic rollback on panic
      this.storage = storageSnapshot;
      this.transfers.length = transfersLen;
      this.functionCalls.length = callsLen;
      throw err;
    } finally {
      this._isView = prevIsView;
    }
  }

  setCaller(account_id, deposit = 0n) {
    this.current_caller = account_id;
    this.current_deposit = BigInt(deposit);
  }

  advanceTime(ms) {
    this.mock_time_ms += Number(ms);
  }

  createCircle({ name, contribution_amount, round_duration_ms, total_members, credit = 0, token_id = "" }) {
    const args = {
      name,
      contribution_amount: BigInt(contribution_amount).toString(),
      round_duration_ms: Number(round_duration_ms),
      total_members: Number(total_members)
    };
    if (credit) args.credit = 1;
    if (token_id) args.token_id = token_id;
    return this._invoke("create_circle", args, false);
  }

  joinCircle({ circle_id, credit = 0 }) {
    const args = { circle_id };
    if (credit) args.credit = 1;
    return this._invoke("join_circle", args, false);
  }

  vouch({ circle_id, member_id }) {
    return this._invoke("vouch", { circle_id, member_id }, false);
  }

  ftOnTransfer({ sender_id, amount, msg }) {
    return this._invoke(
      "ft_on_transfer",
      { sender_id, amount: BigInt(amount).toString(), msg },
      false
    );
  }

  nftToken({ token_id }) {
    return this._invoke("nft_token", { token_id }, true);
  }

  nftTransfer() {
    return this._invoke("nft_transfer", { token_id: "unused.near", receiver_id: "other.near" }, false);
  }

  deposit({ circle_id }) {
    return this._invoke("deposit", { circle_id }, false);
  }

  reportDefault({ circle_id, defaulter_id }) {
    return this._invoke("report_default", { circle_id, defaulter_id }, false);
  }

  claimPayout({ circle_id }) {
    return this._invoke("claim_payout", { circle_id }, false);
  }

  init() {
    return this._invoke("init", {}, false);
  }

  cancelPendingCircle({ circle_id }) {
    return this._invoke("cancel_pending_circle", { circle_id }, false);
  }

  leavePendingCircle({ circle_id }) {
    return this._invoke("leave_pending_circle", { circle_id }, false);
  }

  withdrawOnTermination({ circle_id }) {
    return this._invoke("withdraw_on_termination", { circle_id }, false);
  }

  getReputationProfile({ account_id }) {
    const res = this._invoke("get_reputation_profile", { account_id }, true);
    return {
      ...res,
      collateral_slashed_total: BigInt(res.collateral_slashed_total)
    };
  }

  getCircle({ circle_id }) {
    const raw = this._invoke("get_circle", { circle_id }, true);
    if (!raw) return null;
    return this._hydrateCircle(raw);
  }

  getCircles({ from_index = 0, limit = 10 } = {}) {
    const list = this._invoke("get_circles", { from_index, limit }, true);
    return (list || []).map((c) => this._hydrateCircle(c));
  }

  _hydrateCircle(c) {
    const member_collateral = {};
    for (const [k, v] of Object.entries(c.member_collateral || {})) {
      member_collateral[k] = BigInt(v);
    }
    return {
      ...c,
      contribution_amount: BigInt(c.contribution_amount),
      collateral_per_member: BigInt(c.collateral_per_member),
      total_pot: BigInt(c.total_pot),
      member_collateral
    };
  }
}