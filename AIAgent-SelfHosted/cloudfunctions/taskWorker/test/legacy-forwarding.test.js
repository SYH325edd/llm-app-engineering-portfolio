'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const workerEntry = path.resolve(__dirname, '..', 'index.js');

function loadWorkerWithMocks(onRequest) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        init() {},
        DYNAMIC_CURRENT_ENV: 'dynamic',
        database() {
          return { command: {}, collection() { throw new Error('database should not be used by forwarding bridge'); } };
        },
        callFunction() { throw new Error('legacy taskWorker must not execute cloud functions'); }
      };
    }
    if (request === 'https') {
      return {
        request(url, options, callback) {
          const request = new EventEmitter();
          let body = '';
          request.setTimeout = () => {};
          request.write = (chunk) => { body += String(chunk); };
          request.end = () => {
            onRequest({ url: String(url), options, body });
            const response = new EventEmitter();
            response.statusCode = 202;
            response.setEncoding = () => {};
            callback(response);
            process.nextTick(() => {
              response.emit('data', JSON.stringify({ code: 'TASK_ENQUEUED' }));
              response.emit('end');
            });
          };
          request.destroy = () => request.emit('error', Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
          return request;
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[workerEntry];
  try {
    return require(workerEntry);
  } finally {
    Module._load = originalLoad;
  }
}

test('legacy taskWorker forwards taskId only to gradingWorker and does not execute grading locally', async () => {
  const previous = {
    baseUrl: process.env.GRADING_WORKER_BASE_URL,
    token: process.env.GRADING_WORKER_TOKEN
  };
  process.env.GRADING_WORKER_BASE_URL = 'https://grading-worker.example.com';
  process.env.GRADING_WORKER_TOKEN = 'test-token';
  let captured;
  try {
    const worker = loadWorkerWithMocks((value) => { captured = value; });
    const result = await worker.main({ taskId: 'task-forward-1', ignored: 'value' });
    assert.deepEqual(result, {
      success: true,
      code: 'TASK_ENQUEUED',
      taskId: 'task-forward-1',
      forwarded: true
    });
    assert.equal(captured.url, 'https://grading-worker.example.com/internal/jobs/enqueue');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers.Authorization, 'Bearer test-token');
    assert.equal(captured.body, JSON.stringify({ taskId: 'task-forward-1' }));
  } finally {
    if (previous.baseUrl === undefined) delete process.env.GRADING_WORKER_BASE_URL;
    else process.env.GRADING_WORKER_BASE_URL = previous.baseUrl;
    if (previous.token === undefined) delete process.env.GRADING_WORKER_TOKEN;
    else process.env.GRADING_WORKER_TOKEN = previous.token;
    delete require.cache[workerEntry];
  }
});

test('legacy taskWorker reports missing gradingWorker configuration without running local grading', async () => {
  const previous = {
    baseUrl: process.env.GRADING_WORKER_BASE_URL,
    token: process.env.GRADING_WORKER_TOKEN
  };
  delete process.env.GRADING_WORKER_BASE_URL;
  delete process.env.GRADING_WORKER_TOKEN;
  try {
    const worker = loadWorkerWithMocks(() => { throw new Error('request must not be made'); });
    assert.deepEqual(await worker.main({ taskId: 'task-forward-2' }), {
      success: false,
      code: 'GRADING_WORKER_CONFIG_MISSING',
      taskId: 'task-forward-2',
      forwarded: false
    });
  } finally {
    if (previous.baseUrl === undefined) delete process.env.GRADING_WORKER_BASE_URL;
    else process.env.GRADING_WORKER_BASE_URL = previous.baseUrl;
    if (previous.token === undefined) delete process.env.GRADING_WORKER_TOKEN;
    else process.env.GRADING_WORKER_TOKEN = previous.token;
    delete require.cache[workerEntry];
  }
});
