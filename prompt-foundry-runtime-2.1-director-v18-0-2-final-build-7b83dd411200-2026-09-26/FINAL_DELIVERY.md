# Final Delivery — Director v18.0_2 Reaction & Camera Consumption Correction

- Date: 2026-09-26
- Runtime: `2.1`
- Build: `7b83dd411200`
- Scene Director: `director_scene_context.v1_1` (frozen)
- Shot Director: `director_shot.v18_0_2`
- State + ShotSpec: `state_shotspec.v2`
- Compiler: `consumption_v2m`
- Production Readiness: `production_readiness.v4_11`
- Regression: `659/659 PASS`

This delivery is a narrow continuation of v18.0 Consumption Correction. It does not enter v18.1.

## What changed

1. `reaction_candidate_refs` is now precision-first when `reaction_opportunity=true`: current-shot reaction evidence has highest priority, then explicit Scene `speaker_listener` relationship, then a single-non-speaker fallback. Ambiguous multi-character shots intentionally return `[]`; no new model stage or free-form narrative inference is introduced.
2. Shot Director must compare speaker visual and legal listener/reaction visual before selecting `primary_subject_refs`, `reaction_target_refs`, `visual_target` and `execution_framing`. Listener selection remains optional; FrozenText and dialogue ownership remain untouched.
3. Camera decision order is tightened: scene position -> visual subject -> framing/foreground relation -> previous execution / next scene position -> scene baseline -> base execution fallback.
4. Model-facing `output_template` no longer pre-populates `character / single / medium / eye_level / static`. Creative enum fields are structural blanks and must be selected from `output_contract.allowed_values`; the transport schema shape is unchanged.
5. Context Effect Audit now reads canonical program-owned speaker authority before legacy `shot.dialogue`, trusts the precision-first runtime candidate set, and never widens an empty candidate set back to every non-speaker. It records `reaction_candidate_available` and remains observer-only.

## Frozen boundaries

No changes were made to Scene Context v1_1, Story Bible, Scene Plan, Script, Storyboard, Production Semantics, FrozenText, Stable Ref, State Resolver, ShotSpec, Consumption Compiler, Production Readiness or Frozen Core. No Reaction Hard Gate, Camera Variety Validator, movement quota, Performance architecture upgrade, Prompt Composer or W005 optimization was added.

## Acceptance

- Full test suite: **659/659 PASS**.
- v18.0_2 critical tests: **5/5 PASS**.
- Python compileall: **PASS**.
- Web JS syntax: **PASS**.
- Precision-first reaction candidate / audit ambiguity stress: **40,000 PASS**.
- Full Runtime Mock run stress: **100/100 completed**.
- Deterministic same-Mock v18.0_1 -> v18.0_2 A/B confirms normalized Story Bible / Scene Plan / Script / Storyboard / Production Semantics / PVB / PSB / Style / compiled_project are identical.
- Protected-source hash audit confirms Fact Spine, Scene Context v1_1, State, Compiler, Readiness and Frozen Core are unchanged from Build `af52d4abaa61`.

## Benchmark interpretation

`run_f6ac061e0cf5` remains useful as Reference Benchmark B1, but it is not a strict causal A/B because its upstream artifacts were regenerated. In addition, v18.0_1 Audit could under-observe reaction visualization when speaker authority was not sourced from the canonical program-owned field. Therefore the previous `12 opportunities / 0 visualized` result is not used as a hard quantitative failure criterion. The next real benchmark should use v18.0_2's corrected Audit.

See `docs/DIRECTOR_V18_0_2_REACTION_CAMERA_CONSUMPTION_ACCEPTANCE_2026-09-26.md`.
