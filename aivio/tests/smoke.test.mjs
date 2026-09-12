import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test("root package.json exposes unified engineering scripts", () => {
  const packageJson = readJson("package.json");
  const scripts = packageJson.scripts || {};
  const requiredScripts = [
    "typecheck",
    "build",
    "test",
    "verify",
    "check:env",
    "preflight",
    "cleanup:uploads",
    "web:typecheck",
    "web:build",
    "api:typecheck",
    "api:build"
  ];

  for (const scriptName of requiredScripts) {
    assert.equal(typeof scripts[scriptName], "string", `Missing root script: ${scriptName}`);
    assert.notEqual(scripts[scriptName].trim(), "", `Root script is empty: ${scriptName}`);
  }
});

test(".env examples include deployment, auth, and Prisma SQLite hints", () => {
  const envExample = readText(".env.example");
  const apiEnvExample = readText("apps/api/.env.example");

  assert.match(envExample, /^NODE_ENV=/m, ".env.example must include NODE_ENV");
  assert.match(envExample, /^DATABASE_URL=/m, ".env.example must include DATABASE_URL");
  assert.match(envExample, /^JWT_SECRET=/m, ".env.example must include JWT_SECRET");
  assert.match(envExample, /^CORS_ORIGIN=/m, ".env.example must include CORS_ORIGIN");
  assert.match(envExample, /^ENABLE_MOCK_PAYMENT=/m, ".env.example must include ENABLE_MOCK_PAYMENT");
  assert.match(envExample, /^SMTP_HOST=/m, ".env.example must include SMTP_HOST");
  assert.match(envExample, /^SMTP_PORT=/m, ".env.example must include SMTP_PORT");
  assert.match(envExample, /^SMTP_SECURE=/m, ".env.example must include SMTP_SECURE");
  assert.match(envExample, /^SMTP_USER=/m, ".env.example must include SMTP_USER");
  assert.match(envExample, /^SMTP_PASS=/m, ".env.example must include SMTP_PASS");
  assert.match(envExample, /^SMTP_FROM=/m, ".env.example must include SMTP_FROM");
  assert.match(envExample, /^AUTH_REQUIRE_EMAIL_VERIFICATION=/m, ".env.example must include AUTH_REQUIRE_EMAIL_VERIFICATION");
  assert.match(envExample, /^EMAIL_VERIFICATION_CODE_TTL_MINUTES=/m, ".env.example must include EMAIL_VERIFICATION_CODE_TTL_MINUTES");
  assert.match(envExample, /^PUBLIC_ASSET_BASE_URL=/m, ".env.example must include PUBLIC_ASSET_BASE_URL");
  assert.match(envExample, /^AGNES_REQUEST_TIMEOUT_MS=/m, ".env.example must include AGNES_REQUEST_TIMEOUT_MS");
  assert.match(envExample, /^UPLOAD_RETENTION_DAYS=/m, ".env.example must include UPLOAD_RETENTION_DAYS");
  assert.match(envExample, /^DATABASE_URL="file:\.\/dev\.db"$/m, ".env.example must use the stable Prisma SQLite path");
  assert.match(apiEnvExample, /^DATABASE_URL="file:\.\/dev\.db"$/m, "apps/api/.env.example must document the local Prisma SQLite path");
});

test("email verification schema, auth routes, and stable Prisma scripts exist", () => {
  const schema = readText("apps/api/prisma/schema.prisma");
  const authRoutes = readText("apps/api/src/routes/auth.routes.ts");
  const authService = readText("apps/api/src/services/auth.service.ts");
  const emailService = readText("apps/api/src/services/email.service.ts");
  const apiPackageJson = readJson("apps/api/package.json");
  const prismaWrapper = readText("apps/api/scripts/run-prisma.mjs");
  const rootEnvExample = readText(".env.example");
  const apiEnvExample = readText("apps/api/.env.example");

  assert.match(schema, /emailVerificationCodeHash/, "Prisma user model must include emailVerificationCodeHash");
  assert.match(schema, /emailVerificationExpiresAt/, "Prisma user model must include emailVerificationExpiresAt");
  assert.match(schema, /emailVerificationAttempts/, "Prisma user model must include emailVerificationAttempts");
  assert.match(schema, /emailVerifiedAt/, "Prisma user model must include emailVerifiedAt");
  assert.match(authRoutes, /verify-email-code/, "Auth routes must expose verify-email-code");
  assert.match(authRoutes, /resend-email-code/, "Auth routes must expose resend-email-code");
  assert.match(authService, /Email is not verified\./, "Auth service must block login for unverified email");
  assert.match(authService, /Verification code expired or too many attempts/, "Auth service must expose verification expiry error");
  assert.match(authService, /!isProduction\(\)\s*&&\s*delivery\.devVerificationCode/, "Auth service must only expose devVerificationCode outside production");
  assert.match(emailService, /Email service is not configured\./, "Email service must expose the missing SMTP error");
  assert.match(rootEnvExample, /^DATABASE_URL="?file:\.\/dev\.db"?$/m, "Root .env.example must document the stable local SQLite DATABASE_URL");
  assert.match(apiEnvExample, /^DATABASE_URL="?file:\.\/dev\.db"?$/m, "apps/api/.env.example must document the stable local SQLite DATABASE_URL");
  assert.match(
    apiPackageJson.scripts?.["db:generate"] || "",
    /^node scripts\/run-prisma\.mjs generate --schema prisma\/schema\.prisma$/,
    "API db:generate must use the stable Prisma wrapper"
  );
  assert.match(
    apiPackageJson.scripts?.["db:push"] || "",
    /^node scripts\/run-prisma\.mjs db push --schema prisma\/schema\.prisma$/,
    "API db:push must use the stable Prisma wrapper"
  );
  assert.match(prismaWrapper, /resolveSqliteFilePath/, "Prisma wrapper must include stable SQLite path resolution");
  assert.match(prismaWrapper, /ensureLocalSqliteFile/, "Prisma wrapper must ensure the local SQLite file exists");
  assert.match(prismaWrapper, /DATABASE_URL is not configured/, "Prisma wrapper must give a clear DATABASE_URL error");
});

test("backend CORS configuration allows local Vite origins", () => {
  const envConfig = readText("apps/api/src/config/env.ts");

  assert.match(envConfig, /http:\/\/localhost:5173/, "Backend CORS config must include http://localhost:5173");
  assert.match(envConfig, /http:\/\/127\.0\.0\.1:5173/, "Backend CORS config must include http://127.0.0.1:5173");
});

test("mock payment is protected by environment flag and explicit disabled message", () => {
  const envConfig = readText("apps/api/src/config/env.ts");
  const orderService = readText("apps/api/src/services/order.service.ts");

  assert.match(envConfig, /ENABLE_MOCK_PAYMENT|enableMockPayment/, "Mock payment config must reference ENABLE_MOCK_PAYMENT");
  assert.match(orderService, /Mock payment is disabled\./, "Mock payment guard must expose a clear disabled error");
  assert.match(orderService, /isMockPaymentEnabled\(\)/, "Order service must check whether mock payment is enabled");
});

test("health routes are exposed and avoid returning obvious secret-shaped fields", () => {
  const apiEntry = readText("apps/api/src/index.ts");
  const healthRoutes = readText("apps/api/src/routes/health.routes.ts");

  assert.match(healthRoutes, /get\("\/health"/, "Health route file must define GET /health");
  assert.match(apiEntry, /app\.use\("\/", healthRoutes\)|app\.use\("\/api", healthRoutes\)/, "API entry must mount the health routes");
  assert.doesNotMatch(healthRoutes, /\bapiKey\s*:/, "Health response must not expose apiKey fields");
  assert.doesNotMatch(healthRoutes, /\bsecret\s*:/i, "Health response must not expose secret fields");
  assert.doesNotMatch(healthRoutes, /\btoken\s*:/i, "Health response must not expose token fields");
  assert.doesNotMatch(healthRoutes, /\bpassword\s*:/i, "Health response must not expose password fields");
});

test("upload cleanup script and ignore rules protect temporary local storage strategy", () => {
  const packageJson = readJson("package.json");
  const cleanupScript = readText("scripts/cleanup-uploads.mjs");
  const gitignore = readText(".gitignore");
  const readme = readText("README.md");

  assert.equal(typeof packageJson.scripts?.["cleanup:uploads"], "string", "Root package.json must include cleanup:uploads");
  assert.match(cleanupScript, /UPLOAD_RETENTION_DAYS/, "Cleanup script must read UPLOAD_RETENTION_DAYS");
  assert.match(cleanupScript, /retentionDays/, "Cleanup script must report retentionDays");
  assert.match(cleanupScript, /uploads/i, "Cleanup script must target uploads directories");
  assert.match(gitignore, /^uploads\/$/m, ".gitignore must ignore uploads/");
  assert.match(gitignore, /^apps\/api\/uploads\/$/m, ".gitignore must ignore apps/api/uploads/");
  assert.match(gitignore, /^\*\.mp4$/m, ".gitignore must ignore *.mp4");
  assert.match(gitignore, /^\*\.mov$/m, ".gitignore must ignore *.mov");
  assert.match(gitignore, /^\*\.webm$/m, ".gitignore must ignore *.webm");
  assert.match(readme, /Storage Policy/i, "README must include Storage Policy");
  assert.equal(typeof packageJson.scripts?.verify, "string", "Root package.json must keep verify");
});

test("environment preflight script exists and avoids obvious sensitive output patterns", () => {
  const packageJson = readJson("package.json");
  const checkEnvScript = readText("scripts/check-env.mjs");
  const readme = readText("README.md");
  const envExample = readText(".env.example");

  assert.equal(typeof packageJson.scripts?.["check:env"], "string", "Root package.json must include check:env");
  assert.equal(typeof packageJson.scripts?.preflight, "string", "Root package.json must include preflight");
  assert.match(checkEnvScript, /ENABLE_MOCK_PAYMENT/, "check-env must inspect ENABLE_MOCK_PAYMENT");
  assert.match(checkEnvScript, /UPLOAD_RETENTION_DAYS/, "check-env must inspect UPLOAD_RETENTION_DAYS");
  assert.match(checkEnvScript, /PUBLIC_ASSET_BASE_URL/, "check-env must inspect PUBLIC_ASSET_BASE_URL");
  assert.match(checkEnvScript, /AGNES_REQUEST_TIMEOUT_MS/, "check-env must inspect AGNES_REQUEST_TIMEOUT_MS");
  assert.match(checkEnvScript, /NODE_ENV/, "check-env must inspect NODE_ENV");
  assert.match(checkEnvScript, /SMTP_HOST/, "check-env must inspect SMTP_HOST");
  assert.match(checkEnvScript, /SMTP_PORT/, "check-env must inspect SMTP_PORT");
  assert.match(checkEnvScript, /SMTP_SECURE/, "check-env must inspect SMTP_SECURE");
  assert.match(checkEnvScript, /SMTP_USER/, "check-env must inspect SMTP_USER");
  assert.match(checkEnvScript, /SMTP_PASS/, "check-env must inspect SMTP_PASS");
  assert.match(checkEnvScript, /SMTP_FROM/, "check-env must inspect SMTP_FROM");
  assert.match(checkEnvScript, /AUTH_REQUIRE_EMAIL_VERIFICATION/, "check-env must inspect AUTH_REQUIRE_EMAIL_VERIFICATION");
  assert.match(checkEnvScript, /EMAIL_VERIFICATION_CODE_TTL_MINUTES/, "check-env must inspect EMAIL_VERIFICATION_CODE_TTL_MINUTES");
  assert.doesNotMatch(checkEnvScript, /console\.log\s*\(\s*process\.env\s*\)/, "check-env must not print process.env directly");
  assert.doesNotMatch(checkEnvScript, /console\.log\s*\(\s*await\s+fs\.readFile/i, "check-env must not print raw .env file contents");
  assert.match(readme, /Server Deployment Checklist/i, "README must include Server Deployment Checklist");
  assert.match(readme, /Email Code Registration/i, "README must include Email Code Registration");
  assert.match(readme, /apps\/api\/\.env\.example -> apps\/api\/\.env/i, "README must document copying apps/api/.env.example for Prisma commands");
  assert.match(readme, /DATABASE_URL="file:\.\/dev\.db"/, "README must document the API local SQLite DATABASE_URL");
  assert.match(readme, /npm run preflight/, "README must mention npm run preflight");
  assert.match(readme, /GET \/health/, "README must mention GET /health");
  assert.match(readme, /npm run cleanup:uploads/, "README must mention npm run cleanup:uploads");
  assert.match(readme, /Agnes Video Provider Notes/i, "README must include Agnes Video Provider Notes");
  assert.match(envExample, /^NODE_ENV=/m, ".env.example must document NODE_ENV");
  assert.match(envExample, /^UPLOAD_RETENTION_DAYS=/m, ".env.example must document UPLOAD_RETENTION_DAYS");
  assert.match(envExample, /^ENABLE_MOCK_PAYMENT=/m, ".env.example must document ENABLE_MOCK_PAYMENT");
  assert.match(envExample, /^PUBLIC_ASSET_BASE_URL=/m, ".env.example must document PUBLIC_ASSET_BASE_URL");
  assert.match(envExample, /^AGNES_REQUEST_TIMEOUT_MS=/m, ".env.example must document AGNES_REQUEST_TIMEOUT_MS");
});

test("Agnes video guardrails are documented in backend, frontend, and env checks", () => {
  const agnesClient = readText("apps/api/src/providers/agnes/client.ts");
  const generationService = readText("apps/api/src/services/generation.service.ts");
  const agnesVideoProvider = readText("apps/api/src/providers/agnes/video.ts");
  const createPage = readText("apps/web/src/pages/CreatePage.tsx");
  const readme = readText("README.md");
  const checkEnvScript = readText("scripts/check-env.mjs");
  const envExample = readText(".env.example");
  const packageJson = readJson("package.json");
  const backendAgnesGuardSource = `${generationService}\n${agnesVideoProvider}`;

  assert.match(envExample, /^AGNES_REQUEST_TIMEOUT_MS=60000$/m, ".env.example must document the Agnes timeout default");
  assert.match(checkEnvScript, /AGNES_REQUEST_TIMEOUT_MS/, "check-env must validate AGNES_REQUEST_TIMEOUT_MS");
  assert.match(agnesClient, /AbortController/, "Agnes client must use AbortController for timeout handling");
  assert.match(agnesClient, /Agnes request timed out\. Please try again later\./, "Agnes client must expose a clear timeout error");
  assert.match(agnesClient, /Agnes service is busy\. Please try again later\./, "Agnes client must expose a clear 503 error");
  assert.match(backendAgnesGuardSource, /Agnes 当前仅支持文生视频、图生视频和多图关键帧，不支持参考视频输入。/, "Backend must reject Agnes reference video input");
  assert.match(backendAgnesGuardSource, /Agnes 需要公网可访问的图片素材 URL，请配置 PUBLIC_ASSET_BASE_URL 后再生成。/, "Backend must reject non-public Agnes image URLs");
  assert.match(createPage, /Agnes 支持文生视频、图生视频和多图关键帧；不支持参考视频输入。图片素材需配置公网访问地址。/, "Create page must explain Agnes capability limits");
  assert.match(createPage, /Agnes 当前不支持参考视频输入，请切换到文生视频或图生视频。/, "Create page must block Agnes reference video mode with a clear message");
  assert.match(readme, /Agnes Video Provider Notes/i, "README must include Agnes provider notes");
  assert.equal(typeof packageJson.scripts?.preflight, "string", "Root package.json must keep preflight");
});

test("frontend register page includes email verification step", () => {
  const registerPage = readText("apps/web/src/pages/RegisterPage.tsx");
  const loginPage = readText("apps/web/src/pages/LoginPage.tsx");
  const appRoutes = readText("apps/web/src/App.tsx");
  const packageJson = readJson("package.json");

  assert.match(registerPage, /verifyEmailCode|重新发送验证码|devVerificationCode/, "Register page must include the email verification flow");
  assert.match(registerPage, /import\.meta\.env\.DEV/, "Register page must limit dev verification code display to development");
  assert.match(registerPage, /本地调试验证码/, "Register page must label the local code as a debug-only hint");
  assert.match(loginPage, /Email is not verified\.|邮箱尚未验证/, "Login page must surface unverified email errors");
  assert.match(appRoutes, /path="\/"[\s\S]*?<RequireAuth><DashboardPage \/><\/RequireAuth>/, "Dashboard route must require authentication");
  assert.match(appRoutes, /path="\/templates"[\s\S]*?<RequireAuth><TemplateCenterPage \/><\/RequireAuth>/, "Template route must require authentication");
  assert.equal(typeof packageJson.scripts?.preflight, "string", "Root package.json must keep preflight");
});

test("dashboard page does not directly import obvious mock data sources", () => {
  const dashboardPage = readText("apps/web/src/pages/DashboardPage.tsx");

  assert.doesNotMatch(
    dashboardPage,
    /from\s+["']\.\.\/mock\/|from\s+["'][^"']*mock[^"']*["']/,
    "DashboardPage should not directly import mock data modules"
  );
});

test("auth wiring, SMTP docs, and login/register target copy stay aligned", () => {
  const registerPage = readText("apps/web/src/pages/RegisterPage.tsx");
  const loginPage = readText("apps/web/src/pages/LoginPage.tsx");
  const authContext = readText("apps/web/src/context/AuthContext.tsx");
  const authRoutes = readText("apps/api/src/routes/auth.routes.ts");
  const checkEnvScript = readText("scripts/check-env.mjs");
  const readme = readText("README.md");
  const envExample = readText(".env.example");
  const packageJson = readJson("package.json");
  const webFiles = [
    "apps/web/src/pages/LoginPage.tsx",
    "apps/web/src/pages/RegisterPage.tsx",
    "apps/web/src/pages/DashboardPage.tsx",
    "apps/web/src/pages/CreatePage.tsx",
    "apps/web/src/components/Logo.tsx"
  ];
  const webSource = webFiles.map((file) => readText(file)).join("\n");
  const nonAuthWebSource = [
    "apps/web/src/pages/DashboardPage.tsx",
    "apps/web/src/pages/CreatePage.tsx",
    "apps/web/src/components/Logo.tsx"
  ].map((file) => readText(file)).join("\n");

  assert.match(loginPage, /AI驱动的[\s\S]*视频创作平台/, "Login page must include the target hero title");
  assert.match(loginPage, /让想象，成为影像。/, "Login page must include the target hero subtitle");
  assert.match(registerPage, /AI驱动的[\s\S]*视频创作平台/, "Register page must include the target hero title");
  assert.match(registerPage, /让想象，成为影像。/, "Register page must include the target hero subtitle");
  assert.doesNotMatch(nonAuthWebSource, /AI驱动的视频创作平台/, "Non-auth frontend source must not reuse the login/register target title");
  assert.doesNotMatch(nonAuthWebSource, /让想象，成为影像。?/, "Non-auth frontend source must not reuse the login/register target subtitle");
  assert.match(registerPage, /verifyEmailCode/, "Register page must include verifyEmailCode wiring");
  assert.match(registerPage, /resendEmailCode|resend-email-code/, "Register page must include resend email verification wiring");
  assert.match(authContext, /verifyEmailCode/, "AuthContext must expose verifyEmailCode");
  assert.match(authContext, /resendEmailCode/, "AuthContext must expose resendEmailCode");
  assert.match(authContext, /verify-email-code/, "AuthContext must call the verify-email-code API");
  assert.match(authContext, /resend-email-code/, "AuthContext must call the resend-email-code API");
  assert.match(authContext, /\/auth\/register/, "AuthContext must call the register API");
  assert.match(authContext, /\/auth\/login/, "AuthContext must call the login API");
  assert.match(loginPage, /Email is not verified\./, "Login page must translate the unverified email error");
  assert.match(authRoutes, /verify-email-code/, "Backend auth routes must expose verify-email-code");
  assert.match(authRoutes, /resend-email-code/, "Backend auth routes must expose resend-email-code");
  assert.match(checkEnvScript, /SMTP is required in production when AUTH_REQUIRE_EMAIL_VERIFICATION=true\./, "Preflight must fail when production email verification is enabled without SMTP");
  assert.match(readme, /SMTP/i, "README must mention SMTP");
  assert.match(readme, /smtp\.gmail\.com/i, "README must mention smtp.gmail.com");
  assert.match(readme, /not Google OAuth|不是 Google OAuth/i, "README must explain that email delivery is not Google OAuth");
  assert.match(envExample, /^SMTP_HOST=smtp\.gmail\.com$/m, ".env.example must include SMTP_HOST");
  assert.match(envExample, /^SMTP_PORT=587$/m, ".env.example must include SMTP_PORT");
  assert.match(envExample, /^SMTP_SECURE=false$/m, ".env.example must include SMTP_SECURE");
  assert.match(envExample, /^SMTP_USER=/m, ".env.example must include SMTP_USER");
  assert.match(envExample, /^SMTP_PASS=/m, ".env.example must include SMTP_PASS");
  assert.match(envExample, /^SMTP_FROM=/m, ".env.example must include SMTP_FROM");
  assert.equal(typeof packageJson.scripts?.preflight, "string", "Root package.json must keep preflight");
});
