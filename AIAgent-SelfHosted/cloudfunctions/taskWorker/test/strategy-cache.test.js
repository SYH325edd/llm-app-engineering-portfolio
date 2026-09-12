const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const crypto = require('node:crypto');
const https = require('node:https');
const { EventEmitter } = require('node:events');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return { DYNAMIC_CURRENT_ENV: 'dynamic', init() {}, database() { return { command: {} }; }, getWXContext() { return {}; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const remote = require('../shared/strategy/remote');
const { db } = require('../shared/context');
const embedded = require('../shared/strategy/embedded');
Module._load = originalLoad;

function mockHttpsResponse(statusCode, body) {
  https.request = (...args) => {
    const callback = args.find((value) => typeof value === 'function');
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = statusCode;
      process.nextTick(() => { callback(response); response.emit('data', body); response.emit('end'); });
    };
    request.destroy = (error) => { if (error) process.nextTick(() => request.emit('error', error)); };
    return request;
  };
}

function validStrategy(version, minimumClientContractVersion = '1') {
  return {
    strategyVersion: version, minimumClientContractVersion, modelRuntimeContractVersion: 'model-runtime.v1', modelOutputRepairPolicy: { version: 'model-output-repair.v1' },
    outputSchemaRegistryVersion: 'output-schema-registry.v1', downstreamSemanticsVersion: 'result-semantics.v1', outputSchemaIds: ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2'],
  modelRuntime: Object.fromEntries(['hardProblemPrimary', 'hardProblemReview', 'readingCarelessPrimary', 'readingCarelessReview', 'calculationCarelessPrimary', 'calculationCarelessReview'].map((stage) => [stage, { outputSchemaVersion: stage.startsWith('hard') ? 'hard-problem.v2' : stage.startsWith('reading') ? 'reading-careless.v2' : 'calculation-careless.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1, reviewPayloadMode: 'compact' }])),
    prompts: Object.fromEntries(['narration', 'answerExtraction', 'grade', 'hardProblem', 'carelessTraining', 'calculationCarelessTraining'].map((name) => [name, { system: 'system', userTemplate: 'template' }])), models: { grading: { timeoutMs: 8000 } }, reviewRules: { hardProblem: { correctStepStatuses: ['CORRECT'] } },
  };
}
function signedEnvelope(strategy, key, privateKey) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(strategy), 'utf8'), cipher.final()]);
  const envelope = { strategyVersion: strategy.strategyVersion, artifactHash: crypto.createHash('sha256').update(ciphertext).digest('hex'), licenseStatus: 'active', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), graceUntil: new Date(Date.now() + 86_400_000).toISOString(), encryption: { algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') } };
  envelope.signature = crypto.sign('sha256', Buffer.from(JSON.stringify(envelope)), privateKey).toString('base64');
  return envelope;
}

test('missing strategy_cache/active is treated as a cache miss', async () => {
  db.collection = () => ({ doc: () => ({ get: async () => { throw Object.assign(new Error('document does not exist'), { code: 'DOCUMENT_NOT_FOUND' }); } }) });
  assert.equal(await remote.__strategyTest.readCache(), null);
});

test('production-safe default fails closed when STRATEGY_REMOTE_REQUIRED is omitted and remote configuration is incomplete', async () => {
  const keys = ['STRATEGY_SERVICE_URL', 'STRATEGY_LICENSE_ID', 'STRATEGY_CUSTOMER_ID', 'STRATEGY_LICENSE_KEY', 'STRATEGY_PUBLIC_KEY_BASE64', 'STRATEGY_REMOTE_REQUIRED'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    remote.resetRuntimeStrategyForTests();
    await assert.rejects(remote.loadRuntimeStrategy(), (error) => error.code === 'STRATEGY_REMOTE_CONFIG_MISSING' && error.retryable === false);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    remote.resetRuntimeStrategyForTests();
  }
});

test('remote-required mode never silently falls back to an embedded legacy strategy when remote configuration is incomplete', async () => {
  const keys = ['STRATEGY_SERVICE_URL', 'STRATEGY_LICENSE_ID', 'STRATEGY_CUSTOMER_ID', 'STRATEGY_LICENSE_KEY', 'STRATEGY_PUBLIC_KEY_BASE64', 'STRATEGY_REMOTE_REQUIRED'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.STRATEGY_REMOTE_REQUIRED = 'true';
    remote.resetRuntimeStrategyForTests();
    await assert.rejects(remote.loadRuntimeStrategy(), (error) => error.code === 'STRATEGY_REMOTE_CONFIG_MISSING' && error.retryable === false);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    remote.resetRuntimeStrategyForTests();
  }
});

test('unexpired strategy_cache/active is read without a remote request', async () => {
  const envelope = { graceUntil: new Date(Date.now() + 60_000).toISOString() };
  const refreshAfter = new Date(Date.now() + 60_000);
  db.collection = () => ({ doc: () => ({ get: async () => ({ data: { envelope, refreshAfter } }) }) });
  assert.deepEqual(await remote.__strategyTest.readCache(), { envelope, strategyVersion: '', artifactHash: '', updatedAt: null });
});

test('an effective cached strategy never requests latest after the former refresh window', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), key = crypto.randomBytes(32);
  const strategy = validStrategy('cached-v1'), envelope = signedEnvelope(strategy, key, privateKey);
  Object.assign(process.env, { STRATEGY_SERVICE_URL: 'https://strategy.example.invalid', STRATEGY_LICENSE_ID: 'license', STRATEGY_CUSTOMER_ID: 'customer', STRATEGY_LICENSE_KEY: key.toString('hex'), STRATEGY_PUBLIC_KEY_BASE64: Buffer.from(publicKey.export({ type: 'pkcs1', format: 'pem' })).toString('base64') });
  const originalRequest = https.request;
  db.collection = () => ({ doc: () => ({ get: async () => ({ data: { envelope, refreshAfter: new Date(Date.now() - 8 * 86_400_000) } }) }) });
  https.request = () => { throw new Error('latest must not be requested'); };
  remote.resetRuntimeStrategyForTests();
  assert.deepEqual(await remote.loadRuntimeStrategy(), strategy);
  https.request = originalRequest;
});

test('remote failure after a cache miss preserves the cache and uses the embedded fallback', async () => {
  Object.assign(process.env, {
    STRATEGY_SERVICE_URL: 'https://strategy.example.invalid', STRATEGY_LICENSE_ID: 'license', STRATEGY_CUSTOMER_ID: 'customer',
    STRATEGY_LICENSE_KEY: 'a'.repeat(64), STRATEGY_PUBLIC_KEY_BASE64: Buffer.from('public').toString('base64'), STRATEGY_REMOTE_REQUIRED: 'false',
  });
  let writes = 0;
  db.collection = () => ({ doc: () => ({ get: async () => { throw Object.assign(new Error('document does not exist'), { code: 'DOCUMENT_NOT_FOUND' }); }, set: async () => { writes += 1; } }) });
  const originalRequest = https.request;
  const originalEmbedded = embedded.decryptEmbeddedStrategy;
  const fallback = { strategyVersion: 'embedded-fallback' };
  embedded.decryptEmbeddedStrategy = () => fallback;
  mockHttpsResponse(500, JSON.stringify({ message: 'service unavailable' }));
  global.fetch = undefined;
  remote.resetRuntimeStrategyForTests();
  assert.equal(await remote.loadRuntimeStrategy(), fallback);
  assert.equal(writes, 0);
  embedded.decryptEmbeddedStrategy = originalEmbedded;
  https.request = originalRequest;
});

test('cache miss fetches, validates, writes, and shares the active strategy exactly once', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = crypto.randomBytes(32);
  const strategy = {
    strategyVersion: 'test-v1',
    minimumClientContractVersion: '1',
    modelRuntimeContractVersion: 'model-runtime.v1',
    modelOutputRepairPolicy: { version: 'model-output-repair.v1' },
    outputSchemaRegistryVersion: 'output-schema-registry.v1',
    downstreamSemanticsVersion: 'result-semantics.v1',
    outputSchemaIds: ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2'],
    modelRuntime: Object.fromEntries([
      ['hardProblemPrimary', 'hard-problem.v2'], ['hardProblemReview', 'hard-problem.v2'],
      ['readingCarelessPrimary', 'reading-careless.v2'], ['readingCarelessReview', 'reading-careless.v2'],
      ['calculationCarelessPrimary', 'calculation-careless.v2'], ['calculationCarelessReview', 'calculation-careless.v2'],
    ].map(([stage, outputSchemaVersion]) => [stage, { outputSchemaVersion, modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1, reviewPayloadMode: 'compact' }])),
    prompts: Object.fromEntries(['narration', 'answerExtraction', 'grade', 'hardProblem', 'carelessTraining', 'calculationCarelessTraining'].map((name) => [name, { system: 'system', userTemplate: 'template' }])),
    models: { grading: { timeoutMs: 8000 } },
    reviewRules: { hardProblem: { correctStepStatuses: ['CORRECT'] } },
  };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(strategy), 'utf8'), cipher.final()]);
  const envelope = {
    strategyVersion: strategy.strategyVersion,
    artifactHash: crypto.createHash('sha256').update(ciphertext).digest('hex'),
    licenseStatus: 'active',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    graceUntil: new Date(Date.now() + 86_400_000).toISOString(),
    encryption: { algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') },
  };
  envelope.signature = crypto.sign('sha256', Buffer.from(JSON.stringify(envelope)), privateKey).toString('base64');
  Object.assign(process.env, {
    STRATEGY_SERVICE_URL: 'https://strategy.example.invalid', STRATEGY_LICENSE_ID: 'license', STRATEGY_CUSTOMER_ID: 'customer',
    STRATEGY_LICENSE_KEY: key.toString('hex'), STRATEGY_PUBLIC_KEY_BASE64: Buffer.from(publicKey.export({ type: 'pkcs1', format: 'pem' })).toString('base64'), STRATEGY_REMOTE_REQUIRED: 'true',
  });
  let getCalls = 0;
  let setCalls = 0;
  let writtenId = '';
  let writtenData;
  db.collection = () => ({ doc: (id) => ({ get: async () => { getCalls += 1; throw Object.assign(new Error('document does not exist'), { code: 'DOCUMENT_NOT_FOUND' }); }, set: async ({ data }) => { setCalls += 1; writtenId = id; writtenData = data; } }) });
  const originalRequest = https.request;
  let requestCalls = 0;
  mockHttpsResponse(200, JSON.stringify(envelope));
  const mockRequest = https.request;
  https.request = (...args) => { requestCalls += 1; return mockRequest(...args); };
  global.fetch = undefined;
  remote.resetRuntimeStrategyForTests();
  const [loaded, concurrentLoaded] = await Promise.all([remote.loadRuntimeStrategy(), remote.loadRuntimeStrategy()]);
  https.request = originalRequest;
  assert.deepEqual(loaded, strategy);
  assert.deepEqual(concurrentLoaded, strategy);
  assert.equal(requestCalls, 1);
  assert.equal(setCalls, 1);
  assert.equal(writtenId, 'active');
  assert.equal(writtenData.envelope.strategyVersion, strategy.strategyVersion);
  assert.ok(getCalls >= 1);
});

test('manual refresh validates and atomically replaces the active cache only after all checks pass', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = crypto.randomBytes(32);
  const strategy = {
    strategyVersion: 'manual-v2', minimumClientContractVersion: '1', modelRuntimeContractVersion: 'model-runtime.v1',
    modelOutputRepairPolicy: { version: 'model-output-repair.v1' }, outputSchemaRegistryVersion: 'output-schema-registry.v1', downstreamSemanticsVersion: 'result-semantics.v1',
    outputSchemaIds: ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2'],
    modelRuntime: Object.fromEntries(['hardProblemPrimary', 'hardProblemReview', 'readingCarelessPrimary', 'readingCarelessReview', 'calculationCarelessPrimary', 'calculationCarelessReview'].map((stage) => [stage, { outputSchemaVersion: stage.startsWith('hard') ? 'hard-problem.v2' : stage.startsWith('reading') ? 'reading-careless.v2' : 'calculation-careless.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1, reviewPayloadMode: 'compact' }])),
    prompts: Object.fromEntries(['narration', 'answerExtraction', 'grade', 'hardProblem', 'carelessTraining', 'calculationCarelessTraining'].map((name) => [name, { system: 'system', userTemplate: 'template' }])), models: { grading: { timeoutMs: 8000 } }, reviewRules: { hardProblem: { correctStepStatuses: ['CORRECT'] } },
  };
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(strategy), 'utf8'), cipher.final()]);
  const envelope = { strategyVersion: strategy.strategyVersion, artifactHash: crypto.createHash('sha256').update(ciphertext).digest('hex'), licenseStatus: 'active', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), graceUntil: new Date(Date.now() + 86_400_000).toISOString(), encryption: { algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') } };
  envelope.signature = crypto.sign('sha256', Buffer.from(JSON.stringify(envelope)), privateKey).toString('base64');
  Object.assign(process.env, { STRATEGY_SERVICE_URL: 'https://strategy.example.invalid', STRATEGY_LICENSE_ID: 'license', STRATEGY_CUSTOMER_ID: 'customer', STRATEGY_LICENSE_KEY: key.toString('hex'), STRATEGY_PUBLIC_KEY_BASE64: Buffer.from(publicKey.export({ type: 'pkcs1', format: 'pem' })).toString('base64') });
  const oldEnvelope = { strategyVersion: 'old-v1', artifactHash: 'b'.repeat(64), graceUntil: new Date(Date.now() + 60_000).toISOString() };
  let stored = { envelope: oldEnvelope }; let writes = 0;
  db.collection = () => ({ doc: () => ({ get: async () => ({ data: stored }), set: async ({ data }) => { writes += 1; stored = data; } }) });
  const originalRequest = https.request; mockHttpsResponse(200, JSON.stringify(envelope)); remote.resetRuntimeStrategyForTests();
  const result = await remote.refreshRuntimeStrategy(); https.request = originalRequest;
  assert.deepEqual(result, { changed: true, previousStrategyVersion: 'old-v1', currentStrategyVersion: 'manual-v2', previousArtifactHash: 'b'.repeat(64), currentArtifactHash: envelope.artifactHash, refreshedAt: result.refreshedAt });
  assert.equal(writes, 1); assert.equal(stored.envelope.artifactHash, envelope.artifactHash);
});

test('manual refresh failure preserves both the database cache and current memory strategy', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), key = crypto.randomBytes(32);
  const oldStrategy = validStrategy('old-v1'), oldEnvelope = signedEnvelope(oldStrategy, key, privateKey);
  let stored = { envelope: oldEnvelope }; let writes = 0;
  db.collection = () => ({ doc: () => ({ get: async () => ({ data: stored }), set: async ({ data }) => { writes += 1; stored = data; } }) });
  Object.assign(process.env, { STRATEGY_SERVICE_URL: 'https://strategy.example.invalid', STRATEGY_LICENSE_ID: 'license', STRATEGY_CUSTOMER_ID: 'customer', STRATEGY_LICENSE_KEY: key.toString('hex'), STRATEGY_PUBLIC_KEY_BASE64: Buffer.from(publicKey.export({ type: 'pkcs1', format: 'pem' })).toString('base64') });
  remote.resetRuntimeStrategyForTests(); await remote.loadRuntimeStrategy();
  const originalRequest = https.request; mockHttpsResponse(200, JSON.stringify({ ...oldEnvelope, signature: 'invalid' }));
  await assert.rejects(remote.refreshRuntimeStrategy(), (error) => error.code === 'STRATEGY_SIGNATURE_INVALID'); https.request = originalRequest;
  assert.equal(writes, 0); assert.equal(stored.envelope, oldEnvelope); assert.deepEqual(await remote.loadRuntimeStrategy(), oldStrategy);
});

test('requestJson reports HTTP status and invalid JSON without global fetch', async () => {
  const originalRequest = https.request;
  global.fetch = undefined;
  mockHttpsResponse(500, JSON.stringify({ message: 'server error' }));
  await assert.rejects(remote.__strategyTest.requestJson('https://strategy.example.invalid/v1/strategy/latest', '{}'), (error) => error.code === 'STRATEGY_REMOTE_HTTP_ERROR' && error.status === 500);
  mockHttpsResponse(200, '{invalid');
  await assert.rejects(remote.__strategyTest.requestJson('https://strategy.example.invalid/v1/strategy/latest', '{}'), (error) => error.code === 'STRATEGY_REMOTE_INVALID_JSON');
  https.request = () => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {};
    request.setTimeout = (_timeout, callback) => process.nextTick(callback);
    request.destroy = (error) => process.nextTick(() => request.emit('error', error));
    return request;
  };
  await assert.rejects(remote.__strategyTest.requestJson('https://strategy.example.invalid/v1/strategy/latest', '{}'), (error) => error.code === 'STRATEGY_REMOTE_TIMEOUT');
  https.request = originalRequest;
});
