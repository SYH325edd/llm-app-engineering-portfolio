# Diff Record（差异记录）

| 镜头 | 旧版字符数 | 新版字符数 | 状态 | Error / Warning |
|---|---:|---:|---|---|
| SH008 | 835 | 210 | ok | W007_STYLE_HARD_FACT_DRIFT |
| SH017 | 1154 | — | blocked | E003_SPATIOTEMPORAL_POLLUTION, W007_STYLE_HARD_FACT_DRIFT, W003_DURATION_RISK |
| SH034 | 902 | — | blocked | E001_ENTITY_MISBIND, W007_STYLE_HARD_FACT_DRIFT |
| SH041 | 1031 | — | blocked | E003_SPATIOTEMPORAL_POLLUTION, E003_SPATIOTEMPORAL_POLLUTION, E003_SPATIOTEMPORAL_POLLUTION, W007_STYLE_HARD_FACT_DRIFT, W006_VISUAL_FOCUS_CONFLICT |
| SH043 | 1102 | 261 | warning | W007_STYLE_HARD_FACT_DRIFT, W003_DURATION_RISK |
| SH049 | 1137 | — | blocked | E001_ENTITY_MISBIND, W007_STYLE_HARD_FACT_DRIFT |

## 编译原则

- 只做选择、转换、压缩，不创造、不重写、不补剧情。
- Error（硬错误）阻断当前镜头；Warning（警告）只留元数据，不进入最终 Prompt（提示词）。
- 旧版与新版均来自同一个 Run（运行记录）的冻结上游数据。
