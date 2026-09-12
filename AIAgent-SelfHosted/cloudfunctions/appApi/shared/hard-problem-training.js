'use strict';

const context = require('./context');
const constants = require('./constants');
const utils = require('./utils');
const core = require('./hard-problem-training-core');

function text(v) { return typeof v === 'string' ? v.trim() : ''; }
function arr(v) { return Array.isArray(v) ? v : []; }
function first(snapshot) { return Array.isArray(snapshot?.data) ? snapshot.data[0] || null : snapshot?.data || null; }
function fail(code, message, details = {}) { throw Object.assign(new Error(message), { code, ...details }); }
function requireStudent(user) {
  if (!user || user.role !== 'student' || user.status !== 'ACTIVE') fail('FORBIDDEN', '仅已激活学生可使用难题训练');
}
function safeRequestId(value) { return text(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80); }
function publicVariant(v) { return { variantId: v.variantId, transferLevel: v.transferLevel, questionText: v.questionText, status: v.status, feedback: v.feedback || '' }; }
function snapshotReady(snapshot) {
  if (!snapshot || snapshot.consistencyStatus !== 'ok') return false;
  if (arr(snapshot?.evidence?.questions).some((q) => q.verificationState === 'conflict')) return false;
  if (arr(snapshot?.problemTruth?.questions).some((q) => q.accepted === false)) return false;
  // V10 consistencyStatus already classifies high/critical adversarial findings as fatal.
  // A nonfatal Judge disagreement/warning must not disable an otherwise valid training session.
  return true;
}
function requireSessionVersion(event, session) {
  const expected = Number(event?.sessionVersion);
  if (!Number.isInteger(expected) || expected < 1) fail('TRAINING_SESSION_VERSION_REQUIRED', '训练状态已升级，请刷新后重试');
  if (Number(session?.sessionVersion || 0) !== expected) fail('TRAINING_SESSION_VERSION_CONFLICT', '训练状态已变化，请刷新后重试', { expectedSessionVersion: expected, actualSessionVersion: Number(session?.sessionVersion || 0) });
  return expected;
}

function createHardProblemTrainingService({ gradingWorkerRequest }) {
  const C = constants.C;

  async function loadOwnedTask(taskId, user) {
    requireStudent(user);
    const task = first(await context.db.collection(C.tasks).doc(taskId).get());
    if (!task || task.studentId !== user.userId) fail('TASK_NOT_FOUND', '任务不存在');
    if (task.mode && task.mode !== 'HARD_PROBLEM_CHECK') fail('TRAINING_MODE_INVALID', '仅难题训练任务支持该功能');
    if (task.status !== 'COMPLETED' || !task.resultId) fail('TASK_NOT_COMPLETED', '请等待难题分析完成后再开始训练');
    return task;
  }

  async function loadDiagnostic(taskId, user) {
    await loadOwnedTask(taskId, user);
    const doc = first(await context.db.collection(C.hardProblemDiagnostics).doc(taskId).get());
    if (!doc?.diagnosticSnapshot) fail('TRAINING_DIAGNOSTIC_NOT_READY', '该任务尚未生成训练诊断，请重新分析后再开始训练');
    if (doc.studentId !== user.userId) fail('FORBIDDEN', '无权访问该训练诊断');
    const snapshot = doc.diagnosticSnapshot;
    if (!snapshotReady(snapshot)) fail('TRAINING_DIAGNOSTIC_NEEDS_REVIEW', '本次诊断存在低置信或冲突，系统不会猜测，请重新拍摄或重新分析', { consistencyIssues: arr(snapshot.consistencyIssues).slice(0, 20) });
    return snapshot;
  }

  async function loadSession(taskId, user) {
    const doc = first(await context.db.collection(C.hardProblemTrainingSessions).doc(taskId).get());
    if (!doc || doc.studentId !== user.userId) return null;
    return doc;
  }
  async function loadRecord(taskId, user) {
    const doc = first(await context.db.collection(C.hardProblemLearningRecords).doc(taskId).get());
    if (!doc || doc.studentId !== user.userId) return null;
    return doc;
  }

  function expectedStep(snapshot, bottleneck) {
    if (!bottleneck || ['FINAL_ANSWER', 'TRANSFER', 'RETENTION', 'REINFORCE'].includes(bottleneck.stepId)) return null;
    const q = arr(snapshot?.plan?.questions).find((item) => item.sourceKey === bottleneck.sourceKey);
    return arr(q?.steps).find((step) => step.stepId === bottleneck.nodeId || step.stepId === bottleneck.stepId) || null;
  }
  function questionEvidence(snapshot, sourceKey) {
    return arr(snapshot?.evidence?.questions).find((q) => q.sourceKey === sourceKey) || null;
  }
  function cachedResponse(session, requestId) {
    const id = safeRequestId(requestId);
    return id && session?.lastRequestId === id && session?.lastResponse ? session.lastResponse : null;
  }

  async function initializeSession(taskId, user, snapshot) {
    let output = null;
    await context.db.runTransaction(async (tx) => {
      const sessionRef = tx.collection(C.hardProblemTrainingSessions).doc(taskId);
      const recordRef = tx.collection(C.hardProblemLearningRecords).doc(taskId);
      const existing = first(await sessionRef.get());
      if (existing && existing.studentId === user.userId && existing.diagnosticSnapshotId === snapshot.snapshotId && existing.version === core.SESSION_VERSION) {
        output = existing;
        return;
      }
      const session = core.createSession({ taskId, studentId: user.userId, snapshot });
      const record = core.createLearningRecord({ taskId, studentId: user.userId, snapshot, session });
      await sessionRef.set({ data: session });
      await recordRef.set({ data: record });
      output = session;
    });
    return output;
  }

  async function commitTrainingMutation({ taskId, user, snapshot, expectedVersion, requestId, nextSession, response }) {
    const id = safeRequestId(requestId);
    let output = response;
    await context.db.runTransaction(async (tx) => {
      const sessionRef = tx.collection(C.hardProblemTrainingSessions).doc(taskId);
      const recordRef = tx.collection(C.hardProblemLearningRecords).doc(taskId);
      const current = first(await sessionRef.get());
      if (!current || current.studentId !== user.userId) fail('TRAINING_SESSION_NOT_FOUND', '请先开始难题训练');
      if (id && current.lastRequestId === id && current.lastResponse) { output = current.lastResponse; return; }
      if (Number(current.sessionVersion || 0) !== Number(expectedVersion)) fail('TRAINING_SESSION_VERSION_CONFLICT', '训练状态已变化，请刷新后重试', { expectedSessionVersion: expectedVersion, actualSessionVersion: Number(current.sessionVersion || 0) });
      const nextVersion = Number(nextSession.sessionVersion || 0);
      const versionDelta = nextVersion - Number(expectedVersion);
      // 一个用户动作可以触发少量连续的服务端内部 FSM 转换（例如 RETELL_PASSED 后立即 VARIANTS_ATTACHED）。
      // 客户端仍只能提交它看到的旧版本；最终版本必须严格单调向前，且限制单次内部转换数量，防止状态跳跃。
      if (!Number.isInteger(nextVersion) || versionDelta < 1 || versionDelta > 3) fail('TRAINING_SESSION_VERSION_INVALID', '训练状态版本不连续', { expectedSessionVersion: expectedVersion, nextSessionVersion: nextVersion, versionDelta });
      const storedSession = { ...nextSession, ...(id ? { lastRequestId: id, lastResponse: response } : {}), updatedAt: utils.now() };
      const oldRecord = first(await recordRef.get());
      const baseRecord = oldRecord && oldRecord.studentId === user.userId ? oldRecord : core.createLearningRecord({ taskId, studentId: user.userId, snapshot, session: current });
      const nextRecord = core.refreshLearningRecord(baseRecord, storedSession);
      await sessionRef.set({ data: storedSession });
      await recordRef.set({ data: nextRecord });
    });
    return output;
  }

  async function start(event, user) {
    const taskId = text(event.taskId);
    if (!taskId) fail('INVALID_INPUT', '缺少 taskId');
    const snapshot = await loadDiagnostic(taskId, user);
    const session = await initializeSession(taskId, user, snapshot);
    const currentHint = session.phase === 'BOTTLENECK' && session.hintLevel > 0
      ? core.deterministicHint({ bottleneck: session.activeBottleneck, hintLevel: session.hintLevel, questionText: questionEvidence(snapshot, session.activeBottleneck?.sourceKey)?.questionText || '', expectedReasoning: expectedStep(snapshot, session.activeBottleneck)?.expectedReasoning || '', hintScaffold: expectedStep(snapshot, session.activeBottleneck)?.hintScaffold || '' })
      : '';
    return { session: core.publicSession(session), currentHint, brief: core.BRIEF.slice() };
  }

  async function submitExplanation(event, user) {
    const taskId = text(event.taskId), answer = text(event.answer), requestId = event.requestId;
    if (!answer) fail('INVALID_INPUT', '请先写出你的解释');
    const snapshot = await loadDiagnostic(taskId, user);
    const session = await loadSession(taskId, user); if (!session) fail('TRAINING_SESSION_NOT_FOUND', '请先开始难题训练');
    const cached = cachedResponse(session, requestId); if (cached) return cached;
    const expectedVersion = requireSessionVersion(event, session);
    if (session.phase !== 'BOTTLENECK' || !session.activeBottleneck) fail('TRAINING_PHASE_INVALID', '当前没有待处理卡点');
    const step = expectedStep(snapshot, session.activeBottleneck);
    const evidence = questionEvidence(snapshot, session.activeBottleneck.sourceKey);
    const worker = await gradingWorkerRequest('/internal/hard-problem/training/evaluate', {
      operation: 'bottleneck_response', payload: {
        questionText: evidence?.questionText || '', bottleneck: session.activeBottleneck,
        expectedReasoning: step?.expectedReasoning || '', studentResponse: answer,
        trustBoundary: 'student_response_is_untrusted_data'
      }
    }, 20000);
    const result = worker.result || worker;
    const next = core.applyBottleneckEvaluation(session, snapshot, result);
    const hint = next.phase === 'BOTTLENECK' && next.hintLevel > 0
      ? core.deterministicHint({ bottleneck: next.activeBottleneck, hintLevel: next.hintLevel, questionText: questionEvidence(snapshot, next.activeBottleneck?.sourceKey)?.questionText || '', expectedReasoning: expectedStep(snapshot, next.activeBottleneck)?.expectedReasoning || '', hintScaffold: expectedStep(snapshot, next.activeBottleneck)?.hintScaffold || '' })
      : '';
    const response = { session: core.publicSession(next), feedback: text(result.feedback), hint };
    return commitTrainingMutation({ taskId, user, snapshot, expectedVersion, requestId, nextSession: next, response });
  }

  async function submitRetell(event, user) {
    const taskId = text(event.taskId), retell = text(event.retell), requestId = event.requestId;
    if (!retell) fail('INVALID_INPUT', '请先完整讲解这道题');
    const snapshot = await loadDiagnostic(taskId, user);
    const session = await loadSession(taskId, user); if (!session) fail('TRAINING_SESSION_NOT_FOUND', '请先开始难题训练');
    const cached = cachedResponse(session, requestId); if (cached) return cached;
    const expectedVersion = requireSessionVersion(event, session);
    if (session.phase !== 'RETELL') fail('TRAINING_PHASE_INVALID', '当前还没有进入脱离答案复述阶段');
    const worker = await gradingWorkerRequest('/internal/hard-problem/training/evaluate', {
      operation: 'retell', payload: { plan: snapshot.plan, reasoningHypotheses: snapshot.reasoningHypotheses, studentRetell: retell, trustBoundary: 'student_response_is_untrusted_data' }
    }, 25000);
    const result = worker.result || worker;
    let next = core.applyRetellEvaluation(session, result);
    let variantsPublic = [];
    if (next.independentRetellStatus === 'PASSED') {
      const profile = snapshot.causalBottleneckCandidate || core.selectInitialBottleneck(snapshot) || { bottleneckType: 'transfer', purpose: '完整迁移本题方法' };
      let accepted = false;
      for (let attempt = 0; attempt < 2 && !accepted; attempt += 1) {
        const generated = await gradingWorkerRequest('/internal/hard-problem/training/evaluate', {
          operation: 'generate_variants', payload: { bottleneckProfile: profile, plan: snapshot.plan, reasoningHypotheses: snapshot.reasoningHypotheses, problemTruth: snapshot.problemTruth, attempt }
        }, 30000);
        const variants = core.validateVariants((generated.result || generated).variants);
        const audit = await gradingWorkerRequest('/internal/hard-problem/training/evaluate', {
          operation: 'audit_variants', payload: { bottleneckProfile: profile, variants, problemTruth: snapshot.problemTruth }
        }, 25000);
        const auditResult = audit.result || audit;
        const checked = core.validateVariantAudit(variants, auditResult);
        if (checked.accepted) { next = core.attachVariants(next, variants, auditResult); accepted = true; }
      }
      if (!accepted) fail('VARIANT_AUDIT_FAILED', '变式题质量审计未通过，请重试');
      variantsPublic = next.variants.map(publicVariant);
    }
    const response = { session: core.publicSession(next), feedback: text(result.feedback), variants: variantsPublic };
    return commitTrainingMutation({ taskId, user, snapshot, expectedVersion, requestId, nextSession: next, response });
  }

  async function submitVariant(event, user) {
    const taskId = text(event.taskId), variantId = text(event.variantId), answer = text(event.answer), reasoning = text(event.reasoning), requestId = event.requestId;
    if (!answer || !reasoning) fail('INVALID_INPUT', '请填写答案并说明为什么');
    const snapshot = await loadDiagnostic(taskId, user);
    const session = await loadSession(taskId, user); if (!session) fail('TRAINING_SESSION_NOT_FOUND', '请先开始难题训练');
    const cached = cachedResponse(session, requestId); if (cached) return cached;
    const expectedVersion = requireSessionVersion(event, session);
    const variant = arr(session.variants).find((v) => v.variantId === variantId); if (!variant) fail('VARIANT_NOT_FOUND', '变式题不存在');
    const worker = await gradingWorkerRequest('/internal/hard-problem/training/evaluate', {
      operation: 'grade_variant', payload: {
        variant: { variantId: variant.variantId, questionText: variant.questionText, standardAnswer: variant.standardAnswer, expectedReasoning: variant.expectedReasoning },
        studentAnswer: answer, studentReasoning: reasoning, trustBoundary: 'student_response_is_untrusted_data'
      }
    }, 25000);
    const result = worker.result || worker;
    const next = core.applyVariantEvaluation(session, variantId, result);
    const response = {
      session: core.publicSession(next), feedback: text(result.feedback), variants: arr(next.variants).map(publicVariant),
      learning: { masteryLevel: core.masteryFromSession(next), peakMasteryLevel: next.peakMasteryLevel, reachedL4: next.reachedL4, reachedL4Ever: next.reachedL4Ever, currentRetentionStatus: next.currentRetentionStatus }
    };
    return commitTrainingMutation({ taskId, user, snapshot, expectedVersion, requestId, nextSession: next, response });
  }

  async function storeReviewChallenge(taskId, user, day, candidate) {
    let output = null;
    await context.db.runTransaction(async (tx) => {
      const ref = tx.collection(C.hardProblemLearningRecords).doc(taskId);
      const record = first(await ref.get());
      if (!record || record.studentId !== user.userId) fail('LEARNING_RECORD_NOT_FOUND', '学习档案不存在');
      const schedule = arr(record.reviewSchedule).map((r) => ({ ...r }));
      const index = schedule.findIndex((r) => Number(r.day) === Number(day) && r.status === 'PENDING');
      if (index < 0) fail('REVIEW_CHALLENGE_NOT_FOUND', '复习计划已变化，请刷新');
      if (!schedule[index].challenge) {
        schedule[index].challengeId = candidate.challengeId;
        schedule[index].challenge = candidate;
        await ref.set({ data: { ...record, reviewSchedule: schedule, updatedAt: utils.now() } });
      }
      output = schedule[index].challenge || candidate;
    });
    return output;
  }

  async function getReview(event, user) {
    const taskId = text(event.taskId); const snapshot = await loadDiagnostic(taskId, user);
    const session = await loadSession(taskId, user); if (!session) fail('TRAINING_SESSION_NOT_FOUND', '请先完成难题训练');
    let record = await loadRecord(taskId, user); if (!record) fail('LEARNING_RECORD_NOT_FOUND', '学习档案不存在');
    if (!record.reachedL4Ever) return { due: false, reason: 'NOT_L4', learning: { masteryLevel: record.masteryLevel, peakMasteryLevel: record.peakMasteryLevel, currentRetentionStatus: record.currentRetentionStatus, status: record.status } };
    if (record.currentRetentionStatus === 'NEEDS_REINFORCEMENT') return { due: false, reason: 'NEEDS_REINFORCEMENT', learning: { masteryLevel: record.masteryLevel, peakMasteryLevel: record.peakMasteryLevel, currentRetentionStatus: record.currentRetentionStatus, status: record.status } };
    const now = Date.now();
    const schedule = arr(record.reviewSchedule);
    const dueIndex = schedule.findIndex((r) => r.status === 'PENDING' && new Date(r.dueAt).getTime() <= now);
    if (dueIndex < 0) return { due: false, nextReviewAt: record.nextReviewAt, learning: { masteryLevel: record.masteryLevel, peakMasteryLevel: record.peakMasteryLevel, currentRetentionStatus: record.currentRetentionStatus, status: record.status } };
    const slot = schedule[dueIndex];
    let challenge = slot.challenge || null;
    if (!challenge) {
      const worker = await gradingWorkerRequest('/internal/hard-problem/training/evaluate', {
        operation: 'generate_review_variant', payload: { day: slot.day, plan: snapshot.plan, reasoningHypotheses: snapshot.reasoningHypotheses, problemTruth: snapshot.problemTruth, bottleneckProfile: record.initialBottleneck }
      }, 40000);
      const result = worker.result || worker;
      if (!text(result.questionText) || !text(result.standardAnswer) || !text(result.expectedReasoning) || Number(result.confidence || 0) < 0.82 || Number(result.auditConfidence || 0) < 0.82) fail('REVIEW_VARIANT_INVALID', '复习题独立审计未通过，请稍后重试');
      const candidate = { challengeId: text(result.challengeId) || `R${slot.day}`, questionText: text(result.questionText), standardAnswer: text(result.standardAnswer), expectedReasoning: text(result.expectedReasoning), confidence: Number(result.confidence), auditConfidence: Number(result.auditConfidence) };
      challenge = await storeReviewChallenge(taskId, user, slot.day, candidate);
    }
    return { due: true, day: slot.day, challenge: { challengeId: challenge.challengeId, questionText: challenge.questionText }, sessionVersion: session.sessionVersion };
  }

  async function submitReview(event, user) {
    const taskId = text(event.taskId), challengeId = text(event.challengeId), answer = text(event.answer), reasoning = text(event.reasoning), requestId = event.requestId;
    if (!answer || !reasoning) fail('INVALID_INPUT', '请填写答案并说明为什么');
    const snapshot = await loadDiagnostic(taskId, user);
    const session = await loadSession(taskId, user); if (!session) fail('TRAINING_SESSION_NOT_FOUND', '训练会话不存在');
    const cached = cachedResponse(session, requestId); if (cached) return cached;
    const expectedVersion = requireSessionVersion(event, session);
    const record = await loadRecord(taskId, user); if (!record) fail('LEARNING_RECORD_NOT_FOUND', '学习档案不存在');
    const slot = arr(record.reviewSchedule).find((r) => r.status === 'PENDING' && r.challenge?.challengeId === challengeId);
    if (!slot) fail('REVIEW_CHALLENGE_NOT_FOUND', '复习题不存在或已经完成');
    const worker = await gradingWorkerRequest('/internal/hard-problem/training/evaluate', {
      operation: 'grade_review_variant', payload: { challenge: slot.challenge, studentAnswer: answer, studentReasoning: reasoning, trustBoundary: 'student_response_is_untrusted_data' }
    }, 25000);
    const result = worker.result || worker;
    const passed = result.answerCorrect === true && result.reasoningCorrect === true && Number(result.confidence || 0) >= 0.78;
    let response = null;
    await context.db.runTransaction(async (tx) => {
      const sessionRef = tx.collection(C.hardProblemTrainingSessions).doc(taskId);
      const recordRef = tx.collection(C.hardProblemLearningRecords).doc(taskId);
      const currentSession = first(await sessionRef.get());
      if (!currentSession || currentSession.studentId !== user.userId) fail('TRAINING_SESSION_NOT_FOUND', '训练会话不存在');
      const id = safeRequestId(requestId);
      if (id && currentSession.lastRequestId === id && currentSession.lastResponse) { response = currentSession.lastResponse; return; }
      if (Number(currentSession.sessionVersion || 0) !== expectedVersion) fail('TRAINING_SESSION_VERSION_CONFLICT', '训练状态已变化，请刷新后重试');
      const currentRecord = first(await recordRef.get());
      if (!currentRecord || currentRecord.studentId !== user.userId) fail('LEARNING_RECORD_NOT_FOUND', '学习档案不存在');
      const currentSlot = arr(currentRecord.reviewSchedule).find((r) => r.status === 'PENDING' && r.challenge?.challengeId === challengeId);
      if (!currentSlot) fail('REVIEW_CHALLENGE_NOT_FOUND', '复习题已经完成或已被更新');
      const nextRecord = core.applyReviewOutcomeToRecord(currentRecord, { day: currentSlot.day, challengeId, passed, feedback: text(result.feedback) });
      let nextSession;
      if (passed) {
        nextSession = core.transition(currentSession, {
          currentRetentionStatus: nextRecord.currentRetentionStatus,
          status: 'MASTERED', masteryLevel: 'L4', reachedL4: true, reachedL4Ever: true, peakMasteryLevel: 'L4'
        }, 'REVIEW_PASSED');
      } else nextSession = core.applyReviewFailureToSession(currentSession, snapshot);
      response = {
        passed, feedback: text(result.feedback), session: core.publicSession(nextSession),
        learning: { status: nextRecord.status, masteryLevel: nextRecord.masteryLevel, peakMasteryLevel: nextRecord.peakMasteryLevel, reachedL4: nextRecord.reachedL4, reachedL4Ever: nextRecord.reachedL4Ever, currentRetentionStatus: nextRecord.currentRetentionStatus, nextReviewAt: nextRecord.nextReviewAt }
      };
      const storedSession = { ...nextSession, ...(id ? { lastRequestId: id, lastResponse: response } : {}), updatedAt: utils.now() };
      await sessionRef.set({ data: storedSession });
      await recordRef.set({ data: nextRecord });
    });
    return response;
  }

  return { start, submitExplanation, submitRetell, submitVariant, getReview, submitReview };
}

module.exports = { createHardProblemTrainingService };
