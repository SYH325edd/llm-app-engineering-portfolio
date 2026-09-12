import { Router } from "express";
import { requireActiveUser, requireAuth } from "../middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import { inviteService } from "../services/invite.service.js";
import { fail, ok } from "../utils/response.js";

export const inviteRoutes = Router();

function userId(req: AuthenticatedRequest) {
  if (!req.user?.id) throw Object.assign(new Error("请先登录。"), { status: 401 });
  return req.user.id;
}

function status(error: unknown) {
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : 500;
}

inviteRoutes.get("/invite/me", requireAuth, requireActiveUser, async (req, res) => {
  try { ok(res, await inviteService.getInviteInfo(userId(req as AuthenticatedRequest))); }
  catch (error) { fail(res, status(error), error instanceof Error ? error.message : String(error)); }
});

inviteRoutes.post("/invite/apply", requireAuth, requireActiveUser, async (req, res) => {
  try { ok(res, await inviteService.apply(userId(req as AuthenticatedRequest), req.body)); }
  catch (error) { fail(res, status(error), error instanceof Error ? error.message : String(error)); }
});
