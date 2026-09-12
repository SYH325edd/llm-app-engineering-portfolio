import { Router } from "express";
import { requireAdmin } from "../middleware/admin.middleware.js";
import { adminService } from "../services/admin.service.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import { fail, ok } from "../utils/response.js";
import { giftCardService } from "../services/gift-card.service.js";

export const adminRoutes = Router();

function getAdminUserId(req: AuthenticatedRequest): string {
  const userId = req.user?.id;
  if (!userId) {
    throw Object.assign(new Error("请先登录。"), { status: 401 });
  }
  return userId;
}

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  return 500;
}

adminRoutes.get("/admin/stats", requireAdmin, async (_req, res) => {
  try {
    ok(res, { stats: await adminService.getStats() });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.post("/admin/gift-cards", requireAdmin, async (req, res) => {
  try { ok(res, await giftCardService.create(getAdminUserId(req as AuthenticatedRequest), req.body), 201); }
  catch (error) { fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error)); }
});

adminRoutes.get("/admin/gift-cards", requireAdmin, async (req, res) => {
  try { ok(res, await giftCardService.list(req.query)); }
  catch (error) { fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error)); }
});

adminRoutes.post("/admin/gift-cards/:id/disable", requireAdmin, async (req, res) => {
  try { ok(res, await giftCardService.disable(getAdminUserId(req as AuthenticatedRequest), req.params.id)); }
  catch (error) { fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error)); }
});

adminRoutes.delete("/admin/gift-cards/:id", requireAdmin, async (req, res) => {
  try { ok(res, await giftCardService.delete(req.params.id)); }
  catch (error) { fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error)); }
});

adminRoutes.delete("/admin/gift-cards", requireAdmin, async (req, res) => {
  try { ok(res, await giftCardService.deleteMany(req.body?.ids)); }
  catch (error) { fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error)); }
});

adminRoutes.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    ok(res, await adminService.listUsers(req.query));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.get("/admin/users/:userId", requireAdmin, async (req, res) => {
  try {
    ok(res, await adminService.getUserDetail(req.params.userId));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.post("/admin/users/:userId/adjust-balance", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    const body = req.body as { amount?: unknown; remark?: unknown };
    const amount = Number(body.amount);
    const remark = String(body.remark || "").trim();
    ok(res, await adminService.adjustBalance(adminUserId, req.params.userId, amount, remark));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.post("/admin/users/:userId/disable", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.setUserStatus(adminUserId, req.params.userId, "disabled"));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.post("/admin/users/:userId/enable", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.setUserStatus(adminUserId, req.params.userId, "active"));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.get("/admin/orders", requireAdmin, async (req, res) => {
  try {
    ok(res, await adminService.listOrders(req.query));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.get("/admin/tasks", requireAdmin, async (req, res) => {
  try {
    ok(res, await adminService.listTasks(req.query));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.get("/admin/credit-logs", requireAdmin, async (req, res) => {
  try {
    ok(res, await adminService.listCreditLogs(req.query));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.get("/admin/admin-logs", requireAdmin, async (req, res) => {
  try {
    ok(res, await adminService.listAdminLogs(req.query));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.get("/admin/models", requireAdmin, async (_req, res) => {
  try {
    ok(res, await adminService.getModels());
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.post("/admin/models", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.createModel(adminUserId, req.body), 201);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.patch("/admin/models/:modelId", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.updateModel(adminUserId, req.params.modelId, req.body));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.delete("/admin/models/:modelId", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.deleteModel(adminUserId, req.params.modelId));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.get("/admin/models/:modelId/pricing-rules", requireAdmin, async (req, res) => {
  try {
    ok(res, await adminService.listPricingRules(req.params.modelId));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.post("/admin/models/:modelId/pricing-rules", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.createPricingRule(adminUserId, req.params.modelId, req.body), 201);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.patch("/admin/pricing-rules/:ruleId", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.updatePricingRule(adminUserId, req.params.ruleId, req.body));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.delete("/admin/pricing-rules/:ruleId", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.deletePricingRule(adminUserId, req.params.ruleId));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.get("/admin/providers", requireAdmin, async (_req, res) => {
  try {
    ok(res, await adminService.getProviders());
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.post("/admin/providers", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.createProvider(adminUserId, req.body), 201);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.patch("/admin/providers/:providerId", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.updateProvider(adminUserId, req.params.providerId, req.body));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

adminRoutes.delete("/admin/providers/:providerId", requireAdmin, async (req, res) => {
  try {
    const adminUserId = getAdminUserId(req as AuthenticatedRequest);
    ok(res, await adminService.deleteProvider(adminUserId, req.params.providerId));
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});
