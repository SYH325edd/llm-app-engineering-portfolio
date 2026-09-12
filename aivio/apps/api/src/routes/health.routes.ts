import { Router } from "express";
import { env, getCorsOrigins, getEnv, getRuntimeEnvironment } from "../config/env.js";
import { prisma } from "../services/database.service.js";
import { ok } from "../utils/response.js";
import { createRequire } from "node:module";

export const healthRoutes = Router();

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version?: string };

type HealthCheckValue = boolean | "unknown";

async function checkDatabase(): Promise<HealthCheckValue> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function hasEnvValue(name: string): boolean {
  return Boolean(getEnv(name).trim());
}

healthRoutes.get("/health", async (_req, res) => {
  const database = await checkDatabase();

  ok(res, {
    ok: true,
    service: "AIVio API",
    environment: getRuntimeEnvironment(),
    trustProxy: res.app.get("trust proxy"),
    corsOrigins: getCorsOrigins(),
    timestamp: new Date().toISOString(),
    version: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || packageJson.version || "unknown",
    checks: {
      api: true,
      database,
      corsConfigured: getCorsOrigins().length > 0,
      mockPaymentEnabled: env.enableMockPayment,
      volcengineConfigured: hasEnvValue("VOLCENGINE_ARK_API_KEY"),
      agnesConfigured: hasEnvValue("AGNES_API_KEY"),
      publicAssetBaseUrlConfigured: Boolean(env.publicAssetBaseUrl.trim())
    }
  });
});
