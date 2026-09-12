import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import dotenv from "dotenv";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(apiRoot, "../..");

if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: path.join(apiRoot, ".env.production") });
}
dotenv.config({ path: path.join(apiRoot, ".env"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });

function resolveConfigFile(fileName: string): string {
  const candidates = [
    path.join(repoRoot, "config", fileName),
    path.join(apiRoot, "config", fileName),
    path.join(process.cwd(), "config", fileName)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8788),
  corsOrigin: process.env.CORS_ORIGIN || "",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  generationRateLimitMax: Number(process.env.GENERATION_RATE_LIMIT_MAX || 30),
  mockPayRateLimitMax: Number(process.env.MOCK_PAY_RATE_LIMIT_MAX || 30),
  enableMockPayment: parseBoolean(process.env.ENABLE_MOCK_PAYMENT, false),
  authRequireEmailVerification: parseBoolean(process.env.AUTH_REQUIRE_EMAIL_VERIFICATION, true),
  emailVerificationCodeTtlMinutes: parsePositiveInteger(process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES, 10),
  emailProvider: (process.env.EMAIL_PROVIDER || "").trim().toLowerCase(),
  resendApiKey: process.env.RESEND_API_KEY || "",
  resendFrom: process.env.RESEND_FROM || "",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: parsePositiveInteger(process.env.SMTP_PORT, 587),
  smtpSecure: parseBoolean(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "",
  uploadRetentionDays: parsePositiveInteger(process.env.UPLOAD_RETENTION_DAYS, 7),
  agnesRequestTimeoutMs: parsePositiveInteger(process.env.AGNES_REQUEST_TIMEOUT_MS, 60000),
  maxImageUploadMb: Number(process.env.MAX_IMAGE_UPLOAD_MB || 10),
  maxVideoUploadMb: Number(process.env.MAX_VIDEO_UPLOAD_MB || 100),
  publicAssetBaseUrl: process.env.PUBLIC_ASSET_BASE_URL || "",
  r2AccountId: process.env.R2_ACCOUNT_ID || "",
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || "",
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  r2Bucket: process.env.R2_BUCKET || "",
  r2PublicBaseUrl: process.env.R2_PUBLIC_BASE_URL || "",
  r2Endpoint: process.env.R2_ENDPOINT || "",
  r2Region: process.env.R2_REGION || "auto",
  apiRoot,
  repoRoot,
  modelsPath: resolveConfigFile("models.json"),
  providersPath: resolveConfigFile("providers.json"),
  rechargePackagesPath: resolveConfigFile("recharge-packages.json"),
  taskStorePath: path.join(repoRoot, "data", "generation-tasks.json")
};

export function getEnv(name: string): string {
  return process.env[name] || "";
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value.trim()) {
    throw new Error(`Missing environment variable '${name}'. Configure it in .env before starting the Node API.`);
  }
  return value;
}

export function isProduction(): boolean {
  return env.nodeEnv === "production";
}

export function getRuntimeEnvironment(): string {
  return env.nodeEnv.trim() || "unknown";
}

export function getCorsOrigins(): string[] {
  const defaultOrigins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://127.0.0.1:8788",
    "http://localhost:8788",
    "https://aivio.pages.dev"
  ];
  const configuredOrigins = env.corsOrigin
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const merged = [...configuredOrigins, ...defaultOrigins];
  return Array.from(new Set(merged));
}

export function isSmtpConfigured(): boolean {
  return Boolean(env.smtpHost.trim() && env.smtpUser.trim() && env.smtpPass.trim() && env.smtpFrom.trim());
}

export function validateStartupEnv(): void {
  const required = ["PORT", "DATABASE_URL", "JWT_SECRET"];
  const missing = required.filter((name) => !getEnv(name).trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}.`);
  }
  if (!Number.isInteger(env.port) || env.port <= 0) {
    throw new Error("PORT must be a positive integer.");
  }
  if (isProduction() && !env.corsOrigin.trim()) {
    throw new Error("CORS_ORIGIN must be configured in production.");
  }
}
