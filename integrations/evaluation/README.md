# Independent live evaluation

This dependency-free Node.js script lets an external integrator verify Varyntiq's public control path without receiving engine code, policy thresholds or owner credentials.

It checks:

- public HTTPS health;
- an isolated free tenant with separate agent and administration credentials;
- a request-bound baseline receipt;
- `BLOCK` plus a machine-readable reason for a prompt-injection-driven payment;
- separate one-time x402 nonces for each evaluated intent;
- idempotent retry behavior;
- the tenant's audit-chain status and usage meter.

The repository also includes a no-network conformance proof. It generates an ephemeral ECDSA key, signs five decision receipts, verifies each receipt and proves that changing the intent makes verification fail.

The script keeps both one-time credentials in memory and never prints them. It never receives wallet keys and never signs or sends a payment.

## Run

Use Node.js 18 or newer:

```sh
node evaluate-varyntiq.mjs --live
```

The explicit `--live` flag is required because a run creates one isolated free evaluation tenant and consumes two of its 100 monthly checks. Do not use production prompts, customer data, wallet details, private keys or other secrets in an evaluation.

Successful output contains only the client ID, decisions, reason codes and completed check names. It never contains either credential.

## Test locally without calling the service

```sh
node demo-conformance.mjs
node --test evaluate-varyntiq.test.mjs
node --test demo-conformance.test.mjs
```

The mock tests verify the successful path, refusal of an unsafe `ALLOW`, receipt binding, credential redaction and tamper rejection. The conformance proof is local only; it does not claim that a production service has been externally adopted.

