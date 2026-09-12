# AIVio Architecture

AIVio 采用模块化单体（Modular Monolith）。目标是保持单机部署和本地开发简单，同时让前端、后端业务模块、基础设施与跨端契约拥有明确边界。

## Top-level

```text
AIVio/
├─ apps/
│  ├─ web/                  React + Vite 前端
│  └─ api/                  Express + Prisma API
├─ packages/
│  └─ contracts/            前后端共享 DTO / contract
├─ docs/                    架构文档
├─ scripts/                 环境检查与维护脚本
├─ tests/                   跨模块回归测试
├─ start-local.bat          Windows 本地入口
├─ start-local.ps1
└─ package.json             唯一 workspace 管理入口
```

## Web

```text
apps/web/src/
├─ app/                     应用路由与组合
├─ features/                按业务能力组织页面与业务 UI
│  ├─ auth/
│  ├─ dashboard/
│  ├─ generation/
│  ├─ tasks/
│  ├─ templates/
│  ├─ billing/
│  ├─ profile/
│  └─ admin/
├─ shared/                  跨业务 API client 等公共能力
├─ components/              纯通用 UI
├─ context/                 应用级上下文
├─ config/                  前端静态配置
├─ styles/                  全局样式与设计 token
└─ utils/                   无业务归属的纯工具
```

业务页面的唯一实现位于 `features/*`，旧 `src/pages` 已删除。Feature 专属 API 封装与对应业务同目录，共享的 API client 与跨 Feature API 位于 `shared/api`，旧 `src/lib` 已删除。生成页的大型状态/纯函数已拆到 `features/generation/create`；管理后台的展示模块和纯工具分别位于 `features/admin/components` 与 `features/admin/admin-utils.ts`。

## API

```text
apps/api/src/
├─ app/                     Express 应用组合，不监听端口
├─ server.ts                环境校验与 HTTP listener
├─ modules/                 业务模块，自己拥有 route/service
│  ├─ auth/
│  ├─ users/
│  ├─ billing/
│  ├─ admin/
│  ├─ models/
│  ├─ assets/
│  ├─ prompt/
│  ├─ invite/
│  ├─ generation/
│  ├─ chat/
│  └─ health/
├─ infrastructure/
│  ├─ database/             Prisma / SQLite
│  └─ email/                邮件投递
├─ providers/               外部 AI provider adapter
├─ middleware/              HTTP 横切能力
├─ config/                  环境和业务配置加载
├─ types/                   API 内部领域类型
└─ utils/                   日志、响应、ID 等通用工具
```

`app/create-app.ts` 只依赖各业务模块的 `index.ts`，不会直接越过模块边界读取 route 文件。业务 route/service 不再集中堆放在全局 `routes/`、`services/` 目录。

## Contracts

`packages/contracts` 保存真正跨进程边界使用的 DTO。当前首先统一健康检查 contract，后续新增跨端结构时按实际需求逐步迁入，不建立大而全的共享类型仓库。

## Data and storage

- 结构化数据默认使用 `apps/api/prisma/dev.db`（SQLite）。
- 图片和视频默认保存到 `apps/api/uploads/`。
- R2 配置完整时可选用 R2 保存图片；未配置时不会阻塞本地上传。
- 外部 AI provider 如果必须读取公网素材，需要配置 `PUBLIC_ASSET_BASE_URL`、公网 tunnel 或可访问的对象存储地址。

## Runtime boundaries

- 浏览器只连接 `http://127.0.0.1:8788/api`。
- Provider Key、JWT Secret、SMTP 等秘密只存在后端 `.env`。
- 前端不得持有供应商 Key。
- `start-local` 从根 workspace 统一安装依赖、初始化 SQLite、同步模型并启动 Web/API。

## Engineering rules

1. 新业务优先进入现有 `features/<domain>` / `modules/<domain>`，不要重新建立全局业务堆叠目录。
2. `app` 只负责组合，不放领域业务。
3. `infrastructure` 处理数据库、邮件等技术实现，不承载业务决策。
4. `providers` 负责第三方模型协议转换，业务层不散落供应商 HTTP 细节。
5. 只有真正跨 Web/API 的稳定 DTO 才进入 `packages/contracts`。
6. 不为当前规模引入微服务、Redis、消息队列或复杂 Repository 抽象。
