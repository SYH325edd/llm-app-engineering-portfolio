const assert = require('node:assert/strict');
const test = require('node:test');

function loadDetailPage(response) {
  const pagePath = require.resolve('./index');
  const mockPaths = ['../../../services/cloud', '../result-view', '../grading-summary'].map(require.resolve);
  const originals = mockPaths.map((path) => require.cache[path]);
  const originalPage = global.Page;
  let definition;
  const call = typeof response === 'function' ? response : async () => response;
  require.cache[mockPaths[0]] = { id: mockPaths[0], filename: mockPaths[0], loaded: true, exports: {
    call,
    getTaskStatus: async (taskId, timeoutMs) => {
      const response = await call('getTaskStatus', { taskId }, timeoutMs);
      return response?.audioNarrationStatus ? response : { audioNarrationStatus: response?.result?.audioNarration?.status || 'PENDING' };
    }
  } };
  require.cache[mockPaths[1]] = { id: mockPaths[1], filename: mockPaths[1], loaded: true, exports: { normalizeImages: (images) => images || [], mapQuestions: (questions) => questions || [] } };
  require.cache[mockPaths[2]] = { id: mockPaths[2], filename: mockPaths[2], loaded: true, exports: { buildGradingSummary: () => ({}) } };
  global.Page = (value) => { definition = value; };
  delete require.cache[pagePath];
  try { require('./index'); } finally {
    delete require.cache[pagePath];
    global.Page = originalPage;
    mockPaths.forEach((path, index) => { if (originals[index]) require.cache[path] = originals[index]; else delete require.cache[path]; });
  }
  return definition;
}

async function loadResult(response) {
  const page = loadDetailPage(response);
  const instance = Object.assign({}, page, {
    data: { ...structuredClone(page.data), taskId: 'task-1' },
    setData(update) { Object.assign(this.data, update); },
    formatAudioTime: () => '0:00',
    startAudioPolling() {}
  });
  await instance.loadTask.call(instance);
  return instance.data;
}

test('hard-problem detail renders two final question cards with every wrong step and no knowledge point', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'hard-problem.v2', summary: { totalCount: 2, correctCount: 0, wrongCount: 2, incompleteCount: 0, carelessCount: 0 },
    questions: [
      { sourceKey: 'hard-1', questionNumber: 4, questionText: '题目一', studentAnswer: '1', standardAnswer: '2', evaluationStatus: 'WRONG', stepStatus: 'wrong', logicStatus: 'wrong', firstWrongStep: ['列式错误', '计算错误'], errorReason: '顺序错误', adjustmentSuggestion: '检查列式', knowledgePoint: '不得展示' },
      { sourceKey: 'hard-2', questionText: '题目二', studentAnswer: '3', standardAnswer: '4', evaluationStatus: 'WRONG', stepStatus: 'wrong', logicStatus: 'wrong', firstWrongStep: ['单位错误'], errorReason: '单位遗漏', adjustmentSuggestion: '补充单位' }
    ]
  } });

  assert.equal(data.displayMode, 'hard');
  assert.equal(data.displayQuestions.length, 2);
  assert.deepEqual(data.displayQuestions[0].firstWrongSteps, ['列式错误', '计算错误']);
  const template = require('fs').readFileSync(require.resolve('./index.wxml'), 'utf8');
  assert.equal(template.includes('wx:for="{{item.firstWrongSteps}}"'), true);
  assert.equal(template.includes('wx:for-item="wrongStep"'), true);
  assert.equal(template.includes('wx:for-index="wrongIndex"'), true);
  assert.equal(template.includes('{{wrongIndex + 1}}. {{wrongStep}}'), true);
  assert.equal(Object.hasOwn(data.displayQuestions[0], 'knowledgePoint'), false);
  assert.equal(template.includes('knowledgePoint'), false);
});

test('hard-problem detail maps step and logic statuses to Chinese display text', async () => {
  const data = await loadResult({ task: {}, result: { outputSchemaVersion: 'hard-problem.v2', summary: {}, questions: [
    { sourceKey: 'status-1', evaluationStatus: 'WRONG', stepStatus: 'wrong', logicStatus: 'insufficient' }
  ] } });

  assert.equal(data.displayQuestions[0].stepStatus, 'wrong');
  assert.equal(data.displayQuestions[0].logicStatus, 'insufficient');
  assert.equal(data.displayQuestions[0].stepStatusText, '错误');
  assert.equal(data.displayQuestions[0].logicStatusText, '信息不足');
  const template = require('fs').readFileSync(require.resolve('./index.wxml'), 'utf8');
  assert.equal(template.includes('{{item.stepStatus}}'), false);
  assert.equal(template.includes('{{item.logicStatus}}'), false);
  assert.equal(template.includes('{{item.stepStatusText}}'), true);
  assert.equal(template.includes('{{item.logicStatusText}}'), true);
});

test('reading-careless detail maps three final cards and preserves zero summary values', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'reading-careless.v2', summary: { totalCount: 3, correctCount: 0, wrongCount: 0, incompleteCount: 3, carelessCount: 0 },
    questions: [
      { sourceKey: 'reading-1', questionText: '第16题题目内容', studentConditionText: '', studentRelationText: '关系一', studentAskText: '所求一', referenceConditionText: '条件一', referenceRelationText: '标准关系一', referenceAskText: '标准所求一', conditionCorrect: false, relationCorrect: true, askCorrect: true, threeGridStatus: 'INCOMPLETE', errorReason: '条件缺失', correctionAdvice: '补全条件' },
      { sourceKey: 'reading-2', studentConditionText: '条件二', studentRelationText: '关系二', studentAskText: '所求二', referenceConditionText: '标准条件二', referenceRelationText: '标准关系二', referenceAskText: '标准所求二', conditionCorrect: true, relationCorrect: true, askCorrect: true, threeGridStatus: 'CORRECT', errorReason: '', correctionAdvice: '' },
      { sourceKey: 'reading-3', studentConditionText: '条件三', studentRelationText: '关系三', studentAskText: '所求三', referenceConditionText: '标准条件三', referenceRelationText: '标准关系三', referenceAskText: '标准所求三', conditionCorrect: false, relationCorrect: false, askCorrect: false, threeGridStatus: 'WRONG', errorReason: '关系错误', correctionAdvice: '核对关系' }
    ]
  } });

  assert.equal(data.displayMode, 'reading');
  assert.equal(data.displayQuestions.length, 3);
  assert.equal(data.displayQuestions[0].questionText, '第16题题目内容');
  assert.equal(data.displayQuestions[0].studentConditionText, '未填写');
  assert.equal(data.displayQuestions[0].referenceConditionText, '条件一');
  assert.equal(data.displayQuestions[0].referenceRelationText, '标准关系一');
  assert.equal(data.displayQuestions[0].referenceAskText, '标准所求一');
  assert.equal(data.displaySummary.totalCount, 3);
  assert.equal(data.displaySummary.correctCount, 0);
  const template = require('fs').readFileSync(require.resolve('./index.wxml'), 'utf8');
  assert.equal(template.includes('<text>题目内容</text><view>{{item.questionText}}</view>'), true);
});

test('calculation-careless detail renders final status conclusions while retaining careless issue details', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'calculation-careless.v2', summary: { totalCount: 3, correctCount: 1, wrongCount: 1, incompleteCount: 0, carelessCount: 1 },
    questions: [
      { sourceKey: 'calculation-1', questionText: '题目一', studentCalculation: '过程一', standardCalculation: '标准一', calculationStatus: 'WRONG', processCorrect: false, finalAnswerCorrect: false, carelessDetected: true, issueCategory: 'careless', firstErrorPoint: '借位', carelessIssues: ['漏借位', '个位错误'], methodIssues: [], errorReason: '计算马虎', correctionAdvice: '逐位检查' },
      { sourceKey: 'calculation-2', questionText: '题目二', studentCalculation: '过程二', standardCalculation: '标准二', calculationStatus: 'WRONG', processCorrect: false, finalAnswerCorrect: false, carelessDetected: false, issueCategory: 'knowledge_or_method', firstErrorPoint: '列式', carelessIssues: [], methodIssues: ['方法错误'], errorReason: '方法错误', correctionAdvice: '复习方法' },
      { sourceKey: 'calculation-3', questionText: '题目三', studentCalculation: '过程三', standardCalculation: '标准三', calculationStatus: 'CORRECT', processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none', firstErrorPoint: '', carelessIssues: [], methodIssues: [], errorReason: '', correctionAdvice: '' }
    ]
  } });

  assert.equal(data.displayMode, 'calculation');
  assert.equal(data.displayQuestions.length, 3);
  assert.equal(data.displayQuestions[0].mainConclusion, '存在马虎');
  assert.equal(data.displayQuestions[0].mainConclusion.includes('回答错误'), false);
  assert.equal(data.displayQuestions[2].mainConclusion, '回答正确');
  assert.deepEqual(data.displayQuestions[0].carelessIssues, ['漏借位', '个位错误']);
  assert.equal(data.displaySummary.wrongCount, 1);
  assert.equal(data.displaySummary.carelessCount, 1);
  const template = require('fs').readFileSync(require.resolve('./index.wxml'), 'utf8');
  assert.equal((template.match(/class="detail-card stats-card"/g) || []).length, 1);
  assert.equal((template.match(/wx:for="{{displayQuestions}}"/g) || []).length, 1);
});

test('result detail preserves multiline Unicode mathematical text', async () => {
  const formula = '√16\n∛64\nx²+x³=(-3)²\n(-1)³\n|a-b|=17/12\n2x+3y\n12m²';
  const data = await loadResult({ task: {}, result: { outputSchemaVersion: 'calculation-careless.v2', summary: {}, questions: [{ sourceKey: 'math-1', questionText: formula, studentCalculation: formula, standardCalculation: formula, calculationStatus: 'CORRECT', processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none' }] } });
  assert.equal(data.displayQuestions[0].questionText, formula);
  assert.equal(data.displayQuestions[0].studentCalculation, formula);
});

test('result detail replaces invalid mathematical text with the fixed fallback', async () => {
  const fallback = '公式或文本未能可靠识别，请重新上传方向正确、清晰完整的图片';
  const data = await loadResult({ task: {}, result: { outputSchemaVersion: 'hard-problem.v2', summary: {}, questions: [{ sourceKey: 'bad-1', questionText: '\\frac{1}{2}', studentAnswer: 'bad\uFFFDtext', standardAnswer: 'ok\u0001text', evaluationStatus: 'WRONG', stepStatus: 'wrong', logicStatus: 'wrong', errorReason: '\\sqrt{x}', adjustmentSuggestion: 'ok' }] } });
  const question = data.displayQuestions[0];
  for (const value of [question.questionText, question.studentAnswer, question.standardAnswer, question.errorReason]) assert.equal(value, fallback);
});

test('result detail keeps ordinary Chinese, units, and variables unchanged', async () => {
  const value = '普通说明：x，cm，kg，12m²';
  const data = await loadResult({ task: {}, result: { outputSchemaVersion: 'hard-problem.v2', summary: {}, questions: [{ sourceKey: 'plain-1', questionText: value, studentAnswer: 'x', standardAnswer: '12m²', evaluationStatus: 'CORRECT', stepStatus: 'correct', logicStatus: 'correct' }] } });
  assert.equal(data.displayQuestions[0].questionText, value);
  assert.equal(data.displayQuestions[0].studentAnswer, 'x');
  assert.equal(data.displayQuestions[0].standardAnswer, '12m²');
});

test('correct questions hide the error analysis card and never use 未提供', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'hard-problem.v2', summary: {}, questions: [
      { sourceKey: 'correct-1', normalizedStatus: 'CORRECT', evaluationStatus: 'CORRECT', firstWrongStep: '旧错误位置', errorReason: '旧错误原因', adjustmentSuggestion: '旧建议' }
    ]
  } });

  const question = data.displayQuestions[0];
  assert.equal(question.conclusion, '回答正确');
  assert.equal(question.showErrorCard, false);
  assert.equal(question.errorLocation, '');
  assert.equal(question.errorReason, '');
  assert.equal(question.correctMethod, '');
  assert.equal(question.adjustmentSuggestion, '');
  assert.equal(require('fs').readFileSync(require.resolve('./index.wxml'), 'utf8').includes('未提供'), false);
});

test('teacher-correct hard-problem override suppresses stale AI step errors in the display layer', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'hard-problem.v2', summary: {}, questions: [{
      sourceKey: 'teacher-correct-hard', teacherOverrideApplied: true, teacherOverrideStatus: 'CORRECT', normalizedStatus: 'CORRECT', evaluationStatus: 'WRONG', stepRequired: true, stepStatus: 'wrong', logicStatus: 'wrong',
      stepFeedbacks: [{ stepIndex:1, solutionText:'旧过程', explanationText:'旧解释', solutionStatus:'wrong', explanationStatus:'incorrect', logicStatus:'wrong', analysis:'旧错误分析', correctionAdvice:'旧建议' }], overallFeedback:'旧错误反馈'
    }]
  } });
  const question = data.displayQuestions[0];
  assert.equal(question.conclusion, '回答正确');
  assert.equal(question.stepStatusText, '正确');
  assert.equal(question.logicStatusText, '正确');
  assert.equal(question.hasStepFeedbacks, false);
  assert.equal(question.hasOverallFeedback, false);
});

test('wrong hard-problem question renders one error card with all mapped fields', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'hard-problem.v2', summary: {}, questions: [
      { sourceKey: 'wrong-1', hardState: 'WRONG', firstErrorPoint: '列式', stepAnalysis: '步骤分析', briefFeedback: '简要反馈', standardAnswer: '正确答案', correctProcess: '正确过程', correctionAdvice: '检查单位' }
    ]
  } });

  const question = data.displayQuestions[0];
  assert.equal(question.conclusion, '回答错误');
  assert.equal(question.showErrorCard, true);
  assert.equal(question.errorLocation, '列式');
  assert.equal(question.errorReason, '简要反馈');
  assert.equal(question.correctMethod, '正确答案');
  assert.equal(question.adjustmentSuggestion, '检查单位');
});

test('wrong question with no error fields renders the incomplete-analysis fallback', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'calculation-careless.v2', summary: {}, questions: [
      { sourceKey: 'wrong-empty', calculationStatus: 'WRONG' }
    ]
  } });

  const question = data.displayQuestions[0];
  assert.equal(question.showErrorCard, true);
  assert.equal(question.errorFallbackMessage, '本题已判定为回答错误，但具体错误说明生成不完整，请重新批改。');
});

function createDetailInstance(page) {
  return Object.assign({}, page, {
    data: { ...structuredClone(page.data), taskId: 'task-1' },
    resultVisibilityReady: true,
    setData(update) { Object.assign(this.data, update); },
  });
}

function withFakeTimers(run) {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = new Map();
  let nextTimerId = 1;
  global.setTimeout = (callback, delay) => {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  };
  global.clearTimeout = (id) => timers.delete(id);
  return Promise.resolve()
    .then(() => run(timers))
    .finally(() => {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    });
}

test('detail page polls pending audio every six seconds and stops for ready and failed audio', async () => {
  const statuses = ['READY', 'FAILED'];
  let currentStatus = 'PENDING';
  const page = loadDetailPage(async (action) => {
    if (action === 'getTaskStatus') {
      currentStatus = statuses.shift();
      return { audioNarrationStatus: currentStatus };
    }
    return { task: { voiceStatus: currentStatus }, result: { audioNarration: { status: currentStatus, durationMs: currentStatus === 'READY' ? 1000 : 0 } } };
  });
  const instance = createDetailInstance(page);
  await withFakeTimers(async (timers) => {
    instance.active = true;
    instance.startAudioPolling.call(instance, { status: 'PENDING' });
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, 6000);
    const [readyTimerId, readyTimer] = [...timers.entries()][0];
    timers.delete(readyTimerId);
    await readyTimer.callback();
    assert.equal(instance.data.voiceStatus, 'READY');
    assert.equal(timers.size, 0);

    instance.startAudioPolling.call(instance, { status: 'PENDING' });
    const [failedTimerId, failedTimer] = [...timers.entries()][0];
    timers.delete(failedTimerId);
    await failedTimer.callback();
    assert.equal(instance.data.voiceStatus, 'FAILED');
    assert.equal(timers.size, 0);
  });
});

test('detail page clears audio polling while hidden and restores one timer only for pending audio', async () => {
  let audioStatus = 'PENDING';
  const page = loadDetailPage(async () => ({ task: {}, result: { audioNarration: { status: audioStatus } } }));
  const instance = createDetailInstance(page);
  await withFakeTimers(async (timers) => {
    instance.active = true;
    instance.startAudioPolling.call(instance, { status: 'PENDING' });
    const pendingCallback = [...timers.values()][0].callback;
    instance.onHide.call(instance);
    await pendingCallback();
    assert.equal(timers.size, 0);

    instance.onShow.call(instance);
    instance.onShow.call(instance);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(timers.size, 1);

    audioStatus = 'READY';
    instance.data.audioNarration = { status: 'READY' };
    instance.onHide.call(instance);
    instance.onShow.call(instance);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(timers.size, 0);

    instance.active = true;
    instance.startAudioPolling.call(instance, { status: 'PENDING' });
    instance.onUnload.call(instance);
    assert.equal(timers.size, 0);
  });
});

test('detail audio polling uses getTaskStatus and reads the full task once when ready', async () => {
  const actions = [];
  const page = loadDetailPage(async (action) => {
    actions.push(action);
    if (action === 'getTaskStatus') return { taskId: 'task-1', audioNarrationStatus: 'READY' };
    return { task: { voiceStatus: 'READY' }, result: { audioNarration: { status: 'READY', tempUrl: 'audio-url' } } };
  });
  const instance = createDetailInstance(page);
  await withFakeTimers(async (timers) => {
    instance.active = true;
    instance.startAudioPolling.call(instance, { status: 'PENDING' });
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    await timer.callback();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(actions, ['getTaskStatus', 'getTask']);
    assert.equal(timers.size, 0);
  });
});

test('detail audio polling stops on failed status without reading the full task or rescheduling', async () => {
  const actions = [];
  const page = loadDetailPage(async (action) => {
    actions.push(action);
    return { taskId: 'task-1', audioNarrationStatus: 'FAILED' };
  });
  const instance = createDetailInstance(page);
  await withFakeTimers(async (timers) => {
    instance.active = true;
    instance.startAudioPolling.call(instance, { status: 'GENERATING' });
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    await timer.callback();
    assert.deepEqual(actions, ['getTaskStatus']);
    assert.equal(timers.size, 0);
  });
});

test('ordinary hidden student direct result link redirects before result data is requested', async () => {
  let calls = 0;
  const page = loadDetailPage(async () => { calls += 1; return { task: {}, result: {} }; });
  const instance = createDetailInstance(page);
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let redirected = '';
  global.getApp = () => ({
    globalData: {
      authSnapshot: {
        clientConfig: { studentResultVisibility: 'hidden' },
        user: { role: 'student', status: 'ACTIVE' }
      }
    },
    bootstrap: async function () { return this.globalData.authSnapshot; }
  });
  global.wx = { redirectTo({ url }) { redirected = url; } };
  try {
    instance.onLoad({ taskId: 'task-1' });
    instance.onShow();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 0);
    assert.equal(redirected, '/pages/result/notice/index?mode=result_hidden&taskId=task-1');
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});

test('hard-problem detail renders every solution-explanation pair and overall feedback', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'hard-problem.v2', summary: { totalCount: 1, correctCount: 0, wrongCount: 1, incompleteCount: 0, carelessCount: 0 },
    questions: [{
      sourceKey: 'explain-1', questionText: '应用题', studentAnswer: '76台', standardAnswer: '76台', evaluationStatus: 'WRONG', finalAnswerCorrect: true, stepRequired: true,
      stepStatus: 'wrong', logicStatus: 'insufficient', firstWrongStep: '第2步讲解不完整',
      stepFeedbacks: [
        { stepIndex: 1, solutionText: '25+13=38（台）', explanationText: '先求洗衣机数量，因为比冰箱多13台', solutionStatus: 'correct', explanationStatus: 'clear', logicStatus: 'clear', analysis: '计算和解释对应正确。', correctionAdvice: '' },
        { stepIndex: 2, solutionText: '38×2=76（台）', explanationText: '求空调数量', solutionStatus: 'correct', explanationStatus: 'partially_clear', logicStatus: 'insufficient', analysis: '没有说明为什么使用乘法。', correctionAdvice: '补充因为空调数量是洗衣机的2倍，所以用乘法。' }
      ],
      overallFeedback: '最终答案正确，但第2步讲解需要补充运算依据。'
    }]
  } });

  const question = data.displayQuestions[0];
  assert.equal(question.conclusion, '最终答案正确，过程或讲解需调整');
  const template = require('fs').readFileSync(require.resolve('./index.wxml'), 'utf8');
  assert.equal(template.includes("status-pill--warning"), true);
  assert.equal(question.evaluationStatus, 'ANSWER_CORRECT_PROCESS_WRONG');
  assert.equal(question.hasStepFeedbacks, true);
  assert.equal(question.stepFeedbacks.length, 2);
  assert.equal(question.stepFeedbacks[0].solutionStatusText, '正确');
  assert.equal(question.stepFeedbacks[1].explanationStatusText, '讲解不完整');
  assert.equal(question.stepFeedbacks[1].logicStatusText, '逻辑不充分');
  assert.equal(question.stepFeedbacks[1].showCorrectionAdvice, true);
  assert.equal(question.overallFeedback, '最终答案正确，但第2步讲解需要补充运算依据。');
  assert.equal(template.includes('wx:for="{{item.stepFeedbacks}}"'), true);
  assert.equal(template.includes('{{step.solutionText}}'), true);
  assert.equal(template.includes('{{step.explanationText}}'), true);
  assert.equal(template.includes('本步反馈（思路 / 公式与知识点 / 逻辑）'), true);
  assert.equal(template.includes('{{item.overallFeedback}}'), true);
});


test('hard-problem detail distinguishes unreadable step source from an unwritten step', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'hard-problem.v2', summary: { totalCount: 1, correctCount: 0, wrongCount: 1, incompleteCount: 0 },
    questions: [{
      sourceKey: 'unreadable-step', questionText: '应用题', studentAnswer: '', standardAnswer: '标准答案', evaluationStatus: 'WRONG', finalAnswerCorrect: false, stepRequired: true,
      stepStatus: 'unreadable', logicStatus: 'unreadable', firstWrongStep: '第1步无法识别；第2步缺失', errorReason: '图片不清且作答不完整', adjustmentSuggestion: '重新上传并补写',
      stepFeedbacks: [
        { stepIndex: 1, solutionText: '', explanationText: '', solutionStatus: 'unreadable', explanationStatus: 'unreadable', logicStatus: 'unreadable', analysis: '第一步无法识别。', correctionAdvice: '重新上传清晰图片。' },
        { stepIndex: 2, solutionText: '', explanationText: '', solutionStatus: 'missing', explanationStatus: 'missing', logicStatus: 'insufficient', analysis: '第二步未写。', correctionAdvice: '补写第二步。' }
      ], overallFeedback: '需要重新上传并补全步骤。'
    }]
  } });
  const steps = data.displayQuestions[0].stepFeedbacks;
  assert.equal(steps[0].solutionText, '解题过程无法识别');
  assert.equal(steps[0].explanationText, '对应讲解无法识别');
  assert.equal(steps[0].solutionStatusText, '暂无法判断');
  assert.equal(steps[0].explanationStatusText, '暂无法判断');
  assert.equal(steps[0].logicStatusText, '暂无法判断');
  assert.equal(steps[1].solutionText, '未写出解题过程');
  assert.equal(steps[1].explanationText, '未写出对应讲解');
});


test('hard-problem detail keeps canonical unreadable state ahead of process-warning heuristics', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'hard-problem.v2', summary: { totalCount: 1, correctCount: 0, wrongCount: 0, incompleteCount: 1 },
    questions: [{
      sourceKey: 'unreadable-process', questionText: '应用题', studentAnswer: '76', standardAnswer: '76', normalizedStatus: 'UNREADABLE', evaluationStatus: 'UNREADABLE', finalAnswerCorrect: true, stepRequired: true,
      stepStatus: 'unreadable', logicStatus: 'unreadable', errorType: 'unreadable', firstWrongStep: '', errorReason: '部分过程无法识别', adjustmentSuggestion: '重新拍摄', stepFeedbacks: [], overallFeedback: '部分过程无法识别。'
    }]
  } });
  assert.equal(data.displayQuestions[0].evaluationStatus, 'UNREADABLE');
  assert.equal(data.displayQuestions[0].conclusion, '暂无法判断');
});

test('hard-problem detail honors teacher override before stale AI process fields', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'hard-problem.v2', summary: { totalCount: 1, correctCount: 1, wrongCount: 0, incompleteCount: 0 },
    questions: [{
      sourceKey: 'teacher-correct', questionText: '应用题', studentAnswer: '76', standardAnswer: '76', normalizedStatus: 'CORRECT', evaluationStatus: 'WRONG', teacherOverrideApplied: true, teacherOverrideStatus: 'CORRECT', isCorrect: true, finalAnswerCorrect: true, stepRequired: true,
      stepStatus: 'wrong', logicStatus: 'insufficient', errorType: 'logic_error', firstWrongStep: '旧AI判断', errorReason: '旧AI判断', adjustmentSuggestion: '旧AI建议', stepFeedbacks: [], overallFeedback: '旧AI反馈'
    }]
  } });
  assert.equal(data.displayQuestions[0].evaluationStatus, 'CORRECT');
  assert.equal(data.displayQuestions[0].conclusion, '回答正确');
  assert.deepEqual(data.displayQuestions[0].firstWrongSteps, []);
});

test('hard-problem frontend preserves missing explanation and missing process independently from clear logic', async () => {
  const data = await loadResult({ task: {}, result: {
    outputSchemaVersion: 'hard-problem.v2',
    summary: {},
    questions: [{
      sourceKey:'contract-1', questionText:'牛吃草题', studentAnswer:'5头牛', standardAnswer:'5头牛',
      evaluationStatus:'ANSWER_CORRECT_PROCESS_WRONG', stepRequired:true, stepStatus:'missing', logicStatus:'correct',
      firstWrongStep:'第1步缺少讲解；第4步缺少解题过程',
      errorReason:'存在步骤完整性问题，但数学逻辑本身正确。',
      adjustmentSuggestion:'补充缺失的讲解和结论过程。',
      stepFeedbacks:[
        {
          stepIndex:1, solutionText:'解：设每头牛每天吃1份草。', explanationText:'',
          solutionStatus:'correct', explanationStatus:'missing', logicStatus:'clear',
          analysis:'设定正确，但学生没有写对应讲解。', correctionAdvice:'补充说明设1份草的作用。'
        },
        {
          stepIndex:4, solutionText:'', explanationText:'④所以最多5头牛。',
          solutionStatus:'missing', explanationStatus:'clear', logicStatus:'clear',
          analysis:'结论逻辑正确，但没有单独写对应解答过程。', correctionAdvice:'补写每天长5份草，因此最多养5头牛。'
        }
      ],
      overallFeedback:'整体数学逻辑正确，但存在步骤完整性缺失。'
    }]
  }});
  const q = data.displayQuestions[0];
  assert.equal(q.logicStatus, 'correct');
  assert.equal(q.stepFeedbacks[0].solutionStatusText, '正确');
  assert.equal(q.stepFeedbacks[0].explanationStatusText, '未写讲解');
  assert.equal(q.stepFeedbacks[0].logicStatusText, '逻辑清楚');
  assert.equal(q.stepFeedbacks[1].solutionStatusText, '未写出');
  assert.equal(q.stepFeedbacks[1].explanationStatusText, '讲解清楚');
  assert.equal(q.stepFeedbacks[1].logicStatusText, '逻辑清楚');
});

test('calculation detail lets teacher CORRECT override stale AI careless/process judgments everywhere', async () => {
  const data = await loadResult({ task:{}, result:{ outputSchemaVersion:'calculation-careless.v2', summary:{}, questions:[{
    sourceKey:'teacher-calc-correct-detail', teacherOverrideApplied:true, teacherOverrideStatus:'CORRECT', normalizedStatus:'CORRECT',
    questionText:'题目', studentCalculation:'旧学生过程', standardCalculation:'标准过程', calculationStatus:'WRONG', processCorrect:false, finalAnswerCorrect:false,
    carelessDetected:true, issueCategory:'careless', carelessIssues:['旧AI马虎'], methodIssues:[]
  }]}});
  const q = data.displayQuestions[0];
  assert.equal(q.mainConclusion, '回答正确');
  assert.equal(q.processJudgement, '正确');
  assert.equal(q.finalAnswerJudgement, '正确');
  assert.equal(q.carelessJudgement, '未发现马虎');
  assert.equal(q.issueCategory, 'none');
  assert.deepEqual(q.carelessIssues, []);
});

test('reading detail does not present stale all-correct AI grid judgments as final after teacher marks the question wrong', async () => {
  const data = await loadResult({ task:{}, result:{ outputSchemaVersion:'reading-careless.v2', summary:{}, questions:[{
    sourceKey:'teacher-reading-wrong-detail', teacherOverrideApplied:true, teacherOverrideStatus:'WRONG', normalizedStatus:'WRONG', threeGridStatus:'CORRECT', analysisStatus:'ok',
    conditionCorrect:true, relationCorrect:true, askCorrect:true, studentConditionText:'A', studentRelationText:'B', studentAskText:'C'
  }]}});
  const q = data.displayQuestions[0];
  assert.equal(q.conclusion, '回答错误');
  assert.equal(q.conditionJudgement, '以教师复核为准');
  assert.equal(q.relationJudgement, '以教师复核为准');
  assert.equal(q.askJudgement, '以教师复核为准');
});

test('hard detail does not present stale AI fully-correct process as final after teacher marks the question wrong', async () => {
  const data = await loadResult({ task:{}, result:{ outputSchemaVersion:'hard-problem.v2', summary:{}, questions:[{
    sourceKey:'teacher-hard-wrong-detail', teacherOverrideApplied:true, teacherOverrideStatus:'WRONG', normalizedStatus:'WRONG', evaluationStatus:'CORRECT', finalAnswerCorrect:true,
    stepRequired:true, stepStatus:'correct', logicStatus:'correct', stepFeedbacks:[{stepIndex:1,solutionText:'1+1=2',explanationText:'相加',solutionStatus:'correct',explanationStatus:'clear',logicStatus:'clear',analysis:'旧AI正确',correctionAdvice:''}], overallFeedback:'旧AI全部正确'
  }]}});
  const q = data.displayQuestions[0];
  assert.equal(q.conclusion, '回答错误');
  assert.equal(q.stepStatusText, '以教师复核为准');
  assert.equal(q.logicStatusText, '以教师复核为准');
  assert.equal(q.hasStepFeedbacks, false);
  assert.equal(q.hasOverallFeedback, false);
});
