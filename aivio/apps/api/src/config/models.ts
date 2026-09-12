import fs from "node:fs";
import { env } from "./env.js";
import type { ModelConfig, ModelsFile } from "../types/model.js";

export function getModels(): ModelConfig[] {
  const raw = fs.readFileSync(env.modelsPath, "utf8");
  const parsed = JSON.parse(raw) as ModelsFile;
  return parsed.models || [];
}

export function getEnabledModels(): ModelConfig[] {
  return getModels().filter((model) => model.enabled);
}

export function getEnabledVideoModels(): ModelConfig[] {
  return getEnabledModels().filter((model) => model.modelType === "video");
}

export function getModelById(modelId: string): ModelConfig | undefined {
  return getModels().find((model) => model.id === modelId);
}
