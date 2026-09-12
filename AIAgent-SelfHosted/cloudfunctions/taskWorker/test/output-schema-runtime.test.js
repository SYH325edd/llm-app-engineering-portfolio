'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateNewModelResult, collectNewModelResultIssues, normalizeNewModelResult, resolveRuntimeSchema, auditRuntimeSchema, mapLegacyResult, assertStrategyCompatibility, validateFinalResultContract, validateQuestionSetAudit } = require('../shared/output-schema-validator');
const outputSchemaRegistry = require('../shared/output-schema-registry');
const { assertStrategyBundle } = require('../shared/strategy/contract');
const { getModelRuntimeStage } = require('../shared/model-runtime');
const repair = require('../shared/model-output-repair');
const { safeError } = require('../shared/utils');

function question(version) {
  const common = { outputSchemaVersion: version, sourceKey: 'q-1', questionText: '1 + 1', confidence: 1, studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'page-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable' };
  if (version === 'hard-problem.v2') return { ...common, studentAnswer: '2', standardAnswer: '2', answerStatus: 'answered', finalAnswerCorrect: true, stepRequired: true, stepStatus: 'correct', logicStatus: 'correct', errorType: 'none', firstWrongStep: '', errorReason: '', adjustmentSuggestion: '', knowledgePoint: '', stepFeedbacks: [{ stepIndex: 1, solutionText: '1 + 1 = 2', explanationText: '把两个1相加得到2', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '计算和解释均正确。', correctionAdvice: '' }], overallFeedback: '答案、步骤和讲解均正确。' };
  if (version === 'reading-careless.v2') return { ...common, studentConditionText: 'a', studentRelationText: 'b', studentAskText: 'c', referenceConditionText: 'reference condition', referenceRelationText: 'reference relation', referenceAskText: 'reference ask', analysisStatus: 'ok', conditionCorrect: true, relationCorrect: true, askCorrect: true, missingConditions: [], relationIssues: [], askIssue: '', errorReason: '', correctionAdvice: '' };
  return { ...common, studentCalculation: '1+1=2', standardCalculation: '1+1=2', analysisStatus: 'ok', layoutClear: true, digitAlignmentCorrect: true, stepsComplete: true, carryBorrowClear: true, processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none', carelessIssues: [], methodIssues: [], errorReason: '', firstErrorPoint: '', correctionAdvice: '' };
}

function result(version, questions = [question(version)]) {
  return {
    outputSchemaVersion: version,
    questionSetAudit: { visibleIndependentQuestionCount: questions.length, emittedQuestionCount: questions.length, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions
  };
}

const EVIDENCE_FIELDS = ['studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'];
const INPUT_BASIS_VALUES = ['printed_question_with_work', 'printed_question_without_work', 'work_only_complete', 'work_only_incomplete'];
const MODE_APPLICABILITY_VALUES = ['applicable', 'not_applicable', 'uncertain'];
const STRATEGY_CONTRACT_KEYS = { 'hard-problem.v2': 'hardProblemV2', 'reading-careless.v2': 'readingCarelessV2', 'calculation-careless.v2': 'calculationCarelessV2' };
function remoteStrategy(version) {
  const schema = outputSchemaRegistry.getSchema(version);
  const contractKey = STRATEGY_CONTRACT_KEYS[version];
  return { outputSchemaRegistry: { schemas: [{ schemaId: version, strategyContractKey: contractKey }] }, contracts: { [contractKey]: { requiredFields: [...schema.requiredFields], fieldTypes: { studentWorkDetected: 'boolean', sourceQuestionLabel: 'string', sourceRegion: 'string', inputBasis: 'string', modeApplicability: 'string' }, enumFields: { inputBasis: INPUT_BASIS_VALUES, modeApplicability: MODE_APPLICABILITY_VALUES }, topLevelRequiredFields: ['questionSetAudit'] } } };
}

test('static v2 registry declares the public-contract evidence fields and enums', () => {
  for (const version of ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2']) {
    const schema = outputSchemaRegistry.getSchema(version);
    assert.deepEqual(EVIDENCE_FIELDS.map((field) => [field, schema.fieldTypes[field]]), [['studentWorkDetected', 'boolean'], ['sourceQuestionLabel', 'string'], ['sourceRegion', 'string'], ['inputBasis', 'string'], ['modeApplicability', 'string']]);
    assert.ok(EVIDENCE_FIELDS.every((field) => schema.requiredFields.includes(field)));
    assert.deepEqual(schema.enumFields.inputBasis, INPUT_BASIS_VALUES);
    assert.deepEqual(schema.enumFields.modeApplicability, MODE_APPLICABILITY_VALUES);
    if (version !== 'hard-problem.v2') {
      assert.ok(schema.topLevelRequiredFields.includes('questionSetAudit'));
      assert.equal(schema.topLevelFieldTypes.questionSetAudit, 'object');
      assert.equal(schema.topLevelObjectSchemas.questionSetAudit.consistencyRules, undefined);
    }
  }
});

test('local reading and calculation v2 schemas reject a missing questionSetAudit before merge', () => {
  for (const version of ['reading-careless.v2', 'calculation-careless.v2']) {
    const result = { outputSchemaVersion: version, questions: [question(version)] };
    assert.throws(() => validateNewModelResult(result), (error) => error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questionSetAudit');
  }
});

test('incomplete repair patch reports the exact missing required field paths', () => {
  const output = {
    outputSchemaVersion: 'calculation-careless.v2',
    questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [question('calculation-careless.v2')]
  };
  delete output.questions[0].firstErrorPoint;
  delete output.questions[0].inputBasis;
  const fields = [
    { fieldPath: 'questions[0].firstErrorPoint', reason: 'missing required field' },
    { fieldPath: 'questions[0].inputBasis', reason: 'missing required field' }
  ];
  assert.throws(() => repair.mergeRepairedOutput(output, { repairs: [
    { fieldPath: 'questions[0].firstErrorPoint', sourceKey: 'q-1', value: '' }
  ] }, fields, outputSchemaRegistry.getSchema('calculation-careless.v2')), (error) => {
    assert.equal(error.failureReason, 'MISSING_REQUIRED_PATCH');
    assert.deepEqual(error.missingRequiredFieldPaths, ['questions[0].inputBasis']);
    return true;
  });
});

test('runtime schema compiler normalizes contract enum types to string for normal validation and Repair', () => {
  const strategy = {
    outputSchemaRegistry: { schemas: [{ schemaId: 'calculation-careless.v2', strategyContractKey: 'calculationCarelessV2' }] },
    contracts: { calculationCarelessV2: { requiredFields: [...outputSchemaRegistry.getSchema('calculation-careless.v2').requiredFields], fieldTypes: { inputBasis: 'enum', modeApplicability: 'enum' } } }
  };
  const schema = resolveRuntimeSchema(strategy, 'calculation-careless.v2');
  assert.equal(schema.fieldTypes.inputBasis, 'string');
  assert.equal(schema.fieldTypes.modeApplicability, 'string');
  assert.doesNotThrow(() => validateNewModelResult(result('calculation-careless.v2'), { strategy }));
});

test('customer runtime schema audit finds zero conflicts in all three compiled schemas', () => {
  for (const version of outputSchemaRegistry.supportedVersions()) {
    assert.deepEqual(auditRuntimeSchema(resolveRuntimeSchema(null, version)), []);
  }
});

test('runs 10000 deterministic customer schema and Repair combinations without a model call', () => {
  const versions = outputSchemaRegistry.supportedVersions();
  for (let index = 0; index < 10000; index += 1) {
    const version = versions[index % versions.length];
    const output = result(version);
    assert.doesNotThrow(() => validateNewModelResult(output));
    delete output.questions[0].confidence;
    const plan = repair.prepareModelOutputRepair({ code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[0].confidence', modelOutput: output });
    const merged = repair.mergeRepairedOutput(output, { repairs: [{ fieldPath: 'questions[0].confidence', sourceKey: 'q-1', value: (index % 101) / 100 }] }, plan.fields, plan.schema);
    assert.doesNotThrow(() => validateNewModelResult(merged));
  }
});


test('repairs the real cloud failure where stepFeedbacks and overallFeedback are both absent', () => {
  const originalQuestion = question('hard-problem.v2');
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [{ ...originalQuestion }] };
  delete output.questions[0].stepFeedbacks;
  delete output.questions[0].overallFeedback;
  let validationError;
  try { validateNewModelResult(output); } catch (error) { validationError = error; }
  assert.ok(validationError);
  validationError.modelOutput = output;
  const plan = repair.prepareModelOutputRepair(validationError);
  assert.deepEqual(plan.fieldPaths, ['questions[0].stepFeedbacks']);
  const merged = repair.mergeRepairedOutput(output, { repairs: [
    { fieldPath: 'questions[0].stepFeedbacks', sourceKey: 'q-1', value: originalQuestion.stepFeedbacks }
  ] }, plan.fields, plan.schema, plan.validationContext);
  assert.doesNotThrow(() => validateNewModelResult(merged));
  assert.deepEqual(merged.questions[0].stepFeedbacks, originalQuestion.stepFeedbacks);
  assert.match(merged.questions[0].overallFeedback, /最终答案正确/);
});


test('missing stepFeedbacks repairs dependent aggregates in the same pass when the recovered explanation is partial', () => {
  const original = question('hard-problem.v2');
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [{ ...original, overallFeedback: '旧整体反馈' }] };
  delete output.questions[0].stepFeedbacks;
  let validationError;
  try { validateNewModelResult(output); } catch (error) { validationError = error; }
  validationError.modelOutput = output;
  const plan = repair.prepareModelOutputRepair(validationError);
  const partialSteps = [{
    stepIndex: 1,
    solutionText: '1 + 1 = 2',
    explanationText: '得到2',
    solutionStatus: 'correct',
    explanationStatus: 'partially_clear',
    logicStatus: 'insufficient',
    analysis: '计算正确，但没有说明使用加法的原因。',
    correctionAdvice: '补充说明把两个1相加得到2。'
  }];
  const merged = repair.mergeRepairedOutput(output, { repairs: [
    { fieldPath: 'questions[0].stepFeedbacks', sourceKey: 'q-1', value: partialSteps },
    { fieldPath: 'questions[0].stepStatus', sourceKey: 'q-1', value: 'wrong' },
    { fieldPath: 'questions[0].logicStatus', sourceKey: 'q-1', value: 'insufficient' },
    { fieldPath: 'questions[0].errorType', sourceKey: 'q-1', value: 'logic_error' },
    { fieldPath: 'questions[0].firstWrongStep', sourceKey: 'q-1', value: '第1步讲解不完整' },
    { fieldPath: 'questions[0].errorReason', sourceKey: 'q-1', value: '第1步没有说明使用加法的原因。' },
    { fieldPath: 'questions[0].adjustmentSuggestion', sourceKey: 'q-1', value: '补充第1步的加法依据。' },
    { fieldPath: 'questions[0].overallFeedback', sourceKey: 'q-1', value: '最终答案正确，但第1步讲解需要补充加法依据。' }
  ] }, plan.fields, plan.schema, plan.validationContext);
  assert.doesNotThrow(() => validateNewModelResult(merged));
  assert.equal(merged.questions[0].stepStatus, 'wrong');
  assert.equal(merged.questions[0].logicStatus, 'insufficient');
  assert.equal(merged.questions[0].stepFeedbacks[0].explanationStatus, 'partially_clear');
});

test('repairs a missing nested hard-problem step field without replacing the question or step array', () => {
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [question('hard-problem.v2')] };
  delete output.questions[0].stepFeedbacks[0].analysis;
  let validationError;
  try { validateNewModelResult(output); } catch (error) { validationError = error; }
  validationError.modelOutput = output;
  const plan = repair.prepareModelOutputRepair(validationError);
  assert.deepEqual(plan.fieldPaths, ['questions[0].stepFeedbacks[0].analysis']);
  const merged = repair.mergeRepairedOutput(output, { repairs: [{ fieldPath: 'questions[0].stepFeedbacks[0].analysis', sourceKey: 'q-1', value: '计算和解释均正确。' }] }, plan.fields, plan.schema, plan.validationContext);
  assert.doesNotThrow(() => validateNewModelResult(merged));
  assert.equal(merged.questions[0].stepFeedbacks[0].solutionText, '1 + 1 = 2');
});

test('repairs a nested hard-problem step semantic field path used by continuous step validation', () => {
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [question('hard-problem.v2')] };
  output.questions[0].stepFeedbacks[0].stepIndex = 2;
  let validationError;
  try { validateNewModelResult(output); } catch (error) { validationError = error; }
  validationError.modelOutput = output;
  const plan = repair.prepareModelOutputRepair(validationError);
  assert.deepEqual(plan.fieldPaths, ['questions[0].stepFeedbacks[0].stepIndex']);
  const merged = repair.mergeRepairedOutput(output, { repairs: [{ fieldPath: 'questions[0].stepFeedbacks[0].stepIndex', sourceKey: 'q-1', value: 1 }] }, plan.fields, plan.schema, plan.validationContext);
  assert.doesNotThrow(() => validateNewModelResult(merged));
});

test('hard-problem mixed explanation defects use deterministic aggregate precedence and remain one-pass repairable', () => {
  const mixed = question('hard-problem.v2');
  mixed.stepFeedbacks = [
    { ...mixed.stepFeedbacks[0], stepIndex: 1, explanationStatus: 'partially_clear', logicStatus: 'insufficient', analysis: '第一步讲解不完整。', correctionAdvice: '补充说明这一步使用加法的依据。' },
    { ...mixed.stepFeedbacks[0], stepIndex: 2, solutionText: '2 + 2 = 4', explanationText: '错误地说明为乘法。', explanationStatus: 'incorrect', logicStatus: 'wrong', analysis: '第二步讲解错误。', correctionAdvice: '把乘法解释改为两个2相加。' }
  ];
  mixed.stepStatus = 'wrong';
  mixed.logicStatus = 'wrong';
  mixed.errorType = 'logic_error';
  mixed.firstWrongStep = '第1步讲解不完整；第2步讲解错误';
  mixed.errorReason = '第一步依据不足，第二步解释与算式不一致。';
  mixed.adjustmentSuggestion = '补充第一步依据并修正第二步解释。';
  mixed.overallFeedback = '存在讲解错误，应先修正错误解释。';
  assert.doesNotThrow(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [mixed] }));

  mixed.logicStatus = 'insufficient';
  const issues = collectNewModelResultIssues({ outputSchemaVersion: 'hard-problem.v2', questions: [mixed] });
  assert.deepEqual(issues.map((item) => item.fieldPath), ['questions[0].logicStatus']);
});

test('all hard-problem step-state combinations resolve to one deterministic aggregate state', () => {
  const solutionStatuses = ['correct', 'wrong', 'missing', 'unreadable'];
  const explanationStatuses = ['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable'];
  const logicStatuses = ['clear', 'insufficient', 'wrong', 'unreadable'];
  for (const solutionStatus of solutionStatuses) for (const explanationStatus of explanationStatuses) for (const stepLogicStatus of logicStatuses) {
    const q = question('hard-problem.v2');
    q.stepFeedbacks = [{
      ...q.stepFeedbacks[0],
      solutionText: solutionStatus === 'missing' ? '' : '1 + 1 = 2',
      explanationText: explanationStatus === 'missing' ? '' : '把两个1相加得到2',
      solutionStatus,
      explanationStatus,
      logicStatus: stepLogicStatus,
      analysis: '根据当前步骤状态给出具体判断。',
      correctionAdvice: solutionStatus === 'correct' && explanationStatus === 'clear' && stepLogicStatus === 'clear' ? '' : '根据本步状态补充或订正解题过程与讲解。'
    }];
    q.stepStatus = solutionStatus === 'missing' ? 'missing' : solutionStatus === 'unreadable' ? 'unreadable' : (solutionStatus === 'wrong' || explanationStatus !== 'clear' || stepLogicStatus !== 'clear') ? 'wrong' : 'correct';
    q.logicStatus = explanationStatus === 'incorrect' || stepLogicStatus === 'wrong' ? 'wrong'
      : explanationStatus === 'unreadable' || stepLogicStatus === 'unreadable' || solutionStatus === 'unreadable' ? 'unreadable'
        : stepLogicStatus === 'insufficient' ? 'insufficient' : 'correct';
    q.errorType = q.stepStatus === 'correct' && q.logicStatus === 'correct' ? 'none' : 'multiple';
    if (q.errorType !== 'none') {
      q.firstWrongStep = '第1步';
      q.errorReason = '第1步的过程、讲解或逻辑需要调整。';
      q.adjustmentSuggestion = '根据逐步分析补充或订正第1步。';
    }
    q.overallFeedback = '聚合状态与逐步状态一致。';
    assert.doesNotThrow(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [q] }), `${solutionStatus}/${explanationStatus}/${stepLogicStatus}`);
  }
});

test('hard-problem semantic repair changes judgment status instead of deleting visible student source text', () => {
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [question('hard-problem.v2')] };
  output.questions[0].stepFeedbacks[0].solutionStatus = 'missing';
  let validationError;
  try { validateNewModelResult(output); } catch (error) { validationError = error; }
  validationError.modelOutput = output;
  const plan = repair.prepareModelOutputRepair(validationError);
  assert.deepEqual(plan.fieldPaths, [
    'questions[0].stepFeedbacks[0].solutionStatus',
    'questions[0].stepFeedbacks[0].correctionAdvice'
  ]);
  assert.equal(plan.fieldPaths.includes('questions[0].stepFeedbacks[0].solutionText'), false);
  const merged = repair.mergeRepairedOutput(output, { repairs: [
    { fieldPath: 'questions[0].stepFeedbacks[0].solutionStatus', sourceKey: 'q-1', value: 'correct' },
    { fieldPath: 'questions[0].stepFeedbacks[0].correctionAdvice', sourceKey: 'q-1', value: '' }
  ] }, plan.fields, plan.schema, plan.validationContext);
  assert.equal(merged.questions[0].stepFeedbacks[0].solutionText, '1 + 1 = 2');
  assert.doesNotThrow(() => validateNewModelResult(merged));
});

test('fully clear step arrays repair aggregate fields rather than rewriting the step array', () => {
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [question('hard-problem.v2')] };
  output.questions[0].stepStatus = 'wrong';
  output.questions[0].logicStatus = 'wrong';
  output.questions[0].errorType = 'logic_error';
  let validationError;
  try { validateNewModelResult(output); } catch (error) { validationError = error; }
  validationError.modelOutput = output;
  const plan = repair.prepareModelOutputRepair(validationError);
  assert.deepEqual(plan.fieldPaths.sort(), ['questions[0].logicStatus', 'questions[0].stepStatus'].sort());
  assert.equal(plan.fieldPaths.includes('questions[0].stepFeedbacks'), false);
});


test('deterministically converges the cloud REVIEW failure after repairing one nested correctionAdvice field', () => {
  const q = question('hard-problem.v2');
  q.stepFeedbacks = [
    { ...q.stepFeedbacks[0], stepIndex: 1 },
    { ...q.stepFeedbacks[0], stepIndex: 2, solutionText: '', explanationText: '求出两种情况下的总草量', solutionStatus: 'missing', explanationStatus: 'clear', logicStatus: 'insufficient', analysis: '只写了讲解，未写对应过程。', correctionAdvice: '' }
  ];
  q.stepStatus = 'correct';
  q.logicStatus = 'correct';
  q.errorType = 'none';
  q.firstWrongStep = '';
  q.errorReason = '';
  q.adjustmentSuggestion = '';
  q.overallFeedback = '整个解题过程没有错误。';
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [q] };
  const issues = collectNewModelResultIssues(output);
  assert.ok(issues.some((item) => item.fieldPath === 'questions[0].stepFeedbacks[1].correctionAdvice'));
  const validationError = Object.assign(new Error('invalid'), { code: issues[0].code, fieldPath: issues[0].fieldPath, issues, modelOutput: output });
  const plan = repair.prepareModelOutputRepair(validationError);
  assert.ok(plan.fieldPaths.includes('questions[0].stepFeedbacks[1].correctionAdvice'));
  assert.equal(plan.fieldPaths.includes('questions[0].errorType'), false);
  const repairs = plan.fieldPaths.map((fieldPath) => ({ fieldPath, sourceKey: 'q-1', value: fieldPath.endsWith('.correctionAdvice') ? '请补写这一处对应的解题过程。' : fieldPath.endsWith('.overallFeedback') ? '需要补充过程。' : '' }));
  const merged = repair.mergeRepairedOutput(output, { repairs }, plan.fields, plan.schema, plan.validationContext);
  assert.equal(merged.questions[0].stepStatus, 'missing');
  assert.equal(merged.questions[0].logicStatus, 'insufficient');
  assert.notEqual(merged.questions[0].errorType, 'none');
  assert.match(merged.questions[0].firstWrongStep, /第2步/);
  assert.match(merged.questions[0].overallFeedback, /部分必要解题过程未写出/);
  assert.doesNotThrow(() => validateNewModelResult(merged));
});

test('deterministically recomputes hard-problem summaries when finalAnswerCorrect is repaired', () => {
  const q = question('hard-problem.v2');
  q.finalAnswerCorrect = 'false';
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [q] };
  const issues = collectNewModelResultIssues(output);
  const validationError = Object.assign(new Error('invalid'), { code: issues[0].code, fieldPath: issues[0].fieldPath, issues, modelOutput: output });
  const plan = repair.prepareModelOutputRepair(validationError);
  assert.ok(plan.fieldPaths.includes('questions[0].finalAnswerCorrect'));
  const values = {
    finalAnswerCorrect: false,
    errorType: 'answer_error',
    firstWrongStep: '最终答案需要订正',
    errorReason: '最终答案不正确',
    adjustmentSuggestion: '请重新核对最终答案。',
    overallFeedback: '最终答案需要订正，可见解题过程正确，逐步讲解和逻辑清楚。'
  };
  const repairs = plan.fieldPaths.map((fieldPath) => ({ fieldPath, sourceKey: 'q-1', value: values[fieldPath.split('.').at(-1)] ?? '' }));
  const merged = repair.mergeRepairedOutput(output, { repairs }, plan.fields, plan.schema, plan.validationContext);
  assert.equal(merged.questions[0].finalAnswerCorrect, false);
  assert.equal(merged.questions[0].errorType, 'answer_error');
  assert.match(merged.questions[0].firstWrongStep, /最终答案/);
  assert.match(merged.questions[0].overallFeedback, /最终答案需要订正/);
  assert.doesNotThrow(() => validateNewModelResult(merged));
});

test('flags a composite calculation chain swallowed into step 1 with later numbered explanation-only items', () => {
  const q = question('hard-problem.v2');
  q.studentAnswer = '5头牛';
  q.standardAnswer = '设每头牛每天吃1份草，列式计算后得5头牛。';
  q.stepFeedbacks = [
    { stepIndex: 1, solutionText: '设每头牛每天吃1份草。(20×8-12×10)÷(20-12)=40÷8=5份', explanationText: '', solutionStatus: 'correct', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '综合计算集中在一个步骤中。', correctionAdvice: '补充对应讲解。' },
    { stepIndex: 2, solutionText: '', explanationText: '①求出8头牛20天吃的、10头牛12天吃的', solutionStatus: 'missing', explanationStatus: 'clear', logicStatus: 'insufficient', analysis: '未找到对应过程。', correctionAdvice: '补写过程。' },
    { stepIndex: 3, solutionText: '', explanationText: '②相减得出20-12的天数差', solutionStatus: 'missing', explanationStatus: 'clear', logicStatus: 'insufficient', analysis: '未找到对应过程。', correctionAdvice: '补写过程。' },
    { stepIndex: 4, solutionText: '', explanationText: '③用草数除以天数求每天长5份草', solutionStatus: 'missing', explanationStatus: 'clear', logicStatus: 'insufficient', analysis: '未找到对应过程。', correctionAdvice: '补写过程。' }
  ];
  q.stepStatus = 'missing'; q.logicStatus = 'insufficient'; q.errorType = 'multiple';
  q.firstWrongStep = '第2至4步缺少过程'; q.errorReason = '多个讲解没有过程'; q.adjustmentSuggestion = '补写过程'; q.overallFeedback = '部分过程缺失。';
  const issues = collectNewModelResultIssues({ outputSchemaVersion: 'hard-problem.v2', questions: [q] });
  assert.ok(issues.some((item) => item.fieldPath === 'questions[0].stepFeedbacks' && item.validator === 'hard-problem-step-semantics'));
});

test('rejects one over-consolidated step when a composite formula contains four distinct numbered explanation purposes', () => {
  const q = question('hard-problem.v2');
  q.studentAnswer = '5头牛';
  q.standardAnswer = '设每头牛每天吃1份草，列式计算后得5头牛。';
  q.stepFeedbacks = [{
    stepIndex: 1,
    solutionText: '设每头牛每天吃1份草。(20×8-12×10)÷(20-12)=40÷8=5份',
    explanationText: '①求出两种情况下的总草量；②相减求天数差；③用草量差除以天数差求每天新长草量；④所以最多5头牛',
    solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '综合计算与合并后的讲解对应清楚。', correctionAdvice: ''
  }];
  q.stepStatus = 'correct'; q.logicStatus = 'correct'; q.errorType = 'none'; q.firstWrongStep = ''; q.errorReason = ''; q.adjustmentSuggestion = ''; q.overallFeedback = '最终答案正确，可见解题过程和讲解对应清楚。';
  const issues = collectNewModelResultIssues({ outputSchemaVersion: 'hard-problem.v2', questions: [q] });
  assert.ok(issues.some((item) => item.fieldPath === 'questions[0].stepFeedbacks' && item.validator === 'hard-problem-step-semantics'));
});

test('normalizes hard-problem derived fields without changing student source text', () => {
  const q = question('hard-problem.v2');
  q.stepFeedbacks = [{ ...q.stepFeedbacks[0], stepIndex: 7, explanationStatus: 'partially_clear', logicStatus: 'insufficient', correctionAdvice: '补充为什么使用加法。' }];
  q.stepStatus = 'correct';
  q.logicStatus = 'correct';
  q.errorType = 'none';
  q.firstWrongStep = '';
  q.errorReason = '';
  q.adjustmentSuggestion = '';
  q.overallFeedback = '整个过程完全正确，无需调整。';
  const originalSolution = q.stepFeedbacks[0].solutionText;
  const originalExplanation = q.stepFeedbacks[0].explanationText;
  const normalized = normalizeNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [q] });
  const result = normalized.questions[0];
  assert.equal(result.stepFeedbacks[0].stepIndex, 1);
  assert.equal(result.stepFeedbacks[0].solutionText, originalSolution);
  assert.equal(result.stepFeedbacks[0].explanationText, originalExplanation);
  assert.equal(result.stepStatus, 'wrong');
  assert.equal(result.logicStatus, 'insufficient');
  assert.equal(result.errorType, 'logic_error');
  assert.match(result.firstWrongStep, /第1步讲解不完整/);
  assert.doesNotMatch(result.overallFeedback, /完全正确|无需调整/);
  assert.doesNotThrow(() => validateNewModelResult(normalized));
});

test('preserves a compatible model-identified method_error while normalizing aggregate fields', () => {
  const q = question('hard-problem.v2');
  q.finalAnswerCorrect = false;
  q.stepFeedbacks = [{ ...q.stepFeedbacks[0], solutionStatus: 'wrong', explanationStatus: 'clear', logicStatus: 'wrong', analysis: '学生采用的方法不适用于本题。', correctionAdvice: '改用正确的数量关系。' }];
  q.stepStatus = 'correct';
  q.logicStatus = 'correct';
  q.errorType = 'method_error';
  q.firstWrongStep = '第1步方法不适用';
  q.errorReason = '所用方法与题意不符';
  q.adjustmentSuggestion = '重新建立数量关系';
  q.overallFeedback = '方法需要调整。';
  const normalized = normalizeNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [q] });
  assert.equal(normalized.questions[0].stepStatus, 'wrong');
  assert.equal(normalized.questions[0].logicStatus, 'wrong');
  assert.equal(normalized.questions[0].errorType, 'method_error');
});

test('normalization fixes emitted count but preserves visual question count for omission detection', () => {
  const q = question('hard-problem.v2');
  const result = normalizeNewModelResult({
    outputSchemaVersion: 'hard-problem.v2',
    questions: [q],
    questionSetAudit: { visibleIndependentQuestionCount: 2, emittedQuestionCount: 99, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 0.9 }
  });
  assert.equal(result.questionSetAudit.emittedQuestionCount, 1);
  assert.equal(result.questionSetAudit.visibleIndependentQuestionCount, 2);
  assert.throws(() => validateQuestionSetAudit(result, { required: true }), (error) => error.code === 'QUESTION_SET_AUDIT_COUNT_MISMATCH');
});

test('rejects overall feedback that claims the whole process is error-free while structured statuses report missing evidence', () => {
  const q = question('hard-problem.v2');
  q.stepFeedbacks[0] = { ...q.stepFeedbacks[0], solutionText: '', solutionStatus: 'missing', explanationText: '先求总量', explanationStatus: 'clear', logicStatus: 'insufficient', analysis: '缺少对应解题过程。', correctionAdvice: '补写对应解题过程。' };
  q.stepStatus = 'missing'; q.logicStatus = 'insufficient'; q.errorType = 'multiple';
  q.firstWrongStep = '第1步缺少解题过程'; q.errorReason = '第1步只有讲解'; q.adjustmentSuggestion = '补写过程'; q.overallFeedback = '整个解题过程没有错误。';
  const issues = collectNewModelResultIssues({ outputSchemaVersion: 'hard-problem.v2', questions: [q] });
  assert.ok(issues.some((item) => item.fieldPath === 'questions[0].overallFeedback'));
});

test('new v2 contract rejects each missing required evidence field and accepts a complete question', () => {
  for (const version of ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2']) {
    const complete = question(version);
    assert.doesNotThrow(() => validateNewModelResult(result(version, [complete]), { strategy: remoteStrategy(version) }));
    for (const field of EVIDENCE_FIELDS) {
      const incomplete = { ...complete };
      delete incomplete[field];
      assert.throws(() => validateNewModelResult(result(version, [incomplete]), { strategy: remoteStrategy(version) }), (error) => error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === `questions[0].${field}`);
    }
  }
});

test('collects blank or whitespace question attribution fields as repairable schema issues', () => {
  for (const version of ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2']) {
    const output = result(version, [{ ...question(version), sourceQuestionLabel: ' ', sourceRegion: '' }]);
    const issues = collectNewModelResultIssues(output, { strategy: remoteStrategy(version) });
    assert.deepEqual(issues.map((item) => [item.fieldPath, item.repairable, item.validator]), [
      ['questions[0].sourceQuestionLabel', true, 'non-empty-string'],
      ['questions[0].sourceRegion', true, 'non-empty-string']
    ]);
  }
});

test('legacy strategy contracts remain compatible without evidence-field declarations', () => {
  const legacyMetadata = { outputSchemaRegistryVersion: 'output-schema-registry.v1', downstreamSemanticsVersion: 'result-semantics.v1', outputSchemaIds: ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2'] };
  assert.doesNotThrow(() => assertStrategyCompatibility(legacyMetadata));
  assert.equal(mapLegacyResult({ questions: [] }, 'hard-problem').outputSchemaVersion, 'hard-problem.legacy');
});

test('routes each v2 result by outputSchemaVersion and rejects unknown versions without fallback', () => {
  for (const version of ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2']) {
    assert.equal(validateNewModelResult(result(version)).schema.schemaId, version);
  }
  assert.throws(() => validateNewModelResult({ outputSchemaVersion: 'future.v3', questions: [] }), (error) => error.code === 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION' && error.receivedVersion === 'future.v3' && error.supportedVersions.includes('hard-problem.v2'));
});

test('rejects a required questionSetAudit whose emitted count disagrees with raw questions', () => {
  assert.throws(() => validateQuestionSetAudit({
    questions: [question('hard-problem.v2')],
    questionSetAudit: { visibleIndependentQuestionCount: 3, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 }
  }, { required: true }), (error) => error.code === 'QUESTION_SET_AUDIT_COUNT_MISMATCH');
});

function readingQuestion(overrides = {}) {
  return {
    ...question('reading-careless.v2'),
    referenceConditionText: 'reference condition',
    referenceRelationText: 'reference relation',
    referenceAskText: 'reference ask',
    ...overrides
  };
}

test('accepts reading-careless ok results with complete reference grids', () => {
  assert.doesNotThrow(() => validateNewModelResult(result('reading-careless.v2', [readingQuestion()])));
});

test('rejects an empty reference grid for reading-careless ok results', () => {
  assert.throws(() => validateNewModelResult(result('reading-careless.v2', [readingQuestion({ referenceConditionText: '  ' })])), (error) => error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions[0].referenceConditionText');
});

test('accepts empty reference grids for reading-careless insufficient results', () => {
  assert.doesNotThrow(() => validateNewModelResult(result('reading-careless.v2', [readingQuestion({
      analysisStatus: 'insufficient',
      conditionCorrect: null,
      relationCorrect: null,
      askCorrect: null,
      referenceConditionText: '',
      referenceRelationText: '',
      referenceAskText: ''
    })])));
});

test('maps versionless historical results only through the legacy mapper', () => {
  for (const mode of ['hard-problem', 'reading-careless', 'calculation-careless']) {
    assert.equal(mapLegacyResult({ questions: [] }, mode).outputSchemaVersion, `${mode}.legacy`);
    assert.throws(() => validateNewModelResult({ questions: [] }, mode), (error) => error.code === 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION' && error.fieldPath === 'outputSchemaVersion');
  }
});

test('rejects incompatible public strategy metadata before model invocation', () => {
  const valid = { outputSchemaRegistryVersion: 'output-schema-registry.v1', downstreamSemanticsVersion: 'result-semantics.v1', outputSchemaIds: ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2'] };
  assert.doesNotThrow(() => assertStrategyCompatibility(valid));
  assert.throws(() => assertStrategyCompatibility({ ...valid, outputSchemaRegistryVersion: 'v0' }), (error) => error.code === 'UNSUPPORTED_SCHEMA_REGISTRY_VERSION');
  assert.throws(() => assertStrategyCompatibility({ ...valid, downstreamSemanticsVersion: 'v0' }), (error) => error.code === 'UNSUPPORTED_DOWNSTREAM_SEMANTICS_VERSION');
  assert.throws(() => assertStrategyCompatibility({ ...valid, outputSchemaIds: ['hard-problem.v2'] }), (error) => error.code === 'REQUIRED_OUTPUT_SCHEMA_MISSING');
});

test('rejects model runtime contracts missing a required stage before invocation', () => {
  const stages = ['hardProblemPrimary', 'hardProblemReview', 'readingCarelessPrimary', 'readingCarelessReview', 'calculationCarelessPrimary', 'calculationCarelessReview'];
  const runtime = Object.fromEntries(stages.map((stage) => [stage, { outputSchemaVersion: stage.startsWith('hard') ? 'hard-problem.v2' : stage.startsWith('reading') ? 'reading-careless.v2' : 'calculation-careless.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1, reviewPayloadMode: 'compact' }]));
  const strategy = { strategyVersion: 'test', modelRuntimeContractVersion: 'model-runtime.v1', modelOutputRepairPolicy: { version: 'model-output-repair.v1' }, outputSchemaRegistryVersion: 'output-schema-registry.v1', downstreamSemanticsVersion: 'result-semantics.v1', outputSchemaIds: ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2'], modelRuntime: runtime, prompts: Object.fromEntries(['narration', 'answerExtraction', 'grade', 'hardProblem', 'carelessTraining', 'calculationCarelessTraining'].map((key) => [key, { system: 's', userTemplate: 'u' }])), models: { grading: { timeoutMs: 1000 } }, reviewRules: { hardProblem: { correctStepStatuses: [] } } };
  assert.doesNotThrow(() => assertStrategyBundle(strategy));
  delete strategy.modelRuntime.hardProblemReview;
  assert.throws(() => assertStrategyBundle(strategy), (error) => error.code === 'INVALID_MODEL_RUNTIME_CONFIG');
});

test('validates and reads all six model runtime stages from the preferred stages structure', () => {
  const stages = ['hardProblemPrimary', 'hardProblemReview', 'readingCarelessPrimary', 'readingCarelessReview', 'calculationCarelessPrimary', 'calculationCarelessReview'];
  const runtimeStages = Object.fromEntries(stages.map((stage) => [stage, { outputSchemaVersion: stage.startsWith('hard') ? 'hard-problem.v2' : stage.startsWith('reading') ? 'reading-careless.v2' : 'calculation-careless.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1, reviewPayloadMode: 'compact' }]));
  const strategy = { strategyVersion: 'test', modelRuntimeContractVersion: 'model-runtime.v1', modelOutputRepairPolicy: { version: 'model-output-repair.v1' }, outputSchemaRegistryVersion: 'output-schema-registry.v1', downstreamSemanticsVersion: 'result-semantics.v1', outputSchemaIds: ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2'], modelRuntime: { stages: runtimeStages }, prompts: Object.fromEntries(['narration', 'answerExtraction', 'grade', 'hardProblem', 'carelessTraining', 'calculationCarelessTraining'].map((key) => [key, { system: 's', userTemplate: 'u' }])), models: { grading: { timeoutMs: 1000 } }, reviewRules: { hardProblem: { correctStepStatuses: [] } } };
  assert.doesNotThrow(() => assertStrategyBundle(strategy));
  for (const stage of stages) assert.equal(getModelRuntimeStage(strategy, stage), runtimeStages[stage]);
});

test('validates and reads all six model runtime stages from the legacy structure', () => {
  const stages = ['hardProblemPrimary', 'hardProblemReview', 'readingCarelessPrimary', 'readingCarelessReview', 'calculationCarelessPrimary', 'calculationCarelessReview'];
  const runtime = Object.fromEntries(stages.map((stage) => [stage, { outputSchemaVersion: stage.startsWith('hard') ? 'hard-problem.v2' : stage.startsWith('reading') ? 'reading-careless.v2' : 'calculation-careless.v2', modelTier: 'lite', temperature: 0, maxOutputTokens: 4096, timeoutMs: 1000, structuredOutputMode: 'none', maxRepairAttempts: 1, reviewPayloadMode: 'compact' }]));
  const strategy = { strategyVersion: 'test', modelRuntimeContractVersion: 'model-runtime.v1', modelOutputRepairPolicy: { version: 'model-output-repair.v1' }, outputSchemaRegistryVersion: 'output-schema-registry.v1', downstreamSemanticsVersion: 'result-semantics.v1', outputSchemaIds: ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2'], modelRuntime: runtime, prompts: Object.fromEntries(['narration', 'answerExtraction', 'grade', 'hardProblem', 'carelessTraining', 'calculationCarelessTraining'].map((key) => [key, { system: 's', userTemplate: 'u' }])), models: { grading: { timeoutMs: 1000 } }, reviewRules: { hardProblem: { correctStepStatuses: [] } } };
  assert.doesNotThrow(() => assertStrategyBundle(strategy));
  for (const stage of stages) assert.equal(getModelRuntimeStage(strategy, stage), runtime[stage]);
});

function finalQuestion(sourceKey, overrides = {}) {
  return { sourceKey, questionText: `Question ${sourceKey}`, ...overrides };
}

function assertExclusiveSummary(result) {
  const { totalCount, correctCount, wrongCount, incompleteCount, carelessCount } = result.summary;
  for (const value of [totalCount, correctCount, wrongCount, incompleteCount, carelessCount]) assert.equal(typeof value, 'number');
  assert.equal(totalCount, correctCount + wrongCount + incompleteCount + carelessCount);
}

test('accepts three recognized questions when the final result contains the same three questions', () => {
  const questions = [finalQuestion('q-1', { evaluationStatus: 'CORRECT' }), finalQuestion('q-2', { evaluationStatus: 'WRONG' }), finalQuestion('q-3', { evaluationStatus: 'UNDETERMINED' })];
  const result = validateFinalResultContract({
    finalResult: { outputSchemaVersion: 'hard-problem.v2', questions, summary: {} },
    primaryResult: { questions },
    reviewResult: { questions },
    recognizedQuestionCount: 3
  });
  assert.equal(result.questions.length, 3);
});

test('accepts a REVIEW sourceKey superset as the final question set in REVIEW order', () => {
  const primaryQuestions = [finalQuestion('q-16')];
  const reviewQuestions = [finalQuestion('q-16'), finalQuestion('q-17'), finalQuestion('q-18')];
  const result = validateFinalResultContract({
    finalResult: { outputSchemaVersion: 'hard-problem.v2', questions: reviewQuestions, summary: {} },
    primaryResult: { questions: primaryQuestions },
    reviewResult: { questions: reviewQuestions }
  });
  assert.deepEqual(result.questions.map((question) => question.sourceKey), ['q-16', 'q-17', 'q-18']);
});

test('rejects a final result with fewer questions than were recognized', () => {
  assert.throws(() => validateFinalResultContract({
    finalResult: { outputSchemaVersion: 'hard-problem.v2', questions: [finalQuestion('q-1')], summary: {} },
    recognizedQuestionCount: 3
  }), (error) => error.code === 'QUESTION_COUNT_MISMATCH');
});

test('rejects empty final questions instead of generating an empty result', () => {
  assert.throws(() => validateFinalResultContract({
    finalResult: { outputSchemaVersion: 'hard-problem.v2', questions: [], summary: {} }
  }), (error) => error.code === 'QUESTION_COUNT_MISMATCH');
});

test('rejects duplicate final question sourceKeys', () => {
  assert.throws(() => validateFinalResultContract({
    finalResult: { outputSchemaVersion: 'hard-problem.v2', questions: [finalQuestion('q-1')], summary: {} },
    primaryResult: { questions: [finalQuestion('q-1')] },
    reviewResult: { questions: [finalQuestion('q-1'), finalQuestion('q-1')] }
  }), (error) => error.code === 'QUESTION_SOURCE_KEY_DUPLICATE');
});

test('rejects primary and review results with different sourceKey sets', () => {
  assert.throws(() => validateFinalResultContract({
    finalResult: { outputSchemaVersion: 'hard-problem.v2', questions: [finalQuestion('q-1'), finalQuestion('q-2')], summary: {} },
    primaryResult: { questions: [finalQuestion('q-1'), finalQuestion('q-2')] },
    reviewResult: { questions: [finalQuestion('q-1'), finalQuestion('q-3')] }
  }), (error) => error.code === 'QUESTION_SET_MISMATCH');
});

test('rebuilds final summary from final questions instead of trusting model summary', () => {
  const result = validateFinalResultContract({
    finalResult: {
      outputSchemaVersion: 'calculation-careless.v2',
      questions: [
        finalQuestion('q-1', { analysisStatus: 'ok', carelessDetected: false, processCorrect: true, finalAnswerCorrect: true, issueCategory: 'none' }),
        finalQuestion('q-2', { analysisStatus: 'ok', carelessDetected: true, processCorrect: false, finalAnswerCorrect: false, issueCategory: 'careless' }),
        finalQuestion('q-3', { analysisStatus: 'ok', carelessDetected: false, processCorrect: false, finalAnswerCorrect: false, issueCategory: 'knowledge_or_method' })
      ],
      summary: { totalCount: 99, correctCount: 99, wrongCount: 0, incompleteCount: 99, carelessCount: 0 }
    }
  });
  assert.deepEqual(result.summary, { totalCount: 3, correctCount: 1, wrongCount: 1, incompleteCount: 0, carelessCount: 1 });
});

test('classifies hard-problem final questions by answer, process, and logic', () => {
  const result = validateFinalResultContract({
    finalResult: {
      outputSchemaVersion: 'hard-problem.v2',
      questions: [
        finalQuestion('hard-incomplete', { answerStatus: 'answered', finalAnswerCorrect: true, logicStatus: 'insufficient', stepRequired: true, stepStatus: 'correct' }),
        finalQuestion('hard-wrong', { answerStatus: 'answered', finalAnswerCorrect: true, logicStatus: 'correct', stepRequired: true, stepStatus: 'wrong' }),
        finalQuestion('hard-missing-step-required', { answerStatus: 'answered', finalAnswerCorrect: true, logicStatus: 'correct', stepStatus: 'not_required' }),
        finalQuestion('hard-correct', { answerStatus: 'answered', finalAnswerCorrect: true, logicStatus: 'correct', stepRequired: true, stepStatus: 'correct' })
      ],
      summary: { totalCount: 99, correctCount: 99, wrongCount: 99, incompleteCount: 0, carelessCount: 99 }
    }
  });
  assert.deepEqual(result.summary, { totalCount: 4, correctCount: 1, wrongCount: 3, incompleteCount: 0, carelessCount: 0 });
  assertExclusiveSummary(result);
});

test('classifies a readable blank reading grid as WRONG instead of INCOMPLETE', () => {
  const result = validateFinalResultContract({
    finalResult: {
      outputSchemaVersion: 'reading-careless.v2',
      questions: [
        finalQuestion('reading-blank', { analysisStatus: 'ok', studentConditionText: 'condition', studentRelationText: '', studentAskText: 'ask', conditionCorrect: true, relationCorrect: false, askCorrect: true }),
        finalQuestion('reading-wrong', { analysisStatus: 'ok', studentConditionText: 'condition', studentRelationText: 'relation', studentAskText: 'ask', conditionCorrect: true, relationCorrect: false, askCorrect: true }),
        finalQuestion('reading-undetermined', { analysisStatus: 'insufficient', studentConditionText: '', studentRelationText: '', studentAskText: '', conditionCorrect: null, relationCorrect: null, askCorrect: null }),
        finalQuestion('reading-correct', { analysisStatus: 'ok', studentConditionText: 'condition', studentRelationText: 'relation', studentAskText: 'ask', conditionCorrect: true, relationCorrect: true, askCorrect: true })
      ],
      summary: {}
    }
  });
  assert.deepEqual(result.summary, { totalCount: 4, correctCount: 1, wrongCount: 2, incompleteCount: 1, carelessCount: 0 });
  assertExclusiveSummary(result);
});

test('classifies calculation-careless final questions into mutually exclusive categories', () => {
  const result = validateFinalResultContract({
    finalResult: {
      outputSchemaVersion: 'calculation-careless.v2',
      questions: [
        finalQuestion('calculation-careless', { analysisStatus: 'ok', carelessDetected: true, processCorrect: false, finalAnswerCorrect: false }),
        finalQuestion('calculation-wrong', { analysisStatus: 'ok', carelessDetected: false, processCorrect: true, finalAnswerCorrect: false }),
        finalQuestion('calculation-correct', { analysisStatus: 'ok', carelessDetected: false, processCorrect: true, finalAnswerCorrect: true }),
        finalQuestion('calculation-incomplete', { analysisStatus: 'insufficient', carelessDetected: false, processCorrect: true, finalAnswerCorrect: true })
      ],
      summary: {}
    }
  });
  assert.deepEqual(result.summary, { totalCount: 4, correctCount: 1, wrongCount: 1, incompleteCount: 1, carelessCount: 1 });
  assertExclusiveSummary(result);
});

test('hard-problem step explanation contract validates every nested field and aggregate status', () => {
  const complete = question('hard-problem.v2');
  assert.doesNotThrow(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [complete] }));

  const missingAnalysis = structuredClone(complete);
  delete missingAnalysis.stepFeedbacks[0].analysis;
  assert.throws(
    () => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [missingAnalysis] }),
    (error) => error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions[0].stepFeedbacks[0].analysis'
  );

  const unclearExplanation = structuredClone(complete);
  unclearExplanation.stepFeedbacks[0].explanationStatus = 'partially_clear';
  unclearExplanation.stepFeedbacks[0].logicStatus = 'insufficient';
  unclearExplanation.stepFeedbacks[0].correctionAdvice = '补充说明为什么使用加法。';
  unclearExplanation.stepStatus = 'wrong';
  unclearExplanation.logicStatus = 'insufficient';
  unclearExplanation.errorType = 'logic_error';
  unclearExplanation.firstWrongStep = '第1步讲解';
  unclearExplanation.errorReason = '第1步没有完整说明使用加法的原因。';
  unclearExplanation.adjustmentSuggestion = '补充第1步的运算依据。';
  unclearExplanation.overallFeedback = '计算正确，但讲解不完整。';
  assert.doesNotThrow(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [unclearExplanation] }));

  unclearExplanation.stepStatus = 'correct';
  assert.throws(
    () => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [unclearExplanation] }),
    (error) => error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions[0].stepStatus'
  );
});

function strictHardRuntimeStrategy() {
  const schema = outputSchemaRegistry.getSchema('hard-problem.v2');
  return {
    outputSchemaRegistry: { schemas: [{ schemaId: 'hard-problem.v2', strategyContractKey: 'hardProblemV2' }] },
    contracts: {
      hardProblemV2: {
        requiredFields: [...schema.requiredFields],
        fieldTypes: { studentWorkDetected: 'boolean', sourceQuestionLabel: 'string', sourceRegion: 'string', inputBasis: 'enum', modeApplicability: 'enum', stepFeedbacks: 'array', overallFeedback: 'string' },
        enumFields: { inputBasis: INPUT_BASIS_VALUES, modeApplicability: MODE_APPLICABILITY_VALUES },
        arrayFields: ['stepFeedbacks'],
        arrayItemSchemas: schema.arrayItemSchemas,
        topLevelRequiredFields: ['outputSchemaVersion', 'mode', 'route', 'imageQuality', 'questions', 'questionSetAudit'],
        topLevelFieldTypes: { outputSchemaVersion: 'string', mode: 'string', route: 'object', imageQuality: 'object', questions: 'array', questionSetAudit: 'object' },
        topLevelEnumFields: { mode: ['hard-problem'] },
        topLevelObjectSchemas: {
          route: { requiredFields: ['difficulty', 'confidence', 'flags'], fieldTypes: { difficulty: 'enum', confidence: 'number_0_to_1', flags: 'array' }, enumFields: { difficulty: ['normal', 'hard', 'very_hard'] } },
          imageQuality: { requiredFields: ['ok', 'issues'], fieldTypes: { ok: 'boolean', issues: 'array' } },
          questionSetAudit: { requiredFields: ['visibleIndependentQuestionCount', 'emittedQuestionCount', 'excludedQuestionCount', 'orientation', 'countConfidence'], fieldTypes: { visibleIndependentQuestionCount: 'integer_min_0', emittedQuestionCount: 'integer_min_0', excludedQuestionCount: 'integer_min_0', orientation: 'enum', countConfidence: 'number_0_to_1' }, enumFields: { orientation: ['upright', 'rotated_left', 'rotated_right', 'upside_down', 'uncertain'] }, consistencyRules: ['emittedQuestionCount_equals_questions_length', 'visibleIndependentQuestionCount_equals_emittedQuestionCount_plus_excludedQuestionCount'] }
        }
      }
    }
  };
}
function strictHardOutput() {
  return {
    outputSchemaVersion: 'hard-problem.v2', mode: 'hard-problem',
    route: { difficulty: 'normal', confidence: 1, flags: [] },
    imageQuality: { ok: true, issues: [] },
    questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [question('hard-problem.v2')]
  };
}

test('hard-problem runtime validates and one-pass repairs all model-visible top-level contract fields', () => {
  const strategy = strictHardRuntimeStrategy();
  const output = strictHardOutput();
  assert.doesNotThrow(() => validateNewModelResult(output, { strategy }));
  output.mode = 'wrong-mode';
  output.route = { difficulty: 'unknown', confidence: 5, flags: 'bad' };
  output.imageQuality = { ok: 'yes' };
  output.questionSetAudit = { visibleIndependentQuestionCount: 3, emittedQuestionCount: 2, excludedQuestionCount: 0, orientation: 'sideways', countConfidence: 2 };
  let validationError;
  try { validateNewModelResult(output, { strategy }); } catch (error) { validationError = error; }
  validationError.modelOutput = output;
  assert.deepEqual(validationError.issues.map((item) => item.fieldPath), ['mode', 'route', 'imageQuality', 'questionSetAudit']);
  const plan = repair.prepareModelOutputRepair(validationError, strategy);
  assert.deepEqual(plan.fieldPaths, ['mode', 'route', 'imageQuality', 'questionSetAudit']);
  const merged = repair.mergeRepairedOutput(output, { repairs: [
    { fieldPath: 'mode', value: 'hard-problem' },
    { fieldPath: 'route', value: { difficulty: 'normal', confidence: 1, flags: [] } },
    { fieldPath: 'imageQuality', value: { ok: true, issues: [] } },
    { fieldPath: 'questionSetAudit', value: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 } }
  ] }, plan.fields, plan.schema, plan.validationContext);
  assert.doesNotThrow(() => validateNewModelResult(merged, { strategy }));
});

test('hard-problem runtime rejects an empty questions array instead of repairing or completing student work', () => {
  const strategy = strictHardRuntimeStrategy();
  const output = { ...strictHardOutput(), questions: [], questionSetAudit: { visibleIndependentQuestionCount: 0, emittedQuestionCount: 0, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 } };
  let validationError;
  assert.throws(() => validateNewModelResult(output, { strategy }), (error) => {
    validationError = error;
    return error.code === 'LLM_SCHEMA_ERROR' && error.fieldPath === 'questions' && error.issues.some((item) => item.repairable === false);
  });
  validationError.modelOutput = output;
  assert.equal(repair.prepareModelOutputRepair(validationError, strategy), null);
});


test('hard-problem output quality requires concrete correction content and clean fully-correct fields', () => {
  const partial = question('hard-problem.v2');
  partial.stepFeedbacks[0].explanationStatus = 'partially_clear';
  partial.stepFeedbacks[0].logicStatus = 'insufficient';
  partial.stepFeedbacks[0].correctionAdvice = '';
  partial.stepStatus = 'wrong'; partial.logicStatus = 'insufficient'; partial.errorType = 'logic_error';
  partial.firstWrongStep = '第1步讲解'; partial.errorReason = '讲解不完整'; partial.adjustmentSuggestion = '补充依据';
  assert.throws(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [partial] }), (error) => error.fieldPath === 'questions[0].stepFeedbacks[0].correctionAdvice');

  const wrongSummary = question('hard-problem.v2');
  wrongSummary.finalAnswerCorrect = false; wrongSummary.errorType = 'answer_error';
  wrongSummary.firstWrongStep = ''; wrongSummary.errorReason = ''; wrongSummary.adjustmentSuggestion = '';
  assert.throws(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [wrongSummary] }), (error) => error.fieldPath === 'questions[0].firstWrongStep');

  const correctAdvice = question('hard-problem.v2');
  correctAdvice.stepFeedbacks[0].correctionAdvice = '不应出现的建议';
  assert.throws(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [correctAdvice] }), (error) => error.fieldPath === 'questions[0].stepFeedbacks[0].correctionAdvice');

  const knowledge = question('hard-problem.v2'); knowledge.knowledgePoint = '加法';
  assert.throws(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [knowledge] }), (error) => error.fieldPath === 'questions[0].knowledgePoint');

  const noStandard = question('hard-problem.v2'); noStandard.standardAnswer = '';
  assert.throws(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [noStandard] }), (error) => error.fieldPath === 'questions[0].standardAnswer');
});

test('hard-problem accepts evidence-backed incomplete units instead of requiring a standard student format', () => {
  const explanationOnly = question('hard-problem.v2');
  explanationOnly.studentAnswer = '5头';
  explanationOnly.stepFeedbacks = [{
    stepIndex: 1, solutionText: '', explanationText: '先比较两种放牧情况的总吃草量。',
    solutionStatus: 'missing', explanationStatus: 'clear', logicStatus: 'insufficient',
    analysis: '学生写出了思路说明，但没有写出对应计算过程。', correctionAdvice: '补写与这段思路对应的算式。'
  }];
  explanationOnly.stepStatus = 'missing'; explanationOnly.logicStatus = 'insufficient'; explanationOnly.errorType = 'method_error';
  explanationOnly.firstWrongStep = '第1步缺少解题过程'; explanationOnly.errorReason = '只写了思路，没有写对应算式。';
  explanationOnly.adjustmentSuggestion = '补写对应算式。'; explanationOnly.overallFeedback = '最终答案可见，但过程证据不完整。';
  assert.doesNotThrow(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [explanationOnly] }));

  const processOnly = question('hard-problem.v2');
  processOnly.studentAnswer = '76台';
  processOnly.stepFeedbacks = [{
    stepIndex: 1, solutionText: '38×2=76（台）', explanationText: '',
    solutionStatus: 'correct', explanationStatus: 'missing', logicStatus: 'insufficient',
    analysis: '学生写出了正确计算，但没有写出为什么使用乘法。', correctionAdvice: '补充说明：空调数量是洗衣机数量的2倍，所以用乘法。'
  }];
  processOnly.stepStatus = 'wrong'; processOnly.logicStatus = 'insufficient'; processOnly.errorType = 'logic_error';
  processOnly.firstWrongStep = '第1步讲解缺失'; processOnly.errorReason = '计算过程存在，但没有对应讲解。';
  processOnly.adjustmentSuggestion = '补充这一步的数量关系依据。'; processOnly.overallFeedback = '计算正确，讲解内容缺失。';
  assert.doesNotThrow(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [processOnly] }));

  const answerOnly = question('hard-problem.v2');
  answerOnly.studentAnswer = '5头';
  answerOnly.stepFeedbacks = [{
    stepIndex: 1, solutionText: '', explanationText: '', solutionStatus: 'missing', explanationStatus: 'missing', logicStatus: 'insufficient',
    analysis: '图片中只看到最终答案，没有看到解题过程和对应讲解。', correctionAdvice: '补写解题过程并说明每一步为什么这样做。'
  }];
  answerOnly.stepStatus = 'missing'; answerOnly.logicStatus = 'insufficient'; answerOnly.errorType = 'method_error';
  answerOnly.firstWrongStep = '解题过程和讲解缺失'; answerOnly.errorReason = '只写了最终答案。';
  answerOnly.adjustmentSuggestion = '补写过程和讲解。'; answerOnly.overallFeedback = '只能确认最终答案，无法确认解题过程。';
  assert.doesNotThrow(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [answerOnly] }));
});

test('hard-problem flags repeated explanation prose copied into solutionText across several steps', () => {
  const polluted = question('hard-problem.v2');
  polluted.stepFeedbacks = [
    { stepIndex: 1, solutionText: '求出8头牛20天吃的草', explanationText: '求出8头牛20天吃的草', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '内容重复。', correctionAdvice: '' },
    { stepIndex: 2, solutionText: '相减得出相差天数', explanationText: '相减得出相差天数', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '内容重复。', correctionAdvice: '' }
  ];
  const issues = collectNewModelResultIssues({ outputSchemaVersion: 'hard-problem.v2', questions: [polluted] });
  assert.ok(issues.some((item) => item.fieldPath === 'questions[0].stepFeedbacks' && item.validator === 'hard-problem-step-semantics'));
});

test('hard-problem flags an answer restatement split into a redundant extra step only when the result already exists', () => {
  const split = question('hard-problem.v2');
  split.studentAnswer = '答：文艺书500本，科技书700本';
  split.stepFeedbacks = [
    { stepIndex: 1, solutionText: '1200-500=700本', explanationText: '用总数减去文艺书本数，求科技书本数。', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '计算和解释正确。', correctionAdvice: '' },
    { stepIndex: 2, solutionText: '答：文艺书500本，科技书700本', explanationText: '', solutionStatus: 'correct', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '答语重复前一步结果。', correctionAdvice: '将答语与前一步最终计算合并。' }
  ];
  split.stepStatus = 'wrong'; split.logicStatus = 'insufficient'; split.errorType = 'logic_error';
  split.firstWrongStep = '第2步答语重复拆分'; split.errorReason = '最终答语被单独拆成步骤。'; split.adjustmentSuggestion = '与前一步合并。'; split.overallFeedback = '结果正确，但步骤切分重复。';
  const issues = collectNewModelResultIssues({ outputSchemaVersion: 'hard-problem.v2', questions: [split] });
  assert.ok(issues.some((item) => item.fieldPath === 'questions[0].stepFeedbacks'));
});

test('hard-problem preserves multiple equation lines inside one student-defined visual step', () => {
  const merged = question('hard-problem.v2');
  merged.studentAnswer = '700';
  merged.standardAnswer = '700';
  merged.stepFeedbacks = [
    { stepIndex: 1, solutionText: 'x + 1.4x = 1200\n2.4x = 1200\nx = 500', explanationText: '列方程后化简并解出x。', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '思路：列方程求文艺书数量；公式/知识点：同类项合并和解方程正确；逻辑：三行计算属于同一编号步骤。', correctionAdvice: '' },
    { stepIndex: 2, solutionText: '1200 - 500 = 700', explanationText: '', solutionStatus: 'correct', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '思路：用总数减去文艺书数量；公式/知识点：减法计算正确；逻辑：缺少为什么使用减法的讲解。', correctionAdvice: '补充说明：科技书本数等于总数减去文艺书本数。' }
  ];
  merged.stepStatus = 'wrong'; merged.logicStatus = 'insufficient'; merged.errorType = 'logic_error';
  merged.firstWrongStep = '第2步讲解缺失'; merged.errorReason = '第二步没有单独讲解。'; merged.adjustmentSuggestion = '补充计算依据。'; merged.overallFeedback = '第一步多行方程属于同一学生步骤；第二步计算正确但讲解缺失。';
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [merged] };
  const issues = collectNewModelResultIssues(output);
  const segmentationIssue = issues.find((item) => item.fieldPath === 'questions[0].stepFeedbacks' && item.validator === 'hard-problem-step-semantics');
  assert.equal(segmentationIssue, undefined);
  assert.doesNotThrow(() => validateNewModelResult(output));
});

test('hard-problem accepts four visible calculation steps with missing explanations and no extra answer step', () => {
  const split = question('hard-problem.v2');
  split.studentAnswer = '700';
  split.standardAnswer = '700';
  split.stepFeedbacks = [
    'x + 1.4x = 1200',
    '2.4x = 1200',
    'x = 500',
    '1200 - 500 = 700'
  ].map((solutionText, index) => ({ stepIndex: index + 1, solutionText, explanationText: '', solutionStatus: 'correct', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '计算正确，但没有单独讲解。', correctionAdvice: '补充这一步的计算依据。' }));
  split.stepStatus = 'wrong'; split.logicStatus = 'insufficient'; split.errorType = 'logic_error';
  split.firstWrongStep = '第1至4步讲解缺失'; split.errorReason = '每一步计算可见，但没有单独讲解。'; split.adjustmentSuggestion = '分别补充各步计算依据。'; split.overallFeedback = '四个可见计算步骤均已保留，讲解缺失。';
  assert.doesNotThrow(() => validateNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [split] }));
  assert.deepEqual(split.stepFeedbacks.map((step) => step.stepIndex), [1, 2, 3, 4]);
  assert.equal(split.stepFeedbacks.length, 4);
  assert.ok(split.stepFeedbacks.every((step) => step.explanationStatus === 'missing' && step.explanationText === ''));
});

test('v8 unanswered hard problem may retain the full expected reasoning skeleton without fabricating student source text', () => {
  const q = question('hard-problem.v2');
  q.studentAnswer = '';
  q.standardAnswer = '设未知数，列方程，解方程，再求另一数量并作答。';
  q.answerStatus = 'unanswered';
  q.finalAnswerCorrect = null;
  q.studentWorkDetected = false;
  q.inputBasis = 'printed_question_without_work';
  q.stepRequired = true;
  q.stepStatus = 'missing';
  q.logicStatus = 'insufficient';
  q.errorType = 'unanswered';
  q.firstWrongStep = '第1至4步均未作答';
  q.errorReason = '未检测到学生解题过程或逐步讲解。';
  q.adjustmentSuggestion = '请按必要推理步骤逐步补写过程，并说明每一步为什么这样做。';
  q.overallFeedback = '本题未作答，系统已保留四个必要推理检查点，等待补写。';
  q.stepFeedbacks = ['设未知数', '根据数量关系列方程', '解方程', '求另一数量并作答'].map((purpose, index) => ({
    stepIndex: index + 1,
    solutionText: '',
    explanationText: '',
    solutionStatus: 'missing',
    explanationStatus: 'missing',
    logicStatus: 'insufficient',
    analysis: `思路：学生未写出“${purpose}”对应过程；公式/知识点：需要补充该步骤的数学依据；逻辑：该必要步骤缺失，推理链不完整。`,
    correctionAdvice: `请补充“${purpose}”，并说明为什么这样做。`
  }));
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [q] };
  assert.doesNotThrow(() => validateNewModelResult(output));
  assert.ok(output.questions[0].stepFeedbacks.every((step) => step.solutionText === '' && step.explanationText === ''));
  assert.ok(output.questions[0].stepFeedbacks.every((step) => !('expectedReasoning' in step) && !('expectedPurpose' in step)));
});

test('fixed-step Repair planning and post-merge validation preserve locked segmentation context', () => {
  const q = question('hard-problem.v2');
  q.stepFeedbacks = [{
    stepIndex: 1,
    solutionText: '12+8=20\n20×2=40\n40+2=42\n42÷1=42',
    explanationText: '1.先求第一部分；2.再求第二部分；3.最后合并得到答案',
    solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear',
    analysis: '该固定证据单元的过程、讲解和逻辑均正确。', correctionAdvice: ''
  }];
  q.overallFeedback = '答案、步骤和讲解均正确。';
  q.standardAnswer = '';
  const output = { outputSchemaVersion: 'hard-problem.v2', questions: [q] };
  const diagnostics = { fixedStepReview: true, requestStage: 'hardProblemReview' };
  const fixedIssues = collectNewModelResultIssues(output, diagnostics);
  assert.deepEqual(fixedIssues.map((item) => item.fieldPath), ['questions[0].standardAnswer']);
  assert.ok(collectNewModelResultIssues(output).some((item) => item.fieldPath === 'questions[0].stepFeedbacks'));
  const error = Object.assign(new Error('fixed repair'), { code: 'LLM_SCHEMA_ERROR', fieldPath: fixedIssues[0].fieldPath, issues: fixedIssues, modelOutput: output });
  const plan = repair.prepareModelOutputRepair(error, null, diagnostics);
  assert.deepEqual(plan.fieldPaths, ['questions[0].standardAnswer']);
  assert.equal(plan.validationContext.fixedStepReview, true);
  const merged = repair.mergeRepairedOutput(output, { repairs: [{ fieldPath: 'questions[0].standardAnswer', sourceKey: 'q-1', value: '42' }] }, plan.fields, plan.schema, plan.validationContext);
  assert.doesNotThrow(() => validateNewModelResult(merged, diagnostics));
});

test('hard-problem direct-answer questions normalize and validate as correct without required steps', () => {
  const q = question('hard-problem.v2');
  Object.assign(q, {
    stepRequired: false,
    stepFeedbacks: [],
    stepStatus: 'wrong',
    logicStatus: 'wrong',
    errorType: 'logic_error',
    firstWrongStep: '旧错误',
    errorReason: '旧错误原因',
    adjustmentSuggestion: '请核对',
    overallFeedback: '本题存在问题，需要核对。'
  });
  const normalized = normalizeNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [q] });
  const n = normalized.questions[0];
  assert.equal(n.stepStatus, 'not_required');
  assert.equal(n.logicStatus, 'correct');
  assert.equal(n.errorType, 'none');
  assert.equal(n.firstWrongStep, '');
  assert.equal(n.errorReason, '');
  assert.equal(n.adjustmentSuggestion, '');
  assert.match(n.overallFeedback, /最终答案正确/);
  assert.doesNotThrow(() => validateNewModelResult(normalized));
});

test('zero-step hard-problem aggregates are still contract-checked', () => {
  const q = question('hard-problem.v2');
  Object.assign(q, {
    studentWorkDetected: false,
    stepRequired: true,
    stepFeedbacks: [],
    stepStatus: 'correct',
    logicStatus: 'correct',
    errorType: 'none',
    overallFeedback: '最终答案正确。'
  });
  const issues = collectNewModelResultIssues({ outputSchemaVersion: 'hard-problem.v2', questions: [q] });
  assert.ok(issues.some((item) => item.fieldPath === 'questions[0].stepStatus'));
  assert.ok(issues.some((item) => item.fieldPath === 'questions[0].logicStatus'));
});


test('direct hard-problem model authority skips heuristic re-segmentation but keeps real schema contradictions', () => {
  const q = question('hard-problem.v2');
  q.stepFeedbacks = [{
    stepIndex: 1,
    solutionText: '设x；x+1.4x=1200；2.4x=1200；x=500',
    explanationText: '①设文艺书为x；②文加科等于1200；③求出文艺书的量',
    solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear',
    analysis: '过程与解释均能对应。', correctionAdvice: ''
  }];
  const payload = { outputSchemaVersion: 'hard-problem.v2', questions: [q] };
  const normalIssues = collectNewModelResultIssues(payload, {});
  assert.ok(normalIssues.some((item) => item.fieldPath === 'questions[0].stepFeedbacks'));
  const directIssues = collectNewModelResultIssues(payload, { directHardProblemOutput: true });
  assert.equal(directIssues.some((item) => item.fieldPath === 'questions[0].stepFeedbacks'), false);

  const contradiction = structuredClone(payload);
  contradiction.questions[0].stepFeedbacks[0].explanationStatus = 'missing';
  const contradictionIssues = collectNewModelResultIssues(contradiction, { directHardProblemOutput: true });
  assert.ok(contradictionIssues.some((item) => item.fieldPath === 'questions[0].stepFeedbacks[0].explanationStatus'));
});

test('hard-problem rejects blank sourceKey and questionText before final-result contract validation', () => {
  const blankSource = { outputSchemaVersion: 'hard-problem.v2', questions: [question('hard-problem.v2')] };
  blankSource.questions[0].sourceKey = '   ';
  const sourceIssues = collectNewModelResultIssues(blankSource);
  assert.equal(sourceIssues[0].fieldPath, 'questions[0].sourceKey');
  assert.equal(sourceIssues[0].repairable, false);

  const blankQuestion = { outputSchemaVersion: 'hard-problem.v2', questions: [question('hard-problem.v2')] };
  blankQuestion.questions[0].questionText = '';
  const questionIssues = collectNewModelResultIssues(blankQuestion);
  assert.equal(questionIssues[0].fieldPath, 'questions[0].questionText');
  assert.equal(questionIssues[0].repairable, false);
});

test('inputBasis and studentWorkDetected stay consistent for all v2 schemas', () => {
  for (const version of ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2']) {
    const printedWithout = question(version);
    printedWithout.inputBasis = 'printed_question_without_work';
    printedWithout.studentWorkDetected = true;
    const issuesA = collectNewModelResultIssues({ outputSchemaVersion: version, questions: [printedWithout] });
    assert.ok(issuesA.some((item) => item.code === 'STUDENT_WORK_DETECTION_INPUT_BASIS_MISMATCH' && item.fieldPath === 'questions[0].studentWorkDetected'));

    const withWork = question(version);
    withWork.inputBasis = 'printed_question_with_work';
    withWork.studentWorkDetected = false;
    const issuesB = collectNewModelResultIssues({ outputSchemaVersion: version, questions: [withWork] });
    assert.ok(issuesB.some((item) => item.code === 'STUDENT_WORK_DETECTION_INPUT_BASIS_MISMATCH' && item.fieldPath === 'questions[0].studentWorkDetected'));
  }
});



test('safeError preserves compound calculation work-complete diagnostics when another repairable issue is primary', () => {
  const output = result('calculation-careless.v2');
  output.questions[0].inputBasis = 'work_only_complete';
  output.questions[0].studentWorkDetected = false;
  let validationError;
  try { validateNewModelResult(output); } catch (error) { validationError = error; }
  assert.ok(validationError);
  Object.defineProperty(validationError, 'modelOutput', { value: output });
  const diagnostic = safeError(validationError).schemaValidation;
  assert.equal(diagnostic.issueCode, 'STUDENT_WORK_DETECTION_INPUT_BASIS_MISMATCH');
  assert.equal(diagnostic.workComplete, true);
  assert.deepEqual(diagnostic.emptyOrConflictingFields, ['studentWorkDetected']);
  assert.ok(diagnostic.issues.some((item) => item.code === 'CALCULATION_CARELESS_WORK_COMPLETE_CONSTRAINT'));
});
test('inputBasis/studentWorkDetected mismatch is repairable instead of silently entering downstream results', () => {
  const output = { outputSchemaVersion: 'calculation-careless.v2', questions: [question('calculation-careless.v2')] };
  output.questions[0].inputBasis = 'printed_question_without_work';
  output.questions[0].studentWorkDetected = true;
  let validationError;
  try { validateNewModelResult(output); } catch (error) { validationError = error; }
  assert.ok(validationError);
  validationError.modelOutput = output;
  const plan = repair.prepareModelOutputRepair(validationError);
  assert.ok(plan);
  assert.ok(plan.fieldPaths.includes('questions[0].studentWorkDetected'));
});
