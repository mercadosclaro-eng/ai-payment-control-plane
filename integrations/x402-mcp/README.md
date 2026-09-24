# PayGuard hook for `@x402/mcp`

This small adapter connects PayGuard to the official `onPaymentRequested` hook documented by x402. It runs after a paid MCP tool returns payment requirements and before a wallet constructs or signs a payment payload.

It is intentionally fail-closed:

- `ALLOW` returns `true` to the x402 client.
- `BLOCK` and `REQUIRE_APPROVAL` return `false`.
- Timeouts, network failures, invalid requirements and malformed receipts return `false`.

The adapter never receives a private key and never signs or settles a payment.

## Use

1. Register a dedicated client credential with `POST https://payguard-production-abfe.up.railway.app/register`.
2. Keep the returned administration credential outside the model.
3. Put the client token in the host process as `PAYGUARD_CLIENT_TOKEN`.
4. Import `onPaymentRequested` from `example.mjs` and pass it to the x402 MCP client.
5. Supply the real HTTPS resource URL and the causal prompt/tool context available at the call site.

Do not send credentials, private prompts, customer data or wallet material as context. Send only the minimum excerpt or risk flags needed for the owner policy.

## Test

```sh
node --test payguard-hook.test.mjs
```

The tests cover ALLOW, BLOCK, REQUIRE_APPROVAL, malformed input, a mismatched receipt, network failure and timeout behavior.

## Public references

- Integration guide: https://mercadosclaro-eng.github.io/ai-payment-control-plane/integration.html
- OpenAPI: https://payguard-production-abfe.up.railway.app/openapi.json
- Official x402 MCP guide: https://github.com/x402-foundation/x402/blob/main/docs/guides/mcp-server-with-x402.md

