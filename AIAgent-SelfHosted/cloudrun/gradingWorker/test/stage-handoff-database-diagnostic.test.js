'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { finishWorkerState, inspectDatabasePatch } = require('../server');

function reviewTask(overrides = {}) {
  return {
    _id: 'task-review-diagnostic',
    status: 'PROCESSING',
    currentStage: 'REVIEW_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'review-owner',
    workerAttempt: 4,
    requestStage: 'hardProblemReview',
    modelProvider: 'qwen3_vl_plus',
    modelName: 'qwen3.7-plus',
    ...overrides
  };
}

function fence() {
  return { workerLeaseOwner: 'review-owner', workerAttempt: 4 };
}

function createPathNotViableDatabase(task) {
  const set = (value) => ({ __cloudbaseCommand: 'set', value });
  let receivedPatch;
  const collection = {
    doc: () => ({ get: async () => ({ data: [task] }) }),
    where: () => ({
      update: async (patch) => {
        receivedPatch = patch;
        for (const [key, value] of Object.entries(patch)) {
          if (value && value.__cloudbaseCommand === 'set') {
            task[key] = value.value;
            continue;
          }
          if (task[key] === null && value && typeof value === 'object' && !Array.isArray(value)) {
            throw new Error(`(PathNotViable) Cannot create field '_modelDiagnostics' in element {${key}: null}`);
          }
          task[key] = value;
        }
        return { updated: 1 };
      }
    })
  };
  return {
    runtime: { context: { db: { collection: () => collection, command: { set } } } },
    getReceivedPatch: () => receivedPatch
  };
}

test('REVIEW handoff replaces a null primaryDraft and preserves model diagnostics', async () => {
  const task = reviewTask({ primaryDraft: null });
  const { runtime } = createPathNotViableDatabase(task);
  const handoffPatch = {
    primaryDraft: { questions: [], _modelDiagnostics: { provider: 'qwen3_vl_plus' } },
    reviewDraft: { questions: [] },
    mergedDraft: { questions: [] }
  };

  const result = await finishWorkerState(runtime, task._id, fence(), 'PENDING', undefined, 'FINALIZING_RESULT', null, handoffPatch);

  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.deepEqual(task.primaryDraft, { questions: [], _modelDiagnostics: { provider: 'qwen3_vl_plus' } });
  assert.deepEqual(task.reviewDraft, { questions: [] });
  assert.deepEqual(task.mergedDraft, { questions: [] });
});

test('REVIEW handoff uses top-level set without changing its business patch or Date diagnostics', async () => {
  const task = reviewTask({ primaryDraft: { questions: [{ sourceKey: 'primary-1' }] } });
  const { runtime, getReceivedPatch } = createPathNotViableDatabase(task);
  const handoffAt = new Date('2026-08-07T00:00:00.000Z');
  const handoffPatch = {
    primaryDraft: null,
    hardProblemEvidenceDraft: { capturedAt: handoffAt },
    stageHandoffAt: handoffAt
  };
  const inspection = inspectDatabasePatch({ handoffPatch, nested: { missing: undefined } });

  const result = await finishWorkerState(runtime, task._id, fence(), 'PENDING', undefined, 'FINALIZING_RESULT', null, handoffPatch);
  const writePatch = getReceivedPatch();

  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.equal(task.primaryDraft, null);
  assert.equal(writePatch.primaryDraft.__cloudbaseCommand, 'set');
  assert.equal(writePatch.hardProblemEvidenceDraft.__cloudbaseCommand, 'set');
  assert.equal(writePatch.stageHandoffAt.__cloudbaseCommand, 'set');
  assert.equal(writePatch.status, 'QUEUED');
  assert.equal(writePatch.workerStatus, 'PENDING');
  assert.deepEqual(handoffPatch, {
    primaryDraft: null,
    hardProblemEvidenceDraft: { capturedAt: handoffAt },
    stageHandoffAt: handoffAt
  });
  assert.equal(inspection.invalidFieldPaths.some((item) => item.type === 'non_plain_object:Date'), false);
  assert.deepEqual(inspection.invalidFieldPaths, [{ path: 'nested.missing', type: 'undefined' }]);
});
