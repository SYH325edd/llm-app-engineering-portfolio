'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/hard-problem-training-core');

function snapshot() {
  return {
    snapshotId: 'snap-v10', version: 'hard-problem-evidence-causal-mastery.v10', consistencyStatus: 'ok',
    causalBottleneckCandidate: { sourceKey: 'Q1', stepId: 'N1', nodeId: 'N1', bottleneckType: 'quantity_relation', purpose: '建立数量关系', dependencies: [], causalScore: 12 },
    diagnoses: [
      { sourceKey: 'Q1', stepId: 'N1', nodeId: 'N1', stepIndex: 1, purpose: '建立数量关系', dependencies: [], dependents: ['N2'], satisfactionStatus: 'covered', processStatus: 'wrong', explanationStatus: 'incorrect', logicStatus: 'wrong', bottleneckType: 'quantity_relation', feedback: '关系错误', correctionAdvice: '先说明总量关系' },
      { sourceKey: 'Q1', stepId: 'N2', nodeId: 'N2', stepIndex: 2, purpose: '继续计算', dependencies: ['N1'], dependents: [], satisfactionStatus: 'covered', processStatus: 'wrong', explanationStatus: 'incorrect', logicStatus: 'wrong', bottleneckType: 'calculation_or_method', feedback: '后续错误', correctionAdvice: '检查计算' }
    ],
    plan: { questions: [{ sourceKey: 'Q1', steps: [
      { stepId: 'N1', purpose: '建立数量关系', expectedReasoning: '总量等于两部分之和', hintScaffold: '回到题目条件，找两类数量与总量的关系', dependencies: [] },
      { stepId: 'N2', purpose: '继续计算', expectedReasoning: '依据前面的数量关系计算', hintScaffold: '使用前一步得到的数量关系继续求未知量', dependencies: ['N1'] }
    ] }] }
  };
}

function auditedVariants() {
  const variants = [
    { variantId: 'V1', transferLevel: 'near', questionText: '近迁移', standardAnswer: '1', expectedReasoning: 'r1', confidence: .95 },
    { variantId: 'V2', transferLevel: 'middle', questionText: '中迁移', standardAnswer: '2', expectedReasoning: 'r2', confidence: .95 },
    { variantId: 'V3', transferLevel: 'far', questionText: '远迁移', standardAnswer: '3', expectedReasoning: 'r3', confidence: .95 }
  ];
  const audit = { variants: variants.map((v) => ({ variantId: v.variantId, accepted: true, answerVerified: true, reasoningVerified: true, transferVerified: true, leakageDetected: false, confidence: .95 })) };
  return { variants, audit };
}

test('V10 training chooses the upstream causal bottleneck and H1-H3 never reveal expected reasoning', () => {
  const s0 = core.createSession({ taskId: 't', studentId: 'u', snapshot: snapshot() });
  assert.equal(s0.activeBottleneck.stepId, 'N1');
  const expected = '总量等于两部分之和';
  const h1 = core.deterministicHint({ bottleneck: s0.activeBottleneck, hintLevel: 1, expectedReasoning: expected });
  const h2 = core.deterministicHint({ bottleneck: s0.activeBottleneck, hintLevel: 2, expectedReasoning: expected });
  const h3 = core.deterministicHint({ bottleneck: s0.activeBottleneck, hintLevel: 3, expectedReasoning: expected, hintScaffold: '回到题目条件，找两类数量与总量的关系' });
  const h4 = core.deterministicHint({ bottleneck: s0.activeBottleneck, hintLevel: 4, expectedReasoning: expected });
  assert.match(h1, /题目现在要求/); assert.equal(h1.includes(expected), false);
  assert.equal(h2.includes(expected), false); assert.equal(h3.includes(expected), false); assert.match(h3, /两类数量与总量/);
  assert.equal(h4.includes(expected), true);
});

test('V10 state machine rejects illegal jumps and requires bottlenecks then retell before variants', () => {
  let s = core.createSession({ taskId: 't', studentId: 'u', snapshot: snapshot() });
  assert.throws(() => core.transition(s, { phase: 'MASTERED' }, 'ILLEGAL'), /非法训练状态跳转/);
  s = core.applyBottleneckEvaluation(s, snapshot(), { passed: true, reasoningExplained: true, ownWordsClear: true, copiedAnswerLikely: false, confidence: .95, feedback: 'N1清楚' });
  assert.equal(s.activeBottleneck.stepId, 'N2');
  s = core.applyBottleneckEvaluation(s, snapshot(), { passed: true, reasoningExplained: true, ownWordsClear: true, copiedAnswerLikely: false, confidence: .95, feedback: 'N2清楚' });
  assert.equal(s.phase, 'RETELL');
  s = core.applyRetellEvaluation(s, { passed: true, copiedAnswerLikely: false, confidence: .95, missingStepIds: [] });
  assert.equal(s.phase, 'VARIANTS');
});

test('V10 L4 requires independently audited V1→V2→V3 and preserves peak mastery after later review failure', () => {
  let s = core.createSession({ taskId: 't', studentId: 'u', snapshot: { ...snapshot(), causalBottleneckCandidate: null, diagnoses: [] } });
  assert.equal(s.phase, 'RETELL');
  s = core.applyRetellEvaluation(s, { passed: true, copiedAnswerLikely: false, confidence: .95, missingStepIds: [] });
  const { variants, audit } = auditedVariants();
  assert.equal(core.validateVariantAudit(core.validateVariants(variants), audit).accepted, true);
  s = core.attachVariants(s, variants, audit);
  assert.throws(() => core.applyVariantEvaluation(s, 'V2', { answerCorrect: true, reasoningCorrect: true, confidence: .95 }), /V1/);
  s = core.applyVariantEvaluation(s, 'V1', { answerCorrect: true, reasoningCorrect: true, confidence: .95 });
  s = core.applyVariantEvaluation(s, 'V2', { answerCorrect: true, reasoningCorrect: true, confidence: .95 });
  s = core.applyVariantEvaluation(s, 'V3', { answerCorrect: true, reasoningCorrect: true, confidence: .95 });
  assert.equal(s.masteryLevel, 'L4'); assert.equal(s.peakMasteryLevel, 'L4'); assert.equal(s.reachedL4Ever, true);
  let record = core.createLearningRecord({ taskId: 't', studentId: 'u', snapshot: snapshot(), session: s, now: new Date('2026-01-01T00:00:00Z') });
  record = core.refreshLearningRecord(record, s, new Date('2026-01-01T00:00:00Z'));
  const day1 = record.reviewSchedule[0];
  record = { ...record, reviewSchedule: record.reviewSchedule.map((r, i) => i === 0 ? { ...r, challengeId: 'R1', challenge: { challengeId: 'R1' } } : r) };
  record = core.applyReviewOutcomeToRecord(record, { day: day1.day, challengeId: 'R1', passed: false, feedback: '需要巩固' });
  s = core.applyReviewFailureToSession(s, snapshot());
  assert.equal(record.peakMasteryLevel, 'L4'); assert.equal(record.reachedL4Ever, true); assert.equal(record.currentRetentionStatus, 'NEEDS_REINFORCEMENT');
  assert.equal(s.peakMasteryLevel, 'L4'); assert.equal(s.reachedL4Ever, true); assert.equal(s.phase, 'BOTTLENECK');
});

test('V10 variant audit rejects mathematically unaudited or leaking variants', () => {
  const { variants, audit } = auditedVariants();
  const clean = core.validateVariants(variants);
  const bad = JSON.parse(JSON.stringify(audit)); bad.variants[2].leakageDetected = true;
  assert.equal(core.validateVariantAudit(clean, bad).accepted, false);
  const bad2 = JSON.parse(JSON.stringify(audit)); bad2.variants[1].answerVerified = false;
  assert.equal(core.validateVariantAudit(clean, bad2).accepted, false);
});

test('public V10 session strips solution-bearing bottleneck fields, provenance internals, and recursive cached responses', () => {
  let s = core.createSession({ taskId: 't', studentId: 'u', snapshot: snapshot() });
  s = { ...s, lastRequestId: 'req-private', lastResponse: { session: { lastResponse: { secret: true } } }, diagnosticSnapshotId: 'secret-snapshot', evidenceEvents: [{ private: true }], transitionLog: [{ private: true }] };
  let pub = core.publicSession(s); let serialized = JSON.stringify(pub);
  for (const forbidden of ['standardAnswer', 'expectedReasoning', 'hintScaffold', 'lastRequestId', 'lastResponse', 'diagnosticSnapshotId', 'evidenceEvents', 'transitionLog', '关系错误', '先说明总量关系', '建立数量关系']) {
    assert.equal(serialized.includes(forbidden), false, `public session leaked ${forbidden}`);
  }
  assert.deepEqual(Object.keys(pub.activeBottleneck).sort(), ['bottleneckType', 'nodeId', 'sourceKey', 'stepId', 'stepIndex'].sort());

  s = core.createSession({ taskId: 't', studentId: 'u', snapshot: { ...snapshot(), causalBottleneckCandidate: null, diagnoses: [] } });
  s = core.applyRetellEvaluation(s, { passed: true, copiedAnswerLikely: false, confidence: .95, missingStepIds: [] });
  const { variants, audit } = auditedVariants(); s = core.attachVariants(s, variants, audit);
  pub = core.publicSession(s); serialized = JSON.stringify(pub);
  assert.equal(serialized.includes('standardAnswer'), false); assert.equal(serialized.includes('expectedReasoning'), false);
  assert.equal(pub.variants.length, 3);
});

test('H3 personalized scaffold is allowed only when it does not leak the expected reasoning', () => {
  const safe = core.deterministicHint({ bottleneck: { purpose: '建立关系' }, hintLevel: 3, expectedReasoning: '总量等于两部分之和', hintScaffold: '回到题目条件，找两类数量和总量之间的关系' });
  assert.match(safe, /两类数量和总量/);
  assert.throws(() => core.deterministicHint({ bottleneck: { purpose: '建立关系' }, hintLevel: 3, expectedReasoning: '总量等于两部分之和', hintScaffold: '总量等于两部分之和' }), /提示可能提前泄露答案/);
});

test('causal dependency ranking resolves ReasoningNode ids back to student-written step diagnoses', () => {
  const snap = {
    snapshotId: 'student-node-alias', consistencyStatus: 'ok',
    diagnoses: [
      { sourceKey:'Q1', stepId:'S1', nodeId:'N1', expectedNodeIds:['N1'], stepIndex:1, dependencies:[], dependents:['N2'], satisfactionStatus:'covered', processStatus:'wrong', explanationStatus:'missing', logicStatus:'wrong', bottleneckType:'quantity_relation' },
      { sourceKey:'Q1', stepId:'S2', nodeId:'N2', expectedNodeIds:['N2','N3'], stepIndex:2, dependencies:['N1'], dependents:[], satisfactionStatus:'covered', processStatus:'wrong', explanationStatus:'missing', logicStatus:'wrong', bottleneckType:'calculation_or_method' }
    ]
  };
  const first = core.selectInitialBottleneck(snap);
  assert.equal(first.stepId, 'S1');
  assert.equal(first.nodeId, 'N1');
  const second = core.nextBottleneck(snap, ['Q1:S1']);
  assert.equal(second.stepId, 'S2');
  assert.equal(second.nodeId, 'N2');
});
