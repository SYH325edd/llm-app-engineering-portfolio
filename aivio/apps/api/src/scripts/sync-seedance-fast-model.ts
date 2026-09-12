import { prisma } from "../services/database.service.js";
import { createId } from "../utils/id.js";

const PROVIDER_KEY = "volcengine";
const MODEL_KEY = "ep-20260527143333-wf4ml";
const MODEL_DISPLAY_NAME = "Doubao Seedance 1.0 Fast";
const OLD_DUPLICATE_MODEL_KEYS = ["doubao-seedance-1-0-pro-fast-250528"];
const RESTORED_MODEL_KEYS = [
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-1-5-pro-251215",
  "doubao-seedance-1-0-pro-250428",
  "doubao-seedance-1-0-lite-t2v-250219",
  "doubao-seedance-1-0-lite-i2v-250219"
];

const pricingRules = [
  { resolution: "480p", pointsPerSecond: 1 },
  { resolution: "720p", pointsPerSecond: 2 },
  { resolution: "1080p", pointsPerSecond: 4 }
] as const;

async function ensureProvider() {
  return prisma.provider.upsert({
    where: { providerKey: PROVIDER_KEY },
    create: {
      id: createId(),
      providerKey: PROVIDER_KEY,
      displayName: "Volcengine Ark",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKeyEnvName: "VOLCENGINE_ARK_API_KEY",
      enabled: true,
      configJson: JSON.stringify({ adapter: "volcengine" })
    },
    update: {
      displayName: "Volcengine Ark",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKeyEnvName: "VOLCENGINE_ARK_API_KEY",
      enabled: true,
      configJson: JSON.stringify({ adapter: "volcengine" })
    }
  });
}

async function upsertPricingRule(modelId: string, resolution: string, pointsPerSecond: number) {
  const existing = (await prisma.$queryRawUnsafe(
    "SELECT id FROM ModelPricingRule WHERE modelId = ? AND inputContainsVideo = ? AND audioMode = ? AND resolution = ? LIMIT 1",
    modelId,
    0,
    "default",
    resolution
  )) as Array<{ id: string }>;

  const ruleId = existing[0]?.id || createId();
  if (existing[0]) {
    await prisma.$executeRawUnsafe(
      `UPDATE ModelPricingRule SET
        modelKeySnapshot = ?, inputContainsVideo = ?, audioMode = ?, resolution = ?,
        minOutputDuration = ?, maxOutputDuration = ?, minInputVideoDuration = ?, maxInputVideoDuration = ?,
        minBillableInputVideoDuration = ?, pointsPerSecond = ?, costPerSecondRmb = ?, enabled = ?, remark = ?,
        updatedAt = datetime('now')
      WHERE id = ?`,
      MODEL_KEY,
      0,
      "default",
      resolution,
      4,
      15,
      null,
      null,
      null,
      pointsPerSecond,
      null,
      1,
      "Seedance 1.0 Fast 默认计费规则",
      ruleId
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO ModelPricingRule (
      id, modelId, modelKeySnapshot, inputContainsVideo, audioMode, resolution,
      minOutputDuration, maxOutputDuration, minInputVideoDuration, maxInputVideoDuration,
      minBillableInputVideoDuration, pointsPerSecond, costPerSecondRmb, enabled, remark,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ruleId,
    modelId,
    MODEL_KEY,
    0,
    "default",
    resolution,
    4,
    15,
    null,
    null,
    null,
    pointsPerSecond,
    null,
    1,
    "Seedance 1.0 Fast 默认计费规则"
  );
}

async function main() {
  const provider = await ensureProvider();

  const restored = await prisma.model.updateMany({
    where: { modelKey: { in: RESTORED_MODEL_KEYS } },
    data: { enabled: true }
  });

  const disabledDuplicates = await prisma.model.updateMany({
    where: { modelKey: { in: OLD_DUPLICATE_MODEL_KEYS } },
    data: {
      displayName: "Doubao Seedance 1.0 Pro Fast (old, unavailable)",
      enabled: false
    }
  });

  const model = await prisma.model.upsert({
    where: { modelKey: MODEL_KEY },
    create: {
      id: createId(),
      modelKey: MODEL_KEY,
      providerId: provider.id,
      displayName: MODEL_DISPLAY_NAME,
      modelType: "video",
      inputType: "text,image",
      outputType: "video",
      price: 10,
      enabled: true,
      sortOrder: 1,
      configJson: "{}"
    },
    update: {
      providerId: provider.id,
      displayName: MODEL_DISPLAY_NAME,
      modelType: "video",
      inputType: "text,image",
      outputType: "video",
      price: 10,
      enabled: true,
      sortOrder: 1,
      configJson: "{}"
    }
  });

  for (const rule of pricingRules) {
    await upsertPricingRule(model.id, rule.resolution, rule.pointsPerSecond);
  }

  console.log(JSON.stringify({
    ok: true,
    modelKey: MODEL_KEY,
    displayName: MODEL_DISPLAY_NAME,
    restoredModels: restored.count,
    disabledDuplicateModels: disabledDuplicates.count,
    pricingRules: pricingRules.length
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
