const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { finishWorkerState, sanitizeStageHandoffPatch } = require('../server');
const { getFirstDocument } = require('../document-snapshot');

function createRuntime(document) {
  const reference = {
    get: async () => ({ data: [document] }),
    update: async (patch) => Object.assign(document, patch.data || patch)
  };
  return {
    context: {
      db: {
        collection: () => ({ doc: () => reference }),
        runTransaction: async (callback) => callback({ collection: () => ({ doc: () => reference }) })
      }
    }
  };
}

function fence(document) {
  return {
    workerLeaseOwner: document.workerLeaseOwner,
    workerAttempt: document.workerAttempt,
    workerLeaseUntil: document.workerLeaseUntil
  };
}

test('a completed business stage returns the worker queue to PENDING for the next stage', async () => {
  const document = {
    status: 'QUEUED',
    currentStage: 'PRIMARY_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-1',
    workerAttempt: 1
  };
  const result = await finishWorkerState(createRuntime(document), 'task-1', fence(document), 'PENDING');
  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.equal(document.status, 'QUEUED');
  assert.equal(document.currentStage, 'PRIMARY_GRADING');
  assert.equal(document.workerQueueStatus, 'PENDING');
  assert.equal(document.workerStatus, 'PENDING');
  assert.ok(document.workerNextDispatchAt instanceof Date);
});

test('answer and confirmation states stop background scheduling as WAITING_USER', async () => {
  for (const status of ['NEED_ANSWER', 'NEED_CONFIRMATION']) {
    const document = {
      status,
      currentStage: status,
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: `owner-${status}`,
      workerAttempt: 1
    };
    const result = await finishWorkerState(createRuntime(document), document.workerLeaseOwner, fence(document), 'WAITING_USER');
    assert.equal(result.code, 'TASK_WAITING_USER');
    assert.equal(document.workerQueueStatus, 'WAITING_USER');
    assert.equal(document.workerStatus, 'WAITING_USER');
    assert.equal(document.workerNextDispatchAt, null);
  }
});

test('the worker refuses false completion when resultId is missing', async () => {
  const document = {
    status: 'COMPLETED',
    currentStage: 'COMPLETED',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-1',
    workerAttempt: 1
  };
  const result = await finishWorkerState(createRuntime(document), 'task-1', fence(document), 'COMPLETED');
  assert.equal(result.code, 'TASK_RESULT_NOT_READY');
  assert.equal(document.status, 'FAILED');
  assert.equal(document.workerQueueStatus, 'FAILED');
});

test('the worker completes only when business status and resultId both exist', async () => {
  const document = {
    status: 'COMPLETED',
    currentStage: 'COMPLETED',
    resultId: 'result-1',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-1',
    workerAttempt: 1
  };
  const result = await finishWorkerState(createRuntime(document), 'task-1', fence(document), 'COMPLETED');
  assert.equal(result.code, 'TASK_COMPLETED');
  assert.equal(document.workerQueueStatus, 'COMPLETED');
  assert.equal(document.workerStatus, 'COMPLETED');
});

test('single-document snapshots support CloudRun arrays, legacy objects, and nested transaction envelopes', () => {
  assert.deepEqual(getFirstDocument({ data: [{ _id: 'array' }] }), { _id: 'array' });
  assert.deepEqual(getFirstDocument({ data: { _id: 'object' } }), { _id: 'object' });
  assert.deepEqual(
    getFirstDocument({ data: { data: [{ _id: 'nested-array' }], requestId: 'request-1' }, requestId: 'outer-request' }),
    { _id: 'nested-array' }
  );
  assert.deepEqual(
    getFirstDocument({ result: { body: { data: { _id: 'nested-object' } } }, errMsg: 'ok' }),
    { _id: 'nested-object' }
  );
  assert.equal(getFirstDocument({ data: [] }), null);
  assert.equal(getFirstDocument({ data: {}, requestId: 'empty-response' }), null);
});

test('CloudRun production code does not treat a raw snapshot.data value as one document', () => {
  const workerRoot = path.resolve(__dirname, '..');
  const productionFiles = [
    'server.js',
    'claim-task.js',
    'shared/grading-core/execute-grading-task.js',
    'runtime/taskWorker-shared/checkin.js',
    'runtime/taskWorker-shared/strategy/remote.js'
  ];
  for (const relative of productionFiles) {
    const source = fs.readFileSync(path.join(workerRoot, relative), 'utf8');
    assert.doesNotMatch(source, /\(await[^\n]*\.get\(\)\)\.data/, `${relative} must normalize single-document reads`);
  }
});

test('stage handoff atomically advances a stale PROCESSING snapshot to the expected next stage', async () => {
  const document = {
    status: 'PROCESSING',
    currentStage: 'REVIEW_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-stale',
    workerAttempt: 3
  };
  const result = await finishWorkerState(
    createRuntime(document),
    'task-stale-handoff',
    fence(document),
    'PENDING',
    undefined,
    'FINALIZING_RESULT'
  );
  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.equal(document.status, 'QUEUED');
  assert.equal(document.currentStage, 'FINALIZING_RESULT');
  assert.equal(document.workerQueueStatus, 'PENDING');
  assert.equal(document.workerStatus, 'PENDING');
  assert.equal(document.workerLeaseOwner, null);
});

test('stage handoff is idempotent when the expected next stage is already pending', async () => {
  const document = {
    status: 'QUEUED',
    currentStage: 'FINALIZING_RESULT',
    workerQueueStatus: 'PENDING',
    workerStatus: 'PENDING',
    workerLeaseOwner: null,
    workerAttempt: 3
  };
  const result = await finishWorkerState(
    createRuntime(document),
    'task-already-pending',
    { workerLeaseOwner: 'old-owner', workerAttempt: 2 },
    'PENDING',
    undefined,
    'FINALIZING_RESULT'
  );
  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.equal(result.idempotent, true);
  assert.equal(document.status, 'QUEUED');
  assert.equal(document.workerQueueStatus, 'PENDING');
});

test('stage handoff does not overwrite a newer worker that already claimed the expected stage', async () => {
  const document = {
    status: 'PROCESSING',
    currentStage: 'FINALIZING_RESULT',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'new-owner',
    workerAttempt: 4
  };
  const result = await finishWorkerState(
    createRuntime(document),
    'task-newer-worker',
    { workerLeaseOwner: 'old-owner', workerAttempt: 3 },
    'PENDING',
    undefined,
    'FINALIZING_RESULT'
  );
  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.equal(result.idempotent, true);
  assert.equal(document.workerLeaseOwner, 'new-owner');
  assert.equal(document.workerAttempt, 4);
  assert.equal(document.status, 'PROCESSING');
});

test('stage handoff accepts an empty SDK update result after verifying the applied patch', async () => {
  const document = {
    status: 'PROCESSING',
    currentStage: 'REVIEW_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-empty-result',
    workerAttempt: 7
  };
  const reference = {
    get: async () => ({ data: [document] })
  };
  const db = {
    collection: () => ({
      doc: () => reference,
      where: () => ({
        update: async (patch) => {
          Object.assign(document, patch);
          return {};
        }
      })
    })
  };
  const result = await finishWorkerState(
    { context: { db } },
    'task-empty-update-result',
    fence(document),
    'PENDING',
    undefined,
    'FINALIZING_RESULT'
  );
  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.equal(document.status, 'QUEUED');
  assert.equal(document.currentStage, 'FINALIZING_RESULT');
  assert.equal(document.workerQueueStatus, 'PENDING');
});

test('stage handoff never regresses a task whose persisted stage is already newer', async () => {
  const document = {
    status: 'QUEUED',
    currentStage: 'FINALIZING_RESULT',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-no-regression',
    workerAttempt: 9
  };
  const result = await finishWorkerState(
    createRuntime(document),
    'task-no-stage-regression',
    fence(document),
    'PENDING',
    undefined,
    'REVIEW_GRADING'
  );
  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.equal(result.idempotent, true);
  assert.equal(document.currentStage, 'FINALIZING_RESULT');
  assert.equal(document.workerQueueStatus, 'RUNNING');
});


test('stage handoff atomically persists review drafts with FINALIZING_RESULT', async () => {
  const document = {
    status: 'PROCESSING',
    currentStage: 'REVIEW_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-payload',
    workerAttempt: 11
  };
  const handoffPatch = {
    primaryDraft: { questions: [{ sourceKey: 'q-1' }] },
    reviewDraft: { questions: [{ sourceKey: 'q-1' }] },
    mergedDraft: { questions: [{ sourceKey: 'q-1' }] },
    finalizationRecoveryCount: 0,
    stageHandoffToken: 'stage_handoff_payload',
    stageHandoffTo: 'FINALIZING_RESULT'
  };
  const result = await finishWorkerState(
    createRuntime(document),
    'task-payload-handoff',
    fence(document),
    'PENDING',
    undefined,
    'FINALIZING_RESULT',
    null,
    handoffPatch,
    'stage_handoff_payload'
  );
  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.equal(document.currentStage, 'FINALIZING_RESULT');
  assert.deepEqual(document.primaryDraft, handoffPatch.primaryDraft);
  assert.deepEqual(document.reviewDraft, handoffPatch.reviewDraft);
  assert.deepEqual(document.mergedDraft, handoffPatch.mergedDraft);
  assert.equal(document.stageHandoffToken, 'stage_handoff_payload');
  assert.equal(document.workerQueueStatus, 'PENDING');
});

test('same-stage idempotency requires the matching handoff token', async () => {
  const document = {
    status: 'QUEUED',
    currentStage: 'FINALIZING_RESULT',
    workerQueueStatus: 'PENDING',
    workerStatus: 'PENDING',
    workerLeaseOwner: null,
    workerAttempt: 3,
    stageHandoffToken: 'older-token'
  };
  const result = await finishWorkerState(
    createRuntime(document),
    'task-token-mismatch',
    { workerLeaseOwner: 'old-owner', workerAttempt: 2 },
    'PENDING',
    undefined,
    'FINALIZING_RESULT',
    null,
    { stageHandoffToken: 'new-token', mergedDraft: { questions: [] } },
    'new-token'
  );
  assert.equal(result.code, 'TASK_WORKER_LEASE_LOST');
  assert.equal(document.stageHandoffToken, 'older-token');
});

test('handoff sanitizer removes worker lifecycle fields but keeps business drafts', () => {
  const sanitized = sanitizeStageHandoffPatch({
    status: 'COMPLETED',
    currentStage: 'COMPLETED',
    workerQueueStatus: 'FAILED',
    workerLeaseOwner: 'forbidden',
    resultId: 'forbidden-result',
    primaryDraft: { questions: [] },
    reviewDraft: { questions: [] },
    mergedDraft: { questions: [] },
    stageHandoffToken: 'allowed-token'
  });
  assert.equal(Object.hasOwn(sanitized, 'status'), false);
  assert.equal(Object.hasOwn(sanitized, 'currentStage'), false);
  assert.equal(Object.hasOwn(sanitized, 'workerQueueStatus'), false);
  assert.equal(Object.hasOwn(sanitized, 'workerLeaseOwner'), false);
  assert.equal(Object.hasOwn(sanitized, 'resultId'), false);
  assert.deepEqual(sanitized.primaryDraft, { questions: [] });
  assert.equal(sanitized.stageHandoffToken, 'allowed-token');
});

test('an ambiguous SDK update is not treated as success from lease ownership alone', async () => {
  const document = {
    status: 'PROCESSING',
    currentStage: 'REVIEW_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-ambiguous',
    workerAttempt: 12
  };
  const db = {
    collection: () => ({
      doc: () => ({ get: async () => ({ data: [document] }) }),
      where: () => ({ update: async () => ({}) })
    })
  };
  const result = await finishWorkerState(
    { context: { db } },
    'task-ambiguous-write',
    fence(document),
    'PENDING',
    undefined,
    'FINALIZING_RESULT',
    null,
    { reviewDraft: { questions: [] }, stageHandoffToken: 'ambiguous-token' },
    'ambiguous-token'
  );
  assert.equal(result.code, 'TASK_WORKER_LEASE_LOST');
  assert.equal(document.currentStage, 'REVIEW_GRADING');
  assert.equal(document.reviewDraft, undefined);
});

test('an ambiguous SDK handoff accepts a serialized readback containing the complete nested payload', async () => {
  const document = {
    status: 'PROCESSING',
    currentStage: 'REVIEW_GRADING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: 'owner-serialized-readback',
    workerAttempt: 13
  };
  const clone = () => JSON.parse(JSON.stringify(document));
  const db = {
    collection: () => ({
      doc: () => ({ get: async () => ({ data: [clone()] }) }),
      where: () => ({
        update: async (patch) => {
          Object.assign(document, patch);
          return {};
        }
      })
    })
  };
  const nestedDraft = { questions: [{ sourceKey: 'q-serialized', stepFeedbacks: [{ stepIndex: 1 }] }] };
  const result = await finishWorkerState(
    { context: { db } },
    'task-serialized-readback',
    fence(document),
    'PENDING',
    undefined,
    'FINALIZING_RESULT',
    null,
    {
      primaryDraft: nestedDraft,
      reviewDraft: nestedDraft,
      mergedDraft: nestedDraft,
      stageHandoffToken: 'serialized-token',
      stageHandoffAt: new Date('2026-08-06T00:00:00.000Z')
    },
    'serialized-token'
  );
  assert.equal(result.code, 'TASK_STAGE_COMPLETED');
  assert.equal(result.idempotent, undefined);
  assert.equal(document.currentStage, 'FINALIZING_RESULT');
  assert.deepEqual(document.mergedDraft, nestedDraft);
});
