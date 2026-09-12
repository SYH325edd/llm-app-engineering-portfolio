import { Router } from "express";
import { rewritePrompt } from "../services/prompt-rewrite.service.js";
import { fail, ok } from "../utils/response.js";
import type { PromptRewriteInput } from "../services/prompt-rewrite.service.js";

export const promptRoutes = Router();

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  return 500;
}

promptRoutes.post("/prompt/rewrite", async (req, res) => {
  try {
    const rewrittenPrompt = await rewritePrompt(req.body as PromptRewriteInput);
    ok(res, { rewrittenPrompt });
  } catch (error) {
    const status = getErrorStatus(error);
    const message = status >= 500 ? "优化错误，请重试" : error instanceof Error ? error.message : "优化错误，请重试";
    fail(res, status, message);
  }
});
