# Safety Guard Validation

Validation date: 2026-06-04

## Scope

This validates the LakeJob Safety Guard without opening BOSS, launching a browser, sending messages, or applying to jobs.

Command run:

```powershell
python -m py_compile safety_guard.py test_safety_guard.py
python test_safety_guard.py
```

Result:

```text
Safety Guard validation PASSED
```

## Test Results

| Test | Input | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Daily real apply limit | Simulated `_daily_apply_count = 5` | `blocked=true`, `reason=daily_real_apply_limit_reached` | Matched; intercept log captured | PASSED |
| Daily real message limit | Simulated `_daily_message_count = 5` | `blocked=true`, `reason=daily_real_message_limit_reached` | Matched; intercept log captured | PASSED |
| Duplicate platform job | Simulated `_job_apply_seen = True` for same `platform_job_id` | `blocked=true`, `reason=duplicate_platform_job` | Matched; intercept log captured | PASSED |
| Duplicate company today | Simulated `_company_apply_seen_today = True` | `blocked=true`, `reason=duplicate_company_today` | Matched; intercept log captured | PASSED |
| Blacklisted company | `runtime/blacklist_companies.txt` contains test company | `blocked=true`, `reason=blacklisted_company` | Matched; intercept log captured | PASSED |
| Risk keyword | Page text contains `验证码 / 访问受限 / 频繁 / 风险 / 请稍后` | `blocked=true`, `reason=risk_keyword_detected` | Matched for all keywords; intercept logs captured | PASSED |
| Smoke limit | `LAKEJOB_MAX_ITEMS_PER_RUN=20` and smoke args parsed | Smoke still forces one item | `message-smoke`: `limit=1`, `message_limit=1`, `apply_limit=0`; `apply-smoke`: `limit=1`, `apply_limit=1`, `message_limit=0` | PASSED |
| Intercept logs | Every blocked test path | Safety Guard writes logs | Test captured a log payload for every blocked path with `safety_guard=true` and `blocked=true` | PASSED |

## Fixes Applied

Minimal fixes were applied during validation:

- Normalized Safety Guard reasons to stable snake_case values:
  - `daily_real_apply_limit_reached`
  - `daily_real_message_limit_reached`
  - `duplicate_platform_job`
  - `duplicate_company_today`
  - `blacklisted_company`
  - `risk_keyword_detected`
- Replaced corrupted risk keyword strings with valid Chinese keywords.
- Added offline `test_safety_guard.py`.

## Failed Items

None.

## Conclusion

PASSED
