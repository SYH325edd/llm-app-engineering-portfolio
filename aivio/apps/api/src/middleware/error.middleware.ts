import type { NextFunction, Request, Response } from "express";
import { isProduction } from "../config/env.js";
import { error as logError, toErrorMeta } from "../utils/logger.js";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.path}`,
    code: "NOT_FOUND"
  });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const status = (error as { status?: unknown }).status;
  const statusCode = typeof status === "number" && status >= 400 && status < 600 ? status : 500;
  const message = error instanceof Error ? error.message : String(error);
  logError("Request failed", {
    method: req.method,
    path: req.path,
    statusCode,
    ...toErrorMeta(error)
  });
  res.status(statusCode).json({
    error: statusCode >= 500 && isProduction() ? "Internal server error." : message,
    code: statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
    ...(isProduction() || !(error instanceof Error) ? {} : { debug: { name: error.name } })
  });
}
