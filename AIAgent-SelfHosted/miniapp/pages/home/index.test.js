const assert = require('node:assert/strict');
const test = require('node:test');

function loadHomePage() {
  const pagePath = require.resolve('./index');
  const mockPaths = [
    '../../services/cloud',
    '../../utils/page-refresh',
    '../../utils/task-title',
    '../../utils/task-mode-label',
    '../../utils/custom-tab-bar'
  ].map(require.resolve);
  const originals = mockPaths.map((path) => require.cache[path]);
  const originalPage = global.Page;
  let definition;
  require.cache[mockPaths[0]] = { id: mockPaths[0], filename: mockPaths[0], loaded: true, exports: { call: async () => ({}) } };
  require.cache[mockPaths[1]] = { id: mockPaths[1], filename: mockPaths[1], loaded: true, exports: { createPageRefreshController: () => ({}) } };
  require.cache[mockPaths[2]] = { id: mockPaths[2], filename: mockPaths[2], loaded: true, exports: { withDecodedTaskTitle: (item) => item } };
  require.cache[mockPaths[3]] = { id: mockPaths[3], filename: mockPaths[3], loaded: true, exports: { withTaskModeLabel: (item) => item } };
  require.cache[mockPaths[4]] = { id: mockPaths[4], filename: mockPaths[4], loaded: true, exports: { syncCustomTabBar() {} } };
  global.Page = (value) => { definition = value; };
  delete require.cache[pagePath];
  try { require('./index'); } finally {
    delete require.cache[pagePath];
    global.Page = originalPage;
    mockPaths.forEach((path, index) => { if (originals[index]) require.cache[path] = originals[index]; else delete require.cache[path]; });
  }
  return definition;
}

function createInstance(page, role, task) {
  return Object.assign({}, page, {
    data: { ...structuredClone(page.data), user: { role }, isManager: role === 'teacher' || role === 'super_admin', recent: [task], activeTask: null },
    setData(update) { Object.assign(this.data, update); }
  });
}

function tapTask(taskId) {
  return { currentTarget: { dataset: { taskId } } };
}

test('teacher and super_admin home tasks carry viewer context to processing and result pages', () => {
  const page = loadHomePage();
  const originalWx = global.wx;
  const urls = [];
  global.wx = { navigateTo({ url }) { urls.push(url); }, showToast() {} };
  try {
    for (const role of ['teacher', 'super_admin']) {
      for (const [status, targetPage] of [['PROCESSING', 'task/processing'], ['COMPLETED', 'result/detail']]) {
        const task = { taskId: `task-${role}-${status}`, studentId: `student ${role}`, status };
        createInstance(page, role, task).open(tapTask(task.taskId));
        assert.equal(urls.pop(), `/pages/${targetPage}/index?taskId=${task.taskId}&viewerMode=teacher&targetStudentId=student%20${role}`);
      }
    }
  } finally {
    global.wx = originalWx;
  }
});

test('manager home blocks navigation and prompts when a task has no studentId', () => {
  const page = loadHomePage();
  const originalWx = global.wx;
  const urls = [];
  const toasts = [];
  global.wx = { navigateTo({ url }) { urls.push(url); }, showToast(options) { toasts.push(options); } };
  try {
    const task = { taskId: 'task-missing-student', status: 'PROCESSING' };
    createInstance(page, 'teacher', task).open(tapTask(task.taskId));
    assert.deepEqual(urls, []);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].title, '学生信息不完整，请刷新后重试');
  } finally {
    global.wx = originalWx;
  }
});

test('student home keeps its original task navigation without teacher viewer parameters', () => {
  const page = loadHomePage();
  const originalWx = global.wx;
  const urls = [];
  global.wx = { navigateTo({ url }) { urls.push(url); } };
  try {
    for (const [status, expectedUrl] of [
      ['COMPLETED', '/pages/result/detail/index?taskId=task-student-COMPLETED'],
      ['NEED_CONFIRMATION', '/pages/task/confirm/index?taskId=task-student-NEED_CONFIRMATION'],
      ['PROCESSING', '/pages/task/processing/index?taskId=task-student-PROCESSING']
    ]) {
      const task = { taskId: `task-student-${status}`, status };
      createInstance(page, 'student', task).open(tapTask(task.taskId));
      assert.equal(urls.pop(), expectedUrl);
    }
  } finally {
    global.wx = originalWx;
  }
});

test('review student switch and exit clear the existing auth snapshot before re-launch', async () => {
  const page = loadHomePage();
  const instance = createInstance(page, 'student', { taskId: 'task-1', status: 'PROCESSING' });
  const originalWx = global.wx, originalGetApp = global.getApp;
  const globalData = { user: { role: 'student' }, authSnapshot: { role: 'student' } };
  const urls = [];
  global.getApp = () => ({ globalData });
  global.wx = { reLaunch({ url }) { urls.push(url); }, showToast() {} };
  try {
    await instance.switchReviewRole();
    assert.equal(globalData.user, null);
    assert.equal(globalData.authSnapshot, null);
    globalData.user = { role: 'teacher' }; globalData.authSnapshot = { role: 'teacher' };
    await instance.closeReviewSession();
    assert.equal(globalData.user, null);
    assert.equal(globalData.authSnapshot, null);
    assert.deepEqual(urls, ['/pages/teacher/home/index', '/pages/auth/role/index']);
  } finally { global.wx = originalWx; global.getApp = originalGetApp; }
});
