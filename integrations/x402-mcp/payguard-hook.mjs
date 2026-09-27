/** Compatibility entry point. New code must import ./varyntiq-hook.mjs. */
import { createVaryntiqPaymentHook } from "./varyntiq-hook.mjs";
export const createPayGuardPaymentHook = createVaryntiqPaymentHook;