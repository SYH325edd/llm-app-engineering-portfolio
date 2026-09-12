'use strict';

const { randomUUID } = require('node:crypto');

const TASK_FAILURE_COLLECTION = 'task_failure_cases';
const TRAINING_FAILURE_COLLECTION = 'training_failure_events';
const ARCHIVE_VERSION = 1;
const RECONCILER_STATE_ID = 'task_failure_case_reconciler_v1';

const TRAINING_ACTIONS = Object.freeze({
  startHardProblemTraining: 'start',
  submitHardProblemExplanation: 'submitExplanation',
  submitHardProblemRetell: 'submitRetell',
  submitHardProblemVariant: 'submitVariant',
  getHardProblemReview: 'getReview',
  submitHardProblemReview: 'submitReview'
});

function safeText(value, limit = 500) {
  return String(value ?? '')
    .replace(/cloud:\/\/[^\s\"',}]+/g, '[REDACTED_FILE_ID]')
    .replace(/https?:\/\/\S+/g, '[REDACTED_URL]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(token|authorization|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, limit) || null;
}

function safeErrorCode(value, fallback) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(code) ? code : fallback;
}

function firstDocument(snapshot) {
  const data = snapshot?.data;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isCollectionMissing(error) {
  const code = String(error?.code || error?.errCode || '').toUpperCase();
  const message = String(error?.message || error?.errMsg || '');
  return /COLLECTION.*(?:NOT[_ -]?FOUND|NOT[_ -]?EXIST)|DATABASE_COLLECTION_NOT_EXIST|RESOURCE_NOT_FOUND/.test(code)
    || /collection.*(?:not found|not exist)|集合.*(?:不存在|未创建)/i.test(message);
}

function isCollectionAlreadyExists(error) {
  const code = String(error?.code || error?.errCode || '').toUpperCase();
  const message = String(error?.message || error?.errMsg || '');
  return /ALREADY[_ -]?EXISTS|COLLECTION_EXIST/.test(code)
    || /already exists|集合.*已存在/i.test(message);
}

async function setDocumentWithCollectionRetry(db, collectionName, id, data) {
  try {
    await db.collection(collectionName).doc(id).set({ data });
    return;
  } catch (error) {
    if (!isCollectionMissing(error) || typeof db?.createCollection !== 'function') throw error;
    try {
      await db.createCollection(collectionName);
    } catch (createError) {
      if (!isCollectionAlreadyExists(createError)) throw createError;
    }
    await db.collection(collectionName).doc(id).set({ data });
  }
}

function archiveMarker(task) {
  const failureId = safeText(task?.failureId, 100);
  const failedAt = task?.failedAt || null;
  const failedAtKey = failedAt instanceof Date ? failedAt.toISOString() : String(failedAt || '');
  return {
    failureId,
    failedAt,
    generation: failureId ? `failure:${failureId}` : `legacy:${safeText(task?._id || task?.taskId, 100)}:${failedAtKey}`
  };
}

function updateApplied(result) {
  const count = [result?.updated, result?.stats?.updated, result?.data?.updated, result?.matched]
    .find((value) => Number.isFinite(Number(value)));
  return count === undefined || Number(count) > 0;
}

function shanghaiDateKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const field = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${field.year}-${field.month}-${field.day}`;
}

function dataSpaceOf(record) {
  return record?.dataSpace === 'developer_test' ? 'developer_test' : 'production';
}

function buildTaskFailureCase({ task, error = null, archiveSource, runtimeBuildId = null, archivedAt = new Date(), diagnosticPresent = false }) {
  const taskId = String(task?._id || task?.taskId || '').trim();
  const failedAt = task?.failedAt || archivedAt;
  return {
    taskId,
    failureId: safeText(task?.failureId, 100),
    taskName: safeText(task?.taskName || task?.displayTitle || task?.title, 200),
    studentId: safeText(task?.studentId, 100),
    dataSpace: dataSpaceOf(task),
    studentName: safeText(task?.studentName, 100),
    grade: safeText(task?.grade, 50),
    className: safeText(task?.className, 100),
    taskDateKey: safeText(task?.taskDateKey, 10) || shanghaiDateKey(task?.createdAt),
    failureDateKey: shanghaiDateKey(failedAt),
    dailyTrainingSequence: finiteCount(task?.dailySequence),
    taskAttempt: finiteCount(task?.attempt),
    workerAttempt: finiteCount(task?.workerAttempt),
    workerDispatchAttempt: finiteCount(task?.workerDispatchAttempt),
    parentTaskId: safeText(task?.parentTaskId, 100),
    mode: safeText(task?.mode, 50),
    carelessTrainingType: safeText(task?.carelessTrainingType, 50),
    answerMode: safeText(task?.answerMode, 50),
    questionCount: finiteCount(task?.questionCount),
    studentImageCount: Array.isArray(task?.studentImageFileIds) ? task.studentImageFileIds.length : 0,
    answerImageCount: Array.isArray(task?.answerImageFileIds) ? task.answerImageFileIds.length : 0,
    diagnosticPresent: diagnosticPresent === true,
    status: 'FAILED',
    currentStage: safeText(task?.currentStage, 100),
    failedStage: safeText(task?.failedStage, 100),
    requestStage: safeText(task?.failureRequestStage || error?.requestStage, 100),
    failureCategory: safeText(task?.failureCategory, 100),
    errorCode: safeText(task?.errorCode || error?.code || 'TASK_EXECUTION_FAILED', 100),
    causeCode: safeText(task?.failureCauseCode || error?.causeCode, 100),
    fieldPath: safeText(task?.failureFieldPath || error?.fieldPath, 200),
    safeMessage: `TASK_FAILURE:${safeErrorCode(task?.errorCode || error?.code, 'TASK_EXECUTION_FAILED')}`,
    errorName: safeText(error?.name || 'Error', 100),
    stackTop: [],
    retryable: task?.retryable === true,
    modelProvider: safeText(task?.failureModelProvider || error?.modelProvider, 50),
    modelName: safeText(task?.failureModelName || error?.modelName, 100),
    providerRequestIdPresent: task?.failureProviderRequestIdPresent === true || Boolean(error?.providerRequestId),
    repairAttempted: task?.failureRepairAttempted === true || error?.repairAttempted === true,
    repairAttemptCount: finiteCount(task?.failureRepairAttemptCount || error?.repairAttemptCount) || 0,
    repairFailureStage: safeText(task?.failureRepairFailureStage || error?.repairFailureStage, 100),
    workerStatus: safeText(task?.workerStatus, 50),
    workerQueueStatus: safeText(task?.workerQueueStatus, 50),
    workerQueueError: safeText(task?.workerQueueError, 100),
    runtimeBuildId: safeText(runtimeBuildId, 150),
    createdAt: task?.createdAt || null,
    failedAt,
    archivedAt,
    updatedAt: archivedAt,
    archiveVersion: ARCHIVE_VERSION,
    archiveSource: safeText(archiveSource, 50)
  };
}

function buildTrainingFailureEvent({ eventId, task, user, action, event, error, failedAt = new Date() }) {
  const taskId = String(event?.taskId || task?._id || task?.taskId || '').trim() || null;
  return {
    eventId,
    eventType: 'TRAINING_REQUEST_FAILED',
    taskId,
    studentId: safeText(task?.studentId || user?.userId, 100),
    studentName: safeText(task?.studentName || user?.name, 100),
    taskName: safeText(task?.taskName || task?.displayTitle || task?.title, 200),
    taskDateKey: safeText(task?.taskDateKey, 10) || (task?.createdAt ? shanghaiDateKey(task.createdAt) : null),
    failureDateKey: shanghaiDateKey(failedAt),
    dailyTrainingSequence: finiteCount(task?.dailySequence),
    mode: safeText(task?.mode, 50),
    carelessTrainingType: safeText(task?.carelessTrainingType, 50),
    trainingAction: TRAINING_ACTIONS[action] || 'unknown',
    sessionVersion: finiteCount(event?.sessionVersion),
    requestIdPresent: Boolean(event?.requestId),
    errorCode: safeText(error?.code || 'TRAINING_REQUEST_FAILED', 100),
    causeCode: safeText(error?.causeCode, 100),
    safeMessage: `TRAINING_FAILURE:${safeErrorCode(error?.code, 'TRAINING_REQUEST_FAILED')}`,
    errorName: safeText(error?.name || 'Error', 100),
    retryable: error?.retryable === true,
    failedAt,
    archiveVersion: ARCHIVE_VERSION
  };
}

async function archiveTaskFailureCase({ db, task, error = null, archiveSource, runtimeBuildId = null, archivedAt = new Date() }) {
  const taskId = String(task?._id || task?.taskId || '').trim();
  if (!taskId || String(task?.status || '') !== 'FAILED') return { archived: false, taskId: taskId || null };
  const marker = archiveMarker(task);
  if (task?.failureArchivedAt && Number(task?.failureArchiveVersion || 0) >= ARCHIVE_VERSION && task?.failureArchiveGeneration === marker.generation) {
    return { archived: false, taskId };
  }
  const diagnosticPresent = await db.collection('hard_problem_diagnostics').doc(taskId).get()
    .then(firstDocument)
    .then(Boolean)
    .catch(() => false);
  const doc = buildTaskFailureCase({ task, error, archiveSource, runtimeBuildId, archivedAt, diagnosticPresent });
  await setDocumentWithCollectionRetry(db, TASK_FAILURE_COLLECTION, taskId, doc);
  const condition = { _id: taskId, status: 'FAILED' };
  if (marker.failureId) condition.failureId = marker.failureId;
  else if (marker.failedAt) condition.failedAt = marker.failedAt;
  const result = await db.collection('grading_tasks').where(condition).update({ data: {
    failureArchivedAt: archivedAt,
    failureArchiveVersion: ARCHIVE_VERSION,
    failureArchiveFailureId: marker.failureId,
    failureArchiveGeneration: marker.generation
  } });
  if (!updateApplied(result)) return { archived: false, taskId };
  return { archived: true, taskId };
}

async function archiveTrainingFailureEvent({ db, task = null, user, action, event, error, failedAt = new Date() }) {
  const eventId = `training_failure_${randomUUID()}`;
  const doc = buildTrainingFailureEvent({ eventId, task, user, action, event, error, failedAt });
  await setDocumentWithCollectionRetry(db, TRAINING_FAILURE_COLLECTION, eventId, doc);
  return { archived: true, eventId };
}

async function reconcileTaskFailureCases({ db, limit = 20, archiveSource = 'reconciler', runtimeBuildId = null, now = new Date() }) {
  const stateRef = db.collection('system_settings').doc(RECONCILER_STATE_ID);
  const state = await stateRef.get().then(firstDocument).catch(() => null);
  const offset = Number.isInteger(Number(state?.offset)) && Number(state.offset) >= 0 ? Number(state.offset) : 0;
  const response = await db.collection('grading_tasks')
    .where({ status: 'FAILED' })
    .orderBy('createdAt', 'desc')
    .skip(offset)
    .limit(limit)
    .get();
  const tasks = Array.isArray(response?.data) ? response.data : [];
  let archived = 0;
  let skipped = 0;
  for (const task of tasks) {
    const marker = archiveMarker(task);
    if (task?.failureArchivedAt && Number(task?.failureArchiveVersion || 0) >= ARCHIVE_VERSION && task?.failureArchiveGeneration === marker.generation) {
      skipped += 1;
      continue;
    }
    try {
      const result = await archiveTaskFailureCase({ db, task, archiveSource, runtimeBuildId, archivedAt: now });
      if (result.archived) archived += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  const nextOffset = tasks.length < limit ? 0 : offset + tasks.length;
  await stateRef.set({ data: {
    settingId: RECONCILER_STATE_ID,
    offset: nextOffset,
    lastScannedAt: now,
    updatedAt: now
  } });
  return { scanned: tasks.length, archived, skipped, nextOffset };
}

module.exports = {
  TASK_FAILURE_COLLECTION,
  TRAINING_FAILURE_COLLECTION,
  ARCHIVE_VERSION,
  RECONCILER_STATE_ID,
  buildTaskFailureCase,
  buildTrainingFailureEvent,
  archiveTaskFailureCase,
  archiveTrainingFailureEvent,
  reconcileTaskFailureCases
};
