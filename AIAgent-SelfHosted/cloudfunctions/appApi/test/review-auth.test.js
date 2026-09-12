const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
const collections = new Map();
const openid = 'review-openid';
const monitorCalls = [];
const readShapes = new Map();
const writeCalls = [];
const afterWriteTransforms = new Map();
const readErrors = new Map();
const whereErrors = new Map();
const whereResultQueues = new Map();
const docGetCalls = [];
const whereCalls = [];
let rejectUnsupportedWrites = false;

function store(name) {
  if (!collections.has(name)) collections.set(name, new Map());
  return collections.get(name);
}

const db = {
  collection(name) {
    const records = store(name);
    const validateWrite = (data) => {
      const invalid = (value) => {
        if (value === undefined || typeof value === 'function') return true;
        if (typeof value === 'number' && !Number.isFinite(value)) return true;
        if (value === null || value instanceof Date || ['string', 'number', 'boolean'].includes(typeof value)) return false;
        if (Array.isArray(value)) return value.some(invalid);
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return true;
        return Object.entries(value).some(([key, child]) => key === '_id' || invalid(child));
      };
      if (rejectUnsupportedWrites && invalid(data)) throw Object.assign(new Error('CloudBase rejected unsupported data'), { errCode: 'DATABASE_REQUEST_FAILED' });
    };
    return {
      doc(id) {
        const key = `${name}:${id}`;
        return {
          async get() {
            docGetCalls.push({ collection: name, id });
            if (readErrors.has(key)) throw readErrors.get(key);
            if (!records.has(id)) {
              if (readShapes.get(key) === 'empty-array') return { data: [] };
              if (readShapes.get(key) === 'null') return { data: null };
              throw Object.assign(new Error('not found'), { code: 'DOCUMENT_NOT_FOUND' });
            }
            const data = { _id: id, ...records.get(id) };
            return { data: readShapes.get(key) === 'array' ? [data] : data };
          },
          async set({ data }) {
            validateWrite(data);
            writeCalls.push({ collection: name, id, operation: 'set', data });
            const transform = afterWriteTransforms.get(key);
            records.set(id, transform ? transform(data) : data);
          },
          async update({ data }) {
            validateWrite(data);
            writeCalls.push({ collection: name, id, operation: 'update', data });
            const next = { ...(records.get(id) || {}), ...data };
            const transform = afterWriteTransforms.get(key);
            records.set(id, transform ? transform(next) : next);
          }
        };
      },
      where(query) {
        const fixedKey = query && query._id ? `${name}:${query._id}` : null;
        return {
          limit() { return this; },
          async get() {
            whereCalls.push({ collection: name, query });
            if (whereErrors.has(`${name}:*`)) throw whereErrors.get(`${name}:*`);
            if (fixedKey && whereErrors.has(fixedKey)) throw whereErrors.get(fixedKey);
            const queuedResults = whereResultQueues.get(name);
            if (queuedResults?.length) return { data: queuedResults.shift() };
            const matches = [...records.entries()]
              .map(([id, record]) => ({ _id: id, ...record }))
              .filter((record) => Object.entries(query).every(([key, value]) => record[key] === value));
            const shape = fixedKey ? readShapes.get(fixedKey) : null;
            if (shape === 'empty-array' && !matches.length) return { data: [] };
            if (shape === 'null' && !matches.length) return { data: null };
            if (shape === 'object') return { data: matches[0] || null };
            return { data: matches };
          }
        };
      }
    };
  }
};

Module._load = function (request, parent, isMain) {
  if (request === './context') return { db, context: () => ({ openid }) };
  if (request === './audit') return { monitor: (...args) => monitorCalls.push(args) };
  return originalLoad.call(this, request, parent, isMain);
};
const auth = require('../shared/auth');
Module._load = originalLoad;

function reset() {
  collections.clear();
  monitorCalls.length = 0;
  readShapes.clear();
  writeCalls.length = 0;
  afterWriteTransforms.clear();
  readErrors.clear();
  whereErrors.clear();
  whereResultQueues.clear();
  docGetCalls.length = 0;
  whereCalls.length = 0;
  rejectUnsupportedWrites = false;
  process.env.REVIEW_CHANNEL_ENABLED = 'true';
  process.env.REVIEW_ACCESS_CODE_HASH = crypto.createHash('sha256').update('review-code').digest('hex');
  process.env.REVIEW_CHANNEL_EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();
  store('users').set(`u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`, { userId: `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`, role: 'student', status: 'ACTIVE', name: 'Formal User' });
}

test('review session maps only the current openid hash to fixed active identities and preserves requireRole', async () => {
  reset();
  const opened = await auth.openReviewSession(openid, 'review-code', 'student');
  assert.deepEqual(opened.effectiveUserId, 'review_student_fixed');
  assert.equal(store('review_sessions').get(`review_${crypto.createHash('sha256').update(openid).digest('hex')}`).openid, undefined);
  const student = await auth.currentUser(false);
  assert.equal(student.userId, 'review_student_fixed');
  assert.equal(student.reviewMode, true);
  auth.requireRole(student, ['student']);
  assert.throws(() => auth.requireRole(student, ['teacher']), (error) => error.code === 'FORBIDDEN');
  await auth.switchReviewSession(openid, 'teacher');
  const teacher = await auth.currentUser(false);
  assert.equal(teacher.userId, 'review_teacher_fixed');
  assert.equal(teacher.role, 'teacher');
  assert.equal(teacher.reviewMode, true);
  assert.notEqual(teacher.role, 'super_admin');
  await auth.closeReviewSession(openid);
  const restored = await auth.currentUser(false);
  assert.equal(restored.userId, `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`);
});

test('active developer_admin is super_admin-compatible without exposing its internal role marker', async () => {
  reset();
  const userId = `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`;
  store('users').set(userId, { userId, role: 'developer_admin', status: 'ACTIVE', name: 'Developer Admin' });

  const user = await auth.currentUser(false);

  assert.equal(user.role, 'super_admin');
  assert.equal(user._realRole, 'developer_admin');
  assert.equal(auth.publicUser(user)._realRole, undefined);
  assert.equal(auth.publicUser(user).role, 'super_admin');
});

test('review session rejects closed, expired, and invalid codes without creating review records', async () => {
  reset();
  process.env.REVIEW_CHANNEL_ENABLED = 'TRUE';
  await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_CHANNEL_DISABLED');
  process.env.REVIEW_CHANNEL_ENABLED = 'true';
  process.env.REVIEW_CHANNEL_EXPIRES_AT = new Date(Date.now() - 1).toISOString();
  await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_CHANNEL_EXPIRED');
  process.env.REVIEW_CHANNEL_EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();
  await assert.rejects(auth.openReviewSession(openid, 'wrong-code', 'student'), (error) => error.code === 'REVIEW_ACCESS_CODE_INVALID');
  assert.equal(store('review_sessions').size, 0);
  assert.equal(store('users').size, 1);
});

test('invalid configured access-code hash reports a safe business code before timing comparison', async () => {
  reset();
  process.env.REVIEW_ACCESS_CODE_HASH = 'not-a-sha256-hash';
  await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_ACCESS_CODE_HASH_INVALID' && error.reviewStage === 'review_config');
  assert.equal(store('review_sessions').size, 0);
});

test('fixed review teacher initialization failure preserves its exact stage and creates no session', async () => {
  reset();
  const users = store('users');
  const originalSet = users.set.bind(users);
  users.set = (key, value) => { if (key === 'review_teacher_fixed') throw Object.assign(new Error('teacher write failed'), { code: 'DB_WRITE_FAILED' }); return originalSet(key, value); };
  try {
    await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_FIXED_RECORD_INIT_FAILED' && error.reviewCauseCode === 'DB_WRITE_FAILED' && error.reviewStage === 'review_teacher_init');
    assert.equal(store('review_sessions').size, 0);
  } finally { users.set = originalSet; }
});

test('review session store failures return the dedicated safe code and retain their stage', async () => {
  reset();
  const sessions = store('review_sessions');
  whereErrors.set('review_sessions:*', Object.assign(new Error('session lookup failed'), { code: 'DB_READ_FAILED' }));
  await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_SESSION_STORE_NOT_READY' && error.reviewStage === 'review_session_lookup');
  whereErrors.clear();
  const originalSet = sessions.set.bind(sessions);
  sessions.set = () => { throw Object.assign(new Error('session write failed'), { code: 'DB_WRITE_FAILED' }); };
  try {
    await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_SESSION_STORE_NOT_READY' && error.reviewStage === 'review_session_write');
    assert.equal(sessions.size, 0);
  } finally { sessions.set = originalSet; }
});

test('review session lookup failure falls back to the real user and records no identity material', async () => {
  reset();
  whereErrors.set('review_sessions:*', Object.assign(new Error('review store unavailable'), { code: 'DATABASE_COLLECTION_NOT_EXIST' }));
  const user = await auth.currentUser(false);
  assert.equal(user.userId, `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`);
  const log = monitorCalls.find(([, event]) => event === 'REVIEW_SESSION_LOOKUP_SKIPPED');
  assert.ok(log);
  assert.deepEqual(Object.keys(log[2]).sort(), ['errorCode', 'stage']);
  assert.doesNotMatch(JSON.stringify(log[2]), /review-openid|openidHash|[a-f0-9]{64}/i);
});

test('partial fixed-record initialization is retryable and creates an active session only after all records exist', async () => {
  reset();
  const users = store('users');
  const originalSet = users.set.bind(users);
  let studentWrites = 0;
  users.set = (key, value) => {
    if (key === 'review_student_fixed' && studentWrites++ === 0) throw Object.assign(new Error('student write failed'), { code: 'DB_WRITE_FAILED' });
    return originalSet(key, value);
  };
  await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_FIXED_RECORD_INIT_FAILED' && error.reviewStage === 'review_student_init');
  assert.ok(users.has('review_teacher_fixed'));
  assert.equal(users.has('review_student_fixed'), false);
  assert.equal(store('student_roster').has('review_roster_fixed'), false);
  assert.equal(store('review_sessions').size, 0);

  const opened = await auth.openReviewSession(openid, 'review-code', 'student');
  assert.equal(opened.active, true);
  assert.ok(users.has('review_teacher_fixed'));
  assert.ok(users.has('review_student_fixed'));
  assert.ok(store('student_roster').has('review_roster_fixed'));
  assert.equal(store('review_sessions').size, 1);
  assert.equal(writeCalls.filter((call) => call.id === 'review_teacher_fixed' && call.operation === 'set').length, 1);
  users.set = originalSet;
});

test('fixed review records supplement missing fields without overwriting review data and reject formal ID conflicts', async () => {
  reset();
  store('users').set('review_teacher_fixed', { userId: 'review_teacher_fixed', reviewOnly: true, name: 'Preserved Review Teacher', updatedAt: 'preserved-timestamp' });
  await auth.openReviewSession(openid, 'review-code', 'teacher');
  const teacher = store('users').get('review_teacher_fixed');
  assert.equal(teacher.name, 'Preserved Review Teacher');
  assert.equal(teacher.role, 'teacher');
  assert.equal(teacher.status, 'ACTIVE');
  assert.equal(teacher.updatedAt, 'preserved-timestamp');

  reset();
  store('users').set('review_teacher_fixed', { userId: 'review_teacher_fixed', role: 'teacher', status: 'ACTIVE', reviewOnly: false });
  await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_FIXED_ID_CONFLICT' && error.reviewStage === 'review_teacher_init');
  assert.equal(store('review_sessions').size, 0);
});

test('missing fixed identity never grants review mode and safely restores the real user', async () => {
  reset();
  await auth.openReviewSession(openid, 'review-code', 'student');
  store('users').delete('review_student_fixed');
  const user = await auth.currentUser(false);
  assert.equal(user.userId, `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`);
  assert.equal(user.reviewMode, undefined);
  const log = monitorCalls.find(([, event]) => event === 'REVIEW_SESSION_IDENTITY_INVALID');
  assert.ok(log);
  assert.deepEqual(Object.keys(log[2]).sort(), ['errorCode', 'stage']);
});

test('status and close remain idempotent when no review session exists', async () => {
  reset();
  assert.deepEqual(await auth.reviewSessionStatus(openid), { active: false });
  await assert.rejects(auth.switchReviewSession(openid, 'teacher'), (error) => error.code === 'REVIEW_SESSION_INVALID');
  assert.deepEqual(await auth.closeReviewSession(openid), { active: false });
  assert.deepEqual(await auth.reviewSessionStatus(openid), { active: false });
  assert.equal(writeCalls.some((call) => call.collection === 'review_sessions'), false);
  assert.equal(monitorCalls.some(([, event]) => event === 'REVIEW_SESSION_LOOKUP_SKIPPED'), false);
});

test('first review session lookup treats an empty where result as no history and creates an active session', async () => {
  reset();
  const sessionId = `review_${crypto.createHash('sha256').update(openid).digest('hex')}`;
  readErrors.set(`review_sessions:${sessionId}`, Object.assign(new Error('document does not exist'), { errCode: -1 }));
  whereResultQueues.set('review_sessions', [[]]);

  const opened = await auth.openReviewSession(openid, 'review-code', 'student');

  assert.equal(opened.active, true);
  assert.equal(store('review_sessions').get(sessionId).active, true);
  assert.equal(docGetCalls.some((call) => call.collection === 'review_sessions'), false);
  assert.ok(whereCalls.some((call) => call.collection === 'review_sessions' && call.query.openidHash === crypto.createHash('sha256').update(openid).digest('hex')));
});

test('review session where reads accept object, null, and undefined data shapes', async () => {
  reset();
  await auth.openReviewSession(openid, 'review-code', 'student');
  const session = { _id: 'mock-session', ...store('review_sessions').values().next().value };

  whereResultQueues.set('review_sessions', [session]);
  assert.equal((await auth.reviewSessionStatus(openid)).active, true);
  whereResultQueues.set('review_sessions', [null]);
  assert.deepEqual(await auth.reviewSessionStatus(openid), { active: false });
  whereResultQueues.set('review_sessions', [undefined]);
  assert.deepEqual(await auth.reviewSessionStatus(openid), { active: false });
});

test('real review session where failures return store not ready and never create an active session', async () => {
  for (const errCode of ['PERMISSION_DENIED', 'COLLECTION_NOT_EXIST', 'CONNECTION_FAILED']) {
    reset();
    whereErrors.set('review_sessions:*', Object.assign(new Error('real session query failed'), { errCode }));
    await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_SESSION_STORE_NOT_READY' && error.reviewStage === 'review_session_lookup');
    assert.equal(store('review_sessions').size, 0);
  }
});

test('review session write is verified by where reread and never includes a reserved _id', async () => {
  reset();
  whereResultQueues.set('review_sessions', [[], []]);
  await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_SESSION_STORE_NOT_READY' && error.reviewStage === 'review_session_write');
  const sessionWrite = writeCalls.find((call) => call.collection === 'review_sessions');
  assert.ok(sessionWrite);
  assert.equal(Object.hasOwn(sessionWrite.data, '_id'), false);
  assert.equal(whereCalls.filter((call) => call.collection === 'review_sessions').length, 2);
});

test('open status switch close flow uses one hash-bound session and restores the real identity', async () => {
  reset();
  assert.equal((await auth.openReviewSession(openid, 'review-code', 'student')).active, true);
  assert.deepEqual(await auth.reviewSessionStatus(openid), {
    active: true,
    effectiveRole: 'student',
    effectiveUserId: 'review_student_fixed',
    expiresAt: new Date(process.env.REVIEW_CHANNEL_EXPIRES_AT)
  });
  assert.equal((await auth.switchReviewSession(openid, 'teacher')).effectiveUserId, 'review_teacher_fixed');
  assert.deepEqual(await auth.closeReviewSession(openid), { active: false });
  assert.deepEqual(await auth.reviewSessionStatus(openid), { active: false });
  assert.equal((await auth.currentUser(false)).userId, `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`);
  assert.equal(docGetCalls.some((call) => call.collection === 'review_sessions'), false);
});

test('fixed review writes never send CloudBase reserved _id fields', async () => {
  reset();
  rejectUnsupportedWrites = true;
  const opened = await auth.openReviewSession(openid, 'review-code', 'student');
  assert.equal(opened.active, true);
  const fixedIds = new Set(['review_teacher_fixed', 'review_student_fixed', 'review_roster_fixed']);
  const fixedWrites = writeCalls.filter((call) => fixedIds.has(call.id));
  assert.equal(fixedWrites.length, 3);
  for (const write of fixedWrites) assert.equal(Object.hasOwn(write.data, '_id'), false);
});

test('sanitizeCloudData recursively removes unsupported values and preserves supported falsy values', () => {
  const command = Object.create({ command: true });
  command.value = 'must-not-be-written';
  const sanitized = auth.sanitizeCloudData({
    _id: 'reserved', missing: undefined, fn: () => {}, nan: NaN, infinity: Infinity, command,
    nested: { _id: 'nested-reserved', keepNull: null, keepFalse: false, keepZero: 0, keepEmpty: '', remove: undefined },
    list: [null, false, 0, '', undefined, NaN, () => {}, { keep: 'value', remove: undefined }]
  });
  assert.deepEqual(sanitized, {
    nested: { keepNull: null, keepFalse: false, keepZero: 0, keepEmpty: '' },
    list: [null, false, 0, '', { keep: 'value' }]
  });
});

test('fixed record where reads accept object, one-element array, empty array, and null shapes', async () => {
  reset();
  store('users').set('review_teacher_fixed', { userId: 'review_teacher_fixed', role: 'teacher', status: 'ACTIVE', reviewOnly: true, name: 'Array Teacher' });
  store('users').set('review_student_fixed', { userId: 'review_student_fixed', role: 'student', status: 'ACTIVE', rosterId: 'review_roster_fixed', reviewOnly: true, name: 'Array Student' });
  readShapes.set('users:review_teacher_fixed', 'object');
  readShapes.set('users:review_student_fixed', 'array');
  readShapes.set('student_roster:review_roster_fixed', 'empty-array');
  const opened = await auth.openReviewSession(openid, 'review-code', 'student');
  assert.equal(opened.active, true);
  assert.equal(store('users').get('review_teacher_fixed').name, 'Array Teacher');
  assert.ok(store('users').has('review_student_fixed'));
  assert.ok(store('student_roster').has('review_roster_fixed'));

  reset();
  readShapes.set('users:review_teacher_fixed', 'null');
  const openedFromNull = await auth.openReviewSession(openid, 'review-code', 'teacher');
  assert.equal(openedFromNull.active, true);
  assert.equal(store('users').get('review_teacher_fixed').role, 'teacher');
});

test('each fixed record is re-read and validated before the next stage and session write', async () => {
  reset();
  afterWriteTransforms.set('users:review_teacher_fixed', (data) => ({ ...data, role: 'super_admin' }));
  await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_FIXED_RECORD_INVALID' && error.reviewStage === 'review_teacher_init');
  assert.equal(store('users').has('review_student_fixed'), false);
  assert.equal(store('student_roster').has('review_roster_fixed'), false);
  assert.equal(store('review_sessions').size, 0);
});

test('first fixed-record initialization uses where instead of doc.get when missing documents return errCode -1', async () => {
  reset();
  for (const [collection, id] of [['users', 'review_teacher_fixed'], ['users', 'review_student_fixed'], ['student_roster', 'review_roster_fixed']]) {
    readErrors.set(`${collection}:${id}`, Object.assign(new Error('document does not exist'), { errCode: -1 }));
  }
  const opened = await auth.openReviewSession(openid, 'review-code', 'student');
  assert.equal(opened.active, true);
  assert.equal(docGetCalls.some((call) => ['review_teacher_fixed', 'review_student_fixed', 'review_roster_fixed'].includes(call.id)), false);
  assert.ok(store('users').has('review_teacher_fixed'));
  assert.ok(store('users').has('review_student_fixed'));
  assert.ok(store('student_roster').has('review_roster_fixed'));
  assert.equal(store('review_sessions').size, 1);
});

test('fixed records are re-read with where and active session is written only after all three validations', async () => {
  reset();
  const opened = await auth.openReviewSession(openid, 'review-code', 'teacher');
  assert.equal(opened.active, true);
  for (const [collection, id] of [['users', 'review_teacher_fixed'], ['users', 'review_student_fixed'], ['student_roster', 'review_roster_fixed']]) {
    assert.equal(whereCalls.filter((call) => call.collection === collection && call.query._id === id).length, 2);
  }
  const sessionWriteIndex = writeCalls.findIndex((call) => call.collection === 'review_sessions');
  assert.ok(sessionWriteIndex > writeCalls.findIndex((call) => call.id === 'review_roster_fixed'));
});

test('real fixed-record where failures retain the exact stage and never create a session or modify a formal user', async () => {
  const scenarios = [
    { collection: 'users', id: 'review_teacher_fixed', stage: 'review_teacher_init', errCode: 'PERMISSION_DENIED', seed: [] },
    { collection: 'users', id: 'review_student_fixed', stage: 'review_student_init', errCode: 'COLLECTION_NOT_EXIST', seed: [['users', 'review_teacher_fixed', { userId: 'review_teacher_fixed', role: 'teacher', status: 'ACTIVE', reviewOnly: true }] ] },
    { collection: 'student_roster', id: 'review_roster_fixed', stage: 'review_roster_init', errCode: 'CONNECTION_FAILED', seed: [['users', 'review_teacher_fixed', { userId: 'review_teacher_fixed', role: 'teacher', status: 'ACTIVE', reviewOnly: true }], ['users', 'review_student_fixed', { userId: 'review_student_fixed', role: 'student', status: 'ACTIVE', rosterId: 'review_roster_fixed', reviewOnly: true }]] }
  ];
  for (const scenario of scenarios) {
    reset();
    for (const [collection, id, record] of scenario.seed) store(collection).set(id, record);
    const formalUserId = `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`;
    const formalBefore = store('users').get(formalUserId);
    whereErrors.set(`${scenario.collection}:${scenario.id}`, Object.assign(new Error('real query failed'), { errCode: scenario.errCode }));
    await assert.rejects(auth.openReviewSession(openid, 'review-code', 'student'), (error) => error.code === 'REVIEW_FIXED_RECORD_INIT_FAILED' && error.reviewCauseCode === scenario.errCode && error.reviewStage === scenario.stage);
    assert.equal(store('review_sessions').size, 0);
    assert.strictEqual(store('users').get(formalUserId), formalBefore);
  }
});
