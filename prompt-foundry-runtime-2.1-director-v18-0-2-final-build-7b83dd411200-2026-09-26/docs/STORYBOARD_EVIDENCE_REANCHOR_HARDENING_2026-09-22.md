# Storyboard Evidence Re-anchor Hardening — 2026-09-22

Build: `10f038cd646c`

## Scope

This closeout fixes `storyboard_evidence_not_in_script` failures where a model returns an over-wide `source_evidence.quote` that crosses the current Beat/Script authority boundary.

## Runtime behavior

1. Storyboard canonicalization receives the same `beat_source_authority` used by hard validation.
2. Representation-only drift is re-anchored as before.
3. If an evidence quote is over-wide, the runtime may deterministically narrow it only to exact current-authority fragments that are literally present in the original quote.
4. No paraphrase, semantic inference, or cross-Beat recovery is allowed.
5. If deterministic narrowing is impossible, the validator emits a precise target path such as `scene.shots[20].source_evidence[0].quote`, plus `shot_index`, `evidence_index`, current Beat authority and compact allowed evidence candidates.
6. Targeted Repair may change only that quote; unrelated Shot fields remain frozen.

## Non-goals

- Does not rewrite Shot description.
- Does not move dialogue/narration units.
- Does not change Scene/Beat boundaries.
- Does not weaken evidence membership validation.
- Does not turn unsupported description semantics into hard-coded evidence.

## Verification

- Targeted Storyboard contract tests pass.
- Full suite: 547 tests pass.
- Python compileall passes.
- `/api/health` returns build `10f038cd646c` with `storyboard_scene.v16` and `consumption_v2f` unchanged.
