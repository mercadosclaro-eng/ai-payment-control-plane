/**
 * Pure Ardaro advisory contract helpers.
 *
 * This module deliberately has no network, signing, wallet or runtime-hook
 * dependency. It maps a bounded request and interprets a saved response for
 * human review only. It must remain separate from varyntiq-ardaro.mjs.
 */

const CURRENCIES = new Set(['USD', 'USDC']);
const STATUSES = new Set([
  'WITHIN_SUBMITTED_LIMITS',
  'EXCEEDS_SUBMITTED_LIMITS',
  'RATE_THRESHOLD_EXCEEDED',
  'CURRENCY_MISMATCH',
]);
const DECIMAL = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/;

export const ARDARO_ANALYSIS_FEE = Object.freeze({
  currency: 'USDC',
  amount: '0.10',
  atomic_units: '100000',
  included_in_checks: false,
  paid_by_fixture: false,
});

function fields(value, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== required.length ||
      required.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} requires exactly: ${required.join(', ')}`);
  }
}

function currency(value) {
  if (!CURRENCIES.has(value)) throw new TypeError('Explicit USD or USDC currency required');
  return value;
}

function decimal(value) {
  if (typeof value !== 'string' || value.length > 16 || value.trim() !== value || !DECIMAL.test(value)) {
    throw new TypeError('Bounded nonnegative decimal string with at most six fractional digits required');
  }
  return value;
}

function count(value, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 1_000_000) {
    throw new TypeError('Invalid check count');
  }
  return value;
}

function sameCurrency(...values) {
  const [first, ...rest] = values;
  if (rest.some((value) => value !== first)) throw new TypeError('proposal, policy and history currencies must match');
  return first;
}

/** Convert explicitly scaled minor units to a canonical decimal string. */
export function minorToDecimal(amountMinor, amountDecimals) {
  if (typeof amountMinor !== 'string' || amountMinor.trim() !== amountMinor || !/^(?:0|[1-9][0-9]{0,14})$/.test(amountMinor)) {
    throw new TypeError('Canonical nonnegative integer string required');
  }
  if (!Number.isInteger(amountDecimals) || amountDecimals < 0 || amountDecimals > 6) {
    throw new TypeError('Explicit amountDecimals in 0..6 required');
  }
  const millionths = BigInt(amountMinor) * 10n ** BigInt(6 - amountDecimals);
  const whole = millionths / 1_000_000n;
  const fraction = String(millionths % 1_000_000n).padStart(6, '0');
  return decimal(`${whole}.${fraction}`);
}

/**
 * Map a bounded Ardaro request. The returned shape is the advisory contract,
 * not a payment instruction and not an authorization to sign or spend.
 */
export function toArdaroRequest({ proposal, policy, history }) {
  fields(proposal, ['amountMinor', 'amountDecimals', 'currency'], 'proposal');
  fields(policy, ['currency', 'max_per_transaction', 'max_per_hour', 'max_checks_per_minute'], 'policy');
  fields(history, ['currency', 'committed_last_hour', 'pending_reserved', 'checks_last_minute'], 'history');

  const requestCurrency = sameCurrency(
    currency(proposal.currency),
    currency(policy.currency),
    currency(history.currency),
  );

  return {
    proposed_cost: minorToDecimal(proposal.amountMinor, proposal.amountDecimals),
    currency: requestCurrency,
    policy: {
      currency: requestCurrency,
      max_per_transaction: decimal(policy.max_per_transaction),
      max_per_hour: decimal(policy.max_per_hour),
      max_checks_per_minute: count(policy.max_checks_per_minute, 1),
    },
    history: {
      currency: requestCurrency,
      committed_last_hour: decimal(history.committed_last_hour),
      pending_reserved: decimal(history.pending_reserved),
      checks_last_minute: count(history.checks_last_minute, 0),
    },
  };
}

/**
 * Interpret only the saved canonical response. This result always remains
 * advisory: a human must review it and no signing or payment is authorized.
 */
export function toReviewRecord(response) {
  const result = response?.result;
  const policy = result?.policy;
  if (response?.contract_version !== 'ardaro.agent-utilities.response.v1' ||
      response?.service_id !== 'ardaro.authorize_agent_spend' ||
      response?.status !== 'review_required' ||
      result?.tool !== 'authorize_agent_spend' ||
      !STATUSES.has(result?.authorization_status) ||
      policy?.advisory_only !== true ||
      policy?.human_review_required !== true ||
      policy?.checks_exclude_service_fee !== true ||
      ['downstream_payment_authorized', 'external_spend_enforced', 'reservation_created', 'credentials_issued']
        .some((key) => policy?.[key] !== false)) {
    throw new TypeError('Unsupported or inconsistent advisory response');
  }

  return {
    fixtureOnly: true,
    advisoryStatus: result.authorization_status,
    disposition: result.authorization_status === 'WITHIN_SUBMITTED_LIMITS' ? 'REVIEW_REQUIRED' : 'STOP',
    humanReviewRequired: true,
    signingAuthorized: false,
    paymentAuthorized: false,
    analysisFeeIncluded: false,
    analysisFeePaymentExecuted: false,
    fundsMoved: false,
    response: structuredClone(response),
  };
}

