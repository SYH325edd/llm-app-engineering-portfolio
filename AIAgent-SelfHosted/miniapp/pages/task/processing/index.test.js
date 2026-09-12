const assert = require('node:assert/strict');
const test = require('node:test');

function loadProcessingPage(call) {
  const pagePath = require.resolve('./index');
  const cloudPath = require.resolve('../../../services/cloud');
  const originalCloud = require.cache[cloudPath];
  const originalPage = global.Page;
  let definition;
  require.cache[cloudPath] = { id: cloudPath, filename: cloudPath, loaded: true, exports: {
    call,
    getTaskStatus: async (taskId, timeoutMs) => {
      const response = await call('getTaskStatus', { taskId }, timeoutMs);
      return response?.task || response;
    }
  } };
  global.Page = (value) => { definition = value; };
  delete require.cache[pagePath];
  try { require('./index'); } finally {
    delete require.cache[pagePath];
    global.Page = originalPage;
    if (originalCloud) require.cache[cloudPath] = originalCloud; else delete require.cache[cloudPath];
  }
  return definition;
}

function createInstance(page) {
  return Object.assign({}, page, {
    data: { ...structuredClone(page.data), taskId: 'task-1', task: { status: 'PROCESSING' } },
    setData(update) { Object.assign(this.data, update); },
  });
}

function withFakeTimers(run) {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = new Map();
  let nextTimerId = 1;
  global.setTimeout = (callback, delay) => {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  };
  global.clearTimeout = (id) => timers.delete(id);
  return Promise.resolve()
    .then(() => run(timers))
    .finally(() => {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    });
}

test('processing page does not use a response from before hide after it is shown again', async () => {
  let resolveFirst;
  const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
  let calls = 0;
  const page = loadProcessingPage(async () => {
    calls += 1;
    return calls === 1 ? firstResponse : { task: { taskId: 'task-1', status: 'FAILED' } };
  });
  const instance = createInstance(page);
  const originalWx = global.wx;
  global.wx = { redirectTo() {}, showToast() {}, showModal() {}, switchTab() {} };
  try {
    instance.active = true;
    const polling = instance.poll.call(instance);
    instance.onHide.call(instance);
    instance.onShow.call(instance);
    resolveFirst({ task: { taskId: 'task-1', status: 'COMPLETED', resultId: 'result-1' } });
    await polling;

    assert.equal(instance.data.redirecting, false);
  } finally {
    global.wx = originalWx;
  }
});

test('processing page clears its timer on hide and unload before another getTask call', async () => {
  let calls = 0;
  const page = loadProcessingPage(async () => { calls += 1; return { task: { status: 'PROCESSING' } }; });
  const instance = createInstance(page);
  await withFakeTimers(async (timers) => {
    instance.active = true;
    instance.schedule.call(instance, 6000);
    const scheduled = [...timers.values()][0];
    instance.onHide.call(instance);
    await scheduled.callback();
    assert.equal(calls, 0);

    instance.active = true;
    instance.schedule.call(instance, 6000);
    const rescheduled = [...timers.values()][0];
    instance.onUnload.call(instance);
    await rescheduled.callback();
    assert.equal(calls, 0);
  });
});

test('processing page stops task polling for completed, failed, and cancelled tasks', async () => {
  const originalWx = global.wx;
  global.wx = { redirectTo() {}, showToast() {}, showModal() {}, switchTab() {} };
  try {
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED']) {
      const page = loadProcessingPage(async () => ({ task: { taskId: 'task-1', status, resultId: status === 'COMPLETED' ? 'result-1' : '' } }));
      const instance = createInstance(page);
      instance.active = true;
      await instance.poll.call(instance);
      assert.equal(instance.data.timer, null, status);
      assert.equal(instance.data.polling, false, status);
      instance.onShow.call(instance);
      assert.equal(instance.data.timer, null, status);
    }
  } finally {
    global.wx = originalWx;
  }
});

test('processing page resumes one six-second task timer only while processing', async () => {
  const page = loadProcessingPage(async () => ({ task: { taskId: 'task-1', status: 'PROCESSING' } }));
  const instance = createInstance(page);
  await withFakeTimers(async (timers) => {
    instance.active = true;
    await instance.poll.call(instance);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, 6000);

    instance.onShow.call(instance);
    instance.onShow.call(instance);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(timers.size, 1);
  });
});

test('processing polling uses getTaskStatus and reads the full task once after completion', async () => {
  const actions = [];
  const page = loadProcessingPage(async (action) => {
    actions.push(action);
    if (action === 'getTaskStatus') return { taskId: 'task-1', status: 'COMPLETED', resultId: 'result-1' };
    return { task: { taskId: 'task-1', status: 'COMPLETED', resultId: 'result-1' } };
  });
  const instance = createInstance(page);
  const originalWx = global.wx;
  global.wx = { redirectTo() {}, showToast() {}, showModal() {}, switchTab() {} };
  try {
    instance.active = true;
    await instance.poll.call(instance);
    assert.deepEqual(actions, ['getTaskStatus', 'getTask']);
  } finally {
    global.wx = originalWx;
  }
});

test('teacher failed-task view reads authorized images through getTask and preserves failure information', async () => {
  const actions = [];
  const page = loadProcessingPage(async (action, payload) => {
    actions.push({ action, payload });
    if (action === 'getTaskStatus') return { taskId: 'task-1', status: 'FAILED', errorMessage: 'worker failed' };
    return { task: { taskId: 'task-1', status: 'FAILED', errorMessage: 'worker failed', failureId: 'failure-1', homeworkImages: [{ fileId: 'h1', tempUrl: 'https://image/h1', index: 1 }, { fileId: 'h2', tempUrl: '', loadFailed: true, index: 2 }], answerImages: [{ fileId: 'a1', tempUrl: 'https://image/a1', index: 1 }] } };
  });
  const instance = createInstance(page);
  instance.data.viewerMode = 'teacher';
  instance.data.targetStudentId = 'student-1';
  const originalWx = global.wx;
  global.wx = { redirectTo() {}, showToast() {}, showModal() {}, switchTab() {} };
  try {
    instance.active = true;
    await instance.poll.call(instance);
    assert.deepEqual(actions.map(({ action }) => action), ['getTaskStatus', 'getTask']);
    assert.deepEqual(actions[1].payload, { taskId: 'task-1', viewerMode: 'teacher', targetStudentId: 'student-1' });
    assert.equal(instance.data.errorMessage, 'worker failed');
    assert.equal(instance.data.failureId, 'failure-1');
    assert.equal(instance.data.homeworkImages.length, 2);
    assert.equal(instance.data.answerImages.length, 1);
    assert.equal(instance.data.homeworkImages[1].loadFailed, true);
  } finally {
    global.wx = originalWx;
  }
});

test('failed-task image preview skips unavailable images and marks a failed image load', () => {
  const page = loadProcessingPage(async () => ({ taskId: 'task-1', status: 'FAILED' }));
  const instance = createInstance(page);
  instance.data.homeworkImages = [{ tempUrl: 'https://image/h1' }, { tempUrl: '', loadFailed: true }, { tempUrl: 'https://image/h3' }];
  const previews = [];
  const originalWx = global.wx;
  global.wx = { previewImage(value) { previews.push(value); } };
  try {
    instance.previewImage.call(instance, { currentTarget: { dataset: { type: 'homework', url: 'https://image/h3' } } });
    assert.deepEqual(previews, [{ current: 'https://image/h3', urls: ['https://image/h1', 'https://image/h3'] }]);
    instance.onImageError.call(instance, { currentTarget: { dataset: { type: 'homework', index: 0 } } });
    assert.equal(instance.data['homeworkImages[0].loadFailed'], true);
  } finally {
    global.wx = originalWx;
  }
});
