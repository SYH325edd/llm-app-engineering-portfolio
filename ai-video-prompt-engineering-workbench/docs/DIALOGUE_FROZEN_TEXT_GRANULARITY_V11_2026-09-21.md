# Dialogue FrozenText Granularity v1.1

对应 Storyboard `storyboard_scene.v16`。

## 目的

解决真实 overload feedback 已证明的问题：长对白若整条作为一个 atomic FrozenTextUnit，Storyboard 即使识别出时长超载，也没有安全重分配边界。

## 权威关系

```text
Script dialogue utterance
  └─ speaker / exact text / source order authority
       ↓ Runtime deterministic split
Dialogue FrozenTextUnit[]
  └─ complete strong-boundary semantic units
       ↓ Storyboard allocation
Shot A / Shot B / ...
```

## 确定性切分

- 边界：`。！？；!?;`
- 逗号、顿号、冒号不是切分边界。
- 引号未闭合时不切。
- 同 speaker 的相邻 Script dialogue line，只有前一行以 `， , 、 ： :` 明确续接时，先拼成同一 utterance，再切语义 unit。
- nested quote 保持完整，例如：`临走把钥匙塞给我，说‘周哥，帮我收着，我回来拿’。` 始终是一个 unit。

## Gate

- 每个 unit exactly once；
- unit 顺序不变；
- speaker 不变；
- unit 不可拆半；
- utterance_group_id 可以跨连续 Shot，不再强制同镜；
- Runtime 最终仍必须精确重构 Script utterance。

## 非目标

本轮不启用自动 redistribution，不修改 W003，不修改 Director/Consumption。
