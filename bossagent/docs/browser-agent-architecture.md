# Browser Agent 架构文档

## 一、总体架构

BOSS Agent 后续主线为 Browser Agent 架构。系统通过本地 Web Console 启动浏览器，由用户手动登录 BOSS 直聘，然后由 Browser Agent 在用户授权范围内执行搜索、读取、筛选、生成话术和动作编排。

总体结构如下：

```text
Web Console
→ Browser Session Manager
→ Login Gate
→ Search Planner
→ Browser Search Executor
→ Extractor
→ Scoring Engine
→ Draft Generator
→ ActionOrchestrator
→ SafetyGuard
→ QuotaPolicy
→ AuditLog
```

该架构强调本地运行、用户授权、动作可控、异常停止和日志可追踪。

## 二、核心模块职责

### 1. Web Console

Web Console 是用户操作入口。

职责：展示任务配置页面、接收岗位目标、城市、薪资、行业偏好、提供启动浏览器按钮、展示浏览器会话状态、展示搜索计划、展示岗位分析结果、展示拟投递清单、提供用户确认入口、展示任务报告。

Web Console 不直接操作第三方平台页面，真实页面操作由 Browser Agent 负责。

### 2. Browser Session Manager

Browser Session Manager 负责管理本地浏览器会话。

职责：启动本地 Chromium 或 Chrome、打开 BOSS 登录页或搜索页、管理本地 browser profile、维护 browser session 状态、关闭浏览器会话、处理浏览器启动失败。

边界：不保存账号密码、不读取用户无关页面、不绕过登录验证。

### 3. Login Gate

Login Gate 负责判断是否可以继续执行任务。

职责：检测用户是否已登录、是否出现登录页、验证码、安全验证、账号异常提示，以及是否需要用户手动处理。

处理原则：

```text
未登录：提示用户手动登录
验证码：停止任务并提示用户处理
安全验证：停止任务并提示用户处理
账号异常：停止任务并记录原因
```

Login Gate 是所有自动搜索和真实动作前的第一道门。

### 4. Search Planner

Search Planner 负责生成搜索计划。

输入包括岗位方向、城市、薪资范围、行业偏好、工作经验、学历要求、排除关键词和目标公司类型。

输出包括关键词列表、搜索 URL、搜索顺序、每个关键词的最大处理数量和任务限额。

Search Planner 只生成计划，不直接执行真实动作。

### 5. Browser Search Executor

Browser Search Executor 负责根据 Search Plan 操作浏览器搜索岗位。

职责：打开搜索页面、输入或访问搜索关键词、等待页面加载、读取当前可见岗位列表、有限滚动、进入岗位详情页或详情面板、把可见页面内容交给 Extractor。

限制：不绕过验证码、不高频刷新、不无限翻页、不执行投递动作、不发送消息。

### 6. Extractor

Extractor 负责从页面中抽取岗位信息。

抽取方式可以包括用户可见 DOM 文本、页面截图、视觉识别结果和有限结构化解析。

核心输出：

```text
RawJobCapture
ExtractedJob
StandardJob
```

字段包括岗位标题、公司名称、薪资、地点、经验、学历、岗位详情、招聘者活跃状态、岗位链接、证据文本和抽取置信度。

### 7. Scoring Engine

Scoring Engine 负责岗位匹配评分。

评分因素包括岗位方向匹配、岗位性质匹配、薪资匹配、地点匹配、招聘者活跃度、正向关键词、负向关键词、用户偏好和风险原因。

输出：

```text
score
decision
mainReason
positiveSignals
negativeSignals
riskReasons
needsReview
```

decision 包括 apply、review 和 skip。

### 8. Draft Generator

Draft Generator 负责生成打招呼话术。

输入包括岗位信息、用户简历信息、岗位匹配原因、公司信息和用户偏好。

输出包括打招呼草稿、个性化理由和可编辑文本。

约束：不夸大经历、不编造简历、不生成骚扰式话术、不自动发送，除非进入真实动作阶段且用户已授权。

### 9. ActionOrchestrator

ActionOrchestrator 是真实动作的唯一入口。

真实动作包括投递岗位、发送打招呼消息、收藏岗位和标记处理状态。

所有真实动作都必须经过用户授权、Login Gate、SafetyGuard、QuotaPolicy、AuditLog、动作执行器和结果记录。

任何模块不得绕过 ActionOrchestrator 直接执行真实投递或真实打招呼。

### 10. SafetyGuard

SafetyGuard 负责运行时安全检查。

检查内容包括是否出现验证码、安全验证、账号异常、登录失效、超过任务上限、超过每日上限、连续失败过多或页面状态不确定。

处理原则：可疑即停止，不确定即复核，真实动作前必须再次检查。

### 11. AuditLog

AuditLog 负责记录所有关键动作。

记录内容包括任务启动时间、搜索计划、岗位抽取结果、评分结果、用户确认记录、真实投递动作、真实打招呼动作、失败原因和异常停止原因。

AuditLog 用于复盘、排错和防止重复动作。

## 三、一键启动浏览器流程

```text
用户打开 Web Console
→ 点击“启动 BOSS 浏览器”
→ Browser Session Manager 启动浏览器
