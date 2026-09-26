# Stage 07 — Director Execution Contract

> 文件名沿用旧目录编号；当前真实流水线中 Production Semantics 位于 Director 之前，因此 Director 是 Stage 07。

Status: **DIRECTOR-v18.0_2-REACTION-CAMERA-CONSUMPTION**  
Units: `director_scene:SCxxx` (optional, once per Scene) + `director:SHxxx` (per Shot)  
Contracts: `director_scene_context.v1_1` + `director_shot.v18_0_2`

## v18.0_2 internal architecture

Director remains one product stage. `director_scene:SCxxx` first produces a scene-level strategy and is explicitly fail-soft; validated output is checkpointed by input hash + contract, while unavailable output is not cached. Runtime derives `scene_position`, `reaction_opportunity`, next-Shot `scene_position` and the scene camera baseline; Shot Director then consumes those plus `previous_shot_design` and `scene_distribution_so_far`. Scene Context cannot mutate Story Bible / Scene Plan / Script / Storyboard / Production Semantics and is never rendered into the final Prompt.

Scene Context may own only dramatic function, emotional phases, relationship dynamics, reaction strategy, scene-level camera strategy and character performance baselines. It may not create concrete performance actions, exact camera angle/distance/trajectory, new facts, dialogue, relationships, history, props or outcomes.

## Admission prerequisite

Director 开始前先运行 `director:preflight`：每个 Storyboard Scene 必须存在 Scene Plan context，每个 Shot 必须存在已校验的 Production Semantics。随后当前 Shot 的 `Production Semantics.renderability_status` 必须为 `renderable`。`needs_adaptation` / `blocked` 会在 `production_semantics:gate` 暂停，Director 不执行、不消耗模型调用。

## Input

每个 Unit 只消费：

- 当前 canonical Base Shot；
- 当前 Shot 对应 Production Semantics；
- 对应 Script Beat，仅作剧情上下文；
- 当前 Shot 相关 character / prop / location / narrative context；
- context-aware previous validated `state_out`；
- program-owned allowed refs / exact speakers；
- validated `scene_director_context` + status；
- `previous_shot_design` / `next_shot_purpose` / `scene_distribution_so_far`。

不输入整部 Script、整部 Storyboard，也不允许直接把 raw `shot.description` 当 performance evidence。Director 的动作证据白名单只来自当前 Production Semantics 的 visual events / approved production choices evidence，以及 frozen dialogue。

## Model-owned output

- `dramatic_intent`
- `primary_subject_refs`
- `reaction_target_refs`
- `performance_actions`
- `visual_target`：当前画面主要观看对象，与说话者来源分离
- `visual_focus`：视觉目标内部的局部强调
- `execution_shot_design`：执行层 `shot_size / camera / movement`
- `action_delta`
- `continuity_scope`
- `scene_position` (model echo allowed; Runtime canonicalizes to phase membership when Scene Context is available)
- `scene_context_usage` (model self-reported debug enum list; not effect evidence and not Final Prompt content)

## Program-owned

- `speaker_target_refs`
- resolved `state_in`
- **derived `state_out`**
- `base_shot_fact_constraints` (Fact Authority)
- `base_execution_fallback` (soft execution reference)
- Runtime-derived `scene_position / reaction_opportunity / scene_camera_baseline / next_shot_purpose`
- allowed character / prop refs
- first global Shot `continuity_scope={"mode":"reset"}`

模型提供的 `state_out` 会被删除；Runtime 始终按 `resolved state_in + action_delta` 确定性计算唯一 `state_out`。

## Pre-checkpoint validation

1. outer envelope 必须精确为 `{"director": {...}}`；
2. exact Director / nested JSON fields；
3. allowed refs / exact speakers；
4. transformation type / dependency tags / focus enums；
5. reaction target 必须有 same-character performance action；
6. performance evidence 必须逐字锚定当前权威 action evidence；
7. `performance_actions[*].action` 必须是简体中文；英文/中英混写报 `director_non_chinese_action`；
8. `visual_focus.environment_keys[*]` 会直接进入最终提示词，因此必须是简体中文；英文/中英混写报 `director_non_chinese_environment_focus`，中文但无法由 `program_owned.environment_focus_authority` 直接支持时报 `director_unanchored_environment_focus`；
9. environment focus 只能强调当前 Shot/Scene/Production Semantics 已存在的环境事实，Repair 只能收缩到受支持短语或删除，禁止新造布景、灯光、天气、空间事实；
10. 禁止无证据 performance modifier；
11. dialogue 语义不得在 performance action 中重复表达；
12. `continuity_scope` 的 reset/inherit/partial 必须通过精确继承校验；
13. action_delta 只保留镜头结束后仍需继承的动态变化，禁止 stale delta / transient speaking / 非 canonical 持有关系；
14. Frozen Director validator 再做一次核心语义校验。
15. `visual_target` 与 `speaker_target_refs` 独立：对白声音可继续，但画面可切到听者反应、另一角色、道具或已有环境事实；
16. `visual_target` 与 `visual_focus` 必须一致，focus 不能指向 target 之外的角色/道具；
17. `execution_shot_design` 只能使用冻结摄影枚举；`wide/extreme_wide` 与 face/eyes/mouth/hands 精细焦点为硬冲突，必须在当前 Director Unit 内修复；
18. Runtime 向当前 Director 提供最近最多两镜的实际执行设计；连续三镜完全相同的 `shot_size + camera + movement` 记录为 Director 质量告警，但程序不随机替模型选镜头；
19. State/ShotSpec 确定性采用 `execution_shot_design` 作为最终执行摄影参数，同时保留 `base_shot_design` 供审计；Storyboard Base 不被改写。
20. `shot_purpose` 决定镜头存在理由，`execution_framing` 决定 single / two-shot / over-shoulder / reaction / detail / environment 关系构图；声音来源不再绑定视觉主体。
21. `scene_design_summary` 提供当前 Scene 已使用的景别、机位、运镜、构图和镜头功能统计，供模型识别中近景/平视/固定等场景级单一化；它只提供上下文，不以随机多样性覆盖连续性。
22. `establish_space` 必须使用 wide/extreme_wide；`detail` 与 `emotional_peak` 必须使用 close/extreme_close；`reaction` 必须处于可读反应尺度。

## Repair boundary

Repair 必须以 `repair_instruction.invalid_output` 为基底，只修改 `validation_errors` 指向的当前 Shot 字段。不得顺带改 Base Shot、dialogue、stable refs、Production Semantics 或其他 Shot。

## Output

只保存 validated Director Fragment。全项目 Director Unit 完成后，再运行 `director:gate` 做 assembled deterministic validation；通过后才进入 State + ShotSpec。Gate 失败会记录真正负责错误的 `director:SHxxx` source units，Resume/Retry 会重新生成这些源镜头，而不是空转 Gate。

## Director visual execution v16.1

- Base Shot 仍是 Storyboard 权威，不允许 Director 原地改写。
- `visual_target` 负责回答“画面主要看谁/看什么”；`speaker_target_refs` 只回答“谁在说话”。二者可以不同。
- `execution_shot_design` 是执行层摄影决定，字段只有 `shot_size / camera / movement`。
- Runtime 给模型 `program_owned.base_shot_design` 和最近最多两镜 `recent_shot_designs`，用于上下文摄影判断。
- 旧 v15 checkpoint 可确定性迁移：visual target 从既有 visual_focus 镜像恢复，execution design 回落到 Base Shot；这不产生新剧情或新摄影判断。
- Final ShotSpec/Compiler 使用 execution design，因而最终 Seedance Prompt 的“景别/摄法”会真实反映 Director v16，而不是只保存内部备注。

## Continuity envelope v15

模型层不再直接生成嵌套 `inherit` 对象。原始模型输出固定为：

```json
{"continuity_scope":{"mode":"reset|inherit|partial","inherit_paths":[]}}
```

- `reset` / `inherit`：`inherit_paths=[]`。
- `partial`：每一项必须来自当前 payload 的 `allowed_inherit_paths`，例如 `characters.char_001.position`。
- Runtime canonicalize 后才形成 `{"mode":"partial","inherit":{"characters":...,"props":...,"environment":...}}`，再交给 State Resolver。
- `partial` 但没有任何选择时，程序确定性归一化为 `reset`；这是无继承字段的等价语义，不消耗 Repair。
- 旧 checkpoint 中合法的 nested `inherit` 仍可被 canonicalizer 接受，避免版本升级破坏恢复。


## Director v17.3 execution-authority closeout

Director v17.3 preserves the v17 JSON family and closes execution authority across performance_execution, dialogue_delivery and camera framing. `performance_logic` is evaluated field-by-field: emotion fields need explicit current affect authority; `trigger` and `behavior_goal` must be directly present in current authority; `behavior_tendency` may contain only performance modulation and cannot mint plot actions. Unsupported fields remain debug-only and cannot seed baseline or final Prompt. Camera ownership now uses a positive composition grammar instead of fragile single-word action blacklists. No-visible-character Shots render `人物视线：无`. Director still owns how a Shot is performed and photographed, never plot facts, dialogue text, character history/relationships, or outcomes. See `docs/DIRECTOR_EXECUTION_QUALITY_AUTHORITY_CAMERA_FIX_V17_2_2026-09-23.md`.


### v17.3 execution authority closeout

`performance_execution`, `dialogue_delivery` and `camera_execution.framing_note` now enforce objective-fact authority in addition to field ownership. See `docs/DIRECTOR_EXECUTION_AUTHORITY_CLOSEOUT_V17_3_2026-09-23.md`.


## v17.6 camera authority boundary

`camera_execution.framing_note` is non-authoritative natural-language composition prose. Hard camera facts come from structured visual/camera fields. Deterministic ownership leakage remains hard; unresolved free-text entity authority is soft and the note is omitted from final rendering.


## v17.8 non-authoritative execution stability

`performance_actions` remains the authoritative objective-action layer and keeps exact evidence/ref/state hard gates. `performance_execution` and `dialogue_delivery` are optional execution modifiers, like `camera_execution.framing_note`: they do not own plot facts.

- Ambiguous local articulation verbs are field-aware. `抬起/放下` may describe eyebrows, gaze, chin, shoulders or hands without becoming an objective story mutation; object/state-changing uses remain authority-gated.
- Unsupported objective facts inside execution/delivery produce `W024_PERFORMANCE_EXECUTION_DROPPED_UNSAFE` / `W025_DIALOGUE_DELIVERY_DROPPED_UNSAFE`; they never consume semantic Repair.
- Compiler uses the same performance-execution authority surface as Director and drops only unsafe optional fields.
- Production Readiness keeps E028/E029 only as defense-in-depth when rejected optional text actually survives into the rendered manifest.
- Invalid character refs, FrozenText ids/speakers, authoritative performance evidence, continuity and state remain hard failures.


## v17.9 action-subject ownership and execution stability

`performance_actions.character_ref` is the sole structured owner of a performance action. `performance_actions.action` is predicate-only executable prose: it must not repeat a canonical character name or pronoun before the first action verb. Character names may still appear after the verb when they are genuine action targets.

Canonicalization is deterministic:

- if exact/semantic evidence uniquely selects another legal character, Runtime rebinds `character_ref`;
- if evidence is multi-character, pronoun-only, or otherwise cannot uniquely arbitrate, Runtime keeps the already-valid `character_ref` and strips only the pre-verb subject text;
- the same ambiguous evidence is never sent back to the model to guess the owner, so E021 cannot consume the sole semantic Repair and then terminate as `repair_no_effect`;
- evidence/ref/state/continuity/objective-action violations remain hard errors.

The performance-budget validator also has direct and static arity regression coverage for `_err(...)`, preventing warning-only branches from crashing Stage execution.
