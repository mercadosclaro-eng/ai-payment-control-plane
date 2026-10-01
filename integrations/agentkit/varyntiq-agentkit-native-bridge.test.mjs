import assert from "node:assert/strict";
import test from "node:test";
import { createVaryntiqPrePaymentGuard } from "../pre-payment-guard/varyntiq-pre-payment-guard.mjs";
import { createVaryntiqAgentKitNativeBridge } from "./varyntiq-agentkit-native-bridge.mjs";

const endpoint = "https://api.automaton-sovereign.workers.dev/v2/firewall/simulate-tx";
const selected = {
  scheme: "exact",
  network: "eip155:8453",
  chainId: 8453,
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x71DEAc098914A009E3720524642A6bE6F65EE528",
  amount: "20000",
  maxTimeoutSeconds: 60,
  resource: endpoint,
  extra: { name: "USD Coin", version: "2" },
};
const paymentRequired = { x402Version: 2, resource: endpoint, accepts: [selected] };
const args = { targetContract: "0x0000000000000000000000000000000000000001", calldata: "0x" };

function makeGuard() {
  return createVaryntiqPrePaymentGuard({
    policy: async ({ selected_requirements: req, context }) => {
      if (context.requireApproval) {
        return { decision: "REQUIRE_APPROVAL", reason_codes: ["human_review_required"] };
      }
      const matches = req.amount === "20000"
        && req.payTo === selected.payTo
        && req.asset === selected.asset
        && req.network === selected.network
        && req.resource === endpoint;
      return matches
        ? { decision: "ALLOW", reason_codes: ["challenge_bound"] }
        : { decision: "BLOCK", reason_codes: ["challenge_mismatch"] };
    },
  });
}

function makeBridge(calls) {
  return createVaryntiqAgentKitNativeBridge({
    guard: makeGuard(),
    nativeAction: async (input) => {
      calls.push(input);
      return { provider: "agentkit-native", verdict: "SAFE" };
    },
  });
}

const baseInput = {
  wallet: { name: "mock-wallet" },
  args,
  paymentRequired,
  selectedRequirements: selected,
  resource: endpoint,
  context: { test: true },
};

test("native AgentKit action runs only after Varyntiq ALLOW", async () => {
  const calls = [];
  const result = await makeBridge(calls)(baseInput);
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.sign_called, true);
  assert.deepEqual(result.signed, { provider: "agentkit-native", verdict: "SAFE" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, args);
  assert.deepEqual(calls[0].wallet, baseInput.wallet);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["args", "wallet"]);
});

test("guard output is not injected into AgentKit's strict native action input", async () => {
  const calls = [];
  const bridge = createVaryntiqAgentKitNativeBridge({
    guard: {
      beforeSign: async ({ sign }) => ({
        decision: "ALLOW",
        sign_allowed: true,
        sign_called: true,
        signed: await sign({
          validAfter: 1,
          validBefore: 2,
          nonce: "guard-only",
          from: "0xfrom",
          to: "0xto",
          value: "20000",
        }),
      }),
    },
    nativeAction: async (input) => {
      calls.push(input);
      return { ok: true };
    },
  });

  await bridge(baseInput);
  assert.deepEqual(calls, [{ wallet: baseInput.wallet, args: baseInput.args }]);
});

test("changed x402 terms block before the native action", async () => {
  const calls = [];
  const result = await makeBridge(calls)({
    ...baseInput,
    selectedRequirements: { ...selected, amount: "20001" },
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.sign_allowed, false);
  assert.equal(calls.length, 0);
});

test("human approval requirement blocks native invocation", async () => {
  const calls = [];
  const result = await makeBridge(calls)({
    ...baseInput,
    context: { requireApproval: true },
  });
  assert.equal(result.decision, "REQUIRE_APPROVAL");
  assert.equal(result.sign_allowed, false);
  assert.equal(calls.length, 0);
});

test("an approval digest from another request fails closed", async () => {
  const calls = [];
  const result = await makeBridge(calls)({
    ...baseInput,
    approvedRequestDigest: "digest-for-a-different-request",
  });
  assert.equal(result.decision, "BLOCK");
  assert.deepEqual(result.reason_codes, ["payment_requirements_changed"]);
  assert.equal(calls.length, 0);
});
