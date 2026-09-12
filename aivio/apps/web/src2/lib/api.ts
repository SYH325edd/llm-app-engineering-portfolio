const DEFAULT_API_BASE_URL = "https://aivio-production.up.railway.app/api";

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_API_BASE_URL;
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_BASEURL || "";

export const API_BASE_URL = normalizeApiBaseUrl(configuredApiBaseUrl);

const TOKEN_KEY = "aivio_auth_token";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
}

type ApiRequestOptions = RequestInit & {
  auth?: boolean;
};

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type") && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.auth !== false && token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers
    });
  } catch {
    throw new ApiError(
      `无法连接后端 API。当前请求地址：${API_BASE_URL}。请确认 Railway 后端已启动，并且 Railway 的 CORS_ORIGIN 已包含当前前端域名。`,
      0,
      "NETWORK_ERROR"
    );
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredToken();
    }
    throw new ApiError(
      data?.error || (response.status === 401 ? "登录状态已失效，请重新登录。" : "请求失败，请稍后重试。"),
      response.status,
      data?.code
    );
  }

  return data as T;
}
