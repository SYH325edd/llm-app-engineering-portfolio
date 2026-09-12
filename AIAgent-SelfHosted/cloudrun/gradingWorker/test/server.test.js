const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { createServer, normalizeError, providerReadiness, finishWorkerState, RUNTIME_BUILD_ID } = require('../server');
const { createClaimTask, isDocumentNotFoundError } = require('../claim-task');

function completedExecution(document) {
  return async ({ taskId }) => {
    Object.assign(document, {
      status: 'COMPLETED',
      currentStage: 'COMPLETED',
      resultId: document.resultId || taskId,
      completedAt: new Date()
    });
    return { success: true, outcome: 'COMPLETED' };
  };
}

function completedDbExecution(db, delayMs = 0) {
  return async ({ taskId }) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await db.collection('grading_tasks').doc(taskId).update({
      data: {
        status: 'COMPLETED',
        currentStage: 'COMPLETED',
        resultId: taskId,
        completedAt: new Date()
      }
    });
    return { success: true, outcome: 'COMPLETED' };
  };
}

async function withServer(token, callback, claimTask, runtime, executeTask) {
  const document = { status: 'QUEUED' };
  const reference = {
    get: async () => ({ data: document }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const testRuntime = runtime || { context: { db: {
    collection: () => ({ doc: () => reference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) })
  } } };
  const server = createServer({
    token,
    claimTask,
    runtime: testRuntime,
    executeTask: executeTask || completedExecution(document),
    startRecovery: false
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server.beginShutdown();
  }
}

function request(port, { method, path, headers, body, timeout = 0 }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (timeout) req.setTimeout(timeout, () => req.destroy(new Error('request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

test('GET /health returns the gradingWorker health response', async () => {
  await withServer('expected-token', async (port) => {
    const response = await request(port, { method: 'GET', path: '/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, service: 'gradingWorker', runtimeBuildId: RUNTIME_BUILD_ID, schedulerMode: 'database_polling_v1', queued: 0, running: 0, concurrency: 5, queueLimit: 100, draining: false, drainScheduled: false });
  });
});

test('GET /ready reports missing production configuration and succeeds when required values exist', async () => {
  const keys = ['CLOUDBASE_ENV_ID', 'ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_LITE_ENDPOINT', 'STRATEGY_REMOTE_REQUIRED', 'STRATEGY_SERVICE_URL', 'STRATEGY_CUSTOMER_ID', 'STRATEGY_LICENSE_ID', 'STRATEGY_LICENSE_KEY', 'STRATEGY_PUBLIC_KEY_BASE64'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    await withServer('expected-token', async (port) => {
      const missing = await request(port, { method: 'GET', path: '/ready' });
      assert.equal(missing.statusCode, 503);
      assert.equal(missing.body.code, 'REQUIRED_ENV_MISSING');
      assert.deepEqual(new Set(missing.body.missing), new Set(['CLOUDBASE_ENV_ID', 'ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_LITE_ENDPOINT']));
    });

    process.env.CLOUDBASE_ENV_ID = 'production-env';
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'mini-endpoint';
    process.env.ARK_LITE_ENDPOINT = 'lite-endpoint';

    process.env.STRATEGY_REMOTE_REQUIRED = 'true';
    await withServer('expected-token', async (port) => {
      const missingStrategy = await request(port, { method: 'GET', path: '/ready' });
      assert.equal(missingStrategy.statusCode, 503);
      assert.deepEqual(new Set(missingStrategy.body.missing), new Set(['STRATEGY_SERVICE_URL', 'STRATEGY_CUSTOMER_ID', 'STRATEGY_LICENSE_ID', 'STRATEGY_LICENSE_KEY', 'STRATEGY_PUBLIC_KEY_BASE64']));
    });
    process.env.STRATEGY_SERVICE_URL = 'https://strategy.example.com';
    process.env.STRATEGY_CUSTOMER_ID = 'customer';
    process.env.STRATEGY_LICENSE_ID = 'license';
    process.env.STRATEGY_LICENSE_KEY = 'a'.repeat(64);
    process.env.STRATEGY_PUBLIC_KEY_BASE64 = Buffer.from('public-key').toString('base64');
    await withServer('expected-token', async (port) => {
      const ready = await request(port, { method: 'GET', path: '/ready' });
      assert.equal(ready.statusCode, 200);
      assert.equal(ready.body.ok, true);
      assert.equal(ready.body.ready, true);
    });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});


test('provider readiness keeps Ark required and reports Qwen as independently optional', () => {
  const state = providerReadiness({
    ARK_API_KEY: 'ark-key',
    ARK_LITE_ENDPOINT: 'ark-lite',
    QWEN_API_KEY: 'qwen-key',
    QWEN_BASE_URL: 'https://workspace.example.com/compatible-mode/v1',
    QWEN_MODEL: 'qwen3.7-plus'
  });
  assert.equal(state.ark_lite.ready, true);
  assert.equal(state.qwen3_vl_plus.ready, true);
  assert.equal(state.qwen3_vl_plus.reason, null);
  assert.equal(state.qwen3_vl_plus.model, 'qwen3.7-plus');
  assert.equal(providerReadiness({ ARK_API_KEY: 'ark-key', ARK_LITE_ENDPOINT: 'ark-lite' }).qwen3_vl_plus.reason, 'missing_api_key');
  assert.equal(providerReadiness({ QWEN_API_KEY: 'qwen-key' }).qwen3_vl_plus.reason, 'missing_base_url');
  assert.equal(providerReadiness({ QWEN_API_KEY: 'qwen-key', QWEN_BASE_URL: 'http://workspace.example.com/compatible-mode/v1' }).qwen3_vl_plus.reason, 'invalid_base_url');
  assert.equal(providerReadiness({ QWEN_API_KEY: 'qwen-key', QWEN_BASE_URL: 'https://workspace.example.com/not-compatible', QWEN_MODEL: 'qwen3.7-plus' }).qwen3_vl_plus.reason, 'invalid_base_url');
  assert.equal(providerReadiness({ QWEN_API_KEY: 'qwen-key', QWEN_BASE_URL: 'https://workspace.example.com/compatible-mode/v1', QWEN_MODEL: 'qwen3-vl-plus' }).qwen3_vl_plus.reason, 'invalid_model');
  assert.equal(providerReadiness({ QWEN_API_KEY: 'qwen-key', QWEN_BASE_URL: 'https://workspace.example.com/compatible-mode/v1', QWEN_MODEL: 'qwen3.7-plus-2026-05-26' }).qwen3_vl_plus.ready, true);
  assert.equal(providerReadiness({ DASHSCOPE_API_KEY: 'official-name-key', QWEN_BASE_URL: 'https://workspace.example.com/compatible-mode/v1', QWEN_MODEL: 'qwen3.7-plus' }).qwen3_vl_plus.ready, true);
  assert.equal(providerReadiness({ QWEN_API_KEY: 'qwen-key', QWEN_BASE_URL: 'https://workspace.example.com/compatible-mode/v1', QWEN_MODEL: 'qwen3.7-plus-not-a-snapshot' }).qwen3_vl_plus.reason, 'invalid_model');
});

test('POST /internal/providers/status is token-protected and never returns model keys', async () => {
  const keys = ['ARK_API_KEY', 'ARK_LITE_ENDPOINT', 'QWEN_API_KEY', 'QWEN_BASE_URL', 'QWEN_MODEL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'ark-secret';
    process.env.ARK_LITE_ENDPOINT = 'ark-lite';
    process.env.QWEN_API_KEY = 'qwen-secret';
    process.env.QWEN_BASE_URL = 'https://workspace.example.com/compatible-mode/v1';
    process.env.QWEN_MODEL = 'qwen3.7-plus';
    await withServer('expected-token', async (port) => {
      const denied = await request(port, { method: 'POST', path: '/internal/providers/status', headers: { authorization: 'Bearer wrong-token' }, body: '{}' });
      assert.equal(denied.statusCode, 401);
      const allowed = await request(port, { method: 'POST', path: '/internal/providers/status', headers: { authorization: 'Bearer expected-token' }, body: '{}' });
      assert.equal(allowed.statusCode, 200);
      assert.equal(allowed.body.runtimeBuildId, RUNTIME_BUILD_ID);
      assert.equal(allowed.body.providerStatusContractVersion, 'hard-problem-provider-status.v2');
      assert.equal(allowed.body.providers.qwen3_vl_plus.ready, true);
      assert.equal(allowed.body.providers.qwen3_vl_plus.reason, null);
      assert.equal(allowed.body.providers.qwen3_vl_plus.model, 'qwen3.7-plus');
      assert.doesNotMatch(JSON.stringify(allowed.body), /ark-secret|qwen-secret|workspace\.example\.com/);
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});


test('entrypoint logs the database polling scheduler mode once', async () => {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: '0' } });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(output || 'startup marker timed out')), 3000);
    let settled = false;
    function done(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      error ? reject(error) : resolve();
    }
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('GRADING_WORKER_SCHEDULER_MODE=DATABASE_POLLING_V1')) done();
    });
    child.on('error', done);
    child.on('exit', () => { if (!output.includes('GRADING_WORKER_SCHEDULER_MODE=DATABASE_POLLING_V1')) done(new Error(output || 'server exited before startup marker')); });
  });
  assert.equal((output.match(/GRADING_WORKER_SCHEDULER_MODE=DATABASE_POLLING_V1/g) || []).length, 1);
});

test('startup recovery schedules persisted pending work with ordinary status queries', async () => {
  const document = { _id: 'recovered-task', status: 'QUEUED', workerQueueStatus: 'PENDING', workerAttempt: 0 };
  let executions = 0;
  const reference = { get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) };
  const db = {
    command: { in: () => 'recoverable-statuses' },
    collection: () => ({ doc: () => reference, where: () => ({ limit: () => ({ get: async () => ({ data: [document] }) }) }) }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) })
  };
  const server = createServer({
    token: 'expected-token', runtime: { context: { db } },
    claimTask: async () => {
      Object.assign(document, {
        workerQueueStatus: 'RUNNING',
        workerStatus: 'RUNNING',
        workerLeaseOwner: 'instance-a',
        workerAttempt: 1
      });
      return {
        workerLeaseOwner: 'instance-a',
        workerAttempt: 1,
        claimContext: { workerLeaseOwner: 'instance-a', workerAttempt: 1 },
        body: { code: 'TASK_CLAIMED' }
      };
    },
    executeTask: async ({ taskId }) => {
      executions += 1;
      Object.assign(document, { status: 'COMPLETED', currentStage: 'COMPLETED', resultId: taskId });
      return { success: true, outcome: 'COMPLETED' };
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.beginShutdown();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(executions, 1);
  assert.equal(document.workerQueueStatus, 'COMPLETED');
});

test('normalizes object-shaped errors without stringifying them into responses', () => {
  assert.deepEqual(normalizeError({ code: 'SDK_ERROR', message: { detail: 'unexpected' }, status: 500 }), {
    code: 'SDK_ERROR', message: 'GRADING_WORKER_INTERNAL_ERROR', status: 500, stack: undefined,
    causeCode: null, fieldPath: null, requestStage: null, modelProvider: null, modelName: null,
    providerRequestIdPresent: false, repairAttempted: false, repairAttemptCount: 0,
    repairFailureStage: null, failureId: null
  });
});

test('recognizes CloudBase document-not-found error variants without matching permission errors', () => {
  assert.equal(isDocumentNotFoundError({ code: 'DOCUMENT_NOT_FOUND' }), true);
  assert.equal(isDocumentNotFoundError({ errMsg: 'Document not found' }), true);
  assert.equal(isDocumentNotFoundError({ code: 'DB_PERMISSION_DENIED', errMsg: 'permission denied' }), false);
});

test('POST /internal/jobs/enqueue returns a sanitized JSON error when the SDK rejects with an object', async () => {
  const db = { runTransaction: async () => Promise.reject({ code: 'DB_PERMISSION_DENIED', errMsg: 'database access denied', status: 403 }) };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' },
      body: JSON.stringify({ taskId: 'task-sdk-error' }), timeout: 500
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      accepted: false,
      code: 'DB_PERMISSION_DENIED',
      message: 'database access denied'
    });
    assert.doesNotMatch(JSON.stringify(response.body), /#<Object>|\[object Object\]/);
  }, undefined, { context: { db } });
});

test('POST /internal/jobs/enqueue returns before its background execution completes', async () => {
  let release;
  const execution = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const document = { status: 'QUEUED', workerLeaseOwner: 'instance-a', workerAttempt: 0 };
  const runtime = { context: { db: {
    collection: () => ({ doc: () => ({ get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) }) }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => ({ get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) }) }) })
  } } };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' },
      body: JSON.stringify({ taskId: 'task-queued' })
    });
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.body, { accepted: true, code: 'TASK_ENQUEUED', taskId: 'task-queued' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
  }, async (taskId) => {
    Object.assign(document, {
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: 'instance-a',
      workerAttempt: 1
    });
    return {
      statusCode: 200,
      workerLeaseOwner: 'instance-a',
      workerAttempt: 1,
      claimContext: { workerLeaseOwner: 'instance-a', workerAttempt: 1 },
      body: { code: 'TASK_CLAIMED', taskId }
    };
  }, runtime, async ({ taskId }) => {
    calls += 1;
    await execution;
    Object.assign(document, { status: 'COMPLETED', currentStage: 'COMPLETED', resultId: taskId });
    return { success: true, outcome: 'COMPLETED' };
  });
});

test('dispatch uses a transaction and accepts the committed DISPATCHED state on readback', async () => {
  const document = { _id: 'task-dispatch-empty-result', status: 'QUEUED', workerQueueStatus: 'PENDING', workerAttempt: 0 };
  let dispatchTransactionUpdates = 0;
  const directReference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const transactionReference = {
    get: async () => ({ data: document }),
    update: async (patch) => {
      assert.equal(Object.hasOwn(patch, 'data'), true);
      if (patch.data.workerQueueStatus === 'DISPATCHED') dispatchTransactionUpdates += 1;
      Object.assign(document, patch.data);
      return {};
    }
  };
  const db = {
    collection: () => ({ doc: () => directReference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => transactionReference }) })
  };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/kick', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
    });
    assert.deepEqual(response.body, { accepted: true, code: 'TASK_ENQUEUED', taskId: document._id });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(dispatchTransactionUpdates, 1);
    assert.equal(document.workerQueueStatus, 'COMPLETED');
  }, async () => {
    Object.assign(document, {
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: 'instance-a',
      workerAttempt: 1
    });
    return {
      workerLeaseOwner: 'instance-a',
      workerAttempt: 1,
      claimContext: { workerLeaseOwner: 'instance-a', workerAttempt: 1 },
      body: { code: 'TASK_CLAIMED' }
    };
  }, { context: { db } }, completedExecution(document));
});

test('dispatch normalizes a missing legacy queue status before claim', async () => {
  const document = { _id: 'task-legacy-missing-queue', status: 'QUEUED', currentStage: 'PREPARING_IMAGES', workerAttempt: 0 };
  let transactionCount = 0;
  const directReference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const transactionReference = {
    get: async () => ({ data: document }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const db = {
    collection: () => ({ doc: () => directReference }),
    runTransaction: async (callback) => {
      transactionCount += 1;
      if (transactionCount === 2) {
        delete document.workerQueueStatus;
        delete document.workerStatus;
      }
      return callback({ collection: () => ({ doc: () => transactionReference }) });
    }
  };
  const originalInfo = console.info;
  const logs = [];
  console.info = (...args) => logs.push(args.join(' '));
  try {
    await withServer('expected-token', async (port) => {
      const response = await request(port, {
        method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
      });
      assert.deepEqual(response.body, { accepted: true, code: 'TASK_ENQUEUED', taskId: document._id });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(document.workerQueueStatus, 'COMPLETED');
      assert.match(logs.join('\n'), /TASK_DISPATCH_STATE_NORMALIZED/);
    }, async () => {
      Object.assign(document, {
        workerQueueStatus: 'RUNNING', workerStatus: 'RUNNING', workerLeaseOwner: 'instance-a', workerAttempt: 1
      });
      return {
        workerLeaseOwner: 'instance-a', workerAttempt: 1,
        claimContext: { workerLeaseOwner: 'instance-a', workerAttempt: 1 },
        body: { code: 'TASK_CLAIMED' }
      };
    }, { context: { db } }, completedExecution(document));
  } finally {
    console.info = originalInfo;
  }
});

test('dispatch unwraps a nested CloudBase transaction envelope before claim', async () => {
  const document = { _id: 'task-nested-transaction-snapshot', status: 'QUEUED', currentStage: 'PREPARING_IMAGES', workerQueueStatus: 'PENDING', workerStatus: 'PENDING', workerAttempt: 0 };
  const directReference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const transactionReference = {
    get: async () => ({ data: { data: [document], requestId: 'transaction-read' }, requestId: 'outer-read' }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const db = {
    collection: () => ({ doc: () => directReference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => transactionReference }) })
  };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
    });
    assert.deepEqual(response.body, { accepted: true, code: 'TASK_ENQUEUED', taskId: document._id });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(document.workerQueueStatus, 'COMPLETED');
  }, async () => {
    Object.assign(document, {
      workerQueueStatus: 'RUNNING', workerStatus: 'RUNNING', workerLeaseOwner: 'instance-a', workerAttempt: 1
    });
    return {
      workerLeaseOwner: 'instance-a', workerAttempt: 1,
      claimContext: { workerLeaseOwner: 'instance-a', workerAttempt: 1 },
      body: { code: 'TASK_CLAIMED' }
    };
  }, { context: { db } }, completedExecution(document));
});

test('dispatch retries a temporarily empty transaction snapshot before claim', async () => {
  const document = { _id: 'task-delayed-transaction-snapshot', status: 'QUEUED', currentStage: 'PREPARING_IMAGES', workerQueueStatus: 'PENDING', workerStatus: 'PENDING', workerAttempt: 0 };
  let transactionReads = 0;
  const directReference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const transactionReference = {
    get: async () => {
      transactionReads += 1;
      return transactionReads === 1
        ? { data: {}, requestId: 'not-visible-yet' }
        : { data: { data: [document], requestId: 'visible-now' } };
    },
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const db = {
    collection: () => ({ doc: () => directReference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => transactionReference }) })
  };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
    });
    assert.deepEqual(response.body, { accepted: true, code: 'TASK_ENQUEUED', taskId: document._id });
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.ok(transactionReads >= 2);
    assert.equal(document.workerQueueStatus, 'COMPLETED');
  }, async () => {
    Object.assign(document, {
      workerQueueStatus: 'RUNNING', workerStatus: 'RUNNING', workerLeaseOwner: 'instance-a', workerAttempt: 1
    });
    return {
      workerLeaseOwner: 'instance-a', workerAttempt: 1,
      claimContext: { workerLeaseOwner: 'instance-a', workerAttempt: 1 },
      body: { code: 'TASK_CLAIMED' }
    };
  }, { context: { db } }, completedExecution(document));
});

test('dispatch normalizes a legacy QUEUED queue status before claim', async () => {
  const document = { _id: 'task-legacy-queued-state', status: 'QUEUED', currentStage: 'PREPARING_IMAGES', workerAttempt: 0 };
  let transactionCount = 0;
  const directReference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const transactionReference = {
    get: async () => ({ data: document }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const db = {
    collection: () => ({ doc: () => directReference }),
    runTransaction: async (callback) => {
      transactionCount += 1;
      if (transactionCount === 2) {
        document.workerQueueStatus = 'QUEUED';
        document.workerStatus = 'QUEUED';
      }
      return callback({ collection: () => ({ doc: () => transactionReference }) });
    }
  };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
    });
    assert.deepEqual(response.body, { accepted: true, code: 'TASK_ENQUEUED', taskId: document._id });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(document.workerQueueStatus, 'COMPLETED');
  }, async () => {
    Object.assign(document, {
      workerQueueStatus: 'RUNNING', workerStatus: 'RUNNING', workerLeaseOwner: 'instance-a', workerAttempt: 1
    });
    return {
      workerLeaseOwner: 'instance-a', workerAttempt: 1,
      claimContext: { workerLeaseOwner: 'instance-a', workerAttempt: 1 },
      body: { code: 'TASK_CLAIMED' }
    };
  }, { context: { db } }, completedExecution(document));
});

test('waiting-user, failed, and cancelled tasks are never normalized into dispatchable work', async () => {
  for (const fixture of [
    { taskId: 'task-waiting-user', status: 'NEED_ANSWER', workerQueueStatus: 'WAITING_USER', expectedCode: 'TASK_WAITING_USER' },
    { taskId: 'task-failed', status: 'FAILED', workerQueueStatus: 'FAILED', expectedCode: 'TASK_NOT_RUNNABLE' },
    { taskId: 'task-cancelled', status: 'CANCELLED', workerQueueStatus: 'CANCELLED', expectedCode: 'TASK_NOT_RUNNABLE' }
  ]) {
    const document = { _id: fixture.taskId, status: fixture.status, workerQueueStatus: fixture.workerQueueStatus };
    const reference = {
      get: async () => ({ data: document }),
      update: async (patch) => Object.assign(document, patch.data || patch)
    };
    const db = {
      collection: () => ({ doc: () => reference }),
      runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) })
    };
    await withServer('expected-token', async (port) => {
      const response = await request(port, {
        method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: fixture.taskId })
      });
      assert.equal(response.body.code, fixture.expectedCode);
      assert.equal(document.workerQueueStatus, fixture.workerQueueStatus);
      assert.equal(document.status, fixture.status);
    }, async () => { throw new Error('claim must not run'); }, { context: { db } });
  }
});

test('dispatch retries a stale PENDING readback before claiming a later DISPATCHED document', async () => {
  const document = { _id: 'task-dispatch-retry', status: 'QUEUED', workerQueueStatus: 'PENDING', workerAttempt: 0 };
  let readbacks = 0;
  const directReference = {
    get: async () => ({ data: [readbacks++ === 0 ? { ...document, workerQueueStatus: 'PENDING' } : document] }),
    update: async (patch) => { Object.assign(document, patch); return {}; }
  };
  const transactionReference = { get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) };
  const db = {
    collection: () => ({ doc: () => directReference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => transactionReference }) })
  };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/kick', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
    });
    assert.deepEqual(response.body, { accepted: true, code: 'TASK_ENQUEUED', taskId: document._id });
    await new Promise((resolve) => setTimeout(resolve, 130));
    assert.equal(readbacks, 3);
    assert.equal(document.workerQueueStatus, 'COMPLETED');
  }, async () => {
    Object.assign(document, {
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: 'instance-a',
      workerAttempt: 1
    });
    return {
      workerLeaseOwner: 'instance-a',
      workerAttempt: 1,
      claimContext: { workerLeaseOwner: 'instance-a', workerAttempt: 1 },
      body: { code: 'TASK_CLAIMED' }
    };
  }, { context: { db } }, completedExecution(document));
});

test('a transactional dispatch update error retains its SDK code and requestId before scheduling a retry', async () => {
  const document = { _id: 'task-dispatch-failure', status: 'QUEUED', workerQueueStatus: 'PENDING', workerAttempt: 0 };
  const dispatchError = Object.assign(new Error('dispatch write failed'), { code: 'DB_WRITE_DENIED', requestId: 'request-123' });
  let dispatchFailures = 0;
  const directReference = {
    get: async () => ({ data: document }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const transactionReference = {
    get: async () => ({ data: document }),
    update: async (patch) => {
      const data = patch.data || patch;
      if (data.workerQueueStatus === 'DISPATCHED' && dispatchFailures === 0) {
        dispatchFailures += 1;
        throw dispatchError;
      }
      Object.assign(document, data);
    }
  };
  const db = {
    collection: () => ({ doc: () => directReference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => transactionReference }) })
  };
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  try {
    await withServer('expected-token', async (port) => {
      const response = await request(port, {
        method: 'POST', path: '/internal/jobs/kick', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
      });
      assert.deepEqual(response.body, { accepted: true, code: 'TASK_ENQUEUED', taskId: document._id });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }, async () => { throw new Error('claim must not run'); }, { context: { db } });
  } finally {
    console.error = originalError;
  }
  assert.equal(document.workerQueueStatus, 'PENDING');
  assert.equal(document.workerQueueError, 'DB_WRITE_DENIED');
  assert.ok(document.workerNextDispatchAt instanceof Date);
  assert.match(logs.join('\n'), /task-dispatch-failure/);
  assert.match(logs.join('\n'), /DB_WRITE_DENIED/);
  assert.match(logs.join('\n'), /request-123/);
});

test('POST /internal/jobs/run rejects an incorrect token', async () => {
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/run',
      headers: { authorization: 'Bearer incorrect-token' },
      body: JSON.stringify({ taskId: 'task-123' })
    });
    assert.equal(response.statusCode, 401);
  });
});

test('POST /internal/jobs/run preserves the TASK_NOT_FOUND JSON response', async () => {
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/run', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: 'missing-task' })
    });
    assert.deepEqual(response, {
      statusCode: 404,
      body: { accepted: false, code: 'TASK_NOT_FOUND', taskId: 'missing-task' }
    });
  }, async (taskId) => ({ statusCode: 404, body: { accepted: false, code: 'TASK_NOT_FOUND', taskId } }));
});

test('job routes map CloudBase document-not-found errors to TASK_NOT_FOUND', async () => {
  const taskId = 'task_cross_env_probe';
  const documentError = { code: 'DOCUMENT_NOT_FOUND', errMsg: 'Document not found' };
  for (const path of ['/internal/jobs/run', '/internal/jobs/enqueue', '/internal/jobs/kick']) {
    const runtime = { context: { db: { runTransaction: async () => { throw documentError; } } } };
    const claimTask = path === '/internal/jobs/run' ? async () => { throw documentError; } : undefined;
    await withServer('expected-token', async (port) => {
      const response = await request(port, {
        method: 'POST', path, headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId })
      });
      assert.deepEqual(response, { statusCode: 404, body: { accepted: false, code: 'TASK_NOT_FOUND', taskId } });
    }, claimTask, runtime);
  }
});

test('POST /internal/jobs/run returns a completed task only after the result is persisted', async () => {
  const document = {
    _id: 'task-123',
    status: 'QUEUED',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'instance-a',
    workerAttempt: 1
  };
  const reference = {
    get: async () => ({ data: document }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const db = {
    collection: () => ({ doc: () => reference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) })
  };

  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST',
      path: '/internal/jobs/run',
      headers: { authorization: 'Bearer expected-token' },
      body: JSON.stringify({ taskId: document._id })
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      accepted: true,
      code: 'TASK_COMPLETED',
      taskId: document._id
    });
  }, async (taskId) => ({
    statusCode: 200,
    workerLeaseOwner: 'instance-a',
    workerAttempt: 1,
    claimContext: { workerLeaseOwner: 'instance-a', workerAttempt: 1 },
    body: { accepted: true, code: 'TASK_CLAIMED', taskId }
  }), { context: { db } }, completedExecution(document));
});


function createMemoryDb(tasks) {
  let lock = Promise.resolve();
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

  function collectionApi() {
    return {
      doc(taskId) {
        return {
          async get() { return { data: tasks.get(taskId) }; },
          async update(patch) {
            tasks.set(taskId, applyPatch(tasks.get(taskId), patch));
            return { updated: 1 };
          }
        };
      },
      where(condition) {
        return {
          async update(patch) {
            let updated = 0;
            for (const [taskId, document] of tasks.entries()) {
              if (!matches(document, condition)) continue;
              tasks.set(taskId, applyPatch(document, patch));
              updated += 1;
            }
            return { updated };
          }
        };
      }
    };
  }

  const database = {
    command,
    collection: collectionApi,
    runTransaction(callback) {
      const current = lock;
      let release;
      lock = new Promise((resolve) => { release = resolve; });
      return current.then(async () => {
        try {
          return await callback({ command, collection: collectionApi });
        } finally {
          release();
        }
      });
    }
  };
  return database;
}


test('TASK_RESULT_NOT_READY finalization adds failedAt and sends the final task to the failure archive', async () => {
  const taskId = 'task-result-not-ready-archive';
  const fence = { workerLeaseOwner: 'owner-a', workerAttempt: 1 };
  const tasks = new Map([[taskId, {
    _id: taskId,
    status: 'PROCESSING',
    currentStage: 'FINALIZING_RESULT',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    ...fence
  }]]);
  const archives = [];
  const result = await finishWorkerState(
    { context: { db: createMemoryDb(tasks) } },
    taskId,
    fence,
    'COMPLETED',
    undefined,
    null,
    null,
    null,
    null,
    { archiveTaskFailureCase: async (input) => { archives.push(input); } }
  );

  assert.equal(result.code, 'TASK_RESULT_NOT_READY');
  assert.ok(tasks.get(taskId).failedAt instanceof Date);
  assert.equal(archives.length, 1);
  assert.equal(archives[0].task._id, taskId);
  assert.equal(archives[0].task.status, 'FAILED');
  assert.equal(archives[0].archiveSource, 'gradingWorker');
  assert.equal(archives[0].archivedAt.getTime(), tasks.get(taskId).failedAt.getTime());
});

test('generic FAILED finalization sends the lease-fenced final task and original error to the failure archive', async () => {
  const taskId = 'task-generic-failure-archive';
  const fence = { workerLeaseOwner: 'owner-a', workerAttempt: 1 };
  const originalError = Object.assign(new Error('execution failed'), { code: 'MODEL_FAILED' });
  const tasks = new Map([[taskId, {
    _id: taskId,
    status: 'PROCESSING',
    currentStage: 'PRIMARY_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    ...fence
  }]]);
  const archives = [];
  const result = await finishWorkerState(
    { context: { db: createMemoryDb(tasks) } },
    taskId,
    fence,
    'FAILED',
    'MODEL_FAILED',
    null,
    null,
    null,
    null,
    { error: originalError, archiveTaskFailureCase: async (input) => { archives.push(input); } }
  );

  assert.equal(result.code, 'TASK_EXECUTION_FAILED');
  assert.ok(tasks.get(taskId).failedAt instanceof Date);
  assert.equal(archives.length, 1);
  assert.equal(archives[0].task._id, taskId);
  assert.equal(archives[0].task.status, 'FAILED');
  assert.equal(archives[0].archiveSource, 'gradingWorker');
  assert.equal(archives[0].error, originalError);
});

test('new direct FAILED finalization preserves each task type original stage for the archive', async () => {
  for (const fixture of [
    { name: 'hard-problem', mode: 'HARD_PROBLEM_CHECK', carelessTrainingType: null, stage: 'HARD_PROBLEM_REVIEW' },
    { name: 'reading', mode: 'CARELESS_TRAINING', carelessTrainingType: 'READING', stage: 'REVIEW_GRADING' },
    { name: 'calculation', mode: 'CARELESS_TRAINING', carelessTrainingType: 'CALCULATION', stage: 'FINALIZING_RESULT' }
  ]) {
    const taskId = `task-direct-failure-${fixture.name}`;
    const fence = { workerLeaseOwner: 'owner-a', workerAttempt: 1 };
    const tasks = new Map([[taskId, {
      _id: taskId,
      mode: fixture.mode,
      carelessTrainingType: fixture.carelessTrainingType,
      status: 'PROCESSING',
      currentStage: fixture.stage,
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      ...fence
    }]]);
    const archives = [];

    const result = await finishWorkerState(
      { context: { db: createMemoryDb(tasks) } }, taskId, fence, 'FAILED', 'MODEL_FAILED',
      null, null, null, null, { archiveTaskFailureCase: async (input) => { archives.push(input); } }
    );

    assert.equal(result.code, 'TASK_EXECUTION_FAILED', fixture.name);
    assert.equal(tasks.get(taskId).failedStage, fixture.stage, fixture.name);
    assert.equal(archives.length, 1, fixture.name);
    assert.equal(archives[0].task.failedStage, fixture.stage, fixture.name);
  }
});

test('empty readback after a fenced failure update falls back to the final task without changing the response', async () => {
  const taskId = 'task-empty-failure-readback';
  const fence = { workerLeaseOwner: 'owner-a', workerAttempt: 1 };
  const document = {
    _id: taskId,
    status: 'PROCESSING',
    currentStage: 'PRIMARY_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    ...fence
  };
  let reads = 0;
  const reference = {
    get: async () => ({ data: reads++ === 0 ? document : undefined })
  };
  const db = {
    collection: () => ({
      doc: () => reference,
      where: () => ({
        update: async (patch) => {
          Object.assign(document, patch.data || patch);
          return { updated: 1 };
        }
      })
    })
  };
  const archives = [];

  const result = await finishWorkerState(
    { context: { db } },
    taskId,
    fence,
    'FAILED',
    'MODEL_FAILED',
    null,
    null,
    null,
    null,
    { archiveTaskFailureCase: async (input) => { archives.push(input); } }
  );

  assert.equal(result.code, 'TASK_EXECUTION_FAILED');
  assert.equal(archives.length, 1);
  assert.equal(archives[0].task._id, taskId);
  assert.equal(archives[0].task.status, 'FAILED');
  assert.ok(archives[0].task.failedAt instanceof Date);
});

test('existing FAILED direct finalization backfills a missing failedAt without changing its failure fields', async () => {
  const taskId = 'task-existing-failed-without-time';
  const fence = { workerLeaseOwner: 'owner-a', workerAttempt: 1 };
  const tasks = new Map([[taskId, {
    _id: taskId,
    status: 'FAILED',
    currentStage: 'FAILED',
    failedStage: 'REVIEW_GRADING',
    errorCode: 'EXISTING_FAILURE',
    errorMessage: 'existing safe failure',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    ...fence
  }]]);

  const archives = [];
  const result = await finishWorkerState(
    { context: { db: createMemoryDb(tasks) } },
    taskId,
    fence,
    'FAILED',
    'NEW_FAILURE_MUST_NOT_REPLACE_EXISTING',
    null,
    null,
    null,
    null,
    { archiveTaskFailureCase: async (input) => { archives.push(input); } }
  );

  assert.equal(result.code, 'TASK_EXECUTION_FAILED');
  assert.ok(tasks.get(taskId).failedAt instanceof Date);
  assert.equal(tasks.get(taskId).errorCode, 'EXISTING_FAILURE');
  assert.equal(tasks.get(taskId).errorMessage, 'existing safe failure');
  assert.equal(tasks.get(taskId).failedStage, 'REVIEW_GRADING');
  assert.equal(archives[0].task.failedStage, 'REVIEW_GRADING');
});

test('failure archive rejection preserves TASK_EXECUTION_FAILED and TASK_RESULT_NOT_READY with safe diagnostics', async () => {
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  try {
    for (const fixture of [
      { taskId: 'task-archive-reject-failed', disposition: 'FAILED', explicitErrorCode: 'MODEL_FAILED', expectedCode: 'TASK_EXECUTION_FAILED' },
      { taskId: 'task-archive-reject-result', disposition: 'COMPLETED', explicitErrorCode: undefined, expectedCode: 'TASK_RESULT_NOT_READY' }
    ]) {
      const fence = { workerLeaseOwner: 'owner-a', workerAttempt: 1 };
      const tasks = new Map([[fixture.taskId, {
        _id: fixture.taskId,
        status: 'PROCESSING',
        currentStage: 'FINALIZING_RESULT',
        workerQueueStatus: 'RUNNING',
        workerStatus: 'RUNNING',
        ...fence
      }]]);
      const result = await finishWorkerState(
        { context: { db: createMemoryDb(tasks) } },
        fixture.taskId,
        fence,
        fixture.disposition,
        fixture.explicitErrorCode,
        null,
        null,
        null,
        null,
        { archiveTaskFailureCase: async () => {
          throw Object.assign(new Error('student name and question must stay private'), { code: 'ARCHIVE_WRITE_FAILED' });
        } }
      );
      assert.equal(result.code, fixture.expectedCode);
    }
  } finally {
    console.error = originalConsoleError;
  }

  assert.match(logs.join('\n'), /task-archive-reject-failed/);
  assert.match(logs.join('\n'), /task-archive-reject-result/);
  assert.match(logs.join('\n'), /ARCHIVE_WRITE_FAILED/);
  assert.doesNotMatch(logs.join('\n'), /student name|question must stay private/);
});

test('execution fence update miss writes neither a failure case nor archive marker', async () => {
  const taskId = 'task-failure-archive-lease-lost';
  const tasks = new Map([[taskId, {
    _id: taskId,
    status: 'PROCESSING',
    currentStage: 'PRIMARY_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-current',
    workerAttempt: 2
  }]]);
  let archiveCalls = 0;
  const result = await finishWorkerState(
    { context: { db: createMemoryDb(tasks) } },
    taskId,
    { workerLeaseOwner: 'owner-stale', workerAttempt: 1 },
    'FAILED',
    'MODEL_FAILED',
    null,
    null,
    null,
    null,
    { archiveTaskFailureCase: async () => { archiveCalls += 1; } }
  );

  assert.equal(result.code, 'TASK_WORKER_LEASE_LOST');
  assert.equal(archiveCalls, 0);
  assert.equal(tasks.get(taskId).status, 'PROCESSING');
  assert.equal(tasks.get(taskId).failureArchivedAt, undefined);
  assert.equal(tasks.get(taskId).failureArchiveVersion, undefined);
});


test('concurrent claims for one task allow only one TASK_CLAIMED response', async () => {
  const tasks = new Map([['task-1', { _id: 'task-1', status: 'QUEUED', workerQueueStatus: 'DISPATCHED', workerAttempt: 0 }]]);
  const db = createMemoryDb(tasks);
  const claim = createClaimTask({ db, instanceId: 'instance-a', now: () => new Date('2026-01-01T00:00:00.000Z') });
  await withServer('expected-token', async (port) => {
    const outcomes = await Promise.all([request(port, {
      method: 'POST', path: '/internal/jobs/run',
      headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: 'task-1' })
    }), request(port, {
      method: 'POST', path: '/internal/jobs/run',
      headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: 'task-1' })
    })]);
    assert.equal(outcomes.filter((outcome) => outcome.body.code === 'TASK_COMPLETED').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.body.code === 'TASK_ALREADY_CLAIMED').length, 1);
  }, claim, { context: { db } }, completedDbExecution(db, 20));
});

test('an expired lease can be reclaimed and increments workerAttempt', async () => {
  const tasks = new Map([['task-1', {
    _id: 'task-1', status: 'QUEUED', workerQueueStatus: 'DISPATCHED', workerAttempt: 2,
    workerLeaseUntil: new Date('2025-12-31T23:59:59.999Z')
  }]]);
  const claim = createClaimTask({ db: createMemoryDb(tasks), instanceId: 'instance-a', now: () => new Date('2026-01-01T00:00:00.000Z') });
  const outcome = await claim('task-1');
  assert.equal(outcome.body.code, 'TASK_CLAIMED');
  assert.equal(tasks.get('task-1').workerAttempt, 3);
});

test('an unexpired lease is not overwritten', async () => {
  const tasks = new Map([['task-1', {
    _id: 'task-1', status: 'PROCESSING', workerQueueStatus: 'RUNNING', workerStatus: 'RUNNING', workerAttempt: 2,
    workerLeaseOwner: 'other-instance', workerLeaseUntil: new Date('2026-01-01T00:00:01.000Z')
  }]]);
  const claim = createClaimTask({ db: createMemoryDb(tasks), instanceId: 'instance-a', now: () => new Date('2026-01-01T00:00:00.000Z') });
  const outcome = await claim('task-1');
  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.code, 'TASK_ALREADY_CLAIMED');
  assert.equal(tasks.get('task-1').workerLeaseOwner, 'other-instance');
});

test('a completed task is returned unchanged', async () => {
  const completed = { _id: 'task-1', status: 'COMPLETED', resultId: 'result-1', workerAttempt: 4 };
  const tasks = new Map([['task-1', { ...completed }]]);
  const claim = createClaimTask({ db: createMemoryDb(tasks), instanceId: 'instance-a', now: () => new Date('2026-01-01T00:00:00.000Z') });
  const outcome = await claim('task-1');
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.code, 'TASK_ALREADY_COMPLETED');
  assert.deepEqual(tasks.get('task-1'), completed);
});

test('kick recovers an expired RUNNING task and claims it with a new owner and attempt', async () => {
  const tasks = new Map([['task-1', {
    _id: 'task-1', status: 'PROCESSING', workerQueueStatus: 'RUNNING', workerAttempt: 2,
    workerLeaseOwner: 'old-owner', workerLeaseUntil: new Date('2025-12-31T23:59:59.999Z')
  }]]);
  const db = createMemoryDb(tasks);
  const claim = createClaimTask({ db, instanceId: 'new-owner', createLeaseOwner: () => 'new-owner', now: () => new Date('2026-01-01T00:00:00.000Z') });
  let claimed;
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/kick', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: 'task-1' })
    });
    assert.equal(response.statusCode, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(claimed.workerLeaseOwner, 'new-owner');
    assert.equal(claimed.workerAttempt, 3);
    assert.ok(claimed.workerLeaseUntil instanceof Date);
  }, claim, { context: { db } }, async ({ taskId, preclaimedContext }) => {
    claimed = preclaimedContext;
    await db.collection('grading_tasks').doc(taskId).update({
      data: { status: 'COMPLETED', currentStage: 'COMPLETED', resultId: taskId }
    });
    return { success: true, outcome: 'COMPLETED' };
  });
});

test('kick does not execute a RUNNING task with an unexpired lease', async () => {
  const future = new Date(Date.now() + 60_000);
  const document = { _id: 'task-1', status: 'PROCESSING', workerQueueStatus: 'RUNNING', workerLeaseOwner: 'other-owner', workerAttempt: 1, workerLeaseUntil: future };
  let calls = 0;
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) }) }), runTransaction: async (callback) => callback({ collection: () => ({ doc: () => ({ get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) }) }) }) };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/kick', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: 'task-1' })
    });
    assert.deepEqual(response.body, { accepted: true, code: 'TASK_ALREADY_ENQUEUED', taskId: 'task-1' });
    assert.equal(calls, 0);
  }, async () => { calls += 1; return { body: { code: 'TASK_CLAIMED' } }; }, { context: { db } });
});

test('a worker that loses its lease does not finish over the new worker', async () => {
  const document = { _id: 'task-1', status: 'QUEUED', workerLeaseOwner: 'old-owner', workerAttempt: 1, workerLeaseUntil: new Date(Date.now() + 60_000) };
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) }) }), runTransaction: async (callback) => callback({ collection: () => ({ doc: () => ({ get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) }) }) }) };
  let release;
  const execution = new Promise((resolve) => { release = resolve; });
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: 'task-1' })
    });
    assert.equal(response.statusCode, 202);
    document.workerLeaseOwner = 'new-owner';
    document.workerAttempt = 2;
    document.workerLeaseUntil = new Date(Date.now() + 60_000);
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(document.workerLeaseOwner, 'new-owner');
    assert.equal(document.workerAttempt, 2);
    assert.notEqual(document.workerQueueStatus, 'COMPLETED');
    assert.notEqual(document.workerStatus, 'COMPLETED');
  }, async () => ({ body: { code: 'TASK_CLAIMED' }, claimContext: { workerLeaseOwner: 'old-owner', workerAttempt: 1 } }), { context: { db } }, async () => {
    await execution;
    return { success: true };
  });
});

test('a claim read failure keeps a dispatched task retryable with its real error code', async () => {
  const document = { _id: 'task-claim-read-failure', status: 'QUEUED', workerQueueStatus: 'PENDING', workerAttempt: 0 };
  const reference = {
    get: async () => ({ data: document }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const db = {
    collection: () => ({ doc: () => reference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) })
  };
  const error = Object.assign(new Error('initial read failed'), { code: 'DB_READ_FAILED', stage: 'CLAIM_READ_BEFORE', requestId: 'read-1' });
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  let executions = 0;
  try {
    await withServer('expected-token', async (port) => {
      const response = await request(port, {
        method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
      });
      assert.deepEqual(response.body, { accepted: true, code: 'TASK_ENQUEUED', taskId: document._id });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }, async () => { throw error; }, { context: { db } }, async () => { executions += 1; return { success: true }; });
  } finally {
    console.error = originalError;
  }
  assert.equal(document.workerQueueStatus, 'PENDING');
  assert.equal(document.workerQueueError, 'DB_READ_FAILED');
  assert.ok(document.workerNextDispatchAt instanceof Date);
  assert.ok(document.workerNextDispatchAt.getTime() >= Date.now() + 14000);
  assert.equal(executions, 0);
  assert.match(logs.join('\n'), /WORKER_CLAIM_FAILURE/);
  assert.match(logs.join('\n'), /CLAIM_READ_BEFORE/);
  assert.match(logs.join('\n'), /DB_READ_FAILED/);
});

test('a claim readback failure schedules recovery without starting grading execution', async () => {
  const document = { _id: 'task-claim-readback-failure', status: 'QUEUED', workerQueueStatus: 'PENDING', workerAttempt: 0 };
  const reference = { get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) };
  const db = { collection: () => ({ doc: () => reference }), runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) }) };
  const error = Object.assign(new Error('readback failed'), { code: 'DB_READBACK_FAILED', stage: 'CLAIM_READ_AFTER' });
  let executions = 0;
  await withServer('expected-token', async (port) => {
    await request(port, {
      method: 'POST', path: '/internal/jobs/enqueue', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }, async () => { throw error; }, { context: { db } }, async () => { executions += 1; return { success: true }; });
  assert.equal(document.workerQueueStatus, 'PENDING');
  assert.equal(document.workerQueueError, 'DB_READBACK_FAILED');
  assert.ok(document.workerNextDispatchAt instanceof Date);
  assert.ok(document.workerNextDispatchAt.getTime() >= Date.now() + 14000);
  assert.equal(executions, 0);
});

test('uses a js-sdk array task readback to preserve the claimed worker fence through completion', async () => {
  const document = {
    _id: 'task-js-sdk-fence', status: 'QUEUED', workerQueueStatus: 'RUNNING', workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-a', workerAttempt: 1, workerLeaseUntil: new Date(Date.now() + 300000)
  };
  const reference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const db = {
    collection: () => ({ doc: () => reference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) })
  };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/run', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
    });
    assert.deepEqual(response.body, { accepted: true, code: 'TASK_COMPLETED', taskId: document._id });
  }, async (taskId) => ({
    claimContext: { workerLeaseOwner: 'owner-a', workerAttempt: 1, workerLeaseUntil: document.workerLeaseUntil },
    body: { accepted: true, code: 'TASK_CLAIMED', taskId }
  }), { context: { db } }, completedExecution(document));
  assert.equal(document.workerQueueStatus, 'COMPLETED');
});

test('does not lose a verified claim when a fresh transaction snapshot is stale', async () => {
  const document = {
    _id: 'task-stale-transaction', status: 'QUEUED', workerQueueStatus: 'RUNNING', workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-a', workerAttempt: 1, workerLeaseUntil: new Date(Date.now() + 300000)
  };
  const reference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => { Object.assign(document, patch.data || patch); return { updated: 1 }; }
  };
  const collection = {
    doc: () => reference,
    where: (conditions) => ({
      update: async (patch) => {
        const matches = Object.entries(conditions).every(([key, value]) => document[key] === value);
        if (!matches) return { updated: 0 };
        Object.assign(document, patch.data || patch);
        return { updated: 1 };
      }
    })
  };
  const db = {
    collection: () => collection,
    runTransaction: async () => { throw new Error('stale transaction path must not be used after a verified claim'); }
  };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/run', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
    });
    assert.deepEqual(response.body, { accepted: true, code: 'TASK_COMPLETED', taskId: document._id });
  }, async (taskId) => ({
    claimContext: { workerLeaseOwner: 'owner-a', workerAttempt: 1, workerLeaseUntil: document.workerLeaseUntil },
    body: { accepted: true, code: 'TASK_CLAIMED', taskId }
  }), { context: { db } }, completedExecution(document));
  assert.equal(document.workerQueueStatus, 'COMPLETED');
});

test('rejects a stale preclaim owner and attempt before grading execution', async () => {
  const document = {
    _id: 'task-stale-fence', status: 'QUEUED', workerQueueStatus: 'RUNNING', workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-current', workerAttempt: 2, workerLeaseUntil: new Date(Date.now() + 300000)
  };
  const reference = { get: async () => ({ data: document }), update: async (patch) => Object.assign(document, patch.data || patch) };
  const db = { collection: () => ({ doc: () => reference }), runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) }) };
  let executions = 0;
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST', path: '/internal/jobs/run', headers: { authorization: 'Bearer expected-token' }, body: JSON.stringify({ taskId: document._id })
    });
    assert.deepEqual(response.body, { accepted: false, code: 'TASK_WORKER_LEASE_LOST', taskId: document._id });
  }, async (taskId) => ({
    workerLeaseOwner: 'owner-stale', workerAttempt: 1, workerLeaseUntil: document.workerLeaseUntil,
    claimContext: { workerLeaseOwner: 'owner-stale', workerAttempt: 1, workerLeaseUntil: document.workerLeaseUntil },
    body: { accepted: true, code: 'TASK_CLAIMED', taskId }
  }), { context: { db } }, async () => { executions += 1; return { success: true }; });
  assert.equal(executions, 0);
  assert.equal(document.workerQueueStatus, 'RUNNING');
});

test('CONTINUE atomically hands off to the expected next stage when the task readback is still PROCESSING', async () => {
  const document = {
    _id: 'task-stage-handoff',
    status: 'QUEUED',
    currentStage: 'REVIEW_GRADING',
    workerQueueStatus: 'PENDING',
    workerStatus: 'PENDING',
    workerAttempt: 0
  };
  const reference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const db = {
    collection: () => ({ doc: () => reference }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) })
  };
  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST',
      path: '/internal/jobs/run',
      headers: { authorization: 'Bearer expected-token' },
      body: JSON.stringify({ taskId: document._id })
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.code, 'TASK_STAGE_COMPLETED');
    assert.equal(response.body.nextStage, 'FINALIZING_RESULT');
    assert.equal(document.status, 'QUEUED');
    assert.equal(document.currentStage, 'FINALIZING_RESULT');
    assert.equal(document.workerQueueStatus, 'PENDING');
    assert.equal(document.workerStatus, 'PENDING');
  }, async (taskId) => {
    Object.assign(document, {
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: 'stage-owner',
      workerAttempt: 1
    });
    return {
      statusCode: 200,
      workerLeaseOwner: 'stage-owner',
      workerAttempt: 1,
      claimContext: { workerLeaseOwner: 'stage-owner', workerAttempt: 1 },
      body: { code: 'TASK_CLAIMED', taskId }
    };
  }, { context: { db } }, async () => ({
    success: true,
    outcome: 'CONTINUE',
    nextStage: 'FINALIZING_RESULT'
  }));
});


test('CONTINUE persists the stage payload in the same atomic handoff write', async () => {
  const document = {
    _id: 'task-stage-payload-handoff',
    status: 'QUEUED',
    currentStage: 'REVIEW_GRADING',
    workerQueueStatus: 'PENDING',
    workerStatus: 'PENDING',
    workerAttempt: 0
  };
  const reference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  const collection = {
    doc: () => reference,
    where: (conditions) => ({
      update: async (patch) => {
        const matches = Object.entries(conditions).every(([key, value]) => document[key] === value);
        if (!matches) return { updated: 0 };
        Object.assign(document, patch.data || patch);
        return { updated: 1 };
      }
    })
  };
  const db = {
    collection: () => collection,
    runTransaction: async (callback) => callback({ collection: () => collection })
  };
  const handoffPatch = {
    primaryDraft: { questions: [{ sourceKey: 'q-atomic' }] },
    reviewDraft: { questions: [{ sourceKey: 'q-atomic' }] },
    mergedDraft: { questions: [{ sourceKey: 'q-atomic' }] },
    stageHandoffToken: 'stage_handoff_atomic',
    stageHandoffTo: 'FINALIZING_RESULT'
  };

  await withServer('expected-token', async (port) => {
    const response = await request(port, {
      method: 'POST',
      path: '/internal/jobs/run',
      headers: { authorization: 'Bearer expected-token' },
      body: JSON.stringify({ taskId: document._id })
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.code, 'TASK_STAGE_COMPLETED');
    assert.equal(document.currentStage, 'FINALIZING_RESULT');
    assert.equal(document.workerQueueStatus, 'PENDING');
    assert.deepEqual(document.primaryDraft, handoffPatch.primaryDraft);
    assert.deepEqual(document.reviewDraft, handoffPatch.reviewDraft);
    assert.deepEqual(document.mergedDraft, handoffPatch.mergedDraft);
    assert.equal(document.stageHandoffToken, 'stage_handoff_atomic');
  }, async (taskId) => {
    Object.assign(document, {
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: 'stage-payload-owner',
      workerAttempt: 1
    });
    return {
      statusCode: 200,
      workerLeaseOwner: 'stage-payload-owner',
      workerAttempt: 1,
      claimContext: { workerLeaseOwner: 'stage-payload-owner', workerAttempt: 1 },
      body: { code: 'TASK_CLAIMED', taskId }
    };
  }, { context: { db } }, async () => ({
    success: true,
    outcome: 'CONTINUE',
    nextStage: 'FINALIZING_RESULT',
    handoffPatch,
    handoffToken: 'stage_handoff_atomic'
  }));
});

test('concurrent direct run requests for the same task execute only once inside one worker instance', async () => {
  const document = {
    _id: 'task-local-dedupe',
    taskId: 'task-local-dedupe',
    status: 'QUEUED',
    currentStage: 'PRIMARY_GRADING',
    workerQueueStatus: 'DISPATCHED',
    workerStatus: 'DISPATCHED',
    workerAttempt: 0
  };
  const reference = {
    get: async () => ({ data: document }),
    update: async (patch) => {
      Object.assign(document, patch.data || patch);
      return { updated: 1 };
    }
  };
  const db = {
    collection: () => ({
      doc: () => reference,
      where: (condition) => ({
        update: async (patch) => {
          const matches = Object.entries(condition).every(([key, value]) => document[key] === value);
          if (!matches) return { updated: 0 };
          Object.assign(document, patch.data || patch);
          return { updated: 1 };
        }
      })
    }),
    runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) })
  };
  let claims = 0;
  let executions = 0;
  let releaseExecution;
  const executionGate = new Promise((resolve) => { releaseExecution = resolve; });
  const claimTask = async () => {
    claims += 1;
    Object.assign(document, {
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: 'local-owner',
      workerAttempt: 1,
      workerLeaseUntil: new Date(Date.now() + 300000)
    });
    return {
      body: { accepted: true, code: 'TASK_CLAIMED', taskId: document._id },
      workerLeaseOwner: 'local-owner',
      workerAttempt: 1,
      workerLeaseUntil: document.workerLeaseUntil,
      claimContext: {
        workerLeaseOwner: 'local-owner',
        workerAttempt: 1,
        workerLeaseUntil: document.workerLeaseUntil
      }
    };
  };
  const executeTask = async ({ taskId }) => {
    executions += 1;
    await executionGate;
    Object.assign(document, { status: 'COMPLETED', currentStage: 'COMPLETED', resultId: taskId });
    return { success: true, outcome: 'COMPLETED', resultId: taskId };
  };

  const server = createServer({ token: 'expected-token', runtime: { context: { db } }, claimTask, executeTask, startRecovery: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const first = request(port, {
      method: 'POST', path: '/internal/jobs/run', headers: { authorization: 'Bearer expected-token' },
      body: JSON.stringify({ taskId: document._id })
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await request(port, {
      method: 'POST', path: '/internal/jobs/run', headers: { authorization: 'Bearer expected-token' },
      body: JSON.stringify({ taskId: document._id })
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.code, 'TASK_ALREADY_CLAIMED');
    releaseExecution();
    const firstResult = await first;
    assert.equal(firstResult.body.code, 'TASK_COMPLETED');
    assert.equal(claims, 1);
    assert.equal(executions, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server.beginShutdown();
  }
});
