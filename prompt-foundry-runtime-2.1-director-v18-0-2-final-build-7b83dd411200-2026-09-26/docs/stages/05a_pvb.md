# Stage 05A — PVB Character Contract (FROZEN-05A)

## 目标

把一个 `FROZEN-01 Story Bible` 的 main/supporting Character 转换为 canonical PVB candidate Character。

本 Stage 只负责角色生产视觉候选，不负责 confirmed/locked、Scene 设计、Director 或最终 Prompt。

## Input Contract

每个生产角色一个独立 Unit：

```text
pvb:char_xxx
```

唯一权威输入：

```text
FROZEN-01 Story Bible Character
```

只有 `role_type=main/supporting` 可以进入 PVB。background/referenced_only 不启动 PVB Unit。

禁止输入：Scene Plan、Script、Storyboard、PSB、Style、Director、旧 PVB checkpoint。

## Model Ownership

模型只拥有 10 个 canonical visual **value**：

```text
visual_identity.age_appearance
visual_identity.face
visual_identity.hair
visual_identity.body
visual_identity.skin
wardrobe.default
wardrobe.outerwear
wardrobe.shirt
wardrobe.footwear
wardrobe.accessory
```

模型输出固定为：

```json
{
  "character": {
    "visual_identity": {
      "age_appearance": "",
      "face": "",
      "hair": "",
      "body": "",
      "skin": ""
    },
    "wardrobe": {
      "default": "",
      "outerwear": "",
      "shirt": "",
      "footwear": "",
      "accessory": ""
    }
  }
}
```

不得生成剧情、人物关系、心理、动作、镜头、场景环境或新 canonical 字段。

## Program Ownership

Runtime 独占：

```text
character_id
leaf.source
leaf.status
character.status
version
Story Bible authority
optional_absent decision
```

模型提供的以上 metadata 永远不可信，不进入 canonical checkpoint。

## Authority Mapping

### Story Bible 已拥有字段

若 FROZEN-01 `visual_lock` 已明确同名 canonical field：

```json
{"value":"","source":"","status":"skipped"}
```

模型即使输出不同 value，也必须被丢弃。

### 非 Story-owned 字段

除 accessory 特例外：

```json
{"value":"<model value>","source":"production_design","status":"candidate"}
```

Frozen Core PVB template 允许 candidate value 为空；Stage 05A 不擅自新增“非空”规则。

### wardrobe.accessory

若 Story Bible 未拥有 accessory，且模型 value 为空：

```json
{"value":"","source":"","status":"optional_absent"}
```

`optional_absent` 仅允许 `wardrobe.accessory`。不得扩展到其他字段。

若 accessory 有具体可生产值，则正常为 candidate。

## Status Lifecycle Boundary

Stage 05A canonical checkpoint 只允许：

```text
candidate
skipped
optional_absent
```

`confirmed/locked` 不属于 Stage 05A 模型输出，也不属于本 Stage checkpoint。后续 deterministic production lock 在 Stage 08/资产消费审计时单独判断。

## Legacy Representation Compatibility

为了兼容 Runtime 2.0/2.0.1 旧 provider/checkpoint 输出，raw model response 可暂时包含：

```text
character_id
status
version
leaf = {value, source, status}
```

这是**迁移表示层**，不是第二套 schema。Runtime 只提取 leaf.value，并完全丢弃旧 metadata，再按 FROZEN-05A 规则重建 canonical PVB。

以下仍必须报错：

```text
biography
psychology
camera
未知 visual field
legacy leaf 中未知业务字段
非 string value
```

## Validation Order

```text
Provider JSON parse
→ raw PVB model output shape / unknown-field check
→ legacy representation value extraction (if present)
→ Story Bible authority canonicalization
→ source/status/version deterministic construction
→ canonical PVB exact-field validation
→ Core v1.3 optional_absent semantics validation
→ checkpoint
```

## Checkpoint Contract

Checkpoint Unit：

```text
pvb:char_xxx
```

Canonical checkpoint 形状保持 Frozen Core PVB schema：

```text
character_id
visual_identity.* -> {value,source,status}
wardrobe.* -> {value,source,status}
status=candidate
version=1
```

`input_hash` 包含：

```text
contract_version = pvb_character.v3_1
+ FROZEN-01 Story Bible Character
+ field_policy
+ values-only output template / contract
```

冻结后，下游只能消费 canonical PVB candidate checkpoint，禁止消费 raw model response。

### v3.1 最小身份锚点不变量

`pvb_character.v3_1` 不要求所有 10 个视觉字段都非空。`skipped` 与 `wardrobe.accessory=optional_absent` 继续合法；个别非关键字段也可为空。新增的唯一硬不变量是：Story Bible 已锁定的可视字段与 PVB production-design 字段合并后，角色至少存在一个能被当前 Consumption Compiler 消费的 canonical identity cue。全空或只有会被生产编译器丢弃的非消费文本属于无效 PVB，必须在 PVB Unit 内 Repair，而不是拖到 E023。
