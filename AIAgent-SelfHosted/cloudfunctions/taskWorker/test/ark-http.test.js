const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { validateNewModelResult } = require('../shared/output-schema-validator');
const { safeError } = require('../shared/utils');
const modelOutputRepair = require('../shared/model-output-repair');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return { DYNAMIC_CURRENT_ENV: 'dynamic', init() {}, database() { return { command: {} }; }, getWXContext() { return {}; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const ark = require('../shared/ark');
Module._load = originalLoad;

function mockHttpsResponse(statusCode, body, headers = {}) {
  https.request = (_options, callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.headers = headers;
      process.nextTick(() => { callback(response); response.emit('data', body); response.emit('end'); });
    };
    request.destroy = (error) => { if (error) process.nextTick(() => request.emit('error', error)); };
    return request;
  };
}

function mockHttpsResponses(responses) {
  const requests = [];
  requests.options = [];
  https.request = (options, callback) => {
    requests.options.push(options);
    const request = new EventEmitter();
    request.write = (body) => { requests.push(JSON.parse(body)); };
    request.end = () => {
      const next = responses.shift();
      if (!next) throw new Error('Unexpected Ark request');
      const response = new EventEmitter();
      response.statusCode = next.statusCode || 200;
      response.headers = next.headers || {};
      process.nextTick(() => { callback(response); response.emit('data', next.body); response.emit('end'); });
    };
    request.destroy = (error) => { if (error) process.nextTick(() => request.emit('error', error)); };
    return request;
  };
  return requests;
}

test('Ark PRIMARY and REVIEW grading calls use lite responses with 4096 output tokens', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_LITE_ENDPOINT', 'ARK_LITE_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_LITE_ENDPOINT = 'lite-endpoint';
    process.env.ARK_LITE_API_MODE = 'responses';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const requests = mockHttpsResponses(['hardProblemPrimary', 'hardProblemReview'].map((requestStage) => ({
      body: JSON.stringify({ status: 'completed', output_text: JSON.stringify(schemaFixture('hard-problem.v2')), usage: { output_tokens: 1 } })
    })));
    for (const requestStage of ['hardProblemPrimary', 'hardProblemReview']) {
      await ark.callArk({ taskId: `task-${requestStage}`, tier: 'lite', mode: 'hard_problem', imageUrls: [], systemPrompt: 'grade', userPrompt: 'grade input', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', outputSchemaVersion: 'hard-problem.v2', requestStage });
    }
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.options.map((options) => options.path), ['/api/v3/responses', '/api/v3/responses']);
    assert.deepEqual(requests.map((body) => body.max_output_tokens), [4096, 4096]);
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function schemaFixture(version) {
  const common = { outputSchemaVersion: version, sourceKey: 'q-1', questionText: '1 + 1', confidence: 1 };
  const audit = { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 };
  if (version === 'hard-problem.v2') return { outputSchemaVersion: version, questionSetAudit: audit, questions: [{ ...common, studentAnswer: '2', standardAnswer: '2', answerStatus: 'answered', finalAnswerCorrect: true, stepRequired: true, stepStatus: 'correct', logicStatus: 'correct', errorType: 'none', firstWrongStep: '', errorReason: '', adjustmentSuggestion: '', knowledgePoint: '', stepFeedbacks: [{ stepIndex: 1, solutionText: '1 + 1 = 2', explanationText: '把两个1相加得到2', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '计算和解释均正确。', correctionAdvice: '' }], overallFeedback: '答案、步骤和讲解均正确。' }] };
  if (version === 'reading-careless.v2') return { outputSchemaVersion: version, questionSetAudit: audit, questions: [{ ...common, studentConditionText: '1 和 1', studentRelationText: '相加', studentAskText: '和是多少', referenceConditionText: '题目给出两个数：1 和 1', referenceRelationText: '把两个数相加', referenceAskText: '求 1 和 1 的和', analysisStatus: 'ok', conditionCorrect: true, relationCorrect: true, askCorrect: true, missingConditions: [], relationIssues: [], askIssue: '', errorReason: '', correctionAdvice: '' }] };
  return { outputSchemaVersion: version, questionSetAudit: audit, questions: [{ ...common, studentCalculation: '1+1=2', standardCalculation: '1+1=2', analysisStatus: 'ok', layoutClear: true, digitAlignmentCorrect: true, stepsComplete: true, carryBorrowClear: true, processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none', carelessIssues: [], methodIssues: [], errorReason: '', firstErrorPoint: '', correctionAdvice: '' }] };
}

function multiQuestionSchemaFixture(version) {
  const fixture = schemaFixture(version);
  return {
    ...fixture,
    questionSetAudit: { ...fixture.questionSetAudit, visibleIndependentQuestionCount: 3, emittedQuestionCount: 3 },
    questions: ['q-1', 'q-2', 'q-3'].map((sourceKey, index) => ({
      ...fixture.questions[0],
      sourceKey,
      questionText: `question-${index + 1}`,
      studentAnswer: `answer-${index + 1}`,
      studentConditionText: `condition-${index + 1}`,
      studentCalculation: `${index + 1}+${index + 1}`,
      confidence: 1
    }))
  };
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutSchemaVersions(value) {
  const result = copy(value);
  delete result.outputSchemaVersion;
  for (const question of result.questions) delete question.outputSchemaVersion;
  return result;
}

function parsedSchemaFixture(value, version, requestStage = 'hardProblemPrimary') {
  return ark.__arkTest.parseModelResponse(JSON.stringify(value), { outputSchemaVersion: version, requestStage }).value;
}

test('Ark accepts a 2xx JSON response without global fetch', async () => {
  const originalRequest = https.request;
  global.fetch = undefined;
  mockHttpsResponse(200, JSON.stringify({ choices: [] }), { 'x-request-id': 'request_1' });
  const result = await ark.__arkTest.requestArk({ model: 'model' }, 1000, 'chat_completions');
  https.request = originalRequest;
  assert.deepEqual(result.payload, { choices: [] });
  assert.equal(result.providerRequestId, 'request_1');
});

test('Ark restores blank REVIEW attribution from PRIMARY before schema validation while PRIMARY remains unchanged', () => {
  const review = schemaFixture('hard-problem.v2');
  Object.assign(review.questions[0], { sourceQuestionLabel: '', sourceRegion: '   ' });
  const options = {
    logicalPass: 2,
    outputSchemaVersion: 'hard-problem.v2',
    requestStage: 'hardProblemReview',
    reviewQuestionAttributionBaseline: [{ sourceKey: 'q-1', sourceQuestionLabel: '第1题', sourceRegion: 'image-1' }]
  };
  const restored = ark.__arkTest.parseModelResponse(JSON.stringify(review), options).value;
  assert.deepEqual(Object.fromEntries(['sourceKey', 'sourceQuestionLabel', 'sourceRegion'].map((field) => [field, restored.questions[0][field]])), {
    sourceKey: 'q-1', sourceQuestionLabel: '第1题', sourceRegion: 'image-1'
  });
  assert.equal(restored.questions[0].standardAnswer, '2');
  assert.throws(() => ark.__arkTest.parseModelResponse(JSON.stringify(review), { ...options, logicalPass: 1 }), (error) =>
    error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions[0].sourceQuestionLabel'
  );
});

test('Ark restores PRIMARY identity without changing REVIEW business fields for all three REVIEW schemas', () => {
  const cases = [
    ['hard-problem.v2', 'hardProblemReview', 'standardAnswer', 'review-standard'],
    ['reading-careless.v2', 'readingCarelessReview', 'conditionCorrect', false],
    ['calculation-careless.v2', 'calculationCarelessReview', 'layoutClear', false]
  ];
  for (const [version, requestStage, businessField, businessValue] of cases) {
    const review = schemaFixture(version);
    Object.assign(review.questions[0], { sourceKey: ' q-1 ', sourceQuestionLabel: 'wrong-label', sourceRegion: 'image-99', [businessField]: businessValue });
    const parsed = ark.__arkTest.parseModelResponse(JSON.stringify(review), {
      logicalPass: 2,
      outputSchemaVersion: version,
      requestStage,
      reviewQuestionAttributionBaseline: [{ sourceKey: 'q-1', sourceQuestionLabel: '第1题', sourceRegion: 'image-1' }]
    }).value;
    assert.deepEqual(Object.fromEntries(['sourceKey', 'sourceQuestionLabel', 'sourceRegion'].map((field) => [field, parsed.questions[0][field]])), {
      sourceKey: 'q-1', sourceQuestionLabel: '第1题', sourceRegion: 'image-1'
    });
    assert.equal(parsed.questions[0][businessField], businessValue);
  }
});

test('Ark does not invent attribution for a REVIEW-only question and safeError exposes bounded schema issues', () => {
  const review = multiQuestionSchemaFixture('hard-problem.v2');
  review.questions = review.questions.slice(0, 2);
  Object.assign(review.questions[0], { sourceQuestionLabel: '', sourceRegion: '' });
  Object.assign(review.questions[1], { sourceQuestionLabel: '', sourceRegion: '' });
  assert.throws(() => ark.__arkTest.parseModelResponse(JSON.stringify(review), {
    logicalPass: 2,
    outputSchemaVersion: 'hard-problem.v2',
    requestStage: 'hardProblemReview',
    reviewQuestionAttributionBaseline: [{ sourceKey: 'q-1', sourceQuestionLabel: '第1题', sourceRegion: 'image-1' }]
  }), (error) => {
    const diagnostic = safeError(error).schemaValidation;
    assert.equal(error.code, 'LLM_SCHEMA_ERROR');
    assert.equal(diagnostic.fieldPath, 'questions[1].sourceQuestionLabel');
    assert.equal(diagnostic.questionIndex, 1);
    assert.equal(diagnostic.issueCount, 2);
    assert.deepEqual(diagnostic.issues, [
      { code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[1].sourceQuestionLabel', validator: 'non-empty-string', sourceKey: 'q-2', repairable: true },
      { code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[1].sourceRegion', validator: 'non-empty-string', sourceKey: 'q-2', repairable: true }
    ]);
    assert.doesNotMatch(JSON.stringify(diagnostic), /question-2|answer-2|PROMPT|IMAGE|SECRET/);
    return true;
  });
});

test('Ark returns HTTP and invalid JSON error codes without leaking request data', async () => {
  const originalRequest = https.request;
  global.fetch = undefined;
  mockHttpsResponse(500, JSON.stringify({ error: { message: 'server failure' } }));
  await assert.rejects(ark.__arkTest.requestArk({ prompt: 'secret prompt' }, 1000, 'chat_completions'), (error) => error.code === 'ARK_HTTP_ERROR' && error.status === 500 && !error.errMsg.includes('secret prompt'));
  mockHttpsResponse(200, '{invalid');
  await assert.rejects(ark.__arkTest.requestArk({ model: 'model' }, 1000, 'chat_completions'), (error) => error.code === 'ARK_INVALID_JSON');
  https.request = originalRequest;
});

test('Ark timeout ignores an upstream timeout override and returns ARK_REQUEST_TIMEOUT', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  process.env.ARK_API_KEY = 'test-key';
  process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
  process.env.ARK_MINI_API_MODE = 'chat_completions';
  require('../shared/context').db.collection = () => ({ add: async () => {} });
  global.fetch = undefined;
  let configuredTimeoutMs = 0;
  https.request = () => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {};
    request.setTimeout = (timeout, callback) => { configuredTimeoutMs = timeout; process.nextTick(callback); };
    request.destroy = (error) => process.nextTick(() => request.emit('error', error));
    return request;
  };
  try {
    await assert.rejects(ark.callArk({ taskId: 'task-timeout', tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: '', userPrompt: '', temperature: 0, maxOutputTokens: 1, timeoutMs: 70000, structuredOutputMode: 'none' }), (error) => error.code === 'ARK_REQUEST_TIMEOUT');
    assert.equal(configuredTimeoutMs, 295000);
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark request timeout uses configured value and falls back for invalid values', () => {
  assert.equal(ark.__arkTest.resolveArkRequestTimeout({ ARK_REQUEST_TIMEOUT_MS: '120000' }), 120000);
  assert.equal(ark.__arkTest.resolveArkRequestTimeout({ ARK_REQUEST_TIMEOUT_MS: 'invalid' }), 300000);
  assert.equal(ark.__arkTest.resolveArkRequestTimeout({}), 300000);
  assert.equal(ark.__arkTest.resolveArkRequestTimeout({ ARK_REQUEST_TIMEOUT_MS: '1000' }), 30000);
  assert.equal(ark.__arkTest.resolveArkRequestTimeout({ ARK_REQUEST_TIMEOUT_MS: '999999' }), 300000);
});

test('Ark shares one 300-second grading budget with Repair after a long primary call', () => {
  const budget = ark.__arkTest.resolveGradingExecutionBudget(0, 122000);
  assert.deepEqual(budget, {
    totalBudgetMs: 300000,
    remainingBudgetMs: 178000,
    requestTimeoutMs: 173000,
    canStartRepair: true,
  });
  const exhausted = ark.__arkTest.resolveGradingExecutionBudget(0, 300000);
  assert.equal(exhausted.canStartRepair, false);
  assert.equal(exhausted.requestTimeoutMs, 0);
});

test('Ark enters one Repair after a 122-second primary call and completes validation', async () => {
  const originalRequest = https.request;
  const originalNow = Date.now;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const original = schemaFixture('hard-problem.v2');
    delete original.questions[0].standardAnswer;
    const requests = mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(original) }, finish_reason: 'stop' }] }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ repairs: [{ fieldPath: 'questions[0].standardAnswer', sourceKey: 'q-1', value: '2' }] }) }, finish_reason: 'stop' }] }) }
    ]);
    const times = [0, 122000, 122000, 122000, 122000, 122000];
    Date.now = () => times.shift() ?? 122000;
    const result = await ark.callArk({ taskId: 'task-long-primary-repair', tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: '', userPrompt: '', temperature: 0, maxOutputTokens: 1, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview' });
    assert.equal(requests.length, 2);
    assert.equal(result.questions[0].standardAnswer, '2');
    assert.equal(result._modelDiagnostics.repairSucceeded, true);
  } finally {
    https.request = originalRequest;
    Date.now = originalNow;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark repairs non-fixed required business fields once across all configured grading stages', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  const stages = [
    ['hardProblemPrimary', 'hard-problem.v2', 1, 'standardAnswer', '2'],
    ['hardProblemReview', 'hard-problem.v2', 2, 'standardAnswer', '2'],
    ['readingCarelessPrimary', 'reading-careless.v2', 1, 'referenceAskText', 'find the sum'],
    ['readingCarelessReview', 'reading-careless.v2', 2, 'correctionAdvice', 'read the ask again'],
    ['calculationCarelessPrimary', 'calculation-careless.v2', 1, 'standardCalculation', '2+2=4'],
    ['calculationCarelessReview', 'calculation-careless.v2', 0, 'correctionAdvice', 'check alignment']
  ];
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    for (const [requestStage, version, questionIndex, field, repairedValue] of stages) {
      const original = multiQuestionSchemaFixture(version);
      delete original.questions[questionIndex][field];
      const repaired = { repairs: [{ fieldPath: `questions[${questionIndex}].${field}`, sourceKey: original.questions[questionIndex].sourceKey, value: repairedValue }] };
      const requests = mockHttpsResponses([
        { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(original) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
        { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(repaired) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) }
      ]);
      const result = await ark.callArk({ taskId: `task-${requestStage}`, tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: 'grade', userPrompt: 'grade input', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: version, requestStage });
      assert.equal(requests.length, 2, requestStage);
      assert.equal(result.questions[questionIndex][field], repairedValue);
      assert.deepEqual(result.questions.map((question) => question.sourceKey), ['q-1', 'q-2', 'q-3']);
      assert.equal(result._modelDiagnostics.repairAttempted, true);
      assert.equal(result._modelDiagnostics.repairClassification, 'REPAIRABLE_FIELD_PATCH');
      assert.deepEqual(result._modelDiagnostics.repairFieldPaths, [`questions[${questionIndex}].${field}`]);
      assert.equal(validateNewModelResult(result).schema.schemaId, version);
    }
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('schema-driven repair eligibility collects every repairable business path and rejects identity paths', () => {
  for (const confidence of [undefined, null, '', '  ', '0.75', NaN, Infinity, -0.01, 1.01]) {
    const output = multiQuestionSchemaFixture('hard-problem.v2');
    output.questions[1].confidence = confidence;
    const error = Object.assign(new Error('confidence invalid'), { code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[1].confidence' });
    Object.defineProperty(error, 'modelOutput', { value: output });
    assert.deepEqual(modelOutputRepair.prepareModelOutputRepair(error)?.fieldPaths, ['questions[1].confidence']);
  }
  const output = multiQuestionSchemaFixture('hard-problem.v2');
  delete output.questions[1].standardAnswer;
  delete output.questions[2].confidence;
  const repairable = Object.assign(new Error('multiple fields invalid'), { code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[1].standardAnswer' });
  Object.defineProperty(repairable, 'modelOutput', { value: output });
  assert.deepEqual(modelOutputRepair.prepareModelOutputRepair(repairable)?.fieldPaths, ['questions[1].standardAnswer', 'questions[2].confidence']);

  delete output.questions[1].questionText;
  const error = Object.assign(new Error('questionText missing'), { code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[1].questionText' });
  Object.defineProperty(error, 'modelOutput', { value: output });
  assert.equal(modelOutputRepair.prepareModelOutputRepair(error), null);
});

test('Ark repair instructions request an exact field-patch envelope', () => {
  const original = multiQuestionSchemaFixture('hard-problem.v2');
  delete original.questions[1].standardAnswer;
  const error = Object.assign(new Error('standard answer missing'), { code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[1].standardAnswer' });
  Object.defineProperty(error, 'modelOutput', { value: original });
  const repairPlan = modelOutputRepair.prepareModelOutputRepair(error);
  const instructions = modelOutputRepair.modelOutputRepairInstructions({
    ...repairPlan,
    originalRawResponse: JSON.stringify(original),
    originalRequest: { systemPrompt: 'grade from the original image', userPrompt: 'keep evidence-based conclusions' }
  });

  assert.match(instructions.userPrompt, /"repairs"/i);
  assert.match(instructions.userPrompt, /exactly once/i);
  assert.match(instructions.userPrompt, /no other paths/i);
});

test('Ark repair instructions retain original image evidence context', () => {
  const original = multiQuestionSchemaFixture('hard-problem.v2');
  delete original.questions[1].standardAnswer;
  const error = Object.assign(new Error('standard answer missing'), { code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[1].standardAnswer' });
  Object.defineProperty(error, 'modelOutput', { value: original });
  const repairPlan = modelOutputRepair.prepareModelOutputRepair(error);
  const instructions = modelOutputRepair.modelOutputRepairInstructions({
    ...repairPlan,
    originalRawResponse: JSON.stringify(original),
    originalRequest: { systemPrompt: 'grade from the original image', userPrompt: 'keep evidence-based conclusions' }
  });

  assert.match(instructions.userPrompt, /original image and evidence/i);
  assert.match(instructions.userPrompt, /Do not mechanically use false/i);
  assert.match(instructions.userPrompt, /questions\[1\]\.standardAnswer/);
});

test('Ark repairs every detected business field while preserving text and original image evidence context', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const original = multiQuestionSchemaFixture('hard-problem.v2');
    delete original.questions[1].standardAnswer;
    delete original.questions[1].confidence;
    const repaired = { repairs: [
      { fieldPath: 'questions[1].standardAnswer', sourceKey: original.questions[1].sourceKey, value: '2' },
      { fieldPath: 'questions[1].confidence', sourceKey: original.questions[1].sourceKey, value: 0.75 }
    ] };
    const requests = mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(original) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(repaired) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) }
    ]);
    const result = await ark.callArk({ taskId: 'task-multi-field', tier: 'mini', mode: 'hard_problem', imageUrls: ['https://example.test/image.png'], systemPrompt: 'original grading system prompt', userPrompt: 'original grading prompt context', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview' });
    assert.equal(requests.length, 2);
    assert.match(requests[1].messages[1].content[0].text, /original grading system prompt/);
    assert.match(requests[1].messages[1].content[0].text, /original grading prompt context/);
    assert.deepEqual(requests[0].messages[1].content.slice(1), [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }]);
    assert.deepEqual(requests[1].messages[1].content.slice(1), [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }]);
    assert.equal(result.questions[1].standardAnswer, '2');
    assert.equal(result.questions[1].confidence, 0.75);
    assert.deepEqual(result._modelDiagnostics.repairFieldPaths, ['questions[1].standardAnswer', 'questions[1].confidence']);
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark completes one omitted required repair path with one bounded missing-only request', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const original = multiQuestionSchemaFixture('hard-problem.v2');
    delete original.questions[1].standardAnswer;
    delete original.questions[1].confidence;
    const firstPatch = { repairs: [
      { fieldPath: 'questions[1].standardAnswer', sourceKey: original.questions[1].sourceKey, value: '2' }
    ] };
    const completionPatch = { repairs: [
      { fieldPath: 'questions[1].confidence', sourceKey: original.questions[1].sourceKey, value: 0.75 }
    ] };
    const requests = mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(original) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(firstPatch) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(completionPatch) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) }
    ]);
    const result = await ark.callArk({ taskId: 'task-missing-repair-path', tier: 'mini', mode: 'hard_problem', imageUrls: ['https://example.test/image.png'], systemPrompt: 'grade', userPrompt: 'grade input', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview', maxRepairAttempts: 1 });

    assert.equal(requests.length, 3);
    assert.match(requests[2].messages[1].content[0].text, /questions\[1\]\.confidence/);
    assert.doesNotMatch(requests[2].messages[1].content[0].text, /questions\[1\]\.standardAnswer/);
    assert.deepEqual(requests[2].messages[1].content.slice(1), [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }]);
    assert.equal(result.questions[1].standardAnswer, '2');
    assert.equal(result.questions[1].confidence, 0.75);
    assert.equal(result._modelDiagnostics.repairAttemptCount, 2);
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark repairs questions[0].standardAnswer for a multi-question hardProblemReview without altering the existing nine-question PRIMARY result', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const primary = multiQuestionSchemaFixture('hard-problem.v2');
    primary.questions = Array.from({ length: 9 }, (_, index) => ({
      ...primary.questions[index % primary.questions.length],
      sourceKey: `primary-${index + 1}`,
      questionText: `primary question ${index + 1}`,
      studentAnswer: `${index + 1}`
    }));
    assert.equal(validateNewModelResult(primary).schema.schemaId, 'hard-problem.v2');
    const review = copy(primary);
    delete review.questions[0].standardAnswer;
    const repaired = { repairs: [{ fieldPath: 'questions[0].standardAnswer', sourceKey: review.questions[0].sourceKey, value: '2' }] };
    const requests = mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(review) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(repaired) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) }
    ]);
    const result = await ark.callArk({ taskId: 'task-hard-review-standard-answer', tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: 'hard problem review', userPrompt: `PRIMARY result: ${JSON.stringify(primary)}`, temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview' });
    assert.equal(requests.length, 2);
    assert.equal(result.questions.length, 9);
    assert.equal(result.questions[0].standardAnswer, '2');
    assert.deepEqual(result.questions.slice(1), primary.questions.slice(1));
    assert.deepEqual(result.questions.map((question) => question.sourceKey), primary.questions.map((question) => question.sourceKey));
    assert.deepEqual(result._modelDiagnostics.repairFieldPaths, ['questions[0].standardAnswer']);
    assert.equal(validateNewModelResult(result).schema.schemaId, 'hard-problem.v2');
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark precisely repairs calculation-careless firstErrorPoint, inputBasis and modeApplicability in one request', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const original = schemaFixture('calculation-careless.v2');
    original.questions[0].studentWorkDetected = true;
    original.questions[0].sourceQuestionLabel = '1';
    original.questions[0].sourceRegion = 'top';
    delete original.questions[0].firstErrorPoint;
    delete original.questions[0].inputBasis;
    delete original.questions[0].modeApplicability;
    const repaired = { repairs: [
      { fieldPath: 'questions[0].firstErrorPoint', sourceKey: 'q-1', value: '' },
      { fieldPath: 'questions[0].inputBasis', sourceKey: 'q-1', value: 'printed_question_with_work' },
      { fieldPath: 'questions[0].modeApplicability', sourceKey: 'q-1', value: 'applicable' }
    ] };
    const requests = mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(original) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(repaired) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) }
    ]);
    const strategy = { outputSchemaRegistry: { schemas: [{ schemaId: 'calculation-careless.v2', requiredFields: [...Object.keys(original.questions[0]), 'firstErrorPoint', 'inputBasis', 'modeApplicability'] }] } };
    const result = await ark.callArk({ taskId: 'task-repair-partial', tier: 'mini', mode: 'calculation_careless', imageUrls: [], systemPrompt: 'grade', userPrompt: 'grade input', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'calculation-careless.v2', requestStage: 'calculationCarelessPrimary', strategy });
    assert.equal(requests.length, 2);
    assert.equal(result.questions[0].inputBasis, 'printed_question_with_work');
    assert.equal(validateNewModelResult(result).schema.schemaId, 'calculation-careless.v2');
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});


test('Ark uses one bounded second repair when the first hard-problem patch remains invalid', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const original = schemaFixture('hard-problem.v2');
    original.questions[0].standardAnswer = '';
    assert.ok(require('../shared/output-schema-validator').collectNewModelResultIssues(original).some((item) => item.fieldPath === 'questions[0].standardAnswer'));
    const firstPatch = { repairs: [{ fieldPath: 'questions[0].standardAnswer', sourceKey: 'q-1', value: '' }] };
    const secondPatch = { repairs: [{ fieldPath: 'questions[0].standardAnswer', sourceKey: 'q-1', value: '2' }] };
    const requests = mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(original) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(firstPatch) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(secondPatch) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) }
    ]);
    const result = await ark.callArk({ taskId: 'task-hard-second-repair', tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: 'grade', userPrompt: 'grade input', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview', maxRepairAttempts: 2 });
    assert.equal(requests.length, 3);
    assert.equal(result._modelDiagnostics.repairAttemptCount, 2);
    assert.equal(result._modelDiagnostics.repairClassification, 'REPAIRABLE_FIELD_PATCH_RETRY');
    assert.equal(result.questions[0].standardAnswer, '2');
    assert.doesNotThrow(() => validateNewModelResult(result));
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark rejects a repair after the deterministic merge still violates the schema', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  const original = schemaFixture('hard-problem.v2');
  delete original.questions[0].standardAnswer;
  const partialRepair = { repairs: [{ fieldPath: 'questions[0].standardAnswer', sourceKey: 'q-1', value: 2 }] };
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(original) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(partialRepair) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) }
    ]);
    await assert.rejects(
      ark.callArk({ taskId: 'task-repair-invalid-merge', tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: 'grade', userPrompt: 'grade input', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemPrimary' }),
      (error) => error.code === 'LLM_SCHEMA_REPAIR_FAILED' && error.repairFailureReason === 'LLM_SCHEMA_REPAIR_FAILED'
    );
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark ignores the internal repair parse flag on an ordinary model request', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const invalid = schemaFixture('hard-problem.v2');
    delete invalid.questions[0].standardAnswer;
    assert.throws(
      () => ark.__arkTest.parseModelResponse(JSON.stringify(invalid), { outputSchemaVersion: 'hard-problem.v2', parseOnlyForModelOutputRepair: true }),
      (error) => error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions[0].standardAnswer'
    );
    mockHttpsResponse(200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }));
    await assert.rejects(
      ark.callArk({ taskId: 'task-no-parse-bypass', tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: 'grade', userPrompt: 'grade input', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemPrimary', parseOnlyForModelOutputRepair: true, disableModelOutputRepair: true }),
      (error) => error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions[0].standardAnswer'
    );
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark does not attempt repair for identity fields or a malformed questions structure', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    for (const [mutate, expectedCode, expectedPath] of [
      [(output) => { delete output.questions[2].sourceKey; }, 'LLM_SCHEMA_ERROR', 'questions[2].sourceKey'],
      [(output) => { delete output.questions[2].questionText; }, 'LLM_SCHEMA_ERROR', 'questions[2].questionText'],
      [(output) => { output.questions[2].outputSchemaVersion = 'hard-problem.v2'; }, 'LLM_SCHEMA_ERROR', 'questions[2].outputSchemaVersion'],
      [(output) => { output.questions = {}; }, 'LLM_SCHEMA_ERROR', 'questions']
    ]) {
      const invalid = multiQuestionSchemaFixture('reading-careless.v2');
      mutate(invalid);
      const requests = mockHttpsResponses([{ body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) }]);
      await assert.rejects(ark.callArk({ taskId: 'task-identity', tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: 'grade', userPrompt: 'grade input', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'reading-careless.v2', requestStage: 'readingCarelessReview' }), (error) => error.code === expectedCode && error.fieldPath === expectedPath && error.repairAttempted === false);
      assert.equal(requests.length, 1);
    }
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark rejects truncated JSON and repairs only one safe formatting defect', () => {
  assert.throws(() => ark.__arkTest.parseModelResponse('{"outputSchemaVersion":"hard-problem.v2","questions":[', { finishReason: 'stop', maxOutputTokens: 100 }), (error) => error.code === 'ARK_OUTPUT_TRUNCATED');
  const source = '{"outputSchemaVersion":"hard-problem.v2","questions":[],}';
  const parsed = ark.__arkTest.parseModelResponse(source, { finishReason: 'stop', maxOutputTokens: 100 });
  assert.deepEqual(parsed.value.questions, []);
  assert.equal(parsed.diagnostics.repairAttempted, true);
  assert.equal(parsed.diagnostics.repairSucceeded, true);
});

test('Ark reports safe schema-version diagnostics and rejects aliases and future versions', () => {
  const options = { outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemPrimary' };
  assert.doesNotThrow(() => ark.__arkTest.parseModelResponse('{"outputSchemaVersion":"hard-problem.v2","questions":[]}', options));
  for (const [payload, receivedVersion] of [
    ['{"schemaVersion":"hard-problem.v2","questions":[]}', null],
    ['{"outputSchemaVersion":"future.v3","questions":[]}', 'future.v3']
  ]) {
    assert.throws(() => ark.__arkTest.parseModelResponse(payload, options), (error) =>
      error.code === 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION'
      && error.receivedVersion === receivedVersion
      && error.expectedVersion === 'hard-problem.v2'
      && error.supportedVersions.includes('hard-problem.v2')
      && error.fieldPath === 'outputSchemaVersion'
      && error.requestStage === 'hardProblemPrimary'
      && Array.isArray(error.topLevelKeys)
      && error.topLevelKeys.length <= 30
    );
  }
});

test('Ark normalizes a missing top-level output schema version for all v2 modes before full validation', () => {
  for (const version of ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2']) {
    for (const missingVersion of [undefined, null, '', '   ']) {
      const fixture = schemaFixture(version);
      if (missingVersion === undefined) delete fixture.outputSchemaVersion;
      else fixture.outputSchemaVersion = missingVersion;
      const parsed = ark.__arkTest.parseModelResponse(JSON.stringify(fixture), { outputSchemaVersion: version });
      assert.equal(parsed.value.outputSchemaVersion, version);
      assert.equal(validateNewModelResult(parsed.value).schema.schemaId, version);
    }
  }
});

test('Ark normalizes only missing question output schema versions before REVIEW validation', () => {
  const options = { outputSchemaVersion: 'hard-problem.v2', requestStage: 'review' };

  const missing = schemaFixture('hard-problem.v2');
  delete missing.questions[0].outputSchemaVersion;
  const missingParsed = ark.__arkTest.parseModelResponse(JSON.stringify(missing), options);
  assert.equal(missingParsed.value.questions[0].outputSchemaVersion, 'hard-problem.v2');
  assert.equal(validateNewModelResult(missingParsed.value).schema.schemaId, 'hard-problem.v2');

  const blank = schemaFixture('hard-problem.v2');
  blank.questions[0].outputSchemaVersion = '';
  const blankParsed = ark.__arkTest.parseModelResponse(JSON.stringify(blank), options);
  assert.equal(blankParsed.value.questions[0].outputSchemaVersion, 'hard-problem.v2');
  assert.equal(validateNewModelResult(blankParsed.value).schema.schemaId, 'hard-problem.v2');

  const wrong = schemaFixture('hard-problem.v2');
  wrong.questions[0].outputSchemaVersion = 'reading-careless.v2';
  assert.throws(() => ark.__arkTest.parseModelResponse(JSON.stringify(wrong), options), (error) =>
    error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions[0].outputSchemaVersion'
  );
});

test('Ark normalizes every missing question schema-version representation for all formal schemas without changing business data', () => {
  const schemas = [
    ['hard-problem.v2', 'hardProblemPrimary'],
    ['reading-careless.v2', 'readingCarelessPrimary'],
    ['calculation-careless.v2', 'calculationCarelessPrimary']
  ];
  const questionVersionMutators = [
    (questions) => { delete questions[1].outputSchemaVersion; },
    (questions) => { for (const question of questions) delete question.outputSchemaVersion; },
    (questions) => { for (const question of questions) question.outputSchemaVersion = null; },
    (questions) => { for (const question of questions) question.outputSchemaVersion = ''; },
    (questions) => { for (const question of questions) question.outputSchemaVersion = '  \t'; }
  ];
  for (const [version, requestStage] of schemas) {
    for (const mutateQuestions of questionVersionMutators) {
      const fixture = multiQuestionSchemaFixture(version);
      mutateQuestions(fixture.questions);
      const parsed = parsedSchemaFixture(fixture, version, requestStage);
      assert.deepEqual(parsed.questions.map((question) => question.outputSchemaVersion), [version, version, version]);
      assert.deepEqual(withoutSchemaVersions(parsed), withoutSchemaVersions(fixture));
      assert.deepEqual(parsed.questions.map((question) => question.sourceKey), ['q-1', 'q-2', 'q-3']);
    }
  }
});

test('Ark combines top-level and question schema-version normalization without changing explicit correct versions', () => {
  const version = 'hard-problem.v2';
  for (const mutate of [
    (fixture) => { delete fixture.outputSchemaVersion; for (const question of fixture.questions) delete question.outputSchemaVersion; },
    (fixture) => { delete fixture.questions[1].outputSchemaVersion; },
    (fixture) => { fixture.outputSchemaVersion = ''; fixture.questions[1].outputSchemaVersion = ''; },
    () => {}
  ]) {
    const fixture = multiQuestionSchemaFixture(version);
    mutate(fixture);
    const parsed = parsedSchemaFixture(fixture, version);
    assert.equal(parsed.outputSchemaVersion, version);
    assert.deepEqual(parsed.questions.map((question) => question.outputSchemaVersion), [version, version, version]);
    assert.deepEqual(withoutSchemaVersions(parsed), withoutSchemaVersions(fixture));
  }
});

test('Ark rejects explicit schema-version errors and unsupported aliases at their original paths', () => {
  const version = 'hard-problem.v2';
  const options = { outputSchemaVersion: version, requestStage: 'hardProblemReview' };
  const invalidCases = [
    [(fixture) => { fixture.outputSchemaVersion = 'reading-careless.v2'; }, 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', 'outputSchemaVersion'],
    [(fixture) => { fixture.questions[1].outputSchemaVersion = 'reading-careless.v2'; }, 'LLM_SCHEMA_ERROR', 'questions[1].outputSchemaVersion'],
    [(fixture) => { delete fixture.outputSchemaVersion; fixture.schemaVersion = version; }, 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', 'outputSchemaVersion'],
    [(fixture) => { delete fixture.outputSchemaVersion; fixture.schema_version = version; }, 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', 'outputSchemaVersion'],
    [(fixture) => { delete fixture.questions[1].outputSchemaVersion; fixture.questions[1].schemaVersion = version; }, 'LLM_SCHEMA_ERROR', 'questions[1].outputSchemaVersion'],
    [(fixture) => { delete fixture.questions[1].outputSchemaVersion; fixture.questions[1].schema_version = version; }, 'LLM_SCHEMA_ERROR', 'questions[1].outputSchemaVersion'],
    [(fixture) => { fixture.questions[1].outputSchemaVersion = 'reading-careless.v2'; fixture.questions[2].outputSchemaVersion = 'calculation-careless.v2'; }, 'LLM_SCHEMA_ERROR', 'questions[1].outputSchemaVersion']
  ];
  for (const [mutate, code, fieldPath] of invalidCases) {
    const fixture = multiQuestionSchemaFixture(version);
    mutate(fixture);
    assert.throws(() => ark.__arkTest.parseModelResponse(JSON.stringify(fixture), options), (error) => error.code === code && error.fieldPath === fieldPath);
  }
});

test('Ark production call pipeline normalizes REVIEW question versions for all configured primary and review stages', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  const stages = [
    ['hardProblemPrimary', 'hard-problem.v2'], ['hardProblemReview', 'hard-problem.v2'],
    ['readingCarelessPrimary', 'reading-careless.v2'], ['readingCarelessReview', 'reading-careless.v2'],
    ['calculationCarelessPrimary', 'calculation-careless.v2'], ['calculationCarelessReview', 'calculation-careless.v2']
  ];
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    for (const [requestStage, version] of stages) {
      const response = multiQuestionSchemaFixture(version);
      delete response.questions[1].outputSchemaVersion;
      mockHttpsResponse(200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }));
      const parsed = await ark.callArk({ taskId: `task-${requestStage}`, tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: '', userPrompt: '', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: version, requestStage });
      assert.deepEqual(parsed.questions.map((question) => question.outputSchemaVersion), [version, version, version]);
    }
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Ark preserves explicit valid versions and rejects explicit invalid versions or a missing expected version', () => {
  const valid = schemaFixture('hard-problem.v2');
  const parsed = ark.__arkTest.parseModelResponse(JSON.stringify(valid), { outputSchemaVersion: 'hard-problem.v2' });
  assert.equal(parsed.value.outputSchemaVersion, 'hard-problem.v2');
  for (const receivedVersion of ['future.v3', 'hard-problem.v1', 'reading-careless.v2', 'output-schema-registry.v1', 2, {}, []]) {
    const fixture = schemaFixture('hard-problem.v2');
    fixture.outputSchemaVersion = receivedVersion;
    assert.throws(() => ark.__arkTest.parseModelResponse(JSON.stringify(fixture), { outputSchemaVersion: 'hard-problem.v2' }), (error) => error.code === 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION');
  }
  const withoutExpected = schemaFixture('hard-problem.v2');
  delete withoutExpected.outputSchemaVersion;
  const unnormalized = ark.__arkTest.parseModelResponse(JSON.stringify(withoutExpected), { outputSchemaVersion: null });
  assert.equal(unnormalized.value.outputSchemaVersion, undefined);
  assert.throws(() => validateNewModelResult(unnormalized.value), (error) => error.code === 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION');
});

test('Ark stops after one failed enum repair without leaking request content', async () => {
  const originalRequest = https.request;
  const originalError = console.error;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  const logs = [];
  try {
    process.env.ARK_API_KEY = 'API_KEY_SECRET';
    process.env.ARK_MINI_ENDPOINT = 'mini-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    console.error = (value) => logs.push(value);
    const receivedValue = `INVALID_${'x'.repeat(150)}`;
    const response = schemaFixture('hard-problem.v2');
    Object.assign(response.questions[0], { answerStatus: receivedValue, questionText: 'QUESTION_BODY_SECRET', studentAnswer: 'ANSWER_SECRET' });
    const requests = mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }) }
    ]);
    await assert.rejects(ark.callArk({ taskId: 'task-schema', tier: 'mini', mode: 'hard_problem', imageUrls: ['data:image/png;base64,IMAGE_SECRET'], systemPrompt: 'SYSTEM_PROMPT_SECRET', userPrompt: 'PROMPT_SECRET', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemPrimary' }), (error) => {
      return error.code === 'LLM_SCHEMA_REPAIR_FAILED'
        && error.fieldPath === 'questions[0].answerStatus'
        && error.requestStage === 'hardProblemPrimary'
        && error.repairAttempted === true
        && error.repairAttemptCount === 1;
    });
    assert.equal(requests.length, 2);
  } finally {
    https.request = originalRequest;
    console.error = originalError;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  for (const forbidden of ['API_KEY_SECRET', 'SYSTEM_PROMPT_SECRET', 'PROMPT_SECRET', 'QUESTION_BODY_SECRET', 'ANSWER_SECRET', 'IMAGE_SECRET']) assert.doesNotMatch(logs.join('\n'), new RegExp(forbidden));
});

test('Qwen3.7 Plus hard-problem calls use the OpenAI-compatible multimodal JSON contract', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const keys = ['QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_BASE_URL', 'QWEN_MODEL', 'ARK_API_KEY', 'ARK_LITE_ENDPOINT'];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.QWEN_API_KEY = 'qwen-test-key';
    delete process.env.DASHSCOPE_API_KEY;
    process.env.QWEN_BASE_URL = 'https://workspace.example.com/compatible-mode/v1';
    process.env.QWEN_MODEL = 'qwen3.7-plus';
    delete process.env.ARK_API_KEY;
    delete process.env.ARK_LITE_ENDPOINT;
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const requests = mockHttpsResponses([{
      body: JSON.stringify({
        id: 'qwen-request-1',
        choices: [{ message: { content: JSON.stringify(schemaFixture('hard-problem.v2')) }, finish_reason: 'stop' }],
        usage: { completion_tokens: 123 }
      })
    }]);

    const result = await ark.callArk({
      taskId: 'task-qwen-hard',
      provider: 'qwen3_vl_plus',
      tier: 'lite',
      mode: 'hard_problem',
      imageUrls: ['https://example.test/student.png'],
      systemPrompt: '只输出完整 JSON。',
      userPrompt: '批改图片。',
      temperature: 0,
      maxOutputTokens: 4096,
      timeoutMs: 1000,
      structuredOutputMode: 'none',
      outputSchemaVersion: 'hard-problem.v2',
      requestStage: 'hardProblemPrimary'
    });

    assert.equal(result._modelDiagnostics.modelProvider, 'qwen3_vl_plus');
    assert.equal(requests.options[0].hostname, 'workspace.example.com');
    assert.equal(requests.options[0].path, '/compatible-mode/v1/chat/completions');
    assert.equal(requests.options[0].headers.Authorization, 'Bearer qwen-test-key');
    assert.equal(Number(requests.options[0].headers['Content-Length']), Buffer.byteLength(JSON.stringify(requests[0])));
    assert.equal(requests[0].model, 'qwen3.7-plus');
    assert.equal(requests[0].enable_thinking, false);
    assert.deepEqual(requests[0].response_format, { type: 'json_object' });
    assert.equal(requests[0].max_completion_tokens, 4096);
    assert.equal(Object.hasOwn(requests[0], 'max_tokens'), false);
    assert.deepEqual(requests[0].messages[1].content[1], {
      type: 'image_url',
      image_url: { url: 'https://example.test/student.png' }
    });
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});



test('Qwen repair stays on Qwen3.7 Plus and never falls back to Ark', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const keys = ['QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_BASE_URL', 'QWEN_MODEL', 'ARK_API_KEY', 'ARK_LITE_ENDPOINT'];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.QWEN_API_KEY = 'qwen-repair-key';
    delete process.env.DASHSCOPE_API_KEY;
    process.env.QWEN_BASE_URL = 'https://workspace.example.com/compatible-mode/v1';
    process.env.QWEN_MODEL = 'qwen3.7-plus';
    process.env.ARK_API_KEY = 'ark-must-not-be-used';
    process.env.ARK_LITE_ENDPOINT = 'ark-must-not-be-used';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const original = schemaFixture('hard-problem.v2');
    delete original.questions[0].standardAnswer;
    const requests = mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(original) }, finish_reason: 'stop' }] }) },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ repairs: [{ fieldPath: 'questions[0].standardAnswer', sourceKey: 'q-1', value: '2' }] }) }, finish_reason: 'stop' }] }) }
    ]);
    const result = await ark.callArk({
      taskId: 'task-qwen-repair', provider: 'qwen3_vl_plus', tier: 'lite', mode: 'hard_problem', imageUrls: ['https://example.test/student.png'],
      systemPrompt: '只输出 JSON。', userPrompt: '输出 JSON。', temperature: 0, maxOutputTokens: 2048,
      structuredOutputMode: 'none', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview', maxRepairAttempts: 1
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((body) => body.model), ['qwen3.7-plus', 'qwen3.7-plus']);
    assert.deepEqual(requests.options.map((options) => options.hostname), ['workspace.example.com', 'workspace.example.com']);
    assert.deepEqual(requests.options.map((options) => options.headers.Authorization), ['Bearer qwen-repair-key', 'Bearer qwen-repair-key']);
    assert.equal(requests[0].messages[1].content.some((item) => item.type === 'image_url'), true);
    assert.equal(requests[1].messages[1].content.some((item) => item.type === 'image_url'), true);
    assert.equal(result.questions[0].standardAnswer, '2');
    assert.equal(result._modelDiagnostics.modelProvider, 'qwen3_vl_plus');
    assert.equal(result._modelDiagnostics.repairSucceeded, true);
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('DASHSCOPE_API_KEY is accepted as a Qwen API key compatibility alias', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const keys = ['QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_BASE_URL', 'QWEN_MODEL'];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    delete process.env.QWEN_API_KEY;
    process.env.DASHSCOPE_API_KEY = 'dashscope-test-key';
    process.env.QWEN_BASE_URL = 'https://workspace.example.com/compatible-mode/v1';
    process.env.QWEN_MODEL = 'qwen3.7-plus';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const requests = mockHttpsResponses([{
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(schemaFixture('hard-problem.v2')) }, finish_reason: 'stop' }] })
    }]);
    await ark.callArk({
      taskId: 'task-qwen-dashscope-key', provider: 'qwen3_vl_plus', tier: 'lite', mode: 'hard_problem', imageUrls: [],
      systemPrompt: '只输出 JSON。', userPrompt: '输出 JSON。', temperature: 0, maxOutputTokens: 1024,
      structuredOutputMode: 'none', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemPrimary'
    });
    assert.equal(requests.options[0].headers.Authorization, 'Bearer dashscope-test-key');
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Qwen provider rejects missing Cloud Run configuration without falling back to Ark', async () => {
  const originalEnv = Object.fromEntries(['QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_BASE_URL', 'ARK_API_KEY', 'ARK_LITE_ENDPOINT'].map((key) => [key, process.env[key]]));
  try {
    delete process.env.QWEN_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.QWEN_BASE_URL;
    process.env.ARK_API_KEY = 'ark-key';
    process.env.ARK_LITE_ENDPOINT = 'ark-lite';
    await assert.rejects(ark.callArk({
      taskId: 'task-qwen-unconfigured', provider: 'qwen3_vl_plus', tier: 'lite', mode: 'hard_problem',
      imageUrls: [], systemPrompt: 'JSON', userPrompt: 'JSON', temperature: 0, maxOutputTokens: 100,
      structuredOutputMode: 'none', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemPrimary'
    }), (error) => error.code === 'QWEN_NOT_CONFIGURED' && error.retryable === false);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});


test('Qwen configuration rejects insecure or incompatible base URLs and wrong model names', async () => {
  const originalEnv = Object.fromEntries(['QWEN_API_KEY', 'QWEN_BASE_URL', 'QWEN_MODEL'].map((key) => [key, process.env[key]]));
  try {
    process.env.QWEN_API_KEY = 'qwen-key';
    process.env.QWEN_BASE_URL = 'http://workspace.example.com/compatible-mode/v1';
    process.env.QWEN_MODEL = 'qwen3.7-plus';
    await assert.rejects(ark.callArk({
      taskId: 'task-qwen-invalid-url', provider: 'qwen3_vl_plus', tier: 'lite', mode: 'hard_problem',
      imageUrls: [], systemPrompt: '只输出 JSON', userPrompt: '输出 JSON', temperature: 0, maxOutputTokens: 100,
      structuredOutputMode: 'none', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemPrimary'
    }), (error) => error.code === 'QWEN_NOT_CONFIGURED' && error.retryable === false);

    process.env.QWEN_BASE_URL = 'https://workspace.example.com/compatible-mode/v1';
    process.env.QWEN_MODEL = 'qwen-plus';
    await assert.rejects(ark.callArk({
      taskId: 'task-qwen-invalid-model', provider: 'qwen3_vl_plus', tier: 'lite', mode: 'hard_problem',
      imageUrls: [], systemPrompt: '只输出 JSON', userPrompt: '输出 JSON', temperature: 0, maxOutputTokens: 100,
      structuredOutputMode: 'none', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemPrimary'
    }), (error) => error.code === 'QWEN_INVALID_MODEL' && error.retryable === false);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});


test('explicit maxRepairAttempts zero disables model-output repair', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const invalid = schemaFixture('hard-problem.v2');
    delete invalid.questions[0].standardAnswer;
    const requests = mockHttpsResponses([
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) }, finish_reason: 'stop' }] }) }
    ]);
    await assert.rejects(
      ark.callArk({ taskId: 'task-no-repair', tier: 'mini', mode: 'hard_problem', imageUrls: [], systemPrompt: 'grade', userPrompt: 'input', temperature: 0, maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview', maxRepairAttempts: 0 }),
      (error) => error.code === 'LLM_SCHEMA_ERROR' && error.repairAttempted === false
    );
    assert.equal(requests.length, 1);
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('empty fixedEvidenceQuestions does not disable normal hard-problem segmentation validation', () => {
  const value = schemaFixture('hard-problem.v2');
  value.questions[0].stepFeedbacks = [{
    stepIndex: 1,
    solutionText: '12+8=20\n20×2=40\n40+2=42\n42÷1=42',
    explanationText: '1.先求第一部分；2.再求第二部分；3.最后合并得到答案',
    solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '过程正确。', correctionAdvice: ''
  }];
  assert.throws(
    () => ark.__arkTest.parseAndValidateModelOutput(JSON.stringify(value), { outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview', fixedEvidenceQuestions: [] }),
    (error) => error?.code === 'LLM_SCHEMA_ERROR' && error?.fieldPath === 'questions[0].stepFeedbacks'
  );
  assert.doesNotThrow(() => ark.__arkTest.parseAndValidateModelOutput(JSON.stringify(value), {
    outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview',
    fixedEvidenceQuestions: [{ sourceKey: value.questions[0].sourceKey, fixedSteps: [{ stepIndex: 1 }] }]
  }));
});

test('callArk carries fixedEvidenceQuestions into the initial response validation boundary', async () => {
  const originalRequest = https.request;
  const originalCollection = require('../shared/context').db.collection;
  const originalEnv = Object.fromEntries(['ARK_API_KEY', 'ARK_MINI_ENDPOINT', 'ARK_MINI_API_MODE'].map((key) => [key, process.env[key]]));
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_MINI_ENDPOINT = 'test-endpoint';
    process.env.ARK_MINI_API_MODE = 'chat_completions';
    require('../shared/context').db.collection = () => ({ add: async () => {} });
    const value = schemaFixture('hard-problem.v2');
    value.questions[0].stepFeedbacks = [{
      stepIndex: 1,
      solutionText: '12+8=20\n20×2=40\n40+2=42\n42÷1=42',
      explanationText: '1.先求第一部分；2.再求第二部分；3.最后合并得到答案',
      solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '固定证据单元正确。', correctionAdvice: ''
    }];
    let requests = mockHttpsResponses([{ body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }) }]);
    const fixed = await ark.callArk({
      taskId: 'fixed-initial-context', tier: 'mini', mode: 'hard_problem_fixed_steps', imageUrls: [], systemPrompt: '', userPrompt: '', temperature: 0,
      maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview',
      disableModelOutputRepair: true,
      fixedEvidenceQuestions: [{ sourceKey: 'q-1', fixedSteps: [{ stepIndex: 1, solutionText: value.questions[0].stepFeedbacks[0].solutionText, explanationText: value.questions[0].stepFeedbacks[0].explanationText }] }]
    });
    assert.equal(requests.length, 1);
    assert.equal(fixed.questions[0].sourceKey, 'q-1');

    requests = mockHttpsResponses([{ body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }) }]);
    await assert.rejects(() => ark.callArk({
      taskId: 'empty-fixed-initial-context', tier: 'mini', mode: 'hard_problem_fixed_steps', imageUrls: [], systemPrompt: '', userPrompt: '', temperature: 0,
      maxOutputTokens: 100, timeoutMs: 1000, structuredOutputMode: 'json_object', outputSchemaVersion: 'hard-problem.v2', requestStage: 'hardProblemReview',
      disableModelOutputRepair: true, fixedEvidenceQuestions: []
    }), (error) => error?.code === 'LLM_SCHEMA_ERROR' && error?.fieldPath === 'questions[0].stepFeedbacks');
  } finally {
    https.request = originalRequest;
    require('../shared/context').db.collection = originalCollection;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});


test('Ark uses immutable primaryQuestionId to restore REVIEW attribution even when sourceKey drifts, then strips the internal id', () => {
  const review = schemaFixture('reading-careless.v2');
  Object.assign(review.questions[0], { primaryQuestionId: 'pq_007', sourceKey: 'model-regenerated-key', sourceQuestionLabel: '模型重写题号', sourceRegion: 'image-99' });
  const parsed = ark.__arkTest.parseModelResponse(JSON.stringify(review), {
    logicalPass: 2,
    outputSchemaVersion: 'reading-careless.v2',
    requestStage: 'readingCarelessReview',
    reviewQuestionAttributionBaseline: [{ primaryQuestionId: 'pq_007', sourceKey: 'img3_q7', sourceQuestionLabel: '第7题', sourceRegion: 'image-3:q7', questionText: '第7题' }]
  }).value;
  assert.equal(parsed.questions[0].sourceKey, 'img3_q7');
  assert.equal(parsed.questions[0].sourceQuestionLabel, '第7题');
  assert.equal(parsed.questions[0].sourceRegion, 'image-3:q7');
  assert.equal(Object.hasOwn(parsed.questions[0], 'primaryQuestionId'), false);
});

test('Ark primaryQuestionId mapping is order-independent and duplicate ids cannot collapse two REVIEW questions into one PRIMARY question', () => {
  const review = multiQuestionSchemaFixture('reading-careless.v2');
  review.questions = review.questions.slice(0, 2);
  review.questionSetAudit = { ...review.questionSetAudit, visibleIndependentQuestionCount: 2, emittedQuestionCount: 2 };
  Object.assign(review.questions[0], { primaryQuestionId: 'pq_002', sourceKey: 'drift-b', sourceQuestionLabel: '模型B', sourceRegion: 'image-99' });
  Object.assign(review.questions[1], { primaryQuestionId: 'pq_001', sourceKey: 'drift-a', sourceQuestionLabel: '模型A', sourceRegion: 'image-98' });
  const options = {
    logicalPass: 2, outputSchemaVersion: 'reading-careless.v2', requestStage: 'readingCarelessReview',
    reviewQuestionAttributionBaseline: [
      { primaryQuestionId: 'pq_001', sourceKey: 'primary-a', sourceQuestionLabel: '第1题', sourceRegion: 'image-1:q1' },
      { primaryQuestionId: 'pq_002', sourceKey: 'primary-b', sourceQuestionLabel: '第2题', sourceRegion: 'image-1:q2' }
    ]
  };
  const parsed = ark.__arkTest.parseModelResponse(JSON.stringify(review), options).value;
  assert.deepEqual(parsed.questions.map((q) => q.sourceKey), ['primary-b', 'primary-a']);

  const duplicate = structuredClone(review);
  duplicate.questions[0].primaryQuestionId = 'pq_001';
  duplicate.questions[1].primaryQuestionId = 'pq_001';
  assert.throws(() => ark.__arkTest.parseModelResponse(JSON.stringify(duplicate), options), (error) => error.code === 'QUESTION_SOURCE_KEY_DUPLICATE');
});

test('strategy renderer appends the explicit PRIMARY coverage contract only for REVIEW passes', () => {
  const render = require('../shared/strategy/render');
  const strategy = { prompts: { carelessTraining: { userTemplate: 'META={{META_JSON}}{{REPAIR_INSTRUCTION}}' }, calculationCarelessTraining: { userTemplate: 'META={{META_JSON}}' } } };
  const primaryMeta = { studentImageCount: 1 };
  const reviewMeta = { studentImageCount: 1, independentReview: true, reviewContractInstruction: 'MUST_RETURN_ALL_PRIMARY_IDS' };
  assert.doesNotMatch(render.carelessTrainingUserPrompt(strategy, primaryMeta), /MUST_RETURN_ALL_PRIMARY_IDS/);
  assert.match(render.carelessTrainingUserPrompt(strategy, reviewMeta), /MUST_RETURN_ALL_PRIMARY_IDS/);
  assert.match(render.calculationCarelessTrainingUserPrompt(strategy, reviewMeta), /MUST_RETURN_ALL_PRIMARY_IDS/);
});
