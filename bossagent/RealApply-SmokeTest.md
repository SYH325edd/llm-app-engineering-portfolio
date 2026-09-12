# Real Apply Smoke Test

## Goal

Validate the smallest real JobRadar apply path:

Boss job -> open job detail -> perform one real apply / communication apply action -> write Core application record -> write logs

This smoke test is only for one real job.

## Safety Limits

- Requires `--real`.
- Requires `--send-real`.
- Requires `--confirm-apply APPLY_ONE_REAL_JOB`.
- Forces `limit=1`.
- Forces `apply_limit=1`.
- Forces `message_limit=0`.
- Disables `auto_apply`.
- Disables `auto_message`.
- Sends at most one real apply action, then stops.
- Does not loop.
- Does not batch.
- Does not default to real apply.

## Run Command

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --apply-smoke --send-real --confirm-apply APPLY_ONE_REAL_JOB
```

## Tables Written

- `jobs`
- `match_scores`
- `applications`
- `logs`

`messages` are not written by the smoke test unless the platform-side apply action itself requires a first sentence. In that case, the platform action may send a greeting, but the smoke test still records the apply result through `applications` and `logs`.

## Application Status

The schema does not allow `applied`.

The smoke test uses:

- `submitted` when the real apply action succeeds.
- `pending` when the real apply action fails.

The log payload records:

```json
{
  "apply_smoke": true,
  "real_apply": true,
  "real_apply_sent": true
}
```

## Risk Control Handling

If BOSS shows captcha, risk control, frequency limits, or login expiry, the apply action stops immediately and records the error.

On apply failure, debug artifacts are saved:

```text
runtime/debug_apply.html
runtime/debug_apply.png
```

## Expected Output

```json
{
  "apply_smoke": true,
  "real_apply_sent": true,
  "application_id": "...",
  "job_id": "...",
  "applications_written": 1,
  "logs_written": 1,
  "apply_smoke_error": ""
}
```

## Not Batch

This is not a batch apply feature. It intentionally applies to only one job and exits.

## Current Technical Debt

- Platform-side apply may be implemented as a BOSS communication action, depending on BOSS UI behavior.
- `applications.status` cannot store `applied`; `submitted` is used for successful real apply.
- Real BOSS captcha and risk control remain manual intervention points.
