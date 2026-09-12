import { Router } from "express";
import { requireActiveUser, requireAuth } from "../middleware/auth.middleware.js";
import { billingService } from "../services/billing.service.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import { fail, ok } from "../utils/response.js";
import { giftCardService } from "../services/gift-card.service.js";
import { authService } from "../services/auth.service.js";
import { prisma } from "../services/database.service.js";

export const userRoutes = Router();

function getUserId(req: AuthenticatedRequest): string {
  const userId = req.user?.id;
  if (!userId) {
    throw Object.assign(new Error("Please sign in first."), { status: 401 });
  }
  return userId;
}

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  return 500;
}

userRoutes.get("/user/balance", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const data = await billingService.getBalance(getUserId(req as AuthenticatedRequest));
    ok(res, data);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

userRoutes.get("/user/credit-logs", requireAuth, requireActiveUser, async (req, res) => {
  try {
    ok(res, await billingService.getCreditLogs(getUserId(req as AuthenticatedRequest), req.query));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

userRoutes.post("/user/password", requireAuth, requireActiveUser, async (req, res) => {
  try { ok(res, await authService.changePassword(getUserId(req as AuthenticatedRequest), String(req.body?.currentPassword || ""), String(req.body?.newPassword || ""))); }
  catch (error) { fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error)); }
});

userRoutes.get("/user/notification-settings", requireAuth, requireActiveUser, async (req, res) => {
  try { const user = await prisma.user.findUnique({ where: { id: getUserId(req as AuthenticatedRequest) }, select: { notifyTaskCompleted: true, notifyTaskFailed: true, notifyCreditChanged: true, notifySystemAnnouncement: true } }); ok(res, { settings: user }); }
  catch (error) { fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error)); }
});

userRoutes.put("/user/notification-settings", requireAuth, requireActiveUser, async (req, res) => {
  try { const user = await prisma.user.update({ where: { id: getUserId(req as AuthenticatedRequest) }, data: { notifyTaskCompleted: Boolean(req.body?.taskCompleted), notifyTaskFailed: Boolean(req.body?.taskFailed), notifyCreditChanged: Boolean(req.body?.creditChanged), notifySystemAnnouncement: Boolean(req.body?.systemAnnouncement) }, select: { notifyTaskCompleted: true, notifyTaskFailed: true, notifyCreditChanged: true, notifySystemAnnouncement: true } }); ok(res, { settings: user }); }
  catch (error) { fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error)); }
});

userRoutes.post("/gift-cards/redeem", requireAuth, requireActiveUser, async (req, res) => {
  try {
    ok(res, await giftCardService.redeem(getUserId(req as AuthenticatedRequest), req.body?.code));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});
