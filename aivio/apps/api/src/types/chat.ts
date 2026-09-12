export interface ChatMessage {
  role: "system" | "user" | "assistant" | string;
  content: string;
}

export interface ChatCompletionRequest {
  provider?: string;
  model?: string;
  messages?: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
}
