# Production Freeze Closeout v2

Build: `08e87cc13d3f`

## Frozen output surface

Final Seedance prompt remains exactly 13 fields:

`镜号 / 时长 / 场景 / 人物空间站位 / 景别 / 摄法 / 画面内容 / 旁白 / 台词 / 动作音效 / 环境音效 / 氛围音效 / 配乐`

## Contracts

- Runtime: `2.1`
- Frozen Core: `1.3-frozen`
- Story Bible: `story_bible.v14`
- Scene Plan: `scene_plan.v8`
- Script: `script_scene.v12`
- Storyboard: `storyboard_scene.v16`
- Production Semantics: `production_semantics_shot.v1j`
- Director: `director_shot.v16_2`
- State/ShotSpec: `state_shotspec.v2`
- Compiler: `consumption_v2f`
- Asset registry: `asset_registry.v2`
- Continuity anchor: `continuity_anchor_v2`
- Production Readiness: `production_readiness.v2`

## Closeout changes

### 1. Asset source of truth

Character continuity anchors and global character asset prompts are compiled from the same canonical character record. Stable identity and wardrobe are no longer independently re-described at Shot level. Canonical asset hashes are propagated into Shot provenance and checked by Production Readiness.

### 2. Scene stable/state split

Permanent space/layout/material/environment/color are stored separately from time-bound or transient state. Temporal lighting is selected only when compatible with the current Script scene time. Transient clauses such as “旧铺现在是咖啡店” are state/sublocation facts and never permanent scene identity.

### 3. Continuity Anchor v2 and W005 budget

Final prompts continue to carry readable continuity anchors for independently rendered video Shots; they do not emit bare `char_001`/`scene_001` IDs as the only visual context. W005 now reports continuity/shot-delta/dialogue/audio budgets instead of treating every prompt over a fixed character count as equally wasteful.

### 4. Beat / utterance integrity

Production Readiness reconstructs dialogue from FrozenTextUnit refs and blocks unknown refs, speaker drift or non-exact downstream reconstruction. Adjacent raw Script fragments that belong to one FrozenText utterance remain a single authority unit without rewriting Script source text.

### 5. Performance evidence completion

Performance source priority is Director → Production Semantics → explicit Storyboard/spatial motion → reaction/gaze/posture → continuity fallback. Explicit motion such as pushing a tricycle may not collapse to generic breathing fallback.

### 6. Cross-field dialogue hygiene

Literal dialogue is owned by the dialogue track. Quoted dialogue repeated inside performance text is stripped deterministically while preserving visible mouth/gaze/body cues.

### 7. Director v16.2 repetition gate

Director receives scene-level design distribution. For a non-continuity narrative-purpose Shot, if the established scene grammar is heavily concentrated in at least three execution dimensions, the current Director unit must redesign a narratively useful dimension. A second pressure gate specifically prevents long scenes from remaining overwhelmingly camera-static even when shot size/framing vary. It may not evade either rule by changing plot facts, dialogue, visual target or shot purpose.

The final scene-level Readiness gate computes the minimum recoverable Director Shot set needed to move camera/movement concentration below the hard threshold. Recovery therefore regenerates the affected units rather than repeatedly blaming only the final Shot.

### 8. Production Readiness v2

Freeze checks include:

- 13-field final surface
- exact utterance reconstruction
- residual duration overload
- canonical asset hygiene
- character/scene source-of-truth hashes
- stable scene-anchor drift
- critical performance fallback
- visual/dialogue leakage
- malformed or truncated production text
- three-Shot repetition without continuity reason
- scene-wide camera/movement overconcentration

A successful compile is not automatically Freeze Ready. Readiness returns `production_freeze_ready` only when hard checks pass.

## Validation boundary

This closeout is locally validated at engineering/contract/final-prompt level. It does not claim real Seedance 2.5 render calibration. The uploaded `run_590f694663eb` result was available as rendered Markdown, not as structured `data/runs` artifacts, so its exact historical run was not recompiled without model calls. Its observed failure patterns were converted into generic regression cases and validated locally.
