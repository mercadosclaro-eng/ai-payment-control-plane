import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { createArdaroPreSignGuard } from './varyntiq-ardaro.mjs';

const request = {
  amountMinor: '1000',
  currency: 'USDC',
  payTo: '0x1111111111111111111111111111111111111111',
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4C7C32D4f71b54Bda02913',
  resourceUrl: 'https://agents.getardaro.com/mcp/utilities',
  nonce: 'ardaro-fixture-001',
  limits: { max_single_spend: '1000', daily_remaining: '5000' },
};

function reply(decision, body, extra = {}) {
  return { ok: true, async json() { return { intent_id: body.intent_id, decision, receipt_id: 'fixture-receipt', expires_at: new Date(Date.now() + 60000).toISOString(), ...extra }; } };
}

function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function guard(decision, calls) {
  return createArdaroPreSignGuard({
    token: 'fixture-token',
    agentId: 'ardaro-fixture-agent',
    baseUrl: 'https://varyntiq.example',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ kind: 'policy', body });
      return reply(decision, body);
    },
  });
}

test('only ALLOW reaches the signer', async () => {
  const calls = [];
  const result = await guard('ALLOW', calls)({ request, sign: ({ intent }) => ({ signed: true, intentId: intent.intent_id }) });
  assert.equal(result.signed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.context.ardaro_tool, 'authorize_agent_spend');
  assert.equal(calls[0].body.context.limits.max_single_spend, '1000');
  assert.equal(calls[0].body.x402.nonce, request.nonce);
  assert.equal(calls[0].body.x402.network, request.network);
  assert.equal(calls[0].body.x402.resource.url, request.resourceUrl);
  assert.equal(calls[0].body.proposed_cost.amount, '0.001000');
  assert.equal(calls[0].body.proposed_cost.currency, 'USDC');
  assert.equal(calls[0].body.proposed_cost.scale, 6);
  assert.equal(calls[0].body.proposed_cost.minor_units, '1000');
  assert.equal(calls[0].body.policy.mode, 'pre_sign');
  assert.equal(calls[0].body.policy.decision_scope, 'advisory');
  assert.equal(calls[0].body.policy.requires_review, true);
  assert.equal(calls[0].body.analysis_fee.included_in_proposed_cost, false);
  assert.equal(calls[0].body.analysis_fee.settlement, 'separate');
});

test('BLOCK and REQUIRE_APPROVAL never sign', async () => {
  for (const decision of ['BLOCK', 'REQUIRE_APPROVAL']) {
    const calls = [];
    let signed = false;
    await assert.rejects(
      guard(decision, calls)({ request, sign: () => { signed = true; } }),
      /not an unexpired ALLOW/,
    );
    assert.equal(signed, false);
  }
});

test('expired and changed-term receipts never sign', async () => {
  const expiredCalls = [];
  const expired = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      expiredCalls.push(body);
      return reply('ALLOW', body, { expires_at: '2020-01-01T00:00:00.000Z' });
    },
  });
  let expiredSignCalls = 0;
  await assert.rejects(expired({ request, sign: () => { expiredSignCalls += 1; } }), /not an unexpired ALLOW/);
  assert.equal(expiredSignCalls, 0);

  const changed = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example',
    fetchImpl: async () => ({ ok: true, async json() { return { intent_id: 'different-intent', decision: 'ALLOW' }; } }),
  });
  let changedSignCalls = 0;
  await assert.rejects(changed({ request, sign: () => { changedSignCalls += 1; } }), /not an unexpired ALLOW/);
  assert.equal(changedSignCalls, 0);
});

test('missing expiry and reserved context fields fail closed', async () => {
  const missingExpiry = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return { ok: true, async json() { return { intent_id: body.intent_id, decision: 'ALLOW' }; } };
    },
  });
  let missingExpirySignCalls = 0;
  await assert.rejects(missingExpiry({ request, sign: () => { missingExpirySignCalls += 1; } }), /not an unexpired ALLOW/);
  assert.equal(missingExpirySignCalls, 0);

  await assert.rejects(
    guard('ALLOW', [])({ request: { ...request, context: { nonce: 'attacker-value' } }, sign: () => {} }),
    /reserved fields/,
  );
});

test('the review fixture keeps signing and payment counters at zero for unsafe cases', async () => {
  const scenarios = ['BLOCK', 'REQUIRE_APPROVAL', 'EXPIRED', 'CHANGED_TERMS', 'MALFORMED'];
  const counters = Object.fromEntries(scenarios.map((name) => [name, { sign: 0, payment: 0 }]));
  for (const scenario of scenarios) {
    const calls = [];
    const guardForScenario = createArdaroPreSignGuard({
      token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example',
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        calls.push(body);
        if (scenario === 'MALFORMED') return { ok: true, async json() { return { nope: true }; } };
        if (scenario === 'CHANGED_TERMS') return { ok: true, async json() { return { intent_id: 'changed', decision: 'ALLOW' }; } };
        if (scenario === 'EXPIRED') return reply('ALLOW', body, { expires_at: '2020-01-01T00:00:00.000Z' });
        return reply(scenario, body);
      },
    });
    await assert.rejects(guardForScenario({
      request,
      sign: () => { counters[scenario].sign += 1; return { signed: true }; },
    }));
    if (counters[scenario].sign) counters[scenario].payment += 1;
    assert.equal(counters[scenario].sign, 0, scenario + ' must not sign');
    assert.equal(counters[scenario].payment, 0, scenario + ' must not pay');
  }
  assert.equal(Object.keys(counters).length, 5);
});

test('timeout or transport failure cannot sign', async () => {
  const timeoutGuard = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example', timeoutMs: 100,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  });
  let signed = false;
  await assert.rejects(timeoutGuard({ request, sign: () => { signed = true; } }), /timed out/);
  assert.equal(signed, false);
});

test('response-body parsing remains inside the deadline', async () => {
  const delayedBody = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example', timeoutMs: 100,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return { ok: true, async json() { await new Promise((resolve) => setTimeout(resolve, 200)); return { intent_id: body.intent_id, decision: 'ALLOW', expires_at: new Date(Date.now() + 60000).toISOString() }; } };
    },
  });
  let signed = false;
  await assert.rejects(delayedBody({ request, sign: () => { signed = true; } }), /timed out/);
  assert.equal(signed, false);
});

test('canonical Ardaro mapping covers limits, nonce and payment terms', async () => {
  const seen = [];
  const guardWithPolicy = (inspect) => createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      seen.push(body);
      return reply(inspect(body), body);
    },
  });

  const below = { ...request, amountMinor: '999', nonce: 'boundary-below' };
  const equal = { ...request, amountMinor: '1000', nonce: 'boundary-equal' };
  const above = { ...request, amountMinor: '1001', nonce: 'boundary-above' };
  const decisions = new Map([
    ['boundary-below', 'ALLOW'],
    ['boundary-equal', 'ALLOW'],
    ['boundary-above', 'BLOCK'],
  ]);
  for (const candidate of [below, equal, above]) {
    const guardForCandidate = guardWithPolicy((body) => decisions.get(body.context.nonce));
    let signed = false;
    if (candidate.amountMinor === '1001') {
      await assert.rejects(guardForCandidate({ request: candidate, sign: () => { signed = true; } }), /not an unexpired ALLOW/);
    } else {
      await guardForCandidate({ request: candidate, sign: ({ intent }) => { signed = true; return { intentId: intent.intent_id }; } });
    }
    assert.equal(signed, candidate.amountMinor !== '1001');
  }
  assert.deepEqual(seen.map((body) => body.x402.amount), ['999', '1000', '1001']);
  assert.equal(seen[1].x402.payTo, request.payTo);
  assert.equal(seen[1].x402.network, request.network);
  assert.equal(seen[1].x402.resource.url, request.resourceUrl);
});

test('nonce reuse and recipient/resource/network mismatches fail closed', async () => {
  const usedNonces = new Set();
  const expected = { payTo: request.payTo, resourceUrl: request.resourceUrl, network: request.network };
  const guarded = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const mismatch = body.x402.payTo !== expected.payTo || body.x402.resource.url !== expected.resourceUrl || body.x402.network !== expected.network;
      const replay = usedNonces.has(body.x402.nonce);
      const decision = mismatch || replay ? 'BLOCK' : 'ALLOW';
      if (decision === 'ALLOW') usedNonces.add(body.x402.nonce);
      return reply(decision, body);
    },
  });

  await guarded({ request: { ...request, nonce: 'once-only' }, sign: () => ({ signed: true }) });
  await assert.rejects(guarded({ request: { ...request, nonce: 'once-only' }, sign: () => ({ signed: true }) }), /not an unexpired ALLOW/);
  for (const changed of [
    { payTo: '0x2222222222222222222222222222222222222222' },
    { resourceUrl: 'https://attacker.example/resource' },
    { network: 'eip155:1' },
  ]) {
    await assert.rejects(guarded({ request: { ...request, nonce: crypto.randomUUID(), ...changed }, sign: () => ({ signed: true }) }), /not an unexpired ALLOW/);
  }
});

test('synchronous observer work cannot exceed the deadline before signing', async () => {
  let signed = false;
  const guarded = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example', timeoutMs: 100,
    onDecision: () => busyWait(180),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return reply('ALLOW', body);
    },
  });
  await assert.rejects(guarded({ request, sign: () => { signed = true; } }), /timed out before signing/);
  assert.equal(signed, false);
});

test('backward wall-clock adjustment cannot bypass the monotonic deadline', async () => {
  const realDateNow = Date.now;
  const wallClockBefore = realDateNow();
  let signed = false;
  const guarded = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example', timeoutMs: 100,
    onDecision: () => {
      Date.now = () => wallClockBefore - 60_000;
      const started = performance.now();
      while (performance.now() - started < 180) {}
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return reply('ALLOW', body);
    },
  });
  try {
    await assert.rejects(guarded({ request, sign: () => { signed = true; } }), /timed out before signing/);
    assert.equal(signed, false);
  } finally {
    Date.now = realDateNow;
  }
});

test('expiry is rechecked after the observer callback', async () => {
  let signed = false;
  const guarded = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example', timeoutMs: 500,
    onDecision: () => busyWait(60),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return reply('ALLOW', body, { expires_at: new Date(Date.now() + 20).toISOString() });
    },
  });
  await assert.rejects(guarded({ request, sign: () => { signed = true; } }), /expired before signing/);
  assert.equal(signed, false);
});

test('observer callbacks cannot mutate the canonical approval state', async () => {
  let signedInput;
  const guarded = createArdaroPreSignGuard({
    token: 'fixture-token', agentId: 'ardaro-fixture-agent', baseUrl: 'https://varyntiq.example',
    onDecision: (receipt, intent) => {
      receipt.decision = 'BLOCK';
      intent.amount_minor = 1;
      intent.x402.amount = '1';
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return reply('ALLOW', body);
    },
  });
  await guarded({ request, sign: (input) => { signedInput = input; return { signed: true }; } });
  assert.equal(signedInput.receipt.decision, 'ALLOW');
  assert.equal(signedInput.intent.amount_minor, 1000);
  assert.equal(signedInput.intent.x402.amount, '1000');
});

