# Stage 03 — Script Contract (FROZEN-03)

## 目标

把一个 `FROZEN-02 Scene Plan Scene` 忠实转换为一个 canonical Script Scene。

本 Stage 只负责结构化剧本；不拆 Shot、不做摄影设计、不做 Director、不做生产视觉设计。

## Input Contract

每个 Scene 是一个独立 Unit：

```text
script:SCxxx
```

唯一权威输入：

```text
source_text
canonical Story Bible 中当前 Scene 相关事实
FROZEN-02 Scene Plan Scene
```

Runtime 仍向模型提供完整 `source_text` 以避免对白裁切失真；当前版本没有另造 source-span 系统。

禁止输入：Storyboard、Director、PVB/PSB、旧 Script 输出。

## Ownership

### 模型拥有

- `scene_heading`
- `scene_description`
- 每个 Beat 的 `description`
- dialogue 的 `character_id`
- dialogue 的 `line`

### 程序拥有

- `scene_id`
- `location_ref`
- `context_ref`
- `beat_id`

程序按 Scene Plan 数组位置把 Beat ID 逐个注入 Script。模型输出的这些 ID/ref 即使存在也会被覆盖。

## Model Output Contract

模型只输出：

```json
{
  "scene": {
    "scene_heading": "厨房 - 傍晚",
    "scene_description": "两人在厨房交谈。",
    "beats": [
      {
        "description": "阿宁先开口。",
        "dialogue": [
          {
            "character_id": "char_001",
            "line": "你回来了。"
          }
        ]
      }
    ]
  }
}
```

不允许模型输出：

```text
scene_id
location_ref
context_ref
beat_id
character_name
source_evidence
camera
shot_size
movement
continuity
director
```

其中 `character_name` 不在 Script 中重复保存；UI / Compiler 通过 Story Bible `character_id` 解析名称。

## Canonical Output

```text
scene_id
context_ref
location_ref
scene_heading
scene_description
beats[]
  beat_id
  description
  dialogue[]
    character_id
    line
```

这与 Frozen Script template 保持一致，不另建第二套 Script schema。

## Dialogue Rules

- `character_id` 必须存在于 Story Bible。
- speaker 必须属于当前 Scene Plan `character_refs`。
- `background` 角色不得获得对白。
- `line` 必须为非空字符串。
- `line` 必须逐字存在于 `source_text`。
- 整个 Script Scene 的对白按 Beat / dialogue 数组顺序展开后，必须能在 `source_text` 中按相同先后顺序找到。
- 同一句原文只出现一次却被输出两次时，第二次无法继续匹配原文游标，会报 `dialogue_source_order_mismatch`。

## Beat Rules

- Script Beat 数量必须与 Scene Plan Beat 数量完全一致。
- 数组位置一一对应；程序复制上游 Beat ID。
- 不允许新增、删除、合并、重排 Beat。
- Beat `description` 必须为非空字符串。

## Unknown Field Rule

Canonical Script 不允许未知字段。

如果模型输出 `character_name/source_evidence/camera/...`，Stage 03 报 `extra_script_field` 并在本 Unit 内 Repair，不把字段传给 Storyboard。

## Validation Order

```text
Provider JSON parse
→ Scene Plan-owned IDs/refs canonicalization
→ root/Scene/Beat/dialogue shape
→ required field/scalar validation
→ extra-field authority validation
→ Beat count + Beat ID alignment
→ speaker membership / role validation
→ dialogue verbatim source validation
→ dialogue source-order validation
→ checkpoint
```

## Checkpoint Contract

Checkpoint Unit：

```text
script:SCxxx
```

`input_hash` 由：

```text
contract_version = script_scene.v3
+ source_text
+ canonical Scene Plan Scene
+ relevant canonical Story Bible facts
+ output template / contract
```

决定。

Stage 03 contract 或当前 Scene 的上游权威输入变化时，只失效对应 Script Scene checkpoint。

## 已知验证边界

### 无法静态证明“原文所有对白绝无遗漏”

当前 FROZEN-02 Scene Plan 没有 source span 或 dialogue inventory。Runtime 可以严格证明：

```text
输出的对白逐字来自原文
输出 speaker 合法
输出顺序与原文一致
```

但仅凭这些输入，程序无法可靠证明“原文某句对白一定应该属于这个 Scene 且模型漏掉了它”。

因此本阶段不引入启发式引号 OCR/正则抽取，也不回头扩展 FROZEN-02 schema。对白不得遗漏仍作为 Script Writer 的硬 Prompt 规则；若未来要做到程序级 omission proof，需要单独设计 source-span / dialogue inventory 能力并显式升级契约，不能静默加入。

### Scene 级 source scope

当前每个 Script Scene 仍读取完整 `source_text`。这是忠实性优先的明确取舍，不在 FROZEN-03 中做激进裁切。

## Consumers

只有以下阶段消费 canonical Script：

- Stage 04 Storyboard Base
- Stage 06 Director ContextBuilder（通过匹配 Beat）
- Frozen Static Evaluation
- UI 剧本展示

任何下游不得读取 Script raw model response。
