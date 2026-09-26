# Prompt Foundry Stage 0（阶段 0）总结

- Run（运行记录）：`run_75ba9d49f638`
- 基线样本：`SH008 / SH017 / SH034 / SH041 / SH043 / SH049`
- 阶段目标：建立 Consumption Compiler（消费编译器）的混合验收基线。
- 本阶段原则：只读现有 Run，不修改任何项目源码；Compiler（编译器）只做选择、转换、压缩，不创造、不重写、不补剧情。

## 1. 混合验收基线定义

这 6 个镜头不再定义为单纯的 A/B（对照实验）样本，而正式冻结为 **Consumption Compiler（消费编译器）混合验收基线**。

它固定验收五个维度：

1. **正常编译能力**：合法镜头能否稳定生成最小充分的 Seedance Prompt（Seedance 提示词）。
2. **压缩能力**：能否删除 IR（内部中间表示）、未来状态、重复动作、重复风格和无关上下文，同时保留当前镜头必要信息。
3. **阻断能力**：遇到上游硬错误时，能否拒绝输出错误 Prompt，而不是静默修正上游。
4. **告警能力**：遇到不确定但不应阻断的问题时，能否输出 Warning（警告），且警告不进入最终 Prompt 正文。
5. **错误来源识别能力**：能否指出问题来自 Storyboard Base（基础分镜）、Director（导演执行）、State（状态）还是其他上游层，而不是笼统归咎于最终 Prompt。

后续新 Compiler（编译器）只有同时满足以上五个维度，才算通过 Stage 0 基线。

## 2. 六个镜头最终判定

| 镜头 | 最终判定 | 主要验收维度 | 错误/风险来源 | 结论 |
|---|---|---|---|---|
| `SH008` | OK（通过） | 正常编译、压缩 | Legacy Compiler（旧编译器）存在上下文税和 IR 泄漏 | 可生成 Consumption Prompt（消费层提示词）；旧版 835 字压缩至 158 字。 |
| `SH017` | BLOCKED（阻断） | 阻断、来源识别 | Director（导演执行） | Director 提前混入下一镜 `SH018` 的“女人摇头”反应，属于跨镜污染。 |
| `SH034` | BLOCKED（阻断） | 阻断、来源识别 | Storyboard Base（基础分镜） | `prop_refs` 指向 `prop_007（纸巾）`，但当前动作明确是端 `prop_002（关东煮）`。 |
| `SH041` | BLOCKED（阻断） | 阻断、来源识别 | Director（导演执行） | Director 提前混入 `SH042` 的走到锅前、点单和对白；此前“4 秒动作过载”诊断作废。 |
| `SH043` | WARNING（警告） | 压缩、告警、时长校准 | ShotSpec（镜头规格）的时长与当前内容承载量 | 旧版 1102 字压缩至 215 字；7 秒镜头按第一版公式建议最低约 12 秒，保留为校准样本。 |
| `SH049` | BLOCKED（阻断） | 阻断、来源识别 | Storyboard Base（基础分镜）并向 Director 继续污染 | 咖啡动作错误绑定 `prop_002（关东煮）`，Director 进一步产生 `being_poured_as_coffee`。 |

### 关键冻结结论

- `SH034 / SH049` 证明实体绑定错误可以发生在最终 Prompt 之前，Compiler 不得替上游修正。
- `SH017 / SH041` 证明 Director 可能发生跨镜污染，Compiler 必须识别并阻断。
- `SH043` 证明合法镜头仍可能存在 Duration Risk（时长风险），此类问题第一版只 Warning，不阻断。
- `SH041` 的旧诊断正式修正：4 秒不是根因；根因是 Director 跨镜污染。

## 3. Stage 0 实际观察到的错误码

### Error（硬错误）

- `E001_ENTITY_MISBIND`（实体错绑）  
  已观察：`SH034 / SH049`。

- `E003_SPATIOTEMPORAL_POLLUTION`（时空/跨镜污染）  
  已观察：`SH017 / SH041`。

### Warning（软警告）

- `W003_DURATION_RISK`（时长风险）  
  已观察：`SH017 / SH043`。`SH043` 作为首轮时长公式校准样本保留。

- `W007_STYLE_HARD_FACT_DRIFT`（风格与硬事实漂移）  
  正式冻结命名。当前 Story Bible（故事设定）锁定“白炽灯管”，Style Guide（全局视觉风格）包含 `fluorescent-lit（荧光灯照明）`。这不是两个硬事实互相冲突，因此使用 `DRIFT（漂移）` 而不是 `CONFLICT（冲突）`。

## 4. 第一版错误码目录

以下代码作为 Consumption Compiler（消费编译器）第一版的预留目录。只有“已观察”的代码属于 Stage 0 实证，其余为后续实现时的稳定命名，不视为已经在本 Run 中发生。

### Error（硬错误）

- `E001_ENTITY_MISBIND`：实体错绑。
- `E002_CHAR_REF_MISMATCH`：人物引用不一致。
- `E003_SPATIOTEMPORAL_POLLUTION`：时空污染 / 跨镜污染。
- `E004_HARD_FACT_CONFLICT`：两个硬事实直接冲突。
- `E005_DIALOGUE_SPEAKER_MISMATCH`：对白说话人不一致。
- `E006_UNRESOLVABLE_PROP_STATE`：关键道具状态无法解析，且当前镜头动作依赖该状态。

### Warning（软警告）

- `W001_MISSING_COLOR`：当前生成需要配色信息但无法确定。
- `W002_MISSING_LIGHTING`：当前生成需要光照信息但无法确定。
- `W003_DURATION_RISK`：镜头时长承载风险。
- `W004_STYLE_PSB_DRIFT`：Style Guide（全局视觉风格）与 PSB（场景视觉资产）存在非硬事实层面的倾向漂移。
- `W005_PROMPT_LENGTH_HIGH`：最终 Prompt 字符数异常偏高，提示检查上下文税或重复信息。
- `W006_VISUAL_FOCUS_CONFLICT`：Visual Focus（视觉重点）与 Shot Size（景别）存在潜在不协调；只告警，不由 Compiler 改景别。
- `W007_STYLE_HARD_FACT_DRIFT`：Style Guide 与 Story Bible 硬事实方向不一致；按硬事实编译，同时记录 Warning。

## 5. 时长公式 Stage 0 表现

当前第一版仅作为 deterministic heuristic（确定性启发式）风险检查，不作为物理真值，也不直接阻断生成。

`SH043`：

- 当前 ShotSpec（镜头规格）：`7 秒`
- 中文对白：约 `34 个中文字符`
- 基础语速：按 `4.5 字/秒`
- 加标点停顿、说话节奏、微笑表演、缓慢推近以及 `×1.2` 安全系数
- 第一版建议最低时长：约 `12 秒`

**冻结处理：暂不修改公式。**

`SH043` 正式作为 Duration Lint（时长检查）校准样本。只有完成真实 Seedance（字节跳动视频模型）生成对照后，才决定阈值是否需要调整。当前结论只允许写“存在明显时长风险”，不能宣称 12 秒是精确所需时长。

## 6. Compiler 阻断与警告原则

- Error（硬错误）：当前镜头最终 Prompt 不输出，`prompt_seedance = null`；必须指出错误码和来源层。
- Warning（软警告）：允许输出 Prompt；Warning 只进入编译元数据和 Web 界面，不进入 Seedance Prompt 正文。
- Compiler 不得通过删除原对白、替换实体、补剧情、改镜头内容来消除 Error。
- 单镜头阻断不等于整个 Run 失败。后续实现时应允许其他合法镜头继续编译，并把 Run 结果标记为部分阻断状态，而不是整批废弃。

## 7. 对 Stage 1 的输入

Stage 1 正式拆分为两个子阶段，不合并执行。

### Stage 1a（阶段 1a）：纯汉化 + 状态标签人话化

范围只包括用户可见展示层：

- 英文界面标题、按钮、折叠标题改为中文。
- `stageLabel()` 增加完整中文映射。
- 新增/统一 `statusLabel()`，把 `pending / running / completed / paused / failed / failed_recoverable` 显示为可理解的中文状态。
- 用户可见英文术语遵循“English（中文解释）”规则；底层字段名和 Schema 不改。
- 不改页面信息架构，不改 Compiler，不改 API，不改上游契约。

Stage 1a 完成后必须先跑现有 Web 静态测试和页面烟测，再进入 1b。

### Stage 1b（阶段 1b）：用户区 / 调试区信息架构分层

在 Stage 1a 验证通过之后单独执行：

- 默认用户区保留：总览、生产进度、剧本、人物提示词、场景提示词、分镜提示词。
- 调试相关内容默认折叠，但入口始终可见，可主动展开。
- 调试区包含：生产设计、Director（导演执行）、State（状态）、Prompt Provenance（提示词来源）、Consumption View（本镜实际取用信息）、Resolved Refs（已解析引用）、Validation（校验日志）。
- 1b 属于结构性 UI 调整，不能和 1a 混在同一个补丁里。

## 8. Stage 1 启动条件

Stage 1 可以启动，但只允许先执行 **Stage 1a**。

启动条件已经满足：

- Stage 0 三份原始产物已存在：`A_legacy.md / B_consumption.md / diff_record.md`。
- 六镜判定已冻结。
- 混合验收基线五个维度已冻结。
- `W007_STYLE_HARD_FACT_DRIFT` 名称已冻结。
- `SH043` 已冻结为时长公式校准样本。
- Compiler 源码继续保持不动。

## 9. 本阶段明确未完成的验证

- 未调用 Seedance 实际生成视频。
- 因此尚未完成真正的生成质量 A/B。
- 当前完成的是：文本编译、契约安全、错误来源和阻断/告警基线。
- 后续只有使用相同镜头完成真实生成对照，才能判断新 Prompt 是否真正提高动作完成度、身份稳定性和互动自然度。

## 10. 冻结原则

> **Compiler 只做选择、转换、压缩；不创造、不重写、不补剧情。**
>
> **模型能理解，不代表模型应该看到。不是当前镜头正确生成所必需的信息，就不要进入最终提示词。**
>
> **发现上游错误：阻断 / 警告 / 指向来源，不自己修。**
