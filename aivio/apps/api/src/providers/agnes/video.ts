import type { ProviderCreateResult, ProviderTaskResult } from "../provider.interface.js";
import type { ModelConfig } from "../../types/model.js";
import type { ProviderConfig } from "../../types/provider.js";
import { extractAgnesErrorMessage, requestAgnes, requestAgnesUrl } from "./client.js";

export const AGNES_REFERENCE_VIDEO_UNSUPPORTED_MESSAGE = "Agnes 当前仅支持文生视频、图生视频和多图关键帧，不支持参考视频输入。";
export const AGNES_FIRST_LAST_FRAME_UNSUPPORTED_MESSAGE = "Agnes 当前不支持首尾帧生视频。";
export const AGNES_PUBLIC_ASSET_BASE_URL_REQUIRED_MESSAGE = "Agnes 需要公网可访问的 https 图片素材 URL，请先确认图片已成功上传到 Cloudflare R2。";

function text(value: unknown): string {
  return String(value || "").trim();
}

function numberParam(payload: Record<string, unknown>, model: ModelConfig, key: string, fallback: number): number {
  const value = payload[key] ?? model.defaultParams?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeNumFrames(value: number): number {
  return clampInteger(Math.round((value - 1) / 8) * 8 + 1, 9, 441);
}

function getFrameRate(payload: Record<string, unknown>, model: ModelConfig): number {
  const frameRate = numberParam(payload, model, "frame_rate", 24);
  if (frameRate < 1 || frameRate > 60) {
    throw Object.assign(new Error("Agnes frame_rate must be between 1 and 60."), { status: 400 });
  }
  return frameRate;
}

function validateNumFrames(value: number): number {
  const numFrames = Math.round(value);
  if (numFrames > 441 || numFrames < 9 || (numFrames - 1) % 8 !== 0) {
    throw Object.assign(new Error("Agnes num_frames must be <= 441 and satisfy 8n + 1."), { status: 400 });
  }
  return numFrames;
}

function getNumFrames(payload: Record<string, unknown>, model: ModelConfig, frameRate: number): number {
  if (payload.num_frames !== undefined) {
    return validateNumFrames(numberParam(payload, model, "num_frames", 121));
  }
  const duration = Number(payload.outputDuration ?? payload.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return normalizeNumFrames(duration * frameRate);
  }
  if (model.defaultParams?.num_frames !== undefined) {
    return validateNumFrames(numberParam(payload, model, "num_frames", 121));
  }
  return 121;
}

function getNested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current) && /^\d+$/.test(key)) {
      current = current[Number(key)];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function extractProviderTaskId(value: unknown): string {
  for (const path of [["video_id"], ["data", "video_id"], ["output", "video_id"], ["task_id"], ["id"], ["data", "task_id"], ["data", "id"], ["output", "task_id"]]) {
    const found = getNested(value, path);
    if (typeof found === "string" && found.trim()) return found;
  }
  return "";
}

function extractAgnesResultUrl(value: unknown): string {
  for (const path of [
    ["video_url"],
    ["remixed_from_video_id"],
    ["url"],
    ["result_url"],
    ["output_url"],
    ["data", "video_url"],
    ["data", "remixed_from_video_id"],
    ["data", "url"],
    ["output", "video_url"],
    ["output", "remixed_from_video_id"],
    ["output", "url"],
    ["outputs", "0", "url"]
  ]) {
    const found = getNested(value, path);
    if (typeof found === "string" && found.trim()) return found;
  }
  return "";
}

function normalizeStatus(value: unknown): ProviderTaskResult["status"] | undefined {
  const status = String(getNested(value, ["status"]) || getNested(value, ["data", "status"]) || getNested(value, ["output", "status"]) || "").toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(status)) return "succeeded";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["queued", "pending"].includes(status)) return "pending";
  if (["in_progress", "processing", "running"].includes(status)) return "processing";
  return undefined;
}

function getStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function isAgnesPublicAssetUrl(value: unknown): boolean {
  const url = text(value);
  if (!url || url.startsWith("/")) return false;
  if (/^(file|blob|data):/i.test(url)) return false;
  if (/^data:image\/|^data:video\/|base64,/i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(hostname)) return false;
  if (/^10\./.test(hostname)) return false;
  if (/^192\.168\./.test(hostname)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return false;
  return true;
}

function getAgnesImageUrls(payload: Record<string, unknown>): string[] {
  return [
    text(payload.imageUrl),
    text(payload.endImageUrl),
    ...getStringArray(payload.referenceFrameUrls),
    ...getStringArray(payload.referenceImageUrls)
  ].filter(Boolean);
}

function resolveAgnesMode(payload: Record<string, unknown>, images: string[]): "" | "image_to_video" | "multi_image_video" | "keyframe_video" {
  const explicitMode = text(payload.mode).toLowerCase();
  const imageMode = text(payload.imageMode).toLowerCase();
  if (explicitMode === "image_to_video") return "image_to_video";
  if (explicitMode === "multi_image_video") return "multi_image_video";
  if (explicitMode === "keyframe_video") return "keyframe_video";
  if (imageMode === "first_frame") return images.length > 0 ? "image_to_video" : "";
  if (imageMode === "multi_image") return "multi_image_video";
  if (imageMode === "keyframes") return "keyframe_video";
  if (images.length <= 0) return "";
  if (images.length === 1) return "image_to_video";
  return text(payload.imageMode).toLowerCase() === "first_last_frame" ? "keyframe_video" : "multi_image_video";
}

export function validateAgnesVideoPayload(payload: Record<string, unknown>): void {
  const inputType = text(payload.inputType).toLowerCase();
  const imageMode = text(payload.imageMode).toLowerCase();
  const hasReferenceVideo = Boolean(
    payload.inputContainsVideo
    || inputType === "video"
    || text(payload.referenceVideoUrl)
    || text(payload.referenceVideoAssetId)
  );
  if (hasReferenceVideo) {
    throw Object.assign(new Error(AGNES_REFERENCE_VIDEO_UNSUPPORTED_MESSAGE), { status: 400 });
  }
  if (imageMode === "first_last_frame") {
    throw Object.assign(new Error(AGNES_FIRST_LAST_FRAME_UNSUPPORTED_MESSAGE), { status: 400 });
  }
  const imageUrls = getAgnesImageUrls(payload);
  if (imageUrls.length === 0) return;
  if (imageUrls.some((url) => !isAgnesPublicAssetUrl(url))) {
    throw Object.assign(new Error(AGNES_PUBLIC_ASSET_BASE_URL_REQUIRED_MESSAGE), { status: 400 });
  }
  const agnesMode = resolveAgnesMode(payload, imageUrls);
  if ((agnesMode === "multi_image_video" || agnesMode === "keyframe_video") && imageUrls.length < 2) {
    throw Object.assign(new Error("Agnes 多图生视频和关键帧生视频至少需要 2 张 https 图片。"), { status: 400 });
  }
}

function buildVideoBody(model: ModelConfig, payload: Record<string, unknown>): Record<string, unknown> {
  const frameRate = getFrameRate(payload, model);
  const images = text(payload.inputType).toLowerCase() === "text" ? [] : getAgnesImageUrls(payload);
  const agnesMode = resolveAgnesMode(payload, images);
  const body: Record<string, unknown> = {
    model: "agnes-video-v2.0",
    prompt: text(payload.prompt),
    width: numberParam(payload, model, "width", 1152),
    height: numberParam(payload, model, "height", 768),
    num_frames: getNumFrames(payload, model, frameRate),
    frame_rate: frameRate
  };

  if (agnesMode === "image_to_video" && images[0]) {
    body.image = images[0];
  }
  if (agnesMode === "multi_image_video") {
    body.extra_body = {
      image: images
    };
  }
  if (agnesMode === "keyframe_video") {
    body.extra_body = {
      image: images,
      mode: "keyframes"
    };
  }

  const seed = Number(payload.seed);
  if (Number.isInteger(seed)) body.seed = seed;
  const negativePrompt = text(payload.negative_prompt ?? payload.negativePrompt);
  if (negativePrompt) body.negative_prompt = negativePrompt;
  const steps = Number(payload.num_inference_steps ?? payload.numInferenceSteps);
  if (Number.isInteger(steps) && steps > 0) body.num_inference_steps = steps;

  return body;
}

function buildVideoQueryUrl(provider: ProviderConfig, providerTaskId: string, modelId: string): string {
  const base = new URL(provider.baseUrl);
  const url = new URL("/agnesapi", base.origin);
  url.searchParams.set("video_id", providerTaskId);
  url.searchParams.set("model_name", modelId);
  return url.toString();
}

export async function createAgnesVideoTask(
  provider: ProviderConfig,
  model: ModelConfig,
  payload: Record<string, unknown>
): Promise<ProviderCreateResult> {
  validateAgnesVideoPayload(payload);
  const response = await requestAgnes(provider, "videos", {
    method: "POST",
    body: JSON.stringify(buildVideoBody(model, payload))
  });
  const providerTaskId = extractProviderTaskId(response.body);
  if (!providerTaskId) {
    const error = new Error("Agnes did not return a video task id.");
    (error as Error & { body?: unknown }).body = response.body;
    throw error;
  }
  return {
    providerTaskId,
    resultRaw: response.body,
    resultUrl: extractAgnesResultUrl(response.body)
  };
}

export async function getAgnesVideoTask(provider: ProviderConfig, providerTaskId: string): Promise<ProviderTaskResult> {
  const response = providerTaskId.startsWith("video_")
    ? await requestAgnesUrl(provider, buildVideoQueryUrl(provider, providerTaskId, "agnes-video-v2.0"), { method: "GET" })
    : await requestAgnes(provider, `videos/${encodeURIComponent(providerTaskId)}`, { method: "GET" });
  return {
    status: normalizeStatus(response.body),
    resultRaw: response.body,
    resultUrl: extractAgnesResultUrl(response.body),
    errorMessage: extractAgnesErrorMessage(response.body)
  };
}
