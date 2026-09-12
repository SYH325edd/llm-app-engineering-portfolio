export type HealthCheckValue = boolean | "unknown";

export type SystemHealthChecks = {
  api: boolean;
  database: HealthCheckValue;
  corsConfigured: boolean;
  mockPaymentEnabled: boolean;
  volcengineConfigured: boolean;
  agnesConfigured: boolean;
  publicAssetBaseUrlConfigured: boolean;
};

export type SystemHealth = {
  ok: boolean;
  service: string;
  environment: string;
  trustProxy: boolean | number | string;
  corsOrigins: string[];
  timestamp: string;
  version: string;
  checks: SystemHealthChecks;
};
