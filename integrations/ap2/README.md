# Varyntiq adapter demo for AP2 settlement reconciliation

This no-funds example addresses the failure described in [AP2 issue #308](https://github.com/google-agentic-commerce/AP2/issues/308): a payment token must not be marked as consumed before settlement is confirmed.

The example places Varyntiq's `ALLOW`/`BLOCK` decision before the settlement call and commits `used`, `order_id`, and the charged amount only after the provider returns `confirmed: true`. A failed or uncertain settlement leaves the token available for a safe retry and records a receipt that does not claim payment success.

It is a small independent example, not an official AP2 integration. It uses no private keys, customer data, network calls, or real funds.

Run the test with:

```sh
node --test reconciliation_guard.test.mjs
```
