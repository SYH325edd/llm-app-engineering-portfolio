# Compile Contract Coherence Closeout — consumption_v2k

Date: 2026-09-24  
Runtime: 2.1  
Director: `director_shot.v17_9` (intentionally unchanged)  
Compiler: `consumption_v2k`  
Production Readiness: `production_readiness.v4_9`  
Build: `850468e23225`

## Why the compile stage was still stopping

The reported compile failure combined three independent contract contradictions. None required novel-, scene-, shot- or character-specific handling.

### 1. Runtime state_out false mismatch

Director v17 context state legitimately carries `characters.<ref>.performance_baseline`. That baseline is program-owned acting context and is not written by `action_delta`. Compile static evaluation previously recomputed state with Runtime v10 `state_in + action_delta` and compared the entire state object, so any newly established or updated performance baseline could be rejected as `runtime_state_out_derivation_mismatch` even when physical continuity was correct.

v2k introduces a physical-state comparison view. It removes only the Runtime-owned `performance_baseline` extension before the Runtime v10 derivation equality check. Character/prop/environment physical state remains hard-validated, including null-clear semantics and tamper detection.

### 2. E029 false leakage from aggregate text matching

The compiler correctly filters unsafe optional `dialogue_delivery` / `performance_execution` fields before rendering. Production Readiness previously tried to prove leakage by searching the rejected source string in aggregate final fields such as `manifest.gaze`. If a legal modifier from another source independently rendered exactly the same wording, Readiness could incorrectly blame the rejected dialogue field and raise E029.

v2k records `modifier_trace.v1` provenance for each actually rendered optional modifier: source, source index, field and rendered value. Readiness v4.9 checks this source-specific provenance instead of treating aggregate string coincidence as proof of leakage.

Defense in depth is preserved. If rejected text appears in the final manifest but no legal trace source owns it, Readiness still hard-fails E028/E029. Legacy manifests without trace metadata retain the old surface-text fallback.

The compiler's current-shot entity vocabulary also now includes character aliases, matching Director validation. A legal current-character alias can no longer pass Director and then be silently rejected downstream.

### 3. Camera distribution quality was incorrectly promoted to a compile invariant

Director already classifies scene-wide camera/movement repetition as soft quality pressure. The prompt explicitly prohibits adding decorative motion merely to satisfy diversity. Production Readiness contradicted that contract by turning scene camera over-concentration into hard errors, which could halt a structurally valid project solely because a quiet scene used repeated eye-level/static grammar.

v4.9 preserves the complete diagnostic, affected shot set, required dimensions and repair guidance, but reports it as `W026_CAMERA_DISTRIBUTION_OVERCONCENTRATED`. It no longer makes compile fail. Hard camera ownership/authority violations remain hard failures.

## Version and checkpoint policy

Director remains `director_shot.v17_9`. This is deliberate: the fix changes deterministic compiler/readiness interpretation, not Director semantic output. Existing valid v17.9 Director checkpoints therefore remain reusable and do not need model regeneration. Compiler changes to `consumption_v2k`, which scopes invalidation to the downstream deterministic stage.

## Regression coverage

New/updated tests prove:

- program-owned `performance_baseline` does not create a Runtime v10 physical-state mismatch;
- real physical state tampering still fails;
- same wording from legal `performance_execution.gaze` does not produce a false E029 for a rejected dialogue gaze;
- real un-attributed/corrupted E029 leakage still fails hard;
- current-character aliases are accepted consistently by Director and compiler gaze authority;
- scene-wide camera over-concentration is retained as a minimal recoverable warning set rather than a hard error;
- existing dialogue helper string API remains backward compatible while compiler-internal provenance is added.

Final deterministic validation: `624/624` tests pass, Python compileall passes, and `/api/health` returns HTTP 200 with Build `850468e23225`, Director `director_shot.v17_9`, Compiler `consumption_v2k`.

The delivered source contains no branching on the reported shot IDs, scene ID, character names or the current novel.
