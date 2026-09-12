import { Router } from "express";
import { chatService, NODE_CHAT_NOT_CONFIGURED_MESSAGE } from "../services/chat.service.js";
import { fail, ok } from "../utils/response.js";
import type { ChatCompletionRequest } from "../types/chat.js";

export const chatRoutes = Router();

function getErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message === NODE_CHAT_NOT_CONFIGURED_MESSAGE) return 400;
  if (/required/i.test(message)) return 400;
  return 500;
}

chatRoutes.post("/chat/completions", async (req, res) => {
  try {
    const result = await chatService.createChatCompletion(req.body as ChatCompletionRequest);
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});
