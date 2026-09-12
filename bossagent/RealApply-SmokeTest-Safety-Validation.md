# Real Apply Smoke Test Safety Validation

Validation date: 2026-06-04

## Scope

This validation covers `run_real_mode_smoke_test.py --apply-smoke`.

No database schema, RecruitRadar logic, or `run_dual_mock_validation.py` was changed.

## Safety Checklist

| Check | Status | Evidence |
| --- | --- | --- |
| Requires `--real` | PASSED | Global validation rejects runs without `--real`. |
| Requires `--send-real` | PASSED | `--apply-smoke` branch rejects missing `--send-real`. |
| Requires `--confirm-apply APPLY_ONE_REAL_JOB` | PASSED | Dedicated confirmation phrase is enforced. |
| Forces `limit=1` | PASSED | Validation sets `args.limit = 1`. |
| Forces `apply_limit=1` | PASSED | Validation sets `args.apply_limit = 1`. |
| Forces `message_limit=0` | PASSED | Validation sets `args.message_limit = 0`. |
| Mutually exclusive with `--write-db-only` | PASSED | Validation rejects this combination. |
| Mutually exclusive with `--dry-apply` | PASSED | Validation rejects this combination. |
| Mutually exclusive with `--message-smoke` | PASSED | Validation rejects this combination. |
| No loop apply | PASSED | Branch uses `parsed_jobs[0]` and calls `adapter.apply_to_job()` once. |
| No multi-job apply | PASSED | Search limit is `1`; only one saved job is used. |
| Does not write `messages` | PASSED | Branch writes `jobs`, `match_scores`, `applications`, and `logs`; no `add_message()` call exists in the apply-smoke branch. |
| Prints real apply warning | PASSED | Prints `即将真实投递1个岗位` before `adapter.apply_to_job()`. |
| Stops on captcha/risk/login failure | PASSED | BossAutomation safety checks stop and return failure; smoke branch records the error and stops. |
| Saves apply failure debug artifacts | PASSED | BossAutomation saves `runtime/debug_apply.html` and `runtime/debug_apply.png` on apply failure. |
| Application status is `submitted` on success | PASSED | Successful real apply sets Core status to `submitted`, which is schema-valid. |
| Logs include required fields | PASSED | Log payload includes `real_apply=true`, `apply_smoke=true`, `real_send=true`, `job_id`, and `application_id`. |

## Minimal Fixes Applied

One minimal fix was applied to `run_real_mode_smoke_test.py`:

- Added `real_send=true` to the apply-smoke log payload and run metadata.

## Required Command

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --apply-smoke --send-real --confirm-apply APPLY_ONE_REAL_JOB
```

## Rejected Examples

Missing confirmation phrase:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --apply-smoke --send-real
```

Conflicting mode:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --apply-smoke --dry-apply --send-real --confirm-apply APPLY_ONE_REAL_JOB
```

## Final Conclusion

PASSED
