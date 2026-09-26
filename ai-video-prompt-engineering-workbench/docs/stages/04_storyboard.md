# Stage 04 — Storyboard Base Contract (FROZEN-04)

## 目标

把一个 `FROZEN-02 Scene Plan Scene + FROZEN-03 Script Scene + program-projected prop manifest` 转换为 canonical Base Storyboard Scene。

本 Stage 只负责基础镜头拆分与摄影执行结构；不生成 Director、动态状态、生产视觉设计或最终 Prompt。

## Input Contract

每个 Scene 是一个独立 Unit：

```text
storyboard:SCxxx
```

唯一权威输入：

```text
FROZEN-02 Scene Plan Scene
FROZEN-03 Script Scene
program-projected prop_manifest（仅当前 Scene 允许道具的 canonical_name / aliases / explicit_facts）
```

禁止输入：完整 Story Bible、PVB/PSB、Director、旧 Storyboard 输出。`prop_manifest` 由程序从 Story Bible 做最小投影，不等于把 Story Bible 交给模型。

## Ownership

### 模型拥有

- Shot 对应的 `beat_id`
- `character_refs`
- `prop_refs`
- `shot_size`
- `camera`
- `movement`
- `composition`
- `duration`
- `description`
- dialogue 在同一 Beat 内的镜头分配（只拥有切分/分配边界，不拥有冻结文本本身）
- narration 在同一 Beat 内的镜头分配（只拥有切分/分配边界，不拥有冻结文本本身）
- Scene 内后续镜头的 `continuity`
- `source_evidence`

### 程序拥有

- Scene 父级 `scene_id`
- Scene 父级 `context_ref`
- Scene 父级 `location_ref`
- 每个 Shot 的 `shot_id`
- 每个 Shot 的 `scene_id`
- 每个 Scene **首镜** `continuity.continuous_with_previous`

Scene Unit 内先生成临时 `SH001...`，全部 Scene 合并后由 Runtime 统一重编号为全项目连续 `SH001...`。

## Model Output Contract

模型只输出：

```json
{
  "scene": {
    "shots": [
      {
        "beat_id": "B001",
        "character_refs": ["char_001"],
        "prop_refs": [],
        "shot_size": "medium",
        "camera": "eye_level",
        "movement": "static",
        "composition": "",
        "duration": 5.0,
        "description": "",
        "dialogue": [],
        "narration": [],
        "continuity": {
          "continuous_with_previous": false,
          "axis_side": "neutral",
          "eyeline_match": "not_applicable"
        },
        "source_evidence": [
          {"quote": ""}
        ]
      }
    ]
  }
}
```

禁止输出：

```text
scene_id
context_ref
location_ref
shot_id
shot.scene_id
director
state_in
image_prompt
video_prompt
platform_prompt
```

## Beat Rules

- 每个 Scene Plan Beat 至少一个 Shot。
- Shot 不能跨 Beat 合并。
- `beat_id` 必须来自当前 Scene Plan `beat_list`。
- Shot 的 Beat 展开顺序必须严格遵循 Scene Plan `beat_list` 的数组顺序。
- 同一 Beat 可以拆成多个**连续** Shot。
- 禁止 `B002 → B001` 这类回跳或重排。

Runtime 不通过排序修复 Beat；顺序错误属于语义错误，进入 Unit Repair / Pause。

## Dialogue Rules

对每个 Beat：

```text
所有属于该 Beat 的 Shot dialogue 按 Shot 顺序拼接
=
FROZEN-03 Script Beat dialogue
```

必须满足：

- speaker 完全一致；
- line 逐字一致；
- 顺序一致；
- 不遗漏；
- 不重复；
- `character_refs` 只表示当前画面可见角色；对白 speaker 可以不在当前 Shot `character_refs`，此时由 Production Semantics 确定性派生为画外声音。
- Script 冻结 dialogue 的 speaker 与正文；Storyboard 只决定该 line 如何跨连续 Shots 分配。


## Frozen Text Allocation Rules

Script 已经冻结的 `dialogue` / `narration` 文本属于上游 source authority。Storyboard 模型只拥有**按 Shot 顺序的连续切分与分配边界**，不拥有正文、speaker、标点或空白表示。

Canonicalize 执行：

```text
model Shot segments
→ punctuation-insensitive lexical stream check
→ 与 Script frozen stream 完全一致才继续
→ 按模型选择的 lexical segment lengths 投影回 Script exact text
→ 恢复原始标点/空白
→ exact reconstruction hard gate
```

因此：

- 仅为了让一个 Shot 独立成句而把来源 `，` 改为 `。`，不会触发 Repair；Runtime 会恢复来源标点。
- 漏字、加字、换词、换序、重复正文、跨 source dialogue line 合并、改变 speaker 仍然是硬错误。
- Final Consumption Manifest 直接拼接冻结 narration segments，不再额外注入 `；` 等分隔标点。

## Reference Rules

- `character_refs` 只能来自当前 Scene Plan `character_refs`。
- `prop_refs` 只能来自当前 Scene Plan `prop_refs`。
- Runtime 对完全重复 refs 做首次出现顺序去重。
- 非法 refs 不静默删除，必须报错。

## Photography Rules

`shot_size/camera/movement` 直接使用 Core v1.3 已存在的合法映射：

```text
SHOT_SIZE_MAP
CAMERA_MAP
MOVEMENT_MAP
```

Runtime 不建立第二套摄影枚举。

- `duration` 必须是大于 0 的数字；
- `description` 必须是非空字符串；
- `composition` 必须是字符串；
- `composition` 与 `description` 以简体中文为主；原文专有名词、角色名、品牌名、型号、地点名等授权文本可保留原写法。

## Continuity Ownership

Base Storyboard continuity 与 Director dynamic continuity 是两层不同信息：

### Scene 边界

每个 Scene 的首镜：

```text
shot.continuity.continuous_with_previous
=
FROZEN-02 Scene Plan.continuous_with_previous
```

这是程序拥有字段，Runtime 确定性覆盖，不消耗 Repair。

### Scene 内

第二镜及之后的：

```text
continuous_with_previous
axis_side
eyeline_match
```

仍由 Storyboard 模型决定。

### 明确不等同

此字段**不替代** Stage 06 Director 的：

```text
continuity_scope
state_out
```

也不替代 Frozen State Resolver 的 `state_in`。动态状态继承仍由 Stage 06 + Core v1.3 负责。

## Evidence Rules

每个 Shot 至少一个：

```json
{"quote":"..."}
```

quote 必须逐字来自当前：

- 当前 Beat `beat_source_authority.source_text`；或
- Script Scene `scene_description`；或
- 当前 Script Beat `description`；或
- 当前 Script Beat dialogue / narration。

禁止引用其他 Beat 或自造证据。

## Unknown Field Rule

Canonical Base Storyboard 不允许未知字段。

特别禁止：

```text
director
state_in
production_visual
image_prompt
video_prompt
```

防止 Stage 04 越权污染 Stage 05/06/08。

## Validation Order

```text
Provider JSON parse
→ program-owned Scene/Shot refs canonicalization
→ first-Shot Scene continuity canonicalization
→ exact duplicate ref normalization
→ root/Scene/Shot/container checks
→ required scalar checks
→ extra-field authority checks
→ current-Scene reference validation
→ photography enum/duration validation
→ Beat membership + Beat order validation
→ frozen dialogue/narration representation canonicalization
→ per-Beat exact dialogue/narration reconstruction
→ continuity structure / Scene-boundary check
→ source_evidence current-Beat anchoring
→ simplified-Chinese visual-text gate
→ Scene assembled deterministic gate
→ checkpoint
```

## Checkpoint Contract

Checkpoint Unit：

```text
storyboard:SCxxx
```

`input_hash` 由：

```text
contract_version = storyboard_scene.v16
+ FROZEN-02 Scene Plan Scene
+ FROZEN-03 Script Scene
+ current-Scene prop_manifest projection
+ output template / contract
```

决定。

本 Stage 不把完整 Story Bible 作为模型输入；仅由 Runtime 投影当前 Scene 允许道具的最小 `prop_manifest`，用于物理可见道具校验。

## Consumers

只有以下阶段消费 canonical Base Storyboard：

- Stage 06 Production Semantics ContextBuilder
- Stage 07 Director ContextBuilder
- Stage 07 Frozen ShotSpec Builder
- Frozen Static Evaluation
- UI Storyboard 展示

任何下游不得读取 Storyboard raw model response。
