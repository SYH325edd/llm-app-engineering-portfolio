import { requireEnv } from "../../config/env.js";
import type { ProviderConfig } from "../../types/provider.js";
import { error as logError } from "../../utils/logger.js";

export interface UpstreamResponse {
  status: number;
  body: unknown;
}

function joinApiPath(baseUrl: string, apiPath: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${apiPath.replace(/^\/+/, "")}`;
}

function publicVolcengineError(status: number, message: string): string {
  if (status === 401 || status === 403 || /permission|unauthori[sz]ed|forbidden|无权|权限/i.test(message)) {
    return "火山方舟鉴权失败或无权访问该模型，请检查 API Key 权限和接入点 ID。";
  }
  if (status === 404 || /not\s*found|model.*not.*exist|模型.*不存在|接入点.*不存在/i.test(message)) {
    return "火山方舟未找到该模型接入点，请检查“模型标识 / 接入点 ID”是否正确并已开通。";
  }
  return message || `火山方舟请求失败，状态码 ${status}。`;
}

export async function requestVolcengine(provider: ProviderConfig, apiPath: string, init: RequestInit): Promise<UpstreamResponse> {
  const apiKey = requireEnv(provider.apiKeyEnvName);
  const response = await fetch(joinApiPath(provider.baseUrl, apiPath), {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const upstreamMessage = extractErrorMessage(body) || `Volcengine request failed with status ${response.status}`;
    const message = publicVolcengineError(response.status, upstreamMessage);
    logError("Provider request failed", {
      provider: provider.key,
      apiPath,
      status: response.status,
      message
    });
    const error = new Error(message);
    (error as Error & { status?: number; body?: unknown }).status = response.status;
    (error as Error & { status?: number; body?: unknown }).body = body;
    throw error;
  }

  return { status: response.status, body };
}

export function extractErrorMessage(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const candidate = value as { error?: { message?: unknown }; message?: unknown; errorMessage?: unknown };
  if (typeof candidate.error?.message === "string") return candidate.error.message;
  if (typeof candidate.message === "string") return candidate.message;
  if (typeof candidate.errorMessage === "string") return candidate.errorMessage;
  return "";
}
