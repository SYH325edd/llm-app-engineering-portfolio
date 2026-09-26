# Director v10 State Contract

## Root cause

Director v9 required the model to output both `action_delta` and `state_out`. These two structures encode the same transition twice, so a semantically reasonable model output could still fail because one copy omitted or changed a field. Typical failures were `state_out_change_without_delta` and `action_delta_not_reflected_in_state_out`.

## v10 contract

```text
previous_state_out
      ↓
continuity_scope
      ↓ program: resolve_state_in
state_in
      +
model action_delta
      ↓ program: deterministic apply
state_out
```

The model owns `action_delta`; the Runtime owns `state_in` and `state_out`.

### Persistent state only

`action_delta` contains only changes that remain true at the end of the Shot and need continuity. Shot-local events belong in `performance_actions` / dialogue.

- `speaking` is transient and forbidden in persistent state.
- Prop holding uses only `props.<prop_ref>.held_by`.
- Character-side aliases such as `hold_prop`, `held_prop`, `prop_in_hand`, `held_prop_refs` are mechanically normalized when their value is an allowed stable prop ref.
- `null` as a dynamic field value means clear/remove an inherited state field.

## What remains hard validation

- no-op / stale `action_delta`
- invalid current-shot character or prop refs
- invalid `held_by` character ref
- static asset leakage into derived `state_out` (caught by the existing Frozen Core validation)
- all existing Director evidence, ref, focus, dialogue and continuity constraints

## Frozen Core boundary

No file under `packages/prompt_foundry_v13` is changed. Runtime v10 canonicalizes the Director fragment and injects derived `state_out` before invoking Frozen Core v1.3 validators and the State/ShotSpec stage.
