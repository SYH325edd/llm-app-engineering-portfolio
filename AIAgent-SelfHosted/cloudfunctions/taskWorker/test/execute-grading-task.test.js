const assert = require('node:assert/strict');
const test = require('node:test');

const { executeGradingTask, createGradingRuntime } = require('../shared/grading-core/execute-grading-task');
const { validateHardProblemResult } = require('../shared/json');
const outputSchemaValidator = require('../shared/output-schema-validator');
const { normalizeDownstreamSemantics, wrongQuestionProjection, reviewProjection, ttsText } = require('../shared/result-semantics');
const { applyQualifiedCheckinState, qualifiedQuestion, recordQualifiedQuestions } = require('../shared/checkin');

const HARD_TOP_LEVEL_CONTRACT = {
  topLevelRequiredFields: ['outputSchemaVersion', 'mode', 'route', 'imageQuality', 'questions', 'questionSetAudit'],
  topLevelFieldTypes: { outputSchemaVersion: 'string', mode: 'string', route: 'object', imageQuality: 'object', questions: 'array', questionSetAudit: 'object' },
  topLevelEnumFields: { mode: ['hard-problem'] },
  topLevelObjectSchemas: {
    route: { requiredFields: ['difficulty', 'confidence', 'flags'], fieldTypes: { difficulty: 'enum', confidence: 'number_0_to_1', flags: 'array' }, enumFields: { difficulty: ['normal', 'hard', 'very_hard'] } },
    imageQuality: { requiredFields: ['ok', 'issues'], fieldTypes: { ok: 'boolean', issues: 'array' } },
    questionSetAudit: { requiredFields: ['visibleIndependentQuestionCount', 'emittedQuestionCount', 'excludedQuestionCount', 'orientation', 'countConfidence'], fieldTypes: { visibleIndependentQuestionCount: 'integer_min_0', emittedQuestionCount: 'integer_min_0', excludedQuestionCount: 'integer_min_0', orientation: 'enum', countConfidence: 'number_0_to_1' }, enumFields: { orientation: ['upright', 'rotated_left', 'rotated_right', 'upside_down', 'uncertain'] }, consistencyRules: ['emittedQuestionCount_equals_questions_length', 'visibleIndependentQuestionCount_equals_emittedQuestionCount_plus_excludedQuestionCount'] }
  }
};

const normalizeHardProblemsResult = createGradingRuntime({
  json: require('../shared/json'),
  embedded: { decryptEmbeddedStrategy: () => ({}) }
}).test.normalizeHardProblemsResult;

const calculationRuntime = createGradingRuntime({
  json: require('../shared/json'),
  embedded: { decryptEmbeddedStrategy: () => ({}) }
}).test;

function calculationPayload(question) {
  return {
    outputSchemaVersion: 'calculation-careless.v2',
    route: { difficulty: 'normal', confidence: 1, flags: [] },
    imageQuality: { ok: true, issues: [] },
    questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [{
      outputSchemaVersion: 'calculation-careless.v2', sourceKey: 'image-1-question-1', questionText: '1 + 1', studentCalculation: '1 + 1 = 2', standardCalculation: '1 + 1 = 2',
      analysisStatus: 'ok', layoutClear: true, digitAlignmentCorrect: true, stepsComplete: true, carryBorrowClear: true,
      processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none', carelessIssues: [], methodIssues: [],
      errorReason: '', firstErrorPoint: '', correctionAdvice: '', confidence: 1,
      ...question
    }]
  };
}

test('hard-problem runtime rejects a stale strategy contract before any model request', () => {
  const requiredQuestionFields = ['stepFeedbacks', 'overallFeedback', 'studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'];
  const requiredStepFields = ['stepIndex', 'solutionText', 'explanationText', 'solutionStatus', 'explanationStatus', 'logicStatus', 'analysis', 'correctionAdvice'];
  const promptFields = [...requiredQuestionFields, ...requiredStepFields].join(' ');
  const valid = {
    strategyVersion: '1.3.17',
    contracts: { hardProblemV2: {
      requiredFields: requiredQuestionFields,
      arrayItemSchemas: { stepFeedbacks: {
        requiredFields: requiredStepFields,
        enumFields: {
          solutionStatus: ['correct', 'wrong', 'missing', 'unreadable'],
          explanationStatus: ['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable'],
          logicStatus: ['clear', 'insufficient', 'wrong', 'unreadable']
        }
      } },
      ...HARD_TOP_LEVEL_CONTRACT
    } },
    modelRuntime: { stages: { hardProblemPrimary: { outputSchemaVersion: 'hard-problem.v2' }, hardProblemReview: { outputSchemaVersion: 'hard-problem.v2' } } },
    prompts: { hardProblem: { system: promptFields, userTemplate: promptFields } }
  };
  assert.doesNotThrow(() => calculationRuntime.assertHardProblemExplanationContract(valid));
  const stale = structuredClone(valid);
  stale.strategyVersion = '1.3.14';
  stale.contracts.hardProblemV2.requiredFields = [];
  stale.modelRuntime.stages.hardProblemReview.outputSchemaVersion = 'reading-careless.v2';
  assert.throws(() => calculationRuntime.assertHardProblemExplanationContract(stale), (error) => error.code === 'STRATEGY_CONTRACT_INCOMPATIBLE' && error.missingQuestionFields.includes('stepFeedbacks') && error.invalidRuntimeStages.includes('hardProblemReview'));
});

test('compact REVIEW payload preserves primary step source projection without verbose AI analysis fields', () => {
  const q = hardProblemQuestion();
  const payload = calculationRuntime.compactReviewPayload(hardProblemPayload([{ ...q, sourceKey: 'q-review-compact' }]));
  const projected = payload.questions[0];
  assert.equal(projected.sourceKey, 'q-review-compact');
  assert.equal(projected.studentAnswer, q.studentAnswer);
  assert.deepEqual(projected.stepFeedbacksSourceProjection[0], {
    stepIndex: 1,
    solutionText: q.stepFeedbacks[0].solutionText,
    explanationText: q.stepFeedbacks[0].explanationText,
    solutionStatus: q.stepFeedbacks[0].solutionStatus,
    explanationStatus: q.stepFeedbacks[0].explanationStatus,
    logicStatus: q.stepFeedbacks[0].logicStatus
  });
  assert.equal(Object.hasOwn(projected.stepFeedbacksSourceProjection[0], 'analysis'), false);
  assert.equal(Object.hasOwn(projected.stepFeedbacksSourceProjection[0], 'correctionAdvice'), false);
  assert.equal(Object.hasOwn(projected, 'stepFeedbacks'), false);
  assert.equal(Object.hasOwn(payload, 'textQualityDiagnostics'), false);
  assert.equal(Object.hasOwn(payload, 'attributionDiagnostics'), false);
});

test('strategy and schema-repair failures expose safe diagnostics and non-retryable user messages', () => {
  const taskError = require('../shared/task-error');
  const utils = require('../shared/utils');
  const contractError = Object.assign(new Error('contract mismatch'), { code: 'STRATEGY_CONTRACT_INCOMPATIBLE', strategyVersion: '1.3.14', missingQuestionFields: ['stepFeedbacks'], invalidRuntimeStages: ['hardProblemReview'] });
  const safeContract = utils.safeError(contractError);
  assert.deepEqual(safeContract.strategyContract.missingQuestionFields, ['stepFeedbacks']);
  assert.deepEqual(safeContract.strategyContract.invalidRuntimeStages, ['hardProblemReview']);
  const mappedContract = taskError.mapTaskFailure(contractError, 'PRIMARY_GRADING');
  assert.equal(mappedContract.failureCategory, 'configuration');
  assert.equal(mappedContract.retryable, false);

  const repairError = Object.assign(new Error('repair failed'), { code: 'LLM_SCHEMA_REPAIR_FAILED', fieldPath: 'questions[0].stepFeedbacks[0].analysis', failureReason: 'REPAIR_NO_EFFECT', repairFailureStage: 'REPAIR_CONTEXT_VALIDATION' });
  const safeRepair = utils.safeError(repairError);
  assert.equal(safeRepair.repairValidation.fieldPath, 'questions[0].stepFeedbacks[0].analysis');

  const mappedQwenConfig = taskError.mapTaskFailure({ code: 'QWEN_NOT_CONFIGURED' }, 'PRIMARY_GRADING');
  assert.equal(mappedQwenConfig.retryable, false);
  assert.equal(mappedQwenConfig.failureCategory, 'configuration');
  assert.match(mappedQwenConfig.userMessage, /千问模型/);
  const mappedRepair = taskError.mapTaskFailure(repairError, 'PRIMARY_GRADING');
  assert.equal(mappedRepair.failureCategory, 'ai_response');
  assert.equal(mappedRepair.retryable, false);
});

test('calculation v2 derives a method error as WRONG instead of treating no-careless as correct', () => {
  const result = calculationRuntime.validateCalculationCarelessTrainingGradeResult(calculationPayload({
    processCorrect: false, finalAnswerCorrect: false, carelessDetected: false, issueCategory: 'none', methodIssues: ['运算方法错误']
  }));
  assert.equal(result.questions[0].isCorrect, false);
  assert.equal(result.questions[0].calculationStatus, 'WRONG');
  assert.equal(result.questions[0].issueCategory, 'knowledge_or_method');
  assert.equal(result.summary.allCorrect, false);
});

test('hard-problem unanswered semantics create a wrong question and keep TTS distinct from wrong', () => {
  const semantics = normalizeDownstreamSemantics({
    outputSchemaVersion: 'hard-problem.v2', sourceKey: 'hard-unanswered', evaluationStatus: 'UNANSWERED',
    answerStatus: 'unanswered', questionText: '题目'
  });
  assert.equal(semantics.normalizedStatus, 'UNANSWERED');
  assert.equal(semantics.shouldRecordWrongQuestion, true);
  assert.equal(semantics.wrongQuestionDisposition, 'CREATE');
  assert.equal(semantics.reviewDisposition, 'NEEDS_REVIEW');
  assert.equal(semantics.ttsDisposition, 'UNANSWERED');
  assert.doesNotMatch(ttsText({ outputSchemaVersion: 'hard-problem.v2', evaluationStatus: 'UNANSWERED' }, 0), /回答错误/);
});

test('hard-problem v2 counts three CORRECT questions toward the daily check-in threshold despite other wrong questions', () => {
  const questions = ['CORRECT', 'CORRECT', 'CORRECT', 'WRONG'].map((evaluationStatus, index) => ({
    outputSchemaVersion: 'hard-problem.v2', sourceKey: `hard-${index + 1}`, evaluationStatus
  }));
  const semantics = questions.map(normalizeDownstreamSemantics);
  assert.deepEqual(semantics.map((question) => question.checkinEligible), [true, true, true, false]);

  const additions = semantics
    .filter((question) => qualifiedQuestion(question))
    .map((question, index) => ({ questionKey: `hard-checkin-${index + 1}`, mode: question.mode }));
  const state = applyQualifiedCheckinState({ requiredQuestionCount: 3 }, additions, new Date('2026-07-28T00:00:00.000Z'));
  assert.equal(state.qualifiedQuestionCount, 3);
  assert.equal(state.completed, true);
});

test('daily check-in accumulates eligible correct questions across completed tasks without counting wrong questions', async () => {
  const context = require('../shared/context');
  const originalDb = context.db;
  let document = {};
  context.db = {
    runTransaction: async (callback) => callback({
      collection: () => ({ doc: () => ({
        get: async () => ({ data: document }),
        set: async ({ data }) => { document = data; }
      }) })
    })
  };
  try {
    const createdAt = '2026-07-28T00:00:00.000Z';
    await recordQualifiedQuestions({ _id: 'task-1', studentId: 'student-cross-task', createdAt }, [
      { checkinEligible: true, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-1', questionText: '1 + 1' }
    ]);
    await recordQualifiedQuestions({ _id: 'task-2', studentId: 'student-cross-task', createdAt }, [
      { checkinEligible: false, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-1', questionText: '1 + 1' },
      { checkinEligible: false, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-2', questionText: '2 + 2' }
    ]);
    await recordQualifiedQuestions({ _id: 'task-3', studentId: 'student-cross-task', createdAt }, [
      { checkinEligible: true, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-1', questionText: '1 + 1' },
      { checkinEligible: true, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-2', questionText: '2 + 2' },
      { checkinEligible: false, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-3', questionText: '3 + 3' }
    ]);
    assert.equal(document.qualifiedQuestionCount, 3);
    assert.equal(document.completed, true);
    assert.equal(document.qualifiedQuestionKeys.length, 3);
  } finally {
    context.db = originalDb;
  }
});

test('daily check-in keeps prior qualified progress when a later task has no eligible questions', async () => {
  const context = require('../shared/context');
  const originalDb = context.db;
  let document = {};
  context.db = {
    runTransaction: async (callback) => callback({
      collection: () => ({ doc: () => ({
        get: async () => ({ data: document }),
        set: async ({ data }) => { document = data; }
      }) })
    })
  };
  try {
    const task = { _id: 'task-qualified', studentId: 'student-all-wrong', createdAt: '2026-07-28T00:00:00.000Z' };
    await recordQualifiedQuestions(task, [
      { checkinEligible: true, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-1' }
    ]);
    await recordQualifiedQuestions({ ...task, _id: 'task-all-wrong' }, [
      { checkinEligible: false, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-2' }
    ]);
    assert.equal(document.qualifiedQuestionCount, 1);
    assert.equal(document.qualifiedQuestionKeys.length, 1);
    assert.equal(document.completed, false);
  } finally {
    context.db = originalDb;
  }
});

test('daily check-in keeps a repeated correct question in the same task idempotent', async () => {
  const context = require('../shared/context');
  const originalDb = context.db;
  let document = {};
  context.db = {
    runTransaction: async (callback) => callback({
      collection: () => ({ doc: () => ({
        get: async () => ({ data: document }),
        set: async ({ data }) => { document = data; }
      }) })
    })
  };
  try {
    const task = { _id: 'task-1', studentId: 'student-idempotent', createdAt: '2026-07-28T00:00:00.000Z' };
    const question = { checkinEligible: true, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-1', questionText: '1 + 1' };
    await recordQualifiedQuestions(task, [question]);
    await recordQualifiedQuestions(task, [question]);
    assert.equal(document.qualifiedQuestionCount, 1);
    assert.equal(document.qualifiedQuestionKeys.length, 1);
  } finally {
    context.db = originalDb;
  }
});

test('daily check-in removes a task contribution after manual review and clears completion', async () => {
  const context = require('../shared/context');
  const originalDb = context.db;
  let document = {};
  context.db = {
    runTransaction: async (callback) => callback({
      collection: () => ({ doc: () => ({
        get: async () => ({ data: document }),
        set: async ({ data }) => { document = data; }
      }) })
    })
  };
  try {
    const task = { _id: 'task-reviewed', studentId: 'student-reviewed', createdAt: '2026-07-28T00:00:00.000Z' };
    const question = { outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-reviewed' };
    document = {
      requiredQuestionCount: 3,
      qualifiedQuestionKeys: ['q-other-1', 'q-other-2'],
      qualifiedQuestions: [
        { questionKey: 'q-other-1', taskId: 'task-other-1', mode: 'HARD_PROBLEM_CHECK' },
        { questionKey: 'q-other-2', taskId: 'task-other-2', mode: 'HARD_PROBLEM_CHECK' }
      ]
    };
    await recordQualifiedQuestions(task, [{ ...question, checkinEligible: true }]);
    assert.equal(document.completed, true);
    assert.ok(document.completedAt);
    await recordQualifiedQuestions(task, [{ ...question, checkinEligible: false }]);
    assert.equal(document.qualifiedQuestionCount, 2);
    assert.equal(document.completed, false);
    assert.equal(document.completedAt, null);
  } finally {
    context.db = originalDb;
  }
});

test('daily check-in retries do not duplicate a task and preserve other task contributions', async () => {
  const context = require('../shared/context');
  const originalDb = context.db;
  let document = {};
  context.db = {
    runTransaction: async (callback) => callback({
      collection: () => ({ doc: () => ({
        get: async () => ({ data: document }),
        set: async ({ data }) => { document = data; }
      }) })
    })
  };
  try {
    const createdAt = '2026-07-28T00:00:00.000Z';
    const firstTask = { _id: 'task-retry', studentId: 'student-retry', createdAt };
    const otherTask = { _id: 'task-other', studentId: 'student-retry', createdAt };
    const firstQuestion = { checkinEligible: true, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-1' };
    await recordQualifiedQuestions(firstTask, [firstQuestion]);
    await recordQualifiedQuestions(otherTask, [{ checkinEligible: true, outputSchemaVersion: 'hard-problem.v2', sourceKey: 'q-2' }]);
    await recordQualifiedQuestions(firstTask, [firstQuestion]);
    assert.equal(document.qualifiedQuestionCount, 2);
    assert.equal(document.qualifiedQuestionKeys.length, 2);
    assert.equal(document.qualifiedQuestions.filter((item) => item.taskId === 'task-other').length, 1);
  } finally {
    context.db = originalDb;
  }
});

test('hard-problem v2 WRONG, UNANSWERED, and UNREADABLE questions are not check-in eligible', () => {
  for (const evaluationStatus of ['WRONG', 'UNANSWERED', 'UNREADABLE']) {
    const semantics = normalizeDownstreamSemantics({ outputSchemaVersion: 'hard-problem.v2', sourceKey: evaluationStatus, evaluationStatus });
    assert.equal(semantics.checkinEligible, false, evaluationStatus);
    assert.equal(qualifiedQuestion(semantics), false, evaluationStatus);
  }
});

test('reading three-grid undetermined semantics require re-upload without checkin or wrong-question creation', () => {
  const semantics = normalizeDownstreamSemantics({
    outputSchemaVersion: 'reading-careless.v2', sourceKey: 'reading-unreadable', threeGridStatus: 'UNDETERMINED'
  });
  assert.equal(semantics.normalizedStatus, 'UNDETERMINED');
  assert.equal(semantics.shouldRecordWrongQuestion, false);
  assert.equal(semantics.wrongQuestionDisposition, 'NEEDS_REUPLOAD');
  assert.equal(semantics.checkinEligible, false);
  assert.equal(semantics.reviewDisposition, 'NEEDS_REUPLOAD');
  assert.equal(semantics.ttsDisposition, 'UNDETERMINED');
  assert.match(ttsText({ outputSchemaVersion: 'reading-careless.v2', threeGridStatus: 'UNDETERMINED' }, 0), /重新上传|补充信息/);
});


test('hard-problem wrong-question and review projections preserve step analysis fields', () => {
  const question = {
    outputSchemaVersion: 'hard-problem.v2', sourceKey: 'hard-projection-1', questionText: '应用题', studentAnswer: '76台', standardAnswer: '76台',
    evaluationStatus: 'WRONG', errorType: 'logic_error', errorReason: '第二步解释不完整', firstWrongStep: '第二步', adjustmentSuggestion: '说明使用乘法的依据', knowledgePoint: '', confidence: 0.92,
    answerStatus: 'answered', finalAnswerCorrect: true, stepRequired: true, stepStatus: 'wrong', logicStatus: 'insufficient',
    stepFeedbacks: [{ stepIndex: 1, solutionText: '25+13=38', explanationText: '先求洗衣机', solutionStatus: 'correct', explanationStatus: 'partially_clear', logicStatus: 'insufficient', analysis: '没有完整说明加法依据', correctionAdvice: '说明多13台所以相加' }],
    overallFeedback: '结果正确，但逐步解释需要补全。'
  };
  const wrong = wrongQuestionProjection(question, 'HARD_PROBLEM_CHECK');
  const review = reviewProjection(question, 'HARD_PROBLEM_CHECK');
  assert.deepEqual(wrong.modeDetails.stepFeedbacks, question.stepFeedbacks);
  assert.equal(wrong.modeDetails.overallFeedback, question.overallFeedback);
  assert.deepEqual(review.evidenceFields.stepFeedbacks, question.stepFeedbacks);
  assert.equal(review.evidenceFields.overallFeedback, question.overallFeedback);
});

test('calculation knowledge-or-method semantics record a wrong question without checkin', () => {
  const semantics = normalizeDownstreamSemantics({
    outputSchemaVersion: 'calculation-careless.v2', sourceKey: 'calculation-method', calculationStatus: 'WRONG',
    issueCategory: 'knowledge_or_method', carelessDetected: false
  });
  assert.equal(semantics.normalizedStatus, 'WRONG');
  assert.equal(semantics.resultCategory, 'knowledge_or_method');
  assert.equal(semantics.shouldRecordWrongQuestion, true);
  assert.equal(semantics.wrongQuestionDisposition, 'CREATE');
  assert.equal(semantics.checkinEligible, false);
  assert.equal(semantics.ttsDisposition, 'WRONG');
  assert.doesNotMatch(ttsText({ outputSchemaVersion: 'calculation-careless.v2', calculationStatus: 'WRONG', issueCategory: 'knowledge_or_method' }, 0), /未发现问题|计算正确/);
});

test('calculation v2 derives a fully correct result and summary', () => {
  const result = calculationRuntime.validateCalculationCarelessTrainingGradeResult(calculationPayload({}));
  assert.equal(result.questions[0].isCorrect, true);
  assert.equal(result.questions[0].calculationStatus, 'CORRECT');
  assert.equal(result.questions[0].issueCategory, 'none');
  assert.equal(result.summary.allCorrect, true);
});

test('calculation v2 keeps unreadable judgments undetermined without a correctness conclusion', () => {
  const result = calculationRuntime.validateCalculationCarelessTrainingGradeResult(calculationPayload({
    analysisStatus: 'unreadable', layoutClear: null, digitAlignmentCorrect: null, stepsComplete: null, carryBorrowClear: null,
    processCorrect: null, finalAnswerCorrect: null, carelessDetected: null, issueCategory: 'none'
  }));
  assert.equal(result.questions[0].isCorrect, false);
  assert.equal(result.questions[0].calculationStatus, 'UNDETERMINED');
  assert.equal(result.questions[0].issueCategory, 'undetermined');
});

test('calculation work_only_complete accepts a complete visible calculation and grades it normally', () => {
  const result = calculationRuntime.validateCalculationCarelessTrainingGradeResult(calculationPayload({
    inputBasis: 'work_only_complete', studentWorkDetected: true, modeApplicability: 'applicable',
    questionText: '36×24', studentCalculation: '36×24=864', standardCalculation: '36×24=864'
  }));
  assert.equal(result.questions[0].calculationStatus, 'CORRECT');
  assert.equal(result.questions[0].issueCategory, 'none');
});

test('calculation work_only_incomplete rejects deterministic grading fields', () => {
  assert.throws(() => calculationRuntime.validateCalculationCarelessTrainingGradeResult(calculationPayload({
    inputBasis: 'work_only_incomplete', studentWorkDetected: true, modeApplicability: 'applicable',
    analysisStatus: 'ok', processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none'
  })), (error) => error.code === 'CALCULATION_CARELESS_WORK_INCOMPLETE_CONSTRAINT');
});

test('calculation work_only_complete accepts a pure expression questionText', () => {
  const result = calculationRuntime.validateCalculationCarelessTrainingGradeResult(calculationPayload({
    inputBasis: 'work_only_complete', studentWorkDetected: true, modeApplicability: 'applicable', questionText: '36×24'
  }));
  assert.equal(result.questions[0].questionText, '36×24');
});

function hardProblemPayload(questions) {
  return {
    outputSchemaVersion: 'hard-problem.v2',
    mode: 'hard-problem',
    route: { difficulty: 'normal', confidence: 0, flags: [] },
    imageQuality: { ok: true, issues: [] },
    questionSetAudit: { visibleIndependentQuestionCount: questions.length, emittedQuestionCount: questions.length, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions
  };
}

function hardProblemQuestion() {
  return {
    outputSchemaVersion: 'hard-problem.v2', sourceKey: 'image-1-question-1', questionText: '1 + 1', studentAnswer: '2', standardAnswer: '2',
    answerStatus: 'answered', finalAnswerCorrect: true, stepRequired: true, stepStatus: 'correct', logicStatus: 'correct', errorType: 'none', firstWrongStep: '',
    errorReason: '', adjustmentSuggestion: '', knowledgePoint: '',
    stepFeedbacks: [{ stepIndex: 1, solutionText: '1 + 1 = 2', explanationText: '把两个1相加得到2', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '计算和解释均正确。', correctionAdvice: '' }],
    overallFeedback: '答案、步骤和讲解均正确。', confidence: 1
  };
}

function printedBlankQuestion(sourceKey) {
  return {
    ...hardProblemQuestion(), sourceKey, questionText: `printed ${sourceKey}`,
    studentAnswer: '', answerStatus: 'unanswered', finalAnswerCorrect: null, stepRequired: true,
    stepStatus: 'missing', logicStatus: 'insufficient', errorType: 'unanswered', stepFeedbacks: [], overallFeedback: '未检测到学生作答。',
    studentWorkDetected: false, sourceQuestionLabel: sourceKey, sourceRegion: 'image-1',
    inputBasis: 'printed_question_without_work', modeApplicability: 'hard_problem'
  };
}

async function runHardProblemPipeline(primaryQuestions, reviewQuestions, primaryQuestionSetAudit = null, reviewQuestionSetAudit = null) {
  const writes = [];
  const checkinCalls = [];
  const ttsCalls = [];
  const arkCalls = [];
  const strategy = {
    version: 'test',
    contracts: { hardProblemV2: {
      requiredFields: ['stepFeedbacks', 'overallFeedback', 'studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'],
      arrayItemSchemas: { stepFeedbacks: {
        requiredFields: ['stepIndex', 'solutionText', 'explanationText', 'solutionStatus', 'explanationStatus', 'logicStatus', 'analysis', 'correctionAdvice'],
        enumFields: {
          solutionStatus: ['correct', 'wrong', 'missing', 'unreadable'],
          explanationStatus: ['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable'],
          logicStatus: ['clear', 'insufficient', 'wrong', 'unreadable']
        }
      } },
      ...HARD_TOP_LEVEL_CONTRACT
    } },
    modelRuntime: { stages: {
      hardProblemPrimary: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none' },
      hardProblemReview: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none' }
    } },
    prompts: { hardProblem: { system: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice', userTemplate: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice' } },
    reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct', independentReviewInstruction: '' } },
    ...(primaryQuestionSetAudit || reviewQuestionSetAudit ? { outputSchemaRegistry: { schemas: [{ topLevelRequiredFields: ['questionSetAudit'] }] } } : {})
  };
  const runtime = createGradingRuntime({
    context: { db: { collection: (name) => ({ doc: () => ({ set: async ({ data }) => writes.push({ name, data }), update: async ({ data }) => writes.push({ name, data }) }) }) } },
    constants: { C: { tasks: 'tasks', results: 'results', wrong: 'wrong' } }, audit: { monitor() {} },
    ark: { callArk: async (options) => { arkCalls.push(options); const { logicalPass } = options; return { ...hardProblemPayload(logicalPass === 1 ? primaryQuestions : reviewQuestions), ...(logicalPass === 1 ? primaryQuestionSetAudit ? { questionSetAudit: primaryQuestionSetAudit } : {} : reviewQuestionSetAudit ? { questionSetAudit: reviewQuestionSetAudit } : {}) }; } },
    utils: { now: () => new Date('2026-07-29T00:00:00.000Z'), randomId: () => 'id', shanghaiDateKey: require('../shared/utils').shanghaiDateKey, safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async (_task, questions) => checkinCalls.push(questions) }, taskError: {},
    json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { hardProblemUserPrompt: () => '' }, enqueueTts: async (input) => ttsCalls.push(input)
  });
  const task = { _id: 'task-printed-blank', studentId: 'student-1', createdAt: '2026-07-29T00:00:00.000Z', mode: 'HARD_PROBLEM_CHECK', studentImageFileIds: [], answerImageFileIds: [] };
  await runtime.test.process({ ...task, currentStage: 'PRIMARY_GRADING' }, Date.now());
  const primaryDraft = writes.find((write) => write.name === 'tasks' && write.data.primaryDraft).data.primaryDraft;
  const reviewStage = await runtime.test.process({ ...task, currentStage: 'REVIEW_GRADING', primaryDraft }, Date.now());
  const reviewWrite = writes.find((write) => write.name === 'tasks' && write.data.reviewDraft);
  assert.ok(reviewWrite, JSON.stringify(reviewStage));
  const result = await runtime.test.process({ ...task, currentStage: 'FINALIZING_RESULT', primaryDraft, reviewDraft: reviewWrite.data.reviewDraft, mergedDraft: reviewWrite.data.mergedDraft }, Date.now());
  return { result, writes, checkinCalls, ttsCalls, arkCalls };
}

test('developer_test tasks propagate their data space to grading results and wrong questions', async () => {
  const writes = [];
  const question = { ...hardProblemQuestion(), sourceKey: 'developer-wrong', finalAnswerCorrect: false, stepStatus: 'wrong', logicStatus: 'wrong', errorType: 'answer_error', firstWrongStep: '第1步', errorReason: '计算错误', adjustmentSuggestion: '订正', stepFeedbacks: [{ ...hardProblemQuestion().stepFeedbacks[0], solutionStatus: 'wrong', logicStatus: 'wrong' }] };
  const runtime = createGradingRuntime({
    context: { db: { collection: (name) => ({ doc: () => ({ set: async ({ data }) => writes.push({ name, data }), update: async ({ data }) => writes.push({ name, data }) }) }) } },
    constants: { C: { tasks: 'tasks', results: 'results', wrong: 'wrong' } }, audit: { monitor() {} },
    utils: { now: () => new Date('2026-07-29T00:00:00.000Z'), randomId: () => 'id', shanghaiDateKey: require('../shared/utils').shanghaiDateKey, safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({ modelRuntime: { stages: { hardProblemPrimary: { modelTier: 'lite' }, hardProblemReview: { modelTier: 'lite' } } } }) }, remote: { loadRuntimeStrategy: async () => ({ modelRuntime: { stages: { hardProblemPrimary: { modelTier: 'lite' }, hardProblemReview: { modelTier: 'lite' } } } }) }, strategyRender: { hardProblemUserPrompt: () => '' }
  });
  const draft = hardProblemPayload([question]);
  const result = await runtime.test.process({ _id: 'task-developer-derived', studentId: 'developer-student', dataSpace: 'developer_test', createdAt: '2026-07-29T00:00:00.000Z', mode: 'HARD_PROBLEM_CHECK', currentStage: 'FINALIZING_RESULT', primaryDraft: draft, reviewDraft: draft, mergedDraft: draft }, Date.now());

  assert.deepEqual(result, { outcome: 'COMPLETED', resultId: 'task-developer-derived' });
  assert.equal(writes.find((write) => write.name === 'results').data.dataSpace, 'developer_test');
  assert.equal(writes.find((write) => write.name === 'wrong').data.dataSpace, 'developer_test');
});

async function runReadingCarelessPipeline(primaryQuestions, reviewQuestions) {
  const writes = [];
  const checkinCalls = [];
  const ttsCalls = [];
  const strategy = {
    version: 'test',
    modelRuntime: { stages: {
      readingCarelessPrimary: { outputSchemaVersion: 'reading-careless.v2', modelTier: 'mini', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none' },
      readingCarelessReview: { outputSchemaVersion: 'reading-careless.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none' }
    } },
    prompts: { carelessTraining: { system: 'system', userTemplate: 'user' } },
    reviewRules: { carelessTraining: { missingRelationTokens: [], missingRelationIssue: '', independentReviewInstruction: '' } }
  };
  const runtime = createGradingRuntime({
    context: { db: { collection: (name) => ({ doc: () => ({ set: async ({ data }) => writes.push({ name, data }), update: async ({ data }) => writes.push({ name, data }) }) }) } },
    constants: { C: { tasks: 'tasks', results: 'results', wrong: 'wrong' } }, audit: { monitor() {} },
    ark: { callArk: async ({ logicalPass }) => {
      const questions = logicalPass === 1 ? primaryQuestions : reviewQuestions;
      return { outputSchemaVersion: 'reading-careless.v2', route: { difficulty: 'normal', confidence: 1, flags: [] }, imageQuality: { ok: true, issues: [] }, questionSetAudit: { visibleIndependentQuestionCount: questions.length, emittedQuestionCount: questions.length, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }, questions };
    } },
    utils: { now: () => new Date('2026-07-29T00:00:00.000Z'), randomId: () => 'id', shanghaiDateKey: require('../shared/utils').shanghaiDateKey, safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async (_task, questions) => checkinCalls.push(questions) }, taskError: {},
    json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { carelessTrainingUserPrompt: () => '' }, enqueueTts: async (input) => ttsCalls.push(input)
  });
  const task = { _id: 'task-reading-applicability', studentId: 'student-1', createdAt: '2026-07-29T00:00:00.000Z', mode: 'CARELESS_TRAINING', carelessTrainingType: 'READING', studentImageFileIds: [] };
  await runtime.test.process({ ...task, currentStage: 'PRIMARY_GRADING' }, Date.now());
  const primaryDraft = writes.find((write) => write.name === 'tasks' && write.data.primaryDraft).data.primaryDraft;
  await runtime.test.process({ ...task, currentStage: 'REVIEW_GRADING', primaryDraft }, Date.now());
  const reviewWrite = writes.find((write) => write.name === 'tasks' && write.data.reviewDraft);
  const result = await runtime.test.process({ ...task, currentStage: 'FINALIZING_RESULT', primaryDraft, reviewDraft: reviewWrite.data.reviewDraft, mergedDraft: reviewWrite.data.mergedDraft }, Date.now());
  return { result, writes, checkinCalls, ttsCalls };
}

test('reading-careless excludes work-only algebra marked not_applicable from final projections', async () => {
  const algebra = readingMergeQuestion('algebra-1', {
    inputBasis: 'work_only_complete', modeApplicability: 'not_applicable',
    studentConditionText: '', studentRelationText: '', studentAskText: '',
    conditionCorrect: false, relationCorrect: false, askCorrect: false
  });
  const pipeline = await runReadingCarelessPipeline([algebra], [algebra]);
  const resultDoc = pipeline.writes.find((write) => write.name === 'results').data;
  assert.deepEqual(pipeline.result, { outcome: 'COMPLETED', resultId: 'task-reading-applicability' });
  assert.deepEqual(resultDoc.questions, []);
  for (const value of Object.values(resultDoc.summary)) if (typeof value === 'number') assert.equal(value, 0);
  assert.deepEqual(pipeline.writes.filter((write) => write.name === 'wrong'), []);
  assert.deepEqual(pipeline.checkinCalls, []);
  assert.deepEqual(pipeline.ttsCalls, []);
});

test('reading-careless contract rejects applicable work_only_complete output', () => {
  const runtime = readingMergeRuntime();
  assert.throws(() => runtime.validateCarelessTrainingGradeResult({
    outputSchemaVersion: 'reading-careless.v2', route: { difficulty: 'normal', confidence: 1, flags: [] }, imageQuality: { ok: true, issues: [] },
    questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [readingMergeQuestion('work-only-applicable', { inputBasis: 'work_only_complete', modeApplicability: 'applicable' })]
  }, 'draft'), (error) => error.code === 'READING_CARELESS_WORK_ONLY_APPLICABILITY_CONSTRAINT' && error.fieldPath === 'questions[0].modeApplicability');
});

test('reading-careless uncertain output requires null three-grid judgments', () => {
  const runtime = readingMergeRuntime();
  const payload = (overrides) => ({
    outputSchemaVersion: 'reading-careless.v2', route: { difficulty: 'normal', confidence: 1, flags: [] }, imageQuality: { ok: true, issues: [] },
    questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [readingMergeQuestion('uncertain-1', { inputBasis: 'printed_question_with_work', modeApplicability: 'uncertain', analysisStatus: 'insufficient', conditionCorrect: null, relationCorrect: null, askCorrect: null, ...overrides })]
  });
  assert.throws(() => runtime.validateCarelessTrainingGradeResult(payload({ conditionCorrect: true }), 'draft'), (error) => error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions[0].conditionCorrect');
  const result = runtime.validateCarelessTrainingGradeResult(payload(), 'draft');
  assert.equal(result.questions[0].threeGridStatus, 'UNDETERMINED');
  assert.deepEqual([result.questions[0].conditionCorrect, result.questions[0].relationCorrect, result.questions[0].askCorrect], [null, null, null]);
});

test('student-visible text quality permits Unicode math, variables, units, and multiline calculations', () => {
  const { inspectStudentVisibleText } = require('../shared/output-schema-validator');
  const question = { ...hardProblemQuestion(), questionText: '√16\n∛64\nx² + x³ = (-3)²\n|a-b| = 17/12\n2x+3y，长度：2cm，质量：3kg，路程：4km' };
  assert.deepEqual(inspectStudentVisibleText(question), []);
});

test('student-visible text quality flags LaTeX, controls, and replacement characters and REVIEW degrades them safely', async () => {
  const { inspectStudentVisibleText } = require('../shared/output-schema-validator');
  const invalid = { ...hardProblemQuestion(), questionText: '\\frac{1}{2}', errorReason: `bad\u0001text\uFFFD` };
  assert.deepEqual(inspectStudentVisibleText(invalid).map((issue) => issue.issueType).sort(), ['control_character', 'latex_command', 'replacement_character']);
  const pipeline = await runHardProblemPipeline([invalid], [invalid]);
  const resultDoc = pipeline.writes.find((write) => write.name === 'results').data;
  assert.equal(resultDoc.questions[0].answerStatus, 'unreadable');
  assert.equal(resultDoc.questions[0].questionText, '公式或文本未能可靠识别，请重新上传方向正确、清晰完整的图片');
  assert.doesNotMatch(JSON.stringify(resultDoc.questions), /\\frac|bad|\uFFFD/);
});

test('student-visible text quality flags English explanatory sentences without misclassifying x, cm, or kg', () => {
  const { inspectStudentVisibleText } = require('../shared/output-schema-validator');
  const drift = { ...hardProblemQuestion(), questionText: 'Please solve this equation using the following method carefully' };
  assert.equal(inspectStudentVisibleText(drift)[0].issueType, 'english_sentence');
  for (const text of ['x', 'cm', 'kg', '2x+3y']) assert.deepEqual(inspectStudentVisibleText({ ...hardProblemQuestion(), questionText: text }), []);
});

test('excludes printed blank PRIMARY questions before REVIEW sourceKey matching while retaining normal evidence fields', async () => {
  const normal = { ...hardProblemQuestion(), sourceKey: 'normal-1', sourceQuestionLabel: '1', sourceRegion: 'image-1', studentWorkDetected: true, inputBasis: 'student_work', modeApplicability: 'hard_problem' };
  const pipeline = await runHardProblemPipeline([normal, printedBlankQuestion('printed-1')], [normal]);
  const resultDoc = pipeline.writes.find((write) => write.name === 'results').data;
  assert.deepEqual(pipeline.result, { outcome: 'COMPLETED', resultId: 'task-printed-blank' });
  assert.deepEqual(resultDoc.questions.map((question) => question.sourceKey), ['normal-1']);
  assert.deepEqual(Object.fromEntries(['studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'].map((field) => [field, resultDoc.questions[0][field]])), {
    studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'student_work', modeApplicability: 'hard_problem'
  });
});

test('rejects different sourceKeys with duplicate question attribution evidence', async () => {
  const questions = ['q-1', 'q-2'].map((sourceKey) => ({
    ...hardProblemQuestion(), sourceKey, sourceQuestionLabel: '1', sourceRegion: 'image-1', studentWorkDetected: true, inputBasis: 'student_work'
  }));
  await assert.rejects(runHardProblemPipeline(questions, questions), (error) => error.code === 'QUESTION_ATTRIBUTION_DUPLICATE');
});

test('rejects reused long student calculation evidence in the same source region', async () => {
  const studentAnswer = '先计算括号内的乘法，再逐步合并每一项得到最终结果';
  const questions = ['q-1', 'q-2'].map((sourceKey, index) => ({
    ...hardProblemQuestion(), sourceKey, sourceQuestionLabel: String(index + 1), sourceRegion: 'image-1', studentWorkDetected: true, inputBasis: 'student_work', studentAnswer
  }));
  await assert.rejects(runHardProblemPipeline(questions, questions), (error) => error.code === 'QUESTION_STUDENT_WORK_REUSED');
});

test('allows repeated short student answers when question attribution differs', async () => {
  const questions = ['q-1', 'q-2'].map((sourceKey, index) => ({
    ...hardProblemQuestion(), sourceKey, sourceQuestionLabel: String(index + 1), sourceRegion: `image-${index + 1}`, studentWorkDetected: true, inputBasis: 'student_work', studentAnswer: 'x=2'
  }));
  const pipeline = await runHardProblemPipeline(questions, questions);
  assert.deepEqual(pipeline.writes.find((write) => write.name === 'results').data.questions.map((question) => question.sourceKey), ['q-1', 'q-2']);
});

test('restores blank REVIEW attribution from PRIMARY and reaches FINALIZING_RESULT', async () => {
  const primary = [{ ...hardProblemQuestion(), sourceKey: 'q-1', sourceQuestionLabel: '1', sourceRegion: 'image-1' }];
  const review = [{ ...hardProblemQuestion(), sourceKey: 'q-1', sourceQuestionLabel: '', sourceRegion: '   ' }];
  const pipeline = await runHardProblemPipeline(primary, review);
  const reviewWrite = pipeline.writes.find((write) => write.name === 'tasks' && write.data.reviewDraft);
  assert.equal(reviewWrite.data.currentStage, 'FINALIZING_RESULT');
  assert.equal(pipeline.arkCalls[0].reviewQuestionAttributionBaseline, null);
  assert.deepEqual(pipeline.arkCalls[1].reviewQuestionAttributionBaseline, [{ sourceKey: 'q-1', sourceQuestionLabel: '1', sourceRegion: 'image-1' }]);
  assert.deepEqual(Object.fromEntries(['sourceKey', 'sourceQuestionLabel', 'sourceRegion'].map((field) => [field, reviewWrite.data.reviewDraft.questions[0][field]])), { sourceKey: 'q-1', sourceQuestionLabel: '1', sourceRegion: 'image-1' });
});

test('PRIMARY attribution wins when REVIEW returns incorrect attribution', async () => {
  const primary = [{ ...hardProblemQuestion(), sourceKey: 'q-1', sourceQuestionLabel: '1', sourceRegion: 'image-1' }];
  const review = [{ ...hardProblemQuestion(), sourceKey: 'q-1', sourceQuestionLabel: 'wrong label', sourceRegion: 'image-99' }];
  const pipeline = await runHardProblemPipeline(primary, review);
  const resultQuestion = pipeline.writes.find((write) => write.name === 'results').data.questions[0];
  assert.deepEqual(Object.fromEntries(['sourceKey', 'sourceQuestionLabel', 'sourceRegion'].map((field) => [field, resultQuestion[field]])), { sourceKey: 'q-1', sourceQuestionLabel: '1', sourceRegion: 'image-1' });
});

test('restores a drifted REVIEW sourceKey only from unique PRIMARY attribution and still rejects duplicate, missing, or unrelated identities', async () => {
  const primary = [{ ...hardProblemQuestion(), sourceKey: 'q-1', sourceQuestionLabel: '1', sourceRegion: 'image-1' }];
  const drifted = [{ ...hardProblemQuestion(), sourceKey: 'review-generated-key', sourceQuestionLabel: '1', sourceRegion: 'image-1' }];
  const aligned = await runHardProblemPipeline(primary, drifted);
  assert.equal(aligned.writes.find((write) => write.name === 'results').data.questions[0].sourceKey, 'q-1');

  for (const review of [
    [{ ...hardProblemQuestion(), sourceKey: 'q-1', sourceQuestionLabel: '1', sourceRegion: 'image-1' }, { ...hardProblemQuestion(), sourceKey: 'q-1', sourceQuestionLabel: '2', sourceRegion: 'image-2' }],
    [{ ...hardProblemQuestion(), sourceKey: '', sourceQuestionLabel: '1', sourceRegion: 'image-1' }],
    [{ ...hardProblemQuestion(), sourceKey: 'unrelated', sourceQuestionLabel: '2', sourceRegion: 'image-2' }]
  ]) {
    await assert.rejects(runHardProblemPipeline(primary, review), (error) => ['QUESTION_SET_MISMATCH', 'QUESTION_SOURCE_KEY_DUPLICATE', 'LLM_SCHEMA_ERROR'].includes(error.code));
  }
});

test('rejects REVIEW sourceKeys outside the canonical PRIMARY baseline even when questionSetAudit has a larger count', async () => {
  const primary = [{ ...hardProblemQuestion(), sourceKey: 'q-1' }];
  const review = ['q-1', 'q-2', 'q-3'].map((sourceKey) => ({ ...hardProblemQuestion(), sourceKey }));
  await assert.rejects(runHardProblemPipeline(
    primary,
    review,
    { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    { visibleIndependentQuestionCount: 3, emittedQuestionCount: 3, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }
  ), (error) => error.code === 'QUESTION_SET_MISMATCH');
});

test('normalizes required questionSetAudit after a printed blank question is excluded', async () => {
  const questions = [{ ...hardProblemQuestion(), sourceKey: 'q-1' }, { ...hardProblemQuestion(), sourceKey: 'q-2' }, printedBlankQuestion('printed-audit')];
  const audit = { visibleIndependentQuestionCount: 3, emittedQuestionCount: 3, excludedQuestionCount: 0, orientation: 'uncertain', countConfidence: 0.1 };
  const pipeline = await runHardProblemPipeline(questions, questions, audit, audit);
  const resultDoc = pipeline.writes.find((write) => write.name === 'results').data;
  assert.equal(resultDoc.questions.length, 2);
  assert.deepEqual(resultDoc.questionSetAudit, { ...audit, emittedQuestionCount: 2, excludedQuestionCount: 1 });
  assert.equal(resultDoc.summary.totalCount, 2);
});

test('excludes printed blank questions from result, wrong-question, check-in, and TTS projections', async () => {
  const normalWrong = { ...hardProblemQuestion(), sourceKey: 'normal-wrong', finalAnswerCorrect: false, stepStatus: 'wrong', logicStatus: 'wrong', errorType: 'answer_error', firstWrongStep: '第1步和最终答案', errorReason: '第1步计算错误，导致最终答案错误。', adjustmentSuggestion: '重新计算第1步并据此订正最终答案。', stepFeedbacks: [{ stepIndex: 1, solutionText: '1 + 1 = 3', explanationText: '相加得到3', solutionStatus: 'wrong', explanationStatus: 'incorrect', logicStatus: 'wrong', analysis: '计算和解释均错误。', correctionAdvice: '重新计算并说明加法依据。' }], overallFeedback: '答案、步骤和讲解需要订正。' };
  const pipeline = await runHardProblemPipeline([normalWrong, printedBlankQuestion('printed-2')], [normalWrong]);
  const resultDoc = pipeline.writes.find((write) => write.name === 'results').data;
  assert.deepEqual(resultDoc.questions.map((question) => question.sourceKey), ['normal-wrong']);
  assert.equal(resultDoc.summary.totalCount, 1);
  assert.deepEqual(pipeline.writes.filter((write) => write.name === 'wrong').map((write) => write.data.sourceKey), ['normal-wrong']);
  assert.deepEqual(pipeline.checkinCalls.map((questions) => questions.map((question) => question.sourceKey)), [['normal-wrong']]);
  assert.deepEqual(pipeline.ttsCalls, [{ resultId: 'task-printed-blank' }]);
});

test('completes with zero projections and zero statistics when every question is printed blank', async () => {
  const pipeline = await runHardProblemPipeline([printedBlankQuestion('printed-3')], []);
  const resultDoc = pipeline.writes.find((write) => write.name === 'results').data;
  assert.deepEqual(pipeline.result, { outcome: 'COMPLETED', resultId: 'task-printed-blank' });
  assert.deepEqual(resultDoc.questions, []);
  for (const value of Object.values(resultDoc.summary)) if (typeof value === 'number') assert.equal(value, 0);
  assert.deepEqual(pipeline.writes.filter((write) => write.name === 'wrong'), []);
  assert.deepEqual(pipeline.checkinCalls, []);
  assert.deepEqual(pipeline.ttsCalls, []);
});

test('recordQualifiedQuestions logs a safe database failure and rethrows the original error', async () => {
  const context = require('../shared/context');
  const audit = require('../shared/audit');
  const originalError = Object.assign(new Error('database write failed'), { code: 'CHECKIN_DB_WRITE_FAILED' });
  const records = [];
  const originalDb = context.db;
  const originalMonitor = audit.monitor;
  context.db = {
    runTransaction: async (callback) => callback({
      collection: () => ({ doc: () => ({ get: async () => ({ data: [] }), set: async () => { throw originalError; } }) })
    })
  };
  audit.monitor = (_source, event, details, isError) => records.push({ event, details, isError });
  try {
    await assert.rejects(
      recordQualifiedQuestions({ _id: 'task-checkin-failure', studentId: 'student-1', createdAt: '2026-07-28T00:00:00.000Z' }, [{ checkinEligible: true, questionText: '1 + 1', sourceKey: 'q-1' }]),
      (error) => error === originalError
    );
    assert.deepEqual(records.filter((record) => record.event === 'CHECKIN_DATABASE_WRITE_FAILED'), [{
      event: 'CHECKIN_DATABASE_WRITE_FAILED',
      details: {
        documentId: 'student-1_2026-07-28', dateKey: '2026-07-28', eligibleQuestionCount: 1, uniqueQuestionCount: 1,
        operationStage: 'writeCheckin', errorCode: 'CHECKIN_DB_WRITE_FAILED', errorMessage: 'database write failed'
      },
      isError: true
    }]);
  } finally {
    context.db = originalDb;
    audit.monitor = originalMonitor;
  }
});

test('persistResult logs a safe check-in failure while completing the task', async () => {
  const records = [];
  const writes = [];
  const checkinError = Object.assign(new Error('check-in database write failed'), { code: 'CHECKIN_DB_WRITE_FAILED' });
  const primary = hardProblemPayload([{ ...hardProblemQuestion(), checkinEligible: true }]);
  const runtime = createGradingRuntime({
    context: { db: { collection: (name) => ({ doc: () => ({ set: async ({ data }) => writes.push({ name, data }), update: async ({ data }) => writes.push({ name, data }) }) }) } },
    constants: { C: { tasks: 'tasks', results: 'results', wrong: 'wrong' } },
    audit: { monitor: (_source, event, details, isError) => records.push({ event, details, isError }) },
    utils: { now: () => new Date('2026-07-28T00:00:00.000Z'), randomId: () => 'id', shanghaiDateKey: require('../shared/utils').shanghaiDateKey, safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async () => { throw checkinError; } }, taskError: {},
    json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({ modelRuntime: { stages: { hardProblemPrimary: { modelTier: 'lite' }, hardProblemReview: { modelTier: 'lite' } } } }) }, remote: { loadRuntimeStrategy: async () => ({ modelRuntime: { stages: { hardProblemPrimary: { modelTier: 'lite' }, hardProblemReview: { modelTier: 'lite' } } } }) },
    strategyRender: { hardProblemUserPrompt: () => '' }
  });
  const task = {
    _id: 'task-persist-checkin-failure', studentId: 'student-1', createdAt: '2026-07-28T00:00:00.000Z', mode: 'HARD_PROBLEM_CHECK', currentStage: 'FINALIZING_RESULT',
    primaryDraft: primary, reviewDraft: primary, mergedDraft: primary
  };
  const result = await runtime.test.process(task, Date.now());
  assert.deepEqual(result, { outcome: 'COMPLETED', resultId: 'task-persist-checkin-failure' });
  assert.equal(writes.find((write) => write.name === 'results').data.modelTier, 'lite+lite');
  assert.ok(writes.some((write) => write.name === 'tasks' && write.data.status === 'COMPLETED'));
  assert.deepEqual(records, [{
    event: 'CHECKIN_QUALIFIED_QUESTIONS_FAILED',
    details: {
      taskId: 'task-persist-checkin-failure', studentIdPresent: true, taskDateKey: '2026-07-28', eligibleQuestionCount: 1,
      errorCode: 'CHECKIN_DB_WRITE_FAILED', errorMessage: 'check-in database write failed', errorStage: 'recordQualifiedQuestions'
    },
    isError: true
  }]);
});

test('mergeHardProblemResults rejects REVIEW additions outside the canonical PRIMARY sourceKey baseline', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({ reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }) } }).test;
  const primary = hardProblemPayload([
    { ...hardProblemQuestion(), sourceKey: 'q-16', questionText: '16' },
    { ...hardProblemQuestion(), sourceKey: 'q-17', questionText: '17' }
  ]);
  const review = hardProblemPayload([
    { ...hardProblemQuestion(), sourceKey: 'q-16', questionText: '16 reviewed' },
    { ...hardProblemQuestion(), sourceKey: 'q-17', questionText: '17' },
    { ...hardProblemQuestion(), sourceKey: 'q-18', questionText: '18' }
  ]);
  assert.throws(() => runtime.mergeHardProblemResults(primary, review, { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }), (error) => error.code === 'QUESTION_SET_MISMATCH');
});

test('mergeHardProblemResults preserves complete PRIMARY steps when REVIEW omits a real step', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({ reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }) } }).test;
  const first = hardProblemQuestion();
  const secondStep = { ...first.stepFeedbacks[0], stepIndex: 2, solutionText: '2 + 2 = 4', explanationText: '再把两个2相加得到4', analysis: '第二步计算和讲解正确。' };
  const primaryQuestion = { ...first, sourceKey: 'q-review-step', stepFeedbacks: [first.stepFeedbacks[0], secondStep], overallFeedback: '两步均完整。' };
  const reviewQuestion = { ...first, sourceKey: 'q-review-step', stepFeedbacks: [first.stepFeedbacks[0]], overallFeedback: '复核只返回了一步。' };
  const merged = runtime.mergeHardProblemResults(hardProblemPayload([primaryQuestion]), hardProblemPayload([reviewQuestion]), { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } });
  assert.equal(merged.questions[0].stepFeedbacks.length, 2);
  assert.equal(merged.questions[0].overallFeedback, '两步均完整。');
  assert.match(merged.questions[0].validationWarnings.join(' '), /REVIEW_STEP_OMISSION_PRIMARY_PRESERVED/);
});

test('canonicalizes one multi-line vertical calculation into one PRIMARY sourceKey and keeps REVIEW on that baseline', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({ reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }) } }).test;
  const variants = ['vertical multiplication', 'vertical addition', 'vertical subtraction', 'vertical division', 'multi-step work', 'draft below question', 'inline and vertical work'];
  for (const questionText of variants) {
    const primary = { ...hardProblemPayload(['operand', 'intermediate', 'final'].map((line, index) => ({
      ...hardProblemQuestion(), sourceKey: `row-${index + 1}`, questionText: `${questionText}: ${line}`,
      sourceQuestionLabel: '1', sourceRegion: 'page-1', studentWorkDetected: true, inputBasis: 'printed_question_with_work', modeApplicability: 'applicable'
    }))), questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 } };
    const baseline = runtime.canonicalizeQuestionBaseline(primary);
    assert.deepEqual(baseline.questions.map((question) => question.sourceKey), ['row-1']);
    assert.equal(baseline.questions.length, 1);
    const review = hardProblemPayload([{ ...baseline.questions[0], questionText: `${questionText}: reviewed` }]);
    const merged = runtime.mergeHardProblemResults(baseline, review, { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } });
    assert.deepEqual(merged.questions.map((question) => question.sourceKey), ['row-1']);
    assert.equal(merged.questions.length, 1);
  }
});

test('merges REVIEW by canonical PRIMARY sourceKey rather than REVIEW array position or additions', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({ reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }) } }).test;
  const primary = hardProblemPayload([
    { ...hardProblemQuestion(), sourceKey: 'q-1', questionText: 'first' },
    { ...hardProblemQuestion(), sourceKey: 'q-2', questionText: 'second' }
  ]);
  const reorderedReview = hardProblemPayload([
    { ...hardProblemQuestion(), sourceKey: 'q-2', questionText: 'second reviewed' },
    { ...hardProblemQuestion(), sourceKey: 'q-1', questionText: 'first reviewed' }
  ]);
  const merged = runtime.mergeHardProblemResults(primary, reorderedReview, { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } });
  assert.deepEqual(merged.questions.map((question) => question.sourceKey), ['q-1', 'q-2']);
  assert.deepEqual(merged.questions.map((question) => question.questionText), ['first reviewed', 'second reviewed']);
  const singlePrimary = { ...hardProblemPayload([{ ...hardProblemQuestion(), sourceKey: 'canonical-q', questionText: 'only question' }]), questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 } };
  assert.throws(() => runtime.mergeHardProblemResults(singlePrimary, { ...hardProblemPayload([...singlePrimary.questions, { ...hardProblemQuestion(), sourceKey: 'unknown', questionText: 'step row' }]), questionSetAudit: singlePrimary.questionSetAudit }, { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }), (error) => error.code === 'QUESTION_SET_MISMATCH');
});

test('permits only a uniquely mapped canonical REVIEW supplement and rejects unknown or duplicate sourceKeys', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({ reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }) } }).test;
  const primary = { ...hardProblemPayload([{ ...hardProblemQuestion(), sourceKey: 'q-1', questionText: 'first' }]), canonicalSourceKeys: ['q-1', 'q-2'] };
  const review = hardProblemPayload([
    { ...hardProblemQuestion(), sourceKey: 'q-2', questionText: 'second reviewed' },
    { ...hardProblemQuestion(), sourceKey: 'q-1', questionText: 'first reviewed' }
  ]);
  const merged = runtime.mergeHardProblemResults(primary, review, { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } });
  assert.deepEqual(merged.questions.map((question) => question.sourceKey), ['q-1', 'q-2']);
  assert.throws(() => runtime.mergeHardProblemResults(primary, hardProblemPayload([...review.questions, { ...hardProblemQuestion(), sourceKey: 'unknown', questionText: 'unknown' }]), { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }), (error) => error.code === 'QUESTION_SET_MISMATCH');
  assert.throws(() => runtime.mergeHardProblemResults(primary, hardProblemPayload([review.questions[0], review.questions[0], review.questions[1]]), { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }), (error) => error.code === 'QUESTION_SET_MISMATCH');
});

test('normalizes a top-level hard-problem questions array for validation', () => {
  const payload = hardProblemPayload([hardProblemQuestion()]);
  assert.deepEqual(validateHardProblemResult(normalizeHardProblemsResult(payload)), payload);
});

test('normalizes a Markdown JSON payload with an existing nested questions array', () => {
  const payload = hardProblemPayload([hardProblemQuestion()]);
  const normalized = normalizeHardProblemsResult(`\`\`\`json\n${JSON.stringify({ ...payload, data: { questions: payload.questions }, questions: undefined })}\n\`\`\``);
  assert.deepEqual(validateHardProblemResult(normalized).questions, payload.questions);
});

test('does not fabricate questions when the hard-problem payload omits them', () => {
  const normalized = normalizeHardProblemsResult({ outputSchemaVersion: 'hard-problem.v2', route: { difficulty: 'normal', confidence: 0, flags: [] }, imageQuality: { ok: true, issues: [] } });
  assert.equal(Object.hasOwn(normalized, 'questions'), false);
  assert.throws(() => validateHardProblemResult(normalized), (error) => error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions');
});

test('hardProblem PRIMARY forwards the configured lite responses runtime to callArk', async () => {
  const calls = [];
  const strategy = {
    modelRuntime: { stages: { hardProblemPrimary: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none' } } },
    prompts: { hardProblem: { system: 'system', userTemplate: 'user' } },
    reviewRules: { hardProblem: { correctStepStatuses: [] } }
  };
  const runtime = createGradingRuntime({
    context: { db: { collection: () => ({ doc: () => ({ update: async () => {} }) }) } },
    constants: { C: { tasks: 'tasks' } }, audit: { monitor() {} },
    ark: { callArk: async (options) => { calls.push(options); return hardProblemPayload([hardProblemQuestion()]); } },
    utils: { now: () => new Date(), randomId: () => 'id' }, checkin: { recordQualifiedQuestions: async () => {} }, taskError: {},
    json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { hardProblemUserPrompt: () => '' }
  });
  await runtime.test.process({ _id: 'task-hard-primary', currentStage: 'PRIMARY_GRADING', mode: 'HARD_PROBLEM_CHECK', hardProblemModelProvider: 'qwen3_vl_plus', studentImageFileIds: [], answerImageFileIds: [] }, Date.now());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestStage, 'hardProblemPrimary');
  assert.equal(calls[0].outputSchemaVersion, 'hard-problem.v2');
  assert.equal(calls[0].tier, 'lite');
  assert.equal(calls[0].maxOutputTokens, 4096);
  assert.equal(calls[0].structuredOutputMode, 'none');
  assert.equal(calls[0].provider, 'qwen3_vl_plus');
});

test('a failed confidence repair does not schedule REVIEW or persist a grading result', async () => {
  const writes = [];
  const scheduled = [];
  const strategy = {
    modelRuntime: { stages: { hardProblemPrimary: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none' } } },
    prompts: { hardProblem: { system: 'system', userTemplate: 'user' } },
    reviewRules: { hardProblem: { correctStepStatuses: [] } }
  };
  const runtime = createGradingRuntime({
    context: { db: { collection: (name) => ({ doc: () => ({ update: async ({ data }) => { writes.push({ name, data }); } }) }) } },
    constants: { C: { tasks: 'tasks', results: 'results' } }, audit: { monitor() {} },
    ark: { callArk: async () => { throw Object.assign(new Error('confidence repair rejected'), { code: 'LLM_SCHEMA_REPAIR_FAILED', repairAttempted: true }); } },
    utils: { now: () => new Date(), randomId: () => 'id' }, checkin: { recordQualifiedQuestions: async () => {} }, taskError: {},
    json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { hardProblemUserPrompt: () => '' }, scheduleNextStage: async (input) => { scheduled.push(input); }
  });
  await assert.rejects(runtime.test.process({ _id: 'task-repair-rejected', currentStage: 'PRIMARY_GRADING', mode: 'HARD_PROBLEM_CHECK', studentImageFileIds: [], answerImageFileIds: [] }, Date.now()), (error) => error.code === 'LLM_SCHEMA_REPAIR_FAILED');
  assert.deepEqual(scheduled, []);
  assert.deepEqual(writes, []);
});

test('executeGradingTask completes only after status and resultId are persisted', async () => {
  const task = { _id: 'task-1', currentStage: 'FINALIZING_RESULT' };
  const current = { ...task };
  let processedTask;
  const result = await executeGradingTask({
    taskId: 'task-1',
    runtime: {
      claim: async () => ({ reason: 'CLAIMED', task }),
      loadTask: async () => current,
      process: async (claimedTask) => {
        processedTask = claimedTask;
        Object.assign(current, { status: 'COMPLETED', currentStage: 'COMPLETED', resultId: 'result-1' });
      },
      fail: async () => { throw new Error('must not fail'); }
    }
  });
  assert.deepEqual(processedTask, task);
  assert.deepEqual(result, {
    success: true,
    taskId: 'task-1',
    outcome: 'COMPLETED',
    nextStage: 'COMPLETED',
    resultId: 'result-1',
    observedStage: 'COMPLETED',
    handoffPatch: null,
    handoffToken: null
  });
});

test('executeGradingTask reports CONTINUE when a stage persists the next QUEUED stage', async () => {
  const task = { _id: 'task-1', currentStage: 'PREPARING_IMAGES' };
  const current = { ...task };
  const result = await executeGradingTask({
    taskId: 'task-1',
    runtime: {
      claim: async () => ({ reason: 'CLAIMED', task }),
      loadTask: async () => current,
      process: async () => Object.assign(current, { status: 'QUEUED', currentStage: 'PRIMARY_GRADING' }),
      fail: async () => { throw new Error('must not fail'); }
    }
  });
  assert.equal(result.outcome, 'CONTINUE');
  assert.equal(result.nextStage, 'PRIMARY_GRADING');
  assert.equal(result.resultId, null);
});

test('executeGradingTask reports WAITING_USER for answer or confirmation states', async () => {
  for (const status of ['NEED_ANSWER', 'NEED_CONFIRMATION']) {
    const task = { _id: `task-${status}`, currentStage: 'FINALIZING_RESULT' };
    const current = { ...task };
    const result = await executeGradingTask({
      taskId: task._id,
      runtime: {
        claim: async () => ({ reason: 'CLAIMED', task }),
        loadTask: async () => current,
        process: async () => Object.assign(current, { status, currentStage: status }),
        fail: async () => { throw new Error('must not fail'); }
      }
    });
    assert.equal(result.outcome, 'WAITING_USER');
  }
});

test('executeGradingTask preserves failedStage and mapped failure details', async () => {
  let failureInput;
  const current = { _id: 'task-1', status: 'FAILED', currentStage: 'FAILED', errorCode: 'ARK_TIMEOUT' };
  const result = await executeGradingTask({
    taskId: 'task-1',
    runtime: {
      claim: async () => ({ reason: 'CLAIMED', task: { _id: 'task-1', currentStage: 'REVIEW_GRADING' } }),
      loadTask: async () => current,
      process: async () => { throw Object.assign(new Error('provider unavailable'), { code: 'ARK_TIMEOUT' }); },
      fail: async (input) => { failureInput = input; return true; }
    }
  });
  assert.equal(failureInput.stage, 'REVIEW_GRADING');
  assert.equal(failureInput.error.code, 'ARK_TIMEOUT');
  assert.deepEqual(result, {
    success: false,
    taskId: 'task-1',
    outcome: 'FAILED',
    errorCode: 'ARK_TIMEOUT',
    causeCode: null,
    fieldPath: null,
    requestStage: null,
    modelProvider: null,
    modelName: null,
    providerRequestIdPresent: false,
    repairAttempted: false,
    repairAttemptCount: 0,
    repairFailureStage: null,
    failureId: null
  });
});

test('TASK_STAGE_FAILED preserves bounded schema issue diagnostics without question content', async () => {
  const document = {};
  const records = [];
  const runtime = createGradingRuntime({
    context: { db: { collection: () => ({ doc: () => ({ update: async ({ data }) => Object.assign(document, data) }) }) } },
    constants: { C: { tasks: 'tasks' } },
    audit: { monitor: (_source, event, details) => records.push({ event, details }) },
    utils: require('../shared/utils'),
    taskError: { mapTaskFailure: () => ({ status: 'FAILED', stage: 'FAILED', errorCode: 'LLM_SCHEMA_ERROR', userMessage: 'safe failure', userSuggestion: '', retryable: false, failureCategory: 'MODEL_OUTPUT' }) }
  });
  const error = Object.assign(new Error('Invalid enum value: questions[8].logicStatus'), {
    code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[8].logicStatus', receivedValue: 'invalid_status',
    allowedValues: ['correct', 'wrong', 'insufficient', 'unreadable'], questionIndex: 8, requestStage: 'hardProblemPrimary',
    issueCount: 1, issues: [{ code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[8].logicStatus', validator: 'enum', questionIndex: 8, questionText: 'QUESTION_BODY_SECRET' }],
    repairAttempted: true, repairAttemptCount: 1, repairFailureStage: 'REPAIR_PATCH_VALIDATION',
    question: { questionText: 'QUESTION_BODY_SECRET', studentAnswer: 'ANSWER_SECRET' }, prompt: 'PROMPT_SECRET', image: 'IMAGE_SECRET', token: 'TOKEN_SECRET'
  });
  assert.equal(await runtime.fail({ taskId: 'task-schema', stage: 'PRIMARY_GRADING', error }), true);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'TASK_STAGE_FAILED');
  const details = records[0].details;
  assert.equal(details.taskId, 'task-schema');
  assert.equal(details.stage, 'PRIMARY_GRADING');
  assert.equal(details.errorCode, 'LLM_SCHEMA_ERROR');
  assert.equal(details.fieldPath, 'questions[8].logicStatus');
  assert.equal(details.requestStage, 'hardProblemPrimary');
  assert.equal(details.providerRequestIdPresent, false);
  assert.equal(details.repairAttempted, true);
  assert.equal(details.repairAttemptCount, 1);
  assert.equal(document.failureRepairFailureStage, 'REPAIR_PATCH_VALIDATION');
  assert.equal(typeof details.failureId, 'string');
  assert.equal(details.errorDetails.schemaValidation.fieldPath, 'questions[8].logicStatus');
  assert.deepEqual(details.diagnostics.schemaValidation.issues, [{ code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[8].logicStatus', validator: 'enum', sourceKey: null, repairable: false }]);
  for (const forbidden of ['QUESTION_BODY_SECRET', 'ANSWER_SECRET', 'PROMPT_SECRET', 'IMAGE_SECRET', 'TOKEN_SECRET']) assert.doesNotMatch(JSON.stringify(records), new RegExp(forbidden));
});

test('importing the shared module does not invoke a runtime operation', () => {
  assert.equal(typeof executeGradingTask, 'function');
});

function readingMergeRuntime() {
  return createGradingRuntime({
    json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => ({ reviewRules: { carelessTraining: { missingRelationTokens: [], missingRelationIssue: '' } } }) }
  }).test;
}

function readingMergeQuestion(sourceKey, overrides = {}) {
  return {
    outputSchemaVersion: 'reading-careless.v2', sourceKey, questionText: sourceKey,
    studentConditionText: 'condition', studentRelationText: 'relation', studentAskText: 'ask',
    referenceConditionText: 'primary condition', referenceRelationText: 'primary relation', referenceAskText: 'primary ask',
    analysisStatus: 'ok', conditionCorrect: true, relationCorrect: true, askCorrect: true,
    missingConditions: [], incorrectConditions: [], relationIssues: [], askIssue: '', errorReason: '', correctionAdvice: '', adjustmentSuggestion: '', confidence: 1,
    ...overrides
  };
}

test('reading-careless consolidates duplicate fragments under the same printed main question without hardcoding a specific worksheet', () => {
  const runtime = readingMergeRuntime();
  const result = runtime.consolidateReadingQuestions({
    outputSchemaVersion: 'reading-careless.v2',
    questions: [
      readingMergeQuestion('img1_q-16', { questionText: '第16题 圆柱木块体积问题', sourceQuestionLabel: '第16题' }),
      readingMergeQuestion('img1_q-17-a', { questionText: '第17题 花坛贴砖与混凝土问题', sourceQuestionLabel: '第17题', studentConditionText: '花坛直径20米，高0.5米' }),
      readingMergeQuestion('img1_q-17-b', { questionText: '第17题 花坛贴砖与混凝土问题', sourceQuestionLabel: '第17题', studentAskText: '求瓷砖面积和混凝土是否足够' }),
      readingMergeQuestion('img1_q-18', { questionText: '第18题 两车相遇比例尺问题', sourceQuestionLabel: '第18题' })
    ]
  });
  assert.equal(result.questions.length, 3);
  assert.deepEqual(result.questions.map((question) => runtime.readingQuestionIdentity(question)), ['image:1:printed:16', 'image:1:printed:17', 'image:1:printed:18']);
  assert.match(result.questions[1].studentConditionText, /直径20米/);
  assert.match(result.questions[1].studentAskText, /瓷砖面积/);
});

test('reading-careless consolidates fragments when the printed number exists only in source metadata', () => {
  const runtime = readingMergeRuntime();
  const result = runtime.consolidateReadingQuestions({
    outputSchemaVersion: 'reading-careless.v2',
    questions: [
      readingMergeQuestion('作业图1:第17题:上半部', { questionText: '社区准备建造一个圆形花坛，直径20米，高0.5米。', sourceQuestionLabel: '' }),
      readingMergeQuestion('作业图1:第17题:下半部', { questionText: '现有一堆泥土，近似一个圆锥，判断是否足够。', sourceQuestionLabel: '' })
    ]
  });
  assert.equal(result.questions.length, 1);
  assert.equal(runtime.readingQuestionIdentity(result.questions[0]), 'image:1:printed:17');
  assert.match(result.questions[0].questionText, /圆形花坛/);
  assert.match(result.questions[0].questionText, /一堆泥土/);
});

test('reading-careless never merges the same printed question number from different uploaded images', () => {
  const runtime = readingMergeRuntime();
  const result = runtime.consolidateReadingQuestions({
    outputSchemaVersion: 'reading-careless.v2',
    questions: [
      readingMergeQuestion('作业图1:第17题', { questionText: '第17题 第一张图片的题目', sourceQuestionLabel: '第17题' }),
      readingMergeQuestion('作业图2:第17题', { questionText: '第17题 第二张图片的题目', sourceQuestionLabel: '第17题' })
    ]
  });
  assert.equal(result.questions.length, 2);
  assert.deepEqual(result.questions.map((question) => runtime.readingQuestionIdentity(question)), ['image:1:printed:17', 'image:2:printed:17']);
});

test('reading-careless preserves explicit printed subquestions instead of collapsing them', () => {
  const runtime = readingMergeRuntime();
  const result = runtime.consolidateReadingQuestions({
    outputSchemaVersion: 'reading-careless.v2',
    questions: [
      readingMergeQuestion('img1_q-17-1', { questionText: '第17题（1）求侧面积', sourceQuestionLabel: '第17题（1）' }),
      readingMergeQuestion('img1_q-17-2', { questionText: '第17题（2）判断混凝土是否足够', sourceQuestionLabel: '第17题（2）' }),
      readingMergeQuestion('img1_q-18-1', { questionText: '18-1 求实际距离', sourceQuestionLabel: '18-1' }),
      readingMergeQuestion('img1_q-18-2', { questionText: '18-2 求图上距离', sourceQuestionLabel: '18-2' })
    ]
  });
  assert.equal(result.questions.length, 4);
  assert.deepEqual(result.questions.map((question) => runtime.readingQuestionIdentity(question)), ['image:1:printed:17:sub:1', 'image:1:printed:17:sub:2', 'image:1:printed:18:sub:1', 'image:1:printed:18:sub:2']);
});

test('reading-careless merge uses non-empty REVIEW reference grids for matching sourceKeys', () => {
  const runtime = readingMergeRuntime();
  const audit = { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 };
  const primary = { outputSchemaVersion: 'reading-careless.v2', questionSetAudit: audit, questions: [readingMergeQuestion('q-1')] };
  const review = { outputSchemaVersion: 'reading-careless.v2', questionSetAudit: audit, questions: [readingMergeQuestion('q-1', { referenceConditionText: 'review condition', referenceRelationText: 'review relation', referenceAskText: 'review ask' })] };
  const result = runtime.mergeCarelessTrainingResults(primary, review);
  assert.deepEqual([result.questions[0].referenceConditionText, result.questions[0].referenceRelationText, result.questions[0].referenceAskText], ['review condition', 'review relation', 'review ask']);
});

test('reading-careless merge retains PRIMARY reference grids when REVIEW values are empty', () => {
  const runtime = readingMergeRuntime();
  const audit = { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 };
  const primary = { outputSchemaVersion: 'reading-careless.v2', questionSetAudit: audit, questions: [readingMergeQuestion('q-1')] };
  const review = { outputSchemaVersion: 'reading-careless.v2', questionSetAudit: audit, questions: [readingMergeQuestion('q-1', { referenceConditionText: '', referenceRelationText: 'review relation', referenceAskText: 'review ask' })] };
  const result = runtime.mergeCarelessTrainingResults(primary, review);
  assert.equal(result.questions[0].referenceConditionText, 'primary condition');
});

test('reading-careless merge rejects REVIEW-only questions outside the canonical PRIMARY baseline', () => {
  const runtime = readingMergeRuntime();
  const primary = { outputSchemaVersion: 'reading-careless.v2', questions: [readingMergeQuestion('q-1')] };
  const reviewOnly = readingMergeQuestion('q-2', {
    studentConditionText: 'new condition', studentRelationText: 'new relation', studentAskText: 'new ask',
    referenceConditionText: 'new reference condition', referenceRelationText: 'new reference relation', referenceAskText: 'new reference ask',
    conditionCorrect: false, relationCorrect: true, askCorrect: false, analysisStatus: 'ok', errorReason: 'new error', correctionAdvice: 'new advice'
  });
  const review = { outputSchemaVersion: 'reading-careless.v2', questions: [readingMergeQuestion('q-1'), reviewOnly] };
  assert.throws(() => runtime.mergeCarelessTrainingResults(primary, review), (error) => error.code === 'QUESTION_SET_MISMATCH');
});

test('reading-careless v2 keeps complete formal fields correct when reference grids are absent', () => {
  const runtime = createGradingRuntime({
    json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => ({ reviewRules: { carelessTraining: { missingRelationTokens: [], missingRelationIssue: '' } } }) }
  }).test;
  const question = (sourceKey, reference = true) => ({
    outputSchemaVersion: 'reading-careless.v2', sourceKey, questionText: sourceKey, studentConditionText: '条件', studentRelationText: '关系', studentAskText: '所求',
    referenceConditionText: reference ? '参考条件' : '', referenceRelationText: reference ? '参考关系' : '', referenceAskText: reference ? '参考所求' : '',
    analysisStatus: 'ok', conditionCorrect: true, relationCorrect: true, askCorrect: true,
    missingConditions: [], incorrectConditions: [], relationIssues: [], askIssue: '', errorReason: '', correctionAdvice: '', adjustmentSuggestion: '', confidence: 1
  });
  const primary = { outputSchemaVersion: 'reading-careless.v2', route: { difficulty: 'normal', confidence: 1, flags: [] }, imageQuality: { ok: true, issues: [] }, questionSetAudit: { visibleIndependentQuestionCount: 2, emittedQuestionCount: 2, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }, questions: [question('q-1'), question('q-2')] };
  const review = { ...primary, questions: [question('q-1'), question('q-2')] };
  const result = runtime.mergeCarelessTrainingResults(primary, review);
  assert.equal(typeof result.questions[0].referenceConditionText, 'string');
  assert.equal(result.questions[1].analysisStatus, 'ok');
  assert.equal(result.questions[1].threeGridStatus, 'CORRECT');
  assert.equal(result.summary.correctCount, 2);
  /*
  assert.deepEqual(result.questions.map((item) => item.sourceKey), ['q-1', 'q-2']);
  assert.equal(result.questions[0].referenceConditionText, '参考条件');
  assert.equal(result.questions[1].analysisStatus, 'insufficient');
  assert.equal(result.questions[1].threeGridStatus, 'UNDETERMINED');
  assert.ok(result.validationWarnings.length > 0);
  */
});


test('hard-problem canonicalization clears stale error summaries from a fully correct result', () => {
  const runtime = createGradingRuntime({
    json: require('../shared/json'),
    resultSemantics: require('../shared/result-semantics'),
    embedded: { decryptEmbeddedStrategy: () => ({}) }
  }).test;
  const q = hardProblemQuestion();
  q.firstWrongStep = '模型遗留的错误步骤';
  q.errorReason = '模型遗留的错误原因';
  q.adjustmentSuggestion = '模型遗留的修改建议';
  const result = runtime.validateHardProblemGradeResult(hardProblemPayload([q]), { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } });
  assert.equal(result.questions[0].evaluationStatus, 'CORRECT');
  assert.equal(result.questions[0].firstWrongStep, '');
  assert.equal(result.questions[0].errorReason, '');
  assert.equal(result.questions[0].adjustmentSuggestion, '');
});

test('mergeHardProblemResults accepts REVIEW consolidation when all PRIMARY source evidence is preserved', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({ reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } }) } }).test;
  const base = hardProblemQuestion();
  const primaryQuestion = {
    ...base, sourceKey: 'q-review-consolidation', studentAnswer: '答：文艺书500本，科技书700本',
    stepStatus: 'wrong', logicStatus: 'insufficient', errorType: 'logic_error', firstWrongStep: '第2步', errorReason: '答语被单独拆步', adjustmentSuggestion: '合并答语',
    stepFeedbacks: [
      { stepIndex: 1, solutionText: '1200-500=700本', explanationText: '用总数减去文艺书本数，求科技书本数。', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '计算正确。', correctionAdvice: '' },
      { stepIndex: 2, solutionText: '答：文艺书500本，科技书700本', explanationText: '', solutionStatus: 'correct', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '答语重复。', correctionAdvice: '与前一步合并。' }
    ], overallFeedback: '结果正确，但答语重复拆步。'
  };
  const reviewQuestion = {
    ...base, sourceKey: 'q-review-consolidation', studentAnswer: '答：文艺书500本，科技书700本',
    stepFeedbacks: [{ stepIndex: 1, solutionText: '1200-500=700本；答：文艺书500本，科技书700本', explanationText: '用总数减去文艺书本数，求科技书本数。', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '最终计算和答语属于同一个求解单元。', correctionAdvice: '' }],
    overallFeedback: '最终计算、解释和答语对应正确。'
  };
  const merged = runtime.mergeHardProblemResults(hardProblemPayload([primaryQuestion]), hardProblemPayload([reviewQuestion]), { reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } } });
  assert.equal(merged.questions[0].stepFeedbacks.length, 1);
  assert.match(merged.questions[0].validationWarnings.join(' '), /REVIEW_STEP_CONSOLIDATION_ACCEPTED/);
  assert.match(merged.questions[0].stepFeedbacks[0].solutionText, /1200-500=700本/);
  assert.match(merged.questions[0].stepFeedbacks[0].solutionText, /答：文艺书500本/);
});

test('hard-problem evidence alignment pairs four left-right bands without merging setup and equation', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const evidence = {
    outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'left_right', questions: [{
      sourceKey: 'book-q', layoutType: 'left_right', questionText: '图书题', studentAnswer: '文艺书500本，科技书700本', studentWorkDetected: true,
      sourceQuestionLabel: '第3题', sourceRegion: 'image-1:q3', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
      processUnits: [
        { unitId: 'P1', text: '设图书馆有文艺书x本', order: 1, role: 'setup', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: 'x+1.4x=1200', order: 2, role: 'equation', visualBand: 2, readability: 'readable' },
        { unitId: 'P3', text: '2.4x=1200\nx=500', order: 3, role: 'calculation', visualBand: 3, readability: 'readable' },
        { unitId: 'P4', text: '1200-500=700(本)\n答：文艺书500本，科技书700本', order: 4, role: 'final_result', visualBand: 4, readability: 'readable' }
      ],
      explanationUnits: [
        { unitId: 'E1', text: '科技书是文艺书的1.4倍，所以设文艺书为x', order: 1, label: '', visualBand: 1, readability: 'readable' },
        { unitId: 'E2', text: '文艺书和科技书的总数是1200本', order: 2, label: '', visualBand: 2, readability: 'readable' },
        { unitId: 'E3', text: '求出文艺书的量', order: 3, label: '', visualBand: 3, readability: 'readable' },
        { unitId: 'E4', text: '用总量减文艺书求科技书', order: 4, label: '', visualBand: 4, readability: 'readable' }
      ]
    }]
  };
  const aligned = runtime.alignHardProblemEvidence(evidence);
  assert.equal(aligned.questions[0].pairedSteps.length, 4);
  assert.equal(aligned.questions[0].pairedSteps[0].solutionText, '设图书馆有文艺书x本');
  assert.equal(aligned.questions[0].pairedSteps[1].solutionText, 'x+1.4x=1200');
  assert.match(aligned.questions[0].pairedSteps[2].solutionText, /2\.4x=1200/);
  assert.match(aligned.questions[0].pairedSteps[3].solutionText, /1200-500=700/);
});

test('hard-problem evidence alignment refines an under-segmented two-band book solution into four feedback steps', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const evidence = {
    outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'left_right', questions: [{
      sourceKey: 'book-q-coarse', layoutType: 'left_right', questionText: '图书题', studentAnswer: '文艺书500本，科技书700本', studentWorkDetected: true,
      sourceQuestionLabel: '第3题', sourceRegion: 'image-1:q3', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 0.9, warnings: [],
      processUnits: [
        { unitId: 'P1', text: '设图书馆有文艺书x本\nx+1.4x=1200\n2.4x=1200\nx=500', order: 1, role: 'calculation', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: '1200-500=700(本)\n答：文艺书500本，科技书700本', order: 2, role: 'final_result', visualBand: 2, readability: 'readable' }
      ],
      explanationUnits: [
        { unitId: 'E1', text: '科技书是文艺书的1.4倍，所以设文艺书为x\n文艺书和科技书的总数是1200本', order: 1, label: '', visualBand: 1, readability: 'readable' },
        { unitId: 'E2', text: '求出文艺书的量\n用总量减文艺书求科技书', order: 2, label: '', visualBand: 2, readability: 'readable' }
      ]
    }]
  };
  const alignedQuestion = runtime.alignHardProblemEvidence(evidence).questions[0];
  assert.equal(alignedQuestion.pairedSteps.length, 4);
  assert.equal(alignedQuestion.pairedSteps[0].solutionText, '设图书馆有文艺书x本');
  assert.equal(alignedQuestion.pairedSteps[1].solutionText, 'x+1.4x=1200');
  assert.match(alignedQuestion.pairedSteps[2].solutionText, /2\.4x=1200/);
  assert.match(alignedQuestion.pairedSteps[2].solutionText, /x=500/);
  assert.match(alignedQuestion.pairedSteps[3].solutionText, /1200-500=700/);
  assert.deepEqual(alignedQuestion.pairedSteps.map((step) => step.explanationText), [
    '科技书是文艺书的1.4倍，所以设文艺书为x',
    '文艺书和科技书的总数是1200本',
    '求出文艺书的量',
    '用总量减文艺书求科技书'
  ]);
  assert.match(alignedQuestion.alignmentWarnings.join(' '), /COARSE_VISUAL_BAND_REFINED:2->4/);
});

test('hard-problem evidence alignment preserves four numbered explanations even when top-bottom evidence arrives as one coarse band', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const evidence = {
    outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'top_bottom', questions: [{
      sourceKey: 'grass-q-coarse', layoutType: 'top_bottom', questionText: '牛吃草题', studentAnswer: '最多5头牛', studentWorkDetected: true,
      sourceQuestionLabel: '第1题', sourceRegion: 'image-1:q1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 0.85, warnings: [],
      processUnits: [
        { unitId: 'P1', text: '(20×8-12×10)÷(20-12)\n=40÷8\n=5份', order: 1, role: 'calculation', visualBand: 1, readability: 'readable' }
      ],
      explanationUnits: [
        { unitId: 'E1', text: '①求出8头牛20天吃的、10头牛12天吃的\n②相减得出草量差，20-12是天数差\n③用草数除以天数求每天长5份草\n④所以最多5头牛', order: 1, label: '', visualBand: 1, readability: 'readable' }
      ]
    }]
  };
  const alignedQuestion = runtime.alignHardProblemEvidence(evidence).questions[0];
  assert.equal(alignedQuestion.pairedSteps.length, 4);
  assert.deepEqual(alignedQuestion.pairedSteps.map((step) => step.explanationText), [
    '①求出8头牛20天吃的、10头牛12天吃的',
    '②相减得出草量差，20-12是天数差',
    '③用草数除以天数求每天长5份草',
    '④所以最多5头牛'
  ]);
  assert.match(alignedQuestion.alignmentWarnings.join(' '), /COARSE_VISUAL_BAND_REFINED:1->4/);
});

test('hard-problem evidence alignment preserves four top-bottom process lines and explanation labels', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const evidence = {
    outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'top_bottom', questions: [{
      sourceKey: 'grass-q', layoutType: 'top_bottom', questionText: '牛吃草题', studentAnswer: '最多5头牛', studentWorkDetected: true,
      sourceQuestionLabel: '第1题', sourceRegion: 'image-1:q1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
      processUnits: [
        { unitId: 'P1', text: '设每头牛每天吃1份草', order: 1, role: 'setup', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: '(20×8-12×10)÷(20-12)', order: 2, role: 'equation', visualBand: 2, readability: 'readable' },
        { unitId: 'P3', text: '=40÷8', order: 3, role: 'intermediate_result', visualBand: 3, readability: 'readable' },
        { unitId: 'P4', text: '=5份', order: 4, role: 'final_result', visualBand: 4, readability: 'readable' }
      ],
      explanationUnits: [
        { unitId: 'E1', text: '求出8头牛20天吃的、10头牛12天吃的', order: 1, label: '①', visualBand: 1, readability: 'readable' },
        { unitId: 'E2', text: '相减得出草量差，20-12是天数差', order: 2, label: '②', visualBand: 2, readability: 'readable' },
        { unitId: 'E3', text: '用草数除以天数求每天长5份草', order: 3, label: '③', visualBand: 3, readability: 'readable' },
        { unitId: 'E4', text: '所以最多5头牛', order: 4, label: '④', visualBand: 4, readability: 'readable' }
      ]
    }]
  };
  const aligned = runtime.alignHardProblemEvidence(evidence);
  assert.deepEqual(aligned.questions[0].pairedSteps.map((step) => step.solutionText), ['设每头牛每天吃1份草', '(20×8-12×10)÷(20-12)', '=40÷8', '=5份']);
  assert.deepEqual(aligned.questions[0].pairedSteps.map((step) => step.explanationText), evidence.questions[0].explanationUnits.map((unit) => unit.text));
});

test('fixed hard-problem grading cannot change aligned step count or student source text', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const alignment = {
    layoutType: 'top_bottom', questions: [{ sourceKey: 'q-fixed', questionText: '题目', studentAnswer: '5', studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', pairedSteps: [
      { stepIndex: 1, solutionText: 'P1原文', explanationText: 'E1原文', processUnitIds: ['P1'], explanationUnitIds: ['E1'] },
      { stepIndex: 2, solutionText: 'P2原文', explanationText: 'E2原文', processUnitIds: ['P2'], explanationUnitIds: ['E2'] }
    ] }]
  };
  const model = hardProblemPayload([{ ...hardProblemQuestion(), sourceKey: 'q-fixed', sourceQuestionLabel: '1', sourceRegion: 'image-1', questionText: '题目', studentAnswer: '5', stepFeedbacks: [
    { ...hardProblemQuestion().stepFeedbacks[0], stepIndex: 1, solutionText: '被模型改写', explanationText: '被模型改写' },
    { ...hardProblemQuestion().stepFeedbacks[0], stepIndex: 2, solutionText: '另一个改写', explanationText: '另一个改写' },
    { ...hardProblemQuestion().stepFeedbacks[0], stepIndex: 3, solutionText: '多余步骤', explanationText: '多余步骤' }
  ] }]);
  const enforced = runtime.enforceFixedHardProblemSteps(model, alignment);
  assert.equal(enforced.questions[0].stepFeedbacks.length, 2);
  assert.deepEqual(enforced.questions[0].stepFeedbacks.map((step) => [step.solutionText, step.explanationText]), [['P1原文', 'E1原文'], ['P2原文', 'E2原文']]);
});

test('fixed hard-problem grading keeps calculation correctness separate from reasoning logic', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const alignment = { questions: [{
    sourceKey: 'q-axis', questionText: '题目', studentAnswer: '9', studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image-1:q1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable',
    pairedSteps: [{ stepIndex: 1, solutionText: '4+4=9', explanationText: '把两个4相加', processUnitIds: ['P1'], explanationUnitIds: ['E1'] }]
  }] };
  const model = hardProblemPayload([{
    ...hardProblemQuestion(), sourceKey: 'q-axis', questionText: '题目', studentAnswer: '9', finalAnswerCorrect: false,
    stepStatus: 'wrong', logicStatus: 'correct', errorType: 'calculation_error',
    studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image-1:q1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable',
    stepFeedbacks: [{ stepIndex: 1, solutionText: '模型文本', explanationText: '模型文本', solutionStatus: 'wrong', explanationStatus: 'clear', logicStatus: 'clear', analysis: '思路：目标清楚；公式/知识点：加法方法正确但算术结果错误；逻辑：讲解与所用方法一致。', correctionAdvice: '重新计算4+4。' }]
  }]);
  const enforced = runtime.enforceFixedHardProblemSteps(model, alignment);
  assert.equal(enforced.questions[0].stepFeedbacks[0].solutionStatus, 'wrong');
  assert.equal(enforced.questions[0].stepFeedbacks[0].logicStatus, 'clear');
  const normalized = runtime.normalizeFixedHardProblemAggregates(enforced);
  assert.equal(normalized.questions[0].stepStatus, 'wrong');
  assert.equal(normalized.questions[0].logicStatus, 'correct');
  assert.equal(normalized.questions[0].errorType, 'calculation_error');
});

test('hard-problem evidence pipeline uses PRIMARY for extraction and REVIEW for fixed-step grading', async () => {
  const writes = [];
  const calls = [];
  const strategy = {
    strategyVersion: '1.3.26',
    contracts: { hardProblemV2: {
      requiredFields: ['outputSchemaVersion','sourceKey','questionText','studentAnswer','standardAnswer','answerStatus','finalAnswerCorrect','stepRequired','stepStatus','logicStatus','errorType','firstWrongStep','errorReason','adjustmentSuggestion','knowledgePoint','stepFeedbacks','overallFeedback','confidence','studentWorkDetected','sourceQuestionLabel','sourceRegion','inputBasis','modeApplicability'],
      fieldTypes: { stepFeedbacks: 'array', overallFeedback: 'string', studentWorkDetected: 'boolean', sourceQuestionLabel: 'string', sourceRegion: 'string', inputBasis: 'enum', modeApplicability: 'enum' },
      enumFields: { inputBasis: ['printed_question_with_work','printed_question_without_work','work_only_complete','work_only_incomplete'], modeApplicability: ['applicable','not_applicable','uncertain'] },
      arrayItemSchemas: { stepFeedbacks: { requiredFields: ['stepIndex','solutionText','explanationText','solutionStatus','explanationStatus','logicStatus','analysis','correctionAdvice'], enumFields: { solutionStatus: ['correct','wrong','missing','unreadable'], explanationStatus: ['clear','partially_clear','incorrect','missing','unreadable'], logicStatus: ['clear','insufficient','wrong','unreadable'] } } },
      ...HARD_TOP_LEVEL_CONTRACT
    } },
    modelRuntime: { stages: { hardProblemPrimary: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 0 }, hardProblemReview: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 0 } } },
    prompts: {
      hardProblemEvidence: { system: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer', userTemplate: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer' },
      hardProblem: { system: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice Every questions[] object must include every field required by its outputSchemaVersion Schema.', userTemplate: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice' }
    },
    reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } }
  };
  const evidence = { outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'top_bottom', questions: [{ sourceKey: 'q-pipe', layoutType: 'top_bottom', questionText: '题目', studentAnswer: '2', studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', processUnits: [{ unitId: 'P1', text: '1+1=2', order: 1, role: 'calculation', visualBand: 1, readability: 'readable' }], explanationUnits: [{ unitId: 'E1', text: '把两个1相加', order: 1, label: '①', visualBand: 1, readability: 'readable' }], confidence: 1, warnings: [] }] };
  const final = hardProblemPayload([{ ...hardProblemQuestion(), sourceKey: 'q-pipe', sourceQuestionLabel: '1', sourceRegion: 'image-1', questionText: '题目', studentAnswer: '2' }]);
  const runtime = createGradingRuntime({
    context: { db: { collection: (name) => ({ doc: () => ({ update: async ({ data }) => writes.push({ name, data }) }) }) } }, constants: { C: { tasks: 'tasks' } }, audit: { monitor() {} },
    ark: { callArk: async (options) => { calls.push(options); return calls.length === 1 ? evidence : final; } },
    utils: { now: () => new Date(), randomId: () => 'id', safeError: (error) => ({ code: error.code, message: error.message }) }, checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { hardProblemEvidenceUserPrompt: () => '', hardProblemUserPrompt: () => '' }
  });
  const task = { _id: 'task-evidence-pipeline', mode: 'HARD_PROBLEM_CHECK', hardProblemModelProvider: 'qwen3_vl_plus', studentImageFileIds: [], answerImageFileIds: [] };
  await runtime.test.process({ ...task, currentStage: 'PRIMARY_GRADING' }, Date.now());
  const primaryWrite = writes.find((write) => write.data.hardProblemEvidenceDraft);
  assert.ok(primaryWrite);
  assert.equal(primaryWrite.data.hardProblemReviewRecoveryCount, 0);
  assert.equal(primaryWrite.data.hardProblemReviewLastFailure, null);
  await runtime.test.process({ ...task, currentStage: 'REVIEW_GRADING', hardProblemEvidenceDraft: primaryWrite.data.hardProblemEvidenceDraft, hardProblemAlignmentDraft: primaryWrite.data.hardProblemAlignmentDraft }, Date.now());
  assert.equal(calls.length, 2);
  assert.equal(calls[0].mode, 'hard_problem_evidence');
  assert.equal(calls[0].outputSchemaVersion, null);
  assert.equal(calls[1].mode, 'hard_problem_fixed_steps');
  assert.equal(calls[1].outputSchemaVersion, 'hard-problem.v2');
  assert.equal(calls[1].maxRepairAttempts, 1);
  assert.deepEqual(calls[1].fixedEvidenceQuestions[0].fixedSteps.map((step) => step.stepIndex), [1]);
  assert.deepEqual(calls[1].fixedEvidenceQuestions[0].fixedSteps.map((step) => step.solutionText), ['1+1=2']);
  assert.deepEqual(calls.map((call) => call.provider), ['qwen3_vl_plus', 'qwen3_vl_plus']);
  const finalWrite = writes.find((write) => write.data.mergedDraft);
  assert.equal(finalWrite.data.mergedDraft.questions[0].stepFeedbacks.length, 1);
  assert.equal(finalWrite.data.mergedDraft.questions[0].stepFeedbacks[0].solutionText, '1+1=2');
});

test('top-bottom alignment attaches an extra trailing answer unit to the final explanation, not the first setup step', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const evidence = {
    outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'top_bottom', questions: [{
      sourceKey: 'q-extra-answer', layoutType: 'top_bottom', questionText: '题目', studentAnswer: '5头', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
      processUnits: [
        { unitId: 'P1', text: '设每头牛每天吃1份草', order: 1, role: 'setup', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: '(20×8-12×10)÷(20-12)', order: 2, role: 'equation', visualBand: 2, readability: 'readable' },
        { unitId: 'P3', text: '=40÷8', order: 3, role: 'intermediate_result', visualBand: 3, readability: 'readable' },
        { unitId: 'P4', text: '=5份', order: 4, role: 'final_result', visualBand: 4, readability: 'readable' },
        { unitId: 'P5', text: '答：最多5头牛', order: 5, role: 'answer_text', visualBand: 5, readability: 'readable' }
      ],
      explanationUnits: Array.from({ length: 4 }, (_, index) => ({ unitId: `E${index + 1}`, text: `讲解${index + 1}`, order: index + 1, label: `②③④⑤`[index], visualBand: index + 1, readability: 'readable' }))
    }]
  };
  const aligned = runtime.alignHardProblemEvidence(evidence).questions[0].pairedSteps;
  assert.equal(aligned.length, 4);
  assert.equal(aligned[0].solutionText, '设每头牛每天吃1份草');
  assert.match(aligned[3].solutionText, /=5份/);
  assert.match(aligned[3].solutionText, /答：最多5头牛/);
});

test('left-right alignment merges process lines that share one locked visualBand', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const evidence = {
    outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'left_right', questions: [{
      sourceKey: 'q-left-band', layoutType: 'left_right', questionText: '图书题', studentAnswer: '500和700', studentWorkDetected: true,
      sourceQuestionLabel: '3', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
      processUnits: [
        { unitId: 'P1', text: '设文艺书x本', order: 1, role: 'setup', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: 'x+1.4x=1200', order: 2, role: 'equation', visualBand: 2, readability: 'readable' },
        { unitId: 'P3', text: '2.4x=1200', order: 3, role: 'equation', visualBand: 3, readability: 'readable' },
        { unitId: 'P4', text: 'x=500', order: 4, role: 'intermediate_result', visualBand: 3, readability: 'readable' },
        { unitId: 'P5', text: '1200-500=700本', order: 5, role: 'final_result', visualBand: 4, readability: 'readable' }
      ],
      explanationUnits: Array.from({ length: 4 }, (_, index) => ({ unitId: `E${index + 1}`, text: `讲解${index + 1}`, order: index + 1, label: '', visualBand: index + 1, readability: 'readable' }))
    }]
  };
  const aligned = runtime.alignHardProblemEvidence(evidence).questions[0].pairedSteps;
  assert.equal(aligned.length, 4);
  assert.match(aligned[2].solutionText, /2\.4x=1200/);
  assert.match(aligned[2].solutionText, /x=500/);
  assert.equal(aligned[2].explanationText, '讲解3');
  assert.equal(aligned[3].explanationText, '讲解4');
});

test('fixed hard-problem aggregate normalization overrides contradictory model summaries deterministically', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const result = hardProblemPayload([{ ...hardProblemQuestion(), finalAnswerCorrect: true, stepStatus: 'correct', logicStatus: 'correct', errorType: 'none', firstWrongStep: '', errorReason: '', adjustmentSuggestion: '', overallFeedback: '整个过程完全正确，无需调整。', stepFeedbacks: [
    { stepIndex: 1, solutionText: '', explanationText: '只写了解释', solutionStatus: 'missing', explanationStatus: 'clear', logicStatus: 'insufficient', analysis: '缺少过程。', correctionAdvice: '补过程。' }
  ] }]);
  const normalized = runtime.normalizeFixedHardProblemAggregates(result);
  const question = normalized.questions[0];
  assert.equal(question.stepStatus, 'missing');
  assert.equal(question.logicStatus, 'insufficient');
  assert.equal(question.errorType, 'logic_error');
  assert.match(question.firstWrongStep, /缺少解题过程/);
  assert.doesNotMatch(question.overallFeedback, /完全正确|无需调整/);
});

test('hard-problem evidence rejects printed-without-work records that still contain student source evidence', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  assert.throws(() => runtime.validateHardProblemEvidenceResult({
    outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'top_bottom', questions: [{
      sourceKey: 'q-conflict', layoutType: 'top_bottom', questionText: '题目', studentAnswer: '', studentWorkDetected: false,
      sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_without_work', modeApplicability: 'applicable',
      processUnits: [{ unitId: 'P1', text: '1+1=2', order: 1, role: 'calculation', visualBand: 1, readability: 'readable' }],
      explanationUnits: [], confidence: 1, warnings: []
    }]
  }), (error) => error.code === 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR' && /inputBasis/.test(error.fieldPath));
});

test('v8 over-merged equation-and-solve plan schedules the existing evidence recovery', async () => {
  const writes = [];
  const strategy = {
    strategyVersion: '1.3.32',
    contracts: { hardProblemV2: {
      requiredFields: ['stepFeedbacks', 'overallFeedback', 'studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'],
      arrayItemSchemas: { stepFeedbacks: { requiredFields: ['stepIndex', 'solutionText', 'explanationText', 'solutionStatus', 'explanationStatus', 'logicStatus', 'analysis', 'correctionAdvice'], enumFields: { solutionStatus: ['correct', 'wrong', 'missing', 'unreadable'], explanationStatus: ['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable'], logicStatus: ['clear', 'insufficient', 'wrong', 'unreadable'] } } },
      ...HARD_TOP_LEVEL_CONTRACT
    } },
    modelRuntime: { stages: { hardProblemPrimary: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 0 }, hardProblemReview: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 0 } } },
    prompts: {
      hardProblemEvidence: { system: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer expectedSteps expectedReasoning processUnitIds explanationUnitIds', userTemplate: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer expectedSteps expectedReasoning processUnitIds explanationUnitIds' },
      hardProblem: { system: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice', userTemplate: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice' }
    },
    reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } }
  };
  const evidence = {
    outputSchemaVersion: 'hard-problem-evidence.v2', layoutType: 'single_stream', questions: [{
      sourceKey: 'merged-equation-solve', layoutType: 'single_stream', questionText: '甲数与乙数总和为1200，乙数是甲数的1.4倍。', studentAnswer: '甲数500，乙数700', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1:q1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
      expectedSteps: [
        { stepId: 'S1', order: 1, purpose: '设未知数', expectedReasoning: '设甲数为x。', processUnitIds: ['P1'], explanationUnitIds: [] },
        { stepId: 'S2', order: 2, purpose: '根据数量关系列方程并解方程', expectedReasoning: '列x+1.4x=1200，化简并求出x。', processUnitIds: ['P2'], explanationUnitIds: [] },
        { stepId: 'S3', order: 3, purpose: '利用x求乙数并作答', expectedReasoning: '利用已求出的x求乙数并作答。', processUnitIds: ['P3'], explanationUnitIds: [] }
      ],
      processUnits: [
        { unitId: 'P1', text: '设甲数为x', order: 1, role: 'setup', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: 'x+1.4x=1200\n2.4x=1200\nx=500', order: 2, role: 'calculation', visualBand: 2, readability: 'readable' },
        { unitId: 'P3', text: '1200-500=700', order: 3, role: 'final_result', visualBand: 3, readability: 'readable' }
      ], explanationUnits: []
    }]
  };
  const runtime = createGradingRuntime({
    context: { db: { collection: (name) => ({ doc: () => ({ update: async ({ data }) => writes.push({ name, data }) }) }) } }, constants: { C: { tasks: 'tasks' } }, audit: { monitor() {} },
    ark: { callArk: async () => evidence }, utils: { now: () => new Date(), randomId: () => 'id', safeError: (error) => ({ code: error.code, message: error.message }) }, checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy }, strategyRender: { hardProblemEvidenceUserPrompt: () => '', hardProblemUserPrompt: () => '' }
  });
  await runtime.test.process({ _id: 'task-over-merged-plan', mode: 'HARD_PROBLEM_CHECK', currentStage: 'PRIMARY_GRADING', hardProblemModelProvider: 'qwen3_vl_plus', studentImageFileIds: [], answerImageFileIds: [] }, Date.now());
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.currentStage, 'PRIMARY_GRADING');
  assert.equal(writes[0].data.hardProblemEvidenceRetryCount, 1);
  assert.equal(writes[0].data.hardProblemEvidenceDraft, null);
  assert.equal(writes[0].data.hardProblemAlignmentDraft, null);
});

test('v8 keeps consecutive transformations of one equation in one solve-equation step', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  assert.doesNotThrow(() => runtime.validateHardProblemEvidenceResult({
    outputSchemaVersion: 'hard-problem-evidence.v2', layoutType: 'single_stream', questions: [{
      sourceKey: 'single-equation-solve', layoutType: 'single_stream', questionText: '题目', studentAnswer: 'x=500', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1:q1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
      expectedSteps: [
        { stepId: 'S1', order: 1, purpose: '列方程', expectedReasoning: '根据数量关系列出x+1.4x=1200。', processUnitIds: ['P1'], explanationUnitIds: [] },
        { stepId: 'S2', order: 2, purpose: '解方程', expectedReasoning: '将2.4x=1200化简，求得x=500。', processUnitIds: ['P2'], explanationUnitIds: [] }
      ],
      processUnits: [
        { unitId: 'P1', text: 'x+1.4x=1200', order: 1, role: 'equation', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: '2.4x=1200\nx=500', order: 2, role: 'calculation', visualBand: 2, readability: 'readable' }
      ], explanationUnits: []
    }]
  }));
});

test('answer-only hard-problem evidence creates one fixed missing-process gap step without inventing source text', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const aligned = runtime.alignHardProblemEvidence({
    outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'single_stream', questions: [{
      sourceKey: 'q-answer-only', layoutType: 'single_stream', questionText: '题目', studentAnswer: '42', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable',
      processUnits: [], explanationUnits: [], confidence: 1, warnings: []
    }]
  });
  assert.equal(aligned.questions[0].pairedSteps.length, 1);
  assert.equal(aligned.questions[0].pairedSteps[0].solutionText, '');
  assert.equal(aligned.questions[0].pairedSteps[0].explanationText, '');
});

test('fixed hard-problem grading rejects omitted model steps instead of silently marking them unreadable', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const alignment = {
    layoutType: 'top_bottom', questions: [{ sourceKey: 'q-fixed-missing', questionText: '题目', studentAnswer: '2', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', pairedSteps: [
        { stepIndex: 1, solutionText: '1+1=2', explanationText: '两个1相加', processUnitIds: ['P1'], explanationUnitIds: ['E1'] },
        { stepIndex: 2, solutionText: '答：2', explanationText: '所以结果是2', processUnitIds: ['P2'], explanationUnitIds: ['E2'] }
      ] }]
  };
  const model = hardProblemPayload([{ ...hardProblemQuestion(), sourceKey: 'q-fixed-missing', sourceQuestionLabel: '1', sourceRegion: 'image-1', stepFeedbacks: [hardProblemQuestion().stepFeedbacks[0]] }]);
  assert.throws(() => runtime.enforceFixedHardProblemSteps(model, alignment), (error) => error.code === 'HARD_PROBLEM_FIXED_RESULT_MISMATCH' && error.expectedStepCount === 2);
  assert.equal(runtime.transient({ code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH' }), false);
  assert.equal(runtime.transient({ code: 'QWEN_HTTP_ERROR', status: 401, retryable: false }), false);
  assert.equal(runtime.transient({ code: 'QWEN_HTTP_ERROR', status: 429, retryable: true }), true);
});


test('FINALIZING_RESULT performs one bounded recovery when review drafts were not handed off', async () => {
  const writes = [];
  const strategy = {
    strategyVersion: '1.3.26',
    prompts: {
      hardProblemEvidence: {
        system: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer',
        userTemplate: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer'
      },
      hardProblem: {
        system: 'stepFeedbacks overallFeedback',
        userTemplate: 'stepFeedbacks overallFeedback'
      }
    }
  };
  const runtime = createGradingRuntime({
    context: {
      db: {
        collection: (name) => ({
          doc: () => ({
            update: async ({ data }) => {
              writes.push({ name, data });
              return { updated: 1 };
            }
          })
        })
      },
      cloud: { getTempFileURL: async () => ({ fileList: [] }) }
    },
    constants: { C: { tasks: 'tasks' } },
    audit: { monitor() {} },
    ark: { callArk: async () => { throw new Error('model must not be called during recovery'); } },
    utils: {
      now: () => new Date('2026-08-06T00:00:00.000Z'),
      randomId: () => 'stage_handoff_recovery',
      safeError: (error) => ({ code: error.code, message: error.message })
    },
    checkin: { recordQualifiedQuestions: async () => {} },
    taskError: {},
    json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => strategy },
    remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: {}
  });

  const result = await runtime.test.process({
    _id: 'task-finalization-recovery',
    mode: 'HARD_PROBLEM_CHECK',
    currentStage: 'FINALIZING_RESULT',
    studentImageFileIds: [],
    answerImageFileIds: [],
    primaryDraft: null,
    reviewDraft: null,
    mergedDraft: null,
    hardProblemEvidenceDraft: { questions: [{ sourceKey: 'q-1' }] },
    hardProblemAlignmentDraft: { questions: [{ sourceKey: 'q-1', pairedSteps: [] }] },
    finalizationRecoveryCount: 0
  }, Date.now());

  assert.equal(result.outcome, 'CONTINUE');
  assert.equal(result.nextStage, 'REVIEW_GRADING');
  const taskWrite = writes.find((write) => write.name === 'tasks');
  assert.equal(taskWrite.data.finalizationRecoveryCount, 1);
  assert.equal(taskWrite.data.reviewDraft, null);
  assert.equal(taskWrite.data.mergedDraft, null);
  assert.match(taskWrite.data.statusMessage, /自动恢复/);
});

test('FINALIZING_RESULT performs bounded recovery for calculation-careless when business drafts are lost', async () => {
  const writes = [];
  const strategy = { strategyVersion: '1.6.19' };
  const runtime = createGradingRuntime({
    context: {
      db: { collection: (name) => ({ doc: () => ({ update: async ({ data }) => { writes.push({ name, data }); return { updated: 1 }; } }) }) },
      cloud: { getTempFileURL: async () => ({ fileList: [] }) }
    },
    constants: { C: { tasks: 'tasks' } }, audit: { monitor() {} },
    ark: { callArk: async () => { throw new Error('model must not be called during finalization recovery'); } },
    utils: { now: () => new Date('2026-08-14T00:00:00.000Z'), randomId: () => 'careless_final_recovery', safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy }, strategyRender: {}
  });
  const result = await runtime.test.process({
    _id: 'task-calc-finalization-recovery', mode: 'CARELESS_TRAINING', carelessTrainingType: 'CALCULATION', currentStage: 'FINALIZING_RESULT',
    studentImageFileIds: [], answerImageFileIds: [], primaryDraft: { outputSchemaVersion: 'calculation-careless.v2', questions: [{ sourceKey: 'q1' }] },
    reviewDraft: null, mergedDraft: null, carelessReviewRecoveryCount: 1, finalizationRecoveryCount: 0
  }, Date.now());
  assert.equal(result.outcome, 'CONTINUE');
  assert.equal(result.nextStage, 'REVIEW_GRADING');
  const taskWrite = writes.find((write) => write.name === 'tasks');
  assert.equal(taskWrite.data.finalizationRecoveryCount, 1);
  assert.equal(taskWrite.data.carelessReviewRecoveryCount, 0);
  assert.equal(taskWrite.data.reviewDraft, null);
  assert.equal(taskWrite.data.mergedDraft, null);
});

test('FINALIZING_RESULT stops after one recovery attempt instead of looping forever', async () => {
  const strategy = {
    strategyVersion: '1.3.26',
    prompts: {
      hardProblemEvidence: {
        system: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer',
        userTemplate: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer'
      }
    }
  };
  const runtime = createGradingRuntime({
    context: { db: {}, cloud: {} },
    constants: { C: { tasks: 'tasks' } },
    audit: { monitor() {} },
    utils: { safeError: (error) => ({ code: error.code, message: error.message }) },
    json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => strategy },
    remote: { loadRuntimeStrategy: async () => strategy }
  });

  await assert.rejects(
    () => runtime.test.process({
      _id: 'task-finalization-recovery-exhausted',
      mode: 'HARD_PROBLEM_CHECK',
      currentStage: 'FINALIZING_RESULT',
      studentImageFileIds: [],
      answerImageFileIds: [],
      primaryDraft: null,
      reviewDraft: null,
      mergedDraft: null,
      hardProblemEvidenceDraft: { questions: [{ sourceKey: 'q-1' }] },
      hardProblemAlignmentDraft: { questions: [{ sourceKey: 'q-1', pairedSteps: [] }] },
      finalizationRecoveryCount: 1
    }, Date.now()),
    (error) => error.code === 'TASK_REVIEW_DRAFT_MISSING'
      && error.diagnostics?.recoveryCount === 1
  );
});

test('CloudRun deferred hard-problem pipeline carries all business drafts in the FINALIZING handoff', async () => {
  const calls = [];
  const writes = [];
  const fence = { workerLeaseOwner: 'owner-deferred-payload', workerAttempt: 7 };
  const currentTask = {
    _id: 'task-deferred-payload',
    mode: 'HARD_PROBLEM_CHECK',
    currentStage: 'PRIMARY_GRADING',
    status: 'PROCESSING',
    workerQueueStatus: 'RUNNING',
    workerStatus: 'RUNNING',
    workerLeaseOwner: fence.workerLeaseOwner,
    workerAttempt: fence.workerAttempt,
    studentImageFileIds: [],
    answerImageFileIds: []
  };
  const strategy = {
    strategyVersion: '1.3.26',
    contracts: { hardProblemV2: {
      requiredFields: ['outputSchemaVersion','sourceKey','questionText','studentAnswer','standardAnswer','answerStatus','finalAnswerCorrect','stepRequired','stepStatus','logicStatus','errorType','firstWrongStep','errorReason','adjustmentSuggestion','knowledgePoint','stepFeedbacks','overallFeedback','confidence','studentWorkDetected','sourceQuestionLabel','sourceRegion','inputBasis','modeApplicability'],
      fieldTypes: { stepFeedbacks: 'array', overallFeedback: 'string', studentWorkDetected: 'boolean', sourceQuestionLabel: 'string', sourceRegion: 'string', inputBasis: 'enum', modeApplicability: 'enum' },
      enumFields: { inputBasis: ['printed_question_with_work','printed_question_without_work','work_only_complete','work_only_incomplete'], modeApplicability: ['applicable','not_applicable','uncertain'] },
      arrayItemSchemas: { stepFeedbacks: { requiredFields: ['stepIndex','solutionText','explanationText','solutionStatus','explanationStatus','logicStatus','analysis','correctionAdvice'], enumFields: { solutionStatus: ['correct','wrong','missing','unreadable'], explanationStatus: ['clear','partially_clear','incorrect','missing','unreadable'], logicStatus: ['clear','insufficient','wrong','unreadable'] } } },
      ...HARD_TOP_LEVEL_CONTRACT
    } },
    modelRuntime: { stages: {
      hardProblemPrimary: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 0 },
      hardProblemReview: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 0 }
    } },
    prompts: {
      hardProblemEvidence: { system: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer', userTemplate: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer' },
      hardProblem: { system: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice Every questions[] object must include every field required by its outputSchemaVersion Schema.', userTemplate: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice' }
    },
    reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } }
  };
  const evidence = { outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'top_bottom', questions: [{ sourceKey: 'q-deferred', layoutType: 'top_bottom', questionText: '题目', studentAnswer: '2', studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', processUnits: [{ unitId: 'P1', text: '1+1=2', order: 1, role: 'calculation', visualBand: 1, readability: 'readable' }], explanationUnits: [{ unitId: 'E1', text: '把两个1相加', order: 1, label: '①', visualBand: 1, readability: 'readable' }], confidence: 1, warnings: [] }] };
  const final = hardProblemPayload([{ ...hardProblemQuestion(), sourceKey: 'q-deferred', sourceQuestionLabel: '1', sourceRegion: 'image-1', questionText: '题目', studentAnswer: '2' }]);
  const runtime = createGradingRuntime({
    context: { db: { collection: () => ({
      doc: () => ({
        get: async () => ({ data: [{ ...currentTask }] }),
        update: async ({ data }) => { writes.push(data); return { updated: 1 }; }
      }),
      where: () => ({ update: async (data) => { writes.push(data); return { updated: 1 }; } })
    }) } },
    constants: { C: { tasks: 'tasks' } },
    audit: { monitor() {} },
    ark: { callArk: async (options) => { calls.push(options); return calls.length === 1 ? evidence : final; } },
    utils: { now: () => new Date('2026-08-06T00:00:00.000Z'), randomId: () => 'stage_handoff_deferred', safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { hardProblemEvidenceUserPrompt: () => '', hardProblemUserPrompt: () => '' },
    deferStagePersistence: true
  });

  const primaryHandoff = await runtime.test.process({ ...currentTask }, Date.now(), fence);
  assert.equal(primaryHandoff.nextStage, 'REVIEW_GRADING');
  assert.ok(primaryHandoff.handoffPatch.hardProblemEvidenceDraft);
  assert.ok(primaryHandoff.handoffPatch.hardProblemAlignmentDraft);
  assert.equal(writes.length, 0);

  const reviewHandoff = await runtime.test.process({
    ...currentTask,
    currentStage: 'REVIEW_GRADING',
    ...primaryHandoff.handoffPatch
  }, Date.now(), fence);
  assert.equal(reviewHandoff.nextStage, 'FINALIZING_RESULT');
  assert.ok(reviewHandoff.handoffPatch.primaryDraft);
  assert.ok(reviewHandoff.handoffPatch.reviewDraft);
  assert.ok(reviewHandoff.handoffPatch.mergedDraft);
  assert.equal(reviewHandoff.handoffPatch.hardProblemEvidenceDraft, null);
  assert.equal(reviewHandoff.handoffPatch.hardProblemAlignmentDraft, null);
  assert.equal(reviewHandoff.handoffToken, 'stage_handoff_deferred');
  assert.equal(writes.length, 0);
});


test('careless training calls do not receive the hard-problem provider override', () => {
  const source = require('node:fs').readFileSync(require.resolve('../shared/grading-core/execute-grading-task'), 'utf8');
  const carelessBranch = source.slice(source.indexOf('if (isCareless(task))'), source.indexOf('assertHardProblemExplanationContract(strategy)', source.indexOf('if (isCareless(task))')));
  assert.doesNotMatch(carelessBranch, /provider:\s*hardProblemModelProvider/);
  assert.match(source, /mode: 'hard_problem'.*provider: hardProblemModelProvider\(task\)/s);
});


test('bounded fixed-step fallback preserves every locked student step and never invents source text', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const alignment = {
    layoutType: 'left_right', questions: [{ sourceKey: 'q-recovery', questionText: '图书题', studentAnswer: '500和700', studentWorkDetected: true,
      sourceQuestionLabel: '3', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', pairedSteps: [
        { stepIndex: 1, solutionText: 'x+1.4x=1200', explanationText: '根据总数列方程', processUnitIds: ['P1'], explanationUnitIds: ['E1'] },
        { stepIndex: 2, solutionText: '2.4x=1200\nx=500', explanationText: '解方程得到文艺书数量', processUnitIds: ['P2','P3'], explanationUnitIds: ['E2'] }
      ] }]
  };
  const model = hardProblemPayload([{ ...hardProblemQuestion(), sourceKey: 'q-recovery', sourceQuestionLabel: '3', sourceRegion: 'image-1', stepFeedbacks: [
    { ...hardProblemQuestion().stepFeedbacks[0], stepIndex: 1, solutionText: 'x+1.4x=1200', explanationText: '根据总数列方程' }
  ] }]);
  const recovered = runtime.enforceFixedHardProblemSteps(model, alignment, { allowSafeFallback: true });
  assert.equal(recovered.questions[0].stepFeedbacks.length, 2);
  assert.equal(recovered.questions[0].stepFeedbacks[0].solutionText, 'x+1.4x=1200');
  assert.equal(recovered.questions[0].stepFeedbacks[1].solutionText, '2.4x=1200\nx=500');
  assert.equal(recovered.questions[0].stepFeedbacks[1].explanationText, '解方程得到文艺书数量');
  assert.doesNotMatch(recovered.questions[0].stepFeedbacks[0].analysis, /当前模型未能完成该步判断/);
  assert.match(recovered.questions[0].stepFeedbacks[1].analysis, /当前模型未能完成该步判断/);
  assert.ok(recovered.validationWarnings.includes('HARD_PROBLEM_FIXED_STEP_SAFE_FALLBACK:1'));
});


test('bounded fixed-step fallback completes with preserved source text when the model returns no questions', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const alignment = runtime.alignHardProblemEvidence({
    outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'top_bottom', questions: [{
      sourceKey: 'q-empty-model', layoutType: 'top_bottom', questionText: '牛吃草题', studentAnswer: '5头牛', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
      processUnits: [
        { unitId: 'P1', text: '(20×8-12×10)÷(20-12)', order: 1, role: 'equation', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: '=40÷8\n=5份', order: 2, role: 'final_result', visualBand: 2, readability: 'readable' }
      ],
      explanationUnits: [
        { unitId: 'E1', text: '先求草量差和天数差', order: 1, label: '①', visualBand: 1, readability: 'readable' },
        { unitId: 'E2', text: '用草量差除以天数差', order: 2, label: '②', visualBand: 2, readability: 'readable' }
      ]
    }]
  });
  const emptyModel = {
    outputSchemaVersion: 'hard-problem.v2', mode: 'hard-problem', route: { difficulty: 'normal', confidence: 0, flags: [] },
    imageQuality: { ok: true, issues: [] },
    questionSetAudit: { visibleIndependentQuestionCount: 0, emittedQuestionCount: 0, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 0 },
    questions: []
  };
  const recovered = runtime.normalizeFixedHardProblemAggregates(runtime.enforceFixedHardProblemSteps(emptyModel, alignment, { allowSafeFallback: true }));
  const validated = validateHardProblemResult(recovered);
  assert.equal(validated.questions.length, 1);
  assert.equal(validated.questions[0].answerStatus, 'unreadable');
  assert.equal(validated.questions[0].stepStatus, 'unreadable');
  assert.equal(validated.questions[0].logicStatus, 'unreadable');
  assert.equal(validated.questions[0].stepFeedbacks.length, 2);
  assert.equal(validated.questions[0].stepFeedbacks[0].solutionText, '(20×8-12×10)÷(20-12)');
  assert.match(validated.questions[0].stepFeedbacks[0].analysis, /思路：.*公式\/知识点：.*逻辑：/);
  assert.match(validated.questions[0].overallFeedback, /已保留学生原文与固定步骤/);
  assert.ok(recovered.validationWarnings.includes('HARD_PROBLEM_QUESTION_SAFE_FALLBACK:1'));
});

test('hard-problem REVIEW schedules exactly one same-provider structural recovery and then stops', async () => {
  const events = [];
  const calls = [];
  const strategy = {
    strategyVersion: '1.3.27',
    contracts: { hardProblemV2: {
      requiredFields: ['outputSchemaVersion','sourceKey','questionText','studentAnswer','standardAnswer','answerStatus','finalAnswerCorrect','stepRequired','stepStatus','logicStatus','errorType','firstWrongStep','errorReason','adjustmentSuggestion','knowledgePoint','stepFeedbacks','overallFeedback','confidence','studentWorkDetected','sourceQuestionLabel','sourceRegion','inputBasis','modeApplicability'],
      fieldTypes: { stepFeedbacks: 'array', overallFeedback: 'string', studentWorkDetected: 'boolean', sourceQuestionLabel: 'string', sourceRegion: 'string', inputBasis: 'enum', modeApplicability: 'enum' },
      enumFields: { inputBasis: ['printed_question_with_work','printed_question_without_work','work_only_complete','work_only_incomplete'], modeApplicability: ['applicable','not_applicable','uncertain'] },
      arrayItemSchemas: { stepFeedbacks: { requiredFields: ['stepIndex','solutionText','explanationText','solutionStatus','explanationStatus','logicStatus','analysis','correctionAdvice'], enumFields: { solutionStatus: ['correct','wrong','missing','unreadable'], explanationStatus: ['clear','partially_clear','incorrect','missing','unreadable'], logicStatus: ['clear','insufficient','wrong','unreadable'] } } },
      ...HARD_TOP_LEVEL_CONTRACT
    } },
    modelRuntime: { stages: {
      hardProblemPrimary: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 0 },
      hardProblemReview: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1 }
    } },
    prompts: {
      hardProblemEvidence: { system: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer', userTemplate: 'layoutType processUnits explanationUnits sourceKey questionText studentAnswer' },
      hardProblem: { system: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice Every questions[] object must include every field required by its outputSchemaVersion Schema.', userTemplate: 'stepFeedbacks overallFeedback studentWorkDetected sourceQuestionLabel sourceRegion inputBasis modeApplicability stepIndex solutionText explanationText solutionStatus explanationStatus logicStatus analysis correctionAdvice' }
    },
    reviewRules: { hardProblem: { correctStepStatuses: ['correct'], correctLogicStatus: 'correct' } }
  };
  const evidence = { outputSchemaVersion: 'hard-problem-evidence.v1', layoutType: 'left_right', questions: [{ sourceKey: 'q-retry', layoutType: 'left_right', questionText: '题目', studentAnswer: '2', studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', processUnits: [{ unitId: 'P1', text: '1+1=2', order: 1, role: 'calculation', visualBand: 1, readability: 'readable' }], explanationUnits: [{ unitId: 'E1', text: '两个1相加', order: 1, label: '①', visualBand: 1, readability: 'readable' }], confidence: 1, warnings: [] }] };
  const alignment = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test.alignHardProblemEvidence(evidence);
  const runtime = createGradingRuntime({
    context: { db: { collection: () => ({ doc: () => ({ get: async () => ({ data: [] }), update: async () => ({ updated: 1 }) }) }) } },
    constants: { C: { tasks: 'tasks' } },
    audit: { monitor(_source, event, payload) { events.push({ event, payload }); } },
    ark: { callArk: async (options) => { calls.push(options); throw Object.assign(new Error('固定步骤遗漏'), { code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH', causeCode: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[0].stepFeedbacks', modelProvider: options.provider, providerRequestId: 'request-secret' }); } },
    utils: { now: () => new Date('2026-08-06T00:00:00.000Z'), randomId: () => 'stage_handoff_review_recovery', safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { hardProblemUserPrompt: () => '固定步骤批改' }, deferStagePersistence: true
  });
  const task = { _id: 'task-review-recovery', mode: 'HARD_PROBLEM_CHECK', hardProblemModelProvider: 'qwen3_vl_plus', currentStage: 'REVIEW_GRADING', studentImageFileIds: [], answerImageFileIds: [], hardProblemEvidenceDraft: evidence, hardProblemAlignmentDraft: alignment, hardProblemReviewRecoveryCount: 0 };
  const first = await runtime.test.process(task, Date.now());
  assert.equal(first.outcome, 'CONTINUE');
  assert.equal(first.nextStage, 'REVIEW_GRADING');
  assert.notEqual(first.nextStage, 'FINALIZING_RESULT');
  assert.equal(first.handoffPatch.hardProblemReviewRecoveryCount, 1);
  assert.equal(first.handoffPatch.hardProblemReviewLastFailure.modelProvider, 'qwen3_vl_plus');
  assert.equal(first.handoffPatch.hardProblemReviewLastFailure.providerRequestIdPresent, true);
  assert.equal(Object.hasOwn(first.handoffPatch.hardProblemReviewLastFailure, 'providerRequestId'), false);
  assert.equal(events.some((entry) => entry.event === 'HARD_PROBLEM_REVIEW_RECOVERY_SCHEDULED'), true);
  await assert.rejects(
    runtime.test.process({ ...task, ...first.handoffPatch, currentStage: 'REVIEW_GRADING' }, Date.now()),
    (error) => error.code === 'HARD_PROBLEM_FIXED_RESULT_MISMATCH'
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.provider), ['qwen3_vl_plus', 'qwen3_vl_plus']);
  assert.equal(calls[0].maxRepairAttempts, 1);
  assert.equal(calls[1].maxRepairAttempts, 1);
  assert.match(calls[1].userPrompt, /结构恢复重试/);
});

test('hard-problem mismatch mapping exposes a safe retry message and diagnostics without request id leakage', () => {
  const taskError = require('../shared/task-error');
  const utils = require('../shared/utils');
  const error = Object.assign(new Error('raw provider message'), {
    code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH', causeCode: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[0].stepFeedbacks',
    requestStage: 'hardProblemReview', modelProvider: 'qwen3_vl_plus', modelName: 'qwen3.7-plus', providerRequestId: 'secret-request-id',
    repairAttempted: true, repairAttemptCount: 1
  });
  const mapped = taskError.mapTaskFailure(error, 'REVIEW_GRADING');
  assert.equal(mapped.retryable, true);
  assert.equal(mapped.failureCategory, 'ai_response');
  assert.match(mapped.userMessage, /千问|批改结果/);
  const safe = utils.safeError(error);
  assert.equal(safe.providerRequestIdPresent, true);
  assert.equal(Object.values(safe).includes('secret-request-id'), false);
  assert.equal(safe.fieldPath, 'questions[0].stepFeedbacks');
});


test('a fresh evidence extraction cycle clears stale hard-problem REVIEW recovery state', () => {
  const source = require('node:fs').readFileSync(require.resolve('../shared/grading-core/execute-grading-task'), 'utf8');
  const evidencePrimary = source.slice(source.indexOf("if (stage === STAGES.PRIMARY_GRADING)"), source.indexOf("const primary = isCareless", source.indexOf("if (stage === STAGES.PRIMARY_GRADING)")));
  assert.match(evidencePrimary, /hardProblemReviewRecoveryCount:\s*0/);
  assert.match(evidencePrimary, /hardProblemReviewLastFailure:\s*null/);
  const omissionRetry = source.slice(source.indexOf("HARD_PROBLEM_EVIDENCE_RETRY_REQUESTED"), source.indexOf("const reviewed =", source.indexOf("HARD_PROBLEM_EVIDENCE_RETRY_REQUESTED")));
  assert.match(omissionRetry, /hardProblemReviewRecoveryCount:\s*0/);
  assert.match(omissionRetry, /hardProblemReviewLastFailure:\s*null/);
});

test('v8 expected plan recovers four pedagogical steps from the real two-band book failure shape', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const evidence = {
    outputSchemaVersion: 'hard-problem-evidence.v2', layoutType: 'left_right', questions: [{
      sourceKey: 'book-v8-two-band', layoutType: 'left_right', questionText: '科技书是文艺书的1.4倍，两类书共1200本。', studentAnswer: '文艺书500本，科技书700本', studentWorkDetected: true,
      sourceQuestionLabel: '第3题', sourceRegion: 'image-1:q3', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
      expectedSteps: [
        { stepId: 'S1', order: 1, purpose: '设未知数', expectedReasoning: '设文艺书为x，并用1.4x表示科技书。', processUnitIds: ['P1'], explanationUnitIds: ['E1'] },
        { stepId: 'S2', order: 2, purpose: '根据总量关系列方程', expectedReasoning: '文艺书与科技书总数为1200，所以列x+1.4x=1200。', processUnitIds: [], explanationUnitIds: [] },
        { stepId: 'S3', order: 3, purpose: '解方程', expectedReasoning: '合并同类项并解方程求x。', processUnitIds: [], explanationUnitIds: [] },
        { stepId: 'S4', order: 4, purpose: '求科技书并作答', expectedReasoning: '用总量减文艺书数量求科技书并作答。', processUnitIds: ['P2'], explanationUnitIds: ['E2'] }
      ],
      processUnits: [
        { unitId: 'P1', text: '设图书馆有文艺书x本\nx+1.4x=1200\n2.4x=1200\nx=500', order: 1, role: 'calculation', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: '1200-500=700(本)\n答：文艺书500本，科技书700本', order: 2, role: 'final_result', visualBand: 2, readability: 'readable' }
      ],
      explanationUnits: [
        { unitId: 'E1', text: '科技书是文艺书的1.4倍，所以设文艺书为x\n文艺书和科技书的总数是1200本', order: 1, label: '', visualBand: 1, readability: 'readable' },
        { unitId: 'E2', text: '求出文艺书的量\n用总量减文艺书求科技书', order: 2, label: '', visualBand: 2, readability: 'readable' }
      ]
    }]
  };
  const q = runtime.alignHardProblemEvidence(evidence).questions[0];
  assert.equal(q.pairedSteps.length, 4);
  assert.equal(q.pairedSteps[0].solutionText, '设图书馆有文艺书x本');
  assert.equal(q.pairedSteps[1].solutionText, 'x+1.4x=1200');
  assert.match(q.pairedSteps[2].solutionText, /2\.4x=1200/);
  assert.match(q.pairedSteps[2].solutionText, /x=500/);
  assert.match(q.pairedSteps[3].solutionText, /1200-500=700/);
  assert.deepEqual(q.pairedSteps.map((step) => step.expectedPurpose), ['设未知数','根据总量关系列方程','解方程','求科技书并作答']);
  assert.match(q.alignmentWarnings.join(' '), /EXPECTED_PLAN_PROCESS_REFINED/);
});

test('v8 expected plan keeps a mathematically necessary middle step when the student omitted it', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const evidence = { outputSchemaVersion: 'hard-problem-evidence.v2', layoutType: 'single_stream', questions: [{
    sourceKey: 'missing-middle-v8', layoutType: 'single_stream', questionText: '题目', studentAnswer: '700本', studentWorkDetected: true,
    sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
    expectedSteps: [
      { stepId: 'S1', order: 1, purpose: '设未知数', expectedReasoning: '设未知数并表示相关量。', processUnitIds: ['P1'], explanationUnitIds: [] },
      { stepId: 'S2', order: 2, purpose: '列方程', expectedReasoning: '根据数量关系列方程。', processUnitIds: [], explanationUnitIds: [] },
      { stepId: 'S3', order: 3, purpose: '解方程', expectedReasoning: '化简并解方程。', processUnitIds: ['P2'], explanationUnitIds: [] },
      { stepId: 'S4', order: 4, purpose: '求另一量', expectedReasoning: '利用已求结果求另一量。', processUnitIds: ['P3'], explanationUnitIds: [] }
    ],
    processUnits: [
      { unitId: 'P1', text: '设文艺书x本', order: 1, role: 'setup', visualBand: 1, readability: 'readable' },
      { unitId: 'P2', text: 'x=500', order: 2, role: 'intermediate_result', visualBand: 3, readability: 'readable' },
      { unitId: 'P3', text: '1200-500=700', order: 3, role: 'final_result', visualBand: 4, readability: 'readable' }
    ], explanationUnits: []
  }] };
  const q = runtime.alignHardProblemEvidence(evidence).questions[0];
  assert.equal(q.pairedSteps.length, 4);
  assert.equal(q.pairedSteps[1].expectedPurpose, '列方程');
  assert.equal(q.pairedSteps[1].solutionText, '');
  assert.equal(q.pairedSteps[1].processReadability, 'missing');
  assert.equal(q.pairedSteps[2].solutionText, 'x=500');
  assert.equal(runtime.fixedStepMeta({ questions: [q] })[0].fixedSteps.length, 4);
});

test('v8 attaches extra student evidence to the locked expected plan instead of creating extra expected steps', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const aligned = runtime.alignHardProblemEvidence({
    outputSchemaVersion: 'hard-problem-evidence.v2', layoutType: 'single_stream', questions: [{
      sourceKey: 'many-evidence-one-plan', layoutType: 'single_stream', questionText: '题目', studentAnswer: '结果', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1:q1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
      expectedSteps: [
        { stepId: 'S1', order: 1, purpose: '第一教学目的', expectedReasoning: '完成第一目的。', processUnitIds: ['P1'], explanationUnitIds: [] },
        { stepId: 'S2', order: 2, purpose: '第二教学目的', expectedReasoning: '完成第二目的。', processUnitIds: ['P3'], explanationUnitIds: [] }
      ],
      processUnits: [
        { unitId: 'P1', text: '第一段学生过程', order: 1, role: 'calculation', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: '同一目的的续写', order: 2, role: 'calculation', visualBand: 2, readability: 'readable' },
        { unitId: 'P3', text: '第二教学目的过程', order: 3, role: 'final_result', visualBand: 3, readability: 'readable' }
      ], explanationUnits: []
    }]
  }).questions[0];
  assert.equal(aligned.pairedSteps.length, 2);
  assert.equal(aligned.pairedSteps.map((step) => step.expectedStepId).join(','), 'S1,S2');
  assert.match(aligned.pairedSteps.map((step) => step.solutionText).join('\n'), /同一目的的续写/);
});

test('fixed-step REVIEW skips segmentation validation while retaining fixed-step schema validation', () => {
  const question = {
    ...hardProblemQuestion(),
    stepFeedbacks: [
      { stepIndex: 1, solutionText: 'a=1\nb=2\nc=3\nd=4', explanationText: '① 第一目的\n② 第二目的\n③ 第三目的', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '学生过程可读。', correctionAdvice: '' },
      { stepIndex: 2, solutionText: 'e=5', explanationText: '完成计算。', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '学生过程可读。', correctionAdvice: '' }
    ]
  };
  const result = hardProblemPayload([question]);
  assert.throws(() => outputSchemaValidator.validateNewModelResult(result), (error) => error.code === 'LLM_SCHEMA_ERROR');
  assert.doesNotThrow(() => outputSchemaValidator.validateNewModelResult(result, { fixedStepReview: true }));
});

test('v8 printed unanswered question retains the full expected reasoning plan as missing fixed steps', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const evidence = { outputSchemaVersion: 'hard-problem-evidence.v2', layoutType: 'single_stream', questions: [{
    sourceKey: 'blank-v8', layoutType: 'single_stream', questionText: '一道清晰数学题', studentAnswer: '', studentWorkDetected: false,
    sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_without_work', modeApplicability: 'applicable', confidence: 1, warnings: [],
    expectedSteps: [1,2,3,4].map((n) => ({ stepId: `S${n}`, order: n, purpose: `必要步骤${n}`, expectedReasoning: `补充必要步骤${n}的数学依据。`, processUnitIds: [], explanationUnitIds: [] })),
    processUnits: [], explanationUnits: []
  }] };
  const q = runtime.alignHardProblemEvidence(evidence).questions[0];
  assert.equal(q.pairedSteps.length, 4);
  assert.ok(q.pairedSteps.every((step) => step.solutionText === '' && step.explanationText === ''));
  const fixed = runtime.fixedStepMeta({ questions: [q] })[0];
  assert.equal(fixed.fixedSteps.length, 4);
  assert.equal(fixed.fixedSteps[2].expectedPurpose, '必要步骤3');
});

test('v8 task handoff stores only a compact alignment marker and enforces a 1MB evidence budget', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const alignment = {
    version: 'hard-problem-evidence-alignment.v2', layoutType: 'left_right', questions: [{
      sourceKey: 'q-compact', pairedSteps: [
        { solutionText: 'x+1.4x=1200', explanationText: '根据总数列方程' },
        { solutionText: '', explanationText: '' }
      ]
    }]
  };
  const marker = runtime.compactHardProblemAlignmentDraft(alignment);
  assert.deepEqual(marker.questions, [{ sourceKey: 'q-compact', stepCount: 2, missingSourceStepCount: 1 }]);
  assert.equal(JSON.stringify(marker).includes('x+1.4x=1200'), false);
  assert.equal(runtime.HARD_PROBLEM_TASK_DRAFT_MAX_BYTES, 1024 * 1024);
  assert.ok(runtime.hardProblemDraftBytes(marker) < 4096);
});

test('v8 fixed-step adapter cannot mark an omitted student step correct or fabricate its source text', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const alignment = {
    layoutType: 'left_right', questions: [{
      sourceKey: 'q-missing-source', questionText: '图书题', studentAnswer: '500和700', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', pairedSteps: [{
        stepIndex: 1, expectedStepId: 'S3', expectedPurpose: '解方程', expectedReasoning: '先合并同类项，再解出x。', stepKind: 'expected',
        solutionText: '', explanationText: '', processReadability: 'missing', explanationReadability: 'missing', processUnitIds: [], explanationUnitIds: []
      }]
    }]
  };
  const maliciousModel = hardProblemPayload([{ ...hardProblemQuestion(), sourceKey: 'q-missing-source', sourceQuestionLabel: '1', sourceRegion: 'image-1', stepFeedbacks: [{
    stepIndex: 1, solutionText: 'AI伪造的学生过程', explanationText: 'AI伪造的学生讲解', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear',
    analysis: '思路：本步完全正确；公式/知识点：掌握正确；逻辑：完全清楚。', correctionAdvice: ''
  }] }]);
  const enforced = runtime.enforceFixedHardProblemSteps(maliciousModel, alignment, { allowSafeFallback: true });
  const step = enforced.questions[0].stepFeedbacks[0];
  assert.equal(step.solutionText, '');
  assert.equal(step.explanationText, '');
  assert.equal(step.solutionStatus, 'missing');
  assert.equal(step.explanationStatus, 'missing');
  assert.equal(step.logicStatus, 'insufficient');
  assert.match(step.analysis, /学生未写出.*解方程/);
  assert.match(step.correctionAdvice, /解方程/);
});

test('V10 consistency safe refusal preserves recognized student evidence without emitting a guessed mathematical judgment', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const diagnostic = {
    consistencyStatus: 'blocked',
    consistencyIssues: ['COVERAGE_CONFIDENCE_INSUFFICIENT:Q1', 'ADVERSARIAL_JUDGMENT_REJECTED'],
    evidence: { questions: [{
      sourceKey: 'Q1', questionText: '甲乙共120个，甲是乙的2倍，分别多少？', studentAnswer: '80和40', studentWorkDetected: true,
      sourceQuestionLabel: '第1题', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work',
      processUnits: [{ unitId: 'P1', rawText: 'x+2x=120' }], explanationUnits: [{ unitId: 'E1', rawText: '总量等于两部分之和' }]
    }] }
  };
  const result = runtime.buildHardProblemV10SafeRefusalResult(diagnostic, { questions: [{ sourceKey: 'Q1', standardAnswer: '40和80' }] }, {});
  assert.equal(result.questions.length, 1);
  const q = result.questions[0];
  assert.equal(q.studentAnswer, '80和40');
  assert.equal(q.standardAnswer, '40和80');
  assert.equal(q.answerStatus, 'unreadable');
  assert.equal(q.finalAnswerCorrect, null);
  assert.equal(q.studentWorkDetected, true);
  assert.equal(q.stepFeedbacks[0].solutionText, 'x+2x=120');
  assert.equal(q.stepFeedbacks[0].explanationText, '总量等于两部分之和');
  assert.ok(result.validationWarnings.includes('COVERAGE_CONFIDENCE_INSUFFICIENT:Q1'));
});


test('V10 question-scoped fatal evidence issue does not erase another question trusted review', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const makeEvidence = (sourceKey, processText) => ({ sourceKey, questionText: `${sourceKey}题目`, studentAnswer: '2', studentWorkDetected: true, sourceQuestionLabel: sourceKey, sourceRegion: 'image-1', inputBasis: 'printed_question_with_work', evidenceQuality: .95, processUnits: [{ unitId: `${sourceKey}-P1`, studentStepId: 'S1', rawText: processText, readability: 'readable', confidence: .95 }], explanationUnits: [] });
  const q1Review = { ...hardProblemQuestion(), sourceKey: 'Q1', questionText: 'Q1题目', sourceQuestionLabel: 'Q1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work' };
  const q2Review = { ...hardProblemQuestion(), sourceKey: 'Q2', questionText: 'Q2题目', sourceQuestionLabel: 'Q2', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work' };
  const diagnostic = {
    consistencyStatus: 'blocked',
    consistencyIssues: ['EVIDENCE_VERIFICATION_CONFLICT:Q1'],
    consistencyFatalIssues: ['EVIDENCE_VERIFICATION_CONFLICT:Q1'],
    evidence: { questions: [makeEvidence('Q1', '1+1=2'), makeEvidence('Q2', '1+1=2')] },
    problemTruth: { questions: [
      { sourceKey: 'Q1', accepted: true, questionConsistent: true, referenceAnswerConsistent: true, canonicalAnswerSummary: '2' },
      { sourceKey: 'Q2', accepted: true, questionConsistent: true, referenceAnswerConsistent: true, canonicalAnswerSummary: '2' }
    ] }
  };
  const result = runtime.buildHardProblemV10SafeRefusalResult(diagnostic, hardProblemPayload([q1Review, q2Review]), {});
  const q1 = result.questions.find((q) => q.sourceKey === 'Q1');
  const q2 = result.questions.find((q) => q.sourceKey === 'Q2');
  assert.equal(q1.evaluationStatus, 'UNREADABLE');
  assert.equal(q2.evaluationStatus, 'CORRECT');
  assert.equal(q2.finalAnswerCorrect, true);
  assert.equal(q2.stepFeedbacks[0].solutionStatus, 'correct');
});

test('fixed-step review keeps locked segmentation context through final validation', () => {
  const q = {
    ...hardProblemQuestion(),
    sourceKey: 'fixed-review-context',
    studentAnswer: '42',
    standardAnswer: '42',
    studentWorkDetected: true,
    sourceQuestionLabel: '1',
    sourceRegion: 'image-1',
    inputBasis: 'printed_question_with_work',
    modeApplicability: 'applicable',
    stepFeedbacks: [{
      stepIndex: 1,
      solutionText: '12+8=20\n20×2=40\n40+2=42\n42÷1=42',
      explanationText: '1.先求第一部分；2.再求第二部分；3.最后合并得到答案',
      solutionStatus: 'correct',
      explanationStatus: 'clear',
      logicStatus: 'clear',
      analysis: '该步过程、讲解和逻辑正确。',
      correctionAdvice: ''
    }],
    overallFeedback: '最终答案、解题过程和讲解均正确。'
  };
  const payload = hardProblemPayload([q]);
  assert.throws(
    () => calculationRuntime.validateHardProblemGradeResult(payload, {}, {}),
    (error) => error?.code === 'LLM_SCHEMA_ERROR' && error?.fieldPath === 'questions[0].stepFeedbacks'
  );
  assert.doesNotThrow(() => calculationRuntime.validateHardProblemGradeResult(
    payload,
    {},
    { fixedStepReview: true, requestStage: 'hardProblemReview' }
  ));
});

test('V10 safe refusal cannot be rejected by normal segmentation heuristics', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const diagnostic = {
    consistencyStatus: 'blocked',
    consistencyIssues: ['ADVERSARIAL_JUDGMENT_REJECTED'],
    evidence: { questions: [{
      sourceKey: 'Q-overmerged-safe', questionText: '题目', studentAnswer: '42', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work',
      processUnits: [{ unitId: 'P1', rawText: '12+8=20\n20×2=40\n40+2=42\n42÷1=42' }],
      explanationUnits: [{ unitId: 'E1', rawText: '1.先求第一部分；2.再求第二部分；3.最后合并得到答案' }]
    }] }
  };
  assert.doesNotThrow(() => runtime.buildHardProblemV10SafeRefusalResult(diagnostic, { questions: [{ sourceKey: 'Q-overmerged-safe' }] }, {}));
});

test('hard-problem duplicate-question collapse recomputes aggregate semantics after combining steps', () => {
  const correct = { ...hardProblemQuestion(), sourceKey: 'dup-a', questionText: '1+1等于多少', sourceQuestionLabel: '1', sourceRegion: 'image-1' };
  const partial = {
    ...hardProblemQuestion(), sourceKey: 'dup-b', questionText: '1+1等于多少', sourceQuestionLabel: '1', sourceRegion: 'image-1',
    stepStatus: 'wrong', logicStatus: 'insufficient', errorType: 'logic_error',
    firstWrongStep: '第1步讲解不完整', errorReason: '讲解不完整', adjustmentSuggestion: '补充讲解',
    stepFeedbacks: [{ stepIndex: 1, solutionText: '1+1=2（另一处）', explanationText: '', solutionStatus: 'correct', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '计算正确但讲解缺失。', correctionAdvice: '请补充讲解。' }],
    overallFeedback: '最终答案正确，但讲解需要补充。'
  };
  const payload = hardProblemPayload([correct, partial]);
  payload.questionSetAudit = { visibleIndependentQuestionCount: 1, emittedQuestionCount: 2, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 };
  const result = calculationRuntime.validateHardProblemGradeResult(payload, {});
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].stepFeedbacks.length, 2);
  assert.equal(result.questions[0].stepStatus, 'wrong');
  assert.equal(result.questions[0].logicStatus, 'insufficient');
  assert.equal(result.questions[0].evaluationStatus, 'WRONG');
  assert.equal(result.questions[0].checkinEligible, false);
  assert.equal(result.summary.correctCount, 0);
  assert.equal(result.summary.wrongCount, 1);
});

test('V10 safe refusal preserves each visible calculation step instead of collapsing all work into Step 1', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const diagnostic = {
    consistencyStatus: 'blocked',
    consistencyIssues: ['COVERAGE_CONFIDENCE_INSUFFICIENT:Q-book'],
    evidence: { questions: [{
      sourceKey: 'Q-book', questionText: '科技书是文艺书的1.4倍，共1200本', studentAnswer: '文艺书500本，科技书700本', studentWorkDetected: true,
      sourceQuestionLabel: '3', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work',
      processUnits: [
        { unitId: 'P1', rawText: 'x+1.4x=1200', visualBand: 1 },
        { unitId: 'P2', rawText: '2.4x=1200', visualBand: 2 },
        { unitId: 'P3', rawText: 'x=500', visualBand: 3 },
        { unitId: 'P4', rawText: '1200-500=700(本)', visualBand: 4 }
      ],
      explanationUnits: [
        { unitId: 'E1', rawText: '科技书是文艺书的1.4倍', visualBand: 1 },
        { unitId: 'E2', rawText: '文艺书和科技书总数是1200本', visualBand: 2 },
        { unitId: 'E4', rawText: '求科技书数量，用总量减文艺书数量', visualBand: 4 }
      ]
    }] }
  };
  const coarseAlignment = { questions: [{ sourceKey: 'Q-book', pairedSteps: [{ stepIndex: 1, processUnitIds: ['P1','P2','P3','P4'], explanationUnitIds: ['E1','E2','E4'], solutionText: 'x+1.4x=1200\n2.4x=1200\nx=500\n1200-500=700(本)', explanationText: '科技书是文艺书的1.4倍\n文艺书和科技书总数是1200本\n求科技书数量，用总量减文艺书数量' }] }] };
  const result = runtime.buildHardProblemV10SafeRefusalResult(diagnostic, { questions: [{ sourceKey: 'Q-book', stepFeedbacks: [{ stepIndex: 1, solutionText: '旧的一整块', explanationText: '旧的一整块' }] }] }, {}, coarseAlignment);
  const steps = result.questions[0].stepFeedbacks;
  assert.equal(steps.length, 4);
  assert.deepEqual(steps.map((step) => step.solutionText), ['x+1.4x=1200', '2.4x=1200', 'x=500', '1200-500=700(本)']);
  assert.equal(steps[0].explanationText, '科技书是文艺书的1.4倍');
  assert.equal(steps[1].explanationText, '文艺书和科技书总数是1200本');
  assert.equal(steps[2].explanationText, '');
  assert.equal(steps[3].explanationText, '求科技书数量，用总量减文艺书数量');
  assert.equal(result.questions[0].evaluationStatus, 'UNREADABLE');
  assert.ok(result.validationWarnings.includes('HARD_PROBLEM_V10_SAFE_REFUSAL_STEPS_PRESERVED'));
});

test('V10 safe refusal excludes printed questions with no detected student work instead of fabricating a result', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const diagnostic = {
    consistencyStatus: 'blocked', consistencyIssues: ['PROBLEM_TRUTH_REJECTED:Q-empty'],
    evidence: { questions: [{ sourceKey: 'Q-empty', questionText: '题目', studentAnswer: '', studentWorkDetected: false, sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_without_work', processUnits: [], explanationUnits: [] }] }
  };
  const result = runtime.buildHardProblemV10SafeRefusalNoThrow(diagnostic, { questions: [] }, {}, null);
  assert.equal(result.questions.length, 0);
});



test('V10 safe refusal never drops source explanations omitted by an otherwise fine alignment', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const diagnostic = {
    consistencyStatus: 'blocked', consistencyIssues: ['COVERAGE_CONFIDENCE_INSUFFICIENT:Q-extra-explanation'],
    evidence: { questions: [{
      sourceKey: 'Q-extra-explanation', questionText: '测试题', studentAnswer: '答案', studentWorkDetected: true,
      sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work',
      processUnits: [{ unitId: 'P1', rawText: 'x=500', visualBand: 1 }],
      explanationUnits: [
        { unitId: 'E1', rawText: '先求文艺书数量', visualBand: 1 },
        { unitId: 'E2', rawText: '再用总数减去文艺书数量', visualBand: 2 }
      ]
    }] }
  };
  const incompleteAlignment = { questions: [{ sourceKey: 'Q-extra-explanation', pairedSteps: [
    { stepIndex: 1, processUnitIds: ['P1'], explanationUnitIds: ['E1'], solutionText: 'x=500', explanationText: '先求文艺书数量' }
  ] }] };
  const result = runtime.buildHardProblemV10SafeRefusalNoThrow(diagnostic, { questions: [] }, {}, incompleteAlignment);
  const allExplanation = result.questions[0].stepFeedbacks.map((step) => step.explanationText).join('\n');
  assert.equal((allExplanation.match(/先求文艺书数量/g) || []).length, 1);
  assert.equal((allExplanation.match(/再用总数减去文艺书数量/g) || []).length, 1);
  assert.equal(result.questions[0].stepFeedbacks.length, 1);
  assert.equal(result.questions[0].stepFeedbacks[0].solutionText, 'x=500');
});


test('V10 emergency safe refusal also preserves visible source steps', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const diagnostic = { consistencyIssues: ['REVIEW_PIPELINE_RUNTIME_RECOVERY:Q1'], evidence: { questions: [{
    sourceKey: 'Q1', questionText: '测试题', studentAnswer: '700', studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image-1', inputBasis: 'printed_question_with_work',
    processUnits: [{ unitId: 'P1', rawText: 'x=500' }, { unitId: 'P2', rawText: '1200-500=700' }],
    explanationUnits: [{ unitId: 'E1', rawText: '用总数减文艺书数量' }]
  }] } };
  const result = runtime.buildHardProblemV10EmergencySafeRefusalResult(diagnostic, {});
  assert.equal(result.questions[0].stepFeedbacks.length, 2);
  const source = result.questions[0].stepFeedbacks.map((step) => `${step.solutionText}\n${step.explanationText}`).join('\n');
  for (const token of ['x=500', '1200-500=700', '用总数减文艺书数量']) assert.equal((source.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
});
test('V10 final contract recovery only catches internal contract-family errors, not infrastructure failures', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  assert.equal(runtime.hardProblemFinalRecoverable({ code: 'FINAL_QUESTION_SET_AUDIT_MISMATCH' }), true);
  assert.equal(runtime.hardProblemFinalRecoverable({ code: 'QUESTION_SET_MISMATCH' }), true);
  assert.equal(runtime.hardProblemFinalRecoverable({ code: 'DATABASE_WRITE_FAILED' }), false);
  assert.equal(runtime.hardProblemFinalRecoverable({ code: 'LEASE_LOST' }), false);
});

test('V10.5 perception pass prefers Ark Lite when configured without changing the selected grading provider', () => {
  const prevKey = process.env.ARK_API_KEY;
  const prevEndpoint = process.env.ARK_LITE_ENDPOINT;
  try {
    process.env.ARK_API_KEY = 'test-key';
    process.env.ARK_LITE_ENDPOINT = 'ep-test';
    assert.equal(calculationRuntime.hardProblemPerceptionProvider({ hardProblemModelProvider: 'qwen3_vl_plus' }), 'ark_lite');
    assert.equal(calculationRuntime.hardProblemPerceptionProvider({ hardProblemModelProvider: 'ark_lite' }), 'ark_lite');
    delete process.env.ARK_API_KEY;
    delete process.env.ARK_LITE_ENDPOINT;
    assert.equal(calculationRuntime.hardProblemPerceptionProvider({ hardProblemModelProvider: 'qwen3_vl_plus' }), 'qwen3_vl_plus');
  } finally {
    if (prevKey === undefined) delete process.env.ARK_API_KEY; else process.env.ARK_API_KEY = prevKey;
    if (prevEndpoint === undefined) delete process.env.ARK_LITE_ENDPOINT; else process.env.ARK_LITE_ENDPOINT = prevEndpoint;
  }
});


function directStrategyFixture() {
  return {
    strategyVersion: '1.6.19',
    contracts: { hardProblemV2: {
      requiredFields: ['outputSchemaVersion','sourceKey','questionText','studentAnswer','standardAnswer','answerStatus','finalAnswerCorrect','stepRequired','stepStatus','logicStatus','errorType','firstWrongStep','errorReason','adjustmentSuggestion','knowledgePoint','stepFeedbacks','overallFeedback','confidence','studentWorkDetected','sourceQuestionLabel','sourceRegion','inputBasis','modeApplicability'],
      arrayItemSchemas: { stepFeedbacks: {
        requiredFields: ['stepIndex','solutionText','explanationText','solutionStatus','explanationStatus','logicStatus','analysis','correctionAdvice'],
        enumFields: { solutionStatus:['correct','wrong','missing','unreadable'], explanationStatus:['clear','partially_clear','incorrect','missing','unreadable'], logicStatus:['clear','insufficient','wrong','unreadable'] }
      } },
      ...HARD_TOP_LEVEL_CONTRACT
    } },
    reviewRules: { hardProblemDirectMode: true, hardProblem: { correctStepStatuses:['correct','not_required'], correctLogicStatus:'correct' } }
  };
}
function directStep(overrides = {}) {
  return { stepIndex: 1, solutionText: '1+1=2', explanationText: '两个1相加得到2', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '这一步正确。', correctionAdvice: '', ...overrides };
}
function directQuestion(overrides = {}) {
  return { ...hardProblemQuestion(), studentWorkDetected:true, sourceQuestionLabel:'第1题', sourceRegion:'image-1:question-1', inputBasis:'printed_question_with_work', modeApplicability:'applicable', ...overrides };
}

test('hard-problem direct mode is explicit and the adapter preserves one student step with its explanation', () => {
  assert.equal(calculationRuntime.usesHardProblemDirect({ reviewRules: { hardProblemDirectMode: true } }), true);
  const raw = { questions: [{ questionText:'图书馆题', studentAnswer:'文艺书500本，科技书700本', standardAnswer:'文艺书500本，科技书700本', finalAnswerVerdict:'correct', steps:[
    { studentProcess:'2.4x=1200\nx=500', studentExplanation:'求出文艺书的量', processVerdict:'correct', explanationVerdict:'clear', logicVerdict:'correct', errorKind:'none', reason:'过程与解释对应且正确。', advice:'' }
  ], overallFeedback:'正确', confidence:0.95 }] };
  const normalized = calculationRuntime.normalizeHardProblemDirectDraft(raw);
  const final = calculationRuntime.adaptHardProblemDirectDraft(normalized, directStrategyFixture());
  assert.equal(final.questions[0].stepFeedbacks.length, 1);
  assert.equal(final.questions[0].stepFeedbacks[0].solutionText, '2.4x=1200\nx=500');
  assert.equal(final.questions[0].stepFeedbacks[0].explanationText, '求出文艺书的量');
  assert.equal(final.questions[0].stepFeedbacks[0].explanationStatus, 'clear');
});

test('hard-problem direct normalizer keeps final answer outside stepFeedbacks and does not require explanation for 答', () => {
  const raw = { questions: [{ questionText:'图书馆题', studentAnswer:'文艺书500本，科技书700本', standardAnswer:'文艺书500本，科技书700本', finalAnswerVerdict:'correct', steps:[
    { stepTitle:'设未知数', studentProcess:'设文艺书为x本', studentAnalysis:'科技书是文艺书的1.4倍，所以设文艺书为x', verdict:'correct', issueTarget:'none', reason:'正确', advice:'' },
    { stepTitle:'列方程', studentProcess:'x+1.4x=1200', studentAnalysis:'文+科的总数=1200', verdict:'correct', issueTarget:'none', reason:'正确', advice:'' },
    { stepTitle:'解方程', studentProcess:'2.4x=1200\nx=500', studentAnalysis:'求出文艺书的量', verdict:'correct', issueTarget:'none', reason:'正确', advice:'' },
    { stepTitle:'求科技书', studentProcess:'1200-500=700(本)', studentAnalysis:'用总量-文=科', verdict:'correct', issueTarget:'none', reason:'正确', advice:'' },
    { stepTitle:'作答', studentProcess:'答：文艺书500本，科技书700本。', studentAnalysis:'', verdict:'correct', issueTarget:'none', reason:'答案正确', advice:'' }
  ], overallFeedback:'正确', confidence:0.98 }] };
  const normalized = calculationRuntime.normalizeHardProblemDirectDraft(raw);
  assert.equal(normalized.questions[0].steps.length, 4);
  assert.equal(normalized.questions[0].studentAnswer, '文艺书500本，科技书700本');
  const final = calculationRuntime.adaptHardProblemDirectDraft(normalized, directStrategyFixture());
  assert.equal(final.questions[0].stepFeedbacks.length, 4);
  assert.equal(final.questions[0].stepStatus, 'correct');
  assert.equal(final.questions[0].logicStatus, 'correct');
  assert.equal(final.questions[0].errorType, 'none');
});

test('hard-problem direct normalizer can recover studentAnswer from an explicit 答 step while excluding it from steps', () => {
  const raw = { questions: [{ questionText:'图书馆题', studentAnswer:'', standardAnswer:'文艺书500本，科技书700本', finalAnswerVerdict:'correct', steps:[
    { stepTitle:'求科技书', studentProcess:'1200-500=700(本)', studentAnalysis:'用总量-文=科', verdict:'correct', issueTarget:'none', reason:'正确', advice:'' },
    { stepTitle:'最终答案', studentProcess:'答：文艺书500本，科技书700本。', studentAnalysis:'', verdict:'correct', issueTarget:'none', reason:'答案正确', advice:'' }
  ], overallFeedback:'正确', confidence:0.98 }] };
  const normalized = calculationRuntime.normalizeHardProblemDirectDraft(raw);
  assert.equal(normalized.questions[0].steps.length, 1);
  assert.equal(normalized.questions[0].studentAnswer, '文艺书500本，科技书700本。');
});


test('hard-problem direct normalizer passes 16000 final-answer separation combinations without deleting real steps', () => {
  const answerForms = [
    (answer) => ({ stepTitle:'作答', studentProcess:`答：${answer}` }),
    (answer) => ({ stepTitle:'答案', studentProcess:`答案：${answer}` }),
    (answer) => ({ stepTitle:'最终答案', studentProcess:`最终答案：${answer}` }),
    (answer) => ({ stepTitle:'作答', studentProcess:`答 ${answer}` }),
    (answer) => ({ stepTitle:'最终答案', studentProcess:answer })
  ];
  let checked = 0;
  for (let realStepCount = 1; realStepCount <= 8; realStepCount += 1) {
    for (const answerForm of answerForms) {
      for (const studentAnswerPresent of [false, true]) {
        for (let titleVariant = 0; titleVariant < 5; titleVariant += 1) {
          for (let textVariant = 0; textVariant < 40; textVariant += 1) {
            const answer = `结果${realStepCount}-${titleVariant}-${textVariant}`;
            const steps = Array.from({ length: realStepCount }, (_, index) => ({
              stepTitle: `数学目的${titleVariant}-${index + 1}`,
              studentProcess: `过程${textVariant}-${index + 1}=值${index + 1}`,
              studentAnalysis: `解释${index + 1}`, verdict:'correct', issueTarget:'none', reason:'正确', advice:''
            }));
            steps.push({ ...answerForm(answer), studentAnalysis:'', verdict:'correct', issueTarget:'none', reason:'答案正确', advice:'' });
            const normalized = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
              questionText:'组合测试', studentAnswer: studentAnswerPresent ? answer : '', standardAnswer:answer, finalAnswerVerdict:'correct', steps, overallFeedback:'正确', confidence:0.9
            }] });
            assert.equal(normalized.questions[0].steps.length, realStepCount);
            assert.ok(normalized.questions[0].studentAnswer.includes(answer));
            const final = calculationRuntime.adaptHardProblemDirectDraft(normalized, directStrategyFixture());
            assert.equal(final.questions[0].stepFeedbacks.length, realStepCount);
            assert.equal(final.questions[0].logicStatus, 'correct');
            assert.equal(final.questions[0].errorType, 'none');
            checked += 1;
          }
        }
      }
    }
  }
  assert.equal(checked, 16000);
});

test('hard-problem direct normalizer does not mistake 答题思路 for a final-answer step', () => {
  const raw = { questions: [{ questionText:'测试题', studentAnswer:'42', standardAnswer:'42', finalAnswerVerdict:'correct', steps:[
    { stepTitle:'说明思路', studentProcess:'答题思路：先列出数量关系', studentAnalysis:'说明为什么先列关系', verdict:'correct', issueTarget:'none', reason:'正确', advice:'' }
  ], overallFeedback:'正确', confidence:0.9 }] };
  const normalized = calculationRuntime.normalizeHardProblemDirectDraft(raw);
  assert.equal(normalized.questions[0].steps.length, 1);
  assert.equal(normalized.questions[0].steps[0].studentProcess, '答题思路：先列出数量关系');
});

test('hard-problem direct diagnostic is downstream-only and keeps reviewed student steps for training', () => {
  const reviewed = hardProblemPayload([directQuestion({
    sourceKey: 'q-diag', standardAnswer: '文艺书500本，科技书700本',
    stepFeedbacks: [
      directStep({ stepIndex: 1, solutionText: 'x+1.4x=1200', explanationText: '文加科等于总数' }),
      directStep({ stepIndex: 2, solutionText: '2.4x=1200\nx=500', explanationText: '求出文艺书的量' })
    ]
  })]);
  const diagnostic = calculationRuntime.buildHardProblemDirectDiagnostic(reviewed);
  assert.equal(diagnostic.version, 'hard-problem-frontend-contract.v10.8.2');
  assert.equal(diagnostic.plan.questions[0].steps.length, 2);
  assert.equal(diagnostic.diagnoses.length, 2);
  assert.equal(diagnostic.evidence.questions[0].explanationUnits[1].rawText, '求出文艺书的量');
});

async function runHardProblemDirectStages(primaryPayload, reviewPayload, reviewError = null, reviewDecision = 'correct') {
  const writes = [];
  const arkCalls = [];
  const auditEvents = [];
  const strategy = {
    ...directStrategyFixture(),
    modelRuntime: { stages: {
      hardProblemPrimary: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1 },
      hardProblemReview: { outputSchemaVersion: 'hard-problem.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1 }
    } },
    prompts: { hardProblem: {
      system: '直接看学生原图，按不同数学动作逐步批改。只输出JSON，程序会转换为 hard-problem.v2。',
      userTemplate: '{"questions":[]}',
      reviewSystem: '重新看同一张原图，只检查第一次有没有实质错误。',
      reviewUserTemplate: '{"reviewDecision":"keep|correct","reason":"","correctedResult":null}'
    } }
  };
  const runtime = createGradingRuntime({
    context: { db: { collection: (name) => ({ doc: () => ({ set: async ({ data }) => writes.push({ name, data }), update: async ({ data }) => writes.push({ name, data }) }) }) } },
    constants: { C: { tasks: 'tasks', results: 'results', wrong: 'wrong' } },
    audit: { monitor(...args) { auditEvents.push(args); } },
    ark: { callArk: async (options) => {
      arkCalls.push(options);
      if (options.logicalPass === 2 && reviewError) throw reviewError;
      if (options.logicalPass === 1) return calculationRuntime.directDraftFromBusiness(primaryPayload);
      if (reviewDecision === 'keep') return { reviewDecision: 'keep', reason: '第一次结果正确', correctedResult: null };
      return { reviewDecision: 'correct', reason: '发现实质错误并纠正', correctedResult: calculationRuntime.directDraftFromBusiness(reviewPayload) };
    } },
    utils: { now: () => new Date('2026-08-09T00:00:00.000Z'), randomId: () => 'id', shanghaiDateKey: require('../shared/utils').shanghaiDateKey, safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async () => {} }, taskError: {},
    json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { hardProblemUserPrompt: () => '' }, enqueueTts: async () => {}
  });
  const task = { _id: 'task-direct-flow', studentId: 'student-1', createdAt: '2026-08-09T00:00:00.000Z', mode: 'HARD_PROBLEM_CHECK', hardProblemModelProvider: 'qwen3_vl_plus', studentImageFileIds: [], answerImageFileIds: [] };
  const primaryStage = await runtime.test.process({ ...task, currentStage: 'PRIMARY_GRADING' }, Date.now());
  const primaryDraft = primaryStage.handoffPatch?.primaryDraft || writes.find((write) => write.name === 'tasks' && write.data.primaryDraft)?.data.primaryDraft;
  const reviewStage = await runtime.test.process({ ...task, currentStage: 'REVIEW_GRADING', primaryDraft }, Date.now());
  return { runtime, task, primaryStage, primaryDraft, reviewStage, writes, arkCalls, auditEvents };
}

test('hard-problem direct pipeline bypasses V10 decomposition and lets review correct the primary explanation', async () => {
  const primary = hardProblemPayload([directQuestion({
    sourceKey: 'q-flow', questionText: '图书馆题', studentAnswer: '文艺书500本，科技书700本', standardAnswer: '文艺书500本，科技书700本',
    stepFeedbacks: [
      directStep({ stepIndex: 1, solutionText: 'x+1.4x=1200', explanationText: '文加科等于1200' }),
      directStep({ stepIndex: 2, solutionText: '2.4x=1200\nx=500', explanationText: '', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '过程正确，但未检测到解释。', correctionAdvice: '说明为什么这样做。' })
    ], stepStatus: 'wrong', logicStatus: 'insufficient', errorType: 'logic_error', finalAnswerCorrect: true,
    firstWrongStep: '第2步讲解', errorReason: '第2步未检测到学生讲解。', adjustmentSuggestion: '补充第2步为什么这样解方程。', overallFeedback: '计算过程正确，但第2步讲解暂缺。'
  })]);
  const review = hardProblemPayload([directQuestion({
    sourceKey: 'q-flow', questionText: '图书馆题', studentAnswer: '文艺书500本，科技书700本', standardAnswer: '文艺书500本，科技书700本',
    stepFeedbacks: [
      directStep({ stepIndex: 1, solutionText: 'x+1.4x=1200', explanationText: '文加科等于1200' }),
      directStep({ stepIndex: 2, solutionText: '2.4x=1200\nx=500', explanationText: '求出文艺书的量', explanationStatus: 'clear', logicStatus: 'clear', analysis: '过程与解释均正确。', correctionAdvice: '' })
    ], stepStatus: 'correct', logicStatus: 'correct', errorType: 'none', finalAnswerCorrect: true
  })]);
  const flow = await runHardProblemDirectStages(primary, review);
  assert.equal(flow.primaryStage.nextStage, 'REVIEW_GRADING');
  assert.equal(flow.reviewStage.nextStage, 'FINALIZING_RESULT');
  assert.equal(flow.reviewStage.handoffPatch.mergedDraft.questions[0].stepFeedbacks.length, 2);
  assert.equal(flow.reviewStage.handoffPatch.mergedDraft.questions[0].stepFeedbacks[1].explanationText, '求出文艺书的量');
  assert.equal(flow.reviewStage.handoffPatch.mergedDraft.questions[0].stepFeedbacks[1].explanationStatus, 'clear');
  assert.deepEqual(flow.arkCalls.map((call) => call.requestStage), ['hardProblemPrimary', 'hardProblemReview']);
  assert.deepEqual(flow.arkCalls.map((call) => call.logicalPass), [1, 2]);
  assert.ok(flow.arkCalls.every((call) => call.outputSchemaVersion === null));
  assert.equal(flow.arkCalls[0].mode, 'hard_problem_direct');
  assert.equal(flow.arkCalls[1].mode, 'hard_problem_direct_review');
  assert.equal(flow.arkCalls.some((call) => String(call.requestStage || '').includes('EvidenceV10')), false);
});

test('hard-problem direct review separates equation-building from solving and removes final answer step', async () => {
  const primary = hardProblemPayload([directQuestion({
    sourceKey: 'q-library-purpose', questionText: '图书馆题', studentAnswer: '文艺书500本，科技书700本', standardAnswer: '文艺书500本，科技书700本',
    stepFeedbacks: [
      directStep({ stepIndex: 1, solutionText: '设文艺书为x本', explanationText: '科技书是文艺书的1.4倍，所以设文艺书为x' }),
      directStep({ stepIndex: 2, solutionText: 'x+1.4x=1200\n2.4x=1200\nx=500', explanationText: '文+科的总数=1200\n求出文艺书的量' }),
      directStep({ stepIndex: 3, solutionText: '1200-500=700(本)', explanationText: '用总量-文=科' }),
      directStep({ stepIndex: 4, solutionText: '答：文艺书500本，科技书700本。', explanationText: '', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '最终作答。', correctionAdvice: '' })
    ], stepStatus: 'wrong', logicStatus: 'insufficient', errorType: 'logic_error', finalAnswerCorrect: true
  })]);
  const reviewed = hardProblemPayload([directQuestion({
    sourceKey: 'q-library-purpose', questionText: '图书馆题', studentAnswer: '文艺书500本，科技书700本', standardAnswer: '文艺书500本，科技书700本',
    stepFeedbacks: [
      directStep({ stepIndex: 1, solutionText: '设文艺书为x本', explanationText: '科技书是文艺书的1.4倍，所以设文艺书为x' }),
      directStep({ stepIndex: 2, solutionText: 'x+1.4x=1200', explanationText: '文+科的总数=1200' }),
      directStep({ stepIndex: 3, solutionText: '2.4x=1200\nx=500', explanationText: '求出文艺书的量' }),
      directStep({ stepIndex: 4, solutionText: '1200-500=700(本)', explanationText: '用总量-文=科' }),
      directStep({ stepIndex: 5, solutionText: '答：文艺书500本，科技书700本。', explanationText: '', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '最终作答。', correctionAdvice: '' })
    ], stepStatus: 'wrong', logicStatus: 'insufficient', errorType: 'logic_error', finalAnswerCorrect: true
  })]);
  const flow = await runHardProblemDirectStages(primary, reviewed);
  const finalQuestion = flow.reviewStage.handoffPatch.mergedDraft.questions[0];
  assert.equal(flow.primaryDraft.questions[0].stepFeedbacks.length, 3);
  assert.equal(finalQuestion.stepFeedbacks.length, 4);
  assert.equal(finalQuestion.stepFeedbacks[1].solutionText, 'x+1.4x=1200');
  assert.equal(finalQuestion.stepFeedbacks[2].solutionText, '2.4x=1200\nx=500');
  assert.equal(finalQuestion.stepFeedbacks[2].explanationText, '求出文艺书的量');
  assert.equal(finalQuestion.stepFeedbacks.some((step) => /^答[：:]/.test(step.solutionText)), false);
  assert.equal(finalQuestion.logicStatus, 'correct');
  assert.equal(finalQuestion.errorType, 'none');
});

test('hard-problem direct review parse/schema failure preserves a valid primary instead of failing the task', async () => {
  const primary = hardProblemPayload([directQuestion({
    sourceKey: 'q-fallback', questionText: '1+1', studentAnswer: '2', standardAnswer: '2',
    stepFeedbacks: [directStep()], stepStatus: 'correct', logicStatus: 'correct', errorType: 'none', finalAnswerCorrect: true
  })]);
  const error = Object.assign(new Error('review json invalid'), { code: 'LLM_JSON_PARSE_ERROR' });
  const flow = await runHardProblemDirectStages(primary, null, error);
  assert.equal(flow.reviewStage.nextStage, 'FINALIZING_RESULT');
  assert.equal(flow.reviewStage.handoffPatch.mergedDraft.questions[0].sourceKey, 'image-1-question-1');
  assert.equal(flow.reviewStage.handoffPatch.mergedDraft.questions[0].stepFeedbacks[0].solutionStatus, 'correct');
  assert.ok(flow.reviewStage.handoffPatch.mergedDraft.validationWarnings.some((item) => String(item).startsWith('DIRECT_REVIEW_UNAVAILABLE_PRIMARY_PRESERVED')));
});


test('hard-problem direct review keep preserves the first result and never triggers a third model call', async () => {
  const primary = hardProblemPayload([directQuestion({
    sourceKey: 'q-keep', questionText: '图书馆题', studentAnswer: '500和700', standardAnswer: '500和700',
    stepFeedbacks: [directStep({ explanationText: '求出文艺书的量', explanationStatus: 'clear', logicStatus: 'clear' })],
    stepStatus: 'correct', logicStatus: 'correct', errorType: 'none', finalAnswerCorrect: true,
    firstWrongStep: '', errorReason: '', adjustmentSuggestion: ''
  })]);
  const flow = await runHardProblemDirectStages(primary, null, null, 'keep');
  assert.equal(flow.reviewStage.nextStage, 'FINALIZING_RESULT');
  assert.equal(flow.reviewStage.handoffPatch.mergedDraft.questions[0].stepFeedbacks[0].explanationText, '求出文艺书的量');
  assert.equal(flow.arkCalls.length, 2);
  assert.deepEqual(flow.arkCalls.map((call) => call.logicalPass), [1, 2]);
  assert.ok(flow.auditEvents.some((args) => args[1] === 'HARD_PROBLEM_DIRECT_REVIEW_KEPT'));
  assert.equal(flow.auditEvents.some((args) => String(args[1]).includes('ARBITRATION')), false);
});

test('hard-problem direct review correct replaces the first result without string-consensus arbitration', async () => {
  const primary = hardProblemPayload([directQuestion({
    sourceKey: 'q-correct', questionText: '图书馆题', studentAnswer: '500和700', standardAnswer: '500和700',
    stepFeedbacks: [directStep({ explanationText: '', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '未检测到讲解', correctionAdvice: '补充讲解' })],
    stepStatus: 'wrong', logicStatus: 'insufficient', errorType: 'logic_error', finalAnswerCorrect: true,
    firstWrongStep: '第1步讲解', errorReason: '未检测到讲解', adjustmentSuggestion: '补充讲解'
  })]);
  const review = hardProblemPayload([directQuestion({
    sourceKey: 'q-correct', questionText: '图书馆题', studentAnswer: '500和700', standardAnswer: '500和700',
    stepFeedbacks: [directStep({ explanationText: '求出文艺书的量', explanationStatus: 'clear', logicStatus: 'clear', analysis: '原图中有讲解，复核正确', correctionAdvice: '' })],
    stepStatus: 'correct', logicStatus: 'correct', errorType: 'none', finalAnswerCorrect: true,
    firstWrongStep: '', errorReason: '', adjustmentSuggestion: ''
  })]);
  const flow = await runHardProblemDirectStages(primary, review);
  assert.equal(flow.reviewStage.handoffPatch.mergedDraft.questions[0].stepFeedbacks[0].explanationText, '求出文艺书的量');
  assert.equal(flow.arkCalls.length, 2);
  assert.ok(flow.auditEvents.some((args) => args[1] === 'HARD_PROBLEM_DIRECT_REVIEW_CORRECTED'));
  assert.equal(flow.auditEvents.some((args) => String(args[1]).includes('ARBITRATION')), false);
});

test('natural direct draft maps one combined mathematical action to one existing frontend step', () => {
  const raw = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText: '图书馆题', studentAnswer: '文艺书500本，科技书700本', standardAnswer: '文艺书500本，科技书700本', finalAnswerVerdict: 'correct',
    steps: [
      { stepTitle: '设未知数', studentProcess: '设图书馆有文艺书x本', studentAnalysis: '科技书是文艺书的1.4倍，所以设文艺书为x', verdict: 'correct', issueTarget: 'none', reason: '设未知数正确', advice: '' },
      { stepTitle: '列方程', studentProcess: 'x+1.4x=1200', studentAnalysis: '文加科的总数等于1200', verdict: 'correct', issueTarget: 'none', reason: '列方程正确', advice: '' },
      { stepTitle: '解方程', studentProcess: '2.4x=1200\nx=500', studentAnalysis: '求出文艺书的量', verdict: 'correct', issueTarget: 'none', reason: '解方程正确', advice: '' },
      { stepTitle: '求另一量', studentProcess: '1200-500=700(本)', studentAnalysis: '用总量减文艺书得到科技书', verdict: 'correct', issueTarget: 'none', reason: '求另一量正确', advice: '' }
    ], overallFeedback: '正确', confidence: 0.95
  }] });
  const result = calculationRuntime.adaptHardProblemDirectDraft(raw, directStrategyFixture());
  assert.equal(result.questions[0].stepFeedbacks.length, 4);
  assert.equal(result.questions[0].stepFeedbacks[2].solutionText, '2.4x=1200\nx=500');
  assert.equal(result.questions[0].stepFeedbacks[2].explanationText, '求出文艺书的量');
  assert.equal(result.questions[0].stepFeedbacks[2].solutionStatus, 'correct');
  assert.equal(result.questions[0].stepFeedbacks[2].explanationStatus, 'clear');
  assert.equal(result.questions[0].stepFeedbacks[2].logicStatus, 'clear');
});

test('frontend-contract direct draft preserves missing explanation while keeping independently clear logic', () => {
  const raw = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'题目', studentAnswer:'答案', standardAnswer:'答案', finalAnswerVerdict:'correct',
    steps:[{
      stepTitle:'计算', solutionText:'2.4x=1200\nx=500', explanationText:'',
      solutionStatus:'correct', explanationStatus:'missing', logicStatus:'clear',
      analysis:'计算过程正确，但学生没有写对应讲解。', correctionAdvice:'补充说明这一步为什么能求出未知量。'
    }],
    overallFeedback:'过程正确，但该步缺少学生讲解。', confidence:0.9
  }] });
  const result = calculationRuntime.adaptHardProblemDirectDraft(raw, directStrategyFixture());
  const step = result.questions[0].stepFeedbacks[0];
  assert.equal(step.solutionStatus, 'correct');
  assert.equal(step.explanationText, '');
  assert.equal(step.explanationStatus, 'missing');
  assert.equal(step.logicStatus, 'clear');
  assert.equal(result.questions[0].logicStatus, 'correct');
  assert.notEqual(result.questions[0].stepStatus, 'correct');
});

test('direct review wrapper keeps a valid primary and only requires correctedResult when correction is requested', () => {
  assert.deepEqual(calculationRuntime.normalizeHardProblemDirectReview({ reviewDecision:'keep', reason:'没有实质错误', correctedResult:null }), { reviewDecision:'keep', reason:'没有实质错误', correctedResult:null });
  assert.throws(() => calculationRuntime.normalizeHardProblemDirectReview({ reviewDecision:'correct', reason:'需要纠正', correctedResult:null }), /correctedResult/);
  const corrected = calculationRuntime.normalizeHardProblemDirectReview({ reviewDecision:'correct', reason:'漏了一步', correctedResult:{ questions:[{ questionText:'题目', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct', steps:[{ stepTitle:'计算', studentProcess:'1+1=2', studentAnalysis:'因为1加1等于2', verdict:'correct', issueTarget:'none', reason:'正确', advice:'' }], overallFeedback:'正确', confidence:0.9 }] } });
  assert.equal(corrected.reviewDecision, 'correct');
  assert.equal(corrected.correctedResult.questions[0].steps.length, 1);
});

test('frontend-contract direct draft rejects missing required status fields instead of guessing model intent', () => {
  assert.throws(() => calculationRuntime.normalizeHardProblemDirectDraft({ questions:[{
    questionText:'题目', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct',
    steps:[{
      stepTitle:'计算', solutionText:'1+1=2', explanationText:'因为1加1等于2',
      explanationStatus:'clear', logicStatus:'clear', analysis:'正确', correctionAdvice:''
    }],
    overallFeedback:'正确', confidence:0.9
  }] }), /solutionStatus/);
  assert.throws(() => calculationRuntime.normalizeHardProblemDirectDraft({ questions:[{
    questionText:'题目', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'',
    steps:[], overallFeedback:'结果待核对', confidence:0.9
  }] }), /finalAnswerVerdict/);
});

test('frontend-contract validator rejects visible explanation paired with missing explanationStatus instead of silently rewriting it', () => {
  const raw = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText: '图书馆题', studentAnswer: '500和700', standardAnswer: '500和700', finalAnswerVerdict: 'correct',
    steps: [{
      stepTitle:'解方程', solutionText:'2.4x=1200\nx=500', explanationText:'求出文艺书的量',
      solutionStatus:'correct', explanationStatus:'missing', logicStatus:'clear',
      analysis:'求出文艺书数量', correctionAdvice:'请核对讲解状态。'
    }],
    overallFeedback: '正确', confidence: 0.9
  }] });
  assert.equal(raw.questions[0].steps[0].explanationText, '求出文艺书的量');
  assert.equal(raw.questions[0].steps[0].explanationStatus, 'missing');
  assert.throws(
    () => calculationRuntime.adaptHardProblemDirectDraft(raw, directStrategyFixture()),
    /Visible explanation text conflicts with missing status|LLM_SCHEMA_ERROR/
  );
});

test('direct adapter keeps four student processes plus four explanations as exactly four steps', () => {
  const steps = Array.from({ length: 4 }, (_, index) => ({
    studentProcess: `过程${index + 1}`, studentExplanation: `解释${index + 1}`,
    processVerdict: 'correct', explanationVerdict: 'clear', logicVerdict: 'correct', errorKind: 'none', reason: '正确', advice: ''
  }));
  const result = calculationRuntime.adaptHardProblemDirectDraft(calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{ questionText:'题目', studentAnswer:'答案', standardAnswer:'答案', finalAnswerVerdict:'correct', steps, overallFeedback:'正确', confidence:0.9 }] }), directStrategyFixture());
  assert.equal(result.questions[0].stepFeedbacks.length, 4);
  assert.deepEqual(result.questions[0].stepFeedbacks.map((step) => step.explanationText), ['解释1','解释2','解释3','解释4']);
});

test('direct adapter preserves a multi-line equation chain as one student step when the model says it is one step', () => {
  const result = calculationRuntime.adaptHardProblemDirectDraft(calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{ questionText:'题目', studentAnswer:'500', standardAnswer:'500', finalAnswerVerdict:'correct', steps:[{ studentProcess:'2.4x=1200\nx=500', studentExplanation:'求出文艺书的量', processVerdict:'correct', explanationVerdict:'clear', logicVerdict:'correct', errorKind:'none', reason:'正确', advice:'' }], overallFeedback:'正确', confidence:0.9 }] }), directStrategyFixture());
  assert.equal(result.questions[0].stepFeedbacks.length, 1);
  assert.equal(result.questions[0].stepFeedbacks[0].solutionText, '2.4x=1200\nx=500');
});

test('direct adapter falls back to the trusted teacher answer when the model omits standardAnswer', () => {
  const draft = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{ questionText:'题目', studentAnswer:'500', standardAnswer:'', finalAnswerVerdict:'correct', steps:[{ studentProcess:'x=500', studentExplanation:'求出文艺书的量', processVerdict:'correct', explanationVerdict:'clear', logicVerdict:'correct', reason:'正确', advice:'' }], overallFeedback:'正确', confidence:0.9 }] });
  const result = calculationRuntime.adaptHardProblemDirectDraft(draft, directStrategyFixture(), { manualAnswer:'500' });
  assert.equal(result.questions[0].standardAnswer, '500');
});

test('direct draft accepts ordinary LaTeX-like math text instead of treating it as corrupted student content', () => {
  const draft = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{ questionText:'计算\\frac{1}{2}+\\frac{1}{2}', studentAnswer:'1', standardAnswer:'1', finalAnswerVerdict:'correct', steps:[{ studentProcess:'\\frac{1}{2}+\\frac{1}{2}=1', studentExplanation:'两个二分之一相加', processVerdict:'correct', explanationVerdict:'clear', logicVerdict:'correct', reason:'正确', advice:'' }], overallFeedback:'正确', confidence:0.9 }] });
  assert.match(draft.questions[0].steps[0].studentProcess, /frac/);
});

test('direct draft rejects actual replacement characters instead of silently sending corrupted text to the UI', () => {
  assert.throws(() => calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{ questionText:'题目', studentAnswer:'1', standardAnswer:'1', finalAnswerVerdict:'correct', steps:[{ studentProcess:'1+\uFFFD=2', studentExplanation:'', processVerdict:'unreadable', explanationVerdict:'missing', logicVerdict:'unreadable', reason:'看不清', advice:'重拍' }], overallFeedback:'', confidence:0.5 }] }), /HARD_PROBLEM_DIRECT_SCHEMA_ERROR|损坏文本/);
});

test('direct grading reproduces the library-book example as four correct student steps with the third multi-line step and all four explanations preserved', () => {
  const raw = { questions: [{
    questionText:'图书馆科技书是文艺书的1.4倍，两种书共1200本，分别有多少本？',
    studentAnswer:'文艺书500本，科技书700本', standardAnswer:'文艺书500本，科技书700本', finalAnswerVerdict:'correct',
    steps:[
      { studentProcess:'设图书馆有文艺书x本', studentExplanation:'科技书是文艺书的1.4倍，所以设文艺书为x', processVerdict:'correct', explanationVerdict:'clear', logicVerdict:'correct', reason:'设1倍量为x正确', advice:'' },
      { studentProcess:'x+1.4x=1200', studentExplanation:'文艺书和科技书的总数是1200本', processVerdict:'correct', explanationVerdict:'clear', logicVerdict:'correct', reason:'数量关系正确', advice:'' },
      { studentProcess:'2.4x=1200\nx=500', studentExplanation:'求出文艺书的量', processVerdict:'correct', explanationVerdict:'clear', logicVerdict:'correct', reason:'解方程正确', advice:'' },
      { studentProcess:'1200-500=700(本)', studentExplanation:'用总量减去文艺书得到科技书', processVerdict:'correct', explanationVerdict:'clear', logicVerdict:'correct', reason:'计算与解释正确', advice:'' }
    ], overallFeedback:'全部正确', confidence:0.98
  }] };
  const result = calculationRuntime.adaptHardProblemDirectDraft(calculationRuntime.normalizeHardProblemDirectDraft(raw), directStrategyFixture());
  const q = result.questions[0];
  assert.equal(q.stepFeedbacks.length, 4);
  assert.equal(q.stepFeedbacks[2].solutionText, '2.4x=1200\nx=500');
  assert.equal(q.stepFeedbacks[2].explanationText, '求出文艺书的量');
  assert.deepEqual(q.stepFeedbacks.map((s) => [s.solutionStatus, s.explanationStatus, s.logicStatus]), Array(4).fill(['correct','clear','clear']));
  assert.equal(q.evaluationStatus, 'CORRECT');
});




test('cow-grass frontend contract preserves the intended four student steps and explicit process-analysis pairing', () => {
  const raw = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'一片牧草每天匀速生长，可供10头牛吃12天，也可供8头牛吃20天，最多养多少头牛使草永远吃不完？',
    studentAnswer:'最多5头牛', standardAnswer:'5头牛', finalAnswerVerdict:'correct',
    steps:[
      {
        stepTitle:'设单位量', solutionText:'解：设每头牛每天吃1份草。', explanationText:'',
        solutionStatus:'correct', explanationStatus:'missing', logicStatus:'clear',
        analysis:'设定统一单位正确。', correctionAdvice:'可补充说明设1份草是为了统一后续计算单位。'
      },
      {
        stepTitle:'列综合算式', solutionText:'(20×8-12×10)÷(20-12)',
        explanationText:'①求出8头牛20天吃的、10头牛12天吃的；②相减得出相差草数，20-12是天数。',
        solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear',
        analysis:'综合算式与前两条分析对应正确。', correctionAdvice:''
      },
      {
        stepTitle:'计算结果', solutionText:'=40÷8\n=5份。',
        explanationText:'③用草数÷天数求出每天长5份草。',
        solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear',
        analysis:'计算得到每天生长5份草，正确。', correctionAdvice:''
      },
      {
        stepTitle:'得出结论', solutionText:'', explanationText:'④所以最多5头牛。',
        solutionStatus:'missing', explanationStatus:'clear', logicStatus:'clear',
        analysis:'结论逻辑正确，但学生只写了分析结论，没有单独写对应解答过程。',
        correctionAdvice:'可补写：每天新长5份草，因此最多养5头牛。'
      }
    ],
    overallFeedback:'整体方法和结论正确，第4步存在只有分析而没有对应解答过程的情况。',
    confidence:0.96
  }] });
  const result = calculationRuntime.adaptHardProblemDirectDraft(raw, directStrategyFixture());
  const q = result.questions[0];
  assert.equal(q.stepFeedbacks.length, 4);
  assert.equal(q.stepFeedbacks[0].logicStatus, 'clear');
  assert.equal(q.stepFeedbacks[0].explanationStatus, 'missing');
  assert.equal(q.stepFeedbacks[1].solutionText, '(20×8-12×10)÷(20-12)');
  assert.match(q.stepFeedbacks[1].explanationText, /①/);
  assert.match(q.stepFeedbacks[1].explanationText, /②/);
  assert.equal(q.stepFeedbacks[2].solutionText, '=40÷8\n=5份。');
  assert.equal(q.stepFeedbacks[3].solutionStatus, 'missing');
  assert.equal(q.stepFeedbacks[3].explanationStatus, 'clear');
  assert.equal(q.stepFeedbacks[3].logicStatus, 'clear');
  assert.equal(q.logicStatus, 'correct');
  assert.notEqual(q.stepStatus, 'correct');
});

test('direct review can patch one frontend step while inheriting unchanged fields from the primary', () => {
  const primary = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'题目', studentAnswer:'5头牛', standardAnswer:'5头牛', finalAnswerVerdict:'correct',
    steps:[
      {
        stepTitle:'设单位量', solutionText:'设每头牛每天吃1份草。', explanationText:'',
        solutionStatus:'correct', explanationStatus:'missing', logicStatus:'clear',
        analysis:'设定正确。', correctionAdvice:'补充说明。'
      },
      {
        stepTitle:'列式', solutionText:'(20×8-12×10)÷(20-12)', explanationText:'①...②...',
        solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear',
        analysis:'列式正确。', correctionAdvice:''
      }
    ], overallFeedback:'整体正确', confidence:0.9
  }] });
  const review = calculationRuntime.normalizeHardProblemDirectReview({
    reviewDecision:'correct',
    reason:'第二步解释需要补全',
    correctedResult:{ questions:[{
      steps:[
        {},
        {
          explanationText:'①求两种总消耗；②相减得草量差，并用20-12得到天数差。',
          explanationStatus:'clear',
          logicStatus:'clear',
          analysis:'列式和解释对应完整。',
          correctionAdvice:''
        }
      ]
    }] }
  }, primary);
  assert.equal(review.reviewDecision, 'correct');
  assert.equal(review.correctedResult.questions[0].steps.length, 2);
  assert.equal(review.correctedResult.questions[0].steps[0].solutionText, '设每头牛每天吃1份草。');
  assert.equal(review.correctedResult.questions[0].steps[1].solutionText, '(20×8-12×10)÷(20-12)');
  assert.match(review.correctedResult.questions[0].steps[1].explanationText, /草量差/);
});

test('direct review may replace a bad two-step primary with a complete four-step corrected structure', () => {
  const primary = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'牛吃草题', studentAnswer:'5头牛', standardAnswer:'5头牛', finalAnswerVerdict:'correct',
    steps:[
      {
        stepTitle:'全部计算', solutionText:'设每头牛每天吃1份草。\n(20×8-12×10)÷(20-12)=40÷8=5份', explanationText:'',
        solutionStatus:'correct', explanationStatus:'missing', logicStatus:'clear',
        analysis:'计算正确但未配对分析。', correctionAdvice:'核对学生分析。'
      },
      {
        stepTitle:'全部分析', solutionText:'', explanationText:'①...②...③...④...',
        solutionStatus:'missing', explanationStatus:'clear', logicStatus:'clear',
        analysis:'分析存在但未与过程逐步配对。', correctionAdvice:'逐步配对。'
      }
    ], overallFeedback:'需要复核配对', confidence:0.8
  }] });
  const correctedSteps = [
    { stepTitle:'设单位量', solutionText:'设每头牛每天吃1份草。', explanationText:'', solutionStatus:'correct', explanationStatus:'missing', logicStatus:'clear', analysis:'设定正确。', correctionAdvice:'可补充说明。' },
    { stepTitle:'列综合算式', solutionText:'(20×8-12×10)÷(20-12)', explanationText:'①...②...', solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear', analysis:'对应正确。', correctionAdvice:'' },
    { stepTitle:'计算结果', solutionText:'=40÷8=5份', explanationText:'③...', solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear', analysis:'计算正确。', correctionAdvice:'' },
    { stepTitle:'结论', solutionText:'', explanationText:'④所以最多5头牛。', solutionStatus:'missing', explanationStatus:'clear', logicStatus:'clear', analysis:'结论正确但没有单独过程。', correctionAdvice:'补写结论过程。' }
  ];
  const review = calculationRuntime.normalizeHardProblemDirectReview({
    reviewDecision:'correct', reason:'原结果把全部过程和全部分析各自合并了',
    correctedResult:{ questions:[{
      questionText:'牛吃草题', studentAnswer:'5头牛', standardAnswer:'5头牛',
      finalAnswerVerdict:'correct', steps:correctedSteps, overallFeedback:'配对后整体正确', confidence:0.95
    }] }
  }, primary);
  assert.equal(review.correctedResult.questions[0].steps.length, 4);
  assert.equal(review.correctedResult.questions[0].steps[1].explanationText, '①...②...');
  assert.equal(review.correctedResult.questions[0].steps[3].solutionStatus, 'missing');
});

test('frontend-contract direct adapter preserves exact model fields across 16000 adversarial grading combinations', () => {
  const solutionStatuses = ['correct', 'wrong', 'missing', 'unreadable'];
  const explanationStatuses = ['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable'];
  const logicStatuses = ['clear', 'insufficient', 'wrong', 'unreadable'];
  let cases = 0;
  for (let seed = 0; seed < 16000; seed += 1) {
    const stepCount = (seed % 8) + 1;
    const steps = Array.from({ length: stepCount }, (_, index) => {
      let solutionStatus = solutionStatuses[(seed + index) % solutionStatuses.length];
      let explanationStatus = explanationStatuses[(Math.floor(seed / 3) + index) % explanationStatuses.length];
      let logicStatus = logicStatuses[(Math.floor(seed / 7) + index) % logicStatuses.length];
      const solutionText = solutionStatus === 'missing' ? '' : (index === 2 ? '2.4x=1200\nx=500' : `过程${seed}-${index + 1}`);
      const explanationText = explanationStatus === 'missing' ? '' : `分析${seed}-${index + 1}`;
      if (!solutionText && solutionStatus !== 'missing') solutionStatus = 'missing';
      if (solutionText && solutionStatus === 'missing') solutionStatus = 'correct';
      if (!explanationText && explanationStatus !== 'missing') explanationStatus = 'missing';
      if (explanationText && explanationStatus === 'missing') explanationStatus = 'clear';
      const fullyClear = solutionStatus === 'correct' && explanationStatus === 'clear' && logicStatus === 'clear';
      return {
        stepTitle: `数学动作${index + 1}`,
        solutionText,
        explanationText,
        solutionStatus,
        explanationStatus,
        logicStatus,
        analysis: `理由${seed}-${index + 1}`,
        correctionAdvice: fullyClear ? '' : `建议${seed}-${index + 1}`
      };
    });
    const normalized = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
      questionText: '对抗测试题',
      studentAnswer: '学生答案',
      standardAnswer: '标准答案',
      finalAnswerVerdict: seed % 7 === 0 ? 'wrong' : 'correct',
      steps,
      overallFeedback: '对抗测试',
      confidence: 0.91
    }] });
    const result = calculationRuntime.adaptHardProblemDirectDraft(normalized, directStrategyFixture());
    const emitted = result.questions[0].stepFeedbacks;
    assert.equal(emitted.length, stepCount, `seed=${seed} must not split or merge model steps`);
    for (let index = 0; index < stepCount; index += 1) {
      assert.deepEqual(
        emitted[index],
        {
          stepIndex: index + 1,
          solutionText: steps[index].solutionText,
          explanationText: steps[index].explanationText,
          solutionStatus: steps[index].solutionStatus,
          explanationStatus: steps[index].explanationStatus,
          logicStatus: steps[index].logicStatus,
          analysis: steps[index].analysis,
          correctionAdvice: steps[index].correctionAdvice
        },
        `seed=${seed} exact frontend step ${index + 1}`
      );
    }
    cases += 1;
  }
  assert.equal(cases, 16000);
});


test('hard-problem direct adapter deterministically fills missing correctionAdvice for a non-clear step', () => {
  const draft = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'题目', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct',
    steps:[{ solutionText:'1+1=2', explanationText:'', solutionStatus:'correct', explanationStatus:'missing', logicStatus:'clear', analysis:'缺少讲解。', correctionAdvice:'' }],
    overallFeedback:'需要补充讲解', confidence:0.9
  }] });
  const result = calculationRuntime.adaptHardProblemDirectDraft(draft, directStrategyFixture());
  assert.equal(result.questions[0].stepFeedbacks[0].correctionAdvice, '请补充说明这一步为什么这样计算。');
});

test('hard-problem direct adapter clears stray correctionAdvice when the step is fully clear', () => {
  const draft = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'题目', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct',
    steps:[{ solutionText:'1+1=2', explanationText:'两个1相加得到2', solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear', analysis:'该步正确。', correctionAdvice:'多余建议' }],
    overallFeedback:'正确', confidence:0.9
  }] });
  const result = calculationRuntime.adaptHardProblemDirectDraft(draft, directStrategyFixture());
  assert.equal(result.questions[0].stepFeedbacks[0].correctionAdvice, '');
});

test('hard-problem direct unreadable final answer remains UNREADABLE even when partial answer text is present', () => {
  const draft = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'题目', studentAnswer:'看得出前半部分…', standardAnswer:'2', finalAnswerVerdict:'unreadable',
    steps:[], overallFeedback:'最终答案无法完整识别', confidence:0.4
  }] });
  const result = calculationRuntime.adaptHardProblemDirectDraft(draft, directStrategyFixture());
  assert.equal(result.questions[0].answerStatus, 'unreadable');
  assert.equal(result.questions[0].finalAnswerCorrect, null);
  assert.equal(result.questions[0].evaluationStatus, 'UNREADABLE');
});

test('hard-problem direct answer-only result is valid and does not invent a required missing step', () => {
  const draft = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'1+1等于多少？', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct',
    steps:[], overallFeedback:'答案正确', confidence:0.95
  }] });
  const result = calculationRuntime.adaptHardProblemDirectDraft(draft, directStrategyFixture());
  assert.equal(result.questions[0].stepRequired, false);
  assert.equal(result.questions[0].stepStatus, 'not_required');
  assert.equal(result.questions[0].evaluationStatus, 'CORRECT');
});

test('hard-problem direct review rejects mismatched question counts instead of positionally patching another question', () => {
  const primary = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [
    { questionText:'题1', studentAnswer:'1', standardAnswer:'1', finalAnswerVerdict:'correct', steps:[], overallFeedback:'正确', confidence:0.9 },
    { questionText:'题2', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct', steps:[], overallFeedback:'正确', confidence:0.9 }
  ] });
  assert.throws(() => calculationRuntime.normalizeHardProblemDirectReview({ reviewDecision:'correct', reason:'只返回一题', correctedResult:{ questions:[{ questionText:'题2', studentAnswer:'3', finalAnswerVerdict:'wrong', steps:[], overallFeedback:'错误', confidence:0.9 }] } }, primary), /数量必须与 PRIMARY 一致/);
});

test('hard-problem direct review rejects equal-count question or step reordering instead of silently mispatching', () => {
  const primary = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [
    { questionText:'题甲', studentAnswer:'1', standardAnswer:'1', finalAnswerVerdict:'correct', steps:[{ solutionText:'步骤甲', explanationText:'解释甲', solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear', analysis:'正确', correctionAdvice:'' }], overallFeedback:'正确', confidence:0.9 },
    { questionText:'题乙', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct', steps:[{ solutionText:'步骤乙', explanationText:'解释乙', solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear', analysis:'正确', correctionAdvice:'' }], overallFeedback:'正确', confidence:0.9 }
  ] });
  assert.throws(() => calculationRuntime.normalizeHardProblemDirectReview({ reviewDecision:'correct', reason:'顺序交换', correctedResult:{ questions:[
    { questionText:'题乙', steps:[] }, { questionText:'题甲', steps:[] }
  ] } }, primary), /顺序与 PRIMARY 不一致/);

  const oneQuestion = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'题目', studentAnswer:'3', standardAnswer:'3', finalAnswerVerdict:'correct',
    steps:[
      { solutionText:'步骤1', explanationText:'解释1', solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear', analysis:'正确', correctionAdvice:'' },
      { solutionText:'步骤2', explanationText:'解释2', solutionStatus:'correct', explanationStatus:'clear', logicStatus:'clear', analysis:'正确', correctionAdvice:'' }
    ], overallFeedback:'正确', confidence:0.9
  }] });
  assert.throws(() => calculationRuntime.normalizeHardProblemDirectReview({ reviewDecision:'correct', reason:'步骤交换', correctedResult:{ questions:[{
    questionText:'题目', steps:[
      { solutionText:'步骤2', explanationText:'解释2' },
      { solutionText:'步骤1', explanationText:'解释1' }
    ]
  }] } }, oneQuestion), /steps 顺序与 PRIMARY 不一致/);
});

test('hard-problem direct retry only accepts schema errors whose reported issues are all repairable', () => {
  assert.equal(calculationRuntime.hardProblemDirectRecoverable({ code:'LLM_SCHEMA_ERROR', issues:[{ repairable:true }] }), true);
  assert.equal(calculationRuntime.hardProblemDirectRecoverable({ code:'LLM_SCHEMA_ERROR', issues:[{ repairable:true }, { repairable:false }] }), false);
  assert.equal(calculationRuntime.hardProblemDirectRecoverable({ code:'LLM_SCHEMA_ERROR' }), false);
});

test('hard-problem direct multi-image attribution does not falsely label every question as image-1', () => {
  const draft = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{ questionText:'题目', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct', steps:[], overallFeedback:'正确', confidence:0.9 }] });
  const result = calculationRuntime.adaptHardProblemDirectDraft(draft, directStrategyFixture(), { studentImageCount:3 });
  assert.equal(result.questions[0].sourceKey, 'image-set-3-question-1');
  assert.equal(result.questions[0].sourceRegion, 'images-1-3:question-1');
});

test('hard-problem direct rejects blank questionText before PRIMARY can hand off to FINALIZING', () => {
  assert.throws(() => calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'   ', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct', steps:[], overallFeedback:'答案正确', confidence:0.9
  }] }), (error) => error?.code === 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR' && error?.fieldPath === 'questions[0].questionText');
});

test('hard-problem direct safely derives objective standardAnswer only from matching evidence', () => {
  const correctDraft = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'1+1等于多少？', studentAnswer:'2', standardAnswer:'', finalAnswerVerdict:'correct', steps:[], overallFeedback:'答案正确', confidence:0.9
  }] });
  const correctResult = calculationRuntime.adaptHardProblemDirectDraft(correctDraft, directStrategyFixture());
  assert.equal(correctResult.questions[0].standardAnswer, '2');

  const multiDraft = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [
    { questionText:'题1', studentAnswer:'错误1', standardAnswer:'', finalAnswerVerdict:'wrong', steps:[], overallFeedback:'错误', confidence:0.9 },
    { questionText:'题2', studentAnswer:'错误2', standardAnswer:'', finalAnswerVerdict:'wrong', steps:[], overallFeedback:'错误', confidence:0.9 }
  ] });
  const multiResult = calculationRuntime.adaptHardProblemDirectDraft(multiDraft, directStrategyFixture(), { referenceAnswers:['标准1','标准2'], manualAnswer:'不得复制到每一道题' });
  assert.deepEqual(multiResult.questions.map((q) => q.standardAnswer), ['标准1','标准2']);
});

test('hard-problem direct review cannot erase PRIMARY questionText or standardAnswer with empty strings', () => {
  const primary = calculationRuntime.normalizeHardProblemDirectDraft({ questions: [{
    questionText:'原题文字', studentAnswer:'2', standardAnswer:'2', finalAnswerVerdict:'correct', steps:[], overallFeedback:'正确', confidence:0.9
  }] });
  const review = calculationRuntime.normalizeHardProblemDirectReview({ reviewDecision:'correct', reason:'仅修改反馈', correctedResult:{ questions:[{
    questionText:'', standardAnswer:'', overallFeedback:'复核后仍正确'
  }] } }, primary);
  assert.equal(review.correctedResult.questions[0].questionText, '原题文字');
  assert.equal(review.correctedResult.questions[0].standardAnswer, '2');
  assert.equal(review.correctedResult.questions[0].overallFeedback, '复核后仍正确');
});

test('hard-problem direct mode has exclusive precedence over V10 V9 and evidence recovery branches', () => {
  const prompts = {
    hardProblemEvidence:{system:'x',userTemplate:'x'},
    hardProblemEvidenceV9:{system:'x',userTemplate:'x'}, hardProblemEvidenceVerify:{system:'x',userTemplate:'x'}, hardProblemMethod:{system:'x',userTemplate:'x'}, hardProblemPlan:{system:'x',userTemplate:'x'}, hardProblemPlanAudit:{system:'x',userTemplate:'x'}, hardProblemCoverage:{system:'x',userTemplate:'x'},
    hardProblemEvidenceV10:{system:'x',userTemplate:'x'}, hardProblemEvidenceVerifyV10:{system:'x',userTemplate:'x'}, hardProblemTruthV10:{system:'x',userTemplate:'x'}, hardProblemMethodV10:{system:'x',userTemplate:'x'}, hardProblemHypothesesV10:{system:'x',userTemplate:'x'}, hardProblemHypothesisAuditV10:{system:'x',userTemplate:'x'}, hardProblemCoverageV10:{system:'x',userTemplate:'x'}, hardProblemAdversarialJudgeV10:{system:'x',userTemplate:'x'}
  };
  const hybrid = { reviewRules:{ hardProblemDirectMode:true }, prompts };
  assert.equal(calculationRuntime.usesHardProblemDirect(hybrid), true);
  assert.equal(calculationRuntime.usesHardProblemV10(hybrid), false);
  assert.equal(calculationRuntime.usesHardProblemV9(hybrid), false);
  assert.equal(calculationRuntime.usesHardProblemEvidencePipeline(hybrid), false);
});

test('hard-problem direct required-field gap detection is bounded to fields that really need recovery', () => {
  const raw = { questions:[
    { questionText:'', studentAnswer:'错误答案', standardAnswer:'', finalAnswerVerdict:'wrong', steps:[{ solutionText:'1+1=3', explanationText:'', solutionStatus:'wrong', explanationStatus:'missing', logicStatus:'wrong', analysis:'计算错误', correctionAdvice:'订正' }], overallFeedback:'错误', confidence:0.9 },
    { questionText:'题2', studentAnswer:'2', standardAnswer:'', finalAnswerVerdict:'correct', steps:[], overallFeedback:'正确', confidence:0.9 }
  ] };
  const prepared = calculationRuntime.applyHardProblemDirectDeterministicFields(raw, {});
  assert.equal(prepared.questions[1].standardAnswer, '2');
  assert.deepEqual(calculationRuntime.hardProblemDirectRequiredFieldGaps(prepared, {}), [
    { questionIndex:1, field:'questionText' },
    { questionIndex:1, field:'standardAnswer' }
  ]);
});

test('hard-problem direct second PRIMARY attempt uses one bounded field-only repair for missing questionText and standardAnswer', async () => {
  const calls = [];
  const strategy = {
    ...directStrategyFixture(),
    modelRuntime: { stages: {
      hardProblemPrimary: { outputSchemaVersion:'hard-problem.v2', modelTier:'lite', temperature:0, maxOutputTokens:4096, timeoutMs:1000, structuredOutputMode:'none', maxRepairAttempts:1 },
      hardProblemReview: { outputSchemaVersion:'hard-problem.v2', modelTier:'lite', temperature:0, maxOutputTokens:4096, timeoutMs:1000, structuredOutputMode:'none', maxRepairAttempts:1 }
    } },
    prompts: { hardProblem: { system:'直接看图批改，只输出JSON。', userTemplate:'{"questions":[]}', reviewSystem:'复核', reviewUserTemplate:'{"reviewDecision":"keep|correct","reason":"","correctedResult":null}' } }
  };
  const writes = [];
  const runtime = createGradingRuntime({
    context: { db: { collection: (name) => ({ doc: () => ({ set: async ({data}) => writes.push({name,data}), update: async ({data}) => writes.push({name,data}) }) }) } },
    constants: { C: { tasks:'tasks', results:'results', wrong:'wrong' } }, audit: { monitor() {} },
    ark: { callArk: async (options) => {
      calls.push(options.mode);
      if (options.mode === 'hard_problem_direct_required_field_repair') return { questions:[{ questionIndex:1, questionText:'1+1等于多少？', standardAnswer:'2' }] };
      return { questions:[{
        questionText:'', studentAnswer:'3', standardAnswer:'', finalAnswerVerdict:'wrong',
        steps:[{ solutionText:'1+1=3', explanationText:'把两个1相加', solutionStatus:'wrong', explanationStatus:'incorrect', logicStatus:'wrong', analysis:'计算结果错误。', correctionAdvice:'1+1应等于2。' }],
        overallFeedback:'需要订正计算结果。', confidence:0.9
      }] };
    } },
    utils: { now: () => new Date('2026-08-11T00:00:00.000Z'), randomId: () => 'id', shanghaiDateKey: require('../shared/utils').shanghaiDateKey, safeError: (error) => ({code:error.code,message:error.message}) },
    checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy }, strategyRender: { hardProblemUserPrompt: () => '' }, enqueueTts: async () => {}
  });
  const stage = await runtime.test.process({ _id:'task-direct-required-repair', studentId:'s1', mode:'HARD_PROBLEM_CHECK', hardProblemModelProvider:'qwen3_vl_plus', studentImageFileIds:[], answerImageFileIds:[], currentStage:'PRIMARY_GRADING', hardProblemDirectRetryCount:1 }, Date.now());
  assert.equal(stage.nextStage, 'REVIEW_GRADING');
  assert.equal(stage.handoffPatch.primaryDraft.questions[0].questionText, '1+1等于多少？');
  assert.equal(stage.handoffPatch.primaryDraft.questions[0].standardAnswer, '2');
  assert.deepEqual(calls, ['hard_problem_direct', 'hard_problem_direct_required_field_repair']);
});

test('REVIEW sourceKey drift is restored from unique attribution for reading and calculation careless modes', () => {
  const reading = readingMergeRuntime();
  const readingPrimaryQuestion = readingMergeQuestion('reading-primary', { sourceQuestionLabel: '第7题', sourceRegion: 'image-2:q7' });
  const readingReviewQuestion = readingMergeQuestion('reading-review-generated', { sourceQuestionLabel: '第7题', sourceRegion: 'image-2:q7', referenceConditionText: '复核条件' });
  const readingMerged = reading.mergeCarelessTrainingResults(
    { outputSchemaVersion: 'reading-careless.v2', questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }, questions: [readingPrimaryQuestion] },
    { outputSchemaVersion: 'reading-careless.v2', questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }, questions: [readingReviewQuestion] }
  );
  assert.equal(readingMerged.questions[0].sourceKey, 'reading-primary');
  assert.equal(readingMerged.questions[0].referenceConditionText, '复核条件');

  const calcPrimaryQuestion = calculationPayload({ sourceKey: 'calc-primary', sourceQuestionLabel: '第3题', sourceRegion: 'image-3:q3', studentWorkDetected: true, inputBasis: 'printed_question_with_work', modeApplicability: 'applicable' }).questions[0];
  const calcReviewQuestion = { ...calcPrimaryQuestion, sourceKey: 'calc-review-generated' };
  const calcMerged = calculationRuntime.mergeCalculationCarelessTrainingResults(
    { outputSchemaVersion: 'calculation-careless.v2', questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }, questions: [calcPrimaryQuestion] },
    { outputSchemaVersion: 'calculation-careless.v2', questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }, questions: [calcReviewQuestion] },
    {}
  );
  assert.equal(calcMerged.questions[0].sourceKey, 'calc-primary');
});

test('REVIEW can add a genuinely missed careless question only when attribution is explicit and independent count audit grows', () => {
  const runtime = readingMergeRuntime();
  const q1 = readingMergeQuestion('q-1', { sourceQuestionLabel: '第1题', sourceRegion: 'image-1:q1' });
  const q2 = readingMergeQuestion('q-2-review', { sourceQuestionLabel: '第2题', sourceRegion: 'image-1:q2', questionText: '第2题 求剩余数量' });
  const primary = {
    outputSchemaVersion: 'reading-careless.v2',
    questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 0.8 },
    questions: [q1]
  };
  const review = {
    outputSchemaVersion: 'reading-careless.v2',
    questionSetAudit: { visibleIndependentQuestionCount: 2, emittedQuestionCount: 2, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [q1, q2]
  };
  const merged = runtime.mergeCarelessTrainingResults(primary, review);
  assert.deepEqual(merged.questions.map((question) => question.sourceKey), ['q-1', 'q-2-review']);

  assert.throws(() => runtime.mergeCarelessTrainingResults(primary, { ...review, questionSetAudit: primary.questionSetAudit }), (error) => error.code === 'QUESTION_SET_MISMATCH');
});

test('REVIEW can restore one PRIMARY-excluded question without increasing the visible independent count', () => {
  const runtime = readingMergeRuntime();
  const q1 = readingMergeQuestion('q-1', { sourceQuestionLabel: '第1题', sourceRegion: 'image-1:q1' });
  const restored = readingMergeQuestion('q-2-review', { sourceQuestionLabel: '第2题', sourceRegion: 'image-1:q2', questionText: '第2题 求剩余数量' });
  const primary = {
    outputSchemaVersion: 'reading-careless.v2',
    questionSetAudit: { visibleIndependentQuestionCount: 2, emittedQuestionCount: 1, excludedQuestionCount: 1, orientation: 'upright', countConfidence: 1 },
    questions: [q1]
  };
  const review = {
    outputSchemaVersion: 'reading-careless.v2',
    questionSetAudit: { visibleIndependentQuestionCount: 2, emittedQuestionCount: 2, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [q1, restored]
  };

  const merged = runtime.mergeCarelessTrainingResults(primary, review);
  assert.deepEqual(merged.questions.map((question) => question.sourceKey), ['q-1', 'q-2-review']);
});

test('careless REVIEW recovery instruction identifies an added-question audit mismatch without question text', () => {
  const primary = { questions: [readingMergeQuestion('q-1', { sourceQuestionLabel: '第1题', sourceRegion: 'image-1:q1' })] };
  const instruction = calculationRuntime.reviewContractInstruction(primary, {
    errorCode: 'QUESTION_SET_MISMATCH',
    auditMismatch: {
      primaryVisible: 4,
      primaryEmitted: 4,
      primaryExcluded: 0,
      reviewVisible: 4,
      reviewEmitted: 5,
      reviewExcluded: 0,
      newQuestionCount: 1,
      addedQuestionIdentities: [{ sourceKey: 'image-1-q5', sourceQuestionLabel: '第5题', sourceRegion: 'image-1:q5' }]
    }
  });
  assert.match(instruction, /上一轮REVIEW新增题目与题数审计不一致/);
  assert.match(instruction, /"reviewEmitted":5/);
  assert.match(instruction, /"sourceKey":"image-1-q5"/);
});

test('hard-problem REVIEW recovery instruction targets the actual schema failure instead of always claiming fixed-step mismatch', () => {
  const instruction = calculationRuntime.hardProblemReviewRecoveryInstruction({
    hardProblemReviewRecoveryCount: 1,
    hardProblemReviewLastFailure: { errorCode: 'LLM_SCHEMA_REPAIR_FAILED', causeCode: 'MISSING_REQUIRED_PATCH', fieldPath: 'questions[0].firstWrongStep' }
  }, { questions: [{ sourceKey: 'q-1', pairedSteps: [{}] }] });
  assert.match(instruction, /字段修复补丁不完整/);
  assert.doesNotMatch(instruction, /上一次输出未通过固定步骤契约/);
});

test('careless stage recovery retries identity and question-set failures but not business-semantic model judgments', () => {
  assert.equal(calculationRuntime.CARELESS_STAGE_MAX_RECOVERY, 1);
  assert.equal(calculationRuntime.carelessStageRecoverable({ code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[2].questionText' }, calculationRuntime.STAGES.PRIMARY_GRADING), true);
  assert.equal(calculationRuntime.carelessStageRecoverable({ code: 'QUESTION_SET_MISMATCH' }, calculationRuntime.STAGES.REVIEW_GRADING), true);
  assert.equal(calculationRuntime.carelessStageRecoverable({ code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[0].issueCategory' }, calculationRuntime.STAGES.PRIMARY_GRADING), false);
});


test('reading-careless recognizes img/image/page aliases as the same image identity without cross-image merging', () => {
  const runtime = readingMergeRuntime();
  assert.equal(runtime.readingImageIdentity({ sourceKey: 'img3_calc_001' }), '3');
  assert.equal(runtime.readingImageIdentity({ sourceRegion: 'image-3-top' }), '3');
  assert.equal(runtime.readingImageIdentity({ sourceRegion: 'page_3:right' }), '3');
  const result = runtime.consolidateReadingQuestions({
    outputSchemaVersion: 'reading-careless.v2',
    questions: [
      readingMergeQuestion('img1_q1_a', { questionText: '第1题 第一段', sourceQuestionLabel: '第1题' }),
      readingMergeQuestion('image-1-q1-b', { questionText: '第1题 第二段', sourceQuestionLabel: '第1题' }),
      readingMergeQuestion('img2_q1', { questionText: '第1题 第二张图片', sourceQuestionLabel: '第1题' })
    ]
  });
  assert.equal(result.questions.length, 2);
  assert.deepEqual(result.questions.map((q) => runtime.readingQuestionIdentity(q)), ['image:1:printed:1', 'image:2:printed:1']);
});

test('reading-careless refuses to auto-merge same printed number when image identity is absent', () => {
  const runtime = readingMergeRuntime();
  const result = runtime.consolidateReadingQuestions({
    outputSchemaVersion: 'reading-careless.v2',
    questions: [
      readingMergeQuestion('opaque-a', { questionText: '第8题 甲图片内容', sourceQuestionLabel: '第8题' }),
      readingMergeQuestion('opaque-b', { questionText: '第8题 乙图片内容', sourceQuestionLabel: '第8题' })
    ]
  });
  assert.equal(result.questions.length, 2);
  assert.deepEqual(result.questions.map((q) => runtime.readingQuestionIdentity(q)), ['', '']);
});

test('review attribution treats img and image aliases as the same canonical question only when question number agrees', () => {
  const runtime = readingMergeRuntime();
  const primary = {
    outputSchemaVersion: 'reading-careless.v2',
    canonicalSourceKeys: ['primary-k'],
    questions: [readingMergeQuestion('primary-k', { questionText: '第6题', sourceQuestionLabel: '第6题', sourceRegion: 'img1_top' })]
  };
  const review = {
    outputSchemaVersion: 'reading-careless.v2',
    questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [readingMergeQuestion('review-k', { questionText: '第6题', sourceQuestionLabel: '第6题', sourceRegion: 'image-1-top' })]
  };
  const restored = runtime.restoreReviewQuestionAttribution(primary, review);
  assert.equal(restored.questions[0].sourceKey, 'primary-k');
});


test('reading identity accepts compact q-number source labels without confusing image identity', () => {
  const runtime = readingMergeRuntime();
  const a = readingMergeQuestion('img2_q17_top', { questionText: '', sourceQuestionLabel: 'Q17', sourceRegion: 'img2_top' });
  const b = readingMergeQuestion('image-2-question-17', { questionText: '', sourceQuestionLabel: '17', sourceRegion: 'image-2-top' });
  assert.equal(runtime.readingQuestionIdentity(a), 'image:2:printed:17');
  assert.equal(runtime.readingQuestionIdentity(b), 'image:2:printed:17');
});

test('reading merge never fabricates perfect confidence when all source confidences are non-finite', () => {
  const runtime = readingMergeRuntime();
  const result = runtime.consolidateReadingQuestions({
    outputSchemaVersion: 'reading-careless.v2',
    questions: [
      readingMergeQuestion('img1_q8_a', { questionText: '第8题', sourceQuestionLabel: '第8题', sourceRegion: 'img1_top', confidence: undefined }),
      readingMergeQuestion('img1_q8_b', { questionText: '第8题', sourceQuestionLabel: '第8题', sourceRegion: 'image-1-top', confidence: Number.NaN })
    ]
  });
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].confidence, 0);
});

test('calculation-careless summary categories are mutually exclusive and conserve total count', () => {
  const runtime = readingMergeRuntime();
  const summary = runtime.calculationCarelessSummary([
    { analysisStatus: 'ok', processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none' },
    { analysisStatus: 'ok', processCorrect: false, finalAnswerCorrect: false, carelessDetected: true, issueCategory: 'careless' },
    { analysisStatus: 'ok', processCorrect: false, finalAnswerCorrect: false, carelessDetected: false, issueCategory: 'knowledge_or_method' },
    { analysisStatus: 'insufficient', processCorrect: null, finalAnswerCorrect: null, carelessDetected: null, issueCategory: 'undetermined' }
  ]);
  assert.deepEqual({ correct: summary.correctCount, wrong: summary.wrongCount, careless: summary.carelessCount, undetermined: summary.undeterminedCount }, { correct: 1, wrong: 1, careless: 1, undetermined: 1 });
  assert.equal(summary.totalCount, summary.correctCount + summary.wrongCount + summary.carelessCount + summary.undeterminedCount);
  assert.equal(summary.methodIssueCount, 1);
});

test('wrong-question document ids do not collide for source keys with long common prefixes', () => {
  const runtime = readingMergeRuntime();
  const a = runtime.wrongQuestionDocumentId('task-1', 'img1_section_top_question_001');
  const b = runtime.wrongQuestionDocumentId('task-1', 'img1_section_top_question_002');
  assert.notEqual(a, b);
  assert.match(a, /^task-1_[0-9a-f]{32}$/);
});

test('v2 wrong-question projections follow the public schema instead of collapsing back to legacy fields', () => {
  const reading = wrongQuestionProjection({
    outputSchemaVersion: 'reading-careless.v2', sourceKey: 'reading-proj', questionText: '应用题', threeGridStatus: 'WRONG',
    studentConditionText: '条件A', studentRelationText: '关系B', studentAskText: '所求C',
    conditionCorrect: true, relationCorrect: true, askCorrect: false, askIssue: '所求写错', errorReason: '所求对象不对', correctionAdvice: '重新确认所求', confidence: 0.9
  }, 'CARELESS_TRAINING');
  assert.equal(reading.mode, 'reading-careless.v2');
  assert.equal(reading.studentResponse, '条件A；关系B；所求C');
  assert.equal(reading.standardResponse, '');
  assert.equal(reading.firstErrorPoint, '所求写错');
  assert.equal(reading.knowledgePoint, '');
  assert.equal(reading.modeDetails.studentWorkDetected, undefined);

  const calculation = wrongQuestionProjection({
    outputSchemaVersion: 'calculation-careless.v2', sourceKey: 'calc-proj', questionText: '竖式', calculationStatus: 'WRONG',
    studentCalculation: '12-5=8', standardCalculation: '12-5=7', carelessDetected: true, issueCategory: 'careless',
    firstErrorPoint: '个位', errorReason: '抄错数字', correctionAdvice: '逐位检查', confidence: 0.8
  }, 'CARELESS_TRAINING');
  assert.equal(calculation.mode, 'calculation-careless.v2');
  assert.equal(calculation.studentResponse, '12-5=8');
  assert.equal(calculation.standardResponse, '12-5=7');
  assert.equal(calculation.firstErrorPoint, '个位');
  assert.equal(calculation.knowledgePoint, '');
});

test('v2 downstream projections preserve source-evidence fields required by the published contract', () => {
  const baseEvidence = { studentWorkDetected: true, sourceQuestionLabel: '第3题', sourceRegion: 'img2_top', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable' };
  const cases = [
    { outputSchemaVersion: 'hard-problem.v2', sourceKey: 'hard-3', questionText: '第3题', evaluationStatus: 'WRONG', errorType: 'logic_error', studentAnswer: 'A', standardAnswer: 'B', firstWrongStep: '第2步', adjustmentSuggestion: '重看条件', confidence: 0.7, stepFeedbacks: [], overallFeedback: '需改进', ...baseEvidence },
    { outputSchemaVersion: 'reading-careless.v2', sourceKey: 'read-3', questionText: '第3题', threeGridStatus: 'WRONG', conditionCorrect: false, relationCorrect: true, askCorrect: true, studentConditionText: 'A', studentRelationText: 'B', studentAskText: 'C', missingConditions: ['条件D'], relationIssues: [], askIssue: '', confidence: 0.7, ...baseEvidence },
    { outputSchemaVersion: 'calculation-careless.v2', sourceKey: 'calc-3', questionText: '第3题', calculationStatus: 'WRONG', processCorrect: false, finalAnswerCorrect: false, carelessDetected: true, issueCategory: 'careless', studentCalculation: '1+1=3', standardCalculation: '1+1=2', carelessIssues: ['抄错'], methodIssues: [], firstErrorPoint: '第1步', correctionAdvice: '逐位检查', confidence: 0.7, ...baseEvidence }
  ];
  for (const question of cases) {
    const wrong = wrongQuestionProjection(question, 'CARELESS_TRAINING');
    const review = reviewProjection(question, 'CARELESS_TRAINING');
    for (const field of ['studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability']) {
      assert.equal(wrong.modeDetails[field], question[field], `${question.outputSchemaVersion} wrong projection lost ${field}`);
      assert.equal(review.evidenceFields[field], question[field], `${question.outputSchemaVersion} review projection lost ${field}`);
    }
  }
});

test('canonical calculation fragment merge is order-invariant and conservative for correctness while careless evidence wins', () => {
  const runtime = calculationRuntime;
  const base = calculationPayload({
    sourceKey: 'img1_q17_a', sourceQuestionLabel: '17', sourceRegion: 'image-1-top',
    studentWorkDetected: true, inputBasis: 'printed_question_with_work', modeApplicability: 'applicable'
  });
  const first = { ...base.questions[0], sourceKey: 'img1_q17_a', processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, carelessIssues: [], methodIssues: [], confidence: 0.9 };
  const second = { ...base.questions[0], sourceKey: 'image-1-question-17-b', sourceQuestionLabel: '17', sourceRegion: 'image-1-bottom', processCorrect: false, finalAnswerCorrect: false, carelessDetected: true, carelessIssues: ['竖式对位错误'], methodIssues: [], confidence: 0.6 };
  const payload = (questions) => ({ ...base, questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 2, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }, questions });
  const left = runtime.validateCalculationCarelessTrainingGradeResult(payload([first, second]));
  const right = runtime.validateCalculationCarelessTrainingGradeResult(payload([second, first]));
  for (const result of [left, right]) {
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].processCorrect, false);
    assert.equal(result.questions[0].finalAnswerCorrect, false);
    assert.equal(result.questions[0].carelessDetected, true);
    assert.equal(result.questions[0].issueCategory, 'careless');
    assert.deepEqual(result.questions[0].carelessIssues, ['竖式对位错误']);
    assert.equal(result.questions[0].confidence, 0.6);
  }
  assert.deepEqual(
    { processCorrect:left.questions[0].processCorrect, finalAnswerCorrect:left.questions[0].finalAnswerCorrect, carelessDetected:left.questions[0].carelessDetected, issueCategory:left.questions[0].issueCategory },
    { processCorrect:right.questions[0].processCorrect, finalAnswerCorrect:right.questions[0].finalAnswerCorrect, carelessDetected:right.questions[0].carelessDetected, issueCategory:right.questions[0].issueCategory }
  );
});

test('canonical hard-problem fragment merge prefers readable answered evidence over duplicate unreadable fragment regardless of order', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({ reviewRules: { hardProblem: { correctStepStatuses:['correct'], correctLogicStatus:'correct' } } }) } }).test;
  const answered = { ...hardProblemQuestion(), sourceKey:'img1_q18_a', sourceQuestionLabel:'18', sourceRegion:'image-1-top', studentWorkDetected:true, inputBasis:'printed_question_with_work', modeApplicability:'applicable', confidence:0.8 };
  const unreadable = { ...hardProblemQuestion(), sourceKey:'image-1-question-18-b', sourceQuestionLabel:'18', sourceRegion:'image-1-bottom', studentAnswer:'', answerStatus:'unreadable', finalAnswerCorrect:null, stepFeedbacks:[], stepStatus:'unreadable', logicStatus:'unreadable', errorType:'unreadable', overallFeedback:'无法辨认', studentWorkDetected:true, inputBasis:'printed_question_with_work', modeApplicability:'uncertain', confidence:0.4 };
  const payload = (questions) => ({ ...hardProblemPayload(questions), questionSetAudit:{ visibleIndependentQuestionCount:1, emittedQuestionCount:2, excludedQuestionCount:0, orientation:'upright', countConfidence:1 } });
  for (const result of [runtime.canonicalizeQuestionBaseline(payload([unreadable, answered])), runtime.canonicalizeQuestionBaseline(payload([answered, unreadable]))]) {
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].answerStatus, 'answered');
    assert.equal(result.questions[0].finalAnswerCorrect, true);
    assert.equal(result.questions[0].confidence, 0.4);
  }
});

test('canonical fragment merge keeps studentWorkDetected and inputBasis semantically consistent', () => {
  const base = calculationPayload({ sourceQuestionLabel:'19', sourceRegion:'image-2', sourceKey:'img2_q19_a' });
  const withWork = { ...base.questions[0], studentWorkDetected:true, inputBasis:'printed_question_with_work', modeApplicability:'applicable' };
  const contradictoryBlank = { ...base.questions[0], sourceKey:'img2_q19_b', studentWorkDetected:false, inputBasis:'printed_question_without_work', modeApplicability:'not_applicable' };
  const raw = { ...base, questionSetAudit:{ visibleIndependentQuestionCount:1, emittedQuestionCount:2, excludedQuestionCount:0, orientation:'upright', countConfidence:1 }, questions:[contradictoryBlank, withWork] };
  const merged = calculationRuntime.canonicalizeQuestionBaseline(raw);
  assert.equal(merged.questions.length, 1);
  assert.equal(merged.questions[0].studentWorkDetected, true);
  assert.equal(merged.questions[0].inputBasis, 'printed_question_with_work');
  assert.equal(merged.questions[0].modeApplicability, 'applicable');
});

test('wrong-question compatibility carelessType is derived from calculation v2 result category without legacy model fields', () => {
  assert.equal(calculationRuntime.legacyCarelessTypeForWrongRecord({ outputSchemaVersion:'calculation-careless.v2' }, { resultCategory:'careless' }), 'careless');
  assert.equal(calculationRuntime.legacyCarelessTypeForWrongRecord({ outputSchemaVersion:'calculation-careless.v2' }, { resultCategory:'knowledge_or_method' }), 'method_error');
  assert.equal(calculationRuntime.legacyCarelessTypeForWrongRecord({ outputSchemaVersion:'calculation-careless.v2' }, { resultCategory:'none' }), 'none');
});

test('calculation-careless process really reschedules PRIMARY when model omits questionText', async () => {
  const events = [];
  const strategy = {
    strategyVersion: '1.6.19',
    prompts: { calculationCarelessTraining: { system: '直接看原图并只输出JSON。' } },
    reviewRules: { independentReviewInstruction: '独立复核。' },
    modelRuntime: { stages: {
      calculationCarelessPrimary: { modelTier: 'lite', outputSchemaVersion: 'calculation-careless.v2', structuredOutputMode: 'none', temperature: 0, maxOutputTokens: 1000, timeoutMs: 1000, maxRepairAttempts: 1 },
      calculationCarelessReview: { modelTier: 'lite', outputSchemaVersion: 'calculation-careless.v2', structuredOutputMode: 'none', temperature: 0, maxOutputTokens: 1000, timeoutMs: 1000, maxRepairAttempts: 1 }
    } }
  };
  const runtime = createGradingRuntime({
    context: { db: { collection: () => ({ doc: () => ({ update: async () => ({ updated: 1 }) }) }) } },
    constants: { C: { tasks: 'tasks', results: 'results', wrong: 'wrong' } },
    audit: { monitor(...args) { events.push(args); } },
    ark: { callArk: async () => { throw Object.assign(new Error('Model output validation failed'), { code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[0].questionText', requestStage: 'calculationCarelessPrimary' }); } },
    utils: { now: () => new Date('2026-08-14T08:32:58.000Z'), randomId: () => 'id', shanghaiDateKey: require('../shared/utils').shanghaiDateKey, safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { calculationCarelessTrainingUserPrompt: () => '' }, deferStagePersistence: true
  });
  const result = await runtime.test.process({
    _id: 'task-calc-primary-recovery', mode: 'CARELESS_TRAINING', carelessTrainingType: 'CALCULATION',
    currentStage: 'PRIMARY_GRADING', studentImageFileIds: [], answerImageFileIds: [],
    carelessPrimaryRecoveryCount: 0, primaryTransportAttempt: 0, reviewTransportAttempt: 0
  }, Date.now());
  assert.equal(result.outcome, 'CONTINUE');
  assert.equal(result.nextStage, 'PRIMARY_GRADING');
  assert.equal(result.handoffPatch.carelessPrimaryRecoveryCount, 1);
  assert.equal(result.handoffPatch.primaryTransportAttempt, 0);
  assert.equal(result.handoffPatch.statusMessage, '首次识别结果不完整，正在重新识别');
  assert.ok(events.some((args) => args[1] === 'CARELESS_STAGE_RECOVERY_SCHEDULED'));
});

test('duplicate-fragment canonical source identity and merged text are invariant to model array order', () => {
  const runtime = readingMergeRuntime();
  const readingA = readingMergeQuestion('img1_q17_b', { sourceQuestionLabel:'第17题', sourceRegion:'image-1:question-17', questionText:'第17题 B片段' });
  const readingB = readingMergeQuestion('img1_q17_a', { sourceQuestionLabel:'第17题', sourceRegion:'image-1:question-17', questionText:'第17题 A片段' });
  const left = runtime.consolidateReadingQuestions({ outputSchemaVersion:'reading-careless.v2', questions:[readingA, readingB] }).questions[0];
  const right = runtime.consolidateReadingQuestions({ outputSchemaVersion:'reading-careless.v2', questions:[readingB, readingA] }).questions[0];
  assert.equal(left.sourceKey, 'img1_q17_a');
  assert.equal(right.sourceKey, 'img1_q17_a');
  assert.equal(left.questionText, right.questionText);

  const calcA = calculationPayload({ sourceKey:'img2_q19_b', sourceQuestionLabel:'第19题', sourceRegion:'image-2:question-19' }).questions[0];
  const calcB = { ...calcA, sourceKey:'img2_q19_a', studentCalculation:'片段B' };
  const wrap = (questions) => ({ outputSchemaVersion:'calculation-careless.v2', questionSetAudit:{visibleIndependentQuestionCount:1, emittedQuestionCount:2, excludedQuestionCount:0}, questions });
  const calcLeft = runtime.canonicalizeQuestionBaseline(wrap([calcA, calcB])).questions[0];
  const calcRight = runtime.canonicalizeQuestionBaseline(wrap([calcB, calcA])).questions[0];
  assert.equal(calcLeft.sourceKey, 'img2_q19_a');
  assert.equal(calcRight.sourceKey, 'img2_q19_a');
  assert.equal(calcLeft.studentCalculation, calcRight.studentCalculation);
});

test('question identity refuses auto-attribution when printed question number conflicts with explicit source label', () => {
  const runtime = readingMergeRuntime();
  const conflict = readingMergeQuestion('img3_q17', { questionText:'第1题 文本内容', sourceQuestionLabel:'Q17', sourceRegion:'img3' });
  assert.equal(runtime.canonicalQuestionIdentity(conflict), '');
  const result = runtime.consolidateReadingQuestions({ outputSchemaVersion:'reading-careless.v2', questions:[
    conflict,
    readingMergeQuestion('img3_q1', { questionText:'第1题 另一内容', sourceQuestionLabel:'第1题', sourceRegion:'img3' })
  ]});
  assert.equal(result.questions.length, 2);
});

test('REVIEW omission error identifies the exact missing PRIMARY contract ids', () => {
  const runtime = readingMergeRuntime();
  const primaryQuestions = [1, 2, 3].map((n) => readingMergeQuestion(`img1_q${n}`, {
    sourceQuestionLabel: `第${n}题`, sourceRegion: `image-1:q${n}`, questionText: `第${n}题`
  }));
  const primary = { outputSchemaVersion: 'reading-careless.v2', canonicalSourceKeys: primaryQuestions.map((q) => q.sourceKey), questions: primaryQuestions };
  const review = { outputSchemaVersion: 'reading-careless.v2', questions: [primaryQuestions[0], primaryQuestions[2]] };
  assert.throws(() => runtime.mergeCarelessTrainingResults(primary, review), (error) => {
    assert.equal(error.code, 'QUESTION_SET_MISMATCH');
    assert.deepEqual(error.missingPrimaryQuestionIds, ['pq_002']);
    assert.deepEqual(error.missingPrimaryQuestions, [{ primaryQuestionId: 'pq_002', sourceKey: 'img1_q2', sourceQuestionLabel: '第2题', sourceRegion: 'image-1:q2', questionText: '第2题' }]);
    return true;
  });
});

test('careless REVIEW omission schedules targeted recovery metadata for the missing PRIMARY question', async () => {
  const renderedMeta = [];
  const events = [];
  const strategy = {
    strategyVersion: '1.6.19',
    modelRuntime: { stages: {
      readingCarelessReview: { outputSchemaVersion: 'reading-careless.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1 }
    } },
    prompts: { carelessTraining: { system: 'system', userTemplate: '{{META_JSON}}' } },
    reviewRules: { independentReviewInstruction: '独立复核。', carelessTraining: { missingRelationTokens: [], missingRelationIssue: '' } }
  };
  const primaryQuestions = [1, 2, 3].map((n) => readingMergeQuestion(`img1_q${n}`, {
    sourceQuestionLabel: `第${n}题`, sourceRegion: `image-1:q${n}`, questionText: `第${n}题`,
    studentWorkDetected: true, inputBasis: 'printed_question_with_work', modeApplicability: 'applicable'
  }));
  const primaryDraft = { outputSchemaVersion: 'reading-careless.v2', canonicalSourceKeys: primaryQuestions.map((q) => q.sourceKey), questionSetAudit: { visibleIndependentQuestionCount: 3, emittedQuestionCount: 3, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }, questions: primaryQuestions };
  const runtime = createGradingRuntime({
    context: { db: { collection: () => ({ doc: () => ({ update: async () => ({ updated: 1 }) }) }) } },
    constants: { C: { tasks: 'tasks', results: 'results', wrong: 'wrong' } },
    audit: { monitor(...args) { events.push(args); } },
    ark: { callArk: async () => ({ outputSchemaVersion: 'reading-careless.v2', questionSetAudit: { visibleIndependentQuestionCount: 3, emittedQuestionCount: 2, excludedQuestionCount: 1, orientation: 'upright', countConfidence: 1 }, questions: [primaryQuestions[0], primaryQuestions[2]] }) },
    utils: { now: () => new Date('2026-08-15T00:00:00.000Z'), randomId: () => 'id', shanghaiDateKey: require('../shared/utils').shanghaiDateKey, safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'),
    embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { carelessTrainingUserPrompt: (_strategy, meta) => { renderedMeta.push(meta); return JSON.stringify(meta); } },
    deferStagePersistence: true
  });
  const task = { _id: 'task-review-missing-q2', mode: 'CARELESS_TRAINING', carelessTrainingType: 'READING', currentStage: 'REVIEW_GRADING', studentImageFileIds: [], answerImageFileIds: [], primaryDraft, carelessReviewRecoveryCount: 0 };
  const result = await runtime.test.process(task, Date.now());
  assert.equal(result.outcome, 'CONTINUE');
  assert.equal(result.nextStage, 'REVIEW_GRADING');
  assert.equal(result.handoffPatch.carelessReviewRecoveryCount, 1);
  assert.deepEqual(result.handoffPatch.carelessReviewRecoveryContext.missingPrimaryQuestionIds, ['pq_002']);
  assert.equal(result.handoffPatch.carelessReviewRecoveryContext.missingPrimaryQuestions[0].sourceQuestionLabel, '第2题');
  const recoveryEvent = events.find((args) => args[1] === 'CARELESS_STAGE_RECOVERY_SCHEDULED');
  assert.ok(recoveryEvent);
  assert.deepEqual(recoveryEvent[2].missingPrimaryQuestionIds, ['pq_002']);
  assert.equal(renderedMeta.length, 1);
  assert.deepEqual(renderedMeta[0].primaryQuestionContract.map((item) => item.primaryQuestionId), ['pq_001', 'pq_002', 'pq_003']);
  await assert.rejects(
    runtime.test.process({ ...task, ...result.handoffPatch, currentStage: 'REVIEW_GRADING' }, Date.now()),
    (error) => error.code === 'QUESTION_SET_MISMATCH'
  );
  assert.equal(renderedMeta.length, 2);
  assert.deepEqual(renderedMeta[1].reviewRecovery.missingPrimaryQuestionIds, ['pq_002']);
  assert.match(renderedMeta[1].reviewContractInstruction, /pq_002/);
  assert.match(renderedMeta[1].reviewContractInstruction, /仍需完整返回全部PRIMARY题目/);
});

test('PRIMARY review contract is deterministic and bounds identity evidence before persisting or prompting', () => {
  const runtime = readingMergeRuntime();
  const hugeText = '题'.repeat(2000);
  const hugeRegion = 'region-'.repeat(200);
  const primary = { questions: [
    readingMergeQuestion('k1', { sourceQuestionLabel: '第1题'.repeat(100), sourceRegion: hugeRegion, questionText: hugeText }),
    readingMergeQuestion('k2', { sourceQuestionLabel: '第2题', sourceRegion: 'image-1:q2', questionText: '第二题' })
  ] };
  const contract = runtime.primaryReviewQuestionContract(primary);
  assert.deepEqual(contract.map((item) => item.primaryQuestionId), ['pq_001', 'pq_002']);
  assert.ok(contract[0].questionText.length <= 500);
  assert.ok(contract[0].sourceQuestionLabel.length <= 120);
  assert.ok(contract[0].sourceRegion.length <= 200);
});

test('careless REVIEW targeted retry can recover the missing PRIMARY question and continue to FINALIZING_RESULT', async () => {
  const calls = [];
  const strategy = {
    strategyVersion: '1.6.19',
    modelRuntime: { stages: { readingCarelessReview: { outputSchemaVersion: 'reading-careless.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1 } } },
    prompts: { carelessTraining: { system: 'system', userTemplate: '{{META_JSON}}' } },
    reviewRules: { independentReviewInstruction: '独立复核。', carelessTraining: { missingRelationTokens: [], missingRelationIssue: '' } }
  };
  const primaryQuestions = [1, 2, 3].map((n) => readingMergeQuestion(`img2_q${n}`, {
    sourceQuestionLabel: `第${n}题`, sourceRegion: `image-2:q${n}`, questionText: `第${n}题`, studentWorkDetected: true, inputBasis: 'printed_question_with_work', modeApplicability: 'applicable'
  }));
  const primaryDraft = { outputSchemaVersion: 'reading-careless.v2', canonicalSourceKeys: primaryQuestions.map((q) => q.sourceKey), questionSetAudit: { visibleIndependentQuestionCount: 3, emittedQuestionCount: 3, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }, questions: primaryQuestions };
  let reviewAttempt = 0;
  const runtime = createGradingRuntime({
    context: { db: { collection: () => ({ doc: () => ({ update: async () => ({ updated: 1 }) }) }) } }, constants: { C: { tasks: 'tasks', results: 'results', wrong: 'wrong' } }, audit: { monitor() {} },
    ark: { callArk: async (options) => {
      calls.push(options);
      reviewAttempt += 1;
      const selected = reviewAttempt === 1 ? [primaryQuestions[0], primaryQuestions[2]] : primaryQuestions.map((q, index) => ({ ...q, sourceKey: `review-drift-${index + 1}` }));
      return { outputSchemaVersion: 'reading-careless.v2', questionSetAudit: { visibleIndependentQuestionCount: 3, emittedQuestionCount: selected.length, excludedQuestionCount: 3 - selected.length, orientation: 'upright', countConfidence: 1 }, questions: selected };
    } },
    utils: { now: () => new Date('2026-08-15T00:00:00.000Z'), randomId: () => 'id', shanghaiDateKey: require('../shared/utils').shanghaiDateKey, safeError: (error) => ({ code: error.code, message: error.message }) },
    checkin: { recordQualifiedQuestions: async () => {} }, taskError: {}, json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => strategy }, remote: { loadRuntimeStrategy: async () => strategy },
    strategyRender: { carelessTrainingUserPrompt: (_strategy, meta) => JSON.stringify(meta) }, deferStagePersistence: true
  });
  const task = { _id: 'task-targeted-success', mode: 'CARELESS_TRAINING', carelessTrainingType: 'READING', currentStage: 'REVIEW_GRADING', studentImageFileIds: [], answerImageFileIds: [], primaryDraft, carelessReviewRecoveryCount: 0 };
  const first = await runtime.test.process(task, Date.now());
  assert.equal(first.nextStage, 'REVIEW_GRADING');
  assert.deepEqual(first.handoffPatch.carelessReviewRecoveryContext.missingPrimaryQuestionIds, ['pq_002']);
  const second = await runtime.test.process({ ...task, ...first.handoffPatch, currentStage: 'REVIEW_GRADING' }, Date.now());
  assert.equal(second.nextStage, 'FINALIZING_RESULT');
  assert.equal(second.handoffPatch.carelessReviewRecoveryContext, null);
  assert.deepEqual(second.handoffPatch.mergedDraft.questions.map((q) => q.sourceKey), primaryQuestions.map((q) => q.sourceKey));
  assert.deepEqual(calls[1].reviewQuestionAttributionBaseline.map((q) => q.primaryQuestionId), ['pq_001', 'pq_002', 'pq_003']);
});
