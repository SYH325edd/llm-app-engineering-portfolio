import { env, requireEnv } from "../../config/env.js";
import type { ProviderConfig } from "../../types/provider.js";
import { error as logError } from "../../utils/logger.js";

export interface AgnesResponse {
  status: number;
  body: unknown;
}

function joinApiPath(baseUrl: string, apiPath: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${apiPath.replace(/^\/+/, "")}`;
}

export function extractAgnesErrorMessage(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const candidate = value as {
    error?: { message?: unknown } | string;
    message?: unknown;
    errorMessage?: unknown;
  };
  if (typeof candidate.error === "string") return candidate.error;
  if (typeof candidate.error?.message === "string") return candidate.error.message;
  if (typeof candidate.message === "string") return candidate.message;
  if (typeof candidate.errorMessage === "string") return candidate.errorMessage;
  return "";
}

async function parseAgnesResponse(provider: ProviderConfig, label: string, response: Response): Promise<AgnesResponse> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message = response.status === 503
      ? "Agnes service is busy. Please try again later."
      : extractAgnesErrorMessage(body) || `Agnes request failed with status ${response.status}.`;
    logError("Provider request failed", {
      provider: provider.key,
      apiPath: label,
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

async function fetchWithAgnesTimeout(provider: ProviderConfig, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.agnesRequestTimeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: authHeaders(provider, init)
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logError("Provider request timed out", {
        provider: provider.key,
        url,
        timeoutMs: env.agnesRequestTimeoutMs
      });
      const timeoutError = new Error("Agnes request timed out. Please try again later.");
      (timeoutError as Error & { status?: number; cause?: unknown }).status = 504;
      (timeoutError as Error & { status?: number; cause?: unknown }).cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function authHeaders(provider: ProviderConfig, init: RequestInit): HeadersInit {
  const apiKey = requireEnv(provider.apiKeyEnvName);
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(init.headers || {})
  };
}

export async function requestAgnes(provider: ProviderConfig, apiPath: string, init: RequestInit): Promise<AgnesResponse> {
  const response = await fetchWithAgnesTimeout(provider, joinApiPath(provider.baseUrl, apiPath), init);
  return parseAgnesResponse(provider, apiPath, response);
}

export async function requestAgnesUrl(provider: ProviderConfig, url: string, init: RequestInit): Promise<AgnesResponse> {
  const response = await fetchWithAgnesTimeout(provider, url, init);
  return parseAgnesResponse(provider, url, response);
}
