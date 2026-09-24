import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePayGuard } from "./evaluate-live.mjs";

function mockResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function receipt(intent, decision, reasons, suffix) {
  return {
    receipt_id: `receipt-${suffix}`,
    receipt_hash: `hash-${suffix}`,
    request_hash: `request-${suffix}`,
    intent_id: intent.intent_id,
    amount_minor: intent.amount_minor,
    currency: intent.currency,
    rail: intent.rail,
    decision,
    reasons,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

function successfulFetch() {
  const stored = new Map();
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (path === "/health") return mockResponse(200, { status: "ok" });
    if (path === "/register") return mockResponse(201, { client_id: "client-1", client_token: "pgc_test", client_admin_token: "pga_test" });
    if (path === "/check") {
      if (stored.has(body.intent_id)) return mockResponse(200, stored.get(body.intent_id));
      const dangerous = body.context.source_trust === "untrusted";
      const value = receipt(body, dangerous ? "BLOCK" : "REQUIRE_APPROVAL", dangerous ? ["prompt_injection_payment_pattern"] : ["new_provider_or_payee"], dangerous ? "danger" : "normal");
      stored.set(body.intent_id, value);
      return mockResponse(200, value);
    }
    if (path === "/logs") return mockResponse(200, { chain_valid: true, receipts: [...stored.values()] });
    if (path === "/usage") return mockResponse(200, { checks: stored.size, monthly_check_quota: 100 });
    return mockResponse(404, { error: "not found" });
  };
}

test("verifies the public evaluation path without returning credentials", async () => {
  const result = await evaluatePayGuard({ fetchImpl: successfulFetch(), baseUrl: "https://example.test", evaluationId: "fixed-id" });
  assert.equal(result.result, "PASS");
  assert.equal(result.dangerous_decision, "BLOCK");
  assert.equal(result.baseline_decision, "REQUIRE_APPROVAL");
  assert.equal(result.checks.length, 7);
  assert.equal(JSON.stringify(result).includes("pgc_test"), false);
  assert.equal(JSON.stringify(result).includes("pga_test"), false);
});

test("fails when the dangerous payment is not blocked", async () => {
  const fetchImpl = successfulFetch();
  const altered = async (url, init) => {
    const response = await fetchImpl(url, init);
    if (new URL(url).pathname !== "/check" || !init.body) return response;
    const intent = JSON.parse(init.body);
    if (intent.context.source_trust !== "untrusted") return response;
    return mockResponse(200, receipt(intent, "ALLOW", ["within_policy"], "unsafe"));
  };
  await assert.rejects(
    evaluatePayGuard({ fetchImpl: altered, baseUrl: "https://example.test", evaluationId: "fixed-id" }),
    /dangerous intent returned ALLOW/,
  );
});

test("fails when a receipt is not bound to the submitted intent", async () => {
  const fetchImpl = successfulFetch();
  const altered = async (url, init) => {
    const response = await fetchImpl(url, init);
    if (new URL(url).pathname !== "/check" || !init.body) return response;
    const value = await response.json();
    return mockResponse(200, { ...value, amount_minor: value.amount_minor + 1 });
  };
  await assert.rejects(
    evaluatePayGuard({ fetchImpl: altered, baseUrl: "https://example.test", evaluationId: "fixed-id" }),
    /not bound to the submitted amount/,
  );
});

