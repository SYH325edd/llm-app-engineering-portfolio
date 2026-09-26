# Director v16.1 Deterministic Contract Stabilization — 2026-09-22

## Problem observed in real runs

Two Director contract conflicts could be semantically repairable but still require several manual retries because Runtime asked the model to perform a correction that was already deterministic:

1. `director_shot_size_focus_conflict`
   - `shot_purpose=establish_space`
   - `execution_shot_design.shot_size=wide|extreme_wide`
   - precision `visual_focus.body_regions` such as `hands`

2. `reaction_target_without_performance`
   - a reaction target has no same-character `performance_action`
   - when no current-shot character-attributed reaction evidence exists, the target is unsupported and must not be rescued by invented acting.

## Decision

Do not increase Repair budget and do not retry the same model prompt multiple times.

Instead, after canonicalization and first Director validation, Runtime may perform one deterministic contract stabilization only when *all* current hard Director errors are from the explicitly safe set:

- `director_shot_size_focus_conflict`
- `reaction_target_without_performance`
- reaction-scale `director_shot_purpose_design_conflict`

If any unrelated hard error is present (invalid ref, unsupported field, etc.), no deterministic stabilization is applied; normal validation/Repair remains responsible.

## Deterministic rules

### Establish-space wide + precision focus

Preserve:
- `shot_purpose=establish_space`
- `wide|extreme_wide`
- current visual target

Remove only precision body-region emphasis (`face/eyes/mouth/hands`). If the focus was purely `body_region`, convert it to the corresponding non-precision focus derived from the existing visual target. No new target or event is invented.

### Non-establish wide + precision focus

Preserve the precision focus and choose the least-invasive allowed readable shot size supplied by the validator.

### Reaction target with evidence

Add only the smallest same-character `performance_action` anchored to existing current-shot character evidence. The evidence quote itself is reused; no new psychology or plot fact is authored.

### Reaction target without evidence

Remove the unsupported `reaction_target_ref`. Do not invent a performance action.

If all reaction targets disappear and the presentation wrappers were reaction-specific, degrade only those wrappers to a neutral current-shot presentation (`character` target/focus, `single` framing, `speaker` or `continuity` purpose as already supported by the shot).

### Retained reaction shot at unreadable scale

Use `medium_close` as the deterministic minimum readable reaction scale when the current reaction purpose remains valid.

## Plan vs actual implementation

Planned:
- solve the two recurring real-run conflicts without raising repair retries;
- preserve validator strictness;
- avoid hidden invention;
- leave Storyboard, Script, Production Semantics, State/ShotSpec, W003, Consumption and Frozen Core untouched.

Actual production changes:
- `runtime/stages/director.py`
  - added `stabilize_director_contract_conflicts`
- `runtime/orchestrator.py`
  - applies stabilization only when every hard error is in the safe deterministic set, then immediately revalidates

No production changes outside those two files.

## Verification

- exact establish-space `wide + hands` Runtime case: completes in one model call, no semantic Repair
- exact unsupported reaction-target Runtime case: removes target without invented performance, no semantic Repair
- evidence-backed reaction bundle: adds only anchored performance and readable scale
- mixed unrelated hard errors: deterministic stabilization is disabled so real model errors are not hidden
- full regression: 505/505 PASS
- Python compileall: PASS
- Web JavaScript syntax: PASS
