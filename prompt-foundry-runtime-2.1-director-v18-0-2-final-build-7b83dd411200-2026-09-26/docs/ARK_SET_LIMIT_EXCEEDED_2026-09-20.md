# Ark SetLimitExceeded handling — 2026-09-20

Observed provider response:

- HTTP 429
- provider code: `SetLimitExceeded`
- provider message: account reached the set inference limit for the selected model; model service paused; adjust/close Safe Experience Mode.

This is not an RPM/TPM transient rate limit. It is an account/model activation ceiling. Repeating the same request cannot recover while the provider has paused the model service.

Runtime behavior after this change:

- classify as `provider_inference_limit_reached`
- mark non-retryable
- stop after transport attempt 1
- preserve `provider_code`, `provider_message`, `request_id`, and HTTP status
- surface actionable guidance to adjust the model inference limit or Safe Experience Mode in Ark
- fallback to provider-message recognition when the provider code is absent

The workflow Prompt, Story Bible schema, semantic Repair and downstream Gates are not invoked for this provider-side failure.
