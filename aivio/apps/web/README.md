# Aivio Web

Vite + React + TypeScript frontend for Aivio.

## Environment

Copy `.env.example` to `.env` when you need to override the API URL:

```powershell
Copy-Item .env.example .env
```

Default API base:

```text
VITE_API_BASE_URL=http://127.0.0.1:8788/api
```

Do not put supplier API keys, payment keys, or backend JWT signing secrets in frontend env files.

## Start Node API

```powershell
cd apps\api
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:push
npm.cmd run dev
```

## Start Web

```powershell
cd apps\web
npm.cmd install
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Login And Register

The web app calls:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET /api/auth/me
```

Login stores the returned JWT in browser `localStorage`. Refreshing the page restores the session through `/api/auth/me`.

To promote a user to admin:

```powershell
cd apps\api
npm.cmd run dev:make-admin -- --email test@example.com
```

The frontend shows the management entry only when the real logged-in user has `role=admin`.

## Balance And Credit Logs

Stage B-2 connects the web app to:

```text
GET /api/user/balance
GET /api/user/credit-logs
```

After login and page refresh, the sidebar balance card and profile credit log table read from the Node API. To grant credits to a test user:

```powershell
cd apps\api
npm.cmd run dev:grant-credits -- --email test@example.com --amount 100
```

Refresh the web app after granting credits to see the updated balance and credit log.

## Models, Generation, And Tasks

Stage B-3 connects:

```text
GET /api/models
POST /api/video/generations
GET /api/video/tasks
GET /api/video/tasks/:taskId
```

The create page loads enabled video models from the Node API and shows each model price. Submitting a prompt creates a generation task and refreshes the user balance. The tasks page lists real generation tasks and supports manual status refresh.

To test insufficient balance, register or log in as a user with `0` credits and submit a generation. The UI should show:

```text
余额不足，请充值后再生成。
```

To test a successful task submission, grant credits first:

```powershell
cd apps\api
npm.cmd run dev:grant-credits -- --email test@example.com --amount 100
```

Then open `/create`, select a model, enter a prompt, and submit. Open `/tasks` to view task status, cost, result link, and errors.

## Mock Recharge And Orders

Stage B-4 connects:

```text
GET /api/recharge/packages
POST /api/orders
GET /api/orders
GET /api/orders/:orderId
POST /api/orders/:orderId/mock-pay
```

Open `/recharge` after logging in. Select a package, create an order, then click `模拟支付成功`. The app refreshes balance and credit logs after mock payment.

This is local Mock payment only. It does not connect real payment, WeChat Pay, or Alipay, and it does not create any real charge.

## Admin Real Data

Stage B-5 connects `/admin` to the real Node API admin endpoints. Log in first, then promote the test user:

```powershell
cd apps\api
npm.cmd run dev:make-admin -- --email test@example.com
```

After logging in as that user, open:

```text
http://127.0.0.1:5173/admin
```

Normal logged-in users see `无权限访问`. Admin users can view platform stats and manage users, balances, orders, generation tasks, credit logs, models, providers, and admin logs.

The admin area is localized for Chinese operations. Model management supports create, edit, delete, enable, and disable. Provider management supports create, edit, delete, enable, and disable. When creating models or providers, do not enter real supplier API keys in the page or in config JSON. Provider editing only stores an environment variable name such as `VOLCENGINE_ARK_API_KEY`; the real API key belongs only in `apps/api/.env`.

To initialize or refresh database models and providers from the repository config files:

```powershell
cd apps\api
npm.cmd run dev:sync-models
```

B-5 still does not connect real payment, production payment callbacks, WeChat Pay, or Alipay.
# Seedance Parameterized Billing

The web app now supports Seedance parameterized point estimation on `/create`.

- generation modes: text/image to video and video reference generation
- output duration: 4 to 15 seconds
- input video duration: 2 to 15 seconds for video reference generation
- resolutions: 480p, 720p, 1080p
- Seedance 2.0 Fast disables 1080p
- Seedance 1.5 Pro shows audio/silent selection
- other models do not show audio controls when they are not applicable

The page calls `POST /api/video/estimate-cost` whenever pricing parameters change and only displays estimated points to users. It does not display Volcengine cost, margin, real API keys, or `JWT_SECRET`.

Admins can manage model pricing rules in `/admin` under model management. Sync backend Seedance rules with:

```powershell
cd apps/api
npm.cmd run dev:sync-seedance-pricing
```

## Local asset upload in `/create`

The `/create` page now uploads selected media to the Node API before submitting a generation task:

- Text-to-video does not require an asset.
- Image-to-video supports first-frame and first/last-frame uploads.
- Video reference generation uploads a reference video and uses the returned duration when available.
- Uploads use `POST /api/assets/upload` with `multipart/form-data` field name `file`.
- The backend stores files in `apps/api/uploads/` and returns safe metadata: `assetId`, `/uploads/...` URL, mime type, size, dimensions, and duration.
- Generation requests include `firstFrameAssetId`, `lastFrameAssetId`, or `referenceVideoAssetId` as appropriate.

This is local development storage only. Local `/uploads/...` URLs are useful for previewing in the web app, but production provider calls should use object storage or another public file service. Final provider payload field names still need to be matched to the official Volcengine API.

For C-2 public asset access testing, expose the Node API port through a public tunnel and set `PUBLIC_ASSET_BASE_URL=https://your-public-tunnel.example` in the API environment. Uploaded assets then return public URLs, and video reference generation passes that public URL to the provider. If the URL is still local or private, the provider blocks the call with a clear error.

Temporary tunnel test flow:

### Option A: ngrok

Start the backend:

```powershell
cd apps/api
npm.cmd run dev
```

In another terminal:

```powershell
ngrok http 8788
```

Copy the generated URL, for example `https://xxxx.ngrok-free.app`, then set it in `apps/api/.env`:

```text
PUBLIC_ASSET_BASE_URL=https://xxxx.ngrok-free.app
```

Restart `apps/api`. After uploading a reference video in `/create`, the returned `asset.url` should look like:

```text
https://xxxx.ngrok-free.app/uploads/xxx.mp4
```

Open this URL in a browser first. Volcengine can only read it if the browser can reach it without local-only access.

### Option B: cloudflared

Start the backend:

```powershell
cd apps/api
npm.cmd run dev
```

In another terminal:

```powershell
cloudflared tunnel --url http://127.0.0.1:8788
```

Copy the generated URL, for example `https://xxxx.trycloudflare.com`, then set it in `apps/api/.env`:

```text
PUBLIC_ASSET_BASE_URL=https://xxxx.trycloudflare.com
```

Restart `apps/api`.

Acceptance steps:

1. Start `apps/api`.
2. Start ngrok or cloudflared.
3. Set `PUBLIC_ASSET_BASE_URL`.
4. Restart `apps/api`.
5. Upload a video in `/create`.
6. Confirm `asset.url` is the public tunnel URL plus `/uploads/xxx.mp4`.
7. Open `asset.url` in a browser and confirm it loads.
8. Submit video reference generation.
9. Provider logs should show the public `referenceVideoUrl`.
10. If Volcengine returns `resultUrl`, `/create` should play it in the left preview.
11. If it fails, record the exact Volcengine error.

Tunnel URLs are temporary and can change after every restart. Update `PUBLIC_ASSET_BASE_URL` whenever the tunnel URL changes. Production should use object storage or a stable public domain instead of ngrok or cloudflared.

Real payment, WeChat Pay, Alipay, and production payment callbacks are still not implemented.
