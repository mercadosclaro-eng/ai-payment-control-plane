import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARDARO_ANALYSIS_FEE,
  minorToDecimal,
  toArdaroRequest,
  toReviewRecord,
} from './ardaro-advisory.mjs';

test('maps the exact USD/USDC advisory request contract', () => {
  const mapped = toArdaroRequest({
    proposal: { amountMinor: '1000', amountDecimals: 6, currency: 'USDC' },
    policy: {
      currency: 'USDC',
      max_per_transaction: '0.010000',
      max_per_hour: '1.000000',
      max_checks_per_minute: 10,
    },
    history: {
      currency: 'USDC',
      committed_last_hour: '0.100000',
      pending_reserved: '0.010000',
      checks_last_minute: 2,
    },
  });

  assert.deepEqual(mapped, {
    proposed_cost: '0.001000',
    currency: 'USDC',
    policy: {
      currency: 'USDC',
      max_per_transaction: '0.010000',
      max_per_hour: '1.000000',
      max_checks_per_minute: 10,
    },
    history: {
      currency: 'USDC',
      committed_last_hour: '0.100000',
      pending_reserved: '0.010000',
      checks_last_minute: 2,
    },
  });
  assert.deepEqual(ARDARO_ANALYSIS_FEE, {
    currency: 'USDC',
    amount: '0.10',
    atomic_units: '100000',
    included_in_checks: false,
    paid_by_fixture: false,
  });
});

test('requires explicit scale and rejects mismatched or unsupported currencies', () => {
  assert.equal(minorToDecimal('1000', 2), '10.000000');
  assert.throws(() => minorToDecimal('1000', 7), /amountDecimals/);
  assert.throws(() => toArdaroRequest({
    proposal: { amountMinor: '1', amountDecimals: 6, currency: 'EUR' },
    policy: { currency: 'EUR', max_per_transaction: '1', max_per_hour: '1', max_checks_per_minute: 1 },
    history: { currency: 'EUR', committed_last_hour: '0', pending_reserved: '0', checks_last_minute: 0 },
  }), /USD or USDC/);
  assert.throws(() => toArdaroRequest({
    proposal: { amountMinor: '1', amountDecimals: 6, currency: 'USD' },
    policy: { currency: 'USDC', max_per_transaction: '1', max_per_hour: '1', max_checks_per_minute: 1 },
    history: { currency: 'USD', committed_last_hour: '0', pending_reserved: '0', checks_last_minute: 0 },
  }), /currencies must match/);
});

function response(authorizationStatus = 'WITHIN_SUBMITTED_LIMITS') {
  return {
    contract_version: 'ardaro.agent-utilities.response.v1',
    service_id: 'ardaro.authorize_agent_spend',
    status: 'review_required',
    result: {
      tool: 'authorize_agent_spend',
      authorization_status: authorizationStatus,
      policy: {
        advisory_only: true,
        human_review_required: true,
        checks_exclude_service_fee: true,
        downstream_payment_authorized: false,
        external_spend_enforced: false,
        reservation_created: false,
        credentials_issued: false,
      },
    },
  };
}

test('interprets canonical responses as review-only records', () => {
  const within = toReviewRecord(response());
  assert.equal(within.disposition, 'REVIEW_REQUIRED');
  assert.equal(within.humanReviewRequired, true);
  assert.equal(within.signingAuthorized, false);
  assert.equal(within.paymentAuthorized, false);
  assert.equal(within.fundsMoved, false);

  const exceeded = toReviewRecord(response('EXCEEDS_SUBMITTED_LIMITS'));
  assert.equal(exceeded.disposition, 'STOP');
  assert.throws(() => toReviewRecord({ ...response(), status: 'allow' }), /Unsupported/);
  assert.throws(() => toReviewRecord({
    ...response(),
    result: { ...response().result, policy: { ...response().result.policy, downstream_payment_authorized: true } },
  }), /Unsupported/);
});

