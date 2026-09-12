import type { GenerationTask } from "../types/generation.js";
import type { ModelConfig } from "../types/model.js";
import type { ProviderConfig } from "../types/provider.js";

export interface ProviderCreateResult {
  providerTaskId: string;
  resultRaw: unknown;
  resultUrl: string;
}

export interface ProviderTaskResult {
  status?: GenerationTask["status"];
  resultRaw: unknown;
  resultUrl: string;
  errorMessage?: string;
}

export interface VideoProviderAdapter {
  createVideoTask(provider: ProviderConfig, model: ModelConfig, payload: Record<string, unknown>): Promise<ProviderCreateResult>;
  getVideoTask(provider: ProviderConfig, providerTaskId: string): Promise<ProviderTaskResult>;
}
