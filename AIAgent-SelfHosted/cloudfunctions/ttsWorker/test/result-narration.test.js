const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

const { NARRATION_VERSION, buildNarrationInput, fallbackNarration } = require('../shared/result-narration');

test('reading-careless fallback narrates only the grids that are wrong or missing', () => {
  const input = buildNarrationInput({
    mode: 'CARELESS_TRAINING',
    summary: {},
    questions: [{
      sourceKey: 'reading-grid', questionNumber: 3, threeGridStatus: 'WRONG',
      studentConditionText: '', studentRelationText: '总数相加', studentAskText: '还剩多少个',
      referenceConditionText: '共有12个', referenceRelationText: '总数减去已用', referenceAskText: '还剩多少个',
      conditionCorrect: false, relationCorrect: false, askCorrect: true
    }]
  });

  const narration = fallbackNarration(input);

  assert.match(narration, /第3题条件有问题。正确条件应为：共有12个。/);
  assert.match(narration, /第3题关系有问题。正确关系应为：总数减去已用。/);
  assert.doesNotMatch(narration, /学生填写的关系|学生填写的条件/);
  assert.doesNotMatch(narration, /正确所求|所求有问题/);
});

test('calculation-careless fallback reports only allowed careless details without repeating calculations', () => {
  const input = buildNarrationInput({
    mode: 'CARELESS_TRAINING', carelessTrainingType: 'CALCULATION', outputSchemaVersion: 'calculation-careless.v2',
    summary: {},
    questions: [{
      sourceKey: 'calculation-careless', questionNumber: 4, calculationStatus: 'WRONG', carelessDetected: true,
      studentCalculation: '12减5等于8', standardCalculation: '12减5等于7', firstErrorPoint: '借位',
      carelessIssues: ['漏写借位'], errorReason: '个位计算错误', correctionAdvice: '逐位检查'
    }]
  });

  const narration = fallbackNarration(input);

  assert.match(narration, /第4题存在马虎。/);
  assert.doesNotMatch(narration, /学生计算为|12减5等于8/);
  assert.doesNotMatch(narration, /正确计算为|12减5等于7/);
  assert.match(narration, /马虎点包括：漏写借位。/);
  assert.equal(narration.slice(input.expectedSummaryText.length).includes('回答错误'), false);
});

test('hard-problem fallback identifies a correct answer with wrong process and reads every wrong step', () => {
  const input = buildNarrationInput({
    mode: 'HARD_PROBLEM_CHECK',
    summary: {},
    questions: [{
      sourceKey: 'hard-process', questionNumber: 5, evaluationStatus: 'WRONG', finalAnswerCorrect: true,
      stepStatus: 'wrong', logicStatus: 'wrong', studentAnswer: '7', standardAnswer: '7',
      firstWrongStep: ['列式错误', '推导跳步'], errorReason: '数量关系判断错误', adjustmentSuggestion: '先列关系式'
    }]
  });

  const narration = fallbackNarration(input);

  assert.match(narration, /第5题回答错误。/);
  assert.match(narration, /错误步骤包括：列式错误、推导跳步。/);
});

test('hard-problem narration keeps final sourceKey order and complete wrong-step data', () => {
  const input = buildNarrationInput({
    mode: 'HARD_PROBLEM_CHECK',
    summary: { totalCount: 2, correctCount: 1, wrongCount: 1, incompleteCount: 0, carelessCount: 0 },
    questions: [
      {
        sourceKey: 'hard-source-b', printedQuestionNumber: 8, evaluationStatus: 'WRONG', answerStatus: 'answered',
        finalAnswerCorrect: false, stepRequired: true, stepStatus: 'wrong', logicStatus: 'wrong',
        firstWrongStep: ['列式错误', '后续计算错误'], errorReason: '运算顺序错误', adjustmentSuggestion: '先检查列式', knowledgePoint: '不应进入语音输入'
      },
      {
        sourceKey: '第12小题', evaluationStatus: 'CORRECT', answerStatus: 'answered',
        finalAnswerCorrect: true, stepRequired: false, stepStatus: 'not_required', logicStatus: 'correct',
        firstWrongStep: [], errorReason: '', adjustmentSuggestion: ''
      }
    ]
  });

  assert.deepEqual(input.questions.map((question) => question.sourceKey), ['hard-source-b', '第12小题']);
  assert.deepEqual(input.questions.map((question) => question.questionNumber), [8, 12]);
  assert.deepEqual(input.questions[0].firstWrongStep, ['列式错误', '后续计算错误']);
  assert.equal(Object.hasOwn(input.questions[0], 'knowledgePoint'), false);
  assert.equal(input.expectedSummaryText, '本次共批改2道题，其中回答正确1道，回答错误1道，未作答或无法判断0道。');
});

test('reading-careless treats a readable blank grid as a wrong answer, not incomplete', () => {
  const input = buildNarrationInput({
    mode: 'CARELESS_TRAINING',
    outputSchemaVersion: 'reading-careless.v2',
    summary: {},
    questions: [{
      sourceKey: 'reading-source', questionNumber: 3, analysisStatus: 'ok', threeGridStatus: 'WRONG', normalizedStatus: 'WRONG',
      studentConditionText: '', studentRelationText: '总数关系', studentAskText: '求剩余',
      referenceConditionText: '共有12个', referenceRelationText: '总数减去用掉的数量', referenceAskText: '还剩多少个',
      conditionCorrect: false, relationCorrect: true, askCorrect: true, correctionAdvice: '补全条件', errorReason: '条件未填写'
    }]
  });

  assert.equal(input.questions[0].studentConditionText, '');
  assert.equal(input.questions[0].referenceConditionText, '共有12个');
  assert.equal(input.summary.wrongCount, 1);
  assert.equal(input.summary.incompleteCount, 0);
  assert.equal(input.expectedSummaryText, '本次共检查1道题，其中回答正确0道，回答错误1道，填写不完整0道。');
  assert.match(fallbackNarration(input), /第3题条件有问题/);
  assert.doesNotMatch(fallbackNarration(input), /当前无法准确判断/);
});

test('calculation-careless narration retains both issue lists and final summary counts', () => {
  const input = buildNarrationInput({
    mode: 'CARELESS_TRAINING',
    carelessTrainingType: 'CALCULATION',
    outputSchemaVersion: 'calculation-careless.v2',
    summary: { totalCount: 2, correctCount: 1, wrongCount: 1, incompleteCount: 0, carelessCount: 1 },
    questions: [
      {
        sourceKey: 'calculation-source-2', printedQuestionNumber: 6, analysisStatus: 'ok', calculationStatus: 'WRONG',
        processCorrect: false, finalAnswerCorrect: false, carelessDetected: true, issueCategory: 'careless',
        firstErrorPoint: '借位', carelessIssues: ['漏写借位', '个位计算错误'], methodIssues: [], errorReason: '计算马虎', correctionAdvice: '逐位检查'
      },
      {
        sourceKey: 'calculation-source-1', questionNumber: 2, analysisStatus: 'ok', calculationStatus: 'WRONG',
        processCorrect: false, finalAnswerCorrect: false, carelessDetected: false, issueCategory: 'knowledge_or_method',
        firstErrorPoint: '列式', carelessIssues: [], methodIssues: ['乘法方法错误', '未按步骤计算'], errorReason: '方法错误', correctionAdvice: '复习乘法方法'
      }
    ]
  });

  assert.deepEqual(input.questions.map((question) => question.sourceKey), ['calculation-source-2', 'calculation-source-1']);
  assert.deepEqual(input.questions.map((question) => question.questionNumber), [6, 2]);
  assert.deepEqual(input.questions[0].carelessIssues, ['漏写借位', '个位计算错误']);
  assert.deepEqual(input.questions[1].methodIssues, ['乘法方法错误', '未按步骤计算']);
  assert.equal(input.expectedSummaryText, '本次共检查2道题，其中回答正确0道，回答错误1道，存在马虎1道。');
});

test('hard-problem encouragement only uses answer, step, and logic feedback', () => {
  const input = buildNarrationInput({
    mode: 'HARD_PROBLEM_CHECK',
    summary: { totalCount: 2, correctCount: 1, wrongCount: 1, incompleteCount: 0 },
    questions: [
      { sourceKey: 'hard-correct', questionNumber: 1, evaluationStatus: 'CORRECT' },
      { sourceKey: 'hard-wrong', questionNumber: 2, evaluationStatus: 'WRONG', firstWrongStep: '第二步逻辑判断', adjustmentSuggestion: '请核对第二步逻辑' }
    ]
  });

  assert.match(input.expectedEncouragement, /请核对第二步逻辑/);
  assert.equal(/三格|条件|关系|所求|计算马虎|粗心判断/.test(input.expectedEncouragement), false);
});

test('reading-careless encouragement only uses condition, relation, and ask feedback', () => {
  const input = buildNarrationInput({
    mode: 'CARELESS_TRAINING',
    summary: { totalCount: 1, correctCount: 0, wrongCount: 1, incompleteCount: 0 },
    questions: [{
      sourceKey: 'reading-adjustment', questionNumber: 3, threeGridStatus: 'INCOMPLETE',
      missingConditions: ['已知数量'], relationIssues: ['数量关系未写完整'], askIssue: '所求对象不明确', correctionAdvice: '补全条件后再确认数量关系和所求'
    }]
  });

  assert.match(input.expectedEncouragement, /补全条件后再确认数量关系和所求/);
  assert.equal(/计算过程|运算错误|验算|计算马虎/.test(input.expectedEncouragement), false);
});

test('calculation-careless encouragement follows issue lists without reading terms and fallback reuses it', () => {
  const carelessInput = buildNarrationInput({
    mode: 'CARELESS_TRAINING', carelessTrainingType: 'CALCULATION', outputSchemaVersion: 'calculation-careless.v2',
    summary: { totalCount: 1, correctCount: 0, wrongCount: 1, carelessCount: 1 },
    questions: [{ sourceKey: 'careless-issue', questionNumber: 4, calculationStatus: 'WRONG', carelessDetected: true, issueCategory: 'careless', carelessIssues: ['漏写进位'] }]
  });
  const methodInput = buildNarrationInput({
    mode: 'CARELESS_TRAINING', carelessTrainingType: 'CALCULATION', outputSchemaVersion: 'calculation-careless.v2',
    summary: { totalCount: 1, correctCount: 0, wrongCount: 1, carelessCount: 0 },
    questions: [{ sourceKey: 'method-issue', questionNumber: 5, calculationStatus: 'WRONG', carelessDetected: false, issueCategory: 'knowledge_or_method', methodIssues: ['乘法公式使用错误'] }]
  });

  assert.match(carelessInput.expectedEncouragement, /漏写进位/);
  assert.match(methodInput.expectedEncouragement, /乘法公式使用错误/);
  assert.notEqual(carelessInput.expectedEncouragement, methodInput.expectedEncouragement);
  for (const input of [carelessInput, methodInput]) {
    assert.equal(/三格|条件|关系|所求|先审题再计算/.test(input.expectedEncouragement), false);
    assert.equal(fallbackNarration(input).endsWith(input.expectedEncouragement), true);
  }
});

function loadTtsWorker(mocks) {
  const indexPath = require.resolve('../index');
  const originalIndex = require.cache[indexPath];
  const originals = new Map();
  for (const [request, value] of Object.entries(mocks)) {
    const resolved = require.resolve(request);
    originals.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: value };
  }
  delete require.cache[indexPath];
  try {
    return require('../index');
  } finally {
    delete require.cache[indexPath];
    if (originalIndex) require.cache[indexPath] = originalIndex;
    for (const [resolved, original] of originals) {
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    }
  }
}

function narrationResult() {
  return {
    _id: 'result-1', taskId: 'task-1', studentId: 'student-1', resultVersion: 1,
    audioNarration: { status: 'PENDING' },
    summary: { totalCount: 2, correctCount: 1, wrongCount: 1, incompleteCount: 0, carelessCount: 0 },
    questions: [
      { sourceKey: 'source-b', printedQuestionNumber: 4, evaluationStatus: 'WRONG', answerStatus: 'answered', isCorrect: false, finalAnswerCorrect: false, stepRequired: true, stepStatus: 'wrong', logicStatus: 'wrong', firstWrongStep: ['列式错误'], errorReason: '列式错误', adjustmentSuggestion: '检查列式' },
      { sourceKey: 'source-a', questionNumber: 2, evaluationStatus: 'CORRECT', answerStatus: 'answered', isCorrect: true, finalAnswerCorrect: true, stepRequired: false, stepStatus: 'not_required', logicStatus: 'correct', firstWrongStep: [], errorReason: '', adjustmentSuggestion: '' }
    ]
  };
}

function createWorkerHarness(createNarrationResponse, taskOverrides = {}, resultOverrides = {}) {
  const result = { ...narrationResult(), ...resultOverrides };
  const task = { mode: 'HARD_PROBLEM_CHECK', status: 'COMPLETED', resultId: result._id, ...taskOverrides };
  const resultUpdates = [], taskUpdates = [], generatedInputs = [], synthesizeCalls = [], auditEvents = [], generatedFiles = [], uploads = [];
  const collection = (name) => ({ doc: (id) => ({
    get: async () => ({ data: name === 'results' ? result : task }),
    update: async ({ data }) => (name === 'results' ? resultUpdates : taskUpdates).push({ id, data })
  }) });
  const worker = loadTtsWorker({
    '../shared/context': { db: { collection, runTransaction: async (callback) => callback({ collection }) }, cloud: { uploadFile: async (input) => { uploads.push(input); return { fileID: 'cloud://audio.mp3' }; } } },
    '../shared/constants': { C: { results: 'results', tasks: 'tasks' } },
    '../shared/audit': { monitor: (...args) => auditEvents.push(args) },
    '../shared/utils': { now: () => new Date('2026-07-28T00:00:00.000Z'), randomId: () => 'tts-request' },
    '../shared/tts': { synthesizeSpeech: async (request) => { synthesizeCalls.push(request); return { audio: Buffer.from('audio'), mimeType: 'audio/mpeg' }; } },
    '../shared/ark': { generateNarration: async (input) => { generatedInputs.push(input); return createNarrationResponse(input); } },
    '../shared/result-semantics': { ttsText: () => 'legacy narration must not be used' },
    '../shared/generated-files': { recordGeneratedFile: async (input) => generatedFiles.push(input) }
  });
  return { worker, result, task, resultUpdates, taskUpdates, generatedInputs, synthesizeCalls, auditEvents, generatedFiles, uploads };
}

function finalAudioUpdate(harness) {
  return harness.resultUpdates.map((update) => update.data.audioNarration).filter(Boolean).at(-1);
}

function assertNarrationFallback(harness, originalErrorCode) {
  const narrationUpdate = harness.resultUpdates.find((update) => update.data.narrationSource === 'deterministic_fallback');
  assert.ok(narrationUpdate);
  assert.equal(harness.synthesizeCalls.length, 1);
  assert.equal(finalAudioUpdate(harness).status, 'READY');
  assert.deepEqual(harness.auditEvents.find((event) => event[1] === 'NARRATION_FALLBACK_USED')?.[2], {
    resultId: 'result-1', mode: 'HARD_PROBLEM_CHECK', questionCount: 2, originalErrorCode, narrationVersion: NARRATION_VERSION
  });
}

test('tts worker uses the real narration input and marks audio READY after a valid structured narration', async () => {
  const harness = createWorkerHarness((input) => ({
    summaryText: input.expectedSummaryText,
    items: input.questions.map((question) => ({ sourceKey: question.sourceKey, text: question.state === 'FULLY_CORRECT' ? `第${question.questionNumber}题回答正确。` : `第${question.questionNumber}题回答错误。错误步骤包括：${question.firstWrongStep.join('、')}。原因是${question.errorReason}。建议${question.adjustmentSuggestion}。` })),
    endingText: input.expectedEncouragement
  }));

  const outcome = await harness.worker.processOne('result-1');

  assert.equal(outcome.processed, true);
  assert.equal(harness.generatedInputs.length, 1);
  assert.deepEqual(harness.generatedInputs[0].questions.map((question) => question.sourceKey), ['source-b', 'source-a']);
  assert.equal(harness.synthesizeCalls.length, 1);
  assert.equal(harness.synthesizeCalls[0].text, [harness.generatedInputs[0].expectedSummaryText, '第4题回答错误。错误步骤包括：列式错误。原因是列式错误。建议检查列式。', '第2题回答正确。', harness.generatedInputs[0].expectedEncouragement].filter(Boolean).join(''));
  assert.equal(finalAudioUpdate(harness).status, 'READY');
  assert.equal(harness.generatedFiles[0].dataSpace, 'production');
  assert.match(harness.uploads[0].cloudPath, /^production\/tts\/results\/result-1\/.+\.mp3$/);
});

test('developer_test TTS records the verified task data space on generated files', async () => {
  const harness = createWorkerHarness((input) => ({
    summaryText: input.expectedSummaryText,
    items: input.questions.map((question) => ({ sourceKey: question.sourceKey, text: '语音讲解' })),
    endingText: input.expectedEncouragement
  }), { dataSpace: 'developer_test' }, { dataSpace: 'developer_test' });

  await harness.worker.processOne('result-1');

  assert.equal(harness.generatedFiles[0].dataSpace, 'developer_test');
  assert.match(harness.uploads[0].cloudPath, /^developer-test\/tts\/results\/result-1\/.+\.mp3$/);
});

test('TTS rejects a result whose data space differs from its completed task', async () => {
  const harness = createWorkerHarness(() => { throw new Error('must not generate'); }, { dataSpace: 'developer_test' }, { dataSpace: 'production' });

  const outcome = await harness.worker.processOne('result-1');

  assert.equal(outcome.failed, true);
  assert.equal(finalAudioUpdate(harness).errorCode, 'TTS_TASK_STATE_INVALID');
  assert.equal(harness.generatedFiles.length, 0);
});

test('tts worker blocks narration when the task status is not COMPLETED', async () => {
  const harness = createWorkerHarness(() => { throw new Error('generateNarration must not be called'); }, { status: 'FAILED' });

  const outcome = await harness.worker.processOne('result-1');

  assert.equal(outcome.failed, true);
  assert.equal(harness.generatedInputs.length, 0);
  assert.equal(harness.synthesizeCalls.length, 0);
  assert.equal(finalAudioUpdate(harness).status, 'FAILED');
  assert.equal(finalAudioUpdate(harness).errorCode, 'TTS_TASK_STATE_INVALID');
  assert.equal(harness.task.status, 'FAILED');
  assert.equal(harness.task.resultId, 'result-1');
});

test('tts worker blocks narration when the task resultId differs from the current result', async () => {
  const harness = createWorkerHarness(() => { throw new Error('generateNarration must not be called'); }, { resultId: 'different-result' });

  const outcome = await harness.worker.processOne('result-1');

  assert.equal(outcome.failed, true);
  assert.equal(harness.generatedInputs.length, 0);
  assert.equal(harness.synthesizeCalls.length, 0);
  assert.equal(finalAudioUpdate(harness).status, 'FAILED');
  assert.equal(finalAudioUpdate(harness).errorCode, 'TTS_TASK_STATE_INVALID');
  assert.equal(harness.task.status, 'COMPLETED');
  assert.equal(harness.task.resultId, 'different-result');
});

test('tts worker uses deterministic fallback and synthesizes when item sourceKey or count differs', async () => {
  const harness = createWorkerHarness((input) => ({
    summaryText: input.expectedSummaryText,
    items: [{ sourceKey: 'wrong-source-key', text: '错误顺序' }],
    endingText: input.expectedEncouragement
  }));
  const originalQuestions = structuredClone(harness.result.questions);
  const originalSummary = structuredClone(harness.result.summary);

  const outcome = await harness.worker.processOne('result-1');

  assert.equal(outcome.processed, true);
  assertNarrationFallback(harness, 'NARRATION_CONTRACT_ERROR');
  assert.deepEqual(harness.result.questions, originalQuestions);
  assert.deepEqual(harness.result.summary, originalSummary);
  assert.equal(harness.taskUpdates.some((update) => Object.hasOwn(update.data, 'status')), false);
});

test('tts worker uses deterministic fallback and synthesizes when summary or ending text changes', async () => {
  for (const changedField of ['summaryText', 'endingText']) {
    const harness = createWorkerHarness((input) => ({
      summaryText: changedField === 'summaryText' ? `${input.expectedSummaryText}改写` : input.expectedSummaryText,
      items: input.questions.map((question) => ({ sourceKey: question.sourceKey, text: question.state === 'FULLY_CORRECT' ? `第${question.questionNumber}题回答正确。` : `第${question.questionNumber}题回答错误。` })),
      endingText: changedField === 'endingText' ? `${input.expectedEncouragement}改写` : input.expectedEncouragement
    }));

    const outcome = await harness.worker.processOne('result-1');

    assert.equal(outcome.processed, true, changedField);
    assertNarrationFallback(harness, 'NARRATION_CONTRACT_ERROR');
  }
});

function createHttpsMock(plan) {
  const calls = [];
  return {
    calls,
    request(options, onResponse) {
      const request = new EventEmitter();
      let body = '';
      let timeoutHandler = null;
      let destroyed = false;
      request.write = (chunk) => { body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk); };
      request.setTimeout = (_timeoutMs, handler) => { timeoutHandler = handler; };
      request.destroy = (error) => { destroyed = true; process.nextTick(() => request.emit('error', error)); };
      request.end = () => {
        const call = { options, body, get destroyed() { return destroyed; }, triggerTimeout: () => timeoutHandler?.() };
        calls.push(call);
        plan(call, {
          respond(statusCode, payload, headers = {}) {
            const response = new EventEmitter();
            response.statusCode = statusCode;
            response.headers = headers;
            process.nextTick(() => {
              onResponse(response);
              response.emit('data', Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)));
              response.emit('end');
            });
          },
          fail(error) { process.nextTick(() => request.emit('error', error)); }
        });
      };
      return request;
    }
  };
}

function loadArkWithMockedHttps(https) {
  const arkPath = require.resolve('../shared/ark');
  const mocks = {
    '../shared/context': { db: { collection: () => ({ add: async () => ({}) }) } },
    '../shared/constants': { C: { ai: 'ai' } },
    '../shared/audit': { monitor() {} },
    '../shared/utils': { randomId: () => 'ark-test', now: () => new Date('2026-07-29T00:00:00.000Z'), safeError: () => ({}) },
    '../shared/strategy/remote': {
      loadRuntimeStrategy: async () => ({
        prompts: { narration: { system: 'test narration system', userTemplate: '{{NARRATION_INPUT_JSON}}' } },
        models: { narration: { temperature: 0, maxOutputTokens: 128, timeoutMs: 20 } }
      })
    }
  };
  const originals = new Map();
  for (const [request, value] of Object.entries(mocks)) {
    const resolved = require.resolve(request);
    originals.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: value };
  }
  const originalArk = require.cache[arkPath];
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'node:https') return https;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[arkPath];
  try {
    return require('../shared/ark');
  } finally {
    Module._load = originalLoad;
    if (originalArk) require.cache[arkPath] = originalArk;
    else delete require.cache[arkPath];
    for (const [resolved, original] of originals) {
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    }
  }
}

function narrationTransportInputs() {
  return [
    buildNarrationInput({
      mode: 'HARD_PROBLEM_CHECK', summary: { totalCount: 1, correctCount: 0, wrongCount: 1, incompleteCount: 0 },
      questions: [{ sourceKey: 'hard', evaluationStatus: 'WRONG', answerStatus: 'answered', finalAnswerCorrect: false, stepRequired: true, stepStatus: 'wrong', logicStatus: 'wrong' }]
    }),
    buildNarrationInput({
      mode: 'CARELESS_TRAINING', outputSchemaVersion: 'reading-careless.v2', summary: { totalCount: 1, correctCount: 0, wrongCount: 0, incompleteCount: 1 },
      questions: [{ sourceKey: 'reading', analysisStatus: 'ok', threeGridStatus: 'INCOMPLETE', conditionCorrect: false, relationCorrect: false, askCorrect: false, referenceConditionText: '条件', referenceRelationText: '关系', referenceAskText: '所求' }]
    }),
    buildNarrationInput({
      mode: 'CARELESS_TRAINING', carelessTrainingType: 'CALCULATION', outputSchemaVersion: 'calculation-careless.v2', summary: { totalCount: 1, correctCount: 0, wrongCount: 1, incompleteCount: 0, carelessCount: 1 },
      questions: [{ sourceKey: 'calculation', analysisStatus: 'ok', calculationStatus: 'WRONG', processCorrect: false, finalAnswerCorrect: false, carelessDetected: true }]
    })
  ];
}

async function withArkEnvironment(callback) {
  const saved = {
    ARK_BASE_URL: process.env.ARK_BASE_URL,
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_MINI_ENDPOINT: process.env.ARK_MINI_ENDPOINT,
    ARK_NARRATION_TIMEOUT_MS: process.env.ARK_NARRATION_TIMEOUT_MS,
    fetch: global.fetch
  };
  process.env.ARK_BASE_URL = 'https://ark.test/api/v3';
  process.env.ARK_API_KEY = 'ark-test-key';
  process.env.ARK_MINI_ENDPOINT = 'ark-mini-test';
  process.env.ARK_NARRATION_TIMEOUT_MS = '20';
  global.fetch = undefined;
  try {
    await callback();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (key === 'fetch') continue;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    global.fetch = saved.fetch;
  }
}

test('generateNarration sends every narration mode through HTTPS when global fetch is unavailable', async () => {
  const https = createHttpsMock((_call, response) => response.respond(200, { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], id: 'ark-response-id' }, { 'x-request-id': 'request-1' }));
  const ark = loadArkWithMockedHttps(https);

  await withArkEnvironment(async () => {
    for (const input of narrationTransportInputs()) {
      assert.deepEqual(await ark.generateNarration(input, 'task-1'), {});
    }
  });

  assert.equal(https.calls.length, 3);
  for (const call of https.calls) {
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.hostname, 'ark.test');
    assert.equal(call.options.path, '/api/v3/chat/completions');
    assert.equal(call.options.headers.Authorization, 'Bearer ark-test-key');
    assert.equal(call.options.headers['Content-Type'], 'application/json');
    assert.equal(Number(call.options.headers['Content-Length']), Buffer.byteLength(call.body));
  }
});

test('tts worker marks audio narration FAILED after a non-2xx Ark narration response', async () => {
  const https = createHttpsMock((_call, response) => response.respond(503, { error: { message: 'service unavailable', code: 'InternalServiceError' } }, { 'x-request-id': 'request-503' }));
  const ark = loadArkWithMockedHttps(https);
  const harness = createWorkerHarness((input) => ark.generateNarration(input, 'task-1'));

  await withArkEnvironment(async () => {
    const outcome = await harness.worker.processOne('result-1');
    assert.equal(outcome.failed, true);
  });

  assert.equal(harness.synthesizeCalls.length, 0);
  assert.equal(finalAudioUpdate(harness).status, 'FAILED');
  assert.equal(finalAudioUpdate(harness).errorCode, 'InternalServiceError');
});

test('tts worker uses deterministic fallback after an Ark network error', async () => {
  const https = createHttpsMock((_call, response) => response.fail(Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })));
  const ark = loadArkWithMockedHttps(https);
  const harness = createWorkerHarness((input) => ark.generateNarration(input, 'task-1'));

  await withArkEnvironment(async () => {
    const outcome = await harness.worker.processOne('result-1');
    assert.equal(outcome.processed, true);
  });

  assertNarrationFallback(harness, 'ARK_REQUEST_FAILED');
});

test('generateNarration returns explicit safe failures for network errors and request timeouts', async () => {
  const networkHttps = createHttpsMock((_call, response) => response.fail(Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })));
  const networkArk = loadArkWithMockedHttps(networkHttps);
  const timeoutHttps = createHttpsMock((call) => call.triggerTimeout());
  const timeoutArk = loadArkWithMockedHttps(timeoutHttps);
  const input = narrationTransportInputs()[0];

  await withArkEnvironment(async () => {
    await assert.rejects(() => networkArk.generateNarration(input, 'task-network'), (error) => error.code === 'ARK_REQUEST_FAILED' && !/ark-test-key/.test(error.message));
    await assert.rejects(() => timeoutArk.generateNarration(input, 'task-timeout'), (error) => error.code === 'ARK_TIMEOUT' && !/ark-test-key/.test(error.message));
  });
  assert.equal(timeoutHttps.calls[0].destroyed, true);
});

test('hard-problem TTS narrates only problematic paired steps and omits correct-step/full-overall repetition', () => {
  const input = buildNarrationInput({
    mode: 'HARD_PROBLEM_CHECK', outputSchemaVersion: 'hard-problem.v2', summary: { totalCount: 1, correctCount: 0, wrongCount: 1, incompleteCount: 0 },
    questions: [{
      sourceKey: 'hard-step-tts', questionNumber: 1, evaluationStatus: 'WRONG', finalAnswerCorrect: true, stepRequired: true, stepStatus: 'wrong', logicStatus: 'insufficient',
      stepFeedbacks: [
        { stepIndex: 1, solutionText: '25加13等于38台', explanationText: '因为洗衣机比冰箱多13台', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '过程和解释对应正确', correctionAdvice: '' },
        { stepIndex: 2, solutionText: '38乘2等于76台', explanationText: '求空调数量', solutionStatus: 'correct', explanationStatus: 'partially_clear', logicStatus: 'insufficient', analysis: '没有说明使用乘法的原因', correctionAdvice: '补充空调数量是洗衣机的2倍' }
      ],
      overallFeedback: '最终答案正确，第二步讲解需要补充数量关系。'
    }]
  });
  const narration = fallbackNarration(input);
  assert.doesNotMatch(narration, /25加13等于38台|因为洗衣机比冰箱多13台/);
  assert.doesNotMatch(narration, /第1步/);
  assert.match(narration, /第2步讲解不完整，逻辑不充分。/);
  assert.match(narration, /讲解不完整，逻辑不充分/);
  assert.match(narration, /改进建议：补充空调数量是洗衣机的2倍。/);
  assert.doesNotMatch(narration, /整体反馈|最终答案正确，第二步/);
});


test('hard-problem TTS distinguishes missing content from unreadable content', () => {
  const input = buildNarrationInput({
    mode: 'HARD_PROBLEM_CHECK', outputSchemaVersion: 'hard-problem.v2', summary: { totalCount: 1, correctCount: 0, wrongCount: 1, incompleteCount: 0 },
    questions: [{
      sourceKey: 'hard-step-readable-state', questionNumber: 1, evaluationStatus: 'WRONG', finalAnswerCorrect: false, stepRequired: true, stepStatus: 'unreadable', logicStatus: 'unreadable',
      stepFeedbacks: [
        { stepIndex: 1, solutionText: '', explanationText: '', solutionStatus: 'unreadable', explanationStatus: 'unreadable', logicStatus: 'unreadable', analysis: '图片中的第一步无法可靠辨认。', correctionAdvice: '重新上传清晰图片。' },
        { stepIndex: 2, solutionText: '', explanationText: '', solutionStatus: 'missing', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '学生没有写第二步。', correctionAdvice: '补写第二步和对应讲解。' }
      ],
      overallFeedback: '第一步无法识别，第二步缺失。'
    }]
  });
  const narration = fallbackNarration(input);
  assert.match(narration, /第1步解题过程无法识别，讲解无法识别，逻辑无法识别。/);
  assert.match(narration, /第2步没有写出解题过程，没有写对应讲解，逻辑不充分。/);
});

test('hard-problem narration honors explicit teacher override before AI step states', () => {
  const input = buildNarrationInput({
    mode: 'HARD_PROBLEM_CHECK',
    summary: { totalCount: 1, correctCount: 1, wrongCount: 0, incompleteCount: 0 },
    questions: [{
      sourceKey: 'teacher-override', questionNumber: 1, evaluationStatus: 'WRONG', normalizedStatus: 'CORRECT',
      teacherOverrideApplied: true, teacherOverrideStatus: 'CORRECT', finalAnswerCorrect: true, stepRequired: true,
      stepStatus: 'wrong', logicStatus: 'insufficient', errorType: 'logic_error',
      stepFeedbacks: [{ stepIndex: 1, solutionText: '旧AI判断', explanationText: '', solutionStatus: 'wrong', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '旧AI判断', correctionAdvice: '旧建议' }],
    }],
  });
  const narration = fallbackNarration(input);
  assert.match(narration, /第1题回答正确。/);
  assert.doesNotMatch(narration, /旧AI判断|旧建议/);
});

test('calculation teacher WRONG override remains authoritative even when stale AI calculation fields still say correct', () => {
  const input = buildNarrationInput({
    mode: 'CARELESS_TRAINING', carelessTrainingType: 'CALCULATION', outputSchemaVersion: 'calculation-careless.v2', summary: {},
    questions: [{
      sourceKey:'teacher-calc-wrong', questionNumber:7, teacherOverrideApplied:true, teacherOverrideStatus:'WRONG', normalizedStatus:'WRONG',
      analysisStatus:'ok', calculationStatus:'CORRECT', processCorrect:true, finalAnswerCorrect:true, carelessDetected:false, issueCategory:'none'
    }]
  });
  const narration = fallbackNarration(input);
  assert.match(narration, /第7题经教师复核需要订正。/);
  assert.doesNotMatch(narration, /第7题计算正确。/);
});

test('calculation teacher CORRECT override remains authoritative even when stale AI calculation fields still say wrong', () => {
  const input = buildNarrationInput({
    mode: 'CARELESS_TRAINING', carelessTrainingType: 'CALCULATION', outputSchemaVersion: 'calculation-careless.v2', summary: {},
    questions: [{
      sourceKey:'teacher-calc-correct', questionNumber:8, teacherOverrideApplied:true, teacherOverrideStatus:'CORRECT', normalizedStatus:'CORRECT',
      analysisStatus:'ok', calculationStatus:'WRONG', processCorrect:false, finalAnswerCorrect:false, carelessDetected:true, issueCategory:'careless', carelessIssues:['旧AI判断']
    }]
  });
  const narration = fallbackNarration(input);
  assert.match(narration, /第8题计算正确。/);
  const itemAndEnding = narration.slice(input.expectedSummaryText.length);
  assert.doesNotMatch(itemAndEnding, /存在马虎|回答错误|需要订正/);
  assert.equal(input.summary.correctCount, 1);
  assert.equal(input.summary.carelessCount, 0);
  assert.equal(input.summary.wrongCount, 0);
});
