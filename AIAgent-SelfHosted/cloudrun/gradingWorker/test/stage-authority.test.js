const assert = require('node:assert/strict');
const test = require('node:test');

const { executeGradingTask } = require('../shared/grading-core/execute-grading-task');
const { finishWorkerState, STAGE_HANDOFF_MODE, RUNTIME_BUILD_ID } = require('../server');


test('runtime identifies the atomic business-payload handoff build', () => {
  assert.equal(STAGE_HANDOFF_MODE, 'atomic_payload_authority_v4');
  assert.equal(RUNTIME_BUILD_ID, 'build-20260815-primary-review-question-contract-v10.9.0');
});

function preclaim() {
  return {
    workerLeaseOwner: 'owner-stage-authority',
    workerAttempt: 4,
    workerLeaseUntil: new Date(Date.now() + 300000)
  };
}

test('executeGradingTask treats processResult.nextStage as authoritative when CloudBase readback is stale', async () => {
  const claimedTask = {
    _id: 'task-stale-review-readback',
    status: 'PROCESSING',
    currentStage: 'REVIEW_GRADING'
  };
  let reads = 0;
  const runtime = {
    loadTask: async () => {
      reads += 1;
      return { ...claimedTask };
    },
    process: async () => ({
      outcome: 'CONTINUE',
      nextStage: 'FINALIZING_RESULT'
    }),
    fail: async () => true,
    defaultStage: 'PREPARING_IMAGES'
  };

  const result = await executeGradingTask({
    taskId: claimedTask._id,
    runtime,
    preclaimedContext: preclaim(),
    executionFence: preclaim()
  });

  assert.equal(reads, 2);
  assert.equal(result.outcome, 'CONTINUE');
  assert.equal(result.nextStage, 'FINALIZING_RESULT');
  assert.equal(result.observedStage, 'REVIEW_GRADING');
});

test('executeGradingTask keeps a completed process result when the task readback is stale', async () => {
  const claimedTask = {
    _id: 'task-stale-completed-readback',
    status: 'PROCESSING',
    currentStage: 'FINALIZING_RESULT'
  };
  const runtime = {
    loadTask: async () => ({
      ...claimedTask,
      status: 'QUEUED',
      resultId: null
    }),
    process: async () => ({
      outcome: 'COMPLETED',
      resultId: claimedTask._id
    }),
    fail: async () => true,
    defaultStage: 'PREPARING_IMAGES'
  };

  const result = await executeGradingTask({
    taskId: claimedTask._id,
    runtime,
    preclaimedContext: preclaim(),
    executionFence: preclaim()
  });

  assert.equal(result.outcome, 'COMPLETED');
  assert.equal(result.resultId, claimedTask._id);
});

test('finishWorkerState finalizes from an authoritative process resultId when readback is stale', async () => {
  const document = {
    _id: 'task-completion-authority',
    status: 'PROCESSING',
    currentStage: 'FINALIZING_RESULT',
    resultId: null,
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-completion',
    workerAttempt: 6
  };
  const reference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => {
      Object.assign(document, patch.data || patch);
      return { updated: 1 };
    }
  };
  const runtime = {
    context: {
      db: {
        collection: () => ({
          doc: () => reference,
          where: () => ({
            update: async (patch) => {
              Object.assign(document, patch.data || patch);
              return { updated: 1 };
            }
          })
        })
      }
    }
  };
  const fence = {
    workerLeaseOwner: document.workerLeaseOwner,
    workerAttempt: document.workerAttempt
  };

  const result = await finishWorkerState(
    runtime,
    document._id,
    fence,
    'COMPLETED',
    undefined,
    null,
    document._id
  );

  assert.equal(result.code, 'TASK_COMPLETED');
  assert.equal(document.status, 'COMPLETED');
  assert.equal(document.currentStage, 'COMPLETED');
  assert.equal(document.resultId, document._id);
  assert.equal(document.workerQueueStatus, 'COMPLETED');
});


test('executeGradingTask propagates the exact stage handoff payload and token', async () => {
  const claimedTask = {
    _id: 'task-handoff-payload-propagation',
    status: 'PROCESSING',
    currentStage: 'REVIEW_GRADING'
  };
  const handoffPatch = {
    primaryDraft: { questions: [{ sourceKey: 'q-1' }] },
    reviewDraft: { questions: [{ sourceKey: 'q-1' }] },
    mergedDraft: { questions: [{ sourceKey: 'q-1' }] },
    stageHandoffToken: 'stage_handoff_test'
  };
  const runtime = {
    loadTask: async () => ({ ...claimedTask }),
    process: async () => ({
      outcome: 'CONTINUE',
      nextStage: 'FINALIZING_RESULT',
      handoffPatch,
      handoffToken: 'stage_handoff_test'
    }),
    fail: async () => true,
    defaultStage: 'PREPARING_IMAGES'
  };

  const result = await executeGradingTask({
    taskId: claimedTask._id,
    runtime,
    preclaimedContext: preclaim(),
    executionFence: preclaim()
  });

  assert.equal(result.outcome, 'CONTINUE');
  assert.equal(result.nextStage, 'FINALIZING_RESULT');
  assert.equal(result.handoffToken, 'stage_handoff_test');
  assert.deepEqual(result.handoffPatch, handoffPatch);
});
