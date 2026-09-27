/** Compatibility entry point. New code must import ./varyntiq.ts. */
export {
  createVaryntiqPreSignGate as createPayGuardPreSignGate,
  type VaryntiqGateOptions as PayGuardGateOptions,
  type GateResult,
  type PreSignIntent,
} from "./varyntiq.ts";