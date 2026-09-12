import { Router } from "express";
import { getEnabledRechargePackages } from "../config/recharge-packages.js";
import { requireActiveUser, requireAuth } from "../middleware/auth.middleware.js";
import { orderService } from "../services/order.service.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import { error as logError, toErrorMeta } from "../utils/logger.js";
import { fail, ok } from "../utils/response.js";

export const orderRoutes = Router();

function getUserId(req: AuthenticatedRequest): string {
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

orderRoutes.get("/recharge/packages", requireAuth, requireActiveUser, async (req, res) => {
  try {
    getUserId(req as AuthenticatedRequest);
    ok(res, {
      packages: getEnabledRechargePackages(),
      mockPaymentEnabled: orderService.isMockPaymentEnabled()
    });
  } catch (error) {
    logError("Failed to load recharge packages", toErrorMeta(error));
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

orderRoutes.post("/orders", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);
    const packageId = String((req.body as { packageId?: unknown }).packageId || "").trim();
    if (!packageId) {
      fail(res, 400, "packageId is required.");
      return;
    }
    const order = await orderService.createOrder(userId, packageId);
    ok(res, { order }, 201);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

orderRoutes.get("/orders", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);
    const orders = await orderService.listOrders(userId);
    ok(res, { orders });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

orderRoutes.get("/orders/:orderId", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);
    const order = await orderService.getOrder(userId, req.params.orderId);
    if (!order) {
      fail(res, 404, `Order '${req.params.orderId}' was not found.`);
      return;
    }
    ok(res, { order });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

orderRoutes.post("/orders/:orderId/mock-pay", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);
    const result = await orderService.mockPay(userId, req.params.orderId);
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});
