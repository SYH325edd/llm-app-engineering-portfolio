const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function loadSettingsPage(call) {
  const pagePath = require.resolve('./index');
  const cloudPath = require.resolve('../../services/cloud');
  const customerPath = require.resolve('../../config/customer');
  const originals = [require.cache[cloudPath], require.cache[customerPath]];
  const originalPage = global.Page;
  let definition;
  require.cache[cloudPath] = { id: cloudPath, filename: cloudPath, loaded: true, exports: { call } };
  require.cache[customerPath] = {
    id: customerPath,
    filename: customerPath,
    loaded: true,
    exports: {
      CUSTOMER_DISPLAY_CONFIG: {
        serviceName: '测试服务', operatorName: '测试主体', servicePhone: '10000', complaintPhone: '10000',
        agreementVersion: '1', privacyVersion: '1', filingNumber: ''
      },
      isComplaintPhoneConfigured: () => true
    }
  };
  global.Page = (value) => { definition = value; };
  delete require.cache[pagePath];
  try { require('./index'); } finally {
    delete require.cache[pagePath];
    global.Page = originalPage;
    if (originals[0]) require.cache[cloudPath] = originals[0]; else delete require.cache[cloudPath];
    if (originals[1]) require.cache[customerPath] = originals[1]; else delete require.cache[customerPath];
  }
  return definition;
}

function createInstance(page) {
  return Object.assign({}, page, {
    data: structuredClone(page.data),
    setData(update) { Object.assign(this.data, update); }
  });
}

test('only an active super administrator loads the hard-problem provider switch', async () => {
  const calls = [];
  const page = loadSettingsPage(async (action) => {
    calls.push(action);
    return {
      provider: 'qwen3_vl_plus', statusAvailable: true,
      providers: { ark_lite: { ready: true }, qwen3_vl_plus: { ready: true } }
    };
  });
  const instance = createInstance(page);
  const originalGetApp = global.getApp;
  try {
    global.getApp = () => ({ globalData: { user: { role: 'teacher', status: 'ACTIVE' } } });
    instance.onShow();
    assert.equal(instance.data.isSuperAdmin, false);
    assert.deepEqual(calls, []);

    global.getApp = () => ({ globalData: { user: { role: 'super_admin', status: 'ACTIVE' } } });
    instance.onShow();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(instance.data.isSuperAdmin, true);
    assert.equal(instance.data.hardProblemModelProvider, 'qwen3_vl_plus');
    assert.deepEqual(calls, ['getHardProblemModelProvider']);
  } finally { global.getApp = originalGetApp; }
});

test('switch confirmation states that only new hard-problem tasks change', async () => {
  const calls = [];
  const page = loadSettingsPage(async (action, data) => {
    calls.push([action, data]);
    return { provider: data.provider };
  });
  const instance = createInstance(page);
  instance.data.modelProviders = [
    { value: 'ark_lite', name: '豆包 Seed Lite', ready: true },
    { value: 'qwen3_vl_plus', name: '千问 Qwen3.7 Plus', ready: true, statusText: '已配置' }
  ];
  const originalWx = global.wx;
  let modalContent = '';
  global.wx = {
    showModal(options) { modalContent = options.content; options.success({ confirm: true }); },
    showToast() {}
  };
  try {
    instance.chooseHardProblemModelProvider({ currentTarget: { dataset: { provider: 'qwen3_vl_plus' } } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(modalContent, /仅影响之后新提交的难题训练任务/);
    assert.match(modalContent, /进行中的任务不会改变/);
    assert.deepEqual(calls, [['setHardProblemModelProvider', { provider: 'qwen3_vl_plus' }]]);
  } finally { global.wx = originalWx; }
});

test('settings copy keeps careless training and speech generation on the Doubao channel', () => {
  const wxml = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
  assert.match(wxml, /审题马虎、计算马虎和语音生成仍使用原豆包通道/);
  assert.match(wxml, /仅控制之后新提交的难题训练任务/);
});


test('settings distinguishes invalid Qwen model from worker status failure', async () => {
  const page = loadSettingsPage(async () => ({
    provider: 'ark_lite', statusAvailable: true,
    providerStatusContractVersion: 'hard-problem-provider-status.v2',
    runtimeBuildId: 'build-20260806-qwen-review-repair-diagnostics-v7.3',
    providers: { ark_lite: { ready: true }, qwen3_vl_plus: { ready: false, reason: 'invalid_model', model: 'qwen3-vl-plus' } }
  }));
  const instance = createInstance(page);
  const originalGetApp = global.getApp;
  try {
    global.getApp = () => ({ globalData: { user: { role: 'super_admin', status: 'ACTIVE' } } });
    instance.onShow();
    await new Promise((resolve) => setImmediate(resolve));
    const qwen = instance.data.modelProviders.find((item) => item.value === 'qwen3_vl_plus');
    assert.equal(qwen.ready, false);
    assert.equal(qwen.statusText, '模型名错误');
    assert.equal(instance.data.providerStatusAvailable, true);
    assert.match(instance.data.workerRuntimeBuildId, /v7\.3/);
    assert.equal(instance.data.providerStatusContractVersion, 'hard-problem-provider-status.v2');
  } finally { global.getApp = originalGetApp; }
});


test('settings reports an unsupported provider status contract as a worker version problem', async () => {
  const page = loadSettingsPage(async () => ({
    provider: 'ark_lite', statusAvailable: false, statusErrorCode: 'GRADING_WORKER_VERSION_UNSUPPORTED',
    providers: { ark_lite: { ready: false, reason: 'status_unavailable' }, qwen3_vl_plus: { ready: false, reason: 'status_unavailable' } }
  }));
  const instance = createInstance(page);
  const originalGetApp = global.getApp;
  try {
    global.getApp = () => ({ globalData: { user: { role: 'super_admin', status: 'ACTIVE' } } });
    instance.onShow();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(instance.data.providerStatusAvailable, false);
    assert.match(instance.data.providerStatusErrorText, /版本不支持千问状态检测/);
  } finally { global.getApp = originalGetApp; }
});
