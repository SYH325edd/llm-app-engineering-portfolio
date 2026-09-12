import { apiRequest } from "./api";

export type PromptRewriteInput = {
  prompt: string;
  duration?: number;
  generationMode: "text" | "image" | "video";
  ratio: string;
  resolution: string;
};

export async function rewritePrompt(input: PromptRewriteInput, options: { signal?: AbortSignal } = {}) {
  const result = await apiRequest<{ rewrittenPrompt: string }>("/prompt/rewrite", {
    method: "POST",
    body: JSON.stringify(input),
    signal: options.signal
  });
  return result.rewrittenPrompt;
}
