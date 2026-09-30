# Varyntiq x Ardaro — documentation review runbook v1

**Status:** documentation-only proposal. This document does not approve staging, credentials, signing, payment, production access or live execution.

## Purpose and evidence

The bounded behavior is Varyntiq's advisory pre-sign decision for one synthetic x402 payment intent. Ardaro remains the owner of the wallet and signer. Varyntiq never receives keys, creates a payment credential or settles funds.

Pass/fail criteria:

- unchanged, fresh intent can produce ALLOW for the mock signer;
- changed amount, payee, resource, network or nonce reuse produces BLOCK;
- REQUIRE_APPROVAL, missing or expired receipts, malformed responses, policy failure and timeout fail closed;
- signer and payment counters remain zero for every unsafe case.

Reviewed source commit: 83286d26b7dd0c045ff1a24b1cbf1deffd06200a0.

- CI evidence: https://github.com/mercadosclaro-eng/ai-payment-control-plane/actions/runs/36637190961
- Runtime: Node 24.14.0, network disabled.
- Dependency provenance: Node built-in test runner and repository lockfiles; no third-party runtime dependency is required.
- Container image: none proposed. If Ardaro later requires one, Ardaro must pin and approve its immutable digest.

## Proposed schema and synthetic fixtures

The request contains intent_id, amount and currency, payee, resource URL, network, asset, a fresh nonce and operator-supplied limits. The response contains decision, receipt_id, expires_at, the bound intent digest and reason codes. An advisory response never authorizes signing or payment.

The public fixture at integrations/ardaro-mcp/varyntiq-ardaro.test.mjs covers equal-limit allow, above-limit block, payee/resource/network mismatch, nonce replay, missing or expired expiry, changed terms, malformed output, transport failure, response-body timeout, observer deadline and mutation isolation. varyntiq-ardaro-demo.mjs reports fundsMoved: false.

## Environment and people

Varyntiq specifies the synthetic data boundary, request/response schema, fail-closed behavior, receipt binding and test evidence above.

Ardaro decisions — TBD: named operator, backup operator, staging environment, allowlisted endpoint, storage/logging location, retention and deletion owner, incident contact and final approval owner.

The proposed environment is Ardaro-controlled and isolated, with no production credentials, wallet keys, unrestricted signer or customer data. Permitted network destinations and data classes remain TBD until Ardaro assigns an owner.

## State, authorization and limits

Ardaro owns policy history, pending reservations, replay/idempotency state, reconciliation, credential scope and revocation. Varyntiq returns an advisory decision and receipt only. A live signer or payment path is never invoked by the advisory response itself.

Proposed synthetic limits: 24 hours or 100 intents, whichever comes first; concurrency one; zero spend per action, hour, day and total; no production currency, asset, payee or settlement. Endpoint, network allowlist and any service-fee treatment are TBD and require Ardaro's written decision.

## Audit, shutdown and closeout

Record decision ID, exact intent digest, policy result, receipt status, timestamps, failure reason, test case and signer/payment counters. Propose 30-day staging retention only if Ardaro approves it.

Stop automatically on an unexpected signer/payment call, receipt mismatch, replay acceptance, data-boundary violation or limit breach. Ardaro must have an independent manual kill switch, credential revocation and rollback. Closeout is the pinned manifest, redacted configuration, event JSONL, aggregate pass/fail results, stop/cleanup evidence and operator sign-off.


## Approval matrix

| Action | Current status |
| --- | --- |
| Documentation review | Requested now |
| Name operator, backup and owners | Ardaro TBD |
| Provision isolated staging | Not approved |
| Issue credentials | Not approved |
| Execute synthetic window | Not approved |
| Signing, payment or production access | Not requested; requires Brent's explicit approval |
| Closeout and retention | Ardaro TBD |

Submission starts technical review only. It grants no access, credentials, provisioning, live execution, signing or payment authority.
