# Agent402 + MPP payment control

This reference integration adds an independent policy decision immediately before an Agent402 buyer signs an MPP payment. It composes with Agent402's amount caps and idempotency controls; it does not replace them.

The wrapper lets `mppx` read the live `402 Payment Required`, sends the selected one-time charge and owner-supplied context to the AI Payment Control Plane, and calls `payment.pay()` only after a matching, unexpired `ALLOW` receipt. `BLOCK`, `REQUIRE_APPROVAL`, network failure, a changed challenge, or a seller-origin substitution produce no payment credential.

No wallet key is sent to the control plane. The integration accepts only `https://agent402.tools` by default and only the one-time MPP `charge` flow supported by the underlying adapter.

## Use with agent402-client

```js
import { Agent402 } from "agent402-client";
import { Mppx, tempo, evm } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { createAgent402PayGuardFetch } from "./agent402-payguard.mjs";

const account = privateKeyToAccount(process.env.AGENT_KEY);
const mppx = Mppx.create({
  methods: [tempo.charge({ account }), evm.charge({ account })],
  polyfill: false,
});

const guardedFetch = createAgent402PayGuardFetch({
  mppx,
  token: process.env.PAYGUARD_CLIENT_TOKEN, // dedicated client token, never owner key
  agentId: "research-agent-1",
  currencyCode: "USDC",
  currencyId: process.env.MPP_CURRENCY_ID,  // exact identifier approved by the owner
  context: ({ tool }) => ({
    purpose: `Agent402 tool: ${tool}`,
    source_trust: "owner-configured",
    user_approved_workflow: "research",
  }),
});

const agent402 = new Agent402({
  fetch: guardedFetch,
  maxPerCallUsd: 0.05,
  dailyLimitUsd: 1.00,
  maxPerHostUsd: 1.00,
});

const result = await agent402.call("uuid", {}, { cache: false });
console.log(result);
```

Keep Agent402's native caps enabled. The control plane supplies the separate contextual decision and audit receipt.

## Verification

```text
node --test agent402-payguard.test.mjs
```

The live URL `https://agent402.tools/api/uuid` was also probed without a wallet and returned `402 Payment Required`. No payment was attempted during validation. Agent402 has not endorsed or adopted this reference integration.

