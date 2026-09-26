const DEFAULT_BASE_URL = "https://payguard-production-abfe.up.railway.app";

function text(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function httpUrl(value, name) {
  const parsed = new URL(text(value, name));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${name} must be an HTTP(S) URL`);
  }
  return parsed.toString();
}

function minorUnits(value) {
  const raw = text(String(value ?? ""), "selectedRequirements.amount");
  if (!/^\d+$/.test(raw)) throw new TypeError("amount must use base-10 minor units");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("amount must be a positive safe integer");
  }
  return parsed;
}

function resourceUrl(paymentRequired) {
  const resource = paymentRequired?.resource;
  if (typeof resource === "string") return httpUrl(resource, "paymentRequired.resource");
  return httpUrl(resource?.url, "paymentRequired.resource.url");
}

/**
 * Creates an InFlow `onBeforePaymentCreation` hook backed by Varyntiq.
 * Any ambiguous result aborts before the InFlow signer runs.
 */
export function createVaryntiqInflowHook(options) {
  if (!options || typeof options !== "object") throw new TypeError("options are required");
  const token = text(options.token, "token");
  const agentId = text(options.agentId, "agentId");
  const baseUrl = httpUrl(options.baseUrl ?? DEFAULT_BASE_URL, "baseUrl").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 2500;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new TypeError("timeoutMs must be between 100 and 30000");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");

  return async function varyntiqBeforePaymentCreation({ paymentRequired, selectedRequirements }) {
    try {
      const requirement = selectedRequirements;
      if (!requirement || typeof requirement !== "object") {
        return { abort: true, reason: "Varyntiq: missing selected payment requirement" };
      }

      const endpoint = resourceUrl(paymentRequired);
      const extraContext = options.contextFor?.({ paymentRequired, selectedRequirements: requirement }) ?? {};
      if (typeof extraContext !== "object" || Array.isArray(extraContext)) {
        return { abort: true, reason: "Varyntiq: invalid integration context" };
      }

      const intent = {
        intent_id: `inflow-${crypto.randomUUID()}`,
        agent_id: agentId,
        rail: "x402",
        amount_minor: minorUnits(requirement.amount),
        currency: String(requirement.extra?.name ?? "USDC").toUpperCase(),
        payee: text(requirement.payTo, "selectedRequirements.payTo"),
        endpoint,
        x402: {
          amount: String(requirement.amount),
          payTo: requirement.payTo,
          network: text(requirement.network, "selectedRequirements.network"),
          asset: text(requirement.asset, "selectedRequirements.asset"),
          resource: { url: endpoint },
        },
        context: {
          integration: "inflow-x402-buyer",
          ...extraContext,
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

      if (!response?.ok) return { abort: true, reason: "Varyntiq unavailable" };
      const decision = await response.json();
      if (!decision || decision.intent_id !== intent.intent_id) {
        return { abort: true, reason: "Varyntiq receipt mismatch" };
      }
      options.onDecision?.(decision, intent);
      if (decision.decision === "ALLOW") return { abort: false };
      return { abort: true, reason: `Varyntiq: ${decision.decision ?? "invalid decision"}` };
    } catch {
      return { abort: true, reason: "Varyntiq check failed closed" };
    }
  };
}
