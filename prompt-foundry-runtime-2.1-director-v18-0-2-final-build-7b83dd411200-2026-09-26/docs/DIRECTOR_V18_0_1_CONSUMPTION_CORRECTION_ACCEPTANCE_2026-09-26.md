# Director v18.0_1 Consumption Correction — Acceptance / Stress / Boundary Report

Date: 2026-09-26  
Baseline A Build: `8e1bbfd7b445`  
Delivery Build: `af52d4abaa61`

## Frozen scope

Implemented contracts:
- `director_scene_context.v1_1`
- `director_shot.v18_0_1`

Unchanged contracts:
- Story Bible `story_bible.v14`
- Scene Plan `scene_plan.v8`
- Script `script_scene.v12`
- Storyboard `storyboard_scene.v16`
- Production Semantics `production_semantics_shot.v1j`
- State/ShotSpec `state_shotspec.v2`
- Compiler `consumption_v2m`
- Production Readiness `production_readiness.v4_11`

## Acceptance 1 — Dramatic Turn partition

PASS.

Scene Context can split multiple continuous Dramatic Phases inside one existing Beat. An available/repaired context must satisfy all of the following:
- union of all phase `shot_refs` equals the Scene's exact Shot sequence;
- every Shot appears exactly once;
- each Phase is a contiguous Shot interval;
- Phase order is Storyboard order, with no crossing or holes;
- each Phase's `beat_refs` equals the original Beat ownership of its Shots.

Any invalid partition receives one local repair. Repair failure invalidates the whole optional Scene Context; no partial-context mode exists.

## Acceptance 2 — Authority model

PASS.

Authority is separated into:
1. Fact Authority — immutable Story/Storyboard/Production-Semantics/FrozenText/physical-continuity constraints.
2. Runtime-Derived Creative Context — `scene_position`, `reaction_opportunity`, next Scene position, scene camera baseline.
3. Model Execution Decision — visual subject/framing/shot size/camera/movement/performance execution inside Fact boundaries.

`scene_position` disagreement from the model is deterministically canonicalized to Scene Context membership when Context is available/repaired, without generating a Fact Integrity failure.

## Acceptance 3 — Base Shot field-level authority

PASS.

Model-facing payload now separates:
- `base_shot_fact_constraints` (HARD), including ownership, required refs, objective visual events, required spatial relation, FrozenText-unit allocations and evidence;
- `base_execution_fallback` (SOFT), including shot size/camera/movement and optional framing.

The Director may legitimately choose a different execution design while the immutable fact constraints remain program-owned.

## Acceptance 4 — Reaction and adjacent-shot context

PASS.

`reaction_opportunity` is independent from `scene_position`; it is derived from `reaction_strategy.preferred_reaction_shot_refs`. `next_shot_purpose` contains only the next Shot's Runtime-derived `scene_position`. No narrative-intent summarizer or additional model call was introduced.

`reaction_visualized` is calculated only by the read-only audit from dialogue speaker refs versus final visual subjects and legal reaction targets/listeners. The model does not self-certify this field.

## Acceptance 5 — Context Effect Audit isolation

PASS.

The audit records per-Shot context source, reaction opportunity/visualization and base-to-execution deltas, plus Scene aggregates. It is not referenced by any production validator/compiler path and cannot enter model Prompt, Final Prompt, Repair or Pause logic.

## Engineering regression

- Full deterministic suite: **654/654 PASS**.
- Frozen v18.0_1 tests: **4/4 PASS**.
- Python compileall: **PASS**.
- `apps/web/app.js` syntax check: **PASS**.

## Deterministic A/B surface isolation

The original Build `8e1bbfd7b445` and this delivery were run against the same deterministic Mock model/source.

After excluding run IDs/timestamps only:
- Story Bible: identical
- Scene Plan: identical
- Script: identical
- Storyboard Base: identical
- Production Semantics: identical
- PVB: identical
- PSB: identical
- Style Guide: identical
- compiled_project: identical
- Seedance Prompt: exact string match, **269 -> 269**

This proves v18.0_1 context/audit data does not leak into `consumption_v2m` under identical execution output.

## Stress / boundaries

- 400-Shot legal complete partition, 5,000 validations: **PASS** (~1.251 s observed).
- 400-Shot invalid duplicate/cross/missing partition, 5,000 validations: **5,000/5,000 rejected** (~1.249 s).
- Runtime-derived Scene Position canonicalization, 20,000 iterations: **PASS** (~0.904 s).
- Context Effect Audit, 20,000 iterations: **PASS** (~0.055 s).
- 100 complete Runs with Scene Context intentionally invalid after Repair: **100/100 completed**; Context status `unavailable_after_repair`; `run.error` empty; `failure_history` empty (~2.858 s).

Observed timings are local engineering measurements, not performance SLAs.

## Source-scope audit

Byte comparison against Build `8e1bbfd7b445` confirms no source changes in:
- `runtime/stages/story_bible.py`
- `runtime/stages/scene_plan.py`
- `runtime/stages/script.py`
- `runtime/stages/storyboard.py`
- `runtime/stages/production_semantics.py`
- `runtime/stages/state_shotspec.py`
- `runtime/consumption_compiler.py`
- `runtime/production_readiness.py`
- Frozen Core source under `packages/prompt_foundry_v13/src`

Production changes are limited to Scene/Shot Director consumption and read-only debug observability (`context_builder`, `director_scene_context`, `director`, `orchestrator`, new `director_context_effect`, and Web debug UI).

## Real 《钥匙》 SC002 A/B — not fabricated

The frozen design requires a true A/B using `run_afe3f4a9fb4c` with all upstream artifacts/model parameters frozen, rerunning only:
- `director_scene:SC002`
- `director:SH007-SH033`

The supplied project ZIP does not contain that Run JSON/checkpoint set, and this environment does not contain its original provider execution state. Therefore the planned 28-call live creative-quality A/B was **not executable here** and is explicitly **not claimed as passed**.

The delivery is contract/checkpoint-ready for that A/B: Scene Context v1 checkpoints and Director v18.0 checkpoints will not be reused under the new contract IDs, while unchanged upstream checkpoints remain eligible for reuse by input hash.
