# Prompt Foundry Runtime 2.1 — Ark 429 Provider Fix

Build ID: `6bf744a8bf8f`
Date: 2026-09-20

This build fixes the provider boundary that previously collapsed every Ark HTTP 429 into the same generic `provider_rate_limited` error and could lose the structured Ark error body after the streaming response closed.

Verification:

- pytest: 336 passed
- Python compileall: passed
- web app JavaScript syntax: passed
- synthetic real HTTP streaming 429 `QuotaExceeded`: classified, no useless retries
- synthetic real HTTP streaming 429 `RateLimitExceeded.EndpointTPMExceeded`: classified and window-aware retry
- Runtime persistence of provider_code/provider_message/request_id/Retry-After: passed

The package still cannot determine the exact reason for an already-failed historical request whose Ark response body was discarded by the old adapter. Re-run once with this build to obtain the exact provider code.
