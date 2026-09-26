# Core Chain Compile Stability Closeout — v2l

Date: 2026-09-25  
Build: `b6cbf8e64357`  
Director: `director_shot.v17_9`  
Compiler: `consumption_v2l`  
Production Readiness: `production_readiness.v4_10`

## Why the chain was still stopping

The remaining failures were no longer upstream story/Director failures. They were downstream production-readiness rules treating deterministic rendering quality defects as fatal contract violations.

Three cases were involved:

1. The same authorized objective action could be represented in both `performance_actions` and an authorized `performance_execution` field. v2k joined whole paragraphs, so identical action clauses could be rendered twice and later rejected as `production_text_duplicate_clause`.
2. `camera_language_repetition_without_continuity_reason` treated three repeated camera signatures as a compile invariant even though camera variety is an aesthetic/quality choice, not story truth.
3. E028/E029 need to stay hard only for actual unsafe final-manifest leakage. Compiler filtering and `modifier_trace.v1` remain the source-specific boundary; the corruption-defense tests remain hard.

## v2l contract

### Deterministic repair first

Compiler merges performance output at clause granularity. Exact normalized duplicate clauses are removed before `visual_content` is built. It does not paraphrase, reorder, or collapse distinct acting details.

### Quality remains visible without stopping the run

`production_text_duplicate_clause` is now a readiness warning if any residual duplicate remains after compiler de-duplication.

`camera_language_repetition_without_continuity_reason` is also a readiness warning. It remains visible for production review, but a valid scene is not rejected simply because three consecutive shots reuse the same size/camera/movement/framing.

### Safety gates remain hard

`E028_DIRECTOR_EXECUTION_AUTHORITY` and `E029_DIALOGUE_DELIVERY_AUTHORITY` still block when unsafe optional Director text is actually present in the rendered manifest. Tests explicitly mutate a compiled manifest to simulate a compiler bypass and verify that readiness still rejects it.

FrozenText reconstruction, speaker ownership, objective action authority/evidence, physical state continuity, canonical asset source-of-truth, and final prompt structure remain blocking invariants.

## Recovery behavior

Director stays at `director_shot.v17_9`, so valid Director semantic checkpoints remain reusable. Compiler changes from `consumption_v2k` to `consumption_v2l`; Resume/Retry should re-run the deterministic compile/readiness stage under the new renderer without forcing model regeneration for already-valid Director units.

## Verification

- `631/631` tests pass.
- New regression coverage proves exact action overlap is de-duplicated before readiness.
- New regression coverage proves residual duplicate clauses are warnings rather than compile blockers.
- New regression coverage proves camera-language repetition is a warning rather than a compile blocker.
- Existing actual E028/E029 corrupted-manifest tests still pass as hard failures.
- Full-chain prompt-owner smoke passes.
- Python `compileall` passes.
- Real local `/api/health` returns HTTP 200 with Build `b6cbf8e64357`, Director `director_shot.v17_9`, Compiler `consumption_v2l`.

The uploaded project contains no persisted failing user Run/checkpoint, so the exact real 37-shot Run cannot be replayed offline here. The deterministic failure classes reported in the latest Compile output are covered by the v2l tests and contract changes above.
