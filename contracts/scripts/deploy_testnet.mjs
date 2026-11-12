/**
 * Ajo — Live NEAR Testnet Deployment & On-Chain Verification Script
 *
 * 1. Provisions Testnet accounts via NEAR Testnet Helper (https://helper.testnet.near.org/account)
 * 2. Deploys compiled `contracts/build/orbit_contract.wasm` to NEAR Testnet
 * 3. Calls `init`, `create_circle`, `join_circle`, `deposit`, and `claim_payout` on-chain
 * 4. Verifies live read-only `@view` calls (`get_circles`, `get_reputation_profile`)
 * 5. Writes public deployment metadata & Explorer transaction hashes to `contracts/testnet_deployment.json`
 *    (Private keys are NEVER written to any tracked file.)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, teraToGas, nearToYocto } from "near-api-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.resolve(__dirname, "../build/orbit_contract.wasm");
const DEPLOYMENT_JSON_PATH = path.resolve(__dirname, "../testnet_deployment.json");

const RPC_URL = "https://rpc.testnet.near.org";
const HELPER_URL = "https://helper.testnet.near.org/account";

async function createTestnetAccount(accountId) {
  const keyPair = KeyPair.fromRandom("ed25519");
  const publicKey = keyPair.getPublicKey().toString();

  const res = await fetch(HELPER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: publicKey
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create testnet account ${accountId} (${res.status}): ${errText}`);
  }

  // Wait briefly for finality
  await new Promise((r) => setTimeout(r, 1500));
  return {
    accountId,
    publicKey,
    secretKey: keyPair.toString(),
    account: new Account(accountId, RPC_URL, keyPair.toString())
  };
}

function getTxHash(outcome) {
  return outcome?.transaction_outcome?.id || outcome?.transaction?.hash || "unknown";
}

async function main() {
  console.log("=== AJO: LIVE NEAR TESTNET DEPLOYMENT ===");

  if (!fs.existsSync(WASM_PATH)) {
    throw new Error(`WASM binary not found at ${WASM_PATH}. Run 'npm --prefix contracts run build' first.`);
  }
  const wasmBytes = fs.readFileSync(WASM_PATH);
  console.log(`Loaded compiled WASM binary (${wasmBytes.length} bytes).`);

  const suffix = Math.floor(10000 + Math.random() * 89999);
  const contractId = `ajo-${suffix}.testnet`;
  const aliceId = `alice-ajo-${suffix}.testnet`;
  const bobId = `bob-ajo-${suffix}.testnet`;

  console.log(`1. Creating Testnet accounts via ${HELPER_URL}...`);
  const contractAcc = await createTestnetAccount(contractId);
  console.log(`   Created contract account: ${contractId}`);
  const aliceAcc = await createTestnetAccount(aliceId);
  console.log(`   Created participant Alice: ${aliceId}`);
  const bobAcc = await createTestnetAccount(bobId);
  console.log(`   Created participant Bob:   ${bobId}`);

  console.log(`2. Deploying orbit_contract.wasm to ${contractId}...`);
  const deployOutcome = await contractAcc.account.deployContract(wasmBytes);
  const deployTx = getTxHash(deployOutcome);
  console.log(`   Deployed WASM! Tx: https://testnet.nearblocks.io/txns/${deployTx}`);

  console.log(`3. Initializing contract state (init)...`);
  const initOutcome = await contractAcc.account.callFunctionRaw({
    contractId,
    methodName: "init",
    args: {},
    gas: teraToGas("30")
  });
  const initTx = getTxHash(initOutcome);
  console.log(`   Initialized! Tx: https://testnet.nearblocks.io/txns/${initTx}`);

  const ONE_NEAR = nearToYocto("1");

  console.log(`4. Alice creating Circle #1 ("Lagos Tech Founders Ajo", 1 NEAR contribution, 1 NEAR collateral)...`);
  const create1Outcome = await aliceAcc.account.callFunctionRaw({
    contractId,
    methodName: "create_circle",
    args: {
      name: "Lagos Tech Founders Ajo",
      contribution_amount: ONE_NEAR.toString(),
      round_duration_ms: 86400000,
      total_members: 2
    },
    deposit: ONE_NEAR,
    gas: teraToGas("50")
  });
  const create1Tx = getTxHash(create1Outcome);
  console.log(`   Circle #1 created! Tx: https://testnet.nearblocks.io/txns/${create1Tx}`);

  console.log(`5. Bob joining Circle #1 (staked 1 NEAR collateral -> activates Circle #1)...`);
  const join1Outcome = await bobAcc.account.callFunctionRaw({
    contractId,
    methodName: "join_circle",
    args: { circle_id: "circle_1" },
    deposit: ONE_NEAR,
    gas: teraToGas("50")
  });
  const join1Tx = getTxHash(join1Outcome);
  console.log(`   Bob joined Circle #1! Tx: https://testnet.nearblocks.io/txns/${join1Tx}`);

  console.log(`6. Alice & Bob depositing Round 1 contributions (1 NEAR each) into Circle #1...`);
  const dep1AliceOutcome = await aliceAcc.account.callFunctionRaw({
    contractId,
    methodName: "deposit",
    args: { circle_id: "circle_1" },
    deposit: ONE_NEAR,
    gas: teraToGas("50")
  });
  const dep1AliceTx = getTxHash(dep1AliceOutcome);
  console.log(`   Alice deposited R1! Tx: https://testnet.nearblocks.io/txns/${dep1AliceTx}`);

  const dep1BobOutcome = await bobAcc.account.callFunctionRaw({
    contractId,
    methodName: "deposit",
    args: { circle_id: "circle_1" },
    deposit: ONE_NEAR,
    gas: teraToGas("50")
  });
  const dep1BobTx = getTxHash(dep1BobOutcome);
  console.log(`   Bob deposited R1! Tx: https://testnet.nearblocks.io/txns/${dep1BobTx}`);

  console.log(`7. Executing permissionless claim_payout on Circle #1 Round 1...`);
  const claim1Outcome = await contractAcc.account.callFunctionRaw({
    contractId,
    methodName: "claim_payout",
    args: { circle_id: "circle_1" },
    deposit: 0n,
    gas: teraToGas("80")
  });
  const claim1Tx = getTxHash(claim1Outcome);
  console.log(`   Round 1 Pot Disbursed! Tx: https://testnet.nearblocks.io/txns/${claim1Tx}`);

  console.log(`8. Creating Circle #2 ("Nairobi Susu Savings") & depositing Round 1 for Alice...`);
  const create2Outcome = await aliceAcc.account.callFunctionRaw({
    contractId,
    methodName: "create_circle",
    args: {
      name: "Nairobi Susu Savings",
      contribution_amount: ONE_NEAR.toString(),
      round_duration_ms: 86400000,
      total_members: 2
    },
    deposit: ONE_NEAR,
    gas: teraToGas("50")
  });
  const create2Tx = getTxHash(create2Outcome);

  const join2Outcome = await bobAcc.account.callFunctionRaw({
    contractId,
    methodName: "join_circle",
    args: { circle_id: "circle_2" },
    deposit: ONE_NEAR,
    gas: teraToGas("50")
  });
  const join2Tx = getTxHash(join2Outcome);

  const dep2AliceOutcome = await aliceAcc.account.callFunctionRaw({
    contractId,
    methodName: "deposit",
    args: { circle_id: "circle_2" },
    deposit: ONE_NEAR,
    gas: teraToGas("50")
  });
  const dep2AliceTx = getTxHash(dep2AliceOutcome);
  console.log(`   Circle #2 active with 1/2 deposits settled! Tx: https://testnet.nearblocks.io/txns/${dep2AliceTx}`);

  console.log(`9. Verifying on-chain @view methods via ${RPC_URL}...`);
  async function callNearView(methodName, argsObj) {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "orbit-view",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: contractId,
          method_name: methodName,
          args_base64: Buffer.from(JSON.stringify(argsObj)).toString("base64")
        }
      })
    });
    const json = await res.json();
    const bytes = new Uint8Array(json.result.result);
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  }
  const circlesOnChain = await callNearView("get_circles", { from_index: 0, limit: 10 });
  const aliceRepOnChain = await callNearView("get_reputation_profile", { account_id: aliceId });
  const bobRepOnChain = await callNearView("get_reputation_profile", { account_id: bobId });

  console.log("   Live Circles on NEAR Testnet:", JSON.stringify(circlesOnChain, null, 2));
  console.log("   Alice Reputation Profile:", JSON.stringify(aliceRepOnChain));
  console.log("   Bob Reputation Profile:", JSON.stringify(bobRepOnChain));

  const deploymentManifest = {
    network: "testnet",
    rpc_url: RPC_URL,
    contract_id: contractId,
    explorer_account_url: `https://testnet.nearblocks.io/address/${contractId}`,
    deployed_at: new Date().toISOString(),
    participants: {
      alice: aliceId,
      bob: bobId
    },
    transactions: {
      deploy_wasm: {
        hash: deployTx,
        explorer_url: `https://testnet.nearblocks.io/txns/${deployTx}`
      },
      init: {
        hash: initTx,
        explorer_url: `https://testnet.nearblocks.io/txns/${initTx}`
      },
      create_circle_1: {
        hash: create1Tx,
        explorer_url: `https://testnet.nearblocks.io/txns/${create1Tx}`
      },
      join_circle_1: {
        hash: join1Tx,
        explorer_url: `https://testnet.nearblocks.io/txns/${join1Tx}`
      },
      deposit_circle_1_alice: {
        hash: dep1AliceTx,
        explorer_url: `https://testnet.nearblocks.io/txns/${dep1AliceTx}`
      },
      deposit_circle_1_bob: {
        hash: dep1BobTx,
        explorer_url: `https://testnet.nearblocks.io/txns/${dep1BobTx}`
      },
      claim_payout_circle_1_round_1: {
        hash: claim1Tx,
        explorer_url: `https://testnet.nearblocks.io/txns/${claim1Tx}`
      },
      create_circle_2: {
        hash: create2Tx,
        explorer_url: `https://testnet.nearblocks.io/txns/${create2Tx}`
      },
      join_circle_2: {
        hash: join2Tx,
        explorer_url: `https://testnet.nearblocks.io/txns/${join2Tx}`
      },
      deposit_circle_2_alice: {
        hash: dep2AliceTx,
        explorer_url: `https://testnet.nearblocks.io/txns/${dep2AliceTx}`
      }
    },
    verified_state_snapshot: {
      circles: circlesOnChain,
      reputation_profiles: {
        [aliceId]: aliceRepOnChain,
        [bobId]: bobRepOnChain
      }
    }
  };

  fs.writeFileSync(DEPLOYMENT_JSON_PATH, JSON.stringify(deploymentManifest, null, 2));
  console.log(`\nSaved public deployment manifest to ${DEPLOYMENT_JSON_PATH}`);
  console.log("=== LIVE TESTNET DEPLOYMENT COMPLETE ===");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
