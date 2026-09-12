'use strict';

const http = require('node:http');
const { createHash } = require('node:crypto');
const { createClaimTask, resolveLeaseMs, isDocumentNotFoundError } = require('./claim-task');
const { getCloudbaseClient } = require('./cloudbase-client');
const { getFirstDocument, describeSnapshot } = require('./document-snapshot');
const { createTaskScheduler } = require('./task-watcher');
const { executeGradingTask, createGradingRuntimeFromModuleRoot } = require('./shared/grading-core/execute-grading-task');
const { evaluateHardProblemTraining } = require('./hard-problem-training-runtime');
const taskFailureCase = require('./shared/task-failure-case');

const DEFAULT_HEARTBEAT_MS = 30000;
const SCHEDULER_MODE = 'database_polling_v1';
const STAGE_HANDOFF_MODE = 'atomic_payload_authority_v4';
const RUNTIME_BUILD_ID = 'build-20260815-primary-review-question-contract-v10.9.0';
const PROVIDER_STATUS_CONTRACT_VERSION = 'hard-problem-provider-status.v2';

function resolveHeartbeatMs(value = process.env.GRADING_WORKER_HEARTBEAT_MS) {
  const milliseconds = Number(value);
  return Number.isInteger(milliseconds) && milliseconds >= 10000 && milliseconds <= 60000
    ? milliseconds
    : DEFAULT_HEARTBEAT_MS;
}

function timestampMs(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function resolveConcurrency(value = process.env.GRADING_WORKER_CONCURRENCY) {
  return boundedInteger(value, 5, 1, 20);
}

function resolveQueueLimit(value = process.env.GRADING_WORKER_QUEUE_LIMIT) {
  return boundedInteger(value, 100, 10, 500);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function qwenConfigurationStatus(env = process.env) {
  const apiKeyPresent = Boolean(String(env.QWEN_API_KEY || env.DASHSCOPE_API_KEY || '').trim());
  const baseUrl = String(env.QWEN_BASE_URL || '').trim().replace(/\/$/, '');
  const model = String(env.QWEN_MODEL || 'qwen3.7-plus').trim() || 'qwen3.7-plus';
  if (!apiKeyPresent) return { ready: false, reason: 'missing_api_key', model };
  if (!baseUrl) return { ready: false, reason: 'missing_base_url', model };
  if (!/^qwen3\.7-plus(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return { ready: false, reason: 'invalid_model', model };
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || !url.hostname || !/\/compatible-mode\/v1(?:\/chat\/completions)?$/.test(url.pathname)) {
      return { ready: false, reason: 'invalid_base_url', model };
    }
  } catch {
    return { ready: false, reason: 'invalid_base_url', model };
  }
  return { ready: true, reason: null, model };
}

function validQwenConfiguration(env = process.env) {
  return qwenConfigurationStatus(env).ready;
}

function providerReadiness(env = process.env) {
  const qwen = qwenConfigurationStatus(env);
  return {
    ark_lite: {
      ready: Boolean(String(env.ARK_API_KEY || '').trim() && String(env.ARK_LITE_ENDPOINT || '').trim()),
      label: '豆包 Seed Lite'
    },
    qwen3_vl_plus: {
      ...qwen,
      label: '千问 Qwen3.7 Plus'
    }
  };
}

function normalizeError(error) {
  const value = error && typeof error === 'object' ? error : {};
  const code = typeof value.code === 'string' && /^[A-Z0-9_-]{1,80}$/i.test(value.code)
    ? value.code
    : 'GRADING_WORKER_INTERNAL_ERROR';
  const candidate = error instanceof Error
    ? error.message
    : typeof value.message === 'string'
      ? value.message
      : typeof value.errMsg === 'string'
        ? value.errMsg
        : typeof error === 'string'
          ? error
          : 'GRADING_WORKER_INTERNAL_ERROR';
  const message = String(candidate || 'GRADING_WORKER_INTERNAL_ERROR');
  const safeMessage = /(token|cloudbase_apikey|ark_api_key|prompt|student|image)/i.test(message)
    ? 'GRADING_WORKER_INTERNAL_ERROR'
    : message.slice(0, 500);
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : undefined;
  return {
    code,
    message: safeMessage,
    status: Number(value.status) || undefined,
    stack,
    causeCode: typeof value.causeCode === 'string' ? value.causeCode.slice(0, 100) : null,
    fieldPath: typeof value.fieldPath === 'string' ? value.fieldPath.slice(0, 200) : null,
    requestStage: typeof value.requestStage === 'string' ? value.requestStage.slice(0, 100) : null,
    modelProvider: typeof value.modelProvider === 'string' ? value.modelProvider.slice(0, 50) : null,
    modelName: typeof value.modelName === 'string' ? value.modelName.slice(0, 100) : null,
    providerRequestIdPresent: Boolean(value.providerRequestId),
    repairAttempted: value.repairAttempted === true,
    repairAttemptCount: Number.isFinite(Number(value.repairAttemptCount)) ? Number(value.repairAttemptCount) : 0,
    repairFailureStage: typeof value.repairFailureStage === 'string' ? value.repairFailureStage.slice(0, 100) : null,
    failureId: typeof value.failureId === 'string' ? value.failureId.slice(0, 100) : null
  };
}

function ownerFingerprint(owner) {
  return typeof owner === 'string' && owner
    ? createHash('sha256').update(owner).digest('hex').slice(0, 8)
    : null;
}


function updatedCount(result) {
  const candidates = [result?.updated, result?.stats?.updated, result?.data?.updated, result?.matched];
  const value = candidates.find((item) => Number.isFinite(Number(item)));
  return value === undefined ? null : Number(value);
}

function leaseWhere(taskId, fence) {
  return {
    _id: taskId,
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: fence.workerLeaseOwner,
    workerAttempt: Number(fence.workerAttempt || 0)
  };
}

async function readTask(db, taskId) {
  return getFirstDocument(await db.collection('grading_tasks').doc(taskId).get());
}

function safeDatabaseDiagnosticText(value) {
  return String(value ?? '')
    .replace(/cloud:\/\/[^\s",}]+/g, '[REDACTED_FILE_ID]')
    .replace(/https?:\/\/\S+/g, '[REDACTED_URL]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(token|authorization|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

function inspectDatabasePatch(patch) {
  const invalidFieldPaths = [];
  const record = (path, type) => invalidFieldPaths.push({ path, type });
  const visit = (value, path, ancestors) => {
    if (value === undefined) return record(path, 'undefined');
    if (typeof value === 'function') return record(path, 'function');
    if (typeof value === 'symbol') return record(path, 'symbol');
    if (typeof value === 'bigint') return record(path, 'bigint');
    if (typeof value === 'number' && Number.isNaN(value)) return record(path, 'NaN');
    if (typeof value === 'number' && !Number.isFinite(value)) return record(path, value > 0 ? 'Infinity' : '-Infinity');
    if (!value || typeof value !== 'object') return;
    if (value instanceof Date) return;
    if (ancestors.has(value)) return record(path, 'circular_reference');
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    if (!Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) record(path, `non_plain_object:${value.constructor?.name || 'unknown'}`);
    }
    for (const key of Object.keys(value)) {
      const fieldPath = Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
      if (key === '_id') record(fieldPath, 'nested__id');
      if (key.includes('.') || key.startsWith('$')) record(fieldPath, 'invalid_field_name');
      visit(value[key], fieldPath, nextAncestors);
    }
    for (const key of Object.getOwnPropertySymbols(value)) record(`${path}[${String(key)}]`, 'symbol_key');
  };
  visit(patch, '', new Set());
  let payloadBytes = null;
  try {
    const serialized = JSON.stringify(patch);
    if (typeof serialized === 'string') payloadBytes = Buffer.byteLength(serialized, 'utf8');
  } catch {
    payloadBytes = null;
  }
  return {
    payloadBytes,
    topLevelFields: patch && typeof patch === 'object' && !Array.isArray(patch) ? Object.keys(patch) : [],
    invalidFieldCount: invalidFieldPaths.length,
    invalidFieldPaths: invalidFieldPaths.slice(0, 20)
  };
}

function databaseOperationFailureDiagnostic(context, error) {
  const inspection = context.patch ? inspectDatabasePatch(context.patch) : { payloadBytes: null, topLevelFields: [], invalidFieldCount: 0, invalidFieldPaths: [] };
  const httpStatus = error?.httpStatus ?? error?.status ?? error?.statusCode ?? error?.response?.status ?? null;
  console.error('[gradingWorker] TASK_DATABASE_OPERATION_FAILED', JSON.stringify({
    taskId: context.taskId,
    currentStage: context.currentStage || null,
    nextStage: context.nextStage || null,
    dbOperation: context.dbOperation,
    dbCollection: 'grading_tasks',
    payloadBytes: inspection.payloadBytes,
    topLevelFields: inspection.topLevelFields,
    invalidFieldCount: inspection.invalidFieldCount,
    invalidFieldPaths: inspection.invalidFieldPaths,
    requestStage: context.requestStage || null,
    modelProvider: context.modelProvider || null,
    modelName: context.modelName || null,
    error: {
      name: String(error?.name || 'Error'),
      message: safeDatabaseDiagnosticText(error?.message),
      code: error?.code ?? null,
      errCode: error?.errCode ?? null,
      errMsg: safeDatabaseDiagnosticText(error?.errMsg),
      httpStatus: Number.isFinite(Number(httpStatus)) ? Number(httpStatus) : null
    },
    stackTop: String(error?.stack || '').split(/\r?\n/).filter(Boolean).slice(0, 5).map((line) => safeDatabaseDiagnosticText(line))
  }));
}

function comparableValue(value) {
  const normalize = (item) => {
    if (item instanceof Date) return item.getTime();
    if (item && typeof item === 'object' && typeof item.toDate === 'function') {
      const date = item.toDate();
      return date instanceof Date ? date.getTime() : item;
    }
    if (typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(item)) {
      const timestamp = Date.parse(item);
      return Number.isNaN(timestamp) ? item : timestamp;
    }
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  const normalized = normalize(value);
  return normalized && typeof normalized === 'object' ? JSON.stringify(normalized) : normalized;
}

function patchMatchesTask(task, patch) {
  if (!task || !patch) return false;
  const volatileFields = new Set([
    'updatedAt',
    'workerHeartbeatAt',
    'workerLeaseUntil',
    'workerNextDispatchAt',
    'workerStageFinishedAt',
    'workerFinishedAt',
    'completedAt'
  ]);
  const keys = Object.keys(patch).filter((key) => !volatileFields.has(key));
  return keys.length > 0 && keys.every((key) => comparableValue(task[key]) === comparableValue(patch[key]));
}

function taskHasCurrentLease(task, fence) {
  return Boolean(task
    && task.workerQueueStatus === 'RUNNING'
    && task.workerStatus === 'RUNNING'
    && task.workerLeaseOwner === fence.workerLeaseOwner
    && Number(task.workerAttempt || 0) === Number(fence.workerAttempt || 0));
}

async function updateByCurrentLease(db, taskId, fence, patch, replaceTopLevelFields = null, diagnosticContext = null) {
  const databasePatch = { ...patch };
  if (Array.isArray(replaceTopLevelFields) && typeof db.command?.set === 'function') {
    for (const field of replaceTopLevelFields) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) databasePatch[field] = db.command.set(patch[field]);
    }
  }
  const collection = db.collection('grading_tasks');
  if (typeof collection.where === 'function') {
    const query = collection.where(leaseWhere(taskId, fence));
    if (query && typeof query.update === 'function') {
      let result;
      try {
        result = await query.update(databasePatch);
      } catch (error) {
        if (diagnosticContext) databaseOperationFailureDiagnostic({ ...diagnosticContext, patch }, error);
        throw error;
      }
      const count = updatedCount(result);
      if (count !== null) return count > 0;
      let task;
      try {
        task = await readTask(db, taskId);
      } catch (error) {
        if (diagnosticContext) databaseOperationFailureDiagnostic({ ...diagnosticContext, dbOperation: 'review_schedule_fence_read', patch }, error);
        throw error;
      }
      if (patchMatchesTask(task, patch)) return true;
      if (!taskHasCurrentLease(task, fence)) return false;
    }
  }
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (transaction) => {
      const ref = transaction.collection('grading_tasks').doc(taskId);
      let task;
      try {
        task = getFirstDocument(await ref.get());
      } catch (error) {
        if (diagnosticContext) databaseOperationFailureDiagnostic({ ...diagnosticContext, dbOperation: 'review_schedule_fence_read', patch }, error);
        throw error;
      }
      if (!task
        || task.workerQueueStatus !== 'RUNNING'
        || task.workerStatus !== 'RUNNING'
        || task.workerLeaseOwner !== fence.workerLeaseOwner
        || Number(task.workerAttempt || 0) !== Number(fence.workerAttempt || 0)) return false;
      try {
        await ref.update({ data: databasePatch });
      } catch (error) {
        if (diagnosticContext) databaseOperationFailureDiagnostic({ ...diagnosticContext, patch }, error);
        throw error;
      }
      return true;
    });
  }
  return false;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function logUnexpectedError(error) {
  const normalized = normalizeError(error);
  console.error('[gradingWorker] unexpected error', JSON.stringify(normalized));
  return normalized;
}

function sendInternalError(response, error, taskId) {
  if (taskId && isDocumentNotFoundError(error)) {
    sendJson(response, 404, { accepted: false, code: 'TASK_NOT_FOUND', taskId });
    return;
  }
  const normalized = logUnexpectedError(error);
  if (!response.headersSent && !response.writableEnded) {
    sendJson(response, 500, { accepted: false, code: normalized.code, message: normalized.message });
  }
}

process.on('unhandledRejection', (reason) => {
  logUnexpectedError(reason);
  if (require.main === module) process.exitCode = 1;
});
process.on('uncaughtException', (error) => {
  logUnexpectedError(error);
  if (require.main === module) process.exit(1);
});

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function isValidTaskPayload(payload) {
  return payload !== null
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Object.keys(payload).length === 1
    && Object.prototype.hasOwnProperty.call(payload, 'taskId')
    && typeof payload.taskId === 'string'
    && payload.taskId.trim().length > 0;
}

function taskIsComplete(task) {
  return task?.status === 'COMPLETED' && Boolean(task?.resultId);
}

function taskWaitsForUser(task) {
  return ['NEED_ANSWER', 'NEED_CONFIRMATION'].includes(String(task?.status || ''));
}

function createServer({
  token = process.env.GRADING_WORKER_TOKEN,
  claimTask,
  runtime,
  executeTask = executeGradingTask,
  startRecovery = true,
  concurrency = resolveConcurrency(),
  queueLimit = resolveQueueLimit()
} = {}) {
  let defaultClaimTask;
  let defaultRuntime;
  let shuttingDown = false;
  let recoveryStarted = false;
  let shutdownPromise;
  let scheduler;
  const activeExecutionTaskIds = new Set();

  const getRuntime = () => runtime || (defaultRuntime ||= createWorkerRuntime());
  const getClaimTask = () => claimTask || (defaultClaimTask ||= createClaimTask({ db: getQueueDb() }));
  const getQueueDb = () => getRuntime().context.db;

  async function queueTask(taskId, kick = false) {
    let result;
    for (const [attemptIndex, delay] of [0, 100, 300, 700].entries()) {
      if (delay) await wait(delay);
      const now = new Date();
      result = await getQueueDb().runTransaction(async (transaction) => {
        const ref = transaction.collection('grading_tasks').doc(taskId);
        const snapshot = await ref.get();
        const task = getFirstDocument(snapshot);
        if (!task) {
          console.warn('[gradingWorker] TASK_QUEUE_SNAPSHOT_NOT_VISIBLE', JSON.stringify({
            taskId,
            attempt: attemptIndex + 1,
            snapshotShape: describeSnapshot(snapshot)
          }));
          return { code: 'TASK_QUEUE_SNAPSHOT_NOT_VISIBLE' };
        }
        if (taskIsComplete(task)) {
          return {
            statusCode: 200,
            body: { accepted: true, code: 'TASK_ALREADY_COMPLETED', taskId },
            shouldSchedule: false
          };
        }
        if (taskWaitsForUser(task)) {
          return {
            statusCode: 409,
            body: { accepted: false, code: 'TASK_WAITING_USER', taskId },
            shouldSchedule: false
          };
        }

        const queueStatus = String(task.workerQueueStatus || '');
        const leaseUntilMs = timestampMs(task.workerLeaseUntil);
        const leaseExpired = Boolean(leaseUntilMs && leaseUntilMs <= now.getTime());
        const dispatchExpired = queueStatus === 'DISPATCHED' && (!task.workerLeaseUntil || leaseExpired);
        const runningExpired = queueStatus === 'RUNNING' && Boolean(leaseExpired);

        if (kick && !(queueStatus === 'PENDING' || dispatchExpired || runningExpired)) {
          return {
            statusCode: 200,
            body: { accepted: true, code: 'TASK_ALREADY_ENQUEUED', taskId },
            shouldSchedule: false
          };
        }
        if (!kick && ['PENDING', 'DISPATCHED', 'RUNNING'].includes(queueStatus)) {
          return {
            statusCode: 200,
            body: { accepted: true, code: 'TASK_ALREADY_ENQUEUED', taskId },
            shouldSchedule: queueStatus === 'PENDING' || dispatchExpired || runningExpired
          };
        }
        if (['FAILED', 'CANCELLED'].includes(queueStatus)
          || ['FAILED', 'CANCELLED'].includes(String(task.status || ''))) {
          return {
            statusCode: 409,
            body: { accepted: false, code: 'TASK_NOT_RUNNABLE', taskId },
            shouldSchedule: false
          };
        }

        await ref.update({
          data: {
            workerStatus: 'PENDING',
            workerQueueStatus: 'PENDING',
            workerQueuedAt: task.workerQueuedAt || now,
            workerNextDispatchAt: now,
            workerDispatchAttempt: Number(task.workerDispatchAttempt || 0) + 1,
            workerAttempt: Number(task.workerAttempt || 0),
            workerQueueError: null,
            workerLeaseOwner: null,
            workerLeaseUntil: null,
            updatedAt: now
          }
        });
        return {
          statusCode: 202,
          body: { accepted: true, code: 'TASK_ENQUEUED', taskId },
          shouldSchedule: true
        };
      });
      if (result?.code !== 'TASK_QUEUE_SNAPSHOT_NOT_VISIBLE') return result;
    }
    return {
      statusCode: 404,
      body: { accepted: false, code: 'TASK_NOT_FOUND', taskId },
      shouldSchedule: false
    };
  }

  function dispatchErrorCode(error) {
    return error && typeof error.code === 'string' && error.code.trim()
      ? error.code.trim()
      : 'TASK_DISPATCH_UPDATE_FAILED';
  }

  function logDispatchFailure(taskId, error, result) {
    const normalized = normalizeError(error);
    console.error('[gradingWorker] dispatch failure', JSON.stringify({
      taskId,
      error: {
        name: error && typeof error.name === 'string' ? error.name : 'Error',
        code: dispatchErrorCode(error),
        message: normalized.message,
        requestId: error && typeof error.requestId === 'string' ? error.requestId : undefined
      },
      ...(result && typeof result === 'object' ? { resultKeys: Object.keys(result).sort() } : {})
    }));
  }

  async function dispatchTask(taskId) {
    const db = getQueueDb();
    let state;
    try {
      for (const [attemptIndex, delay] of [0, 100, 300, 700].entries()) {
        if (delay) await wait(delay);
        const now = new Date();
        state = await db.runTransaction(async (transaction) => {
          const ref = transaction.collection('grading_tasks').doc(taskId);
          const snapshot = await ref.get();
          const task = getFirstDocument(snapshot);
          if (!task) {
            console.warn('[gradingWorker] TASK_DISPATCH_SNAPSHOT_NOT_VISIBLE', JSON.stringify({
              taskId,
              attempt: attemptIndex + 1,
              snapshotShape: describeSnapshot(snapshot)
            }));
            return { code: 'TASK_DISPATCH_SNAPSHOT_NOT_VISIBLE' };
          }
          if (taskIsComplete(task)) return { code: 'TASK_ALREADY_COMPLETED' };
          const queueStatus = String(task.workerQueueStatus || '');
          const leaseUntil = timestampMs(task.workerLeaseUntil);
          const leaseActive = Boolean(leaseUntil && leaseUntil > now.getTime());
        if (queueStatus === 'RUNNING' && leaseActive) return { code: 'TASK_ALREADY_CLAIMED' };
        if (queueStatus === 'DISPATCHED') {
          if (!Object.prototype.hasOwnProperty.call(task, 'workerAttempt')) {
            await ref.update({ data: { workerAttempt: 0, updatedAt: now } });
          }
          return { code: 'TASK_ALREADY_DISPATCHED' };
        }
        if (queueStatus === 'RUNNING' && !leaseActive) {
          await ref.update({ data: {
            workerStatus: 'DISPATCHED',
            workerQueueStatus: 'DISPATCHED',
            workerLeaseOwner: null,
            workerLeaseUntil: null,
            workerAttempt: Number(task.workerAttempt || 0),
            workerLastDispatchAt: now,
            workerNextDispatchAt: null,
            workerQueueError: null,
            updatedAt: now
          } });
          return { code: 'TASK_DISPATCHED' };
        }
        const taskStatus = String(task.status || '');
        const recoverableLegacyQueueState = ['', 'QUEUED', 'PROCESSING'].includes(queueStatus)
          && ['QUEUED', 'PROCESSING'].includes(taskStatus)
          && !task.resultId
          && !taskWaitsForUser(task)
          && !['FAILED', 'CANCELLED'].includes(taskStatus)
          && !leaseActive;
        if (queueStatus !== 'PENDING' && !recoverableLegacyQueueState) {
          console.error('[gradingWorker] TASK_DISPATCH_STATE_REJECTED', JSON.stringify({
            taskId,
            observedWorkerQueueStatus: queueStatus || null,
            observedWorkerStatus: task.workerStatus || null,
            observedTaskStatus: taskStatus || null,
            observedStage: task.currentStage || null,
            hasResultId: Boolean(task.resultId),
            leaseActive,
            hasLeaseOwner: Boolean(task.workerLeaseOwner)
          }));
          return { code: 'TASK_DISPATCH_NOT_APPLIED' };
        }
        await ref.update({ data: {
          workerStatus: 'DISPATCHED',
          workerQueueStatus: 'DISPATCHED',
          workerLastDispatchAt: now,
          workerNextDispatchAt: null,
          workerAttempt: Number(task.workerAttempt || 0),
          workerQueueError: null,
          workerLeaseOwner: null,
          workerLeaseUntil: null,
          updatedAt: now
        } });
        if (recoverableLegacyQueueState) {
          console.info('[gradingWorker] TASK_DISPATCH_STATE_NORMALIZED', JSON.stringify({
            taskId,
            previousWorkerQueueStatus: queueStatus || null,
            previousWorkerStatus: task.workerStatus || null,
            taskStatus: taskStatus || null,
            currentStage: task.currentStage || null
          }));
        }
          return { code: 'TASK_DISPATCHED', normalizedLegacyState: recoverableLegacyQueueState };
        });
        if (state?.code !== 'TASK_DISPATCH_SNAPSHOT_NOT_VISIBLE') break;
      }
    } catch (error) {
      logDispatchFailure(taskId, error);
      return { dispatched: false, errorCode: dispatchErrorCode(error) };
    }

    if (['TASK_ALREADY_COMPLETED', 'TASK_ALREADY_CLAIMED', 'TASK_ALREADY_DISPATCHED'].includes(state?.code)) {
      return { dispatched: true, idempotent: true, code: state.code };
    }
    if (state?.code !== 'TASK_DISPATCHED') {
      return { dispatched: false, errorCode: state?.code || 'TASK_DISPATCH_NOT_APPLIED' };
    }

    const ref = db.collection('grading_tasks').doc(taskId);
    let foundDocument = false;
    for (const [index, delay] of [0, 100, 300].entries()) {
      if (delay) await wait(delay);
      try {
        const snapshot = await ref.get();
        const document = getFirstDocument(snapshot);
        foundDocument ||= Boolean(document);
        console.info('[gradingWorker] dispatch readback', JSON.stringify({
          taskId,
          snapshotDataIsArray: Array.isArray(snapshot?.data),
          snapshotDataLength: Array.isArray(snapshot?.data) ? snapshot.data.length : null,
          observedWorkerQueueStatus: document?.workerQueueStatus || null,
          observedStatus: document?.status || null,
          readbackAttempt: index + 1
        }));
        if (document && (
          ['DISPATCHED', 'RUNNING'].includes(String(document.workerQueueStatus || ''))
          || taskIsComplete(document)
        )) {
          return { dispatched: true };
        }
      } catch (error) {
        if (index === 2) logDispatchFailure(taskId, error);
      }
    }
    return {
      dispatched: false,
      errorCode: foundDocument ? 'TASK_DISPATCH_NOT_APPLIED' : 'TASK_DISPATCH_READBACK_MISSING'
    };
  }

  async function resetQueueAfterInfrastructureFailure(taskId, errorCode) {
    const now = new Date();
    return getQueueDb().runTransaction(async (transaction) => {
      const ref = transaction.collection('grading_tasks').doc(taskId);
      const task = getFirstDocument(await ref.get());
      if (!task || taskIsComplete(task) || taskWaitsForUser(task)) return false;
      if (['FAILED', 'CANCELLED'].includes(String(task.status || ''))) return false;
      const leaseUntil = timestampMs(task.workerLeaseUntil);
      const activeLease = String(task.workerQueueStatus || '') === 'RUNNING' && leaseUntil > now.getTime();
      if (activeLease) {
        console.info('[gradingWorker] WORKER_FAILURE_RESET_SKIPPED_ACTIVE_LEASE', JSON.stringify({
          taskId,
          errorCode,
          ownerFingerprint: ownerFingerprint(task.workerLeaseOwner),
          workerAttempt: task.workerAttempt || null
        }));
        return false;
      }
      await ref.update({ data: {
        workerStatus: 'PENDING',
        workerQueueStatus: 'PENDING',
        workerQueueError: errorCode,
        workerNextDispatchAt: new Date(now.getTime() + 15000),
        workerLeaseOwner: null,
        workerLeaseUntil: null,
        updatedAt: now
      } });
      return true;
    });
  }

  async function recordDispatchFailure(taskId, errorCode = 'TASK_DISPATCH_UPDATE_FAILED') {
    await resetQueueAfterInfrastructureFailure(taskId, errorCode);
  }

  async function recordClaimFailure(taskId, errorCode) {
    await resetQueueAfterInfrastructureFailure(taskId, errorCode);
  }

  async function executeJobInternal(taskId, persistentQueue = true) {

    let reachedDispatch = false;
    let reachedClaim = false;
    const result = (statusCode, body, details = {}) => ({
      statusCode,
      body,
      schedulerOutcome: { reachedDispatch, reachedClaim, ...details }
    });

    if (persistentQueue) {
      try {
        const dispatch = await dispatchTask(taskId);
        if (!dispatch.dispatched) {
          await recordDispatchFailure(taskId, dispatch.errorCode);
          return result(500, { accepted: false, code: dispatch.errorCode, taskId }, {
            outcome: 'dispatch_failed',
            code: dispatch.errorCode
          });
        }
        reachedDispatch = true;
      } catch (error) {
        const errorCode = dispatchErrorCode(error);
        try {
          await recordDispatchFailure(taskId, errorCode);
        } catch (recordError) {
          logUnexpectedError(recordError);
        }
        logUnexpectedError(error);
        return result(500, { accepted: false, code: errorCode, taskId }, {
          outcome: 'dispatch_failed',
          code: errorCode
        });
      }
    }

    let claimOutcome;
    try {
      claimOutcome = await getClaimTask()(taskId);
    } catch (error) {
      if (isDocumentNotFoundError(error)) throw error;
      const normalized = normalizeError(error);
      const code = error && typeof error.code === 'string' && error.code.trim()
        ? error.code.trim()
        : 'TASK_CLAIM_INTERNAL_ERROR';
      const stage = typeof error?.stage === 'string' ? error.stage : undefined;
      const requestId = typeof error?.requestId === 'string' ? error.requestId : undefined;
      try {
        await recordClaimFailure(taskId, code);
      } catch (recordError) {
        logUnexpectedError(recordError);
      }
      console.error('[gradingWorker] WORKER_CLAIM_FAILURE', JSON.stringify({
        taskId,
        stage,
        code,
        message: normalized.message,
        requestId
      }));
      return result(500, { accepted: false, code, taskId }, {
        outcome: 'claim_failed',
        code,
        stage
      });
    }

    if (claimOutcome.body.code !== 'TASK_CLAIMED') {
      return {
        ...claimOutcome,
        schedulerOutcome: {
          reachedDispatch,
          reachedClaim,
          outcome: claimOutcome.body.code === 'TASK_ALREADY_COMPLETED'
            ? 'already_completed'
            : 'already_claimed',
          code: claimOutcome.body.code
        }
      };
    }

    reachedClaim = true;
    const activeRuntime = getRuntime();
    const fence = {
      workerLeaseOwner: claimOutcome.workerLeaseOwner ?? claimOutcome.claimContext.workerLeaseOwner,
      workerAttempt: claimOutcome.workerAttempt ?? claimOutcome.claimContext.workerAttempt,
      workerLeaseUntil: claimOutcome.workerLeaseUntil ?? claimOutcome.claimContext.workerLeaseUntil
    };

    if (!await updateIfCurrentLease(activeRuntime, taskId, fence, {
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      status: 'PROCESSING',
      updatedAt: new Date()
    })) {
      return result(500, { accepted: false, code: 'TASK_WORKER_LEASE_LOST', taskId }, {
        outcome: 'lease_lost',
        code: 'TASK_WORKER_LEASE_LOST'
      });
    }
    console.info('[gradingWorker] WORKER_FENCE_CONFIRMED', JSON.stringify({
      taskId,
      ownerFingerprint: ownerFingerprint(fence.workerLeaseOwner),
      workerAttempt: fence.workerAttempt,
      mode: 'conditional_update_v2'
    }));

    const heartbeat = startHeartbeat(activeRuntime, taskId, fence);
    try {
      const executionResult = await executeTask({
        taskId,
        runtime: activeRuntime,
        preclaimedContext: fence,
        executionFence: fence
      });

      const outcome = String(executionResult?.outcome || (executionResult?.success ? 'COMPLETED' : 'FAILED'));
      if (outcome === 'LEASE_LOST' || executionResult?.errorCode === 'TASK_WORKER_LEASE_LOST') {
        return result(500, { accepted: false, code: 'TASK_WORKER_LEASE_LOST', taskId }, {
          outcome: 'lease_lost',
          code: 'TASK_WORKER_LEASE_LOST'
        });
      }

      if (outcome === 'CONTINUE') {
        const disposition = await finishWorkerState(
          activeRuntime,
          taskId,
          fence,
          'PENDING',
          undefined,
          executionResult?.nextStage || null,
          null,
          executionResult?.handoffPatch || null,
          executionResult?.handoffToken || null
        );
        if (!disposition.ok) {
          return result(500, { accepted: false, code: disposition.code, taskId }, {
            outcome: disposition.code === 'TASK_WORKER_LEASE_LOST' ? 'lease_lost' : 'failed',
            code: disposition.code
          });
        }
        return result(200, {
          accepted: true,
          code: 'TASK_STAGE_COMPLETED',
          taskId,
          nextStage: executionResult?.nextStage || null
        }, {
          outcome: 'stage_completed',
          code: 'TASK_STAGE_COMPLETED',
          stage: executionResult?.nextStage || null,
          reschedule: true
        });
      }

      if (outcome === 'WAITING_USER') {
        const disposition = await finishWorkerState(activeRuntime, taskId, fence, 'WAITING_USER');
        if (!disposition.ok) {
          return result(500, { accepted: false, code: disposition.code, taskId }, {
            outcome: disposition.code === 'TASK_WORKER_LEASE_LOST' ? 'lease_lost' : 'failed',
            code: disposition.code
          });
        }
        return result(200, { accepted: true, code: 'TASK_WAITING_USER', taskId }, {
          outcome: 'waiting_user',
          code: 'TASK_WAITING_USER'
        });
      }

      if (outcome === 'COMPLETED') {
        const disposition = await finishWorkerState(
          activeRuntime,
          taskId,
          fence,
          'COMPLETED',
          undefined,
          null,
          executionResult?.resultId || null
        );
        if (!disposition.ok) {
          return result(500, { accepted: false, code: disposition.code, taskId }, {
            outcome: disposition.code === 'TASK_WORKER_LEASE_LOST' ? 'lease_lost' : 'failed',
            code: disposition.code
          });
        }
        return result(200, { accepted: true, code: 'TASK_COMPLETED', taskId }, {
          outcome: 'completed',
          code: 'TASK_COMPLETED'
        });
      }

      const disposition = await finishWorkerState(activeRuntime, taskId, fence, 'FAILED', executionResult?.errorCode);
      if (!disposition.ok) {
        return result(500, { accepted: false, code: disposition.code, taskId }, {
          outcome: disposition.code === 'TASK_WORKER_LEASE_LOST' ? 'lease_lost' : 'failed',
          code: disposition.code
        });
      }
      const failureDetails = {
        errorCode: executionResult?.errorCode || disposition.errorCode || null,
        causeCode: executionResult?.causeCode || disposition.causeCode || null,
        fieldPath: executionResult?.fieldPath || disposition.fieldPath || null,
        requestStage: executionResult?.requestStage || disposition.requestStage || null,
        modelProvider: executionResult?.modelProvider || disposition.modelProvider || null,
        modelName: executionResult?.modelName || disposition.modelName || null,
        providerRequestIdPresent: executionResult?.providerRequestIdPresent === true || disposition.providerRequestIdPresent === true,
        repairAttempted: executionResult?.repairAttempted === true || disposition.repairAttempted === true,
        repairAttemptCount: Number(executionResult?.repairAttemptCount || disposition.repairAttemptCount || 0),
        repairFailureStage: executionResult?.repairFailureStage || disposition.repairFailureStage || null,
        failureId: executionResult?.failureId || disposition.failureId || null
      };
      return result(200, {
        accepted: true,
        code: 'TASK_EXECUTION_FAILED',
        taskId,
        ...failureDetails
      }, {
        outcome: 'failed',
        code: 'TASK_EXECUTION_FAILED',
        ...failureDetails
      });
    } catch (error) {
      if (error && error.code === 'TASK_WORKER_LEASE_LOST') {
        return result(500, { accepted: false, code: 'TASK_WORKER_LEASE_LOST', taskId }, {
          outcome: 'lease_lost',
          code: 'TASK_WORKER_LEASE_LOST'
        });
      }
      const normalized = normalizeError(error);
      const disposition = await finishWorkerState(activeRuntime, taskId, fence, 'FAILED', normalized.code);
      if (!disposition.ok) {
        return result(500, { accepted: false, code: disposition.code, taskId }, {
          outcome: disposition.code === 'TASK_WORKER_LEASE_LOST' ? 'lease_lost' : 'failed',
          code: disposition.code
        });
      }
      const failureDetails = {
        errorCode: disposition.errorCode || normalized.code || null,
        causeCode: disposition.causeCode || normalized.causeCode || null,
        fieldPath: disposition.fieldPath || normalized.fieldPath || null,
        requestStage: disposition.requestStage || normalized.requestStage || null,
        modelProvider: disposition.modelProvider || normalized.modelProvider || null,
        modelName: disposition.modelName || normalized.modelName || null,
        providerRequestIdPresent: disposition.providerRequestIdPresent === true || normalized.providerRequestIdPresent === true,
        repairAttempted: disposition.repairAttempted === true || normalized.repairAttempted === true,
        repairAttemptCount: Number(disposition.repairAttemptCount || normalized.repairAttemptCount || 0),
        repairFailureStage: disposition.repairFailureStage || normalized.repairFailureStage || null,
        failureId: disposition.failureId || normalized.failureId || null
      };
      return result(200, {
        accepted: true,
        code: 'TASK_EXECUTION_FAILED',
        taskId,
        ...failureDetails
      }, {
        outcome: 'failed',
        code: 'TASK_EXECUTION_FAILED',
        ...failureDetails
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function executeJob(taskId, persistentQueue = true) {
    if (activeExecutionTaskIds.has(taskId)) {
      console.info('[gradingWorker] WORKER_LOCAL_EXECUTION_DEDUPED', JSON.stringify({ taskId }));
      return {
        statusCode: 200,
        body: { accepted: true, code: 'TASK_ALREADY_CLAIMED', taskId },
        schedulerOutcome: {
          reachedDispatch: false,
          reachedClaim: false,
          outcome: 'already_claimed',
          code: 'TASK_ALREADY_CLAIMED'
        }
      };
    }
    activeExecutionTaskIds.add(taskId);
    try {
      return await executeJobInternal(taskId, persistentQueue);
    } finally {
      activeExecutionTaskIds.delete(taskId);
    }
  }

  scheduler = createTaskScheduler({
    db: getQueueDb(),
    execute: (taskId) => executeJob(taskId, true),
    concurrency,
    onError: logUnexpectedError,
    onLog: (event, data) => console.info(`[gradingWorker] ${event}`, JSON.stringify(data)),
    maintenance: () => taskFailureCase.reconcileTaskFailureCases({
      db: getQueueDb(),
      limit: 20,
      archiveSource: 'reconciler',
      runtimeBuildId: RUNTIME_BUILD_ID,
      now: new Date()
    })
  });

  async function readiness() {
    const missing = [];
    if (!String(token || '').trim()) missing.push('GRADING_WORKER_TOKEN');
    if (!String(process.env.CLOUDBASE_ENV_ID || '').trim()) missing.push('CLOUDBASE_ENV_ID');
    if (!String(process.env.ARK_API_KEY || '').trim()) missing.push('ARK_API_KEY');
    if (!String(process.env.ARK_MINI_ENDPOINT || '').trim()) missing.push('ARK_MINI_ENDPOINT');
    if (!String(process.env.ARK_LITE_ENDPOINT || '').trim()) missing.push('ARK_LITE_ENDPOINT');
    if (String(process.env.STRATEGY_REMOTE_REQUIRED || 'false').toLowerCase() === 'true') {
      for (const key of ['STRATEGY_SERVICE_URL', 'STRATEGY_CUSTOMER_ID', 'STRATEGY_LICENSE_ID', 'STRATEGY_LICENSE_KEY', 'STRATEGY_PUBLIC_KEY_BASE64']) {
        if (!String(process.env[key] || '').trim()) missing.push(key);
      }
    }
    if (missing.length) {
      return { ready: false, code: 'REQUIRED_ENV_MISSING', missing };
    }
    try {
      const collection = getQueueDb().collection('grading_tasks');
      if (collection && typeof collection.limit === 'function') {
        await collection.limit(1).get();
      }
    } catch (error) {
      return { ready: false, code: 'DATABASE_NOT_READY', errorCode: normalizeError(error).code };
    }
    return { ready: true };
  }

  const server = http.createServer(async (request, response) => {
    let taskId;
    try {
      const url = new URL(request.url, 'http://localhost');

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'gradingWorker',
          runtimeBuildId: RUNTIME_BUILD_ID,
          schedulerMode: SCHEDULER_MODE,
          queued: scheduler.pendingTaskIds.size,
          running: scheduler.runningTaskIds.size,
          concurrency,
          queueLimit,
          draining: scheduler.draining,
          drainScheduled: scheduler.drainScheduled
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/ready') {
        const state = await readiness();
        sendJson(response, state.ready ? 200 : 503, {
          ok: state.ready,
          service: 'gradingWorker',
          schedulerMode: SCHEDULER_MODE,
          ...state
        });
        return;
      }

      const internalPostPaths = ['/internal/jobs/run', '/internal/jobs/enqueue', '/internal/jobs/kick', '/internal/providers/status', '/internal/hard-problem/training/evaluate'];
      if (request.method !== 'POST' || !internalPostPaths.includes(url.pathname)) {
        sendJson(response, 404, { code: 'NOT_FOUND' });
        return;
      }

      if (!token || request.headers.authorization !== `Bearer ${token}`) {
        sendJson(response, 401, { code: 'UNAUTHORIZED' });
        return;
      }

      if (url.pathname === '/internal/providers/status') {
        sendJson(response, 200, { ok: true, code: 'OK', providerStatusContractVersion: PROVIDER_STATUS_CONTRACT_VERSION, runtimeBuildId: RUNTIME_BUILD_ID, providers: providerReadiness() });
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(request);
      } catch {
        sendJson(response, 400, { code: 'INVALID_TASK_ID' });
        return;
      }

      if (url.pathname === '/internal/hard-problem/training/evaluate') {
        const operation = typeof payload?.operation === 'string' ? payload.operation.trim() : '';
        if (!operation || !payload?.payload || typeof payload.payload !== 'object' || Array.isArray(payload.payload)) {
          sendJson(response, 400, { code: 'INVALID_TRAINING_PAYLOAD' });
          return;
        }
        const result = await evaluateHardProblemTraining(operation, payload.payload);
        sendJson(response, 200, { ok: true, code: 'OK', runtimeBuildId: RUNTIME_BUILD_ID, result });
        return;
      }

      if (!isValidTaskPayload(payload)) {
        sendJson(response, 400, { code: 'INVALID_TASK_ID' });
        return;
      }
      taskId = payload.taskId;

      if (url.pathname === '/internal/jobs/enqueue' || url.pathname === '/internal/jobs/kick') {
        if (shuttingDown) {
          sendJson(response, 503, { accepted: false, code: 'WORKER_SHUTTING_DOWN' });
          return;
        }
        const persisted = await queueTask(taskId, url.pathname === '/internal/jobs/kick');
        if (!['TASK_ENQUEUED', 'TASK_ALREADY_ENQUEUED'].includes(persisted.body.code)) {
          sendJson(response, persisted.statusCode, persisted.body);
          return;
        }
        if (!persisted.shouldSchedule) {
          sendJson(response, persisted.statusCode, persisted.body);
          return;
        }

        const alreadyLocal = scheduler.pendingTaskIds.has(taskId) || scheduler.runningTaskIds.has(taskId);
        if (!alreadyLocal && scheduler.pendingTaskIds.size + scheduler.runningTaskIds.size >= queueLimit) {
          sendJson(response, 429, { accepted: false, code: 'WORKER_QUEUE_FULL', taskId });
          return;
        }

        const scheduled = await scheduler.wake(taskId);
        if (!scheduled.accepted) {
          sendJson(response, 503, { accepted: false, code: scheduled.code, taskId });
          return;
        }
        sendJson(
          response,
          url.pathname === '/internal/jobs/enqueue' || scheduled.code === 'TASK_ENQUEUED'
            ? 202
            : persisted.statusCode,
          { accepted: true, code: scheduled.code, taskId }
        );
        return;
      }

      const outcome = await executeJob(taskId, false);
      sendJson(response, outcome.statusCode, outcome.body);
    } catch (error) {
      sendInternalError(response, error, taskId);
    }
  });

  server.beginShutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    scheduler.stop();
    shutdownPromise = (async () => {
      const closePromise = server.listening
        ? new Promise((resolve) => server.close(resolve))
        : Promise.resolve();
      const graceMs = boundedInteger(process.env.GRADING_WORKER_SHUTDOWN_GRACE_MS, 30000, 1000, 60000);
      await scheduler.waitForIdle(graceMs);
      await closePromise;
    })();
    return shutdownPromise;
  };

  server.once('listening', () => {
    if (startRecovery && !recoveryStarted) {
      recoveryStarted = true;
      scheduler.start().catch(logUnexpectedError);
    }
  });

  return server;
}

function createWorkerRuntime() {
  const client = getCloudbaseClient();
  const context = { cloud: client.cloud, db: client.database() };
  return createGradingRuntimeFromModuleRoot({
    moduleRoot: `${__dirname}/runtime/taskWorker-shared`,
    context,
    auditSource: 'gradingWorker',
    getFirstDocument,
    scheduleNextStage: async ({ taskId, stage }) => {
      console.info('[gradingWorker] TASK_STAGE_PERSISTED', JSON.stringify({ taskId, stage }));
      return { scheduled: true, mode: 'database_scheduler' };
    },
    deferStagePersistence: true,
    enqueueTts: async ({ resultId }) => client.callFunction({ name: 'ttsWorker', data: { resultId } })
  });
}

async function updateIfCurrentLease(runtime, taskId, fence, data) {
  const db = runtime.context.db;
  const updated = await updateByCurrentLease(db, taskId, fence, data);
  if (updated) return true;
  const task = await readTask(db, taskId).catch(() => null);
  console.error('[gradingWorker] WORKER_FENCE_MISMATCH', JSON.stringify({
    taskId,
    expectedOwnerFingerprint: ownerFingerprint(fence.workerLeaseOwner),
    actualOwnerFingerprint: ownerFingerprint(task?.workerLeaseOwner),
    expectedAttempt: fence.workerAttempt,
    actualAttempt: task?.workerAttempt,
    observedWorkerQueueStatus: task?.workerQueueStatus,
    observedWorkerStatus: task?.workerStatus
  }));
  return false;
}

function startHeartbeat(runtime, taskId, fence) {
  const leaseMs = resolveLeaseMs();
  const heartbeat = async () => {
    const now = new Date();
    const renewed = await updateByCurrentLease(runtime.context.db, taskId, fence, {
      workerHeartbeatAt: now,
      workerLeaseUntil: new Date(now.getTime() + leaseMs)
    });
    if (!renewed) {
      console.info('[gradingWorker] WORKER_HEARTBEAT_FENCE_LOST', JSON.stringify({
        taskId,
        ownerFingerprint: ownerFingerprint(fence.workerLeaseOwner),
        workerAttempt: fence.workerAttempt
      }));
    }
    return renewed;
  };
  void heartbeat().catch(logUnexpectedError);
  return setInterval(() => {
    void heartbeat().catch(logUnexpectedError);
  }, Math.min(resolveHeartbeatMs(), Math.max(10000, Math.floor(leaseMs / 3))));
}

function stageRank(stage) {
  return {
    PREPARING_IMAGES: 1,
    PRIMARY_GRADING: 2,
    REVIEW_GRADING: 3,
    FINALIZING_RESULT: 4,
    COMPLETED: 5
  }[String(stage || '')] || 0;
}

const HANDOFF_PROTECTED_FIELDS = new Set([
  '_id',
  'status',
  'currentStage',
  'workerQueueStatus',
  'workerStatus',
  'workerLeaseOwner',
  'workerLeaseUntil',
  'workerAttempt',
  'workerHeartbeatAt',
  'workerNextDispatchAt',
  'workerStageFinishedAt',
  'workerFinishedAt',
  'workerQueueError',
  'resultId',
  'completedAt',
  'failedAt'
]);

function sanitizeStageHandoffPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !HANDOFF_PROTECTED_FIELDS.has(key))
  );
}

function taskAlreadyAcceptedHandoff(task, expectedNextStage, fence, expectedHandoffToken = null) {
  if (!task || !expectedNextStage) return false;
  if (task.status === 'COMPLETED' && task.resultId) return true;
  const observedRank = stageRank(task.currentStage);
  const expectedRank = stageRank(expectedNextStage);
  if (!observedRank || !expectedRank || observedRank < expectedRank) return false;
  if (['FAILED', 'CANCELLED', 'NEED_CONFIRMATION', 'NEED_ANSWER'].includes(String(task.status || ''))) return false;
  if (observedRank > expectedRank) return true;
  const tokenMatches = !expectedHandoffToken || String(task.stageHandoffToken || '') === String(expectedHandoffToken);
  if (!tokenMatches) return false;
  if (task.status === 'QUEUED' && ['PENDING', 'DISPATCHED'].includes(String(task.workerQueueStatus || ''))) return true;
  if (task.status === 'PROCESSING'
    && task.workerQueueStatus === 'RUNNING'
    && task.workerStatus === 'RUNNING'
    && Number(task.workerAttempt || 0) > Number(fence.workerAttempt || 0)) return true;
  return false;
}

async function finishWorkerState(runtime, taskId, fence, disposition, explicitErrorCode, expectedNextStage = null, expectedResultId = null, expectedHandoffPatch = null, expectedHandoffToken = null, archiveOptions = {}) {
  const db = runtime.context.db;
  const now = new Date();
  let task;
  try {
    task = await readTask(db, taskId);
  } catch (error) {
    databaseOperationFailureDiagnostic({
      taskId,
      currentStage: expectedNextStage === 'FINALIZING_RESULT' ? 'REVIEW_GRADING' : null,
      nextStage: expectedNextStage,
      dbOperation: 'stage_handoff_task_read',
      requestStage: null,
      modelProvider: null,
      modelName: null
    }, error);
    throw error;
  }

  if (disposition === 'PENDING') {
    const nextStage = String(expectedNextStage || task?.currentStage || '').trim();
    const handoffPatch = sanitizeStageHandoffPatch(expectedHandoffPatch);
    const handoffToken = String(expectedHandoffToken || handoffPatch.stageHandoffToken || '').trim() || null;
    const reviewHandoffContext = task?.currentStage === 'REVIEW_GRADING' && nextStage === 'FINALIZING_RESULT'
      ? {
          taskId,
          currentStage: task.currentStage,
          nextStage,
          requestStage: task.requestStage || task.failureRequestStage || null,
          modelProvider: task.modelProvider || task.failureModelProvider || null,
          modelName: task.modelName || task.failureModelName || null
        }
      : null;
    if (!nextStage || !stageRank(nextStage)) {
      return { ok: false, code: 'TASK_NEXT_STAGE_INVALID' };
    }
    if (taskAlreadyAcceptedHandoff(task, nextStage, fence, handoffToken)) {
      console.info('[gradingWorker] WORKER_STAGE_HANDOFF_ALREADY_ACCEPTED', JSON.stringify({
        taskId,
        expectedNextStage: nextStage,
        observedStage: task?.currentStage || null,
        observedStatus: task?.status || null,
        observedWorkerAttempt: task?.workerAttempt || null
      }));
      return { ok: true, code: 'TASK_STAGE_COMPLETED', idempotent: true };
    }
    if (!taskHasCurrentLease(task, fence)) {
      let current;
      try {
        current = await readTask(db, taskId);
      } catch (error) {
        if (reviewHandoffContext) databaseOperationFailureDiagnostic({ ...reviewHandoffContext, dbOperation: 'review_schedule_fence_read' }, error);
        throw error;
      }
      if (taskAlreadyAcceptedHandoff(current, nextStage, fence, handoffToken)) {
        return { ok: true, code: 'TASK_STAGE_COMPLETED', idempotent: true };
      }
      return { ok: false, code: 'TASK_WORKER_LEASE_LOST' };
    }

    const patch = {
      ...handoffPatch,
      workerHeartbeatAt: now,
      workerLeaseOwner: null,
      workerLeaseUntil: null,
      updatedAt: now,
      status: 'QUEUED',
      currentStage: nextStage,
      workerStatus: 'PENDING',
      workerQueueStatus: 'PENDING',
      workerQueueError: null,
      workerNextDispatchAt: now,
      workerStageFinishedAt: now
    };
    const replaceTopLevelFields = Object.keys(handoffPatch);
    if (await updateByCurrentLease(
      db,
      taskId,
      fence,
      patch,
      replaceTopLevelFields,
      reviewHandoffContext ? { ...reviewHandoffContext, dbOperation: 'review_handoff_update' } : null
    )) {
      console.info('[gradingWorker] WORKER_STAGE_HANDOFF_CONFIRMED', JSON.stringify({
        taskId,
        nextStage,
        handoffTokenPresent: Boolean(handoffToken),
        handoffFieldCount: Object.keys(handoffPatch).length,
        mode: STAGE_HANDOFF_MODE
      }));
      return { ok: true, code: 'TASK_STAGE_COMPLETED' };
    }
    let current;
    try {
      current = await readTask(db, taskId);
    } catch (error) {
      if (reviewHandoffContext) databaseOperationFailureDiagnostic({ ...reviewHandoffContext, dbOperation: 'review_post_request_fence_read', patch }, error);
      throw error;
    }
    if (taskAlreadyAcceptedHandoff(current, nextStage, fence, handoffToken)) {
      return { ok: true, code: 'TASK_STAGE_COMPLETED', idempotent: true };
    }
    return { ok: false, code: 'TASK_WORKER_LEASE_LOST' };
  }

  if (!taskHasCurrentLease(task, fence)) {
    return { ok: false, code: 'TASK_WORKER_LEASE_LOST' };
  }

  const base = {
    workerHeartbeatAt: now,
    workerLeaseOwner: null,
    workerLeaseUntil: null,
    updatedAt: now
  };
  const failureId = task.failureId || `worker_failure_${createHash('sha256')
    .update(`${taskId}:${fence.workerAttempt || 0}:${now.toISOString()}`)
    .digest('hex').slice(0, 24)}`;

  let patch;
  let response;
  if (disposition === 'WAITING_USER') {
    if (!taskWaitsForUser(task)) return { ok: false, code: 'TASK_WAITING_STATE_INVALID' };
    patch = {
      ...base,
      workerStatus: 'WAITING_USER',
      workerQueueStatus: 'WAITING_USER',
      workerQueueError: null,
      workerNextDispatchAt: null,
      workerFinishedAt: now
    };
    response = { ok: true, code: 'TASK_WAITING_USER' };
  } else if (disposition === 'COMPLETED') {
    const completionResultId = task?.resultId || expectedResultId || null;
    if (!taskIsComplete(task) && !completionResultId) {
      const errorCode = 'TASK_RESULT_NOT_READY';
      patch = {
        ...base,
        status: 'FAILED',
        currentStage: 'FAILED',
        errorCode,
        errorMessage: '批改结果尚未完整保存',
        errorSuggestion: '请稍后重新处理任务',
        retryable: true,
        failureId,
        failedStage: task.failedStage || task.currentStage || null,
        workerStatus: 'FAILED',
        workerQueueStatus: 'FAILED',
        workerQueueError: errorCode,
        workerFinishedAt: now,
        failedAt: task.failedAt || now
      };
      response = { ok: false, code: errorCode, errorCode };
    } else {
      patch = {
        ...base,
        status: 'COMPLETED',
        currentStage: 'COMPLETED',
        resultId: completionResultId,
        workerStatus: 'COMPLETED',
        workerQueueStatus: 'COMPLETED',
        workerQueueError: null,
        workerNextDispatchAt: null,
        workerFinishedAt: now,
        completedAt: task.completedAt || now
      };
      if (!taskIsComplete(task) && expectedResultId) {
        console.info('[gradingWorker] WORKER_COMPLETION_CONFIRMED_FROM_PROCESS_RESULT', JSON.stringify({
          taskId,
          resultIdPresent: true,
          mode: STAGE_HANDOFF_MODE
        }));
      }
      response = { ok: true, code: 'TASK_COMPLETED' };
    }
  } else {
    const errorCode = task.errorCode || explicitErrorCode || 'TASK_EXECUTION_FAILED';
    patch = {
      ...base,
      ...(task.status === 'FAILED' ? {} : {
        status: 'FAILED',
        currentStage: 'FAILED',
        errorCode,
        errorMessage: task.errorMessage || '批改任务执行失败',
        errorSuggestion: task.errorSuggestion || '请稍后重新尝试',
        retryable: task.retryable !== false,
        failureId,
        failedStage: task.failedStage || task.currentStage || null
      }),
      ...(disposition === 'FAILED' && !task.failedAt ? { failedAt: now } : {}),
      workerStatus: 'FAILED',
      workerQueueStatus: 'FAILED',
      workerQueueError: errorCode,
      workerNextDispatchAt: null,
      workerFinishedAt: now
    };
    response = {
      ok: true,
      code: 'TASK_EXECUTION_FAILED',
      errorCode,
      causeCode: task.failureCauseCode || null,
      fieldPath: task.failureFieldPath || null,
      requestStage: task.failureRequestStage || null,
      modelProvider: task.failureModelProvider || null,
      modelName: task.failureModelName || null,
      providerRequestIdPresent: task.failureProviderRequestIdPresent === true,
      repairAttempted: task.failureRepairAttempted === true,
      repairAttemptCount: Number(task.failureRepairAttemptCount || 0),
      repairFailureStage: task.failureRepairFailureStage || null,
      failureId: task.failureId || null
    };
  }

  const failureStateContext = disposition === 'FAILED'
    ? {
        taskId,
        currentStage: task?.currentStage || null,
        nextStage: null,
        dbOperation: 'failure_state_update',
        requestStage: task?.requestStage || task?.failureRequestStage || null,
        modelProvider: task?.modelProvider || task?.failureModelProvider || null,
        modelName: task?.modelName || task?.failureModelName || null
      }
    : null;
  const archiveFailure = archiveOptions.archiveTaskFailureCase || taskFailureCase.archiveTaskFailureCase;
  const updated = await updateByCurrentLease(db, taskId, fence, patch, null, failureStateContext);
  if (!updated) return { ok: false, code: 'TASK_WORKER_LEASE_LOST' };
  if (patch.status === 'FAILED' || disposition === 'FAILED') {
    const readbackTask = await readTask(db, taskId).catch(() => null);
    const failedTask = readbackTask && typeof readbackTask === 'object' && Object.keys(readbackTask).length
      ? readbackTask
      : { ...task, ...patch, _id: taskId };
    await archiveFailure({
      db,
      task: failedTask,
      error: archiveOptions.error || null,
      archiveSource: 'gradingWorker',
      runtimeBuildId: RUNTIME_BUILD_ID,
      archivedAt: failedTask.failedAt || now
    }).catch((archiveError) => {
      console.error('[gradingWorker] TASK_FAILURE_ARCHIVE_FAILED', JSON.stringify({
        taskId,
        errorCode: normalizeError(archiveError).code
      }));
    });
  }
  return response;
}

if (require.main === module) {
  try {
    const port = Number(process.env.PORT) || 8080;
    console.log('GRADING_WORKER_SCHEDULER_MODE=DATABASE_POLLING_V1');
    console.log('GRADING_WORKER_FENCE_MODE=CONDITIONAL_UPDATE_V2');
    console.log('GRADING_WORKER_STAGE_HANDOFF_MODE=ATOMIC_PAYLOAD_AUTHORITY_V4');
    console.log(`GRADING_WORKER_RUNTIME_BUILD_ID=${RUNTIME_BUILD_ID}`);
    const server = createServer();
    const shutdown = async () => {
      try {
        await server.beginShutdown();
      } catch (error) {
        logUnexpectedError(error);
        process.exitCode = 1;
      }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    server.once('error', (error) => {
      logUnexpectedError(error);
      process.exitCode = 1;
    });
    server.listen(port);
  } catch (error) {
    logUnexpectedError(error);
    process.exit(1);
  }
}

module.exports = {
  createServer,
  resolveHeartbeatMs,
  resolveConcurrency,
  resolveQueueLimit,
  createWorkerRuntime,
  normalizeError,
  inspectDatabasePatch,
  providerReadiness,
  finishWorkerState,
  sanitizeStageHandoffPatch,
  taskIsComplete,
  SCHEDULER_MODE,
  STAGE_HANDOFF_MODE,
  RUNTIME_BUILD_ID
};
