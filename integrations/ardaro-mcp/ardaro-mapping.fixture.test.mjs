import assert from 'node:assert/strict';
import test from 'node:test';
import { mapArdaroRequestToIntent } from './varyntiq-ardaro.mjs';

const baseRequest = {
  amountMinor: '1000',
  currency: 'USDC',
  payTo: '0x1111111111111111111111111111111111111111',
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4C7C32D4f71b54Bda02913',
  resourceUrl: 'https://agents.getardaro.com/mcp/utilities',
  nonce: 'mapping-fixture-001',
  limits: { max_single_spend: '1000' },
};

test('maps minor units to an explicit whole-currency decimal cost', () => {
  const intent = mapArdaroRequestToIntent(baseRequest, { agentId: 'ardaro-fixture-agent', intentId: 'ardaro-mapping-1' });
  assert.equal(intent.intent_id, 'ardaro-mapping-1');
  assert.equal(intent.currency, 'USDC');
  assert.equal(intent.amount_minor, 1000);
  assert.equal(intent.proposed_cost.amount, '0.001000');
  assert.equal(intent.proposed_cost.currency, 'USDC');
  assert.equal(intent.proposed_cost.scale, 6);
  assert.equal(intent.proposed_cost.minor_units, '1000');
  assert.equal(intent.x402.currency, 'USDC');
});

test('keeps policy history and analysis fee separate from the spend', () => {
  const history = [{ event: 'budget_checked', result: 'within_limits', at: '2026-09-29T00:00:00.000Z' }];
  const intent = mapArdaroRequestToIntent({
    ...baseRequest,
    policyId: 'ardaro-budget-policy',
    policyVersion: '2026-09-29.1',
    policyHistory: history,
    analysisFeeMinor: '25',
  }, { agentId: 'ardaro-fixture-agent', intentId: 'ardaro-mapping-2' });

  assert.deepEqual(intent.policy.history, history);
  assert.equal(intent.policy.mode, 'pre_sign');
  assert.equal(intent.policy.decision_scope, 'advisory');
  assert.equal(intent.policy.requires_review, true);
  assert.equal(intent.policy.policy_id, 'ardaro-budget-policy');
  assert.equal(intent.policy.policy_version, '2026-09-29.1');
  assert.equal(intent.analysis_fee.amount_minor, 25);
  assert.equal(intent.analysis_fee.amount, '0.000025');
  assert.equal(intent.analysis_fee.included_in_proposed_cost, false);
  assert.equal(intent.analysis_fee.settlement, 'separate');
  assert.equal(intent.proposed_cost.minor_units, '1000');
});

test('requires an explicit scale for currencies with no safe default', () => {
  assert.throws(
    () => mapArdaroRequestToIntent({ ...baseRequest, currency: 'JPY' }, { agentId: 'ardaro-fixture-agent' }),
    /currencyScale/,
  );
  const intent = mapArdaroRequestToIntent({ ...baseRequest, currency: 'JPY', currencyScale: 0 }, { agentId: 'ardaro-fixture-agent', intentId: 'ardaro-mapping-3' });
  assert.equal(intent.proposed_cost.amount, '1000');
  assert.equal(intent.proposed_cost.scale, 0);
});

test('detaches caller-supplied limits, context and history', () => {
  const limits = { max_single_spend: '1000' };
  const context = { purpose: 'utility' };
  const history = [{ event: 'created' }];
  const intent = mapArdaroRequestToIntent({ ...baseRequest, limits, context, policyHistory: history }, { agentId: 'ardaro-fixture-agent', intentId: 'ardaro-mapping-4' });
  limits.max_single_spend = '1';
  context.purpose = 'tampered';
  history[0].event = 'tampered';
  assert.equal(intent.context.limits.max_single_spend, '1000');
  assert.equal(intent.context.purpose, 'utility');
  assert.equal(intent.policy.history[0].event, 'created');
});
