import { apiRequest } from "./api";

export type VideoModel = {
  id: string;
  displayName: string;
  provider: string;
  modelType: string;
  inputType: string;
  outputType: string;
  price: number;
  enabled?: boolean;
};

export type GenerationTaskStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled" | string;

export type GenerationTask = {
  id: string;
  userId?: string | null;
  provider: string;
  modelId: string;
  modelDisplayName: string;
  taskType: string;
  prompt: string;
  params?: Record<string, unknown>;
  status: GenerationTaskStatus;
  cost: number;
  providerTaskId: string;
  resultUrl: string;
  videoUrl?: string;
  imageUrl?: string;
  outputUrl?: string;
  resultRaw?: unknown;
  pricingBreakdown?: Record<string, unknown>;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
};

export type NormalizedResult = {
  url: string;
  kind: "video" | "image";
  source: string;
};

export const TASKS_SYNC_EVENT = "aivio:tasks-sync";

export type CreateVideoInput = {
  modelId: string;
  prompt: string;
  inputType: "text" | "image" | "video";
  imageMode?: "first_frame" | "multi_image" | "first_last_frame" | "keyframes";
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  referenceVideoAssetId?: string;
  referenceFrameAssetIds?: string[];
  ratio: string;
  outputDuration: number;
  inputContainsVideo: boolean;
  inputVideoDuration?: number;
  resolution: string;
  audioMode: "audio" | "silent" | "default";
  motionStrength: string;
  count: number;
};

export type EstimateCostInput = Pick<CreateVideoInput, "modelId" | "inputContainsVideo" | "inputVideoDuration" | "outputDuration" | "resolution" | "audioMode" | "count">;

export type CostEstimate = {
  cost: number;
  breakdown: {
    resolution: string;
    inputContainsVideo: boolean;
    inputVideoDuration?: number | null;
    outputDuration: number;
    billableDuration: number;
    count: number;
    audioMode: string;
    baseRetailCnyPerSecond?: number;
    billableCnyPerSecond?: number;
    billableCreditsPerSecond?: number;
    totalCny?: number;
    totalCredits?: number;
    currency?: "CNY" | string;
    creditRate?: number;
    retailMultiplier?: number;
    pointsPerSecond: number;
    formula: string;
  };
};

export async function fetchModels() {
  const result = await apiRequest<{ models: VideoModel[] }>("/models", { auth: false });
  return result.models.filter((model) => model.modelType === "video");
}

export async function createVideoGeneration(input: CreateVideoInput) {
  return apiRequest<{ task: GenerationTask; taskId: string; status: string }>("/video/generations", {
    method: "POST",
    body: JSON.stringify({
      modelId: input.modelId,
      prompt: input.prompt,
      inputType: input.inputType,
      imageMode: input.imageMode,
      firstFrameAssetId: input.firstFrameAssetId,
      lastFrameAssetId: input.lastFrameAssetId,
      referenceVideoAssetId: input.referenceVideoAssetId,
      referenceFrameAssetIds: input.referenceFrameAssetIds,
      ratio: input.ratio,
      duration: input.outputDuration,
      outputDuration: input.outputDuration,
      inputContainsVideo: input.inputContainsVideo,
      inputVideoDuration: input.inputVideoDuration,
      resolution: input.resolution,
      audioMode: input.audioMode,
      motionStrength: input.motionStrength,
      count: input.count,
      params: {
        inputType: input.inputType,
        imageMode: input.imageMode,
        firstFrameAssetId: input.firstFrameAssetId,
        lastFrameAssetId: input.lastFrameAssetId,
        referenceVideoAssetId: input.referenceVideoAssetId,
        referenceFrameAssetIds: input.referenceFrameAssetIds,
        ratio: input.ratio,
        outputDuration: input.outputDuration,
        inputContainsVideo: input.inputContainsVideo,
        inputVideoDuration: input.inputVideoDuration,
        resolution: input.resolution,
        audioMode: input.audioMode,
        motionStrength: input.motionStrength,
        count: input.count
      }
    })
  });
}

export function estimateVideoCost(input: EstimateCostInput) {
  return apiRequest<CostEstimate>("/video/estimate-cost", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function fetchTasks() {
  const result = await apiRequest<{ tasks: GenerationTask[] }>("/video/tasks");
  return result.tasks;
}

export async function fetchTask(taskId: string) {
  const result = await apiRequest<{ task: GenerationTask }>(`/video/tasks/${taskId}`);
  return result.task;
}

export function notifyTasksChanged(task?: GenerationTask) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TASKS_SYNC_EVENT, { detail: { taskId: task?.id || "" } }));
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getNestedString(value: unknown, path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (Array.isArray(current) && /^\d+$/.test(key)) {
      current = current[Number(key)];
      continue;
    }
    const record = getRecord(current);
    if (!record) return "";
    current = record[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

function summarizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 180 ? `${value.slice(0, 180)}...` : value;
  if (typeof value !== "object") return value;
  if (depth >= 2) return Array.isArray(value) ? `[${value.length} items]` : "{...}";
  if (Array.isArray(value)) return value.slice(0, 2).map((item) => summarizeValue(item, depth + 1));
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 8);
  return Object.fromEntries(entries.map(([key, item]) => [key, summarizeValue(item, depth + 1)]));
}

export function summarizeResultRaw(task?: Partial<GenerationTask> | null): string {
  if (!task?.resultRaw) return "";
  try {
    return JSON.stringify(summarizeValue(task.resultRaw));
  } catch {
    return "resultRaw could not be serialized.";
  }
}

function inferResultKind(url: string, source: string): NormalizedResult["kind"] {
  if (/image/i.test(source) || /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(url)) return "image";
  return "video";
}

export function normalizeResult(task?: Partial<GenerationTask> | null): NormalizedResult | null {
  if (!task) return null;
  const candidates: Array<[string, string]> = [
    ["resultUrl", typeof task.resultUrl === "string" ? task.resultUrl.trim() : ""],
    ["videoUrl", typeof task.videoUrl === "string" ? task.videoUrl.trim() : ""],
    ["imageUrl", typeof task.imageUrl === "string" ? task.imageUrl.trim() : ""],
    ["outputUrl", typeof task.outputUrl === "string" ? task.outputUrl.trim() : ""],
    ["task.resultUrl", getNestedString(task, ["task", "resultUrl"])],
    ["task.outputUrl", getNestedString(task, ["task", "outputUrl"])],
    ["resultRaw.resultUrl", getNestedString(task.resultRaw, ["resultUrl"])],
    ["resultRaw.videoUrl", getNestedString(task.resultRaw, ["videoUrl"])],
    ["resultRaw.imageUrl", getNestedString(task.resultRaw, ["imageUrl"])],
    ["resultRaw.outputUrl", getNestedString(task.resultRaw, ["outputUrl"])],
    ["resultRaw.result_url", getNestedString(task.resultRaw, ["result_url"])],
    ["resultRaw.video_url", getNestedString(task.resultRaw, ["video_url"])],
    ["resultRaw.image_url", getNestedString(task.resultRaw, ["image_url"])],
    ["resultRaw.output_url", getNestedString(task.resultRaw, ["output_url"])],
    ["resultRaw.content.video_url", getNestedString(task.resultRaw, ["content", "video_url"])],
    ["resultRaw.content.url", getNestedString(task.resultRaw, ["content", "url"])],
    ["resultRaw.result.video_url", getNestedString(task.resultRaw, ["result", "video_url"])],
    ["resultRaw.result.url", getNestedString(task.resultRaw, ["result", "url"])],
    ["resultRaw.output.video_url", getNestedString(task.resultRaw, ["output", "video_url"])],
    ["resultRaw.output.image_url", getNestedString(task.resultRaw, ["output", "image_url"])],
    ["resultRaw.output.url", getNestedString(task.resultRaw, ["output", "url"])],
    ["resultRaw.outputs.0.url", getNestedString(task.resultRaw, ["outputs", "0", "url"])],
    ["resultRaw.data.0.url", getNestedString(task.resultRaw, ["data", "0", "url"])],
    ["resultRaw.data.url", getNestedString(task.resultRaw, ["data", "url"])]
  ];
  const found = candidates.find(([, url]) => /^https?:\/\//i.test(url));
  if (!found) return null;
  const [source, url] = found;
  return { url, kind: inferResultKind(url, source), source };
}
