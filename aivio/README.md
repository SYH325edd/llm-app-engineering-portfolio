# AIVio Local Commercial Edition

AIVio 的本地商业化整理版。保留原 React 产品前端和现有业务流程，运行结构统一为：React + Vite Web、Express API、Prisma + SQLite、本地文件存储，以及可选的外部 AI Provider。

## 项目结构

```text
AIVio/
├─ apps/
│  ├─ web/                  # React 前端
│  └─ api/                  # Node / Express API
├─ packages/
│  └─ contracts/            # 前后端共享 contract
├─ docs/
│  └─ ARCHITECTURE.md       # 架构边界
├─ scripts/                 # 环境检查 / 本地维护
├─ tests/                   # 回归与架构测试
├─ start-local.bat          # Windows 一键启动
├─ start-local.ps1
└─ package.json             # 唯一 workspace 管理入口
```

详细模块边界见 `docs/ARCHITECTURE.md`。

## 一键启动

Windows 直接双击：

```text
start-local.bat
```

首次启动会：

1. 检查 Node.js / npm。
2. 从示例创建缺失的 `apps/api/.env`、`apps/web/.env`。
3. 自动生成本地 JWT Secret。
4. 从项目根目录统一安装 workspace 依赖。
5. 初始化 Prisma + SQLite。
6. 同步模型配置。
7. 启动 API 与 React 前端。
8. 自动打开浏览器。

本地地址：

```text
Web:          http://127.0.0.1:5173
API:          http://127.0.0.1:8788/api
Health:       http://127.0.0.1:8788/api/health
GET /health:  http://127.0.0.1:8788/health
SQLite:       apps/api/prisma/dev.db
```

## 环境配置

首次手动配置可以复制：

```text
apps/api/.env.example -> apps/api/.env
apps/web/.env.example -> apps/web/.env
```

前端默认：

```text
VITE_API_BASE_URL=http://127.0.0.1:8788/api
```

SQLite：

```text
DATABASE_URL="file:./dev.db"
```

Provider Key 只能放在 `apps/api/.env`。不要把模型 Key、支付 Key 或 JWT Secret 放入前端环境变量。

## 根目录开发命令

所有命令统一从项目根目录运行：

```powershell
npm install
npm run db:generate
npm run db:push
npm run models:sync
npm run web:dev
npm run api:dev
```

质量检查：

```powershell
npm test
npm run typecheck
npm run build
npm run preflight
```

## Local-first storage

图片与视频默认保存在本机 `apps/api/uploads/`。不配置 R2 也可以正常上传和在 AIVio 本地页面中预览。

如果第三方模型必须主动读取图片或视频，它无法访问 `127.0.0.1`。这种情况下配置：

```text
PUBLIC_ASSET_BASE_URL=https://your-public-host.example
```

也可以配置已支持的对象存储。对象存储属于可选能力，不是本地 AIVio 启动前提。

## Storage Policy

本地上传文件默认由 Git 忽略。按 `UPLOAD_RETENTION_DAYS` 清理临时素材：

```powershell
npm run cleanup:uploads
```

## Email Code Registration

邮箱验证码注册流程保留。本地开发未配置真实邮件服务时，可使用开发验证码；生产使用时配置 SMTP 或现有邮件 Provider。

例如 Gmail SMTP：

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

这是标准 SMTP 邮件投递，not Google OAuth，不会读取 Gmail 邮箱内容。

## Agnes Video Provider Notes

Agnes 支持文生视频、图生视频和多图关键帧，不支持参考视频输入。图片素材需要公网可访问地址；本机 `localhost` / `127.0.0.1` 只能用于 AIVio 自己预览，不能被外部模型服务主动读取。

## 本地数据

- 用户、积分、订单、任务：SQLite。
- 上传素材：`apps/api/uploads/`。
- 真实 Provider Key：`apps/api/.env`。
- 浏览器端不保存后端供应商 Secret。
