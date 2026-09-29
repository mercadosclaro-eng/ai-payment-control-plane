# Varyntiq × Ardaro: pilot runbook

This runbook is the shortest safe path from the no-funds fixture to a controlled
external evaluation. It keeps Ardaro's signer, wallet and settlement outside
Varyntiq. Varyntiq receives an intent and returns a decision; it never receives
private keys and never moves funds.

## 1. Verify the fixture locally

Use Node 24 or newer:

~~~bash
node --test integrations/ardaro-mcp/varyntiq-ardaro.test.mjs
node integrations/ardaro-mcp/varyntiq-ardaro-demo.mjs
~~~

The expected result is 9/9 tests passing. The demo must report:

~~~text
fundsMoved: false
~~~

The demo covers an equal-limit allow, an above-limit block, recipient and
resource mismatches, and nonce replay. It does not call a paid endpoint.

## 2. Insert the guard immediately before signing

Wrap the existing Ardaro signing callback with createArdaroPreSignGuard. Pass
the complete payment intent, including:

- amount and currency;
- payee, resource URL, network and asset;
- a fresh, single-use nonce; and
- the limits supplied by the operator.

Only an ALLOW receipt whose intent_id matches the request and whose expires_at
is still in the future may reach the signer. Any timeout, transport failure,
malformed response, missing expiry, changed payment term, reused nonce or
mismatch must stop before signing.

## 3. Run a no-funds canary

Use Ardaro's free fixed reference or a provider-owned mock endpoint. Keep the
signer and payment callback mocked. Record only the following evidence:

1. the canonical intent fields received by Varyntiq;
2. the decision and expiry returned;
3. whether the sign callback ran; and
4. the final fundsMoved counter.

Do not send wallet keys, customer data, secrets or production payment details.

## 4. Acceptance criteria for a first pilot

The pilot is accepted when the operator can reproduce all of these outcomes:

- equal or lower amount: ALLOW reaches the mock signer;
- above the configured limit: BLOCK, signer is not called;
- wrong payee, resource or network: BLOCK, signer is not called;
- reused nonce: first request may allow, replay is BLOCK;
- expired or missing receipt expiry: BLOCK;
- delayed response body beyond the deadline: BLOCK;
- no private key or funds is ever present in Varyntiq logs; and
- the complete canary finishes with fundsMoved: false.

These criteria demonstrate the integration boundary. They are not a claim of
customer adoption, production approval or independent security certification.

## 5. Rollback

Disable the wrapper at the host application's feature flag or revert the
integration commit. The host signer remains the owner of keys and funds, so
rollback does not require moving assets or changing wallets.

## Evidence to send to an evaluator

Share the test command, the redacted decision log and the demo counters. Keep
tokens, wallet addresses used in production, customer identifiers and private
architecture out of the evidence bundle.
