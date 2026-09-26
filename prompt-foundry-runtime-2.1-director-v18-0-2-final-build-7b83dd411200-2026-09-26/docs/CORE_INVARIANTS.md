# Prompt Foundry Core v1.3 Frozen — Invariants

Runtime 2.1 的首要约束是：**不为方便 LLM 编排而修改 Frozen Core。**

## 1. Authority

```text
Original Source / Story Bible hard facts
> locked Production Design
> Director execution decisions
> Compiler expression
```

- Story Bible 是叙事事实与稳定引用的事实源。
- PVB / PSB 不能覆盖 Story Bible 已锁视觉事实。
- Scene Compiler 保留 Story Bible > PSB authority-collision guard。
- Compiler 不得新增表演、心理、剧情或叙事事实。

## 2. Stable refs and context chain

核心引用链保持：

```text
Story Bible narrative_context
→ Scene Plan.context_ref
→ Script.context_ref
→ Storyboard.context_ref
→ ShotSpec.context_ref
```

Runtime 可以确定性归一化无语义的 Scene / Beat / Shot 编号，但不能凭空猜语义引用。

## 3. Director boundary

模型只负责 Director 语义：

- dramatic_intent
- primary_subject_refs
- reaction_target_refs
- performance_actions
- visual_focus
- action_delta
- state_out
- continuity_scope

程序负责：

- speaker_target_refs
- state_in
- Base Shot 原字段
- 合法 ID 集合
- checkpoint / merge / retry scope

`state_in` 永远由 Frozen State Resolver 计算，模型不得生成。

## 4. Performance authority

只允许：

- physical_sequence_expansion
- visible_state_expression
- temporal_order_expansion

不得凭空加入速度、力度、心理、情绪结论或额外反应。

## 5. State continuity

动态状态遵循：

```text
previous state_out
+ continuity_scope
→ Frozen State Resolver
→ state_in
```

静态资产事实不进入动态 continuity state。

## 6. Production design status

- `candidate`：不进入 production
- `confirmed`：preview only
- `locked`：preview + production
- `skipped`：自身不提供值，回 Story Bible
- `optional_absent`：不渲染；当前用于 PVB accessory 语义

## 7. Three final Prompt products

- Character Prompt：全量角色参考资产；不做 Shot Visibility。
- Scene Prompt：全量场景参考资产；Story Bible 与 PSB 去重。
- Shot Prompt：按镜消费必要资产 + Director + state + continuity + provenance。

小说链不得重新引入 LLM `image_prompt / video_prompt / platform_prompt` 作为第二套最终 Prompt。

## 8. Visibility / consumption

Shot Prompt 继续使用 Frozen v1.3 的按镜消费逻辑，包括 hand-only skin rule：

```text
hands/feet only + no same-character body_detail
→ 不消费 skin
```

## 9. Provenance

Shot Prompt Provenance 保留，Compiler 的 resolved refs / consumption 数据不得因 Runtime 2.1 被删除。

## 10. Frozen integrity

`tests/runtime/test_runtime20_foundations.py` 固定校验 Frozen Core SHA-256。Runtime 改造如果改变任一 Frozen 文件，测试必须失败。
