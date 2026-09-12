'use strict';

const ACTIVE_POLL_MS = 3000;
const IDLE_SCAN_MS = 60000;

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

function taskIdFrom(task) {
  const value = task && (task._id || task.taskId);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isEligible(task, now) {
  const status = String(task?.workerQueueStatus || '');
  const dispatchAt = timestampMs(task?.workerNextDispatchAt);
  const leaseUntil = timestampMs(task?.workerLeaseUntil);
  if (status === 'PENDING') return !dispatchAt || dispatchAt <= now;
  if (status === 'DISPATCHED') return !leaseUntil || leaseUntil <= now;
  return status === 'RUNNING' && Boolean(leaseUntil) && leaseUntil <= now;
}

function maintenanceError(error) {
  const candidate = typeof error?.code === 'string' ? error.code.trim() : '';
  return {
    code: /^[A-Z0-9_-]+$/i.test(candidate) ? candidate.slice(0, 80) : 'MAINTENANCE_FAILED'
  };
}

function createTaskScheduler({ db, execute, concurrency = 5, onError = () => {}, onLog = () => {}, maintenance = async () => ({}), now = Date.now, activeMs = ACTIVE_POLL_MS, idleMs = IDLE_SCAN_MS }) {
  let activeTimer;
  let idleTimer;
  let stopped = false;
  let emptyActiveScans = 0;
  let drainScheduled = false;
  let draining = false;
  let drainPromise;
  const pendingTaskIds = new Set();
  const runningTaskIds = new Set();

  function diagnostics(taskId, details = {}) { return { taskId, queued: pendingTaskIds.size, running: runningTaskIds.size, concurrency, ...details }; }
  function log(event, taskId, details) { onLog(event, diagnostics(taskId, details)); }
  function hasLocalWork() { return pendingTaskIds.size > 0 || runningTaskIds.size > 0; }
  async function runMaintenance() {
    try {
      return await maintenance();
    } catch (error) {
      onError(maintenanceError(error));
      return {};
    }
  }

  function clearTimer(timer) { if (timer) clearTimeout(timer); }
  function stop() {
    stopped = true;
    clearTimer(activeTimer);
    clearTimer(idleTimer);
    activeTimer = undefined;
    idleTimer = undefined;
  }

  async function queryStatus(status, limit, fieldsOnly) {
    const collection = db.collection('grading_tasks');
    if (typeof collection.where !== 'function') return [];
    let query = collection.where({ workerQueueStatus: status });
    if (fieldsOnly && typeof query.field === 'function') query = query.field({ _id: 1, taskId: 1, workerQueueStatus: 1, workerNextDispatchAt: 1, workerLeaseUntil: 1 });
    if (!query || typeof query.limit !== 'function') return [];
    const limitedQuery = query.limit(limit);
    if (!limitedQuery || typeof limitedQuery.get !== 'function') return [];
    const response = await limitedQuery.get();
    return Array.isArray(response?.data) ? response.data : [];
  }

  async function recover(limit = 100, fieldsOnly = false) {
    let remaining = limit;
    let found = 0;
    const statuses = ['PENDING', 'DISPATCHED', 'RUNNING'];
    for (let index = 0; index < statuses.length; index += 1) {
      if (!remaining) break;
      const status = statuses[index];
      const perStatusLimit = fieldsOnly ? 1 : Math.ceil(remaining / (statuses.length - index));
      const tasks = await queryStatus(status, perStatusLimit, fieldsOnly);
      remaining -= tasks.length;
      for (const task of tasks) {
        if (!isEligible(task, now())) continue;
        const taskId = taskIdFrom(task);
        if (taskId && (await wake(taskId)).code) found += 1;
      }
    }
    return found;
  }

  function scheduleActive() {
    if (stopped || activeTimer) return;
    clearTimer(idleTimer);
    idleTimer = undefined;
    activeTimer = setTimeout(async () => {
      activeTimer = undefined;
      try {
        const found = await recover(100);
        emptyActiveScans = found ? 0 : emptyActiveScans + 1;
      } catch (error) {
        emptyActiveScans = 0;
        onError(error);
      }
      if (stopped) return;
      if (hasLocalWork() || emptyActiveScans < 2) scheduleActive();
      else scheduleIdle();
    }, activeMs);
    if (typeof activeTimer.unref === 'function') activeTimer.unref();
  }

  function scheduleIdle() {
    if (stopped || idleTimer || hasLocalWork()) return;
    clearTimer(activeTimer);
    activeTimer = undefined;
    idleTimer = setTimeout(async () => {
      idleTimer = undefined;
      try {
        const found = await recover(3, true);
        await runMaintenance();
        if (found) {
          emptyActiveScans = 0;
          scheduleActive();
        } else scheduleIdle();
      } catch (error) {
        onError(error);
        scheduleIdle();
      }
    }, idleMs);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
  }

  function ensureDrain() {
    if (stopped) return;
    if (draining) {
      drainScheduled = true;
      return;
    }
    if (drainScheduled) return;
    drainScheduled = true;
    drainPromise = Promise.resolve().then(drain).catch(onError);
  }

  function startExecution(taskId) {
    runningTaskIds.add(taskId);
    log('SCHEDULER_TASK_START', taskId);
    Promise.resolve().then(async () => {
      let result;
      try {
        const execution = await execute(taskId);
        const code = String(execution?.schedulerOutcome?.code || execution?.body?.code || 'UNEXPECTED_ERROR');
        const outcomes = {
          TASK_COMPLETED: 'completed',
          TASK_STAGE_COMPLETED: 'stage_completed',
          TASK_WAITING_USER: 'waiting_user',
          TASK_EXECUTION_FAILED: 'failed',
          TASK_ALREADY_COMPLETED: 'already_completed',
          TASK_ALREADY_CLAIMED: 'already_claimed',
          TASK_WORKER_LEASE_LOST: 'lease_lost',
          TASK_DISPATCH_FAILED: 'dispatch_failed'
        };
        result = {
          outcome: execution?.schedulerOutcome?.outcome || outcomes[code] || 'unexpected_error',
          code,
          stage: execution?.schedulerOutcome?.stage,
          reschedule: Boolean(execution?.schedulerOutcome?.reschedule),
          reachedDispatch: Boolean(execution?.schedulerOutcome?.reachedDispatch),
          reachedClaim: Boolean(execution?.schedulerOutcome?.reachedClaim),
          errorCode: execution?.schedulerOutcome?.errorCode || execution?.body?.errorCode || null,
          causeCode: execution?.schedulerOutcome?.causeCode || execution?.body?.causeCode || null,
          fieldPath: execution?.schedulerOutcome?.fieldPath || execution?.body?.fieldPath || null,
          requestStage: execution?.schedulerOutcome?.requestStage || execution?.body?.requestStage || null,
          modelProvider: execution?.schedulerOutcome?.modelProvider || execution?.body?.modelProvider || null,
          modelName: execution?.schedulerOutcome?.modelName || execution?.body?.modelName || null,
          providerRequestIdPresent: execution?.schedulerOutcome?.providerRequestIdPresent === true || execution?.body?.providerRequestIdPresent === true,
          repairAttempted: execution?.schedulerOutcome?.repairAttempted === true || execution?.body?.repairAttempted === true,
          repairAttemptCount: Number(execution?.schedulerOutcome?.repairAttemptCount || execution?.body?.repairAttemptCount || 0),
          repairFailureStage: execution?.schedulerOutcome?.repairFailureStage || execution?.body?.repairFailureStage || null,
          failureId: execution?.schedulerOutcome?.failureId || execution?.body?.failureId || null
        };
      } catch (error) {
        onError(error);
        const code = error && typeof error.code === 'string' && error.code.trim() ? error.code.trim() : 'UNEXPECTED_ERROR';
        const stage = typeof error?.stage === 'string' ? error.stage : undefined;
        result = { outcome: stage ? 'claim_failed' : 'unexpected_error', code, stage, reachedDispatch: false, reachedClaim: false };
      } finally {
        runningTaskIds.delete(taskId);
        if (!stopped && result?.reschedule) {
          pendingTaskIds.add(taskId);
          log('SCHEDULER_STAGE_REQUEUED', taskId, { stage: result.stage });
        }
        log('SCHEDULER_TASK_FINISH', taskId, result);
        ensureDrain();
        if (hasLocalWork()) scheduleActive();
      }
    });
  }

  function drain() {
    if (stopped || draining) return;
    drainScheduled = false;
    draining = true;
    log('SCHEDULER_DRAIN_START');
    try {
      while (!stopped && runningTaskIds.size < concurrency && pendingTaskIds.size) {
        const taskId = pendingTaskIds.values().next().value;
        pendingTaskIds.delete(taskId);
        startExecution(taskId);
      }
    } finally {
      draining = false;
      if (!stopped && pendingTaskIds.size && runningTaskIds.size < concurrency) ensureDrain();
      else log('SCHEDULER_DRAIN_IDLE');
    }
  }

  async function wake(taskId) {
    if (stopped || !taskId) return { accepted: false, code: 'WORKER_SHUTTING_DOWN' };
    emptyActiveScans = 0;
    scheduleActive();
    if (pendingTaskIds.has(taskId)) {
      log('SCHEDULER_ALREADY_PENDING', taskId);
      ensureDrain();
      return { accepted: true, code: 'TASK_ALREADY_ENQUEUED' };
    }
    if (runningTaskIds.has(taskId)) {
      log('SCHEDULER_ALREADY_RUNNING', taskId);
      return { accepted: true, code: 'TASK_ALREADY_RUNNING' };
    }
    pendingTaskIds.add(taskId);
    log('SCHEDULER_WAKE', taskId);
    ensureDrain();
    return { accepted: true, code: 'TASK_ENQUEUED' };
  }

  async function start() {
    if (stopped) return false;
    try {
      const found = await recover(100);
      await runMaintenance();
      emptyActiveScans = found ? 0 : 1;
      if (found || hasLocalWork()) scheduleActive();
      else scheduleIdle();
      return Boolean(found);
    } catch (error) {
      onError(error);
      scheduleIdle();
      return false;
    }
  }

  async function waitForIdle(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (runningTaskIds.size && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return runningTaskIds.size === 0;
  }

  return {
    start, stop, wake, recover, ensureDrain, scheduleActive, scheduleIdle, waitForIdle,
    pendingTaskIds, runningTaskIds,
    get draining() { return draining; },
    get drainScheduled() { return drainScheduled; },
    get drainPromise() { return drainPromise; }
  };
}

module.exports = { createTaskScheduler, taskIdFrom, isEligible, ACTIVE_POLL_MS, IDLE_SCAN_MS };
