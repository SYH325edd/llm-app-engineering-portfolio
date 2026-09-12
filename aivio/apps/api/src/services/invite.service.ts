import { randomBytes } from "node:crypto";
import { prisma, type PrismaTransaction } from "./database.service.js";
import { billingService } from "./billing.service.js";
import { createId } from "../utils/id.js";

const INVITE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const INVITE_LENGTH = 6;
const INVITE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

function generateInviteCode() {
  return Array.from(randomBytes(INVITE_LENGTH), (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join("");
}

function assertInviteCode(value: unknown) {
  const code = String(value || "").trim();
  if (!/^[A-Za-z0-9]{6}$/.test(code)) throw Object.assign(new Error("邀请码无效"), { status: 400 });
  return code;
}

async function ensureInviteCode(userId: string) {
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
  if (current?.inviteCode) return current.inviteCode;
  for (;;) {
    try {
      const updated = await prisma.user.update({ where: { id: userId }, data: { inviteCode: generateInviteCode() }, select: { inviteCode: true } });
      return updated.inviteCode!;
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
}

async function rewardInvite(tx: PrismaTransaction, inviter: any, invitee: any, code: string) {
  const inviteeAmount = inviter.role === "admin" ? 100 : 10;
  const existing = await tx.creditLog.findFirst({ where: { type: "invitee_reward", relatedInviteeUserId: invitee.id } });
  if (existing) return;
  const inviteeBefore = invitee.balance;
  const inviteeAfter = inviteeBefore + inviteeAmount;
  await tx.user.update({ where: { id: invitee.id }, data: { balance: inviteeAfter } });
  await billingService.syncMemberLevel(tx, invitee.id, inviteeAfter);
  await billingService.createInviteCreditLog(tx, { userId: invitee.id, type: "invitee_reward", amount: inviteeAmount, balanceBefore: inviteeBefore, balanceAfter: inviteeAfter, inviteCode: code, inviterUserId: inviter.id, inviteeUserId: invitee.id });

  if (inviter.role !== "admin") {
    const inviterBefore = inviter.balance;
    const inviterAfter = inviterBefore + 10;
    await tx.user.update({ where: { id: inviter.id }, data: { balance: inviterAfter } });
    await billingService.syncMemberLevel(tx, inviter.id, inviterAfter);
    await billingService.createInviteCreditLog(tx, { userId: inviter.id, type: "inviter_reward", amount: 10, balanceBefore: inviterBefore, balanceAfter: inviterAfter, inviteCode: code, inviterUserId: inviter.id, inviteeUserId: invitee.id });
  }
}

export class InviteService {
  async ensureUserInviteCode(userId: string) { return ensureInviteCode(userId); }

  async validateRegistrationCode(input: unknown) {
    const code = assertInviteCode(input);
    const inviter = await prisma.user.findUnique({ where: { inviteCode: code }, select: { id: true, role: true } });
    if (!inviter) throw Object.assign(new Error("邀请码无效"), { status: 400 });
    return code;
  }

  async getInviteInfo(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error("用户不存在。"), { status: 404 });
    const inviteCode = user.inviteCode || await ensureInviteCode(userId);
    const canApply = !user.invitedByUserId && Date.now() - user.createdAt.getTime() <= INVITE_WINDOW_MS;
    const inviter = user.invitedByUserId ? await prisma.user.findUnique({ where: { id: user.invitedByUserId }, select: { id: true, email: true, role: true } }) : null;
    return { inviteCode, canApply, usedInviteCode: user.invitedByUserId ? await prisma.user.findFirst({ where: { id: user.invitedByUserId }, select: { inviteCode: true } }).then((item: any) => item?.inviteCode || null) : null, inviter };
  }

  async apply(userId: string, input: unknown) {
    const code = assertInviteCode((input as { inviteCode?: unknown })?.inviteCode);
    return prisma.$transaction(async (tx: PrismaTransaction) => {
      const invitee = await tx.user.findUnique({ where: { id: userId } });
      if (!invitee) throw Object.assign(new Error("用户不存在。"), { status: 404 });
      if (invitee.invitedByUserId) throw Object.assign(new Error("你已经使用过邀请码。"), { status: 409 });
      if (Date.now() - invitee.createdAt.getTime() > INVITE_WINDOW_MS) throw Object.assign(new Error("注册超过 3 天，不能再填写邀请码。"), { status: 409 });
      const inviter = await tx.user.findUnique({ where: { inviteCode: code } });
      if (!inviter || inviter.id === invitee.id) throw Object.assign(new Error("此邀请码无效。"), { status: 400 });
      const updated = await tx.user.update({ where: { id: userId }, data: { invitedByUserId: inviter.id, inviteCodeUsedAt: new Date() } });
      await rewardInvite(tx, inviter, updated, code);
      return { inviteCode: code, addedCredits: inviter.role === "admin" ? 100 : 10, balance: updated.balance + (inviter.role === "admin" ? 100 : 10) };
    });
  }

  async applyOnRegistration(tx: PrismaTransaction, inviteCode: unknown, invitee: any) {
    if (!inviteCode) return invitee;
    const code = assertInviteCode(inviteCode);
    const inviter = await tx.user.findUnique({ where: { inviteCode: code } });
    if (!inviter || inviter.id === invitee.id) throw Object.assign(new Error("邀请码无效"), { status: 400 });
    const updated = await tx.user.update({ where: { id: invitee.id }, data: { invitedByUserId: inviter.id, inviteCodeUsedAt: new Date() } });
    await rewardInvite(tx, inviter, updated, code);
    return updated;
  }
}

export const inviteService = new InviteService();
