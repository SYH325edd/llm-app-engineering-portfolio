# Prompt Foundry Runtime 2.1

## 2026-09-26 Director v18.0_2 — Reaction & Camera Consumption Correction

当前正式基线：Runtime `2.1` · Scene Director `director_scene_context.v1_1`（冻结不变）· Shot Director `director_shot.v18_0_2` · State `state_shotspec.v2` · Compiler `consumption_v2m` · PVB `pvb_character.v3_1` · Build `7b83dd411200`。本轮只修 Shot Director consumption：Runtime 以精度优先规则确定 `reaction_candidate_refs`：优先当前 Shot 反应证据，其次 Scene `speaker_listener` 关系，再使用唯一非 speaker 角色作为安全 fallback；多人歧义时保持空集合；当 `reaction_opportunity=true` 时模型必须真实比较 speaker visual 与合法 listener/reaction visual，但不强制切反应；Camera 决策顺序改为 scene position → visual subject → framing → adjacent execution → scene baseline → base fallback。模型可见 `output_template` 不再预填 Base 的 `single / medium / eye_level / static`，避免把 fallback 继续当默认答案。Scene Context v1_1、Fact Spine、State、Compiler、Readiness、Performance 架构均未修改。Context Effect Audit 同时修正 speaker authority 来源并新增 `reaction_candidate_available` 观测。详见 `docs/DIRECTOR_V18_0_2_REACTION_CAMERA_CONSUMPTION_ACCEPTANCE_2026-09-26.md`。

## 2026-09-26 Director v18.0_1 — Consumption Correction

当时正式基线：Runtime `2.1` · Scene Director `director_scene_context.v1_1` · Shot Director `director_shot.v18_0_1` · State `state_shotspec.v2` · Compiler `consumption_v2m` · PVB `pvb_character.v3_1` · Build `af52d4abaa61`。本轮只修 `Scene Context → Shot Director → Execution Decision`：Dramatic Phase 改为完整有序 Shot 分区，`scene_position/reaction_opportunity` 改为 Runtime-Derived Creative Context，Base Shot 拆分为 HARD Fact Constraints 与 SOFT Execution Fallback，并新增只读 Context Effect Audit。Fact Spine、State、Compiler、Readiness、Performance 架构与 Prompt Composer 均未修改。详见 `docs/DIRECTOR_V18_0_1_CONSUMPTION_CORRECTION_ACCEPTANCE_2026-09-26.md`。

## 2026-09-24 Director Subject Ownership + Execution Stability Closeout v17.9

本轮继续处理 Director 链路的系统级稳定性，不针对 SH010、SH014 或任何具体小说加特判。第一，修复 performance budget warning 分支中 `_err(...)` 的错误调用签名，并增加 AST 回归检查，保证所有 `_err` 调用不超过声明的位置参数数量。第二，冻结 `performance_actions.character_ref` 为动作主体的唯一结构化事实源；`performance_actions.action` 只表达谓词/可执行动作，不再重复人物姓名或代词。Runtime 会在模型输出后确定性移除动作谓词前的冗余/冲突主体文本；当证据唯一指向另一合法角色时确定性重绑 `character_ref`，证据多人歧义或无法唯一裁决时则保留合法结构主体并只去掉自然语言主体前缀，不再把同一份歧义证据交给模型 Repair。由此消除 E021 → Repair → repair_no_effect 的循环，同时保持角色 refs、证据、客观动作 authority、FrozenText、状态与连续性的 Hard Gate。旧 `director_shot.v17_8` checkpoint 不可作为 v17.9 复用。当前工程回归 `620/620`。详见 `docs/DIRECTOR_SUBJECT_OWNERSHIP_EXECUTION_STABILITY_CLOSEOUT_V17_9_2026-09-24.md`。

## 2026-09-24 Director Execution Stability Closeout v17.8

本轮修复的是链路级 authority/Repair 边界，不是某个小说或 SH008 特判。`performance_actions` 继续作为客观剧情动作的硬权威层；`performance_execution / dialogue_delivery / camera_execution.framing_note` 统一为可选、非权威执行修饰。自然表演中的“嘴角微微抬起 / 抬眼 / 抬下颌 / 手抬起再放下”不再被 `抬起/放下` 词表误判为剧情动作；真正的进出、攻击、拿取武器、伤势、外部事件等仍被 authority detector 识别。非权威修饰若越权，Director 记录 `W024/W025`，不再消耗唯一 semantic Repair；Compiler 用同一 authority 规则字段级丢弃，Final Readiness 仅在越权文本实际泄漏进最终 Manifest 时保留 E028/E029 防线。Director 与 Compiler 的 performance execution authority 已统一，消除“上一阶段合法、下一阶段又否认”的跨阶段口径漂移。当前回归 `616/616`，compileall 通过。

## 2026-09-24 Director Non-Authoritative Camera Note Closeout v17.7

本轮不再扩 Camera 自然语言词表，而是彻底取消 `framing_note` 的 Director Hard Gate 资格。`framing_note` 已明确为可选、非权威导演备注：即使检测到对白、人物表演、心理或光线等非 Camera 语义，也只产生 `W023_CAMERA_NOTE_DROPPED_UNSAFE`，不触发 Repair；Compiler 会整条省略该 note。无法证明的自由文本实体继续使用 `W021_CAMERA_NOTE_AUTHORITY_UNRESOLVED` 并省略。真正 Camera authority 只来自 `visual_target / visual_focus / execution_framing / foreground_character_refs / shot_size / camera / movement` 等结构化字段。Final Readiness 保留 E027，仅用于防止异常旧数据绕过 Compiler。当前回归 `610/610`，恢复链 `5/5`。

## 2026-09-23 Director Camera Authority Structural Closeout v17.6

本轮停止继续扩 Camera 自然语言词表，直接修正根层 authority 设计：`framing_note` 被正式降为**非权威导演备注**，不再通过自由中文实体抽取承担 Hard Story Authority。Camera 的硬事实由 `visual_target / visual_focus / execution_framing / foreground_character_refs / shot_size / camera / movement` 等结构化字段负责。E027 只拦确定性的字段越权（对白、人物表演、心理、场景光线）；`framing_note` 内无法证明的自由文本实体只产生 `W021_CAMERA_NOTE_AUTHORITY_UNRESOLVED`，Compiler 会省略该 note，但保留结构化摄法，不暂停也不消耗 Repair。与此同时，`performance_execution` 的未知安全自然语言也统一为 `W022` Soft，只有明确新增客观动作/伤势/外部事件才继续 E028 Hard。详见 `docs/DIRECTOR_CAMERA_AUTHORITY_STRUCTURAL_CLOSEOUT_V17_6_2026-09-23.md`。当前回归 `606/606`，恢复链 `5/5`。

**App:** `2.1.0`  
**Runtime:** `2.1`  
**Frozen Core:** `Prompt Foundry v1.3 / 1.3-frozen`  
**Build:** `7b83dd411200`

Prompt Foundry Runtime 2.1 是本地小说 → 影视生产 Prompt 工作台。本版本完成的是**框架级 authority / validation 重建**：不改变主链，不针对单个小说加特判，而是重新划清每个 Stage 的输入、模型职责、程序职责、硬 Gate、quality warning、Repair 和下游消费边界。





## 2026-09-23 Director grammar generalization closeout

本轮不改变 `director_shot.v17_3` Schema，也不放宽剧情事实边界。E027 将“整体环境主体”与 authority-bound 泛化背景人群纳入 Camera Grammar；`行人/路人/住户/人群` 只有当前 Shot/Scene 已存在对应人流事实时才可作为构图对象。E029 从固定短语白名单改为受控 delivery 语义类别，允许自然组合的语气、咬字、吐字、声线、尾音、迟疑/试探/好奇等导演 cue，同时继续硬拦外部事件、人物经历和新增动作。`gaze_during_line` 支持当前 canonical name、当前角色 alias、当前道具及“对方/当前对象/方向”等泛化目标；E021 主体归属仍保持 canonical evidence-only。当前回归 `592/592`，恢复链 `5/5`。

## 2026-09-23 SH008 Director owner + two-person camera phrasing hardening

本轮不改变 `director_shot.v17_3` Schema：E021 在逐字 evidence 自身无法唯一点名主体时，优先读取绑定同一 exact evidence 的 Production Semantics `visual_events / production_choices` 结构化角色 owner；只有 owner 唯一时才确定性 rebind，真正多人事件继续保持 ambiguous。Camera Grammar 在 E027 前新增 deterministic canonicalization，把“ 两人同框 / X从另一侧经过 / 形成疏离的构图关系 ”规范为“ 双人构图 / X位于画面另一侧 / 形成双人构图关系 ”，保留构图意图但移除 action / psychology wording。当前本地回归 587/587，恢复链 5/5。

## 2026-09-23 Director Execution Authority Closeout v17.3

本轮只收口 Director v17 的事实边界，不新增 Stage 或模型调用：`performance_execution` 的客观动作/伤势/道具/进出与结果必须受当前 Shot action authority 约束；`dialogue_delivery` 使用受控 delivery grammar，不能借音量/语速/停顿/咬字/视线制造新剧情；`camera_execution.framing_note` 除 Camera Grammar 外，还要求其中具体人物、道具、地点和状态来自当前 authority。Compiler 对三类字段均做防御过滤；无人物镜继续输出 `人物视线：无`。详见 `docs/DIRECTOR_EXECUTION_AUTHORITY_CLOSEOUT_V17_3_2026-09-23.md`。

## 2026-09-22 Production Freeze Closeout v2

本轮不重构主链，只完成生产冻结前最后的事实源与消费闭环：Asset Registry v2 成为人物/场景连续性的唯一事实源；Scene Stable 与 Scene State 分离；Consumption v2f 使用 Continuity Anchor v2 与信息预算；FrozenText utterance exact reconstruction、performance evidence completion、visual/dialogue cross-field hygiene 与 Director v16.2 scene-distribution gate 进入 Production Readiness v2。详见 `docs/PRODUCTION_FREEZE_CLOSEOUT_V2_2026-09-22.md`。

## 2026-09-22 Production Closeout v1

本增量完成最终本地生产收口：Duration Authority 在 Compiler 前处理长文本超载；Consumption v2e 使用 compact continuity anchor 保留人物/服装/场景一致性同时减少镜内冗余；资产与文本卫生采用字段级规范化而非故事特判；Shot Manifest 记录 performance provenance；最终增加 `production_readiness.v1` Gate，编译成功不再等于生产可冻结。详见 `docs/PRODUCTION_CLOSEOUT_V1_2026-09-22.md` 与 `docs/PRODUCTION_CLOSEOUT_V1_AUDIT_2026-09-22.md`。

## 2026-09-22 Director deterministic contract stabilization

本增量把两类已验证的 Director 结构冲突从“模型多次 Repair”收敛为程序确定性稳定化：`establish_space + wide + precision body focus` 保留建立空间镜并仅放松精细部位焦点；无当前镜头同角色证据的 `reaction_target` 直接移除，不编造 performance。只有当前全部硬错误都属于安全白名单时才启用，其他错误仍走正常 Validator/Repair。详见 `docs/DIRECTOR_V16_1_DETERMINISTIC_CONTRACT_STABILIZATION_2026-09-22.md`。

## 当前正式链路

```text
Novel Source
→ Deterministic Source Index
→ Story Bible v14
→ Scene Plan v8
→ Script Scene v12
→ Storyboard Base v16
→ PVB v3.1 / PSB v5 / Style v3
→ Production Asset Lock
→ Production Semantics v1j / per Shot
→ Director Scene Context v1_1 / per Scene (fail-soft)
→ Director v18.0_2 / per Shot
→ State Resolver + ShotSpec v2
→ Shot Consumption Manifest
→ Consumption Compiler v2m
→ Final 14-field Character / Scene / Seedance Shot Prompts
```

可选的③E质量闭环（当前显式触发）：

```text
Completed Run
→ Shadow Overload Feedback
→ Safe RedistributionPlan
→ Storyboard Redistribution Fragment
→ Deterministic Apply
→ Production Semantics / Director / State-ShotSpec / Compiler 重建
→ Post-apply Shadow Verification
```

## 本版本核心原则

1. **只让程序能客观证明的规则阻断主链。**
   - exact source / refs / enum / type / order / coverage / state：Hard Gate。
   - Scene/Beat/Shot/Production 的语义摘要或转换与上游文字低相似：Quality Warning，不再因为字符串阈值暂停。
2. **Source authority 与 semantic transform 分离。**
   - `source_refs / source_evidence.quote / dialogue / narration` 保持 exact provenance。
   - Scene Plan / Script summary、Storyboard visual transform、Production Semantics production transform 可以换措辞，但不能伪造引用。
3. **Provider 先约束结构。** Ark 支持 Structured Outputs 时优先 `json_schema`；模型/端点明确不支持时自动记忆并降级 `json_object`。Runtime 业务 Validator 始终保留。
4. **程序可确定的字段不再让模型重复决定。** 例如 Production Semantics `dialogue.offscreen` 由 speaker 是否可见确定性派生。
5. **Semantic Repair 最多一次。** Provider 网络重试与语义 Repair 分层；Repair 只处理机器可读 `repair_targets`，不得重写整个 Stage。
6. **完整可观测性。** Unit 记录 build、contract、authority manifest、hard/warning error types、Repair targets、Provider 错误与 token/request usage。
7. **可选 Story Bible 摘要不再阻断主链。** `explicit_facts` 若在局部 provenance 下仍无法被 Runtime 可靠验证，会从 Canonical Story Bible 中隔离并记录 quality warning；原始 source / dialogue 不受影响，`visual_lock` 等硬事实继续严格校验。

8. **对白候选与 mandatory direct dialogue 分离。** Script 使用 `source_dialogue_inventory` 保存原文对白候选；只有 Runtime 同时确认“这是当前场景 speech”且能唯一绑定 `speaker_ref` 的条目才 `required=true`。仅有引号、但 speaker / delivery 不确定的文本不得因 omission 阻断 Script，留待后续 delivery-mode 语义判断。所有被模型选入 Script 的实际对白仍必须逐字来自当前 Beat/Scene、保持原文顺序并可证明为 source-authored speech。
9. **Repair 永不空目标。** Validator 的具体 path 优先；若旧/全局错误没有字段 path，Runtime 使用当前 Unit 根 `$` 作为 repair scope，避免 `repair_targets=[]` 导致无效 Repair。
10. **冻结文本只允许按程序确定的完整语义边界切分，不允许模型改写。** Script 保持 dialogue / narration 原文权威；Runtime 对 dialogue utterance 与 narration 都只在完整强句界（。！？；，引号闭合）生成 FrozenTextUnit，模型只分配完整 unit，Canonicalize 恢复原字符。
11. **Director Continuity 使用稳定模型 Envelope。** 模型只输出 `continuity_scope.mode + inherit_paths[]`；Runtime 将 flat paths 确定性转换为 canonical `inherit` 对象并计算 `state_in/state_out`。空 partial 选择等价于 reset，不再让模型生成脆弱的嵌套继承对象。Provider JSON Schema 约束真实 `{"director": ...}` 外层结构，provider-only schema metadata 不进入模型 Prompt。
12. **Frozen Text Coverage 是端到端硬契约。** Script 生成 expected FrozenText inventory；Storyboard、ShotSpec 与 Final Manifest 分别保留程序内部 unit refs。Compile Gate 要求 dialogue/narration 在三层都与 Script inventory 完全一致：0 missing、0 duplicate、0 unknown、0 reorder。
13. **utterance group 保留原始发言身份，但不再等于同镜约束。** 同一 speaker 的逗号/顿号/冒号续接行先由程序合并为完整 utterance，再按强句界生成句级 FrozenTextUnit；同一 utterance 的多个完整 unit 可分配到连续 Shot，但任何单个 unit 都不得拆半。
14. **Dialogue delivery 与可见性正交，并支持句内转述原话。** Production Semantics 的 item-level `delivery_mode` 仍为 `direct | quoted | voiceover`，`offscreen` 继续由当前 Shot visible character refs 程序派生。对于 direct 对白中的内层引号，Runtime 从冻结原话确定性生成 `embedded_quote_candidates`，模型只能选择 `quote_index`，不能回写或改写 quote text；Compiler 可输出“画内/画外，含转述原话”。
15. **文档标题在 Source Index 前置确定，不再由 Script 猜。** 只有显式 `project_title` 与文档最前部独立短行在 NFKC、空白折叠、外层标题符号去除后完全一致，且该行无完整句终止标点时，Source Index 才标为 `document_heading`。该 SRC 保留审计，但 Story Bible / Scene Plan 及后续剧情链只消费 `narrative`；无法确定时保守保留正文。
16. **Duration Calibration 与生产公式分离。** `scripts/duration_calibration.py` 可从完整 Run 提取 Seedance 2.5 真实样本表；少于 30 个已标注镜头时只保持 `collecting`，达到阈值后仅输出 candidate parameters。当前 W003 公式仍完全不变、仍为 warning-only；不会自动回写 W003，也不会自动返回 Storyboard 拆镜。



## 当前 Contracts

```text
Story Bible          story_bible.v14
Scene Plan           scene_plan.v8
Script               script_scene.v12
Storyboard           storyboard_scene.v16
PVB                  pvb_character.v3_1
PSB                  psb_scene.v5
Style Guide          style_guide.v3
Production Semantics production_semantics_shot.v1j
Director Scene       director_scene_context.v1_1
Director Shot        director_shot.v18_0_2
State + ShotSpec     state_shotspec.v2
Compiler             consumption_v2m
```

## Final Prompt

每个 Shot 最终确定性输出 14 栏：

```text
镜号
时长
场景
人物空间站位
景别
摄法
人物视线
画面内容
旁白
台词
动作音效
环境音效
氛围音效
配乐
```

最终 Prompt 不由最后一个模型重新自由改写，而是由 Consumption Manifest + deterministic compiler 生成。

## Validation 分层

### 会暂停的 Hard Error

- JSON/Envelope 结构在一次 Targeted Repair 后仍不合法；
- unknown refs / illegal enum / illegal scalar type；
- source_refs 非法、顺序/连续/覆盖错误；
- fabricated evidence quote；
- Story Bible source-bound fact 无法由局部连续 evidence 建立；
- Script dialogue/narration 漏、重、改、换序、speaker 错；
- Storyboard dialogue/narration 重建失败或 evidence/ref 硬错误；
- PSB / Style 必填生产字段缺失；
- Production Semantics 改故事、非法 ref/type、renderability 自相矛盾；
- Director state / continuity / action_delta / evidence 失败；
- deterministic assembly/state/compiler failure。

### 不暂停的 Quality Warning

- Scene Plan / Script semantic summary 低词面重合；
- Storyboard 镜头化表达低词面重合；
- Storyboard non-atomic / non-visual heuristic；
- Production Semantics production transform 低词面重合；
- Production Semantics non-visual language heuristic；
- Director dialogue-restatement lexical heuristic。

这些 warning 会保存在 Unit 和 Run 日志，但不消耗 Repair。

## Windows 启动

```text
start.bat
```

启动后页面 `/api/health` 必须显示当前 `build_id` 与 contracts。排障时先确认 build，不要在旧 Python 进程上判断新代码是否生效。

## 验证等级

本包已完成：

- 全量 pytest；
- framework-native API E2E；
- persisted pause/restart/resume；
- semantic-summary / visual-transform / production-transform warning regression；
- Provider Structured Outputs + fallback regression；
- Python compileall；
- Web JavaScript syntax；
- deterministic final 14-field prompt smoke。

本环境没有使用用户私有 Ark Key 进行真实外部模型全链压测，也没有实际调用 Seedance 生成视频。因此本地框架验收 ≠ live-model corpus 质量验收。

详细边界见：

- `docs/STAGE_CONTRACT_MATRIX.md`
- `docs/FRAMEWORK_AUTHORITY_REBUILD_2026-09-20.md`
- `docs/API.md`
- `docs/SOURCE_METADATA_DETERMINISM_V1_2026-09-21.md`
- `docs/DIALOGUE_DELIVERY_V1J_2026-09-21.md`


## Source authority closeout

- Composite visual provenance is validated per atomic visual fact across the bound local evidence set.
- Mandatory direct dialogue uses deterministic adjacent speaker binding and source-owned Beat placement.
- Storyboard FrozenText coverage remains enforced end-to-end.

## 2026-09-22 Production Closeout v1.1 Lexical Recovery

- Repairs only uniquely recoverable performance cue fragments before prompt serialization (for example `开口追` → `开口追问`, `开口询` → `开口询问`).
- Does not alter dialogue, Storyboard, Director intent, duration, assets, or scene continuity.
- Ambiguous lexical damage remains blocked by Production Readiness.
- Compile/readiness failures no longer display the misleading quota/config recovery hint.

## Camera Visual Weight Generalization

E027 现在将“铺满/填满/占满画面”“占据主导/作为主导/主导画面”视为视觉权重与主体占比构图，并确定性规范为“占据画面主体/作为画面主体”。集合性场景描述（如“摊上物件”）仅在对应空间已存在于当前 Shot/Scene authority 时合法；无 authority 的“尸体铺满画面”“持刀男人占据主导”仍会被 Camera authority 硬拦。