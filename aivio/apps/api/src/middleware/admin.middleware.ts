import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "./auth.middleware.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import { fail } from "../utils/response.js";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      fail(res, 401, "请先登录。");
      return;
    }
    if (user.status !== "active") {
      fail(res, 403, "账号已被禁用，请联系管理员");
      return;
    }
    if (user.role !== "admin") {
      fail(res, 403, "需要管理员权限。");
      return;
    }
    next();
  });
}
