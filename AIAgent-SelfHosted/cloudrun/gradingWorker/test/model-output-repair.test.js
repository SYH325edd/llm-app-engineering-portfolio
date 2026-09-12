'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../runtime/taskWorker-shared/output-schema-registry');
const { validateNewModelResult, collectNewModelResultIssues } = require('../runtime/taskWorker-shared/output-schema-validator');
const repair = require('../runtime/taskWorker-shared/model-output-repair');
const { safeError } = require('../runtime/taskWorker-shared/utils');

const clone = (value) => JSON.parse(JSON.stringify(value));

function runtimeStrategy(schemaId) {
  const schema = registry.getSchema(schemaId);
  return {
    outputSchemaRegistry: { schemas: [{ schemaId, strategyContractKey: 'calculationCarelessV2' }] },
    contracts: { calculationCarelessV2: { requiredFields: [...schema.requiredFields] } },
  };
}

function validCalculationOutput() {
  return {
    outputSchemaVersion: 'calculation-careless.v2',
    mode: 'calculation-careless',
    questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [{
      outputSchemaVersion: 'calculation-careless.v2', sourceKey: 'q-1', questionText: '1 + 1 = ?',
      studentCalculation: '1 + 1 = 2', standardCalculation: '1 + 1 = 2', analysisStatus: 'ok',
      layoutClear: true, digitAlignmentCorrect: true, stepsComplete: true, carryBorrowClear: true,
      processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none',
      carelessIssues: [], methodIssues: [], errorReason: '', firstErrorPoint: '', correctionAdvice: '', confidence: 0.9,
      studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'top',
      inputBasis: 'printed_question_with_work', modeApplicability: 'applicable',
    }],
  };
}

function validMultiQuestionOutput() {
  const output = validCalculationOutput();
  output.route = { confidence: 0.6, decision: 'keep' };
  output.questions.push({ ...clone(output.questions[0]), sourceKey: 'q-2', questionText: '2 + 2 = ?', errorReason: 'original-q2', confidence: 0.8 });
  output.questionSetAudit = { ...output.questionSetAudit, visibleIndependentQuestionCount: 2, emittedQuestionCount: 2 };
  output.questions[0].errorReason = 'original-q1';
  return output;
}

function validHardProblemOutput() {
  return {
    outputSchemaVersion: 'hard-problem.v2',
    questions: [{
      outputSchemaVersion: 'hard-problem.v2', sourceKey: 'hard-q-1', questionText: '题目', studentAnswer: '10', standardAnswer: '10',
      answerStatus: 'answered', finalAnswerCorrect: false, stepRequired: true, stepStatus: 'wrong', logicStatus: 'wrong', errorType: 'multiple',
      firstWrongStep: '第1步', errorReason: '需要逐步检查', adjustmentSuggestion: '逐步订正', knowledgePoint: '', overallFeedback: '请逐步检查每一步。',
      confidence: 0.8, studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'top', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable',
      stepFeedbacks: [{
        stepIndex: 1, solutionText: '1+1=2；2+2=4；4+6=10；10÷2=5', explanationText: '①先算1+1。②再算2+2。③接着相加。④最后除以2。',
        solutionStatus: 'wrong', explanationStatus: 'incorrect', logicStatus: 'wrong', analysis: '多个计算步骤被合并，需要逐步检查。', correctionAdvice: '请逐步写出每次计算。'
      }]
    }]
  };
}

function hardProblemStrategy() {
  const schema = registry.getSchema('hard-problem.v2');
  return {
    outputSchemaRegistry: { schemas: [{ schemaId: 'hard-problem.v2', strategyContractKey: 'hardProblemV2' }] },
    contracts: { hardProblemV2: { requiredFields: [...schema.requiredFields] } },
  };
}

function calculationWorkCompleteValidationError(output, strategy) {
  try {
    validateNewModelResult(output, { strategy });
  } catch (error) {
    Object.defineProperty(error, 'modelOutput', { value: output });
    return error;
  }
  throw new Error('Expected calculation work-complete validation error');
}

test('repairs a Validator-emitted calculation work-complete semantic error with all related fields', () => {
  const strategy = runtimeStrategy('calculation-careless.v2');
  const output = validCalculationOutput();
  output.questions[0].inputBasis = 'work_only_complete';
  output.questions[0].studentWorkDetected = false;
  const validationError = calculationWorkCompleteValidationError(output, strategy);

  assert.equal(validationError.code, 'STUDENT_WORK_DETECTION_INPUT_BASIS_MISMATCH');
  const plan = repair.prepareModelOutputRepair(validationError, strategy);
  assert.ok(plan);
  assert.deepEqual(plan.fieldPaths, [
    'questions[0].studentWorkDetected',
    'questions[0].inputBasis',
    'questions[0].modeApplicability',
    'questions[0].analysisStatus',
  ]);
  const repaired = repair.mergeRepairedOutput(output, { repairs: [
    { fieldPath: 'questions[0].inputBasis', sourceKey: 'q-1', value: 'printed_question_with_work' },
    { fieldPath: 'questions[0].studentWorkDetected', sourceKey: 'q-1', value: true },
    { fieldPath: 'questions[0].modeApplicability', sourceKey: 'q-1', value: 'applicable' },
    { fieldPath: 'questions[0].analysisStatus', sourceKey: 'q-1', value: 'ok' },
  ] }, plan.fields, plan.schema, plan.validationContext);
  assert.doesNotThrow(() => validateNewModelResult(repaired, { strategy }));
});

test('does not repair unknown, empty, or non-repairable error issues', () => {
  const strategy = runtimeStrategy('calculation-careless.v2');
  const output = validCalculationOutput();
  for (const error of [
    { code: 'UNKNOWN_CUSTOM_ERROR', modelOutput: output },
    { code: 'CALCULATION_CARELESS_WORK_COMPLETE_CONSTRAINT', issues: [], modelOutput: output },
    { code: 'CALCULATION_CARELESS_WORK_COMPLETE_CONSTRAINT', issues: [{ code: 'CALCULATION_CARELESS_WORK_COMPLETE_CONSTRAINT', repairable: false }], modelOutput: output },
  ]) assert.equal(repair.prepareModelOutputRepair(error, strategy), null);
});

test('exposes only safe diagnostics for a Validator-emitted calculation semantic error', () => {
  const strategy = runtimeStrategy('calculation-careless.v2');
  const output = validCalculationOutput();
  output.questions[0] = {
    ...output.questions[0],
    questionText: 'private question text',
    studentCalculation: 'private student answer',
    standardCalculation: 'private standard answer',
    inputBasis: 'work_only_complete',
    studentWorkDetected: false,
  };
  const diagnostic = safeError(calculationWorkCompleteValidationError(output, strategy)).schemaValidation;
  assert.ok(diagnostic);
  assert.equal(diagnostic.issueCode, 'STUDENT_WORK_DETECTION_INPUT_BASIS_MISMATCH');
  assert.equal(diagnostic.fieldPath, 'questions[0].studentWorkDetected');
  assert.equal(diagnostic.questionIndex, 0);
  assert.equal(diagnostic.sourceKey, 'q-1');
  assert.equal(diagnostic.validator, 'student-work-input-basis');
  assert.equal(diagnostic.workComplete, true);
  assert.deepEqual(diagnostic.emptyOrConflictingFields, ['studentWorkDetected']);
  const serialized = JSON.stringify(diagnostic);
  for (const secret of ['private question text', 'private student answer', 'private standard answer', 'prompt', 'stack']) assert.doesNotMatch(serialized, new RegExp(secret, 'i'));
});

test('collects base and custom semantic issues before one complete repair plan', () => {
  const strategy = runtimeStrategy('calculation-careless.v2');
  const originalOutput = validMultiQuestionOutput();
  delete originalOutput.questions[0].firstErrorPoint;
  originalOutput.questions[0].inputBasis = 'work_only_complete';
  originalOutput.questions[0].studentWorkDetected = false;
  originalOutput.questions[1].confidence = 1.5;

  let validationError;
  try { validateNewModelResult(originalOutput, { strategy }); }
  catch (error) { validationError = error; }
  assert.ok(validationError);
  Object.defineProperty(validationError, 'modelOutput', { value: originalOutput });
  const issues = collectNewModelResultIssues(originalOutput, { strategy });
  assert.deepEqual(issues.map((issue) => issue.fieldPath), [
    'questions[0].firstErrorPoint',
    'questions[0].studentWorkDetected',
    'questions[0].inputBasis',
    'questions[1].confidence',
  ]);
  const plan = repair.prepareModelOutputRepair(validationError, strategy);
  assert.deepEqual(plan.fieldPaths, [
    'questions[0].firstErrorPoint',
    'questions[0].studentWorkDetected',
    'questions[0].inputBasis',
    'questions[0].modeApplicability',
    'questions[0].analysisStatus',
    'questions[1].confidence',
  ]);
  const merged = repair.mergeRepairedOutput(originalOutput, { repairs: [
    { fieldPath: 'questions[0].firstErrorPoint', sourceKey: 'q-1', value: '' },
    { fieldPath: 'questions[0].inputBasis', sourceKey: 'q-1', value: 'printed_question_with_work' },
    { fieldPath: 'questions[0].studentWorkDetected', sourceKey: 'q-1', value: true },
    { fieldPath: 'questions[0].modeApplicability', sourceKey: 'q-1', value: 'applicable' },
    { fieldPath: 'questions[0].analysisStatus', sourceKey: 'q-1', value: 'ok' },
    { fieldPath: 'questions[1].confidence', sourceKey: 'q-2', value: 0.8 },
  ] }, plan.fields, plan.schema);
  assert.equal(collectNewModelResultIssues(merged, { strategy }).length, 0);
});

test('passes custom semantic constraints and safe enum candidates into one repair plan', () => {
  const strategy = runtimeStrategy('calculation-careless.v2');
  const originalOutput = validCalculationOutput();
  originalOutput.questions[0].inputBasis = 'work_only_complete';
  originalOutput.questions[0].studentWorkDetected = false;
  const plan = repair.prepareModelOutputRepair({ code: 'LLM_SCHEMA_ERROR', modelOutput: originalOutput }, strategy);
  const issue = plan.issues.find((item) => item.fieldPath === 'questions[0].inputBasis');
  const field = plan.fields.find((item) => item.fieldPath === 'questions[0].inputBasis');
  assert.equal(issue.code, 'CALCULATION_CARELESS_WORK_COMPLETE_CONSTRAINT');
  assert.equal(issue.validator, 'calculation-careless-applicability');
  assert.deepEqual(issue.relatedFieldPaths, [
    'questions[0].studentWorkDetected',
    'questions[0].modeApplicability',
    'questions[0].analysisStatus',
  ]);
  assert.match(issue.semanticConstraint, /studentWorkDetected/);
  assert.equal(issue.repairable, true);
  assert.deepEqual(field.validCandidateValues, ['printed_question_with_work', 'printed_question_without_work']);
  assert.equal(field.issueCode, issue.code);
  const instructions = repair.modelOutputRepairInstructions({ ...plan, originalRawResponse: '{}', originalRequest: {} });
  for (const key of ['issueCode', 'semanticConstraint', 'relatedFieldPaths', 'validCandidateValues']) assert.match(instructions.userPrompt, new RegExp(key));
  const merged = repair.mergeRepairedOutput(originalOutput, { repairs: [
    { fieldPath: field.fieldPath, sourceKey: 'q-1', value: 'printed_question_with_work' },
    { fieldPath: 'questions[0].studentWorkDetected', sourceKey: 'q-1', value: true },
    { fieldPath: 'questions[0].modeApplicability', sourceKey: 'q-1', value: 'applicable' },
    { fieldPath: 'questions[0].analysisStatus', sourceKey: 'q-1', value: 'ok' },
  ] }, plan.fields, plan.schema, plan.validationContext);
  assert.equal(collectNewModelResultIssues(merged, { strategy }).length, 0);
});

test('rebuilds a four-step fixed REVIEW array from a two-step merged model result', () => {
  const strategy = hardProblemStrategy();
  const output = validHardProblemOutput();
  const fixedEvidenceQuestions = [{
    sourceKey: 'hard-q-1',
    fixedSteps: [
      { stepIndex: 1, solutionText: '1+1=2', explanationText: '先算第一部分。' },
      { stepIndex: 2, solutionText: '2+2=4', explanationText: '' },
      { stepIndex: 3, solutionText: '4+6=10', explanationText: '再合并结果。' },
      { stepIndex: 4, solutionText: '10÷2=5', explanationText: '' },
    ]
  }];
  const plan = repair.prepareModelOutputRepair({ code: 'LLM_SCHEMA_ERROR', modelOutput: output }, strategy);
  assert.deepEqual(plan.fieldPaths, ['questions[0].stepFeedbacks']);
  const instructions = repair.modelOutputRepairInstructions({ ...plan, originalRawResponse: '{}', originalRequest: { fixedEvidenceQuestions } });
  assert.match(instructions.userPrompt, /fixedEvidenceQuestions/);
  assert.match(instructions.userPrompt, /"expectedStepCount":4/);
  const rebuilt = fixedEvidenceQuestions[0].fixedSteps.map((fixedStep, index) => ({
    stepIndex: index + 1,
    solutionText: fixedStep.solutionText,
    explanationText: fixedStep.explanationText,
    solutionStatus: 'wrong',
    explanationStatus: fixedStep.explanationText ? 'incorrect' : 'missing',
    logicStatus: 'wrong',
    analysis: `第${index + 1}步需要订正。`,
    correctionAdvice: '请按固定步骤逐步订正。'
  }));
  const merged = repair.mergeRepairedOutput(output, { repairs: [{ fieldPath: 'questions[0].stepFeedbacks', sourceKey: 'hard-q-1', value: rebuilt }] }, plan.fields, plan.schema, plan.validationContext);
  assert.equal(merged.questions[0].stepFeedbacks.length, 4);
  assert.deepEqual(merged.questions[0].stepFeedbacks.map((step) => step.stepIndex), [1, 2, 3, 4]);
  assert.deepEqual(merged.questions[0].stepFeedbacks.map((step) => step.solutionText), fixedEvidenceQuestions[0].fixedSteps.map((step) => step.solutionText));
  assert.doesNotThrow(() => validateNewModelResult(merged, { strategy }));
});

test('rejects semantically ineffective or newly-invalid patches without mutating the original result', () => {
  const strategy = runtimeStrategy('calculation-careless.v2');
  const semanticOutput = validCalculationOutput();
  semanticOutput.questions[0].issueCategory = 'careless';
  const semanticPlan = repair.prepareModelOutputRepair({ code: 'LLM_SCHEMA_ERROR', modelOutput: semanticOutput }, strategy);
  const semanticBefore = clone(semanticOutput);
  assert.throws(() => repair.mergeRepairedOutput(semanticOutput, { repairs: [{ fieldPath: 'questions[0].issueCategory', sourceKey: 'q-1', value: 'careless' }] }, semanticPlan.fields, semanticPlan.schema, semanticPlan.validationContext), (error) => error.failureReason === 'REPAIR_NO_EFFECT');
  assert.deepEqual(semanticOutput, semanticBefore);
  assert.throws(() => repair.mergeRepairedOutput(semanticOutput, { repairs: [{ fieldPath: 'questions[0].issueCategory', sourceKey: 'q-1', value: 'knowledge_or_method' }] }, semanticPlan.fields, semanticPlan.schema, semanticPlan.validationContext), (error) => error.failureReason === 'REPAIR_SEMANTIC_CONSTRAINT_UNRESOLVED');
  assert.deepEqual(semanticOutput, semanticBefore);

  const customOutput = validCalculationOutput();
  customOutput.questions[0].inputBasis = 'work_only_complete';
  customOutput.questions[0].studentWorkDetected = false;
  const customPlan = repair.prepareModelOutputRepair({ code: 'LLM_SCHEMA_ERROR', modelOutput: customOutput }, strategy);
  const customBefore = clone(customOutput);
  assert.throws(() => repair.mergeRepairedOutput(customOutput, { repairs: [
    { fieldPath: 'questions[0].inputBasis', sourceKey: 'q-1', value: 'work_only_incomplete' },
    { fieldPath: 'questions[0].studentWorkDetected', sourceKey: 'q-1', value: true },
    { fieldPath: 'questions[0].modeApplicability', sourceKey: 'q-1', value: 'applicable' },
    { fieldPath: 'questions[0].analysisStatus', sourceKey: 'q-1', value: 'ok' },
  ] }, customPlan.fields, customPlan.schema, customPlan.validationContext), (error) => error.failureReason === 'REPAIR_INTRODUCED_NEW_ISSUE');
  assert.deepEqual(customOutput, customBefore);
});

test('blocks repair when a non-repairable sourceKey identity issue is collected', () => {
  const strategy = runtimeStrategy('calculation-careless.v2');
  const originalOutput = validMultiQuestionOutput();
  delete originalOutput.questions[0].firstErrorPoint;
  originalOutput.questions[1].sourceKey = 'q-1';
  const before = clone(originalOutput);
  let validationError;
  try { validateNewModelResult(originalOutput, { strategy }); }
  catch (error) { validationError = error; }
  Object.defineProperty(validationError, 'modelOutput', { value: originalOutput });
  const issues = collectNewModelResultIssues(originalOutput, { strategy });
  assert.equal(issues.some((item) => item.fieldPath === 'questions[0].firstErrorPoint' && item.repairable), true);
  assert.equal(issues.some((item) => item.code === 'QUESTION_SOURCE_KEY_DUPLICATE' && item.repairable === false), true);
  assert.equal(repair.prepareModelOutputRepair(validationError, strategy), null);
  assert.deepEqual(originalOutput, before);
});

test('repairs missing firstErrorPoint and evidence fields using the complete runtime schema', () => {
  const strategy = runtimeStrategy('calculation-careless.v2');
  const originalOutput = validCalculationOutput();
  delete originalOutput.questions[0].firstErrorPoint;
  delete originalOutput.questions[0].inputBasis;
  delete originalOutput.questions[0].modeApplicability;
  const plan = repair.prepareModelOutputRepair({ code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[0].firstErrorPoint', modelOutput: originalOutput }, strategy);
  assert.deepEqual(plan.fieldPaths, ['questions[0].firstErrorPoint', 'questions[0].inputBasis', 'questions[0].modeApplicability']);
  assert.deepEqual(plan.fields.map(({ fieldPath, expectedType, nullable, allowedEnums, numericMinimum, numericMaximum, questionIndex, expectedSourceKey, originalValidationReason }) => ({ fieldPath, expectedType, nullable, allowedEnums, numericMinimum, numericMaximum, questionIndex, expectedSourceKey, originalValidationReason })), [
    { fieldPath: 'questions[0].firstErrorPoint', expectedType: 'string', nullable: false, allowedEnums: null, numericMinimum: null, numericMaximum: null, questionIndex: 0, expectedSourceKey: 'q-1', originalValidationReason: 'missing required field' },
    { fieldPath: 'questions[0].inputBasis', expectedType: 'string', nullable: false, allowedEnums: ['printed_question_with_work', 'printed_question_without_work', 'work_only_complete', 'work_only_incomplete'], numericMinimum: null, numericMaximum: null, questionIndex: 0, expectedSourceKey: 'q-1', originalValidationReason: 'missing required field' },
    { fieldPath: 'questions[0].modeApplicability', expectedType: 'string', nullable: false, allowedEnums: ['applicable', 'not_applicable', 'uncertain'], numericMinimum: null, numericMaximum: null, questionIndex: 0, expectedSourceKey: 'q-1', originalValidationReason: 'missing required field' },
  ]);
  const instructions = repair.modelOutputRepairInstructions({ ...plan, originalRawResponse: JSON.stringify(originalOutput), originalRequest: { systemPrompt: 'original system', userPrompt: 'original user' } });
  for (const key of ['requiredFields', 'fieldTypes', 'enumFields', 'nullableFields', 'numericRanges', 'consistencyRules']) assert.match(instructions.userPrompt, new RegExp(key));
  assert.match(instructions.userPrompt, /original system/);
  assert.match(instructions.userPrompt, /original user/);
  const repairedOutput = { repairs: [
    { fieldPath: 'questions[0].firstErrorPoint', sourceKey: 'q-1', value: '' },
    { fieldPath: 'questions[0].inputBasis', sourceKey: 'q-1', value: 'printed_question_with_work' },
    { fieldPath: 'questions[0].modeApplicability', sourceKey: 'q-1', value: 'applicable' },
  ] };
  const merged = repair.mergeRepairedOutput(originalOutput, repairedOutput, plan.fields, plan.schema);
  assert.doesNotThrow(() => validateNewModelResult(merged, { strategy }));
});

test('collects consistency-rule violations for generic repair', () => {
  const output = validCalculationOutput();
  output.questions[0].issueCategory = 'careless';
  const plan = repair.prepareModelOutputRepair({ code: 'LLM_SCHEMA_ERROR', fieldPath: 'questions[0].issueCategory', modelOutput: output }, runtimeStrategy('calculation-careless.v2'));
  assert.ok(plan.fieldPaths.includes('questions[0].issueCategory'));
});

test('deterministically merges only repair fields and rejects changed question identity', () => {
  const originalOutput = validCalculationOutput();
  delete originalOutput.questions[0].firstErrorPoint;
  const fields = [{ fieldPath: 'questions[0].firstErrorPoint', reason: 'missing required field' }];
  const repairedOutput = { repairs: [{ fieldPath: 'questions[0].firstErrorPoint', sourceKey: 'q-1', value: '' }] };
  const merged = repair.mergeRepairedOutput(originalOutput, repairedOutput, fields, registry.getSchema('calculation-careless.v2'));
  assert.equal(merged.questions[0].errorReason, '');
  assert.throws(() => repair.mergeRepairedOutput(originalOutput, { repairs: [{ ...repairedOutput.repairs[0], sourceKey: 'q-2' }] }, fields, registry.getSchema('calculation-careless.v2')), /sourceKey/);
  assert.throws(() => repair.mergeRepairedOutput(originalOutput, { repairs: [] }, fields, registry.getSchema('calculation-careless.v2')), (error) => error.code === 'LLM_SCHEMA_REPAIR_FAILED');
  assert.throws(() => repair.mergeRepairedOutput(originalOutput, { repairs: [repairedOutput.repairs[0], repairedOutput.repairs[0]] }, fields, registry.getSchema('calculation-careless.v2')), (error) => error.code === 'LLM_SCHEMA_REPAIR_FAILED');
  assert.throws(() => repair.mergeRepairedOutput(originalOutput, { repairs: [{ ...repairedOutput.repairs[0], fieldPath: 'questions[0].errorReason' }] }, fields, registry.getSchema('calculation-careless.v2')), /field path/);
  const enumFields = [{ fieldPath: 'questions[0].modeApplicability', reason: 'invalid enum' }];
  assert.throws(() => repair.mergeRepairedOutput(originalOutput, { repairs: [{ fieldPath: 'questions[0].modeApplicability', sourceKey: 'q-1', value: 'invalid' }] }, enumFields, registry.getSchema('calculation-careless.v2')), /enum/);
  const inconsistent = validCalculationOutput();
  inconsistent.questions[0].issueCategory = 'careless';
  assert.throws(() => validateNewModelResult(repair.mergeRepairedOutput(inconsistent, { repairs: [{ fieldPath: 'questions[0].issueCategory', sourceKey: 'q-1', value: 'careless' }] }, [{ fieldPath: 'questions[0].issueCategory', reason: 'consistency' }], registry.getSchema('calculation-careless.v2'))), /Consistency violation/);
});

test('applies only authorized leaf patches while preserving the complete result', () => {
  const originalOutput = validMultiQuestionOutput();
  const before = clone(originalOutput);
  const fields = [
    { fieldPath: 'questions[0].errorReason', reason: 'invalid value' },
    { fieldPath: 'questions[1].confidence', reason: 'invalid value' },
    { fieldPath: 'route.confidence', reason: 'invalid value' },
  ];
  const repairedOutput = { repairs: [
    { fieldPath: 'questions[1].confidence', sourceKey: 'q-2', value: 0.2 },
    { fieldPath: 'questions[0].errorReason', sourceKey: 'q-1', value: 'patched-q1' },
    { fieldPath: 'route.confidence', value: 0.9 },
  ] };

  const schema = { ...registry.getSchema('calculation-careless.v2'), topLevelFieldTypes: { 'route.confidence': 'number' } };
  const merged = repair.mergeRepairedOutput(originalOutput, repairedOutput, fields, schema);
  assert.equal(merged.questions[0].errorReason, 'patched-q1');
  assert.equal(merged.questions[1].confidence, 0.2);
  assert.deepEqual(merged.questions.map((question) => question.sourceKey), ['q-1', 'q-2']);
  assert.deepEqual(merged.questions.map((question) => question.questionText), before.questions.map((question) => question.questionText));
  assert.deepEqual(merged.route, { confidence: 0.9, decision: 'keep' });
  assert.deepEqual(originalOutput, before);
  assert.doesNotThrow(() => validateNewModelResult(merged, { strategy: runtimeStrategy('calculation-careless.v2') }));
});

test('ignores unrequested repair payload fields without replacing questions or changing identities', () => {
  const originalOutput = validMultiQuestionOutput();
  const fields = [{ fieldPath: 'questions[1].errorReason', reason: 'invalid value' }];
  const repairedOutput = {
    repairs: [
      { fieldPath: 'questions[1].errorReason', sourceKey: 'q-2', value: 'patched-q2' },
      { fieldPath: 'questions[0].sourceKey', sourceKey: 'q-1', value: 'attacker-key' },
    ],
    questions: [{ sourceKey: 'q-2', errorReason: 'wrong-question', questionText: 'replacement' }],
    route: { confidence: 0 },
  };

  const merged = repair.mergeRepairedOutput(originalOutput, repairedOutput, fields, registry.getSchema('calculation-careless.v2'));
  assert.equal(merged.questions[1].errorReason, 'patched-q2');
  assert.deepEqual(merged.questions, originalOutput.questions.map((question, index) => index === 1 ? { ...question, errorReason: 'patched-q2' } : question));
  assert.deepEqual(merged.route, originalOutput.route);
  assert.deepEqual(merged.questions.map((question) => question.sourceKey), ['q-1', 'q-2']);
});

test('rejects invalid or incomplete authorized patches atomically', () => {
  const originalOutput = validMultiQuestionOutput();
  const before = clone(originalOutput);
  const fields = [
    { fieldPath: 'questions[0].errorReason', reason: 'invalid value' },
    { fieldPath: 'questions[1].confidence', reason: 'invalid value' },
  ];
  const schema = registry.getSchema('calculation-careless.v2');
  for (const repairedOutput of [
    { repairs: [{ fieldPath: 'questions[0].errorReason', sourceKey: 'q-1', value: 'patched' }] },
    { repairs: [{ fieldPath: 'questions[0].errorReason', sourceKey: 'q-1', value: 'patched' }, { fieldPath: 'questions[1].confidence', sourceKey: 'q-2', value: 'invalid' }] },
    { repairs: [{ fieldPath: 'questions[0].missingField', sourceKey: 'q-1', value: 'patched' }, { fieldPath: 'questions[1].confidence', sourceKey: 'q-2', value: 0.2 }] },
    { repairs: [{ fieldPath: 'questions[0].errorReason', sourceKey: 'q-2', value: 'patched' }, { fieldPath: 'questions[1].confidence', sourceKey: 'q-2', value: 0.2 }] },
  ]) {
    assert.throws(() => repair.mergeRepairedOutput(originalOutput, repairedOutput, fields, schema), (error) => error.code === 'LLM_SCHEMA_REPAIR_FAILED' && error.repairFailureStage === 'REPAIR_PATCH_VALIDATION');
    assert.deepEqual(originalOutput, before);
  }
  const duplicateSourceKeys = clone(originalOutput);
  duplicateSourceKeys.questions[1].sourceKey = 'q-1';
  assert.throws(() => repair.mergeRepairedOutput(duplicateSourceKeys, { repairs: [
    { fieldPath: 'questions[0].errorReason', sourceKey: 'q-1', value: 'patched' },
    { fieldPath: 'questions[1].confidence', sourceKey: 'q-1', value: 0.2 },
  ] }, fields, schema), (error) => error.code === 'LLM_SCHEMA_REPAIR_FAILED' && error.repairFailureStage === 'REPAIR_PATCH_VALIDATION');
  assert.deepEqual(originalOutput, before);
});

test('safely normalizes authorized patch values from deterministic container forms', () => {
  const originalOutput = validCalculationOutput();
  const fields = [
    { fieldPath: 'questions[0].errorReason', reason: 'invalid type' },
    { fieldPath: 'questions[0].carelessIssues', reason: 'invalid type' },
    { fieldPath: 'questions[0].confidence', reason: 'invalid type' },
    { fieldPath: 'questions[0].processCorrect', reason: 'invalid type' },
    { fieldPath: 'questions[0].issueCategory', reason: 'invalid enum' },
  ];
  const merged = repair.mergeRepairedOutput(originalOutput, { repairs: [
    { fieldPath: 'questions[0].errorReason', value: ['first line', 'second line'] },
    { fieldPath: 'questions[0].carelessIssues', value: 'careless-step' },
    { fieldPath: 'questions[0].confidence', value: '0.8' },
    { fieldPath: 'questions[0].processCorrect', value: 'true' },
    { fieldPath: 'questions[0].issueCategory', value: ' none ' },
  ] }, fields, registry.getSchema('calculation-careless.v2'));
  assert.equal(merged.questions[0].errorReason, 'first line\nsecond line');
  assert.deepEqual(merged.questions[0].carelessIssues, ['careless-step']);
  assert.equal(merged.questions[0].confidence, 0.8);
  assert.equal(merged.questions[0].processCorrect, true);
  assert.equal(merged.questions[0].issueCategory, 'none');
  assert.doesNotThrow(() => validateNewModelResult(merged, { strategy: runtimeStrategy('calculation-careless.v2') }));
});

test('rejects unsafe patch values with a precise failure reason and no writes', () => {
  const originalOutput = validCalculationOutput();
  const before = clone(originalOutput);
  const cases = [
    [{ fieldPath: 'questions[0].errorReason', value: { text: 'not safe' } }, 'INVALID_VALUE_TYPE'],
    [{ fieldPath: 'questions[0].issueCategory', value: ' unknown ' }, 'INVALID_ENUM_VALUE'],
    [{ fieldPath: 'questions[0].confidence', value: '1.2' }, 'INVALID_NUMERIC_RANGE'],
    [{ fieldPath: 'questions[0].processCorrect', value: null }, 'NULL_NOT_ALLOWED'],
  ];
  for (const [repairItem, failureReason] of cases) {
    assert.throws(() => repair.mergeRepairedOutput(originalOutput, { repairs: [repairItem] }, [{ fieldPath: repairItem.fieldPath, reason: 'invalid' }], registry.getSchema('calculation-careless.v2')), (error) => error.code === 'LLM_SCHEMA_REPAIR_FAILED' && error.failureReason === failureReason);
    assert.deepEqual(originalOutput, before);
  }
});

test('keeps multi-question repairs atomic when one reordered patch cannot be normalized', () => {
  const originalOutput = validMultiQuestionOutput();
  const before = clone(originalOutput);
  const fields = [
    { fieldPath: 'questions[0].errorReason', reason: 'invalid type' },
    { fieldPath: 'questions[1].confidence', reason: 'invalid type' },
  ];
  assert.throws(() => repair.mergeRepairedOutput(originalOutput, { repairs: [
    { fieldPath: 'questions[1].confidence', value: 'not-a-number' },
    { fieldPath: 'questions[0].errorReason', value: ['safe', 'but not committed'] },
  ] }, fields, registry.getSchema('calculation-careless.v2')), (error) => error.code === 'LLM_SCHEMA_REPAIR_FAILED' && error.failureReason === 'INVALID_NUMERIC_VALUE');
  assert.deepEqual(originalOutput, before);
  assert.deepEqual(originalOutput.questions.map((question) => question.sourceKey), ['q-1', 'q-2']);
});
