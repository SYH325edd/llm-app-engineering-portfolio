# Ark 结构化阶段稳定性修复验收

日期：2026-09-17
基线：prompt-foundry-v1-template-generalized-v1

## 触发问题

真实运行在 `storyboard_scene` 出现：`finish_reason=length`，`max_completion_tokens=32768`，同时 `reasoning_chars=88381`。这说明输出预算主要被 reasoning 消耗，而不是直接证明最终 Storyboard JSON 本身超过 32768 completion tokens。

## 本轮修改

1. 仅对事实抽取 / 结构编排阶段显式关闭 Ark deep thinking：
   - story_bible
   - scene_plan
   - script_scene
   - storyboard_scene
2. 上述阶段固定 `temperature=0.0`，减少不必要的采样波动。
3. Director、PVB、PSB、Style Guide 不强制关闭 deep thinking，避免误伤导演判断和视觉设计质量。
4. JSON repair 统一使用 `temperature=0.0 + thinking=disabled`。
5. 模型调用异常会进入当前 Unit 的 `attempts`，状态为 `model_failed`。
6. 新增 Run 级 `failure_history`；即使之后 Resume 成功，历史暂停原因和 attempts 仍保留。
7. Web 高级调试区新增“失败历史”。
8. `finish_reason=length` 诊断区分：
   - 有 reasoning 且未关闭 thinking：优先关闭 deep thinking；
   - 已发送 `thinking=disabled` 但 provider 仍返回 reasoning：提示检查当前 endpoint/model 是否真正支持并执行该开关；
   - 无 reasoning：才建议检查最终 JSON 是否确实需要更高 Max Completion Tokens。

## 不改范围

- 不修改 Storyboard / Director 业务契约。
- 不修改 Frozen Core。
- 不修改 Consumption Compiler 规则。
- 不修改时长估算。
- 不提高默认 Max Completion Tokens；当前问题不应先靠盲目加 token 解决。

## 验证

- 全量测试：230 passed。
- Frozen Core / Integration Freeze：通过。
- Web JavaScript 语法检查：通过。
- 结构阶段测试确认请求含 `thinking={"type":"disabled"}` 且 `temperature=0.0`。
- Director 和 PSB 测试确认没有被强制关闭 thinking。
- 失败后 Resume 测试确认 Run 级 failure_history 在恢复完成后仍保留。

## 验证边界

本地环境没有用户真实 Ark API Key/Endpoint，因此本轮没有伪称完成真实云端模型重跑。代码已经按当前 Ark API 参数契约发送 `thinking=disabled`；若用户真实 Endpoint/模型仍返回 reasoning，系统现在会保留证据并给出明确兼容性诊断。
