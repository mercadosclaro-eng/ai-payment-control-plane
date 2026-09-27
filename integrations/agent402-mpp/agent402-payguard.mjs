/** Compatibility entry point. New code must import ./agent402-varyntiq.mjs. */
import { createAgent402VaryntiqFetch } from "./agent402-varyntiq.mjs";
export const createAgent402PayGuardFetch = createAgent402VaryntiqFetch;