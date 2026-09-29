import { createHash } from "node:crypto";

const DECISIONS = new Set(["ALLOW", "BLOCK", "REQUIRE_APPROVAL"]);

function clone(value) {
  return structuredClone(value);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function normalizedInput({ paymentRequired, selectedRequirements, resource, context = {} }) {
  requireObject(paymentRequired, "paymentRequired");
  requireObject(selectedRequirements, "selectedRequirements");
  requireObject(context, "context");

  const input = {
    payment_required: clone(paymentRequired),
    selected_requirements: clone(selectedRequirements),
    resource: resource ?? paymentRequired.resource ?? null,
    context: clone(context),
  };
  return { input, request_digest: digest(input) };
}

function decisionRecord({ decision, reasonCodes, requestDigest }) {
  return {
    version: "varyntiq-pre-payment-decision-v1",
    decision,
    reason_codes: [...reasonCodes],
    request_digest: requestDigest,
  };
}

function blocked(reason, requestDigest = null) {
  return {
    ...decisionRecord({ decision: "BLOCK", reasonCodes: [reason], requestDigest }),
    sign_allowed: false,
  };
}

/**
 * Payer-local pre-sign guard for the selected x402 PaymentRequirements entry.
 * It never receives keys, creates a payment payload, signs, or settles funds.
 */
export function createVaryntiqPrePaymentGuard({ policy }) {
  if (typeof policy !== "function") throw new TypeError("policy must be a function");

  async function evaluate(input) {
    let prepared;
    try {
      prepared = normalizedInput(input);
    } catch {
      return blocked("invalid_payment_input");
    }

    let result;
    try {
      result = await policy(prepared.input);
    } catch {
      return blocked("policy_failure", prepared.request_digest);
    }

    if (!result || !DECISIONS.has(result.decision) || (result.reason_codes !== undefined && !Array.isArray(result.reason_codes))) {
      return blocked("malformed_decision", prepared.request_digest);
    }

    const reasonCodes = result.reason_codes ?? [];
    return {
      ...decisionRecord({ decision: result.decision, reasonCodes, requestDigest: prepared.request_digest }),
      sign_allowed: result.decision === "ALLOW",
    };
  }

  async function beforeSign({ approvedRequestDigest, sign, ...input }) {
    const result = await evaluate(input);
    if (approvedRequestDigest && approvedRequestDigest !== result.request_digest) {
      return blocked("payment_requirements_changed", result.request_digest);
    }
    if (result.decision !== "ALLOW") return result;
    if (typeof sign !== "function") return blocked("signer_missing", result.request_digest);

    const signed = await sign({
      paymentRequired: input.paymentRequired,
      selectedRequirements: input.selectedRequirements,
      resource: input.resource,
      requestDigest: result.request_digest,
    });
    return { ...result, signed, sign_called: true };
  }

  return { evaluate, beforeSign };
}

