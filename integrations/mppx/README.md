# PayGuard adapter for mppx 0.11.0

This adapter places an independent PayGuard decision between `mppx.prepareRequest()` and `PreparedRequest.payment.pay()`.

It supports one-time MPP `charge` intents. The adapter binds the authorization to the exact effective request URL and a canonical SHA-256 digest of the complete selected challenge. It calls `payment.pay()` only after a matching, unexpired `ALLOW` receipt.

It fails closed for `BLOCK`, `REQUIRE_APPROVAL`, sessions, subscriptions, unknown currencies, invalid amounts, missing recipients, timeouts, transport failures, malformed or mismatched receipts, and a changed challenge.

The MPP account, private key and generated credential remain inside `mppx`. Give the adapter a dedicated PayGuard client token, never an owner or administration credential.

## Use

```js
import { Mppx, tempo } from "mppx/client";
import { authorizeAndPayPreparedRequest } from "./payguard.mjs";

const mppx = Mppx.create({
  methods: [tempo({ account })],
  polyfill: false,
});

const prepared = await mppx.prepareRequest(
  "https://merchant.example/resource",
  undefined,
  { requirePayment: true },
);

const response = await authorizeAndPayPreparedRequest(prepared, {
  token: process.env.PAYGUARD_CLIENT_TOKEN,
  agentId: "agent-1",
  currencyCode: "USD",
  currencyId: "0x20c0000000000000000000000000000000000000",
  context: {
    source_trust: "owner-configured",
    purpose: "premium resource",
  },
});
```

The owner must configure `currencyCode` and its exact MPP `currencyId`. The adapter never infers currency decimals or foreign exchange.

## Verification

```text
node --test payguard.test.mjs
```

The adapter also passed a separate runtime test against the official npm package `mppx@0.11.0`: the published `prepareRequest()` path created no paid retry before `ALLOW`, and none for `BLOCK` or `REQUIRE_APPROVAL`.

Compatibility is limited to the tested one-time charge flow. No session, subscription, endorsement or standards status is claimed.
