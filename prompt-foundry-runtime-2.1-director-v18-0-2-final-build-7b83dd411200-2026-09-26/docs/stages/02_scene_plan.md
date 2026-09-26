# Stage 02 — Scene Plan Contract (FROZEN-02)

## 目标

把 `source_text + canonical Story Bible` 转换为**唯一的 Scene / Beat 结构规划**。

本 Stage 只决定故事如何划分 Scene 和 Beat，以及每个 Scene 绑定哪些 Story Bible refs。它不写 Script、对白、不拆 Shot、不做 Director，也不生成生产视觉设计。

## Input Contract

唯一权威输入：

```json
{
  "source_text": "<完整小说原文>",
  "story_bible": "<FROZEN-01 canonical Story Bible>",
  "reference_manifest": {
    "character_refs": [],
    "location_refs": [],
    "prop_refs": [],
    "context_refs": []
  },
  "output_template": {},
  "output_contract": {},
  "contract_version": "scene_plan.v2"
}
```

禁止输入：Script、Storyboard、PVB/PSB、Director、旧 Scene Plan 输出。

## Ownership

### 模型拥有

- Scene 边界与顺序
- Beat 边界与顺序
- `location_ref`
- `context_ref`
- `character_refs`
- `prop_refs`
- `time`
- `continuous_with_previous`（第一 Scene 除外）
- `dramatic_goal`
- `conflict`
- `turning_point`
- Beat `description`
- Beat `type`

### 程序拥有

- `scene_id`
- `beat_id`
- 第一 Scene 的 `continuous_with_previous=false`
- refs 中完全重复项的有序去重
- canonical Scene/Beat ID 顺序

模型输出的 `scene_id/beat_id` 不进入 canonical checkpoint；程序按模型数组顺序重新分配：

```text
SC001, SC002, ...
B001, B002, B003, ...
```

Beat ID 全项目连续，不按 Scene 重置。

## Model Output Contract

模型输出不需要 ID：

```json
{
  "scenes": [
    {
      "context_ref": "",
      "location_ref": "scene_001",
      "time": "",
      "character_refs": ["char_001"],
      "prop_refs": [],
      "continuous_with_previous": false,
      "dramatic_goal": "",
      "conflict": "",
      "turning_point": "",
      "beat_list": [
        {
          "description": "",
          "type": "setup"
        }
      ]
    }
  ]
}
```

`type` 只要求为非空字符串。Runtime 不新增一套未被 Core 定义的 Beat taxonomy。

## Canonical Output

程序归一化后：

```text
scenes[]
  scene_id
  context_ref
  location_ref
  time
  character_refs[]
  prop_refs[]
  continuous_with_previous
  dramatic_goal
  conflict
  turning_point
  beat_list[]
    beat_id
    description
    type
```

Canonical checkpoint 不允许额外字段。

例如以下字段在本 Stage 属于越权：

```text
dialogue
camera
shot_size
director
production_visual
```

模型若输出这些字段，Stage 02 直接报 `extra_scene_plan_field`，不让其污染下游。

## Reference Rules

- `location_ref`：必须精确存在于 Story Bible `scenes[].scene_id`。
- `context_ref`：只能是一个已存在的 `context_id` 或空字符串。
- 禁止 `context_001, context_002`、数组、斜杠拼接或自然语言多 context。
- `character_refs`：只能使用 Story Bible character IDs。
- `prop_refs`：只能使用 Story Bible prop IDs。
- Runtime 只去除**完全重复的同一 ref**，不删除非法 ref；非法 ref 必须进入 Repair / Pause。

## Structure Rules

- 非空小说必须产生至少一个 Scene。
- 每个 Scene 至少一个 Beat。
- 第一 Scene 的 `continuous_with_previous` 必须为 false，由程序确定性覆盖。
- 后续 `continuous_with_previous` 由模型依据时间/空间连续性决定。
- Beat `description` 与 `type` 必须是非空字符串。
- `time/dramatic_goal/conflict/turning_point` 必须是字符串；允许空字符串，不强迫模型编造不存在的冲突或转折。
- 同一 physical location 可以合法出现在多个 Scene Plan Scene 中。

## 明确不做

### 不做 source evidence 字段扩展

Frozen Scene Plan schema 没有 `source_evidence`。Stage 02 不擅自增加字段改变 Core 契约。

Scene Plan 的事实忠实度通过：

```text
canonical Story Bible refs
+ source_text 作为 Planner 输入
+ Stage 03 Script 原文/对白校验
```

进行后续闭环。

### 不做“语义重复 Scene/Beat”自动判错

没有 source span 时，两个结构相似的 Scene/Beat 可能是剧情合法重复。程序没有足够证据做模糊语义去重，因此只处理机械重复 refs 和机械 IDs。

## Validation Order

```text
Provider JSON parse
→ program-owned SC/B ID canonicalization
→ exact duplicate ref normalization
→ first-scene continuity canonicalization
→ top-level/container checks
→ required field/scalar checks
→ extra-field authority check
→ Story Bible reference validation
→ Scene/Beat structure validation
→ canonical ID sequence check
→ checkpoint
```

## Checkpoint Contract

Checkpoint 保存 canonical Scene Plan，不保存 raw model ID。

`input_hash` 由：

```text
contract_version
+ source_text
+ canonical Story Bible
+ reference_manifest
+ output template / contract
```

决定。

Story Bible 或 Stage 02 contract 变化时，旧 Scene Plan checkpoint 自动失效。

## Consumers

Stage 02 canonical checkpoint 只能被：

- Stage 03 Script
- Stage 04 Storyboard（通过 Script + Scene Plan）
- Runtime 统计 / UI 展示

消费。

下游禁止读取 Scene Plan raw model response。
