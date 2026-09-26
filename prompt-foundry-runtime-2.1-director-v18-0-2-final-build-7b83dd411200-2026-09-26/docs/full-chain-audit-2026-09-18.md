# Prompt Foundry Runtime 2.1 全链路审计与修复报告

> **Historical snapshot / 已被后续工程重构取代。** 当前正式契约与可靠性边界请以 `ENGINEERING_RELIABILITY_REBUILD_2026-09-18.md` 和 `STAGE_CONTRACT_MATRIX.md` 为准；本文中的 Storyboard v7 / Director v11 / build id 仅表示审计当时状态。


日期：2026-09-18

## 1. 本次问题的主结论

用户真实运行出现：`storyboard_non_atomic_time_window` 在 Stage 4 一次 Repair 后仍把整个 Scene 暂停。但对最新 `storyboard-quality-gate` 源码复现后，单独的 `storyboard_non_atomic_time_window` 理应降级为质量 Warning，不应触发该硬暂停。

审计确认两个 P0 根因：

1. **旧进程复用导致“下载新包但实际仍跑旧代码”。** 所有补丁包长期共用 `2.1.0 / 1.3-frozen`，旧 `scripts/serve.py` 只按 version/framework 判断 8000 端口是否已有 Prompt Foundry，因此旧构建会被误认为当前构建并直接复用。
2. **质量启发式曾被允许驱动 LLM Repair。** `storyboard_non_atomic_time_window` / `storyboard_non_visual_description` 属于镜头质量诊断，不是事实/结构错误。只要启发式出现假阳性，就可能强迫模型改写/拆分 Shot，从而造成同一内容多次运行出现不必要漂移。

因此，本轮不再针对 SH013 或某篇小说打补丁，而是修复运行实例辨识、Stage 4 错误分级与 checkpoint/Warning 生命周期。

## 2. 当前冻结链路

| 阶段 | 当前契约 | 主要输入 | 主要输出 | 校验/恢复边界 | 审计结论 |
|---|---|---|---|---|---|
| Ark 调用层 | API runtime | stage + system prompt + JSON payload | 模型 JSON | 结构阶段关闭 thinking、temperature=0；模型错误写入 attempt | 已加固 |
| Stage 1 Story Bible | `story_bible.v4` | 完整小说原文 | characters / scenes / props / narrative_contexts | 引用原文证据、程序分配 ID；硬错误 Repair | 未发现本次阻断根因 |
| Stage 2 Scene Plan | `scene_plan.v3` | 完整小说 + Story Bible + reference manifest | Scene / Beat / refs / continuity | 引用、物理道具覆盖等硬校验 | 未发现本次阻断根因 |
| Stage 3 Script | `script_scene.v3` | 完整小说 + 当前 Scene Plan Scene + relevant Story facts | 当前 Scene 的 Script Beats / exact dialogue | 对白逐字、Beat 覆盖、引用约束 | 可用；存在长小说上下文技术债 |
| Stage 4 Storyboard Base | **`storyboard_scene.v7`** | 当前 Plan Scene + 当前 Script Scene + allowed refs + prop manifest | Base Shots | **硬错误 Repair；质量问题只 Warning，不 Repair** | 本轮核心修复 |
| Stage 5A PVB | `pvb_character.v3` | 单角色 Story facts | 候选角色视觉资产 | 不覆盖 Story-owned 字段 | 未发现当前根因 |
| Stage 5B PSB | `psb_scene.v3` | 单物理场景 Story facts | 候选场景视觉资产 | 不覆盖 Story-owned 字段 | 未发现当前根因 |
| Stage 5C Style Guide | `style_guide.v2` | 完整小说 + Story Bible | 五项 Style Guide | 结构/字段校验 | 未发现当前根因 |
| Stage 6 Director | `director_shot.v10` | 单 Shot + 当前 Beat + relevant facts + previous state | Director model-owned semantic fields + action_delta；state_out 由程序派生 | Frozen Core 语义校验；硬错误 Repair | 未发现当前根因 |
| Stage 7 State / ShotSpec | `state_shotspec.v1` | 完整已导演 Storyboard | deterministic ShotSpecs | Frozen State Resolver；不调用模型 | 正常 |
| Stage 8 Compile / Lint | `consumption_v1` | Story / Script / Storyboard / ShotSpec / PVB / PSB / Style | Character / Scene / Shot prompts | deterministic 编译 + hard lint + warnings | 正常 |

## 3. Stage 4 v7 的新边界

### 硬错误：允许 Repair，修不好继续暂停

包括但不限于：

- Schema / JSON shape 错误
- Beat 顺序/覆盖错误
- 对白丢失、重复、改写、speaker 错误
- 非法 character_ref / prop_ref
- 可见/操作道具缺失绑定或错误绑定
- 其他会污染事实、实体、引用或 Frozen Core 的错误

### 质量诊断：只 Warning，不触发 Repair

- `storyboard_non_atomic_time_window`
- `storyboard_non_visual_description`

它们现在：

1. 首次验证即可记录质量 Warning；
2. **不会进入 `repair_instruction.validation_errors`**；
3. 不允许因为正则/启发式判断去重写、拆分或扩写 Shot；
4. 最终映射为 Shot 级黄色 Warning：
   - `W010_NON_ATOMIC_TIME_WINDOW`
   - `W011_NON_VISUAL_DESCRIPTION`

这样既不会把明显风险伪装成正常，也不会因导演质量提示把整条生产链炸停。

## 4. 构建辨识 P0 修复

新增 `build_identity.py`，对真正会改变运行行为的源码计算 12 位 SHA-256 构建指纹。

当前 `/api/health` 返回：

- `version`
- `runtime`
- `framework`
- `build_id`
- `contracts`

`Run` 也持久化：

- `build_id`
- 当前完整 Stage contract map

Web 结果页/高级调试区显示实际 build_id 和契约版本。

### 启动器行为变化

原来：

> 8000 端口存在 `2.1.0 + 1.3-frozen` → 直接复用，即使实际是旧补丁代码。

现在：

> 只有 `version + framework + build_id` **全部一致**才复用。

如果 8000 是旧构建：

> 新构建自动选择下一个空闲端口并打开对应新页面。

因此后续验收不能只看“运行引擎 2.1”，必须核对页面显示的 build_id 和 `storyboard_scene.v7`。

## 5. Warning / checkpoint 生命周期修复

此前存在两种错误状态：

1. 重试 Storyboard 上游后，旧 Storyboard Warning 可能残留；
2. 复用带 Warning 的 Storyboard checkpoint 时，Unit 内 Warning 能回来，但 Run 级 Warning 可能未同步。

现在：

- retry at/before Storyboard 会先清除旧 Storyboard quality warnings；
- reusable Storyboard checkpoint 会重新同步其 quality warnings 到 Run；
- v7 contract 使旧 v6 Storyboard checkpoint 不会被静默复用。

## 6. 交付包污染与测试数据耦合问题

之前 ZIP 中发现：

- `data/runs/run_75ba9d49f638.json`
- 多个测试产生的 `data/checkpoints/run_*/*`

进一步从“干净 ZIP”二次解压验证时发现，16 个回归测试直接依赖 `data/runs/run_75ba9d49f638.json`。这说明测试 fixture 与生产运行目录发生了错误耦合：如果清理生产历史数据，测试就不能运行；如果为了测试通过而保留该文件，正式交付包又被开发者历史 Run 污染。

本次已拆分：

- 历史消费编译回归样本迁到 `tests/fixtures/consumption_regression_run.json`；
- `tests/runtime/test_consumption_compiler.py` 只读取测试 fixture；
- A/B CLI 新增显式 `--run-file`，测试不再要求 fixture 位于 `data/runs`；
- `data/runs/` 与 `data/checkpoints/` 回归为纯用户运行数据目录。

本次交付清理规则：

- `data/runs/` 仅保留 `.gitkeep`
- `data/checkpoints/` 仅保留 `.gitkeep`
- 测试数据只允许存在于 `tests/fixtures/`
- 不包含 `.env`
- 不包含 `.venv`
- 不包含 `__pycache__ / .pyc / .pytest_cache / .bak`

## 7. 确认存在、但本次不应贸然修改的技术债

### P2-A：Stage 3 每个 Scene 重复携带完整小说原文

`build_script_scene_payload()` 当前同时携带：

- full `source_text`
- 当前 Scene Plan Scene
- relevant Story facts

好处是 exact dialogue / evidence 可直接回查原文；缺点是长小说每个 Scene 重复消耗完整上下文，并可能增加跨 Scene 干扰。

**本次不直接裁剪。** 正确修法需要 Stage 2 增加可追溯 source spans / evidence window，之后 Stage 3 只读取当前 Scene 对应原文窗口。仅凭 Beat summary 裁原文会破坏“对白逐字”和证据完整性。

### P2-B：全局 `MAX_REPAIRS = 1`

对单个硬错误可控，但如果一个 Unit 同时有多个独立硬错误，一轮 Repair 可能修不净。

**本次不盲目提高到 2/3 次。** 先通过 failure_history 收集真实硬错误样本，再决定是否只对特定结构错误开放第二次 Repair，否则会增加成本和模型漂移。

### P2-C：少量 Stage 聚合校验的诊断粒度

单元级失败已有完整 `failure_history`。聚合 Script/Storyboard/Director 校验主要用于最终 cross-unit safety；若未来真实出现 assembled-only 失败，应再把其 synthetic unit / failure record 做细。目前不是本次 SH013 的根因，不扩大改动。

## 8. 为什么用户此次 SH013 报错与最新代码矛盾

用户看到：

`unit validation failed after 1 repair(s): storyboard_non_atomic_time_window`

而在本轮审计后的 Stage 4 v7：

- `storyboard_non_atomic_time_window` 属于 soft quality type；
- soft-only 输出第一次即 `passed_with_quality_warnings`；
- `repair_count = 0`；
- 不存在“1 repair 后因该项单独暂停”的代码路径。

因此如果安装本轮包后仍看到完全相同的暂停文本，第一检查项不是继续改 SH013，而是核对：

1. Web 页显示的 `build_id`；
2. Advanced Debug 中 `contracts.storyboard` 是否为 `storyboard_scene.v7`；
3. 是否仍在旧 8000 页面，而新构建实际启动到了 8001/8002。

## 9. 验证结果

本轮最终源码验证：

- 全量测试：247 collected / 247 passed
- Stage 4 + Recovery + API/build identity 定向测试：通过
- Frozen Core / Integration Freeze：通过
- Python compile：通过
- Web JavaScript syntax：通过

最终正式 ZIP 已在清理生产历史数据、迁移测试 fixture 后重新打包，并从 ZIP 本身二次解压验证：247 / 247 tests passed；Frozen Core / Integration Freeze、Python compile、Web JavaScript syntax 均通过。最终构建指纹：`505a599c5d6d`。
