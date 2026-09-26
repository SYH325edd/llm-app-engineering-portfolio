# Production Semantics nested narrative context ownership fix — 2026-09-20

## Symptom

A real Ark run paused at `production_semantics:SH002` after one repair with:

`production_choice_context_mismatch` on `production_choices[0].narrative_context_ref`.

## Root cause

The current narrative context id is deterministic program state, but Production Semantics treated the nested
`production_choices[].narrative_context_ref` and `appearance_overlays[].narrative_context_ref` as model-authored exact-match fields.
The canonicalizer already program-owned top-level `context_ref`, while leaving these nested copies untouched. The token-slimmed model
payload also did not make the required internal id a reliable model decision. A model could therefore produce a semantically valid choice
with the wrong internal context id, fail validation, and repeat the same failure during repair.

## Fix

- Mark both nested narrative context refs as program-owned.
- Expose `program_owned.current_narrative_context_ref` in the Shot context.
- Remove nested context ids from the model-owned item-field contract.
- Canonicalize every production choice and appearance overlay to the current Shot context before validation.
- Keep the strict validator as a final invariant check.

No stage was merged or removed, and the canonical persisted output shape is unchanged.

## Regression coverage

The stateful regression intentionally returns `context_wrong` for SH002 while the current context is `context_001`.
The Runtime canonicalizes it to `context_001`, performs no Production Semantics repair call, and completes the full pipeline.
