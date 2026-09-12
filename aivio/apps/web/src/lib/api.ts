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
  timeoutMs?: number;
};

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15000;
  const timeoutId = timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : null;

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
      headers,
      signal: options.signal ?? controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("Request timed out. Please try again later.", 408, "TIMEOUT_ERROR");
    }
    throw new ApiError(
      `Unable to reach the backend API at ${API_BASE_URL}. Please verify the Railway backend and CORS configuration.`,
      0,
      "NETWORK_ERROR"
    );
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }

  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError("The server returned an invalid response.", response.status || 500, "INVALID_JSON");
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredToken();
    }
    throw new ApiError(
      data?.error || (response.status === 401 ? "Login session expired. Please sign in again." : "Request failed. Please try again later."),
      response.status,
      data?.code
    );
  }

  return data as T;
}
