# Director v16 Quality Upgrade — Plan vs Implementation Audit

Build: `ef26883d73e0`
Contract: `director_shot.v16`

## Planned scope

1. shot_size ↔ visual_focus compatibility.
2. visual target independent from voice source.
3. Director receives previous 1–2 effective shot designs.
4. three-shot camera repetition is detected without program-randomized camera selection.
5. Director execution photography reaches final ShotSpec / Seedance prompt.

## Actual implementation

| Plan | Actual | Status |
|---|---|---|
| shot-size/focus compatibility | `director_shot_size_focus_conflict`; wide/extreme_wide cannot carry precision face/eyes/mouth/hands focus | PASS |
| visual target vs voice source | new `visual_target`; `speaker_target_refs` remains program-owned and independent | PASS |
| previous 1–2 shots | orchestrator supplies last two effective designs in `program_owned.recent_shot_designs` | PASS |
| anti-repetition | exact three-shot design repetition becomes `director_repeated_execution_design` quality warning; no deterministic random override | PASS |
| final execution design | new `execution_shot_design`; State/ShotSpec overlays effective shot_size/camera/movement without mutating Storyboard Base | PASS |
| old checkpoint compatibility | v15 output deterministically recovers visual_target from visual_focus and execution design from Base Shot | PASS |

## Deliberately not changed

- W003 / Duration Calibration.
- Storyboard v16 allocation / Redistribution Apply.
- Scene Plan / Script / PVB / PSB / Style Guide.
- Production Semantics v1j.
- Frozen Core source.
- Consumption v2c information budget (reserved for the next stage).
- sound semantics.

## Acceptance tests

- precision focus + wide execution design is rejected inside Director.
- visual target may be a non-speaker character.
- three identical recent execution designs are detected.
- runtime passes previous effective design into next Director Unit.
- State/ShotSpec consumes Director execution design and preserves Base Shot.
- final Seedance prompt reflects the Director execution design.
- full regression and ZIP re-extraction regression must pass before delivery.
