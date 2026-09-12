import { ChevronDown, ChevronRight, ClipboardList, Database, Grid2X2, PackageCheck, Plus, Users, WalletCards } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import Card from "../components/Card";
import DataTable from "../components/DataTable";
import PageLayout from "../components/PageLayout";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";
import { ApiError } from "../lib/api";
import { getSystemHealth } from "../lib/health";
import type { SystemHealth } from "../lib/health";
import {
  adjustUserBalance,
  createAdminModel,
  createAdminPricingRule,
  createAdminProvider,
  deleteAdminModel,
  deleteAdminPricingRule,
  deleteAdminProvider,
  disableUser,
  enableUser,
  getAdminCreditLogs,
  getAdminLogs,
  getAdminModels,
  getAdminOrders,
  getAdminPricingRules,
  getAdminProviders,
  getAdminStats,
  getAdminTasks,
  getAdminUserDetail,
  getAdminUsers,
  updateAdminModel,
  updateAdminPricingRule,
  updateAdminProvider
} from "../lib/admin";
import type {
  AdminCreditLog,
  AdminLog,
  AdminModel,
  AdminModelCreate,
  AdminOrder,
  AdminPricingRule,
  AdminPricingRulePayload,
  AdminProvider,
  AdminProviderCreate,
  AdminStats,
  AdminTask,
  AdminUserDetail,
  AdminUser
} from "../lib/admin";
import {
  adminActionLabel,
  adminTargetLabel,
  creditTypeLabel,
  enabledLabel,
  formatAdminTime,
  inputTypeLabel,
  modelTypeLabel,
  orderStatusLabel,
  outputTypeLabel,
  paymentProviderLabel,
  roleLabel,
  taskStatusLabel,
  userStatusLabel
} from "../utils/labels";
import NoPermissionPage from "./NoPermissionPage";
import GiftCardsModule from "./AdminGiftCardsPage";

type ModuleKey = "overview" | "users" | "orders" | "giftCards" | "tasks" | "credits" | "models" | "providers" | "logs";
type PeopleModuleKey = "users" | "orders" | "tasks" | "credits";
type PersonSectionKey = "orders" | "tasks" | "credits";
type StatusType = "success" | "failed" | "processing" | "waiting";
type StatItem = [LucideIcon, string, string | number];
type ModelDraft = Pick<AdminModel, "displayName" | "price" | "sortOrder" | "enabled">;
type ProviderDraft = Pick<AdminProvider, "displayName" | "baseUrl" | "apiKeyEnvName" | "enabled">;
type PricingDraft = AdminPricingRulePayload;

const modules: Array<[ModuleKey, string]> = [
  ["overview", "数据总览"],
  ["users", "用户管理"],
  ["orders", "订单管理"],
  ["tasks", "任务管理"],
  ["credits", "积分流水"],
  ["models", "模型管理"],
  ["providers", "供应商管理"],
  ["logs", "操作日志"]
];
const listParams = { page: 1, pageSize: 50 };
const emptyModel: AdminModelCreate = {
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
const emptyProvider: AdminProviderCreate = {
  displayName: "",
  providerKey: "",
  baseUrl: "",
  apiKeyEnvName: "",
  enabled: true,
  configJson: ""
};
const emptyPricingRule: PricingDraft = {
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

type ModelTemplateKey = "seedance-2-0" | "seedance-2-0-fast" | "seedance-1-5-pro" | "seedance-1-0-pro-fast";

type ModelTemplate = {
  key: ModelTemplateKey;
  label: string;
  sortOrder: number;
  rules: PricingDraft[];
};

const VIDEO_CREDIT_RATE = 100;
const VIDEO_SALES_MARKUP = 1.2;
const peopleModules = new Set<PeopleModuleKey>(["users", "orders", "tasks", "credits"]);

function pricingRule(resolution: string, pointsPerSecond: number, audioMode = "default"): PricingDraft {
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

const modelTemplates: ModelTemplate[] = [
  { key: "seedance-2-0", label: "Seedance 2.0", sortOrder: 1, rules: [pricingRule("480p", 162), pricingRule("720p", 338), pricingRule("1080p", 756)] },
  { key: "seedance-2-0-fast", label: "Seedance 2.0 Fast", sortOrder: 2, rules: [pricingRule("480p", 122), pricingRule("720p", 270), pricingRule("1080p", 608)] },
  { key: "seedance-1-5-pro", label: "Seedance 1.5 Pro", sortOrder: 3, rules: [pricingRule("480p", 68, "silent"), pricingRule("720p", 135, "silent"), pricingRule("1080p", 338, "silent")] },
  { key: "seedance-1-0-pro-fast", label: "Seedance 1.0 Pro Fast", sortOrder: 4, rules: [pricingRule("480p", 27), pricingRule("720p", 68), pricingRule("1080p", 135)] }
];

function calculateAdminSalesPriceFromCost(costPerSecondRmb?: number | null) {
  const cost = typeof costPerSecondRmb === "number" && Number.isFinite(costPerSecondRmb) ? Math.max(0, costPerSecondRmb) : 0;
  const salesCnyPerSecond = cost * VIDEO_SALES_MARKUP;
  const salesCreditsPerSecond = Math.ceil(salesCnyPerSecond * VIDEO_CREDIT_RATE);
  return { salesCnyPerSecond, salesCreditsPerSecond };
}

function pointsFromCost(costPerSecondRmb?: number | null) {
  return calculateAdminSalesPriceFromCost(costPerSecondRmb).salesCreditsPerSecond;
}

function withCostBasedSalesPoints(draft: PricingDraft): PricingDraft {
  return { ...draft, pointsPerSecond: pointsFromCost(draft.costPerSecondRmb) };
}

function formatAdminCny(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function brief(value?: string | null, length = 42) {
  if (!value) return "--";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function userLabel(email: string, nickname: string, userId?: string | null) {
  return email || nickname || userId || "--";
}

function containsSecretLike(value: string) {
  return /(^|\b)(sk-|ark-|Bearer\s+|AKIA|AIza|xox[baprs]-)/i.test(value);
}

function containsEndpointId(value: string) {
  return /\bep-[a-z0-9-]+\b/i.test(value);
}

function detailSummary(detail: unknown) {
  try {
    const text = JSON.stringify(detail ?? {});
    return containsSecretLike(text) ? "详情已隐藏，避免显示疑似密钥" : brief(text, 64);
  } catch {
    return "--";
  }
}

function badgeStatus(status: string | boolean): StatusType {
  if (status === true || ["active", "paid", "succeeded"].includes(String(status))) return "success";
  if (status === false || ["disabled", "failed"].includes(String(status))) return "failed";
  if (["processing", "refunded"].includes(String(status))) return "processing";
  return "waiting";
}

function healthBadgeStatus(status: boolean | "unknown"): StatusType {
  if (status === true) return "success";
  if (status === "unknown") return "waiting";
  return "failed";
}

function healthBadgeLabel(status: boolean | "unknown") {
  if (status === true) return "正常";
  if (status === "unknown") return "未知";
  return "未就绪";
}

function peopleModuleTitle(view: PeopleModuleKey) {
  if (view === "orders") return "璁㈠崟绠＄悊";
  if (view === "tasks") return "浠诲姟绠＄悊";
  if (view === "credits") return "绉垎娴佹按";
  return "鐢ㄦ埛绠＄悊";
}

function peopleModuleDescription(view: PeopleModuleKey) {
  if (view === "orders") return "鎸変汉鍛樺睍寮€鏌ョ湅璁㈠崟锛屽悓鏃朵繚鐣欎换鍔″拰绉垎瀛愯彍鍗曘€?";
  if (view === "tasks") return "鎸変汉鍛樺睍寮€鏌ョ湅浠诲姟锛屼换鍔′綔涓鸿鐢ㄦ埛鐨勫瓙鑿滃崟銆?";
  if (view === "credits") return "鎸変汉鍛樺睍寮€鏌ョ湅绉垎娴佹按锛屽悓姝ュ叧鑱旇鍗曞拰浠诲姟銆?";
  return "鎸変汉鍛樼粍缁囨暟鎹紝灞曞紑鍗曚釜鐢ㄦ埛鍚庢煡鐪嬩换鍔°€佽鍗曞拰绉垎瀛愯彍鍗曘€?";
}

function personModuleTitle(view: PeopleModuleKey) {
  if (view === "orders") return "订单管理";
  if (view === "tasks") return "任务管理";
  if (view === "credits") return "积分管理";
  return "用户管理";
}

function personModuleDescription(view: PeopleModuleKey) {
  if (view === "orders") return "按人员查看订单数据。展开某个用户后，可以查看这个用户的订单、任务和积分记录。";
  if (view === "tasks") return "按人员查看任务数据。展开某个用户后，可以查看这个用户做过的任务，以及关联的订单和积分记录。";
  if (view === "credits") return "按人员查看积分数据。展开某个用户后，可以查看这个用户的积分流水，以及相关任务和订单。";
  return "按人员查看用户数据。展开某个用户后，可以查看这个用户的任务、订单和积分记录。";
}

function orderedPersonSections(view: PeopleModuleKey): PersonSectionKey[] {
  if (view === "orders") return ["orders", "tasks", "credits"];
  if (view === "tasks") return ["tasks", "orders", "credits"];
  if (view === "credits") return ["credits", "tasks", "orders"];
  return ["tasks", "orders", "credits"];
}

function defaultOpenSections(view: PeopleModuleKey): Record<PersonSectionKey, boolean> {
  const first = orderedPersonSections(view)[0];
  return {
    orders: first === "orders",
    tasks: first === "tasks",
    credits: first === "credits"
  };
}

function adminError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "登录状态已失效，请重新登录。";
  if (error instanceof ApiError && error.status === 403) return "无权限访问。";
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof TypeError) return "服务连接失败，请确认 Node API 已启动。";
  return error instanceof Error ? error.message : "操作未完成，请检查填写内容后重试。";
}

function assertJsonText(value: string, message: string) {
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

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const [activeModule, setActiveModule] = useState<string>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [creditLogs, setCreditLogs] = useState<AdminCreditLog[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [pricingRules, setPricingRules] = useState<AdminPricingRule[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({ overview: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [systemHealthLoading, setSystemHealthLoading] = useState(true);
  const [systemHealthError, setSystemHealthError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [adjustingUserId, setAdjustingUserId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustRemark, setAdjustRemark] = useState("");
  const [modelDrafts, setModelDrafts] = useState<Record<string, ModelDraft>>({});
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [pricingDrafts, setPricingDrafts] = useState<Record<string, PricingDraft>>({});
  const [creatingModel, setCreatingModel] = useState(false);
  const [creatingProvider, setCreatingProvider] = useState(false);
  const [creatingPricingRule, setCreatingPricingRule] = useState(false);
  const [newModel, setNewModel] = useState<AdminModelCreate>(emptyModel);
  const [newProvider, setNewProvider] = useState<AdminProviderCreate>(emptyProvider);
  const [newPricingRule, setNewPricingRule] = useState<PricingDraft>(emptyPricingRule);
  const [selectedPricingModelId, setSelectedPricingModelId] = useState("");

  function requestError(scope: string, error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      navigate("/login");
      return;
    }
    if (error instanceof ApiError && error.status === 403) {
      setForbidden(true);
      return;
    }
    setErrors((current) => ({ ...current, [scope]: adminError(error) }));
  }

  async function loadStats() {
    setLoading((current) => ({ ...current, overview: true }));
    setErrors((current) => ({ ...current, overview: "" }));
    try {
      setStats(await getAdminStats());
    } catch (error) {
      requestError("overview", error);
    } finally {
      setLoading((current) => ({ ...current, overview: false }));
    }
  }

  async function loadSystemHealth() {
    setSystemHealthLoading(true);
    setSystemHealthError("");
    try {
      setSystemHealth(await getSystemHealth());
    } catch {
      setSystemHealth(null);
      setSystemHealthError("无法连接 API，请检查后端服务是否启动。");
    } finally {
      setSystemHealthLoading(false);
    }
  }

  async function loadUsers() {
    setLoading((current) => ({ ...current, users: true }));
    setErrors((current) => ({ ...current, users: "" }));
    try {
      const result = await getAdminUsers(listParams);
      setUsers(result.users);
      setTotals((current) => ({ ...current, users: result.total }));
    } catch (error) {
      requestError("users", error);
    } finally {
      setLoading((current) => ({ ...current, users: false }));
    }
  }

  async function loadOrders() {
    setLoading((current) => ({ ...current, orders: true }));
    setErrors((current) => ({ ...current, orders: "" }));
    try {
      const result = await getAdminOrders(listParams);
      setOrders(result.orders);
      setTotals((current) => ({ ...current, orders: result.total }));
    } catch (error) {
      requestError("orders", error);
    } finally {
      setLoading((current) => ({ ...current, orders: false }));
    }
  }

  async function loadTasks() {
    setLoading((current) => ({ ...current, tasks: true }));
    setErrors((current) => ({ ...current, tasks: "" }));
    try {
      const result = await getAdminTasks(listParams);
      setTasks(result.tasks);
      setTotals((current) => ({ ...current, tasks: result.total }));
    } catch (error) {
      requestError("tasks", error);
    } finally {
      setLoading((current) => ({ ...current, tasks: false }));
    }
  }

  async function loadCreditLogs() {
    setLoading((current) => ({ ...current, credits: true }));
    setErrors((current) => ({ ...current, credits: "" }));
    try {
      const result = await getAdminCreditLogs(listParams);
      setCreditLogs(result.logs);
      setTotals((current) => ({ ...current, credits: result.total }));
    } catch (error) {
      requestError("credits", error);
    } finally {
      setLoading((current) => ({ ...current, credits: false }));
    }
  }

  async function loadModels() {
    setLoading((current) => ({ ...current, models: true }));
    setErrors((current) => ({ ...current, models: "" }));
    try {
      const items = await getAdminModels();
      setModels(items);
      setModelDrafts(Object.fromEntries(items.map((item) => [item.id, {
        displayName: item.displayName,
        price: item.price,
        sortOrder: item.sortOrder,
        enabled: item.enabled
      }])));
    } catch (error) {
      requestError("models", error);
    } finally {
      setLoading((current) => ({ ...current, models: false }));
    }
  }

  async function loadProviders() {
    setLoading((current) => ({ ...current, providers: true }));
    setErrors((current) => ({ ...current, providers: "" }));
    try {
      const items = await getAdminProviders();
      setProviders(items);
      setProviderDrafts(Object.fromEntries(items.map((item) => [item.id, {
        displayName: item.displayName,
        baseUrl: item.baseUrl,
        apiKeyEnvName: item.apiKeyEnvName,
        enabled: item.enabled
      }])));
    } catch (error) {
      requestError("providers", error);
    } finally {
      setLoading((current) => ({ ...current, providers: false }));
    }
  }

  async function loadPricingRules(modelId = selectedPricingModelId) {
    if (!modelId) {
      setPricingRules([]);
      setPricingDrafts({});
      return;
    }
    setLoading((current) => ({ ...current, pricing: true }));
    setErrors((current) => ({ ...current, pricing: "" }));
    try {
      const items = await getAdminPricingRules(modelId);
      setPricingRules(items);
      setPricingDrafts(Object.fromEntries(items.map((item) => [item.id, toPricingDraft(item)])));
    } catch (error) {
      requestError("pricing", error);
    } finally {
      setLoading((current) => ({ ...current, pricing: false }));
    }
  }

  async function loadLogs() {
    setLoading((current) => ({ ...current, logs: true }));
    setErrors((current) => ({ ...current, logs: "" }));
    try {
      const result = await getAdminLogs(listParams);
      setLogs(result.logs);
      setTotals((current) => ({ ...current, logs: result.total }));
    } catch (error) {
      requestError("logs", error);
    } finally {
      setLoading((current) => ({ ...current, logs: false }));
    }
  }

  useEffect(() => {
    void loadStats();
    void loadSystemHealth();
  }, []);

  useEffect(() => {
    if (peopleModules.has(activeModule as PeopleModuleKey)) void loadUsers();
    if (activeModule === "models") void Promise.all([loadModels(), loadProviders()]);
    if (activeModule === "providers") void loadProviders();
    if (activeModule === "logs") void loadLogs();
  }, [activeModule]);

  useEffect(() => {
    if (activeModule === "models" && selectedPricingModelId) void loadPricingRules(selectedPricingModelId);
  }, [activeModule, selectedPricingModelId]);

  useEffect(() => {
    if (activeModule !== "models" || selectedPricingModelId || !models.length) return;
    const firstVideoModel = models.find((model) => model.modelType === "video") || models[0];
    setSelectedPricingModelId(firstVideoModel.id);
  }, [activeModule, selectedPricingModelId, models]);

  const statCards = useMemo<StatItem[]>(() => stats ? [
    [Users, "用户总数", stats.userTotal],
    [Users, "今日新增用户", stats.todayNewUsers],
    [WalletCards, "订单总数", stats.orderTotal],
    [PackageCheck, "已支付订单总数", stats.paidOrderTotal],
    [WalletCards, "充值总金额", `¥${stats.rechargeAmount}`],
    [Database, "当前总余额", `${stats.totalBalance} 积分`],
    [ClipboardList, "任务总数", stats.taskTotal],
    [Grid2X2, "成功任务数", stats.succeededTaskTotal],
    [Grid2X2, "失败任务数", stats.failedTaskTotal],
    [Database, "消耗积分总数", `${stats.consumedCredits} 积分`]
  ] : [], [stats]);

  async function saveAdjustment(userId: string) {
    const amount = Number(adjustAmount);
    if (!Number.isInteger(amount) || amount === 0) {
      setErrors((current) => ({ ...current, users: "调整金额必须是非零整数。" }));
      return;
    }
    setSavingId(userId);
    setMessage("");
    try {
      await adjustUserBalance(userId, amount, adjustRemark.trim());
      setAdjustingUserId("");
      setAdjustAmount("");
      setAdjustRemark("");
      setMessage("余额调整成功。");
      await Promise.all([loadUsers(), loadStats()]);
    } catch (error) {
      requestError("users", error);
    } finally {
      setSavingId("");
    }
  }

  async function saveUserStatus(user: AdminUser) {
    setSavingId(user.id);
    setMessage("");
    try {
      if (user.status === "disabled") {
        await enableUser(user.id);
        setMessage("用户已启用。");
      } else {
        await disableUser(user.id);
        setMessage("用户已禁用。");
      }
      await loadUsers();
    } catch (error) {
      requestError("users", error);
    } finally {
      setSavingId("");
    }
  }

  async function saveModel(modelId: string) {
    const draft = modelDrafts[modelId];
    if (!draft) return;
    if (draft.price < 0) {
      setErrors((current) => ({ ...current, models: "模型价格不能为负数。" }));
      return;
    }
    setSavingId(modelId);
    setMessage("");
    try {
      await updateAdminModel(modelId, draft);
      setMessage("模型已保存。");
      await loadModels();
    } catch (error) {
      requestError("models", error);
    } finally {
      setSavingId("");
    }
  }

  async function toggleModel(model: AdminModel) {
    setSavingId(model.id);
    setMessage("");
    try {
      await updateAdminModel(model.id, { enabled: !model.enabled });
      setMessage(model.enabled ? "模型已禁用。" : "模型已启用。");
      await loadModels();
    } catch (error) {
      requestError("models", error);
    } finally {
      setSavingId("");
    }
  }

  async function submitModel(event: FormEvent) {
    event.preventDefault();
    setErrors((current) => ({ ...current, models: "" }));
    setMessage("");
    try {
      assertJsonText(newModel.configJson || "", "配置中疑似包含真实密钥，请不要在模型配置中填写 API Key。");
      if (newModel.price < 0) throw new Error("模型价格不能为负数。");
      if (newModel.enabled && newModel.modelType === "video" && !newModel.defaultPricingRules?.length) {
        throw new Error("请先添加计费规则。");
      }
      setSavingId("new-model");
      await createAdminModel({ ...newModel, configJson: newModel.configJson?.trim() || "{}" });
      setNewModel(emptyModel);
      setCreatingModel(false);
      setMessage("模型新增成功。");
      await loadModels();
    } catch (error) {
      setErrors((current) => ({ ...current, models: error instanceof Error && !(error instanceof ApiError) ? error.message : adminError(error) }));
    } finally {
      setSavingId("");
    }
  }

  async function removeModel(model: AdminModel) {
    if (!window.confirm(`确认删除模型“${model.displayName}”吗？`)) return;
    setSavingId(model.id);
    setMessage("");
    try {
      await deleteAdminModel(model.id);
      setMessage("模型已删除。");
      if (selectedPricingModelId === model.id) setSelectedPricingModelId("");
      await loadModels();
    } catch (error) {
      requestError("models", error);
    } finally {
      setSavingId("");
    }
  }

  async function savePricingRule(ruleId: string) {
    const draft = pricingDrafts[ruleId];
    if (!draft) return;
    setSavingId(ruleId);
    setMessage("");
    try {
      await updateAdminPricingRule(ruleId, withCostBasedSalesPoints(draft));
      setMessage("计费规则已保存。");
      await loadPricingRules();
    } catch (error) {
      requestError("pricing", error);
    } finally {
      setSavingId("");
    }
  }

  async function togglePricingRule(rule: AdminPricingRule) {
    setSavingId(rule.id);
    setMessage("");
    try {
      await updateAdminPricingRule(rule.id, { enabled: !rule.enabled });
      setMessage(rule.enabled ? "计费规则已禁用。" : "计费规则已启用。");
      await loadPricingRules();
    } catch (error) {
      requestError("pricing", error);
    } finally {
      setSavingId("");
    }
  }

  async function submitPricingRule(event: FormEvent) {
    event.preventDefault();
    if (!selectedPricingModelId) return;
    setSavingId("new-pricing-rule");
    setMessage("");
    try {
      await createAdminPricingRule(selectedPricingModelId, withCostBasedSalesPoints(newPricingRule));
      setNewPricingRule(emptyPricingRule);
      setCreatingPricingRule(false);
      setMessage("计费规则新增成功。");
      await loadPricingRules(selectedPricingModelId);
    } catch (error) {
      requestError("pricing", error);
    } finally {
      setSavingId("");
    }
  }

  async function removePricingRule(rule: AdminPricingRule) {
    if (!window.confirm(`确认删除 ${rule.resolution} 计费规则吗？`)) return;
    setSavingId(rule.id);
    setMessage("");
    try {
      await deleteAdminPricingRule(rule.id);
      setMessage("计费规则已删除。");
      await loadPricingRules();
    } catch (error) {
      requestError("pricing", error);
    } finally {
      setSavingId("");
    }
  }

  function validateProviderEnv(value: string) {
    if (containsSecretLike(value)) throw new Error("请填写环境变量名，不要填写真实 API Key。");
    if (value && !/^[A-Z][A-Z0-9_]*$/.test(value)) throw new Error("密钥环境变量名只允许填写环境变量名。");
  }

  async function saveProvider(providerId: string) {
    const draft = providerDrafts[providerId];
    if (!draft) return;
    setErrors((current) => ({ ...current, providers: "" }));
    setMessage("");
    try {
      validateProviderEnv(draft.apiKeyEnvName);
      setSavingId(providerId);
      await updateAdminProvider(providerId, draft);
      setMessage("供应商已保存。");
      await loadProviders();
    } catch (error) {
      setErrors((current) => ({ ...current, providers: error instanceof Error && !(error instanceof ApiError) ? error.message : adminError(error) }));
    } finally {
      setSavingId("");
    }
  }

  async function toggleProvider(provider: AdminProvider) {
    setSavingId(provider.id);
    setMessage("");
    try {
      await updateAdminProvider(provider.id, { enabled: !provider.enabled });
      setMessage(provider.enabled ? "供应商已禁用。" : "供应商已启用。");
      await loadProviders();
    } catch (error) {
      requestError("providers", error);
    } finally {
      setSavingId("");
    }
  }

  async function submitProvider(event: FormEvent) {
    event.preventDefault();
    setErrors((current) => ({ ...current, providers: "" }));
    setMessage("");
    try {
      validateProviderEnv(newProvider.apiKeyEnvName);
      assertJsonText(newProvider.configJson || "", "配置中疑似包含真实密钥，请不要在供应商配置中填写 API Key。");
      setSavingId("new-provider");
      await createAdminProvider(newProvider);
      setNewProvider(emptyProvider);
      setCreatingProvider(false);
      setMessage("供应商新增成功。");
      await loadProviders();
    } catch (error) {
      setErrors((current) => ({ ...current, providers: error instanceof Error && !(error instanceof ApiError) ? error.message : adminError(error) }));
    } finally {
      setSavingId("");
    }
  }

  async function removeProvider(provider: AdminProvider) {
    if (!window.confirm(`确认删除供应商“${provider.displayName}”吗？`)) return;
    setSavingId(provider.id);
    setMessage("");
    try {
      await deleteAdminProvider(provider.id);
      setMessage("供应商已删除。");
      await loadProviders();
    } catch (error) {
      requestError("providers", error);
    } finally {
      setSavingId("");
    }
  }

  if (forbidden) return <NoPermissionPage />;

  return (
    <PageLayout className="admin-content">
      <section className="page-head admin-page-head">
        <h1>管理后台</h1>
        <p>查看平台数据、用户、任务、模型、供应商与 Seedance 计费规则。</p>
      </section>
      <section className="admin-module-tabs">
        {modules.filter(([key]) => key !== "overview").flatMap(([key, title]) => key === "orders" ? [[key, title], ["giftCards" as ModuleKey, "礼品卡管理"]] : [[key, title]]).map(([key, title]) => <button className={activeModule === key ? "active" : ""} type="button" key={key} onClick={() => setActiveModule(key)}>{title}</button>)}
      </section>
      {message ? <p className="auth-message success admin-message">{message}</p> : null}

      {activeModule === "overview" ? (
        <Overview
          stats={stats}
          statCards={statCards}
          loading={loading.overview}
          error={errors.overview}
          systemHealth={systemHealth}
          systemHealthLoading={systemHealthLoading}
          systemHealthError={systemHealthError}
          refreshSystemHealth={loadSystemHealth}
        />
      ) : null}
      {activeModule === "giftCards" ? <GiftCardsModule /> : null}
      {peopleModules.has(activeModule as PeopleModuleKey) ? (
        <PeopleDataModule
          key={activeModule}
          view={activeModule as PeopleModuleKey}
          users={users}
          total={totals.users}
          loading={loading.users}
          error={errors.users}
          savingId={savingId}
          adjustingUserId={adjustingUserId}
          adjustAmount={adjustAmount}
          adjustRemark={adjustRemark}
          setAdjustingUserId={setAdjustingUserId}
          setAdjustAmount={setAdjustAmount}
          setAdjustRemark={setAdjustRemark}
          saveAdjustment={saveAdjustment}
          saveUserStatus={saveUserStatus}
        />
      ) : null}
      {activeModule === "models" ? <ModelsModule models={models} providers={providers} drafts={modelDrafts} creating={creatingModel} draft={newModel} loading={loading.models} error={errors.models} savingId={savingId} setCreating={setCreatingModel} setDraft={setNewModel} setDrafts={setModelDrafts} saveModel={saveModel} submitModel={submitModel} toggleModel={toggleModel} removeModel={removeModel} pricingRules={pricingRules} pricingDrafts={pricingDrafts} selectedPricingModelId={selectedPricingModelId} creatingPricingRule={creatingPricingRule} newPricingRule={newPricingRule} pricingLoading={loading.pricing} pricingError={errors.pricing} setSelectedPricingModelId={setSelectedPricingModelId} setPricingDrafts={setPricingDrafts} setCreatingPricingRule={setCreatingPricingRule} setNewPricingRule={setNewPricingRule} savePricingRule={savePricingRule} submitPricingRule={submitPricingRule} togglePricingRule={togglePricingRule} removePricingRule={removePricingRule} /> : null}
      {activeModule === "providers" ? <ProvidersModule providers={providers} drafts={providerDrafts} creating={creatingProvider} draft={newProvider} loading={loading.providers} error={errors.providers} savingId={savingId} setCreating={setCreatingProvider} setDraft={setNewProvider} setDrafts={setProviderDrafts} saveProvider={saveProvider} submitProvider={submitProvider} toggleProvider={toggleProvider} removeProvider={removeProvider} /> : null}
      {activeModule === "logs" ? <LogsModule logs={logs} total={totals.logs} loading={loading.logs} error={errors.logs} /> : null}
    </PageLayout>
  );
}

function toPricingDraft(rule: AdminPricingRule): PricingDraft {
  return {
    inputContainsVideo: rule.inputContainsVideo,
    audioMode: rule.audioMode || "default",
    resolution: rule.resolution,
    minOutputDuration: rule.minOutputDuration,
    maxOutputDuration: rule.maxOutputDuration,
    minInputVideoDuration: rule.minInputVideoDuration,
    maxInputVideoDuration: rule.maxInputVideoDuration,
    minBillableInputVideoDuration: rule.minBillableInputVideoDuration,
    pointsPerSecond: rule.pointsPerSecond,
    costPerSecondRmb: rule.costPerSecondRmb,
    enabled: rule.enabled,
    remark: rule.remark
  };
}

function AdminTable({ title, loading, error, empty, action, children }: { title: string; loading?: boolean; error?: string; empty: boolean; action?: ReactNode; children: ReactNode }) {
  return <Card className="admin-live-card"><div className="card-title-row admin-live-head"><h3>{title}</h3>{action}</div>{error ? <p className="data-error">{error}</p> : null}{children}{loading ? <div className="empty-state">数据加载中...</div> : null}{!loading && empty ? <div className="empty-state">暂无数据</div> : null}</Card>;
}

function Overview(props: {
  stats: AdminStats | null;
  statCards: StatItem[];
  loading?: boolean;
  error?: string;
  systemHealth: SystemHealth | null;
  systemHealthLoading?: boolean;
  systemHealthError?: string;
  refreshSystemHealth: () => void;
}) {
  const systemRows: Array<{ icon: LucideIcon; title: string; detail: string; status: boolean | "unknown" }> = props.systemHealth ? [
    {
      icon: PackageCheck,
      title: "API 服务",
      detail: props.systemHealth.checks.api ? "API 在线，可响应健康检查接口。" : "API 未就绪，相关能力可能不可用。",
      status: props.systemHealth.checks.api
    },
    {
      icon: Database,
      title: "数据库",
      detail:
        props.systemHealth.checks.database === true
          ? "数据库连接正常。"
          : props.systemHealth.checks.database === "unknown"
            ? "数据库状态未知，请检查后端配置。"
            : "数据库不可用，相关能力可能不可用。",
      status: props.systemHealth.checks.database
    },
    {
      icon: WalletCards,
      title: "测试支付",
      detail: props.systemHealth.checks.mockPaymentEnabled ? "测试支付已开启，仅应在测试环境使用。" : "测试支付已关闭，生产环境应保持关闭。",
      status: props.systemHealth.checks.mockPaymentEnabled
    },
    {
      icon: Grid2X2,
      title: "火山方舟",
      detail: props.systemHealth.checks.volcengineConfigured ? "已配置，相关能力可继续联调。" : "未配置，相关能力可能不可用。",
      status: props.systemHealth.checks.volcengineConfigured
    },
    {
      icon: ClipboardList,
      title: "Agnes",
      detail: props.systemHealth.checks.agnesConfigured ? "已配置，相关能力可继续联调。" : "未配置，相关能力可能不可用。",
      status: props.systemHealth.checks.agnesConfigured
    },
    {
      icon: Users,
      title: "素材公网地址",
      detail: props.systemHealth.checks.publicAssetBaseUrlConfigured ? "已配置，外部模型可按当前地址尝试访问素材。" : "未配置，本地上传素材可能无法被外部模型访问。",
      status: props.systemHealth.checks.publicAssetBaseUrlConfigured
    }
  ] : [];

  return (
    <>
      {props.error ? <p className="data-error compact">{props.error}</p> : null}
      <section className="admin-stat-grid admin-stat-grid-wide">
        {props.statCards.map(([Icon, title, value]) => <StatCard key={title} icon={<Icon />} label={title} value={String(value)} />)}
      </section>
      {props.loading ? <Card className="admin-panel-state">数据总览加载中...</Card> : null}
      {!props.loading && !props.stats ? <Card className="admin-panel-state">暂无数据</Card> : null}
      <Card className="system-card admin-system-status-card">
        <div className="card-title-row">
          <div>
            <h3>系统状态</h3>
            <p className="panel-subtitle">
              {props.systemHealth ? `环境：${props.systemHealth.environment} · 更新时间：${formatAdminTime(props.systemHealth.time)}` : "用于本地自检与上线前诊断"}
            </p>
          </div>
          <button className="admin-action" type="button" onClick={props.refreshSystemHealth}>刷新状态</button>
        </div>
        {props.systemHealthError ? <p className="data-error compact">{props.systemHealthError}</p> : null}
        {props.systemHealthLoading ? <div className="admin-panel-state">系统状态加载中...</div> : null}
        {!props.systemHealthLoading && !props.systemHealthError && props.systemHealth ? (
          <div className="admin-system-grid">
            {systemRows.map((row) => {
              const Icon = row.icon;
              return (
                <div className="system-row" key={row.title}>
                  <Icon />
                  <div>
                    <strong>{row.title}</strong>
                    <span>{row.detail}</span>
                  </div>
                  <StatusBadge status={healthBadgeStatus(row.status)}>{healthBadgeLabel(row.status)}</StatusBadge>
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
    </>
  );
}

function UsersModule(props: {
  users: AdminUser[]; total?: number; loading?: boolean; error?: string; savingId: string; adjustingUserId: string; adjustAmount: string; adjustRemark: string;
  setAdjustingUserId: (value: string) => void; setAdjustAmount: (value: string) => void; setAdjustRemark: (value: string) => void;
  saveAdjustment: (id: string) => void; saveUserStatus: (user: AdminUser) => void;
}) {
  return (
    <AdminTable title={`用户管理${props.total === undefined ? "" : ` · 共 ${props.total} 条`}`} loading={props.loading} error={props.error} empty={!props.users.length}>
      <DataTable rows={props.users} columns={[
        { key: "email", title: "邮箱", render: (row) => row.email },
        { key: "nickname", title: "昵称", render: (row) => row.nickname || "--" },
        { key: "role", title: "角色", render: (row) => roleLabel(row.role) },
        { key: "status", title: "账号状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{userStatusLabel(row.status)}</StatusBadge> },
        { key: "balance", title: "余额", align: "right", render: (row) => `${row.balance} 积分` },
        { key: "createdAt", title: "注册时间", render: (row) => formatAdminTime(row.createdAt) },
        { key: "lastLoginAt", title: "最近登录", render: (row) => formatAdminTime(row.lastLoginAt) },
        { key: "actions", title: "操作", render: (row) => <div className="admin-inline-actions"><button className="admin-action" type="button" onClick={() => props.setAdjustingUserId(row.id)}>调整余额</button><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.saveUserStatus(row)}>{row.status === "disabled" ? "启用" : "禁用"}</button></div> }
      ]} />
      {props.adjustingUserId ? <div className="admin-adjust-row"><strong>调整余额</strong><input type="number" step="1" placeholder="正数增加，负数扣减" value={props.adjustAmount} onChange={(event) => props.setAdjustAmount(event.target.value)} /><input placeholder="备注" value={props.adjustRemark} onChange={(event) => props.setAdjustRemark(event.target.value)} /><button className="admin-action" type="button" disabled={props.savingId === props.adjustingUserId} onClick={() => props.saveAdjustment(props.adjustingUserId)}>保存</button><button className="admin-action muted" type="button" onClick={() => props.setAdjustingUserId("")}>取消</button></div> : null}
    </AdminTable>
  );
}

function OrdersModule({ orders, total, loading, error }: { orders: AdminOrder[]; total?: number; loading?: boolean; error?: string }) {
  return <AdminTable title={`订单管理${total === undefined ? "" : ` · 共 ${total} 条`}`} loading={loading} error={error} empty={!orders.length}><DataTable rows={orders} columns={[
    { key: "orderNo", title: "订单号", render: (row) => row.orderNo },
    { key: "user", title: "用户", render: (row) => userLabel(row.userEmail, row.userNickname, row.userId) },
    { key: "amount", title: "支付金额", align: "right", render: (row) => `¥${row.amount}` },
    { key: "credits", title: "获得积分", align: "right", render: (row) => row.credits },
    { key: "paymentProvider", title: "支付方式", render: (row) => paymentProviderLabel(row.paymentProvider) },
    { key: "status", title: "订单状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{orderStatusLabel(row.status)}</StatusBadge> },
    { key: "paidAt", title: "支付时间", render: (row) => formatAdminTime(row.paidAt) },
    { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
  ]} /></AdminTable>;
}

function TasksModule({ tasks, total, loading, error }: { tasks: AdminTask[]; total?: number; loading?: boolean; error?: string }) {
  return <AdminTable title={`任务管理${total === undefined ? "" : ` · 共 ${total} 条`}`} loading={loading} error={error} empty={!tasks.length}><DataTable rows={tasks} columns={[
    { key: "id", title: "任务 ID", render: (row) => <span title={row.id}>{brief(row.id, 14)}</span> },
    { key: "user", title: "用户", render: (row) => userLabel(row.userEmail, row.userNickname, row.userId) },
    { key: "modelDisplayName", title: "模型名称", render: (row) => row.modelDisplayName || "--" },
    { key: "modelId", title: "模型标识", render: (row) => <span title={row.modelId}>{brief(row.modelId, 18)}</span> },
    { key: "prompt", title: "提示词", render: (row) => <span className="admin-clamp" title={row.prompt}>{brief(row.prompt, 34)}</span> },
    { key: "status", title: "任务状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{taskStatusLabel(row.status)}</StatusBadge> },
    { key: "cost", title: "消耗积分", align: "right", render: (row) => `${row.cost} 积分` },
    { key: "providerTaskId", title: "上游任务 ID", render: (row) => <span title={row.providerTaskId}>{brief(row.providerTaskId, 16)}</span> },
    { key: "result", title: "结果 / 错误", render: (row) => row.resultUrl ? <a className="task-link" href={row.resultUrl} target="_blank" rel="noreferrer">查看结果</a> : <span className="admin-clamp" title={row.errorMessage}>{brief(row.errorMessage, 26)}</span> },
    { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
  ]} /></AdminTable>;
}

function CreditsModule({ logs, total, loading, error }: { logs: AdminCreditLog[]; total?: number; loading?: boolean; error?: string }) {
  return <AdminTable title={`积分流水${total === undefined ? "" : ` · 共 ${total} 条`}`} loading={loading} error={error} empty={!logs.length}><DataTable rows={logs} columns={[
    { key: "user", title: "用户", render: (row) => userLabel(row.userEmail, row.userNickname, row.userId) },
    { key: "type", title: "流水类型", render: (row) => creditTypeLabel(row.type) },
    { key: "amount", title: "积分变动", align: "right", render: (row) => row.amount },
    { key: "balanceBefore", title: "变动前余额", align: "right", render: (row) => row.balanceBefore },
    { key: "balanceAfter", title: "变动后余额", align: "right", render: (row) => row.balanceAfter },
    { key: "relatedTaskId", title: "关联任务", render: (row) => <span title={row.relatedTaskId || ""}>{brief(row.relatedTaskId, 14)}</span> },
    { key: "relatedOrderId", title: "关联订单", render: (row) => <span title={row.relatedOrderId || ""}>{brief(row.relatedOrderId, 14)}</span> },
    { key: "remark", title: "备注", render: (row) => <span className="admin-clamp" title={row.remark}>{brief(row.remark, 26)}</span> },
    { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
  ]} /></AdminTable>;
}

function PeopleDataModule(props: {
  view: PeopleModuleKey;
  users: AdminUser[];
  total?: number;
  loading?: boolean;
  error?: string;
  savingId: string;
  adjustingUserId: string;
  adjustAmount: string;
  adjustRemark: string;
  setAdjustingUserId: (value: string) => void;
  setAdjustAmount: (value: string) => void;
  setAdjustRemark: (value: string) => void;
  saveAdjustment: (id: string) => void;
  saveUserStatus: (user: AdminUser) => void;
}) {
  const [expandedUserIds, setExpandedUserIds] = useState<string[]>([]);
  const [detailMap, setDetailMap] = useState<Record<string, AdminUserDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, Record<PersonSectionKey, boolean>>>({});
  const [inviteSourceOpen, setInviteSourceOpen] = useState<Record<string, boolean>>({});

  function sectionTitle(section: PersonSectionKey) {
    if (section === "orders") return "订单";
    if (section === "tasks") return "任务";
    return "积分";
  }

  async function ensureUserDetail(userId: string) {
    if (detailMap[userId] || detailLoading[userId]) return;
    setDetailLoading((current) => ({ ...current, [userId]: true }));
    setDetailErrors((current) => ({ ...current, [userId]: "" }));
    try {
      const detail = await getAdminUserDetail(userId);
      setDetailMap((current) => ({ ...current, [userId]: detail }));
      setOpenSections((current) => ({
        ...current,
        [userId]: current[userId] || defaultOpenSections(props.view)
      }));
    } catch (error) {
      setDetailErrors((current) => ({ ...current, [userId]: adminError(error) }));
    } finally {
      setDetailLoading((current) => ({ ...current, [userId]: false }));
    }
  }

  function toggleUser(userId: string) {
    const expanded = expandedUserIds.includes(userId);
    if (expanded) {
      setExpandedUserIds((current) => current.filter((id) => id !== userId));
      return;
    }
    setExpandedUserIds((current) => [...current, userId]);
    void ensureUserDetail(userId);
  }

  function toggleSection(userId: string, section: PersonSectionKey) {
    const defaults = openSections[userId] || defaultOpenSections(props.view);
    setOpenSections((current) => ({
      ...current,
      [userId]: {
        ...defaults,
        [section]: !defaults[section]
      }
    }));
  }

  function renderOrders(rows: AdminOrder[]) {
    if (!rows.length) return <div className="empty-state">暂无订单</div>;
    return (
      <DataTable
        rows={rows}
        columns={[
          { key: "orderNo", title: "订单号", render: (row) => row.orderNo },
          { key: "amount", title: "支付金额", align: "right", render: (row) => `￥${row.amount}` },
          { key: "credits", title: "获得积分", align: "right", render: (row) => row.credits },
          { key: "paymentProvider", title: "支付方式", render: (row) => paymentProviderLabel(row.paymentProvider) },
          { key: "status", title: "订单状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{orderStatusLabel(row.status)}</StatusBadge> },
          { key: "paidAt", title: "支付时间", render: (row) => formatAdminTime(row.paidAt) },
          { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
        ]}
      />
    );
  }

  function renderTasks(rows: AdminTask[]) {
    if (!rows.length) return <div className="empty-state">暂无任务</div>;
    return (
      <DataTable
        rows={rows}
        columns={[
          { key: "id", title: "任务 ID", render: (row) => <span title={row.id}>{brief(row.id, 14)}</span> },
          { key: "modelDisplayName", title: "模型名称", render: (row) => row.modelDisplayName || "--" },
          { key: "prompt", title: "提示词", render: (row) => <span className="admin-clamp" title={row.prompt}>{brief(row.prompt, 34)}</span> },
          { key: "status", title: "任务状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{taskStatusLabel(row.status)}</StatusBadge> },
          { key: "cost", title: "消耗积分", align: "right", render: (row) => `${row.cost} 积分` },
          {
            key: "result",
            title: "结果 / 错误",
            render: (row) => row.resultUrl
              ? <a className="task-link" href={row.resultUrl} target="_blank" rel="noreferrer">查看结果</a>
              : <span className="admin-clamp" title={row.errorMessage || row.providerTaskId}>{brief(row.errorMessage || row.providerTaskId, 26)}</span>
          },
          { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
        ]}
      />
    );
  }

  function renderCredits(rows: AdminCreditLog[]) {
    if (!rows.length) return <div className="empty-state">暂无积分流水</div>;
    return (
      <DataTable
        rows={rows}
        columns={[
          { key: "type", title: "流水类型", render: (row) => creditTypeLabel(row.type) },
          { key: "amount", title: "积分变动", align: "right", render: (row) => row.amount },
          { key: "balanceBefore", title: "变动前余额", align: "right", render: (row) => row.balanceBefore },
          { key: "balanceAfter", title: "变动后余额", align: "right", render: (row) => row.balanceAfter },
          { key: "remark", title: "备注", render: (row) => <span className="admin-clamp" title={row.remark}>{brief(row.remark, 26)}</span> },
          { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
        ]}
      />
    );
  }

  return (
    <AdminTable
      title={`${personModuleTitle(props.view)}${props.total === undefined ? "" : ` · 共 ${props.total} 位用户`}`}
      loading={props.loading}
      error={props.error}
      empty={!props.users.length}
    >
      <div className="people-module-copy">
        <span>{personModuleDescription(props.view)}</span>
      </div>
      <div className="people-user-list">
        {props.users.map((user) => {
          const expanded = expandedUserIds.includes(user.id);
          const detail = detailMap[user.id];
          const sections = openSections[user.id] || defaultOpenSections(props.view);
          const summaryTasks = detail?.tasks.length;
          const summaryOrders = detail?.orders.length;
          const summaryCredits = detail?.creditLogs.length;

          return (
            <section className={`people-user-card${expanded ? " expanded" : ""}`} key={user.id}>
              <div className="people-user-head">
                <button className="people-user-trigger" type="button" onClick={() => toggleUser(user.id)}>
                  <span className="people-user-chevron">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                  <div className="people-user-identity">
                    <strong>{userLabel(user.email, user.nickname, user.id)}</strong>
                    <span>{user.email || user.nickname || user.id}</span>
                    <div className="people-user-kpis">
                      <span><b>余额</b>{user.balance} 积分</span>
                      <span><b>任务</b>{summaryTasks ?? "--"}</span>
                      <span><b>订单</b>{summaryOrders ?? "--"}</span>
                      <span><b>积分</b>{summaryCredits ?? "--"}</span>
                    </div>
                  </div>
                </button>
                <div className="people-user-actions">
                  <StatusBadge status={badgeStatus(user.status)}>{userStatusLabel(user.status)}</StatusBadge>
                  <button className="admin-action" type="button" onClick={() => props.setAdjustingUserId(user.id)}>调整余额</button>
                  <button className="admin-action" type="button" disabled={props.savingId === user.id} onClick={() => props.saveUserStatus(user)}>
                    {user.status === "disabled" ? "启用" : "禁用"}
                  </button>
                </div>
              </div>

              {props.adjustingUserId === user.id ? (
                <div className="admin-adjust-row people-adjust-row">
                  <strong>调整余额</strong>
                  <input type="number" step="1" placeholder="正数增加，负数扣减" value={props.adjustAmount} onChange={(event) => props.setAdjustAmount(event.target.value)} />
                  <input placeholder="备注" value={props.adjustRemark} onChange={(event) => props.setAdjustRemark(event.target.value)} />
                  <button className="admin-action" type="button" disabled={props.savingId === props.adjustingUserId} onClick={() => props.saveAdjustment(props.adjustingUserId)}>保存</button>
                  <button className="admin-action muted" type="button" onClick={() => props.setAdjustingUserId("")}>取消</button>
                </div>
              ) : null}

              {expanded ? (
                <div className="people-user-detail">
                  <div className="people-user-meta">
                    {detail?.inviteSource?.code ? <button className="people-invite-source" type="button" onClick={() => setInviteSourceOpen((current) => ({ ...current, [user.id]: !current[user.id] }))}>邀请码来源：{detail.inviteSource.code}</button> : <span>邀请码来源：否</span>}
                    <span>角色：{roleLabel(user.role)}</span>
                    <span>注册时间：{formatAdminTime(user.createdAt)}</span>
                    <span>最近登录：{formatAdminTime(user.lastLoginAt)}</span>
                  </div>
                  {detail?.inviteSource?.code && inviteSourceOpen[user.id] ? <div className="people-invite-detail"><span>邀请人邮箱：{detail.inviteSource.inviter?.email || "--"}</span><span>邀请人 ID：{detail.inviteSource.inviter?.id || "--"}</span><span>邀请人身份：{detail.inviteSource.inviter?.role === "admin" ? "管理员" : "普通用户"}</span></div> : null}
                  {detailErrors[user.id] ? <p className="data-error compact">{detailErrors[user.id]}</p> : null}
                  {detailLoading[user.id] ? <div className="empty-state">用户数据加载中...</div> : null}
                  {!detailLoading[user.id] && detail ? (
                    <div className="people-sections">
                      {orderedPersonSections(props.view).map((section) => {
                        const open = sections[section];
                        const count = section === "orders" ? detail.orders.length : section === "tasks" ? detail.tasks.length : detail.creditLogs.length;
                        return (
                          <div className={`people-section${open ? " open" : ""}`} key={`${user.id}-${section}`}>
                            <button className="people-section-toggle" type="button" onClick={() => toggleSection(user.id, section)}>
                              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              <strong>{sectionTitle(section)}</strong>
                              <small>{count} 条</small>
                            </button>
                            {open ? (
                              <div className="people-section-body">
                                {section === "orders" ? renderOrders(detail.orders) : null}
                                {section === "tasks" ? renderTasks(detail.tasks) : null}
                                {section === "credits" ? renderCredits(detail.creditLogs) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </AdminTable>
  );
}

function ModelsModule(props: {
  models: AdminModel[]; providers: AdminProvider[]; drafts: Record<string, ModelDraft>; draft: AdminModelCreate; creating: boolean; loading?: boolean; error?: string; savingId: string;
  pricingRules: AdminPricingRule[]; pricingDrafts: Record<string, PricingDraft>; selectedPricingModelId: string; creatingPricingRule: boolean; newPricingRule: PricingDraft; pricingLoading?: boolean; pricingError?: string;
  setDrafts: Dispatch<SetStateAction<Record<string, ModelDraft>>>; setDraft: Dispatch<SetStateAction<AdminModelCreate>>; setCreating: (value: boolean) => void;
  setSelectedPricingModelId: (value: string) => void; setPricingDrafts: Dispatch<SetStateAction<Record<string, PricingDraft>>>; setCreatingPricingRule: (value: boolean) => void; setNewPricingRule: Dispatch<SetStateAction<PricingDraft>>;
  saveModel: (id: string) => void; submitModel: (event: FormEvent) => void; toggleModel: (model: AdminModel) => void; removeModel: (model: AdminModel) => void;
  savePricingRule: (id: string) => void; submitPricingRule: (event: FormEvent) => void; togglePricingRule: (rule: AdminPricingRule) => void; removePricingRule: (rule: AdminPricingRule) => void;
}) {
  const selectedModel = props.models.find((model) => model.id === props.selectedPricingModelId);
  return (
    <>
      <AdminTable title="模型管理" loading={props.loading} error={props.error} empty={!props.models.length} action={<button className="admin-action primary" type="button" onClick={() => props.setCreating(!props.creating)}><Plus size={15} /> 新增模型</button>}>
        {props.creating ? <ModelCreateForm providers={props.providers} draft={props.draft} saving={props.savingId === "new-model"} setDraft={props.setDraft} submit={props.submitModel} cancel={() => props.setCreating(false)} /> : null}
        {props.selectedPricingModelId ? (
          <div className="admin-editor">
            <div className="admin-editor-head">
              <strong>{`计费规则${selectedModel ? ` · ${selectedModel.displayName}` : ""}`}</strong>
            </div>
            <div className="admin-form-actions">
              <button className="admin-action primary" type="button" onClick={() => props.setCreatingPricingRule(!props.creatingPricingRule)}><Plus size={15} /> 新增计费规则</button>
            </div>
            {props.creatingPricingRule ? <PricingRuleForm draft={props.newPricingRule} saving={props.savingId === "new-pricing-rule"} setDraft={props.setNewPricingRule} submit={props.submitPricingRule} cancel={() => props.setCreatingPricingRule(false)} /> : null}
            {props.pricingError ? <p className="data-error compact">{props.pricingError}</p> : null}
            {props.pricingLoading ? <p className="hint">计费规则加载中...</p> : null}
            {!props.pricingLoading && !props.pricingRules.length ? <p className="admin-warning">请先添加计费规则。</p> : null}
            {props.pricingRules.length ? <PricingRulesTable rules={props.pricingRules} drafts={props.pricingDrafts} savingId={props.savingId} setDrafts={props.setPricingDrafts} save={props.savePricingRule} toggle={props.togglePricingRule} remove={props.removePricingRule} /> : null}
          </div>
        ) : null}
        <DataTable rows={props.models} columns={[
          { key: "displayName", title: "模型名称", render: (row) => <input className="admin-cell-input" value={props.drafts[row.id]?.displayName || ""} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], displayName: event.target.value } }))} /> },
          { key: "modelKey", title: "模型标识", render: (row) => <span title={row.modelKey}>{brief(row.modelKey, 22)}</span> },
          { key: "provider", title: "供应商", render: (row) => <span title={row.providerKey}>{row.providerDisplayName || row.providerKey || "--"}</span> },
          { key: "modelType", title: "模型类型", render: (row) => modelTypeLabel(row.modelType) },
          { key: "inputType", title: "输入类型", render: (row) => inputTypeLabel(row.inputType) },
          { key: "outputType", title: "输出类型", render: (row) => outputTypeLabel(row.outputType) },
          { key: "price", title: "旧单次价格", align: "right", render: (row) => <div><input className="admin-number-input" type="number" min="0" step="1" value={props.drafts[row.id]?.price ?? 0} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], price: Number(event.target.value) } }))} />{row.modelType === "video" ? <small className="admin-warning">视频扣费看上方计费规则</small> : null}</div> },
          { key: "enabled", title: "\u542f\u7528\u72b6\u6001", render: (row) => <div><StatusBadge status={badgeStatus(row.enabled)}>{enabledLabel(row.enabled)}</StatusBadge>{row.enabled && row.modelType === "video" && !row.hasEnabledPricingRules ? <small className="admin-warning">{"\u8bf7\u5148\u6dfb\u52a0\u8ba1\u8d39\u89c4\u5219\u3002"}</small> : null}</div> },
          { key: "sortOrder", title: "排序", align: "right", render: (row) => <input className="admin-number-input" type="number" step="1" value={props.drafts[row.id]?.sortOrder ?? 0} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], sortOrder: Number(event.target.value) } }))} /> },
          { key: "actions", title: "操作", render: (row) => <div className="admin-inline-actions"><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.saveModel(row.id)}>保存</button><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.toggleModel(row)}>{row.enabled ? "禁用" : "启用"}</button><button className="admin-action" type="button" onClick={() => props.setSelectedPricingModelId(row.id)}>{props.selectedPricingModelId === row.id ? "正在编辑计费" : "编辑计费规则"}</button><button className="admin-action danger" type="button" disabled={props.savingId === row.id} onClick={() => props.removeModel(row)}>删除</button></div> }
        ]} />
      </AdminTable>
    </>
  );
}

function ModelCreateForm({ providers, draft, saving, setDraft, submit, cancel }: { providers: AdminProvider[]; draft: AdminModelCreate; saving: boolean; setDraft: Dispatch<SetStateAction<AdminModelCreate>>; submit: (event: FormEvent) => void; cancel: () => void }) {
  const [templateKey, setTemplateKey] = useState<ModelTemplateKey | "">("");
  const defaultRuleCount = draft.defaultPricingRules?.length || 0;
  const labels = {
    title: "\u65b0\u589e\u6a21\u578b",
    intro: "\u9009\u62e9\u6a21\u677f\u540e\uff0c\u7ba1\u7406\u5458\u53ea\u9700\u8981\u586b\u5199\u6a21\u578b\u540d\u79f0\u548c ep- \u63a5\u5165\u70b9 ID\u3002",
    template: "\u5feb\u901f\u9009\u62e9\u6a21\u677f",
    chooseTemplate: "\u8bf7\u9009\u62e9\u6a21\u677f",
    modelName: "\u6a21\u578b\u540d\u79f0",
    modelNameHelp: "\u663e\u793a\u7ed9\u7528\u6237\u770b\u7684\u540d\u5b57\uff0c\u4f8b\u5982 Doubao Seedance 1.0 Pro Fast",
    modelKey: "\u6a21\u578b\u6807\u8bc6 / \u63a5\u5165\u70b9 ID",
    modelKeyHelp: "\u586b\u5199\u706b\u5c71\u65b9\u821f\u63a7\u5236\u53f0\u91cc\u7684 ep- \u5f00\u5934\u63a5\u5165\u70b9 ID\uff0c\u4f8b\u5982 ep-20260527143333-wf4ml",
    provider: "\u4f9b\u5e94\u5546",
    chooseProvider: "\u8bf7\u9009\u62e9\u4f9b\u5e94\u5546",
    modelType: "\u6a21\u578b\u7c7b\u578b",
    videoModel: "\u89c6\u9891\u6a21\u578b",
    imageModel: "\u56fe\u50cf\u6a21\u578b",
    chatModel: "\u5bf9\u8bdd\u6a21\u578b",
    audioModel: "\u97f3\u9891\u6a21\u578b",
    inputType: "\u8f93\u5165\u7c7b\u578b",
    inputTypeHelp: "\u89c6\u9891\u6a21\u578b\u4e00\u822c\u586b\u5199 text,image",
    outputType: "\u8f93\u51fa\u7c7b\u578b",
    outputTypeHelp: "\u89c6\u9891\u6a21\u578b\u586b\u5199 video",
    oldPrice: "\u65e7\u5355\u6b21\u4ef7\u683c",
    sortOrder: "\u6392\u5e8f\u5efa\u8bae\u503c",
    enabled: "\u542f\u7528\u72b6\u6001",
    configJson: "\u914d\u7f6e JSON",
    configHelp: "\u9ad8\u7ea7\u914d\u7f6e\uff0c\u53ef\u4e0d\u586b\uff0c\u9ed8\u8ba4 {}\u3002\u4e0d\u8981\u5728\u8fd9\u91cc\u586b\u5199 API Key\uff0c\u4e5f\u4e0d\u8981\u586b\u5199 ep- \u63a5\u5165\u70b9 ID\u3002",
    defaultRules: "\u9ed8\u8ba4\u8ba1\u8d39\u89c4\u5219\uff1a",
    save: "\u4fdd\u5b58",
    cancel: "\u53d6\u6d88"
  };
  const ruleSummary = defaultRuleCount ? `${defaultRuleCount} \u6761\uff0c\u5c06\u968f\u6a21\u578b\u4e00\u8d77\u521b\u5efa` : "\u672a\u9009\u62e9\u6a21\u677f\uff1b\u542f\u7528\u89c6\u9891\u6a21\u578b\u524d\u8bf7\u5148\u6dfb\u52a0\u8ba1\u8d39\u89c4\u5219\u3002";

  function applyTemplate(value: string) {
    setTemplateKey(value as ModelTemplateKey | "");
    const template = modelTemplates.find((item) => item.key === value);
    if (!template) return;
    const volcengineProvider = providers.find((provider) => provider.providerKey === "volcengine");
    setDraft((current) => ({
      ...current,
      providerId: volcengineProvider?.id || current.providerId,
      modelType: "video",
      inputType: "text,image",
      outputType: "video",
      configJson: "{}",
      sortOrder: template.sortOrder,
      defaultPricingRules: template.rules
    }));
  }

  return (
    <form className="admin-editor" onSubmit={submit}>
      <div className="admin-editor-head"><strong>{labels.title}</strong><span>{labels.intro}</span></div>
      <div className="admin-form-grid">
        <label>{labels.template}<select value={templateKey} onChange={(event) => applyTemplate(event.target.value)}><option value="">{labels.chooseTemplate}</option>{modelTemplates.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}</select></label>
        <label>{labels.modelName}<input required placeholder={labels.modelNameHelp} value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <label>{labels.modelKey}<input required placeholder={labels.modelKeyHelp} value={draft.modelKey} onChange={(event) => setDraft((current) => ({ ...current, modelKey: event.target.value }))} /></label>
        <label>{labels.provider}<select required value={draft.providerId || ""} onChange={(event) => setDraft((current) => ({ ...current, providerId: event.target.value }))}><option value="">{labels.chooseProvider}</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName} ({provider.providerKey})</option>)}</select></label>
        <label>{labels.modelType}<select value={draft.modelType} onChange={(event) => setDraft((current) => ({ ...current, modelType: event.target.value }))}><option value="video">{labels.videoModel}</option><option value="image">{labels.imageModel}</option><option value="chat">{labels.chatModel}</option><option value="audio">{labels.audioModel}</option></select></label>
        <label>{labels.inputType}<input required placeholder={labels.inputTypeHelp} value={draft.inputType} onChange={(event) => setDraft((current) => ({ ...current, inputType: event.target.value }))} /></label>
        <label>{labels.outputType}<input required placeholder={labels.outputTypeHelp} value={draft.outputType} onChange={(event) => setDraft((current) => ({ ...current, outputType: event.target.value }))} /></label>
        <label>{labels.oldPrice}<input type="number" min="0" step="1" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: Number(event.target.value) }))} /></label>
        <label>{labels.sortOrder}<input type="number" step="1" value={draft.sortOrder} onChange={(event) => setDraft((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label>
        <label className="admin-form-check">{labels.enabled}<input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>{enabledLabel(draft.enabled)}</span></label>
        <label className="admin-form-wide">{labels.configJson}<textarea placeholder={labels.configHelp} value={draft.configJson || "{}"} onChange={(event) => setDraft((current) => ({ ...current, configJson: event.target.value }))} /></label>
        <div className="admin-form-wide admin-help">{labels.defaultRules}{ruleSummary}</div>
      </div>
      <div className="admin-form-actions"><button className="admin-action primary" type="submit" disabled={saving}>{labels.save}</button><button className="admin-action muted" type="button" onClick={cancel}>{labels.cancel}</button></div>
    </form>
  );
}


function PricingRulesTable(props: {
  rules: AdminPricingRule[]; drafts: Record<string, PricingDraft>; savingId: string;
  setDrafts: Dispatch<SetStateAction<Record<string, PricingDraft>>>;
  save: (id: string) => void; toggle: (rule: AdminPricingRule) => void; remove: (rule: AdminPricingRule) => void;
}) {
  function patch(id: string, value: Partial<PricingDraft>) {
    props.setDrafts((current) => ({ ...current, [id]: { ...current[id], ...value } }));
  }
  return <DataTable rows={props.rules} columns={[
    { key: "inputContainsVideo", title: "输入模式", render: (row) => <select value={String(props.drafts[row.id]?.inputContainsVideo ?? row.inputContainsVideo)} onChange={(event) => patch(row.id, { inputContainsVideo: event.target.value === "true" })}><option value="false">输入不含视频</option><option value="true">输入包含视频</option></select> },
    { key: "audioMode", title: "声音模式", render: (row) => <select value={props.drafts[row.id]?.audioMode || "default"} onChange={(event) => patch(row.id, { audioMode: event.target.value })}><option value="default">默认</option><option value="audio">有声视频</option><option value="silent">无声视频</option></select> },
    { key: "resolution", title: "分辨率", render: (row) => <select value={props.drafts[row.id]?.resolution || row.resolution} onChange={(event) => patch(row.id, { resolution: event.target.value })}><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option></select> },
    { key: "output", title: "输出时长", render: (row) => <div className="admin-inline-actions"><input className="admin-number-input" type="number" min="4" max="15" value={props.drafts[row.id]?.minOutputDuration ?? row.minOutputDuration} onChange={(event) => patch(row.id, { minOutputDuration: Number(event.target.value) })} /><input className="admin-number-input" type="number" min="4" max="15" value={props.drafts[row.id]?.maxOutputDuration ?? row.maxOutputDuration} onChange={(event) => patch(row.id, { maxOutputDuration: Number(event.target.value) })} /></div> },
    { key: "input", title: "输入视频时长", render: (row) => <div className="admin-inline-actions"><input className="admin-number-input" type="number" min="2" max="15" value={props.drafts[row.id]?.minInputVideoDuration ?? ""} onChange={(event) => patch(row.id, { minInputVideoDuration: event.target.value ? Number(event.target.value) : null })} /><input className="admin-number-input" type="number" min="2" max="15" value={props.drafts[row.id]?.maxInputVideoDuration ?? ""} onChange={(event) => patch(row.id, { maxInputVideoDuration: event.target.value ? Number(event.target.value) : null })} /></div> },
    { key: "billable", title: "最低计费输入", align: "right", render: (row) => <input className="admin-number-input" type="number" min="2" max="15" value={props.drafts[row.id]?.minBillableInputVideoDuration ?? ""} onChange={(event) => patch(row.id, { minBillableInputVideoDuration: event.target.value ? Number(event.target.value) : null })} /> },
    { key: "costPerSecondRmb", title: "成本元/秒", align: "right", render: (row) => <input className="admin-number-input" type="number" min="0" step="0.0001" value={props.drafts[row.id]?.costPerSecondRmb ?? ""} onChange={(event) => {
      const cost = event.target.value ? Number(event.target.value) : null;
      patch(row.id, { costPerSecondRmb: cost, pointsPerSecond: pointsFromCost(cost) });
    }} /> },
    { key: "salesCnyPerSecond", title: "销售价格元/秒", align: "right", render: (row) => {
      const sales = calculateAdminSalesPriceFromCost(props.drafts[row.id]?.costPerSecondRmb ?? row.costPerSecondRmb);
      return <input className="admin-number-input" type="number" min="0" step="0.01" value={formatAdminCny(sales.salesCnyPerSecond)} readOnly />;
    } },
    { key: "enabled", title: "启用状态", render: (row) => <StatusBadge status={badgeStatus(row.enabled)}>{enabledLabel(row.enabled)}</StatusBadge> },
    { key: "remark", title: "备注", render: (row) => <input className="admin-cell-input" value={props.drafts[row.id]?.remark || ""} onChange={(event) => patch(row.id, { remark: event.target.value })} /> },
    { key: "actions", title: "操作", render: (row) => <div className="admin-inline-actions"><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.save(row.id)}>保存</button><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.toggle(row)}>{row.enabled ? "禁用" : "启用"}</button><button className="admin-action danger" type="button" disabled={props.savingId === row.id} onClick={() => props.remove(row)}>删除</button></div> }
  ]} />;
}

function PricingRuleForm({ draft, saving, setDraft, submit, cancel }: { draft: PricingDraft; saving: boolean; setDraft: Dispatch<SetStateAction<PricingDraft>>; submit: (event: FormEvent) => void; cancel: () => void }) {
  const sales = calculateAdminSalesPriceFromCost(draft.costPerSecondRmb);
  return (
    <form className="admin-editor" onSubmit={submit}>
      <div className="admin-editor-head"><strong>新增计费规则</strong><span>填写成本后，销售价格自动按 成本 × 1.2 计算；实际扣费时按 1 元 = 100 积分换算。</span></div>
      <div className="admin-form-grid">
        <label>输入模式<select value={String(draft.inputContainsVideo)} onChange={(event) => setDraft((current) => ({ ...current, inputContainsVideo: event.target.value === "true" }))}><option value="false">输入不含视频</option><option value="true">输入包含视频</option></select></label>
        <label>声音模式<select value={draft.audioMode} onChange={(event) => setDraft((current) => ({ ...current, audioMode: event.target.value }))}><option value="default">默认</option><option value="audio">有声视频</option><option value="silent">无声视频</option></select></label>
        <label>分辨率<select value={draft.resolution} onChange={(event) => setDraft((current) => ({ ...current, resolution: event.target.value }))}><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
        <label>最短输出<input type="number" min="4" max="15" value={draft.minOutputDuration} onChange={(event) => setDraft((current) => ({ ...current, minOutputDuration: Number(event.target.value) }))} /></label>
        <label>最长输出<input type="number" min="4" max="15" value={draft.maxOutputDuration} onChange={(event) => setDraft((current) => ({ ...current, maxOutputDuration: Number(event.target.value) }))} /></label>
        <label>最短输入视频<input type="number" min="2" max="15" value={draft.minInputVideoDuration ?? ""} onChange={(event) => setDraft((current) => ({ ...current, minInputVideoDuration: event.target.value ? Number(event.target.value) : null }))} /></label>
        <label>最长输入视频<input type="number" min="2" max="15" value={draft.maxInputVideoDuration ?? ""} onChange={(event) => setDraft((current) => ({ ...current, maxInputVideoDuration: event.target.value ? Number(event.target.value) : null }))} /></label>
        <label>最低计费输入<input type="number" min="2" max="15" value={draft.minBillableInputVideoDuration ?? ""} onChange={(event) => setDraft((current) => ({ ...current, minBillableInputVideoDuration: event.target.value ? Number(event.target.value) : null }))} /></label>
        <label>成本元/秒<input type="number" min="0" step="0.0001" value={draft.costPerSecondRmb ?? ""} onChange={(event) => setDraft((current) => {
          const cost = event.target.value ? Number(event.target.value) : null;
          return { ...current, costPerSecondRmb: cost, pointsPerSecond: pointsFromCost(cost) };
        })} /></label>
        <label>销售价格元/秒<input type="number" min="0" step="0.01" value={formatAdminCny(sales.salesCnyPerSecond)} readOnly /></label>
        <label className="admin-form-check">启用状态<input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>{enabledLabel(draft.enabled)}</span></label>
        <label className="admin-form-wide">备注<input value={draft.remark} onChange={(event) => setDraft((current) => ({ ...current, remark: event.target.value }))} /></label>
      </div>
      <div className="admin-form-actions"><button className="admin-action primary" type="submit" disabled={saving}>保存</button><button className="admin-action muted" type="button" onClick={cancel}>取消</button></div>
    </form>
  );
}

function ProvidersModule(props: {
  providers: AdminProvider[]; drafts: Record<string, ProviderDraft>; draft: AdminProviderCreate; creating: boolean; loading?: boolean; error?: string; savingId: string;
  setDrafts: Dispatch<SetStateAction<Record<string, ProviderDraft>>>; setDraft: Dispatch<SetStateAction<AdminProviderCreate>>; setCreating: (value: boolean) => void;
  saveProvider: (id: string) => void; submitProvider: (event: FormEvent) => void; toggleProvider: (provider: AdminProvider) => void; removeProvider: (provider: AdminProvider) => void;
}) {
  return (
    <AdminTable title="供应商管理" loading={props.loading} error={props.error} empty={!props.providers.length} action={<button className="admin-action primary" type="button" onClick={() => props.setCreating(!props.creating)}><Plus size={15} /> 新增供应商</button>}>
      {props.creating ? <ProviderCreateForm draft={props.draft} saving={props.savingId === "new-provider"} setDraft={props.setDraft} submit={props.submitProvider} cancel={() => props.setCreating(false)} /> : null}
      <DataTable rows={props.providers} columns={[
        { key: "displayName", title: "供应商名称", render: (row) => <input className="admin-cell-input" value={props.drafts[row.id]?.displayName || ""} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], displayName: event.target.value } }))} /> },
        { key: "providerKey", title: "供应商标识", render: (row) => row.providerKey },
        { key: "enabled", title: "启用状态", render: (row) => <StatusBadge status={badgeStatus(row.enabled)}>{enabledLabel(row.enabled)}</StatusBadge> },
        { key: "baseUrl", title: "接口地址", render: (row) => <input className="admin-url-input" value={props.drafts[row.id]?.baseUrl || ""} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], baseUrl: event.target.value } }))} /> },
        { key: "apiKeyEnvName", title: "密钥环境变量名", render: (row) => <div className="admin-env-cell"><input className="admin-cell-input" placeholder="ENV_NAME" value={props.drafts[row.id]?.apiKeyEnvName || ""} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], apiKeyEnvName: event.target.value } }))} /><small>这里只填写环境变量名，不填写真实 API Key。</small></div> },
        { key: "updatedAt", title: "更新时间", render: (row) => formatAdminTime(row.updatedAt) },
        { key: "actions", title: "操作", render: (row) => <div className="admin-inline-actions"><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.saveProvider(row.id)}>保存</button><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.toggleProvider(row)}>{row.enabled ? "禁用" : "启用"}</button><button className="admin-action danger" type="button" disabled={props.savingId === row.id} onClick={() => props.removeProvider(row)}>删除</button></div> }
      ]} />
    </AdminTable>
  );
}

function ProviderCreateForm({ draft, saving, setDraft, submit, cancel }: { draft: AdminProviderCreate; saving: boolean; setDraft: Dispatch<SetStateAction<AdminProviderCreate>>; submit: (event: FormEvent) => void; cancel: () => void }) {
  return (
    <form className="admin-editor" onSubmit={submit}>
      <div className="admin-editor-head"><strong>新增供应商</strong><span>真实 API Key 只放在后端环境变量中。</span></div>
      <div className="admin-form-grid">
        <label>供应商名称<input required value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <label>供应商标识<input required value={draft.providerKey} onChange={(event) => setDraft((current) => ({ ...current, providerKey: event.target.value }))} /></label>
        <label className="admin-form-wide">接口地址<input value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
        <label>密钥环境变量名<input placeholder="PROVIDER_API_KEY" value={draft.apiKeyEnvName} onChange={(event) => setDraft((current) => ({ ...current, apiKeyEnvName: event.target.value }))} /><small>这里只填写环境变量名，不填写真实 API Key。</small></label>
        <label className="admin-form-check">启用状态<input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>{enabledLabel(draft.enabled)}</span></label>
        <label className="admin-form-wide">配置 JSON<textarea placeholder='{"adapter": "provider"}' value={draft.configJson || ""} onChange={(event) => setDraft((current) => ({ ...current, configJson: event.target.value }))} /></label>
      </div>
      <div className="admin-form-actions"><button className="admin-action primary" type="submit" disabled={saving}>保存</button><button className="admin-action muted" type="button" onClick={cancel}>取消</button></div>
    </form>
  );
}

function LogsModule({ logs, total, loading, error }: { logs: AdminLog[]; total?: number; loading?: boolean; error?: string }) {
  return <AdminTable title={`操作日志${total === undefined ? "" : ` · 共 ${total} 条`}`} loading={loading} error={error} empty={!logs.length}><DataTable rows={logs} columns={[
    { key: "admin", title: "操作管理员", render: (row) => <span title={row.adminUserId}>{brief(row.adminUserId, 18)}</span> },
    { key: "action", title: "操作类型", render: (row) => adminActionLabel(row.action) },
    { key: "targetType", title: "操作对象", render: (row) => adminTargetLabel(row.targetType) },
    { key: "targetId", title: "对象 ID", render: (row) => <span title={row.targetId}>{brief(row.targetId, 16)}</span> },
    { key: "detail", title: "操作详情", render: (row) => <span className="admin-clamp" title={detailSummary(row.detail)}>{detailSummary(row.detail)}</span> },
    { key: "createdAt", title: "操作时间", render: (row) => formatAdminTime(row.createdAt) }
  ]} /></AdminTable>;
}
