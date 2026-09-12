# Node API Migration

## Why Move From PowerShell To Node

The PowerShell server is useful for local experiments and quick iteration, but the project goal is a multi-model AI creation platform with users, balances, orders, async jobs, admin tools, and production deployment. A Node.js + TypeScript API gives the project a clearer module system, stronger typing, easier testing, and a cleaner path to queues and databases.

## PowerShell Version Is Still Kept

The existing PowerShell version remains available:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -PreferredPort 8787
```

The files `server.ps1`, `start.ps1`, `start.bat`, and `public/` are not deleted. They remain the local runnable backup.

## Install Dependencies

From the repository root:

```powershell
cd apps\api
npm install
```

Use Node.js 18.18 or newer.

## Configure Environment

Create an environment file for the Node API:

```powershell
cd apps\api
Copy-Item .env.example .env
notepad .env
```

Set your own key:

```text
PORT=8788
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET=your_jwt_secret_here
VOLCENGINE_ARK_API_KEY=your_volcengine_ark_api_key_here
```

Do not write real API keys into source code, README files, or committed config files.

Stage 11 adds deployment preparation: environment validation, security headers, configurable CORS, rate limiting, unified error responses, enhanced health checks, Docker files, and SQLite backups. Full deployment notes live in root `DEPLOY.md`.

## Start Node API

Development mode:

```powershell
cd apps\api
npm install
npm run db:generate
npm run db:push
npm run dev
```

If PowerShell blocks `npm.ps1`, use the Windows command shim:

```powershell
cd apps\api
npm.cmd run dev
```

Production-style local run:

```powershell
cd apps\api
npm install
npm run db:generate
npm run build
npm run start
```

## SQLite Database

Stage 5 moves the Node API generation task store from root `data/generation-tasks.json` to Prisma + SQLite. This is a local development database only.

Prisma schema:

```text
apps/api/prisma/schema.prisma
```

Default local database URL:

```text
DATABASE_URL="file:./prisma/dev.db"
```

Initialize Prisma Client:

```powershell
cd apps\api
npm run db:generate
```

Create or update SQLite tables:

```powershell
cd apps\api
npm run db:push
```

Back up SQLite:

```powershell
cd apps\api
npm run db:backup
```

Backups are written to `apps/api/backups` and ignored by git. SQLite is suitable for local development and small-scale testing only; formal multi-user production should migrate to PostgreSQL or another managed database.

The schema currently includes:

- `GenerationTask` for video generation task storage.
- `User` for local JWT registration and login.
- `User.balance`, defaulting to `0`.
- `User.role`, using `user` by default and `admin` for administrator access.
- `User.status`, using `active` by default and `disabled` for blocked users.
- `GenerationTask.cost`, defaulting to `0` for old tasks.
- `CreditLog` for balance history.
- `Order` for local Mock recharge records.
- `AdminLog` for administrator operations.
- `Provider` for database-backed supplier metadata.
- `Model` for database-backed model metadata, pricing, enabled state, and sort order.

Login and registration are connected. Stage 7 connects balance checks, generation deduction, development grants, and automatic generation refunds. Stage 8 connects local Mock recharge orders. Stage 9 connects administrator APIs, administrator logs, user disabling, and the lightweight frontend admin area.
Stage 10 moves model and provider management into SQLite while keeping `config/models.json` and `config/providers.json` as seed and fallback files.

## Import Old JSON Tasks

The old root task file is kept:

```text
apps/api/prisma/dev.db
```

To import historical JSON tasks into SQLite:

```powershell
cd apps\api
npm run db:migrate-json
```

The migration script:

- Reads root `data/generation-tasks.json`.
- Inserts missing task IDs into SQLite.
- Skips tasks already present in SQLite.
- Does not delete or rewrite the JSON file.

The old PowerShell version remains available and is not modified by this database migration.

## Frontend Backend Switch

The static frontend still lives in `public/` and is served by the PowerShell local server. The sidebar now shows the active backend mode and can switch the API base between:

```text
PowerShell API: /api
Node API: http://127.0.0.1:8788/api
```

The chosen value is stored in browser local storage under:

```text
relay.apiBaseUrl
```

The frontend uses one API helper, `apiRequest()`, for model loading, video provider loading, video generation, task list loading, and single task lookup. That keeps these calls on the selected backend instead of hard-coding `/api`.

Current switched endpoints:

```text
GET  /health
GET  /providers
POST /auth/register
POST /auth/login
GET  /auth/me
POST /auth/logout
POST /chat/completions
GET  /video/providers
GET  /models
POST /video/generations
GET  /video/tasks
GET  /video/tasks/{taskId}
GET  /user/balance
GET  /user/credit-logs
GET  /recharge/packages
POST /orders
GET  /orders
GET  /orders/{orderId}
POST /orders/{orderId}/mock-pay
GET  /admin/stats
GET  /admin/users
GET  /admin/users/{userId}
POST /admin/users/{userId}/adjust-balance
POST /admin/users/{userId}/disable
POST /admin/users/{userId}/enable
GET  /admin/orders
GET  /admin/tasks
GET  /admin/credit-logs
GET  /admin/admin-logs
GET  /admin/models
PATCH /admin/models/{modelId}
GET  /admin/providers
PATCH /admin/providers/{providerId}
```

## Auth And Task Ownership

Stage 6 adds local JWT auth for the Node API. Configure:

```text
JWT_SECRET=your_jwt_secret_here
```

Register:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8788/api/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"user@example.com","password":"password123","nickname":"User"}'
```

Login:

```powershell
$login = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8788/api/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"user@example.com","password":"password123"}'
```

Check current user:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8788/api/auth/me" `
  -Headers @{ Authorization = "Bearer $($login.token)" }
```

Video generation task APIs now require login in Node API mode. New video tasks write `userId` to `GenerationTask`. A normal user can only list and query tasks that belong to that same user. Historical tasks with `userId = null` are kept for compatibility but are not visible to normal users through Node API task endpoints.

## Balance And Credit Logs

Grant local development credits:

```powershell
cd apps\api
npm run dev:grant-credits -- --email test@example.com --amount 100
```

This script looks up the user by email, increases `User.balance`, and writes a `CreditLog` with `type=system_grant`. It is only for local development and is not a public recharge API.

Check current balance:

```text
GET http://127.0.0.1:8788/api/user/balance
Authorization: Bearer TOKEN
```

Check the current user's credit logs:

```text
GET http://127.0.0.1:8788/api/user/credit-logs
Authorization: Bearer TOKEN
```

The credit log endpoint only returns records for the authenticated user.

## Generation Billing

Video model prices are read from the SQLite `Model` table after syncing model config. If the database has no model rows, the API falls back to `config/models.json`. Each enabled video model must have a positive numeric `price`; otherwise generation is rejected before provider calls.

Sync config into SQLite:

```powershell
cd apps\api
npm run dev:sync-models
```

The sync script reads root `config/providers.json` and `config/models.json`, then upserts providers by `providerKey` and models by `modelKey`. It updates display names, prices, enabled state, types, and default config. It does not delete database-only rows. It stores only the environment variable name in `apiKeyEnvName`, never the real supplier API key.

Generation flow in Node API mode:

- Create `GenerationTask` with `cost`.
- Deduct credits with a `CreditLog` of `type=consume`.
- If balance is insufficient, return `余额不足，请充值后再生成。`.
- Call the provider adapter only after deduction succeeds.
- If provider task creation fails, mark the task `failed`, save `errorMessage`, and refund once with `type=refund`.
- If task polling later finds provider failure, refund once if the task was charged and has not already been refunded.
- If a model is disabled, missing, or has `price <= 0`, generation is rejected before provider calls.
- If a provider is disabled, generation is rejected before provider calls.

Testing:

- Balance insufficient: register/login a user with `balance=0` and submit a video generation request.
- Deduction: grant credits, submit generation, then compare `/api/user/balance` and `/api/user/credit-logs`.
- Provider creation failure refund: use a missing or invalid local provider key, submit generation, and confirm consume and refund logs.
- Task ownership: `GET /api/video/tasks` and `GET /api/video/tasks/{taskId}` only return the current user's tasks.

## Mock Recharge Orders

Stage 8 adds local-only Mock recharge orders. This does not integrate WeChat Pay, Alipay, payment callbacks, QR codes, or third-party payment SDKs.

Recharge package config:

```text
config/recharge-packages.json
```

Only packages with `enabled: true` are exposed by the API. The frontend reads packages from the backend.

View packages:

```text
GET http://127.0.0.1:8788/api/recharge/packages
Authorization: Bearer TOKEN
```

Create an order:

```text
POST http://127.0.0.1:8788/api/orders
Authorization: Bearer TOKEN
Content-Type: application/json

{"packageId":"starter"}
```

List current user's orders:

```text
GET http://127.0.0.1:8788/api/orders
Authorization: Bearer TOKEN
```

Mock payment success:

```text
POST http://127.0.0.1:8788/api/orders/{orderId}/mock-pay
Authorization: Bearer TOKEN
```

Mock payment runs in a Prisma transaction: it verifies the order belongs to the current user, verifies status is `pending`, updates the order to `paid`, writes `paidAt`, increases `User.balance`, and creates a `CreditLog` with `type=recharge` and `relatedOrderId`. A paid order cannot be mock-paid twice, and users cannot view or pay another user's order.

Verify arrival:

```text
GET http://127.0.0.1:8788/api/user/balance
GET http://127.0.0.1:8788/api/user/credit-logs
```

## Admin Management

Stage 9 adds local administrator APIs and a lightweight frontend admin page. Backend access is enforced by `requireAdmin`, which requires a valid JWT, `User.status=active`, and `User.role=admin`.

Promote an existing local user:

```powershell
cd apps\api
npm run dev:make-admin -- --email test@example.com
```

Call admin APIs with an admin token:

```text
Authorization: Bearer ADMIN_TOKEN
```

Admin endpoints:

```text
GET  http://127.0.0.1:8788/api/admin/stats
GET  http://127.0.0.1:8788/api/admin/users
GET  http://127.0.0.1:8788/api/admin/users/{userId}
POST http://127.0.0.1:8788/api/admin/users/{userId}/adjust-balance
POST http://127.0.0.1:8788/api/admin/users/{userId}/disable
POST http://127.0.0.1:8788/api/admin/users/{userId}/enable
GET  http://127.0.0.1:8788/api/admin/orders
GET  http://127.0.0.1:8788/api/admin/tasks
GET  http://127.0.0.1:8788/api/admin/credit-logs
GET  http://127.0.0.1:8788/api/admin/admin-logs
GET  http://127.0.0.1:8788/api/admin/models
PATCH http://127.0.0.1:8788/api/admin/models/{modelId}
GET  http://127.0.0.1:8788/api/admin/providers
PATCH http://127.0.0.1:8788/api/admin/providers/{providerId}
```

Adjust a user's balance:

```text
POST http://127.0.0.1:8788/api/admin/users/{userId}/adjust-balance
Authorization: Bearer ADMIN_TOKEN
Content-Type: application/json

{"amount":50,"remark":"local test adjustment"}
```

Positive amounts add credits. Negative amounts deduct credits. The API rejects changes that would make the balance negative. A successful adjustment writes both `CreditLog.type=admin_adjust` and an `AdminLog` entry.

Disable or enable a user:

```text
POST http://127.0.0.1:8788/api/admin/users/{userId}/disable
POST http://127.0.0.1:8788/api/admin/users/{userId}/enable
Authorization: Bearer ADMIN_TOKEN
```

Disabled users cannot log in. If they already have a token, active-user APIs such as video generation, recharge package loading, order creation, order payment, balance, and credit-log queries return `403`.

Frontend admin access:

1. Start PowerShell frontend on `http://127.0.0.1:8787`.
2. Start Node API on `http://127.0.0.1:8788/api`.
3. Switch the frontend backend mode to `Node API`.
4. Login as an admin user.
5. The `管理后台` tab appears only for admin users.

Model management:

```text
PATCH http://127.0.0.1:8788/api/admin/models/{modelId}
Authorization: Bearer ADMIN_TOKEN
Content-Type: application/json

{"displayName":"Seedance Fast","price":12,"enabled":true,"sortOrder":20}
```

The model patch API allows `displayName`, `price`, `enabled`, and `sortOrder`. It rejects negative prices and writes an `AdminLog` entry. Public `GET /api/models` returns only enabled models. Admin `GET /api/admin/models` returns all models, including disabled ones.

Provider management:

```text
PATCH http://127.0.0.1:8788/api/admin/providers/{providerId}
Authorization: Bearer ADMIN_TOKEN
Content-Type: application/json

{"displayName":"Volcengine Ark","enabled":true,"baseUrl":"https://ark.cn-beijing.volces.com/api/v3","apiKeyEnvName":"VOLCENGINE_ARK_API_KEY"}
```

The provider patch API allows `displayName`, `enabled`, `baseUrl`, and `apiKeyEnvName`. `apiKeyEnvName` must be an environment variable name such as `VOLCENGINE_ARK_API_KEY`; values that look like real keys, including `sk-`, `ark-`, or `Bearer ...`, are rejected. The real key belongs in `.env`:

```text
VOLCENGINE_ARK_API_KEY=your_real_key_here
```

Do not put real API keys into the admin page, config JSON, database, README, or frontend. `GET /api/admin/providers` may show `baseUrl` and `apiKeyEnvName` for admins, but never returns the real environment variable value. Public provider APIs do not return `baseUrl` or `apiKeyEnvName`.

The frontend admin page can view orders, tasks, credit logs, admin logs, model metadata, and supplier metadata. It can edit model display name, price, enabled state, sort order, provider display name, provider enabled state, provider base URL, and provider API-key environment variable name.

## Chat Compatibility Route

Node API mode includes:

```text
POST http://127.0.0.1:8788/api/chat/completions
```

This route exists so the frontend chat and homework areas do not fall through to an unknown endpoint after switching to Node API. It is intentionally conservative:

- The browser must not send supplier API keys.
- The Node API reads keys only from environment variables.
- Current `config/models.json` only contains video models.
- No Node chat provider adapter is wired yet.

If there is no enabled chat model/provider/key, the route returns:

```text
Node API currently has no chat model configured. Contact the administrator or switch back to PowerShell API.
```

Future chat migration should add chat models to `config/models.json`, add the matching provider config to `config/providers.json`, and register a chat provider adapter in `apps/api/src/services/chat.service.ts`.

## Test Health

```text
GET http://127.0.0.1:8788/api/health
```

Expected result includes `status`, `time`, `version`, `environment`, `database`, `modelsCount`, and `providersCount`. It does not return API keys, JWT secrets, database passwords, or payment secrets.

## Test Models

```text
GET http://127.0.0.1:8788/api/models
```

The Node API reads enabled models from SQLite after `npm run dev:sync-models`. If no database model rows exist, it falls back to root `config/models.json`.

## Test Video Generation Task

```powershell
$body = @{
  modelId = "doubao-seedance-1-5-pro-251215"
  mode = "text-to-video"
  prompt = "cinematic lake village, morning mist"
  ratio = "16:9"
  duration = 5
  resolution = "720p"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8788/api/video/generations" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

The Node API task is persisted in:

```text
apps/api/prisma/dev.db
```

List tasks:

```text
GET http://127.0.0.1:8788/api/video/tasks
Authorization: Bearer TOKEN
```

Get one task:

```text
GET http://127.0.0.1:8788/api/video/tasks/{taskId}
Authorization: Bearer TOKEN
```

For compatibility with the earlier PowerShell frontend style, Node also accepts:

```text
GET http://127.0.0.1:8788/api/video/tasks?taskId={taskId}
```

## Current Limits

- Deployment hardening is prepared, but a public production launch still requires real operations review, HTTPS, reverse proxy hardening, content safety, abuse controls, privacy/compliance checks, and database migration planning.
- Registration and login are local JWT flows backed by SQLite.
- Balance checks, generation deduction, local development grants, and automatic generation refunds are implemented.
- Mock recharge orders are implemented for local development only.
- Admin APIs, admin logs, user disabling, and the lightweight frontend admin area are implemented for local development.
- Database-backed model and provider management is implemented for local development.
- No real payment, payment callback, WeChat Pay, or Alipay integration yet.
- Docker and deployment notes are available, but this is not a fully production-ready deployment.
- No object storage integration yet.
- No additional real model provider adapters beyond the current Volcengine video adapter path yet.
- Node chat has a compatibility route, but no chat provider adapter is wired yet; current production-like chat use should stay on PowerShell API until a Node adapter is added.
- Node API task storage now uses local SQLite through Prisma.
- Root `data/generation-tasks.json` is retained for the old PowerShell version and optional import.
- SQLite is only the local development database for this transition stage.
- Later stages should migrate task persistence to PostgreSQL or MySQL.
