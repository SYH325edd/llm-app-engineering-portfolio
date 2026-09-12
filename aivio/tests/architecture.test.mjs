import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const exists = (p) => fs.existsSync(path.join(root, p));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("application composition is separated from compatibility entry points", () => {
  assert.equal(exists("apps/web/src/app/App.tsx"), true, "web app composition must live under src/app");
  assert.equal(exists("apps/api/src/app/create-app.ts"), true, "API composition must live under src/app");
  assert.equal(exists("apps/api/src/server.ts"), true, "API listener must live in server.ts");

  const webCompat = read("apps/web/src/App.tsx");
  assert.match(webCompat, /export \{ default \} from ["']\.\/app\/App["'];?/, "web root App.tsx must be a thin compatibility export");
  assert.ok(webCompat.split(/\r?\n/).filter(Boolean).length <= 3, "web compatibility App.tsx must remain thin");

  const apiEntry = read("apps/api/src/index.ts");
  assert.match(apiEntry, /startServer/, "API entry must delegate startup to startServer");
  assert.doesNotMatch(apiEntry, /express\(/, "API entry must not compose Express directly");
  assert.doesNotMatch(apiEntry, /app\.use\(/, "API entry must not mount routes directly");

  const createApp = read("apps/api/src/app/create-app.ts");
  assert.match(createApp, /export async function createApp\(/, "create-app must export createApp");
  assert.doesNotMatch(createApp, /\.listen\(/, "createApp must not listen on a port");

  const server = read("apps/api/src/server.ts");
  assert.match(server, /export async function startServer\(/, "server.ts must export startServer");
  assert.match(server, /\.listen\(/, "server.ts owns listening");
});


test("frontend pages and API client have a single canonical ownership path", () => {
  const featurePages = [
    "apps/web/src/features/auth/pages/LoginPage.tsx",
    "apps/web/src/features/auth/pages/RegisterPage.tsx",
    "apps/web/src/features/dashboard/pages/DashboardPage.tsx",
    "apps/web/src/features/generation/pages/CreatePage.tsx",
    "apps/web/src/features/tasks/pages/TasksPage.tsx",
    "apps/web/src/features/templates/pages/TemplateCenterPage.tsx",
    "apps/web/src/features/billing/pages/RechargePage.tsx",
    "apps/web/src/features/profile/pages/ProfilePage.tsx",
    "apps/web/src/features/admin/pages/AdminDashboardPage.tsx",
    "apps/web/src/features/admin/pages/AdminGiftCardsPage.tsx",
    "apps/web/src/features/admin/pages/NoPermissionPage.tsx"
  ];

  for (const featurePath of featurePages) {
    assert.equal(exists(featurePath), true, `missing feature page ${featurePath}`);
  }
  assert.equal(exists("apps/web/src/pages"), false, "legacy pages directory must be removed after feature migration");
  assert.equal(exists("apps/web/src/shared/api/client.ts"), true, "shared API client must live under shared/api");
  assert.equal(exists("apps/web/src/lib/api.ts"), false, "legacy API compatibility export must be removed");

  const app = read("apps/web/src/app/App.tsx");
  assert.match(app, /features\/generation\/pages\/CreatePage/, "app routes must import generation page from feature ownership");
  assert.doesNotMatch(app, /\.\.\/pages\//, "app routes must not depend on a legacy page directory");

  const authContext = read("apps/web/src/context/AuthContext.tsx");
  assert.match(authContext, /shared\/api\/client/, "cross-feature consumers must use the canonical shared API client");
});

test("backend composition depends on business module entry points", () => {
  const modules = ["health", "auth", "users", "billing", "admin", "models", "assets", "prompt", "invite", "generation", "chat"];
  for (const name of modules) {
    assert.equal(exists(`apps/api/src/modules/${name}/index.ts`), true, `missing backend module entry point: ${name}`);
  }

  const createApp = read("apps/api/src/app/create-app.ts");
  assert.match(createApp, /\.\.\/modules\/auth\/index\.js/, "app composition must use auth module entry point");
  assert.match(createApp, /\.\.\/modules\/generation\/index\.js/, "app composition must use generation module entry point");
  assert.doesNotMatch(createApp, /\.\.\/routes\//, "app composition must not import route files directly");
});


test("oversized commercial pages delegate state, utilities, and presentation", () => {
  const required = [
    "apps/web/src/features/generation/create/create-state.ts",
    "apps/web/src/features/generation/create/create-utils.ts",
    "apps/web/src/features/admin/admin-utils.ts",
    "apps/web/src/features/admin/components/AdminModules.tsx"
  ];
  for (const file of required) assert.equal(exists(file), true, `missing extracted responsibility: ${file}`);

  const createPageLines = read("apps/web/src/features/generation/pages/CreatePage.tsx").split(/\r?\n/).length;
  const adminPageLines = read("apps/web/src/features/admin/pages/AdminDashboardPage.tsx").split(/\r?\n/).length;
  assert.ok(createPageLines <= 1350, `CreatePage remains oversized (${createPageLines} lines)`);
  assert.ok(adminPageLines <= 700, `AdminDashboardPage remains oversized (${adminPageLines} lines)`);

  const adminPage = read("apps/web/src/features/admin/pages/AdminDashboardPage.tsx");
  assert.match(adminPage, /from ["']\.\.\/components\/AdminModules["']/, "admin page must delegate presentation modules");
  assert.doesNotMatch(adminPage, /function AdminTable\(/, "admin page must not embed generic table presentation");
});


test("workspace owns web, API, and shared cross-boundary contracts", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.deepEqual(new Set(packageJson.workspaces), new Set(["apps/web", "apps/api", "packages/contracts"]));
  assert.equal(exists("packages/contracts/package.json"), true, "contracts package is required");
  assert.equal(exists("packages/contracts/src/index.ts"), true, "contracts package must expose typed contracts");

  const webHealth = read("apps/web/src/features/admin/health-api.ts");
  const apiHealth = read("apps/api/src/modules/health/routes.ts");
  assert.match(webHealth, /@aivio\/contracts/, "web health client must use shared contract");
  assert.match(apiHealth, /@aivio\/contracts/, "API health route must use shared contract");
  assert.match(read("apps/web/src/features/admin/components/AdminModules.tsx"), /systemHealth\.timestamp/, "admin UI must consume the backend timestamp contract");
});

test("local runtime is managed from the root workspace", () => {
  const packageJson = JSON.parse(read("package.json"));
  const scripts = packageJson.scripts || {};
  assert.match(scripts["web:dev"] || "", /--workspace apps\/web run dev/, "root must expose web:dev through the workspace");
  assert.match(scripts["api:dev"] || "", /--workspace apps\/api run dev/, "root must expose api:dev through the workspace");
  assert.match(scripts["db:generate"] || "", /--workspace apps\/api run db:generate/, "root must own Prisma generation");
  assert.match(scripts["db:push"] || "", /--workspace apps\/api run db:push/, "root must own Prisma schema sync");
  assert.match(scripts["models:sync"] || "", /--workspace apps\/api run dev:sync-models/, "root must own local model synchronization");
  assert.match(scripts["api:typecheck"] || "", /--workspace apps\/api run typecheck/, "API typecheck must use workspace execution");
  assert.match(scripts["api:build"] || "", /--workspace apps\/api run build/, "API build must use workspace execution");

  const startLocal = read("start-local.ps1");
  assert.match(startLocal, /npm\.cmd install/, "local start must install from the root workspace");
  assert.match(startLocal, /node_modules\\react\\package\.json/, "local start must verify a web dependency marker");
  assert.match(startLocal, /node_modules\\express\\package\.json/, "local start must verify an API dependency marker");
  assert.match(startLocal, /npm\.cmd run contracts:build/, "local start must build shared contracts before app startup");
  assert.doesNotMatch(startLocal, /--prefix/, "local start must not maintain a second dependency installation path");
  assert.match(startLocal, /npm\.cmd run db:generate/, "local start must prepare Prisma through root scripts");
  assert.match(startLocal, /npm\.cmd run api:dev/, "local start must launch the API through root scripts");
  assert.match(startLocal, /npm\.cmd run web:dev/, "local start must launch the web app through root scripts");
});

test("asset storage is local-first and object storage is optional", () => {
  const assetService = read("apps/api/src/modules/assets/service.ts");
  assert.match(assetService, /const r2Config = getR2Config\(\)/, "asset service may detect optional R2 configuration");
  assert.match(assetService, /input\.type === "image" && r2Config/, "R2 upload must only run when image storage is explicitly configured");
  assert.match(assetService, /fs\.writeFile\(absolutePath, input\.buffer/, "assets must have a local filesystem fallback");
  assert.doesNotMatch(assetService, /const r2Config = ensureR2Config\(\)/, "image upload must not require R2 in local mode");
});

test("backend business implementations are owned by modules, not global route/service piles", () => {
  const required = [
    "apps/api/src/modules/auth/routes.ts",
    "apps/api/src/modules/auth/service.ts",
    "apps/api/src/modules/admin/routes.ts",
    "apps/api/src/modules/admin/service.ts",
    "apps/api/src/modules/assets/routes.ts",
    "apps/api/src/modules/assets/service.ts",
    "apps/api/src/modules/billing/order.routes.ts",
    "apps/api/src/modules/billing/billing.service.ts",
    "apps/api/src/modules/generation/routes.ts",
    "apps/api/src/modules/generation/service.ts",
    "apps/api/src/modules/models/routes.ts",
    "apps/api/src/modules/models/model-registry.service.ts",
    "apps/api/src/modules/prompt/routes.ts",
    "apps/api/src/modules/prompt/service.ts",
    "apps/api/src/infrastructure/database/prisma.ts",
    "apps/api/src/infrastructure/email/service.ts"
  ];
  for (const file of required) assert.equal(exists(file), true, `missing owned backend implementation: ${file}`);
  assert.equal(exists("apps/api/src/routes"), false, "global routes directory must be removed after module migration");
  assert.equal(exists("apps/api/src/services"), false, "global services directory must be removed after module migration");
});

test("local runtime health metadata is provider-neutral", () => {
  const health = read("apps/api/src/modules/health/routes.ts");
  assert.doesNotMatch(health, /RAILWAY_/, "local health metadata must not depend on Railway deployment variables");
  assert.match(health, /GIT_COMMIT_SHA/, "generic Git commit metadata may still be used when available");
});

test("product-owned static content is not kept under a mock namespace", () => {
  assert.equal(exists("apps/web/src/mock"), false, "production feature content must not live under src/mock");
  assert.equal(exists("apps/web/src/features/generation/data/inspirations.ts"), true, "generation inspirations belong to generation");
  assert.equal(exists("apps/web/src/features/templates/data/templates.ts"), true, "template catalog belongs to templates feature");
});

test("frontend API wrappers follow feature ownership instead of a global lib pile", () => {
  const owned = [
    "apps/web/src/features/admin/api.ts",
    "apps/web/src/features/admin/health-api.ts",
    "apps/web/src/features/auth/api.ts",
    "apps/web/src/features/billing/api.ts",
    "apps/web/src/features/profile/api.ts",
    "apps/web/src/features/generation/api/assets.ts",
    "apps/web/src/features/generation/api/prompt.ts",
    "apps/web/src/shared/api/invite.ts",
    "apps/web/src/shared/api/video.ts"
  ];
  for (const file of owned) assert.equal(exists(file), true, `missing owned frontend API wrapper: ${file}`);
  assert.equal(exists("apps/web/src/lib"), false, "global frontend lib API pile must be removed");
});

test("local launcher remains compatible with Windows PowerShell 5.1", () => {
  const startLocal = read("start-local.ps1");
  assert.doesNotMatch(startLocal, /\[Convert\]::ToHexString/, "launcher must not require modern .NET Convert.ToHexString");
  assert.match(startLocal, /\[System\.BitConverter\]::ToString\(\$bytes\)/, "launcher must use the PowerShell 5.1-compatible BitConverter path");
});


test("Prisma runtime uses the workspace CLI and approved install scripts", () => {
  const packageJson = JSON.parse(read("package.json"));
  const apiPackageJson = JSON.parse(read("apps/api/package.json"));
  const startLocal = read("start-local.ps1");

  assert.match(apiPackageJson.scripts?.["db:generate"] || "", /^prisma generate /, "API must invoke Prisma through the workspace CLI");
  assert.match(apiPackageJson.scripts?.["db:push"] || "", /^prisma db push /, "API must invoke Prisma db push through the workspace CLI");
  assert.equal(exists("apps/api/scripts/run-prisma.mjs"), false, "custom Prisma internal-entry runner must be removed");

  assert.equal(packageJson.allowScripts?.prisma, true, "Prisma install scripts must be explicitly approved");
  assert.equal(packageJson.allowScripts?.["@prisma/client"], true, "Prisma client install scripts must be explicitly approved");
  assert.equal(packageJson.allowScripts?.["@prisma/engines"], true, "Prisma engine install scripts must be explicitly approved");
  assert.equal(packageJson.allowScripts?.esbuild, true, "esbuild install scripts must be explicitly approved");

  assert.match(startLocal, /node_modules\\prisma\\build\\index\.js/, "local startup must treat the hoisted Prisma CLI as a dependency marker");
});
