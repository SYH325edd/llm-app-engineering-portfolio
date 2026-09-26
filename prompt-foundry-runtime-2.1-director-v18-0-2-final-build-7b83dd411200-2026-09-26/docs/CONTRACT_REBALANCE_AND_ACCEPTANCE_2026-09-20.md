# Prompt Foundry Runtime 2.1 — Contract Rebalance & Acceptance

Date: 2026-09-20
Build: e242720c7a51

## 1. Scope

This change preserves the existing production chain and its direction:

`Source -> Story Bible -> Scene Plan -> Script -> Storyboard -> PVB/PSB/Style -> Production Semantics -> Director -> State/ShotSpec -> Compile/Eval`

A deterministic consumption step is inserted before final rendering:

`State/ShotSpec -> Shot Consumption Manifest -> Final Prompt Renderer`

The manifest step does not call an LLM and does not create story facts. It selects, deduplicates and validates already-frozen state/assets for one final shot.

## 2. Global policy: hard where truth matters, soft where direction/design matters

Hard contracts now protect:

- immutable source text and deterministic source references;
- IDs, references and cross-stage ownership;
- source-authored dialogue completeness, order, speaker and scene scope;
- source-authored narration selected for voice-over;
- Story facts / identity locks / explicit visual locks;
- no new story event, person or prop introduced by downstream stages;
- persistent state authority and prohibition on semantic/psychological state injection;
- production renderability terminal states;
- actual consumption of PVB / PSB / Style / Director data by the final prompt.

Soft/directorial space is retained for:

- shot size, camera, movement and composition;
- micro-performance, gaze, breathing, pause, posture and visible reaction;
- visual design not specified by the source, provided it does not conflict with frozen facts;
- scene production design not specified by the source;
- style language;
- harmless punctuation, whitespace and authorized proper nouns / Latin text.

## 3. Source and provenance foundation

`runtime/source_index.py` now creates stable `SRCxxxx` source units with character offsets. Story Bible evidence can select source refs; the program materializes the exact quote and offsets from immutable source text.

The source-unit sentence splitter keeps closing quote marks with the spoken sentence, so common prose such as `Tom说：“医生马上来。”` is not split into a dangling closing quote unit.

Scene Plan v5 carries source refs and canonical source spans. Script units consume the current scene source scope rather than treating the entire novel as the active source for every scene.

## 4. Stage contract changes

### Story Bible v5

- non-empty source must result in a usable scene basis;
- exact evidence text is materialized by the program from source refs;
- visual-lock leaves must be concrete strings;
- narrative importance no longer doubles as speaking permission.

### Scene Plan v5

- scenes are grounded in source refs / source spans;
- location/context references remain hard;
- legacy checkpoints without refs are migrated only when the source range can be determined mechanically; ambiguous recovery is not guessed.

### Script Scene v5

- each scene receives only its source scope;
- source-authored dialogue is hard-fidelity data: no omission, duplication, wrong order or wrong speaker;
- background narrative role does not prohibit an authored line;
- narration is a distinct exact-source channel and cannot silently disappear into descriptive prose.

### Storyboard Scene v9

- dialogue and narration are distributed to shots exactly once;
- shot language may retain authorized proper nouns such as iPhone / AI / names;
- shot-design and micro-visualization rules are production-quality constraints rather than brittle character-level source matching.

### PVB / PSB / Style

- explicit Story locks remain authoritative;
- unspecified visual fields remain legitimate production-design space;
- a low-narrative-role character that is actually visible can receive a production PVB;
- final consumption verifies that these assets are not dead data.

### Production Semantics v1e

- missing semantic booleans such as `offscreen` are not silently invented by canonicalization;
- action / environment / atmosphere audio roles are carried separately;
- `blocked` is a terminal human-required result, not a blind regeneration loop;
- `needs_adaptation` is repaired in the responsible semantic unit before Director.

### Director v14

- visible micro-performance may be designed without requiring every modifier to be a literal source token;
- Director still may not add a new story event;
- persistent `action_delta` may not inject relationship, belief, motive or psychological truth;
- static asset state remains outside Director dynamic-state authority.

### State/ShotSpec v2

- deterministic state resolution remains authoritative;
- validated Storyboard narration is mechanically propagated by `shot_id` so voice-over cannot be lost during the frozen state/ShotSpec step.

## 5. Stage 8.5 — Shot Consumption Manifest

`runtime/shot_manifest.py` is the deterministic final selection layer. For each shot it consumes:

- ShotSpec / state;
- Production Semantics;
- Director performance;
- Story Bible;
- PVB;
- PSB;
- Style Guide;
- Script / narration / dialogue.

It does not generate plot. It chooses the minimum sufficient visible information, groups audio, removes literal-dialogue duplication from action prose, and passes one normalized manifest to the renderer.

## 6. Final storyboard prompt contract

Each deliverable shot renders the fixed fields:

1. 镜号
2. 时长
3. 场景
4. 人物空间站位
5. 景别
6. 摄法
7. 画面内容
8. 旁白
9. 台词
10. 动作音效
11. 环境音效
12. 氛围音效
13. 配乐

The final renderer is deterministic. Dialogue and narration are not rewritten at Compile time. PVB / PSB / Style and Director performance are selected into `画面内容`; diegetic / production audio is grouped into the three audio fields.

## 7. Acceptance coverage

New acceptance coverage is in `tests/runtime/test_contract_rebalance_acceptance.py` and validates in one stateful chain:

- Chinese source indexing around quoted dialogue;
- a background-role character with real source dialogue;
- authorized Latin proper nouns (`Sophia`, `Tom`, `iPhone`);
- selected narration surviving through State/ShotSpec into the final prompt;
- visible low-role PVB generation and consumption;
- PSB and Style consumption;
- production-design environment SFX;
- Director micro-performance freedom;
- persistent psychological state rejection;
- exact final 13-field prompt rendering.

Final local verification for this build:

- pytest: 348 / 348 collected tests passed;
- Python compileall: passed;
- Web JavaScript syntax (`node --check apps/web/app.js`): passed;
- stateful Runtime acceptance: `completed`;
- compile status: `ok`;
- static evaluation: passed;
- consumption evaluation: passed.

## 8. Honest boundary

This verifies the runtime, deterministic contracts, migration behavior and full stateful mock-provider chain. It is not statistical proof that 99% of arbitrary novels will succeed with a live model. A defensible 99% claim requires a frozen regression corpus spanning dialogue-heavy prose, first-person narration, flashbacks, repeated locations, ensemble casts, fantasy/science-fiction terminology, long texts, scene returns, wardrobe/prop changes and other structural families, then measuring full-chain completion and fidelity on that corpus.
