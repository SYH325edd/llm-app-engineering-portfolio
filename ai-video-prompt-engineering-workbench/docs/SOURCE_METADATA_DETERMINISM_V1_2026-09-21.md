# Source Metadata Determinism v1 — 2026-09-21

## 目标

把“文档标题是不是剧情”从模型随机判断改为 Runtime deterministic metadata。Source Index 保留标题 SRC 供审计，但剧情链只能消费 narrative SRC。

## Heading 判定

必须同时满足：

1. 用户显式提供 project title；
2. candidate 位于文档最前部并独立成物理行；
3. 文本较短；
4. candidate 后存在正文；
5. candidate 无完整句终止标点；
6. candidate 与 project title 经 representation-only normalization 后完全一致。

Normalization 仅允许：Unicode NFKC、trim、常规空白折叠、去除一层成对外部标题符号。禁止 contains、模糊相似度、embedding 或模型语义匹配。

无法确定时保守标为 `narrative`。

## 下游边界

- Run `source_index`: 保留 `document_heading` + `narrative`。
- Story Bible 模型输入与 factual evidence refs：仅 narrative。
- Scene Plan 模型输入、allowed refs、coverage、legacy inference：仅 narrative。
- Script v12：无 heading heuristic；只消费 Scene Plan narrative refs。
- Storyboard / Production Semantics / Final Prompt：通过上游 canonical chain 自然无法接触 document heading。

## 不变量

SRC 编号不因过滤而重排。标题仍可在审计 Source Index 中看到，例如 SRC0001=document_heading，正文从 SRC0002 开始。
