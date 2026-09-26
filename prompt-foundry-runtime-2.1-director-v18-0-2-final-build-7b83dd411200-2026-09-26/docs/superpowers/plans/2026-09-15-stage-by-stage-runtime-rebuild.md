# Prompt Foundry Stage-by-Stage Runtime Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改 Prompt Foundry Core v1.3 Frozen 的前提下，按 Stage 顺序重新冻结 Runtime 每个 LLM 环节的输入、输出、所有权和验证边界，消除跨阶段雪崩式 bug。

**Architecture:** 每个 Stage 只消费已冻结上游 canonical checkpoint。模型只负责语义字段，程序拥有机械字段；每个 LLM 输出统一经过 Shape → deterministic normalization → authority/reference → semantic/evidence validation → checkpoint。每次只迁移并冻结一个 Stage。

**Tech Stack:** Python 3 / FastAPI / local JSON checkpoint / Volcengine Ark / pytest / Prompt Foundry Core v1.3 Frozen

**Spec:** `docs/STAGE_CONTRACT_MATRIX.md`

## Global Constraints

- Core v1.3 Frozen 文件 SHA 不得变化。
- 不允许一次同时修改两个未冻结 LLM Stage。
- 每个 Stage 先写 Failure Case，再写生产实现。
- Runtime normalization 不得创造叙事或视觉语义。
- repair 最多 1 次，且仅 repair 当前 Unit。
- 已验证且 input hash 未变化的 checkpoint 不得重算。

---

### Task 1: Freeze Stage 01 Story Bible

**Files:**
- Create: `runtime/stages/story_bible.py`
- Create: `tests/runtime/test_stage01_story_bible_contract.py`
- Create: `docs/stages/01_story_bible.md`
- Modify: `runtime/prompts.py`
- Modify: `runtime/orchestrator.py`

**Interfaces:**
- Consumes: `source_text: str`, `run_id: str`
- Produces: canonical Story Bible with program-owned stable IDs

- [x] Write failing tests for program-owned IDs, narrative context schema, evidence grounding, required scalar fields, duplicate canonical entities.
- [x] Verify tests fail on Runtime 2.0.2 baseline.
- [x] Implement isolated Stage 01 contract module.
- [x] Route production Story Bible through Stage 01 module.
- [x] Run Stage 01 tests.
- [x] Run full regression and Frozen Core hash test.

### Task 2: Freeze Stage 02 Scene Plan

**Files:**
- Create: `runtime/stages/scene_plan.py`
- Create: `tests/runtime/test_stage02_scene_plan_contract.py`
- Create: `docs/stages/02_scene_plan.md`
- Modify: `runtime/prompts.py`
- Modify: `runtime/orchestrator.py`

**Interfaces:**
- Consumes: `source_text`, canonical Story Bible only
- Produces: canonical Scene Plan with program-owned SC/B IDs and validated refs

- [x] Audit existing Scene Plan payload and remove model ownership of SC/B IDs.
- [x] Write RED tests for context_ref, location_ref, character/prop refs, Scene/Beat ordering, required structure, and authority leakage. Fuzzy semantic duplicate rejection was explicitly excluded after audit because no source-span evidence exists.
- [x] Implement deterministic SC/B ID assignment after semantic output.
- [x] Freeze reference manifest as the only allowed ref set.
- [x] Run Stage 02 tests + full regression before proceeding.

### Task 3: Freeze Stage 03 Script

**Files:**
- Create: `runtime/stages/script.py`
- Create: `tests/runtime/test_stage03_script_contract.py`
- Create: `docs/stages/03_script.md`

**Interfaces:**
- Consumes: one canonical Scene Plan Scene + relevant Story Bible facts + source text
- Produces: one canonical Script Scene

- [x] Audit exact dialogue preservation and Beat one-to-one mapping.
- [x] Lock scene/location/context/beat refs as program-owned copies.
- [ ] Add source-evidence contract per dialogue/action.
- [ ] Verify per-Scene checkpoint/resume behavior.

### Task 4: Freeze Stage 04 Storyboard Base

**Files:**
- Create: `runtime/stages/storyboard.py`
- Create: `tests/runtime/test_stage04_storyboard_contract.py`
- Create: `docs/stages/04_storyboard.md`

**Interfaces:**
- Consumes: one canonical Script Scene + matching Scene Plan Scene
- Produces: Base Storyboard Scene without Director

- [ ] Freeze required Shot schema.
- [ ] Make SH IDs program-owned.
- [ ] Enforce Beat coverage and exact dialogue reconstruction.
- [ ] Validate shot refs, duration, continuity object, evidence shape before checkpoint.

### Task 5: Freeze Production Design Stages

**Files:**
- Create: `runtime/stages/pvb.py`
- Create: `runtime/stages/psb.py`
- Create: `runtime/stages/style_guide.py`
- Create corresponding tests/docs.

**Interfaces:**
- PVB consumes one Story Bible character.
- PSB consumes one Story Bible physical scene.
- Style consumes canonical Story Bible + source text.

- [ ] Re-audit candidate/skipped/optional_absent ownership.
- [ ] Re-audit Story Bible authority collision.
- [ ] Freeze model-value vs program-metadata split.
- [ ] Freeze locking and prompt materialization behavior.

### Task 6: Freeze Stage 06 Director

**Files:**
- Create: `runtime/stages/director.py`
- Create: `tests/runtime/test_stage06_director_contract.py`
- Create: `docs/stages/06_director.md`

**Interfaces:**
- Consumes: one canonical Base Shot + Script Beat + relevant assets + previous state_out
- Produces: Director fragment only

- [ ] Remove any remaining complete-Shot assumptions.
- [ ] Freeze program-owned speaker refs and state_in.
- [ ] Freeze performance/source-evidence schema.
- [ ] Verify sequential per-Shot continuity and smallest-unit retry.

### Task 7: Final Frozen-Core Integration Gate

**Files:**
- Modify tests only unless a Runtime wiring bug is found.
- Update `docs/TEST_REPORT.md`.

- [ ] Run State Resolver / ShotSpec integration.
- [ ] Run Character/Scene/Shot Compiler regression.
- [ ] Run Static Evaluation.
- [ ] Verify Frozen Core SHA.
- [ ] Run real local API startup/background/resume smoke.
- [ ] Package only after every Stage is marked Frozen in `STAGE_CONTRACT_MATRIX.md`.
