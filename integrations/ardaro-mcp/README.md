# Varyntiq × Ardaro fixture

This is a no-funds compatibility fixture for Ardaro's `authorize_agent_spend` boundary. It evaluates the complete x402 intent before the host runtime calls its signer. Keys and funds remain with the host application.

Run locally:

~~~bash
node --test integrations/ardaro-mcp/varyntiq-ardaro.test.mjs
~~~

Run the no-funds demo:

~~~bash
node integrations/ardaro-mcp/varyntiq-ardaro-demo.mjs
~~~

The demo exercises an equal-limit ALLOW plus above-limit, recipient-mismatch and nonce-reuse BLOCK cases. It prints mock signer/payment counters and always reports `fundsMoved: false`.

The adapter fixture has 12/12 passing tests. It proves that only a matching, unexpired `ALLOW` reaches `sign`; `BLOCK`, `REQUIRE_APPROVAL`, missing or expired expiry, changed receipts, malformed output, transport failure, response-body timeout, reserved-context collisions, limit boundaries, nonce reuse and payee/resource/network mismatches fail closed. The final boundary also rechecks the deadline and expiry immediately before signing, and observer callbacks receive detached copies so they cannot mutate the canonical approval state. A separate four-test offline mapping fixture makes the request contract concrete. Run both together for 16/16 tests. It keeps signing and payment mocked and counts both calls. It does not call Ardaro's paid endpoint and does not move money.

The adapter maps the host request explicitly: amount, currency, payee, resource URL, network, asset and nonce are copied into the canonical Varyntiq intent and its x402 section. `proposed_cost` carries whole-currency decimal amount, currency, scale and original minor units. `policy` records the advisory pre-sign scope, version and history. `analysis_fee` is explicit and separate from the proposed spend. `context.ardaro_tool` is fixed to `authorize_agent_spend`; callers cannot overwrite reserved control fields.

The fixture protects the downstream x402 signing boundary. Ardaro's analysis-fee call is intentionally free/mocked in this review. If that fee is later paid, it must be a separate intent guarded by the same pre-sign check.

For a first pilot, use a Node 24 agent runtime with an operator-managed wallet/facilitator. Varyntiq remains non-custodial and never receives keys or funds.

Ardaro's free fixed reference for the review is `https://agents.getardaro.com/v1/agent-utilities/budget-check/example`. The public context is [mcpso issue #4480](https://github.com/chatmcp/mcpso/issues/4480).
