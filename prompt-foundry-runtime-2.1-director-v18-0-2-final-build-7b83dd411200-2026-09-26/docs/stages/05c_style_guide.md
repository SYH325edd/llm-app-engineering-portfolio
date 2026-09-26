# Stage 05C — Style Guide Contract (FROZEN-05C)

## 目标

把 `source_text + FROZEN-01 Story Bible` 转换为全项目 canonical Style Guide candidate。

本 Stage 只负责全局 `era/region/genre/tone/visual_reference`，不负责人物视觉、场景 production_visual、Storyboard、Director 或最终 Prompt。

## Input Contract

唯一 Unit：

```text
style_guide
```

唯一权威输入：

```text
source_text
FROZEN-01 Story Bible
```

Style Guide 不引用 char/scene/prop/context ID，因此不携带 `reference_manifest`。

保留 `source_text` 是必要的：genre/tone/visual_reference 属于全局表达层语义，当前 Story Bible facts 不能保证完整恢复这些信息。

## Model Ownership

模型只拥有五个非空 string value：

```text
era
region
genre
tone
visual_reference
```

输出固定为：

```json
{
  "era": "",
  "region": "",
  "genre": "",
  "tone": "",
  "visual_reference": ""
}
```

## Program Ownership

Runtime 独占每项：

```text
source = production_design
status = candidate
```

模型生成的 source/status 不进入 canonical checkpoint。

## Global-style Rule

五项必须描述**全项目**稳定风格。禁止把以下内容当成全局风格：

```text
单场天气
单场灯光
单个道具
单一剧情事件
单个角色局部造型
单镜摄影参数
```

这是模型语义规则。当前架构没有可靠的 deterministic source-span/semantic classifier 可以证明某个自然语言 Style value 是否“过度局部”，因此 Runtime **不使用关键词启发式做伪强校验**。

## Candidate Rules

五个 value：

- 必须存在；
- 必须是 string；
- 必须非空；
- canonical metadata 必须为 `source=production_design/status=candidate`。

Stage 05C 不产生 confirmed/locked。candidate→locked 生命周期留给 Stage 08 deterministic asset consumption 审计。

## Legacy Representation Compatibility

旧模型若输出：

```json
{"tone":{"value":"...","source":"...","status":"..."}}
```

Runtime 仅提取 `value`，完全丢弃旧 metadata 后重新生成 canonical candidate。

未知 Style 字段、非 string value、空 value 必须报错。

## Validation Order

```text
Provider JSON parse
→ exact five-field / type / nonempty validation
→ legacy leaf value extraction (if present)
→ source/status deterministic construction
→ canonical exact-field / metadata validation
→ checkpoint
```

## Checkpoint Contract

Checkpoint Unit：

```text
style_guide
```

Canonical checkpoint：

```text
era/region/genre/tone/visual_reference
→ {value, source=production_design, status=candidate}
```

`input_hash` 包含：

```text
contract_version = style_guide.v3
+ source_text
+ FROZEN-01 Story Bible
+ values-only output template / contract
```

下游只能读取 canonical Style Guide checkpoint。
