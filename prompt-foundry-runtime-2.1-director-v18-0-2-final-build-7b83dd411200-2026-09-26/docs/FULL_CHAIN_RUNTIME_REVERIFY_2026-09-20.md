# Prompt Foundry Runtime 2.1 · Full-Chain Runtime Revalidation

Date: 2026-09-20  
Build ID: `d835ed715bc8`

## 1. 为什么重新验

本次不以“现有单元测试全绿”作为流程可运行证明，而是重新检查：

1. 每个模型 Stage 的 Prompt 实际授权模型输出什么；
2. Runtime 是否能把这些 model-owned fields 正确 canonicalize 成下游契约；
3. Stage Gate 失败后 Retry / Resume 是否真的获得新信息，而不是重复同一个 temperature=0 调用；
4. Provider 429 / timeout 是否会在高调用量流水线中形成反复撞限流；
5. 一个典型多 Scene / 多 Shot 项目的 Ark 请求规模是否与当前 Transport 策略匹配。

## 2. 原版确认的系统级问题

### A. `Retry-After` 被本地 8 秒上限截断

旧实现对服务端 `Retry-After` 使用本地 `retry_max_seconds` 截断。默认上限为 8 秒，因此服务端要求等待 30 / 60 / 120 秒时，Runtime 仍可能 8 秒后再次请求，形成确定性 429 循环。

修复后：Provider 的 `Retry-After` 作为权威 cooldown，不再被本地指数退避上限截断。

### B. 高扇出流水线没有共享 Provider 节流

当前调用量不是“每个 Stage 一次”。不计 Repair、JSON recovery 与 Transport retry，近似为：

`3 + 2×Scene + PVB角色数 + PhysicalScene数 + 2×Shot`

仓库现有 `tests/fixtures/consumption_regression_run.json` 有 11 个 Scene、2 个 PVB 角色、1 个 physical scene、51 个 Shot，因此干净路径已经需要约 **130 次模型调用**。旧实现允许本地多个 run worker 共用一个 Ark 配额并发突发，没有共享 pacing。

修复后：同一个 `ArkClient` 的请求串行进入 Provider slot，并保留最小请求间隔；Transport 默认改为 5 次 retry、2 秒起始、30 秒本地指数退避上限，并尊重更长的服务端 `Retry-After`。

### C. Gate Retry 以前不是真正的 Repair

旧 Gate 能定位 `source_unit_ids`，但 Retry / Resume 主要动作是失效责任 Unit 后重新执行。Gate 的 `validation_errors` 和责任 Unit 上一次模型原始 envelope / invalid output 没有回到模型。对于 Story Bible / Scene Plan / Script / Storyboard 这类 temperature=0 Stage，相同输入很容易稳定复现同一个错误。

修复后：Gate / deterministic failure 会按 `scene_id / shot_id / character_id / target_id` 将错误定向保存到责任 Unit；checkpoint 同时保存模型原始 response envelope，下一次 Unit 首次调用即携带 `repair_instruction.validation_errors + invalid_output`。对升级前没有 raw envelope 的旧 checkpoint，Runtime 会按 Stage 契约重建 `scene / character / production_semantics / director` 根节点，避免恢复时再次出现 envelope mismatch。

### D. 单 Unit Repair 用尽后，人工 Retry 也会遗忘失败现场

旧实现一个 Unit 内部 Repair 次数用尽并暂停后，人工 Retry 会重新从原 Prompt 开始，最后一次 invalid output 与精确 validator errors 不再参与下一次生成。

修复后：暂停前持久化最后的 invalid output 与 validator errors；人工 Retry 首次调用直接进入 `repair_from_previous_failure`。

### E. `needs_adaptation` 曾是合法输出但没有自动适配闭环

Production Semantics 可以合法返回 `needs_adaptation`，随后 readiness gate 阻断 Director；旧 Retry 又可能重新得到同一个 `needs_adaptation`。

修复后：若结构合法但状态为 `needs_adaptation`，先在当前 Production Semantics Unit 生成一个可 Repair 的 hard error，要求仅使用 no-story-change production choices 解决问题；能解决则 `renderable`，不能解决则明确 `blocked`。不再允许无限返回 `needs_adaptation`。

## 3. 新增的关键验证

### Prompt-owner full-chain smoke

新增测试不使用旧 Mock 的“后 canonical 成品”，而只返回各 Stage Prompt 明确允许模型拥有的字段，然后让 Runtime 自己完成 ID、context、state、metadata 等程序字段注入。

验证链：

`Story Bible → Scene Plan → Script → Storyboard → PVB → PSB → Style → Production Semantics → Director → State Resolver / ShotSpec → Compile`

结果：完整完成并生成最终 shot prompt。

### Adaptation repair smoke

第一次 Production Semantics 故意返回 `needs_adaptation`，第二次只在收到当前 Unit Repair 指令后返回 `renderable`。

结果：Repair 在 Production Semantics Unit 内闭环，Director 后续正常执行。

### Provider retry semantics

验证 `Retry-After=60` 不再被 `retry_max_seconds=8` 截断；同时保留 429/408/5xx/timeout 与 4xx 永久错误的 Transport 分类。

### Full regression / static checks

- pytest: **334 / 334 passed**
- Python `compileall`: passed
- Web `node --check apps/web/app.js`: passed
- project `data/runs` / `data/checkpoints`: only `.gitkeep`
- Frozen Core SHA / Integration Freeze: covered by full regression and unchanged by this rebuild

## 4. 当前不能宣称的内容

上传包没有用户私有 Ark API key / model credential，因此本次环境不能诚实地宣称“真实 Ark 在线全链已经跑完”。本次完成的是：真实 Runtime 编排的离线 owner-boundary E2E、Transport 行为集成测试、恢复链闭环测试和完整回归。

真实 Ark 仍可能因为账号 QPS/TPM/并发额度不足返回 429；区别是现在 Runtime 会尊重服务端 cooldown，而不是提前重新撞限流。

另外，Stage 1/2 以及 Stage 3 的长 source context 仍是已知扩展性风险。本轮没有为了“看起来彻底”而引入 source chunking / distributed queue 等大改，因为那会改变上游语义边界，需要单独设计和真实长文基准验证。

## 5. 结论

原版“测试全绿”并不能证明实际生产流程可靠。此次复验确认问题集中在 Provider 流量治理、Gate/Unit 恢复闭环与 `needs_adaptation` 生命周期，而不是单独某个 SC002 Prompt。

当前 build 已把这三条系统链闭合，并新增比旧 Mock 更严格的 Prompt-owner full-chain smoke。真实在线 Ark E2E 仍需在用户本机配置有效 Ark credential 后作为最后一层验收，不能由离线测试替代。
