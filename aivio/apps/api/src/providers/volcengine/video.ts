import type { ProviderCreateResult, ProviderTaskResult } from "../provider.interface.js";
import type { ModelConfig } from "../../types/model.js";
import type { ProviderConfig } from "../../types/provider.js";
import { extractErrorMessage, requestVolcengine } from "./client.js";
import { log, warn } from "../../utils/logger.js";

function getText(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const value = payload[key];
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function getStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function maybeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isPrivateOrLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

function buildVideoBody(model: ModelConfig, payload: Record<string, unknown>): Record<string, unknown> {
  const mode = getText(payload, "mode", "text-to-video");
  const prompt = getText(payload, "prompt");
  const content: unknown[] = [];
  const referenceVideoUrl = getText(payload, "referenceVideoUrl");
  if (referenceVideoUrl.trim()) {
    log("Volcengine provider received reference video input", {
      model: model.id,
      referenceVideoUrl,
      inputContainsVideo: payload.inputContainsVideo,
      inputVideoDuration: payload.inputVideoDuration,
      outputDuration: payload.duration,
      resolution: payload.resolution,
      ratio: payload.ratio
    });
    if (isPrivateOrLocalUrl(referenceVideoUrl)) {
      warn("Reference video URL is local and cannot be reached by external provider", {
        model: model.id,
        referenceVideoUrl
      });
      throw new Error("本地视频地址无法被外部 provider 访问。请配置 PUBLIC_ASSET_BASE_URL 为公网 URL，或接入对象存储后再进行视频参考生成。");
    }
    content.push({
      type: "video_url",
      video_url: { url: referenceVideoUrl },
      role: "reference_video"
    });
  }

  if (prompt.trim()) {
    content.push({ type: "text", text: prompt });
  }

  const imageUrl = getText(payload, "imageUrl");
  if (imageUrl.trim()) {
    content.push({
      type: "image_url",
      image_url: { url: imageUrl },
      role: mode === "reference-image" ? "reference_image" : "first_frame"
    });
  }

  const endImageUrl = getText(payload, "endImageUrl");
  if (endImageUrl.trim()) {
    content.push({
      type: "image_url",
      image_url: { url: endImageUrl },
      role: "last_frame"
    });
  }

  const explicitReferenceFrameUrls = getStringArray(payload.referenceFrameUrls);
  const referenceFrameUrls = explicitReferenceFrameUrls.length > 0 ? explicitReferenceFrameUrls : getStringArray(payload.referenceImageUrls);
  if (referenceFrameUrls.length > 0) {
    log("Volcengine provider received reference frame inputs", {
      model: model.id,
      referenceFrameCount: referenceFrameUrls.length,
      referenceFrameUrls
    });
    for (const url of referenceFrameUrls) {
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image"
      });
    }
  }

  const body: Record<string, unknown> = {
    model: model.id,
    content
  };

  const ratio = getText(payload, "ratio") || getText(payload, "aspect_ratio");
  if (ratio.trim()) body.ratio = ratio;
  const duration = maybeNumber(payload.duration);
  if (duration !== undefined) body.duration = duration;
  const resolution = getText(payload, "resolution");
  if (resolution.trim()) body.resolution = resolution;
  const seed = maybeNumber(payload.seed);
  if (seed !== undefined) body.seed = seed;
  if (payload.generateAudio !== undefined) body.generate_audio = Boolean(payload.generateAudio);
  if (payload.watermark !== undefined) body.watermark = Boolean(payload.watermark);

  return body;
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
  for (const path of [["id"], ["task_id"], ["request_id"], ["name"], ["output", "task_id"], ["data", "task_id"], ["uuid"], ["prompt_id"]]) {
    const found = getNested(value, path);
    if (typeof found === "string" && found.trim()) return found;
  }
  return "";
}

export function extractVolcengineResultUrl(value: unknown): string {
  for (const path of [
    ["resultUrl"],
    ["videoUrl"],
    ["outputUrl"],
    ["result_url"],
    ["video_url"],
    ["output_url"],
    ["url"],
    ["content", "video_url"],
    ["content", "url"],
    ["result", "video_url"],
    ["result", "url"],
    ["output", "video_url"],
    ["output", "result_url"],
    ["output", "output_url"],
    ["output", "url"],
    ["output", "video", "url"],
    ["outputs", "0", "url"],
    ["data", "0", "url"],
    ["data", "url"]
  ]) {
    const found = getNested(value, path);
    if (typeof found === "string" && found.trim()) return found;
  }

  const videos = getNested(value, ["output", "videos"]);
  if (Array.isArray(videos) && videos[0] && typeof videos[0] === "object") {
    const url = (videos[0] as Record<string, unknown>).url;
    if (typeof url === "string" && url.trim()) return url;
  }
  return "";
}

function normalizeStatus(value: unknown): ProviderTaskResult["status"] | undefined {
  const status = String(getNested(value, ["status"]) || getNested(value, ["output", "status"]) || "").toLowerCase();
  if (["succeeded", "success", "completed", "done"].includes(status)) return "succeeded";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["pending", "queued"].includes(status)) return "pending";
  if (["processing", "running", "in_progress"].includes(status)) return "processing";
  return undefined;
}

export async function createVolcengineVideoTask(
  provider: ProviderConfig,
  model: ModelConfig,
  payload: Record<string, unknown>
): Promise<ProviderCreateResult> {
  const body = buildVideoBody(model, payload);
  const response = await requestVolcengine(provider, "contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(body)
  });
  return {
    providerTaskId: extractProviderTaskId(response.body),
    resultRaw: response.body,
    resultUrl: extractVolcengineResultUrl(response.body)
  };
}

export async function getVolcengineVideoTask(provider: ProviderConfig, providerTaskId: string): Promise<ProviderTaskResult> {
  const response = await requestVolcengine(provider, `contents/generations/tasks/${providerTaskId}`, {
    method: "GET"
  });
  return {
    status: normalizeStatus(response.body),
    resultRaw: response.body,
    resultUrl: extractVolcengineResultUrl(response.body),
    errorMessage: extractErrorMessage(response.body)
  };
}
