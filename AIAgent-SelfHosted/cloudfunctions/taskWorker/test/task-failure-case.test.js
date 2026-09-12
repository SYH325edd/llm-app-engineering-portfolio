'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ARCHIVE_VERSION,
  TASK_FAILURE_COLLECTION,
  TRAINING_FAILURE_COLLECTION,
  buildTaskFailureCase,
  buildTrainingFailureEvent,
  archiveTaskFailureCase,
  archiveTrainingFailureEvent,
  reconcileTaskFailureCases
} = require('../shared/task-failure-case');

function createFakeDb(initial = {}, failingSets = new Set(), afterSet = null) {
  const collections = new Map(Object.entries(initial).map(([name, documents]) => [
    name,
    new Map(Object.entries(documents))
  ]));

  function getCollection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }

  function snapshot(document) {
    return { data: document === undefined ? [] : [document] };
  }

  return {
    collection(name) {
      const documents = getCollection(name);
      const collection = {
        doc(id) {
          return {
            async get() {
              return snapshot(documents.get(id));
            },
            async set({ data }) {
              if (failingSets.has(`${name}/${id}`)) throw new Error(`set failed: ${name}/${id}`);
              documents.set(id, data);
              if (afterSet) await afterSet({ name, id, documents, data });
            },
            async update({ data }) {
              if (!documents.has(id)) throw new Error(`missing document: ${name}/${id}`);
              documents.set(id, { ...documents.get(id), ...data });
            }
          };
        },
        where(condition) {
          const matched = [...documents.values()].filter((document) => Object.entries(condition)
            .every(([key, value]) => document?.[key] === value));
          return {
            async update({ data }) {
              const matched = [...documents.entries()].filter(([id, document]) => Object.entries(condition)
                .every(([key, value]) => key === '_id' ? id === value : document?.[key] === value));
              for (const [id, document] of matched) documents.set(id, { ...document, ...data });
              return { updated: matched.length };
            },
            orderBy(field, direction) {
              const ordered = [...matched].sort((left, right) => {
                const delta = new Date(left?.[field] || 0) - new Date(right?.[field] || 0);
                return direction === 'desc' ? -delta : delta;
              });
              return {
                skip(offset) {
                  return {
                    limit(limit) {
                      return { async get() { return { data: ordered.slice(offset, offset + limit) }; } };
                    }
                  };
                }
              };
            }
          };
        }
      };
      return collection;
    },
    read(name, id) {
      return getCollection(name).get(id);
    }
  };
}

test('buildTaskFailureCase keeps identity, date, sequence, attempts, and safe metadata only', () => {
  const failedAt = new Date('2026-08-20T08:00:00.000Z');
  const doc = buildTaskFailureCase({
    task: {
      _id: 'task-1', taskName: '8月20日第3次训练', studentId: 'student-1', studentName: '小明',
      grade: '五年级', className: '北京', taskDateKey: '2026-08-20', dailySequence: 3,
      mode: 'CARELESS_TRAINING', carelessTrainingType: 'READING', status: 'FAILED',
      failedStage: 'PRIMARY_GRADING', currentStage: 'FAILED', attempt: 1,
      workerAttempt: 2, workerDispatchAttempt: 3, studentImageFileIds: ['cloud://secret-image'],
      answerImageFileIds: ['cloud://secret-answer'], questionCount: 4, failedAt
    },
    error: Object.assign(new Error('Bearer secret-token cloud://private-file'), {
      code: 'ARK_REQUEST_FAILED', providerRequestId: 'provider-secret'
    }),
    archiveSource: 'taskWorker', runtimeBuildId: null, archivedAt: failedAt, diagnosticPresent: false
  });
  assert.equal(doc.taskId, 'task-1');
  assert.equal(doc.studentName, '小明');
  assert.equal(doc.taskDateKey, '2026-08-20');
  assert.equal(doc.dailyTrainingSequence, 3);
  assert.equal(doc.workerAttempt, 2);
  assert.equal(doc.studentImageCount, 1);
  assert.equal(doc.answerImageCount, 1);
  assert.equal(doc.providerRequestIdPresent, true);
  const serialized = JSON.stringify(doc);
  for (const forbidden of ['cloud://secret-image', 'cloud://secret-answer', 'secret-token', 'provider-secret']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('buildTrainingFailureEvent records action and session version without request payload', () => {
  const failedAt = new Date('2026-08-20T08:00:00.000Z');
  const doc = buildTrainingFailureEvent({
    task: { _id: 'task-2', taskName: '8月20日第2次训练', taskDateKey: '2026-08-20', dailySequence: 2, mode: 'HARD_PROBLEM_CHECK' },
    user: { userId: 'student-2', name: '小红' },
    action: 'submitHardProblemExplanation',
    event: { taskId: 'task-2', sessionVersion: 7, requestId: 'request-secret', answer: '学生完整讲解' },
    error: Object.assign(new Error('训练请求失败'), { code: 'TRAINING_REQUEST_FAILED' }),
    failedAt
  });
  assert.equal(doc.trainingAction, 'submitExplanation');
  assert.equal(doc.sessionVersion, 7);
  assert.equal(doc.requestIdPresent, true);
  assert.equal(JSON.stringify(doc).includes('学生完整讲解'), false);
  assert.equal(JSON.stringify(doc).includes('request-secret'), false);
});

test('failure archives do not retain raw error messages or stacks', () => {
  const sentinels = ['SECRET_QUESTION', 'SECRET_ANSWER', 'SECRET_PROMPT', 'SECRET_MODEL_OUTPUT', 'SECRET_PROVIDER_REQUEST'];
  const rawFailureText = sentinels.join(' ');
  const error = Object.assign(new Error(rawFailureText), {
    code: 'ARK_REQUEST_FAILED',
    stack: `Error: ${rawFailureText}\n    at grading (${rawFailureText})`
  });
  const taskDoc = buildTaskFailureCase({
    task: { _id: 'task-no-raw-error', status: 'FAILED' },
    error,
    archiveSource: 'taskWorker',
    archivedAt: new Date('2026-08-20T08:00:00.000Z')
  });
  const trainingDoc = buildTrainingFailureEvent({
    eventId: 'event-no-raw-error',
    task: { _id: 'task-no-raw-error' },
    user: { userId: 'student-no-raw-error' },
    action: 'submitHardProblemExplanation',
    event: { taskId: 'task-no-raw-error' },
    error,
    failedAt: new Date('2026-08-20T08:00:00.000Z')
  });
  assert.equal(taskDoc.safeMessage, 'TASK_FAILURE:ARK_REQUEST_FAILED');
  assert.deepEqual(taskDoc.stackTop, []);
  assert.equal(trainingDoc.safeMessage, 'TRAINING_FAILURE:ARK_REQUEST_FAILED');
  const serialized = JSON.stringify({ taskDoc, trainingDoc });
  for (const sentinel of sentinels) assert.equal(serialized.includes(sentinel), false);
});

test('archiveTaskFailureCase writes a safe case before marking a failed task', async () => {
  const archivedAt = new Date('2026-08-20T08:00:00.000Z');
  const db = createFakeDb({
    grading_tasks: {
      'task-3': { _id: 'task-3', status: 'FAILED', taskName: '第3次训练', studentImageFileIds: ['cloud://image'] }
    },
    hard_problem_diagnostics: { 'task-3': { taskId: 'task-3' } }
  });
  const result = await archiveTaskFailureCase({
    db,
    task: db.read('grading_tasks', 'task-3'),
    error: Object.assign(new Error('Bearer private'), { code: 'FAILED' }),
    archiveSource: 'taskWorker',
    runtimeBuildId: 'build-1',
    archivedAt
  });
  assert.deepEqual(result, { archived: true, taskId: 'task-3' });
  assert.equal(db.read(TASK_FAILURE_COLLECTION, 'task-3').diagnosticPresent, true);
  assert.equal(db.read(TASK_FAILURE_COLLECTION, 'task-3').safeMessage.includes('private'), false);
  assert.equal(db.read('grading_tasks', 'task-3').status, 'FAILED');
  assert.equal(db.read('grading_tasks', 'task-3').failureArchiveVersion, ARCHIVE_VERSION);
  assert.equal(db.read('grading_tasks', 'task-3').failureArchivedAt, archivedAt);
});

test('archiveTaskFailureCase is idempotent for the same task failure generation', async () => {
  const db = createFakeDb({
    grading_tasks: {
      'task-idempotent': { _id: 'task-idempotent', status: 'FAILED', failureId: 'failure-1', failedAt: new Date('2026-08-20T08:00:00.000Z') }
    }
  });
  const task = db.read('grading_tasks', 'task-idempotent');
  const first = await archiveTaskFailureCase({ db, task, archiveSource: 'taskWorker' });
  const second = await archiveTaskFailureCase({ db, task: db.read('grading_tasks', 'task-idempotent'), archiveSource: 'taskWorker' });

  assert.deepEqual(first, { archived: true, taskId: 'task-idempotent' });
  assert.deepEqual(second, { archived: false, taskId: 'task-idempotent' });
  assert.equal(db.read('grading_tasks', 'task-idempotent').failureArchiveFailureId, 'failure-1');
});

test('stale archive cannot mark a task after its failure generation changes', async () => {
  let changed = false;
  const db = createFakeDb({
    grading_tasks: {
      'task-stale-archive': { _id: 'task-stale-archive', status: 'FAILED', failureId: 'failure-1', failedAt: new Date('2026-08-20T08:00:00.000Z') }
    }
  }, new Set(), async ({ name }) => {
    if (name !== TASK_FAILURE_COLLECTION || changed) return;
    changed = true;
    Object.assign(db.read('grading_tasks', 'task-stale-archive'), {
      status: 'QUEUED', failureId: null, failureArchivedAt: null, failureArchiveVersion: null,
      failureArchiveFailureId: null, failureArchiveGeneration: null
    });
  });

  const result = await archiveTaskFailureCase({ db, task: db.read('grading_tasks', 'task-stale-archive'), archiveSource: 'reconciler' });

  assert.deepEqual(result, { archived: false, taskId: 'task-stale-archive' });
  assert.equal(db.read('grading_tasks', 'task-stale-archive').failureArchivedAt, null);
  assert.equal(db.read('grading_tasks', 'task-stale-archive').failureArchiveFailureId, null);
});

test('a retried task archives its second failed generation after an immediate archive failure', async () => {
  const failures = new Set();
  const db = createFakeDb({
    grading_tasks: {
      'task-retry-archive': { _id: 'task-retry-archive', status: 'FAILED', failureId: 'failure-1', createdAt: new Date('2026-08-20T07:00:00.000Z'), failedAt: new Date('2026-08-20T08:00:00.000Z') }
    }
  }, failures);
  await archiveTaskFailureCase({ db, task: db.read('grading_tasks', 'task-retry-archive'), archiveSource: 'taskWorker' });
  Object.assign(db.read('grading_tasks', 'task-retry-archive'), {
    status: 'QUEUED', failureId: null, failureArchivedAt: null, failureArchiveVersion: null,
    failureArchiveFailureId: null, failureArchiveGeneration: null
  });
  Object.assign(db.read('grading_tasks', 'task-retry-archive'), {
    status: 'FAILED', failureId: 'failure-2', failedAt: new Date('2026-08-20T10:00:00.000Z')
  });
  failures.add(`${TASK_FAILURE_COLLECTION}/task-retry-archive`);
  await assert.rejects(
    archiveTaskFailureCase({ db, task: db.read('grading_tasks', 'task-retry-archive'), archiveSource: 'taskWorker' }),
    /set failed/
  );
  failures.delete(`${TASK_FAILURE_COLLECTION}/task-retry-archive`);

  const reconciled = await reconcileTaskFailureCases({ db, limit: 20, now: new Date('2026-08-20T11:00:00.000Z') });
  assert.deepEqual(reconciled, { scanned: 1, archived: 1, skipped: 0, nextOffset: 0 });
  assert.equal(db.read(TASK_FAILURE_COLLECTION, 'task-retry-archive').failureId, 'failure-2');
  assert.equal(db.read('grading_tasks', 'task-retry-archive').failureArchiveFailureId, 'failure-2');
});

test('archiveTrainingFailureEvent uses a generated identifier and never stores request fields', async () => {
  const db = createFakeDb();
  const result = await archiveTrainingFailureEvent({
    db,
    task: { _id: 'task-4', studentName: '小李' },
    user: { userId: 'student-4', name: '小李' },
    action: 'submitHardProblemRetell',
    event: { taskId: 'task-4', sessionVersion: 2, requestId: 'private-request', body: 'private-body' },
    error: new Error('failed'),
    failedAt: new Date('2026-08-20T08:00:00.000Z')
  });
  assert.equal(result.archived, true);
  assert.match(result.eventId, /^training_failure_/);
  const stored = db.read(TRAINING_FAILURE_COLLECTION, result.eventId);
  assert.equal(stored.trainingAction, 'submitRetell');
  assert.equal(JSON.stringify(stored).includes('private-request'), false);
  assert.equal(JSON.stringify(stored).includes('private-body'), false);
});

test('reconcileTaskFailureCases skips an already marked task without recreating a deleted case', async () => {
  const markedAt = new Date('2026-08-19T08:00:00.000Z');
  const db = createFakeDb({
    grading_tasks: {
      'task-marked': {
        _id: 'task-marked', status: 'FAILED', createdAt: new Date('2026-08-20T08:00:00.000Z'),
        failureId: 'failure-marked', failureArchivedAt: markedAt, failureArchiveVersion: ARCHIVE_VERSION,
        failureArchiveFailureId: 'failure-marked', failureArchiveGeneration: 'failure:failure-marked'
      }
    }
  });
  const result = await reconcileTaskFailureCases({ db, limit: 20, now: new Date('2026-08-20T09:00:00.000Z') });
  assert.deepEqual(result, { scanned: 1, archived: 0, skipped: 1, nextOffset: 0 });
  assert.equal(db.read(TASK_FAILURE_COLLECTION, 'task-marked'), undefined);
});

test('reconcileTaskFailureCases continues after one archive write fails', async () => {
  const db = createFakeDb({
    grading_tasks: {
      'task-fails': { _id: 'task-fails', status: 'FAILED', createdAt: new Date('2026-08-20T10:00:00.000Z') },
      'task-archives': { _id: 'task-archives', status: 'FAILED', createdAt: new Date('2026-08-20T09:00:00.000Z') }
    }
  }, new Set([`${TASK_FAILURE_COLLECTION}/task-fails`]));
  const result = await reconcileTaskFailureCases({ db, limit: 20, now: new Date('2026-08-20T11:00:00.000Z') });
  assert.deepEqual(result, { scanned: 2, archived: 1, skipped: 1, nextOffset: 0 });
  assert.equal(db.read(TASK_FAILURE_COLLECTION, 'task-archives').taskId, 'task-archives');
  assert.equal(db.read('grading_tasks', 'task-archives').failureArchiveVersion, ARCHIVE_VERSION);
});

test('failure archive creates a missing archive collection once and retries the write', async () => {
  const existing = new Set(['grading_tasks', 'hard_problem_diagnostics']);
  const stores = new Map([
    ['grading_tasks', new Map([['task-create-missing', { _id: 'task-create-missing', status: 'FAILED', failureId: 'failure-create-missing', failedAt: new Date('2026-08-20T08:00:00.000Z') }]])],
    ['hard_problem_diagnostics', new Map()]
  ]);
  let createCalls = 0;
  const missingError = () => Object.assign(new Error('collection not exist'), { code: 'DATABASE_COLLECTION_NOT_EXIST' });
  const db = {
    async createCollection(name) {
      createCalls += 1;
      existing.add(name);
      if (!stores.has(name)) stores.set(name, new Map());
    },
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              if (!existing.has(name)) throw missingError();
              const value = stores.get(name)?.get(id);
              return { data: value === undefined ? [] : [value] };
            },
            async set({ data }) {
              if (!existing.has(name)) throw missingError();
              if (!stores.has(name)) stores.set(name, new Map());
              stores.get(name).set(id, data);
            }
          };
        },
        where(condition) {
          return {
            async update({ data }) {
              if (!existing.has(name)) throw missingError();
              let updated = 0;
              for (const [id, value] of stores.get(name) || []) {
                const match = Object.entries(condition).every(([key, expected]) => key === '_id' ? id === expected : value?.[key] === expected);
                if (match) {
                  stores.get(name).set(id, { ...value, ...data });
                  updated += 1;
                }
              }
              return { updated };
            }
          };
        }
      };
    }
  };

  const result = await archiveTaskFailureCase({
    db,
    task: stores.get('grading_tasks').get('task-create-missing'),
    archiveSource: 'taskWorker'
  });

  assert.deepEqual(result, { archived: true, taskId: 'task-create-missing' });
  assert.equal(createCalls, 1);
  assert.equal(stores.get(TASK_FAILURE_COLLECTION).get('task-create-missing').taskId, 'task-create-missing');
});

test('training failure archive creates a missing event collection once and retries the write', async () => {
  const existing = new Set();
  const stores = new Map();
  let createCalls = 0;
  const missingError = () => Object.assign(new Error('collection not found'), { code: 'COLLECTION_NOT_FOUND' });
  const db = {
    async createCollection(name) {
      createCalls += 1;
      existing.add(name);
      stores.set(name, new Map());
    },
    collection(name) {
      return {
        doc(id) {
          return {
            async set({ data }) {
              if (!existing.has(name)) throw missingError();
              stores.get(name).set(id, data);
            }
          };
        }
      };
    }
  };

  const result = await archiveTrainingFailureEvent({
    db,
    user: { userId: 'student-create-missing', name: '学生' },
    action: 'submitHardProblemExplanation',
    event: { taskId: 'task-training-create-missing' },
    error: Object.assign(new Error('failed'), { code: 'TRAINING_REQUEST_FAILED' })
  });

  assert.equal(result.archived, true);
  assert.equal(createCalls, 1);
  assert.equal(stores.get(TRAINING_FAILURE_COLLECTION).get(result.eventId).taskId, 'task-training-create-missing');
});
