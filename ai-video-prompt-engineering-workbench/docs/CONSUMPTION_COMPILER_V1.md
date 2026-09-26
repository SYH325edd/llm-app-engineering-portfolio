# Consumption Compiler v1（消费编译器 v1）

## 目标

Runtime（运行时）在不修改 Prompt Foundry v1.3 Frozen Core（冻结核心）的前提下，为图片 / Seedance（视频生成模型）提供真正的最终消费层提示词。

核心原则：

> 模型能理解，不代表模型应该看到。不是当前镜头正确生成所必需的信息，就不要进入最终提示词。

Consumption Compiler（消费编译器）只做三件事：**选择、转换、压缩**。它不创造剧情、不重写上游决策、不替 Storyboard（基础分镜）或 Director（导演执行）修语义错误。

## 代码位置

- `runtime/consumption_compiler.py`：人物、场景、分镜最终消费编译。
- `runtime/consumption_lint.py`：消费层语义检查与时长风险检查。
- `runtime/stages/compile_eval.py`：保留 Frozen Core（冻结核心）旧编译与静态校验，同时挂接新版消费编译。
- `scripts/ab_compile.py`：旧版 / 新版 A/B（对照实验）命令行入口。

Frozen Core（冻结核心）中的 `compile_shot_prompt_v1_3()` 保持不变，继续作为 Legacy（旧版）基线和静态校验输入。

## 最终链路

```text
Frozen ShotSpec（冻结镜头规格）
+ Director（导演执行）
+ State In / State Out（镜头开始 / 结束状态）
+ PVB / PSB（人物 / 场景视觉资产）
+ Style Guide（全局视觉风格）
        ↓
Consumption Selection（消费信息选择）
        ↓
Conflict Resolution（冲突裁决）
        ↓
Prompt Compilation（提示词编译）
        ↓
Semantic Lint（语义检查）
        ↓
Final Prompt（最终提示词）
```

## 冲突优先级

1. Story Bible（故事设定）硬事实。
2. 当前镜头可见动态状态。
3. PSB（场景视觉资产）锁定值。
4. Style Guide（全局视觉风格）倾向。
5. 缺失且并非生成必需的信息不猜测。

场景级资产优先于全局风格。Style Guide（全局视觉风格）不得覆盖 Story Bible（故事设定）硬事实。

## 分镜原子性

单镜头硬错误只阻断该镜头：

```json
{
  "compile_status": "blocked",
  "prompt_seedance": null
}
```

其他镜头继续编译。项目级状态为 `partial_blocked`（部分镜头阻断），Run（运行记录）生命周期仍可完成，不因某个语义脏镜头整体暂停。

Unexpected compiler exception（非预期编译异常）仍属于 Runtime（运行时）失败，不能伪装成普通镜头阻断。

## Error / Warning（错误 / 警告）

### Error（硬错误）

- `E001_ENTITY_MISBIND`（实体错绑）
- `E002_CHAR_REF_MISMATCH`（人物引用不一致）
- `E003_SPATIOTEMPORAL_POLLUTION`（时空 / 跨镜污染）
- `E004_HARD_FACT_CONFLICT`（硬事实冲突）
- `E005_DIALOGUE_SPEAKER_MISMATCH`（对白说话人不一致）
- `E006_UNRESOLVABLE_PROP_STATE`（关键道具状态无法解析）

### Warning（警告）

- `W001_MISSING_COLOR`（配色信息缺失）
- `W002_MISSING_LIGHTING`（光照信息缺失）
- `W003_DURATION_RISK`（时长风险）
- `W004_STYLE_PSB_DRIFT`（全局风格与场景视觉资产漂移）
- `W005_PROMPT_LENGTH_HIGH`（提示词偏长）
- `W006_VISUAL_FOCUS_CONFLICT`（视觉重点与景别潜在冲突）
- `W007_STYLE_HARD_FACT_DRIFT`（全局风格与硬事实漂移）

Warning（警告）只进入元数据和 Web（网页）提示，**绝不写入最终生成 Prompt（提示词）正文**。

## Duration Lint（时长检查）

第一版是确定性风险估算，不是物理真值：

- 中文对白：约 4.5 字 / 秒。
- 逗号 / 顿号：+0.15 秒。
- 句号 / 问号 / 感叹号：+0.35 秒。
- 说话人切换：+0.25 秒 / 次。
- 简单动作 / 反应 / 位移按可见复杂度附加成本。
- 运镜按类型附加成本。
- 最终乘 1.2 安全系数。

时长不足只产生 `W003_DURATION_RISK`（时长风险），不自动删对白、不自动延长镜头、不自动拆镜。

## A/B（对照实验）

```bash
python scripts/ab_compile.py \
  --run-id run_75ba9d49f638 \
  --shots SH008,SH017,SH034,SH041,SH043,SH049 \
  --output-dir data/ab/run_75ba9d49f638
```

固定 6 镜混合验收基线：

- SH008：正常编译。
- SH043：时长告警。
- SH017 / SH034 / SH041 / SH049：硬错误阻断。

详见 `docs/validation/consumption_v1/`。
