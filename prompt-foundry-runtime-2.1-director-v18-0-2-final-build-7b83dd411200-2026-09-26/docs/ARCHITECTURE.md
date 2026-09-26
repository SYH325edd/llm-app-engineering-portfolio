# Prompt Foundry Runtime 2.1 Architecture

Runtime 2.1 solves LLM orchestration and recovery; it does not rewrite Prompt Foundry Core v1.3.

## Layers

```text
Web
↓
FastAPI
↓
Runtime 2.1 Orchestrator
├─ Stage-owned contracts
├─ CheckpointStore / input hash
├─ ContextBuilder
├─ ModelRouter
├─ repair boundary
└─ RunStore / Events
↓
Prompt Foundry Core v1.3 Frozen
├─ Director Contract
├─ State Resolver
├─ ShotSpec
├─ PVB optional semantics
├─ Character Compiler
├─ Scene Compiler v1.1.1 authority guard
├─ Shot Compiler v1.3
└─ Static Evaluation
```

## Strict unit graph

```text
story_bible
↓
scene_plan
↓
script:SCxxx
↓
storyboard:SCxxx
↓
pvb:char_xxx / psb:scene_xxx / style_guide
↓
director_scene:SCxxx (optional fail-soft)
↓
director:SH001 → director:SH002 → ...
↓
state_shotspec
↓
compile
  └─ compile:assets (production lock + Character/Scene materialization)
↓
Character / Scene / Shot prompts + Static Evaluation
```

Stage 08 is not executed before Director. Production-design candidates remain candidates until the final deterministic production stage.

## Checkpoints

Each model/deterministic Unit is keyed by its complete canonical input hash. A completed Unit is reused only if the hash is unchanged. Retry deletes the target Unit; downstream Units naturally re-run only when their own canonical input changes.

## Director context

Director remains one product stage with Scene and Shot units. `director_scene:SCxxx` uses `director_scene_context.v1_1` to classify continuous Dramatic Turns over the existing Shot sequence; an available/repaired result must be a complete ordered partition. Runtime then derives creative context (`scene_position`, `reaction_opportunity`, next scene position, scene camera baseline). `director:SHxxx` uses `director_shot.v18_0_2` with HARD `base_shot_fact_constraints` and SOFT `base_execution_fallback`; Runtime also derives legal reaction candidates from current-shot character/speaker authority, and the model-facing execution template no longer pre-fills Base camera values. Neither unit receives the complete novel.

Scene Context and Runtime-derived creative context are quality/direction layers, not Fact Authority. They cannot create new events/dialogue/relationships/props or override FrozenText/physical continuity. Context Effect Audit is deterministic observation only and cannot affect model input, validation, State or Compiler.

## State chain

Director decides `continuity_scope` and explicit state semantics. Stage 06 validates resolvability. Stage 07 delegates exact `state_in` and ShotSpec construction to Frozen Core.

## Failure isolation

Hard Fact/contract Unit failure pauses the Run as recoverable. Valid checkpoints remain. Scene Director Context is the explicit exception: provider/schema/semantic failure is recorded as an unavailable Scene Context status and the Shot Director continues in legacy mode. Failed optional Scene Context outputs are not cached. Service restart still converts orphaned hard running/pending Runs to recoverable paused state.

## Outputs while paused

Canonical upstream artifacts and production-design candidates remain inspectable. Final Character/Scene/Shot production prompts are materialized only after Stage 08 succeeds.

## No second pipeline

Legacy whole-project `StoryPipelineV13` is not a Runtime production path. Runtime 2.1 is the single production orchestration chain.
