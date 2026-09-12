const assert = require('node:assert/strict');
const test = require('node:test');

const { createTaskScheduler } = require('../task-watcher');

async function keepEventLoopAliveUntil(promise) {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    return await promise;
  } finally {
    clearInterval(keepAlive);
  }
}

function queueDb(taskFactory = () => []) {
  return {
    collection: () => ({
      where: (filter) => {
        const query = {
          field: () => query,
          limit: () => ({ get: async () => ({ data: taskFactory(filter) }) })
        };
        return query;
      }
    })
  };
}

function emptyQueueDb() {
  return queueDb();
}

function eligibleQueueDb(taskId) {
  return queueDb((filter) => filter.workerQueueStatus === 'PENDING'
    ? [{ _id: taskId, workerQueueStatus: 'PENDING' }]
    : []);
}

test('scheduler runs bounded maintenance at startup and idle scans', async () => {
  let calls = 0;
  let resolveIdleMaintenance;
  const idleMaintenance = new Promise((resolve) => { resolveIdleMaintenance = resolve; });
  const scheduler = createTaskScheduler({
    db: emptyQueueDb(),
    execute: async () => ({}),
    maintenance: async () => {
      calls += 1;
      if (calls === 2) resolveIdleMaintenance();
      return { scanned: 0 };
    },
    activeMs: 5,
    idleMs: 5
  });

  try {
    await scheduler.start();
    assert.equal(calls, 1);
    await keepEventLoopAliveUntil(idleMaintenance);
    assert.equal(calls, 2);
  } finally {
    scheduler.stop();
  }
});

test('active recovery scans do not run maintenance', async () => {
  let queryCount = 0;
  let resolveActiveScan;
  const activeScan = new Promise((resolve) => { resolveActiveScan = resolve; });
  let maintenanceCalls = 0;
  const scheduler = createTaskScheduler({
    db: {
      collection: () => ({
        where: () => ({
          limit: () => ({ get: async () => {
            queryCount += 1;
            if (queryCount === 6) resolveActiveScan();
            return { data: [] };
          } })
        })
      })
    },
    execute: async () => ({}),
    maintenance: async () => { maintenanceCalls += 1; },
    activeMs: 5,
    idleMs: 100000
  });

  try {
    await scheduler.start();
    scheduler.scheduleActive();
    await keepEventLoopAliveUntil(activeScan);
    assert.equal(maintenanceCalls, 1);
  } finally {
    scheduler.stop();
  }
});

test('a failed startup maintenance run retries on the next idle cycle', async () => {
  let calls = 0;
  let resolveRetry;
  const retry = new Promise((resolve) => { resolveRetry = resolve; });
  const errors = [];
  const scheduler = createTaskScheduler({
    db: emptyQueueDb(),
    execute: async () => ({}),
    maintenance: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('temporary maintenance failure'), { code: 'MAINTENANCE_FAILED' });
      resolveRetry();
    },
    onError: (error) => errors.push(error),
    activeMs: 5,
    idleMs: 5
  });

  try {
    await scheduler.start();
    await keepEventLoopAliveUntil(retry);
    assert.equal(calls, 2);
    assert.deepEqual(errors, [{ code: 'MAINTENANCE_FAILED' }]);
  } finally {
    scheduler.stop();
  }
});

test('maintenance errors are reported as code-only plain objects without stopping queue recovery', async () => {
  const errors = [];
  const scheduler = createTaskScheduler({
    db: eligibleQueueDb('task-1'),
    execute: async () => ({ body: { code: 'TASK_COMPLETED' } }),
    maintenance: async () => {
      throw Object.assign(new Error('student content must stay private'), {
        code: 'MAINTENANCE_FAILED',
        cause: { task: { answer: 'private answer' } }
      });
    },
    onError: (error) => errors.push(error),
    activeMs: 5,
    idleMs: 5
  });

  try {
    await scheduler.start();
    await scheduler.waitForIdle(1000);
    assert.equal(Object.getPrototypeOf(errors[0]), Object.prototype);
    assert.deepEqual(errors, [{ code: 'MAINTENANCE_FAILED' }]);
    assert.equal('message' in errors[0], false);
    assert.equal('stack' in errors[0], false);
    assert.equal('cause' in errors[0], false);
  } finally {
    scheduler.stop();
  }
});

test('scheduler recovers only eligible task ids with ordinary status queries', async () => {
  const queries = [];
  const executed = [];
  const now = new Date('2026-01-01T00:00:00.000Z').getTime();
  const scheduler = createTaskScheduler({
    db: { collection: (name) => ({ where: (filter) => ({ limit: () => ({ get: async () => {
      queries.push([name, filter]);
      return { data: filter.workerQueueStatus === 'PENDING'
        ? [{ _id: 'pending', workerQueueStatus: 'PENDING', workerNextDispatchAt: new Date(now - 1) }]
        : filter.workerQueueStatus === 'DISPATCHED'
          ? [{ _id: 'dispatched', workerQueueStatus: 'DISPATCHED', workerLeaseUntil: new Date(now - 1) }]
          : [{ _id: 'running', workerQueueStatus: 'RUNNING', workerLeaseUntil: new Date(now + 1) }] };
    } }) }) }) },
    execute: async (taskId) => { executed.push(taskId); },
    concurrency: 5,
    now: () => now,
    activeMs: 100000,
    idleMs: 100000
  });

  const found = await scheduler.recover(100);
  scheduler.stop();

  assert.equal(found, 2);
  assert.deepEqual(executed.sort(), ['dispatched', 'pending']);
  assert.deepEqual(queries.map(([, filter]) => filter.workerQueueStatus), ['PENDING', 'DISPATCHED', 'RUNNING']);
});

test('wake adds an absent task to the local pending set before draining', async () => {
  let release;
  const execution = new Promise((resolve) => { release = resolve; });
  const logs = [];
  const scheduler = createTaskScheduler({
    db: { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }) },
    execute: async () => {
      await execution;
      return {
        body: { code: 'TASK_COMPLETED' },
        schedulerOutcome: { reachedDispatch: true, reachedClaim: true }
      };
    },
    concurrency: 1,
    onLog: (event, data) => logs.push({ event, data }),
    activeMs: 100000,
    idleMs: 100000
  });

  const outcome = await scheduler.wake('pending-task');
  assert.equal(outcome.code, 'TASK_ENQUEUED');
  assert.equal(scheduler.pendingTaskIds.size + scheduler.runningTaskIds.size, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  const finish = logs.find((entry) => entry.event === 'SCHEDULER_TASK_FINISH').data;
  assert.deepEqual(finish.outcome, 'completed');
  assert.deepEqual(finish.code, 'TASK_COMPLETED');
  assert.equal(finish.reachedDispatch, true);
  assert.equal(finish.reachedClaim, true);
  scheduler.stop();
});

test('scheduler finishes a claim exception with its code and stage and clears the running task', async () => {
  const logs = [];
  const failure = Object.assign(new Error('initial read failed'), { code: 'DB_READ_FAILED', stage: 'CLAIM_READ_BEFORE' });
  const scheduler = createTaskScheduler({
    db: { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }) },
    execute: async () => { throw failure; },
    onError: () => {},
    onLog: (event, data) => logs.push({ event, data }),
    activeMs: 100000,
    idleMs: 100000
  });

  await scheduler.wake('claim-failure-task');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const finish = logs.find((entry) => entry.event === 'SCHEDULER_TASK_FINISH').data;
  assert.deepEqual(finish.outcome, 'claim_failed');
  assert.deepEqual(finish.code, 'DB_READ_FAILED');
  assert.deepEqual(finish.stage, 'CLAIM_READ_BEFORE');
  assert.equal(scheduler.runningTaskIds.has('claim-failure-task'), false);
  scheduler.stop();
});


test('recovery tolerates reduced database mocks without limit and supports timestamp objects', async () => {
  const scheduler = createTaskScheduler({
    db: { collection: () => ({ where: () => ({}) }) },
    execute: async () => { throw new Error('must not execute'); },
    activeMs: 100000,
    idleMs: 100000
  });

  assert.equal(await scheduler.recover(10), 0);
  scheduler.stop();
});


test('scheduler preserves safe model failure diagnostics in the finish event', async () => {
  const logs = [];
  const scheduler = createTaskScheduler({
    db: { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }) },
    execute: async () => ({
      body: {
        code: 'TASK_EXECUTION_FAILED', errorCode: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH', causeCode: 'LLM_SCHEMA_ERROR',
        fieldPath: 'questions[0].stepFeedbacks', requestStage: 'hardProblemReview', modelProvider: 'qwen3_vl_plus',
        modelName: 'qwen3.7-plus', providerRequestIdPresent: true, repairAttempted: true,
        repairAttemptCount: 1, repairFailureStage: 'REPAIR_PATCH_VALIDATION', failureId: 'failure-safe-id'
      },
      schedulerOutcome: {
        code: 'TASK_EXECUTION_FAILED', outcome: 'failed', reachedDispatch: true, reachedClaim: true,
        errorCode: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH', causeCode: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[0].stepFeedbacks',
        requestStage: 'hardProblemReview', modelProvider: 'qwen3_vl_plus', modelName: 'qwen3.7-plus',
        providerRequestIdPresent: true, repairAttempted: true, repairAttemptCount: 1,
        repairFailureStage: 'REPAIR_PATCH_VALIDATION', failureId: 'failure-safe-id'
      }
    }),
    onLog: (event, data) => logs.push({ event, data }),
    activeMs: 100000,
    idleMs: 100000
  });
  await scheduler.wake('qwen-review-failure');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const finish = logs.find((entry) => entry.event === 'SCHEDULER_TASK_FINISH').data;
  assert.equal(finish.outcome, 'failed');
  assert.equal(finish.errorCode, 'HARD_PROBLEM_FIXED_RESULT_MISMATCH');
  assert.equal(finish.causeCode, 'LLM_SCHEMA_ERROR');
  assert.equal(finish.fieldPath, 'questions[0].stepFeedbacks');
  assert.equal(finish.modelProvider, 'qwen3_vl_plus');
  assert.equal(finish.modelName, 'qwen3.7-plus');
  assert.equal(finish.providerRequestIdPresent, true);
  assert.equal(finish.repairAttempted, true);
  assert.equal(finish.repairAttemptCount, 1);
  assert.equal(finish.repairFailureStage, 'REPAIR_PATCH_VALIDATION');
  assert.equal(finish.failureId, 'failure-safe-id');
  assert.doesNotMatch(JSON.stringify(finish), /request-secret|api[_-]?key/i);
  scheduler.stop();
});
