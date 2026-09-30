/**
 * Adapter for placing Varyntiq immediately before AgentKit's native action.
 *
 * The native action is injected so this module stays independent of an
 * AgentKit checkout. In AgentKit's provider harness, `nativeAction` should be
 * the call to `simulateAndGuardTransaction(wallet, args)`. Varyntiq receives
 * the exact x402 challenge that led to that call and is the only code allowed
 * to invoke the action after an ALLOW decision.
 */
export function createVaryntiqAgentKitNativeBridge({ guard, nativeAction }) {
  if (!guard || typeof guard.beforeSign !== "function") {
    throw new TypeError("guard.beforeSign must be a function");
  }
  if (typeof nativeAction !== "function") {
    throw new TypeError("nativeAction must be a function");
  }

  return async function invokeNativeWithVaryntiq({
    wallet,
    args,
    paymentRequired,
    selectedRequirements,
    resource,
    context = {},
    approvedRequestDigest,
  }) {
    return guard.beforeSign({
      approvedRequestDigest,
      paymentRequired,
      selectedRequirements,
      resource,
      context: { ...context, integration: "agentkit-native" },
      sign: (signedInput) => nativeAction({ wallet, args, ...signedInput }),
    });
  };
}
