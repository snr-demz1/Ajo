import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateRelay, RELAY_FIXTURES } from "../src/relay_policy.mjs";
import { buildDryQuote, pickUsdcPair } from "../src/intents_quote.mjs";

describe("Ajo winning-path checks", () => {
  it("22. [Gasless relay] sponsors round deposits and refuses collateral, vouch, and payout", () => {
    for (const fixture of RELAY_FIXTURES) {
      const result = evaluateRelay({
        ...fixture.action,
        orbitContractId: "orbit.testnet",
        stablecoinId: "usdc.testnet"
      });
      assert.equal(result.ok, fixture.ok, fixture.name);
    }
  });

  it("23. [Intents] dry quote body cannot create a deposit address", () => {
    const body = buildDryQuote({
      refundTo: "orbit.near",
      recipient: "orbit.near",
      originAsset: "nep141:arb-usdc.omft.near",
      destinationAsset: "nep141:usdc.near",
      amount: "1000000",
      deadline: "2026-11-14T23:59:00.000Z"
    });
    assert.equal(body.dry, true);
    assert.equal(body.swapType, "EXACT_INPUT");
    assert.equal(body.amount, "1000000");
    assert.equal("depositAddress" in body, false);
    assert.throws(() => buildDryQuote({ ...body, amount: "1.5" }), /integer string/);
  });

  it("picks USDC on NEAR as the destination and a foreign USDC as the origin", () => {
    const pair = pickUsdcPair([
      { symbol: "USDC", blockchain: "near", assetId: "nep141:usdc.near" },
      { symbol: "USDC", blockchain: "arb", assetId: "nep141:arb-usdc.omft.near" },
      { symbol: "NEAR", blockchain: "near", assetId: "nep141:wrap.near" }
    ]);
    assert.equal(pair.destination.blockchain, "near");
    assert.equal(pair.origin.blockchain, "arb");
  });

  it("refuses gasless relay when ft_transfer_call deposit targets wrong receiver_id", () => {
    const result = evaluateRelay({
      receiverId: "usdc.testnet",
      methodName: "ft_transfer_call",
      args: {
        receiver_id: "attacker.testnet",
        amount: "1000000",
        msg: "deposit:circle_1"
      },
      orbitContractId: "orbit.testnet",
      stablecoinId: "usdc.testnet"
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /targeting the Ajo contract/);
  });

  it("prefers EVM USDC origin chains ahead of non-EVM chains when both are present", () => {
    const pair = pickUsdcPair([
      { symbol: "USDC", blockchain: "near", assetId: "nep141:usdc.near" },
      { symbol: "USDC", blockchain: "sol", assetId: "nep141:sol-usdc.omft.near" },
      { symbol: "USDC", blockchain: "arb", assetId: "nep141:arb-usdc.omft.near" }
    ]);
    assert.equal(pair.destination.blockchain, "near");
    assert.equal(pair.origin.blockchain, "arb");
  });
});
