# Prompt Foundry 上游 15 镜阻断修复总结

## 本轮目标

基于最终消费层审计暴露出的 15 个阻断镜头，只修上游三个根因：

1. Stage 2（场景规划）漏掉当前场景中实际发生物理交互的 Story Bible（故事设定）道具引用。
2. Stage 4（基础分镜）只有 `prop_XXX` ID，没有“ID 对应什么道具”的字典，导致模型猜 ID；且缺少当前镜头道具语义绑定校验。
3. Stage 6（导演执行）把整个 Beat（剧情单元）和资产证据都当成 performance evidence（表演动作证据），导致相邻镜头动作被提前带入当前镜头。

本轮不修改 Frozen Core（冻结核心）、State Resolver（状态解析器）、Consumption Compiler（消费编译器）、PVB（人物视觉资产）、PSB（场景视觉资产）、Style Guide（全局视觉风格）和 Web（网页）。

## 版本变化

- `scene_plan.v2` → `scene_plan.v3`
- `storyboard_scene.v3` → `storyboard_scene.v4`
- `director_shot.v6` → `director_shot.v7`

版本升级用于使旧 checkpoint（检查点）自动失效，避免继续复用旧契约输出。

## Stage 2（场景规划）

新增 `scene_plan_missing_physical_prop_ref` 校验：只有 Beat.description 明确描述已知道具的物理交互时，才要求该道具进入 `scene.prop_refs`；纯对白提及不算，否定动作也不算。

历史 Run `run_75ba9d49f638` 验证：

- `SC008`：正确发现缺少 `prop_004`（社区法律援助名片）。
- `SC011`：正确发现缺少 `prop_006`（纸杯）。

## Stage 4（基础分镜）

新增 `prop_manifest（道具字典）`，每个允许道具提供：

- `canonical_name（标准名称）`
- `aliases（别名）`
- `explicit_facts（明确事实）`

模型仍只能使用 `allowed_prop_refs（允许道具引用）`，但不再需要按 ID 顺序猜测含义。

新增两类语义校验：

- `storyboard_missing_visible_prop_ref`：当前镜头明确物理使用某道具，但 `prop_refs` 漏掉。
- `storyboard_unsupported_prop_ref`：错误道具完全替代了当前镜头明确支持的正确道具。

`unsupported` 规则刻意保持保守：如果当前镜头已经包含明确正确道具，不会因为还有额外场景合法道具就直接判错，避免 `SH010`“关东煮 + 鱼丸”这种合法组合被误杀。

历史 9 个道具错绑镜头全部被 Stage 4 更早拒绝：

- SH027
- SH029
- SH030
- SH032
- SH033
- SH034
- SH042
- SH046
- SH049

对完整 51 镜扫描后，Stage 4 的新道具语义错误只命中上述 9 镜，没有额外误杀。

## Stage 6（导演执行）

新增 `program_owned.current_shot_action_evidence（当前镜头动作证据白名单）`，只由以下三类当前镜头字段生成：

- `shot.description`
- `shot.source_evidence[*].quote`
- `shot.dialogue[*].line`

`script_beat（剧情单元）`仍提供剧情上下文，但明确为 `context_only_not_performance_evidence（仅上下文，不是表演证据）`。

以下内容不再允许作为 `performance_actions（表演动作）` 的 source evidence（来源证据）：

- `script_beat.description`
- `script_beat.dialogue`
- `assets（资产）`
- `previous_state_out（上一镜结束状态）`
- 相邻 Shot（镜头）内容

历史 7 个 Director（导演执行）跨镜污染镜头全部会被新版 `unanchored_performance_evidence（未锚定表演证据）` 拒绝：

- SH013
- SH014
- SH017
- SH023
- SH035
- SH041
- SH046

连续状态继续由 `State In（镜头开始状态）/ continuity_scope（连续性范围）`负责，不要求 Director 把上一镜持续动作重新生成一遍。

## 历史 15 镜归因结果

| 镜头 | 根因 | 新拦截层 |
|---|---|---|
| SH013 | Director 跨镜污染 | Stage 6 |
| SH014 | Director 跨镜污染 | Stage 6 |
| SH017 | Director 跨镜污染 | Stage 6 |
| SH023 | Director 跨镜污染 | Stage 6 |
| SH027 | 道具 ID 错绑 | Stage 4 |
| SH029 | 道具 ID 错绑 | Stage 4 |
| SH030 | 道具 ID 错绑 | Stage 4 |
| SH032 | Scene Plan 缿名片 + 道具错绑 | Stage 2 + Stage 4 |
| SH033 | 创可贴错绑关东煮 | Stage 4 |
| SH034 | 关东煮错绑纸巾 | Stage 4 |
| SH035 | Director 跨镜污染 | Stage 6 |
| SH041 | Director 提前执行下一镜点单 | Stage 6 |
| SH042 | 鱼丸错绑关东煮 | Stage 4 |
| SH046 | Scene Plan 缺纸杯 + 道具错绑 + Director 跨镜污染 | Stage 2 + Stage 4 + Stage 6 |
| SH049 | 咖啡动作错绑关东煮 | Stage 4 |

## 验收结果

- Stage 2 / 4 / 6 / Runtime boundaries（运行时边界）定向测试：通过。
- 完整 `pytest` 回归：通过，0 失败。
- Frozen Core（冻结核心）哈希保护：完整测试中通过，本轮未修改 Frozen Core 文件。
- 历史 Run Stage 2：准确发现 SC008、SC011 两处漏道具引用。
- 历史 Run Stage 4：9/9 已知道具错绑全部命中；51 镜扫描无新增误杀。
- 历史 Run Stage 6：7/7 已知跨镜污染全部命中。

## 仍需真实模型验证的部分

本轮完成的是代码、契约、Validator（校验器）与历史错误回归。没有重新调用真实大模型完整生成新的《关东煮》Run，因此不能声称“新模型输出已经 15/15 自动修好”。正确的下一步是用新版契约重新跑同一文本，观察：

1. Stage 2 是否一次生成完整 `scene.prop_refs`。
2. Stage 4 是否依据 `prop_manifest` 正确选择道具 ID。
3. Stage 6 是否只生成当前 Shot 有直接证据的动作。
4. Consumption Compiler（消费编译器）是否不再遇到这 15 镜的同源错误。

Validator 仍应保持严格；如果新 Run 出现新的真实上游错误，继续拒绝，而不是为了把阻断数降到 0 放宽规则。


## 2026-09-17 Repair locator update

- `storyboard_scene.v4` → `storyboard_scene.v5`.
- Prop binding validation errors now include stable `shot_index` + `beat_id`; repair must locate `invalid_output.scene.shots[shot_index].prop_refs` instead of relying on program-owned `shot_id`.
- This invalidates old storyboard checkpoints so the new repair contract is actually used.
