import assert from "node:assert/strict";
import test from "node:test";
import { createVaryntiqPrePaymentGuard } from "./varyntiq-pre-payment-guard.mjs";

const paymentRequired = {
  resource: "https://seller.example.test/weather",
  accepts: [{ amount: "10", payTo: "0xabc", network: "eip155:8453", asset: "USDC" }],
};
const selectedRequirements = { amount: "10", payTo: "0xabc", network: "eip155:8453", asset: "USDC" };
const context = { agent_id: "agent-demo", purpose: "weather_lookup" };

function fixed(decision, reason_codes = []) {
  return createVaryntiqPrePaymentGuard({ policy: async () => ({ decision, reason_codes }) });
}

test("binds the digest to the selected PaymentRequirements entry", async () => {
  const guard = fixed("ALLOW");
  const one = await guard.evaluate({ paymentRequired, selectedRequirements, context });
  const two = await guard.evaluate({ paymentRequired, selectedRequirements: { ...selectedRequirements, amount: "11" }, context });
  assert.match(one.request_digest, /^[a-f0-9]{64}$/);
  assert.notEqual(one.request_digest, two.request_digest);
  assert.equal(one.decision, "ALLOW");
  assert.equal(one.sign_allowed, true);
});

test("only ALLOW reaches the signer", async () => {
  let signCalls = 0;
  const sign = async (input) => { signCalls += 1; return { digest: input.requestDigest }; };
  const allowed = await fixed("ALLOW").beforeSign({ paymentRequired, selectedRequirements, context, sign });
  assert.equal(allowed.sign_called, true);
  assert.equal(signCalls, 1);

  for (const decision of ["BLOCK", "REQUIRE_APPROVAL"]) {
    const result = await fixed(decision, [decision.toLowerCase()]).beforeSign({ paymentRequired, selectedRequirements, context, sign });
    assert.equal(result.decision, decision);
    assert.equal(result.sign_allowed, false);
    assert.equal(result.sign_called, undefined);
  }
  assert.equal(signCalls, 1);
});

test("changed selected requirements fail closed before signing", async () => {
  let signCalls = 0;
  const first = await fixed("ALLOW").evaluate({ paymentRequired, selectedRequirements, context });
  const result = await fixed("ALLOW").beforeSign({
    approvedRequestDigest: first.request_digest,
    paymentRequired,
    selectedRequirements: { ...selectedRequirements, payTo: "0xdef" },
    context,
    sign: async () => { signCalls += 1; },
  });
  assert.deepEqual(result.decision, "BLOCK");
  assert.deepEqual(result.reason_codes, ["payment_requirements_changed"]);
  assert.equal(result.sign_allowed, false);
  assert.equal(signCalls, 0);
});

test("missing selection, policy failures and malformed decisions are recorded and blocked", async () => {
  const missing = await fixed("ALLOW").evaluate({ paymentRequired, context });
  assert.deepEqual(missing, { version: "varyntiq-pre-payment-decision-v1", decision: "BLOCK", reason_codes: ["invalid_payment_input"], request_digest: null, sign_allowed: false });

  const failed = await createVaryntiqPrePaymentGuard({ policy: async () => { throw new Error("offline"); } }).evaluate({ paymentRequired, selectedRequirements, context });
  assert.deepEqual(failed.reason_codes, ["policy_failure"]);
  assert.match(failed.request_digest, /^[a-f0-9]{64}$/);

  const malformed = await createVaryntiqPrePaymentGuard({ policy: async () => ({ decision: "MAYBE" }) }).evaluate({ paymentRequired, selectedRequirements, context });
  assert.deepEqual(malformed.reason_codes, ["malformed_decision"]);
  assert.equal(malformed.sign_allowed, false);
});

test("receipt records the exact request digest and reason codes", async () => {
  const result = await fixed("REQUIRE_APPROVAL", ["approval_required", "daily_cap"]).evaluate({ paymentRequired, selectedRequirements, context });
  assert.equal(result.version, "varyntiq-pre-payment-decision-v1");
  assert.deepEqual(result.reason_codes, ["approval_required", "daily_cap"]);
  assert.equal(result.sign_allowed, false);
  assert.match(result.request_digest, /^[a-f0-9]{64}$/);
});

test("the signer receives the same detached terms that were evaluated", async () => {
  const original = {
    paymentRequired: structuredClone(paymentRequired),
    selectedRequirements: structuredClone(selectedRequirements),
    context: structuredClone(context),
  };
  let policyInput;
  let signerInput;
  const guard = createVaryntiqPrePaymentGuard({
    policy: async (input) => {
      policyInput = input;
      // A policy plugin must not be able to rewrite the canonical snapshot.
      input.payment_required.accepts[0].payTo = "0xattacker";
      input.selected_requirements.payTo = "0xattacker";
      input.context.purpose = "tampered";
      return { decision: "ALLOW" };
    },
  });

  const result = await guard.beforeSign({
    ...original,
    sign: (input) => {
      signerInput = input;
      return { signed: true };
    },
  });

  assert.equal(result.sign_called, true);
  assert.equal(policyInput.selected_requirements.payTo, "0xattacker");
  assert.equal(signerInput.selectedRequirements.payTo, original.selectedRequirements.payTo);
  assert.equal(signerInput.paymentRequired.accepts[0].payTo, original.paymentRequired.accepts[0].payTo);
  assert.equal(signerInput.context.purpose, original.context.purpose);
  assert.equal(signerInput.requestDigest, result.request_digest);
});

test("caller mutations while policy is pending cannot alter the signed terms", async () => {
  const mutablePaymentRequired = structuredClone(paymentRequired);
  const mutableSelectedRequirements = structuredClone(selectedRequirements);
  const mutableContext = structuredClone(context);
  let releasePolicy;
  const policyPending = new Promise((resolve) => { releasePolicy = resolve; });
  let signerInput;
  const guard = createVaryntiqPrePaymentGuard({
    policy: async () => {
      await policyPending;
      return { decision: "ALLOW" };
    },
  });

  const operation = guard.beforeSign({
    paymentRequired: mutablePaymentRequired,
    selectedRequirements: mutableSelectedRequirements,
    context: mutableContext,
    sign: (input) => { signerInput = input; return { signed: true }; },
  });
  mutablePaymentRequired.accepts[0].amount = "999999";
  mutableSelectedRequirements.amount = "999999";
  mutableContext.purpose = "tampered";
  releasePolicy();
  const result = await operation;

  assert.equal(result.sign_called, true);
  assert.equal(signerInput.paymentRequired.accepts[0].amount, "10");
  assert.equal(signerInput.selectedRequirements.amount, "10");
  assert.equal(signerInput.context.purpose, "weather_lookup");
});

