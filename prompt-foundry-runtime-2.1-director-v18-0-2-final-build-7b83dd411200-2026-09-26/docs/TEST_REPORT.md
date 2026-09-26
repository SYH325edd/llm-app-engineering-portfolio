# Prompt Foundry Runtime 2.1.0 — Final Test Report

- App version: `2.1.0`
- Runtime: `2.1`
- Frozen framework: `1.3-frozen`
- Verification date: `2026-09-16`

## Automated regression

Command:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=apps/api:packages/prompt_foundry_v13/src:. pytest -q -p no:cacheprovider
```

Result: **160 / 160 PASS**.

Coverage includes:

- FROZEN-01 Story Bible
- FROZEN-02 Scene Plan
- FROZEN-03 Script
- FROZEN-04 Storyboard Base
- FROZEN-05A PVB
- FROZEN-05B PSB
- FROZEN-05C Style Guide
- FROZEN-06 per-Shot Director
- FROZEN-07 State Resolver + ShotSpec
- FROZEN-08 production lock + Compilers + Static Evaluation
- checkpoint reuse / retry / resume / process restart recovery
- Web progress and model configuration
- Ark SSE parsing / timeout / completion-budget behavior
- startup version/port isolation
- full Runtime 2.1 integration chain producing Character / Scene / Shot prompts

## Frozen Core integrity

Command:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=apps/api:packages/prompt_foundry_v13/src:. \
pytest -q -p no:cacheprovider \
tests/runtime/test_runtime20_foundations.py::test_runtime_does_not_modify_frozen_core_files
```

Result: **PASS**.

No Frozen Core v1.3 file was changed by the Runtime 2.1 stage rebuild.

## Syntax / production-path verification

```bash
python -m compileall -q apps/api packages/prompt_foundry_v13/src runtime scripts
node --check apps/web/app.js
```

Result: **PASS**.

Production Runtime scan confirmed no Runtime references to:

- `normalize_director_semantics`
- `director_shot.v2`
- generic `_whole_stage`
- legacy `_lock_pvb/_lock_psb/_lock_style` helpers

## Real local HTTP smoke

Launched with `scripts/serve.py` on `127.0.0.1:8191`.

Observed:

```json
{"status":"ok","version":"2.1.0","runtime":"2.1","framework":"1.3-frozen"}
```

- `GET /` → `200`
- `GET /api/health` → `200`
- `GET /api/config` → `200`

## Integration freeze

The final integration regression verifies the strict sequence:

```text
Story Bible
→ Scene Plan
→ Script
→ Storyboard Base
→ PVB / PSB / Style candidates
→ Director SH001 / SH002
→ State/ShotSpec
→ Stage 08 production lock / compile
→ Static Evaluation
```

The test completes with 1 Character Prompt, 1 Scene Prompt and 2 Shot Prompts; Static Evaluation passes.

## Not claimed

This local verification does **not** claim:

- a live external request using the user's private Volcengine Ark credential;
- Seedance real-video generation quality.
