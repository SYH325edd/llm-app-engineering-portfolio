import { getEnv } from "../config/env.js";
import { getProviderByKey } from "../config/providers.js";
import { log } from "../utils/logger.js";

export type PromptRewriteInput = {
  prompt?: unknown;
  duration?: unknown;
  generationMode?: unknown;
  ratio?: unknown;
  resolution?: unknown;
};

const AGNES_REWRITE_MODEL = "agnes-2.0-flash";
const DEFAULT_AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1";
const PROMPT_REWRITE_TIMEOUT_MS = 15000;
const GLOBAL_CONSTRAINT = "全局约束：写实电影风格，4K画质，光影自然，画面稳定，无畸形、无闪烁、无跳帧、无多余主体。";
const SYSTEM_PROMPT = `你是一名顶级导演、摄影指导和 AI 视频提示词优化专家。
你的任务是把用户输入的原始创意，改写成可以直接用于 AI 视频生成模型的中文 Prompt。

硬性要求：
- 保持用户原意，不要跑题；
- 不要解释，不要输出标题，不要输出分析，只输出最终 Prompt；
- 每段都要包含主体、动作、场景、光线、景别、机位、镜头运动、视觉风格、质量要求和负面约束；
- 每段都要出现明确镜头语言，例如“中景固定机位”“低机位仰拍”“近景平视机位”“镜头缓慢推进”“镜头轻微横移”“镜头跟随主体移动”；
- 每段都要出现明确光线，例如“黄昏暖色侧逆光”“柔和自然光”“霓虹反射光”“室内顶光与窗边侧光”；
- 每段都要包含视觉风格和质量控制，例如“写实电影风格，4K画质，画面稳定”；
- 每段都要包含负面约束，例如“无畸形、无闪烁、无跳帧、无多余主体”；
- 不要出现“根据文字描述”“生成主体明确”“动作清晰的视频画面”“建立画面主体与环境”等模板废话；
- 不要把“720p、16:9、输出规格”这类参数机械写入正文，除非用户原文明确要求。

6 秒以内输出单段格式：
主体，动作，场景环境，光线氛围，景别+机位+镜头运动，视觉风格，4K画质，画面稳定，无畸形、无闪烁、无跳帧、无多余主体。

6 秒以上输出分镜格式：
0-3秒：主体 + 动作 + 场景 + 光线 + 景别 + 机位 + 镜头运动。
3-6秒：主体 + 动作发展 + 环境细节 + 光线变化 + 镜头运动。
6-9秒：动作收束 + 画面落点 + 镜头收束。
全局约束：写实电影风格，4K画质，光影自然，画面稳定，无畸形、无闪烁、无跳帧、无多余主体。`;

function text(value: unknown): string {
  return String(value || "").trim();
}

function normalizeDuration(value: unknown): number {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return 6;
  return Math.min(15, Math.max(4, Math.round(duration)));
}

function normalizeMode(value: unknown): string {
  const mode = text(value);
  return ["text", "image", "video"].includes(mode) ? mode : "text";
}

function normalizeInput(input: PromptRewriteInput) {
  const prompt = text(input.prompt);
  if (!prompt) {
    throw Object.assign(new Error("请先输入创意描述"), { status: 400 });
  }
  if (prompt.length > 1000) {
    throw Object.assign(new Error("创意描述不能超过 1000 字"), { status: 400 });
  }
  return {
    prompt,
    duration: normalizeDuration(input.duration),
    generationMode: normalizeMode(input.generationMode),
    ratio: text(input.ratio) || "16:9",
    resolution: text(input.resolution) || "720p"
  };
}

function getAgnesApiKey(): string {
  return getEnv("AGNES_API_KEY").trim();
}

function getAgnesBaseUrl(): string {
  return (
    getEnv("AGNES_BASE_URL").trim() ||
    getProviderByKey("agnes")?.baseUrl ||
    DEFAULT_AGNES_BASE_URL
  ).replace(/\/+$/, "");
}

function buildUserMessage(input: ReturnType<typeof normalizeInput>): string {
  return [
    "原始 prompt：",
    input.prompt,
    "",
    "上下文参数仅用于判断输出结构和生成模式，不要机械写进正文：",
    `duration：${input.duration}`,
    `generationMode：${input.generationMode}`,
    `ratio：${input.ratio}`,
    `resolution：${input.resolution}`
  ].join("\n");
}

function preview(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 200);
}

function extractChatContent(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
  const content = first?.message?.content ?? first?.text;
  return typeof content === "string" ? content.trim() : "";
}

function hasKeywordGroup(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizeRewrittenPrompt(value: string): string {
  const compact = value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  const needsConstraint = [
    [/镜头|运镜|推进|推近|拉远|横移|环绕|跟随|固定机位|摇移/],
    [/机位|平视|俯拍|仰拍|低机位|高机位|固定机位/],
    [/光线|光影|夕阳|黄昏|柔光|逆光|侧光|自然光|暖色|冷色/],
    [/风格|写实|电影|纪实|胶片/],
    [/4K|画质|高清|细节清晰/],
    [/无畸形|无闪烁|无跳帧|无多余主体/]
  ].some((patterns) => !hasKeywordGroup(compact, patterns));
  return needsConstraint ? `${compact}\n${GLOBAL_CONSTRAINT}` : compact;
}

async function rewriteWithAgnes(input: ReturnType<typeof normalizeInput>): Promise<string> {
  const apiKey = getAgnesApiKey();
  if (!apiKey) {
    log("Prompt rewrite provider: agnes", { called: false, reason: "missing_key" });
    return "";
  }
  const userMessage = buildUserMessage(input);
  log("Prompt rewrite provider: agnes", { called: true });
  if (getEnv("PROMPT_REWRITE_DEBUG").trim() === "1") {
    log("Prompt rewrite Agnes request preview", {
      systemPromptPreview: preview(SYSTEM_PROMPT),
      userPromptPreview: preview(userMessage),
      duration: input.duration,
      generationMode: input.generationMode,
      ratio: input.ratio,
      resolution: input.resolution
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROMPT_REWRITE_TIMEOUT_MS);
  try {
    const response = await fetch(`${getAgnesBaseUrl()}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: AGNES_REWRITE_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        temperature: 0.45
      })
    });

    if (!response.ok) return "";
    const body = await response.json().catch(() => null);
    return extractChatContent(body);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function rewritePrompt(input: PromptRewriteInput): Promise<string> {
  const normalized = normalizeInput(input);
  const aiPrompt = await rewriteWithAgnes(normalized);
  if (!aiPrompt) {
    throw Object.assign(new Error("优化错误，请重试"), { status: 502 });
  }
  return normalizeRewrittenPrompt(aiPrompt);
}
