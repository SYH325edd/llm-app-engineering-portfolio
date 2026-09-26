# Storyboard Redistribution Apply v1 — Modification Audit

Baseline: `a2126106c0dc` (③D Preview v1)
Current: `bc1b8c64b258` (③E Apply v1)

## 方案 vs 实际改动

| 方案项 | 实际结果 | 状态 |
|---|---|---|
| 只消费已验证安全 FrozenText 边界 | apply engine 只接受 `preview_ready`，blocked/atomic/cross-channel 不应用 | PASS |
| replacement 文本不能由模型改 | dialogue/narration/ref/scene/beat/shot identity canonical program-owned | PASS |
| replacement 摄影重新生成 | `storyboard_redistribution_fragment` 独立 Unit 生成 refs/摄影/构图/时长/description/continuity/evidence | PASS |
| 正式写回 Storyboard | deterministic apply 替换 source Shot 并全局 SH 重编号 | PASS |
| 上游不重跑 | apply 操作不重新调用 Story Bible / Scene Plan / Script / canonical Storyboard model Unit | PASS |
| 下游重建 | Production Semantics → Director → State/ShotSpec → Compiler 按 input hash 重新计算/复用 | PASS |
| pause/resume 不回退 | source-hashed override 在下游暂停后 Resume 仍保留 applied Storyboard | PASS |
| 上游变化时不套旧 override | source authority hash 不匹配即失效 | PASS |
| W003 未校准前不默认自动修改 | apply 仅显式 API opt-in；主链不自动调用 | PASS |
| apply 后验证残余风险 | 重新生成 Shadow feedback，只记录 residual overload，不递归修改 | PASS |
| Frozen Core 不修改 | `packages/prompt_foundry_v13/src/prompt_foundry_v1_3/*.py` 与基线一致 | PASS |

## 冻结文件字节级审计

- `UNCHANGED` — `runtime/consumption_lint.py`
- `UNCHANGED` — `runtime/consumption_compiler.py`
- `UNCHANGED` — `runtime/shot_manifest.py`
- `UNCHANGED` — `runtime/stages/storyboard.py`
- `UNCHANGED` — `runtime/stages/scene_plan.py`
- `UNCHANGED` — `runtime/stages/script.py`
- `UNCHANGED` — `runtime/stages/production_semantics.py`
- `UNCHANGED` — `runtime/stages/director.py`
- `UNCHANGED` — `runtime/stages/state_shotspec.py`
- `UNCHANGED` — `runtime/frozen_text_coverage.py`

## 本轮生产代码差异（相对③D基线）

- `modified` — `apps/api/app/ark.py`
- `modified` — `apps/api/app/main.py`
- `modified` — `apps/api/app/upstream_validation.py`
- `modified` — `runtime/model_router.py`
- `modified` — `runtime/orchestrator.py`
- `modified` — `runtime/prompts.py`
- `modified` — `runtime/stage_contracts.py`
- `modified` — `runtime/stages/compile_eval.py`
- `modified` — `runtime/storyboard_overload_feedback.py`
- `modified` — `runtime/storyboard_redistribution.py`

说明：`apps/api/app/upstream_validation.py` 与 `runtime/stages/compile_eval.py` 的变化仅用于同步 Storyboard v16 句级 FrozenText dialogue ownership。Frozen Core 本体未改；只有 exact Script FrozenText 可证明时才兼容抑制 legacy `speaker_ownership_mismatch`。
