const assert = require('node:assert/strict');
const test = require('node:test');

function loadPage(call) {
  const pagePath = require.resolve('./index');
  const mockPaths = ['../../../services/cloud', '../../../utils/page-refresh', '../../../utils/custom-tab-bar', '../../../config/features'].map(require.resolve);
  const originals = mockPaths.map((path) => require.cache[path]);
  const originalPage = global.Page;
  let definition;
  require.cache[mockPaths[0]] = { id: mockPaths[0], filename: mockPaths[0], loaded: true, exports: { call } };
  require.cache[mockPaths[1]] = { id: mockPaths[1], filename: mockPaths[1], loaded: true, exports: { createPageRefreshController: () => ({}) } };
  require.cache[mockPaths[2]] = { id: mockPaths[2], filename: mockPaths[2], loaded: true, exports: { syncCustomTabBar() {} } };
  require.cache[mockPaths[3]] = { id: mockPaths[3], filename: mockPaths[3], loaded: true, exports: { TEACHER_FEATURES: {} } };
  global.Page = (value) => { definition = value; };
  delete require.cache[pagePath];
  try { require('./index'); } finally { delete require.cache[pagePath]; global.Page = originalPage; mockPaths.forEach((path, index) => originals[index] ? require.cache[path] = originals[index] : delete require.cache[path]); }
  return definition;
}

test('review teacher switches to the fixed student view and closes to real-identity selection', async () => {
  const calls = [];
  const page = loadPage(async (action, data) => { calls.push([action, data]); return {}; });
  const urls = [];
  const originalWx = global.wx, originalGetApp = global.getApp;
  const globalData = { user: { role: 'teacher' }, authSnapshot: { role: 'teacher' } };
  global.getApp = () => ({ globalData });
  global.wx = { reLaunch({ url }) { urls.push(url); }, showToast() {} };
  try {
    await page.switchReviewRole();
    assert.equal(globalData.user, null);
    assert.equal(globalData.authSnapshot, null);
    globalData.user = { role: 'student' }; globalData.authSnapshot = { role: 'student' };
    await page.closeReviewSession();
    assert.equal(globalData.user, null);
    assert.equal(globalData.authSnapshot, null);
    assert.deepEqual(calls, [['reviewSession', { operation: 'switch', role: 'student' }], ['reviewSession', { operation: 'close' }]]);
    assert.deepEqual(urls, ['/pages/home/index', '/pages/auth/role/index']);
  } finally { global.wx = originalWx; global.getApp = originalGetApp; }
});


test('super admin home exposes the system settings entry', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
  assert.match(wxml, /bindtap="settings"/);
  assert.match(wxml, />系统设置</);
});
