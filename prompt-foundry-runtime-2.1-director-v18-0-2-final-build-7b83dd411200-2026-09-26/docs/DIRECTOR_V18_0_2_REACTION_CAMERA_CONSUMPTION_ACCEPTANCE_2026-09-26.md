# Director v18.0_2 Reaction & Camera Consumption — Acceptance / Stress / Boundary Report

Date: 2026-09-26  
Delivery Build: `7b83dd411200`

## Contracts

- Scene Director: `director_scene_context.v1_1` — frozen, source unchanged
- Shot Director: `director_shot.v18_0_2`
- State: `state_shotspec.v2`
- Compiler: `consumption_v2m`
- Readiness: `production_readiness.v4_11`

## Scope

This iteration only closes two Shot Director consumption gaps observed in the user's Reference Benchmark B1:

1. `reaction_opportunity` must produce a real speaker-vs-listener visual candidate decision.
2. `scene_position` / adjacent execution must be able to influence camera execution without a pre-filled Base answer anchoring the model.

Scene Context v1_1, Performance architecture, State, Compiler and Readiness are intentionally frozen.

## Implementation

### Reaction candidate consumption

`reaction_candidate_refs` is program-owned and deterministic, but no longer treats every non-speaker as an equally valid listener. The precision order is:

```text
reaction_opportunity == true
→ current-shot uniquely attributable reaction evidence
→ explicit Scene speaker_listener relationship
→ single non-speaker fallback
→ otherwise [] for ambiguous multi-character Shots
```

Shot-local evidence is stronger than Scene-level relationship context. An empty candidate set is meaningful ambiguity and must not be widened back to all non-speakers. The model compares speaker visual against only these legal reaction candidates. Choosing a listener may change only visual ownership/framing; dialogue speaker, FrozenText and objective facts remain unchanged. No listener quota or hard validator is added.

### Camera consumption

The Director decision order is explicit:

```text
scene_position
→ visual subject
→ framing / foreground relation
→ previous execution / next scene_position
→ scene camera baseline
→ shot_size / camera / movement
→ base execution only as fallback
```

The model-facing `output_template` no longer pre-populates Base values such as `single / medium / eye_level / static`. Enum fields are structural blanks; actual values must come from `output_contract.allowed_values`. This removes answer anchoring without changing the provider JSON shape.

### Audit correction

`reaction_visualized` reads `program_owned.speaker_target_refs` first and uses the precision-first runtime reaction candidates. Legacy `shot.dialogue` remains only as a compatibility fallback. For current payloads an empty `reaction_candidate_refs` means ambiguity; Audit does not fall back to `allowed_character_refs - speaker`. The Audit adds `reaction_candidate_available`; it remains read-only and cannot enter Prompt, Hard Gate, Repair or Pause.

## Critical tests

1. Reaction candidate is explicit, listener visual is legal, and dialogue ownership remains with the speaker.
2. Model-facing creative template has no Base camera/framing default answer while Base fallback remains available as input.
3. Camera execution can legally differ from Base without Runtime overwriting it; corrected Audit recognizes the reaction visual.

Result: **5/5 PASS** (the original three contract tests plus multi-character ambiguity and semantic-listener/evidence-priority coverage).

## Full regression

- **659/659 PASS**
- Python compileall: **PASS**
- Web JS syntax: **PASS**


## Deterministic surface-isolation A/B

The same Mock source/model was executed on Build `af52d4abaa61` and v18.0_2. After removing run-local IDs/timestamps, the following are identical:

```text
Story Bible
Scene Plan
Script
Storyboard Base
Production Semantics
PVB
PSB
Style Guide
compiled_project
```

This confirms that the v18.0_2 consumption/audit changes do not alter Fact Spine or Compiler output when the model execution decision itself is unchanged.

## Stress / boundary

- Precision-first candidate selection and ambiguous-audit boundary x40,000: **PASS**.
- Existing model-facing template unanchoring and Base fallback behavior remain covered by regression tests.
- Full Runtime Mock run stress x100: **100/100 completed**.

## Source-scope audit

Relative to Build `af52d4abaa61`, production source changes are limited to:

```text
runtime/stages/director.py
runtime/director_context_effect.py
apps/web/app.js
```

The following remain byte-identical:

```text
runtime/stages/director_scene_context.py
runtime/stages/story_bible.py
runtime/stages/scene_plan.py
runtime/stages/script.py
runtime/stages/storyboard.py
runtime/stages/production_semantics.py
runtime/stages/state_shotspec.py
runtime/consumption_compiler.py
runtime/production_readiness.py
packages/prompt_foundry_v13/src/**/*.py
```

## Reference Benchmark B1 limitation

The user's `run_f6ac061e0cf5` is a useful same-novel business reference but not a strict causal A/B because Story Bible / Scene Plan and other upstream artifacts were regenerated. Its reported `Reaction Opportunity = 12 / Reaction Visualized = 0` also came from v18.0_1 Audit logic that could read speaker ownership from `shot.dialogue` instead of canonical program-owned speaker authority. v18.0_2 corrects this measurement path. Therefore that `0` must not be used as a hard baseline until the run is re-audited or a v18.0_2 benchmark is produced.

## Next real acceptance

One real benchmark is sufficient. Prefer preserving the B1 upstream artifacts/checkpoints and rerunning only Shot Director under contract `director_shot.v18_0_2`; Scene Context remains `v1_1` and does not need another redesign. Observe:

- reaction_candidate_available
- reaction_visualized
- subject / target / framing deltas
- camera / shot-size deltas around real Dramatic Turns
- Fact/FrozenText integrity

Do not use movement count as a quota.


## Final precision closeout

The final delivery also closes the multi-character semantic precision issue found during post-delivery audit. In a Shot with one speaker and multiple other visible characters, Runtime no longer labels every non-speaker as a listener. It uses existing evidence/relationship authority only and returns an empty candidate set when the listener is still ambiguous. This is a conservative fail-soft creative behavior: it may decline a reaction cut rather than manufacture a wrong listener.

README historical wording was also corrected so the v18.0_1 section says `当时正式基线`; only the v18.0_2 section is labeled current baseline.
