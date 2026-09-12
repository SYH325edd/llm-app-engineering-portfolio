import { ClipboardList, Database, Grid2X2, PackageCheck, Users, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import PageLayout from "../../../components/PageLayout";
import { ApiError } from "../../../shared/api/client";
import { getSystemHealth } from "../health-api";
import type { SystemHealth } from "../health-api";
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
} from "../api";
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
} from "../api";
import NoPermissionPage from "./NoPermissionPage";
import GiftCardsModule from "./AdminGiftCardsPage";

import {
  adminError,
  assertJsonText,
  containsSecretLike,
  emptyModel,
  emptyPricingRule,
  emptyProvider,
  listParams,
  modules,
  peopleModules,
  withCostBasedSalesPoints
} from "../admin-utils";
import type { ModuleKey, PeopleModuleKey, ModelDraft, PricingDraft, ProviderDraft, StatItem } from "../admin-utils";
import { LogsModule, ModelsModule, Overview, PeopleDataModule, ProvidersModule } from "../components/AdminModules";

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
