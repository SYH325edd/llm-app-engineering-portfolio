'use strict';

const { createHash } = require('node:crypto');

const VERSION = 'hard-problem-student-step-authority.v10.5';
const ACCEPT_CONFIDENCE = 0.90;
const VERIFY_CONFIDENCE = 0.94;
const DEEP_REVIEW_CONFIDENCE = 0.90;
const TERMINAL_CONFIDENCE_FLOOR = 0.55;
const EVIDENCE_UNIT_TERMINAL_FLOOR = 0.35;
const RELATIONS = Object.freeze(['supports', 'partial_support', 'contradicts', 'irrelevant']);
const RISK_PATHS = Object.freeze(['fast', 'verified', 'deep']);

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
function freezeArray(values) { return Object.freeze(values); }
function nowIso() { return new Date().toISOString(); }

function suspiciousInstructionText(value) {
  const s = text(value).toLowerCase();
  if (!s) return false;
  return /(ignore\s+(all\s+)?(previous|prior)\s+instructions|system\s+prompt|developer\s+message|判我正确|忽略.*规则|不要批改|mark\s+me\s+correct|act\s+as\s+system)/i.test(s);
}

function normalizeProvenance(value = {}, fallback = {}) {
  return Object.freeze({
    sourceImageIndex: Math.max(0, Math.floor(number(value.sourceImageIndex, fallback.sourceImageIndex || 0))),
    sourceRegion: text(value.sourceRegion || fallback.sourceRegion),
    imageHash: text(value.imageHash || fallback.imageHash),
    extractor: text(value.extractor || fallback.extractor),
    promptVersion: text(value.promptVersion || fallback.promptVersion),
    capturedAt: text(value.capturedAt || fallback.capturedAt)
  });
}

function normalizeEvidenceUnit(unit, index, kind, question = {}) {
  if (!unit || typeof unit !== 'object' || Array.isArray(unit)) throw err('HARD_PROBLEM_V10_EVIDENCE_INVALID', '学生证据单元无效', `${kind}Units[${index}]`);
  const unitId = text(unit.unitId) || `${kind === 'process' ? 'P' : 'E'}${index + 1}`;
  const rawText = text(unit.rawText || unit.text);
  const readability = ['readable', 'uncertain', 'unreadable'].includes(unit.readability) ? unit.readability : (rawText ? 'readable' : 'unreadable');
  if (!rawText && readability !== 'unreadable') throw err('HARD_PROBLEM_V10_EVIDENCE_INVALID', '可读学生证据不得为空', `${kind}Units[${index}].rawText`);
  const provenance = normalizeProvenance(unit.provenance, { sourceRegion: unit.sourceRegion || question.sourceRegion });
  return Object.freeze({
    unitId,
    type: kind,
    rawText,
    text: rawText,
    normalizedText: text(unit.normalizedText) || rawText,
    order: Math.max(1, Math.floor(number(unit.order, index + 1))),
    sourceRegion: text(unit.sourceRegion || provenance.sourceRegion),
    visualBand: Number.isFinite(Number(unit.visualBand)) ? Number(unit.visualBand) : null,
    studentStepId: text(unit.studentStepId),
    studentStepLabel: text(unit.studentStepLabel || unit.label),
    readability,
    confidence: clamp01(unit.confidence, readability === 'readable' ? 0.50 : 0.20),
    role: kind === 'process' ? text(unit.role) || 'unknown' : undefined,
    label: kind === 'explanation' ? text(unit.label) : undefined,
    provenance,
    instructionRisk: suspiciousInstructionText(rawText),
    verificationConfirmed: unit.verificationConfirmed === true,
    verificationConflict: unit.verificationConflict === true,
    verifierCandidateText: text(unit.verifierCandidateText)
  });
}

function normalizeEvidenceQuestion(question, index) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) throw err('HARD_PROBLEM_V10_EVIDENCE_INVALID', '学生证据题目无效', `questions[${index}]`);
  const sourceKey = text(question.sourceKey) || `Q${index + 1}`;
  const processUnits = array(question.processUnits).map((u, i) => normalizeEvidenceUnit(u, i, 'process', question)).sort((a, b) => a.order - b.order);
  const explanationUnits = array(question.explanationUnits).map((u, i) => normalizeEvidenceUnit(u, i, 'explanation', question)).sort((a, b) => a.order - b.order);
  const ids = [...processUnits, ...explanationUnits].map((unit) => unit.unitId);
  if (new Set(ids).size !== ids.length) throw err('HARD_PROBLEM_V10_EVIDENCE_INVALID', '学生证据 unitId 重复', `questions[${index}]`);
  const studentAnswer = text(question.studentAnswer);
  const studentWorkDetected = question.studentWorkDetected === true || Boolean(studentAnswer || processUnits.some((u) => u.rawText) || explanationUnits.some((u) => u.rawText));
  const allUnits = [...processUnits, ...explanationUnits];
  const unitConfidenceFloor = allUnits.length ? Math.min(...allUnits.map((u) => u.confidence)) : (studentWorkDetected ? 0.50 : (text(question.questionText) ? 0.70 : 0.20));
  const evidenceQuality = clamp01(question.evidenceQuality ?? question.confidence, unitConfidenceFloor);
  const instructionRisk = suspiciousInstructionText(studentAnswer) || allUnits.some((u) => u.instructionRisk);
  const questionText = text(question.questionText);
  const allowedInputBasis = new Set(['printed_question_with_work', 'printed_question_without_work', 'work_only_complete', 'work_only_incomplete']);
  const requestedInputBasis = text(question.inputBasis);
  const inputBasis = allowedInputBasis.has(requestedInputBasis)
    ? requestedInputBasis
    : questionText
      ? (studentWorkDetected ? 'printed_question_with_work' : 'printed_question_without_work')
      : (studentWorkDetected ? 'work_only_incomplete' : 'printed_question_without_work');
  const verificationState = text(question.verificationState) || 'unverified';
  const declaredStudentStepCount = Math.max(0, Math.floor(number(question.studentStepCount, 0)));
  if (verificationState === 'structure_verified') {
    const processStepIds = processUnits.map((unit) => text(unit.studentStepId));
    if (processUnits.length && processStepIds.some((sid) => !sid)) throw err('HARD_PROBLEM_V10_STRUCTURE_INVALID', '已锁定结构中的学生过程缺少 studentStepId', `${sourceKey}.processUnits`);
    const processStepSet = new Set(processStepIds.filter(Boolean));
    if (explanationUnits.some((unit) => !text(unit.studentStepId) || !processStepSet.has(text(unit.studentStepId)))) throw err('HARD_PROBLEM_V10_STRUCTURE_INVALID', '已锁定结构中的学生解释引用了不存在的学生步骤', `${sourceKey}.explanationUnits`);
    if (declaredStudentStepCount > 0 && declaredStudentStepCount !== processStepSet.size) throw err('HARD_PROBLEM_V10_STRUCTURE_INVALID', '已锁定 StudentStep 数量与实际结构不一致', `${sourceKey}.studentStepCount`);
  }
  return Object.freeze({
    sourceKey,
    questionText,
    studentAnswer,
    studentWorkDetected,
    sourceQuestionLabel: text(question.sourceQuestionLabel) || `第${index + 1}题`,
    sourceRegion: text(question.sourceRegion),
    inputBasis,
    processUnits: freezeArray(processUnits),
    explanationUnits: freezeArray(explanationUnits),
    evidenceQuality,
    verificationState,
    structureReviewState: text(question.structureReviewState),
    structureConfidence: clamp01(question.structureConfidence, evidenceQuality),
    studentStepCount: declaredStudentStepCount,
    warnings: freezeArray(uniq(array(question.warnings).map(text))),
    instructionRisk
  });
}

function normalizeEvidenceLedger(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw err('HARD_PROBLEM_V10_EVIDENCE_INVALID', 'EvidenceLedger 必须是对象', '$');
  const questions = array(value.questions).map(normalizeEvidenceQuestion);
  if (!questions.length) throw err('HARD_PROBLEM_V10_EVIDENCE_INVALID', 'EvidenceLedger 未识别到题目', 'questions');
  const keys = questions.map((q) => q.sourceKey);
  if (new Set(keys).size !== keys.length) throw err('HARD_PROBLEM_V10_EVIDENCE_INVALID', 'sourceKey 重复', 'questions');
  const normalized = { version: VERSION, kind: 'EvidenceLedger', questions: freezeArray(questions), createdAt: text(value.createdAt) || nowIso() };
  return Object.freeze({ ...normalized, evidenceFingerprint: sha(normalized) });
}

function shouldVerifyEvidence(evidence) {
  const e = normalizeEvidenceLedger(evidence);
  // V10.5: every visible student-work question gets one structure review pass.
  // The first model pass is a perception draft; the second pass sees both the original image
  // and that draft and becomes the sole authority for StudentStep boundaries.
  return e.questions.some((q) => q.studentWorkDetected === true
    || q.evidenceQuality < VERIFY_CONFIDENCE
    || q.verificationState === 'conflict'
    || [...q.processUnits, ...q.explanationUnits].some((u) => u.readability !== 'readable' || u.confidence < VERIFY_CONFIDENCE)
    || (!q.questionText && q.studentWorkDetected));
}

function canonicalizeReviewedStudentStepIds(processUnits, explanationUnits, sourceKey) {
  const orderedStepIds = [];
  const seen = new Set();
  for (const unit of processUnits) {
    const sid = text(unit.studentStepId);
    if (!sid) throw err('HARD_PROBLEM_V10_STRUCTURE_INVALID', '结构复核后的学生过程缺少 studentStepId', `${sourceKey}.${unit.unitId}.studentStepId`);
    if (!seen.has(sid)) { seen.add(sid); orderedStepIds.push(sid); }
  }
  const canonicalByOriginal = new Map(orderedStepIds.map((sid, index) => [sid, `S${index + 1}`]));
  const process = processUnits.map((unit) => Object.freeze({ ...unit, studentStepId: canonicalByOriginal.get(text(unit.studentStepId)) }));
  const explanation = explanationUnits.map((unit) => {
    const sid = text(unit.studentStepId);
    if (!sid || !canonicalByOriginal.has(sid)) {
      throw err('HARD_PROBLEM_V10_STRUCTURE_INVALID', '学生解释必须绑定到已存在的学生过程步骤', `${sourceKey}.${unit.unitId}.studentStepId`);
    }
    return Object.freeze({ ...unit, studentStepId: canonicalByOriginal.get(sid) });
  });
  return { process, explanation, studentStepCount: orderedStepIds.length };
}

function applyEvidenceStructureReview(evidence, review) {
  const base = normalizeEvidenceLedger(evidence);
  if (!review || typeof review !== 'object' || !array(review.questions).length) return base;
  const reviewByKey = new Map(array(review.questions).map((q) => [text(q.sourceKey), q]));
  const questions = base.questions.map((baseQuestion, index) => {
    const raw = reviewByKey.get(baseQuestion.sourceKey);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return Object.freeze({ ...baseQuestion, verificationState: 'unverified', warnings: freezeArray(uniq([...(baseQuestion.warnings || []), 'STRUCTURE_REVIEW_MISSING'])) });
    }
    if (!Array.isArray(raw.processUnits) || !Array.isArray(raw.explanationUnits)) {
      throw err('HARD_PROBLEM_V10_STRUCTURE_INVALID', '结构复核必须显式返回完整 processUnits 和 explanationUnits 数组', `${baseQuestion.sourceKey}.questions[${index}]`);
    }
    const merged = {
      ...baseQuestion,
      ...raw,
      sourceKey: baseQuestion.sourceKey,
      questionText: text(raw.questionText) || baseQuestion.questionText,
      studentAnswer: Object.prototype.hasOwnProperty.call(raw, 'studentAnswer') ? text(raw.studentAnswer) : baseQuestion.studentAnswer,
      studentWorkDetected: baseQuestion.studentWorkDetected === true || raw.studentWorkDetected === true,
      sourceQuestionLabel: text(raw.sourceQuestionLabel) || baseQuestion.sourceQuestionLabel,
      sourceRegion: text(raw.sourceRegion) || baseQuestion.sourceRegion,
      inputBasis: text(raw.inputBasis) || baseQuestion.inputBasis,
      evidenceQuality: raw.structureConfidence ?? raw.evidenceQuality ?? raw.confidence ?? baseQuestion.evidenceQuality,
      verificationState: 'structure_verified'
    };
    let candidate = normalizeEvidenceQuestion(merged, index);
    const baseHadProcess = baseQuestion.processUnits.length > 0;
    if (baseQuestion.studentWorkDetected && baseHadProcess && candidate.processUnits.length === 0) {
      throw err('HARD_PROBLEM_V10_STRUCTURE_INVALID', '结构复核不得删除全部学生过程', `${baseQuestion.sourceKey}.processUnits`);
    }
    const canonical = canonicalizeReviewedStudentStepIds(candidate.processUnits, candidate.explanationUnits, baseQuestion.sourceKey);
    if (candidate.processUnits.length && canonical.studentStepCount === 0) {
      throw err('HARD_PROBLEM_V10_STRUCTURE_INVALID', '结构复核未形成学生步骤', `${baseQuestion.sourceKey}.studentStepId`);
    }
    const structureConfidence = clamp01(raw.structureConfidence ?? raw.confidence, candidate.evidenceQuality);
    const warnings = uniq([...(candidate.warnings || []), ...array(raw.correctionReasons).map((x) => `STRUCTURE_REVIEW:${text(x)}`)]);
    candidate = Object.freeze({
      ...candidate,
      processUnits: freezeArray(canonical.process),
      explanationUnits: freezeArray(canonical.explanation),
      verificationState: 'structure_verified',
      structureReviewState: 'verified',
      structureConfidence,
      studentStepCount: canonical.studentStepCount,
      evidenceQuality: Math.max(candidate.evidenceQuality, Math.min(structureConfidence, 0.98)),
      warnings: freezeArray(warnings)
    });
    return candidate;
  });
  const normalized = { version: VERSION, kind: 'EvidenceLedger', questions: freezeArray(questions), createdAt: base.createdAt };
  return Object.freeze({ ...normalized, evidenceFingerprint: sha(normalized) });
}

function applyEvidenceVerification(evidence, verification) {
  // V10.5 preferred contract: the reviewer returns a complete corrected StudentEvidence view.
  // This may split/merge the first-pass draft, but only from the original image; after this point
  // StudentStep boundaries are frozen. Legacy decision-only verification remains supported.
  if (verification && typeof verification === 'object' && array(verification.questions).length) {
    return applyEvidenceStructureReview(evidence, verification);
  }
  const base = normalizeEvidenceLedger(evidence);
  if (!verification || typeof verification !== 'object') return base;
  const decisions = new Map(array(verification.decisions).map((item) => [`${text(item.sourceKey)}\u0000${text(item.unitId)}`, item]));
  const questions = base.questions.map((q) => {
    const decisionFor = (unitId) => decisions.get(`${q.sourceKey}\u0000${unitId}`);
    const update = (unit) => {
      const decision = decisionFor(unit.unitId);
      if (!decision) return unit;
      const candidate = text(decision.confirmedText);
      const agrees = decision.agreesWithExtraction === true || (!candidate || candidate === unit.rawText);
      if (!agrees && candidate && unit.rawText && candidate !== unit.rawText) {
        return Object.freeze({ ...unit, readability: 'uncertain', confidence: Math.min(unit.confidence, 0.49), verificationConflict: true, verifierCandidateText: candidate, verificationConfirmed: false });
      }
      if (decision.agreesWithExtraction !== true && !candidate) return unit;
      return Object.freeze({ ...unit, confidence: Math.max(unit.confidence, clamp01(decision.confidence, 0.95)), verificationConfirmed: true, verificationConflict: false });
    };
    const processUnits = q.processUnits.map(update);
    const explanationUnits = q.explanationUnits.map(update);
    const allUnits = [...processUnits, ...explanationUnits];
    const riskyIds = [...q.processUnits, ...q.explanationUnits]
      .filter((u) => u.readability !== 'readable' || u.confidence < VERIFY_CONFIDENCE)
      .map((u) => u.unitId);
    const pseudoChecks = ['__questionText', '__studentAnswer'].map((id) => ({ id, decision: decisionFor(id), original: id === '__questionText' ? q.questionText : q.studentAnswer })).filter((x) => x.original);
    let pseudoConflict = false;
    let pseudoConfirmedCount = 0;
    for (const item of pseudoChecks) {
      if (!item.decision) continue;
      const candidate = text(item.decision.confirmedText);
      const agrees = item.decision.agreesWithExtraction === true || (candidate && candidate === item.original);
      if (!agrees && candidate && candidate !== item.original) pseudoConflict = true;
      if (agrees && (item.decision.agreesWithExtraction === true || candidate === item.original)) pseudoConfirmedCount += 1;
    }
    const unitConflict = allUnits.some((u) => u.verificationConflict);
    const conflict = unitConflict || pseudoConflict;
    const allRiskyConfirmed = riskyIds.every((id) => {
      const unit = allUnits.find((u) => u.unitId === id);
      return unit?.verificationConfirmed === true;
    });
    const requiresQuestionLevelCheck = q.evidenceQuality < VERIFY_CONFIDENCE;
    const questionLevelComplete = !requiresQuestionLevelCheck || pseudoChecks.length === 0 || pseudoConfirmedCount === pseudoChecks.length;
    const verificationComplete = !conflict && allRiskyConfirmed && questionLevelComplete;
    const verificationState = conflict ? 'conflict' : verificationComplete ? 'verified' : 'unverified';
    const evidenceQuality = conflict ? Math.min(q.evidenceQuality, 0.49)
      : verificationComplete ? Math.max(q.evidenceQuality, 0.95)
        : q.evidenceQuality;
    return Object.freeze({ ...q, processUnits: freezeArray(processUnits), explanationUnits: freezeArray(explanationUnits), verificationState, evidenceQuality });
  });
  const normalized = { version: VERSION, kind: 'EvidenceLedger', questions: freezeArray(questions), createdAt: base.createdAt };
  return Object.freeze({ ...normalized, evidenceFingerprint: sha(normalized) });
}

function normalizeProblemTruth(value, evidence) {
  const ev = normalizeEvidenceLedger(evidence);
  const rawByKey = new Map(array(value?.questions).map((q) => [text(q.sourceKey), q]));
  const questions = ev.questions.map((eq) => {
    const raw = rawByKey.get(eq.sourceKey);
    const explicit = Boolean(raw && typeof raw === 'object' && !Array.isArray(raw));
    const questionConsistent = explicit && raw.questionConsistent === true;
    const referenceAnswerConsistent = explicit && raw.referenceAnswerConsistent === true;
    const accepted = explicit && raw.accepted === true && questionConsistent && referenceAnswerConsistent;
    const confidence = clamp01(raw?.confidence, 0);
    const issues = uniq(array(raw?.issues).map(text));
    if (!explicit) issues.push('TRUTH_RESULT_MISSING');
    if (explicit && raw.accepted !== true) issues.push('TRUTH_NOT_EXPLICITLY_ACCEPTED');
    if (explicit && raw.questionConsistent !== true) issues.push('QUESTION_NOT_EXPLICITLY_VERIFIED');
    if (explicit && raw.referenceAnswerConsistent !== true) issues.push('REFERENCE_NOT_EXPLICITLY_VERIFIED');
    return Object.freeze({
      sourceKey: eq.sourceKey,
      accepted,
      questionConsistent,
      questionText: text(raw?.questionText) || eq.questionText,
      referenceAnswerConsistent,
      canonicalAnswerSummary: text(raw?.canonicalAnswerSummary),
      constraints: freezeArray(uniq(array(raw?.constraints).map(text))),
      confidence,
      issues: freezeArray(uniq(issues))
    });
  });
  const truth = { version: VERSION, kind: 'ProblemTruthModel', questions: freezeArray(questions) };
  return Object.freeze({ ...truth, truthFingerprint: sha(truth.questions) });
}

function problemTruthAccepted(truth) {
  const questions = array(truth?.questions);
  return questions.length > 0 && questions.every((q) => q.accepted === true && q.questionConsistent === true && q.referenceAnswerConsistent === true && q.confidence >= TERMINAL_CONFIDENCE_FLOOR);
}

function normalizeMethodSignal(value, sourceKeys = []) {
  const byKey = new Map(array(value?.questions).map((item) => [text(item.sourceKey), item]));
  return Object.freeze({
    version: VERSION,
    kind: 'MethodSignal',
    questions: freezeArray(sourceKeys.map((sourceKey) => {
      const item = byKey.get(sourceKey) || {};
      return Object.freeze({
        sourceKey,
        methodFamily: text(item.methodFamily) || 'unknown',
        coreRepresentation: text(item.coreRepresentation),
        alternatives: freezeArray(uniq(array(item.alternatives).map(text))),
        confidence: clamp01(item.confidence, 0.50)
      });
    }))
  });
}

function validateDag(nodes, sourceKey, hypothesisId) {
  const ids = nodes.map((n) => n.nodeId);
  if (new Set(ids).size !== ids.length) throw err('HARD_PROBLEM_V10_HYPOTHESIS_INVALID', 'Reasoning DAG nodeId 重复', `${sourceKey}.${hypothesisId}`);
  const idSet = new Set(ids);
  const orderById = new Map(nodes.map((node) => [node.nodeId, Number(node.order || 0)]));
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      if (!idSet.has(dep)) throw err('HARD_PROBLEM_V10_HYPOTHESIS_INVALID', 'Reasoning DAG dependency 引用未知节点', `${sourceKey}.${hypothesisId}.${node.nodeId}.${dep}`);
      if (Number(orderById.get(dep) || 0) >= Number(node.order || 0)) throw err('HARD_PROBLEM_V10_HYPOTHESIS_INVALID', 'Reasoning DAG dependency 必须位于当前节点之前', `${sourceKey}.${hypothesisId}.${node.nodeId}.${dep}`);
    }
  }
  const visiting = new Set(); const visited = new Set(); const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  function dfs(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw err('HARD_PROBLEM_V10_HYPOTHESIS_INVALID', 'Reasoning DAG 存在循环依赖', `${sourceKey}.${hypothesisId}.${id}`);
    visiting.add(id);
    for (const dep of byId.get(id)?.dependencies || []) dfs(dep);
    visiting.delete(id); visited.add(id);
  }
  ids.forEach(dfs);
}

function normalizeHypothesis(raw, index, sourceKey) {
  const hypothesisId = text(raw.hypothesisId) || `H${index + 1}`;
  const rawNodes = array(raw.nodes || raw.steps);
  if (!rawNodes.length) throw err('HARD_PROBLEM_V10_HYPOTHESIS_INVALID', 'Reasoning Hypothesis 缺少节点', `${sourceKey}.${hypothesisId}`);
  const nodes = rawNodes.map((node, i) => {
    const nodeId = text(node.nodeId || node.stepId) || `N${i + 1}`;
    const purpose = text(node.purpose);
    const expectedReasoning = text(node.expectedReasoning);
    const hintScaffold = text(node.hintScaffold);
    if (!purpose || !expectedReasoning || !hintScaffold) throw err('HARD_PROBLEM_V10_HYPOTHESIS_INVALID', 'Reasoning 节点缺少 purpose/expectedReasoning/hintScaffold', `${sourceKey}.${hypothesisId}.${nodeId}`);
    return Object.freeze({
      nodeId,
      stepId: nodeId,
      order: Math.max(1, Math.floor(number(node.order, i + 1))),
      purpose,
      expectedReasoning,
      hintScaffold,
      dependencies: freezeArray(uniq(array(node.dependencies).map(text))),
      knowledgePoints: freezeArray(uniq(array(node.knowledgePoints).map(text)))
    });
  }).sort((a, b) => a.order - b.order);
  validateDag(nodes, sourceKey, hypothesisId);
  return Object.freeze({
    hypothesisId,
    methodFamily: text(raw.methodFamily) || 'unknown',
    label: text(raw.label) || text(raw.methodFamily) || hypothesisId,
    nodes: freezeArray(nodes),
    confidence: clamp01(raw.confidence, 0.50),
    warnings: freezeArray(uniq(array(raw.warnings).map(text)))
  });
}

function normalizeReasoningHypotheses(value, evidence, problemTruth, methodSignal) {
  const ev = normalizeEvidenceLedger(evidence);
  const truthByKey = new Map(array(problemTruth?.questions).map((q) => [q.sourceKey, q]));
  const methodByKey = new Map(array(methodSignal?.questions).map((q) => [q.sourceKey, q]));
  const rawByKey = new Map(array(value?.questions).map((q) => [text(q.sourceKey), q]));
  const questions = ev.questions.map((eq) => {
    const truth = truthByKey.get(eq.sourceKey);
    if (!truth?.accepted) throw err('HARD_PROBLEM_V10_TRUTH_INVALID', 'ProblemTruth 未通过，禁止规划推理路径', eq.sourceKey);
    const raw = rawByKey.get(eq.sourceKey) || {};
    const hypotheses = array(raw.hypotheses).map((h, i) => normalizeHypothesis(h, i, eq.sourceKey));
    if (!hypotheses.length) throw err('HARD_PROBLEM_V10_HYPOTHESIS_INVALID', '未生成合法 Reasoning Hypothesis', eq.sourceKey);
    if (new Set(hypotheses.map((h) => h.hypothesisId)).size !== hypotheses.length) throw err('HARD_PROBLEM_V10_HYPOTHESIS_INVALID', 'hypothesisId 重复', eq.sourceKey);
    return Object.freeze({
      sourceKey: eq.sourceKey,
      methodSignal: methodByKey.get(eq.sourceKey) || { sourceKey: eq.sourceKey, methodFamily: 'unknown', confidence: 0.5 },
      hypotheses: freezeArray(hypotheses.slice(0, 4)),
      confidence: clamp01(raw.confidence, Math.max(...hypotheses.map((h) => h.confidence))),
      warnings: freezeArray(uniq(array(raw.warnings).map(text)))
    });
  });
  const out = { version: VERSION, kind: 'ReasoningHypothesisSet', questions: freezeArray(questions) };
  return Object.freeze({ ...out, hypothesisFingerprint: sha(out.questions) });
}

function auditReasoningHypotheses(hypotheses, audit) {
  const auditByKey = new Map(array(audit?.questions).map((q) => [text(q.sourceKey), q]));
  const questions = [];
  let accepted = true;
  for (const q of array(hypotheses?.questions)) {
    const raw = auditByKey.get(q.sourceKey);
    const explicitIds = new Set(array(raw?.acceptedHypothesisIds).map(text).filter(Boolean));
    const rejectedIds = new Set(array(raw?.rejectedHypothesisIds).map(text).filter(Boolean));
    const knownIds = new Set(q.hypotheses.map((h) => h.hypothesisId));
    const allowed = q.hypotheses.filter((h) => explicitIds.has(h.hypothesisId) && !rejectedIds.has(h.hypothesisId));
    const confidence = clamp01(raw?.confidence, 0);
    const invalidAcceptedIds = [...explicitIds].filter((id) => !knownIds.has(id));
    const questionAccepted = Boolean(raw && raw.accepted === true && allowed.length > 0 && invalidAcceptedIds.length === 0 && confidence >= TERMINAL_CONFIDENCE_FLOOR);
    if (!questionAccepted) accepted = false;
    questions.push(Object.freeze({
      sourceKey: q.sourceKey,
      accepted: questionAccepted,
      acceptedHypothesisIds: freezeArray(allowed.map((h) => h.hypothesisId)),
      confidence,
      reason: text(raw?.reason) || (raw ? '' : 'HYPOTHESIS_AUDIT_RESULT_MISSING'),
      issues: freezeArray(invalidAcceptedIds.map((id) => `UNKNOWN_ACCEPTED_HYPOTHESIS:${id}`))
    }));
  }
  return Object.freeze({ accepted, questions: freezeArray(questions) });
}

function normalizeTypedCoverage(value, evidence, hypotheses, hypothesisAudit = null) {
  const ev = normalizeEvidenceLedger(evidence);
  const rawByKey = new Map(array(value?.questions).map((q) => [text(q.sourceKey), q]));
  const auditByKey = new Map(array(hypothesisAudit?.questions).map((q) => [q.sourceKey, new Set(q.acceptedHypothesisIds)]));
  const evidenceByKey = new Map(ev.questions.map((q) => [q.sourceKey, new Map([...q.processUnits, ...q.explanationUnits].map((u) => [u.unitId, u]))]));
  const questions = array(hypotheses?.questions).map((hq) => {
    const raw = rawByKey.get(hq.sourceKey) || {};
    const allowedIds = auditByKey.get(hq.sourceKey) || new Set(hq.hypotheses.map((h) => h.hypothesisId));
    let selectedHypothesisId = text(raw.selectedHypothesisId);
    const allowedHypotheses = hq.hypotheses.filter((h) => allowedIds.has(h.hypothesisId));
    if (!selectedHypothesisId || !allowedIds.has(selectedHypothesisId)) {
      if (allowedHypotheses.length !== 1) throw err('HARD_PROBLEM_V10_COVERAGE_INVALID', '存在多个合法解法时 Coverage 必须显式选择 hypothesis', `${hq.sourceKey}.selectedHypothesisId`);
      selectedHypothesisId = allowedHypotheses[0].hypothesisId;
    }
    const hypothesis = hq.hypotheses.find((h) => h.hypothesisId === selectedHypothesisId);
    if (!hypothesis) throw err('HARD_PROBLEM_V10_COVERAGE_INVALID', 'Coverage 未选择合法 hypothesis', hq.sourceKey);
    const nodeIds = new Set(hypothesis.nodes.map((n) => n.nodeId));
    const unitMap = evidenceByKey.get(hq.sourceKey) || new Map();
    const edges = [];
    for (const rawEdge of array(raw.edges || raw.coverageEdges)) {
      const nodeId = text(rawEdge.nodeId || rawEdge.stepId);
      const evidenceId = text(rawEdge.evidenceId || rawEdge.unitId);
      const relation = text(rawEdge.relation);
      if (!RELATIONS.includes(relation)) throw err('HARD_PROBLEM_V10_COVERAGE_INVALID', 'Coverage relation 非法或缺失', `${hq.sourceKey}.${nodeId}.${evidenceId}.relation`);
      if (!nodeIds.has(nodeId)) throw err('HARD_PROBLEM_V10_COVERAGE_INVALID', 'Coverage 引用未知 nodeId', `${hq.sourceKey}.${nodeId}`);
      if (!unitMap.has(evidenceId)) throw err('HARD_PROBLEM_V10_COVERAGE_INVALID', 'Coverage 引用未知 evidenceId', `${hq.sourceKey}.${evidenceId}`);
      const unit = unitMap.get(evidenceId);
      edges.push(Object.freeze({
        nodeId,
        stepId: nodeId,
        evidenceId,
        evidenceType: unit.type,
        relation,
        supportRole: text(rawEdge.supportRole) || relation,
        confidence: clamp01(rawEdge.confidence, 0)
      }));
    }
    const dedup = []; const seen = new Set();
    for (const edge of edges) {
      const key = `${edge.nodeId}\u0000${edge.evidenceId}\u0000${edge.relation}`;
      if (!seen.has(key)) { seen.add(key); dedup.push(edge); }
    }
    return Object.freeze({
      sourceKey: hq.sourceKey,
      selectedHypothesisId,
      edges: freezeArray(dedup),
      confidence: clamp01(raw.confidence, 0),
      warnings: freezeArray(uniq(array(raw.warnings).map(text)))
    });
  });
  const out = { version: VERSION, kind: 'TypedEvidenceGraph', questions: freezeArray(questions) };
  return Object.freeze({ ...out, coverageFingerprint: sha(out.questions) });
}

function selectedHypothesis(hypotheses, coverageQuestion) {
  const q = array(hypotheses?.questions).find((x) => x.sourceKey === coverageQuestion?.sourceKey);
  return q?.hypotheses?.find((h) => h.hypothesisId === coverageQuestion.selectedHypothesisId) || null;
}

function buildSelectedPlan(hypotheses, coverage) {
  const coverageByKey = new Map(array(coverage?.questions).map((q) => [q.sourceKey, q]));
  const questions = array(hypotheses?.questions).map((hq) => {
    const cq = coverageByKey.get(hq.sourceKey);
    const h = selectedHypothesis(hypotheses, cq);
    if (!h) throw err('HARD_PROBLEM_V10_COVERAGE_INVALID', '无法构造 selected plan', hq.sourceKey);
    return Object.freeze({
      sourceKey: hq.sourceKey,
      selectedHypothesisId: h.hypothesisId,
      methodFingerprint: { sourceKey: hq.sourceKey, methodFamily: h.methodFamily, confidence: h.confidence },
      steps: freezeArray(h.nodes.map((n) => Object.freeze({ stepId: n.nodeId, nodeId: n.nodeId, order: n.order, purpose: n.purpose, expectedReasoning: n.expectedReasoning, hintScaffold: n.hintScaffold, dependencies: n.dependencies, knowledgePoints: n.knowledgePoints }))),
      confidence: Math.min(h.confidence, clamp01(cq?.confidence, 0.75)),
      planWarnings: freezeArray(uniq([...(h.warnings || []), ...(cq?.warnings || [])]))
    });
  });
  const plan = { version: VERSION, kind: 'SelectedReasoningPlan', questions: freezeArray(questions) };
  return Object.freeze({ ...plan, planFingerprint: sha(plan.questions) });
}

function relationWeight(relation) {
  if (relation === 'supports') return 1;
  if (relation === 'partial_support') return 0.55;
  if (relation === 'contradicts') return -1;
  return 0;
}

function studentStepKey(unit, fallbackIndex, kind = 'process') {
  const explicit = text(unit?.studentStepId);
  if (explicit) return explicit;
  // visualBand is layout evidence only. It must never create or merge StudentSteps.
  if (kind === 'process') return `P${Math.max(1, Math.floor(number(unit?.order, fallbackIndex + 1)))}`;
  return '';
}

function looksLikeStudentExplanation(unit) {
  const value = text(unit?.rawText || unit?.text);
  if (!value) return false;
  if (/^(解\s*[:：]?|设|假设|令|答\s*[:：]?)/.test(value)) return false;
  const explanationSignal = /(为什么|因为|所以|表示|说明|数量关系|关系是|条件是|依据|根据|公式|求的是|求.+数量|用.+(?:加|减|乘|除)|总量|总数|可知|从而|即为|说明了)/.test(value);
  const chineseCount = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  return explanationSignal && chineseCount >= 4;
}

function buildCanonicalStudentSteps(question) {
  const originalProcessUnits = array(question?.processUnits).slice().sort((a, b) => a.order - b.order);
  const declaredExplanationUnits = array(question?.explanationUnits).slice().sort((a, b) => a.order - b.order);
  // This is a read-only view correction. EvidenceLedger itself remains immutable. It only prevents a
  // clearly explanatory sentence accidentally emitted under processUnits from becoming a fake student step.
  const structureLocked = question?.structureReviewState === 'verified' || question?.verificationState === 'structure_verified';
  const explanatoryCandidates = structureLocked ? [] : originalProcessUnits.filter(looksLikeStudentExplanation);
  // Defensive role correction must never delete a real student-written step. Reclassify an
  // explanatory-looking process unit only when that same student step still has another
  // process unit (or a same-band process unit) that can remain the step authority.
  const reclassifiedIds = new Set();
  for (const candidate of explanatoryCandidates) {
    const sid = text(candidate.studentStepId);
    const band = Number(candidate.visualBand);
    const hasCompanionProcess = originalProcessUnits.some((other) => {
      if (other === candidate || looksLikeStudentExplanation(other)) return false;
      const otherSid = text(other.studentStepId);
      if (sid && otherSid && sid === otherSid) return true;
      const otherBand = Number(other.visualBand);
      return Number.isFinite(band) && band > 0 && Number.isFinite(otherBand) && Math.floor(band) === Math.floor(otherBand);
    });
    if (hasCompanionProcess) reclassifiedIds.add(candidate.unitId);
  }
  const reclassified = originalProcessUnits.filter((unit) => reclassifiedIds.has(unit.unitId));
  const processUnits = originalProcessUnits.filter((unit) => !reclassifiedIds.has(unit.unitId));
  const explanationUnits = [...declaredExplanationUnits, ...reclassified].sort((a, b) => a.order - b.order);
  const groups = [];
  const groupByKey = new Map();
  processUnits.forEach((unit, index) => {
    const key = studentStepKey(unit, index, 'process');
    if (!groupByKey.has(key)) {
      const band = Number(unit?.visualBand);
      const group = {
        key,
        processUnits: [],
        explanationUnits: [],
        firstOrder: unit.order || index + 1,
        visualBand: Number.isFinite(band) && band > 0 ? Math.floor(band) : null
      };
      groupByKey.set(key, group);
      groups.push(group);
    }
    groupByKey.get(key).processUnits.push(unit);
  });
  const usedExplanation = new Set();
  const bindExplanation = (unit, index) => {
    if (!groups.length) return null;
    const explicit = text(unit?.studentStepId);
    if (explicit && groupByKey.has(explicit)) return groupByKey.get(explicit);
    if (structureLocked && explicit) return null;
    const band = Number(unit?.visualBand);
    if (Number.isFinite(band) && band > 0) {
      const normalizedBand = Math.floor(band);
      const key = `B${normalizedBand}`;
      if (groupByKey.has(key)) return groupByKey.get(key);
      const positioned = groups.filter((group) => Number.isFinite(group.visualBand));
      if (positioned.length) {
        return positioned.reduce((best, group) => {
          const bestDistance = Math.abs(best.visualBand - normalizedBand);
          const distance = Math.abs(group.visualBand - normalizedBand);
          if (distance !== bestDistance) return distance < bestDistance ? group : best;
          return group.firstOrder < best.firstOrder ? group : best;
        });
      }
    }
    if (groups.length === 1) return groups[0];
    if (explanationUnits.length === groups.length && groups[index]) return groups[index];
    // Explanation is evidence for a student-written process step, never a new step. When the
    // model did not emit an explicit pair id/position, preserve the text on the nearest step by
    // sequence rather than fabricating an explanation-only card.
    return groups[Math.min(index, groups.length - 1)] || null;
  };
  explanationUnits.forEach((unit, index) => {
    const group = bindExplanation(unit, index);
    if (!group) return;
    group.explanationUnits.push(unit);
    usedExplanation.add(unit.unitId);
  });
  const studentSteps = groups.map((group, index) => {
    const p = group.processUnits;
    const e = group.explanationUnits;
    return Object.freeze({
      studentStepId: /^S\d+$/i.test(group.key || '') ? String(group.key).toUpperCase() : `S${index + 1}`,
      stepIndex: index + 1,
      solutionText: uniq(p.map((u) => u.rawText)).join('\n'),
      explanationText: uniq(e.map((u) => u.rawText)).join('\n'),
      processUnitIds: freezeArray(uniq(p.map((u) => u.unitId))),
      explanationUnitIds: freezeArray(uniq(e.map((u) => u.unitId))),
      processReadability: p.length ? (p.some((u) => u.readability === 'unreadable') ? 'unreadable' : p.some((u) => u.readability === 'uncertain') ? 'uncertain' : 'readable') : 'missing',
      explanationReadability: e.length ? (e.some((u) => u.readability === 'unreadable') ? 'unreadable' : e.some((u) => u.readability === 'uncertain') ? 'uncertain' : 'readable') : 'missing'
    });
  });
  const unmatchedExplanationUnits = explanationUnits.filter((unit) => !usedExplanation.has(unit.unitId));
  return Object.freeze({
    studentSteps: freezeArray(studentSteps),
    unmatchedExplanationUnits: freezeArray(unmatchedExplanationUnits),
    reclassifiedExplanationUnitIds: freezeArray(reclassified.map((unit) => unit.unitId))
  });
}

function buildFixedAlignment(evidence, hypotheses, coverage) {
  const ev = normalizeEvidenceLedger(evidence);
  const coverageByKey = new Map(array(coverage?.questions).map((q) => [q.sourceKey, q]));
  const questions = ev.questions.map((eq) => {
    const cq = coverageByKey.get(eq.sourceKey);
    const h = selectedHypothesis(hypotheses, cq);
    if (!h) throw err('HARD_PROBLEM_V10_COVERAGE_INVALID', '缺少选定 Reasoning Hypothesis', eq.sourceKey);
    const edges = array(cq?.edges);
    const canonical = buildCanonicalStudentSteps(eq);
    const pairedSteps = canonical.studentSteps.map((studentStep, index) => {
      const evidenceIds = new Set([...studentStep.processUnitIds, ...studentStep.explanationUnitIds]);
      const stepEdges = edges.filter((edge) => evidenceIds.has(edge.evidenceId) && edge.relation !== 'irrelevant' && edge.confidence >= 0.45);
      const nodeIds = uniq(stepEdges.map((edge) => edge.nodeId));
      const nodes = nodeIds.map((id) => h.nodes.find((node) => node.nodeId === id)).filter(Boolean).sort((a, b) => a.order - b.order);
      const contradictory = stepEdges.filter((e) => e.relation === 'contradicts');
      const expectedPurpose = nodes.length ? uniq(nodes.map((n) => n.purpose)).join('；') : `判断学生第${index + 1}步的数学过程与对应解释`;
      const expectedReasoning = nodes.length ? uniq(nodes.map((n) => n.expectedReasoning)).join('；') : '根据题目条件、标准数学事实和前后学生步骤，判断本步过程是否正确、解释是否支持过程、逻辑是否成立。';
      const dependencies = uniq(nodes.flatMap((n) => array(n.dependencies)));
      return Object.freeze({
        ...studentStep,
        expectedStepId: nodeIds[0] || `STUDENT_${index + 1}`,
        expectedNodeIds: freezeArray(nodeIds),
        expectedPurpose,
        expectedReasoning,
        dependencies: freezeArray(dependencies),
        stepKind: 'student_written',
        contradictoryEvidenceIds: freezeArray(uniq(contradictory.map((e) => e.evidenceId))),
        coverageRelations: freezeArray(stepEdges.map((e) => ({ evidenceId: e.evidenceId, nodeId: e.nodeId, relation: e.relation, confidence: e.confidence }))),
        coverageConfidence: stepEdges.length ? Math.max(0, Math.min(1, stepEdges.reduce((sum, e) => sum + Math.max(0, relationWeight(e.relation)) * e.confidence, 0) / Math.max(1, stepEdges.length))) : 0
      });
    });
    const coveredNodeIds = new Set(edges.filter((edge) => edge.relation !== 'irrelevant' && edge.confidence >= 0.45).map((edge) => edge.nodeId));
    const missingExpectedNodes = h.nodes.filter((node) => !coveredNodeIds.has(node.nodeId)).map((node) => Object.freeze({
      stepId: node.nodeId,
      nodeId: node.nodeId,
      order: node.order,
      purpose: node.purpose,
      expectedReasoning: node.expectedReasoning,
      hintScaffold: node.hintScaffold,
      dependencies: node.dependencies
    }));
    const warnings = uniq([
      ...array(cq?.warnings).map(text),
      ...(canonical.unmatchedExplanationUnits.length ? [`UNMATCHED_EXPLANATION:${canonical.unmatchedExplanationUnits.length}`] : []),
      ...(canonical.reclassifiedExplanationUnitIds.length ? [`PROCESS_ROLE_RECLASSIFIED_AS_EXPLANATION:${canonical.reclassifiedExplanationUnitIds.length}`] : [])
    ]);
    return Object.freeze({
      sourceKey: eq.sourceKey,
      layoutType: 'student_step_alignment',
      questionText: eq.questionText,
      studentAnswer: eq.studentAnswer,
      studentWorkDetected: eq.studentWorkDetected,
      sourceQuestionLabel: eq.sourceQuestionLabel,
      sourceRegion: eq.sourceRegion,
      inputBasis: eq.inputBasis,
      modeApplicability: 'applicable',
      selectedHypothesisId: h.hypothesisId,
      expectedSteps: freezeArray(h.nodes.map((n) => ({ stepId: n.nodeId, order: n.order, purpose: n.purpose, expectedReasoning: n.expectedReasoning, hintScaffold: n.hintScaffold, dependencies: n.dependencies }))),
      pairedSteps: freezeArray(pairedSteps),
      missingExpectedNodes: freezeArray(missingExpectedNodes),
      unmatchedExplanationUnits: canonical.unmatchedExplanationUnits,
      processUnits: eq.processUnits,
      explanationUnits: eq.explanationUnits,
      alignmentConfidence: clamp01(cq?.confidence, 0.70),
      alignmentWarnings: freezeArray(warnings)
    });
  });
  return Object.freeze({ version: 'hard-problem-student-step-alignment.v10.5', layoutType: 'student_step_alignment', questions: freezeArray(questions), _v10: true });
}

function stepSatisfaction(step, reviewStep = null) {
  const processCovered = array(step?.processUnitIds).length > 0;
  const explanationCovered = array(step?.explanationUnitIds).length > 0;
  const contradictionPresent = array(step?.contradictoryEvidenceIds).length > 0;
  const positiveCoverage = processCovered || explanationCovered;
  const reviewReadable = reviewStep ? reviewStep.solutionStatus !== 'unreadable' && reviewStep.explanationStatus !== 'unreadable' : true;
  let status = 'missing';
  if (positiveCoverage && contradictionPresent) status = 'conflicted';
  else if (positiveCoverage && reviewReadable) status = 'covered';
  else if (positiveCoverage) status = 'uncertain';
  return { processCovered, explanationCovered, contradictionPresent, satisfactionStatus: status };
}

function normalizeAdversarialJudgment(value = {}) {
  const issues = array(value.issues).map((issue) => Object.freeze({
    sourceKey: text(issue.sourceKey),
    stepId: text(issue.stepId || issue.nodeId),
    code: text(issue.code) || 'ADVERSARIAL_ISSUE',
    severity: ['low', 'medium', 'high', 'critical'].includes(issue.severity) ? issue.severity : 'medium',
    reason: text(issue.reason),
    confidence: clamp01(issue.confidence, 0)
  }));
  const blocking = issues.some((i) => ['high', 'critical'].includes(i.severity) && i.confidence >= 0.75);
  const explicitAccepted = value.accepted === true;
  return Object.freeze({ accepted: explicitAccepted && !blocking, confidence: clamp01(value.confidence, explicitAccepted ? 0.80 : 0), issues: freezeArray(issues), skipped: value.skipped === true });
}

function causalScore(diagnosis, diagnosisById) {
  if (!diagnosis || diagnosis.bottleneckType === 'none') return -999;
  const base = diagnosis.satisfactionStatus === 'missing' ? 8 : diagnosis.satisfactionStatus === 'conflicted' ? 9 : diagnosis.processStatus === 'wrong' ? 8 : diagnosis.explanationStatus === 'incorrect' ? 7 : diagnosis.logicStatus === 'wrong' ? 7 : 5;
  const downstream = array(diagnosis.dependents).filter((id) => diagnosisById.get(id)?.bottleneckType !== 'none').length;
  const upstreamProblem = array(diagnosis.dependencies).some((id) => diagnosisById.get(id)?.bottleneckType !== 'none');
  return base + downstream * 2 - (upstreamProblem ? 5 : 0) - Number(diagnosis.stepIndex || 0) * 0.001;
}

function buildDiagnosticSnapshot({ evidence, problemTruth, method, hypotheses, hypothesisAudit, coverage, alignment, reviewResult, adversarialJudgment = null, route = null }) {
  const reviewByKey = new Map(array(reviewResult?.questions).map((q) => [text(q.sourceKey), q]));
  const coverageByKey = new Map(array(coverage?.questions).map((q) => [q.sourceKey, q]));
  const diagnoses = [];
  for (const aq of array(alignment?.questions)) {
    const rq = reviewByKey.get(aq.sourceKey) || {};
    const reviewSteps = array(rq.stepFeedbacks);
    const cq = coverageByKey.get(aq.sourceKey);
    const hypothesis = selectedHypothesis(hypotheses, cq);
    const dependentsById = new Map((hypothesis?.nodes || []).map((n) => [n.nodeId, []]));
    for (const n of hypothesis?.nodes || []) for (const dep of n.dependencies) if (dependentsById.has(dep)) dependentsById.get(dep).push(n.nodeId);
    aq.pairedSteps.forEach((step, index) => {
      const reviewStep = reviewSteps[index] || {};
      const satisfaction = stepSatisfaction(step, reviewStep);
      const explanationStatus = text(reviewStep.explanationStatus) || (satisfaction.explanationCovered ? 'unknown' : 'missing');
      const logicStatus = text(reviewStep.logicStatus) || 'insufficient';
      const processStatus = text(reviewStep.solutionStatus) || (satisfaction.processCovered ? 'unknown' : 'missing');
      const bottleneckType = satisfaction.satisfactionStatus === 'conflicted' ? 'evidence_conflict'
        : processStatus === 'wrong' ? 'calculation_or_method'
          : ['incorrect', 'missing'].includes(explanationStatus) ? 'explanation'
            : logicStatus !== 'clear' ? 'logic' : 'none';
      const nodeIds = array(step.expectedNodeIds).length ? array(step.expectedNodeIds) : [step.expectedStepId].filter(Boolean);
      const anchorNodeId = nodeIds[0] || `STUDENT_${index + 1}`;
      const studentStepId = text(step.studentStepId) || `STUDENT_${index + 1}`;
      const dependents = uniq(nodeIds.flatMap((nodeId) => dependentsById.get(nodeId) || []));
      diagnoses.push({
        sourceKey: aq.sourceKey,
        stepId: studentStepId,
        nodeId: anchorNodeId,
        expectedNodeIds: nodeIds,
        stepIndex: step.stepIndex,
        purpose: step.expectedPurpose,
        dependencies: uniq(array(step.dependencies)),
        dependents,
        satisfactionStatus: satisfaction.satisfactionStatus,
        processStatus,
        explanationStatus,
        logicStatus,
        calculationCorrect: processStatus === 'correct' ? true : processStatus === 'wrong' ? false : null,
        conditionUseCorrect: logicStatus === 'clear' ? true : logicStatus === 'wrong' ? false : null,
        reasoningExplained: ['clear', 'partially_clear'].includes(explanationStatus),
        continuityClear: logicStatus === 'clear',
        answerCopyingDetected: reviewStep.answerCopyingDetected === true ? true : reviewStep.answerCopyingDetected === false ? false : null,
        ownWordsClear: reviewStep.ownWordsClear === true || (reviewStep.ownWordsClear == null && explanationStatus === 'clear'),
        bottleneckType,
        feedback: text(reviewStep.analysis),
        correctionAdvice: text(reviewStep.correctionAdvice),
        confidence: Math.min(clamp01(aq.alignmentConfidence, 0.70), clamp01(reviewStep.confidence, 0.90))
      });
    });
    if (rq.finalAnswerCorrect === false && diagnoses.filter((d) => d.sourceKey === aq.sourceKey).every((d) => d.bottleneckType === 'none')) {
      diagnoses.push({ sourceKey: aq.sourceKey, stepId: 'FINAL_ANSWER', nodeId: 'FINAL_ANSWER', stepIndex: aq.pairedSteps.length + 1, purpose: '核对最终答案', dependencies: aq.pairedSteps.length ? [aq.pairedSteps[aq.pairedSteps.length - 1].expectedStepId] : [], dependents: [], satisfactionStatus: aq.studentAnswer ? 'covered' : 'missing', processStatus: 'unknown', explanationStatus: 'unknown', logicStatus: 'insufficient', calculationCorrect: false, conditionUseCorrect: null, reasoningExplained: false, continuityClear: false, answerCopyingDetected: null, ownWordsClear: false, bottleneckType: 'final_answer', feedback: '前面推理未发现明显错误，但最终答案仍需核对。', correctionAdvice: '重新检查最后一步计算、单位和作答。', confidence: 0.90 });
    }
  }
  const bySource = new Map();
  for (const d of diagnoses) {
    if (!bySource.has(d.sourceKey)) bySource.set(d.sourceKey, new Map());
    bySource.get(d.sourceKey).set(d.stepId, d);
    if (d.nodeId && !bySource.get(d.sourceKey).has(d.nodeId)) bySource.get(d.sourceKey).set(d.nodeId, d);
  }
  const problematic = diagnoses.filter((d) => d.bottleneckType !== 'none');
  const ranked = problematic.map((d) => ({ d, score: causalScore(d, bySource.get(d.sourceKey) || new Map()) })).sort((a, b) => b.score - a.score || Number(a.d.stepIndex || 0) - Number(b.d.stepIndex || 0));
  const active = ranked[0]?.d || null;
  const selectedPlan = buildSelectedPlan(hypotheses, coverage);
  const adversarial = normalizeAdversarialJudgment(adversarialJudgment || { accepted: true, skipped: true });
  const snapshot = {
    version: VERSION,
    kind: 'DiagnosticSnapshot',
    evidence,
    problemTruth,
    method,
    reasoningHypotheses: hypotheses,
    hypothesisAudit,
    coverage,
    plan: selectedPlan,
    diagnoses,
    causalBottleneckCandidate: active ? { sourceKey: active.sourceKey, stepId: active.stepId, nodeId: active.nodeId, bottleneckType: active.bottleneckType, purpose: active.purpose, dependencies: active.dependencies, causalScore: ranked[0].score } : null,
    activeBottleneckCandidate: active ? { sourceKey: active.sourceKey, stepId: active.stepId, bottleneckType: active.bottleneckType, purpose: active.purpose } : null,
    adversarialJudgment: adversarial,
    route: route || { path: 'fast', reasons: [] },
    consistencyStatus: 'pending',
    createdAt: nowIso()
  };
  const checked = consistencyGate(snapshot, alignment, reviewResult);
  const snapshotId = sha({ evidence: evidence.evidenceFingerprint, truth: problemTruth?.truthFingerprint, hypotheses: hypotheses?.hypothesisFingerprint, coverage: coverage?.coverageFingerprint, diagnoses, adversarial });
  return Object.freeze({ ...snapshot, consistencyStatus: checked.ok ? 'ok' : 'blocked', consistencyIssues: freezeArray(checked.issues), consistencyFatalIssues: freezeArray(checked.fatalIssues || []), consistencyWarnings: freezeArray(checked.warnings || []), snapshotId });
}

function consistencyGate(snapshot, alignment, reviewResult) {
  const fatalIssues = [];
  const warnings = [];
  const evidenceByKey = new Map(array(snapshot?.evidence?.questions).map((q) => [q.sourceKey, q]));
  const truthByKey = new Map(array(snapshot?.problemTruth?.questions).map((q) => [q.sourceKey, q]));
  for (const aq of array(alignment?.questions)) {
    const eq = evidenceByKey.get(aq.sourceKey);
    if (eq && eq.studentWorkDetected === false && (eq.studentAnswer || eq.processUnits.length || eq.explanationUnits.length)) fatalIssues.push(`WORK_DETECTION_CONFLICT:${aq.sourceKey}`);
    if (eq?.verificationState === 'conflict') fatalIssues.push(`EVIDENCE_VERIFICATION_CONFLICT:${aq.sourceKey}`);
    if (eq && (eq.evidenceQuality < TERMINAL_CONFIDENCE_FLOOR || [...eq.processUnits, ...eq.explanationUnits].some((u) => u.readability === 'unreadable' || u.confidence < EVIDENCE_UNIT_TERMINAL_FLOOR))) fatalIssues.push(`EVIDENCE_QUALITY_INSUFFICIENT:${aq.sourceKey}`);
    const truth = truthByKey.get(aq.sourceKey);
    if (!truth || truth.accepted !== true || truth.questionConsistent !== true || truth.referenceAnswerConsistent !== true || Number(truth.confidence || 0) < TERMINAL_CONFIDENCE_FLOOR) fatalIssues.push(`PROBLEM_TRUTH_REJECTED:${aq.sourceKey}`);
    if (snapshot?.hypothesisAudit?.accepted !== true) warnings.push(`HYPOTHESIS_AUDIT_REJECTED:${aq.sourceKey}`);
    const auditQuestion = array(snapshot?.hypothesisAudit?.questions).find((q) => q.sourceKey === aq.sourceKey);
    if (auditQuestion && !array(auditQuestion.acceptedHypothesisIds).includes(aq.selectedHypothesisId)) warnings.push(`SELECTED_HYPOTHESIS_NOT_AUDITED:${aq.sourceKey}:${aq.selectedHypothesisId || ''}`);
    const coverageQuestion = array(snapshot?.coverage?.questions).find((q) => q.sourceKey === aq.sourceKey);
    if (!coverageQuestion || coverageQuestion.confidence < TERMINAL_CONFIDENCE_FLOOR) warnings.push(`COVERAGE_CONFIDENCE_INSUFFICIENT:${aq.sourceKey}`);
    const realEvidenceUnits = eq ? [...eq.processUnits, ...eq.explanationUnits] : [];
    const semanticEdges = array(coverageQuestion?.edges).filter((edge) => edge.relation !== 'irrelevant' && edge.confidence >= 0.45);
    if (realEvidenceUnits.length > 0 && semanticEdges.length === 0) warnings.push(`STUDENT_EVIDENCE_UNMAPPED:${aq.sourceKey}`);
    const rq = array(reviewResult?.questions).find((q) => text(q.sourceKey) === aq.sourceKey);
    if (rq && array(rq.stepFeedbacks).length !== aq.pairedSteps.length) warnings.push(`STEP_COUNT_CONFLICT:${aq.sourceKey}`);
    if (array(aq.unmatchedExplanationUnits).length) warnings.push(`UNMATCHED_EXPLANATION:${aq.sourceKey}:${aq.unmatchedExplanationUnits.length}`);
    aq.pairedSteps.forEach((step) => {
      const diagnosis = array(snapshot?.diagnoses).find((d) => d.sourceKey === aq.sourceKey && (d.stepId === step.studentStepId || array(step.expectedNodeIds).includes(d.nodeId)));
      if ((step.processUnitIds.length || step.explanationUnitIds.length) && diagnosis?.satisfactionStatus === 'missing') warnings.push(`COVERED_STEP_MARKED_MISSING:${aq.sourceKey}:${step.studentStepId || step.expectedStepId}`);
    });
  }
  if (snapshot?.adversarialJudgment && snapshot.adversarialJudgment.accepted !== true) warnings.push('ADVERSARIAL_JUDGMENT_REJECTED');
  for (const issue of array(snapshot?.adversarialJudgment?.issues)) {
    if (['high', 'critical'].includes(issue.severity) && issue.confidence >= 0.75) fatalIssues.push(`ADVERSARIAL_BLOCK:${issue.code}:${issue.sourceKey || ''}:${issue.stepId || ''}`);
  }
  const allIssues = uniq([...fatalIssues, ...warnings]);
  return { ok: fatalIssues.length === 0, issues: allIssues, fatalIssues: uniq(fatalIssues), warnings: uniq(warnings) };
}

function routeRisk({ evidence, problemTruth, method, hypotheses, hypothesisAudit = null, coverage }) {
  const reasons = [];
  let path = 'fast';
  const ev = normalizeEvidenceLedger(evidence);
  if (ev.questions.some((q) => q.verificationState === 'verified')) { path = 'verified'; reasons.push('evidence_verified'); }
  if (ev.questions.some((q) => q.verificationState === 'conflict' || q.evidenceQuality < ACCEPT_CONFIDENCE)) { path = 'deep'; reasons.push('evidence_risk'); }
  if (ev.questions.some((q) => q.instructionRisk)) { path = 'deep'; reasons.push('untrusted_instruction_text'); }
  if (array(problemTruth?.questions).some((q) => !q.accepted || q.confidence < DEEP_REVIEW_CONFIDENCE)) { path = 'deep'; reasons.push('truth_risk'); }
  if (array(method?.questions).some((q) => q.methodFamily === 'unknown' || q.confidence < 0.75)) { path = 'deep'; reasons.push('method_uncertain'); }
  if (array(hypotheses?.questions).some((q) => q.hypotheses.length > 1 || q.confidence < DEEP_REVIEW_CONFIDENCE)) { path = 'deep'; reasons.push('multi_or_low_hypothesis'); }
  if (hypothesisAudit && (hypothesisAudit.accepted !== true || array(hypothesisAudit.questions).some((q) => Number(q.confidence || 0) < 0.75))) { path = 'deep'; reasons.push('hypothesis_audit_risk'); }
  if (array(coverage?.questions).some((q) => q.confidence < DEEP_REVIEW_CONFIDENCE || q.edges.some((e) => e.relation === 'contradicts'))) { path = 'deep'; reasons.push('coverage_risk'); }
  const evidenceByKey = new Map(ev.questions.map((q) => [q.sourceKey, q]));
  if (array(coverage?.questions).some((q) => { const eq = evidenceByKey.get(q.sourceKey); return [...array(eq?.processUnits), ...array(eq?.explanationUnits)].length > 0 && !array(q.edges).some((e) => e.relation !== 'irrelevant' && e.confidence >= 0.45); })) { path = 'deep'; reasons.push('unmapped_student_evidence'); }
  return Object.freeze({ path: RISK_PATHS.includes(path) ? path : 'deep', reasons: freezeArray(uniq(reasons)) });
}

function shouldRunAdversarialJudge({ route, evidence, problemTruth, hypotheses, coverage, reviewResult }) {
  if (route?.path === 'deep') return true;
  if (array(evidence?.questions).some((q) => q.verificationState === 'conflict')) return true;
  if (array(problemTruth?.questions).some((q) => q.confidence < DEEP_REVIEW_CONFIDENCE)) return true;
  if (array(hypotheses?.questions).some((q) => q.hypotheses.length > 1)) return true;
  if (array(coverage?.questions).some((q) => q.edges.some((e) => e.relation === 'contradicts'))) return true;
  if (array(reviewResult?.questions).some((q) => array(q.stepFeedbacks).some((s) => Number(s.confidence || 1) < 0.80))) return true;
  return false;
}

function publicDiagnostic(snapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    runtimeVersion: VERSION,
    route: snapshot.route,
    diagnoses: array(snapshot.diagnoses).map(({ sourceKey, stepId, stepIndex, purpose, dependencies, satisfactionStatus, processStatus, explanationStatus, logicStatus, bottleneckType, feedback, correctionAdvice, confidence }) => ({ sourceKey, stepId, stepIndex, purpose, dependencies, satisfactionStatus, processStatus, explanationStatus, logicStatus, bottleneckType, feedback, correctionAdvice, confidence })),
    activeBottleneckCandidate: snapshot.activeBottleneckCandidate,
    causalBottleneckCandidate: snapshot.causalBottleneckCandidate,
    consistencyStatus: snapshot.consistencyStatus
  };
}

module.exports = {
  VERSION, ACCEPT_CONFIDENCE, VERIFY_CONFIDENCE, DEEP_REVIEW_CONFIDENCE, TERMINAL_CONFIDENCE_FLOOR, EVIDENCE_UNIT_TERMINAL_FLOOR, RELATIONS,
  normalizeEvidenceLedger, shouldVerifyEvidence, applyEvidenceVerification, applyEvidenceStructureReview,
  normalizeProblemTruth, problemTruthAccepted, normalizeMethodSignal,
  normalizeReasoningHypotheses, auditReasoningHypotheses,
  normalizeTypedCoverage, buildSelectedPlan, buildCanonicalStudentSteps, buildFixedAlignment,
  stepSatisfaction, normalizeAdversarialJudgment, buildDiagnosticSnapshot, consistencyGate,
  routeRisk, shouldRunAdversarialJudge, publicDiagnostic, suspiciousInstructionText, sha
};
