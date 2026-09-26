# Consumption Compiler Implementation Plan

**Goal:** 在不修改 Frozen Core 的前提下完成 Web 信息分层、人物/场景/分镜消费编译、语义检查、A/B CLI 与最终验收。

**Architecture:** Frozen Core 继续负责上游契约、State/ShotSpec 与 legacy static evaluation；Runtime 新增 consumption_compiler / consumption_lint，输出 consumption_v1。单镜 Error 阻断该镜，不暂停整个 Run；Warning 仅留元数据/UI。

**Tech Stack:** Python 3, pytest, vanilla HTML/CSS/JS.

## Global Constraints
- 不修改 packages/prompt_foundry_v13 Frozen Core 文件。
- Compiler 只做选择、转换、压缩，不创造、不重写、不补剧情。
- Error 单镜阻断；Warning 不进入 Seedance Prompt 正文。
- 保留 legacy compiler 用于 Frozen static evaluation 与 A/B 基线。
- 用户可见英文术语采用 English（中文解释）或直接中文；底层字段不改。

## Tasks
1. Stage 1b：主导航与默认折叠高级调试区。
2. Runtime 人物/场景 consumption asset compiler。
3. Runtime shot consumption compiler + E001/E003/W003/W006/W007 lint。
4. compile_and_evaluate 同时跑 legacy static gate 与 consumption_v1，写入版本/状态元数据。
5. Web 展示 blocked/warning，blocked 禁止复制。
6. A/B CLI 输出 A_legacy.md / B_consumption.md / diff_record.md。
7. 真实 run_75ba9d49f638 全片验收、Frozen hash、全量测试、项目审计、ZIP。
