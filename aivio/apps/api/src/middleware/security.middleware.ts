import type { Express, RequestHandler } from "express";
import cors from "cors";
import { env, getCorsOrigins } from "../config/env.js";
import { log, warn } from "../utils/logger.js";

type RateLimitFactory = (options: { windowMs: number; max: number; standardHeaders: boolean; legacyHeaders: boolean }) => RequestHandler;

function localRateLimit(options: { windowMs: number; max: number }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = hits.get(key);
    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    current.count += 1;
    if (current.count > options.max) {
      res.status(429).json({ error: "Too many requests. Please try again later.", code: "RATE_LIMITED" });
      return;
    }
    next();
  };
}

async function loadHelmet(): Promise<RequestHandler> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    const module = (await dynamicImport("helmet")) as { default?: () => RequestHandler };
    log("Loaded helmet security middleware.");
    return module.default ? module.default() : (_req, _res, next) => next();
  } catch {
    warn("helmet is not installed; using no-op security header middleware.");
    return (_req, _res, next) => next();
  }
}

async function loadRateLimit(): Promise<RateLimitFactory> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    const module = (await dynamicImport("express-rate-limit")) as { rateLimit?: RateLimitFactory; default?: RateLimitFactory };
    log("Loaded express-rate-limit middleware.");
    return module.rateLimit || module.default || ((options) => localRateLimit(options));
  } catch {
    warn("express-rate-limit is not installed; using local in-memory fallback limiter.");
    return (options) => localRateLimit(options);
  }
}

function corsMiddleware(): RequestHandler {
  const allowedOrigins = new Set(getCorsOrigins());
  return cors({
    optionsSuccessStatus: 204,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    }
  });
}

export async function applySecurityMiddleware(app: Express): Promise<void> {
  const helmetMiddleware = await loadHelmet();
  const rateLimit = await loadRateLimit();
  const generalLimiter = rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });
  const authLimiter = rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });
  const generationLimiter = rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.generationRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });
  const mockPayLimiter = rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.mockPayRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });

  app.use(helmetMiddleware);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) {
      next();
      return;
    }
    if (getCorsOrigins().includes(origin)) {
      next();
      return;
    }
    res.status(403).json({
      error: `CORS origin is not allowed: ${origin}`,
      code: "CORS_ORIGIN_NOT_ALLOWED"
    });
  });
  app.use(corsMiddleware());
  app.use(generalLimiter);
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/register", authLimiter);
  app.use("/api/auth/verify-email-code", authLimiter);
  app.use("/api/auth/resend-email-code", authLimiter);
  app.use("/api/video/generations", generationLimiter);
  app.use(/\/api\/orders\/[^/]+\/mock-pay$/, mockPayLimiter);
}
