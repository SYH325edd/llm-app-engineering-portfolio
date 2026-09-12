import type { Response } from "express";

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json(data);
}

export function fail(res: Response, status: number, message: string, details?: unknown): void {
  res.status(status).json({
    error: message,
    code: status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
    ...(details === undefined ? {} : { details })
  });
}
