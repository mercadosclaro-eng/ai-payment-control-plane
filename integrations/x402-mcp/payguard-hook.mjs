/**
 * Fail-closed PayGuard adapter for @x402/mcp's onPaymentRequested hook.
 *
 * The hook runs before an x402 payment payload is created or signed. It sends
 * only the proposed public payment terms and caller-supplied risk context to
 * PayGuard. It never receives a wallet key or signs a payment.
 */

const DEFAULT_BASE_URL = "https://payguard-production-abfe.up.railway.app";

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function absoluteHttpUrl(value, name) {
  const text = requireText(value, name);
  const parsed = new URL(text);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL`);
  }
  return parsed.toString();
}

function positiveSafeInteger(value, name) {
  const text = requireText(String(value ?? ""), name);
  if (!/^\d+$/.test(text)) throw new TypeError(`${name} must contain base-10 minor units`);
  const amount = Number(text);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError(`${name} must fit a positive JavaScript safe integer`);
  }
  return amount;
}

/**
 * @typedef {Object} PayGuardHookOptions
 * @property {string} token Dedicated PayGuard client token for this agent.
 * @property {string} agentId Stable non-secret identifier for this agent.
 * @property {string|((request: object) => string)} resourceUrl HTTPS service URL being paid.
 * @property {(input: {toolName: string, paymentRequired: object}) => object=} contextFor
 * @property {(receipt: object, intent: object) => void=} onDecision
 * @property {(accepts: object[]) => object=} selectRequirement
 * @property {string=} baseUrl
 * @property {number=} timeoutMs
 * @property {typeof fetch=} fetchImpl
 */

/**
 * Create an async hook compatible with x402MCPClient({ onPaymentRequested }).
 * Any timeout, network failure, malformed response, or non-ALLOW decision
 * returns false so the wallet does not sign.
 *
 * @param {PayGuardHookOptions} options
 */
export function createPayGuardPaymentHook(options) {
  if (!options || typeof options !== "object") throw new TypeError("options are required");
  const token = requireText(options.token, "token");
  const agentId = requireText(options.agentId, "agentId");
  const baseUrl = absoluteHttpUrl(options.baseUrl ?? DEFAULT_BASE_URL, "baseUrl").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 2500;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new TypeError("timeoutMs must be an integer between 100 and 30000");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
  const selectRequirement = options.selectRequirement ?? ((accepts) => accepts[0]);

  return async function onPaymentRequested({ toolName, paymentRequired }) {
    try {
      const accepts = paymentRequired?.accepts;
      if (!Array.isArray(accepts) || accepts.length === 0) return false;
      const requirement = selectRequirement(accepts);
      if (!requirement || typeof requirement !== "object") return false;

      const endpointSource = typeof options.resourceUrl === "function"
        ? options.resourceUrl({ toolName, paymentRequired, requirement })
        : options.resourceUrl;
      const endpoint = absoluteHttpUrl(endpointSource, "resourceUrl");
      const amountMinor = positiveSafeInteger(requirement.amount, "requirement.amount");
      const payee = requireText(requirement.payTo, "requirement.payTo");
      const network = requireText(requirement.network, "requirement.network");
      const asset = requireText(requirement.asset, "requirement.asset");
      const currency = String(requirement.extra?.name ?? "USDC").toUpperCase();

      const suppliedContext = options.contextFor?.({ toolName, paymentRequired, requirement }) ?? {};
      if (!suppliedContext || typeof suppliedContext !== "object" || Array.isArray(suppliedContext)) {
        return false;
      }

      const intent = {
        intent_id: `x402-${crypto.randomUUID()}`,
        agent_id: agentId,
        rail: "x402",
        amount_minor: amountMinor,
        currency,
        payee,
        endpoint,
        x402: {
          amount: String(requirement.amount),
          payTo: payee,
          network,
          asset,
          resource: { url: endpoint },
        },
        context: {
          tool_name: String(toolName ?? ""),
          ...suppliedContext,
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
          body: JSON.stringify(intent),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response?.ok) return false;
      const receipt = await response.json();
      if (!receipt || typeof receipt !== "object" || receipt.intent_id !== intent.intent_id) return false;
      options.onDecision?.(receipt, intent);
      return receipt.decision === "ALLOW";
    } catch {
      return false;
    }
  };
}

