'use strict';

const BRIEF = [
  '每次只看卡住的一步。',
  '不能照着标准答案复述。',
  '必须解释每一步为什么。',
  '最终需要脱离答案完整讲解。',
  '通过变式题才算真正掌握。'
];
const HINT_LEVELS = [0, 1, 2, 3, 4];
const VARIANT_IDS = ['V1', 'V2', 'V3'];
const REVIEW_DAYS = [1, 3, 7];
const SESSION_VERSION = 'hard-problem-training-session.v10';
const RECORD_VERSION = 'hard-problem-learning-record.v10';
const ALLOWED_PHASES = new Set(['BOTTLENECK', 'RETELL', 'VARIANTS', 'MASTERED']);
const ALLOWED_TRANSITIONS = Object.freeze({
  BOTTLENECK: new Set(['BOTTLENECK', 'RETELL']),
  RETELL: new Set(['RETELL', 'VARIANTS']),
  VARIANTS: new Set(['VARIANTS', 'BOTTLENECK', 'MASTERED']),
  MASTERED: new Set(['MASTERED', 'BOTTLENECK'])
});

function text(v) { return typeof v === 'string' ? v.trim() : ''; }
function arr(v) { return Array.isArray(v) ? v : []; }
function clampInt(v, min, max, fallback = min) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function nowIso(now = new Date()) { return new Date(now).toISOString(); }
function addDays(base, days) { const d = new Date(base); d.setDate(d.getDate() + days); return d.toISOString(); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function keyOf(d) { return `${text(d?.sourceKey)}:${text(d?.stepId || d?.nodeId)}`; }
function fail(code, message, details = {}) { throw Object.assign(new Error(message), { code, ...details }); }

function evidenceEventKey(event) {
  if (!event || typeof event !== 'object') return '';
  return [text(event.kind), text(event.key), text(event.variantId), text(event.challengeId), text(event.at), String(event.passed)].join('|');
}
function mergeEvidenceEvents(existing, incoming) {
  const out = []; const seen = new Set();
  for (const event of [...arr(existing), ...arr(incoming)]) {
    const key = evidenceEventKey(event) || JSON.stringify(event);
    if (seen.has(key)) continue;
    seen.add(key); out.push(event);
  }
  return out.slice(-500);
}

function diagnosisNeedsWork(d) {
  return Boolean(d && ((d.bottleneckType && d.bottleneckType !== 'none')
    || ['missing', 'conflicted'].includes(d.satisfactionStatus)
    || d.processStatus === 'wrong'
    || ['incorrect', 'missing'].includes(d.explanationStatus)
    || ['wrong', 'insufficient'].includes(d.logicStatus)));
}

function diagnosisMap(snapshot) {
  const map = new Map();
  for (const d of arr(snapshot?.diagnoses)) {
    const sourceKey = text(d?.sourceKey);
    const ids = [text(d?.stepId), text(d?.nodeId), ...arr(d?.expectedNodeIds).map(text)].filter(Boolean);
    for (const id of new Set(ids)) map.set(`${sourceKey}:${id}`, d);
  }
  return map;
}

function causalRank(snapshot, completedKeys = []) {
  const completed = new Set(arr(completedKeys).map(String));
  const diagnoses = arr(snapshot?.diagnoses).filter((d) => diagnosisNeedsWork(d) && !completed.has(keyOf(d)));
  const map = diagnosisMap(snapshot);
  return diagnoses.map((d) => {
    const deps = arr(d.dependencies).map((id) => `${text(d.sourceKey)}:${text(id)}`);
    const upstreamOpen = deps.filter((k) => diagnosisNeedsWork(map.get(k)) && !completed.has(k)).length;
    const downstreamOpen = arr(d.dependents).map((id) => `${text(d.sourceKey)}:${text(id)}`).filter((k) => diagnosisNeedsWork(map.get(k)) && !completed.has(k)).length;
    const intrinsic = d.satisfactionStatus === 'conflicted' ? 9 : d.satisfactionStatus === 'missing' ? 8 : d.processStatus === 'wrong' ? 8 : d.explanationStatus === 'incorrect' ? 7 : d.logicStatus === 'wrong' ? 7 : 5;
    return { d, score: intrinsic + downstreamOpen * 2 - upstreamOpen * 6 - Number(d.stepIndex || 0) * 0.001 };
  }).sort((a, b) => b.score - a.score || Number(a.d.stepIndex || 0) - Number(b.d.stepIndex || 0));
}

function toBottleneck(d, score = null) {
  if (!d) return null;
  return {
    sourceKey: text(d.sourceKey), stepId: text(d.stepId || d.nodeId), nodeId: text(d.nodeId || d.stepId),
    stepIndex: Number(d.stepIndex || 0), bottleneckType: text(d.bottleneckType) || 'reasoning',
    purpose: text(d.purpose), feedback: text(d.feedback), correctionAdvice: text(d.correctionAdvice),
    dependencies: arr(d.dependencies).map(text).filter(Boolean), causalScore: Number.isFinite(Number(score)) ? Number(score) : null
  };
}

function selectInitialBottleneck(snapshot) {
  const preferred = snapshot?.causalBottleneckCandidate;
  if (preferred) {
    const match = arr(snapshot?.diagnoses).find((d) => text(d.sourceKey) === text(preferred.sourceKey) && text(d.stepId || d.nodeId) === text(preferred.stepId || preferred.nodeId));
    if (match && diagnosisNeedsWork(match)) return toBottleneck(match, preferred.causalScore);
  }
  const ranked = causalRank(snapshot, []);
  return ranked.length ? toBottleneck(ranked[0].d, ranked[0].score) : null;
}

function nextBottleneck(snapshot, completedKeys = []) {
  const ranked = causalRank(snapshot, completedKeys);
  return ranked.length ? toBottleneck(ranked[0].d, ranked[0].score) : null;
}

function hintLeakageGuard({ hint, hintLevel, expectedReasoning = '' }) {
  const h = text(hint); const expected = text(expectedReasoning);
  const issues = [];
  if (!h) issues.push('EMPTY_HINT');
  if (hintLevel < 4 && expected && expected.length >= 6 && h.includes(expected)) issues.push('EARLY_EXPECTED_REASONING_LEAK');
  if (hintLevel < 4 && /最终答案|答案是|所以答案|直接得到/.test(h)) issues.push('EARLY_FINAL_ANSWER_LEAK');
  return { ok: issues.length === 0, issues };
}

function deterministicHint({ bottleneck, hintLevel, questionText = '', expectedReasoning = '', hintScaffold = '' }) {
  const level = clampInt(hintLevel, 1, 4, 1);
  let hint;
  if (level === 1) hint = '先不看答案。只回答一个问题：题目现在要求你求什么或说明什么？';
  else if (level === 2) hint = '为了完成当前目标，你还缺少哪个量、哪个条件、哪个关系，或者哪个中间结论？先把缺的东西说出来。';
  else if (level === 3) {
    const scaffold = text(hintScaffold);
    hint = scaffold
      ? `只提示当前一步的依据：${scaffold}。先不要继续完成后面的推导。`
      : '回到题目条件，找与当前目标直接相关的数量关系、定义、公式方向或推理依据。只说依据，先不要继续完成后面的推导。';
  } else {
    const reason = text(expectedReasoning);
    hint = reason ? `只看当前卡住的一步：${reason}` : `只看当前卡住的一步：${text(questionText) || text(bottleneck?.purpose) || '根据题目补全当前必要推理。'}`;
  }
  const guard = hintLeakageGuard({ hint, hintLevel: level, expectedReasoning });
  if (!guard.ok) fail('HINT_LEAKAGE_BLOCKED', '当前提示可能提前泄露答案，已阻止发送', { issues: guard.issues });
  return hint;
}

function assertTransition(from, to) {
  if (!ALLOWED_PHASES.has(from) || !ALLOWED_PHASES.has(to) || !ALLOWED_TRANSITIONS[from]?.has(to)) fail('TRAINING_STATE_TRANSITION_INVALID', `非法训练状态跳转: ${from} -> ${to}`);
}

function transition(session, patch, eventType, now = new Date()) {
  const from = text(session.phase); const to = text(patch.phase || from);
  assertTransition(from, to);
  const version = Math.max(1, Number(session.sessionVersion || 1)) + 1;
  const event = { eventId: `E${version}`, type: text(eventType) || 'STATE_UPDATE', from, to, at: nowIso(now) };
  return { ...session, ...patch, version: SESSION_VERSION, sessionVersion: version, transitionLog: [...arr(session.transitionLog).slice(-99), event], updatedAt: nowIso(now) };
}

function createSession({ taskId, studentId, snapshot, now = new Date() }) {
  const bottleneck = selectInitialBottleneck(snapshot);
  return {
    version: SESSION_VERSION, sessionVersion: 1,
    taskId: text(taskId), studentId: text(studentId), diagnosticSnapshotId: text(snapshot?.snapshotId),
    diagnosticRuntimeVersion: text(snapshot?.version || snapshot?.runtimeVersion),
    phase: bottleneck ? 'BOTTLENECK' : 'RETELL', activeBottleneck: bottleneck,
    completedBottlenecks: [], hintLevel: 0, hintCount: 0, maxHintLevel: 0,
    independentRetellStatus: 'NOT_STARTED', variants: [], masteryLevel: 'L1', peakMasteryLevel: 'L1',
    reachedL4: false, reachedL4Ever: false, currentRetentionStatus: 'TRAINING', status: 'ACTIVE', brief: BRIEF.slice(),
    transitionLog: [], evidenceEvents: [], createdAt: nowIso(now), updatedAt: nowIso(now)
  };
}

function applyBottleneckEvaluation(session, snapshot, evaluation, now = new Date()) {
  if (session.phase !== 'BOTTLENECK' || !session.activeBottleneck) fail('TRAINING_PHASE_INVALID', '当前没有待处理卡点');
  const passed = evaluation?.passed === true && evaluation?.reasoningExplained !== false && evaluation?.ownWordsClear !== false && evaluation?.copiedAnswerLikely !== true && Number(evaluation?.confidence || 0) >= 0.75;
  if (passed) {
    const key = keyOf(session.activeBottleneck);
    const completed = [...new Set([...arr(session.completedBottlenecks), key])];
    const more = nextBottleneck(snapshot, completed);
    return transition(session, {
      completedBottlenecks: completed, activeBottleneck: more, hintLevel: 0,
      phase: more ? 'BOTTLENECK' : 'RETELL', masteryLevel: more ? session.masteryLevel : 'L2',
      peakMasteryLevel: more ? session.peakMasteryLevel : (session.peakMasteryLevel === 'L1' ? 'L2' : session.peakMasteryLevel),
      lastFeedback: text(evaluation?.feedback),
      evidenceEvents: [...arr(session.evidenceEvents), { kind: 'BOTTLENECK_EXPLANATION', key, passed: true, confidence: Number(evaluation?.confidence || 0), at: nowIso(now) }]
    }, 'BOTTLENECK_PASSED', now);
  }
  const level = Math.min(4, Number(session.hintLevel || 0) + 1);
  return transition(session, {
    hintLevel: level,
    hintCount: Number(session.hintCount || 0) + 1,
    maxHintLevel: Math.max(Number(session.maxHintLevel || 0), level),
    lastFeedback: text(evaluation?.feedback),
    evidenceEvents: [...arr(session.evidenceEvents), { kind: 'BOTTLENECK_EXPLANATION', key: keyOf(session.activeBottleneck), passed: false, confidence: Number(evaluation?.confidence || 0), hintLevel: level, at: nowIso(now) }]
  }, 'BOTTLENECK_NEEDS_HINT', now);
}

function applyRetellEvaluation(session, evaluation, now = new Date()) {
  if (session.phase !== 'RETELL') fail('TRAINING_PHASE_INVALID', '当前不是完整复述阶段');
  const passed = evaluation?.passed === true && evaluation?.copiedAnswerLikely !== true && Number(evaluation?.confidence || 0) >= 0.78 && arr(evaluation?.missingStepIds).length === 0;
  return transition(session, {
    independentRetellStatus: passed ? 'PASSED' : 'FAILED',
    phase: passed ? 'VARIANTS' : 'RETELL',
    masteryLevel: passed ? 'L3' : 'L2',
    peakMasteryLevel: passed && ['L1', 'L2'].includes(session.peakMasteryLevel) ? 'L3' : session.peakMasteryLevel,
    lastFeedback: text(evaluation?.feedback),
    evidenceEvents: [...arr(session.evidenceEvents), { kind: 'INDEPENDENT_RETELL', passed, confidence: Number(evaluation?.confidence || 0), missingStepIds: arr(evaluation?.missingStepIds).map(text), at: nowIso(now) }]
  }, passed ? 'RETELL_PASSED' : 'RETELL_FAILED', now);
}

function validateVariants(variants) {
  const rows = arr(variants);
  if (rows.length !== 3) fail('VARIANT_COUNT_INVALID', '必须生成3道变式题');
  const map = new Map(rows.map((v) => [text(v.variantId), v]));
  const levels = { V1: 'near', V2: 'middle', V3: 'far' };
  return VARIANT_IDS.map((id) => {
    const v = map.get(id);
    if (!v || text(v.transferLevel) !== levels[id] || !text(v.questionText) || !text(v.standardAnswer) || !text(v.expectedReasoning) || Number(v.confidence || 0) < 0.80) fail('VARIANT_INVALID', `变式题无效: ${id}`, { variantId: id });
    return { variantId: id, transferLevel: levels[id], questionText: text(v.questionText), standardAnswer: text(v.standardAnswer), expectedReasoning: text(v.expectedReasoning), knowledgePoints: arr(v.knowledgePoints).map(text).filter(Boolean), confidence: Number(v.confidence), auditConfidence: null, status: 'PENDING', answerCorrect: null, reasoningCorrect: null, submittedAt: null };
  });
}

function validateVariantAudit(variants, audit) {
  const auditRows = arr(audit?.variants);
  const auditMap = new Map(auditRows.map((v) => [text(v.variantId), v]));
  const actualIds = variants.map((v) => v.variantId);
  if (actualIds.join(',') !== VARIANT_IDS.join(',')) return { accepted: false, reason: 'variant_ids_invalid' };
  if (auditRows.length !== 3 || new Set(auditRows.map((v) => text(v.variantId))).size !== 3) return { accepted: false, reason: 'variant_audit_binding_invalid' };
  for (const id of VARIANT_IDS) {
    const row = auditMap.get(id);
    if (!row || row.accepted !== true || row.answerVerified !== true || row.reasoningVerified !== true || row.transferVerified !== true || row.leakageDetected === true || Number(row.confidence || 0) < 0.82) return { accepted: false, reason: text(row?.reason) || `audit_rejected:${id}` };
  }
  return { accepted: true, reason: '', byVariant: Object.fromEntries(VARIANT_IDS.map((id) => [id, Number(auditMap.get(id).confidence || 0)])) };
}

function attachVariants(session, variants, audit = null, now = new Date()) {
  if (session.phase !== 'VARIANTS' || session.independentRetellStatus !== 'PASSED') fail('TRAINING_PHASE_INVALID', '变式阶段尚未开启');
  const validated = validateVariants(variants);
  if (audit) {
    const check = validateVariantAudit(validated, audit);
    if (!check.accepted) fail('VARIANT_AUDIT_FAILED', '变式题质量审计未通过', { reason: check.reason });
    for (const v of validated) v.auditConfidence = check.byVariant[v.variantId];
  }
  return transition(session, { variants: validated }, 'VARIANTS_ATTACHED', now);
}

function nextPendingVariantId(variants) { return arr(variants).find((v) => v.status !== 'COMPLETED')?.variantId || null; }

function applyVariantEvaluation(session, variantId, evaluation, now = new Date()) {
  if (session.phase !== 'VARIANTS') fail('TRAINING_PHASE_INVALID', '当前不是变式题阶段');
  const id = text(variantId);
  if (!VARIANT_IDS.includes(id)) fail('VARIANT_ID_INVALID', '变式题编号无效');
  const expected = nextPendingVariantId(session.variants);
  if (expected && id !== expected) fail('VARIANT_SEQUENCE_INVALID', `请按 V1→V2→V3 顺序完成，当前应提交 ${expected}`);
  let found = false;
  const variants = arr(session.variants).map((v) => {
    if (v.variantId !== id) return v;
    found = true;
    if (v.status === 'COMPLETED') return v;
    return { ...v, status: 'COMPLETED', answerCorrect: evaluation?.answerCorrect === true, reasoningCorrect: evaluation?.reasoningCorrect === true, feedback: text(evaluation?.feedback), evaluationConfidence: Number(evaluation?.confidence || 0), submittedAt: nowIso(now) };
  });
  if (!found) fail('VARIANT_NOT_FOUND', '变式题不存在');
  const allDone = variants.length === 3 && variants.every((v) => v.status === 'COMPLETED');
  const allCorrect = allDone && variants.every((v) => v.answerCorrect === true && v.reasoningCorrect === true && Number(v.evaluationConfidence || 0.8) >= 0.75);
  if (!allDone) return transition(session, { variants, evidenceEvents: [...arr(session.evidenceEvents), { kind: 'VARIANT', variantId: id, passed: variants.find((v) => v.variantId === id).answerCorrect && variants.find((v) => v.variantId === id).reasoningCorrect, at: nowIso(now) }] }, 'VARIANT_SUBMITTED', now);
  if (allCorrect && session.independentRetellStatus === 'PASSED') {
    return transition(session, {
      variants, masteryLevel: 'L4', peakMasteryLevel: 'L4', reachedL4: true, reachedL4Ever: true,
      currentRetentionStatus: 'MASTERED', phase: 'MASTERED', status: 'MASTERED', activeBottleneck: null,
      evidenceEvents: [...arr(session.evidenceEvents), { kind: 'MASTERY_L4', passed: true, at: nowIso(now) }]
    }, 'L4_REACHED', now);
  }
  const failed = variants.filter((v) => !(v.answerCorrect && v.reasoningCorrect));
  const transferOnly = failed.length === 1 && failed[0].transferLevel === 'far';
  const activeBottleneck = transferOnly
    ? { sourceKey: 'TRANSFER', stepId: 'TRANSFER', nodeId: 'TRANSFER', stepIndex: 999, bottleneckType: 'transfer', purpose: '把已学方法迁移到新情境', dependencies: [] }
    : session.activeBottleneck || { sourceKey: 'TRANSFER', stepId: 'REINFORCE', nodeId: 'REINFORCE', stepIndex: 998, bottleneckType: 'variant_failure', purpose: '重新解释并修复变式题暴露的关键理解', dependencies: [] };
  return transition(session, {
    variants, masteryLevel: 'L3', reachedL4: false, currentRetentionStatus: 'TRAINING', status: 'ACTIVE', phase: 'BOTTLENECK', activeBottleneck,
    evidenceEvents: [...arr(session.evidenceEvents), { kind: 'MASTERY_L4', passed: false, failedVariantIds: failed.map((v) => v.variantId), at: nowIso(now) }]
  }, 'VARIANTS_REQUIRE_REINFORCEMENT', now);
}

function buildReviewSchedule(masteredAt = new Date()) {
  return REVIEW_DAYS.map((day) => ({ day, dueAt: addDays(masteredAt, day), status: 'PENDING', challengeId: null, challenge: null, result: null }));
}

function masteryFromSession(session) {
  if (session.reachedL4 && session.masteryLevel === 'L4') return 'L4';
  if (session.independentRetellStatus === 'PASSED') return 'L3';
  if (arr(session.completedBottlenecks).length > 0 || session.phase === 'RETELL') return 'L2';
  return 'L1';
}

function publicSession(session) {
  const forbidden = new Set([
    'standardAnswer', 'expectedReasoning', 'hintScaffold',
    'lastRequestId', 'lastResponse', 'evidenceEvents', 'transitionLog',
    'diagnosticSnapshotId', 'diagnosticRuntimeVersion'
  ]);
  function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([k]) => !forbidden.has(k)).map(([k, v]) => [k, clean(v)]));
  }
  const safeActiveBottleneck = session?.activeBottleneck ? {
    sourceKey: text(session.activeBottleneck.sourceKey),
    stepId: text(session.activeBottleneck.stepId || session.activeBottleneck.nodeId),
    nodeId: text(session.activeBottleneck.nodeId || session.activeBottleneck.stepId),
    stepIndex: Number(session.activeBottleneck.stepIndex || 0),
    bottleneckType: text(session.activeBottleneck.bottleneckType) || 'reasoning'
  } : null;
  return clean({ ...session, activeBottleneck: safeActiveBottleneck, masteryLevel: masteryFromSession(session) });
}

function createLearningRecord({ taskId, studentId, snapshot, session, now = new Date() }) {
  const diagnoses = arr(snapshot?.diagnoses);
  const initial = selectInitialBottleneck(snapshot);
  return {
    version: RECORD_VERSION, taskId: text(taskId), studentId: text(studentId), diagnosticSnapshotId: text(snapshot?.snapshotId),
    knowledgePoints: [...new Set(arr(snapshot?.plan?.questions).flatMap((q) => arr(q.steps).flatMap((s) => arr(s.knowledgePoints))).map(text).filter(Boolean))],
    initialBottleneck: initial, errorCause: initial?.bottleneckType || 'none',
    weakStepIds: diagnoses.filter(diagnosisNeedsWork).map((d) => text(d.stepId || d.nodeId)).filter(Boolean),
    hintCount: Number(session?.hintCount || 0), maxHintLevel: Number(session?.maxHintLevel || 0),
    independentRetellPassed: session?.independentRetellStatus === 'PASSED', variantTotal: 3,
    variantCorrectCount: arr(session?.variants).filter((v) => v.answerCorrect && v.reasoningCorrect).length,
    masteryLevel: masteryFromSession(session || {}), peakMasteryLevel: text(session?.peakMasteryLevel) || masteryFromSession(session || {}),
    reachedL4: session?.reachedL4 === true, reachedL4Ever: session?.reachedL4Ever === true,
    currentRetentionStatus: text(session?.currentRetentionStatus) || 'TRAINING',
    nextReviewAt: null, reviewSchedule: [], reviewHistory: [], learningEvidence: arr(session?.evidenceEvents),
    status: session?.reachedL4 ? 'MASTERED' : 'TRAINING', createdAt: nowIso(now), updatedAt: nowIso(now)
  };
}

function refreshLearningRecord(record, session, now = new Date()) {
  const currentL4 = session.reachedL4 === true && session.masteryLevel === 'L4';
  const reachedL4Ever = record.reachedL4Ever === true || session.reachedL4Ever === true || currentL4;
  const peak = reachedL4Ever ? 'L4' : (text(session.peakMasteryLevel) || record.peakMasteryLevel || masteryFromSession(session));
  const schedule = reachedL4Ever && !arr(record.reviewSchedule).length ? buildReviewSchedule(now) : arr(record.reviewSchedule);
  const next = schedule.find((r) => r.status === 'PENDING');
  return { ...record,
    hintCount: Number(session.hintCount || 0), maxHintLevel: Number(session.maxHintLevel || 0),
    independentRetellPassed: session.independentRetellStatus === 'PASSED',
    variantCorrectCount: arr(session.variants).filter((v) => v.answerCorrect && v.reasoningCorrect).length,
    masteryLevel: masteryFromSession(session), peakMasteryLevel: peak, reachedL4: currentL4, reachedL4Ever,
    currentRetentionStatus: text(session.currentRetentionStatus) || (currentL4 ? 'MASTERED' : record.currentRetentionStatus || 'TRAINING'),
    status: currentL4 ? 'MASTERED' : record.status === 'NEEDS_REINFORCEMENT' ? 'NEEDS_REINFORCEMENT' : 'TRAINING',
    reviewSchedule: schedule, nextReviewAt: next?.dueAt || null,
    learningEvidence: mergeEvidenceEvents(record.learningEvidence, session.evidenceEvents),
    updatedAt: nowIso(now)
  };
}

function applyReviewOutcomeToRecord(record, { day, challengeId, passed, feedback = '' }, now = new Date()) {
  const schedule = clone(arr(record.reviewSchedule));
  const index = schedule.findIndex((r) => Number(r.day) === Number(day) && (r.challengeId === challengeId || r.challenge?.challengeId === challengeId));
  if (index < 0) fail('REVIEW_CHALLENGE_NOT_FOUND', '复习题不存在');
  schedule[index].status = 'COMPLETED';
  schedule[index].result = { passed: passed === true, feedback: text(feedback), completedAt: nowIso(now) };
  const reviewEvent = { kind: 'SPACED_REVIEW', day: Number(day), challengeId: text(challengeId), passed: passed === true, feedback: text(feedback), at: nowIso(now) };
  const history = [...arr(record.reviewHistory), { day: Number(day), challengeId: text(challengeId), passed: passed === true, completedAt: nowIso(now) }];
  const next = schedule.find((r) => r.status === 'PENDING');
  return { ...record,
    reviewSchedule: schedule, reviewHistory: history, nextReviewAt: next?.dueAt || null,
    peakMasteryLevel: record.reachedL4Ever ? 'L4' : record.peakMasteryLevel,
    masteryLevel: passed ? record.masteryLevel : 'L3', reachedL4: passed ? record.reachedL4 : false,
    reachedL4Ever: record.reachedL4Ever === true,
    currentRetentionStatus: passed ? (next ? 'MASTERED' : 'REVIEW_COMPLETED') : 'NEEDS_REINFORCEMENT',
    status: passed ? (next ? 'MASTERED' : 'REVIEW_COMPLETED') : 'NEEDS_REINFORCEMENT', learningEvidence: mergeEvidenceEvents(record.learningEvidence, [reviewEvent]), updatedAt: nowIso(now)
  };
}

function applyReviewFailureToSession(session, snapshot, now = new Date()) {
  const bottleneck = selectInitialBottleneck(snapshot) || { sourceKey: 'RETENTION', stepId: 'RETENTION', nodeId: 'RETENTION', stepIndex: 999, bottleneckType: 'retention', purpose: '重新讲清本题核心方法并恢复长期掌握', dependencies: [] };
  return transition(session, {
    phase: 'BOTTLENECK', activeBottleneck: bottleneck, hintLevel: 0, masteryLevel: 'L3', reachedL4: false,
    currentRetentionStatus: 'NEEDS_REINFORCEMENT', status: 'ACTIVE', variants: [], independentRetellStatus: 'NOT_STARTED', completedBottlenecks: []
  }, 'RETENTION_REINFORCEMENT', now);
}

module.exports = {
  BRIEF, HINT_LEVELS, VARIANT_IDS, REVIEW_DAYS, SESSION_VERSION, RECORD_VERSION,
  diagnosisNeedsWork, selectInitialBottleneck, nextBottleneck, causalRank,
  hintLeakageGuard, deterministicHint, assertTransition, transition,
  createSession, applyBottleneckEvaluation, applyRetellEvaluation,
  validateVariants, validateVariantAudit, attachVariants, applyVariantEvaluation,
  buildReviewSchedule, masteryFromSession, publicSession,
  createLearningRecord, refreshLearningRecord, applyReviewOutcomeToRecord, applyReviewFailureToSession
};
