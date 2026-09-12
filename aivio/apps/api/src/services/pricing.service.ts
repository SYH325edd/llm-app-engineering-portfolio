import { prisma } from "./database.service.js";

export const VIDEO_CREDIT_RATE = 100;
export const VIDEO_RETAIL_MULTIPLIER = 1.2;

export type AudioMode = "audio" | "silent" | "default";

export type VideoPricingInput = {
  modelId: string;
  inputContainsVideo?: boolean;
  inputVideoDuration?: number | string | null;
  outputDuration?: number | string | null;
  resolution?: string | null;
  audioMode?: string | null;
  count?: number | string | null;
};

type PricingRuleRow = {
  id: string;
  modelId: string;
  modelKeySnapshot: string;
  inputContainsVideo: boolean;
  audioMode: string | null;
  resolution: string;
  minOutputDuration: number;
  maxOutputDuration: number;
  minInputVideoDuration: number | null;
  maxInputVideoDuration: number | null;
  minBillableInputVideoDuration: number | null;
  pointsPerSecond: number;
  costPerSecondRmb: number | null;
  enabled: boolean;
  remark: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ModelWithProvider = {
  id: string;
  modelKey: string;
  displayName: string;
  enabled: boolean;
  modelType: string;
  provider: {
    id: string;
    providerKey: string;
    displayName: string;
    enabled: boolean;
  };
};

export type VideoRetailCreditOptions = {
  baseRetailCnyPerSecond: number;
  seconds: number;
};

export function calculateVideoRetailCredits(options: VideoRetailCreditOptions) {
  const baseRetailCnyPerSecond = Number(options.baseRetailCnyPerSecond);
  const seconds = Number(options.seconds);
  const billableCnyPerSecond = baseRetailCnyPerSecond * VIDEO_RETAIL_MULTIPLIER;
  const totalCny = billableCnyPerSecond * seconds;
  const totalCredits = Math.ceil(totalCny * VIDEO_CREDIT_RATE);

  return {
    baseRetailCnyPerSecond,
    billableCnyPerSecond,
    seconds,
    totalCny,
    totalCredits,
    currency: "CNY" as const,
    creditRate: VIDEO_CREDIT_RATE,
    retailMultiplier: VIDEO_RETAIL_MULTIPLIER
  };
}

function intFrom(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw Object.assign(new Error(`${field} 必须是整数。`), { status: 400 });
  }
  return parsed;
}

function boolFrom(value: unknown): boolean {
  if (value === true || value === "true") return true;
  return false;
}

function normalizeResolution(value: unknown): string {
  return String(value || "720p").trim().toLowerCase();
}

function normalizeAudioMode(value: unknown): AudioMode {
  const mode = String(value || "default").trim().toLowerCase();
  if (mode === "audio" || mode === "silent") return mode;
  return "default";
}

function toPublicRule(rule: PricingRuleRow) {
  const toIso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  const billableCreditsPerSecond = rule.pointsPerSecond;
  const billableCnyPerSecond = billableCreditsPerSecond / VIDEO_CREDIT_RATE;
  const baseRetailCnyPerSecond = billableCnyPerSecond / VIDEO_RETAIL_MULTIPLIER;
  return {
    id: rule.id,
    modelId: rule.modelId,
    modelKeySnapshot: rule.modelKeySnapshot,
    inputContainsVideo: Boolean(rule.inputContainsVideo),
    audioMode: rule.audioMode || "default",
    resolution: rule.resolution,
    minOutputDuration: rule.minOutputDuration,
    maxOutputDuration: rule.maxOutputDuration,
    minInputVideoDuration: rule.minInputVideoDuration,
    maxInputVideoDuration: rule.maxInputVideoDuration,
    minBillableInputVideoDuration: rule.minBillableInputVideoDuration,
    pointsPerSecond: rule.pointsPerSecond,
    baseRetailCnyPerSecond,
    billableCnyPerSecond,
    billableCreditsPerSecond,
    currency: "CNY" as const,
    creditRate: VIDEO_CREDIT_RATE,
    retailMultiplier: VIDEO_RETAIL_MULTIPLIER,
    costPerSecondRmb: rule.costPerSecondRmb,
    enabled: Boolean(rule.enabled),
    remark: rule.remark,
    createdAt: toIso(rule.createdAt),
    updatedAt: toIso(rule.updatedAt)
  };
}

async function findPricingRule(where: {
  modelId: string;
  resolution: string;
  enabled: boolean;
  inputContainsVideo?: boolean;
  audioMode?: string;
}): Promise<PricingRuleRow | null> {
  const clauses = ["modelId = ?", "resolution = ?", "enabled = ?"];
  const params: unknown[] = [where.modelId, where.resolution, where.enabled ? 1 : 0];
  if (where.inputContainsVideo !== undefined) {
    clauses.push("inputContainsVideo = ?");
    params.push(where.inputContainsVideo ? 1 : 0);
  }
  if (where.audioMode !== undefined) {
    clauses.push("audioMode = ?");
    params.push(where.audioMode);
  }
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT * FROM ModelPricingRule WHERE ${clauses.join(" AND ")} ORDER BY createdAt ASC LIMIT 1`,
    ...params
  )) as PricingRuleRow[];
  return rows[0] || null;
}

export function buildPricingRemark(input: {
  modelDisplayName: string;
  resolution: string;
  outputDuration: number;
  inputContainsVideo: boolean;
  inputVideoDuration?: number | null;
  count: number;
  audioMode: AudioMode;
  cost: number;
}) {
  const modeText = input.inputContainsVideo ? "视频参考生成" : "文生/图生视频";
  const inputText = input.inputContainsVideo ? `，输入视频 ${input.inputVideoDuration ?? 0}s` : "";
  const audioText = input.audioMode === "default" ? "默认" : input.audioMode === "audio" ? "有声" : "无声";
  return `视频生成扣费：${input.modelDisplayName}，${modeText}，${input.resolution}，输出 ${input.outputDuration}s${inputText}，数量 ${input.count}，声音模式 ${audioText}，消耗 ${input.cost} 积分。`;
}

export class PricingService {
  toPublicRule(rule: PricingRuleRow) {
    return toPublicRule(rule);
  }

  async calculateVideoGenerationCost(params: VideoPricingInput) {
    const modelId = String(params.modelId || "").trim();
    if (!modelId) throw Object.assign(new Error("modelId is required."), { status: 400 });

    const model = (await prisma.model.findFirst({
      where: { OR: [{ id: modelId }, { modelKey: modelId }] },
      include: { provider: true }
    })) as ModelWithProvider | null;
    if (!model) throw Object.assign(new Error(`Video model '${modelId}' was not found.`), { status: 404 });
    if (!model.enabled || model.modelType !== "video") {
      throw Object.assign(new Error("当前模型已禁用或不可用于视频生成。"), { status: 400 });
    }
    if (!model.provider?.enabled) {
      throw Object.assign(new Error("当前模型供应商已禁用。"), { status: 400 });
    }

    const outputDuration = intFrom(params.outputDuration, 8, "输出视频时长");
    if (outputDuration < 4 || outputDuration > 15) {
      throw Object.assign(new Error("输出视频时长必须在 4 到 15 秒之间。"), { status: 400 });
    }

    const count = intFrom(params.count, 1, "生成数量");
    if (count < 1 || count > 4) {
      throw Object.assign(new Error("生成数量必须在 1 到 4 之间。"), { status: 400 });
    }

    const inputContainsVideo = boolFrom(params.inputContainsVideo);
    const inputVideoDuration = inputContainsVideo ? intFrom(params.inputVideoDuration, 4, "输入视频时长") : null;
    if (inputContainsVideo && (inputVideoDuration === null || inputVideoDuration < 2 || inputVideoDuration > 15)) {
      throw Object.assign(new Error("输入视频时长必须在 2 到 15 秒之间。"), { status: 400 });
    }

    const resolution = normalizeResolution(params.resolution);
    const audioMode = normalizeAudioMode(params.audioMode);
    const isSeedance15 = model.modelKey.includes("seedance-1-5-pro");

    const where = isSeedance15
      ? {
          modelId: model.id,
          resolution,
          enabled: true,
          audioMode: audioMode === "default" ? "silent" : audioMode
        }
      : {
          modelId: model.id,
          resolution,
          enabled: true,
          inputContainsVideo,
          audioMode: "default"
        };

    const rule = await findPricingRule(where);
    if (!rule) {
      const disabledRule = await findPricingRule({ ...where, enabled: false });
      if (disabledRule?.remark) {
        throw Object.assign(new Error(disabledRule.remark), { status: 400 });
      }
      throw Object.assign(new Error("当前模型暂未配置该参数的计费规则，请联系管理员。"), { status: 400 });
    }
    if (outputDuration < rule.minOutputDuration || outputDuration > rule.maxOutputDuration) {
      throw Object.assign(new Error("输出视频时长必须在 4 到 15 秒之间。"), { status: 400 });
    }
    if (inputContainsVideo) {
      const minInput = rule.minInputVideoDuration ?? 2;
      const maxInput = rule.maxInputVideoDuration ?? 15;
      if (inputVideoDuration === null || inputVideoDuration < minInput || inputVideoDuration > maxInput) {
        throw Object.assign(new Error(`输入视频时长必须在 ${minInput} 到 ${maxInput} 秒之间。`), { status: 400 });
      }
    }

    const minBillableInput = rule.minBillableInputVideoDuration ?? 4;
    const billableInputDuration = inputContainsVideo ? Math.max(inputVideoDuration ?? 4, minBillableInput) : 0;
    const billableDuration = inputContainsVideo ? outputDuration + billableInputDuration : outputDuration;
    const billableCreditsPerSecond = rule.pointsPerSecond;
    const billableCnyPerSecond = billableCreditsPerSecond / VIDEO_CREDIT_RATE;
    const baseRetailCnyPerSecond = billableCnyPerSecond / VIDEO_RETAIL_MULTIPLIER;
    const totalCredits = Math.ceil(billableCreditsPerSecond * billableDuration * count);
    const totalCny = totalCredits / VIDEO_CREDIT_RATE;
    const cost = totalCredits;
    const formula = inputContainsVideo
      ? `${billableCreditsPerSecond} credits/s × (${outputDuration} + max(${inputVideoDuration}, ${minBillableInput})) × ${count}`
      : `${billableCreditsPerSecond} credits/s × ${outputDuration} × ${count}`;

    return {
      cost,
      model: {
        id: model.id,
        modelKey: model.modelKey,
        displayName: model.displayName,
        providerKey: model.provider.providerKey
      },
      rule: toPublicRule(rule),
      breakdown: {
        resolution,
        inputContainsVideo,
        inputVideoDuration,
        outputDuration,
        billableInputDuration,
        billableDuration,
        count,
        audioMode: isSeedance15 ? (audioMode === "default" ? "silent" : audioMode) : "default",
        baseRetailCnyPerSecond,
        billableCnyPerSecond,
        billableCreditsPerSecond,
        totalCny,
        totalCredits,
        currency: "CNY",
        creditRate: VIDEO_CREDIT_RATE,
        retailMultiplier: VIDEO_RETAIL_MULTIPLIER,
        pointsPerSecond: billableCreditsPerSecond,
        formula
      }
    };
  }
}

export const pricingService = new PricingService();
