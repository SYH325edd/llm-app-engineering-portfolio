# Real Message Smoke Test Safety Validation

Validation date: 2026-06-04

## Scope

This validation covers the safety behavior of `run_real_mode_smoke_test.py --message-smoke`.

No schema, BossAutomation, RecruitRadar search logic, or business database structure was changed.

## Safety Checklist

| Check | Status | Evidence |
| --- | --- | --- |
| `--message-smoke` must include `--real` | PASSED | Global validation rejects runs without `--real`. |
| `--message-smoke` must include `--send-real` | PASSED | Message smoke branch rejects missing `--send-real`. |
| Requires second confirmation phrase | PASSED | Requires `--confirm-send SEND_ONE_REAL_MESSAGE`. |
| Forces `limit=1` | PASSED | Validation sets `args.limit = 1`. |
| Forces `message_limit=1` | PASSED | Validation sets `args.message_limit = 1`. |
| Forces `apply_limit=0` | PASSED | Validation sets `args.apply_limit = 0`. |
| Does not write `applications` | PASSED | Message smoke branch does not call `create_application()` and reports `applications_written=0`. |
| Does not call `BossAdapter.apply_to_job()` | PASSED | Message smoke branch only opens the job conversation and calls `adapter.send_message()`. |
| Does not loop send | PASSED | Branch selects one job and calls `send_message()` once. |
| Does not send to multiple jobs | PASSED | Real search limit is `1`; only `parsed_jobs[0]` is used. |
| Message direction is correct | PASSED | Core message is written with `direction="outbound"`. |
| Logs record real send result | PASSED | Log payload includes `real_send`. |
| Terminal clearly warns before send | PASSED | Prints `即将真实发送1条消息` immediately before the real send call. |

## Minimal Fixes Applied

The initial implementation required `--real --send-real`, but did not require a dedicated second confirmation phrase. The following minimal fixes were applied to `run_real_mode_smoke_test.py`:

- Added `MESSAGE_SMOKE_CONFIRM_PHRASE = "SEND_ONE_REAL_MESSAGE"`.
- Required `--confirm-send SEND_ONE_REAL_MESSAGE` when `--message-smoke` is used.
- Added terminal warning: `即将真实发送1条消息`.

## Required Command

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --message-smoke --send-real --confirm-send SEND_ONE_REAL_MESSAGE
```

## Rejected Commands

Missing `--send-real`:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --message-smoke
```

Missing confirmation phrase:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --message-smoke --send-real
```

## Final Conclusion

PASSED
