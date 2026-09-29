/**
 * Varyntiq pre-sign guard for Ardaro's authorize_agent_spend boundary.
 *
 * This adapter is intentionally provider-neutral: Ardaro (or another
 * runtime) supplies the signer, while Varyntiq decides whether signing may
 * happen. Keys, funds and settlement remain outside this module.
 */

import { performance } from 'node:perf_hooks';

const DEFAULT_BASE_URL = process.env.VARYNTIQ_BASE_URL;
const DEFAULT_CURRENCY_SCALES = Object.freeze({
  USD: 2,
  EUR: 2,
  GBP: 2,
  USDC: 6,
  USDT: 6,
  DAI: 18,
  ETH: 18,
  WETH: 18,
});

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' must be a non-empty string');
  return value.trim();
}

function httpUrl(value, name) {
  const parsed = new URL(text(value, name));
  if (!/^https?:$/.test(parsed.protocol)) throw new TypeError(name + ' must be an HTTP(S) URL');
  return parsed.toString();
}

function amountMinor(value) {
  const normalized = text(String(value == null ? '' : value), 'amountMinor');
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(Number(normalized)) || Number(normalized) <= 0) {
    throw new TypeError('amountMinor must be positive integer minor units');
  }
  return Number(normalized);
}

function nonNegativeMinor(value, name) {
  const normalized = text(String(value == null ? '0' : value), name);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(Number(normalized))) {
    throw new TypeError(name + ' must be a non-negative integer minor amount');
  }
  return Number(normalized);
}

function currencyScale(value, currency) {
  const raw = value == null ? DEFAULT_CURRENCY_SCALES[currency] : value;
  if (raw == null || !/^\d+$/.test(String(raw)) || !Number.isInteger(Number(raw)) || Number(raw) < 0 || Number(raw) > 18) {
    throw new TypeError('currencyScale must be an integer from 0 to 18');
  }
  return Number(raw);
}

function decimalAmount(minor, scale) {
  const digits = String(minor);
  if (scale === 0) return digits;
  const padded = digits.padStart(scale + 1, '0');
  return padded.slice(0, -scale) + '.' + padded.slice(-scale);
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Convert Ardaro's authorize_agent_spend request into one explicit,
 * detached Varyntiq intent. The cost is represented in whole-currency
 * decimal units plus its scale and original minor units, so no consumer has
 * to guess whether `1000` means 10.00, 0.001000 or something else.
 */
export function mapArdaroRequestToIntent(request, { agentId, intentId } = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('request must be an object');
  const stableAgentId = text(agentId, 'agentId');
  const currency = text(request.currency || 'USDC', 'currency').toUpperCase();
  const amount = amountMinor(request.amountMinor);
  const scale = currencyScale(request.currencyScale, currency);
  const analysisAmount = nonNegativeMinor(request.analysisFeeMinor, 'analysisFeeMinor');
  const payTo = text(request.payTo, 'payTo');
  const network = text(request.network, 'network');
  const asset = text(request.asset, 'asset');
  const nonce = text(request.nonce, 'nonce');
  const resourceUrl = httpUrl(request.resourceUrl, 'resourceUrl');
  const context = request.context == null ? {} : request.context;
  if (context === null || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('context must be an object');
  const limits = request.limits == null ? {} : request.limits;
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) throw new TypeError('limits must be an object');
  const reservedContextKeys = ['ardaro_tool', 'nonce', 'limits', 'policy', 'policy_history', 'analysis_fee', 'policy_id', 'policy_version'];
  const collisions = reservedContextKeys.filter((key) => Object.prototype.hasOwnProperty.call(context, key));
  if (collisions.length) throw new TypeError('context contains reserved fields: ' + collisions.join(', '));
  const policyHistory = request.policyHistory == null ? [] : request.policyHistory;
  if (!Array.isArray(policyHistory)) throw new TypeError('policyHistory must be an array');
  const policyId = text(request.policyId || 'varyntiq-default', 'policyId');
  const policyVersion = text(request.policyVersion || 'varyntiq-policy-v1', 'policyVersion');

  return {
    intent_id: intentId || 'ardaro-' + crypto.randomUUID(),
    schema_version: 'varyntiq-intent-v2',
    agent_id: stableAgentId,
    rail: 'x402',
    amount_minor: amount,
    amount_scale: scale,
    currency,
    proposed_cost: {
      amount: decimalAmount(amount, scale),
      currency,
      scale,
      minor_units: String(amount),
    },
    payee: payTo,
    endpoint: resourceUrl,
    policy: {
      mode: 'pre_sign',
      decision_scope: 'advisory',
      requires_review: true,
      policy_id: policyId,
      policy_version: policyVersion,
      history: clone(policyHistory),
    },
    analysis_fee: {
      amount_minor: analysisAmount,
      amount: decimalAmount(analysisAmount, scale),
      currency,
      scale,
      included_in_proposed_cost: false,
      settlement: 'separate',
      payer: 'ardaro',
    },
    x402: {
      amount: String(request.amountMinor),
      payTo,
      network,
      asset,
      nonce,
      currency,
      resource: { url: resourceUrl },
    },
    context: Object.assign({
      ardaro_tool: 'authorize_agent_spend',
      nonce,
      limits: clone(limits),
      policy_id: policyId,
      policy_version: policyVersion,
    }, clone(context)),
  };
}

/**
 * @param {object} options
 * @param {string} options.token Dedicated Varyntiq token.
 * @param {string} options.agentId Stable non-secret agent identifier.
 * @param {string=} options.baseUrl Varyntiq endpoint.
 * @param {number=} options.timeoutMs
 * @param {typeof fetch=} options.fetchImpl
 * @param {(receipt: object, intent: object) => void=} options.onDecision
 */
export function createArdaroPreSignGuard(options) {
  if (!options || typeof options !== 'object') throw new TypeError('options are required');
  const token = text(options.token, 'token');
  const agentId = text(options.agentId, 'agentId');
  const baseUrl = httpUrl(options.baseUrl || DEFAULT_BASE_URL, 'baseUrl').replace(/\/$/, '');
  const timeoutMs = options.timeoutMs == null ? 2500 : options.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new TypeError('timeoutMs must be 100..30000');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is unavailable');

  return async function authorizeAndSign(input) {
    const request = input && input.request;
    const sign = input && input.sign;
    if (!request || typeof request !== 'object' || typeof sign !== 'function') {
      throw new TypeError('request and sign callback are required');
    }
    const intent = mapArdaroRequestToIntent(request, { agentId });

    const controller = new AbortController();
    // Elapsed time must not depend on wall-clock adjustments. Receipt expiry
    // below intentionally continues to use Date.now(), because expiry is an
    // absolute timestamp supplied by the policy service.
    const startedAt = performance.now();
    const deadline = startedAt + timeoutMs;
    let timer;
    const operation = (async function () {
      const response = await fetchImpl(baseUrl + '/check', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(intent),
        signal: controller.signal,
      });
      if (!response || !response.ok) throw new Error('Varyntiq policy request failed');
      return response.json();
    })();
    try {
      const timeout = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          controller.abort();
          reject(new Error('Varyntiq policy request timed out'));
        }, timeoutMs);
      });
      const receipt = await Promise.race([operation, timeout]);
      const expiresAt = receipt && typeof receipt === 'object' ? receipt.expires_at : undefined;
      const parsedExpiry = expiresAt === undefined ? NaN : Date.parse(String(expiresAt));
      const expired = !Number.isFinite(parsedExpiry) || parsedExpiry <= Date.now();
      if (!receipt || typeof receipt !== 'object' || receipt.intent_id !== intent.intent_id || receipt.decision !== 'ALLOW' || expired) {
        if (options.onDecision) options.onDecision(clone(receipt || {}), clone(intent));
        throw new Error('Varyntiq decision is not an unexpired ALLOW (' + ((receipt && receipt.decision) || 'invalid') + ')');
      }
      // Observer callbacks are informational only. Give them detached copies so
      // they cannot mutate the canonical approval state used for signing.
      if (options.onDecision) options.onDecision(clone(receipt), clone(intent));
      if (performance.now() >= deadline) throw new Error('Varyntiq decision timed out before signing');
      if (!Number.isFinite(parsedExpiry) || parsedExpiry <= Date.now()) {
        throw new Error('Varyntiq decision expired before signing');
      }
      return sign({ intent: clone(intent), receipt: clone(receipt) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

