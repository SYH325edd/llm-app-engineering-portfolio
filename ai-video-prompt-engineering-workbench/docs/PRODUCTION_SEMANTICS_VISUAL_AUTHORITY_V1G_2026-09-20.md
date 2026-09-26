# Production Semantics visual-authority split — v1g

## Problem

`visual_events.action` is a Shot-level production semantic compiled from the frozen Base Storyboard Shot, but v1f validated that action directly against wider Script/source quote text. A legal Shot-level contraction/rewording could therefore fail lexical anchoring even though the Base Shot itself had already passed Stage 4 evidence validation.

## Authority split

- `program_owned.current_shot_evidence`: exact upstream Script/Beat/dialogue provenance. It remains the only source for `source_evidence.quote`.
- `program_owned.current_shot_visual_authority`: the already-validated frozen `Shot.description`. It is the direct semantic authority for `visual_events.action`.

The two lists are intentionally separate. Storyboard wording is not promoted to raw source evidence.

## Validation

A visual event must satisfy both boundaries:

1. its `source_evidence` must be exact current-Shot upstream provenance; and
2. its `action` must be anchored to the frozen Base Shot visual authority.

This keeps fabricated actions blocked while avoiding false failures caused by comparing Shot-level production wording directly with a broader Script quote.

## Repair

`production_semantics_visual_event_not_supported` now targets only `visual_events[*].action`. Repair must shrink/reword that action back into the frozen Base Shot visual scope. It must not widen evidence or invent a new action.

## Non-changes

No lexical threshold was lowered. Storyboard evidence validation, Script provenance, dialogue freezing, production choices, Director ownership, and final compiler behavior remain unchanged.
