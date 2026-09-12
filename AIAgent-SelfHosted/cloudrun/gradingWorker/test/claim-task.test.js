const assert = require('node:assert/strict');
const test = require('node:test');

const { createClaimTask } = require('../claim-task');

function createJsDb(document) {
  const command = {
    inc: (value) => ({ operation: 'inc', value }),
    lte: (value) => ({ operation: 'lte', value })
  };
  let updateCalls = 0;
  function matches(condition) {
    return Object.entries(condition).every(([key, value]) => {
      if (value && value.operation === 'lte') return new Date(document[key]).getTime() <= value.value.getTime();
      return document[key] === value;
    });
  }
  return {
    command,
    get updateCalls() { return updateCalls; },
    collection: () => ({
      doc: () => ({ get: async () => ({ data: [document] }) }),
      where: (condition) => ({ update: async (patch) => {
        updateCalls += 1;
        assert.equal(Object.hasOwn(patch, 'data'), false);
        if (!matches(condition)) return { updated: 0 };
        for (const [key, value] of Object.entries(patch)) {
          document[key] = value && value.operation === 'inc' ? Number(document[key] || 0) + value.value : value;
        }
        return { updated: 1 };
      } })
    })
  };
}

test('claims a DISPATCHED task with a js-sdk conditional update and array readback', async () => {
  const document = { _id: 'task-claim', taskId: 'task-claim', status: 'QUEUED', workerQueueStatus: 'DISPATCHED', workerAttempt: 0 };
  const db = createJsDb(document);
  const claim = createClaimTask({ db, instanceId: 'worker-a', createLeaseOwner: () => 'worker-a', now: () => new Date('2026-07-28T00:00:00.000Z') });

  const result = await claim(document.taskId);

  assert.deepEqual(result.body, { accepted: true, code: 'TASK_CLAIMED', taskId: 'task-claim' });
  assert.deepEqual(result.claimContext, { workerLeaseOwner: 'worker-a', workerAttempt: 1, workerLeaseUntil: document.workerLeaseUntil });
  assert.deepEqual({
    code: result.code,
    taskId: result.taskId,
    workerLeaseOwner: result.workerLeaseOwner,
    workerAttempt: result.workerAttempt,
    workerLeaseUntil: result.workerLeaseUntil
  }, {
    code: 'TASK_CLAIMED',
    taskId: 'task-claim',
    workerLeaseOwner: 'worker-a',
    workerAttempt: 1,
    workerLeaseUntil: document.workerLeaseUntil
  });
  assert.equal(db.updateCalls, 1);
  assert.equal(document.workerQueueStatus, 'RUNNING');
  assert.equal(document.workerStatus, 'RUNNING');
  assert.equal(document.workerLeaseOwner, 'worker-a');
  assert.equal(document.workerAttempt, 1);
  assert.ok(document.workerLeaseUntil instanceof Date);
});

test('keeps a 300-second lease fenced before the grading execution budget expires', async () => {
  const startedAt = new Date('2026-07-28T00:00:00.000Z');
  const document = { _id: 'task-long-call', taskId: 'task-long-call', status: 'QUEUED', workerQueueStatus: 'DISPATCHED', workerAttempt: 0 };
  const db = createJsDb(document);
  const first = await createClaimTask({ db, instanceId: 'worker-a', createLeaseOwner: () => 'worker-a', now: () => startedAt })(document.taskId);
  assert.equal(document.workerLeaseUntil.getTime() - startedAt.getTime(), 300000);
  const second = await createClaimTask({ db, instanceId: 'worker-b', createLeaseOwner: () => 'worker-b', now: () => new Date(startedAt.getTime() + 299999) })(document.taskId);
  assert.equal(first.body.code, 'TASK_CLAIMED');
  assert.equal(second.body.code, 'TASK_ALREADY_CLAIMED');
  assert.equal(document.workerLeaseOwner, 'worker-a');
  assert.equal(document.workerAttempt, 1);
});

test('allows only one conditional claim for concurrent DISPATCHED claimers', async () => {
  const document = { _id: 'task-concurrent', taskId: 'task-concurrent', status: 'QUEUED', workerQueueStatus: 'DISPATCHED', workerAttempt: 0 };
  const db = createJsDb(document);
  const outcomes = await Promise.all([
    createClaimTask({ db, instanceId: 'worker-a', createLeaseOwner: () => 'worker-a' })(document.taskId),
    createClaimTask({ db, instanceId: 'worker-b', createLeaseOwner: () => 'worker-b' })(document.taskId)
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.body.code === 'TASK_CLAIMED').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.body.code === 'TASK_ALREADY_CLAIMED').length, 1);
});

test('recovers an expired RUNNING lease only when its original fencing values still match', async () => {
  const document = {
    _id: 'task-recover', taskId: 'task-recover', status: 'PROCESSING', workerQueueStatus: 'RUNNING',
    workerLeaseOwner: 'old-worker', workerAttempt: 2, workerLeaseUntil: new Date('2026-07-27T23:59:59.999Z')
  };
  const db = createJsDb(document);
  const claim = createClaimTask({ db, instanceId: 'worker-new', createLeaseOwner: () => 'worker-new', now: () => new Date('2026-07-28T00:00:00.000Z') });

  const result = await claim(document.taskId);

  assert.equal(result.body.code, 'TASK_CLAIMED');
  assert.equal(document.workerLeaseOwner, 'worker-new');
  assert.equal(document.workerAttempt, 3);
});

test('reports CLAIM_READ_BEFORE and preserves the database error when the initial read fails', async () => {
  const error = Object.assign(new Error('initial read failed'), { code: 'DB_READ_FAILED', requestId: 'read-1' });
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const claim = createClaimTask({ db: {
      command: { inc: () => ({}) },
      collection: () => ({ doc: () => ({ get: async () => { throw error; } }) })
    } });
    await assert.rejects(claim('task-read-failure'), (actual) => actual.code === 'DB_READ_FAILED' && actual.stage === 'CLAIM_READ_BEFORE' && actual.cause === error);
  } finally {
    console.error = originalError;
  }
  assert.match(logs.join('\n'), /WORKER_CLAIM_ERROR/);
  assert.match(logs.join('\n'), /CLAIM_READ_BEFORE/);
  assert.doesNotMatch(logs.join('\n'), /WORKER_CLAIM_RESULT/);
});

test('reports CLAIM_UPDATE without emitting a claim result when the conditional update fails', async () => {
  const document = { _id: 'task-update-failure', status: 'QUEUED', workerQueueStatus: 'DISPATCHED', workerAttempt: 0 };
  const error = Object.assign(new Error('conditional update failed'), { code: 'DB_UPDATE_FAILED' });
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const claim = createClaimTask({ db: {
      command: { inc: () => ({}) },
      collection: () => ({
        doc: () => ({ get: async () => ({ data: [document] }) }),
        where: () => ({ update: async () => { throw error; } })
      })
    } });
    await assert.rejects(claim(document._id), (actual) => actual.code === 'DB_UPDATE_FAILED' && actual.stage === 'CLAIM_UPDATE' && actual.cause === error);
  } finally {
    console.error = originalError;
  }
  assert.match(logs.join('\n'), /WORKER_CLAIM_ERROR/);
  assert.match(logs.join('\n'), /CLAIM_UPDATE/);
  assert.doesNotMatch(logs.join('\n'), /WORKER_CLAIM_RESULT/);
});

test('reports CLAIM_READ_AFTER when the post-update readback fails', async () => {
  const document = { _id: 'task-readback-failure', status: 'QUEUED', workerQueueStatus: 'DISPATCHED', workerAttempt: 0 };
  const error = Object.assign(new Error('readback failed'), { code: 'DB_READBACK_FAILED' });
  let reads = 0;
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const claim = createClaimTask({ db: {
      command: { inc: () => ({ operation: 'inc', value: 1 }) },
      collection: () => ({
        doc: () => ({ get: async () => {
          reads += 1;
          if (reads === 2) throw error;
          return { data: [document] };
        } }),
        where: () => ({ update: async () => ({ updated: 1 }) })
      })
    } });
    await assert.rejects(claim(document._id), (actual) => actual.code === 'DB_READBACK_FAILED' && actual.stage === 'CLAIM_READ_AFTER' && actual.cause === error);
  } finally {
    console.error = originalError;
  }
  assert.match(logs.join('\n'), /WORKER_CLAIM_ERROR/);
  assert.match(logs.join('\n'), /CLAIM_READ_AFTER/);
});


test('same service instance issues a unique lease owner per concurrent claim and only one wins', async () => {
  const document = { _id: 'task-same-instance', taskId: 'task-same-instance', status: 'QUEUED', workerQueueStatus: 'DISPATCHED', workerAttempt: 0 };
  const db = createJsDb(document);
  let sequence = 0;
  const claim = createClaimTask({
    db,
    instanceId: 'worker-shared',
    createLeaseOwner: () => `worker-shared:claim-${++sequence}`
  });

  const outcomes = await Promise.all([claim(document.taskId), claim(document.taskId)]);

  assert.equal(outcomes.filter((outcome) => outcome.body.code === 'TASK_CLAIMED').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.body.code === 'TASK_ALREADY_CLAIMED').length, 1);
  assert.match(document.workerLeaseOwner, /^worker-shared:claim-/);
  assert.equal(document.workerAttempt, 1);
});


test('normalizes a legacy DISPATCHED task without workerAttempt before applying the fenced claim', async () => {
  const document = { _id: 'task-legacy-attempt', taskId: 'task-legacy-attempt', status: 'QUEUED', workerQueueStatus: 'DISPATCHED' };
  const db = createJsDb(document);
  const claim = createClaimTask({ db, instanceId: 'worker-legacy', createLeaseOwner: () => 'worker-legacy:claim' });

  const result = await claim(document.taskId);

  assert.equal(result.body.code, 'TASK_CLAIMED');
  assert.equal(document.workerAttempt, 1);
  assert.equal(document.workerLeaseOwner, 'worker-legacy:claim');
  assert.equal(db.updateCalls, 2);
});
