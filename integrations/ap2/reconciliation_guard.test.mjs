import assert from 'node:assert/strict';
import test from 'node:test';
import { completeCheckout } from './reconciliation_guard.mjs';

function operation() {
  return { tokenId: 'demo-token', orderId: 'demo-order', amount: 199, currency: 'USD' };
}

test('commits token usage only after settlement confirmation', async () => {
  const tokenStore = { 'demo-token': { used: false } };
  let calls = 0;
  const result = await completeCheckout({
    tokenStore,
    tokenId: 'demo-token',
    operation: operation(),
    varyntiqDecision: { decision: 'ALLOW' },
    settle: async () => { calls += 1; return { confirmed: true, orderId: 'order-1' }; },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(tokenStore['demo-token'].used, true);
});

test('keeps the token available when settlement is unconfirmed', async () => {
  const tokenStore = { 'demo-token': { used: false } };
  const result = await completeCheckout({
    tokenStore,
    tokenId: 'demo-token',
    operation: operation(),
    varyntiqDecision: { decision: 'ALLOW' },
    settle: async () => ({ confirmed: false }),
  });
  assert.equal(result.reason, 'settlement_unconfirmed');
  assert.equal(tokenStore['demo-token'].used, false);
  assert.equal('order_id' in tokenStore['demo-token'], false);
});

test('blocks before the settlement provider on a Varyntiq denial', async () => {
  const tokenStore = { 'demo-token': { used: false } };
  let called = false;
  const result = await completeCheckout({
    tokenStore,
    tokenId: 'demo-token',
    operation: operation(),
    varyntiqDecision: { decision: 'BLOCK' },
    settle: async () => { called = true; return { confirmed: true }; },
  });
  assert.equal(result.reason, 'policy_blocked');
  assert.equal(called, false);
  assert.equal(tokenStore['demo-token'].used, false);
});

test('rejects a replay after a confirmed settlement', async () => {
  const tokenStore = { 'demo-token': { used: true, order_id: 'order-1' } };
  let called = false;
  const result = await completeCheckout({
    tokenStore,
    tokenId: 'demo-token',
    operation: operation(),
    varyntiqDecision: { decision: 'ALLOW' },
    settle: async () => { called = true; return { confirmed: true }; },
  });
  assert.equal(result.reason, 'token_already_used');
  assert.equal(called, false);
});
