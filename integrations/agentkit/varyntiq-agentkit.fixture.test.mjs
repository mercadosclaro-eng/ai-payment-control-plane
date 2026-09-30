import assert from "node:assert/strict";
import test from "node:test";
import { createVaryntiqPrePaymentGuard } from "../pre-payment-guard/varyntiq-pre-payment-guard.mjs";

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

function policy(input) {
  if (input.context?.requireApproval) {
    return { decision: "REQUIRE_APPROVAL", reason_codes: ["human_review_required"] };
  }
  const req = input.selected_requirements;
  const matches = req.amount === "20000"
    && req.payTo === selected.payTo
    && req.asset === selected.asset
    && req.network === selected.network
    && req.resource === endpoint;
  return matches
    ? { decision: "ALLOW", reason_codes: ["challenge_bound"] }
    : { decision: "BLOCK", reason_codes: ["challenge_mismatch"] };
}

test("unchanged AgentKit terms allow before signing", async () => {
  let calls = 0;
  const guard = createVaryntiqPrePaymentGuard({ policy: async (input) => policy(input) });
  const result = await guard.beforeSign({
    paymentRequired,
    selectedRequirements: selected,
    context: { integration: "agentkit", endpoint },
    sign: () => { calls += 1; return { mocked: true }; },
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.sign_allowed, true);
  assert.equal(result.sign_called, true);
  assert.equal(calls, 1);
});

test("changed amount or recipient blocks before signing", async () => {
  let calls = 0;
  const guard = createVaryntiqPrePaymentGuard({ policy: async (input) => policy(input) });
  const amount = await guard.beforeSign({
    paymentRequired,
    selectedRequirements: { ...selected, amount: "20001" },
    context: { integration: "agentkit", endpoint },
    sign: () => { calls += 1; },
  });
  const recipient = await guard.beforeSign({
    paymentRequired,
    selectedRequirements: { ...selected, payTo: "0x0000000000000000000000000000000000000001" },
    context: { integration: "agentkit", endpoint },
    sign: () => { calls += 1; },
  });
  assert.equal(amount.decision, "BLOCK");
  assert.equal(recipient.decision, "BLOCK");
  assert.equal(calls, 0);
});

test("approval-required result never reaches signer", async () => {
  let calls = 0;
  const guard = createVaryntiqPrePaymentGuard({ policy: async (input) => policy(input) });
  const result = await guard.beforeSign({
    paymentRequired,
    selectedRequirements: selected,
    context: { integration: "agentkit", endpoint, requireApproval: true },
    sign: () => { calls += 1; },
  });
  assert.equal(result.decision, "REQUIRE_APPROVAL");
  assert.equal(result.sign_allowed, false);
  assert.equal(calls, 0);
});

test("policy failure and invalid input fail closed", async () => {
  const failed = await createVaryntiqPrePaymentGuard({
    policy: async () => { throw new Error("unavailable"); },
  }).evaluate({
    paymentRequired,
    selectedRequirements: selected,
    context: { integration: "agentkit" },
  });
  assert.equal(failed.decision, "BLOCK");
  assert.deepEqual(failed.reason_codes, ["policy_failure"]);

  const invalid = await createVaryntiqPrePaymentGuard({ policy: async () => ({ decision: "ALLOW" }) })
    .evaluate({ paymentRequired, context: { integration: "agentkit" } });
  assert.equal(invalid.decision, "BLOCK");
  assert.deepEqual(invalid.reason_codes, ["invalid_payment_input"]);
});
