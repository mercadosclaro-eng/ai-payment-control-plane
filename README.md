# Varyntiq market site

Public category and pilot landing page for the deployed Varyntiq MVP. The site contains only the product boundary, integration contract and externally verifiable evidence. The private engine, rules, thresholds and commercial strategy are excluded.

Varyntiq is the only public product name. The current hosted endpoint and registry record still contain a legacy technical identifier; they are compatibility bridges and are not product branding. A canonical Varyntiq endpoint and registry identity must be created and tested before those bridges can be retired.

Public discovery assets include a human integration guide, an `llms.txt` summary and a standards-neutral `integration.json` profile. They describe only the public contract and operational boundaries. They do not claim A2A, x402 settlement or wallet functionality that the service does not implement.

Public reference integrations include Agent402/MPP, the official x402 MCP hook, x402 wallet clients and an InFlow x402 buyer hook that runs immediately before managed signing. These adapters expose only the public decision contract and never receive wallet keys.

The public demo includes a local, no-funds proof: exact intent hashing, ECDSA receipt verification, replay and fail-closed scenarios, and tamper rejection. The hosted core additionally requires a single-use x402 nonce, authenticates receipts to the client token, reserves pending approvals against global and per-agent/payee/provider budget caps, strictly validates policy values and verifies the receipt against the exact request before returning it. It is a demonstration of the control contract, not evidence of customer adoption.

Pilot requests are collected through a public GitHub issue form that explicitly forbids secrets, credentials, wallet details, customer data and confidential architecture. Deeper evaluation material is shared only through a separately controlled confidential process.
