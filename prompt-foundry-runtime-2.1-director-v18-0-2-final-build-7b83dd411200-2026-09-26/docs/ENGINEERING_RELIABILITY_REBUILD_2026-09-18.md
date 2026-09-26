# Prompt Foundry Runtime 2.1 — Engineering Reliability Rebuild

Date: 2026-09-18

本轮不是针对 `storyboard:SC002 HTTP 429` 的局部补丁，而是按“故障必须在所属层被识别、修复或阻断”的原则重建运行时可靠性边界。主业务链保持：Story Bible → Scene Plan → Script → Storyboard → PVB/PSB/Style → Production Semantics → Director → State/ShotSpec → Compile。

## 1. 发现的系统性问题

### P0 — Provider 故障与语义契约故障混层

429、5xx、连接/读取超时此前直接冒泡成 Unit 失败，与 JSON/Schema/语义错误使用同一失败表象。结果是用户看到“Storyboard SC002 failed”，但无法判断究竟是限流还是分镜内容错误。

### P0 — 外层 JSON 包装可被静默吞错

多个 Stage 使用 `x.get("scene") / x.get("director")` 后再校验。模型即使返回错根、多根或额外根字段，也可能在进入 validator 前被静默裁掉。

### P0 — Prompt 声明了硬规则，producer validator 没实现

Storyboard 已要求 `composition/description` 为简体中文，Director 已要求 `performance_actions.action` 为简体中文，但原 validator 没有在生产 Stage 拦截。错误会一路保存进 checkpoint，最终才由 Consumption Compiler 的 E007 阻断。

### P0 — Production Semantics 未解决仍继续调用 Director

`needs_adaptation / blocked` 是合法的语义诊断状态，但不是 Director 的合法前置状态。原流程仍继续调用 Director，直到最终 Compile 才 E008，既浪费模型调用，也把故障发现推迟到错误层级。

### P1 — assembled cross-unit 校验没有一等 Unit

Script / Storyboard / Director 的 assembled validation 部分直接 `raise RuntimePaused`，Run 可能缺少明确的 gate Unit、failure kind、可复核 errors。

### P1 — checkpoint 只按输入 hash 复用

契约升级后，旧 checkpoint 可能绕过新 validator；反过来如果粗暴绑全局 build id，又会导致无关 Stage 全量重跑。

### P1 — 生产资产冻结过晚

PVB/PSB/Style candidate 只有进入最终 Compile 时才做 production lock。若后续 Production Semantics / Director 暂停，合法的 Character/Scene Prompt 无法作为部分产物保留；若锁本身失败，也会浪费后续模型调用。

### P1 — 文档与代码契约漂移

Stage 4 文档声称完全不消费 Story Bible，但代码实际使用程序投影的 `prop_manifest`；Director 文档停留在 v5/v6，而生产代码已经演进到 v11。

## 2. 新的分层执行模型

```text
Provider Transport
  ↓
JSON syntax/root object
  ↓
Exact model-response envelope
  ↓
Stage canonicalization
  ↓
Unit hard validation / one targeted semantic Repair
  ↓
Canonical checkpoint (input hash + stage contract id)
  ↓
Deterministic assembled Stage gate
  ↓
Downstream Stage
```

故障分类不再混用：

- `provider_rate_limited`
- `provider_http_transient`
- `provider_read_timeout`
- `provider_connect_timeout`
- `provider_transport_error`
- `provider_http_permanent`
- `invalid_json / invalid_json_root`
- `model_output_envelope_mismatch`
- `stage_contract_validation`
- `*_assembly_gate`
- `production_semantics_readiness_gate`
- deterministic compile/static errors

## 3. 429 行为

默认：最多 3 次 transport retry（总尝试 4 次），按 1s / 2s / 4s 有界退避，并优先读取 `Retry-After`。这些重试发生在 Ark transport 内部，**不增加 Runtime semantic `repair_count`**。耗尽后 Run 暂停，并记录 HTTP status、transport_attempts、failure_kind 与 retryable。

可配置：

```text
ARK_MAX_TRANSPORT_RETRIES=3
ARK_RETRY_BASE_SECONDS=1
ARK_RETRY_MAX_SECONDS=8
```

## 4. Producer-owned hard gates

- Story Bible v4：顶层/entity/source_evidence 使用精确 canonical 字段集合，未声明字段在 Story Bible Unit 内报 `extra_story_bible_field`，不允许模型私有字段进入权威 checkpoint。
- Storyboard v8：`composition/description` 英文或中英混写在 Storyboard Unit 内报 `storyboard_non_chinese_text` 并定点 Repair。
- Production Semantics v1d：凡会直接进入最终 Shot Prompt 的 `visual_events.action / production_choices.choice / appearance_overlays.overrides.*` 均在本 Stage 做简体中文硬校验；剧情内必须逐字显示的英文仅由 `diegetic_text.content` 承载。
- Production Semantics 的 `program_owned.current_shot_evidence` 只允许可追溯的 `source_evidence.quote` 与冻结对白；Storyboard 模型生成的 `shot.description` 仍作为语义上下文，但不得被提升为 evidence authority，避免模型描述给自身“洗证据”。
- Director v14：`performance_actions[*].action` 英文或中英混写在 Director Unit 内报 `director_non_chinese_action`；`visual_focus.environment_keys[*]` 同时执行中文门和上游视觉事实锚定门，中文但无依据也会以 `director_unanchored_environment_focus` 在当前 Director Unit Repair。
- Production Semantics：存在 `needs_adaptation/blocked` 时 `production_semantics:gate` 阻断；Director 不运行。
- Script/Storyboard/Director：增加 deterministic assembled gate，跨 Unit 不变量不再靠顶层匿名异常表达。
- Director 在任何 Shot 调用前增加 prerequisite gate：Scene Plan context 与每个 Shot 的 Production Semantics 必须齐全，避免跑到半程才因缺上游依赖暂停。

Consumption Compiler 继续保留 E007/E008，作为 defense-in-depth，而不是首个发现层。

## 5. Checkpoint migration

当前 checkpoint contract id 由 `Stage contract version + model-envelope version` 构成。输入相同但 contract id 不同的旧 checkpoint 会先使用当前 deterministic validator 复验：

- 仍合法：原地升级并复用，不调用模型；
- 不合法：只重新生成该 Unit；
- 下游仍由 input hash 自然判断是否可复用。

这避免“修了代码却继续吃旧错误”，也避免“每改一行就全项目重跑”。`state_shotspec` 虽为纯确定性阶段，也绑定独立 deterministic contract id，避免旧确定性 checkpoint 跨实现版本静默复用。

## 6. 生产资产提前冻结

PVB/PSB/Style 完成后立即执行 deterministic production lock 并生成 Character/Scene prompts。后续 Director 暂停时，这些已验证产物仍保留；资产锁失败也会在昂贵的后续模型调用前暴露。


## 7. Gate / deterministic failure recovery

旧恢复逻辑只会删除用户点击的失败 Unit。对 `*:gate` 来说这会形成死循环：Gate 被删掉，但真正有问题的已完成 source checkpoint 继续复用，下一次执行得到同一个 Gate 错误。

现在所有可定位的 deterministic gate/failure 都保存 `source_unit_ids`：

- Script gate → `script:SCxxx`；
- Storyboard gate → `storyboard:SCxxx`；
- Production Semantics readiness gate → `production_semantics:SHxxx`；
- Director prerequisite / assembly gate → 对应 `scene_plan`、`production_semantics:SHxxx` 或 `director:SHxxx`；
- Production asset lock → 对应 PVB/PSB/Style Unit；
- Compile/static failure → 按 `source_layer / shot_id / target_id` 尽量回指 Storyboard/Director/PVB/PSB。

`resume()` 与 `retry_unit()` 会先失效这些真正的 source Units，再恢复流水线。若 deterministic failure 无法可靠定位源 Unit，则不会伪装成“可重试”，而记录 `retry_mode=inspect_runtime`，避免无意义循环。

## 8. Defense-in-depth output safety

Producer validator 是第一道门，Consumption Compiler 仍保留最终兜底。特别是历史 checkpoint 中可能存在 `visual_focus.environment_keys=["glass_window"]` 之类旧 Director 输出；即使它绕过新 v14 producer 校验，Consumption Compiler 也会以 `E007_NON_CHINESE_OUTPUT` 阻断，不允许英文环境 key 混入最终 Seedance 提示词。

## 9. Recovery status 与测试持久化隔离

- 模型边界异常由适配器分类决定恢复语义：Ark 明确 400/401/403 等永久错误写为 `failed + inspect_runtime`；429/408/5xx/timeout 为 `failed_recoverable + retry_current_unit`；未分类模型适配器异常默认保留人工重试能力，但记录为 `provider_model_unclassified`。
- `state_shotspec` 是纯确定性阶段；自身验证失败不再标记为“重试同一 Unit”，而是 `failed + inspect_runtime`，防止同输入无限循环。
- Web 暂停区展示 failure kind、HTTP status、transport attempts 与不可原地恢复提示，便于区分 Provider 故障和语义契约故障。
- API 注入自定义 `RunStore` 时会自动把默认 CheckpointStore 放入同一隔离根目录，测试/沙箱不再回退写入项目 `data/checkpoints`。
- 保存 Ark 模型配置时保留当前 transport retry policy，不会把 `.env` 中已经设置的重试参数静默重置为默认值。

## 10. 当前正式契约

- Story Bible `story_bible.v4`
- Scene Plan `scene_plan.v4`
- Script `script_scene.v3`
- Storyboard `storyboard_scene.v8`
- PVB `pvb_character.v3`
- PSB `psb_scene.v3`
- Style Guide `style_guide.v2`
- Production Semantics `production_semantics_shot.v1d`
- Director `director_shot.v15`
- State + ShotSpec `state_shotspec.v1`
- Compiler `consumption_v2b`

## 11. 验证范围

本轮验证包括：Ark 429/永久 HTTP 分类、transport 与 semantic Repair 隔离、精确 envelope、legacy checkpoint contract migration、Story Bible exact-field gate、deterministic State/ShotSpec 恢复语义、Storyboard 中文硬门、Production Semantics 最终 Prompt 字段中文硬门、Director action/environment 中文与环境事实锚定门、Production Semantics readiness gate、Gate source-unit retry/resume、配置保存后的 retry policy 保留、测试持久化隔离，以及全量 Runtime/API/Web 回归。

最终验证：`325 / 325` tests 通过；Python compile 通过；Web JavaScript syntax 通过；Frozen Core 与上传基线源码无差异；临时目录真实 Runtime smoke 完成 17 个 Unit 并产出 `compiled_project`；项目 `data/runs` / `data/checkpoints` 仅保留 `.gitkeep`。当前 Build ID：`01d1e6fdfa67`。
