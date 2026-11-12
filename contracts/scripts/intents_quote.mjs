import { buildDryQuote, requestDryUsdcQuote } from "../src/intents_quote.mjs";

const offline = process.argv.includes("--offline");
const refundTo = process.argv.find((arg) => arg.startsWith("--refund="))?.slice("--refund=".length) || "orbit.near";
const recipient = process.argv.find((arg) => arg.startsWith("--recipient="))?.slice("--recipient=".length) || refundTo;

if (offline) {
  const body = buildDryQuote({
    refundTo,
    recipient,
    originAsset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    destinationAsset: "nep141:usdc.near",
    amount: "1000000",
    deadline: "2026-11-14T23:59:00.000Z"
  });
  console.log(JSON.stringify(body, null, 2));
  console.log("dry=true. This body does not create a deposit address.");
  process.exit(0);
}

try {
  const result = await requestDryUsdcQuote({ refundTo, recipient });
  console.log(`Quote HTTP ${result.status}`);
  console.log(`From ${result.origin.blockchain} USDC (${result.origin.assetId})`);
  console.log(`To ${result.destination.blockchain} USDC (${result.destination.assetId})`);
  console.log(`dry=${result.body.dry} refundTo=${result.body.refundTo} recipient=${result.body.recipient}`);
  console.log(`amountIn=${result.quote.quote?.amountIn || result.quote.amountIn || "n/a"}`);
  console.log(`amountOut=${result.quote.quote?.amountOut || result.quote.amountOut || "n/a"}`);
  const depositAddress = result.quote.quote?.depositAddress || result.quote.depositAddress;
  console.log(`depositAddress=${depositAddress || "absent"}`);
  if (!result.body.dry || result.status >= 400) {
    console.log(JSON.stringify(result.quote, null, 2));
    process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
