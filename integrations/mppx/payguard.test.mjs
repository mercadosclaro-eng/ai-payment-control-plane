import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { authorizeAndPayPreparedRequest } from "./payguard.mjs";

const endpoint = "https://merchant.example/premium";
const currencyId = "usd";
const payee = "merchant_123";
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fixture(overrides = {}) {
  let payCalls = 0;
  const challenge = overrides.challenge ?? {
    id: "challenge-1",
    method: "tempo",
    realm: "merchant.example",
    intent: "charge",
    request: { amount: "4900", currency: currencyId, recipient: payee },
  };
  return {
    prepared: {
      request: { url: endpoint },
      payment: {
        challenge,
        async pay() { payCalls += 1; return { status: 200, paid: true }; },
      },
      ...overrides.prepared,
    },
    challenge,
    payCalls: () => payCalls,
  };
}

function allowReceipt(body, overrides = {}) {
  return {
    ok: true,
    async json() {
      return {
        decision: "ALLOW",
        intent_id: body.intent_id,
        amount_minor: body.amount_minor,
        currency: body.currency,
        rail: body.rail,
        payee_hash: hash(body.payee.toLowerCase()),
        endpoint_hash: hash(body.endpoint),
        receipt_id: "receipt-1",
        request_hash: "request-hash-1",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      };
    },
  };
}

function options(responseFactory, inspect = () => {}, extra = {}) {
  return {
    token: "client-token",
    agentId: "agent-1",
    currencyCode: "USD",
    currencyId,
    intentId: () => "fixed",
    context: { source_trust: "owner-configured", purpose: "premium data" },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      inspect(url, init, body);
      return responseFactory(body);
    },
    ...extra,
  };
}

test("a matching ALLOW pays exactly once after checking the selected charge", async () => {
  const f = fixture();
  const result = await authorizeAndPayPreparedRequest(f.prepared, options(allowReceipt, (url, init, body) => {
    assert.equal(url, "https://payguard-production-abfe.up.railway.app/check");
    assert.equal(init.headers.authorization, "Bearer client-token");
    assert.equal(body.intent_id, "mpp-fixed");
    assert.equal(body.amount_minor, 4900);
    assert.equal(body.currency, "USD");
    assert.equal(body.payee, payee);
    assert.equal(body.endpoint, endpoint);
    assert.equal(body.context.mpp_currency_id, currencyId);
    assert.equal(body.context.mpp_challenge_id, "challenge-1");
    assert.equal(body.context.mpp_method, "tempo");
    assert.match(body.context.mpp_challenge_hash, /^[0-9a-f]{64}$/);
  }));
  assert.deepEqual(result, { status: 200, paid: true });
  assert.equal(f.payCalls(), 1);
});

test("BLOCK and REQUIRE_APPROVAL never pay", async () => {
  for (const decision of ["BLOCK", "REQUIRE_APPROVAL"]) {
    const f = fixture();
    await assert.rejects(
      authorizeAndPayPreparedRequest(f.prepared, options((body) => allowReceipt(body, { decision }))),
      /matching ALLOW/,
    );
    assert.equal(f.payCalls(), 0);
  }
});

test("unsupported or incomplete challenges fail closed before the check", async () => {
  const invalid = [
    { id: "c", method: "tempo", realm: "merchant.example", intent: "session", request: { amount: "4900", currency: currencyId, recipient: payee } },
    { id: "c", method: "tempo", realm: "merchant.example", intent: "subscription", request: { amount: "4900", currency: currencyId, recipient: payee } },
    { id: "c", method: "tempo", realm: "merchant.example", intent: "charge", request: { amount: "4.9", currency: currencyId, recipient: payee } },
    { id: "c", method: "tempo", realm: "merchant.example", intent: "charge", request: { amount: "4900", currency: "eur", recipient: payee } },
    { id: "c", method: "tempo", realm: "merchant.example", intent: "charge", request: { amount: "4900", currency: currencyId, recipient: "" } },
    { id: "", method: "tempo", realm: "merchant.example", intent: "charge", request: { amount: "4900", currency: currencyId, recipient: payee } },
  ];
  for (const challenge of invalid) {
    const f = fixture({ challenge });
    await assert.rejects(authorizeAndPayPreparedRequest(f.prepared, options(() => { throw new Error("unreachable"); })));
    assert.equal(f.payCalls(), 0);
  }
});

test("network, malformed, mismatched and expired receipts fail closed", async () => {
  const cases = [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false, async json() { return {}; } }),
    (body) => allowReceipt(body, { amount_minor: 1 }),
    (body) => allowReceipt(body, { endpoint_hash: hash("https://other.example/") }),
    (body) => allowReceipt(body, { payee_hash: hash("other") }),
    (body) => allowReceipt(body, { expires_at: new Date(0).toISOString() }),
  ];
  for (const responseFactory of cases) {
    const f = fixture();
    await assert.rejects(authorizeAndPayPreparedRequest(f.prepared, options(responseFactory)));
    assert.equal(f.payCalls(), 0);
  }
});

test("timeout fails closed", async () => {
  const f = fixture();
  const fetchImpl = async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  await assert.rejects(authorizeAndPayPreparedRequest(f.prepared, options(() => {}, () => {}, {
    timeoutMs: 100,
    fetchImpl,
  })));
  assert.equal(f.payCalls(), 0);
});

test("a challenge changed while the check is pending cannot reuse the ALLOW", async () => {
  const f = fixture();
  await assert.rejects(authorizeAndPayPreparedRequest(f.prepared, options((body) => {
    f.challenge.request.amount = "9900";
    return allowReceipt(body);
  })), /challenge changed/);
  assert.equal(f.payCalls(), 0);
});

