# Varyntiq public security matrix

This is the public, testable boundary of Varyntiq. It separates what the control plane enforces from what an integrating signer must verify.

| Control | Varyntiq provides | Integrator must verify |
| --- | --- | --- |
| Exact intent binding | Canonical request hash and a receipt bound to amount, currency, rail, agent, provider, payee and endpoint | The signer rejects a changed request or expired receipt |
| Pre-sign decision | `ALLOW`, `BLOCK` or `REQUIRE_APPROVAL` before the external signer runs | Every outcome other than `ALLOW` stops or routes to owner approval |
| Replay protection | Unique intent IDs, one-time x402 nonces and duplicate detection | The adapter does not retry with a new payment silently |
| Payee and provider policy | Allow/deny lists, optional pinned-payee enforcement, new-provider review, scoped exposure caps and historical price checks | The owner configures the intended hosts, assets and recipients |
| Quote safety | Exact x402 amount/payee/resource checks plus expected-price and historical-drift signals | A changed quote is submitted as a new decision |
| Prompt-to-payment abuse | Signals for untrusted content and payment-directed injection patterns | The application supplies trustworthy context; merchant/model text is never approval |
| Trust provenance | Optional policy mode requires a bounded trust class with `trust_class_source=application` | The application assigns the class; merchant/model text cannot self-authorize it |
| Auditability | Hash-chained receipts; authenticated deployments can attach a receipt MAC | Receipts and decision state are retained according to the client policy |
| Failure mode | Network error, malformed response or missing proof is fail-closed in reference adapters | The final signer enforces the same boundary on every payment path |
| Fund boundary | No custody of funds, signing keys, or settlement | The wallet, processor or external signer remains responsible for execution |

## Evidence status

- The repository contains local conformance tests and dependency-free evaluation fixtures.
- The public demo never connects a wallet and moves no funds.
- No customer adoption, pilot, contract, external endorsement, fraud guarantee or certification is claimed here.
- A canonical hosted endpoint is supplied only during a controlled pilot after its environment and health have been independently verified.

The matrix is intentionally explicit about the remaining proof: a third-party integration must execute the check repeatedly and confirm the result before Varyntiq is described as customer validated.

