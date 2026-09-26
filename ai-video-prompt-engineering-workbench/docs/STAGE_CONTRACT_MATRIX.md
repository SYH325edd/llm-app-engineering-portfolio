# Prompt Foundry Runtime 2.1 — Stage Contract Matrix

本矩阵定义主链每个 Stage 的唯一权威输入、模型职责、程序职责、硬 Gate 与下游消费边界。核心原则：**raw model output 不跨 Stage；Stage 之间只消费 canonical checkpoint。只有程序可以确定性证明的规则才允许阻断主链，词面相似度等启发式语义检查只能作为 quality warning。**

## 1. Authority classes

| Authority | 是否硬 Gate | 含义 |
|---|---:|---|
| `exact_source` | 是 | 必须逐字来自指定 source authority，例如 Script dialogue/narration、evidence quote、source_refs 对应原文。 |
| `frozen_source_allocation` | 是 | 上游文本已经冻结；Runtime 先生成不可拆分 FrozenTextUnit，模型只分配 unit_id 到 Shot，正文由程序确定性还原。 |
| `source_bound_fact` | 是 | Story Bible factual leaf 必须被最小连续 evidence window 建立。 |
| `semantic_summary` | 否 | Scene/Beat/Script 描述属于结构摘要；source refs / exact source window 才是事实权威。低词面重合只告警。 |
| `semantic_transform` | 否 | Storyboard/Production Semantics 将已验证上游内容转换成镜头/生产表达；词面重合只告警，refs/provenance 仍硬校验。 |
| `frozen_upstream` | 是 | 必须服从已经冻结的上游结构/引用/状态权威。 |
| `design_fill` | 是（结构/非空） | PVB/PSB/Style 被明确授权的生产设计空间，不要求原文词面锚定，但不能改故事事实。 |
| `program_owned` | 是 | stable ID、state、derived visibility 等由 Runtime 确定性注入/派生，模型无权决定。 |

## 2. Main pipeline

| Stage | Unit | 唯一权威输入 | Model owns | Program owns | 关键硬 Gate | Canonical output |
|---|---|---|---|---|---|---|
| 0 Run Input | run | title + source_text | 无 | run/runtime metadata | source_text 存在性 | Run record |
| 0.5 Source Index + Metadata v1 | deterministic | source_text + explicit project_title | 无 | `SRCxxxx`、offset、顺序、`source_type` | source unit 顺序/边界；heading 仅 exact deterministic classification | Auditable Source Index |
| 1 Story Bible v14 | story_bible | Source Index | 实体、source-bound facts、locks、evidence refs、context 语义 | stable IDs/version、quote/offset materialization、最小连续 evidence window 扩展 | evidence ref/quote、facts/locks provenance、字段/类型 | Story Bible |
| 2 Scene Plan v8 | scene_plan | Source Index + Story Bible | Scene/Beat 边界、refs、context transition、结构摘要 | SC/B IDs、source span、resume context | Scene/Beat source_refs 连续/顺序/全覆盖、合法 refs/context | Scene Plan |
| 3 Script v12 | script:SCxxx | current narrative Scene exact source scope + Story facts + Beat exact source authority | heading/description、Beat summary、对白/旁白选择 | scene/location/context/beat IDs、dialogue manifest；不再识别 document heading | dialogue/narration exact、speaker/order/beat shape | Script Scene |
| 4 Storyboard v16 | storyboard:SCxxx | Script + Beat exact source authority + sentence-level FrozenTextUnit inventory + allowed refs | Shot 划分、摄影字段、镜头描述、dialogue_unit_refs / narration_unit_refs、evidence | parent refs、SH IDs、首镜 continuity、冻结文本正文还原 | Beat 顺序、FrozenTextUnit 完整/唯一/有序分配、单 unit 不可拆、evidence quote exact、refs/enums/types | Base Storyboard |
| 5A PVB v3 | pvb:char_xxx | Story character | 角色生产视觉值 | ID/source/status/version、Story-owned skip | shape/status/Story ownership/optional accessory | PVB candidate |
| 5B PSB v5 | psb:scene_xxx | Story physical scene | 未被 Story 锁定的生产场景设计 | ID/source/status/version、Story-owned skip | 非 Story-owned PSB fields 必须有生产设计值 | PSB candidate |
| 5C Style v3 | style_guide | source_text + Story Bible | style values | source/status | required field policy | Style candidate |
| 5D Asset Lock | deterministic | PVB/PSB/Style candidates | 无 | confirm/lock + lock log | candidate semantics | Locked assets |
| 6 Production Semantics v1j | production_semantics:SHxxx | Frozen Base Shot + current exact provenance + allowed refs + program-owned embedded quote candidates | visual/audio semantics、renderability、diegetic text、no-story-change choices、overlay、delivery mode 与 quote-index 选择 | shot/context IDs、完整 dialogue、offscreen、embedded quote exact text | exact provenance、refs/enums/types、no-story-change、renderability consistency、quote candidate index | Production Semantics Shot |
| 6 Gate | deterministic | 全部 semantics shots | 无 | readiness | `renderable/blocked` policy | Director admission |
| 7 Director preflight | deterministic | context manifest + semantics IDs | 无 | dependency completeness | missing semantics/context | admission |
| 7A Scene Director Context v1_1 | director_scene:SCxxx | current Scene Plan/Script/Storyboard + Production Semantics digest + current assets + allowed refs | dramatic function、complete ordered dramatic-phase partition、relationship/reaction/camera baseline、performance baselines | stable refs、allowed evidence universe、exact Shot order/Beat ownership、checkpoint/fallback status | refs/evidence/enums/100% ordered Shot partition/no-new-facts/no-concrete-action-or-camera | Scene Director Context (optional, whole-scene fail-soft) |
| 7B Director v18.0_2 | director:SHxxx | HARD Base Fact Constraints + SOFT Base Execution Fallback + renderable semantics + assets + previous state + Runtime-derived scene position/reaction opportunity + previous/next execution context | intent、visual subject/framing/camera/performance execution、scene_context_usage、action_delta、continuity_scope | speaker refs、state_in/state_out、allowed refs、Runtime-derived creative context | refs/evidence/state/continuity/action_delta/fact boundary; Runtime canonicalizes scene_position | Director Fragment + read-only Context Effect Audit |
| 8 State + ShotSpec v2 | deterministic | validated Director chain | 无 | state resolver + ShotSpec | state chain | ShotSpecs |
| 8.5 Consumption Manifest | deterministic | ShotSpec + semantics + Director + assets + Script | 无 | minimal sufficient selection/dedupe/audio/provenance | consumer contract | Shot manifest |
| 9 Compile + Eval | deterministic | Shot manifest | 无 | 13-field renderer + static/consumption evaluation | compiler contract | Final prompts |

## 3. What may pause the main chain

Hard failures are limited to invariants Runtime can objectively verify:

- malformed/missing required JSON structure after Provider/schema + one targeted Repair;
- unknown refs / illegal enum / illegal scalar type;
- invalid or non-contiguous `source_refs` where contiguity is required;
- source coverage gaps/duplicates/order violations;
- fabricated evidence quote;
- Story Bible source-bound facts that cannot be established by their bound/local evidence window;
- Script dialogue/narration omission, duplication, speaker/order/source mismatch;
- Storyboard dialogue/narration reconstruction mismatch, illegal refs/props/evidence;
- PSB/Style required production-design values absent;
- Production Semantics illegal refs/types/story-changing adaptation or inconsistent renderability;
- Director authoritative evidence/ref/state/continuity/action-delta violations;
- deterministic Stage assembly/state/compiler failures.

The following are **quality warnings**, not pause conditions:

- Scene Plan Beat summary has low lexical overlap with its exact source window;
- Script Beat summary has low lexical overlap with its exact source window;
- Storyboard description is a low-overlap visual transform or evidence-binding heuristic is weak;
- Storyboard non-atomic/non-visual heuristic;
- Production Semantics visual action has low lexical overlap with the frozen Shot visual authority;
- Production Semantics “non-visual” language heuristic;
- Director dialogue-restatement lexical heuristic.

These warnings remain visible in `unit.quality_warnings` and run-level `quality_warnings`, but do not consume semantic Repair.

Director v18.0_2 retains the v17.9 action-owner guarantees and consumes Scene Context through Runtime-derived creative context without granting it fact authority. v17.9 made `performance_actions.character_ref` the single action-owner field and canonicalizes `performance_actions.action` to predicate-only prose. Subject-prefix conflicts are resolved deterministically instead of spending semantic Repair; unique evidence may rebind the owner, while ambiguous evidence keeps the legal structured owner and removes only the conflicting text prefix. v17.8 optional execution safety remains in force.

Director v17.8 applies the same rule to optional execution prose: unsafe `performance_execution`, `dialogue_delivery`, and `framing_note` content is warning + compiler-drop, not model Repair. Objective plot authority remains in evidence-bound `performance_actions` and structured refs/state.

## 4. Provider → Runtime validation layers

```text
Ark Provider
  ↓ JSON Schema Structured Outputs（支持时）
  ↓ 自动 fallback json_object（Provider/模型不支持时）
Model Envelope Gate
  ↓
Canonicalize / deterministic normalization
  ↓
Hard Contract Validator
  ↓
Quality Warning Validator
  ↓
1 targeted semantic Repair（仅 hard errors）
  ↓
Canonical Checkpoint
```

Provider transport retry（429/5xx/timeout）与 semantic Repair 完全分离。每个模型 Unit 最多 1 次定点语义 Repair；重复问温度 0 模型不是恢复机制。

## 5. Repair contract

每次 Repair 都包含机器可读：

- `repair_targets`
- `must_be_nonempty_paths`
- `must_change_targeted_fields`
- `preserve_other_valid_fields`
- `validation_errors`
- `invalid_output`

Repair 返回完整 Stage JSON，而不是 patch。若 canonicalized repair 与上一次非法输出完全一致，追加 `repair_no_effect` 诊断；原始业务错误仍保持首要错误。

## 6. Run observability

每个 model Unit 记录：

- `build_id`
- `contract_id`
- `contract_trace.repair_budget`
- `contract_trace.authority_manifest`
- 每次 attempt 的 `validation_summary.hard_error_types`
- 每次 attempt 的 `validation_summary.quality_warning_types`
- `repair_instruction.repair_targets`
- Provider failure kind / status / request id / retry metadata
- token/request usage

因此排障时先看“失败层”而不是直接改 Prompt。

## 7. Checkpoint compatibility

Checkpoint 绑定 `input_hash + contract_id`。契约升级后先用当前 validator 复验旧 canonical checkpoint；仍合法则迁移 contract，不合法才重新调用模型。下游通过 input hash 自动失效，不做整条链无脑重跑。

## 8. Dialogue authority clarification

- `source_dialogue_inventory` is the current Scene's source-authored dialogue candidate inventory.
- Only entries where Runtime can establish speech status **and** a unique `speaker_ref` are `required=true` mandatory direct dialogue.
- Quoted-but-unbound text remains a source candidate because it may be reported speech, flashback dialogue, written text, voice-over, or another delivery mode; omission from current direct dialogue is not a hard error.
- Every selected Script dialogue line must still be exact source-authored speech inside the current Beat/Scene and preserve source occurrence order.
- A mandatory frozen `speaker_ref` may not be changed.
- A narrative source substring that is not quoted speech and not a deterministic unquoted speech construction cannot be promoted to dialogue merely because the text exists in the Scene.

## 9. Repair target fallback

All model-validation hard errors should expose `path`/`target_path`. As a framework safety net, if a legacy/global hard error has no field path, Runtime emits `repair_targets=["$"]` for the current Unit instead of an empty target list. This preserves bounded one-pass Repair and no-op detection without pretending the error is field-local.

| Frozen Text Coverage Gate | compile | Script inventory + canonical Storyboard + ShotSpec + Final Manifest provenance | 无模型职责 | 比较 scene-scoped unit refs | missing / duplicate / unknown / reorder 任一即 hard fail | frozen_text_coverage.v1 |


## 9. Source metadata determinism

- Source Index 保留全部 SRC 供审计；`source_type` 当前只使用 `narrative | document_heading`。
- `document_heading` 只能由 Runtime 基于显式 project title 做 exact deterministic classification；模型无权判断。
- Story Bible / Scene Plan 的模型输入、Scene Plan allowed refs / coverage / legacy inference 均只使用 `narrative` refs。
- Script 不再拥有 heading heuristic，也不做事后 narration 删除。
- 无法确定是否标题时一律保留为 `narrative`。

## 10. Dialogue Delivery v1j

- item-level `delivery_mode`: `direct | quoted | voiceover`；缺省 `direct`。
- `offscreen` 仍由 Runtime 根据当前 Shot visible character refs 派生。
- direct 对白内的嵌套引号由 Runtime 生成 `embedded_quote_candidates[{quote_index,text}]`。
- 模型只允许返回候选 `embedded_quote_indices`，不得返回/改写 quote text。
- Canonical dialogue 的 `embedded_quotes[{text,mode:"quoted"}]` 完全由程序重建。
