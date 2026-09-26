# Director Subject Ownership + Execution Stability Closeout v17.9

Date: 2026-09-24  
Scope: Director runtime contract/validator/canonicalization and regression coverage only.

## 1. Failure classes

Two independent failures were exposed after v17.8.

### A. Stage execution failure in a warning-only branch

The performance-budget path invoked `_err` with three positional arguments although the helper accepts only `(type, detail, *, path=None)`. The branch therefore raised a Python `TypeError` before contract validation could finish. This was a deterministic implementation defect, not a model-output defect.

### B. E021 subject ownership could not converge

`performance_actions[*]` carried the action owner twice: once structurally in `character_ref` and again implicitly in free-form `action` prose. If prose mentioned another canonical name before the first action verb while the source evidence was pronoun-only or multi-character, the validator asked the model to choose an owner from evidence that did not uniquely contain the answer. A low-variance Repair could correctly return the same value, which was then rejected as `repair_no_effect`.

## 2. Contract correction

`character_ref` is now the only structured action owner. `action` is a predicate, not a second subject field. Runtime removes canonical names/pronouns that occur before the first action verb. Names after the first action verb remain legal as targets.

Ownership resolution is deterministic:

1. if evidence uniquely identifies a different legal owner, rebind `character_ref`;
2. otherwise retain the legal structured `character_ref` and strip only the conflicting/redundant subject prefix from `action`;
3. do not spend semantic Repair on unresolved pronoun/multi-character ownership.

This does not relax objective action authority. `performance_actions` still requires valid refs and current-shot evidence and remains subject to state/continuity/FrozenText constraints.

## 3. Crash prevention

The malformed warning-path `_err` call is corrected. A source-level AST regression test now verifies that every direct `_err(...)` call uses no more positional arguments than the helper declares, so unexecuted warning/error branches cannot silently retain this class of defect. A runtime regression also executes the high-performance-budget path and verifies that it returns W015 instead of crashing.

## 4. Repair semantics

v17.9 intentionally removes E021 subject-prefix ambiguity from model Repair. Repair remains available for errors where the model has enough authority/context to make a meaningful field correction. Deterministic conflicts stay deterministic. This follows the Runtime-wide rule: do not ask a model to decide information the supplied evidence cannot decide.

## 5. Migration

Director contract is bumped from `director_shot.v17_8` to `director_shot.v17_9`. Checkpoint reuse includes contract identity, and a dedicated regression test proves a completed v17.8 Director checkpoint is not reusable by v17.9. Compiler stays `consumption_v2j`; no compiler behavior change is required for this closeout.

## 6. Non-goals

No story/novel/character/shot-specific rule was added. No Story Bible, Scene Plan, Script, Storyboard, FrozenText, State Resolver or Frozen Core business contract was weakened or rewritten.

## 7. Validation

Engineering regression target: 620/620.  
Additional checks: Python compileall; `/api/health` must expose Build `461123447dfe`, Director `director_shot.v17_9`, Compiler `consumption_v2j`. Real provider/Seedance execution remains product-level validation outside deterministic local tests.
