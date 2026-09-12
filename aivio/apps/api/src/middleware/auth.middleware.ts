import type { NextFunction, Request, Response } from "express";
import { authService } from "../services/auth.service.js";
import { fail } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/auth.js";

function getBearerToken(req: Request): string {
  const header = req.headers.authorization || "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = getBearerToken(req);
    if (!token) {
      fail(res, 401, "请先登录。");
      return;
    }

    const payload = authService.verifyToken(token);
    const user = await authService.getUserById(payload.sub);
    if (!user) {
      fail(res, 401, "登录状态已失效，请重新登录。");
      return;
    }

    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    fail(res, typeof status === "number" ? status : 401, error instanceof Error ? error.message : "登录状态无效。");
  }
}

export function requireActiveUser(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    fail(res, 401, "请先登录。");
    return;
  }
  if (user.status !== "active") {
    fail(res, 403, "账号已被禁用，请联系管理员");
    return;
  }
  next();
}
