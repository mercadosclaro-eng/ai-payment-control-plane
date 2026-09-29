# Varyntiq name migration

Varyntiq is the only public product name.

The canonical integration entry points are now named `varyntiq-*` and new
examples use `VARYNTIQ_CLIENT_TOKEN` / `VARYNTIQ_BASE_URL`. Existing migration
aliases are kept only where removing them would break an already-installed
consumer; no new example or deployment depends on them.

Any former hostname is not a second product and must not be used in marketing.
Before it can be retired, a canonical Varyntiq endpoint must be provisioned,
tested with the full evaluator and exposed only after the health, receipt,
fail-closed and rollback checks pass. This file does not change production,
secrets, customer data or registry records.

