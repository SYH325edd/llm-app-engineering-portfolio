import { getModels } from "../config/models.js";
import { getProviders } from "../config/providers.js";
import type { ModelConfig } from "../types/model.js";
import type { ProviderConfig, PublicProvider } from "../types/provider.js";
import { createId } from "../utils/id.js";
import { prisma } from "./database.service.js";

type DbProvider = {
  id: string;
  providerKey: string;
  displayName: string;
  baseUrl: string;
  apiKeyEnvName: string;
  enabled: boolean;
  configJson: string;
  createdAt: Date;
  updatedAt: Date;
};

type DbModel = {
  id: string;
  modelKey: string;
  providerId: string;
  displayName: string;
  modelType: string;
  inputType: string;
  outputType: string;
  price: number;
  enabled: boolean;
  sortOrder: number;
  configJson: string;
  createdAt: Date;
  updatedAt: Date;
  provider?: DbProvider;
  pricingRules?: Array<{ id: string }>;
};

type ModelPatch = {
  displayName?: unknown;
  price?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
};

type ModelCreateInput = {
  displayName?: unknown;
  modelKey?: unknown;
  providerId?: unknown;
  providerKey?: unknown;
  modelType?: unknown;
  inputType?: unknown;
  outputType?: unknown;
  price?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
  configJson?: unknown;
};

type ProviderPatch = {
  displayName?: unknown;
  enabled?: unknown;
  baseUrl?: unknown;
  apiKeyEnvName?: unknown;
};

type ProviderCreateInput = {
  displayName?: unknown;
  providerKey?: unknown;
  baseUrl?: unknown;
  apiKeyEnvName?: unknown;
  enabled?: unknown;
  configJson?: unknown;
};

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function toProviderConfig(provider: DbProvider): ProviderConfig {
  const config = parseJsonObject(provider.configJson);
  return {
    key: provider.providerKey,
    displayName: provider.displayName,
    adapter: String(config.adapter || provider.providerKey),
    baseUrl: provider.baseUrl,
    apiKeyEnvName: provider.apiKeyEnvName,
    enabled: provider.enabled
  };
}

function toModelConfig(model: DbModel): ModelConfig {
  const config = parseJsonObject(model.configJson);
  return {
    id: model.modelKey,
    displayName: model.displayName,
    provider: model.provider?.providerKey || String(config.provider || ""),
    modelType: model.modelType,
    inputType: model.inputType,
    outputType: model.outputType,
    price: model.price,
    enabled: model.enabled,
    defaultParams: config.defaultParams && typeof config.defaultParams === "object" ? (config.defaultParams as Record<string, unknown>) : undefined
  };
}

function toAdminProvider(provider: DbProvider) {
  return {
    id: provider.id,
    providerKey: provider.providerKey,
    displayName: provider.displayName,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl,
    apiKeyEnvName: provider.apiKeyEnvName,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString()
  };
}

function toAdminModel(model: DbModel) {
  return {
    id: model.id,
    modelKey: model.modelKey,
    displayName: model.displayName,
    providerId: model.providerId,
    providerKey: model.provider?.providerKey || "",
    providerDisplayName: model.provider?.displayName || "",
    modelType: model.modelType,
    inputType: model.inputType,
    outputType: model.outputType,
    price: model.price,
    enabled: model.enabled,
    hasEnabledPricingRules: Boolean(model.pricingRules?.length),
    sortOrder: model.sortOrder,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString()
  };
}

function toAdminModelWithSequentialSort(model: DbModel, sortOrder: number) {
  return {
    ...toAdminModel(model),
    sortOrder
  };
}

function isRealKeyLike(value: string): boolean {
  return /(^|\b)(sk-|ark-|Bearer\s+|AKIA|AIza|xox[baprs]-)/i.test(value);
}

function containsEndpointId(value: string): boolean {
  return /\bep-[a-z0-9-]+\b/i.test(value);
}

function assertSafeConfigJson(value: unknown, _field = "configJson"): string {
  if (value === undefined || value === null || value === "") return "{}";
  const json = typeof value === "string" ? value.trim() : stringifyJson(value);
  if (isRealKeyLike(json)) {
    throw Object.assign(new Error("配置中疑似包含真实密钥，请不要在这里填写 API Key。"), { status: 400 });
  }
  if (containsEndpointId(json)) {
    throw Object.assign(new Error("接入点 ID 请填写到“模型标识 / 接入点 ID”，配置 JSON 请填写 {}。"), { status: 400 });
  }
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not object");
    }
  } catch {
    throw Object.assign(new Error("配置 JSON 必须是对象格式，例如 {}。"), { status: 400 });
  }
  return json;
}

function assertEnvName(value: string): void {
  if (!value) return;
  if (isRealKeyLike(value) || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
    throw Object.assign(new Error("密钥环境变量名必须是环境变量名，不能填写真实 API Key。"), { status: 400 });
  }
}

function getBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function getInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw Object.assign(new Error(`${field} must be an integer.`), { status: 400 });
  }
  return parsed;
}

function getRequiredText(value: unknown, field: string): string {
  const text = String(value || "").trim();
  if (!text) {
    throw Object.assign(new Error(`${field} 不能为空。`), { status: 400 });
  }
  return text;
}

export class ModelRegistryService {
  async hasDatabaseModels(): Promise<boolean> {
    return (await prisma.model.count()) > 0;
  }

  private publicModelWhere() {
    return {
      enabled: true,
      provider: { enabled: true },
      OR: [
        { modelType: { not: "video" } },
        { pricingRules: { some: { enabled: true } } }
      ]
    };
  }

  async getPublicModels(): Promise<ModelConfig[]> {
    if (!(await this.hasDatabaseModels())) {
      return getModels().filter((model) => model.enabled);
    }
    const models = (await prisma.model.findMany({
      where: {
        enabled: true,
        provider: { enabled: true }
      },
      include: { provider: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    })) as DbModel[];
    return models.map(toModelConfig);
  }

  async getPublicProviders(): Promise<PublicProvider[]> {
    if (!(await this.hasDatabaseModels())) {
      const models = getModels().filter((model) => model.enabled);
      return getProviders()
        .filter((provider) => provider.enabled)
        .map((provider) => this.toPublicProvider(provider, models));
    }
    const providers = (await prisma.provider.findMany({
      where: { enabled: true },
      include: {
        models: {
          where: {
            enabled: true,
            OR: [
              { modelType: { not: "video" } },
              { pricingRules: { some: { enabled: true } } }
            ]
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        }
      },
      orderBy: { createdAt: "asc" }
    })) as Array<DbProvider & { models: DbModel[] }>;
    return providers
      .map((provider) => this.toPublicProvider(toProviderConfig(provider), provider.models.map((model) => toModelConfig({ ...model, provider }))))
      .filter((provider) => provider.models.length > 0);
  }

  async getPublicVideoProviders(): Promise<PublicProvider[]> {
    return (await this.getPublicProviders())
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((model) => model.modelType === "video"),
        capabilities: provider.capabilities.filter((capability) => capability === "video")
      }))
      .filter((provider) => provider.models.length > 0);
  }

  async getGenerationModel(modelKey: string): Promise<ModelConfig | undefined> {
    if (!(await this.hasDatabaseModels())) {
      return getModels().find((model) => model.id === modelKey);
    }
    const model = (await prisma.model.findUnique({
      where: { modelKey },
      include: { provider: true }
    })) as DbModel | null;
    return model ? toModelConfig(model) : undefined;
  }

  async getGenerationProvider(providerKey: string): Promise<ProviderConfig | undefined> {
    if (!(await this.hasDatabaseModels())) {
      return getProviders().find((provider) => provider.key === providerKey);
    }
    const provider = (await prisma.provider.findUnique({ where: { providerKey } })) as DbProvider | null;
    return provider ? toProviderConfig(provider) : undefined;
  }

  async listAdminModels() {
    const models = (await prisma.model.findMany({
      include: { provider: true, pricingRules: { where: { enabled: true }, select: { id: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    })) as DbModel[];
    return { models: models.map((model, index) => toAdminModelWithSequentialSort(model, index + 1)) };
  }

  async updateAdminModel(modelId: string, patch: ModelPatch) {
    const existing = (await prisma.model.findUnique({ where: { id: modelId }, include: { provider: true } })) as DbModel | null;
    if (!existing) throw Object.assign(new Error(`Model '${modelId}' was not found.`), { status: 404 });

    const data: Record<string, unknown> = {};
    if (patch.displayName !== undefined) data.displayName = String(patch.displayName).trim();
    if (patch.enabled !== undefined) data.enabled = getBoolean(patch.enabled, existing.enabled);
    if (patch.sortOrder !== undefined) data.sortOrder = getInteger(patch.sortOrder, "sortOrder");
    if (patch.price !== undefined) {
      const price = getInteger(patch.price, "price");
      if (price < 0) throw Object.assign(new Error("price must not be negative."), { status: 400 });
      data.price = price;
    }

    const updated = (await prisma.model.update({
      where: { id: modelId },
      data,
      include: { provider: true }
    })) as DbModel;
    return toAdminModel(updated);
  }

  async createAdminModel(input: ModelCreateInput) {
    const displayName = getRequiredText(input.displayName, "模型名称");
    const modelKey = getRequiredText(input.modelKey, "模型标识");
    const providerId = String(input.providerId || "").trim();
    const providerKey = String(input.providerKey || "").trim();
    const provider = providerId
      ? ((await prisma.provider.findUnique({ where: { id: providerId } })) as DbProvider | null)
      : providerKey
        ? ((await prisma.provider.findUnique({ where: { providerKey } })) as DbProvider | null)
        : null;
    if (!provider) throw Object.assign(new Error("供应商不存在。"), { status: 400 });
    if (await prisma.model.findUnique({ where: { modelKey } })) {
      throw Object.assign(new Error("模型标识已存在。"), { status: 409 });
    }
    const price = input.price === undefined ? 0 : getInteger(input.price, "单次价格");
    if (price < 0) throw Object.assign(new Error("模型价格不能为负数。"), { status: 400 });
    const created = (await prisma.model.create({
      data: {
        id: createId(),
        modelKey,
        providerId: provider.id,
        displayName,
        modelType: getRequiredText(input.modelType, "模型类型"),
        inputType: getRequiredText(input.inputType, "输入类型"),
        outputType: getRequiredText(input.outputType, "输出类型"),
        price,
        enabled: getBoolean(input.enabled, true),
        sortOrder: input.sortOrder === undefined ? 1 : getInteger(input.sortOrder, "排序"),
        configJson: assertSafeConfigJson(input.configJson)
      },
      include: { provider: true }
    })) as DbModel;
    return toAdminModel(created);
  }

  async deleteAdminModel(modelId: string) {
    const existing = (await prisma.model.findUnique({ where: { id: modelId }, include: { provider: true } })) as DbModel | null;
    if (!existing) throw Object.assign(new Error("模型不存在。"), { status: 404 });
    await prisma.model.delete({ where: { id: modelId } });
    return toAdminModel(existing);
  }

  async listAdminProviders() {
    const providers = (await prisma.provider.findMany({ orderBy: { createdAt: "asc" } })) as DbProvider[];
    return { providers: providers.map(toAdminProvider) };
  }

  async updateAdminProvider(providerId: string, patch: ProviderPatch) {
    const existing = (await prisma.provider.findUnique({ where: { id: providerId } })) as DbProvider | null;
    if (!existing) throw Object.assign(new Error(`Provider '${providerId}' was not found.`), { status: 404 });

    const data: Record<string, unknown> = {};
    if (patch.displayName !== undefined) data.displayName = String(patch.displayName).trim();
    if (patch.enabled !== undefined) data.enabled = getBoolean(patch.enabled, existing.enabled);
    if (patch.baseUrl !== undefined) data.baseUrl = String(patch.baseUrl || "").trim();
    if (patch.apiKeyEnvName !== undefined) {
      const apiKeyEnvName = String(patch.apiKeyEnvName || "").trim();
      assertEnvName(apiKeyEnvName);
      data.apiKeyEnvName = apiKeyEnvName;
    }

    const updated = (await prisma.provider.update({
      where: { id: providerId },
      data
    })) as DbProvider;
    return toAdminProvider(updated);
  }

  async createAdminProvider(input: ProviderCreateInput) {
    const displayName = getRequiredText(input.displayName, "供应商名称");
    const providerKey = getRequiredText(input.providerKey, "供应商标识");
    const apiKeyEnvName = String(input.apiKeyEnvName || "").trim();
    assertEnvName(apiKeyEnvName);
    if (await prisma.provider.findUnique({ where: { providerKey } })) {
      throw Object.assign(new Error("供应商标识已存在。"), { status: 409 });
    }
    const provider = (await prisma.provider.create({
      data: {
        id: createId(),
        providerKey,
        displayName,
        baseUrl: String(input.baseUrl || "").trim(),
        apiKeyEnvName,
        enabled: getBoolean(input.enabled, true),
        configJson: assertSafeConfigJson(input.configJson)
      }
    })) as DbProvider;
    return toAdminProvider(provider);
  }

  async deleteAdminProvider(providerId: string) {
    const existing = (await prisma.provider.findUnique({ where: { id: providerId } })) as DbProvider | null;
    if (!existing) throw Object.assign(new Error("供应商不存在。"), { status: 404 });
    const modelCount = await prisma.model.count({ where: { providerId } });
    if (modelCount > 0) {
      throw Object.assign(new Error("当前供应商下仍有关联模型，请先删除或迁移模型。"), { status: 400 });
    }
    await prisma.provider.delete({ where: { id: providerId } });
    return toAdminProvider(existing);
  }

  async syncFromConfig() {
    const providers = getProviders();
    const models = getModels();
    const providerRows = new Map<string, DbProvider>();

    for (const provider of providers) {
      assertEnvName(provider.apiKeyEnvName);
      const existing = (await prisma.provider.findUnique({ where: { providerKey: provider.key } })) as DbProvider | null;
      const row = (await prisma.provider.upsert({
        where: { providerKey: provider.key },
        create: {
          id: createId(),
          providerKey: provider.key,
          displayName: provider.displayName,
          baseUrl: provider.baseUrl || "",
          apiKeyEnvName: provider.apiKeyEnvName || "",
          enabled: Boolean(provider.enabled),
          configJson: stringifyJson({ adapter: provider.adapter })
        },
        update: {
          displayName: provider.displayName,
          baseUrl: provider.baseUrl || "",
          apiKeyEnvName: provider.apiKeyEnvName || "",
          enabled: Boolean(provider.enabled),
          configJson: stringifyJson({ ...parseJsonObject(existing?.configJson || "{}"), adapter: provider.adapter })
        }
      })) as DbProvider;
      providerRows.set(provider.key, row);
    }

    let sortOrder = 1;
    for (const model of models) {
      const provider = providerRows.get(model.provider);
      if (!provider) continue;
      const existing = (await prisma.model.findUnique({ where: { modelKey: model.id } })) as DbModel | null;
      const config = parseJsonObject(existing?.configJson || "{}");
      await prisma.model.upsert({
        where: { modelKey: model.id },
        create: {
          id: createId(),
          modelKey: model.id,
          providerId: provider.id,
          displayName: model.displayName,
          modelType: model.modelType,
          inputType: model.inputType,
          outputType: model.outputType,
          price: model.price,
          enabled: Boolean(model.enabled),
          sortOrder,
          configJson: stringifyJson(config)
        },
        update: {
          providerId: provider.id,
          displayName: model.displayName,
          modelType: model.modelType,
          inputType: model.inputType,
          outputType: model.outputType,
          price: model.price,
          enabled: Boolean(model.enabled),
          configJson: stringifyJson(config)
        }
      });
      sortOrder += 1;
    }

    return {
      providers: providers.length,
      models: models.length
    };
  }

  private toPublicProvider(provider: ProviderConfig, models: ModelConfig[]): PublicProvider {
    const providerModels = models.filter((model) => model.provider === provider.key);
    return {
      provider: provider.key,
      displayName: provider.displayName,
      enabled: provider.enabled,
      models: providerModels.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        modelType: model.modelType,
        inputType: model.inputType,
        outputType: model.outputType
      })),
      capabilities: Array.from(new Set(providerModels.map((model) => model.modelType)))
    };
  }
}

export const modelRegistryService = new ModelRegistryService();
