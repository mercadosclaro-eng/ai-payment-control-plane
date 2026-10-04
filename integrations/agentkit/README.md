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

## Exact upstream schema conformance

The separate `varyntiq-agentkit-schema.test.mjs` suite imports the actual
Automaton provider schema from commit
`29ab0dcaa8d642126695c1330025afc2fa3bd80c` of
`baianomarceloeduardo-jpg/agentkit`, path
`typescript/agentkit/src/action-providers/automatonFirewall/schemas.ts`.
It verifies the original Git blob SHA
`566ddacb9edb350b51353e74e4d16e0271f2b95d` before importing the file.
The source is downloaded unchanged as `schemas.mjs` (it contains ordinary JavaScript).
No reconstructed local validator is substituted.

The dedicated **AgentKit schema conformance** workflow downloads the pinned
schema and installs test-only `zod@4.4.3`, compatible with the provider's
declared `^4.3.6` range. Setup requires network access; the test cases do not
make network requests, sign transactions, or use funds.

To reproduce with Node 24+ and Python 3.12+, from the repository root run:

```sh
python integrations/agentkit/run-pinned-conformance.py
```

The runner creates a fresh temporary package directory, downloads the exact
schema and Zod 4.4.3 archive, and verifies their Git blob and SHA-512 pins before
importing or extracting them. It does not run npm, inherit a parent npm project,
or execute package lifecycle scripts. The temporary directory is removed after
the test process exits. Setup needs network access; tests use test doubles.

All five keys (`targetContract`, `calldata`, `fromAddress`, `valueWei`,
`tokenAddress`) must be present. Nullable values are explicit, and parsing
applies the upstream defaults before invocation. The tests cover missing keys,
unexpected payment fields, an incorrectly wrapped payload, invalid address,
and policy BLOCK / REQUIRE_APPROVAL with zero native calls.

Validation is a caller responsibility in this harness, before invoking the
bridge. The bridge does not silently acquire provider schema validation.
The native action and wallet remain test doubles: these are schema conformance
and boundary tests, not an end-to-end provider run, external adoption or payment evidence.

The schema pin proves conformance to exact source bytes, not compatibility with
future schema changes. Any byte change deliberately fails the pin check.

