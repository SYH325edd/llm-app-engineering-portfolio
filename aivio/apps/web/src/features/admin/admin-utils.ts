import type { LucideIcon } from "lucide-react";
import { ApiError } from "../../shared/api/client";
import type { AdminModel, AdminModelCreate, AdminPricingRulePayload, AdminProvider, AdminProviderCreate } from "./api";

export type ModuleKey = "overview" | "users" | "orders" | "giftCards" | "tasks" | "credits" | "models" | "providers" | "logs";
export type PeopleModuleKey = "users" | "orders" | "tasks" | "credits";
export type PersonSectionKey = "orders" | "tasks" | "credits";
export type StatusType = "success" | "failed" | "processing" | "waiting";
export type StatItem = [LucideIcon, string, string | number];
export type ModelDraft = Pick<AdminModel, "displayName" | "price" | "sortOrder" | "enabled">;
export type ProviderDraft = Pick<AdminProvider, "displayName" | "baseUrl" | "apiKeyEnvName" | "enabled">;
export type PricingDraft = AdminPricingRulePayload;

export const modules: Array<[ModuleKey, string]> = [
  ["overview", "数据总览"],
  ["users", "用户管理"],
  ["orders", "订单管理"],
  ["tasks", "任务管理"],
  ["credits", "积分流水"],
  ["models", "模型管理"],
  ["providers", "供应商管理"],
  ["logs", "操作日志"]
];
export const listParams = { page: 1, pageSize: 50 };
export const emptyModel: AdminModelCreate = {
  displayName: "",
  modelKey: "",
  providerId: "",
  modelType: "video",
  inputType: "text,image",
  outputType: "video",
  price: 0,
  enabled: true,
  sortOrder: 1,
  configJson: "{}"
};
export const emptyProvider: AdminProviderCreate = {
  displayName: "",
  providerKey: "",
  baseUrl: "",
  apiKeyEnvName: "",
  enabled: true,
  configJson: ""
};
export const emptyPricingRule: PricingDraft = {
  inputContainsVideo: false,
  audioMode: "default",
  resolution: "720p",
  minOutputDuration: 4,
  maxOutputDuration: 15,
  minInputVideoDuration: null,
  maxInputVideoDuration: null,
  minBillableInputVideoDuration: null,
  pointsPerSecond: 135,
  costPerSecondRmb: null,
  enabled: true,
  remark: ""
};

export type ModelTemplateKey = "seedance-2-0" | "seedance-2-0-fast" | "seedance-1-5-pro" | "seedance-1-0-pro-fast";

export type ModelTemplate = {
  key: ModelTemplateKey;
  label: string;
  sortOrder: number;
  rules: PricingDraft[];
};

export const VIDEO_CREDIT_RATE = 100;
export const VIDEO_SALES_MARKUP = 1.2;
export const peopleModules = new Set<PeopleModuleKey>(["users", "orders", "tasks", "credits"]);

export function pricingRule(resolution: string, pointsPerSecond: number, audioMode = "default"): PricingDraft {
  return {
    inputContainsVideo: false,
    audioMode,
    resolution,
    minOutputDuration: 4,
    maxOutputDuration: 15,
    minInputVideoDuration: null,
    maxInputVideoDuration: null,
    minBillableInputVideoDuration: null,
    pointsPerSecond,
    costPerSecondRmb: null,
    enabled: true,
    remark: ""
  };
}

export const modelTemplates: ModelTemplate[] = [
  { key: "seedance-2-0", label: "Seedance 2.0", sortOrder: 1, rules: [pricingRule("480p", 162), pricingRule("720p", 338), pricingRule("1080p", 756)] },
  { key: "seedance-2-0-fast", label: "Seedance 2.0 Fast", sortOrder: 2, rules: [pricingRule("480p", 122), pricingRule("720p", 270), pricingRule("1080p", 608)] },
  { key: "seedance-1-5-pro", label: "Seedance 1.5 Pro", sortOrder: 3, rules: [pricingRule("480p", 68, "silent"), pricingRule("720p", 135, "silent"), pricingRule("1080p", 338, "silent")] },
  { key: "seedance-1-0-pro-fast", label: "Seedance 1.0 Pro Fast", sortOrder: 4, rules: [pricingRule("480p", 27), pricingRule("720p", 68), pricingRule("1080p", 135)] }
];

export function calculateAdminSalesPriceFromCost(costPerSecondRmb?: number | null) {
  const cost = typeof costPerSecondRmb === "number" && Number.isFinite(costPerSecondRmb) ? Math.max(0, costPerSecondRmb) : 0;
  const salesCnyPerSecond = cost * VIDEO_SALES_MARKUP;
  const salesCreditsPerSecond = Math.ceil(salesCnyPerSecond * VIDEO_CREDIT_RATE);
  return { salesCnyPerSecond, salesCreditsPerSecond };
}

export function pointsFromCost(costPerSecondRmb?: number | null) {
  return calculateAdminSalesPriceFromCost(costPerSecondRmb).salesCreditsPerSecond;
}

export function withCostBasedSalesPoints(draft: PricingDraft): PricingDraft {
  return { ...draft, pointsPerSecond: pointsFromCost(draft.costPerSecondRmb) };
}

export function formatAdminCny(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

export function brief(value?: string | null, length = 42) {
  if (!value) return "--";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

export function userLabel(email: string, nickname: string, userId?: string | null) {
  return email || nickname || userId || "--";
}

export function containsSecretLike(value: string) {
  return /(^|\b)(sk-|ark-|Bearer\s+|AKIA|AIza|xox[baprs]-)/i.test(value);
}

export function containsEndpointId(value: string) {
  return /\bep-[a-z0-9-]+\b/i.test(value);
}

export function detailSummary(detail: unknown) {
  try {
    const text = JSON.stringify(detail ?? {});
    return containsSecretLike(text) ? "详情已隐藏，避免显示疑似密钥" : brief(text, 64);
  } catch {
    return "--";
  }
}

export function badgeStatus(status: string | boolean): StatusType {
  if (status === true || ["active", "paid", "succeeded"].includes(String(status))) return "success";
  if (status === false || ["disabled", "failed"].includes(String(status))) return "failed";
  if (["processing", "refunded"].includes(String(status))) return "processing";
  return "waiting";
}

export function healthBadgeStatus(status: boolean | "unknown"): StatusType {
  if (status === true) return "success";
  if (status === "unknown") return "waiting";
  return "failed";
}

export function healthBadgeLabel(status: boolean | "unknown") {
  if (status === true) return "正常";
  if (status === "unknown") return "未知";
  return "未就绪";
}

export function peopleModuleTitle(view: PeopleModuleKey) {
  if (view === "orders") return "璁㈠崟绠＄悊";
  if (view === "tasks") return "浠诲姟绠＄悊";
  if (view === "credits") return "绉垎娴佹按";
  return "鐢ㄦ埛绠＄悊";
}

export function peopleModuleDescription(view: PeopleModuleKey) {
  if (view === "orders") return "鎸変汉鍛樺睍寮€鏌ョ湅璁㈠崟锛屽悓鏃朵繚鐣欎换鍔″拰绉垎瀛愯彍鍗曘€?";
  if (view === "tasks") return "鎸変汉鍛樺睍寮€鏌ョ湅浠诲姟锛屼换鍔′綔涓鸿鐢ㄦ埛鐨勫瓙鑿滃崟銆?";
  if (view === "credits") return "鎸変汉鍛樺睍寮€鏌ョ湅绉垎娴佹按锛屽悓姝ュ叧鑱旇鍗曞拰浠诲姟銆?";
  return "鎸変汉鍛樼粍缁囨暟鎹紝灞曞紑鍗曚釜鐢ㄦ埛鍚庢煡鐪嬩换鍔°€佽鍗曞拰绉垎瀛愯彍鍗曘€?";
}

export function personModuleTitle(view: PeopleModuleKey) {
  if (view === "orders") return "订单管理";
  if (view === "tasks") return "任务管理";
  if (view === "credits") return "积分管理";
  return "用户管理";
}

export function personModuleDescription(view: PeopleModuleKey) {
  if (view === "orders") return "按人员查看订单数据。展开某个用户后，可以查看这个用户的订单、任务和积分记录。";
  if (view === "tasks") return "按人员查看任务数据。展开某个用户后，可以查看这个用户做过的任务，以及关联的订单和积分记录。";
  if (view === "credits") return "按人员查看积分数据。展开某个用户后，可以查看这个用户的积分流水，以及相关任务和订单。";
  return "按人员查看用户数据。展开某个用户后，可以查看这个用户的任务、订单和积分记录。";
}

export function orderedPersonSections(view: PeopleModuleKey): PersonSectionKey[] {
  if (view === "orders") return ["orders", "tasks", "credits"];
  if (view === "tasks") return ["tasks", "orders", "credits"];
  if (view === "credits") return ["credits", "tasks", "orders"];
  return ["tasks", "orders", "credits"];
}

export function defaultOpenSections(view: PeopleModuleKey): Record<PersonSectionKey, boolean> {
  const first = orderedPersonSections(view)[0];
  return {
    orders: first === "orders",
    tasks: first === "tasks",
    credits: first === "credits"
  };
}

export function adminError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "登录状态已失效，请重新登录。";
  if (error instanceof ApiError && error.status === 403) return "无权限访问。";
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof TypeError) return "服务连接失败，请确认 Node API 已启动。";
  return error instanceof Error ? error.message : "操作未完成，请检查填写内容后重试。";
}

export function assertJsonText(value: string, message: string) {
  const text = value.trim() || "{}";
  if (containsSecretLike(text)) throw new Error(message);
  if (containsEndpointId(text)) throw new Error("接入点 ID 请填写到“模型标识 / 接入点 ID”，配置 JSON 请填写 {}。");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return true;
  } catch {
    throw new Error("配置 JSON 必须是对象格式，例如 {}。");
  }
}

