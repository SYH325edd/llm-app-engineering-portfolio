# Production Candidate Repair Hardening — 2026-09-22

Build: `a5bff70dfa8e`

This closeout fixes three production failures observed in the real resumed run without adding stages or model calls.

1. `director_visual_target_focus_mismatch` now emits exact `visual_focus` repair targets, allowed refs, and preserved `visual_target` authority.
2. `director_repeated_execution_design` now uses `must_change_any_of_paths` across legal execution dimensions; returning the same triplet is not a repair.
3. Production Readiness character asset source-of-truth validation now checks the same shared visible-character set used by the visibility-aware continuity compiler. Non-visible contextual `character_refs` are not forced into the prompt.

Validation: 539 tests collected and passed; `compileall` passed. Real provider behavior remains a runtime acceptance boundary.
