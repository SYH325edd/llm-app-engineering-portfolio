# Full Pipeline Contract Integration — 2026-09-20

Build: `e1891dda00ce`

This closeout was triggered by repeated cases where individually valid Stage changes exposed downstream contract mismatches. The repair was performed against the complete Source → Story Bible → Scene Plan → Script → Storyboard → Production Design → Production Semantics → Director → Compiler chain, not against one novel.

## Findings

1. A conservative/high-confidence detector must never be used as an exhaustive source inventory. The Script dialogue manifest violated this rule.
2. A semantic summary must never become the factual input of a hard gate. Scene Plan prop detection violated this rule by reading Beat descriptions instead of exact source authority.
3. Hard model errors must produce executable Repair scope. Empty `repair_targets` made one-pass Repair non-actionable.
4. Exact source authority must be enforced at the narrowest owning scope. Script dialogue/narration now validate against Beat source windows in addition to Scene scope.

## Frozen rules

- Source refs / quotes / dialogue / narration remain exact hard authority.
- Semantic summaries/transforms may trigger quality warnings, not lexical hard failure.
- `high_confidence_dialogue_manifest` is a required ordered subset only.
- Source-authored quoted dialogue outside that subset is legal.
- Narrative prose cannot be reclassified as dialogue merely because it is an exact Scene substring.
- Physical prop hard requirements in Scene Plan derive from exact Scene source text.
- Repair targets are never empty; precise path first, current Unit root `$` fallback.

## Regression coverage

The acceptance suite now includes a full-chain case with both:

- quoted dialogue without an explicit `say/ask` verb in surrounding prose;
- explicit high-confidence dialogue with frozen speaker attribution.

Both must survive Script → Storyboard → Production Semantics → Director → final 13-field Prompt, while omission of high-confidence dialogue and narrative-text-as-dialogue remain hard failures.
