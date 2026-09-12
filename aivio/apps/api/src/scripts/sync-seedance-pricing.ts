import { prisma } from "../services/database.service.js";
import { createId } from "../utils/id.js";

type SeedanceRule = {
  key: string;
  inputContainsVideo: boolean;
  audioMode: "audio" | "silent" | "default";
  resolution: "480p" | "720p" | "1080p";
  minOutputDuration: number;
  maxOutputDuration: number;
  minInputVideoDuration?: number | null;
  maxInputVideoDuration?: number | null;
  minBillableInputVideoDuration?: number | null;
  pointsPerSecond: number;
  costPerSecondRmb?: number | null;
  enabled: boolean;
  remark?: string;
};

type ModelRow = {
  id: string;
  modelKey: string;
  modelType: string;
};

const MODEL_PREFIXES = [
  "ep-20260527143333-wf4ml",
  "doubao-seedance-2-0-mini",
  "doubao-seedance-2-0-fast",
  "doubao-seedance-2-0",
  "doubao-seedance-1-5-pro",
  "doubao-seedance-1-0-pro-fast",
  "doubao-seedance-1-0-pro",
  "doubao-seedance-1-0-lite"
];

const VIDEO_CREDIT_RATE = 100;
const VIDEO_RETAIL_MULTIPLIER = 1.2;

function billableRetailCreditsFromCny(baseRetailCnyPerSecond: number) {
  return Math.ceil(baseRetailCnyPerSecond * VIDEO_RETAIL_MULTIPLIER * VIDEO_CREDIT_RATE);
}

const rule = (input: Omit<SeedanceRule, "minOutputDuration" | "maxOutputDuration">): SeedanceRule => ({
  minOutputDuration: 4,
  maxOutputDuration: 15,
  ...input,
  pointsPerSecond: typeof input.costPerSecondRmb === "number"
    ? Math.ceil(input.costPerSecondRmb * VIDEO_RETAIL_MULTIPLIER * VIDEO_CREDIT_RATE)
    : input.pointsPerSecond
});

const noVideo20 = [
  rule({ key: "doubao-seedance-2-0", inputContainsVideo: false, audioMode: "default", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(1.2), costPerSecondRmb: 0.462, enabled: true }),
  rule({ key: "doubao-seedance-2-0", inputContainsVideo: false, audioMode: "default", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(2.5), costPerSecondRmb: 0.994, enabled: true }),
  rule({ key: "doubao-seedance-2-0", inputContainsVideo: false, audioMode: "default", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(5.6), costPerSecondRmb: 2.478, enabled: true }),
  rule({ key: "doubao-seedance-2-0-fast", inputContainsVideo: false, audioMode: "default", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(0.9), costPerSecondRmb: 0.372, enabled: true }),
  rule({ key: "doubao-seedance-2-0-fast", inputContainsVideo: false, audioMode: "default", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(2), costPerSecondRmb: 0.8, enabled: true }),
  rule({ key: "doubao-seedance-2-0-fast", inputContainsVideo: false, audioMode: "default", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(4.5), costPerSecondRmb: null, enabled: true })
];

const videoInput20 = [
  rule({ key: "doubao-seedance-2-0", inputContainsVideo: true, audioMode: "default", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(1.2), costPerSecondRmb: 0.2812, minInputVideoDuration: 2, maxInputVideoDuration: 15, minBillableInputVideoDuration: 4, enabled: true }),
  rule({ key: "doubao-seedance-2-0", inputContainsVideo: true, audioMode: "default", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(2.5), costPerSecondRmb: 0.605, minInputVideoDuration: 2, maxInputVideoDuration: 15, minBillableInputVideoDuration: 4, enabled: true }),
  rule({ key: "doubao-seedance-2-0", inputContainsVideo: true, audioMode: "default", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(5.6), costPerSecondRmb: 1.5062, minInputVideoDuration: 2, maxInputVideoDuration: 15, minBillableInputVideoDuration: 4, enabled: true }),
  rule({ key: "doubao-seedance-2-0-fast", inputContainsVideo: true, audioMode: "default", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(0.9), costPerSecondRmb: 0.2212, minInputVideoDuration: 2, maxInputVideoDuration: 15, minBillableInputVideoDuration: 4, enabled: true }),
  rule({ key: "doubao-seedance-2-0-fast", inputContainsVideo: true, audioMode: "default", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(2), costPerSecondRmb: 0.4757, minInputVideoDuration: 2, maxInputVideoDuration: 15, minBillableInputVideoDuration: 4, enabled: true }),
  rule({ key: "doubao-seedance-2-0-fast", inputContainsVideo: true, audioMode: "default", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(4.5), costPerSecondRmb: null, minInputVideoDuration: 2, maxInputVideoDuration: 15, minBillableInputVideoDuration: 4, enabled: true })
];

const pro15 = [
  rule({ key: "doubao-seedance-1-5-pro", inputContainsVideo: false, audioMode: "audio", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(0.5), costPerSecondRmb: 0.16, enabled: true }),
  rule({ key: "doubao-seedance-1-5-pro", inputContainsVideo: false, audioMode: "audio", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(1), costPerSecondRmb: 0.346, enabled: true }),
  rule({ key: "doubao-seedance-1-5-pro", inputContainsVideo: false, audioMode: "audio", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(2.5), costPerSecondRmb: 0.778, enabled: true }),
  rule({ key: "doubao-seedance-1-5-pro", inputContainsVideo: false, audioMode: "silent", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(0.5), costPerSecondRmb: 0.08, enabled: true }),
  rule({ key: "doubao-seedance-1-5-pro", inputContainsVideo: false, audioMode: "silent", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(1), costPerSecondRmb: 0.172, enabled: true }),
  rule({ key: "doubao-seedance-1-5-pro", inputContainsVideo: false, audioMode: "silent", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(2.5), costPerSecondRmb: 0.388, enabled: true })
];

const pro10 = [
  rule({ key: "doubao-seedance-1-0-pro", inputContainsVideo: false, audioMode: "default", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(0.5), costPerSecondRmb: 0.151, enabled: true, remark: "按 token 公式估算，非火山方舟官方示例价" }),
  rule({ key: "doubao-seedance-1-0-pro", inputContainsVideo: false, audioMode: "default", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(1), costPerSecondRmb: 0.324, enabled: true, remark: "按 token 公式估算，非火山方舟官方示例价" }),
  rule({ key: "doubao-seedance-1-0-pro", inputContainsVideo: false, audioMode: "default", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(2), costPerSecondRmb: 0.729, enabled: true, remark: "按 token 公式估算，非火山方舟官方示例价" }),
  rule({ key: "doubao-seedance-1-0-pro-fast", inputContainsVideo: false, audioMode: "default", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(0.2), costPerSecondRmb: 0.042, enabled: true, remark: "按 token 公式估算，非火山方舟官方示例价" }),
  rule({ key: "doubao-seedance-1-0-pro-fast", inputContainsVideo: false, audioMode: "default", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(0.5), costPerSecondRmb: 0.091, enabled: true, remark: "按 token 公式估算，非火山方舟官方示例价" }),
  rule({ key: "doubao-seedance-1-0-pro-fast", inputContainsVideo: false, audioMode: "default", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(1), costPerSecondRmb: 0.204, enabled: true, remark: "按 token 公式估算，非火山方舟官方示例价" })
];

const seedance10FastEndpoint = [
  rule({ key: "ep-20260527143333-wf4ml", inputContainsVideo: false, audioMode: "default", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(0.2), costPerSecondRmb: null, enabled: true, remark: "Seedance 1.0 Fast 默认计费规则" }),
  rule({ key: "ep-20260527143333-wf4ml", inputContainsVideo: false, audioMode: "default", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(0.5), costPerSecondRmb: null, enabled: true, remark: "Seedance 1.0 Fast 默认计费规则" }),
  rule({ key: "ep-20260527143333-wf4ml", inputContainsVideo: false, audioMode: "default", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(1), costPerSecondRmb: null, enabled: true, remark: "Seedance 1.0 Fast 默认计费规则" })
];

const mini20 = [
  rule({ key: "doubao-seedance-2-0-mini", inputContainsVideo: false, audioMode: "default", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(0.6), costPerSecondRmb: null, enabled: true }),
  rule({ key: "doubao-seedance-2-0-mini", inputContainsVideo: false, audioMode: "default", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(1.3), costPerSecondRmb: null, enabled: true }),
  rule({ key: "doubao-seedance-2-0-mini", inputContainsVideo: false, audioMode: "default", resolution: "1080p", pointsPerSecond: 0, costPerSecondRmb: null, enabled: false, remark: "当前模型不支持 1080p" })
];

const lite10 = [
  rule({ key: "doubao-seedance-1-0-lite", inputContainsVideo: false, audioMode: "default", resolution: "480p", pointsPerSecond: billableRetailCreditsFromCny(0.4), costPerSecondRmb: null, enabled: true }),
  rule({ key: "doubao-seedance-1-0-lite", inputContainsVideo: false, audioMode: "default", resolution: "720p", pointsPerSecond: billableRetailCreditsFromCny(0.8), costPerSecondRmb: null, enabled: true }),
  rule({ key: "doubao-seedance-1-0-lite", inputContainsVideo: false, audioMode: "default", resolution: "1080p", pointsPerSecond: billableRetailCreditsFromCny(1.5), costPerSecondRmb: null, enabled: true })
];

const SEEDANCE_RULES = [...seedance10FastEndpoint, ...noVideo20, ...videoInput20, ...mini20, ...pro15, ...pro10, ...lite10];

function modelPrefix(modelKey: string) {
  return MODEL_PREFIXES.find((prefix) => modelKey.startsWith(prefix));
}

async function upsertRule(model: { id: string; modelKey: string }, input: SeedanceRule) {
  const existingRows = (await prisma.$queryRawUnsafe(
    "SELECT id FROM ModelPricingRule WHERE modelId = ? AND inputContainsVideo = ? AND audioMode = ? AND resolution = ? LIMIT 1",
    model.id,
    input.inputContainsVideo ? 1 : 0,
    input.audioMode,
    input.resolution
  )) as Array<{ id: string }>;
  const existing = existingRows[0];
  const data = {
    modelKeySnapshot: model.modelKey,
    inputContainsVideo: input.inputContainsVideo,
    audioMode: input.audioMode,
    resolution: input.resolution,
    minOutputDuration: input.minOutputDuration,
    maxOutputDuration: input.maxOutputDuration,
    minInputVideoDuration: input.minInputVideoDuration ?? null,
    maxInputVideoDuration: input.maxInputVideoDuration ?? null,
    minBillableInputVideoDuration: input.minBillableInputVideoDuration ?? null,
    pointsPerSecond: input.pointsPerSecond,
    costPerSecondRmb: input.costPerSecondRmb ?? null,
    enabled: input.enabled,
    remark: input.remark || ""
  };
  if (existing) {
    await prisma.$executeRawUnsafe(
      `UPDATE ModelPricingRule SET
        modelKeySnapshot = ?, inputContainsVideo = ?, audioMode = ?, resolution = ?,
        minOutputDuration = ?, maxOutputDuration = ?, minInputVideoDuration = ?, maxInputVideoDuration = ?,
        minBillableInputVideoDuration = ?, pointsPerSecond = ?, costPerSecondRmb = ?, enabled = ?, remark = ?,
        updatedAt = datetime('now')
      WHERE id = ?`,
      data.modelKeySnapshot,
      data.inputContainsVideo ? 1 : 0,
      data.audioMode,
      data.resolution,
      data.minOutputDuration,
      data.maxOutputDuration,
      data.minInputVideoDuration,
      data.maxInputVideoDuration,
      data.minBillableInputVideoDuration,
      data.pointsPerSecond,
      data.costPerSecondRmb,
      data.enabled ? 1 : 0,
      data.remark,
      existing.id
    );
    return "updated";
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO ModelPricingRule (
      id, modelId, modelKeySnapshot, inputContainsVideo, audioMode, resolution,
      minOutputDuration, maxOutputDuration, minInputVideoDuration, maxInputVideoDuration,
      minBillableInputVideoDuration, pointsPerSecond, costPerSecondRmb, enabled, remark,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    createId(),
    model.id,
    data.modelKeySnapshot,
    data.inputContainsVideo ? 1 : 0,
    data.audioMode,
    data.resolution,
    data.minOutputDuration,
    data.maxOutputDuration,
    data.minInputVideoDuration,
    data.maxInputVideoDuration,
    data.minBillableInputVideoDuration,
    data.pointsPerSecond,
    data.costPerSecondRmb,
    data.enabled ? 1 : 0,
    data.remark
  );
  return "created";
}

async function main() {
  const models = (await prisma.model.findMany({ where: { modelType: "video" }, orderBy: { modelKey: "asc" } })) as ModelRow[];
  for (const prefix of MODEL_PREFIXES) {
    const found = models.find((model) => model.modelKey.startsWith(prefix));
    if (!found) console.warn(`[warn] 未找到模型：${prefix}`);
  }

  for (const model of models) {
    const prefix = modelPrefix(model.modelKey);
    if (!prefix) continue;
    const rules = SEEDANCE_RULES.filter((item) => item.key === prefix);
    if (!rules.length) continue;
    const summary: string[] = [];
    for (const item of rules) {
      const action = await upsertRule(model, item);
      summary.push(`${action}:${item.inputContainsVideo ? "含视频" : "无视频"}:${item.audioMode}:${item.resolution}:${item.enabled ? item.pointsPerSecond : "disabled"}`);
    }
    console.log(`[ok] ${model.modelKey}`);
    for (const line of summary) console.log(`  - ${line}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
