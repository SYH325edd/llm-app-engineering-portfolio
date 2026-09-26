# Core Chain Final Stability v2m — 2026-09-25

Build: `f0acbd5b8232`  
Director: `director_shot.v17_9`  
Compiler: `consumption_v2m`  
Production Readiness: `production_readiness.v4_11`

## Goal

Keep the Prompt Foundry core chain running to completion. Hard-stop only defects that can corrupt plot facts, stable references, frozen dialogue/narration, state/continuity, or the compiled artifact itself. Director quality shortfalls remain visible but do not stop production.

## Root causes fixed

### 1. E029 provenance false positives

Readiness previously inferred ownership by searching an unsafe raw `dialogue_delivery.gaze_during_line` string inside the aggregate rendered gaze field. That can misclassify legal text rendered by another channel, or stale/legacy compiler artifacts.

Compiler v2m writes two deterministic protections:

- `rendered_modifier_trace_version = modifier_trace.v1`
- `rendered_surface_fingerprint_version = surface_hash.v1`

Normal Readiness now treats source-specific modifier trace as the authority. It does not use aggregate string coincidence to prove leakage when trace exists.

A real post-compile mutation is still hard-failed: surface fingerprints first prove the compiler-owned field changed, and only then can rejected injected modifier text be classified as `E028` / `E029`. Other unexplained mutations fail as `rendered_manifest_integrity_mismatch`.

### 2. E025 was a quality gate, not a structural gate

`E025_PERFORMANCE_NOT_EXECUTABLE` stopped the entire run when a critical/high-density character shot lacked extra v17 `performance_execution` signals. That is a director-quality weakness, not proof of changed plot facts.

It is now `W027_PERFORMANCE_NOT_EXECUTABLE`. The shot can compile with objective action, dialogue, framing and continuity intact while the quality issue remains visible for later refinement.

## Hard gates intentionally retained

- frozen dialogue/narration integrity;
- unknown/invalid stable refs and asset source-of-truth mismatch;
- objective action / state / continuity violations;
- true unsafe E028/E029 content that actually enters a compiler-owned rendered surface;
- compiler-owned rendered surface mutation after sanitization;
- malformed production text defects that can alter or truncate content;
- unresolved production duration authority.

## Compatibility / resume

Director remains `director_shot.v17_9`; valid Director checkpoints do not need model regeneration. Compiler changes from `consumption_v2l` to `consumption_v2m`, so Resume/Retry should re-run deterministic compile/readiness under the new provenance/fingerprint contract.

Do not delete valid upstream checkpoints unless their own input/contract identity changed.

## Verification

- full project pytest: `631 / 631` collected tests pass;
- Python `compileall`: pass;
- full-chain prompt-owner smoke: pass;
- real local `/api/health`: HTTP 200;
- health Build: `f0acbd5b8232`;
- health Director: `director_shot.v17_9`;
- health Compiler: `consumption_v2m`.

This is engineering/runtime verification. The package does not contain the user's live failed run checkpoints, so that exact live novel run was not replayed offline.
