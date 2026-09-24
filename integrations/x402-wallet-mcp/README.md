# Optional PayGuard gate for `x402-wallet-mcp`

This integration targets the open-source [`onchainexpat/x402-wallet-mcp`](https://github.com/onchainexpat/x402-wallet-mcp) Base/USDC payment flow at commit `b7942a83ab738c2f0e5555e656810900964d9d52`.

It inserts one optional independent decision after the wallet's local allowlist and spending checks and before `signExactPayment` or `signEscrowPayment` can run.

## Behavior

- No `PAYGUARD_CLIENT_TOKEN`: upstream behavior is unchanged.
- Matching, unexpired `ALLOW`: continue to the existing balance and signing path.
- `BLOCK` or `REQUIRE_APPROVAL`: return without signing.
- Timeout, network failure, HTTP error or mismatched receipt: return without signing.

The adapter receives the chosen public x402 quote. It never receives the wallet key, Privy credential, PayGuard owner key or tenant-administration credential. It uses only a dedicated PayGuard agent token.

The current adapter does not claim causal prompt-injection protection because the wallet's MCP tool does not expose a trustworthy host-supplied causal context at the signer boundary. It still provides an independent owner policy, duplicate, budget, payee, endpoint, frequency and price-anomaly decision. A future host callback could add trusted causal flags without sending private prompts.

## Files

- `payguard.ts`: dependency-free, fail-closed pre-sign gate.
- `payguard.test.ts`: receipt-binding, refusal, network-failure and timeout tests.
- `negotiator.patch`: minimal upstream wiring plus environment variables.

## Test

With Node.js 22 or newer:

```sh
node --test payguard.test.ts
```

No live service, wallet, key or payment is used by the tests.

