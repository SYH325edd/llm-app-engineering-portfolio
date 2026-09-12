# LakeJob

LakeJob 是一个**本地优先、模块化单体**的双端招聘智能体。项目同时覆盖求职端与招聘端，核心能力包括岗位/候选人管理、简历与 JD 匹配、消息草稿、五角色串行闭环、视觉执行基础设施、安全限额与审计。

> 真实招聘平台操作属于受监督实验能力。遇到登录、验证码、安全验证、平台限制或页面状态不确定时必须停止并交还人工，不提供验证码绕过、账号池、代理池或风控规避能力。

## 快速开始

Windows：

```bat
setup.cmd
start.cmd
```

启动后访问：`http://127.0.0.1:8000/`

五角色闭环页面：`http://127.0.0.1:8000/orchestration`

手动启动：

```powershell
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
venv\Scripts\python.exe -m playwright install chromium
venv\Scripts\python.exe -m lakejob.app.console
```

## 商业级源码结构

```text
lakejob/
├── app/                    FastAPI、Web 路由与 CLI 入口
├── application/            求职、招聘、简历、消息、匹配等业务用例
├── domain/                 核心 Schema、状态机、平台目标模型
├── infrastructure/         数据库、AI、浏览器、BOSS、视觉基础设施
├── orchestration/          五角色严格串行闭环
├── safety/                 Safety Guard、Quota、动作审计
└── shared/                 日志、i18n 等公共能力

config/                     可提交的本地配置模板
migrations/                 PostgreSQL Schema 与迁移
scripts/                    数据库、验证、发布脚本
templates/                  Jinja2 页面
static/                     Web 静态资源
tests/                      自动化测试
docs/                       当前有效架构/安全/规划文档
```

根目录只保留项目入口和工程配置；业务源码统一进入 `lakejob/`，不再平铺散落。

## 五角色闭环

固定顺序：

```text
总指挥 → 执行员 → 监督员 → 合验员 → 终审审计员 → 锁定
```

合验和终审均要求至少 95 分；任一审核驳回都回到执行员，最多自动返工 3 次，仍不合格进入人工介入。终审使用独立盲审上下文，最终通过后生成内容哈希并锁定版本。

## BOSS 登录与真实模式

登录辅助入口：

```powershell
venv\Scripts\python.exe -m lakejob.infrastructure.platforms.boss.auth_login --browser-type chromium
```

真实搜索 Smoke：

```powershell
venv\Scripts\python.exe -m scripts.run_real_mode_smoke_test --mode jobradar --keyword "AI" --real --browser-type chromium
```

真实动作必须受 Safety Guard、Quota、对象确认与结果验证保护。

## 数据库

```powershell
$env:LAKEJOB_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/lakejob_db"
venv\Scripts\python.exe -m scripts.db_migrate
venv\Scripts\python.exe -m scripts.db_seed_local
```

真实 Key 只通过环境变量配置，参考 `.env.example`。

## 验证与发布

```powershell
venv\Scripts\python.exe -m compileall lakejob scripts tests
venv\Scripts\python.exe -m pytest -q
venv\Scripts\python.exe -m scripts.pre_push_check
venv\Scripts\python.exe -m scripts.make_release
```

发布脚本会排除 `runtime/`、`logs/`、浏览器 Profile、登录态、数据库、截图、缓存和虚拟环境。

## 当前文档

- `docs/ARCHITECTURE.md`：模块边界与依赖方向
- `docs/ORCHESTRATION.md`：五角色闭环协议
- `docs/SAFETY.md`：真实平台和数据安全边界
- `docs/ROADMAP.md`：后续发展顺序
