# Stage 05B — PSB Scene Contract (FROZEN-05B)

## 目标

把一个 `FROZEN-01 Story Bible` physical Scene 转换为 canonical PSB candidate Scene。

本 Stage 只负责物理场景生产视觉候选，不负责 confirmed/locked、角色视觉、Director 或最终 Prompt。

## Input Contract

每个 Story Bible physical Scene 一个独立 Unit：

```text
psb:scene_xxx
```

唯一权威输入：

```text
FROZEN-01 Story Bible Scene
```

禁止输入：Scene Plan、Script、Storyboard、PVB、Style、Director、旧 PSB checkpoint。

## Model Ownership

模型只拥有 6 个 canonical production visual **value**：

```text
space
layout
materials
lighting
color
environment
```

输出固定为：

```json
{
  "scene": {
    "production_visual": {
      "space": "",
      "layout": "",
      "materials": "",
      "lighting": "",
      "color": "",
      "environment": ""
    }
  }
}
```

不得生成 scene_id/source/status/version，不得新增人物、剧情、动作、镜头或下游 Prompt 字段。

## Program Ownership

Runtime 独占：

```text
scene_id
leaf.source
leaf.status
scene.status
version
Story Bible authority
```

模型提供的以上 metadata 永远不进入 canonical checkpoint。

## Authority Mapping

### Story Bible 已拥有字段

若 FROZEN-01 `scene.visual_lock` 已拥有同名 canonical field：

```json
{"value":"","source":"","status":"skipped"}
```

模型输出的该 field value 必须被丢弃。

### 非 Story-owned 字段

这些字段属于 PSB 被明确授权的生产设计空间。原文没有逐字给出某个静态视觉细节，并不等于该字段应为空；模型必须在不改变 Story Bible 事实的前提下做保守、可生产的视觉补全。不得用“未知 / 未说明 / 无信息”代替设计值。

必须有非空 string value，并生成：

```json
{"value":"<model value>","source":"production_design","status":"candidate"}
```

Stage 05B 没有 `optional_absent`。也不允许 confirmed/locked 出现在 candidate checkpoint。

## Candidate Completeness Rule

与 PVB 不同，现有 PSB 生成契约要求每个非 Story-owned canonical field 都必须提供非空生产视觉值。

因此：

```text
blank non-owned candidate → validation error / one Unit repair
```

Runtime 不用空字符串偷偷补场景设计。

## Legacy Representation Compatibility

为了兼容 Runtime 2.0/2.0.1/2.0.2 旧 provider 输出，raw response 可暂时包含：

```text
scene_id
status
version
leaf = {value, source, status}
```

这只是迁移表示层。Runtime 只读取 leaf.value，所有 model metadata 被丢弃后重新按 Stage 05B authority policy 构造。

未知业务字段、未知 production_visual 字段、非 string value 仍必须报错。

## Scene Compiler Boundary

Frozen Scene Compiler 已有 authority collision guard：

```text
Story Bible visual_lock > PSB
```

Stage 05B 保持这一规则，不在 Runtime 建第二套 resolver。

Scene Compiler production mode 只消费 locked PSB；candidate checkpoint 本阶段不直接生产 Prompt。

## Validation Order

```text
Provider JSON parse
→ raw PSB model shape / unknown-field check
→ legacy representation value extraction (if present)
→ non-owned value completeness validation
→ Story Bible authority canonicalization
→ source/status/version deterministic construction
→ canonical PSB exact-field validation
→ checkpoint
```

## Checkpoint Contract

Checkpoint Unit：

```text
psb:scene_xxx
```

Canonical checkpoint：

```text
scene_id
production_visual.{space/layout/materials/lighting/color/environment}
  -> {value,source,status}
status=candidate
version=1
```

`input_hash` 包含：

```text
contract_version = psb_scene.v5
+ FROZEN-01 Story Bible Scene
+ field_policy
+ values-only output template / contract
```

冻结后，下游只能消费 canonical PSB candidate checkpoint，禁止消费 raw model response。
