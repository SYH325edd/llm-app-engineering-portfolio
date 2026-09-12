export type GenerationTaskStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";

export interface GenerationTask {
  id: string;
  userId?: string | null;
  provider: string;
  modelId: string;
  modelDisplayName: string;
  taskType: string;
  prompt: string;
  params: Record<string, unknown>;
  pricingBreakdown?: Record<string, unknown>;
  status: GenerationTaskStatus;
  cost: number;
  providerTaskId: string;
  resultUrl: string;
  resultRaw: unknown;
  errorMessage: string;
  statusMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGenerationTaskInput {
  userId?: string | null;
  provider: string;
  modelId: string;
  modelDisplayName: string;
  taskType: string;
  prompt: string;
  params: Record<string, unknown>;
  pricingBreakdown?: Record<string, unknown>;
  cost: number;
}

export interface VideoGenerationRequest {
  modelId?: string;
  model?: string;
  prompt?: string;
  inputType?: "text" | "image" | "video" | string;
  imageMode?: "first_frame" | "multi_image" | "first_last_frame" | "keyframes" | string;
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  referenceVideoAssetId?: string;
  referenceFrameAssetIds?: string[] | string;
  mode?: string;
  ratio?: string;
  aspect_ratio?: string;
  duration?: number | string;
  outputDuration?: number | string;
  inputContainsVideo?: boolean;
  inputVideoDuration?: number | string;
  resolution?: string;
  audioMode?: string;
  count?: number | string;
  seed?: number | string;
  generateAudio?: boolean;
  watermark?: boolean;
  imageUrl?: string;
  endImageUrl?: string;
  [key: string]: unknown;
}
