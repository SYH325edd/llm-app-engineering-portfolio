# API Relay Console

Local API relay and creation console. This is still a local development version: it keeps the existing PowerShell + static frontend shape, and also includes a Node.js API under `apps/api` for the migration path.

## Configure Environment

Copy `.env.example` to `.env` and fill in your own key:

```powershell
Copy-Item .env.example .env
notepad .env
```

`.env` can contain the providers you want to enable:

```text
JWT_SECRET=your_jwt_secret_here
DATABASE_URL="file:./dev.db"
VOLCENGINE_ARK_API_KEY=your_real_key_here
AGNES_API_KEY=your_agnes_key_here
OPENAI_API_KEY=your_openai_key_here
DEEPSEEK_API_KEY=your_deepseek_key_here
GITHUB_MODELS_API_KEY=your_github_models_key_here
```

Do not commit `.env` or real API keys. The frontend no longer accepts, sends, or stores supplier API keys. The backend reads keys from environment variables only. Video uses the environment variable named in `config/providers.json`; chat providers use their matching environment variables.

## Preflight Check

Before local release checks or deployment handoff, run:

```powershell
npm run verify
```

After the Node API starts, open:

```text
GET /health
```

Confirm these fields are in the expected state:

- `database`
- `volcengineConfigured`
- `agnesConfigured`
- `publicAssetBaseUrlConfigured`
- `mockPaymentEnabled`

Notes:

- `mockPaymentEnabled=true` is for test environments only.
- Production should not enable Mock payment.
- If `publicAssetBaseUrlConfigured=false`, external models may not be able to access locally uploaded assets.

## Storage Policy

- In the MVP stage, uploaded source assets may be stored temporarily on the server local disk.
- The default local upload retention window is controlled by `UPLOAD_RETENTION_DAYS=7`.
- You can manually clean expired local uploads with:

```powershell
npm run cleanup:uploads
```

- AI-generated videos should not be stored on the server local disk for the long term.
- The server keeps task metadata, status, cost, error information, and result URLs only.
- Production can later move uploads and generated assets to object storage or a CDN, but that is not included in this round.

## Agnes Video Provider Notes

- Agnes supports text-to-video, image-to-video, and multi-image/keyframe video generation.
- The current project does not allow Agnes reference-video input.
- Image materials sent to Agnes must use a publicly reachable URL.
- Local `/uploads/...`, `localhost`, and `127.0.0.1` URLs are not reachable from the Agnes service.
- When using image materials in deployment, configure `PUBLIC_ASSET_BASE_URL`.
- `AGNES_REQUEST_TIMEOUT_MS` defaults to `60000`.

## Email Code Registration

- Users register with email + password first, then complete registration by entering a 6-digit email verification code.
- The API sends the code through SMTP, not Google OAuth.
- It does not require the Gmail API and it does not read Gmail inbox content.
- Gmail SMTP example:
  - `SMTP_HOST=smtp.gmail.com`
  - `SMTP_PORT=587`
  - `SMTP_SECURE=false`
- These SMTP variables can be configured in the root `.env` or in `apps/api/.env` for local API startup.
- Port `587` usually pairs with `SMTP_SECURE=false`, while port `465` usually pairs with `SMTP_SECURE=true`.
- If you use a personal Gmail account, Google two-step verification and an app password are usually required.
- Local development can use the development verification code when SMTP is not configured.
- Production must configure SMTP when `AUTH_REQUIRE_EMAIL_VERIFICATION=true`, and it must not return a development verification code.
- Before launch, run:

```powershell
npm run check:env
npm run preflight
```

- Unverified email accounts cannot log in when email verification is required.
- Later iterations should add resend frequency limits and verification request rate limits.

## Server Deployment Checklist

1. Pull the latest code from GitHub.
2. Install dependencies for the root workspace, `apps/api`, and `apps/web`.
3. Create and configure `.env` from `.env.example`.
4. Run:

```powershell
npm run preflight
```

5. Build:

```powershell
npm run build
```

6. Start the API service.
7. Start the web service.
8. Check:

```text
GET /health
GET /api/health
```

9. Clean expired uploads manually when needed:

```powershell
npm run cleanup:uploads
```

Production notes:

- Do not enable `ENABLE_MOCK_PAYMENT=true`.
- Do not commit `.env`.
- Do not commit `uploads/`.
- Do not keep generated videos on the server long term.
- If `PUBLIC_ASSET_BASE_URL` is missing, external models may not be able to access locally uploaded assets.

## Start

### PowerShell API

Double-click `start.bat`, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -PreferredPort 8787
```

Open:

```text
http://127.0.0.1:8787
```

### Node API

In a second terminal, start the Node API:

```powershell
cd apps\api
npm install
npm run db:generate
npm run db:push
npm run dev
```

If PowerShell blocks `npm.ps1`, use:

```powershell
cd apps\api
npm.cmd run dev
```

If the default npm registry is slow or blocked, install dependencies through a mirror:

```powershell
cd apps\api
npm config set registry https://registry.npmmirror.com
npm.cmd install
```

`helmet` and `express-rate-limit` are production dependencies. The API prefers the real packages at runtime and only uses the local fallback when they are not installed.

The Node API listens on:

```text
http://127.0.0.1:8788/api
```

Stage 11 adds deployment preparation and security hardening for the Node API. See [DEPLOY.md](DEPLOY.md) for production build, Docker, reverse proxy, HTTPS, environment variable, and SQLite backup notes.

The page has a backend mode switch in the sidebar. It can show and switch between:

```text
PowerShell API · 127.0.0.1:8787
Node API · 127.0.0.1:8788
```

The selected API base is stored only in browser local storage as `relay.apiBaseUrl`.

For production, the frontend should call your deployed API origin, for example:

```text
https://你的域名/api
```

The frontend must never store supplier API keys.

### Aivio React Web

The new Vite + React frontend lives in `apps/web`.

Configure the Node API URL with:

```text
VITE_API_BASE_URL=http://127.0.0.1:8788/api
```

Start the Node API first:

```powershell
cd apps\api
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:push
npm.cmd run dev
```

Then start the web app:

```powershell
cd apps\web
npm.cmd install
npm.cmd run dev
```

The web app uses the Node API auth endpoints for login, register, logout, and `/api/auth/me`. To make a user an admin:

```powershell
cd apps\api
npm.cmd run dev:make-admin -- --email test@example.com
```

Do not put supplier API keys, payment keys, or `JWT_SECRET` in `apps/web/.env`.

B-2 connects user balance and credit logs in `apps/web`:

```text
GET /api/user/balance
GET /api/user/credit-logs
```

Grant local test credits with:

```powershell
cd apps\api
npm.cmd run dev:grant-credits -- --email test@example.com --amount 100
```

B-3 connects models, video generation, and user tasks in `apps/web`:

```text
GET /api/models
POST /api/video/generations
GET /api/video/tasks
GET /api/video/tasks/:taskId
```

Use `/create` to select a real enabled model and submit a prompt. Use `/tasks` to view status, cost, result URL, and errors. To test insufficient balance, use a user with `0` credits and submit a generation. To test successful task creation, grant credits first with `dev:grant-credits`.

### Prompt Rewrite API

`/create` uses the Node API to optimize the creative description before generation. The endpoint temporarily uses Agnes AI and does not fall back to DeepSeek.

```text
POST /api/prompt/rewrite
```

Request JSON:

```json
{
  "prompt": "一个女孩在海边走路",
  "duration": 8,
  "generationMode": "image",
  "ratio": "9:16",
  "resolution": "1080p"
}
```

Fields:

- `prompt`: required, 1-1000 characters. Empty input returns `请先输入创意描述`; input over 1000 characters returns `创意描述不能超过 1000 字`.
- `duration`: optional, defaults to `6`; values are normalized to the supported 4-15 second range.
- `generationMode`: optional, defaults to `text`; supported values are `text`, `image`, and `video`.
- `ratio`: optional, defaults to `16:9`.
- `resolution`: optional, defaults to `720p`.

Response JSON:

```json
{
  "rewrittenPrompt": "0-3秒：...\n3-5秒：...\n5-8秒：...\n全局约束：..."
}
```

Behavior:

- When `AGNES_API_KEY` is configured, the backend sends the original prompt and context to the Agnes OpenAI-compatible chat endpoint with model `agnes-2.0-flash`.
- Agnes is responsible for rewriting the prompt. The backend returns Agnes's final text directly as `rewrittenPrompt`.
- `duration`, `generationMode`, `ratio`, and `resolution` are passed as context only. The prompt rewrite instruction tells Agnes not to mechanically include ratio, resolution, or output-spec text unless the user asked for it.
- If the key is missing, the Agnes request fails, times out, returns empty content, or returns an unexpected format, the endpoint returns the Chinese error `优化错误，请重试`.
- Local fallback is intentionally disabled for now. Add it back only after a product decision explicitly enables fallback behavior.
- The API returns JSON errors only; it does not expose stack traces or API keys.

Prompt rewrite integration lives in:

```text
apps/api/src/services/prompt-rewrite.service.ts
```

Keep supplier API keys in `apps/api/.env` only. Do not put Agnes, DeepSeek, or Volcengine Ark keys in frontend code or frontend environment files.

B-4 connects local Mock recharge and orders in `apps/web`:

```text
GET /api/recharge/packages
POST /api/orders
GET /api/orders
GET /api/orders/:orderId
POST /api/orders/:orderId/mock-pay
```

Start the Node API and web app, log in, open `/recharge`, select a package, create an order, and click `模拟支付成功`. The balance and credit logs refresh after payment. This remains Mock payment only; real payment, WeChat Pay, and Alipay are not connected.

B-5 connects the `apps/web` management page to real Node API admin data. Promote an existing local user first:

```powershell
cd apps\api
npm.cmd run dev:make-admin -- --email test@example.com
```

Log in as that user and open `/admin` in the React web app. The Chinese admin area can view stats, users, orders, tasks, credit logs, models, providers, and admin logs. It can adjust balances, disable or enable users, create/edit/delete/enable/disable models, and create/edit/delete/enable/disable providers. A normal logged-in user sees `无权限访问`.

Do not enter real supplier API keys when creating models or providers. Config JSON must not contain API keys, and provider records store only the environment variable name for the secret. Real API keys belong only in `apps/api/.env`. Repository config files can still seed or refresh database models and providers:

```powershell
cd apps\api
npm.cmd run dev:sync-models
```

The B-5 web admin area still does not connect real payment or production payment callbacks, and it does not add WeChat Pay or Alipay. Supplier API keys and `JWT_SECRET` remain backend-only secrets and must not be placed in frontend code or frontend env files.

## SQLite Database

The Node API now uses Prisma + SQLite for users, generation tasks, balances, credit logs, and reserved order records. This is a local development database only.

The Prisma schema lives in:

```text
apps/api/prisma/schema.prisma
```

The local SQLite database is configured with:

```text
DATABASE_URL="file:./dev.db"
```

For Prisma commands run inside `apps/api`, copy:

```text
apps/api/.env.example -> apps/api/.env
```

Keep:

```text
DATABASE_URL="file:./dev.db"
```

`file:./dev.db` is resolved from [apps/api/prisma/schema.prisma](/C:/Users/yinghao/Desktop/AIVio-main/apps/api/prisma/schema.prisma), so the actual SQLite file lands at:

```text
apps/api/prisma/dev.db
```

Initialize or refresh the local database:

```powershell
cd apps\api
npm install
npm run db:generate
npm run db:push
```

Back up the current SQLite database:

```powershell
cd apps\api
npm run db:backup
```

Backups are written to `apps/api/backups` and ignored by git. SQLite is for local development and small-scale testing; formal multi-user production should migrate to PostgreSQL or another managed database.

The schema includes `User.balance` with default `0`, `User.role`, `User.status`, `GenerationTask.cost` with default `0` for old tasks, `CreditLog` for `recharge`, `consume`, `refund`, `admin_adjust`, and `system_grant`, `Order` for Mock recharge orders, and `AdminLog` for administrator operations.

Stage 10 also adds database-backed `Provider` and `Model` tables. `config/providers.json` and `config/models.json` are still kept as seed and fallback files.

To import old local JSON task records into SQLite:

```powershell
cd apps\api
npm run db:migrate-json
```

The import reads the old root JSON file:

```text
data/generation-tasks.json
```

It skips task IDs that already exist in SQLite and does not delete or modify the JSON file. The old PowerShell version still uses the JSON file and remains available.

## Config Files

Providers live in:

```text
config/providers.json
```

Video models live in:

```text
config/models.json
```

Mock recharge packages live in:

```text
config/recharge-packages.json
```

Only packages with `enabled: true` are returned by the Node API. The frontend reads these packages from the backend and does not hard-code recharge amounts.

The frontend loads video models from:

```text
GET /api/models
```

After changing the seed config files, sync them into SQLite:

```powershell
cd apps\api
npm run dev:sync-models
```

The sync script upserts providers by `providerKey` and models by `modelKey`. It does not delete database-only rows and does not store real API keys. Provider rows store only `apiKeyEnvName`, for example `VOLCENGINE_ARK_API_KEY` or `AGNES_API_KEY`; the real value belongs in `.env`.

When Node API mode is selected, the same frontend calls:

```text
POST http://127.0.0.1:8788/api/auth/register
POST http://127.0.0.1:8788/api/auth/login
GET http://127.0.0.1:8788/api/auth/me
POST http://127.0.0.1:8788/api/auth/logout
POST http://127.0.0.1:8788/api/chat/completions
GET http://127.0.0.1:8788/api/models
GET http://127.0.0.1:8788/api/video/providers
GET http://127.0.0.1:8788/api/video/tasks
POST http://127.0.0.1:8788/api/video/generations
GET http://127.0.0.1:8788/api/video/tasks/{taskId}
GET http://127.0.0.1:8788/api/user/balance
GET http://127.0.0.1:8788/api/user/credit-logs
GET http://127.0.0.1:8788/api/recharge/packages
POST http://127.0.0.1:8788/api/orders
GET http://127.0.0.1:8788/api/orders
GET http://127.0.0.1:8788/api/orders/{orderId}
POST http://127.0.0.1:8788/api/orders/{orderId}/mock-pay
GET http://127.0.0.1:8788/api/admin/stats
GET http://127.0.0.1:8788/api/admin/users
GET http://127.0.0.1:8788/api/admin/users/{userId}
POST http://127.0.0.1:8788/api/admin/users/{userId}/adjust-balance
POST http://127.0.0.1:8788/api/admin/users/{userId}/disable
POST http://127.0.0.1:8788/api/admin/users/{userId}/enable
GET http://127.0.0.1:8788/api/admin/orders
GET http://127.0.0.1:8788/api/admin/tasks
GET http://127.0.0.1:8788/api/admin/credit-logs
GET http://127.0.0.1:8788/api/admin/admin-logs
GET http://127.0.0.1:8788/api/admin/models
POST http://127.0.0.1:8788/api/admin/models
PATCH http://127.0.0.1:8788/api/admin/models/{modelId}
DELETE http://127.0.0.1:8788/api/admin/models/{modelId}
GET http://127.0.0.1:8788/api/admin/providers
POST http://127.0.0.1:8788/api/admin/providers
PATCH http://127.0.0.1:8788/api/admin/providers/{providerId}
DELETE http://127.0.0.1:8788/api/admin/providers/{providerId}
```

## Video Generation

Create a local generation task:

```text
POST http://127.0.0.1:8787/api/video/generations
```

Request example:

```json
{
  "modelId": "doubao-seedance-1-5-pro-251215",
  "mode": "text-to-video",
  "prompt": "cinematic rain night street, red sports car passing neon lights",
  "ratio": "16:9",
  "duration": 5,
  "resolution": "720p",
  "generateAudio": false,
  "watermark": false
}
```

Query a local task:

```text
GET http://127.0.0.1:8787/api/video/tasks?taskId=LOCAL_TASK_ID
GET http://127.0.0.1:8787/api/video/tasks/LOCAL_TASK_ID
```

List local tasks:

```text
GET http://127.0.0.1:8787/api/video/tasks
```

In Node API mode, video task creation and task list APIs require login. The frontend stores the returned JWT in local storage and sends it as:

```text
Authorization: Bearer TOKEN
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
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8788/api/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"user@example.com","password":"password123"}'
```

Check current user:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8788/api/auth/me" `
  -Headers @{ Authorization = "Bearer YOUR_TOKEN" }
```

Grant local development credits to a test user:

```powershell
cd apps\api
npm run dev:grant-credits -- --email test@example.com --amount 100
```

This is only a local developer script. It is not a public recharge endpoint and does not perform payment.

Promote a local development user to administrator:

```powershell
cd apps\api
npm run dev:make-admin -- --email test@example.com
```

This script only updates an existing local user by email. It is not a public role-management endpoint.

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

## Mock Recharge

Stage 8 adds a local-only Mock recharge order flow. It is for development testing only and does not connect to WeChat Pay, Alipay, payment callbacks, QR codes, or any third-party payment SDK.

View enabled packages:

```text
GET http://127.0.0.1:8788/api/recharge/packages
Authorization: Bearer TOKEN
```

Create a pending order:

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

Mock-pay an order:

```text
POST http://127.0.0.1:8788/api/orders/{orderId}/mock-pay
Authorization: Bearer TOKEN
```

Mock payment marks the order as `paid`, writes `paidAt`, increases `User.balance`, and writes a `CreditLog` with `type=recharge`, `amount=credits`, `relatedOrderId`, and the before/after balances. Calling mock-pay again on a paid order returns a clear error. Users can only view and pay their own orders.

Verify credits arrived by calling:

```text
GET http://127.0.0.1:8788/api/user/balance
GET http://127.0.0.1:8788/api/user/credit-logs
```

In Node API mode, video generation checks and deducts credits:

- Model prices are read from the SQLite `Model` table after `npm run dev:sync-models`; if the database has no model rows, the API falls back to `config/models.json`.
- Each enabled video model must have a positive numeric `price`.
- `enabled=false` models are hidden from `/api/models` and rejected during generation.
- Disabled providers reject generation for all of their models.
- A task is created with `GenerationTask.cost`.
- The API deducts credits after task creation and writes a `CreditLog` with `type=consume`.
- If balance is not enough, the API returns `余额不足，请充值后再生成。`.
- If provider task creation fails after deduction, the task is marked `failed` and the API automatically writes a `refund` credit log.
- If task polling later discovers provider failure, the API refunds once and keeps task ownership checks.

To test insufficient balance, register or login as a user with `balance=0`, then submit a video generation request. To test deduction, grant credits with `dev:grant-credits`, submit a generation, then call `/api/user/balance` and `/api/user/credit-logs`. To test provider creation failure refund, temporarily run without a valid provider key or use an invalid provider configuration in local `.env`, submit a generation, and confirm a consume log followed by a refund log.

## Admin Console

Stage 9 adds local administrator APIs and a lightweight frontend admin area. Administrator access is controlled by the logged-in user's `role=admin`; the frontend only hides or shows the entry, while the backend enforces authorization.

Make a test admin:

```powershell
cd apps\api
npm run dev:make-admin -- --email test@example.com
```

Call admin APIs with an admin token:

```text
Authorization: Bearer ADMIN_TOKEN
```

Useful admin endpoints:

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
POST http://127.0.0.1:8788/api/admin/models
PATCH http://127.0.0.1:8788/api/admin/models/{modelId}
DELETE http://127.0.0.1:8788/api/admin/models/{modelId}
GET  http://127.0.0.1:8788/api/admin/providers
POST http://127.0.0.1:8788/api/admin/providers
PATCH http://127.0.0.1:8788/api/admin/providers/{providerId}
DELETE http://127.0.0.1:8788/api/admin/providers/{providerId}
```

Adjust a user's balance:

```text
POST http://127.0.0.1:8788/api/admin/users/{userId}/adjust-balance
Authorization: Bearer ADMIN_TOKEN
Content-Type: application/json

{"amount":50,"remark":"local test adjustment"}
```

Positive amounts add credits and negative amounts deduct credits. The API refuses adjustments that would make the user's balance negative. Successful adjustments write `CreditLog.type=admin_adjust` and an `AdminLog` record.

The admin order, task, credit-log, and admin-log endpoints are read-only table views for local operations. `GET /api/admin/models` returns all database models, including disabled models. Model admin APIs support create, update, and delete; negative prices and config JSON that looks like a real secret are rejected, and every successful create/update/delete writes an `AdminLog`.

Supplier management:

```text
GET http://127.0.0.1:8788/api/admin/providers
POST http://127.0.0.1:8788/api/admin/providers
PATCH http://127.0.0.1:8788/api/admin/providers/{providerId}
DELETE http://127.0.0.1:8788/api/admin/providers/{providerId}
Authorization: Bearer ADMIN_TOKEN
Content-Type: application/json

{"displayName":"Volcengine Ark","enabled":true,"baseUrl":"https://ark.cn-beijing.volces.com/api/v3","apiKeyEnvName":"VOLCENGINE_ARK_API_KEY"}
```

The provider API may update `displayName`, `enabled`, `baseUrl`, and `apiKeyEnvName`. `apiKeyEnvName` must be an environment variable name, not a real key. Inputs that look like `sk-`, `ark-`, `Bearer ...`, or other key-shaped secrets are rejected. The backend reads the actual key only from `.env`:

```text
VOLCENGINE_ARK_API_KEY=your_real_key_here
AGNES_API_KEY=your_agnes_key_here
```

Do not enter real supplier API keys in the admin page, config JSON, README, or database. `GET /api/admin/models`, `GET /api/admin/providers`, and public model/provider APIs do not return real API keys or `JWT_SECRET`. Public `/api/models` only returns enabled models and public `/api/providers` does not return `baseUrl` or `apiKeyEnvName`.

Disabled users cannot log in. If a user is disabled after already logging in, active-user APIs such as video generation, recharge packages, order creation, order payment, balance, and credit-log queries return `403`.

Frontend admin access:

1. Start the PowerShell frontend and the Node API.
2. Open `http://127.0.0.1:8787`.
3. Switch the sidebar backend mode to `Node API`.
4. Login as a user promoted with `npm run dev:make-admin -- --email test@example.com`.
5. The `管理后台` tab appears only for `role=admin` users.

The admin page can view users, orders, generation tasks, credit logs, admin logs, model metadata, and supplier metadata. It can adjust user balance, disable or enable users, update model display names/prices/status/sort order, and update provider display names/status/base URL/environment variable name.

The Volcengine provider adapter calls Ark native endpoints:

```text
POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
GET  https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{provider_task_id}
```

## Chat And Homework

The existing OpenAI-compatible relay remains available:

```text
POST http://127.0.0.1:8787/v1/chat/completions
```

Chat and homework calls no longer accept API keys from the browser. If the selected provider is not configured in `.env`, the frontend will show a provider-not-configured error.

The Node API now exposes a compatibility route:

```text
POST http://127.0.0.1:8788/api/chat/completions
```

This route does not accept API keys from the browser. It only reads provider keys from environment variables. In the current migration stage, no Node chat provider adapter is wired yet; if no chat model/provider/key is configured, Node returns:

```text
Node API currently has no chat model configured. Contact the administrator or switch back to PowerShell API.
```

Video generation, model loading, video provider loading, and task records are available in Node API mode. PowerShell remains the local backup for the existing chat relay.

## Current Limits

- Stage 11 adds environment validation, security headers, configurable CORS, rate limiting, unified error responses, enhanced health checks, Docker files, and SQLite backups.
- Balance checks, generation deduction, development grants, and automatic generation refunds are implemented in the Node API.
- Mock recharge orders are implemented for local development only.
- Admin APIs, admin logs, and the lightweight frontend admin area are implemented for local development.
- Model and provider management are database-backed after running `npm run dev:sync-models`; JSON config remains seed and fallback.
- No real payment, payment callback, WeChat Pay, or Alipay integration.
- Docker and deployment notes are available, but this is not a fully production-ready deployment.
- No object storage integration yet.
- No additional real model provider adapters beyond the current local Volcengine video adapter path.
- Before public launch, real payment, content safety, abuse controls, privacy/compliance review, HTTPS, reverse proxy hardening, and database migration planning still need to be completed.
- Node chat has a safe compatibility route, but no chat provider adapter is wired yet.
- Node API generation tasks are stored in local SQLite through Prisma.
- User registration/login uses JWT and local SQLite only.

## C-1 local uploaded assets

C-1 adds a local development asset upload chain for AI video creation:

- `POST /api/assets/upload` accepts authenticated `multipart/form-data` uploads with field name `file`.
- Supported image inputs are JPG, PNG, and WEBP. Supported video inputs are MP4, MOV, and WEBM.
- `/create` uploads first-frame, last-frame, and reference-video files to the Node API before creating a generation task.
- Uploaded file metadata is stored in `UploadedAsset`; generation task `paramsJson` stores `inputType`, `imageMode`, asset ids, local asset URLs, and provider preparation fields.
- Uploaded files are saved under `apps/api/uploads/`, which is ignored by Git.
- `GET /api/assets/:assetId` returns metadata for the current user's own asset. Admin users may read all asset metadata.

This is local storage only. The returned `/uploads/...` URL is suitable for local preview and demos, but it is not guaranteed to be reachable by Volcengine or any external provider. Production should replace this with object storage or a public file/CDN service, and final provider image/video parameter names must be aligned with the official provider API.

For C-2 public asset access testing, expose the local Node API port, usually `8788`, through a public tunnel or temporary public file service, then set:

```text
PUBLIC_ASSET_BASE_URL=https://your-public-tunnel.example
```

When this value is configured, uploaded asset metadata returns `url` as `PUBLIC_ASSET_BASE_URL + /uploads/...`, and provider payloads use that public URL. If the URL is still `localhost`, `127.0.0.1`, or a private network address, the Volcengine provider rejects video reference generation with a clear error instead of pretending the external provider can fetch the file.

Temporary tunnel testing options:

### Option A: ngrok

Start the Node API:

```powershell
cd apps/api
npm.cmd run dev
```

In another terminal, expose port `8788`:

```powershell
ngrok http 8788
```

Copy the generated public URL, for example:

```text
https://xxxx.ngrok-free.app
```

Set it in `apps/api/.env`:

```text
PUBLIC_ASSET_BASE_URL=https://xxxx.ngrok-free.app
```

Restart the Node API:

```powershell
npm.cmd run dev
```

After uploading a video in `/create`, `asset.url` should look like:

```text
https://xxxx.ngrok-free.app/uploads/xxx.mp4
```

This URL must open or download directly in a browser before Volcengine can read it.

### Option B: cloudflared tunnel

Start the Node API:

```powershell
cd apps/api
npm.cmd run dev
```

In another terminal, expose the local API:

```powershell
cloudflared tunnel --url http://127.0.0.1:8788
```

Copy the generated public URL, for example:

```text
https://xxxx.trycloudflare.com
```

Set it in `apps/api/.env`:

```text
PUBLIC_ASSET_BASE_URL=https://xxxx.trycloudflare.com
```

Restart the Node API.

### C-2 acceptance checklist

1. Start `apps/api`.
2. Start the public tunnel.
3. Set `PUBLIC_ASSET_BASE_URL` in `apps/api/.env`.
4. Restart `apps/api`.
5. Upload a video in `/create`.
6. Confirm `asset.url` starts with the tunnel URL.
7. Paste `asset.url` into a browser and confirm the video opens or downloads.
8. Submit video reference generation.
9. Confirm provider logs show a public `referenceVideoUrl`.
10. If Volcengine returns `resultUrl`, `/create` should play it in the left preview.
11. If it fails, keep the real Volcengine error for debugging.

ngrok and cloudflared URLs are temporary and may change each restart. Update `PUBLIC_ASSET_BASE_URL` whenever the tunnel URL changes. Production should use object storage or a stable public domain, not a temporary tunnel.
- The old PowerShell task JSON file is retained at `data/generation-tasks.json`.
- To clear local task records, stop the server and replace `data/generation-tasks.json` with `[]`.
- The local SQLite database is only for development and is not a production database.
- This is not production-ready.
- Later stages should add real payment, payment callbacks, WeChat/Alipay, object storage, production deployment, model online editing, and migrate tasks to PostgreSQL or MySQL through a formal API/database/worker architecture.
## Seedance Parameterized Billing

Aivio now uses Seedance parameterized video billing instead of the old fixed model `price` for video generation. The frontend estimates points through `POST /api/video/estimate-cost`, and the backend uses the same pricing service when creating generation tasks.

Supported controls:
- generation mode: text/image to video, or video reference generation
- output duration: 4 to 15 seconds
- input video duration: 2 to 15 seconds when video input is enabled, with billing minimum of 4 seconds
- resolution: 480p, 720p, 1080p
- Seedance 2.0 Fast does not support 1080p
- Seedance 1.5 Pro distinguishes audio and silent video
- count: 1 to 4

Seedance pricing rules are stored in the database and can be synced with:

```powershell
cd apps/api
npm.cmd run dev:sync-seedance-pricing
```

The public frontend only shows estimated point consumption. It must not show Volcengine cost, margin, real API keys, or `JWT_SECRET`. The platform point price is based on estimated Volcengine cost plus 80 percent, with 1 RMB = 10 points. Real production payment and production payment callbacks are still not implemented.
