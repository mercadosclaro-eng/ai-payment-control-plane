# Varyntiq / AgentKit compatibility fixture

This fixture exercises the payer-side Varyntiq pre-sign boundary against the
same Base/x402 v2 shape observed from AgentKit issue #1521. It is deliberately
self-contained: it uses no wallet keys, credentials, signatures, settlement,
production customer data, or production funds.

The fixture covers:

- unchanged challenge terms -> `ALLOW` and the mock signer runs;
- changed amount or recipient -> `BLOCK` before signing;
- a policy requiring a human -> `REQUIRE_APPROVAL` before signing; and
- policy failure or invalid input -> `BLOCK` (fail closed).

Run it from the repository root with:

```text
node --test integrations/agentkit/varyntiq-agentkit.fixture.test.mjs
```

The fixture is a compatibility aid for AgentKit's proposed x402 action. It is
not an official AgentKit integration, a paid settlement, or evidence of
customer acceptance.

## Native provider harness bridge

The native-harness request from AgentKit issue #1521 is implemented in
`varyntiq-agentkit-native-bridge.mjs`. It accepts the same
`paymentRequired`, selected `accepts[]` entry, wallet, and parsed action args
that the native test already has. The injected `nativeAction` is the exact
AgentKit call:

```js
const nativeAction = ({ wallet, args }) =>
  automatonFirewallActionProvider({ maxAmountUnits: 20000 })
    .simulateAndGuardTransaction(wallet, args);
```

The bridge calls that action only after Varyntiq returns `ALLOW`; amount,
recipient, asset, network, resource, approval, or digest mismatches stop before
the provider action. It deliberately discards the guard's `signedInput` when
invoking `nativeAction`: AgentKit's provider owns those payment fields and
signs them inside `simulateAndGuardTransaction`, while its strict action
schema rejects extra keys. This preserves the payer-side pre-sign boundary.

The bridge and regression test are verified locally with:

```text
node --test integrations/agentkit/varyntiq-agentkit-native-bridge.test.mjs
```

These tests use no wallet keys, credentials, signatures, settlement, production
customer data, or production funds. Running inside AgentKit's repository still
requires the AgentKit checkout and its Jest toolchain.
