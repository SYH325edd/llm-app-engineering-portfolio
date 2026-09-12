const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return { DYNAMIC_CURRENT_ENV: 'dynamic', init() {}, database() { return { command: {} }; }, getWXContext() { return {}; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const worker = require('../index').__test;
const { cloud, db } = require('../shared/context');
const remoteStrategy = require('../shared/strategy/remote');
const { safeError } = require('../shared/utils');
const { monitor } = require('../shared/audit');
Module._load = originalLoad;

test('safeError serializes a CloudBase object without object stringification', () => {
  const error = safeError({ errMsg: 'storage denied', errCode: 'StorageError', status: 403, stack: 'stack trace' });
  assert.equal(error.message, 'storage denied');
  assert.equal(error.errMsg, 'storage denied');
  assert.equal(error.errCode, 'StorageError');
  assert.equal(error.status, 403);
  assert.notEqual(error.message, '[object Object]');
  let output = '';
  const originalError = console.error;
  console.error = (value) => { output = value; };
  monitor('taskWorker', 'TASK_STAGE_FAILED', { errorCode: error.code, errorMessage: error.message, errorDetails: error }, true);
  console.error = originalError;
  assert.match(output, /storage denied/);
  assert.doesNotMatch(output, /\[object Object\]/);
});

test('schema-version diagnostics survive error wrapping and audit serialization', () => {
  const error = Object.assign(new Error('output schema mismatch'), {
    code: 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION',
    receivedVersion: 'future.v3',
    expectedVersion: 'hard-problem.v2',
    supportedVersions: ['hard-problem.v2'],
    fieldPath: 'outputSchemaVersion',
    requestStage: 'hardProblemPrimary'
  });
  const wrapped = safeError(error);
  assert.deepEqual(wrapped.schemaValidation, {
    receivedVersion: 'future.v3',
    expectedVersion: 'hard-problem.v2',
    supportedVersions: ['hard-problem.v2'],
    fieldPath: 'outputSchemaVersion',
    requestStage: 'hardProblemPrimary'
  });
  let output = '';
  const originalError = console.error;
  console.error = (value) => { output = value; };
  monitor('taskWorker', 'TASK_STAGE_FAILED', { errorCode: wrapped.code, errorMessage: wrapped.message, errorDetails: wrapped, diagnostics: { schemaValidation: wrapped.schemaValidation } }, true);
  console.error = originalError;
  assert.deepEqual(JSON.parse(JSON.parse(output).diagnostics).schemaValidation, wrapped.schemaValidation);
});

test('tempUrls exposes non-zero CloudBase status and errMsg', async () => {
  cloud.getTempFileURL = async () => ({ fileList: [{ status: -1, errMsg: 'file not found' }] });
  await assert.rejects(worker.tempUrls(['cloud://cloudbase-d5g764d4w29a8d93e.a/file.png']), (error) =>
    error.code === 'STORAGE_TEMP_URL_FAILED' && error.status === -1 && error.errMsg === 'file not found');
});

test('a valid CloudBase tempFileURL advances PREPARING_IMAGES to PRIMARY_GRADING', async () => {
  cloud.getTempFileURL = async () => ({ fileList: [{ status: 0, tempFileURL: 'https://example.invalid/temp.png' }] });
  cloud.callFunction = async () => ({ result: { success: true } });
  remoteStrategy.loadRuntimeStrategy = async () => ({});
  let patch;
  const reference = {
    get: async () => ({ data: {
      _id: 'task_1',
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: 'owner-1',
      workerAttempt: 1
    } }),
    update: async ({ data }) => { patch = data; }
  };
  db.collection = () => ({ doc: () => reference });
  db.runTransaction = async (callback) => callback({ collection: () => ({ doc: () => reference }) });
  await worker.process({ _id: 'task_1', currentStage: worker.STAGES.PREPARING_IMAGES, studentImageFileIds: ['cloud://cloudbase-d5g764d4w29a8d93e.a/file.png'] }, Date.now());
  assert.equal(patch.currentStage, worker.STAGES.PRIMARY_GRADING);
});
