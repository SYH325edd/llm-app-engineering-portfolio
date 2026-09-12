import { randomBytes } from "node:crypto";
import { prisma, type PrismaTransaction } from "./database.service.js";
import { billingService } from "./billing.service.js";
import { createId } from "../utils/id.js";

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 24;

function createGiftCardCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function parseCredits(value: unknown) {
  const credits = Number(value);
  if (!Number.isInteger(credits) || credits <= 0) throw Object.assign(new Error("积分额度必须是正整数。"), { status: 400 });
  return credits;
}

function parseQuantity(value: unknown) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1000) {
    throw Object.assign(new Error("生成数量必须是 1 到 1000 之间的整数。"), { status: 400 });
  }
  return quantity;
}

function parseExpiry(expiresAt: unknown, expiryType: unknown) {
  if (expiryType === "permanent" || (!expiresAt && !expiryType)) return null;
  if (expiryType === "1d" || expiryType === "7d" || expiryType === "30d") {
    const days = Number(String(expiryType).slice(0, -1));
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
  const date = new Date(String(expiresAt || ""));
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw Object.assign(new Error("过期时间必须是未来的有效时间。"), { status: 400 });
  }
  return date;
}

function publicCard(card: any, users = new Map<string, any>()) {
  const redeemedUser = card.redeemedByUserId ? users.get(card.redeemedByUserId) : null;
  return {
    id: card.id,
    code: card.code,
    credits: card.credits,
    status: card.status === "active" && card.expiresAt && card.expiresAt.getTime() <= Date.now() ? "expired" : card.status,
    expiresAt: card.expiresAt?.toISOString() || null,
    createdByAdminId: card.createdByAdminId,
    redeemedByUserId: card.redeemedByUserId,
    redeemedUser: redeemedUser ? { id: redeemedUser.id, email: redeemedUser.email, nickname: redeemedUser.nickname } : null,
    redeemedAt: card.redeemedAt?.toISOString() || null,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    disabledAt: card.disabledAt?.toISOString() || null,
    disabledByAdminId: card.disabledByAdminId
  };
}

export class GiftCardService {
  async create(adminId: string, input: { credits?: unknown; quantity?: unknown; expiresAt?: unknown; expiryType?: unknown }) {
    const credits = parseCredits(input.credits);
    const quantity = parseQuantity(input.quantity);
    const expiresAt = parseExpiry(input.expiresAt, input.expiryType);
    const cards: any[] = [];

    await prisma.$transaction(async (tx: PrismaTransaction) => {
      for (let index = 0; index < quantity; index += 1) {
        let card: any;
        do {
          try {
            card = await tx.giftCard.create({
              data: { id: createId(), code: createGiftCardCode(), credits, expiresAt, createdByAdminId: adminId }
            });
          } catch (error) {
            if (!String(error).includes("Unique constraint")) throw error;
          }
        } while (!card);
        cards.push(publicCard(card));
      }
    });
    return { cards };
  }

  async list(input: { search?: unknown; status?: unknown; page?: unknown; pageSize?: unknown } = {}) {
    const page = Math.max(1, Number.parseInt(String(input.page || "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(input.pageSize || "10"), 10) || 10));
    const search = String(input.search || "").trim();
    const status = String(input.status || "all");
    const now = new Date();
    const where: any = {};
    const filters: any[] = [];

    if (status === "active") filters.push({ status: "active" }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
    if (status === "redeemed" || status === "disabled") filters.push({ status });
    if (status === "expired") filters.push({ status: "active" }, { expiresAt: { lt: now } });
    if (!["all", "active", "redeemed", "disabled", "expired"].includes(status)) {
      throw Object.assign(new Error("状态筛选参数无效。"), { status: 400 });
    }

    let matchingUserIds: string[] = [];
    if (search) {
      const users = await prisma.user.findMany({ where: { email: { contains: search } }, select: { id: true } });
      matchingUserIds = users.map((user: any) => user.id);
      filters.push({ OR: [{ code: { contains: search } }, { redeemedByUserId: { in: matchingUserIds } }] });
    }
    if (filters.length) where.AND = filters;

    const [total, cards] = await prisma.$transaction([
      prisma.giftCard.count({ where }),
      prisma.giftCard.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })
    ]);
    const userIds = cards.flatMap((card: any) => card.redeemedByUserId ? [card.redeemedByUserId] : []);
    const users = new Map<string, any>((await prisma.user.findMany({ where: { id: { in: userIds } } })).map((user: any) => [user.id, user] as [string, any]));
    return { items: cards.map((card: any) => ({ ...publicCard(card, users), redeemedByEmail: users.get(card.redeemedByUserId)?.email || null })), total, page, pageSize };
  }

  async disable(adminId: string, id: string) {
    const card = await prisma.giftCard.findUnique({ where: { id } });
    if (!card) throw Object.assign(new Error("礼品卡不存在。"), { status: 404 });
    if (card.status === "redeemed") throw Object.assign(new Error("已兑换礼品卡不能作废。"), { status: 409 });
    if (card.status === "disabled") return publicCard(card);
    const updated = await prisma.giftCard.update({ where: { id }, data: { status: "disabled", disabledAt: new Date(), disabledByAdminId: adminId } });
    return publicCard(updated);
  }

  async delete(id: string) {
    const card = await prisma.giftCard.findUnique({ where: { id } });
    if (!card) throw Object.assign(new Error("礼品卡不存在。"), { status: 404 });
    if (card.status === "redeemed" || card.redeemedByUserId) {
      throw Object.assign(new Error("已兑换礼品卡不能删除，请保留积分流水记录。"), { status: 409 });
    }
    await prisma.giftCard.delete({ where: { id } });
    return { id };
  }

  async deleteMany(idsInput: unknown) {
    const ids = Array.isArray(idsInput) ? idsInput.map(String).filter(Boolean) : [];
    if (!ids.length) throw Object.assign(new Error("请选择要删除的礼品卡。"), { status: 400 });
    const cards = await prisma.giftCard.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, redeemedByUserId: true } });
    if (cards.some((card: any) => card.status === "redeemed" || card.redeemedByUserId)) {
      throw Object.assign(new Error("选中的礼品卡包含已兑换卡片，不能删除。"), { status: 409 });
    }
    const result = await prisma.giftCard.deleteMany({ where: { id: { in: cards.map((card: any) => card.id) } } });
    return { deletedCount: result.count };
  }

  async redeem(userId: string, codeInput: unknown) {
    const code = String(codeInput || "").trim();
    if (!code) throw Object.assign(new Error("请输入礼品卡 ID。"), { status: 400 });

    return prisma.$transaction(async (tx: PrismaTransaction) => {
      const card = await tx.giftCard.findUnique({ where: { code } });
      if (!card) throw Object.assign(new Error("礼品卡不存在。"), { status: 404 });
      if (card.status === "redeemed") throw Object.assign(new Error("礼品卡已兑换。"), { status: 409 });
      if (card.status === "disabled") throw Object.assign(new Error("礼品卡已禁用。"), { status: 409 });
      if (card.expiresAt && card.expiresAt.getTime() <= Date.now()) throw Object.assign(new Error("礼品卡已过期。"), { status: 409 });

      const claimed = await tx.giftCard.updateMany({ where: { id: card.id, status: "active" }, data: { status: "redeemed", redeemedByUserId: userId, redeemedAt: new Date() } });
      if (claimed.count !== 1) throw Object.assign(new Error("礼品卡已兑换。"), { status: 409 });

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw Object.assign(new Error("用户不存在。"), { status: 404 });
      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore + card.credits;
      await tx.user.update({ where: { id: userId }, data: { balance: balanceAfter } });
      await billingService.syncMemberLevel(tx, userId, balanceAfter);
      await billingService.createGiftCardCreditLog(tx, userId, card.id, card.credits, balanceBefore, balanceAfter);
      return { addedCredits: card.credits, balance: balanceAfter, code: card.code };
    });
  }
}

export const giftCardService = new GiftCardService();
