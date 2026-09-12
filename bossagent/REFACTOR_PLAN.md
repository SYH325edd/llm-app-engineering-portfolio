# BOSS Agent Refactor Plan

## Safety baseline

- Default execution remains mock, dry-run, and draft-only.
- No CAPTCHA bypass, anti-detection, risk-control evasion, bulk apply, or bulk messaging.
- Real apply/message requires an actionable confirmed target, SafetyGuard, QuotaPolicy,
  an exact confirmation phrase, and an audit trail.
- All verification uses fixtures, fake senders, fixed screenshots, or dry-run commands.

## Implementation stages

1. Harden `.gitignore`, `scripts/pre_push_check.py`, and add `scripts/make_release.py`.
2. Add ordered, recorded migrations and an idempotent local seed path.
3. Align Local Control and RecruitRadar CLI contracts and test parser generation.
4. Add explicit application/message state machines and prevent premature success states.
5. Add `PlatformTarget` actionability checks between vision results and real actions.
6. Add Pydantic DTOs at adapter, safety, quota, vision, and action boundaries.
7. Introduce `web/` application, dependency, route, and service modules while retaining
   `web_console.py` as the compatibility entry point.
8. Standardize pytest fixtures and keep live tests skipped unless explicitly enabled.
9. Add scheduler locking, retry lifecycle fields, fake-clock support, and draft-only naming.
10. Route AI calls through the provider layer with timeout, retry, validation, and mock fallback.
11. Centralize logging/audit redaction and make debug artifacts opt-in.
12. Validate visual click bounds/type/confidence and verify post-click state changes.
13. Make UI safety states and draft-versus-sent wording explicit.
14. Update runbooks and write `REFACTOR_SUMMARY.md` with validation evidence and limits.

## Primary files

- Core: `core/schemas/`, `core/state_machine.py`, `core/platform_targets.py`, `core/logging.py`
- Actions: `jobradar_apply.py`, `message_draft.py`, `message_center.py`,
  `recruitradar_msg.py`, `job_flow.py`, `recruit_flow.py`
- Platform/vision: `adapters/base.py`, `adapters/boss/adapter.py`,
  `skills/search/vision_search_skill.py`, `skills/vision/ui_grounder.py`
- Runtime: `local_control.py`, `scheduler.py`, `ai/`
- Web: `web_console.py`, `web/app.py`, `web/deps.py`, `web/routes/`, `web/services/`
- Database/release: `schema.sql`, `migrations/`, `scripts/db_migrate.py`,
  `scripts/db_seed_local.py`, `scripts/pre_push_check.py`, `scripts/make_release.py`
- Tests/docs: `conftest.py`, `test_*.py`, `README.md`, `DEV-SETUP.md`,
  `REAL-MODE-RUNBOOK.md`, `REFACTOR_SUMMARY.md`

## Verification commands

```powershell
python -m compileall .
python scripts/pre_push_check.py
pytest -q
python scripts/make_release.py
```

Focused tests cover CLI compatibility, state transitions, target actionability,
migrations, release exclusions, SafetyGuard, QuotaPolicy, scheduler locking/retry,
AI provider failures, and visual click validation.

## Risks

- PostgreSQL may be unavailable locally; migration tests therefore use parser/fake-connection
  coverage and the summary records whether an integration migration was possible.
- Browser-backed BOSS actions are deliberately not exercised.
- Existing uncommitted work is treated as the baseline and is not reverted.
- `web_console.py` is large; route extraction must preserve existing imports and templates.
