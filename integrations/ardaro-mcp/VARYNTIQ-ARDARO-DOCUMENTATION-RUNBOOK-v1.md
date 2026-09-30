# Varyntiq x Ardaro - documentation review v1

Status: documentation-only proposal. No staging, credentials, signing, payment, production access or live execution is approved.

## Scope and source
Varyntiq returns an advisory pre-sign decision for one synthetic x402 intent. The host owns wallet and signer; Varyntiq never receives keys or settles funds. Reviewed source commit: 83286d26b7dd0c045ff1a24b1cbf1deffd06200a (publish-inflow).

## Contract separation
Varyntiq canonical intent is produced by mapArdaroRequestToIntent and includes intent_id, schema_version, agent_id, rail, amount_minor, amount_scale, currency, proposed_cost, payee, endpoint, policy, analysis_fee, x402 and context. The adapter checks receipt intent_id, decision=ALLOW and unexpired expires_at. It does not claim to validate intent_digest or reason_codes.

Ardaro advisory request: proposal.amountMinor, proposal.amountDecimals, proposal.currency; policy.currency, policy.max_per_transaction, policy.max_per_hour, policy.max_checks_per_minute; history.currency, history.committed_last_hour, history.pending_reserved, history.checks_last_minute.
Ardaro advisory response: contract_version=ardaro.agent-utilities.response.v1, service_id=ardaro.authorize_agent_spend, status=review_required, result.tool=authorize_agent_spend, result.authorization_status, with advisory, human review, payment, reservation and credential issuance explicit. It never authorizes signing or payment.

## Evidence
Command: node --test integrations/ardaro-mcp/varyntiq-ardaro.test.mjs integrations/ardaro-mcp/ardaro-mapping.fixture.test.mjs integrations/ardaro-mcp/ardaro-advisory.test.mjs
Result: 20 tests, 20 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo. Node 24.14.0; network disabled; no third-party runtime dependency; unsafe cases keep signer/payment counters at zero.

## Controls and limits
Implemented: input/URL/currency/amount/context validation, canonical mapping, receipt binding, ALLOW, expiry/deadline recheck, replay/changed-term mismatch handling, timeout and callback isolation; fixture fails closed before sign. Mocked: policy endpoint and signer callbacks. Prohibited/mock: settlement and fee payment; exercise fee is 0 USDC. Proposed host controls only: 24 hours or 100 intents, concurrency one, zero spend, allowlist, retention and kill switch. The fixture does not enforce cross-run quota/concurrency.

Ardaro must decide operator, backup, staging, endpoint, logging, retention, incident and final approval owners. No credentials, production data, signing or payment are requested. Documentation review is the only current gate.
