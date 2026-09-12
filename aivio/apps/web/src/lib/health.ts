import { apiRequest } from "./api";

export type SystemHealthChecks = {
  api: boolean;
  database: boolean | "unknown";
  corsConfigured: boolean;
  mockPaymentEnabled: boolean;
  volcengineConfigured: boolean;
  agnesConfigured: boolean;
  publicAssetBaseUrlConfigured: boolean;
};

export type SystemHealth = {
  ok: boolean;
  service: string;
  time: string;
  environment: string;
  checks: SystemHealthChecks;
};

export async function getSystemHealth() {
  return apiRequest<SystemHealth>("/health", { auth: false });
}
