const assert = require('node:assert/strict');
const test = require('node:test');

const { realignHardProblemExplanations } = require('../shared/explanation-matcher');
const { normalizeHardProblemTeachingStep, normalizeHardProblemQuestion } = require('../shared/output-schema-validator');
const { createGradingRuntime } = require('../shared/grading-core/execute-grading-task');

function rng(seed = 0x5eeda11) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 0x100000000);
}
const rand = rng();
const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

function step(overrides = {}) {
  return {
    stepIndex: 1,
    stepTitle: '计算',
    solutionText: 'x=1',
    explanationText: '求出未知数',
    solutionStatus: 'correct',
    explanationStatus: 'clear',
    logicStatus: 'clear',
    analysis: '过程正确。',
    correctionAdvice: '',
    ...overrides
  };
}

test('语义阈值小幅放宽：同一真实讲解可以覆盖相邻拆分步骤', () => {
  const aligned = realignHardProblemExplanations([
    step({ stepIndex: 1, solutionText: 'x+1.4x=1200', explanationText: '文+科总数=1200总数', analysis: '根据总数列方程。' }),
    step({ stepIndex: 2, solutionText: '2.4x=1200', explanationText: '', explanationStatus: 'missing', analysis: '合并后继续计算。', correctionAdvice: '补充讲解。' })
  ]);
  assert.equal(aligned[1].explanationText, '文+科总数=1200总数');
  assert.equal(aligned[1].explanationStatus, 'clear');
  assert.equal(aligned[1].matchedExplanationSourceStepIndex, 1);
});

test('语义阈值仍有边界：泛化讲解不会硬塞给无关相邻步骤', () => {
  const aligned = realignHardProblemExplanations([
    step({ stepIndex: 1, solutionText: 'x+1.4x=1200', explanationText: '列方程', analysis: '列方程。' }),
    step({ stepIndex: 2, solutionText: 'x=500', explanationText: '', explanationStatus: 'missing', analysis: '求出文艺书数量。', correctionAdvice: '补充讲解。' })
  ]);
  assert.equal(aligned[1].explanationText, '');
  assert.equal(aligned[1].explanationStatus, 'missing');
});

test('分析不过度：基础方程已说明求解目的时不要求逐字复述机械变形', () => {
  const normalized = normalizeHardProblemTeachingStep(step({
    solutionText: '2.4x=1200，x=500',
    explanationText: '求出文艺书的量',
    explanationStatus: 'partially_clear',
    analysis: '计算正确，但没有说明从2.4x=1200到x=500的推导依据。',
    correctionAdvice: '可以补充说明等式两边同时除以2.4。'
  }));
  assert.equal(normalized.explanationStatus, 'clear');
  assert.equal(normalized.correctionAdvice, '');
});

test('分析放宽不越界：真正缺少数量关系依据时仍保留讲解不完整', () => {
  const normalized = normalizeHardProblemTeachingStep(step({
    solutionText: '2.4x=1200，x=500',
    explanationText: '求出文艺书的量',
    explanationStatus: 'partially_clear',
    analysis: '缺少题目条件中的数量关系依据。',
    correctionAdvice: '请补充为什么这里使用这个数量关系。'
  }));
  assert.equal(normalized.explanationStatus, 'partially_clear');
  assert.notEqual(normalized.correctionAdvice, '');
});

test('1000组变体边界：匹配放宽与过度分析规则保持稳定', () => {
  for (let i = 0; i < 400; i += 1) {
    const total = int(100, 9999);
    const k10 = int(11, 39);
    const k = (k10 / 10).toFixed(1);
    const aligned = realignHardProblemExplanations([
      step({ stepIndex: 1, solutionText: `x+${(Number(k)-1).toFixed(1)}x=${total}`, explanationText: `两类总数=${total}总数`, analysis: '根据总数列方程。' }),
      step({ stepIndex: 2, solutionText: `${k}x=${total}`, explanationText: '', explanationStatus: 'missing', analysis: '继续计算。', correctionAdvice: '补充讲解。' })
    ]);
    assert.notEqual(aligned[1].explanationText, '', `positive case ${i}`);
  }
  for (let i = 0; i < 300; i += 1) {
    const total = int(100, 9999);
    const result = int(10, 999);
    const aligned = realignHardProblemExplanations([
      step({ stepIndex: 1, solutionText: `x+1.4x=${total}`, explanationText: '列方程', analysis: '列方程。' }),
      step({ stepIndex: 2, solutionText: `x=${result}`, explanationText: '', explanationStatus: 'missing', analysis: '计算结果。', correctionAdvice: '补充讲解。' })
    ]);
    assert.equal(aligned[1].explanationText, '', `negative case ${i}`);
  }
  for (let i = 0; i < 200; i += 1) {
    const divisor = int(2, 9);
    const result = int(10, 999);
    const total = divisor * result;
    const normalized = normalizeHardProblemTeachingStep(step({
      solutionText: `${divisor}x=${total}，x=${result}`,
      explanationText: `求出未知数x的量`,
      explanationStatus: 'partially_clear',
      analysis: `计算正确，但没有说明从${divisor}x=${total}到x=${result}的推导依据。`,
      correctionAdvice: `可以补充说明等式两边同时除以${divisor}。`
    }));
    assert.equal(normalized.explanationStatus, 'clear', `mechanical case ${i}`);
    assert.equal(normalized.correctionAdvice, '');
  }
  for (let i = 0; i < 100; i += 1) {
    const normalized = normalizeHardProblemTeachingStep(step({
      solutionText: `2x=${int(20, 2000)}，x=${int(10, 999)}`,
      explanationText: '求出未知数的量',
      explanationStatus: 'partially_clear',
      analysis: '缺少题目条件和数量关系依据。',
      correctionAdvice: '请补充数量关系。'
    }));
    assert.equal(normalized.explanationStatus, 'partially_clear', `relationship case ${i}`);
  }
});

test('最终问题归一化会执行语义重配和教学尺度优化', () => {
  const q = normalizeHardProblemQuestion({
    outputSchemaVersion: 'hard-problem.v2', sourceKey:'q1', questionText:'测试', studentAnswer:'500', standardAnswer:'500', answerStatus:'answered', finalAnswerCorrect:true,
    stepRequired:true, stepStatus:'wrong', logicStatus:'wrong', errorType:'logic_error', firstWrongStep:'旧结论', errorReason:'旧结论', adjustmentSuggestion:'旧建议', knowledgePoint:'', overallFeedback:'部分讲解需要补充', confidence:1, studentWorkDetected:true, sourceQuestionLabel:'第1题', sourceRegion:'image-1:question-1', inputBasis:'printed_question_with_work', modeApplicability:'applicable',
    stepFeedbacks:[
      step({ stepIndex:1, solutionText:'x+1.4x=1200', explanationText:'文+科总数=1200总数', analysis:'根据总数列方程。' }),
      step({ stepIndex:2, solutionText:'2.4x=1200', explanationText:'', explanationStatus:'missing', analysis:'继续计算。', correctionAdvice:'补充讲解。' }),
      step({ stepIndex:3, solutionText:'2.4x=1200，x=500', explanationText:'求出文艺书的量', explanationStatus:'partially_clear', analysis:'计算正确，但没有说明等式两边同时除以2.4。', correctionAdvice:'补充等式两边同时除以2.4。' })
    ]
  });
  assert.equal(q.stepFeedbacks[1].explanationText, '文+科总数=1200总数');
  assert.equal(q.stepFeedbacks[2].explanationStatus, 'clear');
  assert.equal(q.stepFeedbacks[2].correctionAdvice, '');
});

test('DIRECT适配链路也执行两项解释层优化', () => {
  const runtime = createGradingRuntime({ json: require('../shared/json'), embedded: { decryptEmbeddedStrategy: () => ({}) } }).test;
  const draft = {
    questions:[{
      questionText:'文艺书和科技书共1200本', studentAnswer:'500', finalAnswerVerdict:'correct', overallFeedback:'最终答案正确，但部分讲解需要补充。', confidence:1,
      steps:[
        step({ stepTitle:'列方程', solutionText:'x+1.4x=1200', explanationText:'文+科总数=1200总数', analysis:'根据总数列方程。' }),
        step({ stepTitle:'继续计算', solutionText:'2.4x=1200', explanationText:'', explanationStatus:'missing', analysis:'继续计算。', correctionAdvice:'补充讲解。' }),
        step({ stepTitle:'求数量', solutionText:'2.4x=1200，x=500', explanationText:'求出文艺书的量', explanationStatus:'partially_clear', analysis:'计算正确，但没有说明等式两边同时除以2.4。', correctionAdvice:'补充等式两边同时除以2.4。' })
      ]
    }]
  };
  const result = runtime.adaptHardProblemDirectDraft(draft, {}, { manualAnswer:'500', studentImageCount:1 });
  const q = result.questions[0];
  assert.equal(q.stepFeedbacks[1].explanationText, '文+科总数=1200总数');
  assert.equal(q.stepFeedbacks[2].explanationStatus, 'clear');
  assert.equal(q.stepFeedbacks[2].correctionAdvice, '');
  assert.equal(q.overallFeedback, '最终答案、解题过程、讲解和数学逻辑均正确。');
});

test('语义重配不允许把自动补配的讲解继续链式传播到更远步骤', () => {
  const aligned = realignHardProblemExplanations([
    step({ stepIndex: 1, solutionText: 'x+1.4x=1200', explanationText: '文+科总数=1200总数', analysis: '根据总数列方程。' }),
    step({ stepIndex: 2, solutionText: '2.4x=1200', explanationText: '', explanationStatus: 'missing', analysis: '继续计算。', correctionAdvice: '补充讲解。' }),
    step({ stepIndex: 3, solutionText: '2.4x=1200', explanationText: '', explanationStatus: 'missing', analysis: '继续计算。', correctionAdvice: '补充讲解。' })
  ]);
  assert.equal(aligned[1].explanationText, '文+科总数=1200总数');
  assert.equal(aligned[1].matchedExplanationSourceStepIndex, 1);
  assert.equal(aligned[2].explanationText, '');
  assert.equal(aligned[2].explanationStatus, 'missing');
});

test('语义重配只能从原始学生讲解取值，不能通过自动补配步骤继续传播', () => {
  const aligned = realignHardProblemExplanations([
    step({ stepIndex: 1, solutionText: '7x=2911', explanationText: '根据数量关系7求出未知数', explanationStatus: 'clear', analysis: '继续计算。' }),
    step({ stepIndex: 2, solutionText: '7x=5667', explanationText: '', explanationStatus: 'missing', analysis: '继续计算。', correctionAdvice: '补充讲解。' }),
    step({ stepIndex: 3, solutionText: '7x=3070', explanationText: '', explanationStatus: 'missing', analysis: '继续计算。', correctionAdvice: '补充讲解。' })
  ]);
  assert.equal(aligned[1].explanationText, '根据数量关系7求出未知数');
  assert.equal(aligned[1].matchedExplanationSourceStepIndex, 1);
  assert.equal(aligned[2].explanationText, '');
  assert.equal(aligned[2].explanationStatus, 'missing');
});
