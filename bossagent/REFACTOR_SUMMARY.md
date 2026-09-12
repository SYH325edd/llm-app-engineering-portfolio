# BOSS Agent Refactor Summary

## What changed

- Added release hygiene checks and a source-only release builder. Runtime state, uploads,
  logs, browser profiles, cookies/sessions, debug captures, databases, caches, and virtual
  environments are ignored and excluded from release archives.
- Added ordered PostgreSQL migrations with checksums and an idempotent local seed. The local
  plan grants search/draft capacity but sets real apply/message quotas to zero.
- Aligned Local Control and RecruitRadar CLI parsing. RecruitRadar defaults to mock/dry-run;
  real search must be explicit.
- Added Pydantic DTOs for jobs, candidates, queries, results, targets, decisions, drafts,
  actions, and vision elements/results.
- Added explicit message/application state machines. Records are no longer marked sent or
  applied before the platform adapter reports success.
- Added `PlatformTarget`. `vision://`, missing URLs, or detail pages without timestamped
  confirmation evidence cannot perform real apply/message actions.
- Kept `PlatformAdapter` and BOSS as the first adapter. Search remains vision-first.
- Added visual click validation for element type, confidence, viewport bounds, and post-click
  page state waiting. No anti-detection or risk-control evasion was added.
- Added Scheduler locking, dry-run defaults, retry metadata, and the `message_draft` task name.
- Removed RecruitRadar's direct HTTP AI call in favor of `ai/provider.py`; added timeout,
  retry, JSON error handling, and missing-key mock fallback.
- Added privacy redaction, local-only web POST protection, modular `web/` entry/dependency
  packages, and prominent UI labels for mock, dry-run, draft-only, non-actionable, pending,
  SafetyGuard-blocked, and QuotaPolicy-blocked states.

## Local startup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:LAKEJOB_DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB"
python scripts/db_migrate.py
python scripts/db_seed_local.py
uvicorn web.app:app --reload --host 127.0.0.1
```

## Validation

- `python -m compileall .`: passed. The command also traversed local ignored environments;
  `.pytest_cache` could not be listed, but compilation exited 0.
- `python scripts/pre_push_check.py`: passed; warned that ignored `venv/` exists locally.
- `.\venv\Scripts\pytest.exe -q -s`: passed, 95 collected tests. Live external tests remain
  skipped unless `RUN_LIVE_TESTS=1`. The local database lacks the latest `audit_logs` table,
  so two best-effort audit writes warned and failed closed without failing tests.
- `python scripts/make_release.py`: passed; created `dist/boss-agent-source.zip` containing
  264 source files.

The global Python environment did not contain pytest, so validation used the existing
`venv` executable. `-s` was required because this Python 3.14/pytest environment raises an
I/O error in pytest's default capture cleanup; the tests themselves pass.

## Database verification

Migration ordering, checksum behavior, filename filtering, and seed SQL are covered offline.
No PostgreSQL integration migration was run because the configured local database is not an
empty disposable test database and is missing some existing SaaS migrations. Run
`scripts/db_migrate.py` against a disposable PostgreSQL database before deployment.

## Intentionally unsupported

- CAPTCHA bypass, anti-detection, risk-control evasion, or verification automation.
- Bulk or unattended real apply/message behavior.
- Treating visual search cards as confirmed platform targets.
- Releasing local browser state, cookies, resumes, screenshots, HTML, logs, or databases.

## Real-action test boundary

No real BOSS login, apply, or message action was executed. Apply/message evidence comes only
from dry-run plans, fake adapters/senders, fixed vision fixtures, and state transition tests.

## Remaining limits

- `web_console.py` remains the compatibility route owner while `web/` provides the new ASGI
  entry and dependency boundary. Moving every route into individual routers should be done
  incrementally with template-level regression tests.
- Some older modules still return dictionaries internally; DTO adoption is concentrated at
  safety-critical boundaries and should continue inward.
- Existing mojibake in legacy Chinese source/templates was not broadly rewritten to avoid
  unrelated behavioral churn.

## Next round

Complete the physical FastAPI route extraction, add a disposable PostgreSQL integration test
container for migrate/seed/rollback checks, and persist PlatformTarget confirmation through a
dedicated detail-review UI before considering any manually supervised real-action smoke test.
