# AIAgent

AIAgent 是项目的唯一源码工程。微信小程序、后端业务 Handler、批改 Worker、Strategy、共享模块、测试与腾讯云 Self-Hosted 部署配置均维护在本目录中，

当前版本：`Runtime V10.9.0 / Strategy 1.6.19`  
Runtime Build ID：`build-20260815-primary-review-question-contract-v10.9.0`

## 工程结构

```text
AIAgent/
├─ miniapp/                     微信小程序唯一源码
├─ server/                      Self-Hosted HTTP / 数据库 / 文件兼容层
├─ cloudfunctions/              既有业务 Handler（保留目录以维持稳定业务链）
├─ cloudrun/gradingWorker/      批改执行 Worker
├─ strategy/
│  ├─ source/                   Strategy / Prompt / Schema 唯一可编辑源
│  ├─ private/                  License、签名密钥与加密材料（仅服务端）
│  └─ release/current/          当前正式 Strategy 发布制品
├─ shared/                      公共业务模块
├─ scripts/                     Strategy 发布与校验工具
├─ tests/                       工程级测试
├─ docker-compose.yml           腾讯云 Self-Hosted 编排
├─ .env.example                生产环境变量模板
└─ docs/                        部署与业务文档
```

`cloudfunctions/` 目录现在作为稳定业务 Handler 被 `server/` 直接加载，不代表生产环境仍依赖 CloudBase。保留目录与既有 Handler 结构，是为了避免迁移基础设施时重写已经稳定的批改、训练、TTS、导出和用户业务。

## 运行架构

```text
微信小程序
    ↓ HTTPS
api.example.invalid
    ↓
AIAgent API (127.0.0.1:3100)
    ├─ 微信登录 / Session
    ├─ 既有 appApi / exportData Handler
    ├─ 本地文件存储 /data/aiagent/files
    ├─ MongoDB（AIAgent 独立 Docker 网络）
    └─ gradingWorker（Docker 内网）
```

生产运行不依赖 CloudBase 云函数、CloudBase 数据库、CloudBase 云存储或 Cloud Run。微信仍负责小程序客户端与 `wx.login()` 身份入口。

## Strategy

Strategy 的唯一编辑源位于 `strategy/source/`，私密材料位于 `strategy/private/`。发布时直接执行：

```bash
npm run strategy:publish
```

该命令直接读取同工程的签名与加密材料，完成校验、签名并生成 `strategy/release/current/`；不会复制第二份 Prompt、License 或私钥到其他业务目录。

常用校验：

```bash
npm run strategy:audit
npm run test:strategy
npm run selfhost:check
npm test
```

## 开发与部署

微信开发者工具继续打开本工程（`project.config.json` 的 `miniprogramRoot` 为 `miniapp/`）。小程序 Self-Hosted API 地址由 `miniapp/config/backend.js` 控制。

腾讯云生产部署使用根目录 `docker-compose.yml`，程序目录与业务数据严格分离：

```text
/opt/aiagent/       程序
/data/aiagent/      MongoDB 与用户文件
```

完整部署步骤见 `docs/tencent-selfhost-deployment.md`。
