import type { VideoModelCapability, VideoModelCapabilitySet } from "../../../config/videoModelCapabilities";
import { ApiError } from "../../../shared/api/client";
import type { UploadedAsset } from "../api/assets";
import { summarizeResultRaw } from "../../../shared/api/video";
import type { GenerationTask, VideoModel } from "../../../shared/api/video";

export type GenerationMode = "text" | "image" | "video";
export type ImageInputMode = "first" | "multi" | "firstEnd" | "keyframes";
export type VideoInputMode = "extension" | "edit";
export type ImageSlot = "start" | "end";

export type UploadedImage = {
  file: File;
  previewUrl: string;
  dimensions?: string;
  asset?: UploadedAsset;
  uploading?: boolean;
  uploadError?: string;
};

export type UploadedVideo = {
  file: File;
  previewUrl: string;
  duration?: number;
  asset?: UploadedAsset;
  uploading?: boolean;
  uploadError?: string;
};

export const promptPlaceholder = "请输入你想生成的视频画面，格式：[主体] + [动作] + [场景] + [镜头运动] + [光线] + [风格]";
export const outputDurations = Array.from({ length: 12 }, (_, index) => index + 4);
export const inputDurations = Array.from({ length: 14 }, (_, index) => index + 2);
export const resolutions = ["480p", "720p", "1080p"] as const;
export const counts = [1, 2, 3, 4];
export const MAX_REFERENCE_FRAMES = 6;
export const POLL_INTERVAL_MS = 500;
export const POLL_TIMEOUT_MS = 30 * 60 * 1000;
export const AGNES_SUPPORT_NOTE = "Agnes 支持文生视频、图生视频和多图关键帧；不支持参考视频输入。图片素材需使用公网可访问地址。";
export const AGNES_REFERENCE_VIDEO_NOTICE = "Agnes 当前不支持参考视频输入，请切换到文生视频或图生视频。";

export const modeOptions: Array<{ key: GenerationMode; label: string; description: string }> = [
  { key: "text", label: "文生视频", description: "仅通过创意描述生成画面" },
  { key: "image", label: "图生视频", description: "支持图片素材参考" },
  { key: "video", label: "视频生视频", description: "根据视频素材生成" }
];

export const imageModeOptions: Array<{ key: ImageInputMode; label: string; capability: VideoModelCapability }> = [
  { key: "first", label: "首帧", capability: "image_to_video_first_frame" },
  { key: "firstEnd", label: "首尾帧", capability: "image_to_video_first_last_frame" },
  { key: "multi", label: "多图", capability: "image_to_video_multi_image" },
  { key: "keyframes", label: "关键帧", capability: "image_to_video_keyframes" }
];

export const videoModeOptions: Array<{ key: VideoInputMode; label: string; capability: VideoModelCapability }> = [
  { key: "extension", label: "视频续写", capability: "video_to_video_extension" },
  { key: "edit", label: "视频编辑", capability: "video_to_video_edit" }
];

export function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 402) return "余额不足，请充值后再生成。";
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof TypeError) return "服务连接失败，请确认 Node API 已启动。";
  return error instanceof Error ? error.message : "生成失败，请稍后重试。";
}

export function modelSupports1080(model?: VideoModel | null) {
  if (!model) return true;
  return !model.id.includes("seedance-2-0-fast") && !model.id.includes("seedance-2-0-mini");
}

export function needsAudioMode(model?: VideoModel | null) {
  return Boolean(model?.id.includes("seedance-1-5-pro"));
}

export function clampDuration(value: number) {
  return Math.min(15, Math.max(2, Math.round(value)));
}

export function previewRatioClass(ratio: string) {
  if (ratio === "9:16") return "ratio-9-16";
  if (ratio === "1:1") return "ratio-1-1";
  return "ratio-16-9";
}

export function generationModeLabel(mode: GenerationMode) {
  if (mode === "image") return "图生视频";
  if (mode === "video") return "视频生视频";
  return "文生视频";
}

export function imageModeLabel(mode: ImageInputMode) {
  return imageModeOptions.find((option) => option.key === mode)?.label || "首帧";
}

export function supportsCapability(capabilities: VideoModelCapabilitySet, capability: VideoModelCapability) {
  return Boolean(capabilities[capability]);
}

export function getAvailableImageModes(capabilities: VideoModelCapabilitySet) {
  return imageModeOptions.filter((option) => supportsCapability(capabilities, option.capability));
}

export function getAvailableVideoModes(capabilities: VideoModelCapabilitySet) {
  return videoModeOptions.filter((option) => supportsCapability(capabilities, option.capability));
}

export function supportsGenerationMode(capabilities: VideoModelCapabilitySet, mode: GenerationMode) {
  if (mode === "text") return supportsCapability(capabilities, "text_to_video");
  if (mode === "image") return getAvailableImageModes(capabilities).length > 0;
  return getAvailableVideoModes(capabilities).length > 0;
}

export function getFirstAvailableMode(capabilities: VideoModelCapabilitySet): GenerationMode {
  if (supportsGenerationMode(capabilities, "text")) return "text";
  if (supportsGenerationMode(capabilities, "image")) return "image";
  if (supportsGenerationMode(capabilities, "video")) return "video";
  return "text";
}

export function uploadPurpose(slot: ImageSlot) {
  return slot === "start" ? "first_frame" : "last_frame";
}

export function uploadErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "上传失败，请重试。";
}

export function readImageDimensions(url: string) {
  return new Promise<{ width: number; height: number; dimensions: string }>((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({
      width: probe.naturalWidth,
      height: probe.naturalHeight,
      dimensions: `${probe.naturalWidth} × ${probe.naturalHeight}`
    });
    probe.onerror = () => resolve({ width: 0, height: 0, dimensions: "" });
    probe.src = url;
  });
}

export function readVideoDuration(url: string) {
  return new Promise<number | null>((resolve) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? Number(probe.duration.toFixed(1)) : null);
    probe.onerror = () => resolve(null);
    probe.src = url;
  });
}

export function isTerminalStatus(status: string) {
  return ["succeeded", "failed", "cancelled"].includes(status);
}

export function statusLabel(status: string) {
  if (status === "idle") return "待生成";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "已失败";
  if (status === "cancelled") return "已取消";
  if (status === "processing") return "生成中";
  return "排队中";
}

export function formatTaskTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "--" : time.toLocaleString("zh-CN", { hour12: false });
}

export function taskResolution(task?: GenerationTask | null) {
  return String(task?.pricingBreakdown?.resolution || task?.params?.resolution || "--");
}

export function taskDuration(task?: GenerationTask | null) {
  const value = task?.pricingBreakdown?.outputDuration || task?.params?.outputDuration || task?.params?.duration;
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return "未知时长";
  return `${duration}s`;
}

export function formatCny(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return value.toFixed(2);
}

export function upsertTask(tasks: GenerationTask[], task: GenerationTask) {
  const next = [task, ...tasks.filter((item) => item.id !== task.id)];
  return next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 12);
}

export function missingResultMessage(task?: GenerationTask | null) {
  const summary = summarizeResultRaw(task);
  return summary ? `任务已完成，但未返回结果地址。原始返回摘要：${summary}` : "任务已完成，但未返回结果地址。";
}
