# Varyntiq for InFlow x402 buyers

This reference adapter connects Varyntiq to the `onBeforePaymentCreation` hook in `@inflowpayai/x402-buyer`. The hook runs after InFlow selects a payment requirement and before its managed signer creates a payment payload.

`ALLOW` lets payment creation continue. `BLOCK`, `REQUIRE_APPROVAL`, timeouts, network failures and malformed receipts abort before signing. Varyntiq never receives a wallet key and cannot sign or settle a payment.

## Five-minute trial

1. Create an independent free client token with `POST https://payguard-production-abfe.up.railway.app/register`.
2. Keep the returned administration credential outside the agent and model.
3. Set the client token in the host process as `VARYNTIQ_CLIENT_TOKEN`.
4. Register the hook on the InFlow client:

```js
import { createInflowClient } from "@inflowpayai/x402-buyer";
import { createVaryntiqInflowHook } from "./varyntiq-inflow.mjs";

const client = await createInflowClient(inflowOptions);

client.onBeforePaymentCreation(createVaryntiqInflowHook({
  token: process.env.VARYNTIQ_CLIENT_TOKEN,
  agentId: "procurement-agent",
  contextFor: () => ({ purpose: "approved supplier purchase" }),
}));
```

Use the hook only with an InFlow release that includes the managed-payment lifecycle-hook correction merged in [inflowpayai/inflow-node#67](https://github.com/inflowpayai/inflow-node/pull/67).

## Verify locally

```sh
node --test varyntiq-inflow.test.mjs
```

The test pack proves explicit `ALLOW`, `BLOCK`, `REQUIRE_APPROVAL`, invalid input, network failure and mismatched-receipt behavior without creating a wallet or moving money.

This is an independent compatibility example. InFlow has not adopted or endorsed Varyntiq.
