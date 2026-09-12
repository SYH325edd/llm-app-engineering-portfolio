# BOSS Agent 最终路线文档

## 一、项目最终目标

BOSS Agent 的最终目标是构建一个本地化的双向招聘 Agent 系统。系统以 Web Console 为操作入口，通过 Browser Agent 启动本地浏览器，在用户授权和用户手动登录 BOSS 直聘后，自动完成岗位搜索、岗位筛选、岗位匹配分析、投递决策、打招呼话术生成，并在安全边界内执行自动投递和自动打招呼。

项目最终形态不是单纯的网页采集插件，也不是传统网页爬虫，而是：

```text
本地 Web Console
→ Browser Agent
→ Search Planner
→ Job Extractor
→ Scoring Engine
→ Draft Generator
→ ActionOrchestrator
→ SafetyGuard / Quota / AuditLog
```

系统后续可以服务两类用户：

```text
求职者：自动寻找合适岗位、自动投递、自动打招呼、记录投递结果。
招聘者：自动寻找候选人、生成沟通草稿、在确认和限额保护下执行联系动作。
```

当前优先主线为求职者侧：自动搜索岗位、筛选岗位、投递和打招呼。

## 二、当前已完成状态

当前项目已经完成 Web Console 路由重构主线：

```text
legacy.py 已删除
危险 POST 路由已迁移到独立业务模块
公共工具已从 legacy.py 拆分
Web 路由结构已模块化
测试通过：129 passed
最新稳定 tag：refactor-remove-legacy-routes-pass
GitHub 已上传
```

当前已拆分的公共模块包括：

```text
web/ui.py
web/db.py
web/audit.py
web/payload.py
web/dashboard_data.py
web/config_schema.py
```

这为后续 Browser Agent、自动动作编排、安全审计和真实任务执行提供了基础。

## 三、后续阶段路线

### Phase 20：最终路线文档与 Browser Agent 架构文档

目标：明确最终路线，避免项目偏向单纯插件采集工具。

输出：

```text
docs/final-roadmap.md
docs/browser-agent-architecture.md
docs/safety-boundary.md
```

验收标准：

```text
只新增文档
不修改业务代码
不引入新依赖
不改变测试
release 打包通过
```

### Phase 21：Browser Launcher MVP

目标：在 Web Console 中提供“启动 BOSS 浏览器”按钮。

流程：

```text
用户点击启动按钮
→ 后端启动本地浏览器
→ 打开 BOSS 登录页
→ 用户手动登录
→ 系统显示浏览器会话状态
```

本阶段不自动搜索、不投递、不打招呼。

### Phase 22：Login Gate + Session State

目标：建立登录状态检测和浏览器会话状态管理。

功能：检测登录状态、验证码、安全验证、账号异常，并保存本地 browser profile。

限制：不保存账号密码、不绕过验证码、不绕过平台验证，遇到异常立即停止。

### Phase 23：Search Planner

目标：根据岗位方向、城市、薪资范围、行业偏好和排除条件生成 SearchPlan、关键词组合、搜索 URL 或搜索步骤。本阶段只生成计划，不执行真实投递。

### Phase 24：Browser Search Executor

目标：让 Browser Agent 按计划打开搜索页、输入关键词或访问搜索 URL、读取岗位列表、有限滚动并生成岗位候选列表。本阶段不自动投递、不自动打招呼、不绕过验证。

### Phase 25：Job Extractor + Scoring

目标：抽取岗位标题、公司名称、薪资、城市、经验要求、学历要求、岗位详情、招聘者活跃度、岗位链接和页面证据文本，并输出“投递 / 复核 / 跳过”判断。

评分依据包括目标方向匹配、薪资匹配、岗位性质匹配、招聘者活跃度、负向关键词和风险因素。

### Phase 26：Dry-run Apply Plan

目标：生成拟投递清单，但不真实点击。

输出：拟投递岗位列表、岗位匹配分、推荐理由、风险原因、拟打招呼话术和用户确认入口。

验收标准：用户能看到系统准备投递哪些岗位、为什么推荐、打招呼内容是什么，并且真实动作默认不执行。

### Phase 27：Real Action Orchestrator

目标：所有真实投递和真实打招呼统一经过 ActionOrchestrator。

必须具备用户授权、确认开关、单次任务上限、每日动作上限、动作间隔、失败记录、异常停止和审计日志。

真实动作包括投递岗位、发送打招呼消息、收藏岗位和标记处理状态。

### Phase 28：Auto Apply + Auto Greeting

目标：在用户授权范围内执行自动投递和自动打招呼。

流程：用户确认任务后，系统按清单逐个执行；每个动作前检查安全状态；执行投递；发送打招呼话术；记录成功或失败；遇到验证或账号异常立即停止。

