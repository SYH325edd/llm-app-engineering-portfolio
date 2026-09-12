import { prisma, type PrismaTransaction } from "./database.service.js";
import { createId } from "../utils/id.js";

export type CreditLogType = "recharge" | "consume" | "refund" | "admin_adjust" | "system_grant" | "gift_card_redeem" | "invitee_reward" | "inviter_reward";

export const INSUFFICIENT_BALANCE_MESSAGE = "余额不足，请充值后再生成。";

type Tx = PrismaTransaction;

function toPublicCreditLog(log: {
  id: string;
  userId: string | null;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  relatedTaskId: string | null;
  relatedOrderId: string | null;
  relatedGiftCardId: string | null;
  relatedInviteCode: string | null;
  relatedInviterUserId: string | null;
  relatedInviteeUserId: string | null;
  remark: string;
  createdAt: Date;
}) {
  return {
    id: log.id,
    userId: log.userId,
    type: log.type,
    amount: log.amount,
    balanceBefore: log.balanceBefore,
    balanceAfter: log.balanceAfter,
    relatedTaskId: log.relatedTaskId,
    relatedOrderId: log.relatedOrderId,
    relatedGiftCardId: log.relatedGiftCardId,
    relatedInviteCode: log.relatedInviteCode,
    relatedInviterUserId: log.relatedInviterUserId,
    relatedInviteeUserId: log.relatedInviteeUserId,
    remark: log.remark,
    createdAt: log.createdAt.toISOString()
  };
}

async function createCreditLog(
  tx: Tx,
  input: {
    userId: string;
    type: CreditLogType;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    relatedTaskId?: string | null;
    relatedOrderId?: string | null;
    relatedGiftCardId?: string | null;
    relatedInviteCode?: string | null;
    relatedInviterUserId?: string | null;
    relatedInviteeUserId?: string | null;
    remark?: string;
  }
) {
  return tx.creditLog.create({
    data: {
      id: createId(),
      userId: input.userId,
      type: input.type,
      amount: input.amount,
      balanceBefore: input.balanceBefore,
      balanceAfter: input.balanceAfter,
      relatedTaskId: input.relatedTaskId || null,
      relatedOrderId: input.relatedOrderId || null,
      relatedGiftCardId: input.relatedGiftCardId || null,
      relatedInviteCode: input.relatedInviteCode || null,
      relatedInviterUserId: input.relatedInviterUserId || null,
      relatedInviteeUserId: input.relatedInviteeUserId || null,
      remark: input.remark || ""
    }
  });
}

export class BillingService {
  async syncMemberLevel(tx: Tx, userId: string, balance: number) {
    const memberLevel = balance >= 50000 ? "svip" : "normal";
    return tx.user.update({ where: { id: userId }, data: { memberLevel } });
  }

  async getVideoGenerationCharge(userId: string, originalCost: number) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
    const memberLevel = user.balance >= 50000 ? "svip" : "normal";
    if (user.memberLevel !== memberLevel) await prisma.user.update({ where: { id: userId }, data: { memberLevel } });
    const actualCost = memberLevel === "svip" ? Math.round(originalCost * 0.98) : originalCost;
    return { originalCost, actualCost, memberLevel, discountRate: memberLevel === "svip" ? 0.98 : 1 };
  }

  async createInviteCreditLog(tx: Tx, input: { userId: string; type: "invitee_reward" | "inviter_reward"; amount: number; balanceBefore: number; balanceAfter: number; inviteCode: string; inviterUserId: string; inviteeUserId: string }) {
    return createCreditLog(tx, { ...input, remark: input.type === "invitee_reward" ? "Invitee reward" : "Inviter reward" });
  }
  async createGiftCardCreditLog(tx: Tx, userId: string, giftCardId: string, amount: number, balanceBefore: number, balanceAfter: number) {
    return createCreditLog(tx, { userId, type: "gift_card_redeem", amount, balanceBefore, balanceAfter, relatedGiftCardId: giftCardId, remark: "Gift card redeem" });
  }
  async getBalance(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
    const memberLevel = user.balance >= 50000 ? "svip" : "normal";
    if (user.memberLevel !== memberLevel) await prisma.user.update({ where: { id: userId }, data: { memberLevel } });
    return {
      userId: user.id,
      email: user.email,
      balance: user.balance
    };
  }

  async getCreditLogs(userId: string, query: { page?: unknown; pageSize?: unknown; tab?: unknown; type?: unknown; startDate?: unknown; endDate?: unknown; keyword?: unknown; direction?: unknown } = {}) {
    const page = Math.max(1, Number.parseInt(String(query.page || "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || "10"), 10) || 10));
    const tab = String(query.tab || query.type || "all");
    const direction = String(query.direction || "all");
    const keyword = String(query.keyword || "").trim();
    const startDate = String(query.startDate || "").trim();
    const endDate = String(query.endDate || "").trim();
    const filters: any[] = [{ userId }];
    if (tab === "consume") filters.push({ type: "consume" }, { amount: { lt: 0 } });
    if (tab === "recharge") filters.push({ type: "recharge" }, { amount: { gt: 0 } });
    if (tab === "invite") filters.push({ type: { in: ["invitee_reward", "inviter_reward"] } });
    if (tab === "gift_card") filters.push({ type: "gift_card_redeem" });
    if (tab === "refund") filters.push({ type: "refund" });
    if (direction === "increase") filters.push({ amount: { gt: 0 } });
    if (direction === "decrease") filters.push({ amount: { lt: 0 } });
    if (startDate) filters.push({ createdAt: { gte: new Date(`${startDate}T00:00:00`) } });
    if (endDate) filters.push({ createdAt: { lte: new Date(`${endDate}T23:59:59.999`) } });
    if (keyword) {
      const orders = await prisma.order.findMany({ where: { userId, orderNo: { contains: keyword } }, select: { id: true } });
      filters.push({ OR: [{ relatedTaskId: { contains: keyword } }, { relatedOrderId: { in: orders.map((order: any) => order.id) } }, { remark: { contains: keyword } }, { relatedInviteCode: { contains: keyword } }] });
    }
    const where = { AND: filters };
    const [total, logs] = await Promise.all([
      prisma.creditLog.count({ where }),
      prisma.creditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })
    ]);
    const records = logs.map(toPublicCreditLog);
    return { records, logs: records, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async listCreditLogs(userId: string, query?: Parameters<BillingService["getCreditLogs"]>[1]) {
    return this.getCreditLogs(userId, query);
  }

  async grantDevCredits(email: string, amount: number) {
    if (!email || amount <= 0) {
      throw new Error("email and positive amount are required.");
    }

    return prisma.$transaction(async (tx: Tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) throw new Error(`User '${email}' was not found.`);
      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore + amount;
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { balance: balanceAfter }
      });
      await this.syncMemberLevel(tx, user.id, balanceAfter);
      const log = await createCreditLog(tx, {
        userId: user.id,
        type: "system_grant",
        amount,
        balanceBefore,
        balanceAfter,
        remark: "Local development credit grant"
      });
      return { userId: updated.id, email: updated.email, balance: updated.balance, log: toPublicCreditLog(log) };
    });
  }

  async consumeCredits(userId: string, taskId: string, amount: number, remark = "Video generation consume") {
    if (amount <= 0) return null;

    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.creditLog.findFirst({
        where: { userId, relatedTaskId: taskId, type: "consume" }
      });
      if (existing) return toPublicCreditLog(existing);

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
      if (user.balance < amount) {
        throw Object.assign(new Error(INSUFFICIENT_BALANCE_MESSAGE), { status: 402 });
      }

      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore - amount;
      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter }
      });
      await this.syncMemberLevel(tx, userId, balanceAfter);
      const log = await createCreditLog(tx, {
        userId,
        type: "consume",
        amount: -amount,
        balanceBefore,
        balanceAfter,
        relatedTaskId: taskId,
        remark
      });
      return toPublicCreditLog(log);
    });
  }

  async consumeForTask(userId: string, taskId: string, amount: number, remark = "Video generation consume") {
    return this.consumeCredits(userId, taskId, amount, remark);
  }

  async refundCredits(userId: string, taskId: string, amount: number, remark = "Video generation refund") {
    if (amount <= 0) return null;

    return prisma.$transaction(async (tx: Tx) => {
      const consume = await tx.creditLog.findFirst({
        where: { userId, relatedTaskId: taskId, type: "consume" }
      });
      if (!consume) return null;

      const existingRefund = await tx.creditLog.findFirst({
        where: { userId, relatedTaskId: taskId, type: "refund" }
      });
      if (existingRefund) return toPublicCreditLog(existingRefund);

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw Object.assign(new Error("User not found."), { status: 404 });

      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore + amount;
      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter }
      });
      await this.syncMemberLevel(tx, userId, balanceAfter);
      const log = await createCreditLog(tx, {
        userId,
        type: "refund",
        amount,
        balanceBefore,
        balanceAfter,
        relatedTaskId: taskId,
        remark
      });
      return toPublicCreditLog(log);
    });
  }

  async refundForTask(userId: string, taskId: string, amount: number, remark = "Video generation refund") {
    return this.refundCredits(userId, taskId, amount, remark);
  }

  async hasConsumed(taskId: string) {
    const consume = await prisma.creditLog.findFirst({
      where: { relatedTaskId: taskId, type: "consume" }
    });
    return Boolean(consume);
  }

  async hasRefunded(taskId: string) {
    const refund = await prisma.creditLog.findFirst({
      where: { relatedTaskId: taskId, type: "refund" }
    });
    return Boolean(refund);
  }

  async hasRefund(userId: string, taskId: string) {
    const refund = await prisma.creditLog.findFirst({
      where: { userId, relatedTaskId: taskId, type: "refund" }
    });
    return Boolean(refund);
  }
}

export const billingService = new BillingService();
