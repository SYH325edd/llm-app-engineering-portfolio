import { apiRequest } from "./api";

export type AdminListParams = {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  userId?: string;
  modelId?: string;
  type?: string;
};

export type AdminStats = {
  userTotal: number;
  todayNewUsers: number;
  orderTotal: number;
  paidOrderTotal: number;
  rechargeAmount: number;
  totalBalance: number;
  taskTotal: number;
  succeededTaskTotal: number;
  failedTaskTotal: number;
  consumedCredits: number;
};

export type AdminUser = {
  id: string;
  email: string;
  nickname: string;
  role: string;
  balance: number;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminOrder = {
  id: string;
  userId: string;
  userEmail: string;
  userNickname: string;
  orderNo: string;
  amount: number;
  credits: number;
  paymentProvider: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminTask = {
  id: string;
  userId: string | null;
  userEmail: string;
  userNickname: string;
  modelDisplayName: string;
  modelId: string;
  prompt: string;
  status: string;
  cost: number;
  providerTaskId: string;
  resultUrl: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminCreditLog = {
  id: string;
  userId: string | null;
  userEmail: string;
  userNickname: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  relatedTaskId: string | null;
  relatedOrderId: string | null;
  remark: string;
  createdAt: string;
};

export type AdminLog = {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: unknown;
  createdAt: string;
};

export type AdminModel = {
  id: string;
  displayName: string;
  modelKey: string;
  providerId: string;
  providerKey: string;
  providerDisplayName: string;
  modelType: string;
  inputType: string;
  outputType: string;
  price: number;
  enabled: boolean;
  hasEnabledPricingRules?: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminProvider = {
  id: string;
  displayName: string;
  providerKey: string;
  enabled: boolean;
  baseUrl: string;
  apiKeyEnvName: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminPricingRule = {
  id: string;
  modelId: string;
  modelKeySnapshot: string;
  inputContainsVideo: boolean;
  audioMode: "audio" | "silent" | "default" | string;
  resolution: string;
  minOutputDuration: number;
  maxOutputDuration: number;
  minInputVideoDuration: number | null;
  maxInputVideoDuration: number | null;
  minBillableInputVideoDuration: number | null;
  pointsPerSecond: number;
  baseRetailCnyPerSecond?: number;
  billableCnyPerSecond?: number;
  billableCreditsPerSecond?: number;
  currency?: "CNY" | string;
  creditRate?: number;
  retailMultiplier?: number;
  costPerSecondRmb: number | null;
  enabled: boolean;
  remark: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminModelPatch = Partial<Pick<AdminModel, "displayName" | "price" | "sortOrder" | "enabled">>;
export type AdminProviderPatch = Partial<Pick<AdminProvider, "displayName" | "baseUrl" | "apiKeyEnvName" | "enabled">>;
export type AdminModelCreate = Pick<AdminModel, "displayName" | "modelKey" | "modelType" | "inputType" | "outputType" | "price" | "enabled" | "sortOrder"> & {
  providerId?: string;
  providerKey?: string;
  configJson?: string;
  defaultPricingRules?: AdminPricingRulePayload[];
};
export type AdminProviderCreate = Pick<AdminProvider, "displayName" | "providerKey" | "baseUrl" | "apiKeyEnvName" | "enabled"> & {
  configJson?: string;
};
export type AdminPricingRulePayload = Omit<
  AdminPricingRule,
  | "id"
  | "modelId"
  | "modelKeySnapshot"
  | "createdAt"
  | "updatedAt"
  | "baseRetailCnyPerSecond"
  | "billableCnyPerSecond"
  | "billableCreditsPerSecond"
  | "currency"
  | "creditRate"
  | "retailMultiplier"
>;

type PageResult<T, K extends string> = {
  total: number;
  page: number;
  pageSize: number;
} & Record<K, T[]>;

function withParams(path: string, params?: AdminListParams) {
  if (!params) return path;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export async function getAdminStats() {
  const result = await apiRequest<{ stats: AdminStats }>("/admin/stats");
  return result.stats;
}

export function getAdminUsers(params?: AdminListParams) {
  return apiRequest<PageResult<AdminUser, "users">>(withParams("/admin/users", params));
}

export function getAdminUserDetail(userId: string) {
  return apiRequest<{ user: AdminUser; orders: AdminOrder[]; tasks: AdminTask[]; creditLogs: AdminCreditLog[] }>(`/admin/users/${userId}`);
}

export function adjustUserBalance(userId: string, amount: number, remark: string) {
  return apiRequest(`/admin/users/${userId}/adjust-balance`, { method: "POST", body: JSON.stringify({ amount, remark }) });
}

export function disableUser(userId: string) {
  return apiRequest(`/admin/users/${userId}/disable`, { method: "POST" });
}

export function enableUser(userId: string) {
  return apiRequest(`/admin/users/${userId}/enable`, { method: "POST" });
}

export function getAdminOrders(params?: AdminListParams) {
  return apiRequest<PageResult<AdminOrder, "orders">>(withParams("/admin/orders", params));
}

export function getAdminTasks(params?: AdminListParams) {
  return apiRequest<PageResult<AdminTask, "tasks">>(withParams("/admin/tasks", params));
}

export function getAdminCreditLogs(params?: AdminListParams) {
  return apiRequest<PageResult<AdminCreditLog, "logs">>(withParams("/admin/credit-logs", params));
}

export function getAdminLogs(params?: AdminListParams) {
  return apiRequest<PageResult<AdminLog, "logs">>(withParams("/admin/admin-logs", params));
}

export async function getAdminModels() {
  const result = await apiRequest<{ models: AdminModel[] }>("/admin/models");
  return result.models;
}

export function updateAdminModel(modelId: string, payload: AdminModelPatch) {
  return apiRequest(`/admin/models/${modelId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function createAdminModel(payload: AdminModelCreate) {
  return apiRequest<{ model: AdminModel }>(`/admin/models`, { method: "POST", body: JSON.stringify(payload) });
}

export function deleteAdminModel(modelId: string) {
  return apiRequest(`/admin/models/${modelId}`, { method: "DELETE" });
}

export async function getAdminPricingRules(modelId: string) {
  const result = await apiRequest<{ rules: AdminPricingRule[] }>(`/admin/models/${modelId}/pricing-rules`);
  return result.rules;
}

export function createAdminPricingRule(modelId: string, payload: AdminPricingRulePayload) {
  return apiRequest<{ rule: AdminPricingRule }>(`/admin/models/${modelId}/pricing-rules`, { method: "POST", body: JSON.stringify(payload) });
}

export function updateAdminPricingRule(ruleId: string, payload: Partial<AdminPricingRulePayload>) {
  return apiRequest<{ rule: AdminPricingRule }>(`/admin/pricing-rules/${ruleId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteAdminPricingRule(ruleId: string) {
  return apiRequest(`/admin/pricing-rules/${ruleId}`, { method: "DELETE" });
}

export async function getAdminProviders() {
  const result = await apiRequest<{ providers: AdminProvider[] }>("/admin/providers");
  return result.providers;
}

export function updateAdminProvider(providerId: string, payload: AdminProviderPatch) {
  return apiRequest(`/admin/providers/${providerId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function createAdminProvider(payload: AdminProviderCreate) {
  return apiRequest<{ provider: AdminProvider }>("/admin/providers", { method: "POST", body: JSON.stringify(payload) });
}

export function deleteAdminProvider(providerId: string) {
  return apiRequest(`/admin/providers/${providerId}`, { method: "DELETE" });
}
