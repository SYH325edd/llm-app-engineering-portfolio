# Director v16.1 Shot-Size / Precision-Focus Repair Closeout

Build: `c22c5b3d06fd`
Contract: `director_shot.v16_1|model-envelope.v1`
Date: 2026-09-22

## Failure reproduced

A Director output can be structurally valid but semantically incompatible when:

- `execution_shot_design.shot_size` is `wide` / `extreme_wide`; and
- `visual_focus.body_regions` requests a precision region such as `hands`, `face`, `eyes`, or `mouth`.

The hard gate correctly emits `director_shot_size_focus_conflict`, but the previous Repair prompt did not give the model an executable resolution policy. A deterministic model could therefore return the same invalid pair after the single Repair budget and pause the unit.

## Fix

No hard rule was relaxed. The validator now emits executable Repair metadata and the canonical Director Repair prompt consumes it.

### Normal precision-focus shots

For non-`establish_space` shots:

- preserve `shot_purpose`;
- preserve `visual_target`;
- preserve the existing precision `visual_focus`;
- preserve unrelated valid Director fields;
- change only `execution_shot_design.shot_size` to a compatible value.

Allowed Repair values are `medium_close`, `close`, `extreme_close`, narrowed to `close` / `extreme_close` for `detail` and `emotional_peak`.

### Establish-space shots

`establish_space` must remain `wide` / `extreme_wide`. In that case Repair must:

- preserve the wide execution design;
- preserve `shot_purpose=establish_space`;
- remove only the precision body-region emphasis;
- replace it with a non-precision focus consistent with the existing `visual_target`.

This avoids fixing one hard error by immediately creating `director_shot_purpose_design_conflict`.

## Scope audit

Production-code change:

- `runtime/stages/director.py`

Regression additions:

- `tests/runtime/test_stage06_director_contract.py`
- `tests/runtime/test_runtime20_recovery.py`

Byte-level unchanged from Build `c22c5b3d06fd`:

- Storyboard v16
- Script v12
- Production Semantics v1j
- State / ShotSpec v2
- W003 / Consumption Lint
- Consumption v2d compiler
- API and Web source
- Frozen Core package source

## Validation

- Director contract + recovery targeted suite: PASS
- Full regression: 495 / 495 PASS
- `python -m compileall`: PASS
- Web JS syntax: PASS
- final ZIP extraction regression: PASS

No real Ark/Seedance provider acceptance is claimed in this closeout.
