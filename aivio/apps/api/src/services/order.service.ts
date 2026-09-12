import { getRechargePackageById } from "../config/recharge-packages.js";
import { env } from "../config/env.js";
import { createId } from "../utils/id.js";
import { prisma, type PrismaTransaction } from "./database.service.js";
import { billingService } from "./billing.service.js";

export type OrderStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded";
export const MOCK_PAYMENT_DISABLED_MESSAGE = "Mock payment is disabled.";

type DbOrder = {
  id: string;
  userId: string | null;
  orderNo: string;
  amount: number;
  credits: number;
  paymentProvider: string;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toPublicOrder(order: DbOrder) {
  return {
    id: order.id,
    userId: order.userId || "",
    orderNo: order.orderNo,
    amount: order.amount,
    credits: order.credits,
    paymentProvider: order.paymentProvider,
    status: order.status as OrderStatus,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  };
}

function createOrderNo(): string {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `MOCK${timestamp}${createId().slice(0, 8).toUpperCase()}`;
}

export class OrderService {
  isMockPaymentEnabled() {
    return env.enableMockPayment;
  }

  async createOrder(userId: string, packageId: string) {
    if (!this.isMockPaymentEnabled()) {
      throw Object.assign(new Error(MOCK_PAYMENT_DISABLED_MESSAGE), { status: 403 });
    }

    const rechargePackage = getRechargePackageById(packageId);
    if (!rechargePackage) {
      throw Object.assign(new Error(`Recharge package '${packageId}' was not found or is disabled.`), { status: 400 });
    }

    const order = await prisma.order.create({
      data: {
        id: createId(),
        userId,
        orderNo: createOrderNo(),
        amount: rechargePackage.amount,
        credits: rechargePackage.credits,
        paymentProvider: "mock",
        status: "pending"
      }
    });
    return toPublicOrder(order);
  }

  async listOrders(userId: string) {
    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });
    return orders.map(toPublicOrder);
  }

  async getOrder(userId: string, orderId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId }
    });
    return order ? toPublicOrder(order) : null;
  }

  async mockPay(userId: string, orderId: string) {
    if (!this.isMockPaymentEnabled()) {
      throw Object.assign(new Error(MOCK_PAYMENT_DISABLED_MESSAGE), { status: 403 });
    }

    return prisma.$transaction(async (tx: PrismaTransaction) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, userId }
      });
      if (!order) {
        throw Object.assign(new Error(`Order '${orderId}' was not found.`), { status: 404 });
      }
      if (order.status === "paid") {
        throw Object.assign(new Error("该订单已支付，不能重复模拟支付。"), { status: 409 });
      }
      if (order.status !== "pending") {
        throw Object.assign(new Error(`Only pending orders can be mock-paid. Current status: ${order.status}.`), {
          status: 409
        });
      }

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw Object.assign(new Error("User not found."), { status: 404 });
      }

      const paidAt = new Date();
      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore + order.credits;
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "paid",
          paidAt
        }
      });
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter }
      });
      await billingService.syncMemberLevel(tx, userId, balanceAfter);
      const log = await tx.creditLog.create({
        data: {
          id: createId(),
          userId,
          type: "recharge",
          amount: order.credits,
          balanceBefore,
          balanceAfter,
          relatedTaskId: null,
          relatedOrderId: order.id,
          remark: `Mock recharge order ${order.orderNo}`
        }
      });

      return {
        order: toPublicOrder(updatedOrder),
        balance: {
          userId: updatedUser.id,
          email: updatedUser.email,
          balance: updatedUser.balance
        },
        creditLog: {
          id: log.id,
          userId: log.userId,
          type: log.type,
          amount: log.amount,
          balanceBefore: log.balanceBefore,
          balanceAfter: log.balanceAfter,
          relatedTaskId: log.relatedTaskId,
          relatedOrderId: log.relatedOrderId,
          remark: log.remark,
          createdAt: log.createdAt.toISOString()
        }
      };
    });
  }
}

export const orderService = new OrderService();
