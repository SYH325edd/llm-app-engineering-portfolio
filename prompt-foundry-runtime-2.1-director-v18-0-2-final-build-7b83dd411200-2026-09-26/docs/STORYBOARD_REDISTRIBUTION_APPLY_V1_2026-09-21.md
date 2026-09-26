# Storyboard Redistribution Apply v1 — ③E

Build: `bc1b8c64b258`

## 目标

把③D已经验证的 `RedistributionPlan` 真正应用回 Storyboard，同时保持 FrozenText 权威不变，并只重跑受影响的下游生产链。

## 计划 vs 实际实现

| 原计划 | 实际实现 | 验证 |
|---|---|---|
| 只按完整 FrozenTextUnit 重分配 | `apply_redistribution_fragments()` 只消费 Preview 中已验证的完整 segment；程序注入 exact dialogue/narration 和 unit refs | PASS |
| 不复制原 Shot 摄影字段 | 新增 `storyboard_redistribution_fragment` 模型 Unit；重新生成 refs / shot_size / camera / movement / composition / duration / description / continuity / evidence | PASS |
| 不让模型改正文 | scene/beat/shot identity、FrozenText refs、dialogue/narration 均 program-owned | PASS |
| 应用后正式全局重编号 | apply 后统一重新分配 `SH001...`，输出 old->new Shot 映射 | PASS |
| 只重跑下游 | apply 后只重跑 Production Semantics → Director → State/ShotSpec → Compiler | PASS |
| 不重跑稳定上游 | Story Bible / Scene Plan / Script / Storyboard model Unit 不在 apply 中再次调用 | PASS |
| 下游失败可恢复 | 持久化 `storyboard_redistribution_override`；Director 故意失败后普通 Resume 保持拆分后 Storyboard | PASS |
| 上游变化时 override 必须失效 | override 带 canonical Script+Storyboard source hash，不匹配即失效 | PASS |
| 不改 W003 | `runtime/consumption_lint.py` 与 Preview v1 基线字节级相同 | PASS |
| 不改 Director / Script / Scene Plan / Consumption 主体 | 对相应文件做基线 `cmp`，均字节级相同 | PASS |

## 触发策略

③E 是“可执行 apply”，但当前保持**显式 opt-in**，不会在普通 Runtime 主链中自动触发：

`POST /api/runs/{run_id}/redistribute-overloaded`

原因：W003 / Shadow threshold 尚未经过真实 Seedance 2.5 校准。当前可以验证工程闭环，但不应让 provisional 阈值在用户不知情时自动改写正式 Storyboard。未来完成真实 Duration Calibration 后，可复用同一 apply engine 接入自动反馈。

Apply 完成后会再次运行 Shadow Overload，仅记录 `post_apply_feedback` / `residual_overloaded_shot_ids`，**不递归自动再拆**。

## 新增执行单元

`storyboard_redistribution_fragment`

输入：
- source Shot
- 已验证 replacement segments
- 当前 Beat authority
- scene allowed character/prop refs

模型只负责：
- `character_refs`
- `prop_refs`
- `shot_size`
- `camera`
- `movement`
- `composition`
- `duration`
- `description`
- `continuity`
- `source_evidence`

程序负责：
- replacement 数量
- segment 顺序
- `shot_id`
- `scene_id`
- `beat_id`
- dialogue / narration 原文
- FrozenTextUnit refs
- 第一个 replacement Shot 的 continuity 继承规则
- 最终全局 Shot 重编号

## Contract 同步

Storyboard v16 允许一个原始 utterance 的多个句级 FrozenTextUnit 分布到连续 Shots。③E 实测时发现两个旧 Gate 仍按“整条 Script dialogue line = 最小镜头单位”判断：

1. `apps/api/app/upstream_validation.py`
2. Frozen Core 静态 Director / compile evaluation

处理方式：
- assembly Gate 与 Storyboard v16 使用同一个确定性 FrozenText 语义单元。
- Frozen Core 文件不修改。
- Runtime 兼容层只在当前 Shot dialogue 能被同 Beat 的确定性 FrozenTextUnit 精确证明时抑制 legacy `speaker_ownership_mismatch`；真实改词/换 speaker 仍保留硬错误。

## 恢复语义

Apply 成功写回后立即保存：

`artifacts.storyboard_redistribution_override`

包含：
- source authority hash
- applied Storyboard
- apply report
- plan

如果后续 Production Semantics / Director / State / Compile 暂停，普通 Resume 会：
1. 正常读取 canonical upstream checkpoints；
2. 校验 source hash；
3. 重新套用已确认的 override；
4. 继续下游，不退回拆分前 Storyboard。

如果 canonical Script / Storyboard 权威变化，override 自动失效，不跨版本猜迁移。

## 不在本轮范围

- 不校准 W003 参数
- 不改变 overload 阈值
- 不做跨 channel 自动排序
- 不把单一 atomic unit 内部拆开
- 不进入 Director v16 镜头多样性优化
- 不进入 Consumption v2d 信息预算
- 不修 Sound Semantics / W008 等其它登记问题

## 验证

- Redistribute fragment / deterministic apply：PASS
- exact FrozenText coverage/order：PASS
- downstream-only regeneration：PASS
- downstream Director pause → Resume override persistence：PASS
- API `/redistribute-overloaded` no-safe-apply：PASS
- post-apply residual overload feedback：PASS（只记录，不递归）
- upstream assembly v16 contract sync：PASS
- Runtime Frozen Core compatibility boundary：PASS
- 相关定向回归：PASS
- 全量：`473 / 473 PASS`
