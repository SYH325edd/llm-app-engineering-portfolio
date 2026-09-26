# Dialogue Visual-Channel Closeout — 2026-09-26

Build: `8e1bbfd7b445`  
Runtime: `2.1`  
Compiler contract: `consumption_v2m`  
Production Readiness: `production_readiness.v4_11`

## Trigger

A production Run still paused at Compile with only:

`exact_dialogue_repeated_in_visual_content` on `SH016`.

The previous fixes had already removed dialogue copied through Director `performance_actions`, `performance_logic`, `performance_execution`, and Production Semantics visual events. E023 identity-anchor failures were no longer present.

## Root cause

`_performance_text_with_source()` has a final fallback when neither Director performance actions nor Production Semantics visual events provide a renderable action. It calls `_storyboard_explicit_action()` and previously serialized that Storyboard action directly into `visual_content`.

A Storyboard composition/action is allowed to carry the frozen utterance as narrative context. Therefore a shape such as:

`visible action + 低声说“<FrozenText dialogue>”`

could bypass the existing dialogue stripping and duplicate the exact line in the visual track. This was a missing consumption-path invariant, not a dialogue-authority failure and not an SH016-specific defect.

## Fix

The Storyboard explicit-action fallback now applies `_strip_dialogue_from_action(..., dialogue_lines)` before serialization, followed only by existing deterministic fragment/light cleanup. The dialogue track is not rewritten. If stripping leaves no executable action, the fallback returns no performance text instead of inventing replacement content.

No contract version is bumped: this is a deterministic correctness repair inside the existing `consumption_v2m` responsibility. No Story Bible, Scene Plan, Script, Storyboard, Production Semantics, PVB, Scene Director, Shot Director, State Resolver, Frozen Core or Readiness hard-gate semantics changed.

## Acceptance

- Full deterministic regression: `650/650 PASS`.
- Performance-source matrix: Director action / Production Semantics visual event / v18 logic+execution / Storyboard explicit-action fallback all preserve the frozen line only in the dialogue track.
- Storyboard fallback stress: `4,000` compile + readiness cases PASS across quoted/unquoted long dialogue and quoted/unquoted short dialogue.
- Short-dialogue boundary: stripping `好` does not damage unrelated `良好`.
- `exact_dialogue_repeated_in_visual_content` remains a Hard Gate.

## Recovery

For a Run already paused at Compile under an older Build, keep its `data/runs` and `data/checkpoints`, start this Build, then Resume the existing Run. Compile is the paused deterministic unit, so the new renderer logic is applied without requiring a new Story Bible/Script/Storyboard generation.
