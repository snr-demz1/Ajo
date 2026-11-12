import { evaluateRelay, RELAY_FIXTURES } from "../src/relay_policy.mjs";

const orbitContractId = "orbit.testnet";
const stablecoinId = "usdc.testnet";

let failed = 0;
for (const fixture of RELAY_FIXTURES) {
  const result = evaluateRelay({
    ...fixture.action,
    orbitContractId,
    stablecoinId
  });
  const pass = result.ok === fixture.ok;
  if (!pass) failed += 1;
  console.log(`${pass ? "ok" : "FAIL"}  ${fixture.name}: ${result.reason}`);
}

if (failed > 0) {
  console.error(`Relay policy check failed (${failed}).`);
  process.exit(1);
}
console.log("Relay policy check passed. Only round deposits are sponsored.");
