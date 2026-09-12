'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const taskWorkerRoot = path.resolve(__dirname, '../cloudfunctions/taskWorker');
const { createGradingRuntime } = require(path.join(taskWorkerRoot, 'shared/grading-core/execute-grading-task'));
const { validateHardProblemResult } = require(path.join(taskWorkerRoot, 'shared/json'));

const runtime = createGradingRuntime({
  json: require(path.join(taskWorkerRoot, 'shared/json')),
  embedded: { decryptEmbeddedStrategy: () => ({}) }
}).test;

function evidenceQuestion(index, variant) {
  const sourceKey = `stress-q-${index + 1}`;
  const common = {
    sourceKey,
    questionText: variant === 'books' ? '科技书是文艺书的1.4倍，两类书共1200本。' : '牛吃草问题。',
    studentAnswer: variant === 'books' ? '文艺书500本，科技书700本' : '最多5头牛',
    studentWorkDetected: true,
    sourceQuestionLabel: `${index + 1}`,
    sourceRegion: `image-1:q-${index + 1}`,
    inputBasis: 'printed_question_with_work',
    modeApplicability: 'applicable',
    confidence: 0.98,
    warnings: []
  };

  if (variant === 'books') {
    return {
      ...common,
      layoutType: 'left_right',
      processUnits: [
        { unitId: 'P1', text: '设文艺书有x本', order: 1, role: 'setup', visualBand: 1, readability: 'readable' },
        { unitId: 'P2', text: 'x+1.4x=1200', order: 2, role: 'equation', visualBand: 2, readability: 'readable' },
        { unitId: 'P3', text: '2.4x=1200', order: 3, role: 'calculation', visualBand: 3, readability: 'readable' },
        { unitId: 'P4', text: 'x=500', order: 4, role: 'intermediate_result', visualBand: 3, readability: 'readable' },
        { unitId: 'P5', text: '1200-500=700本', order: 5, role: 'final_result', visualBand: 4, readability: 'readable' },
        { unitId: 'P6', text: '答：文艺书500本，科技书700本', order: 6, role: 'answer_text', visualBand: 4, readability: 'readable' }
      ],
      explanationUnits: [
        { unitId: 'E1', text: '先设文艺书为x本。', order: 1, label: '①', visualBand: 1, readability: 'readable' },
        { unitId: 'E2', text: '根据总数列方程。', order: 2, label: '②', visualBand: 2, readability: 'readable' },
        { unitId: 'E3', text: '解方程求出文艺书数量。', order: 3, label: '③', visualBand: 3, readability: 'readable' },
        { unitId: 'E4', text: '总数减文艺书得到科技书。', order: 4, label: '④', visualBand: 4, readability: 'readable' }
      ]
    };
  }

  if (variant === 'missing-bands') {
    return {
      ...common,
      layoutType: 'top_bottom',
      processUnits: [
        { unitId: 'P1', text: '(20×8-12×10)÷(20-12)', order: 1, role: 'equation', visualBand: null, readability: 'readable' },
        { unitId: 'P2', text: '=40÷8\n=5份', order: 2, role: 'final_result', visualBand: null, readability: 'readable' }
      ],
      explanationUnits: [
        { unitId: 'E1', text: '先求草量差和天数差。', order: 1, label: '①', visualBand: null, readability: 'readable' },
        { unitId: 'E2', text: '再用草量差除以天数差。', order: 2, label: '②', visualBand: null, readability: 'readable' }
      ]
    };
  }

  return {
    ...common,
    layoutType: 'top_bottom',
    processUnits: [
      { unitId: 'P1', text: '设每头牛每天吃1份草', order: 1, role: 'setup', visualBand: 1, readability: 'readable' },
      { unitId: 'P2', text: '(20×8-12×10)÷(20-12)', order: 2, role: 'equation', visualBand: 2, readability: 'readable' },
      { unitId: 'P3', text: '=40÷8', order: 3, role: 'intermediate_result', visualBand: 3, readability: 'readable' },
      { unitId: 'P4', text: '=5份', order: 4, role: 'final_result', visualBand: 4, readability: 'readable' }
    ],
    explanationUnits: [
      { unitId: 'E1', text: '先统一每头牛每天吃草的单位。', order: 1, label: '①', visualBand: 1, readability: 'readable' },
      { unitId: 'E2', text: '用两种吃法求草量差和天数差。', order: 2, label: '②', visualBand: 2, readability: 'readable' },
      { unitId: 'E3', text: '草量差除以天数差得到每天长草量。', order: 3, label: '③', visualBand: 3, readability: 'readable' },
      { unitId: 'E4', text: '每天长5份草，所以最多养5头牛。', order: 4, label: '④', visualBand: 4, readability: 'readable' }
    ]
  };
}

function evidencePayload(question) {
  return {
    outputSchemaVersion: 'hard-problem-evidence.v1',
    layoutType: question.layoutType,
    questions: [question]
  };
}

function validStep(step) {
  return {
    stepIndex: step.stepIndex,
    solutionText: step.solutionText,
    explanationText: step.explanationText,
    solutionStatus: 'correct',
    explanationStatus: 'clear',
    logicStatus: 'clear',
    analysis: '思路：本步目的明确；公式/知识点：使用正确；逻辑：前后衔接清楚。',
    correctionAdvice: ''
  };
}

function validQuestion(alignedQuestion) {
  return {
    outputSchemaVersion: 'hard-problem.v2',
    sourceKey: alignedQuestion.sourceKey,
    questionText: alignedQuestion.questionText,
    studentAnswer: alignedQuestion.studentAnswer,
    standardAnswer: alignedQuestion.studentAnswer,
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
    stepFeedbacks: alignedQuestion.pairedSteps.map(validStep),
    overallFeedback: '答案、每一步过程、讲解和逻辑均清楚。',
    confidence: 0.99,
    studentWorkDetected: alignedQuestion.studentWorkDetected,
    sourceQuestionLabel: alignedQuestion.sourceQuestionLabel,
    sourceRegion: alignedQuestion.sourceRegion,
    inputBasis: alignedQuestion.inputBasis,
    modeApplicability: alignedQuestion.modeApplicability
  };
}

function payload(questions) {
  return {
    outputSchemaVersion: 'hard-problem.v2',
    mode: 'hard-problem',
    route: { difficulty: 'normal', confidence: 0.9, flags: [] },
    imageQuality: { ok: true, issues: [] },
    questionSetAudit: {
      visibleIndependentQuestionCount: questions.length,
      emittedQuestionCount: questions.length,
      excludedQuestionCount: 0,
      orientation: 'upright',
      countConfidence: 1
    },
    questions
  };
}

function malformedModel(caseIndex, alignedQuestion) {
  const good = validQuestion(alignedQuestion);
  switch (caseIndex % 6) {
    case 0:
      return payload([]);
    case 1:
      return payload([{ ...good, stepFeedbacks: good.stepFeedbacks.slice(0, Math.max(0, good.stepFeedbacks.length - 1)) }]);
    case 2:
      return payload([{ ...good, sourceKey: 'wrong-source-key' }]);
    case 3:
      return payload([{ ...good, stepFeedbacks: [...good.stepFeedbacks].reverse().map((step, index) => ({ ...step, stepIndex: index + 1, solutionText: `模型改写-${index}` })) }]);
    case 4:
      return payload([{ ...good, stepFeedbacks: [...good.stepFeedbacks, { ...good.stepFeedbacks[0], stepIndex: good.stepFeedbacks.length + 1, solutionText: '模型虚构的多余步骤' }] }]);
    default:
      return payload([{ ...good, standardAnswer: '', answerStatus: 'unreadable', finalAnswerCorrect: null, stepStatus: 'unreadable', logicStatus: 'unreadable' }]);
  }
}

function sourceCoverage(question, aligned) {
  const expected = [
    ...question.processUnits.map((unit) => unit.unitId),
    ...question.explanationUnits.map((unit) => unit.unitId)
  ].sort();
  const actual = aligned.pairedSteps.flatMap((step) => [
    ...(step.processUnitIds || []),
    ...(step.explanationUnitIds || [])
  ]).sort();
  assert.deepEqual(actual, expected, '每个原始过程/讲解单元必须且只能归属一个固定步骤');
  assert.equal(new Set(actual).size, actual.length, '不得重复使用原始过程/讲解单元');
}

function run(iterations = 100) {
  const variants = ['books', 'top-bottom', 'missing-bands'];
  let fallbackRuns = 0;
  let normalRuns = 0;
  let preservedSteps = 0;

  for (let i = 0; i < iterations; i += 1) {
    const source = evidenceQuestion(i, variants[i % variants.length]);
    const alignment = runtime.alignHardProblemEvidence(evidencePayload(source));
    assert.equal(alignment.questions.length, 1);
    const alignedQuestion = alignment.questions[0];
    sourceCoverage(source, alignedQuestion);

    const useMalformed = i % 2 === 1;
    const model = useMalformed ? malformedModel(i, alignedQuestion) : payload([validQuestion(alignedQuestion)]);
    const enforced = runtime.enforceFixedHardProblemSteps(model, alignment, { allowSafeFallback: true });
    const normalized = runtime.normalizeFixedHardProblemAggregates(enforced);
    const validated = validateHardProblemResult(normalized);

    assert.equal(validated.questions.length, 1, '结构异常时也必须返回当前题目');
    const resultQuestion = validated.questions[0];
    assert.equal(resultQuestion.sourceKey, alignedQuestion.sourceKey);
    assert.equal(resultQuestion.stepFeedbacks.length, alignedQuestion.pairedSteps.length);
    assert.deepEqual(
      resultQuestion.stepFeedbacks.map((step) => [step.solutionText, step.explanationText]),
      alignedQuestion.pairedSteps.map((step) => [step.solutionText, step.explanationText]),
      '模型不得改写、丢失或新增学生固定步骤原文'
    );
    for (const step of resultQuestion.stepFeedbacks) {
      assert.match(step.analysis, /思路：/);
      assert.match(step.analysis, /公式\/知识点：/);
      assert.match(step.analysis, /逻辑：/);
    }

    if (useMalformed) {
      fallbackRuns += 1;
      const fallbackWarning = (normalized.validationWarnings || []).some((item) => /HARD_PROBLEM_(FIXED_STEP|QUESTION)_SAFE_FALLBACK/.test(item));
      if (i % 6 !== 3 && i % 6 !== 4 && i % 6 !== 5) {
        assert.equal(fallbackWarning, true, '无法修复的结构异常必须留下安全兜底诊断');
      }
      if (fallbackWarning) {
        assert.notEqual(resultQuestion.finalAnswerCorrect, true, '安全兜底不得伪造正确结论');
      }
    } else {
      normalRuns += 1;
    }
    preservedSteps += resultQuestion.stepFeedbacks.length;
  }

  return {
    suite: 'hard-problem-step-feedback-stress',
    iterations,
    normalRuns,
    malformedOrIncompleteModelRuns: fallbackRuns,
    preservedFixedSteps: preservedSteps,
    result: 'PASS'
  };
}

const iterations = Number.parseInt(process.argv[2] || '100', 10);
const report = run(Number.isFinite(iterations) && iterations > 0 ? iterations : 100);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
