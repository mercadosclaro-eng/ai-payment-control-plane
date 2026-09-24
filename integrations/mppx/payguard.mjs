/**
 * Private proof: authorize an mppx PreparedRequest before creating its payment
 * credential. The caller obtains `prepared` from mppx.prepareRequest().
 *
 * This adapter supports one-time MPP `charge` intents only. It never receives a
 * payment key and calls `payment.pay()` only after validating an ALLOW receipt.
 */

const DEFAULT_BASE_URL = "https://payguard-production-abfe.up.railway.app";

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function httpUrl(value, name) {
  const parsed = new URL(requiredText(value, name));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${name} must be an HTTP(S) URL`);
  }
  return parsed.toString();
}

function atomicAmount(value) {
  const raw = requiredText(String(value ?? ""), "challenge.request.amount");
  if (!/^\d+$/.test(raw)) throw new TypeError("challenge.request.amount must use atomic integer units");
  const amount = BigInt(raw);
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("challenge.request.amount is outside the supported range");
  }
  return { raw, minor: Number(amount) };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError("challenge contains a non-canonical value");
}

function selectedSnapshot(challenge, endpoint, currencyCode, rail) {
  if (!challenge || typeof challenge !== "object") throw new TypeError("prepared.payment.challenge is required");
  if (challenge.intent !== "charge") throw new TypeError("only MPP charge intents are supported");
  if (!challenge.request || typeof challenge.request !== "object") {
    throw new TypeError("challenge.request is required");
  }
  const amount = atomicAmount(challenge.request.amount);
  const challengeId = requiredText(challenge.id, "challenge.id");
  const method = requiredText(challenge.method, "challenge.method");
  const realm = requiredText(challenge.realm, "challenge.realm");
  const currencyId = requiredText(challenge.request.currency, "challenge.request.currency");
  const payee = requiredText(challenge.request.recipient, "challenge.request.recipient");
  return Object.freeze({
    intent: challenge.intent,
    challengeId,
    method,
    realm,
    challengeCanonical: canonicalJson(challenge),
    rawAmount: amount.raw,
    amountMinor: amount.minor,
    currencyId,
    currencyCode,
    payee,
    endpoint,
    rail,
  });
}

function snapshotMatches(challenge, snapshot) {
  try {
    const current = selectedSnapshot(
      challenge,
      snapshot.endpoint,
      snapshot.currencyCode,
      snapshot.rail,
    );
    return current.intent === snapshot.intent &&
      current.challengeId === snapshot.challengeId &&
      current.method === snapshot.method &&
      current.realm === snapshot.realm &&
      current.challengeCanonical === snapshot.challengeCanonical &&
      current.rawAmount === snapshot.rawAmount &&
      current.currencyId === snapshot.currencyId &&
      current.payee === snapshot.payee;
  } catch {
    return false;
  }
}

/**
 * @param {object} prepared Value returned by mppx.prepareRequest().
 * @param {object} options
 * @param {string} options.token Dedicated agent token, never the owner key.
 * @param {string} options.agentId Stable owner-configured agent identifier.
 * @param {string} options.currencyCode PayGuard policy currency, e.g. USD or USDC.
 * @param {string} options.currencyId Exact MPP currency identifier accepted by the owner.
 * @param {"http"|"mcp"=} options.rail
 * @param {object|(() => object)=} options.context Owner-derived causal context.
 * @param {string=} options.baseUrl
 * @param {number=} options.timeoutMs
 * @param {typeof fetch=} options.fetchImpl
 * @param {() => string=} options.intentId
 */
export async function authorizeAndPayPreparedRequest(prepared, options) {
  if (!prepared || typeof prepared !== "object") throw new TypeError("prepared request is required");
  if (!options || typeof options !== "object") throw new TypeError("options are required");
  if (!prepared.payment || typeof prepared.payment !== "object") {
    throw new TypeError("prepared request has no selected payment");
  }
  if (typeof prepared.payment.pay !== "function") throw new TypeError("prepared.payment.pay is required");

  const token = requiredText(options.token, "token");
  const agentId = requiredText(options.agentId, "agentId");
  const currencyCode = requiredText(options.currencyCode, "currencyCode").toUpperCase();
  const expectedCurrencyId = requiredText(options.currencyId, "currencyId");
  const rail = options.rail ?? "http";
  if (rail !== "http" && rail !== "mcp") throw new TypeError("rail must be http or mcp");
  const endpoint = httpUrl(prepared.request?.url, "prepared.request.url");
  const snapshot = selectedSnapshot(prepared.payment.challenge, endpoint, currencyCode, rail);
  if (snapshot.currencyId !== expectedCurrencyId) {
    throw new TypeError("MPP currency does not match the owner-configured currency identifier");
  }

  const baseUrl = httpUrl(options.baseUrl ?? DEFAULT_BASE_URL, "baseUrl").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 2500;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new TypeError("timeoutMs must be an integer from 100 to 30000");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
  const intentId = options.intentId ?? (() => globalThis.crypto.randomUUID());
  const ownerContext = typeof options.context === "function" ? options.context() : (options.context ?? {});
  if (!ownerContext || typeof ownerContext !== "object" || Array.isArray(ownerContext)) {
    throw new TypeError("context must be an object");
  }
  const challengeHash = await sha256(snapshot.challengeCanonical);

  const body = {
    intent_id: `mpp-${requiredText(intentId(), "intentId")}`,
    agent_id: agentId,
    rail,
    amount_minor: snapshot.amountMinor,
    currency: currencyCode,
    payee: snapshot.payee,
    endpoint: snapshot.endpoint,
    context: {
      ...ownerContext,
      integration: "mppx-prepared-request",
      mpp_intent: "charge",
      mpp_challenge_id: snapshot.challengeId,
      mpp_method: snapshot.method,
      mpp_realm: snapshot.realm,
      mpp_challenge_hash: challengeHash,
      mpp_currency_id: snapshot.currencyId,
      mpp_amount_atomic: snapshot.rawAmount,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/check`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok) throw new Error("PayGuard check failed");
  const receipt = await response.json();
  const endpointHash = await sha256(snapshot.endpoint);
  const matches = receipt?.decision === "ALLOW" &&
    receipt.intent_id === body.intent_id &&
    receipt.amount_minor === body.amount_minor &&
    receipt.currency === body.currency &&
    receipt.rail === body.rail &&
    receipt.payee_hash === await sha256(snapshot.payee.toLowerCase()) &&
    receipt.endpoint_hash === endpointHash &&
    typeof receipt.receipt_id === "string" && receipt.receipt_id.length > 0 &&
    typeof receipt.request_hash === "string" && receipt.request_hash.length > 0 &&
    typeof receipt.expires_at === "string" && Date.parse(receipt.expires_at) > Date.now();
  if (!matches) throw new Error("PayGuard did not return a matching ALLOW receipt");
  if (!snapshotMatches(prepared.payment.challenge, snapshot)) {
    throw new Error("selected MPP challenge changed during authorization");
  }

  return prepared.payment.pay();
}
