import type { UploadedAsset } from "../api/assets";
import type { GenerationMode, ImageInputMode, UploadedImage, UploadedVideo, VideoInputMode } from "./create-utils";

const CREATE_PROMPT_DRAFT_KEY = "aivio_create_prompt_draft";
const CREATE_PAGE_STATE_KEY = "aivio_create_page_state";

export type PersistedUploadedMedia = {
  asset: UploadedAsset;
  previewUrl: string;
  dimensions?: string;
  duration?: number;
};

export type CreatePageState = {
  modelId: string;
  ratio: string;
  generationMode: GenerationMode;
  imageInputMode: ImageInputMode;
  videoInputMode: VideoInputMode;
  outputDuration: number;
  inputVideoDuration: number;
  resolution: string;
  audioMode: "audio" | "silent" | "default";
  motionStrength: string;
  count: number;
  advancedParamsOpen: boolean;
  startImage: PersistedUploadedMedia | null;
  endImage: PersistedUploadedMedia | null;
  referenceFrames: PersistedUploadedMedia[];
  referenceVideo: PersistedUploadedMedia | null;
};

export function readPromptDraft() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(CREATE_PROMPT_DRAFT_KEY) || "";
  } catch {
    return "";
  }
}

export function savePromptDraft(value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(CREATE_PROMPT_DRAFT_KEY, value);
    else window.sessionStorage.removeItem(CREATE_PROMPT_DRAFT_KEY);
  } catch {
    // Storage is best-effort and must never block generation.
  }
}

function createPlaceholderFile(name: string, type: string) {
  return new File([""], name || "uploaded", { type: type || "application/octet-stream" });
}

export function toPersistedMedia(value: UploadedImage | UploadedVideo | null): PersistedUploadedMedia | null {
  if (!value?.asset || value.uploading) return null;
  return {
    asset: value.asset,
    previewUrl: value.previewUrl || value.asset.url,
    dimensions: "dimensions" in value ? value.dimensions : undefined,
    duration: "duration" in value ? value.duration : undefined
  };
}

export function restoreImage(value: PersistedUploadedMedia | null | undefined): UploadedImage | null {
  if (!value?.asset) return null;
  return {
    file: createPlaceholderFile(value.asset.originalName, value.asset.mimeType),
    previewUrl: value.previewUrl || value.asset.url,
    dimensions: value.dimensions,
    asset: value.asset,
    uploading: false,
    uploadError: ""
  };
}

export function restoreVideo(value: PersistedUploadedMedia | null | undefined): UploadedVideo | null {
  if (!value?.asset) return null;
  return {
    file: createPlaceholderFile(value.asset.originalName, value.asset.mimeType),
    previewUrl: value.previewUrl || value.asset.url,
    duration: value.duration ?? (typeof value.asset.durationSeconds === "number" ? value.asset.durationSeconds : undefined),
    asset: value.asset,
    uploading: false,
    uploadError: ""
  };
}

export function readCreatePageState(): CreatePageState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CREATE_PAGE_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CreatePageState> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : "",
      ratio: typeof parsed.ratio === "string" ? parsed.ratio : "16:9",
      generationMode: parsed.generationMode === "image" || parsed.generationMode === "video" ? parsed.generationMode : "text",
      imageInputMode: parsed.imageInputMode === "multi" || parsed.imageInputMode === "firstEnd" || parsed.imageInputMode === "keyframes" ? parsed.imageInputMode : "first",
      videoInputMode: parsed.videoInputMode === "edit" ? "edit" : "extension",
      outputDuration: typeof parsed.outputDuration === "number" ? parsed.outputDuration : 0,
      inputVideoDuration: typeof parsed.inputVideoDuration === "number" ? parsed.inputVideoDuration : 4,
      resolution: typeof parsed.resolution === "string" ? parsed.resolution : "720p",
      audioMode: parsed.audioMode === "audio" || parsed.audioMode === "default" ? parsed.audioMode : "silent",
      motionStrength: typeof parsed.motionStrength === "string" ? parsed.motionStrength : "medium",
      count: typeof parsed.count === "number" ? parsed.count : 1,
      advancedParamsOpen: Boolean(parsed.advancedParamsOpen),
      startImage: parsed.startImage && typeof parsed.startImage === "object" ? parsed.startImage as PersistedUploadedMedia : null,
      endImage: parsed.endImage && typeof parsed.endImage === "object" ? parsed.endImage as PersistedUploadedMedia : null,
      referenceFrames: Array.isArray(parsed.referenceFrames) ? parsed.referenceFrames as PersistedUploadedMedia[] : [],
      referenceVideo: parsed.referenceVideo && typeof parsed.referenceVideo === "object" ? parsed.referenceVideo as PersistedUploadedMedia : null
    };
  } catch {
    return null;
  }
}

export function saveCreatePageState(state: CreatePageState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CREATE_PAGE_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage is best-effort and must never block generation.
  }
}
