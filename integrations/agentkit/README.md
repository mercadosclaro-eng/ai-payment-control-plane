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
