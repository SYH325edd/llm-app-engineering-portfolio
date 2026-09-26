# Prompt Foundry Director Architecture v18 — v18.0_1 Consumption Correction

This file records the implemented v18.0 Iteration-1 correction. It does not implement v18.1 Creative Continuity, v18.2 full Camera Grammar or Compiler v2n.

## Frozen boundaries

Story Bible v14, Scene Plan v8, Script v12, Storyboard v16, Production Semantics v1j, Frozen Core, State/ShotSpec v2, Consumption v2m and Production Readiness v4_11 are unchanged.

## Director internal graph

```text
Fact Spine (read-only)
  -> director_scene:SCxxx / director_scene_context.v1_1 / optional fail-soft
  -> Runtime-derived creative context
  -> director:SHxxx / director_shot.v18_0_1
  -> read-only Context Effect Audit
  -> State Resolver + ShotSpec v2
  -> Consumption v2m
```

## Scene Context v1_1

Scene Context identifies continuous Dramatic Turns. One Beat may contain multiple Phases, but any `available/repaired` result must partition all existing Scene Shots exactly once, in order, with contiguous/non-crossing Phases and unchanged Beat ownership. One local Repair is allowed; failure makes the whole Scene Context unavailable and the Scene runs in Legacy Director mode.

`camera_strategy` is Scene baseline only (`stability`, `framing_tendency`, `movement_policy`). It cannot prescribe exact per-Shot shot size, angle, motion, composition, blocking or performance action.

## Runtime-derived creative context

When Scene Context is available/repaired, Runtime deterministically derives `scene_position`, `reaction_opportunity`, next-Shot `scene_position` and the scene camera baseline. These guide creative execution but are not Fact Authority and never enter State/Compiler as story facts.

## Shot Director v18_0_1

Base Shot authority is split into `base_shot_fact_constraints` (HARD) and `base_execution_fallback` (SOFT). Director decision order is Fact constraints -> scene position -> reaction opportunity -> current shot/dialogue function -> previous execution -> next scene position -> scene baseline -> base execution fallback. Director may reuse Base execution when it remains best; variation is not a target.

## Context Effect Audit

`runtime/director_context_effect.py` computes read-only Shot/Scene observations: scene-position source, reaction opportunity/visualization, context-usage emptiness and Base-to-execution deltas. The audit never enters model input, Final Prompt, Hard Gate, Repair or Pause.

## Surface boundary

The deterministic same-model A/B keeps the Seedance prompt byte-identical at 269 characters. Scene Context and audit data remain internal Director/debug IR.

Current Build: `af52d4abaa61`.
