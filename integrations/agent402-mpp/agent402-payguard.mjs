import { authorizeAndPayPreparedRequest } from "../mppx/payguard.mjs";

const DEFAULT_ORIGIN = "https://agent402.tools";

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function endpointDetails(value, allowedOrigin) {
  const url = new URL(value);
  if (url.origin !== allowedOrigin) {
    throw new Error(`refusing payment outside ${allowedOrigin}`);
  }
  return {
    endpoint: url.toString(),
    route: url.pathname,
    tool: url.pathname.split("/").filter(Boolean).at(-1) ?? "unknown",
  };
}

/**
 * Creates a fetch compatible with agent402-client. It lets mppx discover the
 * live 402 challenge, then asks the control plane before mppx creates a payment
 * credential. Free responses pass through unchanged.
 */
export function createAgent402PayGuardFetch(options) {
  if (!options || typeof options !== "object") throw new TypeError("options are required");
  const mppx = options.mppx;
  if (!mppx || typeof mppx.prepareRequest !== "function") {
    throw new TypeError("mppx.prepareRequest is required");
  }
  const allowedOrigin = new URL(options.allowedOrigin ?? DEFAULT_ORIGIN).origin;
  const policy = {
    token: required(options.token, "token"),
    agentId: required(options.agentId, "agentId"),
    currencyCode: required(options.currencyCode, "currencyCode"),
    currencyId: required(options.currencyId, "currencyId"),
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    intentId: options.intentId,
  };

  return async function agent402PayGuardFetch(input, init) {
    const prepared = await mppx.prepareRequest(input, init);
    if (!prepared.payment) return prepared.response;

    const details = endpointDetails(prepared.request?.url, allowedOrigin);
    const ownerContext = typeof options.context === "function"
      ? options.context({ input, init, prepared, ...details })
      : (options.context ?? {});
    if (!ownerContext || typeof ownerContext !== "object" || Array.isArray(ownerContext)) {
      throw new TypeError("context must resolve to an object");
    }

    return authorizeAndPayPreparedRequest(prepared, {
      ...policy,
      rail: "http",
      context: {
        ...ownerContext,
        provider: "agent402.tools",
        agent402_route: details.route,
        agent402_tool: details.tool,
        request_method: prepared.request?.method ?? "GET",
      },
    });
  };
}

