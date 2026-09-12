# LakeJob 架构

## 1. 架构原则

LakeJob 采用**模块化单体（Modular Monolith）**：一个本地应用、一个业务源码包、清晰模块边界。当前体量不拆微服务，避免部署和运维复杂度，同时为后续桌面化或服务化保留接口。

依赖方向固定为：

```text
app → application → domain
          ↓
infrastructure
          ↓
safety / orchestration / shared
```

业务入口不得依赖根目录脚本；根目录不承载业务实现。

## 2. 模块职责

### `lakejob/app/`
FastAPI 应用、路由、Web UI 组装和本地启动入口。只负责输入输出与服务组合，不放招聘业务规则。

### `lakejob/application/`
业务用例层：

- `jobs/`：岗位搜索、Job360、投递准备、求职话术
- `recruiting/`：候选人搜索、Candidate360、人才库、招聘话术
- `matching/`：岗位/候选人匹配能力
- `messaging/`：消息中心与草稿
- `profiles/`：画像
- `resumes/`：简历解析与管理
- `scheduling/`：计划任务
- `control/`：本地运行控制

### `lakejob/domain/`
稳定业务模型、Schema、状态机和平台目标约束。不得依赖 Web 或具体平台实现。

### `lakejob/infrastructure/`
技术与外部系统适配：

- `ai/`：Mock / DeepSeek Provider
- `database/`：PostgreSQL 数据访问
- `browser/`：浏览器 Runtime / Session
- `platforms/boss/`：BOSS 平台适配、认证、只读搜索与兼容实现
- `vision/`：截图、页面感知、UI 定位、视觉动作 Runtime

### `lakejob/orchestration/`
总指挥 → 执行员 → 监督员 → 合验员 → 终审审计员的严格串行闭环、返工、证据、评分和结果锁定。

### `lakejob/safety/`
真实动作前置保护、Quota、对象确认、审计和安全阻断。

### `lakejob/shared/`
日志脱敏、国际化等无业务状态的共享能力。

## 3. 数据与运行文件

- `migrations/`：PostgreSQL Schema 与迁移
- `config/`：可提交的配置模板和演示画像
- `runtime/`：登录态、截图、运行证据和本地状态，仅运行时生成，不进入发布包
- `logs/`：运行日志，不进入发布包

## 4. 视觉执行

真实平台自动化采用视觉优先、结构信息辅助的方式。动作必须遵循：

```text
页面状态识别 → 目标定位 → 安全检查 → 单次动作 → 等待变化 → 结果验证 → 审计记录
```

验证码、安全验证、未知页面、低置信度定位或连续验证失败必须暂停并交还人工。

## 5. 商业化边界

当前保持本地优先：简历、候选人、聊天、截图、浏览器状态默认留在本机。未来可以增加云端授权和版本控制，但云端控制平面与敏感业务数据必须解耦。
