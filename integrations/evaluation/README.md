# Independent live evaluation

This dependency-free Node.js script lets an external integrator verify PayGuard's public control path without receiving engine code, policy thresholds or owner credentials.

It checks:

- public HTTPS health;
- an isolated free tenant with separate agent and administration credentials;
- a request-bound baseline receipt;
- `BLOCK` plus a machine-readable reason for a prompt-injection-driven payment;
- idempotent retry behavior;
- the tenant's audit-chain status and usage meter.

The script keeps both one-time credentials in memory and never prints them. It never receives wallet keys and never signs or sends a payment.

## Run

Use Node.js 18 or newer:

```sh
node evaluate-live.mjs --live
```

The explicit `--live` flag is required because a run creates one isolated free evaluation tenant and consumes two of its 100 monthly checks. Do not use production prompts, customer data, wallet details, private keys or other secrets in an evaluation.

Successful output contains only the client ID, decisions, reason codes and completed check names. It never contains either credential.

## Test locally without calling the service

```sh
node --test evaluate-live.test.mjs
```

The mock tests verify the successful path, refusal of an unsafe `ALLOW`, receipt binding and credential redaction.

