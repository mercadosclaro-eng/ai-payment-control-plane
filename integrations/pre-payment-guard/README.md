# Varyntiq pre-payment guard

This fixture implements the boundary discussed in x402 #2533: the payer selects one immutable `PaymentRequirements` entry, Varyntiq evaluates that exact entry, and the hook runs before payload construction or signing.

The guard is payer-local and non-custodial. It never receives wallet keys, creates payment payloads, signs, or settles funds.

Every result contains a stable `request_digest`, a decision (`ALLOW`, `BLOCK`, or `REQUIRE_APPROVAL`), and reason codes. Only `ALLOW` reaches the supplied signer. Missing input, policy failures, malformed decisions, or changed selected requirements fail closed.

The guard takes one detached snapshot before policy evaluation, gives the policy a separate copy, and sends detached copies of that same snapshot to the signer. Caller or policy mutations therefore cannot change the terms that were evaluated.

Run the no-funds fixture with:

```text
node --test integrations/pre-payment-guard/varyntiq-pre-payment-guard.test.mjs
```
The fixture has seven network-free tests, including mutation-during-policy and
policy-mutation cases.
