import type { ChatCompletionRequest, ChatCompletionResponse } from "../types/chat.js";
import type { ModelConfig } from "../types/model.js";
import type { ProviderConfig } from "../types/provider.js";

export interface ChatProviderAdapter {
  createChatCompletion(
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    payload: ChatCompletionRequest
  ): Promise<ChatCompletionResponse>;
}
