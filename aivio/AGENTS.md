# AGENTS.md

This file constrains all future Codex development tasks in this repository.

## 项目目标

本项目是一个多模型 AI 创作平台，目前已经可以本地调用火山方舟 Seedence 系列模型。最终目标是支持用户注册登录、余额充值、积分扣费、异步生成任务、多模型接入、后台管理和生产环境部署。

## 核心原则

1. 不允许把项目写死成火山方舟专用平台。
2. 后期需要支持 OpenAI、DeepSeek、Claude、Gemini、可灵、即梦、Runway、本地模型等多种 API。
3. 所有 API Key、Base URL、模型 ID、数据库连接、支付密钥必须通过环境变量或后台配置读取。
4. 前端不得直接接触任何供应商 API Key。
5. 视频生成、图生视频、图片生成等耗时任务必须进入 `generation_tasks` 任务系统。
6. 不允许绕过用户余额校验直接调用模型。
7. 不允许出现生成失败但不退款的情况。
8. 每次修改必须尽量小步提交，不要一次性重写整个项目。
9. 每次任务结束必须输出：
   - 修改了哪些文件；
   - 新增了哪些文件；
   - 如何启动；
   - 如何测试；
   - 是否存在未完成问题。

## 技术要求

1. 后端需要保留统一 provider adapter 架构。
2. 当前火山方舟调用必须封装为 `volcengine` provider。
3. 模型配置必须抽象成 `models`。
4. 供应商配置必须抽象成 `providers`。
5. 生成任务必须统一进入 `generation_tasks`。
6. 余额流水必须进入 `credit_logs`。
7. 充值订单必须进入 `orders`。
8. 管理员操作后续需要进入 `admin_logs`。

## 禁止事项

1. 不要把真实 API Key 写入代码。
2. 不要把真实 API Key 写入 README。
3. 不要破坏当前已经能本地调用 Seedence 的能力。
4. 不要删除现有功能，除非有明确替代方案。
5. 不要写死某一个具体案例、提示词或用户数据。
6. 不要引入无法解释的大型依赖。
7. 不要在没有测试的情况下声称功能完成。
