# Production Closeout v1.1 — Lexical Recovery

Build: `bbc60bd5bd02`

## Problem
Production Readiness correctly blocked lexically truncated performance cues such as `开口追` / `语气带着询`, but the compile stage had no deterministic recovery path, so a uniquely recoverable representation defect paused the whole run. The UI also mislabeled some deterministic compile failures as quota/config failures.

## Fix
1. Add a narrow performance-cue lexical normalizer before final prompt serialization.
2. Only complete fragments with one safe canonical completion in the performance vocabulary.
3. Keep Production Readiness unchanged as a hard gate for residual/ambiguous truncation.
4. Do not regenerate Director, dialogue, Storyboard, assets, duration, or continuity.
5. Distinguish provider quota/config failures from deterministic compile/readiness failures in the Web recovery hint.

## Scope audit
Production source changes relative to build `01f5e69dfd7e`:
- `runtime/shot_manifest.py`
- `apps/web/app.js`

No changes to Story Bible, Scene Plan, Script, Storyboard, PVB, PSB, Production Semantics, Director, State/ShotSpec, W003/Duration Authority, Consumption v2e continuity packaging, Production Readiness rules, API, or Frozen Core.

## Verification
- Focused lexical normalization + readiness tests: PASS
- Full regression: 515/515 PASS
- Python compileall: PASS
- Web JavaScript syntax: PASS
- Final ZIP extraction regression: required before delivery
