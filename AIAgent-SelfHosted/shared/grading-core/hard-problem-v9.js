'use strict';

const { createHash } = require('node:crypto');

const VERSION = 'hard-problem-learning-engine.v9';
const ACCEPT_CONFIDENCE = 0.86;
const VERIFY_CONFIDENCE = 0.92;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp01(value, fallback = 0) { return Math.max(0, Math.min(1, number(value, fallback))); }
function array(value) { return Array.isArray(value) ? value : []; }
function uniq(values) { return [...new Set(values.filter(Boolean))]; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function sha(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function err(code, message, fieldPath, details = {}) {
  return Object.assign(new Error(message), { code, fieldPath: fieldPath || null, ...details });
}

function normalizeEvidenceUnit(unit, index, kind) {
  if (!unit || typeof unit !== 'object' || Array.isArray(unit)) throw err('HARD_PROBLEM_V9_EVIDENCE_INVALID', '学生证据单元无效', `${kind}Units[${index}]`);
  const unitId = text(unit.unitId) || `${kind === 'process' ? 'P' : 'E'}${index + 1}`;
  const sourceText = text(unit.text);
  const readability = ['readable', 'uncertain', 'unreadable'].includes(unit.readability) ? unit.readability : (sourceText ? 'readable' : 'unreadable');
  if (!sourceText && readability !== 'unreadable') throw err('HARD_PROBLEM_V9_EVIDENCE_INVALID', '可读学生证据不得为空', `${kind}Units[${index}].text`);
  return Object.freeze({
    unitId,
    type: kind,
    text: sourceText,
    order: Math.max(1, Math.floor(number(unit.order, index + 1))),
    sourceRegion: text(unit.sourceRegion),
    visualBand: Number.isFinite(Number(unit.visualBand)) ? Number(unit.visualBand) : null,
    readability,
    confidence: clamp01(unit.confidence, readability === 'readable' ? 0.9 : 0.4),
    role: kind === 'process' ? text(unit.role) || 'unknown' : undefined,
    label: kind === 'explanation' ? text(unit.label) : undefined
  });
}

function normalizeEvidenceQuestion(question, index) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) throw err('HARD_PROBLEM_V9_EVIDENCE_INVALID', '学生证据题目无效', `questions[${index}]`);
  const sourceKey = text(question.sourceKey) || `Q${index + 1}`;
  const processUnits = array(question.processUnits).map((unit, i) => normalizeEvidenceUnit(unit, i, 'process')).sort((a, b) => a.order - b.order);
  const explanationUnits = array(question.explanationUnits).map((unit, i) => normalizeEvidenceUnit(unit, i, 'explanation')).sort((a, b) => a.order - b.order);
  const ids = [...processUnits, ...explanationUnits].map((unit) => unit.unitId);
  if (new Set(ids).size !== ids.length) throw err('HARD_PROBLEM_V9_EVIDENCE_INVALID', '学生证据 unitId 重复', `questions[${index}]`);
  const studentAnswer = text(question.studentAnswer);
  const studentWorkDetected = question.studentWorkDetected === true || Boolean(studentAnswer || processUnits.some((u) => u.text) || explanationUnits.some((u) => u.text));
  const evidenceQuality = clamp01(question.evidenceQuality ?? question.confidence, studentWorkDetected ? 0.9 : 0.75);
  return Object.freeze({
    sourceKey,
    questionText: text(question.questionText),
    studentAnswer,
    studentWorkDetected,
    sourceQuestionLabel: text(question.sourceQuestionLabel) || `第${index + 1}题`,
    sourceRegion: text(question.sourceRegion),
    inputBasis: text(question.inputBasis) || (studentWorkDetected ? 'work_detected' : 'printed_question_without_work'),
    processUnits: Object.freeze(processUnits),
    explanationUnits: Object.freeze(explanationUnits),
    evidenceQuality,
    verificationState: text(question.verificationState) || 'unverified',
    warnings: Object.freeze(uniq(array(question.warnings).map(text)))
  });
}

function normalizeStudentEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw err('HARD_PROBLEM_V9_EVIDENCE_INVALID', 'StudentEvidence 必须是对象', '$');
  const questions = array(value.questions).map(normalizeEvidenceQuestion);
  if (!questions.length) throw err('HARD_PROBLEM_V9_EVIDENCE_INVALID', 'StudentEvidence 未识别到题目', 'questions');
  const keys = questions.map((q) => q.sourceKey);
  if (new Set(keys).size !== keys.length) throw err('HARD_PROBLEM_V9_EVIDENCE_INVALID', 'sourceKey 重复', 'questions');
  const normalized = { version: VERSION, kind: 'StudentEvidence', questions, createdAt: text(value.createdAt) || new Date().toISOString() };
  return Object.freeze({ ...normalized, evidenceFingerprint: sha(normalized) });
}

function shouldVerifyEvidence(evidence) {
  const e = normalizeStudentEvidence(evidence);
  return e.questions.some((q) => q.evidenceQuality < VERIFY_CONFIDENCE
    || [...q.processUnits, ...q.explanationUnits].some((u) => u.readability !== 'readable' || u.confidence < VERIFY_CONFIDENCE)
    || (!q.questionText && q.studentWorkDetected));
}

function applyEvidenceVerification(evidence, verification) {
  const base = normalizeStudentEvidence(evidence);
  if (!verification || typeof verification !== 'object') return base;
  const decisions = new Map(array(verification.decisions).map((item) => [`${text(item.sourceKey)}\u0000${text(item.unitId)}`, item]));
  const questions = base.questions.map((q) => {
    const update = (unit) => {
      const decision = decisions.get(`${q.sourceKey}\u0000${unit.unitId}`);
      if (!decision) return unit;
      const confirmedText = text(decision.confirmedText);
      const agrees = decision.agreesWithExtraction === true || (!confirmedText || confirmedText === unit.text);
      if (!agrees && confirmedText && unit.text && confirmedText !== unit.text) {
        return Object.freeze({ ...unit, readability: 'uncertain', confidence: Math.min(unit.confidence, 0.49), verificationConflict: true, verifierCandidateText: confirmedText });
      }
      return Object.freeze({ ...unit, confidence: Math.max(unit.confidence, clamp01(decision.confidence, 0.95)), verificationConfirmed: true });
    };
    const processUnits = q.processUnits.map(update);
    const explanationUnits = q.explanationUnits.map(update);
    const conflict = [...processUnits, ...explanationUnits].some((u) => u.verificationConflict);
    return Object.freeze({ ...q, processUnits: Object.freeze(processUnits), explanationUnits: Object.freeze(explanationUnits), verificationState: conflict ? 'conflict' : 'verified', evidenceQuality: conflict ? Math.min(q.evidenceQuality, 0.49) : Math.max(q.evidenceQuality, 0.94) });
  });
  const normalized = { version: VERSION, kind: 'StudentEvidence', questions, createdAt: base.createdAt };
  return Object.freeze({ ...normalized, evidenceFingerprint: sha(normalized) });
}

function normalizeMethodFingerprint(value, sourceKeys = []) {
  const byKey = new Map(array(value?.questions).map((item) => [text(item.sourceKey), item]));
  return Object.freeze({
    version: VERSION,
    kind: 'MethodFingerprint',
    questions: Object.freeze(sourceKeys.map((sourceKey) => {
      const item = byKey.get(sourceKey) || {};
      return Object.freeze({ sourceKey, methodFamily: text(item.methodFamily) || 'unknown', coreRepresentation: text(item.coreRepresentation), confidence: clamp01(item.confidence, 0.5) });
    }))
  });
}

function normalizePlan(value, evidence, methodFingerprint) {
  const ev = normalizeStudentEvidence(evidence);
  const methodByKey = new Map(array(methodFingerprint?.questions).map((q) => [q.sourceKey, q]));
  const rawByKey = new Map(array(value?.questions).map((q) => [text(q.sourceKey), q]));
  const questions = ev.questions.map((eq) => {
    const raw = rawByKey.get(eq.sourceKey) || {};
    const rawSteps = array(raw.steps || raw.expectedSteps);
    if (!rawSteps.length) throw err('HARD_PROBLEM_V9_PLAN_INVALID', 'ReasoningPlan 缺少步骤', `questions.${eq.sourceKey}.steps`);
    const steps = rawSteps.map((step, index) => {
      const stepId = text(step.stepId) || `S${index + 1}`;
      const purpose = text(step.purpose);
      const expectedReasoning = text(step.expectedReasoning);
      if (!purpose || !expectedReasoning) throw err('HARD_PROBLEM_V9_PLAN_INVALID', 'ReasoningPlan 步骤缺少 purpose 或 expectedReasoning', `${eq.sourceKey}.${stepId}`);
      return Object.freeze({ stepId, order: Math.max(1, Math.floor(number(step.order, index + 1))), purpose, expectedReasoning, dependencies: Object.freeze(uniq(array(step.dependencies).map(text))) });
    }).sort((a, b) => a.order - b.order);
    if (new Set(steps.map((s) => s.stepId)).size !== steps.length) throw err('HARD_PROBLEM_V9_PLAN_INVALID', 'ReasoningPlan stepId 重复', eq.sourceKey);
    return Object.freeze({ sourceKey: eq.sourceKey, methodFingerprint: methodByKey.get(eq.sourceKey) || { sourceKey: eq.sourceKey, methodFamily: 'unknown', confidence: 0.5 }, steps: Object.freeze(steps), confidence: clamp01(raw.confidence, 0.9), planWarnings: Object.freeze(uniq(array(raw.warnings).map(text))) });
  });
  return Object.freeze({ version: VERSION, kind: 'ReasoningPlan', questions: Object.freeze(questions), planFingerprint: sha(questions) });
}

function auditPlan(plan, audit) {
  const decisions = new Map(array(audit?.questions).map((q) => [text(q.sourceKey), q]));
  const rejected = [];
  for (const q of array(plan?.questions)) {
    const decision = decisions.get(q.sourceKey);
    if (decision && decision.accepted === false) rejected.push({ sourceKey: q.sourceKey, reason: text(decision.reason) || 'plan_audit_rejected' });
  }
  return { accepted: rejected.length === 0, rejected };
}

function normalizeCoverage(value, evidence, plan) {
  const ev = normalizeStudentEvidence(evidence);
  const planQuestions = array(plan?.questions);
  const rawByKey = new Map(array(value?.questions).map((q) => [text(q.sourceKey), q]));
  const evidenceByQ = new Map(ev.questions.map((q) => [q.sourceKey, new Map([...q.processUnits, ...q.explanationUnits].map((u) => [u.unitId, u]))]));
  const coverageQuestions = planQuestions.map((pq) => {
    const raw = rawByKey.get(pq.sourceKey) || {};
    const validStepIds = new Set(pq.steps.map((s) => s.stepId));
    const validEvidence = evidenceByQ.get(pq.sourceKey) || new Map();
    const edges = [];
    for (const rawEdge of array(raw.edges || raw.coverageEdges)) {
      const stepId = text(rawEdge.stepId);
      const evidenceId = text(rawEdge.evidenceId || rawEdge.unitId);
      if (!validStepIds.has(stepId)) throw err('HARD_PROBLEM_V9_COVERAGE_INVALID', 'Coverage 引用未知 stepId', `${pq.sourceKey}.${stepId}`);
      if (!validEvidence.has(evidenceId)) throw err('HARD_PROBLEM_V9_COVERAGE_INVALID', 'Coverage 引用未知 evidenceId', `${pq.sourceKey}.${evidenceId}`);
      const unit = validEvidence.get(evidenceId);
      edges.push(Object.freeze({ stepId, evidenceId, evidenceType: unit.type, supportRole: text(rawEdge.supportRole) || 'supports', confidence: clamp01(rawEdge.confidence, 0.9) }));
    }
    const dedup = [];
    const seen = new Set();
    for (const edge of edges) {
      const key = `${edge.stepId}\u0000${edge.evidenceId}\u0000${edge.supportRole}`;
      if (!seen.has(key)) { seen.add(key); dedup.push(edge); }
    }
    return Object.freeze({ sourceKey: pq.sourceKey, edges: Object.freeze(dedup), confidence: clamp01(raw.confidence, dedup.length ? 0.9 : 0.7), warnings: Object.freeze(uniq(array(raw.warnings).map(text))) });
  });
  return Object.freeze({ version: VERSION, kind: 'EvidenceCoverage', questions: Object.freeze(coverageQuestions), coverageFingerprint: sha(coverageQuestions) });
}

function buildFixedAlignment(evidence, plan, coverage) {
  const ev = normalizeStudentEvidence(evidence);
  const planByKey = new Map(array(plan?.questions).map((q) => [q.sourceKey, q]));
  const coverageByKey = new Map(array(coverage?.questions).map((q) => [q.sourceKey, q]));
  const questions = ev.questions.map((eq) => {
    const pq = planByKey.get(eq.sourceKey);
    if (!pq) throw err('HARD_PROBLEM_V9_PLAN_INVALID', '缺少题目 Plan', eq.sourceKey);
    const edges = array(coverageByKey.get(eq.sourceKey)?.edges);
    const unitMap = new Map([...eq.processUnits, ...eq.explanationUnits].map((u) => [u.unitId, u]));
    const pairedSteps = pq.steps.map((step, index) => {
      const stepEdges = edges.filter((edge) => edge.stepId === step.stepId && edge.confidence >= 0.5);
      const processUnits = stepEdges.map((e) => unitMap.get(e.evidenceId)).filter((u) => u?.type === 'process').sort((a, b) => a.order - b.order);
      const explanationUnits = stepEdges.map((e) => unitMap.get(e.evidenceId)).filter((u) => u?.type === 'explanation').sort((a, b) => a.order - b.order);
      return Object.freeze({
        stepIndex: index + 1,
        expectedStepId: step.stepId,
        expectedPurpose: step.purpose,
        expectedReasoning: step.expectedReasoning,
        stepKind: 'expected',
        solutionText: uniq(processUnits.map((u) => u.text)).join('\n'),
        explanationText: uniq(explanationUnits.map((u) => u.text)).join('\n'),
        processUnitIds: Object.freeze(uniq(processUnits.map((u) => u.unitId))),
        explanationUnitIds: Object.freeze(uniq(explanationUnits.map((u) => u.unitId))),
        processReadability: processUnits.length ? (processUnits.some((u) => u.readability === 'unreadable') ? 'unreadable' : processUnits.some((u) => u.readability === 'uncertain') ? 'uncertain' : 'readable') : 'missing',
        explanationReadability: explanationUnits.length ? (explanationUnits.some((u) => u.readability === 'unreadable') ? 'unreadable' : explanationUnits.some((u) => u.readability === 'uncertain') ? 'uncertain' : 'readable') : 'missing',
        coverageConfidence: stepEdges.length ? Math.min(...stepEdges.map((e) => e.confidence)) : 0
      });
    });
    return Object.freeze({
      sourceKey: eq.sourceKey,
      layoutType: 'semantic_graph',
      questionText: eq.questionText,
      studentAnswer: eq.studentAnswer,
      studentWorkDetected: eq.studentWorkDetected,
      sourceQuestionLabel: eq.sourceQuestionLabel,
      sourceRegion: eq.sourceRegion,
      inputBasis: eq.inputBasis,
      modeApplicability: 'applicable',
      expectedSteps: pq.steps,
      pairedSteps: Object.freeze(pairedSteps),
      processUnits: eq.processUnits,
      explanationUnits: eq.explanationUnits,
      alignmentConfidence: clamp01(coverageByKey.get(eq.sourceKey)?.confidence, 0.7),
      alignmentWarnings: Object.freeze(uniq(array(coverageByKey.get(eq.sourceKey)?.warnings).map(text)))
    });
  });
  return Object.freeze({ version: 'hard-problem-evidence-coverage.v9', layoutType: 'semantic_graph', questions: Object.freeze(questions), _v9: true });
}

function stepSatisfaction(step, reviewStep = null) {
  const processCovered = array(step?.processUnitIds).length > 0;
  const explanationCovered = array(step?.explanationUnitIds).length > 0;
  const coveragePresent = processCovered || explanationCovered;
  const reviewSupports = reviewStep && reviewStep.solutionStatus !== 'unreadable' && reviewStep.explanationStatus !== 'unreadable';
  return {
    processCovered,
    explanationCovered,
    satisfactionStatus: !coveragePresent ? 'missing' : (reviewSupports === false ? 'uncertain' : 'covered')
  };
}

function buildDiagnosticSnapshot({ evidence, method, plan, coverage, alignment, reviewResult }) {
  const reviewByKey = new Map(array(reviewResult?.questions).map((q) => [text(q.sourceKey), q]));
  const diagnoses = [];
  for (const aq of array(alignment?.questions)) {
    const rq = reviewByKey.get(aq.sourceKey) || {};
    const reviewSteps = array(rq.stepFeedbacks);
    aq.pairedSteps.forEach((step, index) => {
      const reviewStep = reviewSteps[index] || {};
      const satisfaction = stepSatisfaction(step, reviewStep);
      diagnoses.push({
        sourceKey: aq.sourceKey,
        stepId: step.expectedStepId,
        stepIndex: step.stepIndex,
        purpose: step.expectedPurpose,
        satisfactionStatus: satisfaction.satisfactionStatus,
        processStatus: text(reviewStep.solutionStatus) || (satisfaction.processCovered ? 'unknown' : 'missing'),
        explanationStatus: text(reviewStep.explanationStatus) || (satisfaction.explanationCovered ? 'unknown' : 'missing'),
        logicStatus: text(reviewStep.logicStatus) || 'insufficient',
        calculationCorrect: reviewStep.solutionStatus === 'correct' ? true : reviewStep.solutionStatus === 'wrong' ? false : null,
        conditionUseCorrect: reviewStep.logicStatus === 'clear' ? true : reviewStep.logicStatus === 'wrong' ? false : null,
        reasoningExplained: ['clear', 'partially_clear'].includes(reviewStep.explanationStatus),
        continuityClear: reviewStep.logicStatus === 'clear',
        answerCopyingDetected: null,
        ownWordsClear: reviewStep.explanationStatus === 'clear',
        bottleneckType: satisfaction.satisfactionStatus === 'missing' ? 'missing_step' : reviewStep.solutionStatus === 'wrong' ? 'calculation_or_method' : ['incorrect', 'missing'].includes(reviewStep.explanationStatus) ? 'explanation' : reviewStep.logicStatus !== 'clear' ? 'logic' : 'none',
        feedback: text(reviewStep.analysis),
        correctionAdvice: text(reviewStep.correctionAdvice),
        confidence: Math.min(clamp01(aq.alignmentConfidence, 0.7), clamp01(reviewStep.confidence, 0.9))
      });
    });
    if (rq.finalAnswerCorrect === false && diagnoses.filter((d) => d.sourceKey === aq.sourceKey).every((d) => d.bottleneckType === 'none')) {
      diagnoses.push({ sourceKey: aq.sourceKey, stepId: 'FINAL_ANSWER', stepIndex: aq.pairedSteps.length + 1, purpose: '核对最终答案', satisfactionStatus: aq.studentAnswer ? 'covered' : 'missing', processStatus: 'unknown', explanationStatus: 'unknown', logicStatus: 'insufficient', calculationCorrect: false, conditionUseCorrect: null, reasoningExplained: false, continuityClear: false, answerCopyingDetected: null, ownWordsClear: false, bottleneckType: 'final_answer', feedback: '前面推理未发现明显错误，但最终答案仍需核对。', correctionAdvice: '重新检查最后一步计算、单位和作答。', confidence: 0.9 });
    }
  }
  const active = diagnoses.find((d) => d.bottleneckType !== 'none') || null;
  const snapshot = { version: VERSION, kind: 'DiagnosticSnapshot', evidence, method, plan, coverage, diagnoses, activeBottleneckCandidate: active ? { sourceKey: active.sourceKey, stepId: active.stepId, bottleneckType: active.bottleneckType } : null, consistencyStatus: 'pending', createdAt: new Date().toISOString() };
  const checked = consistencyGate(snapshot, alignment, reviewResult);
  return { ...snapshot, consistencyStatus: checked.ok ? 'ok' : 'blocked', consistencyIssues: checked.issues, snapshotId: sha({ evidence: evidence.evidenceFingerprint, plan: plan.planFingerprint, coverage: coverage.coverageFingerprint, diagnoses }) };
}

function consistencyGate(snapshot, alignment, reviewResult) {
  const issues = [];
  const evidenceByKey = new Map(array(snapshot?.evidence?.questions).map((q) => [q.sourceKey, q]));
  for (const aq of array(alignment?.questions)) {
    const eq = evidenceByKey.get(aq.sourceKey);
    if (eq && eq.studentWorkDetected === false && (eq.studentAnswer || eq.processUnits.length || eq.explanationUnits.length)) issues.push(`WORK_DETECTION_CONFLICT:${aq.sourceKey}`);
    const rq = array(reviewResult?.questions).find((q) => text(q.sourceKey) === aq.sourceKey);
    if (rq && array(rq.stepFeedbacks).length !== aq.pairedSteps.length) issues.push(`STEP_COUNT_CONFLICT:${aq.sourceKey}`);
    aq.pairedSteps.forEach((step) => {
      const diagnosis = array(snapshot?.diagnoses).find((d) => d.sourceKey === aq.sourceKey && d.stepId === step.expectedStepId);
      if ((step.processUnitIds.length || step.explanationUnitIds.length) && diagnosis?.satisfactionStatus === 'missing') issues.push(`COVERED_STEP_MARKED_MISSING:${aq.sourceKey}:${step.expectedStepId}`);
    });
  }
  return { ok: issues.length === 0, issues };
}

function publicDiagnostic(snapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    diagnoses: array(snapshot.diagnoses).map(({ sourceKey, stepId, stepIndex, purpose, satisfactionStatus, processStatus, explanationStatus, logicStatus, bottleneckType, feedback, correctionAdvice, confidence }) => ({ sourceKey, stepId, stepIndex, purpose, satisfactionStatus, processStatus, explanationStatus, logicStatus, bottleneckType, feedback, correctionAdvice, confidence })),
    activeBottleneckCandidate: snapshot.activeBottleneckCandidate,
    consistencyStatus: snapshot.consistencyStatus
  };
}

module.exports = {
  VERSION, ACCEPT_CONFIDENCE, VERIFY_CONFIDENCE,
  normalizeStudentEvidence, shouldVerifyEvidence, applyEvidenceVerification,
  normalizeMethodFingerprint, normalizePlan, auditPlan, normalizeCoverage,
  buildFixedAlignment, stepSatisfaction, buildDiagnosticSnapshot, consistencyGate,
  publicDiagnostic, sha
};
