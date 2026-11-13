// Dry NEAR Intents quote. dry:true asks 1Click for a price and does not create a deposit address.

const QUOTE_URL = "https://1click.chaindefuser.com/v0/quote";
const TOKENS_URL = "https://1click.chaindefuser.com/v0/tokens";

export function buildDryQuote({
  refundTo,
  recipient,
  originAsset,
  destinationAsset,
  amount,
  deadline
}) {
  if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) {
    throw new Error("amount must be an integer string in base units");
  }
  return {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset,
    amount,
    recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline
  };
}

function tokenList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.tokens)) return payload.tokens;
  return [];
}

const EVM_ORIGIN_CHAINS = new Set(["eth", "ethereum", "arb", "arbitrum", "base", "op", "optimism", "pol", "polygon", "bsc", "avax"]);

export function pickUsdcPair(tokens) {
  const list = tokenList(tokens);
  const usdc = list.filter((token) => String(token.symbol || "").toUpperCase() === "USDC" && token.assetId);
  const onNear = usdc.find((token) => String(token.blockchain || "").toLowerCase() === "near");
  const abroad =
    usdc.find((token) => EVM_ORIGIN_CHAINS.has(String(token.blockchain || "").toLowerCase())) ||
    usdc.find((token) => String(token.blockchain || "").toLowerCase() !== "near");
  if (!onNear || !abroad) {
    throw new Error("USDC on NEAR and USDC on another chain were not both in the token list");
  }
  return { origin: abroad, destination: onNear };
}

// A checksummed origin-chain address. 1Click rejects non-checksum refunds. dry:true does not send funds.
const EVM_REFUND = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

export async function requestDryUsdcQuote({ refundTo, recipient, amount = "1000000" }) {
  const tokensRes = await fetch(TOKENS_URL);
  if (!tokensRes.ok) {
    throw new Error(`Token list failed (${tokensRes.status})`);
  }
  const pair = pickUsdcPair(await tokensRes.json());
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  // refundTo must be an address on the origin chain. ETH USDC refunds to an EVM address.
  const originRefund = String(pair.origin.blockchain).toLowerCase() === "near" ? refundTo : EVM_REFUND;
  const body = buildDryQuote({
    refundTo: originRefund,
    recipient,
    originAsset: pair.origin.assetId,
    destinationAsset: pair.destination.assetId,
    amount,
    deadline
  });
  const quoteRes = await fetch(QUOTE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const quote = await quoteRes.json();
  return { body, status: quoteRes.status, quote, origin: pair.origin, destination: pair.destination };
}
