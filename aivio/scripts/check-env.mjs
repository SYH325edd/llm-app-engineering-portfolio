import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const actualEnvFilePaths = [
  path.join(repoRoot, "apps", "api", ".env"),
  path.join(repoRoot, ".env")
];
const exampleEnvFilePath = path.join(repoRoot, ".env.example");

function parseEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }
  return values;
}

async function readEnvFile(filePath) {
  try {
    return parseEnvText(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function normalizeBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return false;
}

function normalizeNodeEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "development";
}

function hasConfiguredValue(value) {
  return Boolean(String(value || "").trim());
}

function isProduction(nodeEnv) {
  return nodeEnv === "production";
}

function looksUnsafeCors(corsOrigin) {
  const trimmed = String(corsOrigin || "").trim();
  if (!trimmed) return true;
  if (trimmed === "*") return true;
  const origins = trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  if (origins.length === 0) return true;
  return origins.every((origin) => /localhost|127\.0\.0\.1/i.test(origin));
}

function resolveUploadRetentionDays(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { valid: false, retentionDays: 7 };
  }
  return { valid: true, retentionDays: parsed };
}

function resolvePositiveMinutes(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { valid: false, minutes: fallback };
  }
  return { valid: true, minutes: parsed };
}

function resolvePositiveMilliseconds(value, fallback) {
  if (value === undefined || String(value).trim() === "") {
    return { configured: false, valid: true, milliseconds: fallback };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { configured: true, valid: false, milliseconds: fallback };
  }
  return { configured: true, valid: true, milliseconds: parsed };
}

function sanitizeCheckState(configured) {
  return configured ? "configured" : "missing";
}

const exampleEnv = await readEnvFile(exampleEnvFilePath);
const envFromFiles = {};
for (const filePath of actualEnvFilePaths) {
  Object.assign(envFromFiles, await readEnvFile(filePath));
}

const effectiveEnv = { ...envFromFiles, ...process.env };
const nodeEnv = normalizeNodeEnv(effectiveEnv.NODE_ENV);
const production = isProduction(nodeEnv);
const databaseConfigured = hasConfiguredValue(effectiveEnv.DATABASE_URL);
const jwtSecretConfigured = hasConfiguredValue(effectiveEnv.JWT_SECRET);
const corsOriginConfigured = hasConfiguredValue(effectiveEnv.CORS_ORIGIN);
const mockPaymentEnabled = normalizeBoolean(effectiveEnv.ENABLE_MOCK_PAYMENT);
const authRequireEmailVerification = effectiveEnv.AUTH_REQUIRE_EMAIL_VERIFICATION === undefined
  ? true
  : normalizeBoolean(effectiveEnv.AUTH_REQUIRE_EMAIL_VERIFICATION);
const volcengineConfigured = hasConfiguredValue(effectiveEnv.VOLCENGINE_ARK_API_KEY);
const agnesConfigured = hasConfiguredValue(effectiveEnv.AGNES_API_KEY);
const publicAssetBaseUrlConfigured = hasConfiguredValue(effectiveEnv.PUBLIC_ASSET_BASE_URL);
const uploadRetention = resolveUploadRetentionDays(effectiveEnv.UPLOAD_RETENTION_DAYS);
const emailVerificationCodeTtl = resolvePositiveMinutes(effectiveEnv.EMAIL_VERIFICATION_CODE_TTL_MINUTES, 10);
const agnesRequestTimeout = resolvePositiveMilliseconds(effectiveEnv.AGNES_REQUEST_TIMEOUT_MS, 60000);
const smtpHostConfigured = hasConfiguredValue(effectiveEnv.SMTP_HOST);
const smtpPortConfigured = hasConfiguredValue(effectiveEnv.SMTP_PORT);
const smtpPortValid = Number.isInteger(Number(effectiveEnv.SMTP_PORT)) && Number(effectiveEnv.SMTP_PORT) > 0;
const smtpSecureConfigured = hasConfiguredValue(effectiveEnv.SMTP_SECURE);
const smtpUserConfigured = hasConfiguredValue(effectiveEnv.SMTP_USER);
const smtpPassConfigured = hasConfiguredValue(effectiveEnv.SMTP_PASS);
const smtpFromConfigured = hasConfiguredValue(effectiveEnv.SMTP_FROM);
const smtpConfigured = smtpHostConfigured && smtpPortValid && smtpUserConfigured && smtpPassConfigured;

const errors = [];
const warnings = [];

if (production && !databaseConfigured) {
  errors.push("DATABASE_URL is missing in production.");
} else if (!production && !databaseConfigured) {
  warnings.push("DATABASE_URL is missing. Local startup may rely on fallback behavior, but deployment should configure it explicitly.");
}

if (production && !jwtSecretConfigured) {
  errors.push("JWT_SECRET is missing in production.");
} else if (!production && !jwtSecretConfigured) {
  warnings.push("JWT_SECRET is missing. Authentication may not work correctly until it is configured.");
}

if (production && mockPaymentEnabled) {
  errors.push("ENABLE_MOCK_PAYMENT must remain disabled in production.");
}

if (production && looksUnsafeCors(effectiveEnv.CORS_ORIGIN)) {
  errors.push("CORS_ORIGIN is missing or unsafe in production.");
} else if (!production && !corsOriginConfigured) {
  warnings.push("CORS_ORIGIN is not explicitly configured. Development localhost defaults may still work.");
}

if (production && authRequireEmailVerification && !smtpConfigured) {
  errors.push("SMTP is required in production when AUTH_REQUIRE_EMAIL_VERIFICATION=true.");
} else if (!production && !smtpConfigured) {
  warnings.push("SMTP is not fully configured. Development can use the console/dev verification code fallback.");
}

if (production && authRequireEmailVerification && !smtpFromConfigured) {
  errors.push("SMTP_FROM is required in production when AUTH_REQUIRE_EMAIL_VERIFICATION=true.");
} else if (!production && !smtpFromConfigured) {
  warnings.push("SMTP_FROM is missing. Outgoing verification emails should configure a sender address.");
}

if (!volcengineConfigured) {
  warnings.push("VOLCENGINE_ARK_API_KEY is missing. Video generation provider capability may be unavailable.");
}

if (!agnesConfigured) {
  warnings.push("AGNES_API_KEY is missing. Prompt optimization capability may be unavailable.");
}

if (!publicAssetBaseUrlConfigured) {
  warnings.push("PUBLIC_ASSET_BASE_URL is missing. External models may not be able to access locally uploaded assets.");
}

if (!uploadRetention.valid) {
  warnings.push("UPLOAD_RETENTION_DAYS is missing or invalid. The cleanup script will fall back to 7 days.");
}

if (!emailVerificationCodeTtl.valid) {
  warnings.push("EMAIL_VERIFICATION_CODE_TTL_MINUTES is missing or invalid. Email verification code TTL will fall back to 10 minutes.");
}

if (agnesRequestTimeout.configured && !agnesRequestTimeout.valid) {
  warnings.push("AGNES_REQUEST_TIMEOUT_MS is invalid. Agnes requests will fall back to 60000 ms.");
}

const result = {
  ok: errors.length === 0,
  environment: nodeEnv,
  errors,
  warnings,
  checks: {
    corsOrigin: production ? !looksUnsafeCors(effectiveEnv.CORS_ORIGIN) : true,
    uploadRetentionDays: uploadRetention.retentionDays > 0,
    mockPaymentSafe: !production || !mockPaymentEnabled,
    databaseConfigured,
    jwtSecretConfigured,
    smtpConfigured,
    smtpFromConfigured,
    authRequireEmailVerification,
    emailVerificationCodeTtlMinutes: emailVerificationCodeTtl.minutes > 0,
    agnesRequestTimeoutMs: agnesRequestTimeout.milliseconds > 0,
    volcengineConfigured,
    agnesConfigured,
    publicAssetBaseUrlConfigured
  },
  statuses: {
    NODE_ENV: sanitizeCheckState(hasConfiguredValue(effectiveEnv.NODE_ENV)),
    DATABASE_URL: sanitizeCheckState(databaseConfigured),
    JWT_SECRET: sanitizeCheckState(jwtSecretConfigured),
    CORS_ORIGIN: production && looksUnsafeCors(effectiveEnv.CORS_ORIGIN) ? "invalid" : sanitizeCheckState(corsOriginConfigured),
    ENABLE_MOCK_PAYMENT: hasConfiguredValue(effectiveEnv.ENABLE_MOCK_PAYMENT) ? "configured" : "missing",
    SMTP_HOST: sanitizeCheckState(smtpHostConfigured),
    SMTP_PORT: smtpPortValid ? sanitizeCheckState(smtpPortConfigured) : "invalid",
    SMTP_SECURE: smtpSecureConfigured ? "configured" : "missing",
    SMTP_USER: sanitizeCheckState(smtpUserConfigured),
    SMTP_PASS: sanitizeCheckState(smtpPassConfigured),
    SMTP_FROM: sanitizeCheckState(smtpFromConfigured),
    AUTH_REQUIRE_EMAIL_VERIFICATION: hasConfiguredValue(effectiveEnv.AUTH_REQUIRE_EMAIL_VERIFICATION) ? "configured" : "missing",
    EMAIL_VERIFICATION_CODE_TTL_MINUTES: emailVerificationCodeTtl.valid ? "configured" : "invalid",
    AGNES_REQUEST_TIMEOUT_MS: !agnesRequestTimeout.configured ? "missing" : agnesRequestTimeout.valid ? "configured" : "invalid",
    UPLOAD_RETENTION_DAYS: uploadRetention.valid ? "configured" : "invalid",
    VOLCENGINE_ARK_API_KEY: sanitizeCheckState(volcengineConfigured),
    AGNES_API_KEY: sanitizeCheckState(agnesConfigured),
    PUBLIC_ASSET_BASE_URL: sanitizeCheckState(publicAssetBaseUrlConfigured)
  },
  documentedKeys: Object.keys(exampleEnv).sort()
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
