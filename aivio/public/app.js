const state = {
  providers: [],
  videoProviders: [],
  videoModels: [],
  settings: {
    provider: "github",
    baseUrl: "",
    model: "",
    temperature: 0.7,
    maxTokens: 4096
  },
  videoSettings: {
    provider: "volcengine",
    baseUrl: "",
    model: "",
    mode: "text-to-video",
    ratio: "16:9",
    duration: 5,
    resolution: "720p",
    seed: "",
    generateAudio: false,
    watermark: false,
    prompt: "",
    imageUrl: "",
    endImageUrl: "",
    taskId: ""
  },
  chat: [],
  assignmentMessages: [],
  activeMode: "solve",
  history: [],
  generationTasks: [],
  rechargePackages: [],
  orders: [],
  admin: {
    stats: null,
    users: [],
    orders: [],
    tasks: [],
    creditLogs: [],
    adminLogs: [],
    models: [],
    providers: [],
    selectedUser: null
  },
  currentUser: null,
  balance: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const API_BASE_STORAGE_KEY = "relay.apiBaseUrl";
const AUTH_TOKEN_STORAGE_KEY = "relay.authToken";
const AUTH_USER_STORAGE_KEY = "relay.authUser";
const POWERSHELL_API_BASE_URL = "/api";
const NODE_API_BASE_URL = "http://127.0.0.1:8788/api";

let API_BASE_URL = normalizeApiBaseUrl(localStorage.getItem(API_BASE_STORAGE_KEY) || POWERSHELL_API_BASE_URL);

const systemPresets = {
  "karpathy-coding": [
    "You are a coding assistant following Karpathy-inspired development habits.",
    "Work like a senior engineer inside the existing codebase: inspect first, then make the smallest useful change.",
    "State the concrete problem in your own words, identify the files and behaviors involved, and avoid broad rewrites.",
    "Prefer simple code, local patterns, tight feedback loops, and changes that can be manually verified.",
    "Do not add abstractions, dependencies, comments, or tests unless they reduce real risk or make the behavior clearer.",
    "For bugs, reason from evidence before patching; for features, keep the first version complete but narrowly scoped.",
    "When finished, explain what changed, how it was verified, and any remaining trade-offs."
  ].join("\n")
};

const els = {
  serverStatus: $("#serverStatus"),
  providerSelect: $("#providerSelect"),
  baseUrlInput: $("#baseUrlInput"),
  modelInput: $("#modelInput"),
  modelPresetSelect: $("#modelPresetSelect"),
  modelList: $("#modelList"),
  temperatureInput: $("#temperatureInput"),
  maxTokensInput: $("#maxTokensInput"),
  relayEndpoint: $("#relayEndpoint"),
  apiMode: $("#apiMode"),
  usePowerShellApi: $("#usePowerShellApi"),
  useNodeApi: $("#useNodeApi"),
  rechargeTab: $("#rechargeTab"),
  adminTab: $("#adminTab"),
  authStatus: $("#authStatus"),
  loginForm: $("#loginForm"),
  loginEmail: $("#loginEmail"),
  loginPassword: $("#loginPassword"),
  registerForm: $("#registerForm"),
  registerEmail: $("#registerEmail"),
  registerNickname: $("#registerNickname"),
  registerPassword: $("#registerPassword"),
  logoutButton: $("#logoutButton"),
  balanceBox: $("#balanceBox"),
  userBalance: $("#userBalance"),
  refreshBalance: $("#refreshBalance"),
  activeModel: $("#activeModel"),
  chatStream: $("#chatStream"),
  chatForm: $("#chatForm"),
  chatInput: $("#chatInput"),
  systemPreset: $("#systemPreset"),
  assignmentForm: $("#assignmentForm"),
  assignmentTitle: $("#assignmentTitle"),
  assignmentSubject: $("#assignmentSubject"),
  assignmentPrompt: $("#assignmentPrompt"),
  assignmentRubric: $("#assignmentRubric"),
  assignmentContext: $("#assignmentContext"),
  assignmentOutput: $("#assignmentOutput"),
  followupForm: $("#followupForm"),
  followupInput: $("#followupInput"),
  videoProviderSelect: $("#videoProviderSelect"),
  videoModeSelect: $("#videoModeSelect"),
  videoBaseUrlInput: $("#videoBaseUrlInput"),
  videoModelInput: $("#videoModelInput"),
  videoModelPresetSelect: $("#videoModelPresetSelect"),
  videoModelList: $("#videoModelList"),
  videoCostHint: $("#videoCostHint"),
  videoRatioInput: $("#videoRatioInput"),
  videoDurationInput: $("#videoDurationInput"),
  videoResolutionInput: $("#videoResolutionInput"),
  videoSeedInput: $("#videoSeedInput"),
  videoGenerateAudioInput: $("#videoGenerateAudioInput"),
  videoWatermarkInput: $("#videoWatermarkInput"),
  videoPromptInput: $("#videoPromptInput"),
  videoImageUrlInput: $("#videoImageUrlInput"),
  videoEndImageUrlInput: $("#videoEndImageUrlInput"),
  videoTaskIdInput: $("#videoTaskIdInput"),
  videoOutput: $("#videoOutput"),
  rechargePackages: $("#rechargePackages"),
  orderList: $("#orderList"),
  adminStats: $("#adminStats"),
  adminUsers: $("#adminUsers"),
  adminUserDetail: $("#adminUserDetail"),
  adminOrders: $("#adminOrders"),
  adminTasks: $("#adminTasks"),
  adminCreditLogs: $("#adminCreditLogs"),
  adminLogs: $("#adminLogs"),
  adminModels: $("#adminModels"),
  adminProviders: $("#adminProviders"),
  historyList: $("#historyList"),
  toast: $("#toast")
};

function loadLocalState() {
  const rawSettings = localStorage.getItem("relay.settings");
  if (rawSettings) {
    try {
      state.settings = { ...state.settings, ...JSON.parse(rawSettings) };
    } catch {}
  }
  delete state.settings.apiKey;
  delete state.settings.rememberKey;

  const rawVideoSettings = localStorage.getItem("relay.videoSettings");
  if (rawVideoSettings) {
    try {
      state.videoSettings = { ...state.videoSettings, ...JSON.parse(rawVideoSettings) };
    } catch {}
  }
  delete state.videoSettings.apiKey;
  delete state.videoSettings.rememberKey;

  const rawHistory = localStorage.getItem("relay.history");
  if (rawHistory) {
    try {
      state.history = JSON.parse(rawHistory);
    } catch {}
  }

  const rawUser = localStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (rawUser) {
    try {
      state.currentUser = JSON.parse(rawUser);
    } catch {}
  }

  const draft = localStorage.getItem("relay.assignmentDraft");
  if (draft) {
    try {
      const parsed = JSON.parse(draft);
      els.assignmentTitle.value = parsed.title || "";
      els.assignmentSubject.value = parsed.subject || "";
      els.assignmentPrompt.value = parsed.prompt || "";
      els.assignmentRubric.value = parsed.rubric || "";
      els.assignmentContext.value = parsed.context || "";
      setMode(parsed.mode || "solve");
    } catch {}
  }
}

function saveSettings() {
  readSettingsFromInputs();
  const settingsToSave = { ...state.settings };
  delete settingsToSave.apiKey;
  delete settingsToSave.rememberKey;
  localStorage.setItem("relay.settings", JSON.stringify(settingsToSave));
  toast("已保存");
  updateActiveModel();
}

function saveHistory() {
  localStorage.setItem("relay.history", JSON.stringify(state.history.slice(0, 80)));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeApiBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === POWERSHELL_API_BASE_URL) return POWERSHELL_API_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

function apiUrl(path) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}

function isNodeApiMode() {
  return API_BASE_URL === NODE_API_BASE_URL;
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
}

function setAuthSession(token, user) {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  }
  if (user) {
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  }
  state.currentUser = user || null;
  renderAuth();
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  state.currentUser = null;
  renderAuth();
}

function renderAuth() {
  const user = state.currentUser;
  const isLoggedIn = Boolean(user);
  if (els.authStatus) {
    els.authStatus.textContent = isLoggedIn ? `已登录：${user.nickname || user.email}` : "未登录";
  }
  if (els.rechargeTab) els.rechargeTab.hidden = !isLoggedIn;
  if (els.adminTab) els.adminTab.hidden = !(isLoggedIn && user.role === "admin");
  if (!(isLoggedIn && user.role === "admin") && $("#adminView")?.classList.contains("active")) {
    switchTab("console");
  }
  if (els.balanceBox) els.balanceBox.hidden = !isLoggedIn;
  if (els.userBalance) els.userBalance.textContent = String(state.balance?.balance ?? user?.balance ?? 0);
  if (els.loginForm) els.loginForm.hidden = isLoggedIn;
  if (els.registerForm) els.registerForm.hidden = isLoggedIn;
  if (els.logoutButton) els.logoutButton.hidden = !isLoggedIn;
}

async function refreshBalance() {
  if (!isNodeApiMode() || !getAuthToken()) {
    state.balance = null;
    renderAuth();
    return null;
  }
  const data = await apiRequest("/user/balance");
  state.balance = data;
  if (state.currentUser) {
    state.currentUser = { ...state.currentUser, balance: data.balance };
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(state.currentUser));
  }
  renderAuth();
  return data;
}

async function fetchRechargePackages() {
  if (!isNodeApiMode() || !getAuthToken()) {
    state.rechargePackages = [];
    renderRechargePackages();
    return state.rechargePackages;
  }
  const data = await apiRequest("/recharge/packages");
  state.rechargePackages = data.packages || [];
  renderRechargePackages();
  return state.rechargePackages;
}

async function fetchOrders() {
  if (!isNodeApiMode() || !getAuthToken()) {
    state.orders = [];
    renderOrders();
    return state.orders;
  }
  const data = await apiRequest("/orders");
  state.orders = data.orders || [];
  renderOrders();
  return state.orders;
}

async function refreshRechargeData() {
  await fetchRechargePackages();
  await fetchOrders();
}

function resetAdminState() {
  state.admin = {
    stats: null,
    users: [],
    orders: [],
    tasks: [],
    creditLogs: [],
    adminLogs: [],
    models: [],
    providers: [],
    selectedUser: null
  };
}

async function refreshAdminData() {
  if (!isNodeApiMode() || !getAuthToken() || state.currentUser?.role !== "admin") {
    resetAdminState();
    renderAdmin();
    return;
  }
  const [stats, users, orders, tasks, creditLogs, adminLogs, models, providers] = await Promise.all([
    apiRequest("/admin/stats"),
    apiRequest("/admin/users?pageSize=20"),
    apiRequest("/admin/orders?pageSize=20"),
    apiRequest("/admin/tasks?pageSize=20"),
    apiRequest("/admin/credit-logs?pageSize=20"),
    apiRequest("/admin/admin-logs?pageSize=20"),
    apiRequest("/admin/models"),
    apiRequest("/admin/providers")
  ]);
  state.admin.stats = stats.stats;
  state.admin.users = users.users || [];
  state.admin.orders = orders.orders || [];
  state.admin.tasks = tasks.tasks || [];
  state.admin.creditLogs = creditLogs.logs || [];
  state.admin.adminLogs = adminLogs.logs || [];
  state.admin.models = models.models || [];
  state.admin.providers = providers.providers || [];
  renderAdmin();
}

function getApiModeLabel() {
  if (API_BASE_URL === POWERSHELL_API_BASE_URL) {
    return `PowerShell API · ${location.host || "127.0.0.1:8787"}`;
  }
  if (API_BASE_URL === NODE_API_BASE_URL) {
    return "Node API · 127.0.0.1:8788";
  }
  return `Custom API · ${API_BASE_URL}`;
}

function updateApiModeDisplay() {
  if (els.apiMode) els.apiMode.textContent = getApiModeLabel();
  els.relayEndpoint.textContent = `${API_BASE_URL}/chat/completions`;
  if (els.usePowerShellApi) els.usePowerShellApi.disabled = API_BASE_URL === POWERSHELL_API_BASE_URL;
  if (els.useNodeApi) els.useNodeApi.disabled = API_BASE_URL === NODE_API_BASE_URL;
}

function setApiBaseUrl(value) {
  API_BASE_URL = normalizeApiBaseUrl(value);
  localStorage.setItem(API_BASE_STORAGE_KEY, API_BASE_URL);
  updateApiModeDisplay();
}

async function refreshApiData() {
  if (isNodeApiMode()) {
    await fetchCurrentUser();
  } else {
    renderAuth();
  }
  await checkHealth();
  await fetchProviders();
  await fetchVideoProviders();
  await fetchVideoModels();
  await fetchGenerationTasks();
  await refreshRechargeData();
  await refreshAdminData();
  writeSettingsToInputs();
  writeVideoSettingsToInputs();
  syncProviderDefaults(false);
  syncVideoProviderDefaults(false);
  updateActiveModel();
}

async function switchApiBaseUrl(value) {
  setApiBaseUrl(value);
  try {
    await refreshApiData();
    toast(`已切换到 ${getApiModeLabel()}`);
  } catch (error) {
    toast(error.message);
  }
}

async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(formatApiError(data, text, response.status));
  }
  return data;
}

async function fetchCurrentUser() {
  const token = getAuthToken();
  if (!token) {
    state.currentUser = null;
    state.balance = null;
    renderAuth();
    return null;
  }
  try {
    const data = await apiRequest("/auth/me");
    setAuthSession(token, data.user);
    await refreshBalance();
    await refreshRechargeData();
    await refreshAdminData();
    return data.user;
  } catch {
    clearAuthSession();
    return null;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  try {
    const data = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: els.loginEmail.value.trim(),
        password: els.loginPassword.value
      })
    });
    setAuthSession(data.token, data.user);
    els.loginPassword.value = "";
    await refreshBalance();
    await fetchGenerationTasks();
    await refreshRechargeData();
    await refreshAdminData();
    toast("登录成功");
  } catch (error) {
    toast(error.message);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  try {
    const data = await apiRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: els.registerEmail.value.trim(),
        nickname: els.registerNickname.value.trim(),
        password: els.registerPassword.value
      })
    });
    setAuthSession(data.token, data.user);
    els.registerPassword.value = "";
    await refreshBalance();
    await fetchGenerationTasks();
    await refreshRechargeData();
    await refreshAdminData();
    toast("注册成功");
  } catch (error) {
    toast(error.message);
  }
}

async function handleLogout() {
  try {
    if (isNodeApiMode()) {
      await apiRequest("/auth/logout", { method: "POST" });
    }
  } catch {}
  clearAuthSession();
  state.balance = null;
  state.generationTasks = [];
  state.rechargePackages = [];
  state.orders = [];
  resetAdminState();
  renderHistory();
  renderRechargePackages();
  renderOrders();
  renderAdmin();
  toast("已退出登录");
}

async function fetchProviders() {
  const data = await apiRequest("/providers");
  state.providers = data.providers || [];
  els.relayEndpoint.textContent = data.relayEndpoint || `${location.origin}/v1/chat/completions`;
  updateApiModeDisplay();
  renderProviders();
}

async function fetchVideoProviders() {
  const data = await apiRequest("/video/providers");
  state.videoProviders = data.providers || [];
  renderVideoProviders();
}

async function fetchVideoModels() {
  const data = await apiRequest("/models");
  state.videoModels = (data.models || []).filter((model) => model.modelType === "video");
  renderVideoModels(false);
}

async function fetchGenerationTasks() {
  if (isNodeApiMode() && !getAuthToken()) {
    state.generationTasks = [];
    renderHistory();
    return state.generationTasks;
  }
  const data = await apiRequest("/video/tasks");
  state.generationTasks = data.tasks || [];
  renderHistory();
  return state.generationTasks;
}

async function checkHealth() {
  try {
    const data = await apiRequest("/health");
    els.serverStatus.textContent = data.ok ? "本地服务在线" : "服务异常";
  } catch {
    els.serverStatus.textContent = "服务未连接";
  }
}

function renderProviders() {
  els.providerSelect.innerHTML = state.providers
    .map((provider) => `<option value="${escapeHtml(provider.id || provider.provider)}">${escapeHtml(provider.name || provider.displayName)}</option>`)
    .join("");
  if (state.settings.provider) {
    els.providerSelect.value = state.settings.provider;
  }
  syncProviderDefaults(false);
}

function getProvider(id = state.settings.provider) {
  return state.providers.find((provider) => (provider.id || provider.provider) === id) || state.providers[0];
}

function getVideoProvider(id = state.videoSettings.provider) {
  return state.videoProviders.find((provider) => (provider.provider || provider.key || provider.id) === id) || state.videoProviders[0];
}

function getVideoModel(id = state.videoSettings.model) {
  return state.videoModels.find((model) => model.id === id) || state.videoModels[0];
}

function updateVideoCostHint() {
  if (!els.videoCostHint) return;
  const model = getVideoModel(els.videoModelInput?.value || state.videoSettings.model);
  const price = model?.price;
  els.videoCostHint.textContent = typeof price === "number" && Number.isFinite(price)
    ? `预计消耗积分：${price}`
    : "预计消耗积分：--";
}

function syncProviderDefaults(overwriteModel = true) {
  const provider = getProvider(els.providerSelect.value);
  if (!provider) return;

  state.settings.provider = provider.id || provider.provider;
  if (!els.baseUrlInput.value || overwriteModel) {
    els.baseUrlInput.value = provider.baseUrl || "";
  }

  const models = provider.models || [];
  const getModelId = (model) => typeof model === "string" ? model : model.id;
  const getModelLabel = (model) => typeof model === "string" ? model : (model.displayName || model.id);
  els.modelList.innerHTML = models
    .filter(Boolean)
    .map((model) => `<option value="${escapeHtml(getModelId(model))}">${escapeHtml(getModelLabel(model))}</option>`)
    .join("");
  els.modelPresetSelect.innerHTML = models
    .filter(Boolean)
    .map((model) => `<option value="${escapeHtml(getModelId(model))}">${escapeHtml(getModelLabel(model))}</option>`)
    .join("");

  if (overwriteModel && models[0]) {
    els.modelInput.value = getModelId(models[0]);
  } else if (!els.modelInput.value && state.settings.model) {
    els.modelInput.value = state.settings.model;
  } else if (!els.modelInput.value && models[0]) {
    els.modelInput.value = getModelId(models[0]);
  }
  if (els.modelInput.value) {
    els.modelPresetSelect.value = els.modelInput.value;
  }
  updateActiveModel();
}

function renderVideoProviders() {
  els.videoProviderSelect.innerHTML = state.videoProviders
    .map((provider) => `<option value="${escapeHtml(provider.provider || provider.key || provider.id)}">${escapeHtml(provider.displayName || provider.name)}</option>`)
    .join("");
  if (state.videoSettings.provider) {
    els.videoProviderSelect.value = state.videoSettings.provider;
  }
  syncVideoProviderDefaults(false);
}

function syncVideoProviderDefaults(overwriteModel = true) {
  const provider = getVideoProvider(els.videoProviderSelect.value);
  if (!provider) return;
  state.videoSettings.provider = provider.provider || provider.key || provider.id;
  els.videoBaseUrlInput.value = provider.baseUrl || "";
  renderVideoModels(overwriteModel);
}

function renderVideoModels(overwriteModel = false) {
  const models = state.videoModels || [];
  els.videoModelList.innerHTML = models
    .filter(Boolean)
    .map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.displayName || model.id)}</option>`)
    .join("");
  els.videoModelPresetSelect.innerHTML = models
    .filter(Boolean)
    .map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.displayName || model.id)}</option>`)
    .join("");
  if (overwriteModel && models[0]) {
    els.videoModelInput.value = models[0].id;
  } else if (!els.videoModelInput.value && state.videoSettings.model) {
    els.videoModelInput.value = state.videoSettings.model;
  } else if (!els.videoModelInput.value && models[0]) {
    els.videoModelInput.value = models[0].id;
  }
  if (els.videoModelInput.value) {
    els.videoModelPresetSelect.value = els.videoModelInput.value;
  }
  const model = getVideoModel(els.videoModelInput.value);
  const defaults = model?.defaultParams || {};
  if (overwriteModel || !els.videoModeSelect.value) {
    els.videoModeSelect.value = defaults.mode || state.videoSettings.mode || "text-to-video";
  }
  if (overwriteModel && defaults.ratio) els.videoRatioInput.value = defaults.ratio;
  if (overwriteModel && defaults.duration) els.videoDurationInput.value = defaults.duration;
  if (overwriteModel && defaults.resolution) els.videoResolutionInput.value = defaults.resolution;
  if (overwriteModel && defaults.generateAudio !== undefined) {
    els.videoGenerateAudioInput.checked = Boolean(defaults.generateAudio);
  }
  if (overwriteModel && defaults.watermark !== undefined) {
    els.videoWatermarkInput.checked = Boolean(defaults.watermark);
  }
  if (!els.videoOutput.textContent) {
    els.videoOutput.textContent = "Video model list is ready. Video API keys are read only from server environment variables.";
  }
  updateVideoCostHint();
}
function writeSettingsToInputs() {
  els.providerSelect.value = state.settings.provider;
  els.baseUrlInput.value = state.settings.baseUrl;
  els.modelInput.value = state.settings.model;
  els.temperatureInput.value = state.settings.temperature;
  els.maxTokensInput.value = state.settings.maxTokens;
}

function writeVideoSettingsToInputs() {
  els.videoProviderSelect.value = state.videoSettings.provider;
  els.videoBaseUrlInput.value = state.videoSettings.baseUrl;
  els.videoModelInput.value = state.videoSettings.model;
  els.videoModeSelect.value = state.videoSettings.mode;
  els.videoRatioInput.value = state.videoSettings.ratio;
  els.videoDurationInput.value = state.videoSettings.duration;
  els.videoResolutionInput.value = state.videoSettings.resolution;
  els.videoSeedInput.value = state.videoSettings.seed;
  els.videoGenerateAudioInput.checked = Boolean(state.videoSettings.generateAudio);
  els.videoWatermarkInput.checked = Boolean(state.videoSettings.watermark);
  els.videoPromptInput.value = state.videoSettings.prompt;
  els.videoImageUrlInput.value = state.videoSettings.imageUrl;
  els.videoEndImageUrlInput.value = state.videoSettings.endImageUrl;
  els.videoTaskIdInput.value = state.videoSettings.taskId;
}

function readSettingsFromInputs() {
  state.settings.provider = els.providerSelect.value;
  state.settings.baseUrl = els.baseUrlInput.value.trim();
  state.settings.model = els.modelInput.value.trim();
  state.settings.temperature = Number(els.temperatureInput.value || 0.7);
  state.settings.maxTokens = Number(els.maxTokensInput.value || 4096);
}

function readVideoSettingsFromInputs() {
  state.videoSettings.provider = els.videoProviderSelect.value;
  state.videoSettings.baseUrl = els.videoBaseUrlInput.value.trim();
  state.videoSettings.model = els.videoModelInput.value.trim();
  state.videoSettings.mode = els.videoModeSelect.value;
  state.videoSettings.ratio = els.videoRatioInput.value;
  state.videoSettings.duration = Number(els.videoDurationInput.value || 5);
  state.videoSettings.resolution = els.videoResolutionInput.value.trim();
  state.videoSettings.seed = els.videoSeedInput.value.trim();
  state.videoSettings.generateAudio = els.videoGenerateAudioInput.checked;
  state.videoSettings.watermark = els.videoWatermarkInput.checked;
  state.videoSettings.prompt = els.videoPromptInput.value.trim();
  state.videoSettings.imageUrl = els.videoImageUrlInput.value.trim();
  state.videoSettings.endImageUrl = els.videoEndImageUrlInput.value.trim();
  state.videoSettings.taskId = els.videoTaskIdInput.value.trim();
}

function saveVideoSettings() {
  readVideoSettingsFromInputs();
  const settingsToSave = { ...state.videoSettings };
  delete settingsToSave.apiKey;
  delete settingsToSave.rememberKey;
  localStorage.setItem("relay.videoSettings", JSON.stringify(settingsToSave));
  toast("视频配置已保存");
}

function updateActiveModel() {
  readSettingsFromInputs();
  const provider = getProvider();
  const name = provider ? (provider.name || provider.displayName) : state.settings.provider;
  els.activeModel.textContent = `${name || "Custom"} · ${state.settings.model || "未选择模型"}`;
}

function getSystemPrompt() {
  const selected = els.systemPreset.value.trim();
  return systemPresets[selected] || selected;
}

function validateSettings() {
  readSettingsFromInputs();
  const provider = getProvider();
  if (provider?.requiresKey && !provider.configured) throw new Error("该功能暂未配置，请联系管理员");
  if (!state.settings.model) throw new Error("请填写模型名");
}

function formatApiError(data, text, status) {
  const pieces = [];
  const message = (typeof data?.error === "string" ? data.error : data?.error?.message) || data?.message || text || `请求失败 ${status}`;
  pieces.push(message);
  if (data?.error?.upstream_url) pieces.push(`上游地址：${data.error.upstream_url}`);
  if (data?.error?.hint) pieces.push(data.error.hint);
  return pieces.join("\n");
}

async function callRelay(messages, options = {}) {
  validateSettings();
  const payload = {
    provider: state.settings.provider,
    model: state.settings.model,
    messages,
    temperature: state.settings.temperature,
    max_tokens: state.settings.maxTokens,
    stream: false,
    ...options
  };

  const data = await apiRequest("/chat/completions", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.raw || "";
  return { content, data };
}

function buildVideoPayload() {
  readVideoSettingsFromInputs();
  return {
    modelId: state.videoSettings.model,
    mode: state.videoSettings.mode,
    prompt: state.videoSettings.prompt,
    ratio: state.videoSettings.ratio,
    aspect_ratio: state.videoSettings.ratio,
    duration: state.videoSettings.duration,
    resolution: state.videoSettings.resolution,
    seed: state.videoSettings.seed,
    generateAudio: state.videoSettings.generateAudio,
    watermark: state.videoSettings.watermark,
    imageUrl: state.videoSettings.imageUrl,
    endImageUrl: state.videoSettings.endImageUrl
  };
}

function validateVideoSettings() {
  readVideoSettingsFromInputs();
  if (!state.videoSettings.model) throw new Error("Please choose a video model");
  if (!state.videoSettings.prompt) throw new Error("Please fill in Prompt");
}
async function submitVideoTask(event) {
  event.preventDefault();
  try {
    if (isNodeApiMode() && !state.currentUser) {
      throw new Error("请先登录后再生成视频。");
    }
    validateVideoSettings();
    els.videoOutput.classList.add("loading");
    els.videoOutput.textContent = "正在提交视频任务...";
    const data = await apiRequest("/video/generations", {
      method: "POST",
      body: JSON.stringify(buildVideoPayload())
    });
    const taskId = data.task_id || data.upstream?.id || data.upstream?.task_id || data.upstream?.output?.task_id || data.upstream?.request_id || data.upstream?.name || "";
    if (taskId) {
      els.videoTaskIdInput.value = taskId;
      state.videoSettings.taskId = taskId;
    }
    els.videoOutput.textContent = JSON.stringify(data, null, 2);
    saveVideoSettings();
    refreshBalance().catch((balanceError) => toast(balanceError.message));
    fetchGenerationTasks().catch((taskError) => toast(taskError.message));
    addHistory("视频任务", state.videoSettings.prompt || state.videoSettings.model, JSON.stringify(data, null, 2));
  } catch (error) {
    els.videoOutput.textContent = `提交失败：${error.message}`;
    refreshBalance().catch(() => {});
  } finally {
    els.videoOutput.classList.remove("loading");
  }
}

async function refreshVideoTask() {
  try {
    readVideoSettingsFromInputs();
    if (!state.videoSettings.taskId) throw new Error("请填写任务 ID");
    els.videoOutput.classList.add("loading");
    els.videoOutput.textContent = "正在查询视频任务...";
    const taskId = encodeURIComponent(state.videoSettings.taskId);
    const data = await apiRequest(`/video/tasks/${taskId}`);
    els.videoOutput.textContent = JSON.stringify(data, null, 2);
    saveVideoSettings();
    refreshBalance().catch((balanceError) => toast(balanceError.message));
    fetchGenerationTasks().catch((taskError) => toast(taskError.message));
  } catch (error) {
    els.videoOutput.textContent = `查询失败：${error.message}`;
  } finally {
    els.videoOutput.classList.remove("loading");
  }
}

function addMessage(role, content, meta = "") {
  state.chat.push({ role, content, meta, time: new Date().toISOString() });
  renderChat();
}

function renderChat() {
  if (!state.chat.length) {
    els.chatStream.innerHTML = `
      <div class="message">
        <div class="meta">控制台</div>
        <div class="content">选择供应商，填写 Key 和模型名，然后开始调用。</div>
      </div>
    `;
    return;
  }
  els.chatStream.innerHTML = state.chat.map((message) => `
    <article class="message ${message.role === "user" ? "user" : ""}">
      <div class="meta">${escapeHtml(message.role === "user" ? "你" : "模型")}${message.meta ? ` · ${escapeHtml(message.meta)}` : ""}</div>
      <div class="content">${escapeHtml(message.content)}</div>
    </article>
  `).join("");
  els.chatStream.scrollTop = els.chatStream.scrollHeight;
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const prompt = els.chatInput.value.trim();
  if (!prompt) return;

  addMessage("user", prompt);
  els.chatInput.value = "";
  const loading = { role: "assistant", content: "请求中...", meta: "处理中", time: new Date().toISOString(), loading: true };
  state.chat.push(loading);
  renderChat();

  try {
    const system = getSystemPrompt();
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    for (const message of state.chat.filter((item) => !item.loading)) {
      messages.push({ role: message.role === "assistant" ? "assistant" : "user", content: message.content });
    }
    const result = await callRelay(messages);
    loading.content = result.content || "模型没有返回文本。";
    loading.meta = state.settings.model;
    loading.loading = false;
    addHistory("控制台", prompt, loading.content);
  } catch (error) {
    loading.content = `请求失败：${error.message}`;
    loading.meta = "错误";
    loading.loading = false;
  }
  renderChat();
}

function setMode(mode) {
  state.activeMode = mode;
  $$(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
}

function getModeInstruction() {
  const subject = els.assignmentSubject.value.trim() || "通用";
  const base = `你是${subject}作业助手。输出要清晰、分步骤、可直接用于学习复盘。`;
  const modes = {
    solve: `${base} 先分析题意，再给解题过程，最后给最终答案。`,
    check: `${base} 检查用户作业，指出错误、原因和修改后的版本。`,
    outline: `${base} 生成可执行提纲，保留关键论点和步骤。`,
    polish: `${base} 在不改变原意的前提下润色表达，并说明改动重点。`
  };
  return modes[state.activeMode] || modes.solve;
}

function buildAssignmentPrompt() {
  const title = els.assignmentTitle.value.trim();
  const subject = els.assignmentSubject.value.trim();
  const prompt = els.assignmentPrompt.value.trim();
  const rubric = els.assignmentRubric.value.trim();
  const context = els.assignmentContext.value.trim();
  return [
    title ? `作业标题：${title}` : "",
    subject ? `科目：${subject}` : "",
    `模式：${state.activeMode}`,
    "",
    "题目或任务：",
    prompt,
    rubric ? `\n评分要求：\n${rubric}` : "",
    context ? `\n补充材料：\n${context}` : ""
  ].filter(Boolean).join("\n");
}

async function handleAssignmentSubmit(event) {
  event.preventDefault();
  const prompt = buildAssignmentPrompt();
  if (!els.assignmentPrompt.value.trim()) {
    toast("请先填写题目");
    return;
  }

  els.assignmentOutput.classList.add("loading");
  els.assignmentOutput.textContent = "生成中...";

  state.assignmentMessages = [
    { role: "system", content: getModeInstruction() },
    { role: "user", content: prompt }
  ];

  try {
    const result = await callRelay(state.assignmentMessages);
    const content = result.content || "模型没有返回文本。";
    state.assignmentMessages.push({ role: "assistant", content });
    els.assignmentOutput.textContent = content;
    addHistory(els.assignmentTitle.value.trim() || "作业", prompt, content);
    saveDraft();
  } catch (error) {
    els.assignmentOutput.textContent = `请求失败：${error.message}`;
  } finally {
    els.assignmentOutput.classList.remove("loading");
  }
}

async function handleFollowup(event) {
  event.preventDefault();
  const prompt = els.followupInput.value.trim();
  if (!prompt) return;
  if (!state.assignmentMessages.length) {
    toast("先生成一次作业");
    return;
  }

  els.followupInput.value = "";
  els.assignmentOutput.classList.add("loading");
  const current = els.assignmentOutput.textContent;
  els.assignmentOutput.textContent = `${current}\n\n继续处理中...`;

  state.assignmentMessages.push({ role: "user", content: prompt });
  try {
    const result = await callRelay(state.assignmentMessages);
    const content = result.content || "模型没有返回文本。";
    state.assignmentMessages.push({ role: "assistant", content });
    els.assignmentOutput.textContent = content;
    addHistory("继续追问", prompt, content);
  } catch (error) {
    els.assignmentOutput.textContent = `${current}\n\n请求失败：${error.message}`;
  } finally {
    els.assignmentOutput.classList.remove("loading");
  }
}

function saveDraft() {
  const draft = {
    title: els.assignmentTitle.value,
    subject: els.assignmentSubject.value,
    prompt: els.assignmentPrompt.value,
    rubric: els.assignmentRubric.value,
    context: els.assignmentContext.value,
    mode: state.activeMode
  };
  localStorage.setItem("relay.assignmentDraft", JSON.stringify(draft));
  toast("草稿已保存");
}

function addHistory(title, prompt, answer) {
  state.history.unshift({
    title,
    provider: state.settings.provider,
    model: state.settings.model,
    prompt,
    answer,
    time: new Date().toISOString()
  });
  state.history = state.history.slice(0, 80);
  saveHistory();
  renderHistory();
}

function formatTaskStatus(status) {
  const labels = {
    pending: "等待中",
    processing: "处理中",
    succeeded: "已成功",
    failed: "已失败",
    cancelled: "已取消"
  };
  return labels[status] || status || "未知";
}

function formatTaskTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatOrderStatus(status) {
  const labels = {
    pending: "待支付",
    paid: "已支付",
    failed: "失败",
    cancelled: "已取消",
    refunded: "已退款"
  };
  return labels[status] || status || "未知";
}

function renderRechargePackages() {
  if (!els.rechargePackages) return;
  if (!state.currentUser) {
    els.rechargePackages.innerHTML = `<div class="message"><div class="content">请先登录后查看充值套餐。</div></div>`;
    return;
  }
  if (!state.rechargePackages.length) {
    els.rechargePackages.innerHTML = `<div class="message"><div class="content">暂无可用充值套餐。</div></div>`;
    return;
  }
  els.rechargePackages.innerHTML = state.rechargePackages.map((item) => `
    <article class="package-card">
      <header>
        <div>
          <strong>${escapeHtml(item.name || item.id)}</strong>
          <small>${escapeHtml(item.id || "")}</small>
        </div>
        <strong>￥${escapeHtml(item.amount)}</strong>
      </header>
      <p>${escapeHtml(item.credits)} 积分</p>
      <button type="button" data-create-order="${escapeHtml(item.id)}">创建订单</button>
    </article>
  `).join("");
}

function renderOrders() {
  if (!els.orderList) return;
  if (!state.currentUser) {
    els.orderList.innerHTML = `<div class="message"><div class="content">请先登录后查看订单。</div></div>`;
    return;
  }
  if (!state.orders.length) {
    els.orderList.innerHTML = `<div class="message"><div class="content">暂无订单。</div></div>`;
    return;
  }
  els.orderList.innerHTML = state.orders.map((order, index) => `
    <article class="order-card">
      <header>
        <div>
          <strong>${escapeHtml(order.orderNo || order.id)}</strong>
          <small>${escapeHtml(formatTaskTime(order.createdAt))}</small>
        </div>
        <small>${escapeHtml(formatOrderStatus(order.status))}</small>
      </header>
      <p>金额 ￥${escapeHtml(order.amount)} · ${escapeHtml(order.credits)} 积分</p>
      ${order.status === "pending" ? `<button type="button" data-mock-pay="${index}">模拟支付成功</button>` : ""}
    </article>
  `).join("");
}

async function createOrder(packageId) {
  const data = await apiRequest("/orders", {
    method: "POST",
    body: JSON.stringify({ packageId })
  });
  state.orders.unshift(data.order);
  renderOrders();
  toast("订单已创建");
}

async function mockPayOrder(index) {
  const order = state.orders[Number(index)];
  if (!order) return;
  const data = await apiRequest(`/orders/${encodeURIComponent(order.id)}/mock-pay`, { method: "POST" });
  await refreshBalance();
  await fetchOrders();
  toast("充值成功，积分已到账");
  return data;
}

function renderEmptyAdmin(message = "暂无数据。") {
  return `<div class="message"><div class="content">${escapeHtml(message)}</div></div>`;
}

function renderAdminTable(headers, rows) {
  if (!rows.length) return renderEmptyAdmin();
  return `
    <table>
      <thead><tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

function renderAdmin() {
  if (!els.adminStats) return;
  if (state.currentUser?.role !== "admin") {
    [els.adminStats, els.adminUsers, els.adminOrders, els.adminTasks, els.adminCreditLogs, els.adminLogs, els.adminModels, els.adminProviders].forEach((el) => {
      if (el) el.innerHTML = renderEmptyAdmin("需要管理员权限。");
    });
    if (els.adminUserDetail) els.adminUserDetail.innerHTML = "";
    return;
  }

  const stats = state.admin.stats || {};
  const statItems = [
    ["用户总数", stats.userTotal],
    ["今日新增", stats.todayNewUsers],
    ["订单总数", stats.orderTotal],
    ["已支付订单", stats.paidOrderTotal],
    ["充值金额", stats.rechargeAmount],
    ["总余额", stats.totalBalance],
    ["任务总数", stats.taskTotal],
    ["成功任务", stats.succeededTaskTotal],
    ["失败任务", stats.failedTaskTotal],
    ["消耗积分", stats.consumedCredits]
  ];
  els.adminStats.innerHTML = statItems.map(([label, value]) => `
    <div class="stat-card"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value ?? 0)}</strong></div>
  `).join("");

  els.adminUsers.innerHTML = renderAdminTable(["邮箱", "昵称", "角色", "状态", "余额", "操作"], state.admin.users.map((user, index) => `
    <tr>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.nickname || "")}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${escapeHtml(user.status)}</td>
      <td>${escapeHtml(user.balance)}</td>
      <td>
        <div class="admin-actions">
          <button class="secondary" data-admin-detail="${index}">详情</button>
          <button class="secondary" data-admin-adjust="${index}">调余额</button>
          ${user.status === "active"
            ? `<button class="secondary" data-admin-disable="${index}">禁用</button>`
            : `<button class="secondary" data-admin-enable="${index}">启用</button>`}
        </div>
      </td>
    </tr>
  `));

  els.adminOrders.innerHTML = renderAdminTable(["订单号", "用户", "金额", "积分", "状态", "创建时间"], state.admin.orders.map((order) => `
    <tr>
      <td>${escapeHtml(order.orderNo)}</td>
      <td>${escapeHtml(order.userEmail || order.userId)}</td>
      <td>￥${escapeHtml(order.amount)}</td>
      <td>${escapeHtml(order.credits)}</td>
      <td>${escapeHtml(order.status)}</td>
      <td>${escapeHtml(formatTaskTime(order.createdAt))}</td>
    </tr>
  `));

  els.adminTasks.innerHTML = renderAdminTable(["任务", "用户", "模型", "状态", "消耗", "失败原因"], state.admin.tasks.map((task) => `
    <tr>
      <td>${escapeHtml(task.id)}</td>
      <td>${escapeHtml(task.userEmail || task.userId || "")}</td>
      <td>${escapeHtml(task.modelDisplayName || task.modelId)}</td>
      <td>${escapeHtml(task.status)}</td>
      <td>${escapeHtml(task.cost)}</td>
      <td>${escapeHtml(task.errorMessage || "")}</td>
    </tr>
  `));

  els.adminCreditLogs.innerHTML = renderAdminTable(["用户", "类型", "数量", "变动前", "变动后", "备注"], state.admin.creditLogs.map((log) => `
    <tr>
      <td>${escapeHtml(log.userEmail || log.userId || "")}</td>
      <td>${escapeHtml(log.type)}</td>
      <td>${escapeHtml(log.amount)}</td>
      <td>${escapeHtml(log.balanceBefore)}</td>
      <td>${escapeHtml(log.balanceAfter)}</td>
      <td>${escapeHtml(log.remark || "")}</td>
    </tr>
  `));

  els.adminLogs.innerHTML = renderAdminTable(["管理员", "动作", "对象", "时间"], state.admin.adminLogs.map((log) => `
    <tr>
      <td>${escapeHtml(log.adminUserId)}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(`${log.targetType}:${log.targetId}`)}</td>
      <td>${escapeHtml(formatTaskTime(log.createdAt))}</td>
    </tr>
  `));

  els.adminModels.innerHTML = renderAdminTable(["模型", "Key", "供应商", "类型", "价格", "启用", "排序", "操作"], state.admin.models.map((model, index) => `
    <tr>
      <td>${escapeHtml(model.displayName || model.modelId)}</td>
      <td>${escapeHtml(model.modelKey || model.modelId || "")}</td>
      <td>${escapeHtml(model.providerKey || model.provider || "")}</td>
      <td>${escapeHtml(model.modelType)}</td>
      <td>${escapeHtml(model.price)}</td>
      <td>${escapeHtml(model.enabled ? "是" : "否")}</td>
      <td>${escapeHtml(model.sortOrder ?? 0)}</td>
      <td>
        <div class="admin-actions">
          <button class="secondary" data-admin-model-name="${index}">改名</button>
          <button class="secondary" data-admin-model-price="${index}">价格</button>
          <button class="secondary" data-admin-model-sort="${index}">排序</button>
          <button class="secondary" data-admin-model-toggle="${index}">${model.enabled ? "禁用" : "启用"}</button>
        </div>
      </td>
    </tr>
  `));

  if (els.adminProviders) {
    els.adminProviders.innerHTML = renderAdminTable(["供应商", "Key", "启用", "API Key 环境变量", "Base URL", "操作"], state.admin.providers.map((provider, index) => `
      <tr>
        <td>${escapeHtml(provider.displayName)}</td>
        <td>${escapeHtml(provider.providerKey)}</td>
        <td>${escapeHtml(provider.enabled ? "是" : "否")}</td>
        <td>${escapeHtml(provider.apiKeyEnvName || "")}</td>
        <td>${escapeHtml(provider.baseUrl || "")}</td>
        <td>
          <div class="admin-actions">
            <button class="secondary" data-admin-provider-name="${index}">改名</button>
            <button class="secondary" data-admin-provider-base="${index}">Base URL</button>
            <button class="secondary" data-admin-provider-env="${index}">环境变量</button>
            <button class="secondary" data-admin-provider-toggle="${index}">${provider.enabled ? "禁用" : "启用"}</button>
          </div>
        </td>
      </tr>
    `));
  }

  renderAdminUserDetail();
}

function assertEnvNameInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (!/^[A-Z][A-Z0-9_]*$/.test(trimmed) || /sk-|ark-|Bearer\s+/i.test(trimmed)) {
    throw new Error("只能填写环境变量名，不能填写真实 API Key");
  }
  return trimmed;
}

async function patchAdminModel(index, patch) {
  const model = state.admin.models[Number(index)];
  if (!model) return;
  await apiRequest(`/admin/models/${encodeURIComponent(model.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
  await refreshAdminData();
  toast("模型已更新");
}

async function editAdminModelName(index) {
  const model = state.admin.models[Number(index)];
  if (!model) return;
  const displayName = window.prompt("模型展示名称", model.displayName || "");
  if (displayName === null) return;
  await patchAdminModel(index, { displayName });
}

async function editAdminModelPrice(index) {
  const model = state.admin.models[Number(index)];
  if (!model) return;
  const value = window.prompt("模型价格（非负整数）", String(model.price ?? 0));
  if (value === null) return;
  const price = Number(value);
  if (!Number.isInteger(price) || price < 0) {
    toast("请输入非负整数价格");
    return;
  }
  await patchAdminModel(index, { price });
}

async function editAdminModelSort(index) {
  const model = state.admin.models[Number(index)];
  if (!model) return;
  const value = window.prompt("排序值（整数，越小越靠前）", String(model.sortOrder ?? 0));
  if (value === null) return;
  const sortOrder = Number(value);
  if (!Number.isInteger(sortOrder)) {
    toast("请输入整数排序值");
    return;
  }
  await patchAdminModel(index, { sortOrder });
}

async function toggleAdminModel(index) {
  const model = state.admin.models[Number(index)];
  if (!model) return;
  await patchAdminModel(index, { enabled: !model.enabled });
}

async function patchAdminProvider(index, patch) {
  const provider = state.admin.providers[Number(index)];
  if (!provider) return;
  await apiRequest(`/admin/providers/${encodeURIComponent(provider.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
  await refreshAdminData();
  toast("供应商已更新");
}

async function editAdminProviderName(index) {
  const provider = state.admin.providers[Number(index)];
  if (!provider) return;
  const displayName = window.prompt("供应商展示名称", provider.displayName || "");
  if (displayName === null) return;
  await patchAdminProvider(index, { displayName });
}

async function editAdminProviderBaseUrl(index) {
  const provider = state.admin.providers[Number(index)];
  if (!provider) return;
  const baseUrl = window.prompt("Base URL", provider.baseUrl || "");
  if (baseUrl === null) return;
  await patchAdminProvider(index, { baseUrl });
}

async function editAdminProviderEnv(index) {
  const provider = state.admin.providers[Number(index)];
  if (!provider) return;
  const value = window.prompt("API Key 环境变量名（不要填写真实 Key）", provider.apiKeyEnvName || "");
  if (value === null) return;
  await patchAdminProvider(index, { apiKeyEnvName: assertEnvNameInput(value) });
}

async function toggleAdminProvider(index) {
  const provider = state.admin.providers[Number(index)];
  if (!provider) return;
  await patchAdminProvider(index, { enabled: !provider.enabled });
}

function renderAdminUserDetail() {
  if (!els.adminUserDetail) return;
  const detail = state.admin.selectedUser;
  if (!detail) {
    els.adminUserDetail.innerHTML = "";
    return;
  }
  els.adminUserDetail.innerHTML = `
    <div class="message">
      <div class="meta">用户详情 · ${escapeHtml(detail.user.email)}</div>
      <div class="content">余额：${escapeHtml(detail.user.balance)}\n最近订单：${escapeHtml(detail.orders.length)}\n最近任务：${escapeHtml(detail.tasks.length)}\n最近流水：${escapeHtml(detail.creditLogs.length)}</div>
    </div>
  `;
}

async function loadAdminUserDetail(index) {
  const user = state.admin.users[Number(index)];
  if (!user) return;
  state.admin.selectedUser = await apiRequest(`/admin/users/${encodeURIComponent(user.id)}`);
  renderAdminUserDetail();
}

async function adjustAdminUserBalance(index) {
  const user = state.admin.users[Number(index)];
  if (!user) return;
  const amountText = window.prompt(`调整 ${user.email} 的余额，正数增加，负数扣减`, "10");
  if (amountText === null) return;
  const amount = Number(amountText);
  if (!Number.isInteger(amount) || amount === 0) {
    toast("请输入非零整数");
    return;
  }
  const remark = window.prompt("备注", "后台手动调整") || "";
  await apiRequest(`/admin/users/${encodeURIComponent(user.id)}/adjust-balance`, {
    method: "POST",
    body: JSON.stringify({ amount, remark })
  });
  await refreshAdminData();
  toast("余额已调整");
}

async function setAdminUserStatus(index, status) {
  const user = state.admin.users[Number(index)];
  if (!user) return;
  const endpoint = status === "disabled" ? "disable" : "enable";
  await apiRequest(`/admin/users/${encodeURIComponent(user.id)}/${endpoint}`, { method: "POST" });
  await refreshAdminData();
  toast(status === "disabled" ? "用户已禁用" : "用户已启用");
}

function renderHistory() {
  const tasks = state.generationTasks || [];
  if (!tasks.length) {
    const message = isNodeApiMode() && !state.currentUser ? "请先登录后查看任务。" : "暂无任务记录。";
    els.historyList.innerHTML = `<div class="message"><div class="content">${escapeHtml(message)}</div></div>`;
    return;
  }
  els.historyList.innerHTML = tasks.map((task, index) => {
    const resultUrl = task.resultUrl || "";
    const errorMessage = task.errorMessage || "";
    const raw = JSON.stringify(task.resultRaw || task, null, 2);
    return `
      <article class="history-item">
        <header>
          <div>
            <strong>${escapeHtml(task.modelDisplayName || task.modelId || "未命名模型")}</strong>
            <small>${escapeHtml(task.provider || "")} · ${escapeHtml(task.taskType || "")} · ${escapeHtml(formatTaskStatus(task.status))} · 消耗 ${escapeHtml(task.cost ?? 0)} 积分</small>
          </div>
          <small>${escapeHtml(formatTaskTime(task.createdAt))}</small>
        </header>
        <pre>${escapeHtml(task.prompt || "")}</pre>
        ${resultUrl ? `<p><a href="${escapeHtml(resultUrl)}" target="_blank" rel="noreferrer">${escapeHtml(resultUrl)}</a></p>` : ""}
        ${task.status === "failed" && task.cost > 0 ? `<p class="cost-hint">${escapeHtml(errorMessage.includes("退款") || errorMessage.toLowerCase().includes("refund") ? "失败后已自动退款。" : "失败任务如已扣费会自动退款。")}</p>` : ""}
        ${errorMessage ? `<pre>${escapeHtml(errorMessage)}</pre>` : ""}
        <div class="button-row" style="margin-top:10px">
          <button class="secondary" data-load-task="${index}">载入任务</button>
          <button class="secondary" data-copy-task="${index}">复制数据</button>
        </div>
        <small>${escapeHtml(task.id || "")}</small>
      </article>
    `;
  }).join("");
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
  toast("已复制");
}

function downloadText(filename, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function testCall() {
  try {
    const result = await callRelay([{ role: "user", content: "请只回复：连接成功" }], { max_tokens: 32 });
    toast(result.content || "连接成功");
  } catch (error) {
    toast(error.message);
  }
}

function switchTab(tabName) {
  $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${tabName}View`).classList.add("active");
}

function bindEvents() {
  $("#refreshProviders").addEventListener("click", () => fetchProviders().then(() => toast("已刷新")).catch((error) => toast(error.message)));
  els.usePowerShellApi.addEventListener("click", () => switchApiBaseUrl(POWERSHELL_API_BASE_URL));
  els.useNodeApi.addEventListener("click", () => switchApiBaseUrl(NODE_API_BASE_URL));
  els.loginForm.addEventListener("submit", handleLogin);
  els.registerForm.addEventListener("submit", handleRegister);
  els.logoutButton.addEventListener("click", handleLogout);
  els.refreshBalance.addEventListener("click", () => refreshBalance().then(() => toast("余额已刷新")).catch((error) => toast(error.message)));
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#testCall").addEventListener("click", testCall);
  $("#copyEndpoint").addEventListener("click", () => copyText(els.relayEndpoint.textContent));
  $("#clearAll").addEventListener("click", () => {
    state.chat = [];
    state.assignmentMessages = [];
    els.assignmentOutput.textContent = "";
    renderChat();
  });

  els.providerSelect.addEventListener("change", () => syncProviderDefaults(true));
  els.modelPresetSelect.addEventListener("change", () => {
    els.modelInput.value = els.modelPresetSelect.value;
    updateActiveModel();
  });
  [els.baseUrlInput, els.modelInput, els.temperatureInput, els.maxTokensInput].forEach((input) => {
    input.addEventListener("input", updateActiveModel);
  });
  els.videoProviderSelect.addEventListener("change", () => syncVideoProviderDefaults(true));
  els.videoModelPresetSelect.addEventListener("change", () => {
    els.videoModelInput.value = els.videoModelPresetSelect.value;
    renderVideoModels(true);
    readVideoSettingsFromInputs();
    updateVideoCostHint();
  });
  els.videoModelInput.addEventListener("input", updateVideoCostHint);

  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  $$(".mode").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  els.chatForm.addEventListener("submit", handleChatSubmit);
  els.assignmentForm.addEventListener("submit", handleAssignmentSubmit);
  els.followupForm.addEventListener("submit", handleFollowup);
  $("#videoForm").addEventListener("submit", submitVideoTask);
  $("#saveVideoSettings").addEventListener("click", saveVideoSettings);
  $("#refreshVideoTask").addEventListener("click", refreshVideoTask);
  $("#copyVideoResult").addEventListener("click", () => copyText(els.videoOutput.textContent || ""));
  $("#refreshRecharge").addEventListener("click", () => refreshRechargeData().then(() => toast("充值数据已刷新")).catch((error) => toast(error.message)));
  $("#refreshAdmin").addEventListener("click", () => refreshAdminData().then(() => toast("后台数据已刷新")).catch((error) => toast(error.message)));
  $("#saveDraft").addEventListener("click", saveDraft);
  $("#copyAnswer").addEventListener("click", () => copyText(els.assignmentOutput.textContent || ""));
  $("#downloadAnswer").addEventListener("click", () => downloadText("assignment-output.md", els.assignmentOutput.textContent || "", "text/markdown"));
  $("#refreshTasks").addEventListener("click", () => fetchGenerationTasks().then(() => toast("任务已刷新")).catch((error) => toast(error.message)));
  $("#exportHistory").addEventListener("click", () => downloadText("generation-tasks.json", JSON.stringify(state.generationTasks, null, 2), "application/json"));

  els.rechargePackages.addEventListener("click", (event) => {
    const packageId = event.target.dataset.createOrder;
    if (packageId) {
      createOrder(packageId).catch((error) => toast(error.message));
    }
  });

  els.orderList.addEventListener("click", (event) => {
    const orderIndex = event.target.dataset.mockPay;
    if (orderIndex !== undefined) {
      mockPayOrder(orderIndex).catch((error) => toast(error.message));
    }
  });

  els.adminUsers.addEventListener("click", (event) => {
    const detailIndex = event.target.dataset.adminDetail;
    const adjustIndex = event.target.dataset.adminAdjust;
    const disableIndex = event.target.dataset.adminDisable;
    const enableIndex = event.target.dataset.adminEnable;
    if (detailIndex !== undefined) {
      loadAdminUserDetail(detailIndex).catch((error) => toast(error.message));
    }
    if (adjustIndex !== undefined) {
      adjustAdminUserBalance(adjustIndex).catch((error) => toast(error.message));
    }
    if (disableIndex !== undefined) {
      setAdminUserStatus(disableIndex, "disabled").catch((error) => toast(error.message));
    }
    if (enableIndex !== undefined) {
      setAdminUserStatus(enableIndex, "active").catch((error) => toast(error.message));
    }
  });

  els.adminModels.addEventListener("click", (event) => {
    const nameIndex = event.target.dataset.adminModelName;
    const priceIndex = event.target.dataset.adminModelPrice;
    const sortIndex = event.target.dataset.adminModelSort;
    const toggleIndex = event.target.dataset.adminModelToggle;
    if (nameIndex !== undefined) {
      editAdminModelName(nameIndex).catch((error) => toast(error.message));
    }
    if (priceIndex !== undefined) {
      editAdminModelPrice(priceIndex).catch((error) => toast(error.message));
    }
    if (sortIndex !== undefined) {
      editAdminModelSort(sortIndex).catch((error) => toast(error.message));
    }
    if (toggleIndex !== undefined) {
      toggleAdminModel(toggleIndex).catch((error) => toast(error.message));
    }
  });

  if (els.adminProviders) {
    els.adminProviders.addEventListener("click", (event) => {
      const nameIndex = event.target.dataset.adminProviderName;
      const baseIndex = event.target.dataset.adminProviderBase;
      const envIndex = event.target.dataset.adminProviderEnv;
      const toggleIndex = event.target.dataset.adminProviderToggle;
      if (nameIndex !== undefined) {
        editAdminProviderName(nameIndex).catch((error) => toast(error.message));
      }
      if (baseIndex !== undefined) {
        editAdminProviderBaseUrl(baseIndex).catch((error) => toast(error.message));
      }
      if (envIndex !== undefined) {
        editAdminProviderEnv(envIndex).catch((error) => toast(error.message));
      }
      if (toggleIndex !== undefined) {
        toggleAdminProvider(toggleIndex).catch((error) => toast(error.message));
      }
    });
  }

  els.historyList.addEventListener("click", (event) => {
    const loadIndex = event.target.dataset.loadHistory;
    const copyIndex = event.target.dataset.copyHistory;
    const loadTaskIndex = event.target.dataset.loadTask;
    const copyTaskIndex = event.target.dataset.copyTask;
    if (loadIndex !== undefined) {
      const item = state.history[Number(loadIndex)];
      if (!item) return;
      els.assignmentOutput.textContent = item.answer || "";
      switchTab("homework");
    }
    if (copyIndex !== undefined) {
      const item = state.history[Number(copyIndex)];
      if (item) copyText(item.answer || "");
    }
    if (loadTaskIndex !== undefined) {
      const task = state.generationTasks[Number(loadTaskIndex)];
      if (!task) return;
      els.videoTaskIdInput.value = task.id || "";
      state.videoSettings.taskId = task.id || "";
      els.videoOutput.textContent = JSON.stringify(task, null, 2);
      switchTab("video");
    }
    if (copyTaskIndex !== undefined) {
      const task = state.generationTasks[Number(copyTaskIndex)];
      if (task) copyText(JSON.stringify(task, null, 2));
    }
  });
}

async function init() {
  loadLocalState();
  bindEvents();
  updateApiModeDisplay();
  renderAuth();
  renderChat();
  renderHistory();
  renderRechargePackages();
  renderOrders();
  renderAdmin();
  try {
    await refreshApiData();
  } catch (error) {
    toast(error.message);
  }
}

init();
