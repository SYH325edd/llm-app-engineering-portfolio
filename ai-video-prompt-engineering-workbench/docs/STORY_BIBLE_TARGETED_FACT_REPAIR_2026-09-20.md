# Story Bible targeted fact repair — 2026-09-20

## Failure

Live `story_bible` could pause after its single Repair with `story_bible_fact_not_supported` even when the underlying source fact was real but the bound evidence window was incomplete, especially for:

- pronoun / antecedent resolution (`他` -> a named or relational character);
- first-person speaker perspective (`我` -> the speaking character);
- one fact requiring two adjacent source units (action in one sentence, property/result in the next).

The same error type also correctly protects against a truly fabricated fact. These two cases therefore cannot be fixed by lowering lexical thresholds or disabling semantic support validation.

## Root cause

The Runtime used a generic repair payload containing `do_not_change_story_facts: true` for every stage. That contradicts Stage 1 ownership: Story Bible is itself the owner of extracted story facts. For `story_bible_fact_not_supported`, a real fact may need evidence re-binding, while a genuinely unsupported fact must be correctable or removable. The old payload made the latter impossible and did not give the model an exact entity/fact/evidence repair target.

## Engineering fix

Story Bible contract is now `story_bible.v7`.

1. Initial extraction keeps `explicit_facts` source-faithful and avoids unnecessary pronoun/person rewriting or merging separately evidenced clauses.
2. `story_bible_fact_not_supported` now includes:
   - `path`
   - `evidence_index`
   - `evidence_path`
   - `support_path`
   - `target_path`
   - current `source_refs`
   - explicit `repair_action`
3. Repair policy is stage-specific:
   - downstream stages still cannot change frozen story facts;
   - Story Bible may correct only validator-targeted unsupported factual leaves;
   - all unrelated facts remain frozen.
4. Repair order for this error is:
   - first rebind/expand the smallest contiguous `source_refs` when the source truly supports the fact but the evidence window is incomplete;
   - otherwise correct/remove only the factual leaf identified by `target_path` and update its `supports`.
5. The hard semantic gate remains active. No threshold was lowered and fabricated facts backed by irrelevant real quotes still fail.

## Verification

- targeted repair regression: passed;
- semantic authority regressions: passed;
- full pytest suite: passed;
- Python compileall: passed;
- Web JavaScript syntax check: passed.
