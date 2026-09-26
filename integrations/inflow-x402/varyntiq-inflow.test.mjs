import assert from "node:assert/strict";
import test from "node:test";
import { createVaryntiqInflowHook } from "./varyntiq-inflow.mjs";

const hookContext = {
  paymentRequired: { resource: { url: "https://merchant.example/pay" } },
  selectedRequirements: {
    amount: "1250000",
    payTo: "0x1111111111111111111111111111111111111111",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4C7C32D4f71b54Bda02913",
    extra: { name: "USDC" },
  },
};

function makeHook(decision, inspect = () => {}) {
  return createVaryntiqInflowHook({
    token: "client-token",
    agentId: "inflow-buyer-1",
    contextFor: () => ({ purpose: "purchase approved dataset" }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      inspect(body, init);
      return {
        ok: true,
        async json() {
          return { intent_id: body.intent_id, decision, receipt_id: "receipt-1" };
        },
      };
    },
  });
}

test("allows InFlow signing only after an explicit matching ALLOW", async () => {
  const result = await makeHook("ALLOW", (body, init) => {
    assert.equal(body.amount_minor, 1250000);
    assert.equal(body.endpoint, "https://merchant.example/pay");
    assert.equal(body.context.integration, "inflow-x402-buyer");
    assert.equal(init.headers.authorization, "Bearer client-token");
  })(hookContext);
  assert.deepEqual(result, { abort: false });
});

test("aborts BLOCK and REQUIRE_APPROVAL before signing", async () => {
  assert.equal((await makeHook("BLOCK")(hookContext)).abort, true);
  assert.equal((await makeHook("REQUIRE_APPROVAL")(hookContext)).abort, true);
});

test("fails closed on network and receipt errors", async () => {
  const offline = createVaryntiqInflowHook({
    token: "client-token",
    agentId: "inflow-buyer-1",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal((await offline(hookContext)).abort, true);

  const mismatch = createVaryntiqInflowHook({
    token: "client-token",
    agentId: "inflow-buyer-1",
    fetchImpl: async () => ({
      ok: true,
      async json() { return { intent_id: "different", decision: "ALLOW" }; },
    }),
  });
  assert.equal((await mismatch(hookContext)).abort, true);
});

test("fails closed when the selected payment requirement is incomplete", async () => {
  const result = await makeHook("ALLOW")({ paymentRequired: hookContext.paymentRequired });
  assert.equal(result.abort, true);
});

test("fails closed when custom context is malformed", async () => {
  const hook = createVaryntiqInflowHook({
    token: "client-token",
    agentId: "inflow-buyer-1",
    contextFor: () => "invalid",
    fetchImpl: async () => { throw new Error("must not be called"); },
  });
  assert.equal((await hook(hookContext)).abort, true);
});
