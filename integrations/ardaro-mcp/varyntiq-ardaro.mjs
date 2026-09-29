/**
 * Varyntiq pre-sign guard for Ardaro's authorize_agent_spend boundary.
 *
 * This adapter is intentionally provider-neutral: Ardaro (or another
 * runtime) supplies the signer, while Varyntiq decides whether signing may
 * happen. Keys, funds and settlement remain outside this module.
 */

const DEFAULT_BASE_URL = process.env.VARYNTIQ_BASE_URL || 'https://varyntiq-production-production.up.railway.app';

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
    const context = request.context == null ? {} : request.context;
    if (context === null || typeof context !== 'object' || Array.isArray(context)) {
      throw new TypeError('context must be an object');
    }
    const reservedContextKeys = ['ardaro_tool', 'nonce', 'limits'];
    const collisions = reservedContextKeys.filter(function (key) { return Object.prototype.hasOwnProperty.call(context, key); });
    if (collisions.length) {
      throw new TypeError('context contains reserved fields: ' + collisions.join(', '));
    }

    const intent = {
      intent_id: 'ardaro-' + crypto.randomUUID(),
      agent_id: agentId,
      rail: 'x402',
      amount_minor: amountMinor(request.amountMinor),
      currency: text(request.currency || 'USDC', 'currency').toUpperCase(),
      payee: text(request.payTo, 'payTo'),
      endpoint: httpUrl(request.resourceUrl, 'resourceUrl'),
      x402: {
        amount: String(request.amountMinor),
        payTo: text(request.payTo, 'payTo'),
        network: text(request.network, 'network'),
        asset: text(request.asset, 'asset'),
        nonce: text(request.nonce, 'nonce'),
        resource: { url: httpUrl(request.resourceUrl, 'resourceUrl') },
      },
      context: Object.assign({
        ardaro_tool: 'authorize_agent_spend',
        nonce: text(request.nonce, 'nonce'),
        limits: request.limits || {},
      }, context),
    };

    const controller = new AbortController();
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
        if (options.onDecision) options.onDecision(receipt || {}, intent);
        throw new Error('Varyntiq decision is not an unexpired ALLOW (' + ((receipt && receipt.decision) || 'invalid') + ')');
      }
      if (options.onDecision) options.onDecision(receipt, intent);
      return sign({ intent: intent, receipt: receipt });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
