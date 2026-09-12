import fs from "node:fs";
import { env } from "./env.js";
import { getEnabledModels } from "./models.js";
import type { ModelConfig } from "../types/model.js";
import type { ProviderConfig, ProvidersFile, PublicProvider } from "../types/provider.js";

export function getProviders(): ProviderConfig[] {
  const raw = fs.readFileSync(env.providersPath, "utf8");
  const parsed = JSON.parse(raw) as ProvidersFile;
  return parsed.providers || [];
}

export function getProviderByKey(providerKey: string): ProviderConfig | undefined {
  return getProviders().find((provider) => provider.key === providerKey);
}

export function getPublicProviders(): PublicProvider[] {
  const models = getEnabledModels();
  return getProviders().map((provider) => ({
    provider: provider.key,
    displayName: provider.displayName,
    enabled: provider.enabled,
    models: models
      .filter((model: ModelConfig) => model.provider === provider.key)
      .map((model) => ({
        id: model.id,
        displayName: model.displayName,
        modelType: model.modelType,
        inputType: model.inputType,
        outputType: model.outputType
      })),
    capabilities: Array.from(new Set(models.filter((model) => model.provider === provider.key).map((model) => model.modelType)))
  }));
}

export function getPublicVideoProviders(): PublicProvider[] {
  return getPublicProviders()
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.modelType === "video"),
      capabilities: provider.capabilities.filter((capability) => capability === "video")
    }))
    .filter((provider) => provider.models.length > 0);
}
