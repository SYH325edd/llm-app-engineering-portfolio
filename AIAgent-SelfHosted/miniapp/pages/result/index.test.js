const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

function loadResultPage(response) {
  const pagePath = require.resolve('./index');
  const mockModules = {
    [require.resolve('../../services/cloud')]: { call: async () => response },
    [require.resolve('../../utils/manager-view')]: {
      currentRole: async () => 'student', isManagerRole: () => false,
      filterManagerStudents: (rows) => rows || [], openManagerStudent: () => {}
    },
    [require.resolve('../../utils/custom-tab-bar')]: { syncCustomTabBar() {} }
  };
  const originals = Object.fromEntries(Object.keys(mockModules).map((path) => [path, require.cache[path]]));
  const originalPage = global.Page;
  let definition;
  for (const [path, exports] of Object.entries(mockModules)) {
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
  }
  global.Page = (value) => { definition = value; };
  delete require.cache[pagePath];
  try { require('./index'); } finally {
    delete require.cache[pagePath];
    global.Page = originalPage;
    for (const [path, cached] of Object.entries(originals)) {
      if (cached) require.cache[path] = cached;
      else delete require.cache[path];
    }
  }
  return definition;
}

async function loadTask(response) {
  const page = loadResultPage(response);
  const instance = Object.assign({}, page, {
    data: {
      ...structuredClone(page.data),
      selectedTaskId: 'task-1',
      completedTasks: [{ taskId: 'task-1', title: '测试作业', displayTitle: '测试作业' }]
    },
    resultCache: {},
    requestSequence: 0,
    setData(update) { Object.assign(this.data, update); }
  });
  await instance.loadTask.call(instance, 'task-1');
  return instance.data;
}

test('reading-careless result overview preserves the final correct summary and uses the three-grid view', async () => {
  const data = await loadTask({ task: { taskId: 'task-1' }, result: {
    outputSchemaVersion: 'reading-careless.v2',
    summary: { totalCount: 1, correctCount: 1, wrongCount: 0, incompleteCount: 0, carelessCount: 0 },
    questions: [{
      outputSchemaVersion: 'reading-careless.v2', sourceKey: 'q-1', analysisStatus: 'ok',
      normalizedStatus: 'CORRECT', threeGridStatus: 'CORRECT',
      conditionCorrect: true, relationCorrect: true, askCorrect: true,
      studentConditionText: '鸡兔', studentRelationText: '4x+2(x+23)=274', studentAskText: '鸡兔各几只'
    }]
  } });

  assert.equal(data.displayMode, 'reading');
  assert.deepEqual(
    { totalCount: data.summary.totalCount, correctCount: data.summary.correctCount, wrongCount: data.summary.wrongCount, incompleteCount: data.summary.incompleteCount },
    { totalCount: 1, correctCount: 1, wrongCount: 0, incompleteCount: 0 }
  );
  assert.equal(data.questions[0].threeGridStatus, 'CORRECT');
  assert.equal(data.questions[0].threeGridLabel, '三格判断正确');
});

test('reading-careless result overview maps undeterminedCount to incomplete without counting it as wrong', async () => {
  const data = await loadTask({ task: { taskId: 'task-1' }, result: {
    outputSchemaVersion: 'reading-careless.v2',
    summary: { totalCount: 1, correctCount: 0, wrongCount: 0, undeterminedCount: 1 },
    questions: [{ outputSchemaVersion: 'reading-careless.v2', sourceKey: 'q-1', analysisStatus: 'insufficient', normalizedStatus: 'UNDETERMINED', threeGridStatus: 'UNDETERMINED' }]
  } });

  assert.equal(data.summary.correctCount, 0);
  assert.equal(data.summary.wrongCount, 0);
  assert.equal(data.summary.incompleteCount, 1);
});

test('legacy result overview keeps the original generic summary path', async () => {
  const data = await loadTask({ task: { taskId: 'task-1' }, result: {
    questions: [{ sourceKey: 'q-1', isCorrect: true }, { sourceKey: 'q-2', isCorrect: false }]
  } });

  assert.equal(data.displayMode, 'default');
  assert.deepEqual(
    { totalCount: data.summary.totalCount, correctCount: data.summary.correctCount, wrongCount: data.summary.wrongCount },
    { totalCount: 2, correctCount: 1, wrongCount: 1 }
  );
});

test('reading-careless template branches away from generic answer and carelessness labels', () => {
  const template = fs.readFileSync(require.resolve('./index.wxml'), 'utf8');
  assert.equal(template.includes("wx:if=\"{{displayMode === 'reading'}}\""), true);
  assert.equal(template.includes('三格结果：{{item.threeGridLabel}}'), true);
  assert.equal(template.includes("displayMode === 'reading' ? '填写不完整'"), true);
  assert.equal(template.includes("displayMode === 'hard' ? '未作答/不可读'"), true);
  assert.equal(template.includes("'疑似马虎题数'"), true);
});


test('hard-problem result overview uses a dedicated process-analysis view without a carelessness label', async () => {
  const data = await loadTask({ task: { taskId: 'task-1' }, result: {
    outputSchemaVersion: 'hard-problem.v2',
    summary: { totalCount: 1, correctCount: 0, wrongCount: 1, unansweredCount: 0, unreadableCount: 0 },
    questions: [{
      outputSchemaVersion: 'hard-problem.v2', sourceKey: 'hard-overview', questionText: '应用题', studentAnswer: '76台', standardAnswer: '76台',
      normalizedStatus: 'WRONG', evaluationStatus: 'WRONG', finalAnswerCorrect: true, stepRequired: true, stepStatus: 'wrong', logicStatus: 'insufficient', errorReason: '第二步讲解不完整',
      stepFeedbacks: [{ stepIndex: 1, solutionText: '38×2=76', explanationText: '求空调', solutionStatus: 'correct', explanationStatus: 'partially_clear', logicStatus: 'insufficient', analysis: '缺少乘法依据', correctionAdvice: '补充2倍关系' }],
      overallFeedback: '最终答案正确，讲解需要补充。'
    }]
  } });
  assert.equal(data.displayMode, 'hard');
  assert.equal(data.questions[0].hardResultState, 'process_wrong');
  assert.equal(data.questions[0].answerLabel, '最终答案正确，过程或讲解需调整');
  const template = fs.readFileSync(require.resolve('./index.wxml'), 'utf8');
  assert.equal(template.includes("item.hardResultState === 'process_wrong' ? 'process-warning'"), true);
  assert.equal(data.questions[0].stepFeedbackCount, 1);
  assert.equal(template.includes("wx:elif=\"{{displayMode === 'hard'}}\""), true);
  assert.equal(template.includes('综合判断：{{item.answerLabel}}'), true);
  assert.equal(template.includes('已生成 {{item.stepFeedbackCount}} 步解题过程与讲解分析'), true);
});

test('hard-problem overview preserves exactly the student-written process count and paired explanations', async () => {
  const steps = Array.from({ length: 4 }, (_, i) => ({
    stepIndex: i + 1,
    solutionText: `学生过程${i + 1}`,
    explanationText: `学生解释${i + 1}`,
    solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '通过', correctionAdvice: ''
  }));
  const data = await loadTask({ task: { taskId: 'task-1' }, result: {
    outputSchemaVersion: 'hard-problem.v2', summary: { totalCount: 1, correctCount: 1, wrongCount: 0 },
    questions: [{
      outputSchemaVersion: 'hard-problem.v2', sourceKey: 'student-steps-4', questionText: '题目', studentAnswer: '最终答案', standardAnswer: '标准答案',
      normalizedStatus: 'CORRECT', evaluationStatus: 'CORRECT', finalAnswerCorrect: true, stepRequired: true, stepStatus: 'correct', logicStatus: 'correct',
      stepFeedbacks: steps, overallFeedback: '过程与解释均成立。'
    }]
  } });
  assert.equal(data.displayMode, 'hard');
  assert.equal(data.questions[0].stepFeedbackCount, 4);
  assert.equal(data.questions[0].stepFeedbacks.length, 4);
  assert.deepEqual(data.questions[0].stepFeedbacks.map((s) => s.solutionText), ['学生过程1','学生过程2','学生过程3','学生过程4']);
  assert.deepEqual(data.questions[0].stepFeedbacks.map((s) => s.explanationText), ['学生解释1','学生解释2','学生解释3','学生解释4']);
  assert.equal(data.questions[0].correctAnswer, '标准答案');
});

test('calculation-careless overview consumes v2 calculation fields instead of legacy answer fields', async () => {
  const data = await loadTask({ task: { taskId: 'task-1' }, result: {
    outputSchemaVersion: 'calculation-careless.v2',
    summary: { totalCount: 1, correctCount: 0, wrongCount: 1, carelessCount: 1 },
    questions: [{
      outputSchemaVersion: 'calculation-careless.v2', sourceKey: 'calc-1', questionText: '499×3÷6',
      analysisStatus: 'ok', calculationStatus: 'WRONG', processCorrect: false, finalAnswerCorrect: false,
      carelessDetected: true, issueCategory: 'careless', studentCalculation: '499×3=1497，1497÷6=249……3',
      standardCalculation: '499×3=1497，1497÷6=249.5', firstErrorPoint: '1497÷6', carelessIssues: ['除法余数处理错误'],
      methodIssues: [], errorReason: '把余数直接写进最终答案', correctionAdvice: '检查余数和小数'
    }]
  } });
  assert.equal(data.displayMode, 'calculation');
  assert.equal(data.questions[0].studentAnswer, '499×3=1497，1497÷6=249……3');
  assert.equal(data.questions[0].correctAnswer, '499×3=1497，1497÷6=249.5');
  assert.equal(data.questions[0].carelessStatus, 'careless');
  assert.equal(data.questions[0].answerLabel, '计算中存在马虎');
  assert.equal(data.summary.totalCount, 1);
  assert.equal(data.summary.wrongCount, 0);
  assert.equal(data.summary.carelessCount, 1);
});

test('v2 overview derives counts from final questions instead of trusting stale overlapping summaries', async () => {
  const data = await loadTask({ task: { taskId: 'task-1' }, result: {
    outputSchemaVersion: 'calculation-careless.v2',
    summary: { totalCount: 99, correctCount: 50, wrongCount: 49, carelessCount: 49 },
    questions: [{
      outputSchemaVersion: 'calculation-careless.v2', sourceKey: 'calc-stale', questionText: '题目', analysisStatus: 'ok',
      processCorrect: false, finalAnswerCorrect: false, carelessDetected: true, issueCategory: 'careless', calculationStatus: 'WRONG',
      studentCalculation: '学生过程', standardCalculation: '标准过程', carelessIssues: ['抄错数字']
    }]
  } });
  assert.deepEqual(
    { total: data.summary.totalCount, correct: data.summary.correctCount, wrong: data.summary.wrongCount, careless: data.summary.carelessCount },
    { total: 1, correct: 0, wrong: 0, careless: 1 }
  );
});

test('calculation overview keeps teacher WRONG override after refresh even if stale AI fields still say correct', async () => {
  const data = await loadTask({ task:{taskId:'task-1'}, result:{
    outputSchemaVersion:'calculation-careless.v2',
    questions:[{ outputSchemaVersion:'calculation-careless.v2', sourceKey:'teacher-wrong', teacherOverrideApplied:true, teacherOverrideStatus:'WRONG', normalizedStatus:'WRONG', analysisStatus:'ok', calculationStatus:'CORRECT', processCorrect:true, finalAnswerCorrect:true, carelessDetected:false, issueCategory:'none', studentCalculation:'1+1=2', standardCalculation:'1+1=2' }]
  }});
  assert.deepEqual({correct:data.summary.correctCount, wrong:data.summary.wrongCount, careless:data.summary.carelessCount, incomplete:data.summary.incompleteCount}, {correct:0, wrong:1, careless:0, incomplete:0});
});

test('calculation overview keeps teacher CORRECT override after refresh even if stale AI fields still say careless', async () => {
  const data = await loadTask({ task:{taskId:'task-1'}, result:{
    outputSchemaVersion:'calculation-careless.v2',
    questions:[{ outputSchemaVersion:'calculation-careless.v2', sourceKey:'teacher-correct', teacherOverrideApplied:true, teacherOverrideStatus:'CORRECT', normalizedStatus:'CORRECT', analysisStatus:'ok', calculationStatus:'WRONG', processCorrect:false, finalAnswerCorrect:false, carelessDetected:true, issueCategory:'careless', carelessIssues:['旧AI判断'], studentCalculation:'1+1=3', standardCalculation:'1+1=2' }]
  }});
  assert.deepEqual({correct:data.summary.correctCount, wrong:data.summary.wrongCount, careless:data.summary.carelessCount, incomplete:data.summary.incompleteCount}, {correct:1, wrong:0, careless:0, incomplete:0});
});
