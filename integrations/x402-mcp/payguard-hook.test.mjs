import assert from "node:assert/strict";
import test from "node:test";
import { createPayGuardPaymentHook } from "./payguard-hook.mjs";

const baseRequest = {
  toolName: "get_weather",
  paymentRequired: {
    resource: { url: "https://merchant.example/weather" },
    accepts: [{
      amount: "1000",
      payTo: "0x1111111111111111111111111111111111111111",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4C7C32D4f71b54Bda02913",
      extra: { name: "USDC" },
    }],
  },
};

function response(decision, requestBody) {
  return {
    ok: true,
    async json() {
      return { intent_id: requestBody.intent_id, decision, receipt_id: "receipt-1" };
    },
  };
}

function makeHook(decision = "ALLOW", inspect = () => {}) {
  return createPayGuardPaymentHook({
    token: "test-token",
    agentId: "agent-1",
    resourceUrl: ({ paymentRequired }) => paymentRequired.resource.url,
    contextFor: () => ({ source_trust: "untrusted" }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      inspect(body, init);
      return response(decision, body);
    },
  });
}

test("allows only an explicit matching ALLOW receipt", async () => {
  const hook = makeHook("ALLOW", (body, init) => {
    assert.equal(body.amount_minor, 1000);
    assert.equal(body.currency, "USDC");
    assert.equal(body.endpoint, "https://merchant.example/weather");
    assert.equal(body.x402.network, "eip155:8453");
    assert.equal(body.context.tool_name, "get_weather");
    assert.equal(init.headers.authorization, "Bearer test-token");
  });
  assert.equal(await hook(baseRequest), true);
});

test("denies BLOCK and REQUIRE_APPROVAL", async () => {
  assert.equal(await makeHook("BLOCK")(baseRequest), false);
  assert.equal(await makeHook("REQUIRE_APPROVAL")(baseRequest), false);
});

test("fails closed on network error, malformed input and mismatched receipt", async () => {
  const failing = createPayGuardPaymentHook({
    token: "test-token",
    agentId: "agent-1",
    resourceUrl: "https://merchant.example/weather",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(await failing(baseRequest), false);
  assert.equal(await failing({ toolName: "x", paymentRequired: { accepts: [] } }), false);

  const mismatched = createPayGuardPaymentHook({
    token: "test-token",
    agentId: "agent-1",
    resourceUrl: "https://merchant.example/weather",
    fetchImpl: async () => ({ ok: true, async json() { return { intent_id: "other", decision: "ALLOW" }; } }),
  });
  assert.equal(await mismatched(baseRequest), false);
});

test("fails closed on timeout", async () => {
  const hook = createPayGuardPaymentHook({
    token: "test-token",
    agentId: "agent-1",
    resourceUrl: "https://merchant.example/weather",
    timeoutMs: 100,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  assert.equal(await hook(baseRequest), false);
});

