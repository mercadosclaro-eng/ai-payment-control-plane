import { createPayGuardPaymentHook } from "./payguard-hook.mjs";

// Pass this hook to x402MCPClient's onPaymentRequested option.
// Keep PAYGUARD_CLIENT_TOKEN in the host process, not in model context.
export const onPaymentRequested = createPayGuardPaymentHook({
  token: process.env.PAYGUARD_CLIENT_TOKEN,
  agentId: "procurement-agent",
  resourceUrl: ({ paymentRequired }) => paymentRequired.resource?.url,
  contextFor: ({ toolName }) => ({
    source_trust: "untrusted",
    payment_requested_by_untrusted_content: true,
    untrusted_excerpt: `Tool ${toolName} requested an x402 payment`,
  }),
  onDecision: (receipt) => {
    console.info("PayGuard decision", receipt.decision, receipt.receipt_id);
  },
});

