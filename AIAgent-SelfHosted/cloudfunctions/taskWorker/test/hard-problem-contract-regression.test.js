'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGradingRuntime } = require('../shared/grading-core/execute-grading-task');
const {
  normalizeNewModelResult,
  validateNewModelResult,
  deriveHardProblemAggregateState,
  deriveHardProblemEvaluationStatus,
  validateFinalResultContract,
} = require('../shared/output-schema-validator');
const { validateHardProblemResult } = require('../shared/json');

const runtime = createGradingRuntime({
  json: require('../shared/json'),
  embedded: { decryptEmbeddedStrategy: () => ({}) },
}).test;

const SOLUTION = ['correct', 'wrong', 'missing', 'unreadable'];
const EXPLANATION = ['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable'];
const LOGIC = ['clear', 'insufficient', 'wrong', 'unreadable'];
const STATES = SOLUTION.flatMap((solutionStatus) => EXPLANATION.flatMap((explanationStatus) => LOGIC.map((logicStatus) => [solutionStatus, explanationStatus, logicStatus])));

function step([solutionStatus, explanationStatus, logicStatus], index) {
  const fullyClear = solutionStatus === 'correct' && explanationStatus === 'clear' && logicStatus === 'clear';
  return {
    stepIndex: index + 1,
    solutionText: ['missing', 'unreadable'].includes(solutionStatus) ? '' : `算式${index + 1}`,
    explanationText: ['missing', 'unreadable'].includes(explanationStatus) ? '' : `讲解${index + 1}`,
    solutionStatus,
    explanationStatus,
    logicStatus,
    analysis: fullyClear ? '该步解题过程、讲解和逻辑均正确。' : '该步需要根据当前状态补充或订正。',
    correctionAdvice: fullyClear ? '' : '请根据本步状态补充或订正。',
  };
}

function question(states) {
  return {
    outputSchemaVersion: 'hard-problem.v2',
    sourceKey: 'Q1',
    questionText: '题目',
    studentAnswer: '答案',
    standardAnswer: '标准答案',
    answerStatus: 'answered',
    finalAnswerCorrect: true,
    stepRequired: true,
    stepStatus: 'correct',
    logicStatus: 'correct',
    errorType: 'none',
    firstWrongStep: '',
    errorReason: '',
    adjustmentSuggestion: '',
    knowledgePoint: '',
    overallFeedback: '当前结果待系统聚合。',
    confidence: 1,
    studentWorkDetected: true,
    sourceQuestionLabel: '1',
    sourceRegion: 'page-1',
    inputBasis: 'printed_question_with_work',
    modeApplicability: 'applicable',
    stepFeedbacks: states.map(step),
  };
}

function fullPayload(q) {
  return {
    outputSchemaVersion: 'hard-problem.v2',
    mode: 'hard-problem',
    route: { difficulty: 'normal', confidence: 1, flags: [] },
    imageQuality: { ok: true, issues: [] },
    questionSetAudit: { visibleIndependentQuestionCount: 1, emittedQuestionCount: 1, excludedQuestionCount: 0, orientation: 'upright', countConfidence: 1 },
    questions: [q],
  };
}

test('hard-problem aggregate producers round-trip every one-step and two-step state combination', () => {
  let checked = 0;
  const check = (states) => {
    const raw = question(states);
    const fixed = runtime.normalizeFixedHardProblemAggregates(fullPayload(raw));
    assert.doesNotThrow(() => validateHardProblemResult(fixed));
    const normalized = normalizeNewModelResult({ outputSchemaVersion: 'hard-problem.v2', questions: [raw] });
    assert.doesNotThrow(() => validateNewModelResult(normalized));
    checked += 1;
  };
  for (const first of STATES) check([first]);
  for (const first of STATES) for (const second of STATES) check([first, second]);
  assert.equal(checked, 6480);
});

test('hard-problem aggregate precedence is deterministic at unreadable and no-step boundaries', () => {
  assert.deepEqual(
    deriveHardProblemAggregateState({ answerStatus: 'unreadable', stepRequired: false }, []),
    {
      fullyClear: false,
      stepStatus: 'not_required',
      logicStatus: 'unreadable',
      hasSolutionMissing: false,
      hasSolutionUnreadable: false,
      hasSolutionWrong: false,
      hasLogicWrong: false,
      hasLogicUnreadable: false,
      hasLogicInsufficient: false,
    },
  );
  assert.equal(deriveHardProblemAggregateState({ answerStatus: 'answered', stepRequired: false }, []).stepStatus, 'not_required');
  assert.equal(deriveHardProblemAggregateState({ answerStatus: 'answered', stepRequired: false }, []).logicStatus, 'correct');
  assert.equal(deriveHardProblemEvaluationStatus({ answerStatus: 'answered', finalAnswerCorrect: true, stepRequired: true, stepStatus: 'unreadable', logicStatus: 'unreadable' }), 'UNREADABLE');
  assert.equal(deriveHardProblemEvaluationStatus({ answerStatus: 'answered', finalAnswerCorrect: false, stepRequired: true, stepStatus: 'unreadable', logicStatus: 'unreadable' }), 'WRONG');
});

test('hard-problem final summary uses the same outcome semantics as evaluationStatus', () => {
  const mk = (sourceKey, patch) => ({
    outputSchemaVersion: 'hard-problem.v2', sourceKey, questionText: '题目', studentAnswer: '答案', standardAnswer: '标准答案',
    answerStatus: 'answered', finalAnswerCorrect: true, stepRequired: true, stepStatus: 'correct', logicStatus: 'correct', errorType: 'none',
    firstWrongStep: '', errorReason: '', adjustmentSuggestion: '', knowledgePoint: '', overallFeedback: '结果', confidence: 1,
    studentWorkDetected: true, sourceQuestionLabel: sourceKey, sourceRegion: 'page-1', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable', stepFeedbacks: [],
    ...patch,
  });
  const result = validateFinalResultContract({
    finalResult: {
      outputSchemaVersion: 'hard-problem.v2',
      questions: [
        mk('correct', {}),
        mk('missing-explanation', { stepStatus: 'wrong', logicStatus: 'insufficient', errorType: 'logic_error' }),
        mk('partial-unreadable', { stepStatus: 'unreadable', logicStatus: 'unreadable', errorType: 'unreadable' }),
        mk('wrong-answer', { finalAnswerCorrect: false, stepStatus: 'unreadable', logicStatus: 'unreadable', errorType: 'answer_error' }),
      ],
      summary: {},
    },
  });
  assert.deepEqual(result.summary, { totalCount: 4, correctCount: 1, wrongCount: 2, incompleteCount: 1, carelessCount: 0 });
});

test('teacher override is authoritative for downstream hard-problem semantics without rewriting AI evidence', () => {
  const { normalizeDownstreamSemantics } = require('../shared/result-semantics');
  const aiWrongTeacherCorrect = normalizeDownstreamSemantics({
    outputSchemaVersion: 'hard-problem.v2', sourceKey: 'teacher-correct', evaluationStatus: 'WRONG', errorType: 'logic_error',
    teacherOverrideApplied: true, teacherOverrideStatus: 'CORRECT',
  });
  assert.equal(aiWrongTeacherCorrect.normalizedStatus, 'CORRECT');
  assert.equal(aiWrongTeacherCorrect.checkinEligible, true);
  assert.equal(aiWrongTeacherCorrect.wrongQuestionDisposition, 'SKIP');
  const aiCorrectTeacherWrong = normalizeDownstreamSemantics({
    outputSchemaVersion: 'hard-problem.v2', sourceKey: 'teacher-wrong', evaluationStatus: 'CORRECT', errorType: 'none',
    teacherOverrideApplied: true, teacherOverrideStatus: 'WRONG',
  });
  assert.equal(aiCorrectTeacherWrong.normalizedStatus, 'WRONG');
  assert.equal(aiCorrectTeacherWrong.checkinEligible, false);
  assert.equal(aiCorrectTeacherWrong.wrongQuestionDisposition, 'CREATE');
});


test('hard-problem runtime resolves the legacy unreadable/no-step contract intersection without an impossible stepStatus', () => {
  const legacyStrategy = {
    outputSchemaRegistry: { schemas: [{ schemaId: 'hard-problem.v2', strategyContractKey: 'hardProblemV2' }] },
    contracts: {
      hardProblemV2: {
        consistencyRules: [
          { when: { answerStatus: 'unreadable' }, require: { finalAnswerCorrect: null, stepStatus: 'unreadable', logicStatus: 'unreadable', errorType: 'unreadable' } },
          { when: { stepRequired: false }, require: { stepStatus: 'not_required' } },
        ],
      },
    },
  };
  const q = {
    ...question([]),
    answerStatus: 'unreadable',
    finalAnswerCorrect: null,
    stepRequired: false,
    stepFeedbacks: [],
    stepStatus: 'not_required',
    logicStatus: 'unreadable',
    errorType: 'unreadable',
    studentAnswer: '',
    standardAnswer: '',
    overallFeedback: '图片中的关键作答内容无法辨认，需要重新拍摄。',
  };
  assert.doesNotThrow(() => validateNewModelResult(fullPayload(q), { strategy: legacyStrategy }));
});
