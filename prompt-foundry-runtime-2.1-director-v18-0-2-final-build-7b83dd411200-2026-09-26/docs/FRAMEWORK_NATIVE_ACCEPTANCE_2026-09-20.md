# Framework-native acceptance — 2026-09-20

This verification executes the packaged Prompt Foundry Runtime through its real framework surfaces, not isolated validator/compiler helpers.

## Verified paths

1. `scripts/serve.py` starts the packaged application and `/api/health` reports build `e242720c7a51` plus the current Runtime contracts.
2. `FastAPI POST /api/runs` with `sync_runs=False` executes the actual background scheduling path through `RuntimeV20`, RunStore, CheckpointStore, all semantic Units, deterministic State/ShotSpec, Shot Consumption Manifest and Consumption Compiler.
3. The resulting run reaches `completed`, `compile_status=ok`, static evaluation passes and consumption evaluation passes.
4. Final shot prompts are read back from the persisted run and contain the fixed 13-field storyboard delivery format.
5. A provider failure at `storyboard:SC001` pauses only the responsible Unit. Recreating the FastAPI application against the same persisted RunStore/CheckpointStore and calling `/api/runs/{id}/resume` reuses completed upstream work and finishes successfully.
6. The original canonical framework fixture also completes through the same API/runtime chain after the contract rebalance.

## Permanent regression tests

`tests/api/test_framework_native_e2e.py` now locks two production-facing paths:

- asynchronous API full-chain execution to final prompt;
- persisted pause/restart/resume recovery across application instances.

These tests supplement, rather than replace, per-stage contract tests and mock-provider semantic tests.
