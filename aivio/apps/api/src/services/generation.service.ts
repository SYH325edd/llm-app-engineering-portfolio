import { agnesProvider } from "../providers/agnes/index.js";
import {
  AGNES_FIRST_LAST_FRAME_UNSUPPORTED_MESSAGE,
  AGNES_PUBLIC_ASSET_BASE_URL_REQUIRED_MESSAGE,
  AGNES_REFERENCE_VIDEO_UNSUPPORTED_MESSAGE,
  isAgnesPublicAssetUrl
} from "../providers/agnes/video.js";
import { volcengineProvider } from "../providers/volcengine/index.js";
import { extractVolcengineResultUrl } from "../providers/volcengine/video.js";
import type { VideoProviderAdapter } from "../providers/provider.interface.js";
import { billingService, INSUFFICIENT_BALANCE_MESSAGE } from "./billing.service.js";
import { assetService } from "./asset.service.js";
import { authService } from "./auth.service.js";
import { modelRegistryService } from "./model-registry.service.js";
import { buildPricingRemark, pricingService } from "./pricing.service.js";
import { taskDbStore } from "./task-db-store.service.js";
import type { GenerationTask, VideoGenerationRequest } from "../types/generation.js";

const videoAdapters: Record<string, VideoProviderAdapter> = {
  agnes: agnesProvider,
  volcengine: volcengineProvider
};

const AGNES_INITIAL_STATUS_DELAY_MS = 120_000;
const AGNES_STATUS_QUERY_INTERVAL_MS = 60_000;
const AGNES_RATE_LIMIT_COOLDOWN_MS = 180_000;
const STATUS_QUERY_COOLDOWN_MESSAGE = "状态查询冷却中，请稍后再试";
const agnesStatusFlights = new Map<string, Promise<GenerationTask>>();

function getPayloadParams(payload: VideoGenerationRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const skip = new Set(["model", "modelId", "prompt", "apiKey", "baseUrl", "provider"]);
  for (const [key, value] of Object.entries(payload)) {
    if (skip.has(key)) continue;
    params[key] = value;
  }
  return params;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isoFromMs(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTerminalTaskStatus(status: unknown): boolean {
  return ["succeeded", "completed", "failed", "cancelled", "refunded"].includes(String(status));
}

function isAgnesStatusRateLimit(error: unknown): boolean {
  const status = (error as { status?: unknown }).status;
  return status === 429 || /video status query rate limit exceeded/i.test(extractErrorMessage(error));
}

function withStatusMessage(task: GenerationTask, statusMessage: string): GenerationTask {
  return { ...task, statusMessage };
}

function getStatusPollingEntry(task: GenerationTask, videoId: string): {
  lastStatusCheckedAt: string | null;
  nextAllowedStatusCheckAt: string | null;
  statusMessage?: string;
} {
  const polling = isRecord(task.params.statusPolling) ? task.params.statusPolling : {};
  const entry = isRecord(polling[videoId]) ? polling[videoId] : {};
  const lastStatusCheckedAt = typeof entry.lastStatusCheckedAt === "string" ? entry.lastStatusCheckedAt : null;
  const nextAllowedStatusCheckAt = typeof entry.nextAllowedStatusCheckAt === "string" ? entry.nextAllowedStatusCheckAt : null;
  const statusMessage = typeof entry.statusMessage === "string" ? entry.statusMessage : undefined;
  return { lastStatusCheckedAt, nextAllowedStatusCheckAt, statusMessage };
}

function withStatusPollingEntry(
  params: Record<string, unknown>,
  videoId: string,
  entry: {
    lastStatusCheckedAt?: string | null;
    nextAllowedStatusCheckAt?: string | null;
    statusMessage?: string;
  }
): Record<string, unknown> {
  const polling = isRecord(params.statusPolling) ? params.statusPolling : {};
  const current = isRecord(polling[videoId]) ? polling[videoId] : {};
  return {
    ...params,
    statusPolling: {
      ...polling,
      [videoId]: {
        ...current,
        ...entry
      }
    }
  };
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => text(item)).filter(Boolean);
  return [];
}

function inferInputType(payload: VideoGenerationRequest): string {
  const explicit = text(payload.inputType);
  if (explicit) return explicit;
  if (payload.inputContainsVideo || payload.referenceVideoAssetId) return "video";
  if (payload.firstFrameAssetId || payload.lastFrameAssetId || payload.imageUrl || payload.endImageUrl) return "image";
  return "text";
}

function validateAgnesInput(
  providerKey: string,
  providerAdapter: string,
  payload: VideoGenerationRequest,
  assetInputs: Awaited<ReturnType<typeof resolveAssetInputs>>
): void {
  if (providerKey !== "agnes" && providerAdapter !== "agnes") return;

  const explicitInputType = text(payload.inputType).toLowerCase();
  const imageMode = text(payload.imageMode).toLowerCase();
  const hasReferenceVideo = Boolean(
    assetInputs.inputContainsVideo
    || assetInputs.referenceVideoAssetId
    || text(payload.referenceVideoAssetId)
    || text(payload.referenceVideoUrl)
    || explicitInputType === "video"
  );
  if (hasReferenceVideo) {
    throw Object.assign(new Error(AGNES_REFERENCE_VIDEO_UNSUPPORTED_MESSAGE), { status: 400 });
  }
  if (imageMode === "first_last_frame") {
    throw Object.assign(new Error(AGNES_FIRST_LAST_FRAME_UNSUPPORTED_MESSAGE), { status: 400 });
  }

  const imageUrls = [
    text(assetInputs.providerParams.firstFrameUrl),
    text(assetInputs.providerParams.lastFrameUrl),
    ...assetInputs.providerParams.referenceFrameUrls,
    ...assetInputs.providerParams.referenceImageUrls,
    text(payload.imageUrl),
    text(payload.endImageUrl),
    ...normalizeStringList(payload.referenceFrameUrls),
    ...normalizeStringList(payload.referenceImageUrls)
  ].filter(Boolean);
  if (imageUrls.length === 0) return;
  if (imageUrls.some((url) => !isAgnesPublicAssetUrl(url))) {
    throw Object.assign(new Error(AGNES_PUBLIC_ASSET_BASE_URL_REQUIRED_MESSAGE), { status: 400 });
  }
  if ((imageMode === "multi_image" || imageMode === "keyframes") && imageUrls.length < 2) {
    throw Object.assign(new Error("Agnes 多图生视频和关键帧生视频至少需要 2 张 https 图片。"), { status: 400 });
  }
}

async function backfillSucceededResultUrl(task: GenerationTask): Promise<GenerationTask> {
  if (task.status !== "succeeded" || task.resultUrl) return task;
  const resultUrl = extractVolcengineResultUrl(task.resultRaw);
  if (!resultUrl) return task;
  return taskDbStore.update(task.id, { resultUrl });
}

async function resolveAssetInputs(payload: VideoGenerationRequest, userId: string, userRole: string) {
  const inputType = inferInputType(payload);
  const imageMode = text(payload.imageMode) || (payload.lastFrameAssetId ? "first_last_frame" : "first_frame");
  const payloadParams = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params) ? payload.params as Record<string, unknown> : null;
  const firstFrameAssetId = text(payload.firstFrameAssetId);
  const lastFrameAssetId = text(payload.lastFrameAssetId);
  const referenceVideoAssetId = text(payload.referenceVideoAssetId);
  const referenceFrameAssetIds = normalizeStringList(payload.referenceFrameAssetIds ?? payloadParams?.referenceFrameAssetIds);
  const inputContainsVideo = Boolean(payload.inputContainsVideo || inputType === "video");

  let firstFrameAsset: Awaited<ReturnType<typeof assetService.requireAsset>> | null = null;
  let lastFrameAsset: Awaited<ReturnType<typeof assetService.requireAsset>> | null = null;
  let referenceVideoAsset: Awaited<ReturnType<typeof assetService.requireAsset>> | null = null;
  let referenceFrameAssets: Array<Awaited<ReturnType<typeof assetService.requireAsset>>> = [];
  let effectiveInputVideoDuration = payload.inputVideoDuration;

  if (referenceFrameAssetIds.length > 6) {
    throw Object.assign(new Error("参考帧最多上传 6 张"), { status: 400 });
  }

  if (inputType === "image") {
    if (!firstFrameAssetId && referenceFrameAssetIds.length === 0) {
      throw Object.assign(new Error("请上传参考图片（首帧）。"), { status: 400 });
    }
    if (firstFrameAssetId) {
      firstFrameAsset = await assetService.requireAsset(firstFrameAssetId, userId, userRole, "image");
    }
    if (imageMode === "first_last_frame") {
      if (!lastFrameAssetId) {
        throw Object.assign(new Error("首尾帧生成需要同时上传首帧图片和尾帧图片。"), { status: 400 });
      }
      lastFrameAsset = await assetService.requireAsset(lastFrameAssetId, userId, userRole, "image");
    }
  }

  if (inputContainsVideo) {
    if (!referenceVideoAssetId) {
      throw Object.assign(new Error("请上传参考视频。"), { status: 400 });
    }
    referenceVideoAsset = await assetService.requireAsset(referenceVideoAssetId, userId, userRole, "video");
    if (typeof referenceVideoAsset.durationSeconds === "number" && Number.isFinite(referenceVideoAsset.durationSeconds)) {
      effectiveInputVideoDuration = Math.round(referenceVideoAsset.durationSeconds);
    }
  }

  if (referenceFrameAssetIds.length > 0) {
    referenceFrameAssets = await Promise.all(
      referenceFrameAssetIds.map((assetId) => assetService.requireAsset(assetId, userId, userRole, "image"))
    );
  }

  const referenceFrameUrls = referenceFrameAssets.map((asset) => asset.providerUrl).filter(Boolean);
  const providerParams = {
    firstFrameUrl: firstFrameAsset?.providerUrl,
    lastFrameUrl: lastFrameAsset?.providerUrl,
    referenceVideoUrl: referenceVideoAsset?.providerUrl,
    referenceFrameUrls,
    referenceImageUrls: referenceFrameUrls
  };

  const assets = {
    firstFrame: firstFrameAsset,
    lastFrame: lastFrameAsset,
    referenceVideo: referenceVideoAsset,
    referenceFrames: referenceFrameAssets
  };

  return {
    inputType,
    imageMode: inputType === "image" ? imageMode : undefined,
    inputContainsVideo,
    firstFrameAssetId: firstFrameAsset?.id,
    lastFrameAssetId: lastFrameAsset?.id,
    referenceVideoAssetId: referenceVideoAsset?.id,
    referenceFrameAssetIds,
    effectiveInputVideoDuration,
    providerParams,
    assets
  };
}

async function refundFailedTask(task: GenerationTask, reason: string): Promise<GenerationTask> {
  if (!task.userId || task.cost <= 0) return task;
  await billingService.refundCredits(task.userId, task.id, task.cost, reason);
  const refundNote = `已自动退款 ${task.cost} 积分。`;
  const currentMessage = task.errorMessage || reason;
  if (currentMessage.includes(refundNote)) return task;
  return taskDbStore.update(task.id, {
    errorMessage: `${currentMessage}\n${refundNote}`
  });
}

async function queryAgnesTaskStatus(
  task: GenerationTask,
  provider: Awaited<ReturnType<typeof modelRegistryService.getGenerationProvider>>,
  adapter: VideoProviderAdapter
): Promise<GenerationTask> {
  if (!provider) return task;
  const videoId = task.providerTaskId;
  const checkedAt = Date.now();

  try {
    const result = await adapter.getVideoTask(provider, videoId);
    const nextAllowedAt = result.status && isTerminalTaskStatus(result.status)
      ? null
      : checkedAt + AGNES_STATUS_QUERY_INTERVAL_MS;
    const updated = await taskDbStore.update(task.id, {
      status: result.status || task.status,
      resultRaw: result.resultRaw,
      resultUrl: result.resultUrl || task.resultUrl,
      errorMessage: result.status === "failed" ? result.errorMessage || task.errorMessage : task.errorMessage,
      params: withStatusPollingEntry(task.params, videoId, {
        lastStatusCheckedAt: isoFromMs(checkedAt),
        nextAllowedStatusCheckAt: isoFromMs(nextAllowedAt),
        statusMessage: ""
      })
    });
    if (updated.status === "failed") {
      return refundFailedTask(updated, "Provider task failed");
    }
    return updated;
  } catch (error) {
    const cooldownMs = isAgnesStatusRateLimit(error) ? AGNES_RATE_LIMIT_COOLDOWN_MS : AGNES_STATUS_QUERY_INTERVAL_MS;
    const updated = await taskDbStore.update(task.id, {
      params: withStatusPollingEntry(task.params, videoId, {
        lastStatusCheckedAt: isoFromMs(checkedAt),
        nextAllowedStatusCheckAt: isoFromMs(checkedAt + cooldownMs),
        statusMessage: STATUS_QUERY_COOLDOWN_MESSAGE
      })
    });
    return withStatusMessage(updated, STATUS_QUERY_COOLDOWN_MESSAGE);
  }
}

async function getAgnesTaskWithPolling(
  task: GenerationTask,
  provider: Awaited<ReturnType<typeof modelRegistryService.getGenerationProvider>>,
  adapter: VideoProviderAdapter
): Promise<GenerationTask> {
  const videoId = task.providerTaskId;
  const now = Date.now();
  const polling = getStatusPollingEntry(task, videoId);
  const createdAt = parseTime(task.createdAt) || now;
  const initialAllowedAt = createdAt + AGNES_INITIAL_STATUS_DELAY_MS;
  const recordedNextAllowedAt = parseTime(polling.nextAllowedStatusCheckAt);
  const nextAllowedAt = recordedNextAllowedAt ?? initialAllowedAt;

  if (nextAllowedAt > now) {
    const updated = recordedNextAllowedAt
      ? task
      : await taskDbStore.update(task.id, {
        params: withStatusPollingEntry(task.params, videoId, {
          lastStatusCheckedAt: polling.lastStatusCheckedAt,
          nextAllowedStatusCheckAt: isoFromMs(nextAllowedAt),
          statusMessage: STATUS_QUERY_COOLDOWN_MESSAGE
        })
      });
    return withStatusMessage(updated, STATUS_QUERY_COOLDOWN_MESSAGE);
  }

  const existing = agnesStatusFlights.get(videoId);
  if (existing) return existing;

  const flight = queryAgnesTaskStatus(task, provider, adapter);
  agnesStatusFlights.set(videoId, flight);
  try {
    return await flight;
  } finally {
    if (agnesStatusFlights.get(videoId) === flight) {
      agnesStatusFlights.delete(videoId);
    }
  }
}

export class GenerationService {
  async createVideoGeneration(payload: VideoGenerationRequest, userId: string): Promise<GenerationTask> {
    const modelId = payload.modelId || payload.model;
    if (!modelId) {
      throw new Error("modelId is required.");
    }
    if (!payload.prompt?.trim()) {
      throw new Error("prompt is required.");
    }

    const userForAssets = await authService.getUserById(userId);
    const assetInputs = await resolveAssetInputs(payload, userId, userForAssets?.role || "user");

    const model = await modelRegistryService.getGenerationModel(modelId);
    if (!model) {
      throw Object.assign(new Error(`Video model '${modelId}' was not found.`), { status: 404 });
    }
    if (!model.enabled || model.modelType !== "video") {
      throw Object.assign(new Error(`Video model '${modelId}' is disabled or not available for video generation.`), { status: 400 });
    }
    const pricing = await pricingService.calculateVideoGenerationCost({
      modelId,
      inputContainsVideo: assetInputs.inputContainsVideo,
      inputVideoDuration: assetInputs.effectiveInputVideoDuration,
      outputDuration: payload.outputDuration ?? payload.duration,
      resolution: payload.resolution,
      audioMode: payload.audioMode,
      count: payload.count
    });
    const provider = await modelRegistryService.getGenerationProvider(model.provider);
    if (!provider || !provider.enabled) {
      throw Object.assign(new Error(`Provider '${model.provider}' is not configured or enabled.`), { status: 400 });
    }

    validateAgnesInput(provider.key, provider.adapter, payload, assetInputs);

    const adapter = videoAdapters[provider.adapter];
    if (!adapter) {
      throw new Error(`Video provider adapter '${provider.adapter}' is not implemented.`);
    }
    const originalCost = pricing.cost;
    const charge = await billingService.getVideoGenerationCharge(userId, originalCost);
    const cost = charge.actualCost;
    const balance = await billingService.getBalance(userId);
    if (balance.balance < cost) {
      throw Object.assign(new Error(INSUFFICIENT_BALANCE_MESSAGE), { status: 402 });
    }

    const outputDuration = Number(pricing.breakdown.outputDuration);
    const normalizedPayload: VideoGenerationRequest = {
      ...payload,
      inputType: assetInputs.inputType,
      imageMode: assetInputs.imageMode,
      firstFrameAssetId: assetInputs.firstFrameAssetId,
      lastFrameAssetId: assetInputs.lastFrameAssetId,
      referenceVideoAssetId: assetInputs.referenceVideoAssetId,
      referenceFrameAssetIds: assetInputs.referenceFrameAssetIds,
      duration: outputDuration,
      outputDuration,
      resolution: pricing.breakdown.resolution,
      inputContainsVideo: pricing.breakdown.inputContainsVideo,
      inputVideoDuration: pricing.breakdown.inputVideoDuration ?? undefined,
      audioMode: pricing.breakdown.audioMode,
      count: pricing.breakdown.count,
      generateAudio: pricing.breakdown.audioMode === "audio" ? true : payload.generateAudio,
      imageUrl: assetInputs.providerParams.firstFrameUrl || payload.imageUrl,
      endImageUrl: assetInputs.providerParams.lastFrameUrl || payload.endImageUrl,
      referenceVideoUrl: assetInputs.providerParams.referenceVideoUrl,
      referenceFrameUrls: assetInputs.providerParams.referenceFrameUrls,
      referenceImageUrls: assetInputs.providerParams.referenceImageUrls
    };
    const consumeRemarkBase = buildPricingRemark({
      modelDisplayName: model.displayName,
      resolution: String(pricing.breakdown.resolution),
      outputDuration,
      inputContainsVideo: Boolean(pricing.breakdown.inputContainsVideo),
      inputVideoDuration: typeof pricing.breakdown.inputVideoDuration === "number" ? pricing.breakdown.inputVideoDuration : null,
      count: Number(pricing.breakdown.count),
      audioMode: pricing.breakdown.audioMode as "audio" | "silent" | "default",
      cost
    });
    const consumeRemark = charge.memberLevel === "svip"
      ? `${consumeRemarkBase}; originalCost=${originalCost}; discountRate=0.98; actualCost=${cost}; memberLevelAtCharge=svip`
      : consumeRemarkBase;

    let task = await taskDbStore.create({
      userId,
      provider: provider.key,
      modelId: model.id,
      modelDisplayName: model.displayName,
      taskType: String(normalizedPayload.mode || model.defaultParams?.mode || "text-to-video"),
      prompt: normalizedPayload.prompt || "",
      params: {
        ...getPayloadParams(normalizedPayload),
        inputType: assetInputs.inputType,
        imageMode: assetInputs.imageMode,
        firstFrameAssetId: assetInputs.firstFrameAssetId,
        lastFrameAssetId: assetInputs.lastFrameAssetId,
        referenceVideoAssetId: assetInputs.referenceVideoAssetId,
        referenceFrameAssetIds: assetInputs.referenceFrameAssetIds,
        assets: assetInputs.assets,
        providerParams: assetInputs.providerParams,
        pricingBreakdown: { ...pricing.breakdown, originalCost, actualCost: cost, discountRate: charge.discountRate, memberLevelAtCharge: charge.memberLevel }
      },
      pricingBreakdown: { ...pricing.breakdown, originalCost, actualCost: cost, discountRate: charge.discountRate, memberLevelAtCharge: charge.memberLevel },
      cost
    });
    try {
      await billingService.consumeCredits(userId, task.id, cost, consumeRemark);
    } catch (error) {
      await taskDbStore.update(task.id, {
        status: "failed",
        errorMessage: extractErrorMessage(error)
      });
      throw error;
    }
    task = await taskDbStore.update(task.id, { status: "processing" });

    try {
      const result = await adapter.createVideoTask(provider, model, normalizedPayload as Record<string, unknown>);
      const taskChanges: Partial<GenerationTask> = {
        status: "processing",
        providerTaskId: result.providerTaskId,
        resultRaw: result.resultRaw,
        resultUrl: result.resultUrl
      };
      if (provider.key === "agnes" || provider.adapter === "agnes") {
        taskChanges.params = withStatusPollingEntry(task.params, result.providerTaskId, {
          lastStatusCheckedAt: null,
          nextAllowedStatusCheckAt: isoFromMs(Date.now() + AGNES_INITIAL_STATUS_DELAY_MS),
          statusMessage: ""
        });
      }
      task = await taskDbStore.update(task.id, taskChanges);
      return task;
    } catch (error) {
      task = await taskDbStore.update(task.id, {
        status: "failed",
        errorMessage: extractErrorMessage(error),
        resultRaw: (error as { body?: unknown }).body ?? null
      });
      task = await refundFailedTask(task, "Provider task creation failed");
      throw Object.assign(new Error(task.errorMessage), { task });
    }
  }

  async listTasks(userId: string): Promise<GenerationTask[]> {
    return taskDbStore.list(userId);
  }

  async getTask(taskId: string, userId: string): Promise<GenerationTask | undefined> {
    let task = await taskDbStore.get(taskId, userId);
    if (task) task = await backfillSucceededResultUrl(task);
    if (!task || !task.providerTaskId || isTerminalTaskStatus(task.status)) {
      return task;
    }

    const provider = await modelRegistryService.getGenerationProvider(task.provider);
    if (!provider) return task;
    const adapter = videoAdapters[provider.adapter];
    if (!adapter) return task;
    if (provider.key === "agnes" || provider.adapter === "agnes") {
      return getAgnesTaskWithPolling(task, provider, adapter);
    }

    try {
      const result = await adapter.getVideoTask(provider, task.providerTaskId);
      const updated = await taskDbStore.update(task.id, {
        status: result.status || task.status,
        resultRaw: result.resultRaw,
        resultUrl: result.resultUrl || task.resultUrl,
        errorMessage: result.status === "failed" ? result.errorMessage || task.errorMessage : task.errorMessage
      });
      if (updated.status === "failed") {
        return refundFailedTask(updated, "Provider task failed");
      }
      return updated;
    } catch (error) {
      const updated = await taskDbStore.update(task.id, {
        status: "failed",
        errorMessage: extractErrorMessage(error),
        resultRaw: (error as { body?: unknown }).body ?? null
      });
      return refundFailedTask(updated, "Provider task query failed");
    }
  }
}

export const generationService = new GenerationService();
