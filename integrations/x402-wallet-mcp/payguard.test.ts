import assert from "node:assert/strict";
import test from "node:test";
import { createPayGuardPreSignGate, type PreSignIntent } from "./payguard.ts";

const intent: PreSignIntent = {
  url: "https://merchant.example/report",
  method: "POST",
  accept: {
    scheme: "exact",
    network: "eip155:8453",
    amount: "1000000",
    payTo: "0x1111111111111111111111111111111111111111",
    asset: "0x833589fCD6eDb6E08f4C7C32D4f71b54bda02913",
  },
};

function response(decision: string, request: Record<string, unknown>, overrides = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      const quote = request.x402 as Record<string, string>;
      return {
        intent_id: request.intent_id,
        amount_minor: request.amount_minor,
        currency: request.currency,
        rail: request.rail,
        network: quote.network,
        asset: quote.asset.toLowerCase(),
        receipt_id: "receipt-1",
        request_hash: "request-1",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        decision,
        reasons: decision === "ALLOW" ? ["within_policy"] : ["new_provider_or_payee"],
        ...overrides,
      };
    },
  } as Response;
}

function gate(decision = "ALLOW", inspect = (_body: Record<string, unknown>) => {}) {
  return createPayGuardPreSignGate({
    token: "pgc_test",
    intentId: () => "fixed",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      inspect(body);
      return response(decision, body);
    },
  });
}

test("allows only an explicit receipt bound to the signer input", async () => {
  const result = await gate("ALLOW", (body) => {
    assert.equal(body.amount_minor, 1_000_000);
    assert.equal(body.payee, intent.accept.payTo);
    assert.equal((body.x402 as Record<string, string>).network, "eip155:8453");
    assert.equal((body.context as Record<string, string>).integration, "x402-wallet-mcp");
  })(intent);
  assert.equal(result.allowed, true);
  assert.equal(result.receiptId, "receipt-1");
});

test("refuses BLOCK and REQUIRE_APPROVAL before signing", async () => {
  assert.equal((await gate("BLOCK")(intent)).allowed, false);
  assert.equal((await gate("REQUIRE_APPROVAL")(intent)).allowed, false);
});

test("fails closed on network failure and invalid amount", async () => {
  const offline = createPayGuardPreSignGate({
    token: "pgc_test",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.deepEqual((await offline(intent)).reasons, ["payguard_unavailable"]);
  const invalid = await gate()({ ...intent, accept: { ...intent.accept, amount: "not-a-number" } });
  assert.deepEqual(invalid.reasons, ["invalid_x402_amount"]);
});

test("fails closed on a mismatched or expired receipt", async () => {
  const mismatched = createPayGuardPreSignGate({
    token: "pgc_test",
    intentId: () => "fixed",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return response("ALLOW", body, { amount_minor: 2_000_000 });
    },
  });
  assert.deepEqual((await mismatched(intent)).reasons, ["mismatched_payguard_receipt"]);
});

test("fails closed on timeout", async () => {
  const timeout = createPayGuardPreSignGate({
    token: "pgc_test",
    timeoutMs: 20,
    fetchImpl: async (_url, { signal } = {}) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  assert.deepEqual((await timeout(intent)).reasons, ["payguard_unavailable"]);
});

