# Deployment Guide

This project is still a local-first multi-model AI creation platform. Stage 11 prepares the Node API for deployment, but it does not add real payment, object storage, or production compliance controls.

## Local Development

Start the legacy PowerShell frontend:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -PreferredPort 8787
```

Start the Node API:

```powershell
cd apps\api
npm install
npm run db:generate
npm run db:push
npm run dev:sync-models
npm run dev
```

If PowerShell blocks `npm.ps1`, use `npm.cmd`.

If the default npm registry is unavailable in a restricted network, switch to a mirror before installing:

```powershell
cd apps\api
npm config set registry https://registry.npmmirror.com
npm.cmd install
```

`helmet` and `express-rate-limit` are production dependencies. The API logs `Loaded helmet security middleware.` and `Loaded express-rate-limit middleware.` when the real packages are available; otherwise it logs that the local fallback limiter/header middleware is being used.

## Environment Variables

Local development uses `apps/api/.env`. Production should use server environment variables or an uncommitted `apps/api/.env.production`.

Required variables:

```text
NODE_ENV=production
PORT=8788
DATABASE_URL="file:./dev.db"
JWT_SECRET=replace_with_a_long_random_secret
VOLCENGINE_ARK_API_KEY=replace_with_volcengine_key
CORS_ORIGIN=https://your-domain.example
```

Never commit real `.env`, API keys, JWT secrets, database passwords, or payment secrets. Provider keys must stay in environment variables; the admin panel stores only names such as `VOLCENGINE_ARK_API_KEY`.

## Production Build

```powershell
cd apps\api
npm install
npm run db:generate
npm run build
npm run start
```

Initialize or update the database before first start:

```powershell
npm run db:push
npm run dev:sync-models
```

Create the first administrator after registering a user:

```powershell
npm run dev:make-admin -- --email admin@example.com
```

Keep only one administrator account and remove all other user accounts:

```powershell
cd apps\api
npm run ops:keep-only-user -- --email ceshi@qq.com
```

The script keeps the target user, sets it to `role=admin` and `status=active`, deletes other user accounts, removes their orders and uploaded asset rows, and detaches their generation tasks and credit logs from deleted users. It does not print secrets.

## Railway API Deployment

Create the Railway service from `apps/api` or set the API service root directory to `apps/api`.

Use these commands:

```text
Build command: npm run build
Start command: npm run railway:start
```

Configure these Railway Variables for the API service:

```text
NODE_ENV=production
DATABASE_URL=file:./dev.db
JWT_SECRET=replace_with_a_long_random_secret
VOLCENGINE_ARK_API_KEY=replace_with_volcengine_key
CORS_ORIGIN=https://your-frontend-domain.example
```

Railway provides `PORT` automatically. If you set it manually, keep it as a positive integer. Do not put real `JWT_SECRET`, `VOLCENGINE_ARK_API_KEY`, Bearer tokens, or other provider keys in GitHub, README files, frontend env files, or admin model config JSON.

`npm run railway:start` runs Prisma generation, pushes the SQLite schema, syncs the model config, then starts `node dist/index.js`. If the service crashes during startup, check the deploy log for `Node API startup validation failed`; the log includes the missing variable name without printing secret values.

SQLite on Railway is suitable only for smoke tests and early demos. A redeploy, restart, or filesystem reset can lose local SQLite data unless persistent storage is configured. For formal multi-user production, migrate to PostgreSQL or another managed persistent database.

## Docker

Build and run:

```powershell
docker compose up --build
```

The compose file mounts `apps/api/prisma` so the SQLite database survives container recreation. It does not bake `.env` into the image. Create `apps/api/.env.production` from `apps/api/.env.production.example` before running compose.

## Health Check

```text
GET http://127.0.0.1:8788/api/health
```

The response includes `status`, `time`, `version`, `environment`, `database`, `modelsCount`, and `providersCount`. It does not return secrets.

## Frontend API Address

Local Node API:

```text
http://127.0.0.1:8788/api
```

Production should point the frontend to:

```text
https://your-domain.example/api
```

Do not configure supplier API keys in the frontend.

## Cloudflare Pages Frontend Deployment

Cloudflare Pages can build the frontend from the repository root.

Use these settings:

```text
Build command: npm run build
Build output directory: dist
```

The root build script installs through the npm workspace, builds `apps/web`, then copies `apps/web/dist` to the repository root `dist` directory for Cloudflare Pages.

If the Cloudflare Pages project is already configured with the build root directory `frontend`, keep that setting and use:

```text
Build command: npm run build
Build output directory: dist
```

The `frontend` compatibility package installs and builds the real frontend in `apps/web`, then copies the output into `frontend/dist`.

Configure this Cloudflare Pages environment variable:

```text
VITE_API_BASE_URL=https://aivio-production.up.railway.app/api
```

The variable name must be `VITE_API_BASE_URL`, with the underscore before `URL`. Include the `/api` suffix. The browser will call the Railway API directly, so configure the Railway `CORS_ORIGIN` variable to include the Cloudflare Pages frontend origin. Do not put backend secrets, supplier API keys, `JWT_SECRET`, or Bearer tokens in Cloudflare Pages variables.

## Reverse Proxy

Put a reverse proxy such as Nginx, Caddy, or a cloud load balancer in front of the Node API. A typical layout is:

```text
https://your-domain.example/      -> static frontend
https://your-domain.example/api/  -> Node API on 127.0.0.1:8788
```

Forward standard headers such as `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`. Configure `CORS_ORIGIN` to the final HTTPS origin.

## HTTPS

Terminate HTTPS at the reverse proxy or platform load balancer. Use a managed certificate or Let's Encrypt. Do not expose production login, recharge, admin, or generation APIs over plain HTTP.

## SQLite Backup

```powershell
cd apps\api
npm run db:backup
```

Backups are written to `apps/api/backups` and ignored by git. SQLite is suitable for local development and small testing only. For formal multi-user production, migrate to PostgreSQL or another managed database with regular backups.

## Current Limits

- Real payment is not implemented.
- WeChat Pay and Alipay are not implemented.
- Production object storage is not implemented.
- More real model provider adapters are not implemented.
- Formal content safety, moderation, abuse monitoring, filing/ICP, privacy, and compliance checks must be completed before public launch.
