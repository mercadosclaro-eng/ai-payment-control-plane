import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createAgent402PayGuardFetch } from "./agent402-payguard.mjs";

const currencyId = "0x20c0000000000000000000000000000000000000";
const payee = "0x1111111111111111111111111111111111111111";
const hash = (value) => createHash("sha256").update(value).digest("hex");

function challenge() {
  return {
    id: "agent402-live-shape",
    method: "tempo",
    realm: "agent402.tools",
    intent: "charge",
    request: { amount: "1000", currency: currencyId, recipient: payee },
  };
}

function fixture({ payment = true } = {}) {
  let paid = 0;
  const response = new Response("free", { status: 200 });
  const prepared = {
    request: new Request("https://agent402.tools/api/uuid"),
    response,
    payment: payment ? {
      challenge: challenge(),
      async pay() { paid += 1; return new Response('{"uuid":"paid"}', { status: 200 }); },
    } : undefined,
  };
  return {
    mppx: { async prepareRequest() { return prepared; } },
    prepared,
    response,
    paid: () => paid,
  };
}

function policy(f, decision = "ALLOW", inspect = () => {}) {
  return {
    mppx: f.mppx,
    token: "agent-token",
    agentId: "buyer-agent",
    currencyCode: "USDC",
    currencyId,
    intentId: () => "agent402-test",
    context: { purpose: "obtain one UUID", source_trust: "owner-configured" },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      inspect(body);
      return {
        ok: true,
        async json() {
          return {
            decision,
            intent_id: body.intent_id,
            amount_minor: body.amount_minor,
            currency: body.currency,
            rail: body.rail,
            payee_hash: hash(body.payee.toLowerCase()),
            endpoint_hash: hash(body.endpoint),
            receipt_id: "receipt-agent402",
            request_hash: "request-agent402",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          };
        },
      };
    },
  };
}

test("free Agent402 responses pass through without a policy call", async () => {
  const f = fixture({ payment: false });
  let checked = false;
  const guardedFetch = createAgent402PayGuardFetch({
    ...policy(f),
    fetchImpl: async () => { checked = true; throw new Error("unexpected"); },
  });
  assert.equal(await guardedFetch("https://agent402.tools/api/free"), f.response);
  assert.equal(checked, false);
  assert.equal(f.paid(), 0);
});

test("matching ALLOW pays Agent402 exactly once with route context", async () => {
  const f = fixture();
  const guardedFetch = createAgent402PayGuardFetch(policy(f, "ALLOW", (body) => {
    assert.equal(body.endpoint, "https://agent402.tools/api/uuid");
    assert.equal(body.context.provider, "agent402.tools");
    assert.equal(body.context.agent402_route, "/api/uuid");
    assert.equal(body.context.agent402_tool, "uuid");
    assert.equal(body.context.purpose, "obtain one UUID");
  }));
  const response = await guardedFetch("https://agent402.tools/api/uuid");
  assert.equal(response.status, 200);
  assert.equal(f.paid(), 1);
});

test("BLOCK and REQUIRE_APPROVAL never create an Agent402 payment", async () => {
  for (const decision of ["BLOCK", "REQUIRE_APPROVAL"]) {
    const f = fixture();
    const guardedFetch = createAgent402PayGuardFetch(policy(f, decision));
    await assert.rejects(guardedFetch("https://agent402.tools/api/uuid"), /matching ALLOW/);
    assert.equal(f.paid(), 0);
  }
});

test("a redirected or substituted seller origin fails closed", async () => {
  const f = fixture();
  f.prepared.request = new Request("https://attacker.example/api/uuid");
  const guardedFetch = createAgent402PayGuardFetch(policy(f));
  await assert.rejects(guardedFetch("https://agent402.tools/api/uuid"), /refusing payment outside/);
  assert.equal(f.paid(), 0);
});

