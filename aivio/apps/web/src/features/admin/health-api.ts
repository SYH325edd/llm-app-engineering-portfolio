import type { SystemHealth, SystemHealthChecks } from "@aivio/contracts";
import { apiRequest } from "../../shared/api/client";

export type { SystemHealth, SystemHealthChecks } from "@aivio/contracts";

export async function getSystemHealth() {
  return apiRequest<SystemHealth>("/health", { auth: false });
}
