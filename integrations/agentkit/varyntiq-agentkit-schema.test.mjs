import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createVaryntiqPrePaymentGuard } from "../pre-payment-guard/varyntiq-pre-payment-guard.mjs";
import { createVaryntiqAgentKitNativeBridge } from "./varyntiq-agentkit-native-bridge.mjs";

// Exact upstream schema, not a locally reconstructed validator. See README.
assert.ok(process.env.AGENTKIT_SCHEMA_PATH, "Set AGENTKIT_SCHEMA_PATH to the pinned upstream schema");
const schemaPath = resolve(process.env.AGENTKIT_SCHEMA_PATH);
const source = await readFile(schemaPath);
const blob = createHash("sha1").update("blob " + source.length + "\0").update(source).digest("hex");
assert.equal(blob, "566ddacb9edb350b51353e74e4d16e0271f2b95d", "Upstream schema bytes changed");
const { SimulateAndGuardInputSchema: schema } = await import(pathToFileURL(schemaPath).href);

const address = "0x0000000000000000000000000000000000000001";
const raw = { targetContract: address, calldata: null, fromAddress: null, valueWei: null, tokenAddress: null };
const resource = "https://example.invalid/schema-conformance";
const selected = { scheme: "exact", network: "eip155:8453", asset: address, payTo: address, amount: "1", maxTimeoutSeconds: 60, resource };
const wallet = Object.freeze({ name: "non-signing-test-double" });

async function invoke(input, decision = "ALLOW") {
  const calls = [];
  let policyCalls = 0;
  const guard = createVaryntiqPrePaymentGuard({
    policy: async () => { policyCalls++; return { decision, reason_codes: ["schema_fixture"] }; },
  });
  const bridge = createVaryntiqAgentKitNativeBridge({
    guard,
    nativeAction: async (payload) => {
      // Validate again at the observed boundary to catch field contamination.
      schema.parse(payload.args);
      assert.deepEqual(Object.keys(payload).sort(), ["args", "wallet"]);
      calls.push(payload);
      return { mocked: true };
    },
  });
  try {
    // Caller validation is explicit; the bridge itself does not parse provider arguments.
    const args = schema.parse(input);
    const result = await bridge({ wallet, args, resource, selectedRequirements: selected,
      paymentRequired: { x402Version: 2, resource, accepts: [selected] } });
    return { result, calls, policyCalls };
  } catch (error) { return { error, calls, policyCalls }; }
}

test("real strict schema: five required fields with explicit nulls parse before ALLOW and native invocation", async () => {
  const out = await invoke(raw);
  assert.equal(out.error, undefined);
  assert.equal(out.result.decision, "ALLOW");
  assert.equal(out.calls.length, 1);
  assert.deepEqual(out.calls[0].args, { ...raw, calldata: "0x", valueWei: "0" });
  assert.equal(out.calls[0].wallet, wallet);
});
test("real strict schema: all five populated fields pass unchanged", async () => {
  const input = { targetContract: address, calldata: "0x1234", fromAddress: address, valueWei: "12", tokenAddress: address };
  const out = await invoke(input);
  assert.equal(out.error, undefined);
  assert.equal(out.calls.length, 1);
  assert.deepEqual(out.calls[0].args, input);
});
for (const key of Object.keys(raw)) {
  test("missing required key " + key + " prevents policy and native invocation", async () => {
    const input = { ...raw }; delete input[key];
    const out = await invoke(input);
    assert.ok(out.error);
    assert.ok(out.error.issues.some(issue => issue.path[0] === key));
    assert.equal(out.policyCalls, 0);
    assert.equal(out.calls.length, 0);
  });
}
for (const input of [
  { ...raw, validAfter: 1, validBefore: 2, nonce: "guard-only" },
  { ...raw, from: address, to: address, value: "1" },
  { wallet, args: raw },
  { ...raw, targetContract: "invalid-address" },
]) {
  test("invalid or contaminated input rejected: " + JSON.stringify(input), async () => {
    const out = await invoke(input);
    assert.ok(out.error);
    assert.equal(out.policyCalls, 0);
    assert.equal(out.calls.length, 0);
  });
}
for (const decision of ["BLOCK", "REQUIRE_APPROVAL"]) {
  test("real-schema-valid input still cannot invoke native action on " + decision, async () => {
    const out = await invoke(raw, decision);
    assert.equal(out.error, undefined);
    assert.equal(out.result.decision, decision);
    assert.equal(out.result.sign_allowed, false);
    assert.equal(out.calls.length, 0);
  });
}
