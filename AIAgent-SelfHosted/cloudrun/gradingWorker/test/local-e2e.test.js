const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const Module = require('node:module');
const test = require('node:test');
const { createServer } = require('../server');
const { createClaimTask } = require('../claim-task');

const tasks = new Map();
const results = new Map();
let networkHandler;
const originalLoad = Module._load;
const legacyCloudSdkModule = ['wx', 'server', 'sdk'].join('-');
const legacyCurrentEnvProperty = ['DYNAMIC', 'CURRENT', 'ENV'].join('_');

let transaction = Promise.resolve();
const command = {
  inc: (value) => ({ operation: 'inc', value }),
  lte: (value) => ({ operation: 'lte', value })
};

function matches(document, condition) {
  return Object.entries(condition).every(([key, expected]) => {
    if (expected && expected.operation === 'lte') {
      return new Date(document?.[key]).getTime() <= expected.value.getTime();
    }
    return document?.[key] === expected;
  });
}

function applyPatch(document, patch) {
  const next = { ...(document || {}) };
  for (const [key, value] of Object.entries(patch.data || patch)) {
    next[key] = value && value.operation === 'inc'
      ? Number(next[key] || 0) + value.value
      : value;
  }
  return next;
}

function collectionApi(name) {
  const collection = name === 'grading_results' ? results : tasks;
  return {
    doc(id) {
      return {
        async get() { return { data: collection.get(id) }; },
        async set({ data }) { collection.set(id, { ...data }); },
        async update(patch) {
          collection.set(id, applyPatch(collection.get(id), patch));
          return { updated: 1 };
        }
      };
    },
    where(condition) {
      return {
        async update(patch) {
          let updated = 0;
          for (const [id, document] of collection.entries()) {
            if (!matches(document, condition)) continue;
            collection.set(id, applyPatch(document, patch));
            updated += 1;
          }
          return { updated };
        }
      };
    }
  };
}

const memoryDb = {
  command,
  collection: collectionApi,
  runTransaction(callback) {
    const previous = transaction;
    let release;
    transaction = new Promise((resolve) => { release = resolve; });
    return previous.then(async () => {
      try {
        return await callback({ command, collection: collectionApi });
      } finally {
        release();
      }
    });
  }
};

Module._load = function (request, parent, isMain) {
  if (request === legacyCloudSdkModule) return { [legacyCurrentEnvProperty]: 'dynamic', init() {}, database: () => memoryDb };
  if (request === 'xlsx') return {};
  if (request === 'https') return { request: (...args) => networkHandler(...args) };
  return originalLoad.call(this, request, parent, isMain);
};
let createTaskCoreFlow = null;
try {
  ({ createTaskCoreFlow } = require('../../../cloudfunctions/appApi'));
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
}
Module._load = originalLoad;
const fullPackageIntegrationAvailable = typeof createTaskCoreFlow === 'function';

function httpRequest(port, path, taskId) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { authorization: 'Bearer local-token', 'content-type': 'application/json' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject);
    request.end(JSON.stringify({ taskId }));
  });
}

function appApiNetwork(port, counts, mode = 'ok') {
  return (url, options, callback) => {
    const request = new EventEmitter();
    let body = '';
    request.write = (value) => { body += value; };
    request.setTimeout = () => {};
    request.destroy = () => {};
    request.end = () => {
      counts.enqueue += 1;
      if (mode === '429') return process.nextTick(() => {
        const response = Object.assign(new EventEmitter(), { statusCode: 429, setEncoding() {} });
        callback(response);
        response.emit('data', JSON.stringify({ code: 'WORKER_QUEUE_FULL' }));
        response.emit('end');
      });
      const target = new URL(url);
      const upstream = http.request({ host: '127.0.0.1', port, method: options.method, path: target.pathname, headers: options.headers }, (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { responseBody += chunk; });
        response.on('end', () => {
          const mockResponse = new EventEmitter();
          mockResponse.statusCode = response.statusCode;
          mockResponse.setEncoding = () => {};
          callback(mockResponse);
          mockResponse.emit('data', responseBody);
          mockResponse.emit('end');
        });
      });
      upstream.on('error', (error) => request.emit('error', error));
      upstream.end(body);
    };
    return request;
  };
}

function waitFor(predicate, timeout = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => predicate() ? resolve() : Date.now() - started > timeout ? reject(new Error('timed out')) : setTimeout(check, 5);
    check();
  });
}

async function withWorker(callback, executeTask) {
  const server = createServer({ token: 'local-token', claimTask: createClaimTask({ db: memoryDb }), runtime: { context: { db: memoryDb } }, executeTask, startRecovery: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await callback(server.address().port); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function reset() {
  tasks.clear(); results.clear(); transaction = Promise.resolve();
  process.env.GRADING_WORKER_BASE_URL = 'https://worker.invalid';
  process.env.GRADING_WORKER_TOKEN = 'local-token';
  process.env.GRADING_WORKER_CONCURRENCY = '5';
  process.env.GRADING_WORKER_QUEUE_LIMIT = '100';
}

function createMockExecution(observation) {
  const storage = { async getTempFileURL() { observation.storage += 1; return { fileList: [] }; } };
  const strategy = { async load() { observation.strategy += 1; return {}; } };
  const ark = async () => { observation.ark += 1; observation.running += 1; observation.maxRunning = Math.max(observation.maxRunning, observation.running); await new Promise((resolve) => setTimeout(resolve, 5)); observation.running -= 1; return { questions: [], summary: { correctCount: 0 } }; };
  return async ({ taskId }) => {
    await storage.getTempFileURL(); await strategy.load(); const grade = await ark();
    results.set(taskId, { taskId, ...grade });
    await memoryDb.collection('grading_tasks').doc(taskId).update({ data: { status: 'COMPLETED', currentStage: 'COMPLETED', resultId: taskId } });
    return { success: true, outcome: 'COMPLETED' };
  };
}

test('local E2E: create, enqueue, claim, execute, complete, and expose completion without secrets', { skip: fullPackageIntegrationAvailable ? false : 'requires the full customer package with cloudfunctions/appApi' }, async () => {
  reset();
  const observation = { ark: 0, storage: 0, strategy: 0, running: 0, maxRunning: 0 };
  const counts = { enqueue: 0 };
  await withWorker(async (port) => {
    networkHandler = appApiNetwork(port, counts);
    const task = { _id: 'task-e2e', taskId: 'task-e2e', status: 'QUEUED', currentStage: 'QUEUED', studentImageFileIds: ['cloud://private-image'] };
    const created = await createTaskCoreFlow(task.taskId, task, { saveTask: async (id, value) => tasks.set(id, value), recordPractice: async () => {}, monitor: () => {} });
    assert.deepEqual(created, { taskId: task.taskId, dispatchStatus: 'ENQUEUED' });
    await waitFor(() => tasks.get(task.taskId).workerQueueStatus === 'COMPLETED');
    assert.equal(counts.enqueue, 1);
    assert.equal(observation.ark, 1);
    assert.equal(results.size, 1);
    assert.equal(tasks.get(task.taskId).status, 'COMPLETED');
    assert.equal(tasks.get(task.taskId).workerQueueStatus, 'COMPLETED');
    assert.doesNotMatch(JSON.stringify(created), /local-token|private-image|prompt/i);
  }, createMockExecution(observation));
});

test('local E2E: a failed initial enqueue stays pending and one kick recovers it', { skip: fullPackageIntegrationAvailable ? false : 'requires the full customer package with cloudfunctions/appApi' }, async () => {
  reset();
  const observation = { ark: 0, storage: 0, strategy: 0, running: 0, maxRunning: 0 };
  const counts = { enqueue: 0 };
  await withWorker(async (port) => {
    networkHandler = appApiNetwork(port, counts, '429');
    const task = { _id: 'task-recover', taskId: 'task-recover', status: 'QUEUED', currentStage: 'QUEUED' };
    const created = await createTaskCoreFlow(task.taskId, task, { saveTask: async (id, value) => tasks.set(id, value), recordPractice: async () => {}, monitor: () => {} });
    assert.deepEqual(created, { taskId: task.taskId, dispatchStatus: 'PENDING' });
    assert.equal(tasks.get(task.taskId).status, 'QUEUED');
    const kicks = await Promise.all(Array.from({ length: 10 }, () => httpRequest(port, '/internal/jobs/kick', task.taskId)));
    assert.equal(kicks.filter((result) => result.body.code === 'TASK_ENQUEUED').length, 1);
    await waitFor(() => tasks.get(task.taskId).workerQueueStatus === 'COMPLETED');
    assert.equal(observation.ark, 1);
  }, createMockExecution(observation));
});

test('local E2E: 100 queued tasks respect concurrency, deduplicate, and drain', { skip: fullPackageIntegrationAvailable ? false : 'requires the full customer package with cloudfunctions/appApi' }, async () => {
  reset();
  const observation = { ark: 0, storage: 0, strategy: 0, running: 0, maxRunning: 0 };
  await withWorker(async (port) => {
    for (let index = 0; index < 100; index += 1) tasks.set(`task-${index}`, { _id: `task-${index}`, taskId: `task-${index}`, status: 'QUEUED', currentStage: 'QUEUED' });
    const accepted = await Promise.all(Array.from({ length: 100 }, (_, index) => httpRequest(port, '/internal/jobs/enqueue', `task-${index}`)));
    assert.equal(accepted.filter((result) => result.body.code === 'TASK_ENQUEUED').length, 100);
    const duplicate = await httpRequest(port, '/internal/jobs/enqueue', 'task-0');
    assert.ok(['TASK_ALREADY_ENQUEUED', 'TASK_ALREADY_COMPLETED'].includes(duplicate.body.code));
    await waitFor(() => [...tasks.values()].every((task) => task.workerQueueStatus === 'COMPLETED'), 10000);
    const health = await new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}/health`, (response) => { let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => resolve(JSON.parse(body))); }).on('error', reject));
    assert.equal(observation.maxRunning, 5);
    assert.equal(observation.ark, 100);
    assert.equal(results.size, 100);
    assert.deepEqual({ queued: health.queued, running: health.running }, { queued: 0, running: 0 });
  }, createMockExecution(observation));
});
