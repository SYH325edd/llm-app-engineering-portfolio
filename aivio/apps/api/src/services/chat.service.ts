import { getEnv } from "../config/env.js";
import { getEnabledModels, getModelById } from "../config/models.js";
import { getProviderByKey } from "../config/providers.js";
import type { ChatProviderAdapter } from "../providers/chat-provider.interface.js";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../types/chat.js";
import type { ModelConfig } from "../types/model.js";

export const NODE_CHAT_NOT_CONFIGURED_MESSAGE = "Node API 当前未配置聊天模型，请联系管理员或切换回 PowerShell API。";

const chatAdapters: Record<string, ChatProviderAdapter> = {};

function getChatModel(payload: ChatCompletionRequest): ModelConfig | undefined {
  if (payload.model) {
    const model = getModelById(payload.model);
    if (model?.enabled && model.modelType === "chat") return model;
    return undefined;
  }

  return getEnabledModels().find((model) => model.modelType === "chat");
}

function ensureMessages(payload: ChatCompletionRequest): void {
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw new Error("messages is required.");
  }
}

export class ChatService {
  async createChatCompletion(payload: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    ensureMessages(payload);

    const model = getChatModel(payload);
    if (!model) {
      throw new Error(NODE_CHAT_NOT_CONFIGURED_MESSAGE);
    }

    const provider = getProviderByKey(payload.provider || model.provider);
    if (!provider?.enabled) {
      throw new Error(NODE_CHAT_NOT_CONFIGURED_MESSAGE);
    }

    const apiKey = getEnv(provider.apiKeyEnvName);
    if (!apiKey.trim()) {
      throw new Error(NODE_CHAT_NOT_CONFIGURED_MESSAGE);
    }

    const adapter = chatAdapters[provider.adapter];
    if (!adapter) {
      throw new Error(NODE_CHAT_NOT_CONFIGURED_MESSAGE);
    }

    return adapter.createChatCompletion(provider, model, apiKey, payload);
  }
}

export const chatService = new ChatService();
