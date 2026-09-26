# Runtime 2.1 Operational Rules

## Ownership

Model owns bounded semantic decisions. Program owns stable IDs, exact dialogue speaker+line, allowed refs, context-state scheduling, state_in/state_out mechanics, checkpoint identity, deterministic merge/order, production lock and compiler execution.

## Canonical Stage chain

```text
Story Bible v5
→ Scene Plan v5
→ Script v5
→ Storyboard v9
→ PVB/PSB/Style
→ Production Semantics v1e
→ Director v14
→ State + ShotSpec v2
→ Frozen static gate + Runtime state/context checks
→ Shot Consumption Manifest
→ Consumption v2c
```

## Validation order

```text
raw model JSON
→ Stage shape contract
→ deterministic canonicalization
→ reference / authority validation
→ semantic / evidence validation
→ current Unit repair only when stage policy allows
→ canonical checkpoint
```

Storyboard `non_atomic_time_window / non_visual_description` 属诊断质量规则，不驱动 LLM Repair。Production Semantics 的 renderability 才是最终消费层的可执行性权威。

## Context state

Scene Plan v5 marks `continue / enter / return / switch`。Runtime 用 `ContextStateCursor` 保存 `state_by_context + return stack`；Director 与 ShotSpec 均从同一 policy 取得 previous state。`switch` 清空旧 return stack；`return` 恢复进入 context 前保存的 state。

## Production Semantics

Per-shot independent checkpoint。它只负责把 Base Shot 已有证据编译成：visual/audio/renderability/frozen dialogue/diegetic text/controlled production choices/context appearance overlays。`needs_adaptation` 在本 Unit 定向修复；`blocked` 为明确终态，不进入 Director。

Production choice 必须 evidence-bound、current-context-bound、`impact=no_story_change`；任何新增剧情事实越权均验证失败。

## Director

Director v14 只从 Production Semantics `visual_events / approved production_choices / frozen dialogue` 取得动作证据。`shot.description / script_beat` 仅用于上下文理解。状态协议保持 program-owned state_out：模型只写 action_delta，Runtime 计算并校验 state_out。

## Consumption

Shot Consumption Manifest 先确定性选择/去重当前 Shot 的 PVB/PSB/Style/Director/State/音频/旁白/对白信息；Consumption v2c 再渲染固定 13 栏最终分镜 Prompt，不再使用 raw description 作为 action fallback。静态镜头可以没有动作段；`needs_adaptation/blocked` 不能用旧文本绕过。Consumption v1 保留为 A/B reference。

## Checkpoint / Retry

- completed Unit 只有在 input hash 与当前 contract id 都匹配时直接复用；旧 contract checkpoint 必须通过当前 deterministic validator 才能原地升级；
- Model stage 外层 JSON 必须满足精确 envelope；错误 envelope 属当前 Unit contract failure，不允许 `.get(...)` 静默吞掉；
- retry Production Semantics 会使对应下游 Director/ShotSpec/Compile 重算；deterministic Gate 会记录 `source_unit_ids`，Resume/Retry 先失效真正源 Unit；
- retry Director 不重新生成已验证 Production Semantics；Provider 429/408/5xx/timeout 在 transport 层有限退避，不占用 semantic Repair；
- 所有 compile materialized views 在相关上游 retry 后统一清除，禁止 UI 展示 stale output。

## Production Freeze Gate

Production 版本必须同时通过 Engineering Gate 和 Production Semantic Gate。单纯测试数量增加不构成生产质量证明。
