const assert = require('node:assert/strict');
const test = require('node:test');

function loadUploadPage({ uploadTaskImages, call, resultHidden = false }) {
  const pagePath = require.resolve('./index');
  const uploadPath = require.resolve('../../../services/upload');
  const cloudPath = require.resolve('../../../services/cloud');
  const visibilityPath = require.resolve('../../../utils/student-result-visibility');
  const originals = new Map([
    [uploadPath, require.cache[uploadPath]],
    [cloudPath, require.cache[cloudPath]],
    [visibilityPath, require.cache[visibilityPath]],
  ]);
  const originalPage = global.Page;
  let definition;
  require.cache[uploadPath] = { id: uploadPath, filename: uploadPath, loaded: true, exports: { uploadTaskImages } };
  require.cache[cloudPath] = { id: cloudPath, filename: cloudPath, loaded: true, exports: { call } };
  require.cache[visibilityPath] = { id: visibilityPath, filename: visibilityPath, loaded: true, exports: {
    resolveCurrentStudentResultHidden: async () => resultHidden,
    uploadedNoticeUrl: () => '/pages/result/notice/index',
  } };
  global.Page = (value) => { definition = value; };
  delete require.cache[pagePath];
  try { require('./index'); } finally {
    delete require.cache[pagePath];
    global.Page = originalPage;
    for (const [path, original] of originals) {
      if (original) require.cache[path] = original; else delete require.cache[path];
    }
  }
  return definition;
}

function createInstance(page) {
  return Object.assign({}, page, {
    data: { ...structuredClone(page.data), studentImages: ['student-1', 'student-2', 'student-3'], answerImages: ['answer-1'], manualAnswer: '42', title: '作业', mode: 'HARD_PROBLEM_CHECK' },
    setData(update) { Object.assign(this.data, update); },
  });
}

function withWx(run) {
  const originalWx = global.wx;
  const storage = new Map();
  const redirects = [];
  const modals = [];
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, structuredClone(value)); },
    removeStorageSync(key) { storage.delete(key); },
    redirectTo(value) { redirects.push(value); },
    showToast() {},
    showModal(value) { modals.push(value); },
  };
  return Promise.resolve().then(() => run({ storage, redirects, modals })).finally(() => { global.wx = originalWx; });
}

test('upload submit creates one task and opens processing without rules', async () => {
  let createCalls = 0;
  const page = loadUploadPage({
    uploadTaskImages: async () => ({ homeworkImageFileIds: ['h1', 'h2', 'h3'], answerImageFileIds: ['a1'] }),
    call: async (action) => { assert.equal(action, 'createTask'); createCalls += 1; return { taskId: 'task-created' }; },
  });
  await withWx(async ({ redirects }) => {
    const instance = createInstance(page);
    await instance.submit.call(instance);
    assert.equal(createCalls, 1);
    assert.deepEqual(redirects, [{ url: '/pages/task/processing/index?taskId=task-created' }]);
  });
});

test('upload submit ignores rapid repeated taps while a task is being created', async () => {
  let releaseCreate;
  let createCalls = 0;
  const page = loadUploadPage({
    uploadTaskImages: async () => ({ homeworkImageFileIds: ['h1'], answerImageFileIds: [] }),
    call: async () => { createCalls += 1; return new Promise((resolve) => { releaseCreate = () => resolve({ taskId: 'task-created' }); }); },
  });
  await withWx(async () => {
    const instance = createInstance(page);
    const first = instance.submit.call(instance);
    const second = instance.submit.call(instance);
    await Promise.resolve();
    assert.equal(createCalls, 1);
    releaseCreate();
    await Promise.all([first, second]);
  });
});

test('upload submit keeps selected images and skips createTask when image upload fails', async () => {
  let createCalls = 0;
  const page = loadUploadPage({
    uploadTaskImages: async () => { throw new Error('second image failed'); },
    call: async () => { createCalls += 1; },
  });
  await withWx(async ({ modals }) => {
    const instance = createInstance(page);
    await instance.submit.call(instance);
    assert.equal(createCalls, 0);
    assert.deepEqual(instance.data.studentImages, ['student-1', 'student-2', 'student-3']);
    assert.equal(instance.data.loading, false);
    assert.equal(modals[0].title, '启动失败');
  });
});

test('upload submit keeps selected images when createTask fails', async () => {
  const page = loadUploadPage({
    uploadTaskImages: async () => ({ homeworkImageFileIds: ['h1'], answerImageFileIds: [] }),
    call: async () => { throw new Error('create failed'); },
  });
  await withWx(async ({ redirects, modals }) => {
    const instance = createInstance(page);
    await instance.submit.call(instance);
    assert.deepEqual(instance.data.studentImages, ['student-1', 'student-2', 'student-3']);
    assert.equal(instance.data.loading, false);
    assert.equal(redirects.length, 0);
    assert.equal(modals[0].content, 'create failed');
  });
});
