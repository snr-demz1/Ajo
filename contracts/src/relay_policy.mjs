// Gasless deposit policy. The relayer pays gas and refuses every other method.

export function evaluateRelay({ receiverId, methodName, args, orbitContractId, stablecoinId }) {
  if (methodName === "deposit" && receiverId === orbitContractId) {
    return { ok: true, reason: "NEAR round deposit on the Ajo contract" };
  }
  if (methodName === "ft_transfer_call" && receiverId === stablecoinId) {
    const msg = args && typeof args.msg === "string" ? args.msg : "";
    if (!msg.startsWith("deposit:")) {
      return { ok: false, reason: "relayer only sponsors deposit messages on the stablecoin" };
    }
    if (!args || args.receiver_id !== orbitContractId) {
      return { ok: false, reason: "relayer only sponsors ft_transfer_call targeting the Ajo contract" };
    }
    return { ok: true, reason: "stablecoin round deposit" };
  }
  return { ok: false, reason: `relayer refuses ${methodName || "unknown method"}` };
}

export const RELAY_FIXTURES = [
  {
    name: "orbit deposit",
    action: { receiverId: "orbit.testnet", methodName: "deposit", args: { circle_id: "circle_1" } },
    ok: true
  },
  {
    name: "stablecoin deposit message",
    action: {
      receiverId: "usdc.testnet",
      methodName: "ft_transfer_call",
      args: { receiver_id: "orbit.testnet", amount: "1000000", msg: "deposit:circle_1" }
    },
    ok: true
  },
  {
    name: "collateral message",
    action: {
      receiverId: "usdc.testnet",
      methodName: "ft_transfer_call",
      args: { msg: "collateral:circle_1" }
    },
    ok: false
  },
  {
    name: "vouch",
    action: { receiverId: "orbit.testnet", methodName: "vouch", args: {} },
    ok: false
  },
  {
    name: "claim payout",
    action: { receiverId: "orbit.testnet", methodName: "claim_payout", args: {} },
    ok: false
  }
];
