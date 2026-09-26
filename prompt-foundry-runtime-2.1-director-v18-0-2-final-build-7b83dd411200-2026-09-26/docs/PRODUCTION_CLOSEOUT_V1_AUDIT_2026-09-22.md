# Production Closeout v1 — Plan vs Implementation Audit

Baseline: `1b0c820758ce`
Current build: `bbc60bd5bd02`

| Planned item | Actual implementation | Result |
|---|---|---|
| A. Duration Authority before Compiler | `runtime/storyboard_overload_feedback.py` + `runtime/orchestrator.py`; pre-Director redistribution/extension, post-Director ShotSpec extension, 15s hard ceiling, residual risk blocks | PASS |
| B. Compact continuity packaging | `runtime/consumption_compiler.py`; compact stable character/wardrobe + stable scene anchor, current shot state kept outside anchor | PASS |
| C. Generic text/asset hygiene | `runtime/consumption_compiler.py` + `runtime/shot_manifest.py`; field normalization, cross-field dedupe, punctuation cleanup, dialogue removed from visual channel | PASS |
| D. Performance coverage | `runtime/shot_manifest.py`; `performance_source` provenance and evidence-first fallback order | PASS |
| E. Production Readiness Gate | new `runtime/production_readiness.py` + `runtime/stages/compile_eval.py`; hard production errors + non-mutating camera monotony warning | PASS |
| Asset/hash integrity | continuity anchor hashes + `consumption_input_hash`; retry invalidates materialized readiness/compile state | PASS |
| Keep final 13 fields | no new user-facing prompt fields | PASS |
| Do not move split/duration authority into Compiler | Compiler remains consumer; allocation stays in Storyboard redistribution / Runtime authority | PASS |
| Do not output bare `char_001` / `scene_001` as final visual context | refs remain internal; compact text anchors are rendered | PASS |
| Do not add story-specific fixes | template-generalization test passes; Runtime has no story-specific names | PASS |

## Production source scope audit

Compared with baseline ZIP, changed production source is limited to six files:

- `runtime/consumption_compiler.py`
- `runtime/orchestrator.py`
- `runtime/production_readiness.py` (new)
- `runtime/shot_manifest.py`
- `runtime/stages/compile_eval.py`
- `runtime/storyboard_overload_feedback.py`

Byte-level unchanged scopes:

- `apps/api`: 0 changed production files
- `apps/web`: 0 changed production files
- `packages/prompt_foundry_v13/src` (Frozen Core): 0 changed files
- Story Bible Stage: unchanged
- Scene Plan Stage: unchanged
- Script Stage: unchanged
- Storyboard Stage contract/generator: unchanged
- Production Semantics Stage: unchanged
- Director v16.1 contract/generator: unchanged
- State/ShotSpec Stage: unchanged

## Regression changes

Legacy test fixtures that used English placeholder PSB values were updated to legal Chinese production-design values because Production Readiness now correctly requires a usable stable scene anchor. The gate was not weakened.

The previous manual redistribution-resume test was updated to the new production semantics: Duration Authority now auto-redistributes long multi-unit dialogue before Director; the test verifies a later Director pause resumes without rerunning Storyboard or spending another redistribution model call.

New closeout regressions cover:

- compact continuity normalization and scene cross-field dedupe
- exact dialogue confined to dialogue track
- critical-shot fallback rejection
- long multi-sentence dialogue returning to allocator
- character asset/wardrobe changes altering `consumption_input_hash`
- final ShotSpec duration extension before compilation
- camera monotony warning without programmatic camera mutation
- compile/readiness materialized state invalidation on retry

## Verification boundary

Passing this audit means local deterministic pipeline and regression acceptance passed. It does **not** mean real Seedance 2.5 timing or visual continuity has been empirically calibrated. A later real-render acceptance batch remains required before declaring external-model Production Freeze.
