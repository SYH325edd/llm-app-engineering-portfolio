'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const context = require('../shared/context');
const constants = require('../shared/constants');
const { createHardProblemTrainingService } = require('../shared/hard-problem-training');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeDb(seed = {}) {
  const store = new Map();
  for (const [collection, docs] of Object.entries(seed)) {
    const map = new Map();
    for (const [id, value] of Object.entries(docs)) map.set(id, clone(value));
    store.set(collection, map);
  }
  function collection(name) {
    if (!store.has(name)) store.set(name, new Map());
    const map = store.get(name);
    return {
      doc(id) {
        return {
          async get() { const value = map.get(id); return { data: value === undefined ? [] : [clone(value)] }; },
          async set({ data }) { map.set(id, clone(data)); return { updated: 1 }; },
          async update({ data }) { map.set(id, { ...(map.get(id) || {}), ...clone(data) }); return { updated: 1 }; }
        };
      }
    };
  }
  return {
    collection,
    command: {},
    async runTransaction(fn) { return fn({ collection }); },
    _get(collectionName, id) { return clone(store.get(collectionName)?.get(id)); },
    _set(collectionName, id, value) { if (!store.has(collectionName)) store.set(collectionName, new Map()); store.get(collectionName).set(id, clone(value)); }
  };
}

function diagnosticSnapshot() {
  return {
    snapshotId: 'snap-service-v10', version: 'hard-problem-evidence-causal-mastery.v10', consistencyStatus: 'ok', consistencyIssues: [],
    adversarialJudgment: { accepted: true, confidence: .98, issues: [] },
    evidence: { questions: [{ sourceKey: 'Q1', questionText: '甲乙共120个，甲是乙的2倍，分别多少？', studentAnswer: '80和40', studentWorkDetected: true, verificationState: 'verified', evidenceQuality: .98, processUnits: [{ unitId: 'P1', rawText: 'x+2x=120', confidence: .98 }], explanationUnits: [] }] },
    problemTruth: { questions: [{ sourceKey: 'Q1', accepted: true, questionConsistent: true, referenceAnswerConsistent: true, confidence: .99 }] },
    reasoningHypotheses: { questions: [{ sourceKey: 'Q1', hypotheses: [{ hypothesisId: 'H1', methodFamily: 'equation', confidence: .98, nodes: [{ nodeId: 'N1', order: 1, purpose: '建立数量关系', expectedReasoning: '总量等于两部分数量之和', hintScaffold: '找总量与两部分数量之间的关系', dependencies: [] }] }] }] },
    plan: { questions: [{ sourceKey: 'Q1', selectedHypothesisId: 'H1', steps: [{ stepId: 'N1', nodeId: 'N1', order: 1, purpose: '建立数量关系', expectedReasoning: '总量等于两部分数量之和', hintScaffold: '找总量与两部分数量之间的关系', dependencies: [] }] }] },
    diagnoses: [{ sourceKey: 'Q1', stepId: 'S1', nodeId: 'N1', stepIndex: 1, purpose: '建立数量关系', dependencies: [], dependents: [], satisfactionStatus: 'covered', processStatus: 'wrong', explanationStatus: 'missing', logicStatus: 'wrong', bottleneckType: 'quantity_relation', feedback: '数量关系没有说明清楚', correctionAdvice: '先说明总量与两部分的关系', confidence: .95 }],
    causalBottleneckCandidate: { sourceKey: 'Q1', stepId: 'S1', nodeId: 'N1', bottleneckType: 'quantity_relation', purpose: '建立数量关系', dependencies: [], causalScore: 10 }
  };
}

function variants() {
  return [
    { variantId: 'V1', transferLevel: 'near', questionText: '近迁移题', standardAnswer: 'A1', expectedReasoning: 'R1', confidence: .95 },
    { variantId: 'V2', transferLevel: 'middle', questionText: '中迁移题', standardAnswer: 'A2', expectedReasoning: 'R2', confidence: .95 },
    { variantId: 'V3', transferLevel: 'far', questionText: '远迁移题', standardAnswer: 'A3', expectedReasoning: 'R3', confidence: .95 }
  ];
}
function variantAudit() {
  return { variants: variants().map((v) => ({ variantId: v.variantId, accepted: true, answerVerified: true, reasoningVerified: true, transferVerified: true, leakageDetected: false, confidence: .96 })) };
}

function workerStub() {
  const calls = [];
  const fn = async (_path, body) => {
    calls.push(clone(body));
    const op = body.operation;
    if (op === 'bottleneck_response') return { result: { passed: true, reasoningExplained: true, ownWordsClear: true, copiedAnswerLikely: false, confidence: .96, feedback: '已讲清当前关系' } };
    if (op === 'retell') return { result: { passed: true, copiedAnswerLikely: false, confidence: .96, missingStepIds: [], feedback: '完整复述通过' } };
    if (op === 'generate_variants') return { result: { variants: variants() } };
    if (op === 'audit_variants') return { result: variantAudit() };
    if (op === 'grade_variant') return { result: { answerCorrect: true, reasoningCorrect: true, confidence: .96, feedback: '通过' } };
    if (op === 'generate_review_variant') return { result: { challengeId: 'R1', questionText: '第1天复习题', standardAnswer: 'RA', expectedReasoning: 'RR', confidence: .96, auditConfidence: .96 } };
    if (op === 'grade_review_variant') return { result: { answerCorrect: true, reasoningCorrect: true, confidence: .96, feedback: '保持掌握' } };
    throw new Error(`unexpected operation ${op}`);
  };
  fn.calls = calls;
  return fn;
}

test('V10 service closes the full student loop with version CAS, idempotency, 3/3 L4, and Day1 review', async () => {
  const C = constants.C;
  const taskId = 'task-v10'; const studentId = 'student-v10';
  const db = fakeDb({
    [C.tasks]: { [taskId]: { _id: taskId, studentId, mode: 'HARD_PROBLEM_CHECK', status: 'COMPLETED', resultId: 'result-v10' } },
    [C.hardProblemDiagnostics]: { [taskId]: { _id: taskId, studentId, diagnosticSnapshot: diagnosticSnapshot() } }
  });
  context.db = db;
  const worker = workerStub();
  const service = createHardProblemTrainingService({ gradingWorkerRequest: worker });
  const user = { userId: studentId, role: 'student', status: 'ACTIVE' };

  const started = await service.start({ taskId }, user);
  assert.equal(started.session.phase, 'BOTTLENECK');
  assert.equal(started.session.sessionVersion, 1);
  assert.equal('purpose' in started.session.activeBottleneck, false);

  const explained = await service.submitExplanation({ taskId, answer: '因为总量等于甲乙两部分之和', sessionVersion: 1, requestId: 'explain-1' }, user);
  const bottleneckCall = worker.calls.find((call) => call.operation === 'bottleneck_response');
  assert.equal(bottleneckCall.payload.bottleneck.stepId, 'S1');
  assert.equal(bottleneckCall.payload.bottleneck.nodeId, 'N1');
  assert.equal(bottleneckCall.payload.expectedReasoning, '总量等于两部分数量之和');
  assert.equal(explained.session.phase, 'RETELL');
  assert.equal(explained.session.sessionVersion, 2);
  const replay = await service.submitExplanation({ taskId, answer: '重复提交', sessionVersion: 1, requestId: 'explain-1' }, user);
  assert.deepEqual(replay, explained);
  await assert.rejects(service.submitRetell({ taskId, retell: '完整讲解', sessionVersion: 1, requestId: 'stale' }, user), (e) => e.code === 'TRAINING_SESSION_VERSION_CONFLICT');

  const retold = await service.submitRetell({ taskId, retell: '设乙为x，甲为2x，总量等于两部分之和，所以x+2x=120……', sessionVersion: 2, requestId: 'retell-1' }, user);
  assert.equal(retold.session.phase, 'VARIANTS');
  assert.equal(retold.session.independentRetellStatus, 'PASSED');
  assert.equal(retold.variants.length, 3);
  assert.equal(JSON.stringify(retold.session).includes('standardAnswer'), false);

  let version = retold.session.sessionVersion;
  for (const variantId of ['V1', 'V2', 'V3']) {
    const out = await service.submitVariant({ taskId, variantId, answer: '答案', reasoning: '原因', sessionVersion: version, requestId: `variant-${variantId}` }, user);
    version = out.session.sessionVersion;
    if (variantId !== 'V3') assert.equal(out.session.phase, 'VARIANTS');
    else {
      assert.equal(out.session.phase, 'MASTERED');
      assert.equal(out.learning.masteryLevel, 'L4');
      assert.equal(out.learning.reachedL4Ever, true);
    }
  }

  const record = db._get(C.hardProblemLearningRecords, taskId);
  assert.equal(record.peakMasteryLevel, 'L4');
  assert.equal(record.reviewSchedule.length, 3);
  record.reviewSchedule[0].dueAt = '2000-01-01T00:00:00.000Z';
  record.nextReviewAt = record.reviewSchedule[0].dueAt;
  db._set(C.hardProblemLearningRecords, taskId, record);

  const review = await service.getReview({ taskId }, user);
  assert.equal(review.due, true); assert.equal(review.day, 1); assert.equal(review.challenge.questionText, '第1天复习题');
  assert.equal('standardAnswer' in review.challenge, false);

  const reviewResult = await service.submitReview({ taskId, challengeId: review.challenge.challengeId, answer: 'RA', reasoning: 'RR', sessionVersion: review.sessionVersion, requestId: 'review-1' }, user);
  assert.equal(reviewResult.passed, true);
  assert.equal(reviewResult.learning.peakMasteryLevel, 'L4');
  assert.equal(reviewResult.learning.currentRetentionStatus, 'MASTERED');
  assert.ok(worker.calls.some((c) => c.operation === 'generate_review_variant'));
});

test('nonfatal adversarial disagreement does not block a consistency-ok V10 training session', async () => {
  const C = constants.C;
  const taskId = 'task-nonfatal-judge'; const studentId = 'student-nonfatal-judge';
  const snapshot = diagnosticSnapshot();
  snapshot.consistencyStatus = 'ok';
  snapshot.consistencyIssues = ['ADVERSARIAL_JUDGMENT_REJECTED'];
  snapshot.consistencyWarnings = ['ADVERSARIAL_JUDGMENT_REJECTED'];
  snapshot.consistencyFatalIssues = [];
  snapshot.adversarialJudgment = { accepted: false, confidence: .55, issues: [{ severity:'medium', code:'JUDGE_DISAGREEMENT', confidence:.6 }] };
  const db = fakeDb({
    [C.tasks]: { [taskId]: { _id: taskId, studentId, mode: 'HARD_PROBLEM_CHECK', status: 'COMPLETED', resultId: taskId } },
    [C.hardProblemDiagnostics]: { [taskId]: { _id: taskId, studentId, diagnosticSnapshot: snapshot } }
  });
  context.db = db;
  const service = createHardProblemTrainingService({ gradingWorkerRequest: workerStub() });
  const started = await service.start({ taskId }, { userId: studentId, role: 'student', status: 'ACTIVE' });
  assert.equal(started.session.phase, 'BOTTLENECK');
});
