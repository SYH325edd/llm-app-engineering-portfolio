'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { executeGradingTask, createGradingRuntime } = require('../shared/grading-core/execute-grading-task');

function createDb(taskId, task, { failArchive = false } = {}) {
  const collections = {
    grading_tasks: new Map([[taskId, task]]),
    hard_problem_diagnostics: new Map(),
    task_failure_cases: new Map()
  };
  const db = {
    collection(name) {
      if (!collections[name]) collections[name] = new Map();
      return {
        doc(id) {
          return {
            async get() { const value = collections[name].get(id); return { data: value === undefined ? [] : [value] }; },
            async set({ data }) {
              if (failArchive && name === 'task_failure_cases') throw Object.assign(new Error('archive unavailable'), { code: 'ARCHIVE_UNAVAILABLE' });
              collections[name].set(id, data);
            },
            async update({ data }) {
              const current = collections[name].get(id);
              if (!current) return { updated: 0 };
              collections[name].set(id, { ...current, ...data });
              return { updated: 1 };
            }
          };
        },
        where(condition) {
          return {
            async update({ data }) {
              let updated = 0;
              for (const [id, value] of collections[name]) {
                const match = Object.entries(condition).every(([key, expected]) => key === '_id' ? id === expected : value?.[key] === expected);
                if (match) { collections[name].set(id, { ...value, ...data }); updated += 1; }
              }
              return { updated };
            }
          };
        }
      };
    }
  };
  return { db, collections };
}

test('taskWorker final failure archives a safe failure case without changing the task failure outcome', async () => {
  const taskId = 'task-failure-integration';
  const task = { _id: taskId, status: 'PROCESSING', currentStage: 'REVIEW_GRADING', studentName: '学生', dailySequence: 2, dataSpace: 'developer_test' };
  const { db, collections } = createDb(taskId, task);
  const runtime = createGradingRuntime({
    context: { db },
    constants: { C: { tasks: 'grading_tasks' } },
    audit: { monitor: () => {} },
    utils: { ...require('../shared/utils'), randomId: () => 'failure-integration', now: () => new Date('2026-08-20T00:00:00.000Z') },
    taskError: { mapTaskFailure: () => ({ status: 'FAILED', stage: 'FAILED', errorCode: 'ARK_TIMEOUT', userMessage: 'safe', userSuggestion: '', retryable: false, failureCategory: 'MODEL_OUTPUT' }) }
  });
  const result = await executeGradingTask({
    taskId,
    runtime: {
      claim: async () => ({ reason: 'CLAIMED', task }),
      loadTask: runtime.loadTask,
      process: async () => { throw Object.assign(new Error('provider unavailable'), { code: 'ARK_TIMEOUT' }); },
      fail: runtime.fail,
      defaultStage: runtime.defaultStage
    }
  });
  assert.equal(result.outcome, 'FAILED');
  assert.equal(result.errorCode, 'ARK_TIMEOUT');
  assert.equal(collections.task_failure_cases.get(taskId).taskId, taskId);
  assert.equal(collections.task_failure_cases.get(taskId).dataSpace, 'developer_test');
  assert.equal(collections.grading_tasks.get(taskId).failureArchiveVersion, 1);
});

test('taskWorker failure remains FAILED when failure-case archival itself fails', async () => {
  const taskId = 'task-failure-archive-unavailable';
  const task = { _id: taskId, status: 'PROCESSING', currentStage: 'PRIMARY_GRADING' };
  const { db, collections } = createDb(taskId, task, { failArchive: true });
  const runtime = createGradingRuntime({
    context: { db },
    constants: { C: { tasks: 'grading_tasks' } },
    audit: { monitor: () => {} },
    utils: { ...require('../shared/utils'), randomId: () => 'failure-archive-unavailable', now: () => new Date('2026-08-20T00:00:00.000Z') },
    taskError: { mapTaskFailure: () => ({ status: 'FAILED', stage: 'FAILED', errorCode: 'ARK_REQUEST_FAILED', userMessage: 'safe', userSuggestion: '', retryable: false, failureCategory: 'MODEL_OUTPUT' }) }
  });
  const result = await executeGradingTask({
    taskId,
    runtime: {
      claim: async () => ({ reason: 'CLAIMED', task }),
      loadTask: runtime.loadTask,
      process: async () => { throw Object.assign(new Error('provider unavailable'), { code: 'ARK_REQUEST_FAILED' }); },
      fail: runtime.fail,
      defaultStage: runtime.defaultStage
    }
  });
  assert.equal(result.outcome, 'FAILED');
  assert.equal(result.errorCode, 'ARK_REQUEST_FAILED');
  assert.equal(collections.grading_tasks.get(taskId).status, 'FAILED');
  assert.equal(collections.task_failure_cases.has(taskId), false);
});
