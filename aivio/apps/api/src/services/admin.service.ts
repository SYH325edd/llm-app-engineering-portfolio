import { createId } from "../utils/id.js";
import { prisma, type PrismaTransaction } from "./database.service.js";
import { modelRegistryService } from "./model-registry.service.js";
import { pricingService } from "./pricing.service.js";
import { log } from "../utils/logger.js";
import { billingService } from "./billing.service.js";

type PageInput = {
  page?: unknown;
  pageSize?: unknown;
};

function toPositiveInt(value: unknown, fallback: number, max = 100): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function getPagination(input: PageInput) {
  const page = toPositiveInt(input.page, 1, 100000);
  const pageSize = toPositiveInt(input.pageSize, 20, 100);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize
  };
}

function todayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function stringifyDetail(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toInteger(value: unknown, field: string, fallback?: number): number {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw Object.assign(new Error(`${field} 必须是整数。`), { status: 400 });
  }
  return parsed;
}

function toOptionalInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  return toInteger(value, field);
}

function toOptionalFloat(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw Object.assign(new Error(`${field} 必须是数字。`), { status: 400 });
  }
  return parsed;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function normalizeResolution(value: unknown): string {
  const resolution = String(value || "").trim().toLowerCase();
  if (!["480p", "720p", "1080p"].includes(resolution)) {
    throw Object.assign(new Error("分辨率必须是 480p、720p 或 1080p。"), { status: 400 });
  }
  return resolution;
}

function normalizeAudioMode(value: unknown): string {
  const mode = String(value || "default").trim().toLowerCase();
  if (!["audio", "silent", "default"].includes(mode)) {
    throw Object.assign(new Error("声音模式必须是 audio、silent 或 default。"), { status: 400 });
  }
  return mode;
}

function validatePricingPayload(input: Record<string, unknown>, existing?: Record<string, unknown>) {
  const minOutputDuration = toInteger(input.minOutputDuration ?? existing?.minOutputDuration, "最短输出时长", 4);
  const maxOutputDuration = toInteger(input.maxOutputDuration ?? existing?.maxOutputDuration, "最长输出时长", 15);
  if (minOutputDuration < 4 || maxOutputDuration > 15 || minOutputDuration > maxOutputDuration) {
    throw Object.assign(new Error("输出视频时长必须在 4 到 15 秒之间。"), { status: 400 });
  }
  const minInputVideoDuration = input.minInputVideoDuration !== undefined
    ? toOptionalInteger(input.minInputVideoDuration, "最短输入视频时长")
    : (existing?.minInputVideoDuration as number | null | undefined) ?? null;
  const maxInputVideoDuration = input.maxInputVideoDuration !== undefined
    ? toOptionalInteger(input.maxInputVideoDuration, "最长输入视频时长")
    : (existing?.maxInputVideoDuration as number | null | undefined) ?? null;
  if (minInputVideoDuration !== null && maxInputVideoDuration !== null && (minInputVideoDuration < 2 || maxInputVideoDuration > 15 || minInputVideoDuration > maxInputVideoDuration)) {
    throw Object.assign(new Error("输入视频时长必须在 2 到 15 秒之间。"), { status: 400 });
  }
  const pointsPerSecond = toInteger(input.pointsPerSecond ?? existing?.pointsPerSecond, "每秒积分");
  if (pointsPerSecond <= 0) throw Object.assign(new Error("每秒积分必须大于 0。"), { status: 400 });

  return {
    inputContainsVideo: toBoolean(input.inputContainsVideo ?? existing?.inputContainsVideo, false),
    audioMode: normalizeAudioMode(input.audioMode ?? existing?.audioMode),
    resolution: normalizeResolution(input.resolution ?? existing?.resolution),
    minOutputDuration,
    maxOutputDuration,
    minInputVideoDuration,
    maxInputVideoDuration,
    minBillableInputVideoDuration: input.minBillableInputVideoDuration !== undefined
      ? toOptionalInteger(input.minBillableInputVideoDuration, "最低计费输入视频时长")
      : (existing?.minBillableInputVideoDuration as number | null | undefined) ?? null,
    pointsPerSecond,
    costPerSecondRmb: input.costPerSecondRmb !== undefined
      ? toOptionalFloat(input.costPerSecondRmb, "火山估算每秒成本")
      : (existing?.costPerSecondRmb as number | null | undefined) ?? null,
    enabled: toBoolean(input.enabled ?? existing?.enabled, true),
    remark: String(input.remark ?? existing?.remark ?? "").trim()
  };
}

async function listPricingRuleRows(modelId: string) {
  return (await prisma.$queryRawUnsafe(
    "SELECT * FROM ModelPricingRule WHERE modelId = ? ORDER BY resolution ASC, inputContainsVideo ASC, audioMode ASC, createdAt ASC",
    modelId
  )) as any[];
}

async function findPricingRuleRow(ruleId: string) {
  const rows = (await prisma.$queryRawUnsafe("SELECT * FROM ModelPricingRule WHERE id = ? LIMIT 1", ruleId)) as any[];
  return rows[0] || null;
}

async function insertPricingRuleRow(modelId: string, modelKeySnapshot: string, payload: ReturnType<typeof validatePricingPayload>) {
  const id = createId();
  await prisma.$executeRawUnsafe(
    `INSERT INTO ModelPricingRule (
      id, modelId, modelKeySnapshot, inputContainsVideo, audioMode, resolution,
      minOutputDuration, maxOutputDuration, minInputVideoDuration, maxInputVideoDuration,
      minBillableInputVideoDuration, pointsPerSecond, costPerSecondRmb, enabled, remark,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    id,
    modelId,
    modelKeySnapshot,
    payload.inputContainsVideo ? 1 : 0,
    payload.audioMode,
    payload.resolution,
    payload.minOutputDuration,
    payload.maxOutputDuration,
    payload.minInputVideoDuration,
    payload.maxInputVideoDuration,
    payload.minBillableInputVideoDuration,
    payload.pointsPerSecond,
    payload.costPerSecondRmb,
    payload.enabled ? 1 : 0,
    payload.remark
  );
  return findPricingRuleRow(id);
}

async function updatePricingRuleRow(ruleId: string, payload: ReturnType<typeof validatePricingPayload>) {
  await prisma.$executeRawUnsafe(
    `UPDATE ModelPricingRule SET
      inputContainsVideo = ?, audioMode = ?, resolution = ?,
      minOutputDuration = ?, maxOutputDuration = ?, minInputVideoDuration = ?, maxInputVideoDuration = ?,
      minBillableInputVideoDuration = ?, pointsPerSecond = ?, costPerSecondRmb = ?, enabled = ?, remark = ?,
      updatedAt = datetime('now')
    WHERE id = ?`,
    payload.inputContainsVideo ? 1 : 0,
    payload.audioMode,
    payload.resolution,
    payload.minOutputDuration,
    payload.maxOutputDuration,
    payload.minInputVideoDuration,
    payload.maxInputVideoDuration,
    payload.minBillableInputVideoDuration,
    payload.pointsPerSecond,
    payload.costPerSecondRmb,
    payload.enabled ? 1 : 0,
    payload.remark,
    ruleId
  );
  return findPricingRuleRow(ruleId);
}

function toPublicUser(user: {
  id: string;
  email: string;
  nickname: string;
  role: string;
  balance: number;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    balance: user.balance,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

function toPublicOrder(order: {
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
  user?: { email: string; nickname: string } | null;
}) {
  return {
    id: order.id,
    userId: order.userId || "",
    userEmail: order.user?.email || "",
    userNickname: order.user?.nickname || "",
    orderNo: order.orderNo,
    amount: order.amount,
    credits: order.credits,
    paymentProvider: order.paymentProvider,
    status: order.status,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  };
}

function toPublicTask(task: {
  id: string;
  userId: string | null;
  provider: string;
  modelId: string;
  modelDisplayName: string;
  taskType: string;
  prompt: string;
  status: string;
  cost: number;
  providerTaskId: string;
  resultUrl: string;
  errorMessage: string;
  createdAt: Date;
  updatedAt: Date;
  user?: { email: string; nickname: string } | null;
}) {
  return {
    id: task.id,
    userId: task.userId,
    userEmail: task.user?.email || "",
    userNickname: task.user?.nickname || "",
    provider: task.provider,
    modelId: task.modelId,
    modelDisplayName: task.modelDisplayName,
    taskType: task.taskType,
    prompt: task.prompt,
    status: task.status,
    cost: task.cost,
    providerTaskId: task.providerTaskId,
    resultUrl: task.resultUrl,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}

function toPublicCreditLog(log: {
  id: string;
  userId: string | null;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  relatedTaskId: string | null;
  relatedOrderId: string | null;
  remark: string;
  createdAt: Date;
  user?: { email: string; nickname: string } | null;
}) {
  return {
    id: log.id,
    userId: log.userId,
    userEmail: log.user?.email || "",
    userNickname: log.user?.nickname || "",
    type: log.type,
    amount: log.amount,
    balanceBefore: log.balanceBefore,
    balanceAfter: log.balanceAfter,
    relatedTaskId: log.relatedTaskId,
    relatedOrderId: log.relatedOrderId,
    remark: log.remark,
    createdAt: log.createdAt.toISOString()
  };
}

function toPublicAdminLog(log: {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  detailJson: string;
  createdAt: Date;
}) {
  return {
    id: log.id,
    adminUserId: log.adminUserId,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    detail: parseJson(log.detailJson),
    createdAt: log.createdAt.toISOString()
  };
}

export class AdminService {
  async getStats() {
    const start = todayStart();
    const [
      userTotal,
      todayNewUsers,
      orderTotal,
      paidOrderTotal,
      rechargeAmount,
      totalBalance,
      taskTotal,
      succeededTaskTotal,
      failedTaskTotal,
      consumedCredits
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: start } } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: "paid" } }),
      prisma.order.aggregate({ where: { status: "paid" }, _sum: { amount: true } }),
      prisma.user.aggregate({ _sum: { balance: true } }),
      prisma.generationTask.count(),
      prisma.generationTask.count({ where: { status: "succeeded" } }),
      prisma.generationTask.count({ where: { status: "failed" } }),
      prisma.creditLog.aggregate({ where: { type: "consume" }, _sum: { amount: true } })
    ]);

    return {
      userTotal,
      todayNewUsers,
      orderTotal,
      paidOrderTotal,
      rechargeAmount: rechargeAmount._sum.amount || 0,
      totalBalance: totalBalance._sum.balance || 0,
      taskTotal,
      succeededTaskTotal,
      failedTaskTotal,
      consumedCredits: Math.abs(consumedCredits._sum.amount || 0)
    };
  }

  async listUsers(query: { keyword?: unknown; status?: unknown } & PageInput) {
    const pagination = getPagination(query);
    const keyword = String(query.keyword || "").trim();
    const status = String(query.status || "").trim();
    const where = {
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            OR: [{ email: { contains: keyword } }, { nickname: { contains: keyword } }]
          }
        : {})
    };
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take
      })
    ]);
    return { total, page: pagination.page, pageSize: pagination.pageSize, users: users.map(toPublicUser) };
  }

  async getUserDetail(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error(`User '${userId}' was not found.`), { status: 404 });
    const [orders, tasks, creditLogs, inviter] = await Promise.all([
      prisma.order.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.generationTask.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.creditLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
      user.invitedByUserId ? prisma.user.findUnique({ where: { id: user.invitedByUserId }, select: { id: true, email: true, role: true, inviteCode: true } }) : null
    ]);
    return {
      user: toPublicUser(user),
      inviteSource: { code: inviter?.inviteCode || null, inviter },
      orders: orders.map(toPublicOrder),
      tasks: tasks.map(toPublicTask),
      creditLogs: creditLogs.map(toPublicCreditLog)
    };
  }

  async adjustBalance(adminUserId: string, userId: string, amount: number, remark: string) {
    if (!Number.isInteger(amount) || amount === 0) {
      throw Object.assign(new Error("amount must be a non-zero integer."), { status: 400 });
    }
    return prisma.$transaction(async (tx: PrismaTransaction) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw Object.assign(new Error(`User '${userId}' was not found.`), { status: 404 });
      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore + amount;
      if (balanceAfter < 0) {
        throw Object.assign(new Error("余额不能调整为负数。"), { status: 400 });
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter }
      });
      await billingService.syncMemberLevel(tx, userId, balanceAfter);
      const creditLog = await tx.creditLog.create({
        data: {
          id: createId(),
          userId,
          type: "admin_adjust",
          amount,
          balanceBefore,
          balanceAfter,
          relatedTaskId: null,
          relatedOrderId: null,
          remark: remark || "Admin balance adjustment"
        }
      });
      const adminLog = await tx.adminLog.create({
        data: {
          id: createId(),
          adminUserId,
          action: "adjust_balance",
          targetType: "user",
          targetId: userId,
          detailJson: stringifyDetail({ amount, remark, balanceBefore, balanceAfter })
        }
      });
      log("Admin adjusted user balance", { adminUserId, userId, amount, balanceBefore, balanceAfter });
      return {
        user: toPublicUser(updated),
        creditLog: toPublicCreditLog(creditLog),
        adminLog: toPublicAdminLog(adminLog)
      };
    });
  }

  async setUserStatus(adminUserId: string, userId: string, status: "active" | "disabled") {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { status }
    });
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: status === "disabled" ? "disable_user" : "enable_user",
        targetType: "user",
        targetId: userId,
        detailJson: stringifyDetail({ status })
      }
    });
    log("Admin changed user status", { adminUserId, userId, status });
    return { user: toPublicUser(user), adminLog: toPublicAdminLog(adminLog) };
  }

  async listOrders(query: { status?: unknown; keyword?: unknown } & PageInput) {
    const pagination = getPagination(query);
    const status = String(query.status || "").trim();
    const keyword = String(query.keyword || "").trim();
    const where = {
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            OR: [{ orderNo: { contains: keyword } }, { user: { email: { contains: keyword } } }]
          }
        : {})
    };
    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: { user: { select: { email: true, nickname: true } } },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take
      })
    ]);
    return { total, page: pagination.page, pageSize: pagination.pageSize, orders: orders.map(toPublicOrder) };
  }

  async listTasks(query: { status?: unknown; modelId?: unknown; userId?: unknown } & PageInput) {
    const pagination = getPagination(query);
    const status = String(query.status || "").trim();
    const modelId = String(query.modelId || "").trim();
    const userId = String(query.userId || "").trim();
    const where = {
      ...(status ? { status } : {}),
      ...(modelId ? { modelId } : {}),
      ...(userId ? { userId } : {})
    };
    const [total, tasks] = await Promise.all([
      prisma.generationTask.count({ where }),
      prisma.generationTask.findMany({
        where,
        include: { user: { select: { email: true, nickname: true } } },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take
      })
    ]);
    return { total, page: pagination.page, pageSize: pagination.pageSize, tasks: tasks.map(toPublicTask) };
  }

  async listCreditLogs(query: { userId?: unknown; type?: unknown } & PageInput) {
    const pagination = getPagination(query);
    const userId = String(query.userId || "").trim();
    const type = String(query.type || "").trim();
    const where = {
      ...(userId ? { userId } : {}),
      ...(type ? { type } : {})
    };
    const [total, logs] = await Promise.all([
      prisma.creditLog.count({ where }),
      prisma.creditLog.findMany({
        where,
        include: { user: { select: { email: true, nickname: true } } },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take
      })
    ]);
    return { total, page: pagination.page, pageSize: pagination.pageSize, logs: logs.map(toPublicCreditLog) };
  }

  async listAdminLogs(query: PageInput) {
    const pagination = getPagination(query);
    const [total, logs] = await Promise.all([
      prisma.adminLog.count(),
      prisma.adminLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take
      })
    ]);
    return { total, page: pagination.page, pageSize: pagination.pageSize, logs: logs.map(toPublicAdminLog) };
  }

  async getModels() {
    return modelRegistryService.listAdminModels();
  }

  async updateModel(adminUserId: string, modelId: string, patch: unknown) {
    const model = await modelRegistryService.updateAdminModel(modelId, patch as Record<string, unknown>);
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: "update_model",
        targetType: "model",
        targetId: modelId,
        detailJson: stringifyDetail({ patch, modelKey: model.modelKey })
      }
    });
    log("Admin updated model", { adminUserId, modelId, modelKey: model.modelKey });
    return { model, adminLog: toPublicAdminLog(adminLog) };
  }

  async createModel(adminUserId: string, input: unknown) {
    const model = await modelRegistryService.createAdminModel(input as Record<string, unknown>);
    const defaultRules = Array.isArray((input as { defaultPricingRules?: unknown }).defaultPricingRules)
      ? ((input as { defaultPricingRules?: unknown[] }).defaultPricingRules || [])
      : [];
    const createdRules = [];
    for (const item of defaultRules) {
      const payload = validatePricingPayload(item as Record<string, unknown>);
      const rule = await insertPricingRuleRow(model.id, model.modelKey, payload);
      createdRules.push(pricingService.toPublicRule(rule as any));
    }
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: "create_model",
        targetType: "model",
        targetId: model.id,
        detailJson: stringifyDetail({ modelKey: model.modelKey, displayName: model.displayName, defaultPricingRules: createdRules.length })
      }
    });
    log("Admin created model", { adminUserId, modelId: model.id, modelKey: model.modelKey });
    return { model: { ...model, hasEnabledPricingRules: model.hasEnabledPricingRules || createdRules.some((rule) => rule.enabled) }, adminLog: toPublicAdminLog(adminLog) };
  }

  async deleteModel(adminUserId: string, modelId: string) {
    const model = await modelRegistryService.deleteAdminModel(modelId);
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: "delete_model",
        targetType: "model",
        targetId: modelId,
        detailJson: stringifyDetail({ modelKey: model.modelKey, displayName: model.displayName })
      }
    });
    log("Admin deleted model", { adminUserId, modelId, modelKey: model.modelKey });
    return { model, adminLog: toPublicAdminLog(adminLog) };
  }

  async listPricingRules(modelId: string) {
    const model = await prisma.model.findUnique({ where: { id: modelId } });
    if (!model) throw Object.assign(new Error("模型不存在。"), { status: 404 });
    const rules = await listPricingRuleRows(modelId);
    return { rules: rules.map((rule: any) => pricingService.toPublicRule(rule)) };
  }

  async createPricingRule(adminUserId: string, modelId: string, input: unknown) {
    const model = await prisma.model.findUnique({ where: { id: modelId } });
    if (!model) throw Object.assign(new Error("模型不存在。"), { status: 404 });
    const payload = validatePricingPayload(input as Record<string, unknown>);
    const rule = await insertPricingRuleRow(modelId, model.modelKey, payload);
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: "create_pricing_rule",
        targetType: "pricing_rule",
        targetId: rule.id,
        detailJson: stringifyDetail({ modelKey: model.modelKey, rule: pricingService.toPublicRule(rule as any) })
      }
    });
    return { rule: pricingService.toPublicRule(rule as any), adminLog: toPublicAdminLog(adminLog) };
  }

  async updatePricingRule(adminUserId: string, ruleId: string, patch: unknown) {
    const existing = await findPricingRuleRow(ruleId);
    if (!existing) throw Object.assign(new Error("计费规则不存在。"), { status: 404 });
    const payload = validatePricingPayload(patch as Record<string, unknown>, existing as Record<string, unknown>);
    const rule = await updatePricingRuleRow(ruleId, payload);
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: "update_pricing_rule",
        targetType: "pricing_rule",
        targetId: ruleId,
        detailJson: stringifyDetail({ patch, rule: pricingService.toPublicRule(rule as any) })
      }
    });
    return { rule: pricingService.toPublicRule(rule as any), adminLog: toPublicAdminLog(adminLog) };
  }

  async deletePricingRule(adminUserId: string, ruleId: string) {
    const existing = await findPricingRuleRow(ruleId);
    if (!existing) throw Object.assign(new Error("计费规则不存在。"), { status: 404 });
    await prisma.$executeRawUnsafe("DELETE FROM ModelPricingRule WHERE id = ?", ruleId);
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: "delete_pricing_rule",
        targetType: "pricing_rule",
        targetId: ruleId,
        detailJson: stringifyDetail(pricingService.toPublicRule(existing as any))
      }
    });
    return { rule: pricingService.toPublicRule(existing as any), adminLog: toPublicAdminLog(adminLog) };
  }

  async getProviders() {
    return modelRegistryService.listAdminProviders();
  }

  async updateProvider(adminUserId: string, providerId: string, patch: unknown) {
    const provider = await modelRegistryService.updateAdminProvider(providerId, patch as Record<string, unknown>);
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: "update_provider",
        targetType: "provider",
        targetId: providerId,
        detailJson: stringifyDetail({ patch, providerKey: provider.providerKey })
      }
    });
    log("Admin updated provider", { adminUserId, providerId, providerKey: provider.providerKey });
    return { provider, adminLog: toPublicAdminLog(adminLog) };
  }

  async createProvider(adminUserId: string, input: unknown) {
    const provider = await modelRegistryService.createAdminProvider(input as Record<string, unknown>);
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: "create_provider",
        targetType: "provider",
        targetId: provider.id,
        detailJson: stringifyDetail({ providerKey: provider.providerKey, displayName: provider.displayName })
      }
    });
    log("Admin created provider", { adminUserId, providerId: provider.id, providerKey: provider.providerKey });
    return { provider, adminLog: toPublicAdminLog(adminLog) };
  }

  async deleteProvider(adminUserId: string, providerId: string) {
    const provider = await modelRegistryService.deleteAdminProvider(providerId);
    const adminLog = await prisma.adminLog.create({
      data: {
        id: createId(),
        adminUserId,
        action: "delete_provider",
        targetType: "provider",
        targetId: providerId,
        detailJson: stringifyDetail({ providerKey: provider.providerKey, displayName: provider.displayName })
      }
    });
    log("Admin deleted provider", { adminUserId, providerId, providerKey: provider.providerKey });
    return { provider, adminLog: toPublicAdminLog(adminLog) };
  }
}

export const adminService = new AdminService();
