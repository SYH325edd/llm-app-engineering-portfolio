# Prompt Foundry Runtime 2.1 — Core Chain Stability Closeout

Date: 2026-09-25  
Build: `9ca55fb88fe5`  
Director contract: `director_shot.v17_9`  
Compiler: `consumption_v2k`  
Frozen Core: `1.3-frozen` unchanged

## Why the chain kept stopping

The current SH011 failure exposed a responsibility conflict rather than a novel-specific prompt problem.

`reaction_target_refs` was treated simultaneously as a camera/visual choice and as proof that the same character must own an evidence-backed objective `performance_action`. When exact evidence uniquely belonged to another character, Runtime correctly rebound the objective action owner, then immediately failed because the remaining reaction target had no same-character objective action. The old stabilizer attempted to satisfy that second rule by manufacturing another action from reaction evidence. If that evidence was multi-character or misattributed, the system recreated E021 and spent the one model Repair on an impossible loop.

The actual loop was:

1. model attaches objective action to wrong `character_ref`;
2. exact evidence uniquely identifies the real action owner;
3. Runtime deterministically rebinds the action owner;
4. old rule still requires every `reaction_target_ref` to have a same-character objective action;
5. Runtime/model attempts to add one only to satisfy the camera relation;
6. the added action conflicts with the exact evidence owner;
7. E021 returns, then `repair_no_effect` pauses the run.

## Contract correction

The runtime now separates the authorities:

- `performance_actions[*].character_ref` is the sole owner of an objective, evidence-backed story action.
- `reaction_target_refs` is a visual/camera choice only. It may name a listener or affected character even when the source text gives that character no explicit objective action.
- a reaction target no longer requires a same-character `performance_action`.
- optional visible reaction detail belongs in `performance_execution` when useful and safe; it may also be empty.
- Runtime never invents an objective action merely to make a reaction shot legal.

This is generic and contains no SH011/person/novel branch.

## Evidence attribution correction

`reaction_performance_evidence_by_character` is retained only as diagnostic/context information. Multi-character Production Semantics no longer lends one quote to every referenced character. Evidence is attributed only when one character is uniquely determined by structured semantics or an explicit canonical subject.

This prevents a quote such as `老周...` from being offered as evidence for another visible character simply because both characters are present in one semantic event.

## Core-chain-first policy

The runtime now distinguishes hard production authority from non-authoritative director enrichment.

Hard blockers remain hard:

- invalid/unknown stable refs in objective story fields;
- unanchored `performance_actions` evidence;
- objective action subject ownership conflicts that cannot be deterministically resolved;
- FrozenText/dialogue ownership and immutable text constraints;
- `action_delta`, continuity and state transition errors;
- schema/shape errors that downstream stages cannot consume;
- unauthorized objective story facts.

Fail-soft / quality-only director concerns:

- reaction targets without objective performance actions;
- camera/framing/shot-purpose coherence conflicts after deterministic stabilization;
- shot-size/focus quality conflicts after deterministic stabilization;
- visual-target/focus coherence when it is a director-quality issue rather than an unknown stable ref;
- optional `performance_logic` / `performance_execution` entries attached to non-current characters are dropped;
- optional `dialogue_delivery` entries with unknown FrozenText units are dropped, duplicate units keep the first entry, and speaker ownership is corrected from the immutable FrozenText target.

The goal is not to accept corrupted story facts. The goal is to stop optional directing metadata from consuming the semantic Repair budget or preventing Compile.

## Frozen Core boundary

`packages/prompt_foundry_v13` remains frozen. The legacy Core still contains its historical `reaction_target_without_performance` rule. Runtime suppresses that obsolete rule only at the compatibility boundary:

- per-shot frozen Director validation is filtered in `runtime/orchestrator.py`;
- frozen static evaluation is adapted in `runtime/stages/compile_eval.py`.

The frozen files themselves were restored unchanged and their hash guard passes.

## Resume behavior

The Director contract remains `director_shot.v17_9` intentionally. The JSON shape and objective action authority did not change; this patch removes an invalid cross-field coupling and hardens optional enrichment handling.

The Build ID changes to `9ca55fb88fe5`. On Resume across the old Build → new Build boundary, Runtime clears stale validator-specific repair hints. Completed semantic checkpoints remain eligible for normal contract/input reuse, while the previously failed Director unit is re-evaluated under the new runtime.

This avoids needlessly regenerating every already-completed Director shot.

## Verification

Final verified worktree:

- `pytest -q`: PASS
- 628 tests collected / all passed
- `python -m compileall`: PASS
- `/api/health`: HTTP 200
- Build: `9ca55fb88fe5`
- Director: `director_shot.v17_9`
- Compiler: `consumption_v2k`
- explicit local end-to-end Runtime smoke: `completed`
- Compile unit: `completed`
- ShotSpec generated
- final shot prompt generated
- Frozen Core hash test: PASS
- no runtime source branch contains `SH011`, `老周`, or `年轻人`

## What is not claimed

The uploaded package does not contain the user's real persisted failed run/checkpoints, so the exact production run could not be replayed offline. The fix is validated against the failure class, the runtime resume/build-boundary behavior, the full repository test suite, and a complete local E2E chain. Real Ark output may still reveal a different class of model or authority failure; if that happens it should be classified against the hard/fail-soft boundary above rather than patched per novel.
