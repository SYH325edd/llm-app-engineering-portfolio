'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const __test = require('../shared/export-result-semantics');

function loadExportData({ user, collections, generatedFiles, workbooks, uploads }) {
  const indexPath = require.resolve('../index');
  const originalIndex = require.cache[indexPath];
  const originalLoad = Module._load;
  const collection = (name) => ({
    where: () => ({ limit: () => ({ get: async () => ({ data: collections[name] || [] }) }) }),
    orderBy: () => ({ limit: () => ({ get: async () => ({ data: collections[name] || [] }) }) })
  });
  const mocks = {
    '../shared/context': { db: { collection }, cloud: { uploadFile: async (input) => { uploads.push(input); return { fileID: 'cloud://export.xlsx' }; }, getTempFileURL: async () => ({ fileList: [{ tempFileURL: 'https://example.invalid/export.xlsx' }] }) } },
    '../shared/constants': { C: { roster: 'student_roster', tasks: 'grading_tasks', results: 'grading_results' } },
    '../shared/auth': { currentUser: async () => user, requireRole() {} },
    '../shared/utils': { randomId: () => 'export-id', hasScope: () => true },
    '../shared/audit': { audit: async () => {} },
    '../shared/generated-files': { GENERATED_FILE_RETENTION_DAYS: 90, recordGeneratedFile: async (input) => generatedFiles.push(input) }
  };
  const originals = new Map();
  for (const [request, value] of Object.entries(mocks)) {
    const resolved = require.resolve(request);
    originals.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: value };
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'xlsx') return { utils: { book_new: () => ({ sheets: [] }), json_to_sheet: (rows) => rows, book_append_sheet: (book, rows, name) => book.sheets.push({ name, rows }) }, write: (book) => { workbooks.push(book); return Buffer.from('xlsx'); } };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[indexPath];
  try { return require('../index'); }
  finally {
    Module._load = originalLoad;
    delete require.cache[indexPath];
    if (originalIndex) require.cache[indexPath] = originalIndex;
    for (const [resolved, original] of originals) { if (original) require.cache[resolved] = original; else delete require.cache[resolved]; }
  }
}

function loadExportAuth(rawUser) {
  const authPath = require.resolve('../shared/auth');
  const originalAuth = require.cache[authPath];
  const mocks = {
    '../shared/context': { context: () => ({ openid: 'developer-openid' }), db: { collection: () => ({ doc: () => ({ get: async () => ({ data: rawUser }), set: async () => {} }) }) } },
    '../shared/constants': { C: { users: 'users' } },
    '../shared/utils': { userIdFromOpenid: () => 'developer-id', now: () => new Date() }
  };
  const originals = new Map();
  for (const [request, value] of Object.entries(mocks)) {
    const resolved = require.resolve(request);
    originals.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: value };
  }
  delete require.cache[authPath];
  try { return require('../shared/auth'); }
  finally {
    delete require.cache[authPath];
    if (originalAuth) require.cache[authPath] = originalAuth;
    for (const [resolved, original] of originals) { if (original) require.cache[resolved] = original; else delete require.cache[resolved]; }
  }
}

test('V2 export counts calculation careless separately from ordinary wrong questions', () => {
  const summary = __test.summarizeQuestionsForExport([
    { outputSchemaVersion:'calculation-careless.v2', sourceKey:'c1', normalizedStatus:'CORRECT', calculationStatus:'CORRECT', carelessDetected:false },
    { outputSchemaVersion:'calculation-careless.v2', sourceKey:'c2', normalizedStatus:'WRONG', calculationStatus:'WRONG', carelessDetected:true, issueCategory:'careless', carelessIssues:['抄错数字'] },
    { outputSchemaVersion:'calculation-careless.v2', sourceKey:'c3', normalizedStatus:'WRONG', calculationStatus:'WRONG', carelessDetected:false, issueCategory:'knowledge_or_method', methodIssues:['公式错误'] }
  ]);
  assert.deepEqual({ total:summary.totalCount, correct:summary.correctCount, careless:summary.carelessCount, method:summary.methodErrorCount }, { total:3, correct:1, careless:1, method:1 });
  assert.match(summary.errorSummary, /c2:抄错数字/);
  assert.match(summary.errorSummary, /c3:公式错误/);
});

test('V2 export does not treat reading or hard correct questions as errors because legacy isCorrect is absent', () => {
  const summary = __test.summarizeQuestionsForExport([
    { outputSchemaVersion:'reading-careless.v2', sourceKey:'r1', normalizedStatus:'CORRECT', threeGridStatus:'CORRECT' },
    { outputSchemaVersion:'hard-problem.v2', sourceKey:'h1', normalizedStatus:'CORRECT', evaluationStatus:'CORRECT' },
    { outputSchemaVersion:'reading-careless.v2', sourceKey:'r2', normalizedStatus:'WRONG', threeGridStatus:'WRONG', askIssue:'缺少所求' }
  ]);
  assert.equal(summary.correctCount, 2);
  assert.equal(summary.errorSummary, 'r2:缺少所求');
});

test('V2 export gives teacher override priority over stale AI normalized status', () => {
  const summary = __test.summarizeQuestionsForExport([
    { outputSchemaVersion:'calculation-careless.v2', sourceKey:'tc', teacherOverrideApplied:true, teacherOverrideStatus:'CORRECT', normalizedStatus:'WRONG', carelessDetected:true, issueCategory:'careless', carelessIssues:['旧AI'] },
    { outputSchemaVersion:'reading-careless.v2', sourceKey:'tw', teacherOverrideApplied:true, teacherOverrideStatus:'WRONG', normalizedStatus:'CORRECT', threeGridStatus:'CORRECT' }
  ]);
  assert.equal(summary.correctCount, 1);
  assert.match(summary.errorSummary, /tw:/);
  assert.doesNotMatch(summary.errorSummary, /tc:/);
});

test('exportData keeps super_admin, teacher, and developer_admin exports in production by default', async () => {
  const collections = {
    student_roster: [
      { _id: 'production-roster', name: '正式学生', boundUserId: 'production-student', archived: false },
      { _id: 'developer-roster', name: '测试学生', boundUserId: 'developer-student', archived: false, dataSpace: 'developer_test' }
    ],
    grading_tasks: [
      { _id: 'production-task', studentId: 'production-student', studentName: '正式学生', status: 'COMPLETED', createdAt: '2026-09-01T00:00:00.000Z' },
      { _id: 'developer-task', studentId: 'developer-student', studentName: '测试学生', status: 'COMPLETED', createdAt: '2026-09-01T00:00:00.000Z', dataSpace: 'developer_test' }
    ],
    grading_results: [
      { taskId: 'production-task', studentId: 'production-student', questions: [] },
      { taskId: 'developer-task', studentId: 'developer-student', questions: [], dataSpace: 'developer_test' }
    ]
  };
  for (const user of [
    { userId: 'super', role: 'super_admin', status: 'ACTIVE' },
    { userId: 'teacher', role: 'teacher', status: 'ACTIVE' },
    { userId: 'developer', role: 'super_admin', _realRole: 'developer_admin', status: 'ACTIVE' }
  ]) {
    const generatedFiles = [], workbooks = [], uploads = [];
    const exportData = loadExportData({ user, collections, generatedFiles, workbooks, uploads });

    await exportData.main({ type: 'combined', filters: {} });

    assert.deepEqual(workbooks[0].sheets[0].rows.map((row) => row.姓名), ['正式学生']);
    assert.deepEqual(workbooks[0].sheets[1].rows.map((row) => row.学生), ['正式学生']);
    assert.equal(generatedFiles[0].dataSpace, 'production');
    assert.equal(uploads[0].cloudPath, `production/exports/${user.userId}/export-id.xlsx`);
  }
});

test('exportData recognizes an ACTIVE database developer_admin through a server-only marker', async () => {
  const auth = loadExportAuth({ userId: 'developer-id', role: 'developer_admin', status: 'ACTIVE' });
  const user = await auth.currentUser();

  assert.equal(user.role, 'super_admin');
  assert.equal(user._realRole, 'developer_admin');
});
