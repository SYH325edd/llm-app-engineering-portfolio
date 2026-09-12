const { randomUUID } = require('node:crypto');
const { getCloudbaseClient } = require('./cloudbase-client');
const { getFirstDocument } = require('./document-snapshot');

const TASK_COLLECTION = 'grading_tasks';
const DEFAULT_LEASE_MS = 300000;
const MIN_LEASE_MS = 60000;
const MAX_LEASE_MS = 1800000;

function resolveLeaseMs(value = process.env.GRADING_WORKER_LEASE_MS) {
  const leaseMs = Number(value);
  return Number.isInteger(leaseMs) && leaseMs >= MIN_LEASE_MS && leaseMs <= MAX_LEASE_MS
    ? leaseMs : DEFAULT_LEASE_MS;
}

function toMilliseconds(value) {
  const milliseconds = new Date(value).getTime();
  return Number.isNaN(milliseconds) ? 0 : milliseconds;
}

function isDocumentNotFoundError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (['DOCUMENT_NOT_FOUND', 'DOCUMENT_NOT_EXIST', 'DOC_NOT_FOUND', 'DATABASE_DOCUMENT_NOT_FOUND', 'DATABASE_DOCUMENT_NOT_EXIST'].includes(code)) return true;
  const message = `${error?.message || ''} ${error?.errMsg || ''}`;
  return /\b(document|doc)\s+(is\s+)?not\s+(found|exist)\b/i.test(message);
}

function updatedCount(result) {
  const candidates = [result?.updated, result?.stats?.updated, result?.data?.updated, result?.matched];
  return candidates.find((value) => Number.isFinite(Number(value))) ?? null;
}

function claimErrorCode(error) {
  return error && typeof error.code === 'string' && error.code.trim() ? error.code.trim() : 'TASK_CLAIM_INTERNAL_ERROR';
}

function claimErrorMessage(error) {
  const message = error instanceof Error ? error.message : typeof error?.message === 'string' ? error.message : typeof error?.errMsg === 'string' ? error.errMsg : 'TASK_CLAIM_INTERNAL_ERROR';
  return /(token|apikey|api_key|prompt|student|image|leaseowner)/i.test(message) ? 'TASK_CLAIM_INTERNAL_ERROR' : String(message).slice(0, 500);
}

function createClaimTask(options = {}) {
  const db = options.db || getCloudbaseClient().database();
  const instanceId = options.instanceId || randomUUID();
  const createLeaseOwner = typeof options.createLeaseOwner === 'function'
    ? options.createLeaseOwner
    : () => `${instanceId}:${randomUUID()}`;
  const leaseMs = options.leaseMs || resolveLeaseMs();
  const now = options.now || (() => new Date());
  const collection = () => db.collection(TASK_COLLECTION);
  const readTask = async (taskId) => getFirstDocument(await collection().doc(taskId).get());
  const logResult = (taskId, code, updated, task, ownerMatched) => {
    console.info('[gradingWorker] WORKER_CLAIM_RESULT', JSON.stringify({
      taskId,
      code,
      updated,
      leaseAcquired: code === 'TASK_CLAIMED',
      workerAttempt: task ? Number(task.workerAttempt || 0) : null,
      ownerMatched
    }));
  };
  const response = (code, taskId, task, updated, ownerMatched) => {
    logResult(taskId, code, updated, task, ownerMatched);
    const statusCode = code === 'TASK_CLAIMED' ? 200 : code === 'TASK_NOT_FOUND' ? 404 : code === 'TASK_ALREADY_COMPLETED' ? 200 : 409;
    return {
      statusCode,
      ...(code === 'TASK_CLAIMED' ? {
        code,
        taskId,
        workerLeaseOwner: task.workerLeaseOwner,
        workerAttempt: Number(task.workerAttempt || 0),
        workerLeaseUntil: task.workerLeaseUntil,
        claimContext: { workerLeaseOwner: task.workerLeaseOwner, workerAttempt: Number(task.workerAttempt || 0), workerLeaseUntil: task.workerLeaseUntil }
      } : {}),
      body: { accepted: code === 'TASK_CLAIMED', code, taskId }
    };
  };

  return async function claimTask(taskId) {
    let stage = 'CLAIM_READ_BEFORE';
    try {
    let before = await readTask(taskId);
    if (!before) return response('TASK_NOT_FOUND', taskId, null, null, false);
    if (before.status === 'COMPLETED' && before.resultId) return response('TASK_ALREADY_COMPLETED', taskId, before, null, false);
    if (['FAILED', 'CANCELLED'].includes(before.status) || ['FAILED', 'CANCELLED'].includes(before.workerQueueStatus)) return response('TASK_NOT_DISPATCHABLE', taskId, before, null, false);

    if (!Object.prototype.hasOwnProperty.call(before, 'workerAttempt')) {
      stage = 'CLAIM_NORMALIZE_ATTEMPT';
      const normalizeConditions = { _id: taskId, workerQueueStatus: before.workerQueueStatus };
      if (before.workerQueueStatus === 'RUNNING') {
        normalizeConditions.workerLeaseOwner = before.workerLeaseOwner;
        normalizeConditions.workerLeaseUntil = before.workerLeaseUntil;
      }
      await collection().where(normalizeConditions).update({ workerAttempt: 0 });
      before = await readTask(taskId);
      if (!before) return response('TASK_NOT_FOUND', taskId, null, null, false);
      if (before.status === 'COMPLETED' && before.resultId) return response('TASK_ALREADY_COMPLETED', taskId, before, null, false);
      if (['FAILED', 'CANCELLED'].includes(before.status) || ['FAILED', 'CANCELLED'].includes(before.workerQueueStatus)) return response('TASK_NOT_DISPATCHABLE', taskId, before, null, false);
    }

    const claimedAt = now();
    const workerLeaseUntil = new Date(claimedAt.getTime() + leaseMs);
    const beforeAttempt = Number(before.workerAttempt || 0);
    const claimOwner = String(createLeaseOwner({ taskId, instanceId, beforeAttempt, claimedAt }) || '').trim();
    if (!claimOwner) throw Object.assign(new Error('claim owner factory returned an empty value'), { code: 'TASK_CLAIM_OWNER_INVALID' });
    let conditions;
    if (before.workerQueueStatus === 'DISPATCHED') {
      conditions = { _id: taskId, workerQueueStatus: 'DISPATCHED', workerAttempt: beforeAttempt };
    } else if (before.workerQueueStatus === 'RUNNING' && toMilliseconds(before.workerLeaseUntil) <= claimedAt.getTime()) {
      conditions = {
        _id: taskId,
        workerQueueStatus: 'RUNNING',
        workerLeaseOwner: before.workerLeaseOwner,
        workerAttempt: before.workerAttempt,
        workerLeaseUntil: db.command.lte(claimedAt)
      };
    } else if (before.workerQueueStatus === 'RUNNING') {
      return response('TASK_ALREADY_CLAIMED', taskId, before, null, false);
    } else {
      return response('TASK_NOT_DISPATCHABLE', taskId, before, null, false);
    }

    stage = 'CLAIM_UPDATE';
    const result = await collection().where(conditions).update({
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: claimOwner,
      workerLeaseUntil,
      workerStartedAt: claimedAt,
      workerHeartbeatAt: claimedAt,
      workerAttempt: db.command.inc(1),
      workerQueueError: null,
      updatedAt: claimedAt
    });
    const updated = updatedCount(result);
    stage = 'CLAIM_READ_AFTER';
    const after = await readTask(taskId);
    if (!after) return response('TASK_NOT_FOUND', taskId, null, updated, false);
    stage = 'CLAIM_VERIFY_OWNER';
    const ownerMatched = after.workerLeaseOwner === claimOwner;
    const attemptMatched = Number(after.workerAttempt || 0) === beforeAttempt + 1;
    if (ownerMatched && attemptMatched && after.workerQueueStatus === 'RUNNING' && after.workerStatus === 'RUNNING' && after.workerLeaseUntil) {
      stage = 'CLAIM_COMPLETE';
      return response('TASK_CLAIMED', taskId, after, updated, true);
    }
    if (after.status === 'COMPLETED' && after.resultId) return response('TASK_ALREADY_COMPLETED', taskId, after, updated, false);
    if (['FAILED', 'CANCELLED'].includes(after.status) || ['FAILED', 'CANCELLED'].includes(after.workerQueueStatus)) return response('TASK_NOT_DISPATCHABLE', taskId, after, updated, false);
    if (after.workerQueueStatus === 'RUNNING' && !ownerMatched) return response('TASK_ALREADY_CLAIMED', taskId, after, updated, false);
    return response('TASK_CLAIM_NOT_APPLIED', taskId, after, updated, false);
    } catch (error) {
      const code = claimErrorCode(error);
      const message = claimErrorMessage(error);
      const resultKeys = error?.result && typeof error.result === 'object' && !Array.isArray(error.result) ? Object.keys(error.result).sort() : undefined;
      console.error('[gradingWorker] WORKER_CLAIM_ERROR', JSON.stringify({ taskId, stage, name: error?.name || 'Error', code, message, requestId: error?.requestId, resultKeys }));
      const normalized = new Error(message, { cause: error });
      normalized.code = code;
      normalized.stage = stage;
      normalized.requestId = error?.requestId;
      throw normalized;
    }
  };
}

module.exports = { createClaimTask, resolveLeaseMs, isDocumentNotFoundError, getFirstDocument };
