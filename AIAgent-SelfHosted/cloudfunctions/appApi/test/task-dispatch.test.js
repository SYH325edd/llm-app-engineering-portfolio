const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
const documents = new Map();
const taskDocuments = new Map();
const rosterDocuments = new Map();
const classDocuments = new Map();
const consentDocuments = new Map();
const importConflictDocuments = new Map();
const calls = [];
const monitorCalls = [];
let networkHandler;
let checkinReadError = null;
let resultReadError = null;
let currentUser = { userId: 'student-1', role: 'student', status: 'ACTIVE' };
let refreshRuntimeStrategy = async () => ({ changed: false, previousStrategyVersion: 'v1', currentStrategyVersion: 'v1', previousArtifactHash: 'a'.repeat(64), currentArtifactHash: 'a'.repeat(64), refreshedAt: 'now' });
let importWorkbook = null;
let classSetCalls = 0;
let rosterWhereCalls = 0;
let rosterSetCalls = 0;
let rosterSetFailureAt = null;
let reviewOpenError = null;
let currentUserCalls = 0;
let reviewOpenArgs = null;
let contextOpenid = 'openid-1';

function documentsFor(name) {
  if (name === 'student_roster') return rosterDocuments;
  if (name === 'classes') return classDocuments;
  if (name === 'teacher_privacy_consents') return consentDocuments;
  if (name === 'import_conflicts') return importConflictDocuments;
  return name === 'grading_tasks' ? taskDocuments : documents;
}

function matchesWhere(document, where) {
  return Object.entries(where || {}).every(([key, value]) => value && Array.isArray(value.__in) ? value.__in.includes(document[key]) : document[key] === value);
}

const taskDb = {
  collection(name) {
    const collectionDocuments = documentsFor(name);
    return {
      doc(id) {
        return {
          async get() {
            if (name === 'checkins' && checkinReadError) throw checkinReadError;
            return { data: collectionDocuments.get(id) || (name === 'grading_tasks' ? documents.get(id) : undefined) };
          },
          async update({ data }) {
            if (name === 'grading_tasks') {
              const updated = { ...(taskDocuments.get(id) || documents.get(id) || {}), ...data };
              taskDocuments.set(id, updated);
              documents.set(id, updated);
              return;
            }
            collectionDocuments.set(id, { ...(collectionDocuments.get(id) || {}), ...data });
          },
          async set({ data }) {
            if (name === 'classes') classSetCalls += 1;
            if (name === 'student_roster') {
              rosterSetCalls += 1;
              if (rosterSetFailureAt === rosterSetCalls) throw Object.assign(new Error('roster write failed'), { code: 'ROSTER_WRITE_FAILED' });
            }
            if (name === 'grading_tasks') {
              taskDocuments.set(id, data);
              documents.set(id, data);
              return;
            }
            collectionDocuments.set(id, data);
          }
        };
      },
      where(where) {
        let offset = 0;
        let pageSize;
        return {
          limit(value) { pageSize = value; return this; },
          skip(value) { offset = value; return this; },
          async get() {
            if (name === 'student_roster') rosterWhereCalls += 1;
            if (name === 'grading_results' && resultReadError) throw resultReadError;
            const matched = [...collectionDocuments.entries()].filter(([id, document]) => matchesWhere({ _id: id, ...document }, where)).map(([id, document]) => ({ _id: id, ...document }));
            return { data: matched.slice(offset, pageSize === undefined ? undefined : offset + pageSize) };
          }
        };
      },
      limit() {
        return { async get() { return { data: [...collectionDocuments.entries()].map(([id, document]) => ({ _id: id, ...document })) }; } };
      },
      async add({ data }) {
        collectionDocuments.set(`generated-${collectionDocuments.size + 1}`, data);
      }
    };
  }
  ,
  async runTransaction(callback) { return callback(taskDb); }
};

Module._load = function (request, parent, isMain) {
  if (request === './shared/context' || request === './context') return { db: taskDb, cmd: { in: (values) => ({ __in: values }) }, cloud: { downloadFile: async () => ({ fileContent: Buffer.from('xlsx') }) }, context: () => ({ openid: contextOpenid }) };
  if (request === './shared/auth') return {
    currentUser: async () => { currentUserCalls += 1; return currentUser; },
    requireActiveStudent(user) {
      if (!user || user.role !== 'student' || user.status !== 'ACTIVE') throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
    },
    requireRole() {},
    publicUser: (user) => user,
    reviewSessionStatus: async () => ({ active: false }),
    openReviewSession: async (...args) => { reviewOpenArgs = args; if (reviewOpenError) throw reviewOpenError; return { active: true, effectiveRole: args[2], effectiveUserId: `review_${args[2]}_fixed` }; },
    switchReviewSession: async () => { throw Object.assign(new Error('review session is invalid'), { code: 'REVIEW_SESSION_INVALID' }); },
    closeReviewSession: async () => ({ active: false })
  };
  if (request === './shared/audit') return { audit: async () => {}, monitor: (...args) => monitorCalls.push(args), systemLog: async () => {} };
  if (request === './shared/strategy/remote') return { refreshRuntimeStrategy: (...args) => refreshRuntimeStrategy(...args) };
  if (request === 'wx-server-sdk') {
    const database = () => ({ command: {}, collection: () => ({ doc: (id) => ({
      async update({ data }) { documents.set(id, { ...(documents.get(id) || {}), ...data }); },
      async set({ data }) { documents.set(id, data); },
      async get() { return { data: documents.get(id) }; }
    }) }) });
    return { DYNAMIC_CURRENT_ENV: 'dynamic', init() {}, database, getWXContext() { return {}; } };
  }
  if (request === 'xlsx') return { utils: { aoa_to_sheet(rows) { return { rows }; }, book_new() { return { sheets: [] }; }, book_append_sheet(workbook, worksheet, name) { workbook.sheets.push({ worksheet, name }); }, sheet_to_json(sheet) { return sheet.rows; } }, read() { return importWorkbook; }, write() { return Buffer.from('xlsx-template'); } };
  if (request === 'https') return { request: (...args) => networkHandler(...args) };
  return originalLoad.call(this, request, parent, isMain);
};
const { createTaskCoreFlow, main, checkinStats, taskAccuracyStats, teacherOwnsRoster } = require('../index');
const { normalizeCheckinRecord, recordPractice, recordQualifiedQuestions } = require('../shared/checkin');
const source = require('node:fs').readFileSync(require.resolve('../index'), 'utf8');
Module._load = originalLoad;

function response(statusCode, payload) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.setEncoding = () => {};
  process.nextTick(() => { res.emit('data', JSON.stringify(payload)); res.emit('end'); });
  return res;
}

function successfulRequest(url, options, callback) {
  const request = new EventEmitter();
  request.write = (body) => { calls.push({ options, body }); };
  request.end = () => callback(response(202, { code: 'TASK_ENQUEUED' }));
  request.setTimeout = () => {};
  request.destroy = () => {};
  return request;
}

function reset() {
  documents.clear(); taskDocuments.clear(); rosterDocuments.clear(); classDocuments.clear(); consentDocuments.clear(); importConflictDocuments.clear(); calls.length = 0; monitorCalls.length = 0;
  checkinReadError = null;
  resultReadError = null;
  importWorkbook = null;
  classSetCalls = 0;
  rosterWhereCalls = 0;
  rosterSetCalls = 0;
  rosterSetFailureAt = null;
  reviewOpenError = null;
  currentUserCalls = 0;
  reviewOpenArgs = null;
  contextOpenid = 'openid-1';
  currentUser = { userId: 'student-1', role: 'student', status: 'ACTIVE' };
  process.env.GRADING_WORKER_BASE_URL = 'https://worker.example.invalid';
  process.env.GRADING_WORKER_TOKEN = 'test-token-not-to-log';
  process.env.GRADING_WORKER_ENQUEUE_TIMEOUT_MS = '5000';
}

function todayFixture() {
  const createdAt = new Date().toISOString();
  return { createdAt, dateKey: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) };
}

function seedCompletedResultTask({ studentId, taskId, resultId, createdAt, questions }) {
  taskDocuments.set(taskId, { _id: taskId, studentId, status: 'COMPLETED', mode: 'CARELESS_TRAINING', resultId, createdAt });
  documents.set(resultId, { _id: resultId, taskId, studentId, outputSchemaVersion: 'reading-careless.v2', questions });
}

test('recordPractice preserves existing check-in progress from an array snapshot', async () => {
  reset();
  const createdAt = '2026-07-28T00:00:00.000Z';
  const id = 'student-array_2026-07-28';
  documents.set(id, [{
    qualifiedQuestionCount: 1,
    qualifiedQuestionKeys: ['q-existing'],
    completed: false
  }]);

  await recordPractice({ _id: 'task-new', studentId: 'student-array', createdAt });

  const record = documents.get(id);
  assert.equal(record.qualifiedQuestionCount, 1);
  assert.deepEqual(record.qualifiedQuestionKeys, ['q-existing']);
  assert.equal(record.completed, false);
  assert.ok(record.submittedTaskIds.includes('task-new'));
});

test('recordPractice creates the first daily check-in document when the database reports DOCUMENT_NOT_FOUND', async () => {
  reset();
  const id = 'student-first-checkin_2026-07-28';
  checkinReadError = Object.assign(new Error('Document not found'), { code: 'DOCUMENT_NOT_FOUND' });

  await recordPractice({ _id: 'task-first-checkin', studentId: 'student-first-checkin', createdAt: '2026-07-28T00:00:00.000Z' });

  const record = documents.get(id);
  assert.equal(record.studentId, 'student-first-checkin');
  assert.equal(record.practiced, true);
  assert.equal(record.qualifiedQuestionCount, 0);
  assert.deepEqual(record.submittedTaskIds, ['task-first-checkin']);
});

test('developer_test tasks propagate their data space to check-ins', async () => {
  reset();
  const task = { _id: 'task-developer-checkin', studentId: 'developer-student', createdAt: '2026-07-28T00:00:00.000Z', dataSpace: 'developer_test' };

  await recordPractice(task);
  await recordQualifiedQuestions(task, [{ checkinEligible: true, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-1' }]);

  assert.equal(documents.get('developer-student_2026-07-28').dataSpace, 'developer_test');
});

test('recordPractice rethrows a check-in read failure without writing an empty record', async () => {
  reset();
  const id = 'student-read-failure_2026-07-28';
  const existing = { qualifiedQuestionCount: 1, qualifiedQuestionKeys: ['q-existing'], completed: false };
  documents.set(id, existing);
  checkinReadError = Object.assign(new Error('check-in read failed'), { code: 'CHECKIN_DB_READ_FAILED' });

  await assert.rejects(
    recordPractice({ _id: 'task-read-failure', studentId: 'student-read-failure', createdAt: '2026-07-28T00:00:00.000Z' }),
    (error) => error.code === 'CHECKIN_DB_READ_FAILED'
  );
  assert.strictEqual(documents.get(id), existing);
});

test('legacy uniqueQuestionCount remains when a current task adds one qualified question', async () => {
  reset();
  const id = 'student-legacy_2026-07-28';
  documents.set(id, { uniqueQuestionCount: 2 });
  await recordQualifiedQuestions(
    { _id: 'task-legacy', studentId: 'student-legacy', createdAt: '2026-07-28T00:00:00.000Z' },
    [{ checkinEligible: true, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-1' }]
  );
  assert.equal(documents.get(id).qualifiedQuestionCount, 3);
});

test('check-in statistics preserve the exact qualified count and calculate teacher-visible accuracy', () => {
  const rows = [{ dateKey: '2026-07-28', qualifiedQuestionCount: 5, requiredQuestionCount: 3, completed: true, practiced: true }];
  const tasks = [
    { _id: 'task-a', status: 'COMPLETED', questionCount: 3, correctCount: 2, createdAt: '2026-07-28T00:00:00.000Z' },
    { _id: 'task-b', resultId: 'task-b', status: 'COMPLETED', questionCount: 2, correctCount: 2, createdAt: '2026-07-28T01:00:00.000Z' },
    { _id: 'task-c', status: 'PROCESSING', questionCount: 9, correctCount: 9, createdAt: '2026-07-28T02:00:00.000Z' }
  ];
  assert.deepEqual(taskAccuracyStats(tasks), { answeredQuestionCount: 5, correctQuestionCount: 4 });
  const stats = checkinStats(rows, '2026-07-28', tasks);
  assert.equal(stats.today.qualifiedQuestionCount, 5);
  assert.equal(stats.today.completed, true);
  assert.equal(stats.today.remainingCount, 0);
  assert.equal(stats.answeredQuestionCount, 5);
  assert.equal(stats.correctQuestionCount, 4);
  assert.equal(stats.accuracyRate, 0.8);
  assert.equal(stats.checkinRate, 1);
});

test('check-in statistics preserve exact counts at and above the three-question threshold', () => {
  for (const qualifiedQuestionCount of [3, 4, 5]) {
    const stats = checkinStats([
      { dateKey: '2026-07-30', qualifiedQuestionCount, requiredQuestionCount: 3, practiced: true }
    ], '2026-07-30', [
      { _id: `task-${qualifiedQuestionCount}`, status: 'COMPLETED', questionCount: qualifiedQuestionCount, correctCount: qualifiedQuestionCount, createdAt: '2026-07-30T00:00:00.000Z' }
    ]);
    assert.equal(stats.today.qualifiedQuestionCount, qualifiedQuestionCount);
    assert.equal(stats.today.completed, true);
    assert.equal(stats.today.remainingCount, 0);
  }
});

test('getCheckinOverview reconciles three missed qualified results and getMyCheckinStats sees completion', async () => {
  reset();
  const { createdAt, dateKey } = todayFixture();
  const studentId = 'student-reconcile';
  documents.set(`${studentId}_${dateKey}`, { studentId, dateKey, qualifiedQuestionCount: 0, requiredQuestionCount: 3, practiced: true });
  rosterDocuments.set('roster-reconcile', { _id: 'roster-reconcile', name: 'Student Reconcile', ownerTeacherId: 'admin-1', boundUserId: studentId, archived: false });
  rosterDocuments.set('roster-other', { _id: 'roster-other', name: 'Student Other', ownerTeacherId: 'admin-1', boundUserId: 'student-other', archived: false });
  for (let index = 1; index <= 3; index += 1) {
    seedCompletedResultTask({
      studentId,
      taskId: `task-reconcile-${index}`,
      resultId: `result-reconcile-${index}`,
      createdAt,
      questions: [{ outputSchemaVersion: 'reading-careless.v2', sourceKey: `q-${index}`, threeGridStatus: 'CORRECT', conditionCorrect: true, relationCorrect: true, askCorrect: true }]
    });
  }

  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  const overview = await main({ action: 'getCheckinOverview' });
  assert.equal(overview.success, true, JSON.stringify(overview));
  assert.equal(overview.data.students.find((item) => item.studentId === studentId).qualifiedQuestionCount, 3);
  assert.equal(overview.data.completedStudentCount, 1);
  assert.equal(overview.data.inProgressStudentCount, 0);
  assert.equal(overview.data.completionRate, 0.5);

  currentUser = { userId: studentId, role: 'student', status: 'ACTIVE' };
  const mine = await main({ action: 'getMyCheckinStats' });
  assert.equal(mine.success, true, JSON.stringify(mine));
  assert.equal(mine.data.today.completed, true);
  assert.equal(mine.data.today.remainingCount, 0);
});

test('check-in reconciliation is idempotent and excludes non-qualified or duplicate questions', async () => {
  reset();
  const { createdAt, dateKey } = todayFixture();
  const studentId = 'student-idempotent';
  documents.set(`${studentId}_${dateKey}`, { studentId, dateKey, qualifiedQuestionCount: 0, requiredQuestionCount: 3, practiced: true });
  rosterDocuments.set('roster-idempotent', { _id: 'roster-idempotent', name: 'Student Idempotent', ownerTeacherId: 'admin-1', boundUserId: studentId, archived: false });
  seedCompletedResultTask({
    studentId,
    taskId: 'task-idempotent-1',
    resultId: 'result-idempotent-1',
    createdAt,
    questions: [
      { outputSchemaVersion: 'reading-careless.v2', sourceKey: 'q-1', threeGridStatus: 'CORRECT', conditionCorrect: true, relationCorrect: true, askCorrect: true },
      { outputSchemaVersion: 'reading-careless.v2', sourceKey: 'q-1', threeGridStatus: 'CORRECT', conditionCorrect: true, relationCorrect: true, askCorrect: true },
      { outputSchemaVersion: 'reading-careless.v2', sourceKey: 'wrong', threeGridStatus: 'WRONG', conditionCorrect: false, relationCorrect: true, askCorrect: true },
      { outputSchemaVersion: 'reading-careless.v2', sourceKey: 'undetermined', threeGridStatus: 'UNDETERMINED' },
      { outputSchemaVersion: 'calculation-careless.v2', sourceKey: 'careless', calculationStatus: 'WRONG', issueCategory: 'careless', carelessDetected: true },
      { outputSchemaVersion: 'calculation-careless.v2', sourceKey: 'knowledge', calculationStatus: 'WRONG', issueCategory: 'knowledge_or_method', carelessDetected: false }
    ]
  });
  for (let index = 2; index <= 3; index += 1) {
    seedCompletedResultTask({
      studentId,
      taskId: `task-idempotent-${index}`,
      resultId: `result-idempotent-${index}`,
      createdAt,
      questions: [{ outputSchemaVersion: 'reading-careless.v2', sourceKey: `q-${index}`, threeGridStatus: 'CORRECT', conditionCorrect: true, relationCorrect: true, askCorrect: true }]
    });
  }

  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  await main({ action: 'getCheckinOverview' });
  await main({ action: 'getCheckinOverview' });

  const record = documents.get(`${studentId}_${dateKey}`);
  assert.equal(record.qualifiedQuestionCount, 3);
  assert.equal(record.qualifiedQuestionKeys.length, 3);
  assert.equal(new Set(record.qualifiedQuestionKeys).size, 3);
  assert.deepEqual(record.qualifiedQuestions.map((item) => item.sourceKey).sort(), ['q-1', 'q-2', 'q-3']);
});

test('all three check-in entry points return the same reconciled today state', async () => {
  reset();
  const { createdAt, dateKey } = todayFixture();
  const studentId = 'student-entry-consistency';
  rosterDocuments.set('roster-entry-consistency', { _id: 'roster-entry-consistency', name: 'Student Entry', ownerTeacherId: 'teacher-1', boundUserId: studentId, archived: false });
  for (let index = 1; index <= 3; index += 1) {
    seedCompletedResultTask({
      studentId,
      taskId: `task-entry-${index}`,
      resultId: `result-entry-${index}`,
      createdAt,
      questions: [{ outputSchemaVersion: 'reading-careless.v2', sourceKey: `q-${index}`, threeGridStatus: 'CORRECT', conditionCorrect: true, relationCorrect: true, askCorrect: true }]
    });
  }

  currentUser = { userId: studentId, role: 'student', status: 'ACTIVE' };
  const mine = await main({ action: 'getMyCheckinStats' });
  currentUser = { userId: 'teacher-1', role: 'teacher', status: 'ACTIVE' };
  const overview = await main({ action: 'getCheckinOverview' });
  const student = await main({ action: 'getStudentCheckinStats', studentId: 'roster-entry-consistency' });
  const overviewToday = overview.data.students[0];
  const states = [mine.data.today, overviewToday, student.data.today];

  for (const state of states) {
    assert.equal(state.qualifiedQuestionCount, 3);
    assert.equal(state.requiredQuestionCount, 3);
    assert.equal(state.completed, true);
    assert.equal(state.remainingCount, 0);
  }
  assert.equal(overview.data.completedStudentCount, 1);
  assert.equal(overview.data.inProgressStudentCount, 0);
  assert.equal(overview.data.completionRate, 1);
});

test('check-in reconciliation failure keeps current statistics and writes only safe metadata', async () => {
  reset();
  const { createdAt, dateKey } = todayFixture();
  const studentId = 'student-reconcile-failure';
  const original = { studentId, dateKey, qualifiedQuestionCount: 1, requiredQuestionCount: 3, practiced: true };
  documents.set(`${studentId}_${dateKey}`, original);
  seedCompletedResultTask({
    studentId,
    taskId: 'task-reconcile-failure',
    resultId: 'result-reconcile-failure',
    createdAt,
    questions: [{ outputSchemaVersion: 'reading-careless.v2', sourceKey: 'private-question', threeGridStatus: 'CORRECT' }]
  });
  resultReadError = Object.assign(new Error('private database details'), { code: 'RESULT_READ_FAILED' });
  currentUser = { userId: studentId, role: 'student', status: 'ACTIVE', name: 'Private Student Name' };

  const response = await main({ action: 'getMyCheckinStats' });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.today.qualifiedQuestionCount, 1);
  assert.strictEqual(documents.get(`${studentId}_${dateKey}`), original);
  const failureLog = monitorCalls.find(([, eventName]) => eventName === 'CHECKIN_RECONCILE_FAILED');
  assert.ok(failureLog);
  assert.deepEqual(failureLog[2], { studentIdExists: true, dateKey, completedTaskCount: 1, resultCount: 0, errorCode: 'RESULT_READ_FAILED' });
  assert.doesNotMatch(JSON.stringify(failureLog), /Private Student Name|private-question|private database details/);
});

test('teacher roster ownership isolates explicitly assigned students while preserving legacy scope compatibility', () => {
  const teacherA = { userId: 'teacher-a', role: 'teacher', scopes: [{ grade: '', className: '一班' }] };
  const teacherB = { userId: 'teacher-b', role: 'teacher', scopes: [{ grade: '', className: '一班' }] };
  assert.equal(teacherOwnsRoster(teacherA, { ownerTeacherId: 'teacher-a', grade: '', className: '一班' }), true);
  assert.equal(teacherOwnsRoster(teacherB, { ownerTeacherId: 'teacher-a', grade: '', className: '一班' }), false);
  assert.equal(teacherOwnsRoster(teacherB, { grade: '', className: '一班' }), true);
});

test('managerStudentTasks returns the same completed-task grading summary as listCompletedTasks', async () => {
  reset();
  rosterDocuments.set('roster-a', { _id: 'roster-a', name: 'Student A', ownerTeacherId: 'teacher-a', boundUserId: 'student-a', archived: false });
  taskDocuments.set('task-a', { _id: 'task-a', studentId: 'student-a', status: 'COMPLETED', currentStage: 'COMPLETED', progress: 100, mode: 'HOMEWORK', resultId: 'result-a', createdAt: '2026-07-30T00:00:00.000Z', completedAt: '2026-07-30T00:02:00.000Z' });
  documents.set('result-a', { _id: 'result-a', taskId: 'task-a', studentId: 'student-a', questions: [{ isCorrect: true }, { answerStatus: 'correct' }, { status: 'unanswered' }] });

  currentUser = { userId: 'student-a', role: 'student', status: 'ACTIVE' };
  const student = await main({ action: 'listCompletedTasks' });
  currentUser = { userId: 'teacher-a', role: 'teacher', status: 'ACTIVE' };
  const teacher = await main({ action: 'managerStudentTasks', rosterId: 'roster-a', mode: 'history' });

  assert.equal(student.success, true, JSON.stringify(student));
  assert.equal(teacher.success, true, JSON.stringify(teacher));
  for (const key of ['taskId', 'status', 'stage', 'progress', 'mode', 'totalQuestionCount', 'correctCount', 'wrongCount', 'incompleteCount', 'createdAt', 'completedAt', 'resultId', 'resultSummary']) {
    assert.deepEqual(teacher.data.tasks[0][key], student.data.tasks[0][key], key);
  }
  assert.equal(teacher.data.tasks[0].totalQuestionCount, 3);
  assert.equal(teacher.data.tasks[0].correctCount, 2);
  assert.equal(teacher.data.tasks[0].incompleteCount, 1);
});

test('managerStudentTasks enforces roster ownership while allowing super_admin access', async () => {
  reset();
  rosterDocuments.set('roster-a', { _id: 'roster-a', name: 'Student A', ownerTeacherId: 'teacher-a', boundUserId: 'student-a', archived: false });
  taskDocuments.set('task-a', { _id: 'task-a', studentId: 'student-a', status: 'PROCESSING', currentStage: 'REVIEW_GRADING', progress: 60, createdAt: '2026-07-30T00:00:00.000Z' });

  currentUser = { userId: 'teacher-a', role: 'teacher', status: 'ACTIVE' };
  assert.equal((await main({ action: 'managerStudentTasks', rosterId: 'roster-a', mode: 'history' })).success, true);
  currentUser = { userId: 'teacher-b', role: 'teacher', status: 'ACTIVE' };
  const denied = await main({ action: 'managerStudentTasks', rosterId: 'roster-a', mode: 'history' });
  assert.equal(denied.success, false);
  assert.equal(denied.code, 'FORBIDDEN');
  currentUser = { userId: 'admin-a', role: 'super_admin', status: 'ACTIVE' };
  assert.equal((await main({ action: 'managerStudentTasks', rosterId: 'roster-a', mode: 'history' })).success, true);
});

test('managerStudentTasks calculates legacy completed-task counts from result questions', async () => {
  reset();
  rosterDocuments.set('roster-a', { _id: 'roster-a', name: 'Student A', ownerTeacherId: 'teacher-a', boundUserId: 'student-a', archived: false });
  taskDocuments.set('legacy-task', { _id: 'legacy-task', studentId: 'student-a', status: 'COMPLETED', resultId: 'legacy-result', createdAt: '2026-07-30T00:00:00.000Z' });
  documents.set('legacy-result', { _id: 'legacy-result', taskId: 'legacy-task', studentId: 'student-a', questions: [{ isCorrect: true }, { isCorrect: false }] });
  currentUser = { userId: 'teacher-a', role: 'teacher', status: 'ACTIVE' };

  const response = await main({ action: 'managerStudentTasks', rosterId: 'roster-a', mode: 'history' });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.tasks[0].totalQuestionCount, 2);
  assert.equal(response.data.tasks[0].correctCount, 1);
  assert.equal(response.data.tasks[0].wrongCount, 1);
  assert.equal(response.data.tasks[0].incompleteCount, 0);
});

test('managerClassDashboard recent submissions include the owning studentId', async () => {
  reset();
  rosterDocuments.set('roster-dashboard', { _id: 'roster-dashboard', name: 'Dashboard Student', ownerTeacherId: 'teacher-dashboard', boundUserId: 'student-dashboard', archived: false });
  taskDocuments.set('task-dashboard', { _id: 'task-dashboard', studentId: ' student-dashboard ', status: 'PROCESSING', mode: 'HOMEWORK', createdAt: '2026-07-30T00:00:00.000Z' });
  currentUser = { userId: 'teacher-dashboard', role: 'teacher', status: 'ACTIVE' };

  const response = await main({ action: 'managerClassDashboard' });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.recentSubmissions.length, 1);
  assert.equal(response.data.recentSubmissions[0].studentId, 'student-dashboard');
});

test('teacher processing view receives the same live task status only for its owned student', async () => {
  reset();
  rosterDocuments.set('roster-a', { _id: 'roster-a', name: 'Student A', ownerTeacherId: 'teacher-a', boundUserId: 'student-a', archived: false });
  taskDocuments.set('task-live', { _id: 'task-live', studentId: 'student-a', status: 'PROCESSING', currentStage: 'REVIEW_GRADING', progress: 62, resultId: '', errorCode: '', errorMessage: '', createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:01:00.000Z' });

  currentUser = { userId: 'student-a', role: 'student', status: 'ACTIVE' };
  const student = await main({ action: 'getTaskStatus', taskId: 'task-live' });
  currentUser = { userId: 'teacher-a', role: 'teacher', status: 'ACTIVE' };
  const teacher = await main({ action: 'getTaskStatus', taskId: 'task-live', viewerMode: 'teacher', targetStudentId: 'student-a' });

  assert.equal(student.success, true, JSON.stringify(student));
  assert.equal(teacher.success, true, JSON.stringify(teacher));
  for (const key of ['status', 'stage', 'progress', 'resultId', 'errorCode', 'errorMessage', 'createdAt', 'updatedAt']) {
    assert.deepEqual(teacher.data[key], student.data[key], key);
  }

  currentUser = { userId: 'teacher-b', role: 'teacher', status: 'ACTIVE' };
  const deniedTeacher = await main({ action: 'getTaskStatus', taskId: 'task-live', viewerMode: 'teacher', targetStudentId: 'student-a' });
  assert.equal(deniedTeacher.success, false);
  assert.equal(deniedTeacher.code, 'FORBIDDEN');
  currentUser = { userId: 'teacher-a', role: 'teacher', status: 'ACTIVE' };
  const mismatchedTarget = await main({ action: 'getTaskStatus', taskId: 'task-live', viewerMode: 'teacher', targetStudentId: 'student-b' });
  assert.equal(mismatchedTarget.success, false);
  assert.equal(mismatchedTarget.code, 'FORBIDDEN');
  currentUser = { userId: 'admin-a', role: 'super_admin', status: 'ACTIVE' };
  assert.equal((await main({ action: 'getTaskStatus', taskId: 'task-live', viewerMode: 'teacher', targetStudentId: 'student-a' })).success, true);
  currentUser = { userId: 'student-b', role: 'student', status: 'ACTIVE' };
  const deniedStudent = await main({ action: 'getTaskStatus', taskId: 'task-live', viewerMode: 'teacher', targetStudentId: 'student-a' });
  assert.equal(deniedStudent.success, false);
  assert.equal(deniedStudent.code, 'FORBIDDEN');
});

test('teacher processing source keeps target student through polling and completed-result navigation', () => {
  const processingSource = require('node:fs').readFileSync(require.resolve('../../../miniapp/pages/task/processing/index.js'), 'utf8');
  const resultSource = require('node:fs').readFileSync(require.resolve('../../../miniapp/pages/result/detail/index.js'), 'utf8');
  const teacherTasksSource = require('node:fs').readFileSync(require.resolve('../../../miniapp/pages/teacher/student-tasks/index.js'), 'utf8');
  assert.match(teacherTasksSource, /viewerMode=teacher/);
  assert.match(teacherTasksSource, /targetStudentId/);
  assert.match(processingSource, /getTaskStatus\)\(this\.data\.taskId, 15000, this\.taskViewerParams\(\)\)/);
  assert.match(processingSource, /viewerMode=teacher/);
  assert.match(processingSource, /\['FORBIDDEN', 'TASK_NOT_FOUND'\]/);
  assert.match(processingSource, /result\/detail\/index\?taskId=/);
  assert.match(resultSource, /viewerMode/);
  assert.match(resultSource, /targetStudentId/);
});

test('completed task viewer access allows the owner teacher and super_admin but rejects another teacher and student', async () => {
  reset();
  rosterDocuments.set('roster-result-access', { _id: 'roster-result-access', ownerTeacherId: 'teacher-result-owner', boundUserId: 'student-result-owner', archived: false });
  taskDocuments.set('task-result-access', { _id: 'task-result-access', studentId: 'student-result-owner', status: 'COMPLETED', currentStage: 'COMPLETED', progress: 100, resultId: 'result-access', createdAt: '2026-07-30T00:00:00.000Z' });
  documents.set('result-access', { _id: 'result-access', taskId: 'task-result-access', studentId: 'student-result-owner', questions: [] });
  const viewerEvent = { action: 'getTask', taskId: 'task-result-access', viewerMode: 'teacher', targetStudentId: 'student-result-owner' };

  currentUser = { userId: 'teacher-result-owner', role: 'teacher', status: 'ACTIVE' };
  assert.equal((await main(viewerEvent)).success, true);

  currentUser = { userId: 'teacher-result-other', role: 'teacher', status: 'ACTIVE' };
  const deniedTeacher = await main(viewerEvent);
  assert.equal(deniedTeacher.success, false);
  assert.equal(deniedTeacher.code, 'FORBIDDEN');

  currentUser = { userId: 'admin-result', role: 'super_admin', status: 'ACTIVE' };
  assert.equal((await main(viewerEvent)).success, true);

  currentUser = { userId: 'student-result-other', role: 'student', status: 'ACTIVE' };
  const deniedStudent = await main(viewerEvent);
  assert.equal(deniedStudent.success, false);
  assert.equal(deniedStudent.code, 'FORBIDDEN');
});

test('failed task images are returned only through the existing authorized getTask path', async () => {
  reset();
  rosterDocuments.set('roster-failed-images', { _id: 'roster-failed-images', ownerTeacherId: 'teacher-owner', boundUserId: 'student-owner', archived: false });
  taskDocuments.set('task-failed-images', { _id: 'task-failed-images', studentId: 'student-owner', status: 'FAILED', currentStage: 'FAILED', progress: 48, errorMessage: 'worker failed', failureId: 'failure-images', homeworkImageFileIds: ['cloud://homework-1', 'cloud://homework-2'], answerImageFileIds: ['cloud://answer-1'] });
  const event = { action: 'getTask', taskId: 'task-failed-images', viewerMode: 'teacher', targetStudentId: 'student-owner' };

  currentUser = { userId: 'teacher-owner', role: 'teacher', status: 'ACTIVE' };
  const allowed = await main(event);
  assert.equal(allowed.success, true, JSON.stringify(allowed));
  assert.deepEqual(allowed.data.task.homeworkImages.map((image) => image.fileId), ['cloud://homework-1', 'cloud://homework-2']);
  assert.deepEqual(allowed.data.task.answerImages.map((image) => image.fileId), ['cloud://answer-1']);
  assert.equal(allowed.data.task.failureId, 'failure-images');

  currentUser = { userId: 'teacher-other', role: 'teacher', status: 'ACTIVE' };
  const denied = await main(event);
  assert.equal(denied.success, false);
  assert.equal(denied.code, 'FORBIDDEN');
});

test('teacher roster import accepts any region, assigns the current teacher, and preserves another teacher\'s student', async () => {
  reset();
  currentUser = { userId: 'teacher-a', role: 'teacher', status: 'ACTIVE', scopes: [] };
  importWorkbook = {
    SheetNames: ['students'],
    Sheets: {
      students: {
        rows: [
          ['姓名', '地区', '学号'],
          ['张三', '山西省太原市小店区', 'SX001'],
          ['李四', '湖南省长沙市望城区', 'HN001'],
          ['王五', '山东省菏泽市单县', 'SD001']
        ]
      }
    }
  };

  const imported = await main({ action: 'importRoster', fileID: 'cloud://roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1', teacherId: 'forged-teacher-id' });
  assert.equal(imported.success, true, JSON.stringify(imported));
  assert.equal(imported.data.created, 3);
  assert.equal(imported.data.errors.length, 0);
  assert.deepEqual([...rosterDocuments.values()].map((student) => student.className).sort(), ['山东省菏泽市单县', '山西省太原市小店区', '湖南省长沙市望城区'].sort());
  assert.ok([...rosterDocuments.values()].every((student) => student.ownerTeacherId === 'teacher-a'));

  const teacherAStudentId = [...rosterDocuments.entries()].find(([, student]) => student.name === '张三')[0];
  currentUser = { userId: 'teacher-b', role: 'teacher', status: 'ACTIVE', scopes: [] };
  const teacherBList = await main({ action: 'listStudents' });
  assert.equal(teacherBList.success, true, JSON.stringify(teacherBList));
  assert.deepEqual(teacherBList.data, []);
  const teacherBUpdate = await main({ action: 'updateStudent', studentId: teacherAStudentId, patch: { name: '赵六' } });
  assert.equal(teacherBUpdate.success, false);
  assert.equal(teacherBUpdate.code, 'FORBIDDEN');

  importWorkbook.Sheets.students.rows = [['姓名', '地区', '学号'], ['张三', '山西省太原市小店区', 'SX999']];
  const conflict = await main({ action: 'importRoster', fileID: 'cloud://roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });
  assert.equal(conflict.success, true, JSON.stringify(conflict));
  assert.equal(conflict.data.created, 0);
  assert.equal(conflict.data.updated, 0);
  assert.equal(conflict.data.conflicts, 1);
  assert.equal(conflict.data.errors.length, 1);
  assert.equal(rosterDocuments.get(teacherAStudentId).ownerTeacherId, 'teacher-a');
  assert.equal(rosterDocuments.get(teacherAStudentId).studentNumber, 'SX001');
});

test('teacher and super-admin imports own new rosters regardless of region, and manual creation uses the same owner', async () => {
  reset();
  currentUser = { userId: 'admin-hunan', role: 'super_admin', status: 'ACTIVE', name: '湖南管理员', className: '湖南' };
  documents.set('admin-hunan', currentUser);
  importWorkbook = {
    SheetNames: ['students'],
    Sheets: { students: { rows: [['姓名', '地区', '学号'], ['豆豆', '北京', 'BJ001']] } }
  };

  const adminImport = await main({ action: 'importRoster', fileID: 'cloud://admin-roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });
  assert.equal(adminImport.success, true, JSON.stringify(adminImport));
  const [doudouRosterId, doudouRoster] = [...rosterDocuments.entries()].find(([, roster]) => roster.name === '豆豆');
  assert.equal(doudouRoster.ownerTeacherId, 'admin-hunan');

  currentUser = { userId: 'teacher-shanghai', role: 'teacher', status: 'ACTIVE', name: '上海老师', scopes: [] };
  importWorkbook.Sheets.students.rows = [['姓名', '地区', '学号'], ['明明', '上海', 'SH001']];
  const teacherImport = await main({ action: 'importRoster', fileID: 'cloud://teacher-roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });
  assert.equal(teacherImport.success, true, JSON.stringify(teacherImport));
  assert.equal([...rosterDocuments.values()].find((roster) => roster.name === '明明').ownerTeacherId, 'teacher-shanghai');

  currentUser = { userId: 'admin-hunan', role: 'super_admin', status: 'ACTIVE', name: '湖南管理员', className: '湖南' };
  const created = await main({ action: 'createStudent', student: { name: '手动创建学生', region: '天津' } });
  assert.equal(created.success, true, JSON.stringify(created));
  assert.equal(created.data.ownerTeacherId, 'admin-hunan');

  currentUser = { userId: 'student-doudou', role: 'student', status: 'ACTIVE', name: '豆豆', rosterId: doudouRosterId, className: '北京' };
  const profile = await main({ action: 'updateProfile', name: '豆豆', region: '北京' });
  assert.equal(profile.success, true, JSON.stringify(profile));
  assert.deepEqual(profile.data.boundTeachers, [{ userId: 'admin-hunan', name: '湖南管理员', role: 'super_admin' }]);
  assert.equal(profile.data.boundTeacherNames, '湖南管理员');
});

test('ordinary teacher can manually create a production roster without a scope record', async () => {
  reset();
  currentUser = { userId: 'teacher-production', role: 'teacher', status: 'ACTIVE' };

  const created = await main({ action: 'createStudent', student: { name: '正式手动学生', region: '正式班' } });

  assert.equal(created.success, true, JSON.stringify(created));
  assert.equal(rosterDocuments.get(created.data._id).ownerTeacherId, 'teacher-production');
  assert.equal(rosterDocuments.get(created.data._id).dataSpace, 'production');

  currentUser = { userId: 'developer-admin', role: 'super_admin', _realRole: 'developer_admin', status: 'ACTIVE' };
  const developerCreated = await main({ action: 'createStudent', student: { name: '测试手动学生', region: '测试班' } });
  assert.equal(developerCreated.success, true, JSON.stringify(developerCreated));
  assert.equal(rosterDocuments.get(developerCreated.data._id).dataSpace, 'developer_test');
});

test('re-import fills an empty owner and never overwrites an existing owner', async () => {
  reset();
  rosterDocuments.set('legacy-roster', { _id: 'legacy-roster', name: '旧学生', normalizedName: '旧学生', grade: '', className: '北京', studentNumber: 'OLD001', ownerTeacherId: '', archived: false });
  currentUser = { userId: 'admin-current', role: 'super_admin', status: 'ACTIVE' };
  importWorkbook = {
    SheetNames: ['students'],
    Sheets: { students: { rows: [['姓名', '地区', '学号'], ['旧学生', '北京', 'NEW001']] } }
  };

  const filled = await main({ action: 'importRoster', fileID: 'cloud://legacy-roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });
  assert.equal(filled.success, true, JSON.stringify(filled));
  assert.equal(rosterDocuments.get('legacy-roster').ownerTeacherId, 'admin-current');

  currentUser = { userId: 'admin-other', role: 'super_admin', status: 'ACTIVE' };
  importWorkbook.Sheets.students.rows = [['姓名', '地区', '学号'], ['旧学生', '北京', 'ADMIN001']];
  const preserved = await main({ action: 'importRoster', fileID: 'cloud://other-roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });
  assert.equal(preserved.success, true, JSON.stringify(preserved));
  assert.equal(rosterDocuments.get('legacy-roster').ownerTeacherId, 'admin-current');
});

test('student profile resolves only explicit roster owners and never falls back to same-region teachers', async () => {
  reset();
  documents.set('teacher-owner', { userId: 'teacher-owner', role: 'teacher', status: 'ACTIVE', name: '导入老师', className: '湖南' });
  documents.set('teacher-same-region', { userId: 'teacher-same-region', role: 'teacher', status: 'ACTIVE', name: '北京老师', className: '北京', scopes: [{ grade: '', className: '北京' }] });
  rosterDocuments.set('roster-doudou', { _id: 'roster-doudou', name: '豆豆', normalizedName: '豆豆', grade: '', className: '北京', ownerTeacherId: 'teacher-owner', archived: false });
  currentUser = { userId: 'student-doudou', role: 'student', status: 'ACTIVE', name: '豆豆', rosterId: 'roster-doudou', className: '北京' };

  const bound = await main({ action: 'updateProfile', name: '豆豆', region: '北京' });
  assert.equal(bound.success, true, JSON.stringify(bound));
  assert.deepEqual(bound.data.boundTeachers, [{ userId: 'teacher-owner', name: '导入老师', role: 'teacher' }]);
  assert.equal(bound.data.boundTeacherNames, '导入老师');

  rosterDocuments.set('roster-doudou', { ...rosterDocuments.get('roster-doudou'), ownerTeacherId: '' });
  const unbound = await main({ action: 'updateProfile', name: '豆豆', region: '北京' });
  assert.equal(unbound.success, true, JSON.stringify(unbound));
  assert.deepEqual(unbound.data.boundTeachers, []);
  assert.equal(unbound.data.boundTeacherNames, '暂未绑定');
});

test('student profile displays only the ACTIVE roster owner teacher or super_admin', async () => {
  reset();
  documents.set('teacher-owner-display', { userId: 'teacher-owner-display', role: 'teacher', status: 'ACTIVE', name: 'Owner Teacher' });
  documents.set('admin-owner-display', { userId: 'admin-owner-display', role: 'super_admin', status: 'ACTIVE', name: 'Owner Admin' });
  documents.set('legacy-teacher-display', { userId: 'legacy-teacher-display', role: 'teacher', status: 'ACTIVE', name: 'Legacy Teacher', className: 'Beijing' });
  documents.set('same-region-display', { userId: 'same-region-display', role: 'teacher', status: 'ACTIVE', name: 'Same Region Teacher', className: 'Beijing', scopes: [{ grade: '3', className: 'Beijing' }] });
  rosterDocuments.set('roster-owner-display', { _id: 'roster-owner-display', ownerTeacherId: 'teacher-owner-display', teacherId: 'legacy-teacher-display', className: 'Beijing', grade: '3', archived: false });
  currentUser = { userId: 'student-owner-display', role: 'student', status: 'ACTIVE', name: 'Student', rosterId: 'roster-owner-display', className: 'Beijing', grade: '3' };

  const teacherBound = await main({ action: 'updateProfile', name: 'Student', region: 'Beijing' });
  assert.equal(teacherBound.success, true, JSON.stringify(teacherBound));
  assert.deepEqual(teacherBound.data.boundTeachers, [{ userId: 'teacher-owner-display', name: 'Owner Teacher', role: 'teacher' }]);

  rosterDocuments.set('roster-owner-display', { ...rosterDocuments.get('roster-owner-display'), ownerTeacherId: 'admin-owner-display' });
  const adminBound = await main({ action: 'updateProfile', name: 'Student', region: 'Beijing' });
  assert.equal(adminBound.success, true, JSON.stringify(adminBound));
  assert.deepEqual(adminBound.data.boundTeachers, [{ userId: 'admin-owner-display', name: 'Owner Admin', role: 'super_admin' }]);

  rosterDocuments.set('roster-owner-display', { ...rosterDocuments.get('roster-owner-display'), ownerTeacherId: '' });
  const unbound = await main({ action: 'updateProfile', name: 'Student', region: 'Beijing' });
  assert.equal(unbound.success, true, JSON.stringify(unbound));
  assert.deepEqual(unbound.data.boundTeachers, []);
});

test('new task dispatch saves once and sends one taskId-only enqueue request', async () => {
  reset(); networkHandler = successfulRequest;
  const task = { status: 'QUEUED', studentImageFileIds: ['cloud://private-image'] };
  const result = await createTaskCoreFlow('task-1', task, { saveTask: async (id, data) => documents.set(id, data), recordPractice: async () => {}, monitor: () => {} });
  assert.deepEqual(result, { taskId: 'task-1', dispatchStatus: 'ENQUEUED' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, JSON.stringify({ taskId: 'task-1' }));
  const stored = documents.get('task-1');
  assert.equal(stored.status, task.status);
  assert.deepEqual(stored.studentImageFileIds, task.studentImageFileIds);
  assert.equal(stored.workerStatus, 'PENDING');
  assert.equal(stored.workerQueueStatus, 'PENDING');
  assert.equal(stored.workerDispatchReason, 'create_task');
  assert.ok(stored.workerNextDispatchAt instanceof Date);
});

test('enqueue response loss preserves a Worker-committed DISPATCHED state', async () => {
  reset();
  networkHandler = (url, options, callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      const current = documents.get('task-dispatch-response-lost');
      const updated = {
        ...current,
        workerStatus: 'DISPATCHED',
        workerQueueStatus: 'DISPATCHED',
        workerQueueError: null,
        workerNextDispatchAt: null
      };
      documents.set('task-dispatch-response-lost', updated);
      taskDocuments.set('task-dispatch-response-lost', updated);
      process.nextTick(() => request.emit('error', Object.assign(new Error('response lost'), { code: 'ECONNRESET' })));
    };
    request.setTimeout = () => {};
    request.destroy = () => {};
    return request;
  };
  const result = await createTaskCoreFlow('task-dispatch-response-lost', { status: 'QUEUED' }, {
    saveTask: async (id, data) => documents.set(id, data),
    recordPractice: async () => {},
    monitor: () => {}
  });
  assert.deepEqual(result, { taskId: 'task-dispatch-response-lost', dispatchStatus: 'ENQUEUED' });
  const stored = documents.get('task-dispatch-response-lost');
  assert.equal(stored.workerQueueStatus, 'DISPATCHED');
  assert.equal(stored.workerStatus, 'DISPATCHED');
  assert.equal(stored.workerQueueError, null);
  assert.equal(stored.workerNextDispatchAt, null);
  assert.ok(monitorCalls.some((entry) => entry[1] === 'TASK_DISPATCH_RESPONSE_LOST'));
});

test('a genuine network failure keeps PENDING and schedules a retry without resetting queue fields', async () => {
  reset();
  networkHandler = () => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => process.nextTick(() => request.emit('error', Object.assign(new Error('network unavailable'), { code: 'ENETUNREACH' })));
    request.setTimeout = () => {};
    request.destroy = () => {};
    return request;
  };
  const result = await createTaskCoreFlow('task-network-failure', { status: 'QUEUED' }, {
    saveTask: async (id, data) => documents.set(id, data),
    recordPractice: async () => {},
    monitor: () => {}
  });
  assert.deepEqual(result, { taskId: 'task-network-failure', dispatchStatus: 'PENDING' });
  const stored = documents.get('task-network-failure');
  assert.equal(stored.workerQueueStatus, 'PENDING');
  assert.equal(stored.workerStatus, 'PENDING');
  assert.equal(stored.workerQueueError, 'ENETUNREACH');
  assert.ok(stored.workerNextDispatchAt instanceof Date);
});

test('enqueue response loss preserves RUNNING lease ownership and attempt', async () => {
  reset();
  const leaseUntil = new Date(Date.now() + 60_000);
  networkHandler = () => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      const current = documents.get('task-running-response-lost');
      const updated = {
        ...current,
        workerStatus: 'RUNNING',
        workerQueueStatus: 'RUNNING',
        workerLeaseOwner: 'worker-owner-fixed',
        workerLeaseUntil: leaseUntil,
        workerAttempt: 3,
        workerQueueError: null,
        workerNextDispatchAt: null
      };
      documents.set('task-running-response-lost', updated);
      taskDocuments.set('task-running-response-lost', updated);
      process.nextTick(() => request.emit('error', Object.assign(new Error('response lost'), { code: 'ECONNRESET' })));
    };
    request.setTimeout = () => {};
    request.destroy = () => {};
    return request;
  };
  const result = await createTaskCoreFlow('task-running-response-lost', { status: 'QUEUED' }, {
    saveTask: async (id, data) => documents.set(id, data),
    recordPractice: async () => {},
    monitor: () => {}
  });
  assert.deepEqual(result, { taskId: 'task-running-response-lost', dispatchStatus: 'ENQUEUED' });
  const stored = documents.get('task-running-response-lost');
  assert.equal(stored.workerQueueStatus, 'RUNNING');
  assert.equal(stored.workerStatus, 'RUNNING');
  assert.equal(stored.workerLeaseOwner, 'worker-owner-fixed');
  assert.equal(stored.workerLeaseUntil, leaseUntil);
  assert.equal(stored.workerAttempt, 3);
  assert.equal(stored.workerNextDispatchAt, null);
});

test('429 keeps the task queued and records a pending dispatch without taskWorker fallback', async () => {
  reset();
  networkHandler = (url, options, callback) => { const request = new EventEmitter(); request.write = () => {}; request.end = () => callback(response(429, { code: 'WORKER_QUEUE_FULL' })); request.setTimeout = () => {}; request.destroy = () => {}; return request; };
  const task = { status: 'QUEUED' };
  const result = await createTaskCoreFlow('task-2', task, { saveTask: async (id, data) => documents.set(id, data), recordPractice: async () => {}, monitor: () => {} });
  assert.deepEqual(result, { taskId: 'task-2', dispatchStatus: 'PENDING' });
  assert.equal(documents.get('task-2').status, 'QUEUED');
  assert.equal(documents.get('task-2').workerQueueError, 'WORKER_QUEUE_FULL');
  assert.ok(documents.get('task-2').workerNextDispatchAt instanceof Date);
});

test('missing worker configuration keeps the task pending without a network request or secret exposure', async () => {
  reset(); delete process.env.GRADING_WORKER_TOKEN;
  networkHandler = () => { throw new Error('network must not be called'); };
  const result = await createTaskCoreFlow('task-3', { status: 'QUEUED' }, {
    saveTask: async (id, data) => documents.set(id, data),
    recordPractice: async () => {},
    monitor: () => {}
  });
  assert.deepEqual(result, { taskId: 'task-3', dispatchStatus: 'PENDING' });
  assert.equal(calls.length, 0);
  assert.equal(documents.get('task-3').status, 'QUEUED');
  assert.equal(documents.get('task-3').workerQueueStatus, 'PENDING');
  assert.equal(documents.get('task-3').workerQueueError, 'GRADING_WORKER_CONFIG_MISSING');
  assert.doesNotMatch(JSON.stringify(documents.get('task-3')), /test-token-not-to-log|ARK_API_KEY|cloud:\/\/private-image/);
});

test('all task recovery entry points use dispatchTask and never invoke the legacy taskWorker', () => {
  assert.doesNotMatch(source, /name:\s*['"]taskWorker['"]/);
  for (const reason of [
    'answers_updated',
    'confirmation_resolved',
    'careless_training_resumed',
    'task_retry'
  ]) {
    assert.match(
      source,
      new RegExp(`dispatchTask\\(String\\(task\\._id\\), ['"]${reason}['"]\\)`),
      `${reason} must dispatch through gradingWorker`
    );
  }
});


test('result endpoints and navigation require both COMPLETED status and resultId', () => {
  assert.match(source, /function taskHasReadyResult\(task\)/);
  assert.match(source, /return task\?\.status === 'COMPLETED' && Boolean\(task\?\.resultId\)/);
  assert.match(source, /displayTasks\(await visibleStudentTasks\(user\)\)\.filter\(taskHasReadyResult\)/);
  assert.match(source, /mode === 'result' \? displayed\.filter\(taskHasReadyResult\)/);
  assert.doesNotMatch(source, /resultId: String\(task\.resultId \|\| task\._id/);
  assert.match(source, /task\?\.status === 'COMPLETED' && !task\.resultId/);
  assert.match(source, /TASK_FALSE_COMPLETION_REPAIRED/);
  assert.match(source, /errorCode: 'TASK_RESULT_NOT_READY'/);
  assert.match(source, /assertTaskViewerAccess\(task, user, event\);[\s\S]*TASK_FALSE_COMPLETION_REPAIRED/);
  assert.match(source, /results\)\.doc\(task\.resultId\)/);
});

test('getTaskStatus returns only the status whitelist and rejects another student task', async () => {
  taskDocuments.set('task-1', {
    _id: 'task-1', studentId: 'student-1', status: 'PROCESSING', currentStage: 'PRIMARY_GRADING', progress: 42,
    statusMessage: 'processing', errorCode: '', errorMessage: '', resultId: '', voiceStatus: 'GENERATING', updatedAt: '2026-07-29T00:00:00.000Z',
    homeworkImages: ['private-image'], manualAnswer: 'private-answer', workerQueueStatus: 'RUNNING'
  });

  const allowed = await main({ action: 'getTaskStatus', taskId: 'task-1' });
  assert.equal(allowed.success, true, JSON.stringify(allowed));
  assert.deepEqual(Object.keys(allowed.data).sort(), [
    'audioNarrationStatus', 'createdAt', 'currentStage', 'errorCode', 'errorMessage', 'progress', 'resultId', 'stage', 'status', 'statusMessage', 'taskId', 'updatedAt'
  ]);
  assert.deepEqual(allowed.data, {
    taskId: 'task-1', status: 'PROCESSING', currentStage: 'PRIMARY_GRADING', stage: 'PRIMARY_GRADING', progress: 42,
    statusMessage: 'processing', errorCode: '', errorMessage: '', resultId: '', audioNarrationStatus: 'GENERATING', createdAt: null, updatedAt: '2026-07-29T00:00:00.000Z'
  });

  currentUser = { userId: 'student-2', role: 'student', status: 'ACTIVE' };
  const denied = await main({ action: 'getTaskStatus', taskId: 'task-1' });
  assert.equal(denied.success, false);
  assert.equal(denied.code, 'FORBIDDEN');
});

test('normalizeCheckinRecord falls back to legacy uniqueQuestionCount when qualified count is absent', () => {
  assert.equal(normalizeCheckinRecord({ uniqueQuestionCount: 2 }).qualifiedQuestionCount, 2);
});

test('normalizeCheckinRecord preserves an explicit qualifiedQuestionCount of zero over legacy count', () => {
  assert.equal(normalizeCheckinRecord({ qualifiedQuestionCount: 0, uniqueQuestionCount: 2 }).qualifiedQuestionCount, 0);
});

test('refreshRuntimeStrategy is dispatched through the existing active super-admin authorization', async () => {
  reset();
  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  let calls = 0;
  refreshRuntimeStrategy = async () => { calls += 1; return { changed: true, previousStrategyVersion: 'v1', currentStrategyVersion: 'v2', previousArtifactHash: 'a'.repeat(64), currentArtifactHash: 'b'.repeat(64), refreshedAt: 'now' }; };
  const result = await main({ action: 'refreshRuntimeStrategy' });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(result.data).sort(), ['changed', 'currentArtifactHash', 'currentStrategyVersion', 'previousArtifactHash', 'previousStrategyVersion', 'refreshedAt']);
});

test('reviewSession rejects opening a review identity while the server channel is closed', async () => {
  reset();
  delete process.env.REVIEW_CHANNEL_ENABLED;
  delete process.env.REVIEW_ACCESS_CODE_HASH;
  delete process.env.REVIEW_CHANNEL_EXPIRES_AT;
  reviewOpenError = Object.assign(new Error('review channel is disabled'), { code: 'REVIEW_CHANNEL_DISABLED', reviewStage: 'review_config' });
  const response = await main({ action: 'reviewSession', operation: 'open', role: 'student', accessCode: 'not-a-real-code' });
  assert.equal(response.success, false);
  assert.equal(response.code, 'REVIEW_CHANNEL_DISABLED');
  assert.equal(response.data.review_stage, 'review_config');
  assert.equal(response.data.review_error_code, 'REVIEW_CHANNEL_DISABLED');
  assert.equal(response.data.request_id, response.request_id);
});

test('first reviewSession open bypasses currentUser and trusts only the server context openid', async () => {
  reset();
  currentUser = null;
  const response = await main({ action: 'reviewSession', operation: 'open', role: 'student', accessCode: 'review-code', openid: 'attacker-openid', openidHash: 'attacker-hash', userId: 'attacker-user', user: { role: 'super_admin' } });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(currentUserCalls, 0);
  assert.deepEqual(reviewOpenArgs, ['openid-1', 'review-code', 'student']);
  assert.equal(response.data.effectiveUserId, 'review_student_fixed');
});

test('reviewSession returns NO_OPENID when the trusted server context has no identity', async () => {
  reset();
  contextOpenid = '';
  const response = await main({ action: 'reviewSession', operation: 'open', role: 'student', accessCode: 'review-code', openid: 'attacker-openid' });
  assert.equal(response.success, false);
  assert.equal(response.code, 'NO_OPENID');
  assert.equal(response.data.review_error_code, 'NO_OPENID');
  assert.equal(currentUserCalls, 0);
  assert.equal(reviewOpenArgs, null);
});

test('formal management queries exclude review-only roster, teacher, task, and check-in data', async () => {
  reset();
  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  rosterDocuments.set('formal-roster', { _id: 'formal-roster', name: 'Formal Student', boundUserId: 'formal-student', archived: false });
  rosterDocuments.set('review_roster_fixed', { _id: 'review_roster_fixed', name: 'Review Student', boundUserId: 'review_student_fixed', archived: false, reviewOnly: true, ownerTeacherId: 'review_teacher_fixed' });
  taskDocuments.set('formal-task', { _id: 'formal-task', studentId: 'formal-student', status: 'COMPLETED', createdAt: '2026-08-01T00:00:00.000Z' });
  taskDocuments.set('review-task', { _id: 'review-task', studentId: 'review_student_fixed', status: 'COMPLETED', createdAt: '2026-08-02T00:00:00.000Z' });
  documents.set('formal-teacher', { userId: 'formal-teacher', role: 'teacher', status: 'ACTIVE' });
  documents.set('review_teacher_fixed', { userId: 'review_teacher_fixed', role: 'teacher', status: 'ACTIVE', reviewOnly: true });

  const home = await main({ action: 'home' });
  const dashboard = await main({ action: 'managerClassDashboard' });
  const students = await main({ action: 'listStudents' });
  const teachers = await main({ action: 'listTeachers' });

  assert.equal(home.data.stats.students, 1);
  assert.deepEqual(home.data.recent.map((task) => task._id), ['formal-task']);
  assert.equal(dashboard.data.classSummary.studentCount, 1);
  assert.deepEqual(dashboard.data.recentSubmissions.map((task) => task.taskId), ['formal-task']);
  assert.deepEqual(students.data.map((student) => student._id), ['formal-roster']);
  assert.deepEqual(teachers.data.map((teacher) => teacher.userId), ['formal-teacher']);
});

test('developer_admin runtime identity uses super_admin management access while remaining absent from teacher management', async () => {
  reset();
  currentUser = { userId: 'developer-1', role: 'super_admin', _realRole: 'developer_admin', status: 'ACTIVE' };
  rosterDocuments.set('formal-roster', { _id: 'formal-roster', name: 'Formal Student', boundUserId: 'formal-student', archived: false });
  documents.set('formal-teacher', { userId: 'formal-teacher', role: 'teacher', status: 'ACTIVE' });
  documents.set('developer-1', { userId: 'developer-1', role: 'developer_admin', status: 'ACTIVE' });
  documents.set('super-admin-1', { userId: 'super-admin-1', role: 'super_admin', status: 'ACTIVE' });
  documents.set('super-admin-2', { userId: 'super-admin-2', role: 'super_admin', status: 'ACTIVE' });

  const home = await main({ action: 'home' });
  const students = await main({ action: 'listStudents' });
  const teachers = await main({ action: 'listTeachers' });

  assert.equal(home.success, true);
  assert.deepEqual(students.data.map((student) => student._id), ['formal-roster']);
  assert.deepEqual(teachers.data.map((teacher) => teacher.userId), ['formal-teacher', 'super-admin-1', 'super-admin-2']);
});

test('ordinary super_admin cannot review a developer_admin as a teacher', async () => {
  reset();
  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  documents.set('developer-1', { userId: 'developer-1', role: 'developer_admin', status: 'PENDING', requestedScopes: [{ grade: '一年级', className: '1班' }] });

  const result = await main({ action: 'reviewTeacher', userId: 'developer-1', approved: false, rejectReason: 'not allowed' });

  assert.equal(result.success, false);
  assert.equal(result.code, 'INVALID_STATUS');
});

test('review-mode teacher sees only the fixed review roster and its task', async () => {
  reset();
  currentUser = { userId: 'review_teacher_fixed', role: 'teacher', status: 'ACTIVE', reviewMode: true };
  rosterDocuments.set('formal-roster', { _id: 'formal-roster', name: 'Formal Student', boundUserId: 'formal-student', archived: false, ownerTeacherId: 'formal-teacher' });
  rosterDocuments.set('review_roster_fixed', { _id: 'review_roster_fixed', name: 'Review Student', boundUserId: 'review_student_fixed', archived: false, reviewOnly: true, ownerTeacherId: 'review_teacher_fixed' });
  taskDocuments.set('formal-task', { _id: 'formal-task', studentId: 'formal-student', status: 'COMPLETED', createdAt: '2026-08-01T00:00:00.000Z' });
  taskDocuments.set('review-task', { _id: 'review-task', studentId: 'review_student_fixed', status: 'COMPLETED', createdAt: '2026-08-02T00:00:00.000Z' });

  const students = await main({ action: 'listStudents' });
  const dashboard = await main({ action: 'managerClassDashboard' });
  assert.deepEqual(students.data.map((student) => student._id), ['review_roster_fixed']);
  assert.deepEqual(dashboard.data.recentSubmissions.map((task) => task.taskId), ['review-task']);
});

test('reviewSession open logs only safe diagnostics when the delegated session open fails', async () => {
  reset();
  process.env.REVIEW_CHANNEL_ENABLED = 'true';
  process.env.REVIEW_ACCESS_CODE_HASH = 'a'.repeat(64);
  process.env.REVIEW_CHANNEL_EXPIRES_AT = new Date(Date.now() + 60000).toISOString();
  reviewOpenError = Object.assign(new Error('database write failed for review-code'), { code: 'REVIEW_FIXED_RECORD_INIT_FAILED', reviewCauseCode: 'DATABASE_REQUEST_FAILED', reviewStage: 'review_teacher_init' });
  const response = await main({ action: 'reviewSession', operation: 'open', role: 'student', accessCode: 'review-code' });
  assert.equal(response.success, false);
  const log = monitorCalls.find(([, eventName]) => eventName === 'REVIEW_SESSION_OPEN_FAILED');
  assert.ok(log);
  assert.deepEqual(Object.keys(log[2]).sort(), ['environmentEnabled', 'errorCode', 'errorMessage', 'errorName', 'expiresAtConfigured', 'expiresAtValid', 'hashConfigured', 'hashLength', 'operation', 'requestId', 'reviewSessionsCollectionStep', 'stage']);
  assert.equal(log[2].stage, 'review_teacher_init');
  assert.equal(log[2].errorCode, 'REVIEW_FIXED_RECORD_INIT_FAILED');
  assert.match(log[2].errorMessage, /DATABASE_REQUEST_FAILED/);
  assert.doesNotMatch(JSON.stringify(log[2]), /review-code|a{64}|openid/i);
});


test('teacher can preview and download the same valid roster import template contract', async () => {
  reset();
  currentUser = { userId: 'teacher-template', role: 'teacher', status: 'ACTIVE' };
  const response = await main({ action: 'getRosterImportTemplate' });
  assert.equal(response.success, true);
  assert.equal(response.data.fileName, '学生名单导入模板.xlsx');
  assert.equal(response.data.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.deepEqual(response.data.columns.map((column) => [column.label, column.required]), [['姓名', true], ['地区', true], ['学号', false]]);
  assert.equal(Buffer.from(response.data.base64, 'base64').toString(), 'xlsx-template');
  assert.equal(response.data.examples.length, 2);
});

test('listCompletedTasks preserves a correct reading-careless v2 summary instead of reclassifying it as wrong', async () => {
  reset();
  taskDocuments.set('reading-task', { _id: 'reading-task', studentId: 'student-1', status: 'COMPLETED', currentStage: 'COMPLETED', progress: 100, mode: 'CARELESS_TRAINING', resultId: 'reading-result', createdAt: '2026-08-01T00:00:00.000Z' });
  documents.set('reading-result', {
    _id: 'reading-result', taskId: 'reading-task', studentId: 'student-1', outputSchemaVersion: 'reading-careless.v2',
    summary: { totalCount: 1, correctCount: 1, wrongCount: 0, undeterminedCount: 0, allCorrect: true },
    questions: [{ outputSchemaVersion: 'reading-careless.v2', sourceKey: 'q-1', normalizedStatus: 'CORRECT', threeGridStatus: 'CORRECT', conditionCorrect: true, relationCorrect: true, askCorrect: true }]
  });

  const response = await main({ action: 'listCompletedTasks' });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.tasks[0].totalQuestionCount, 1);
  assert.equal(response.data.tasks[0].correctCount, 1);
  assert.equal(response.data.tasks[0].wrongCount, 0);
  assert.equal(response.data.tasks[0].incompleteCount, 0);
});

test('listCompletedTasks maps reading-careless v2 undetermined results to incomplete, not wrong', async () => {
  reset();
  taskDocuments.set('reading-task', { _id: 'reading-task', studentId: 'student-1', status: 'COMPLETED', currentStage: 'COMPLETED', progress: 100, mode: 'CARELESS_TRAINING', resultId: 'reading-result', createdAt: '2026-08-01T00:00:00.000Z' });
  documents.set('reading-result', {
    _id: 'reading-result', taskId: 'reading-task', studentId: 'student-1', outputSchemaVersion: 'reading-careless.v2',
    summary: { totalCount: 1, correctCount: 0, wrongCount: 0, undeterminedCount: 1, allCorrect: false },
    questions: [{ outputSchemaVersion: 'reading-careless.v2', sourceKey: 'q-1', normalizedStatus: 'UNDETERMINED', threeGridStatus: 'UNDETERMINED', analysisStatus: 'insufficient' }]
  });

  const response = await main({ action: 'listCompletedTasks' });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.tasks[0].correctCount, 0);
  assert.equal(response.data.tasks[0].wrongCount, 0);
  assert.equal(response.data.tasks[0].incompleteCount, 1);
});

test('bootstrap defaults ordinary student result visibility to hidden when system setting is absent', async () => {
  reset();
  const response = await main({ action: 'bootstrap' });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.clientConfig.studentResultVisibility, 'hidden');
  assert.equal(response.data.user.role, 'student');
});

test('bootstrap exposes visible mode from the existing system_settings record', async () => {
  reset();
  documents.set('student_result_visibility', { mode: 'visible' });
  const response = await main({ action: 'bootstrap' });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.clientConfig.studentResultVisibility, 'visible');
});


test('super admin reads worker-backed hard problem model provider readiness', async () => {
  reset();
  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  documents.set('hard_problem_model_provider', { provider: 'qwen3_vl_plus' });
  networkHandler = (url, options, callback) => {
    const request = new EventEmitter();
    request.write = (body) => calls.push({ url: String(url), options, body });
    request.end = () => callback(response(200, {
      ok: true,
      code: 'OK',
      providerStatusContractVersion: 'hard-problem-provider-status.v2',
      runtimeBuildId: 'build-20260806-qwen-review-repair-diagnostics-v7.3',
      providers: {
        ark_lite: { ready: true, label: '豆包 Seed Lite' },
        qwen3_vl_plus: { ready: true, label: '千问 Qwen3.7 Plus', model: 'qwen3.7-plus', reason: null }
      }
    }));
    request.setTimeout = () => {};
    request.destroy = () => {};
    return request;
  };

  const result = await main({ action: 'getHardProblemModelProvider' });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.data.provider, 'qwen3_vl_plus');
  assert.equal(result.data.providers.qwen3_vl_plus.ready, true);
  assert.equal(result.data.providerStatusContractVersion, 'hard-problem-provider-status.v2');
  assert.match(result.data.runtimeBuildId, /v7\.3/);
  assert.equal(JSON.parse(calls[0].body).taskId, undefined);
  assert.match(calls[0].url, /\/internal\/providers\/status$/);
});

test('super admin rejects an old worker provider status contract instead of reporting Qwen as unconfigured', async () => {
  reset();
  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  networkHandler = (url, options, callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => callback(response(200, {
      ok: true, code: 'OK', runtimeBuildId: 'old-worker',
      providers: { ark_lite: { ready: true }, qwen3_vl_plus: { ready: false } }
    }));
    request.setTimeout = () => {};
    request.destroy = () => {};
    return request;
  };
  const result = await main({ action: 'getHardProblemModelProvider' });
  assert.equal(result.success, true);
  assert.equal(result.data.statusAvailable, false);
  assert.equal(result.data.statusErrorCode, 'GRADING_WORKER_VERSION_UNSUPPORTED');
  assert.equal(result.data.providers.qwen3_vl_plus.reason, 'status_unavailable');
});

test('super admin cannot select an unconfigured hard problem model provider', async () => {
  reset();
  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  networkHandler = (url, options, callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => callback(response(200, {
      ok: true,
      code: 'OK',
      providerStatusContractVersion: 'hard-problem-provider-status.v2',
      runtimeBuildId: 'build-20260806-qwen-review-repair-diagnostics-v7.3',
      providers: { ark_lite: { ready: true }, qwen3_vl_plus: { ready: false, reason: 'invalid_model', model: 'qwen3-vl-plus' } }
    }));
    request.setTimeout = () => {};
    request.destroy = () => {};
    return request;
  };

  const result = await main({ action: 'setHardProblemModelProvider', provider: 'qwen3_vl_plus' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'MODEL_PROVIDER_NOT_READY');
  assert.match(result.message, /qwen3\.7-plus/);
  assert.equal(documents.has('hard_problem_model_provider'), false);
});

test('new hard problem tasks snapshot the selected provider while careless tasks remain on Ark', async () => {
  reset();
  documents.set('hard_problem_model_provider', { provider: 'qwen3_vl_plus' });
  networkHandler = successfulRequest;

  const hard = await main({
    action: 'createTask',
    mode: 'HARD_PROBLEM_CHECK',
    studentImageFileIds: ['cloud://student-work'],
    answerImageFileIds: []
  });
  assert.equal(hard.success, true, JSON.stringify(hard));
  assert.equal(hard.data.hardProblemModelProvider, 'qwen3_vl_plus');
  const hardTask = taskDocuments.get(hard.data.taskId);
  assert.equal(hardTask.hardProblemModelProvider, 'qwen3_vl_plus');

  documents.set('hard_problem_model_provider', { provider: 'ark_lite' });
  assert.equal(hardTask.hardProblemModelProvider, 'qwen3_vl_plus');

  const careless = await main({
    action: 'createTask',
    mode: 'CARELESS_TRAINING',
    carelessTrainingType: 'READING',
    studentImageFileIds: ['cloud://careless-work']
  });
  assert.equal(careless.success, true, JSON.stringify(careless));
  assert.equal(Object.hasOwn(taskDocuments.get(careless.data.taskId), 'hardProblemModelProvider'), false);
});


test('task retry clears stale hard-problem review recovery and safe failure diagnostics', () => {
  const source = require('node:fs').readFileSync(require.resolve('../index'), 'utf8');
  const retryStart = source.indexOf("case 'retryTask'");
  const retryEnd = source.indexOf("case '", retryStart + 20);
  const retrySource = source.slice(retryStart, retryEnd > retryStart ? retryEnd : undefined);
  for (const field of [
    'failureCauseCode', 'failureFieldPath', 'failureRequestStage', 'failureModelProvider', 'failureModelName',
    'failureProviderRequestIdPresent', 'failureRepairAttempted', 'failureRepairAttemptCount', 'failureRepairFailureStage',
    'hardProblemReviewRecoveryCount', 'hardProblemReviewLastFailure', 'hardProblemUnderstandingRecoveryCount',
    'hardProblemDirectRetryCount', 'hardProblemDirectHandoffRecoveryCount', 'carelessPrimaryRecoveryCount',
    'carelessReviewRecoveryCount', 'carelessReviewRecoveryContext', 'finalizationRecoveryCount', 'primaryTransportAttempt', 'reviewTransportAttempt',
    'primaryDraft', 'reviewDraft', 'mergedDraft'
  ]) assert.match(retrySource, new RegExp(field));
});

test('retryTask clears the prior failure archive generation before requeueing', async () => {
  reset();
  networkHandler = successfulRequest;
  const taskId = 'task-retry-clears-archive-generation';
  taskDocuments.set(taskId, {
    _id: taskId,
    studentId: 'student-1',
    status: 'FAILED',
    failedStage: 'PRIMARY_GRADING',
    failureId: 'failure-first',
    failureArchivedAt: '2026-08-20T08:00:00.000Z',
    failureArchiveVersion: 1,
    failureArchiveFailureId: 'failure-first',
    failureArchiveGeneration: 'failure:failure-first',
    retryable: true,
    retryCount: 0
  });

  const response = await main({ action: 'retryTask', taskId });
  const retried = taskDocuments.get(taskId);

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(retried.status, 'QUEUED');
  assert.equal(retried.failureArchivedAt, null);
  assert.equal(retried.failureArchiveVersion, null);
  assert.equal(retried.failureArchiveFailureId, null);
  assert.equal(retried.failureArchiveGeneration, null);
});

test('developer_admin roster imports are tagged as developer_test', async () => {
  reset();
  currentUser = { userId: 'developer-1', role: 'super_admin', _realRole: 'developer_admin', status: 'ACTIVE' };
  importWorkbook = {
    SheetNames: ['students'],
    Sheets: { students: { rows: [['姓名', '地区', '学号'], ['测试学生', '测试班', 'DEV001']] } }
  };

  const response = await main({ action: 'importRoster', fileID: 'cloud://developer-roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal([...rosterDocuments.values()].find((item) => item.name === '测试学生').dataSpace, 'developer_test');
});

test('importRoster imports 300 new students from one class', async () => {
  reset();
  currentUser = { userId: 'teacher-bulk', role: 'teacher', status: 'ACTIVE' };
  importWorkbook = {
    SheetNames: ['students'],
    Sheets: { students: { rows: [
      ['姓名', '地区', '学号'],
      ...Array.from({ length: 300 }, (_, index) => [`学生${index + 1}`, '批量班', `NO${index + 1}`])
    ] } }
  };

  const response = await main({ action: 'importRoster', fileID: 'cloud://bulk-roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.created, 300);
  assert.equal(response.data.updated, 0);
  assert.equal(response.data.conflicts, 0);
  assert.deepEqual(response.data.errors, []);
  assert.equal(rosterDocuments.size, 300);
});

test('importRoster ensures a shared class once and preloads roster once', async () => {
  reset();
  currentUser = { userId: 'teacher-bulk', role: 'teacher', status: 'ACTIVE' };
  importWorkbook = {
    SheetNames: ['students'],
    Sheets: { students: { rows: [
      ['姓名', '地区', '学号'],
      ...Array.from({ length: 300 }, (_, index) => [`学生${index + 1}`, '批量班', `NO${index + 1}`])
    ] } }
  };

  await main({ action: 'importRoster', fileID: 'cloud://bulk-roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });

  assert.equal(classSetCalls, 1);
  assert.equal(rosterWhereCalls, 1);
});

test('importRoster records a row write failure and continues with later students', async () => {
  reset();
  currentUser = { userId: 'teacher-bulk', role: 'teacher', status: 'ACTIVE' };
  rosterSetFailureAt = 2;
  importWorkbook = {
    SheetNames: ['students'],
    Sheets: { students: { rows: [
      ['姓名', '地区', '学号'],
      ['学生一', '批量班', 'NO1'],
      ['学生二', '批量班', 'NO2'],
      ['学生三', '批量班', 'NO3']
    ] } }
  };

  const response = await main({ action: 'importRoster', fileID: 'cloud://bulk-roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.created, 2);
  assert.deepEqual(response.data.errors, [{ row: 3, error: '该行写入失败，请稍后重试' }]);
  assert.deepEqual([...rosterDocuments.values()].map((item) => item.name).sort(), ['学生一', '学生三']);
});

test('importRoster updates an existing student after the first 1000 roster records', async () => {
  reset();
  currentUser = { userId: 'teacher-bulk', role: 'teacher', status: 'ACTIVE' };
  for (let index = 0; index < 1000; index += 1) {
    rosterDocuments.set(`filler-${index}`, { name: `填充学生${index}`, normalizedName: `填充学生${index}`, grade: '', className: '其他班', ownerTeacherId: 'teacher-bulk', archived: false });
  }
  rosterDocuments.set('after-page', { name: '后续学生', normalizedName: '后续学生', grade: '', className: '批量班', studentNumber: 'OLD', ownerTeacherId: 'teacher-bulk', archived: false });
  importWorkbook = { SheetNames: ['students'], Sheets: { students: { rows: [['姓名', '地区', '学号'], ['后续学生', '批量班', 'NEW']] } } };

  const response = await main({ action: 'importRoster', fileID: 'cloud://paged-roster.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.created, 0);
  assert.equal(response.data.updated, 1);
  assert.equal(rosterDocuments.size, 1001);
  assert.equal(rosterDocuments.get('after-page').studentNumber, 'NEW');
});

test('importRoster records conflicts for duplicate matches after the first 1000 roster records', async () => {
  reset();
  currentUser = { userId: 'teacher-bulk', role: 'teacher', status: 'ACTIVE' };
  for (let index = 0; index < 1000; index += 1) {
    rosterDocuments.set(`filler-${index}`, { name: `填充学生${index}`, normalizedName: `填充学生${index}`, grade: '', className: '其他班', ownerTeacherId: 'teacher-bulk', archived: false });
  }
  rosterDocuments.set('after-page-a', { name: '冲突学生', normalizedName: '冲突学生', grade: '', className: '批量班', studentNumber: 'A', ownerTeacherId: 'teacher-bulk', archived: false });
  rosterDocuments.set('after-page-b', { name: '冲突学生', normalizedName: '冲突学生', grade: '', className: '批量班', studentNumber: 'B', ownerTeacherId: 'teacher-bulk', archived: false });
  importWorkbook = { SheetNames: ['students'], Sheets: { students: { rows: [['姓名', '地区', '学号'], ['冲突学生', '批量班', 'NEW']] } } };

  const response = await main({ action: 'importRoster', fileID: 'cloud://paged-conflict.xlsx', consentConfirmed: true, consentVersion: '1.0.1' });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.data.created, 0);
  assert.equal(response.data.updated, 0);
  assert.equal(response.data.conflicts, 1);
  assert.equal(importConflictDocuments.size, 1);
  assert.equal(rosterDocuments.get('after-page-a').studentNumber, 'A');
  assert.equal(rosterDocuments.get('after-page-b').studentNumber, 'B');
});

test('new students inherit the matched roster data space instead of their untrusted initial default', async () => {
  reset();
  networkHandler = successfulRequest;
  rosterDocuments.set('developer-roster', { _id: 'developer-roster', name: '测试学生', normalizedName: '测试学生', grade: '', className: '测试班', archived: false, dataSpace: 'developer_test' });
  currentUser = { userId: 'developer-student', role: 'student', status: 'NEW' };

  const registration = await main({ action: 'registerStudent', name: '测试学生', region: '测试班' });
  assert.equal(registration.success, true, JSON.stringify(registration));
  assert.equal(documents.get('developer-student').dataSpace, 'developer_test');

  currentUser = documents.get('developer-student');
  const created = await main({ action: 'createTask', mode: 'HARD_PROBLEM_CHECK', studentImageFileIds: ['cloud://developer-work'], answerImageFileIds: [] });
  assert.equal(created.success, true, JSON.stringify(created));
  assert.equal(taskDocuments.get(created.data.taskId).dataSpace, 'developer_test');

  reset();
  rosterDocuments.set('production-roster', { _id: 'production-roster', name: '正式学生', normalizedName: '正式学生', grade: '', className: '正式班', archived: false, dataSpace: 'production' });
  currentUser = { userId: 'production-student', role: 'student', status: 'NEW' };

  const productionRegistration = await main({ action: 'registerStudent', name: '正式学生', region: '正式班' });
  assert.equal(productionRegistration.success, true, JSON.stringify(productionRegistration));
  assert.equal(documents.get('production-student').dataSpace, 'production');
});

test('only developer_admin can read developer_test roster and task data', async () => {
  reset();
  rosterDocuments.set('production-roster', { _id: 'production-roster', name: '正式学生', boundUserId: 'production-student', ownerTeacherId: 'teacher-1', archived: false });
  rosterDocuments.set('developer-roster', { _id: 'developer-roster', name: '测试学生', boundUserId: 'developer-student', ownerTeacherId: 'teacher-1', archived: false, dataSpace: 'developer_test' });
  taskDocuments.set('production-task', { _id: 'production-task', studentId: 'production-student', status: 'COMPLETED', createdAt: '2026-09-01T00:00:00.000Z' });
  taskDocuments.set('developer-task', { _id: 'developer-task', studentId: 'developer-student', status: 'COMPLETED', createdAt: '2026-09-02T00:00:00.000Z', dataSpace: 'developer_test' });

  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  assert.deepEqual((await main({ action: 'listStudents' })).data.map((item) => item._id), ['production-roster']);
  assert.deepEqual((await main({ action: 'history' })).data.map((item) => item._id), ['production-task']);

  currentUser = { userId: 'teacher-1', role: 'teacher', status: 'ACTIVE' };
  assert.deepEqual((await main({ action: 'listStudents' })).data.map((item) => item._id), ['production-roster']);
  assert.deepEqual((await main({ action: 'history' })).data.map((item) => item._id), ['production-task']);

  currentUser = { userId: 'developer-1', role: 'super_admin', _realRole: 'developer_admin', status: 'ACTIVE' };
  assert.deepEqual((await main({ action: 'listStudents' })).data.map((item) => item._id).sort(), ['developer-roster', 'production-roster']);
  assert.deepEqual((await main({ action: 'history' })).data.map((item) => item._id).sort(), ['developer-task', 'production-task']);
});

test('ordinary managers exclude developer_test wrong-question records from the class dashboard', async () => {
  reset();
  currentUser = { userId: 'admin-1', role: 'super_admin', status: 'ACTIVE' };
  rosterDocuments.set('production-roster', { _id: 'production-roster', name: '正式学生', boundUserId: 'production-student', archived: false });
  taskDocuments.set('production-task', { _id: 'production-task', studentId: 'production-student', status: 'COMPLETED', createdAt: '2026-09-01T00:00:00.000Z' });
  documents.set('production-wrong', { studentId: 'production-student', taskId: 'production-task', sourceKey: 'prod-q', mastered: false });
  documents.set('developer-wrong', { studentId: 'production-student', taskId: 'production-task', sourceKey: 'developer-q', mastered: false, dataSpace: 'developer_test' });

  const response = await main({ action: 'managerClassDashboard' });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.deepEqual(response.data.wrongQuestions.map((item) => item.sourceKey), ['prod-q']);
});
