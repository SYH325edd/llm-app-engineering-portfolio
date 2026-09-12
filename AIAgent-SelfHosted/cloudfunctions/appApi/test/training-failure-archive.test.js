'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const context = require('../shared/context');
const { __test } = require('..');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fakeDb(seed = {}, options = {}) {
  const store = new Map();
  for (const [collectionName, documents] of Object.entries(seed)) {
    store.set(collectionName, new Map(Object.entries(documents).map(([id, value]) => [id, clone(value)])));
  }
  function collection(collectionName) {
    if (!store.has(collectionName)) store.set(collectionName, new Map());
    const documents = store.get(collectionName);
    return {
      doc(id) {
        return {
          async get() {
            const value = documents.get(id);
            return { data: value === undefined ? [] : [clone(value)] };
          },
          async set({ data }) {
            if (options.failTrainingArchive && collectionName === 'training_failure_events') throw options.failTrainingArchive;
            documents.set(id, clone(data));
            return { updated: 1 };
          }
        };
      }
    };
  }
  return {
    collection,
    command: {},
    _all(collectionName) { return [...(store.get(collectionName)?.values() || [])].map(clone); }
  };
}

function trainingTask(taskId, studentId) {
  return {
    _id: taskId,
    studentId,
    studentName: '小明',
    taskDateKey: '2026-08-20',
    dailySequence: 4
  };
}

test('runHardProblemTrainingAction archives a sanitized training failure and rethrows the original error', async () => {
  const taskId = 'task-training-1';
  const studentId = 'student-1';
  const db = fakeDb({ grading_tasks: { [taskId]: trainingTask(taskId, studentId) } });
  context.db = db;
  const original = Object.assign(new Error('训练评估失败'), { code: 'TRAINING_EVALUATION_FAILED' });

  await assert.rejects(
    __test.runHardProblemTrainingAction(
      'submitHardProblemExplanation',
      async () => { throw original; },
      { taskId, sessionVersion: 4, requestId: 'request-1', answer: '不得入库的学生讲解' },
      { userId: studentId, name: '小明' },
      'request-1'
    ),
    (error) => error === original
  );

  const events = db._all('training_failure_events');
  assert.equal(events.length, 1);
  assert.equal(events[0].studentName, '小明');
  assert.equal(events[0].dailyTrainingSequence, 4);
  assert.equal(events[0].trainingAction, 'submitExplanation');
  assert.equal(JSON.stringify(events[0]).includes('不得入库的学生讲解'), false);
});

test('runHardProblemTrainingAction preserves the original error when failure archival throws', async () => {
  const taskId = 'task-training-2';
  const studentId = 'student-2';
  const db = fakeDb({ grading_tasks: { [taskId]: trainingTask(taskId, studentId) } }, { failTrainingArchive: new Error('archive unavailable') });
  context.db = db;
  const original = Object.assign(new Error('训练评估失败'), { code: 'TRAINING_EVALUATION_FAILED' });

  await assert.rejects(
    __test.runHardProblemTrainingAction(
      'submitHardProblemExplanation',
      async () => { throw original; },
      { taskId, sessionVersion: 4, requestId: 'request-2', answer: '不得入库的学生讲解' },
      { userId: studentId, name: '小明' },
      'request-2'
    ),
    (error) => error === original
  );
  assert.equal(db._all('training_failure_events').length, 0);
});

test('each hard-problem training action archives an independent mapped event and rethrows its original error', async () => {
  const taskId = 'task-training-actions';
  const studentId = 'student-actions';
  const db = fakeDb({ grading_tasks: { [taskId]: trainingTask(taskId, studentId) } });
  context.db = db;
  const fixtures = [
    ['startHardProblemTraining', 'start'],
    ['submitHardProblemExplanation', 'submitExplanation'],
    ['submitHardProblemRetell', 'submitRetell'],
    ['submitHardProblemVariant', 'submitVariant'],
    ['getHardProblemReview', 'getReview'],
    ['submitHardProblemReview', 'submitReview']
  ];

  for (const [action, trainingAction] of fixtures) {
    const original = Object.assign(new Error(`${action}-failed`), { code: 'TRAINING_EVALUATION_FAILED' });
    await assert.rejects(
      __test.runHardProblemTrainingAction(
        action,
        async () => { throw original; },
        { taskId, sessionVersion: 4, requestId: `request-${action}`, answer: `private-${action}` },
        { userId: studentId, name: '小明' },
        `request-${action}`
      ),
      (error) => error === original
    );
    assert.equal(db._all('training_failure_events').at(-1).trainingAction, trainingAction);
  }

  const events = db._all('training_failure_events');
  assert.equal(events.length, fixtures.length);
  assert.equal(new Set(events.map((event) => event.eventId)).size, fixtures.length);
  assert.equal(JSON.stringify(events).includes('private-'), false);
});
