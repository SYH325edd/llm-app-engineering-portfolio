# Director Subject Ownership Hardening

Build: `84942b05350c`

This closeout hardens two deterministic Director type/ownership failures without widening the Director contract.

1. `primary_subject_refs` remains character-only. A ref that is a valid current-shot prop is removed from this field deterministically; the prop remains represented through `visual_target.prop_refs` / `visual_focus.prop_refs`. Unknown refs stay hard failures.
2. `E021_DIRECTOR_PERFORMANCE_SUBJECT_MISMATCH` is evidence-led. If the action text and exact current-shot evidence uniquely name the same visible canonical character, `character_ref` is rebound to that character without model Repair. If ownership is not deterministically supported, the runtime does not guess: Repair receives both `action` and `character_ref` as must-change-any-of targets and must preserve evidence/event facts.
