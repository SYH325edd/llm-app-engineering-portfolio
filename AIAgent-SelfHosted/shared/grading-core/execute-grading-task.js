'use strict';
const path = require('node:path');
const { createHash } = require('node:crypto');
const outputSchemaRegistry = require(path.join(__dirname, '../output-schema-registry'));
const { validateFinalResultContract, validateQuestionSetAudit, inspectStudentVisibleText, questionAttributionDiagnostics, validateQuestionAttribution, deriveHardProblemAggregateState, deriveHardProblemEvaluationStatus, deriveHardProblemErrorType, normalizeHardProblemQuestion, normalizeHardProblemTeachingStep } = require(path.join(__dirname, '../output-schema-validator'));
const { realignHardProblemExplanations } = require(path.join(__dirname, '../explanation-matcher'));
const { getModelRuntimeStage } = require(path.join(__dirname, '../model-runtime'));
const hardProblemV9 = require('./hard-problem-v9');
const hardProblemV10 = require('./hard-problem-v10');

function ownerFingerprint(owner) {
  return typeof owner === 'string' && owner ? createHash('sha256').update(owner).digest('hex').slice(0, 8) : null;
}

function safeCheckinDiagnosticMessage(error) {
  return String(error?.message || error?.errMsg || 'Unknown error')
    .replace(/cloud:\/\/[^\s",}]+/g, '[REDACTED_FILE_ID]')
    .replace(/https?:\/\/\S+/g, '[REDACTED_URL]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(token|authorization|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

function dataSpaceOf(record) {
    return record?.dataSpace === 'developer_test' ? 'developer_test' : 'production';
}

const HARD_PROBLEM_REVIEW_MAX_RECOVERY = 1;
const HARD_PROBLEM_UNDERSTANDING_MAX_RECOVERY = 1;
// CloudBase single-document limit is 16 MB. Hard-problem stage handoff is deliberately capped
// far below that limit so task metadata, leases and future fields always retain headroom.
const HARD_PROBLEM_TASK_DRAFT_MAX_BYTES = 1024 * 1024;
const HARD_PROBLEM_REVIEW_RECOVERABLE_CODES = new Set([
  'HARD_PROBLEM_FIXED_RESULT_MISMATCH',
  'LLM_JSON_PARSE_ERROR',
  'LLM_SCHEMA_ERROR',
  'LLM_SCHEMA_REPAIR_FAILED',
  'UNSUPPORTED_OUTPUT_SCHEMA_VERSION',
  'LLM_EMPTY_RESPONSE',
  'QWEN_OUTPUT_TRUNCATED',
  'ARK_OUTPUT_TRUNCATED'
]);
const HARD_PROBLEM_FINAL_RECOVERABLE_CODES = new Set([
  'LLM_SCHEMA_ERROR',
  'QUESTION_SET_AUDIT_MISSING',
  'QUESTION_SET_AUDIT_INVALID',
  'QUESTION_SET_AUDIT_COUNT_MISMATCH',
  'FINAL_QUESTION_SET_AUDIT_MISMATCH',
  'FINAL_QUESTION_ATTRIBUTION_INVALID',
  'QUESTION_SET_MISMATCH'
]);

function safeDiagnosticText(value, maxLength = 200) {
  return String(value || '').replace(/https?:\/\/\S+/g, '[REDACTED_URL]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, maxLength);
}

function hardProblemReviewRecoverable(error) {
  return HARD_PROBLEM_REVIEW_RECOVERABLE_CODES.has(String(error?.code || ''))
    || HARD_PROBLEM_REVIEW_RECOVERABLE_CODES.has(String(error?.causeCode || ''));
}
function hardProblemFinalRecoverable(error) {
  return HARD_PROBLEM_FINAL_RECOVERABLE_CODES.has(String(error?.code || ''))
    || HARD_PROBLEM_FINAL_RECOVERABLE_CODES.has(String(error?.causeCode || ''));
}
function hardProblemDraftBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8'); }
  catch { return Number.POSITIVE_INFINITY; }
}
function compactHardProblemAlignmentDraft(alignment) {
  const questions = Array.isArray(alignment?.questions) ? alignment.questions : [];
  return {
    version: String(alignment?.version || 'hard-problem-evidence-alignment.v2'),
    layoutType: String(alignment?.layoutType || 'uncertain'),
    questionCount: questions.length,
    questions: questions.map((question) => ({
      sourceKey: String(question?.sourceKey || ''),
      stepCount: Array.isArray(question?.pairedSteps) ? question.pairedSteps.length : 0,
      missingSourceStepCount: Array.isArray(question?.pairedSteps)
        ? question.pairedSteps.filter((step) => !String(step?.solutionText || '').trim() && !String(step?.explanationText || '').trim()).length
        : 0
    }))
  };
}

function hardProblemFailureDiagnostics(error, task = null, stage = null) {
  const hardProblemTask = String(task?.mode || '') === 'HARD_PROBLEM_CHECK';
  const provider = String(error?.modelProvider || (hardProblemTask ? task?.hardProblemModelProvider || 'ark_lite' : '')).slice(0, 50) || null;
  const modelName = String(error?.modelName || (provider === 'qwen3_vl_plus' ? 'qwen3.7-plus' : provider === 'ark_lite' ? 'doubao-seed-lite' : '')).slice(0, 100) || null;
  const inferredRequestStage = hardProblemTask
    ? (stage === 'REVIEW_GRADING' ? 'hardProblemReview' : stage === 'PRIMARY_GRADING' ? 'hardProblemPrimary' : '')
    : '';
  return {
    errorCode: String(error?.code || 'TASK_PROCESS_FAILED').slice(0, 100),
    causeCode: String(error?.causeCode || error?.repairFailureReason || '').slice(0, 100) || null,
    fieldPath: typeof error?.fieldPath === 'string' ? error.fieldPath.slice(0, 200) : null,
    requestStage: String(error?.requestStage || inferredRequestStage).slice(0, 100) || null,
    modelProvider: provider,
    modelName,
    providerRequestIdPresent: Boolean(error?.providerRequestId),
    repairAttempted: error?.repairAttempted === true,
    repairAttemptCount: Number.isFinite(Number(error?.repairAttemptCount)) ? Number(error.repairAttemptCount) : 0,
    repairFailureStage: String(error?.repairFailureStage || '').slice(0, 100) || null,
    safeMessage: safeDiagnosticText(error?.message || '')
  };
}

function hardProblemReviewRecoveryInstruction(task, alignment) {
  const count = Number(task?.hardProblemReviewRecoveryCount || 0);
  if (count < 1) return '';
  const expected = alignment.questions.map((question) => ({ sourceKey: question.sourceKey, stepCount: question.pairedSteps.length }));
  const prior = task?.hardProblemReviewLastFailure && typeof task.hardProblemReviewLastFailure === 'object'
    ? { errorCode: task.hardProblemReviewLastFailure.errorCode || null, causeCode: task.hardProblemReviewLastFailure.causeCode || null, fieldPath: task.hardProblemReviewLastFailure.fieldPath || null }
    : null;
  if (prior?.causeCode === 'MISSING_REQUIRED_PATCH')
    return `\n\n【字段修复补丁不完整后的结构恢复】上一次字段修复补丁不完整。必须重新查看原图，完整返回契约要求的 JSON；重点修正安全诊断所指字段，但不得删除、合并或重排 questions，也不得改变题目身份。上次安全诊断：${JSON.stringify(prior)}。`;
  if (String(prior?.errorCode || '').includes('QUESTION_'))
    return `\n\n【题目身份与题数审计恢复】上一次输出的题目身份或题数审计不一致。必须逐题重新查看原图，保持已有 sourceKey 对应关系，并让 questionSetAudit 与实际 questions 数量严格一致。上次安全诊断：${JSON.stringify(prior)}。`;
  if (String(prior?.errorCode || '').includes('SCHEMA'))
    return `\n\n【输出字段契约恢复】上一次输出未满足字段契约。必须完整返回契约要求的 JSON，重点修正安全诊断所指字段，不得改变无关题目、步骤或结论。上次安全诊断：${JSON.stringify(prior)}。`;
  return `

【结构恢复重试】上一次输出未通过固定步骤契约。必须逐题返回，每个 fixedEvidenceQuestions 项都要对应一个 questions[]，并完整返回同数量的 stepFeedbacks。期望步骤数量：${JSON.stringify(expected)}。上次安全诊断：${JSON.stringify(prior)}。重新完成逐步判断，但不得改写学生原文、不得改变已锁定的步骤数量、顺序和边界；只输出契约要求的 JSON 字段，禁止解释性前后缀和重复内容。`;
}

async function executeGradingTask({ taskId, runtime, preclaimedContext = null, executionFence = null }) {
  if (preclaimedContext) {
    console.info('[gradingWorker] WORKER_PRECLAIM_CONTEXT', JSON.stringify({
      taskId,
      ownerPresent: Boolean(preclaimedContext.workerLeaseOwner),
      ownerFingerprint: ownerFingerprint(preclaimedContext.workerLeaseOwner),
      workerAttempt: preclaimedContext.workerAttempt,
      leaseUntilPresent: Boolean(preclaimedContext.workerLeaseUntil)
    }));
  }
  const claimed = preclaimedContext
    ? { reason: 'CLAIMED', task: await runtime.loadTask(taskId) }
    : await runtime.claim(taskId);
  if (claimed.reason !== 'CLAIMED') {
    return { success: true, ignored: true, reason: claimed.reason, outcome: 'IGNORED' };
  }
  if (!claimed.task) {
    return { success: false, taskId, errorCode: 'TASK_NOT_FOUND', outcome: 'FAILED' };
  }
  try {
    const processResult = await runtime.process(claimed.task, Date.now(), executionFence);
    const current = await runtime.loadTask(taskId);
    const processOutcome = String(processResult?.outcome || '').trim().toUpperCase();
    const outcome = ['CONTINUE', 'COMPLETED', 'WAITING_USER', 'FAILED', 'LEASE_LOST'].includes(processOutcome)
      ? processOutcome
      : current?.status === 'COMPLETED' && current?.resultId
        ? 'COMPLETED'
        : ['NEED_CONFIRMATION', 'NEED_ANSWER'].includes(String(current?.status || ''))
          ? 'WAITING_USER'
          : current?.status === 'QUEUED'
            ? 'CONTINUE'
            : ['FAILED', 'CANCELLED'].includes(String(current?.status || ''))
              ? 'FAILED'
              : 'FAILED';
    const nextStage = outcome === 'CONTINUE'
      ? processResult?.nextStage || current?.currentStage || null
      : current?.currentStage || processResult?.nextStage || null;
    return {
      success: true,
      taskId,
      outcome,
      nextStage,
      resultId: processResult?.resultId || current?.resultId || null,
      observedStage: current?.currentStage || null,
      handoffPatch: processResult?.handoffPatch || null,
      handoffToken: processResult?.handoffToken || null
    };
  } catch (error) {
    if (error?.code === 'TASK_WORKER_LEASE_LOST') return { success: false, taskId, errorCode: error.code, outcome: 'LEASE_LOST' };
    const stage = claimed.task.currentStage || runtime.defaultStage;
    const handled = await runtime.fail({ taskId, stage, error, executionFence });
    if (!handled) return { success: false, taskId, errorCode: 'TASK_WORKER_LEASE_LOST', outcome: 'LEASE_LOST' };
    const current = await runtime.loadTask(taskId);
    const outcome = ['NEED_CONFIRMATION', 'NEED_ANSWER'].includes(String(current?.status || '')) ? 'WAITING_USER' : 'FAILED';
    return {
      success: false,
      taskId,
      outcome,
      errorCode: current?.errorCode || error?.code || 'TASK_EXECUTION_FAILED',
      causeCode: current?.failureCauseCode || error?.causeCode || null,
      fieldPath: current?.failureFieldPath || error?.fieldPath || null,
      requestStage: current?.failureRequestStage || error?.requestStage || null,
      modelProvider: current?.failureModelProvider || error?.modelProvider || null,
      modelName: current?.failureModelName || error?.modelName || null,
      providerRequestIdPresent: current?.failureProviderRequestIdPresent === true || Boolean(error?.providerRequestId),
      repairAttempted: current?.failureRepairAttempted === true || error?.repairAttempted === true,
      repairAttemptCount: Number(current?.failureRepairAttemptCount || error?.repairAttemptCount || 0),
      repairFailureStage: current?.failureRepairFailureStage || error?.repairFailureStage || null,
      failureId: current?.failureId || null
    };
  }
}

function createGradingRuntime(options) {
  const context_1 = options.context;
  const constants_1 = options.constants;
  const audit_1 = options.audit;
  const ark_1 = options.ark;
  const utils_1 = options.utils;
  const checkin_1 = options.checkin;
  const task_error_1 = options.taskError;
  const taskFailureCase = options.taskFailureCase || require(path.join(__dirname, '../task-failure-case'));
  const json_1 = options.json;
  const embedded_1 = options.embedded;
  const remote_1 = options.remote;
  const strategyRender = options.strategyRender;
  const resultSemantics = options.resultSemantics || require(path.join(__dirname, '../result-semantics'));
  const auditSource = String(options.auditSource || 'taskWorker');
  const deferStagePersistence = options.deferStagePersistence === true;
  const firstDocument = typeof options.getFirstDocument === 'function'
    ? options.getFirstDocument
    : (snapshot) => Array.isArray(snapshot?.data) ? snapshot.data[0] || null : snapshot?.data || null;
  const scheduleNextStageHook = typeof options.scheduleNextStage === 'function'
    ? options.scheduleNextStage
    : async () => ({ scheduled: false, mode: 'database_only' });
  const enqueueTtsHook = typeof options.enqueueTts === 'function'
    ? options.enqueueTts
    : async () => ({ scheduled: false });
  function updatedCount(result) {
    const candidates = [result?.updated, result?.stats?.updated, result?.data?.updated, result?.matched];
    const value = candidates.find((item) => Number.isFinite(Number(item)));
    return value === undefined ? null : Number(value);
  }
  async function readTask(taskId) {
    return firstDocument(await context_1.db.collection(constants_1.C.tasks).doc(taskId).get());
  }
  function valueMatchesPatch(actual, expected) {
    const normalize = (item) => {
      if (item instanceof Date) return item.getTime();
      if (item && typeof item === 'object' && typeof item.toDate === 'function') {
        const date = item.toDate();
        return date instanceof Date ? date.getTime() : item;
      }
      if (typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(item)) {
        const timestamp = Date.parse(item);
        return Number.isNaN(timestamp) ? item : timestamp;
      }
      if (Array.isArray(item)) return item.map(normalize);
      if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
      return item;
    };
    return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
  }
  function taskContainsPatch(task, patch) {
    return Boolean(task) && Object.entries(patch || {}).every(([key, value]) => valueMatchesPatch(task[key], value));
  }
  function workerFenceQuery(taskId, fence) {
    return {
      _id: taskId,
      workerQueueStatus: 'RUNNING',
      workerStatus: 'RUNNING',
      workerLeaseOwner: fence.workerLeaseOwner,
      workerAttempt: Number(fence.workerAttempt || 0)
    };
  }
  async function updateTaskWithFence(taskId, patch, fence) {
    if (!fence) {
      await context_1.db.collection(constants_1.C.tasks).doc(taskId).update({ data: patch });
      return true;
    }
    const collection = context_1.db.collection(constants_1.C.tasks);
    if (typeof collection.where === 'function') {
      const query = collection.where(workerFenceQuery(taskId, fence));
      if (query && typeof query.update === 'function') {
        const result = await query.update(patch);
        const count = updatedCount(result);
        if (count !== null) return count > 0;
        const observed = await readTask(taskId);
        if (taskContainsPatch(observed, patch)) return true;
        if (!workerFenceMatches(observed, fence)) return false;
      }
    }
    return context_1.db.runTransaction(async (transaction) => {
      const ref = transaction.collection(constants_1.C.tasks).doc(taskId);
      if (!workerFenceMatches(firstDocument(await ref.get()), fence)) return false;
      await ref.update({ data: patch });
      return true;
    });
  }
const LEASE_MS = 55_000;
const WORKER_BUDGET_MS = 55_000;
const AI_TIMEOUT_MS = 30_000;
const STAGES = { PREPARING_IMAGES: 'PREPARING_IMAGES', PRIMARY_GRADING: 'PRIMARY_GRADING', REVIEW_GRADING: 'REVIEW_GRADING', FINALIZING_RESULT: 'FINALIZING_RESULT' };
function leaseLost() { return Object.assign(new Error('Task worker lease lost'), { code: 'TASK_WORKER_LEASE_LOST' }); }
 function fenceMatches(task, fence) { return !fence || (task && task.workerLeaseOwner === fence.workerLeaseOwner && Number(task.workerAttempt || 0) === Number(fence.workerAttempt || 0)); }
 function workerFenceMatches(task, fence) { return fenceMatches(task, fence) && task.workerQueueStatus === 'RUNNING' && task.workerStatus === 'RUNNING'; }
 async function assertFence(taskId, fence) {
     if (!fence) return;
    const current = await readTask(taskId);
    if (!workerFenceMatches(current, fence)) {
        console.error('[gradingWorker] WORKER_FENCE_MISMATCH', JSON.stringify({ taskId, expectedOwnerFingerprint: ownerFingerprint(fence.workerLeaseOwner), actualOwnerFingerprint: ownerFingerprint(current?.workerLeaseOwner), expectedAttempt: fence.workerAttempt, actualAttempt: current?.workerAttempt, observedWorkerQueueStatus: current?.workerQueueStatus, observedWorkerStatus: current?.workerStatus }));
        throw leaseLost();
    }
}
function progressFor(stage) { return { PREPARING_IMAGES: 5, PRIMARY_GRADING: 25, REVIEW_GRADING: 60, FINALIZING_RESULT: 85 }[stage] || 5; }
function stageMessage(stage) { return { PREPARING_IMAGES: '正在准备作业图片', PRIMARY_GRADING: '正在进行首次批改', REVIEW_GRADING: '正在进行独立复核', FINALIZING_RESULT: '正在生成最终批改结果' }[stage] || '正在处理'; }
function canStartAi(startedAt) { return Date.now() - startedAt <= WORKER_BUDGET_MS - AI_TIMEOUT_MS - 2_000; }
function isCareless(task) { return task.mode === 'CARELESS_TRAINING'; }
function isCalculationCareless(task) { return isCareless(task) && task.carelessTrainingType === 'CALCULATION'; }
function hardProblemModelProvider(task) {
    return String(task?.hardProblemModelProvider || '') === 'qwen3_vl_plus' ? 'qwen3_vl_plus' : 'ark_lite';
}
function hardProblemPerceptionProvider(task) {
    // V10.5 perception-first routing: prefer Seed 2.0 Lite for the raw visual pass when Ark Lite is configured.
    // The structure correction / math judgment can still use the task-selected provider (for example Qwen 3.7 Plus).
    if (globalThis.process?.env?.ARK_API_KEY && globalThis.process?.env?.ARK_LITE_ENDPOINT) return 'ark_lite';
    return hardProblemModelProvider(task);
}
function transportField(stage) { return stage === STAGES.PRIMARY_GRADING ? 'primaryTransportAttempt' : 'reviewTransportAttempt'; }
function requestStageFor(task, logicalPass) {
    const suffix = logicalPass === 2 ? 'Review' : 'Primary';
    return isCalculationCareless(task) ? `calculationCareless${suffix}` : isCareless(task) ? `readingCareless${suffix}` : `hardProblem${suffix}`;
}
function shouldExcludePrintedQuestionWithoutWork(question) {
    const printedWithoutWork = question?.studentWorkDetected === false && question?.inputBasis === 'printed_question_without_work';
    if (!printedWithoutWork) return false;
    // In the v8 evidence pipeline, an unanswered hard problem is retained only after the
    // ExpectedReasoningPlan has been materialized as visible missing stepFeedbacks.
    // Legacy/direct hard-problem drafts without a locked plan keep their historical exclusion behavior.
    if (question?.outputSchemaVersion === 'hard-problem.v2' && Array.isArray(question?.stepFeedbacks) && question.stepFeedbacks.length > 0) return false;
    return true;
}
function shouldExcludeReadingCarelessNotApplicable(question) {
    return question?.outputSchemaVersion === 'reading-careless.v2' && question?.modeApplicability === 'not_applicable';
}
function excludePrintedQuestionsWithoutWork(questions) {
    return (Array.isArray(questions) ? questions : [])
        .filter((question) => !shouldExcludePrintedQuestionWithoutWork(question))
        .filter((question) => !shouldExcludeReadingCarelessNotApplicable(question));
}
function strategyRequiresQuestionSetAudit(strategy, outputSchemaVersion = null) {
    const schemas = strategy?.outputSchemaRegistry?.schemas;
    const registryRequiresAudit = Array.isArray(schemas) && schemas.some((schema) => (!outputSchemaVersion || schema?.schemaId === outputSchemaVersion) && [schema?.topLevelRequiredFields, schema?.requiredTopLevelFields, schema?.topLevelSchema?.required, schema?.topLevelContract?.requiredFields].some((fields) => Array.isArray(fields) && fields.includes('questionSetAudit')));
    if (registryRequiresAudit) return true;
    if (outputSchemaVersion !== 'hard-problem.v2') return false;
    return Array.isArray(strategy?.contracts?.hardProblemV2?.topLevelRequiredFields) && strategy.contracts.hardProblemV2.topLevelRequiredFields.includes('questionSetAudit');
}
function assertHardProblemExplanationContract(strategy) {
    const strategyVersion = String(strategy?.strategyVersion || strategy?.version || '').trim();
    if (!strategyVersion) return;
    const contract = strategy?.contracts?.hardProblemV2;
    const required = new Set(Array.isArray(contract?.requiredFields) ? contract.requiredFields : []);
    const itemSchema = contract?.arrayItemSchemas?.stepFeedbacks;
    const itemRequired = new Set(Array.isArray(itemSchema?.requiredFields) ? itemSchema.requiredFields : []);
    const expectedQuestionFields = ['stepFeedbacks', 'overallFeedback', 'studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'];
    const expectedStepFields = ['stepIndex', 'solutionText', 'explanationText', 'solutionStatus', 'explanationStatus', 'logicStatus', 'analysis', 'correctionAdvice'];
    const expectedStepEnums = {
        solutionStatus: ['correct', 'wrong', 'missing', 'unreadable'],
        explanationStatus: ['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable'],
        logicStatus: ['clear', 'insufficient', 'wrong', 'unreadable']
    };
    const promptText = `${String(strategy?.prompts?.hardProblem?.system || '')}\n${String(strategy?.prompts?.hardProblem?.userTemplate || '')}`;
    const evidencePromptText = `${String(strategy?.prompts?.hardProblemEvidence?.system || '')}\n${String(strategy?.prompts?.hardProblemEvidence?.userTemplate || '')}`;
    const versionParts = strategyVersion.split('.').map((part) => Number(part));
    const requiresExpectedReasoningPlan = versionParts.length === 3 && versionParts.every(Number.isInteger)
        && (versionParts[0] > 1 || (versionParts[0] === 1 && (versionParts[1] > 3 || (versionParts[1] === 3 && versionParts[2] >= 30))));
    const evidenceContractFields = ['layoutType', 'processUnits', 'explanationUnits', 'sourceKey', 'questionText', 'studentAnswer',
        ...(requiresExpectedReasoningPlan ? ['expectedSteps', 'expectedReasoning', 'processUnitIds', 'explanationUnitIds'] : [])];
    const missingEvidencePromptFields = usesHardProblemEvidencePipeline(strategy)
        ? evidenceContractFields.filter((field) => !evidencePromptText.includes(field))
        : [];
    const missingQuestionFields = expectedQuestionFields.filter((field) => !required.has(field));
    const missingStepFields = expectedStepFields.filter((field) => !itemRequired.has(field));
    const missingPromptFields = usesHardProblemDirect(strategy) ? [] : [...expectedQuestionFields, ...expectedStepFields].filter((field) => !promptText.includes(field));
    const invalidStepEnumFields = Object.entries(expectedStepEnums).filter(([field, values]) => JSON.stringify(itemSchema?.enumFields?.[field] || []) !== JSON.stringify(values)).map(([field]) => field);
    const invalidRuntimeStages = ['hardProblemPrimary', 'hardProblemReview'].filter((stage) => strategy?.modelRuntime?.stages?.[stage]?.outputSchemaVersion !== 'hard-problem.v2');
    const expectedTopLevelFields = ['outputSchemaVersion', 'mode', 'route', 'imageQuality', 'questions', 'questionSetAudit'];
    const expectedTopLevelTypes = { outputSchemaVersion: 'string', mode: 'string', route: 'object', imageQuality: 'object', questions: 'array', questionSetAudit: 'object' };
    const topRequired = new Set(Array.isArray(contract?.topLevelRequiredFields) ? contract.topLevelRequiredFields : []);
    const missingTopLevelFields = expectedTopLevelFields.filter((field) => !topRequired.has(field) || contract?.topLevelFieldTypes?.[field] !== expectedTopLevelTypes[field]);
    const invalidTopLevelEnums = JSON.stringify(contract?.topLevelEnumFields?.mode || []) === JSON.stringify(['hard-problem']) ? [] : ['mode'];
    const requiredTopLevelObjectFields = { route: ['difficulty', 'confidence', 'flags'], imageQuality: ['ok', 'issues'], questionSetAudit: ['visibleIndependentQuestionCount', 'emittedQuestionCount', 'excludedQuestionCount', 'orientation', 'countConfidence'] };
    const invalidTopLevelObjectSchemas = Object.entries(requiredTopLevelObjectFields).filter(([field, fields]) => {
        const objectSchema = contract?.topLevelObjectSchemas?.[field];
        const requiredFields = new Set(Array.isArray(objectSchema?.requiredFields) ? objectSchema.requiredFields : []);
        return !objectSchema || fields.some((requiredField) => !requiredFields.has(requiredField) || !objectSchema?.fieldTypes?.[requiredField]);
    }).map(([field]) => field);
    if (missingQuestionFields.length || missingStepFields.length || missingPromptFields.length || missingEvidencePromptFields.length || invalidStepEnumFields.length || invalidRuntimeStages.length || missingTopLevelFields.length || invalidTopLevelEnums.length || invalidTopLevelObjectSchemas.length) {
        throw Object.assign(new Error('难题讲解策略契约与当前运行代码不兼容'), {
            code: 'STRATEGY_CONTRACT_INCOMPATIBLE',
            strategyVersion,
            missingQuestionFields,
            missingStepFields,
            missingPromptFields,
            missingEvidencePromptFields,
            invalidStepEnumFields,
            invalidRuntimeStages,
            missingTopLevelFields,
            invalidTopLevelEnums,
            invalidTopLevelObjectSchemas
        });
    }
}
function usesHardProblemEvidencePipeline(strategy) {
    if (usesHardProblemDirect(strategy)) return false;
    return Boolean(strategy?.prompts?.hardProblemEvidence?.system && strategy?.prompts?.hardProblemEvidence?.userTemplate);
}
const HARD_EVIDENCE_LAYOUTS = new Set(['left_right', 'top_bottom', 'single_stream', 'uncertain']);
const HARD_EVIDENCE_INPUT_BASIS = new Set(['printed_question_with_work', 'printed_question_without_work', 'work_only_complete', 'work_only_incomplete']);
const HARD_EVIDENCE_APPLICABILITY = new Set(['applicable', 'not_applicable', 'uncertain']);
const HARD_PROCESS_ROLES = new Set(['setup', 'equation', 'calculation', 'intermediate_result', 'final_result', 'answer_text', 'unknown']);
function evidenceString(value) { return typeof value === 'string' ? value.trim() : ''; }
function evidenceNumber(value, fallback = null) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function normalizeHardProblemEvidenceUnit(unit, index, kind) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) throw Object.assign(new Error('难题原文单元必须是对象'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', fieldPath: `${kind}Units[${index}]` });
    const text = evidenceString(unit.text);
    const unitId = evidenceString(unit.unitId) || `${kind === 'process' ? 'P' : 'E'}${index + 1}`;
    const order = Math.max(1, Math.floor(evidenceNumber(unit.order, index + 1)));
    const visualBand = evidenceNumber(unit.visualBand, null);
    if (!text && unit.readability !== 'unreadable') throw Object.assign(new Error('难题原文单元文本为空'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', fieldPath: `${kind}Units[${index}].text` });
    if (kind === 'process') {
        const role = HARD_PROCESS_ROLES.has(unit.role) ? unit.role : 'unknown';
        return { unitId, text, order, role, visualBand, readability: unit.readability === 'unreadable' ? 'unreadable' : 'readable' };
    }
    return { unitId, text, order, label: evidenceString(unit.label), visualBand, readability: unit.readability === 'unreadable' ? 'unreadable' : 'readable' };
}
function normalizeHardProblemEvidenceIdList(value) {
    return [...new Set((Array.isArray(value) ? value : []).map((item) => evidenceString(item)).filter(Boolean))];
}
function overMergedExpectedStepPurpose(step) {
    const text = `${evidenceString(step?.purpose)}\n${evidenceString(step?.expectedReasoning)}`;
    const has = (pattern) => pattern.test(text);
    if (has(/设(?:未知数)?|令(?:未知数)?|假设|设为|unknown\s*variable|\blet\b/i) && has(/列方程|建立(?:数量)?关系|数量关系|方程式|(?:form|write|set\s+up)\s+(?:an?\s+)?equation/i))
        return 'SETUP_AND_EQUATION';
    if (has(/列方程|建立(?:数量)?关系|数量关系|方程式|(?:form|write|set\s+up)\s+(?:an?\s+)?equation/i) && has(/解方程|求解方程|解出|solve(?:\s+the)?\s+equation/i))
        return 'EQUATION_AND_SOLVE';
    if (has(/解出(?:中间)?量|求出(?:中间)?量|得到(?:中间)?量|中间量|intermediate\s+(?:value|result)/i) && has(/利用(?:已求|上述|该)?(?:量|结果)|代入(?:已求|上述)?(?:量|结果)|再求(?:另|另一|其他)量|求(?:另|另一|其他)量|use\s+the\s+(?:intermediate|previous)\s+(?:value|result)/i))
        return 'INTERMEDIATE_AND_NEXT_QUANTITY';
    return '';
}
function normalizeHardProblemExpectedStep(step, index, knownProcessIds, knownExplanationIds, warnings) {
    const source = step && typeof step === 'object' && !Array.isArray(step) ? step : {};
    const stepId = evidenceString(source.stepId) || `S${index + 1}`;
    const order = Math.max(1, Math.floor(evidenceNumber(source.order, index + 1)));
    const purpose = evidenceString(source.purpose) || `第${index + 1}个必要推理步骤`;
    const expectedReasoning = evidenceString(source.expectedReasoning) || '根据题目补充这一必要推理步骤，并说明为什么这样做。';
    const processUnitIds = normalizeHardProblemEvidenceIdList(source.processUnitIds);
    const explanationUnitIds = normalizeHardProblemEvidenceIdList(source.explanationUnitIds);
    for (const unitId of processUnitIds) if (!knownProcessIds.has(unitId)) warnings.push(`EXPECTED_STEP_UNKNOWN_PROCESS_REF:${stepId}:${unitId}`);
    for (const unitId of explanationUnitIds) if (!knownExplanationIds.has(unitId)) warnings.push(`EXPECTED_STEP_UNKNOWN_EXPLANATION_REF:${stepId}:${unitId}`);
    return { stepId, order, purpose, expectedReasoning, processUnitIds, explanationUnitIds };
}
function buildFallbackExpectedSteps(question, processUnits, explanationUnits, warnings) {
    // This path exists only for malformed/legacy evidence. Production strategy 1.3.30 must emit expectedSteps.
    // It never fabricates student source text; it only creates a safe pedagogical checkpoint so the task can finish.
    if (question?.inputBasis === 'printed_question_without_work' || (!processUnits.length && !explanationUnits.length)) {
        warnings.push('EXPECTED_REASONING_PLAN_FALLBACK:GENERIC');
        return [{
            stepId: 'S1', order: 1, purpose: '完整解题过程',
            expectedReasoning: '请根据题目补充必要的解题步骤，并逐步说明每一步使用的数量关系、公式或运算依据。',
            processUnitIds: [], explanationUnitIds: []
        }];
    }
    const groups = groupEvidenceUnits(processUnits, explanationUnits);
    warnings.push(`EXPECTED_REASONING_PLAN_FALLBACK:LEGACY:${Math.max(1, groups.length)}`);
    return (groups.length ? groups : [{ processUnits: [], explanationUnits: [] }]).map((group, index) => ({
        stepId: `S${index + 1}`,
        order: index + 1,
        purpose: `第${index + 1}个必要推理步骤`,
        expectedReasoning: '请结合题目判断这一学生步骤的数学目的、依据和与前后步骤的衔接。',
        processUnitIds: (group.processUnits || []).map((unit) => unit.unitId),
        explanationUnitIds: (group.explanationUnits || []).map((unit) => unit.unitId)
    }));
}
function validateHardProblemEvidenceResult(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('难题原文提取结果必须是对象'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', fieldPath: '$' });
    const layoutType = HARD_EVIDENCE_LAYOUTS.has(value.layoutType) ? value.layoutType : 'uncertain';
    if (!Array.isArray(value.questions) || !value.questions.length) throw Object.assign(new Error('难题原文提取结果缺少题目'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', fieldPath: 'questions' });
    const seen = new Set();
    const questions = value.questions.map((question, questionIndex) => {
        if (!question || typeof question !== 'object' || Array.isArray(question)) throw Object.assign(new Error('难题原文题目必须是对象'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', fieldPath: `questions[${questionIndex}]` });
        const sourceKey = evidenceString(question.sourceKey);
        if (!sourceKey || seen.has(sourceKey)) throw Object.assign(new Error('难题原文 sourceKey 无效或重复'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', fieldPath: `questions[${questionIndex}].sourceKey` });
        seen.add(sourceKey);
        const inputBasis = HARD_EVIDENCE_INPUT_BASIS.has(question.inputBasis) ? question.inputBasis : 'work_only_incomplete';
        const studentWorkDetected = inputBasis === 'printed_question_without_work' ? false : question.studentWorkDetected !== false;
        const processUnits = (Array.isArray(question.processUnits) ? question.processUnits : []).map((unit, index) => normalizeHardProblemEvidenceUnit(unit, index, 'process')).sort((a, b) => a.order - b.order);
        const explanationUnits = (Array.isArray(question.explanationUnits) ? question.explanationUnits : []).map((unit, index) => normalizeHardProblemEvidenceUnit(unit, index, 'explanation')).sort((a, b) => a.order - b.order);
        if (inputBasis === 'printed_question_without_work' && (studentWorkDetected || processUnits.length || explanationUnits.length || evidenceString(question.studentAnswer)))
            throw Object.assign(new Error('印刷题无作答状态与可见学生内容冲突'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', fieldPath: `questions[${questionIndex}].inputBasis` });
        if (inputBasis !== 'printed_question_without_work' && studentWorkDetected !== true)
            throw Object.assign(new Error('存在学生作答时 studentWorkDetected 必须为 true'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', fieldPath: `questions[${questionIndex}].studentWorkDetected` });
        const processIds = processUnits.map((unit) => unit.unitId);
        const explanationIds = explanationUnits.map((unit) => unit.unitId);
        if (new Set(processIds).size !== processIds.length || new Set(explanationIds).size !== explanationIds.length) throw Object.assign(new Error('难题原文单元 ID 重复'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', fieldPath: `questions[${questionIndex}]` });
        const warnings = Array.isArray(question.warnings) ? question.warnings.map((item) => evidenceString(item)).filter(Boolean) : [];
        const knownProcessIds = new Set(processIds);
        const knownExplanationIds = new Set(explanationIds);
        let expectedSteps = (Array.isArray(question.expectedSteps) ? question.expectedSteps : [])
            .map((step, index) => normalizeHardProblemExpectedStep(step, index, knownProcessIds, knownExplanationIds, warnings))
            .sort((a, b) => a.order - b.order || a.stepId.localeCompare(b.stepId));
        const seenStepIds = new Set();
        expectedSteps = expectedSteps.filter((step) => {
            if (!step.stepId || seenStepIds.has(step.stepId)) { warnings.push(`EXPECTED_STEP_DUPLICATE_ID:${step.stepId || 'EMPTY'}`); return false; }
            seenStepIds.add(step.stepId); return true;
        }).slice(0, 20).map((step, index) => ({ ...step, order: index + 1 }));
        const overMergedStepIndex = expectedSteps.findIndex((step) => overMergedExpectedStepPurpose(step));
        if (overMergedStepIndex >= 0) {
            const reason = overMergedExpectedStepPurpose(expectedSteps[overMergedStepIndex]);
            throw Object.assign(new Error('Expected reasoning step merges independent mathematical purposes'), {
                code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR',
                fieldPath: `questions[${questionIndex}].expectedSteps[${overMergedStepIndex}].purpose`,
                reasonCode: `EXPECTED_STEP_OVER_MERGED:${reason}`
            });
        }
        const requestedEvidenceV2 = evidenceString(value.outputSchemaVersion) === 'hard-problem-evidence.v2';
        if (!expectedSteps.length && requestedEvidenceV2 && (question.modeApplicability !== 'not_applicable')) expectedSteps = buildFallbackExpectedSteps(question, processUnits, explanationUnits, warnings);
        return {
            sourceKey,
            layoutType: HARD_EVIDENCE_LAYOUTS.has(question.layoutType) ? question.layoutType : layoutType,
            questionText: evidenceString(question.questionText),
            studentAnswer: evidenceString(question.studentAnswer),
            studentWorkDetected,
            sourceQuestionLabel: evidenceString(question.sourceQuestionLabel) || `第${questionIndex + 1}题`,
            sourceRegion: evidenceString(question.sourceRegion) || `image-1:question-${questionIndex + 1}`,
            inputBasis,
            modeApplicability: HARD_EVIDENCE_APPLICABILITY.has(question.modeApplicability) ? question.modeApplicability : 'applicable',
            expectedSteps,
            processUnits,
            explanationUnits,
            confidence: Math.max(0, Math.min(1, evidenceNumber(question.confidence, 0))),
            warnings: [...new Set(warnings)]
        };
    });
    return { outputSchemaVersion: 'hard-problem-evidence.v2', layoutType, questions, _modelDiagnostics: value._modelDiagnostics || null };
}
function unitText(units) { return units.map((unit) => unit.text).filter(Boolean).join('\n'); }
function explicitVisualBand(value) {
    const band = evidenceNumber(value, null);
    return band !== null && band > 0 ? Math.floor(band) : null;
}
function evidenceUnitOrder(unit, fallback) {
    return Math.max(1, Math.floor(evidenceNumber(unit?.order, fallback)));
}
function resolvedEvidenceUnits(processUnits, explanationUnits) {
    const process = processUnits.map((unit, index) => ({ ...unit, _kind: 'process', _index: index, _resolvedBand: explicitVisualBand(unit.visualBand) }));
    const explanation = explanationUnits.map((unit, index) => ({ ...unit, _kind: 'explanation', _index: index, _resolvedBand: explicitVisualBand(unit.visualBand) }));
    const explicitByOrder = new Map();
    for (const unit of [...process, ...explanation]) {
        if (unit._resolvedBand !== null) explicitByOrder.set(evidenceUnitOrder(unit, unit._index + 1), unit._resolvedBand);
    }
    for (const unit of [...process, ...explanation]) {
        if (unit._resolvedBand === null) {
            const sameOrderBand = explicitByOrder.get(evidenceUnitOrder(unit, unit._index + 1));
            if (sameOrderBand !== undefined) unit._resolvedBand = sameOrderBand;
        }
    }
    return { process, explanation };
}
function evidenceBandKey(unit) {
    if (unit._resolvedBand !== null) return `band:${unit._resolvedBand}`;
    return `order:${evidenceUnitOrder(unit, unit._index + 1)}`;
}
function groupEvidenceUnits(processUnits, explanationUnits) {
    const resolved = resolvedEvidenceUnits(processUnits, explanationUnits);
    const groups = new Map();
    const ensure = (unit) => {
        const key = evidenceBandKey(unit);
        if (!groups.has(key)) groups.set(key, {
            key,
            visualBand: unit._resolvedBand,
            firstOrder: evidenceUnitOrder(unit, unit._index + 1),
            processUnits: [],
            explanationUnits: []
        });
        const group = groups.get(key);
        group.firstOrder = Math.min(group.firstOrder, evidenceUnitOrder(unit, unit._index + 1));
        return group;
    };
    for (const unit of resolved.process) ensure(unit).processUnits.push(unit);
    for (const unit of resolved.explanation) ensure(unit).explanationUnits.push(unit);
    const ordered = [...groups.values()].sort((left, right) => {
        const leftBand = left.visualBand === null ? Infinity : left.visualBand;
        const rightBand = right.visualBand === null ? Infinity : right.visualBand;
        return left.firstOrder - right.firstOrder || leftBand - rightBand || left.key.localeCompare(right.key);
    });
    for (const group of ordered) {
        group.processUnits.sort((a, b) => a.order - b.order || a._index - b._index);
        group.explanationUnits.sort((a, b) => a.order - b.order || a._index - b._index);
    }
    return ordered;
}
function compactEvidenceText(value) {
    return String(value || '').normalize('NFKC').replace(/^(答|所以|故|因此)\s*[:：]?\s*/, '').replace(/[\s，。；;、:：()（）]/g, '').toLowerCase();
}
function hardEvidenceLines(value) {
    return String(value || '').split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
}
function hardEvidenceRoleForLine(line, fallbackRole) {
    const value = String(line || '').trim();
    if (/^(?:解\s*[:：]?\s*)?设/.test(value)) return 'setup';
    if (/^(?:答|所以|故|因此)\s*[:：]?/.test(value)) return 'answer_text';
    if (/=/.test(value)) return /[a-zA-Z]/.test(value) ? 'equation' : 'calculation';
    return HARD_PROCESS_ROLES.has(fallbackRole) ? fallbackRole : 'unknown';
}
function expandHardProcessAtoms(units) {
    const atoms = [];
    for (const unit of units) {
        const lines = hardEvidenceLines(unit.text);
        const safeLines = lines.length ? lines : [unit.text];
        safeLines.forEach((line, lineIndex) => atoms.push({
            ...unit,
            unitId: lineIndex === 0 ? unit.unitId : `${unit.unitId}#${lineIndex + 1}`,
            _sourceUnitId: unit.unitId,
            _lineIndex: lineIndex,
            text: line,
            role: hardEvidenceRoleForLine(line, unit.role),
            order: unit.order + lineIndex / 1000
        }));
    }
    return atoms;
}
function splitNumberedExplanationText(value) {
    const text = String(value || '').trim();
    if (!text) return [];
    const newlineParts = hardEvidenceLines(text);
    if (newlineParts.length > 1) return newlineParts;
    const numbered = text.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/).map((part) => part.trim()).filter(Boolean);
    return numbered.length > 1 ? numbered : [text];
}
function expandHardExplanationAtoms(units) {
    const atoms = [];
    for (const unit of units) {
        const parts = splitNumberedExplanationText(unit.text);
        const safeParts = parts.length ? parts : [unit.text];
        safeParts.forEach((text, partIndex) => atoms.push({
            ...unit,
            unitId: partIndex === 0 ? unit.unitId : `${unit.unitId}#${partIndex + 1}`,
            _sourceUnitId: unit.unitId,
            _lineIndex: partIndex,
            text,
            order: unit.order + partIndex / 1000
        }));
    }
    return atoms;
}
function hardProcessBoundaryMergeScore(leftGroup, rightGroup) {
    const left = leftGroup.processUnits[leftGroup.processUnits.length - 1];
    const right = rightGroup.processUnits[0];
    if (!left || !right) return 1000;
    if (right.role === 'answer_text') return -100;
    if (left.role === 'setup' || right.role === 'setup') return 100;
    const leftText = String(left.text || '').trim();
    const rightText = String(right.text || '').trim();
    if (/^=/.test(rightText)) return 0;
    const leftEquation = /=/.test(leftText) && /[a-zA-Z]/.test(leftText);
    const rightEquation = /=/.test(rightText) && /[a-zA-Z]/.test(rightText);
    if (leftEquation && rightEquation) {
        if (/^[a-zA-Z][a-zA-Z0-9]*\s*=/.test(rightText)) return 0;
        if (left._sourceUnitId === right._sourceUnitId) return 1;
        return 5;
    }
    if (left._sourceUnitId === right._sourceUnitId) return 8;
    return 30;
}
function mergeHardProcessGroupsToTarget(groups, targetCount) {
    const output = groups.map((group) => ({ ...group, processUnits: [...group.processUnits], explanationUnits: [] }));
    while (output.length > targetCount && output.length > 1) {
        let bestIndex = 0;
        let bestScore = Infinity;
        for (let index = 0; index < output.length - 1; index += 1) {
            const score = hardProcessBoundaryMergeScore(output[index], output[index + 1]);
            if (score < bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        }
        const left = output[bestIndex];
        const right = output[bestIndex + 1];
        output.splice(bestIndex, 2, {
            key: `${left.key}+${right.key}`,
            visualBand: null,
            firstOrder: Math.min(left.firstOrder, right.firstOrder),
            processUnits: [...left.processUnits, ...right.processUnits],
            explanationUnits: []
        });
    }
    return output;
}
function refineCoarseHardProblemGroups(question, groups, warnings) {
    if (groups.length > 2) return groups;
    const processAtoms = expandHardProcessAtoms(question.processUnits || []);
    const explanationAtoms = expandHardExplanationAtoms(question.explanationUnits || []);
    const nonAnswerProcessCount = processAtoms.filter((unit) => unit.role !== 'answer_text').length;
    if (explanationAtoms.length < 3 || nonAnswerProcessCount < 3 || groups.length >= explanationAtoms.length) return groups;
    let processGroups = processAtoms.map((unit, index) => ({
        key: `atomic:${index + 1}`,
        visualBand: null,
        firstOrder: evidenceUnitOrder(unit, index + 1),
        processUnits: [unit],
        explanationUnits: []
    }));
    if (processGroups.length > 1) {
        const last = processGroups[processGroups.length - 1];
        if (last.processUnits.every((unit) => unit.role === 'answer_text')) {
            processGroups[processGroups.length - 2].processUnits.push(...last.processUnits);
            processGroups.pop();
        }
    }
    const targetCount = Math.max(1, Math.min(12, explanationAtoms.length));
    processGroups = mergeHardProcessGroupsToTarget(processGroups, targetCount);
    while (processGroups.length < targetCount) {
        processGroups.push({ key: `atomic-gap:${processGroups.length + 1}`, visualBand: null, firstOrder: processGroups.length + 1, processUnits: [], explanationUnits: [] });
    }
    explanationAtoms.slice(0, targetCount).forEach((unit, index) => processGroups[index].explanationUnits.push(unit));
    warnings.push(`COARSE_VISUAL_BAND_REFINED:${groups.length}->${targetCount}`);
    return processGroups;
}
function mergeTrailingAnswerGroup(groups, studentAnswer, warnings) {
    if (groups.length < 2) return groups;
    const last = groups[groups.length - 1];
    const previous = groups[groups.length - 2];
    const answerOnly = last.processUnits.length > 0
        && last.processUnits.every((unit) => unit.role === 'answer_text')
        && last.explanationUnits.length === 0;
    if (!answerOnly) return groups;
    const answerText = compactEvidenceText(unitText(last.processUnits));
    const studentAnswerText = compactEvidenceText(studentAnswer);
    const previousText = compactEvidenceText(unitText(previous.processUnits));
    const restatesAnswer = Boolean(answerText)
        && (!studentAnswerText || answerText.includes(studentAnswerText) || studentAnswerText.includes(answerText));
    const resultAlreadyVisible = Boolean(answerText) && previousText && [...new Set(answerText.match(/\d+(?:\.\d+)?/g) || [])].every((token) => previousText.includes(token));
    if (!restatesAnswer && !resultAlreadyVisible) return groups;
    previous.processUnits.push(...last.processUnits);
    previous.firstOrder = Math.min(previous.firstOrder, last.firstOrder);
    warnings.push('TRAILING_ANSWER_TEXT_MERGED_INTO_FINAL_STEP');
    return groups.slice(0, -1);
}
function buildExpectedPlanGroups(question, runtimeWarnings) {
    const expectedSteps = Array.isArray(question.expectedSteps) ? question.expectedSteps : [];
    if (!expectedSteps.length) return null;
    const processById = new Map(question.processUnits.map((unit) => [unit.unitId, unit]));
    const explanationById = new Map(question.explanationUnits.map((unit) => [unit.unitId, unit]));
    const usedProcess = new Set();
    const usedExplanation = new Set();
    const groups = expectedSteps.map((step, index) => ({
        key: `expected:${step.stepId}`,
        expectedStepId: step.stepId,
        expectedPurpose: step.purpose,
        expectedReasoning: step.expectedReasoning,
        stepKind: 'expected',
        visualBand: null,
        firstOrder: index + 1,
        processUnits: [], explanationUnits: []
    }));
    expectedSteps.forEach((step, index) => {
        for (const unitId of step.processUnitIds || []) {
            const unit = processById.get(unitId);
            if (!unit) continue;
            if (usedProcess.has(unitId)) { runtimeWarnings.push(`EXPECTED_PROCESS_REF_REUSED:${unitId}`); continue; }
            usedProcess.add(unitId); groups[index].processUnits.push(unit);
        }
        for (const unitId of step.explanationUnitIds || []) {
            const unit = explanationById.get(unitId);
            if (!unit) continue;
            if (usedExplanation.has(unitId)) { runtimeWarnings.push(`EXPECTED_EXPLANATION_REF_REUSED:${unitId}`); continue; }
            usedExplanation.add(unitId); groups[index].explanationUnits.push(unit);
        }
    });

    // If the vision model supplied coarse multi-line units, rebuild only that source side against the
    // already-decided ExpectedReasoningPlan count. This prevents visualBand/explanation count from
    // determining the pedagogical step count while still recovering under-segmented handwriting.
    const targetCount = groups.length;
    const processAtoms = expandHardProcessAtoms(question.processUnits || []);
    const coarseProcess = question.processUnits.some((unit) => hardEvidenceLines(unit.text).length > 1);
    if (targetCount > 1 && coarseProcess && processAtoms.filter((unit) => unit.role !== 'answer_text').length >= targetCount) {
        let atomicGroups = processAtoms.map((unit, index) => ({ key: `expected-atomic-p:${index + 1}`, visualBand: null, firstOrder: unit.order, processUnits: [unit], explanationUnits: [] }));
        if (atomicGroups.length > 1 && atomicGroups.at(-1).processUnits.every((unit) => unit.role === 'answer_text')) {
            atomicGroups[atomicGroups.length - 2].processUnits.push(...atomicGroups.at(-1).processUnits);
            atomicGroups.pop();
        }
        atomicGroups = mergeHardProcessGroupsToTarget(atomicGroups, targetCount);
        if (atomicGroups.length === targetCount) {
            groups.forEach((group, index) => { group.processUnits = atomicGroups[index].processUnits; });
            usedProcess.clear();
            for (const unit of processAtoms) usedProcess.add(unit._sourceUnitId || unit.unitId);
            runtimeWarnings.push(`EXPECTED_PLAN_PROCESS_REFINED:${question.processUnits.length}->${targetCount}`);
        }
    }
    const explanationAtoms = expandHardExplanationAtoms(question.explanationUnits || []);
    const coarseExplanation = question.explanationUnits.some((unit) => splitNumberedExplanationText(unit.text).length > 1);
    if (targetCount > 1 && coarseExplanation && explanationAtoms.length >= targetCount) {
        groups.forEach((group) => { group.explanationUnits = []; });
        explanationAtoms.forEach((unit, index) => groups[Math.min(index, targetCount - 1)].explanationUnits.push(unit));
        usedExplanation.clear();
        for (const unit of explanationAtoms) usedExplanation.add(unit._sourceUnitId || unit.unitId);
        runtimeWarnings.push(`EXPECTED_PLAN_EXPLANATION_REFINED:${question.explanationUnits.length}->${targetCount}`);
    }

    // Any visible student material that the model did not map must never be discarded or create a
    // new ExpectedStep. Attach it to the nearest locked pedagogical step as additional evidence.
    const remainingProcess = question.processUnits.filter((unit) => !usedProcess.has(unit.unitId));
    const remainingExplanation = question.explanationUnits.filter((unit) => !usedExplanation.has(unit.unitId));
    if (remainingProcess.length || remainingExplanation.length) {
        const attach = (units, field) => {
            for (const unit of units) {
                const target = groups.reduce((best, group, index) => {
                    const groupUnits = [...group.processUnits, ...group.explanationUnits];
                    const anchor = groupUnits.length
                        ? groupUnits.reduce((sum, item) => sum + Number(item.order || 0), 0) / groupUnits.length
                        : group.firstOrder;
                    const distance = Math.abs(Number(unit.order || 0) - anchor);
                    return !best || distance < best.distance ? { group, distance, index } : best;
                }, null);
                target.group[field].push(unit);
            }
        };
        attach(remainingProcess, 'processUnits');
        attach(remainingExplanation, 'explanationUnits');
        runtimeWarnings.push(`UNMAPPED_EVIDENCE_ATTACHED_TO_EXPECTED_PLAN:${remainingProcess.length + remainingExplanation.length}`);
    }
    return groups;
}
function alignHardProblemQuestionEvidence(question, layoutType) {
    const processes = question.processUnits;
    const explanations = question.explanationUnits;
    const runtimeWarnings = [];
    let groups = buildExpectedPlanGroups(question, runtimeWarnings);
    if (!groups) {
        groups = groupEvidenceUnits(processes, explanations);
        groups = refineCoarseHardProblemGroups(question, groups, runtimeWarnings);
        const needsAnswerOnlyGapStep = question.studentWorkDetected === true && Boolean(question.studentAnswer) && !groups.length;
        if (needsAnswerOnlyGapStep) groups = [{ key: 'answer-only-gap', expectedStepId: 'S1', expectedPurpose: '完整解题过程', expectedReasoning: '请补充得到最终答案前的必要解题过程，并逐步说明依据。', stepKind: 'expected', visualBand: null, firstOrder: 1, processUnits: [], explanationUnits: [] }];
    }
    groups = mergeTrailingAnswerGroup(groups, question.studentAnswer, runtimeWarnings);
    const pairedSteps = groups.map((group, index) => ({
        stepIndex: index + 1,
        expectedStepId: evidenceString(group.expectedStepId) || `S${index + 1}`,
        expectedPurpose: evidenceString(group.expectedPurpose) || `第${index + 1}个必要推理步骤`,
        expectedReasoning: evidenceString(group.expectedReasoning) || '结合题目判断这一必要步骤应完成的数学目的和依据。',
        stepKind: group.stepKind === 'student_extra' ? 'student_extra' : 'expected',
        solutionText: unitText(group.processUnits),
        explanationText: unitText(group.explanationUnits),
        processUnitIds: group.processUnits.map((unit) => unit.unitId),
        explanationUnitIds: group.explanationUnits.map((unit) => unit.unitId),
        processReadability: !group.processUnits.length ? 'missing' : group.processUnits.some((unit) => unit.readability === 'unreadable') ? 'unreadable' : 'readable',
        explanationReadability: !group.explanationUnits.length ? 'missing' : group.explanationUnits.some((unit) => unit.readability === 'unreadable') ? 'unreadable' : 'readable'
    }));
    const sourceProcessId = (unitId) => String(unitId || '').split('#')[0];
    const usedProcess = new Set(pairedSteps.flatMap((step) => step.processUnitIds.map(sourceProcessId)));
    const usedExplanation = new Set(pairedSteps.flatMap((step) => step.explanationUnitIds.map(sourceProcessId)));
    const unmatchedProcessUnits = processes.filter((unit) => !usedProcess.has(unit.unitId));
    const unmatchedExplanationUnits = explanations.filter((unit) => !usedExplanation.has(unit.unitId));
    if (unmatchedProcessUnits.length || unmatchedExplanationUnits.length) throw Object.assign(new Error('难题原文存在未配对单元'), { code: 'HARD_PROBLEM_ALIGNMENT_ERROR', sourceKey: question.sourceKey, unmatchedProcessUnitIds: unmatchedProcessUnits.map((unit) => unit.unitId), unmatchedExplanationUnitIds: unmatchedExplanationUnits.map((unit) => unit.unitId) });
    const duplicatedProcessIds = pairedSteps.flatMap((step) => step.processUnitIds.map(sourceProcessId)).filter((unitId, index, all) => all.indexOf(unitId) !== index);
    const duplicatedExplanationIds = pairedSteps.flatMap((step) => step.explanationUnitIds.map(sourceProcessId)).filter((unitId, index, all) => all.indexOf(unitId) !== index);
    // Derived line atoms from the same original coarse source unit may legitimately appear in adjacent
    // expected steps. Only raw duplicate IDs are an error when no refinement warning is present.
    const processRefinementApplied = runtimeWarnings.some((item) => item.startsWith('EXPECTED_PLAN_PROCESS_REFINED:') || item.startsWith('COARSE_VISUAL_BAND_REFINED:'));
    const explanationRefinementApplied = runtimeWarnings.some((item) => item.startsWith('EXPECTED_PLAN_EXPLANATION_REFINED:') || item.startsWith('COARSE_VISUAL_BAND_REFINED:'));
    if ((duplicatedProcessIds.length && !processRefinementApplied) || (duplicatedExplanationIds.length && !explanationRefinementApplied))
        throw Object.assign(new Error('难题原文单元被重复分配'), { code: 'HARD_PROBLEM_ALIGNMENT_ERROR', sourceKey: question.sourceKey, duplicatedProcessIds, duplicatedExplanationIds });
    const missingBandCount = [...processes, ...explanations].filter((unit) => explicitVisualBand(unit.visualBand) === null).length;
    if (missingBandCount) runtimeWarnings.push(`VISUAL_BAND_MISSING_FALLBACK:${missingBandCount}`);
    return {
        sourceKey: question.sourceKey, layoutType, questionText: question.questionText, studentAnswer: question.studentAnswer,
        studentWorkDetected: question.studentWorkDetected, sourceQuestionLabel: question.sourceQuestionLabel,
        sourceRegion: question.sourceRegion, inputBasis: question.inputBasis, modeApplicability: question.modeApplicability,
        expectedSteps: question.expectedSteps || [], pairedSteps, processUnits: processes, explanationUnits: explanations,
        alignmentConfidence: question.confidence, alignmentWarnings: [...new Set([...(question.warnings || []), ...runtimeWarnings])]
    };
}
function alignHardProblemEvidence(evidence) {
    const validated = validateHardProblemEvidenceResult(evidence);
    const questions = validated.questions.map((question) => alignHardProblemQuestionEvidence(question, question.layoutType || validated.layoutType));
    return { version: 'hard-problem-evidence-alignment.v2', layoutType: validated.layoutType, questions, _modelDiagnostics: validated._modelDiagnostics || null };
}
function fixedStepMeta(alignment) {
    return alignment.questions.map((question) => ({
        sourceKey: question.sourceKey,
        questionText: question.questionText,
        studentAnswer: question.studentAnswer,
        studentWorkDetected: question.studentWorkDetected,
        sourceQuestionLabel: question.sourceQuestionLabel,
        sourceRegion: question.sourceRegion,
        inputBasis: question.inputBasis,
        modeApplicability: question.modeApplicability,
        fixedSteps: question.pairedSteps.map(({ stepIndex, studentStepId, expectedStepId, expectedNodeIds, expectedPurpose, expectedReasoning, stepKind, solutionText, explanationText }) => ({
            stepIndex, studentStepId, expectedStepId, expectedNodeIds: Array.isArray(expectedNodeIds) ? expectedNodeIds : [], expectedPurpose, expectedReasoning, stepKind, solutionText, explanationText
        })),
        unmatchedExplanationText: (Array.isArray(question.unmatchedExplanationUnits) ? question.unmatchedExplanationUnits : []).map((unit) => String(unit?.rawText || unit?.text || '').trim()).filter(Boolean)
    }));
}
function fixedStepMatchKey(step) { return `${normalizeHardProblemSource(step?.solutionText)}|${normalizeHardProblemSource(step?.explanationText)}`; }
function assertFixedHardProblemModelCoverage(result, alignment) {
    const resultQuestions = Array.isArray(result?.questions) ? result.questions : [];
    if (!resultQuestions.length)
        throw Object.assign(new Error('固定步骤批改未返回题目'), { code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH', fieldPath: 'questions' });
    const resultByKey = new Map(resultQuestions.map((question) => [String(question?.sourceKey || '').trim(), question]));
    alignment.questions.forEach((alignedQuestion, questionIndex) => {
        const modelQuestion = resultByKey.get(alignedQuestion.sourceKey)
            || resultQuestions.find((question) => question?.sourceQuestionLabel === alignedQuestion.sourceQuestionLabel && question?.sourceRegion === alignedQuestion.sourceRegion)
            || resultQuestions[questionIndex];
        if (!modelQuestion || typeof modelQuestion !== 'object')
            throw Object.assign(new Error('固定步骤批改遗漏题目'), { code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH', fieldPath: `questions[${questionIndex}]`, sourceKey: alignedQuestion.sourceKey });
        const modelSteps = Array.isArray(modelQuestion.stepFeedbacks) ? modelQuestion.stepFeedbacks : [];
        if (modelSteps.length < alignedQuestion.pairedSteps.length)
            throw Object.assign(new Error('固定步骤批改遗漏步骤'), { code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH', fieldPath: `questions[${questionIndex}].stepFeedbacks`, sourceKey: alignedQuestion.sourceKey, expectedStepCount: alignedQuestion.pairedSteps.length, actualStepCount: modelSteps.length });
        alignedQuestion.pairedSteps.forEach((_, stepIndex) => {
            const step = modelSteps[stepIndex];
            if (!step || typeof step !== 'object')
                throw Object.assign(new Error('固定步骤批改步骤无效'), { code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH', fieldPath: `questions[${questionIndex}].stepFeedbacks[${stepIndex}]`, sourceKey: alignedQuestion.sourceKey });
            if (!['correct', 'wrong', 'missing', 'unreadable'].includes(step.solutionStatus)
                || !['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable'].includes(step.explanationStatus)
                || !['clear', 'insufficient', 'wrong', 'unreadable'].includes(step.logicStatus)
                || !evidenceString(step.analysis))
                throw Object.assign(new Error('固定步骤批改缺少必要判断字段'), { code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH', fieldPath: `questions[${questionIndex}].stepFeedbacks[${stepIndex}]`, sourceKey: alignedQuestion.sourceKey });
        });
    });
}
function enforceFixedHardProblemSteps(result, alignment, options = {}) {
    const allowSafeFallback = options.allowSafeFallback === true;
    if (!allowSafeFallback) assertFixedHardProblemModelCoverage(result, alignment);
    const alignmentByKey = new Map(alignment.questions.map((question) => [question.sourceKey, question]));
    const resultQuestions = Array.isArray(result?.questions) ? result.questions : [];
    const resultByKey = new Map(resultQuestions.map((question) => [String(question?.sourceKey || '').trim(), question]));
    const questions = alignment.questions.map((alignedQuestion, questionIndex) => {
        const matchedByIdentity = resultByKey.get(alignedQuestion.sourceKey)
            || resultQuestions.find((question) => question?.sourceQuestionLabel === alignedQuestion.sourceQuestionLabel && question?.sourceRegion === alignedQuestion.sourceRegion);
        const indexCandidate = resultQuestions[questionIndex];
        const indexCandidateSafe = !allowSafeFallback
            || (resultQuestions.length === alignment.questions.length && !evidenceString(indexCandidate?.sourceKey));
        const modelQuestion = matchedByIdentity || (indexCandidateSafe ? indexCandidate : null) || {};
        const modelQuestionFound = Boolean(matchedByIdentity || (indexCandidateSafe && indexCandidate));
        const modelSteps = Array.isArray(modelQuestion.stepFeedbacks) ? modelQuestion.stepFeedbacks : [];
        const byKey = new Map(modelSteps.map((step) => [fixedStepMatchKey(step), step]));
        const indexStepFallbackSafe = !allowSafeFallback || modelSteps.length >= alignedQuestion.pairedSteps.length;
        const fixedSteps = alignedQuestion.pairedSteps.map((fixedStep, index) => {
            const exact = byKey.get(fixedStepMatchKey(fixedStep));
            const candidate = exact || (indexStepFallbackSafe ? modelSteps[index] : null) || {};
            const candidateSolutionStatus = ['correct', 'wrong', 'missing', 'unreadable'].includes(candidate.solutionStatus) ? candidate.solutionStatus : null;
            const candidateExplanationStatus = ['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable'].includes(candidate.explanationStatus) ? candidate.explanationStatus : null;
            const hasSolutionSource = Boolean(evidenceString(fixedStep.solutionText));
            const hasExplanationSource = Boolean(evidenceString(fixedStep.explanationText));
            let solutionStatus = candidateSolutionStatus || (hasSolutionSource ? 'unreadable' : 'missing');
            let explanationStatus = candidateExplanationStatus || (hasExplanationSource ? 'unreadable' : 'missing');
            let sourceStatusAdjusted = false;
            // Model judgments never outrank locked source evidence. This is the adapter boundary that
            // prevents a hallucinated "correct/clear" judgment from fabricating student work, and also
            // prevents visible source text from being erased by a model-side "missing" label.
            if (!hasSolutionSource && !['missing', 'unreadable'].includes(solutionStatus)) { solutionStatus = fixedStep.processReadability === 'unreadable' ? 'unreadable' : 'missing'; sourceStatusAdjusted = true; }
            if (hasSolutionSource && solutionStatus === 'missing') { solutionStatus = 'unreadable'; sourceStatusAdjusted = true; }
            if (!hasExplanationSource && !['missing', 'unreadable'].includes(explanationStatus)) { explanationStatus = fixedStep.explanationReadability === 'unreadable' ? 'unreadable' : 'missing'; sourceStatusAdjusted = true; }
            if (hasExplanationSource && explanationStatus === 'missing') { explanationStatus = 'unreadable'; sourceStatusAdjusted = true; }
            let logicStatus;
            if (solutionStatus === 'unreadable' || explanationStatus === 'unreadable') logicStatus = 'unreadable';
            else if (explanationStatus === 'incorrect' || candidate.logicStatus === 'wrong') logicStatus = 'wrong';
            else if (solutionStatus === 'missing' || ['missing', 'partially_clear'].includes(explanationStatus)) logicStatus = 'insufficient';
            else logicStatus = ['clear', 'insufficient'].includes(candidate.logicStatus) ? candidate.logicStatus : 'insufficient';
            // A calculation slip does not by itself prove a logic defect. Keep the two axes independent:
            // solutionStatus evaluates mathematical execution; logicStatus evaluates the stated reasoning.
            if (logicStatus === 'clear' && explanationStatus !== 'clear') logicStatus = 'insufficient';
            const fullyClear = solutionStatus === 'correct' && explanationStatus === 'clear' && logicStatus === 'clear';
            const safeFallbackStep = !exact && (!candidate || !evidenceString(candidate.analysis));
            const deterministicAnalysis = fixedStep.solutionText || fixedStep.explanationText
                ? `思路：当前模型未能完成该步判断（${evidenceString(fixedStep.expectedPurpose) || `第${index + 1}步`}）；公式/知识点：请结合学生原文与题目人工核验；逻辑：当前证据无法可靠判断。`
                : `思路：学生未写出“${evidenceString(fixedStep.expectedPurpose) || `第${index + 1}步`}”对应的过程；公式/知识点：应补充${evidenceString(fixedStep.expectedReasoning) || '这一必要步骤的数学依据'}；逻辑：缺少该必要步骤，前后推理链不完整。`;
            const analysis = sourceStatusAdjusted ? deterministicAnalysis : (evidenceString(candidate.analysis) || deterministicAnalysis);
            let correctionAdvice = evidenceString(candidate.correctionAdvice);
            if (fullyClear) correctionAdvice = '';
            else if (!correctionAdvice) correctionAdvice = solutionStatus === 'unreadable' || explanationStatus === 'unreadable' || logicStatus === 'unreadable'
                ? '请老师结合原图人工复核；若图片不清晰，请重新上传清晰、完整的图片。'
                : (!fixedStep.solutionText && !fixedStep.explanationText
                    ? `请补充“${evidenceString(fixedStep.expectedPurpose) || `第${index + 1}步`}”：${evidenceString(fixedStep.expectedReasoning) || '写出必要过程，并说明为什么这样做。'}`
                    : '请根据本步反馈补充正确的数量关系、公式依据和推导过程。');
            return {
                stepIndex: index + 1,
                solutionText: fixedStep.solutionText,
                explanationText: fixedStep.explanationText,
                solutionStatus,
                explanationStatus,
                logicStatus,
                analysis,
                correctionAdvice,
                _safeFallbackStep: safeFallbackStep
            };
        });
        const fallbackStepCountForQuestion = fixedSteps.filter((step) => step._safeFallbackStep).length;
        const structurallyIncomplete = allowSafeFallback && (!modelQuestionFound || fallbackStepCountForQuestion > 0 || !evidenceString(modelQuestion.standardAnswer));
        const safeFixedSteps = fixedSteps.map(({ _safeFallbackStep, ...step }) => step);
        return {
            ...modelQuestion,
            outputSchemaVersion: 'hard-problem.v2',
            sourceKey: alignedQuestion.sourceKey,
            sourceQuestionLabel: alignedQuestion.sourceQuestionLabel,
            sourceRegion: alignedQuestion.sourceRegion,
            questionText: alignedQuestion.questionText || evidenceString(modelQuestion.questionText) || '题目内容无法完整辨认',
            studentAnswer: alignedQuestion.studentAnswer,
            standardAnswer: evidenceString(modelQuestion.standardAnswer),
            answerStatus: structurallyIncomplete ? 'unreadable' : ['answered', 'unanswered', 'unreadable'].includes(modelQuestion.answerStatus) ? modelQuestion.answerStatus : (alignedQuestion.studentWorkDetected ? 'answered' : 'unanswered'),
            finalAnswerCorrect: structurallyIncomplete ? null : typeof modelQuestion.finalAnswerCorrect === 'boolean' || modelQuestion.finalAnswerCorrect === null ? modelQuestion.finalAnswerCorrect : null,
            stepRequired: modelQuestion.stepRequired !== false,
            stepStatus: ['correct', 'wrong', 'missing', 'not_required', 'unreadable'].includes(modelQuestion.stepStatus) ? modelQuestion.stepStatus : 'missing',
            logicStatus: ['correct', 'wrong', 'insufficient', 'unreadable'].includes(modelQuestion.logicStatus) ? modelQuestion.logicStatus : 'insufficient',
            errorType: evidenceString(modelQuestion.errorType) || 'multiple',
            firstWrongStep: evidenceString(modelQuestion.firstWrongStep),
            errorReason: evidenceString(modelQuestion.errorReason),
            adjustmentSuggestion: evidenceString(modelQuestion.adjustmentSuggestion),
            knowledgePoint: '',
            overallFeedback: structurallyIncomplete ? 'AI批改结果结构不完整，已保留学生原文与固定步骤，请老师人工复核。' : evidenceString(modelQuestion.overallFeedback),
            confidence: Math.max(0, Math.min(1, Number(modelQuestion.confidence) || 0)),
            studentWorkDetected: alignedQuestion.studentWorkDetected,
            inputBasis: alignedQuestion.inputBasis,
            modeApplicability: alignedQuestion.modeApplicability,
            stepFeedbacks: safeFixedSteps
        };
    });
    const unknownKeys = resultQuestions.map((question) => String(question?.sourceKey || '').trim()).filter((sourceKey) => sourceKey && !alignmentByKey.has(sourceKey));
    const fallbackStepCount = questions.reduce((sum, question) => sum + (Array.isArray(question.stepFeedbacks) ? question.stepFeedbacks.filter((step) => /当前模型未能完成该步判断|人工复核/.test(String(step?.analysis || ''))).length : 0), 0);
    const fallbackQuestionCount = questions.filter((question) => question.answerStatus === 'unreadable' && /AI批改结果结构不完整/.test(String(question.overallFeedback || ''))).length;
    const warnings = [...new Set([
        ...(Array.isArray(result?.validationWarnings) ? result.validationWarnings : []),
        ...(unknownKeys.length ? [`HARD_PROBLEM_UNKNOWN_MODEL_QUESTIONS_IGNORED:${unknownKeys.length}`] : []),
        ...(allowSafeFallback && fallbackStepCount ? [`HARD_PROBLEM_FIXED_STEP_SAFE_FALLBACK:${fallbackStepCount}`] : []),
        ...(allowSafeFallback && fallbackQuestionCount ? [`HARD_PROBLEM_QUESTION_SAFE_FALLBACK:${fallbackQuestionCount}`] : [])
    ])];
    return { ...result, ...(warnings.length ? { validationWarnings: warnings } : {}), questions };
}
function normalizeV9FixedHardProblemAggregates(result, _alignment) {
    // V9 compatibility may change evidence alignment, but aggregate states must always be
    // derived from the final locked stepFeedbacks so they cannot contradict the shared contract.
    const base = normalizeFixedHardProblemAggregates(result);
    return { ...base, summary: hardSummary(base.questions || []) };
}

function hardProblemStepIssues(step, index) {
    const issues = [];
    const label = `第${index + 1}步`;
    if (step.solutionStatus === 'wrong') issues.push(`${label}解题过程有误`);
    else if (step.solutionStatus === 'missing') issues.push(`${label}缺少解题过程`);
    else if (step.solutionStatus === 'unreadable') issues.push(`${label}解题过程无法辨认`);
    if (step.explanationStatus === 'incorrect') issues.push(`${label}学生讲解不正确`);
    else if (step.explanationStatus === 'partially_clear') issues.push(`${label}学生讲解不完整`);
    else if (step.explanationStatus === 'missing') issues.push(`${label}缺少对应讲解`);
    else if (step.explanationStatus === 'unreadable') issues.push(`${label}学生讲解无法辨认`);
    if (step.logicStatus === 'wrong') issues.push(`${label}过程与讲解逻辑不一致`);
    else if (step.logicStatus === 'insufficient' && !issues.some((item) => item.includes(label))) issues.push(`${label}逻辑依据不足`);
    else if (step.logicStatus === 'unreadable' && !issues.some((item) => item.includes(label))) issues.push(`${label}逻辑无法判断`);
    return issues;
}
function normalizeFixedHardProblemAggregates(result) {
    const questions = (Array.isArray(result?.questions) ? result.questions : []).map((question) => {
        const steps = Array.isArray(question.stepFeedbacks) ? question.stepFeedbacks : [];
        const printedWithoutWork = question.inputBasis === 'printed_question_without_work' || question.studentWorkDetected === false;
        const answerStatus = printedWithoutWork ? 'unanswered' : ['answered', 'unanswered', 'unreadable'].includes(question.answerStatus) ? question.answerStatus : (question.studentAnswer || steps.length ? 'answered' : 'unanswered');
        const finalAnswerCorrect = answerStatus === 'answered' ? (typeof question.finalAnswerCorrect === 'boolean' ? question.finalAnswerCorrect : false) : null;
        const stepRequired = answerStatus === 'answered' ? (steps.length ? true : question.stepRequired === true) : true;
        const aggregate = deriveHardProblemAggregateState({ ...question, answerStatus, stepRequired }, steps);
        const { stepStatus, logicStatus } = aggregate;
        const fullyCorrect = answerStatus === 'answered' && finalAnswerCorrect === true && (!stepRequired || stepStatus === 'correct') && logicStatus === 'correct';
        const errorType = deriveHardProblemErrorType({ ...question, answerStatus, finalAnswerCorrect, stepRequired, stepStatus, logicStatus }, steps, stepStatus, logicStatus);
        const stepIssues = steps.flatMap(hardProblemStepIssues);
        const issues = finalAnswerCorrect === false ? [...stepIssues, '最终答案错误'] : stepIssues;
        const issueText = [...new Set(issues)].join('；');
        const onlyFinalAnswerWrong = finalAnswerCorrect === false && stepIssues.length === 0 && stepStatus === 'correct' && logicStatus === 'correct';
        const correctSummary = { firstWrongStep: '', errorReason: '', adjustmentSuggestion: '', overallFeedback: '最终答案、解题过程、逐步讲解和逻辑均正确。' };
        const fallbackSummary = issueText || '当前作答仍有需要核实的内容';
        const overallText = evidenceString(question.overallFeedback);
        const safeStructureFallback = answerStatus === 'unreadable' && /AI批改结果结构不完整/.test(overallText);
        const contradicts = !fullyCorrect && /完全正确|均正确|无需调整|没有错误/.test(overallText);
        const summaryFields = fullyCorrect ? correctSummary : safeStructureFallback ? {
            firstWrongStep: '',
            errorReason: 'AI批改返回结构异常，系统已保留学生原文和固定步骤，未把不完整结果判为正确或错误。',
            adjustmentSuggestion: '请老师结合原图人工复核；必要时重新提交本题。',
            overallFeedback: overallText
        } : {
            firstWrongStep: evidenceString(question.firstWrongStep) || issueText,
            errorReason: evidenceString(question.errorReason) || fallbackSummary,
            adjustmentSuggestion: evidenceString(question.adjustmentSuggestion) || (onlyFinalAnswerWrong ? '请重新核对并订正最终答案，确保答案与已完成的正确步骤一致。' : '请按上述问题补充或修正对应的过程与讲解。'),
            overallFeedback: !overallText || contradicts ? `最终答案或逐步过程仍有需要调整：${fallbackSummary}。` : overallText
        };
        return {
            ...question,
            answerStatus,
            finalAnswerCorrect,
            stepRequired,
            stepStatus,
            logicStatus,
            errorType,
            knowledgePoint: '',
            stepFeedbacks: steps,
            ...summaryFields
        };
    });
    const questionSetAudit = {
        visibleIndependentQuestionCount: questions.length,
        emittedQuestionCount: questions.length,
        excludedQuestionCount: 0,
        orientation: ['upright', 'rotated_left', 'rotated_right', 'upside_down', 'uncertain'].includes(result?.questionSetAudit?.orientation) ? result.questionSetAudit.orientation : 'upright',
        countConfidence: Math.max(0, Math.min(1, Number(result?.questionSetAudit?.countConfidence) || 1))
    };
    return {
        outputSchemaVersion: 'hard-problem.v2',
        mode: 'hard-problem',
        route: result?.route && typeof result.route === 'object' ? result.route : { difficulty: 'normal', confidence: 0.8, flags: [] },
        imageQuality: result?.imageQuality && typeof result.imageQuality === 'object' ? result.imageQuality : { ok: true, issues: [] },
        questionSetAudit,
        ...(Array.isArray(result?.validationWarnings) && result.validationWarnings.length ? { validationWarnings: result.validationWarnings } : {}),
        questions
    };
}

function normalizeQuestionSetAudit(result, rawQuestions, includedQuestions, strategy) {
    if (!strategyRequiresQuestionSetAudit(strategy, result?.outputSchemaVersion)) return { ...result, questions: includedQuestions };
    const audit = validateQuestionSetAudit({ ...result, questions: rawQuestions }, { required: true });
    const normalized = { ...audit, emittedQuestionCount: includedQuestions.length, excludedQuestionCount: audit.excludedQuestionCount + (rawQuestions.length - includedQuestions.length) };
    if (normalized.visibleIndependentQuestionCount !== normalized.emittedQuestionCount + normalized.excludedQuestionCount)
        throw Object.assign(new Error('questionSetAudit counts do not match filtered questions'), { code: 'QUESTION_SET_AUDIT_COUNT_MISMATCH', fieldPath: 'questionSetAudit' });
    return { ...result, questions: includedQuestions, questionSetAudit: normalized };
}
function primaryReviewQuestionContract(primary) {
    const questions = Array.isArray(primary?.questions) ? primary.questions : [];
    return questions.map((question, index) => ({
        primaryQuestionId: `pq_${String(index + 1).padStart(3, '0')}`,
        sourceKey: String(question?.sourceKey || '').trim(),
        sourceQuestionLabel: String(question?.sourceQuestionLabel || '').trim().slice(0, 120),
        sourceRegion: String(question?.sourceRegion || '').trim().slice(0, 200),
        questionText: String(question?.questionText || '').trim().slice(0, 500)
    }));
}
function reviewContractInstruction(primary, recoveryContext = null) {
    const contract = primaryReviewQuestionContract(primary);
    if (!contract.length) return '';
    const missingIds = Array.isArray(recoveryContext?.missingPrimaryQuestionIds) ? recoveryContext.missingPrimaryQuestionIds.filter(Boolean) : [];
    const base = [
        'REVIEW题目身份契约：PRIMARY已经确认下列题目存在。你必须对每个primaryQuestionId逐题重新查看原图并返回一次，不能遗漏、删除、合并或用不返回来否定题目存在。',
        '你可以推翻PRIMARY的正确/错误/马虎判断、修改原因和建议；也可以在原图证据明确时新增PRIMARY漏题。',
        '对PRIMARY已有题，返回对象中必须额外带primaryQuestionId并原样使用给定值。sourceKey可保持原值；程序会按primaryQuestionId恢复PRIMARY归属。新增题不要伪造已有primaryQuestionId。',
        `PRIMARY题目契约：${JSON.stringify(contract)}`
    ];
    if (missingIds.length) {
        const missing = contract.filter((item) => missingIds.includes(item.primaryQuestionId));
        base.push(`上一轮REVIEW遗漏了这些PRIMARY题目：${JSON.stringify(missing)}。本轮必须重点重新查看这些题对应的原图区域，并且仍需完整返回全部PRIMARY题目，不得只返回缺失题。`);
    }
    if (recoveryContext?.auditMismatch && typeof recoveryContext.auditMismatch === 'object') {
        base.push(`上一轮REVIEW新增题目与题数审计不一致：${JSON.stringify(recoveryContext.auditMismatch)}。本轮必须重新查看原图；若确有新增题，必须提供唯一sourceKey、sourceQuestionLabel、sourceRegion并让questionSetAudit与实际questions严格一致；若不是独立题，不得重复拆题或新增。`);
    } else if (/^questionSetAudit(?:\.|$)/.test(String(recoveryContext?.fieldPath || ''))) {
        base.push(`上一轮REVIEW的questionSetAudit不符合契约。必须满足 emittedQuestionCount=questions.length 且 visibleIndependentQuestionCount=emittedQuestionCount+excludedQuestionCount。`);
    }
    return base.join('\n');
}
function compactReviewPayload(primary) {
    const questions = excludePrintedQuestionsWithoutWork(primary?.questions);
    const sourceKeys = questions.map((question) => String(question?.sourceKey || '').trim());
    if (!sourceKeys.every(Boolean) || new Set(sourceKeys).size !== sourceKeys.length)
        throw Object.assign(new Error('首次结果 sourceKey 无效'), { code: 'LLM_SCHEMA_ERROR' });
    const compactStep = (step) => ({
        stepIndex: step?.stepIndex,
        solutionText: String(step?.solutionText || ''),
        explanationText: String(step?.explanationText || ''),
        solutionStatus: step?.solutionStatus,
        explanationStatus: step?.explanationStatus,
        logicStatus: step?.logicStatus
    });
    return {
        outputSchemaVersion: primary.outputSchemaVersion,
        ...(primary.questionSetAudit ? { questionSetAudit: primary.questionSetAudit } : {}),
        validationWarnings: Array.isArray(primary.validationWarnings) ? primary.validationWarnings : [],
        questions: questions.map((question) => ({
            sourceKey: question.sourceKey,
            sourceQuestionLabel: question.sourceQuestionLabel,
            sourceRegion: question.sourceRegion,
            questionText: question.questionText,
            studentAnswer: String(question.studentAnswer || ''),
            finalAnswerCorrect: question.finalAnswerCorrect,
            stepRequired: question.stepRequired,
            stepFeedbacksSourceProjection: Array.isArray(question.stepFeedbacks) ? question.stepFeedbacks.map(compactStep) : [],
            overallFeedback: String(question.overallFeedback || '')
        }))
    };
}
const CARELESS_STAGE_MAX_RECOVERY = 1;
function carelessStageRecoverable(error, stage) {
    const code = String(error?.code || '').toUpperCase();
    const fieldPath = String(error?.fieldPath || error?.schemaValidation?.fieldPath || '');
    if (code === 'QUESTION_SET_MISMATCH' && stage === STAGES.REVIEW_GRADING) return true;
    if (['QUESTION_SET_AUDIT_COUNT_MISMATCH', 'QUESTION_ATTRIBUTION_INVALID', 'QUESTION_ATTRIBUTION_DUPLICATE', 'QUESTION_SOURCE_KEY_DUPLICATE'].includes(code)) return true;
    if (code !== 'LLM_SCHEMA_ERROR') return false;
    return /^questions\[\d+\]\.(?:sourceKey|sourceQuestionLabel|sourceRegion|questionText)$/.test(fieldPath)
        || /^questionSetAudit(?:\.|$)/.test(fieldPath);
}

function carelessReviewRecoveryContextFromError(error, recoveryAttempt) {
    const missingPrimaryQuestionIds = Array.isArray(error?.missingPrimaryQuestionIds) ? error.missingPrimaryQuestionIds.filter(Boolean).slice(0, 20) : [];
    const auditMismatch = error?.questionSetAuditDiagnostics && typeof error.questionSetAuditDiagnostics === 'object'
        ? error.questionSetAuditDiagnostics
        : null;
    const fieldPath = String(error?.fieldPath || error?.schemaValidation?.fieldPath || '').slice(0, 200) || null;
    if (!missingPrimaryQuestionIds.length && !auditMismatch && !fieldPath) return null;
    return {
        recoveryAttempt,
        errorCode: String(error?.code || 'QUESTION_SET_MISMATCH').slice(0, 100),
        ...(fieldPath ? { fieldPath } : {}),
        ...(missingPrimaryQuestionIds.length ? {
            missingPrimaryQuestionIds,
            missingPrimaryQuestions: Array.isArray(error?.missingPrimaryQuestions) ? error.missingPrimaryQuestions.slice(0, 20) : []
        } : {}),
        ...(auditMismatch ? { auditMismatch } : {})
    };
}
function transient(error) {
    if (error?.retryable === false)
        return false;
    const code = String(error?.code || '').toUpperCase();
    return code === 'INTERNALSERVICEERROR' || code === 'ARK_TIMEOUT' || code === 'ARK_REQUEST_TIMEOUT' || code === 'ARK_CONNECTION_ERROR'
        || code === 'QWEN_REQUEST_TIMEOUT' || code === 'QWEN_REQUEST_FAILED' || code === 'QWEN_CONNECTION_ERROR' || code === 'QWEN_HTTP_ERROR'
        || code === 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR' || code === 'HARD_PROBLEM_ALIGNMENT_ERROR'
        || [429, 500, 502, 503, 504].includes(Number(error?.status));
}
async function tempUrls(ids, diagnostic = null) {
    if (!ids.length)
        return [];
    let response;
    try {
        response = await context_1.cloud.getTempFileURL({ fileList: ids });
    }
    catch (error) {
        const detail = (0, utils_1.safeError)(error);
        throw Object.assign(new Error(detail.message), { code: 'IMAGE_DOWNLOAD_FAILED', errMsg: detail.errMsg, errCode: detail.errCode, status: detail.status });
    }
    if (!response || !Array.isArray(response.fileList))
        throw Object.assign(new Error('CloudBase 临时地址响应无效'), { code: 'STORAGE_TEMP_URL_INVALID_RESPONSE' });
    if (diagnostic)
        (0, audit_1.monitor)(auditSource, 'PREPARING_IMAGES_TEMP_URL_RESPONSE', { ...diagnostic, diagnostics: { hasFileList: true, fileList: response.fileList.map((item, index) => ({ imageIndex: index, status: item?.status ?? null, errMsg: String(item?.errMsg || '') })) } }, true);
    const urls = response.fileList.map((item, index) => {
        const status = Number(item?.status ?? 0);
        const errMsg = String(item?.errMsg || '');
        if (status !== 0)
            throw Object.assign(new Error(errMsg || '图片临时地址生成失败'), { code: 'STORAGE_TEMP_URL_FAILED', status, errMsg, imageIndex: index, fileId: (0, utils_1.redact)(ids[index]) });
        if (!item?.tempFileURL)
            throw Object.assign(new Error(errMsg || '图片临时地址缺失'), { code: 'STORAGE_TEMP_URL_FAILED', status, errMsg, imageIndex: index, fileId: (0, utils_1.redact)(ids[index]) });
        return item.tempFileURL;
    });
    return urls;
}
function carelessSummary(questions) {
    if (questions.some((q) => q.outputSchemaVersion === 'reading-careless.v2')) {
        const totalCount = questions.length;
        const correctCount = questions.filter((q) => q.threeGridStatus === 'CORRECT').length;
        const wrongCount = questions.filter((q) => q.threeGridStatus === 'WRONG').length;
        const undeterminedCount = questions.filter((q) => q.threeGridStatus === 'UNDETERMINED').length;
        return { totalCount, correctCount, wrongCount, undeterminedCount, allCorrect: totalCount > 0 && correctCount === totalCount };
    }
    const totalCount = questions.length;
    const correctCount = questions.filter((q) => q.conditionCorrect && q.relationCorrect && q.askCorrect).length;
    return { totalCount, correctCount, needsAdjustmentCount: totalCount - correctCount, incompleteCount: questions.filter((q) => !q.studentConditionText || !q.studentRelationText || !q.studentAskText).length, allCorrect: totalCount > 0 && correctCount === totalCount };
}
function hardSummary(questions) {
    if (questions.some((q) => q.outputSchemaVersion === 'hard-problem.v2')) {
        const totalCount = questions.length;
        const correctCount = questions.filter((q) => q.evaluationStatus === 'CORRECT').length;
        const wrongCount = questions.filter((q) => q.evaluationStatus === 'WRONG').length;
        const unansweredCount = questions.filter((q) => q.evaluationStatus === 'UNANSWERED').length;
        const unreadableCount = questions.filter((q) => q.evaluationStatus === 'UNREADABLE').length;
        return { totalCount, correctCount, wrongCount, unansweredCount, unreadableCount, allCorrect: totalCount > 0 && correctCount === totalCount };
    }
    const result = { totalCount: questions.length, fullyCorrectCount: 0, answerCorrectProcessWrongCount: 0, wrongCount: 0, unansweredCount: 0, allCorrect: false };
    for (const question of questions) {
        if (question.isCorrect)
            result.fullyCorrectCount += 1;
        else if (question.finalAnswerCorrect)
            result.answerCorrectProcessWrongCount += 1;
        else if (!String(question.studentAnswer || '').trim())
            result.unansweredCount += 1;
        else
            result.wrongCount += 1;
    }
    result.allCorrect = result.totalCount > 0 && result.fullyCorrectCount === result.totalCount;
    return result;
}
function calculationCarelessSummary(questions) {
    const summary = { totalCount: questions.length, correctCount: 0, wrongCount: 0, carelessCount: 0, methodIssueCount: 0, undeterminedCount: 0, allCorrect: false };
    for (const question of questions) {
        if (question?.issueCategory === 'knowledge_or_method') summary.methodIssueCount += 1;
        if (question?.analysisStatus !== 'ok' || question?.processCorrect == null || question?.finalAnswerCorrect == null || question?.carelessDetected == null) summary.undeterminedCount += 1;
        else if (question.carelessDetected === true) summary.carelessCount += 1;
        else if (question.processCorrect === true && question.finalAnswerCorrect === true) summary.correctCount += 1;
        else summary.wrongCount += 1;
    }
    summary.allCorrect = summary.totalCount > 0 && summary.correctCount === summary.totalCount;
    return summary;
}
const TEXT_QUALITY_FALLBACK = '公式或文本未能可靠识别，请重新上传方向正确、清晰完整的图片';
function textQualitySummary(task, questions) {
    return isCalculationCareless(task) ? calculationCarelessSummary(questions) : isCareless(task) ? carelessSummary(questions) : hardSummary(questions);
}
function unreadableTextQualityQuestion(question) {
    if (question.outputSchemaVersion === 'reading-careless.v2') {
        const value = { ...question, questionText: TEXT_QUALITY_FALLBACK, studentConditionText: '', studentRelationText: '', studentAskText: '', referenceConditionText: '', referenceRelationText: '', referenceAskText: '', analysisStatus: 'unreadable', conditionCorrect: null, relationCorrect: null, askCorrect: null, missingConditions: [], relationIssues: [], askIssue: '', errorReason: TEXT_QUALITY_FALLBACK, correctionAdvice: TEXT_QUALITY_FALLBACK };
        const normalized = { ...value, threeGridComplete: false, threeGridStatus: 'UNDETERMINED' };
        return { ...normalized, ...resultSemantics.normalizeDownstreamSemantics(normalized) };
    }
    if (question.outputSchemaVersion === 'calculation-careless.v2') {
        const value = { ...question, questionText: TEXT_QUALITY_FALLBACK, studentCalculation: '', standardCalculation: '', analysisStatus: 'unreadable', layoutClear: null, digitAlignmentCorrect: null, stepsComplete: null, carryBorrowClear: null, processCorrect: null, finalAnswerCorrect: null, carelessDetected: null, issueCategory: 'undetermined', carelessIssues: [], methodIssues: [], errorReason: TEXT_QUALITY_FALLBACK, firstErrorPoint: '', correctionAdvice: TEXT_QUALITY_FALLBACK, calculationStatus: 'UNDETERMINED' };
        return { ...value, ...resultSemantics.normalizeDownstreamSemantics(value) };
    }
    const value = { ...question, questionText: TEXT_QUALITY_FALLBACK, studentAnswer: '', standardAnswer: '', answerStatus: 'unreadable', finalAnswerCorrect: null, stepRequired: true, stepStatus: 'unreadable', logicStatus: 'unreadable', errorType: 'unreadable', firstWrongStep: '', errorReason: TEXT_QUALITY_FALLBACK, adjustmentSuggestion: TEXT_QUALITY_FALLBACK, knowledgePoint: '', stepFeedbacks: [], overallFeedback: TEXT_QUALITY_FALLBACK, evaluationStatus: 'UNREADABLE' };
    return { ...value, ...resultSemantics.normalizeDownstreamSemantics(value) };
}
function gateStudentVisibleText(result, task, phase) {
    const diagnostics = [];
    const questions = [];
    for (const question of Array.isArray(result?.questions) ? result.questions : []) {
        const issues = inspectStudentVisibleText(question);
        if (!issues.length) questions.push(question);
        else if (phase === 'review') questions.push(unreadableTextQualityQuestion(question));
        else diagnostics.push(...issues.map((issue) => ({ sourceKey: String(question.sourceKey || ''), fieldPath: issue.fieldPath, issueType: issue.issueType })));
    }
    return { ...result, questions, summary: textQualitySummary(task, questions), textQualityDiagnostics: diagnostics };
}
function isMissingCarelessRelation(value, strategy) {
    return strategy.reviewRules.carelessTraining.missingRelationTokens.includes(String(value || '').trim());
}
function enforceCarelessRelation(question, strategy) {
    const relationText = String(question.studentRelationText || '').trim();
    const conditionText = String(question.studentConditionText || '').trim();
    const askText = String(question.studentAskText || '').trim();
    if (isMissingCarelessRelation(relationText, strategy)) {
        const relationIssues = Array.isArray(question.relationIssues) ? question.relationIssues.filter(Boolean) : [];
        return { ...question, studentRelationText: '', relationCorrect: false, threeGridComplete: false, isCorrect: false, relationIssues: [...new Set([...relationIssues, strategy.reviewRules.carelessTraining.missingRelationIssue])] };
    }
    const threeGridComplete = Boolean(conditionText && relationText && askText);
    return { ...question, threeGridComplete, isCorrect: threeGridComplete && question.conditionCorrect === true && question.relationCorrect === true && question.askCorrect === true };
}
function normalizeQuestionBoundaryText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}
function readingImageIdentity(question) {
    const candidates = [question?.sourceKey, question?.sourceRegion].map(normalizeQuestionBoundaryText).filter(Boolean);
    for (const candidate of candidates) {
        const match = candidate.match(/(?:作业图|图片|图像)\s*(\d{1,3})|(?:^|[^a-z0-9])(?:img|image|page|p)[\s_:#-]*(\d{1,3})|第\s*(\d{1,3})\s*(?:张|页|幅)/i);
        if (match)
            return String(Number(match[1] || match[2] || match[3]));
    }
    return '';
}
function readingSubquestionFromTail(tail) {
    const sub = String(tail || '').trim().match(/^(?:[-—_:：.]\s*)?(?:[（(【[]\s*(\d{1,2})\s*[）)】\]]|(?:小题|第|问)\s*(\d{1,2})\s*(?:小题|问)?)/);
    return sub ? String(Number(sub[1] || sub[2])) : '';
}
function readingPrintedIdentityFromQuestionText(value) {
    const questionText = normalizeQuestionBoundaryText(value);
    if (!questionText) return null;
    const explicit = questionText.match(/^(?:第\s*)?(\d{1,3})\s*题/);
    if (explicit) return { main: String(Number(explicit[1])), sub: readingSubquestionFromTail(questionText.slice(explicit[0].length)) };
    const directSub = questionText.match(/^(\d{1,3})\s*[-—_]\s*(\d{1,2})(?=\s|[、:：.．)）】\]]|$)/);
    if (directSub) return { main: String(Number(directSub[1])), sub: String(Number(directSub[2])) };
    const numbered = questionText.match(/^(\d{1,3})\s*[、:：.．]/);
    if (numbered) return { main: String(Number(numbered[1])), sub: readingSubquestionFromTail(questionText.slice(numbered[0].length)) };
    return null;
}
function readingPrintedIdentityFromStructured(value) {
    const candidate = normalizeQuestionBoundaryText(value);
    if (!candidate) return null;
    const compactLabel = candidate.match(/^\s*(?:第\s*)?(?:q(?:uestion)?[\s_:#-]*)?(\d{1,3})\s*(?:题)?\s*$/i);
    if (compactLabel) return { main: String(Number(compactLabel[1])), sub: '' };
    const directSub = candidate.match(/(?:^|[:：|/])\s*(\d{1,3})\s*[-—_]\s*(\d{1,2})(?=\s|[、:：.．)）】\]]|$)/);
    if (directSub) return { main: String(Number(directSub[1])), sub: String(Number(directSub[2])) };
    const explicit = candidate.match(/(?:^|[:：|/\_-])\s*(?:第\s*)?(?:q(?:uestion)?[\s_:#-]*)?(\d{1,3})\s*题?/i);
    if (explicit) return { main: String(Number(explicit[1])), sub: readingSubquestionFromTail(candidate.slice(explicit.index + explicit[0].length)) };
    const numbered = candidate.match(/(?:^|[:：|/])\s*(\d{1,3})\s*[、.．]/);
    if (numbered) return { main: String(Number(numbered[1])), sub: '' };
    return null;
}
function samePrintedIdentity(left, right) {
    return Boolean(left && right && left.main === right.main && String(left.sub || '') === String(right.sub || ''));
}
function printedIdentityConflict(question) {
    const fromQuestionText = readingPrintedIdentityFromQuestionText(question?.questionText);
    const fromLabel = readingPrintedIdentityFromStructured(question?.sourceQuestionLabel);
    return Boolean(fromQuestionText && fromLabel && !samePrintedIdentity(fromQuestionText, fromLabel));
}
function readingPrintedQuestionIdentity(question) {
    const fromQuestionText = readingPrintedIdentityFromQuestionText(question?.questionText);
    const fromLabel = readingPrintedIdentityFromStructured(question?.sourceQuestionLabel);
    // Explicit printed number and explicit source label are two independent identity signals.
    // If they conflict, do not guess: returning null prevents cross-question auto-merge/attribution.
    if (printedIdentityConflict(question)) return null;
    if (fromQuestionText) return fromQuestionText;
    if (fromLabel) return fromLabel;
    for (const candidate of [question?.sourceKey, question?.sourceRegion]) {
        const parsed = readingPrintedIdentityFromStructured(candidate);
        if (parsed) return parsed;
    }
    return null;
}
function readingQuestionIdentity(question) {
    const printed = readingPrintedQuestionIdentity(question);
    const image = readingImageIdentity(question);
    if (!printed || !image)
        return '';
    return `image:${image}:printed:${printed.main}${printed.sub ? `:sub:${printed.sub}` : ''}`;
}
function stableTextCompare(a, b) {
    const normalizedA = normalizeQuestionBoundaryText(a);
    const normalizedB = normalizeQuestionBoundaryText(b);
    return normalizedA.localeCompare(normalizedB, 'en') || String(a).localeCompare(String(b), 'en');
}
function stableIdentityString(values) {
    return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))].sort(stableTextCompare)[0] || '';
}
function selectReadingString(values, { join = false } = {}) {
    const unique = [];
    for (const value of values) {
        const text = String(value || '').trim();
        if (!text || unique.some((item) => normalizeQuestionBoundaryText(item) === normalizeQuestionBoundaryText(text))) continue;
        unique.push(text);
    }
    if (!unique.length) return '';
    const byLength = [...unique].sort((a, b) => b.length - a.length || stableTextCompare(a, b));
    const superset = byLength.find((candidate) => unique.every((item) => normalizeQuestionBoundaryText(candidate).includes(normalizeQuestionBoundaryText(item))));
    if (superset) return superset;
    return join ? [...unique].sort(stableTextCompare).join('\n') : byLength[0];
}
function mergeReadingBoolean(values) {
    if (values.includes(false)) return false;
    if (values.includes(true)) return true;
    return null;
}
function mergeReadingQuestion(group) {
    if (group.length === 1) return group[0];
    const orderedGroup = [...group].sort((a, b) => stableTextCompare(a?.sourceKey || a?.sourceRegion || a?.sourceQuestionLabel || '', b?.sourceKey || b?.sourceRegion || b?.sourceQuestionLabel || ''));
    const first = orderedGroup[0];
    group = orderedGroup;
    const merged = { ...first, sourceKey: stableIdentityString(group.map((item) => item?.sourceKey)) || first.sourceKey };
    const joinedFields = ['questionText', 'askIssue', 'errorReason', 'correctionAdvice'];
    const longestFields = ['studentConditionText', 'studentRelationText', 'studentAskText', 'referenceConditionText', 'referenceRelationText', 'referenceAskText', 'sourceQuestionLabel', 'sourceRegion'];
    for (const field of joinedFields) merged[field] = selectReadingString(group.map((item) => item?.[field]), { join: true });
    for (const field of longestFields) merged[field] = selectReadingString(group.map((item) => item?.[field]));
    for (const field of ['missingConditions', 'relationIssues', 'incorrectConditions']) merged[field] = [...new Set(group.flatMap((item) => Array.isArray(item?.[field]) ? item[field].map((value) => String(value || '').trim()).filter(Boolean) : []))];
    for (const field of ['conditionCorrect', 'relationCorrect', 'askCorrect']) merged[field] = mergeReadingBoolean(group.map((item) => item?.[field]));
    merged.analysisStatus = group.some((item) => item?.analysisStatus === 'ok') ? 'ok' : group.some((item) => item?.analysisStatus === 'insufficient') ? 'insufficient' : 'unreadable';
    merged.studentWorkDetected = group.some((item) => item?.studentWorkDetected === true);
    const applicability = group.map((item) => item?.modeApplicability);
    merged.modeApplicability = applicability.includes('applicable') ? 'applicable' : applicability.includes('uncertain') ? 'uncertain' : applicability.includes('not_applicable') ? 'not_applicable' : merged.modeApplicability;
    const basisPriority = ['printed_question_with_work', 'work_only_complete', 'work_only_incomplete', 'printed_question_without_work'];
    merged.inputBasis = basisPriority.find((value) => group.some((item) => item?.inputBasis === value)) || merged.inputBasis;
    const confidenceValues = group.map((item) => Number(item?.confidence)).filter(Number.isFinite);
    merged.confidence = confidenceValues.length ? Math.max(0, Math.min(1, Math.min(...confidenceValues))) : 0;
    return merged;
}
function consolidateReadingQuestions(result) {
    if (result?.outputSchemaVersion !== 'reading-careless.v2' || !Array.isArray(result.questions) || result.questions.length < 2) return result;
    const output = [];
    const groups = new Map();
    for (const question of result.questions) {
        const identity = readingQuestionIdentity(question);
        if (!identity) {
            output.push(question);
            continue;
        }
        if (!groups.has(identity)) {
            const holder = { identity, questions: [] };
            groups.set(identity, holder);
            output.push(holder);
        }
        groups.get(identity).questions.push(question);
    }
    const questions = output.map((item) => item?.questions ? mergeReadingQuestion(item.questions) : item);
    const collapsedCount = result.questions.length - questions.length;
    if (!collapsedCount) return result;
    const audit = result.questionSetAudit && typeof result.questionSetAudit === 'object' ? {
        ...result.questionSetAudit,
        visibleIndependentQuestionCount: Math.max(questions.length, Number(result.questionSetAudit.visibleIndependentQuestionCount || result.questions.length) - collapsedCount),
        emittedQuestionCount: Math.max(questions.length, Number(result.questionSetAudit.emittedQuestionCount || result.questions.length) - collapsedCount)
    } : result.questionSetAudit;
    return { ...result, questions, ...(audit ? { questionSetAudit: audit } : {}) };
}
function canonicalQuestionIdentity(question) {
    if (printedIdentityConflict(question)) return '';
    const printed = readingPrintedQuestionIdentity(question);
    const image = readingImageIdentity(question);
    if (printed && image)
        return `image:${image}:printed:${printed.main}${printed.sub ? `:sub:${printed.sub}` : ''}`;
    const label = normalizeQuestionBoundaryText(question?.sourceQuestionLabel);
    const region = normalizeQuestionBoundaryText(question?.sourceRegion);
    return label && region ? `${region}\u0000${label}` : '';
}
function canonicalQuestionText(values) {
    const unique = [];
    for (const value of values) {
        const text = String(value || '').trim();
        if (text && !unique.includes(text)) unique.push(text);
    }
    return unique.join('\n');
}
function mergeCanonicalCommonEvidence(canonical, group) {
    const workValues = group.map((question) => question?.studentWorkDetected).filter((value) => value === true || value === false);
    if (workValues.includes(true)) canonical.studentWorkDetected = true;
    else if (workValues.length) canonical.studentWorkDetected = false;
    const basisPriority = canonical.studentWorkDetected === true
        ? ['printed_question_with_work', 'work_only_complete', 'work_only_incomplete']
        : ['printed_question_without_work'];
    canonical.inputBasis = basisPriority.find((value) => group.some((question) => question?.inputBasis === value))
        || group.map((question) => question?.inputBasis).find(Boolean) || canonical.inputBasis;
    const applicabilityPriority = ['applicable', 'uncertain', 'not_applicable'];
    canonical.modeApplicability = applicabilityPriority.find((value) => group.some((question) => question?.modeApplicability === value)) || canonical.modeApplicability;
    const confidenceValues = group.map((question) => Number(question?.confidence)).filter(Number.isFinite);
    canonical.confidence = confidenceValues.length ? Math.max(0, Math.min(1, Math.min(...confidenceValues))) : 0;
    return canonical;
}
function mergeCanonicalBoolean(group, field, { trueWins = false } = {}) {
    const values = group.map((question) => question?.[field]).filter((value) => value === true || value === false);
    if (!values.length) return null;
    if (trueWins) return values.includes(true);
    return values.includes(false) ? false : true;
}
function canonicalizeQuestionBaseline(result) {
    if (!result?.outputSchemaVersion || !Array.isArray(result.questions) || result.questions.length < 2) return result;
    const declaredCount = result.questionSetAudit?.visibleIndependentQuestionCount;
    if (!Number.isInteger(declaredCount) || declaredCount < 1 || declaredCount >= result.questions.length) return result;
    const output = [];
    const groups = new Map();
    for (const question of result.questions) {
        const identity = canonicalQuestionIdentity(question);
        if (!identity) {
            output.push(question);
            continue;
        }
        if (!groups.has(identity)) {
            const holder = { questions: [] };
            groups.set(identity, holder);
            output.push(holder);
        }
        groups.get(identity).questions.push(question);
    }
    const questions = output.map((item) => {
        if (!item?.questions || item.questions.length === 1) return item?.questions ? item.questions[0] : item;
        const group = [...item.questions].sort((a, b) => stableTextCompare(a?.sourceKey || a?.sourceRegion || a?.sourceQuestionLabel || '', b?.sourceKey || b?.sourceRegion || b?.sourceQuestionLabel || ''));
        const canonical = { ...group[0], sourceKey: stableIdentityString(group.map((question) => question?.sourceKey)) || group[0].sourceKey };
        for (const field of ['questionText', 'studentAnswer', 'studentCalculation', 'standardAnswer', 'standardCalculation', 'firstWrongStep', 'firstErrorPoint', 'errorReason', 'adjustmentSuggestion', 'correctionAdvice', 'overallFeedback']) {
            if (Object.hasOwn(canonical, field)) canonical[field] = canonicalQuestionText(group.map((question) => question?.[field]));
        }
        if (group.some((question) => Array.isArray(question?.stepFeedbacks))) {
            const seen = new Set();
            const combined = [];
            for (const question of group) for (const step of Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks : []) {
                const fingerprint = [step?.solutionText, step?.explanationText].map((value) => normalizeQuestionBoundaryText(value)).join('\u0000');
                if (fingerprint && seen.has(fingerprint)) continue;
                if (fingerprint) seen.add(fingerprint);
                combined.push({ ...step, stepIndex: combined.length + 1 });
            }
            canonical.stepFeedbacks = combined;
        }
        mergeCanonicalCommonEvidence(canonical, group);
        if (canonical.outputSchemaVersion === 'hard-problem.v2') {
            const statuses = group.map((question) => String(question?.answerStatus || ''));
            if (statuses.includes('answered')) {
                canonical.answerStatus = 'answered';
                canonical.finalAnswerCorrect = !group.some((question) => question?.answerStatus === 'answered' && question?.finalAnswerCorrect === false);
            } else if (statuses.includes('unreadable')) {
                canonical.answerStatus = 'unreadable';
                canonical.finalAnswerCorrect = null;
            } else {
                canonical.answerStatus = 'unanswered';
                canonical.finalAnswerCorrect = null;
            }
            canonical.stepRequired = group.some((question) => question?.stepRequired === true || (Array.isArray(question?.stepFeedbacks) && question.stepFeedbacks.length > 0));
            return normalizeHardProblemQuestion(canonical);
        }
        if (canonical.outputSchemaVersion === 'calculation-careless.v2') {
            const statuses = group.map((question) => String(question?.analysisStatus || ''));
            canonical.analysisStatus = statuses.includes('ok') ? 'ok' : statuses.includes('insufficient') ? 'insufficient' : 'unreadable';
            canonical.processCorrect = canonical.analysisStatus === 'ok' ? mergeCanonicalBoolean(group, 'processCorrect') : null;
            canonical.finalAnswerCorrect = canonical.analysisStatus === 'ok' ? mergeCanonicalBoolean(group, 'finalAnswerCorrect') : null;
            canonical.carelessDetected = canonical.analysisStatus === 'ok' ? mergeCanonicalBoolean(group, 'carelessDetected', { trueWins: true }) : null;
            for (const field of ['carelessIssues', 'methodIssues']) {
                canonical[field] = [...new Set(group.flatMap((question) => Array.isArray(question?.[field]) ? question[field].map((value) => String(value || '').trim()).filter(Boolean) : []))];
            }
        }
        return canonical;
    });
    const collapsedCount = result.questions.length - questions.length;
    if (!collapsedCount || questions.length !== declaredCount) return result;
    const audit = result.questionSetAudit && typeof result.questionSetAudit === 'object' ? {
        ...result.questionSetAudit,
        visibleIndependentQuestionCount: questions.length,
        emittedQuestionCount: questions.length,
        excludedQuestionCount: 0
    } : result.questionSetAudit;
    return { ...result, questions, ...(audit ? { questionSetAudit: audit } : {}) };
}
function validateCarelessTrainingGradeResult(value, phase = 'final', strategy = (0, embedded_1.decryptEmbeddedStrategy)()) {
    const validatedResult = (0, json_1.validateCarelessTrainingResult)((0, json_1.normalizeCarelessTrainingResult)(value), phase);
    const result = canonicalizeQuestionBaseline(consolidateReadingQuestions(validatedResult));
    if (result.outputSchemaVersion === 'reading-careless.v2') {
        const questions = result.questions.map((q) => {
            const threeGridComplete = Boolean(String(q.studentConditionText || '').trim() && String(q.studentRelationText || '').trim() && String(q.studentAskText || '').trim());
            const threeGridStatus = q.analysisStatus !== 'ok' ? 'UNDETERMINED' : q.conditionCorrect === true && q.relationCorrect === true && q.askCorrect === true ? 'CORRECT' : 'WRONG';
            const normalizedQuestion = { ...q, outputSchemaVersion: 'reading-careless.v2', threeGridComplete, threeGridStatus, confidence: Math.max(0, Math.min(1, Number(q.confidence) || 0)) };
            return { ...normalizedQuestion, ...resultSemantics.normalizeDownstreamSemantics(normalizedQuestion) };
        });
        const includedQuestions = excludePrintedQuestionsWithoutWork(questions);
        return normalizeQuestionSetAudit({ ...result, summary: carelessSummary(includedQuestions), validationWarnings: Array.isArray(result.validationWarnings) ? result.validationWarnings : [] }, questions, includedQuestions, strategy);
    }
    const questions = result.questions.map((q) => ({ ...enforceCarelessRelation(q, strategy), sourceKey: String(q.sourceKey || ''), confidence: Math.max(0, Math.min(1, Number(q.confidence) || 0)) }));
    const includedQuestions = excludePrintedQuestionsWithoutWork(questions);
    return normalizeQuestionSetAudit({ ...result, summary: carelessSummary(includedQuestions) }, questions, includedQuestions, strategy);
}
function validateCalculationCarelessTrainingGradeResult(value, strategy = (0, embedded_1.decryptEmbeddedStrategy)()) {
    const result = canonicalizeQuestionBaseline((0, json_1.validateCalculationCarelessTrainingResult)(value));
    const questions = result.questions.map((q) => {
        const calculationStatus = q.processCorrect === true && q.finalAnswerCorrect === true ? 'CORRECT' : q.processCorrect === null || q.finalAnswerCorrect === null ? 'UNDETERMINED' : 'WRONG';
        const issueCategory = calculationStatus === 'CORRECT' ? 'none' : calculationStatus === 'UNDETERMINED' ? 'undetermined' : q.carelessDetected === true ? 'careless' : 'knowledge_or_method';
        if (q.issueCategory !== issueCategory && audit_1?.monitor)
            audit_1.monitor(auditSource, 'CALCULATION_ISSUE_CATEGORY_OVERRIDDEN', { sourceKey: q.sourceKey, modelIssueCategory: q.issueCategory, issueCategory, calculationStatus }, true);
        const normalizedQuestion = { ...q, calculationStatus, issueCategory, confidence: Math.max(0, Math.min(1, Number(q.confidence) || 0)) };
        return { ...normalizedQuestion, ...resultSemantics.normalizeDownstreamSemantics(normalizedQuestion) };
    });
    const includedQuestions = excludePrintedQuestionsWithoutWork(questions);
    return normalizeQuestionSetAudit({ ...result, summary: calculationCarelessSummary(includedQuestions) }, questions, includedQuestions, strategy);
}
function normalizeHardProblemsPayload(payload) {
    let value = payload;
    let parseStage = 'object';
    if (typeof payload === 'string') {
        parseStage = /^\s*```(?:json)?\s*/i.test(payload) ? 'markdown_json' : 'json_string';
        value = (0, json_1.extractJson)(payload);
    }
    const isObject = value && typeof value === 'object' && !Array.isArray(value);
    const topLevelKeys = isObject ? Object.keys(value) : [];
    const nestedObjectKeys = isObject
        ? Object.fromEntries(topLevelKeys.filter((key) => value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])).map((key) => [key, Object.keys(value[key])]))
        : {};
    const diagnostics = {
        payloadType: Array.isArray(payload) ? 'array' : typeof payload,
        topLevelKeys,
        nestedObjectKeys,
        questionsPresent: isObject && Object.hasOwn(value, 'questions'),
        questionsIsArray: isObject && Array.isArray(value.questions),
        parseStage
    };
    if (!isObject || Array.isArray(value.questions))
        return { value, diagnostics };
    for (const key of ['result', 'data', 'output']) {
        if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key]) && Array.isArray(value[key].questions)) {
            return { value: { ...value, questions: value[key].questions }, diagnostics: { ...diagnostics, questionsPresent: true, questionsIsArray: true } };
        }
    }
    return { value, diagnostics };
}
function normalizeHardProblemsResult(payload) {
    return normalizeHardProblemsPayload(payload).value;
}
function validateHardProblemGradeResult(value, strategy = (0, embedded_1.decryptEmbeddedStrategy)(), diagnostics = {}) {
    const normalized = normalizeHardProblemsPayload(value);
    let result;
    try {
        result = canonicalizeQuestionBaseline((0, json_1.validateHardProblemResult)(normalized.value, diagnostics));
    }
    catch (error) {
        if (error?.code === 'LLM_SCHEMA_ERROR' && !normalized.diagnostics.questionsIsArray)
            (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_RESULT_SCHEMA_DIAGNOSTIC', normalized.diagnostics, true);
        throw error;
    }
    if (result.outputSchemaVersion === 'hard-problem.v2') {
        const questions = result.questions.map((q) => {
            const evaluationStatus = deriveHardProblemEvaluationStatus(q);
            const warnings = Array.isArray(q.validationWarnings) ? [...q.validationWarnings] : [];
            let errorType = q.errorType;
            if (evaluationStatus === 'UNANSWERED') errorType = 'unanswered';
            else if (evaluationStatus === 'UNREADABLE') errorType = 'unreadable';
            else if (evaluationStatus === 'CORRECT') errorType = 'none';
            else if (!['answer_error', 'calculation_error', 'method_error', 'logic_error', 'multiple'].includes(errorType)) {
                warnings.push(`errorType: ${String(errorType)} conflicts with evaluationStatus=WRONG`);
                errorType = 'multiple';
            }
            const correctSummary = evaluationStatus === 'CORRECT' ? { firstWrongStep: '', errorReason: '', adjustmentSuggestion: '' } : {};
            const normalizedQuestion = { ...q, ...correctSummary, outputSchemaVersion: 'hard-problem.v2', evaluationStatus, errorType, confidence: Math.max(0, Math.min(1, Number(q.confidence) || 0)), ...(warnings.length ? { validationWarnings: warnings } : {}) };
            return { ...normalizedQuestion, ...resultSemantics.normalizeDownstreamSemantics(normalizedQuestion) };
        });
        const validationWarnings = questions.flatMap((q) => q.validationWarnings || []);
        const includedQuestions = excludePrintedQuestionsWithoutWork(questions);
        return normalizeQuestionSetAudit({ ...result, summary: hardSummary(includedQuestions), ...(validationWarnings.length ? { validationWarnings } : {}) }, questions, includedQuestions, strategy);
    }
    const questions = result.questions.map((q) => {
        const rules = strategy.reviewRules.hardProblem;
        const isCorrect = q.finalAnswerCorrect === true && (!q.stepRequired || rules.correctStepStatuses.includes(q.stepStatus)) && q.logicStatus === rules.correctLogicStatus;
        return { ...q, sourceKey: String(q.sourceKey || ''), isCorrect, confidence: Math.max(0, Math.min(1, Number(q.confidence) || 0)), ...(isCorrect ? { errorType: 'none', firstWrongStep: '', errorReason: '', adjustmentSuggestion: '' } : {}) };
    });
    const includedQuestions = excludePrintedQuestionsWithoutWork(questions);
    return normalizeQuestionSetAudit({ ...result, summary: hardSummary(includedQuestions) }, questions, includedQuestions, strategy);
}
function reviewAdditionHasExplicitEvidence(question) {
    return Boolean(
        String(question?.sourceKey || '').trim()
        && canonicalQuestionIdentity(question)
        && normalizeQuestionBoundaryText(question?.questionText)
    );
}
function reviewAuditAllowsNewQuestions(primary, review, newQuestionCount) {
    if (newQuestionCount <= 0) return true;
    const primaryVisible = Number(primary?.questionSetAudit?.visibleIndependentQuestionCount);
    const primaryEmitted = Number(primary?.questionSetAudit?.emittedQuestionCount);
    const primaryExcluded = Number(primary?.questionSetAudit?.excludedQuestionCount);
    const reviewVisible = Number(review?.questionSetAudit?.visibleIndependentQuestionCount);
    const reviewEmitted = Number(review?.questionSetAudit?.emittedQuestionCount);
    const reviewExcluded = Number(review?.questionSetAudit?.excludedQuestionCount);
    const primaryQuestionCount = Array.isArray(primary?.questions) ? primary.questions.length : 0;
    const reviewQuestionCount = Array.isArray(review?.questions) ? review.questions.length : 0;
    if (![primaryVisible, primaryEmitted, primaryExcluded, reviewVisible, reviewEmitted, reviewExcluded].every(Number.isInteger)) return false;
    if (primaryEmitted !== primaryQuestionCount || primaryVisible !== primaryEmitted + primaryExcluded) return false;
    if (reviewEmitted !== reviewQuestionCount || reviewVisible !== reviewEmitted + reviewExcluded) return false;
    return reviewEmitted - primaryEmitted >= newQuestionCount && reviewVisible >= primaryVisible;
}

function reviewAuditMismatchDiagnostics(primary, review, newQuestionCount, additions) {
    return {
        primaryVisible: Number(primary?.questionSetAudit?.visibleIndependentQuestionCount),
        primaryEmitted: Number(primary?.questionSetAudit?.emittedQuestionCount),
        primaryExcluded: Number(primary?.questionSetAudit?.excludedQuestionCount),
        reviewVisible: Number(review?.questionSetAudit?.visibleIndependentQuestionCount),
        reviewEmitted: Number(review?.questionSetAudit?.emittedQuestionCount),
        reviewExcluded: Number(review?.questionSetAudit?.excludedQuestionCount),
        newQuestionCount,
        addedQuestionIdentities: additions.slice(0, 10).map((question) => ({ sourceKey: String(question?.sourceKey || '').trim(), sourceQuestionLabel: String(question?.sourceQuestionLabel || '').trim().slice(0, 120), sourceRegion: String(question?.sourceRegion || '').trim().slice(0, 200) }))
    };
}
function alignReviewQuestionsToPrimaryBaseline(primary, review, { allowNewQuestions = true } = {}) {
    const primaryQuestions = Array.isArray(primary?.questions) ? primary.questions : [];
    const reviewQuestions = Array.isArray(review?.questions) ? review.questions : [];
    const primaryKeys = primaryQuestions.map((question) => String(question?.sourceKey || '').trim());
    const canonicalKeys = Array.isArray(primary?.canonicalSourceKeys)
        ? primary.canonicalSourceKeys.map((sourceKey) => String(sourceKey || '').trim())
        : primaryKeys;
    const rawReviewKeys = reviewQuestions.map((question) => String(question?.sourceKey || '').trim());
    const invalidBase = !primaryKeys.every(Boolean) || new Set(primaryKeys).size !== primaryKeys.length
        || !canonicalKeys.every(Boolean) || new Set(canonicalKeys).size !== canonicalKeys.length
        || !primaryKeys.every((key) => canonicalKeys.includes(key))
        || !rawReviewKeys.every(Boolean) || new Set(rawReviewKeys).size !== rawReviewKeys.length;
    if (invalidBase)
        throw Object.assign(new Error('REVIEW sourceKey 与 PRIMARY 规范题目基线不一致'), { code: 'QUESTION_SET_MISMATCH' });

    const primaryByKey = new Map(primaryQuestions.map((question) => [String(question.sourceKey).trim(), question]));
    const primaryByIdentity = new Map();
    const ambiguousPrimaryIdentities = new Set();
    for (const question of primaryQuestions) {
        const identity = canonicalQuestionIdentity(question);
        if (!identity) continue;
        if (primaryByIdentity.has(identity)) {
            primaryByIdentity.delete(identity);
            ambiguousPrimaryIdentities.add(identity);
        } else if (!ambiguousPrimaryIdentities.has(identity)) {
            primaryByIdentity.set(identity, question);
        }
    }

    const usedPrimaryKeys = new Set();
    const seenAdditionIdentities = new Set();
    const additions = [];
    let trulyNewQuestionCount = 0;
    const alignedReviewQuestions = reviewQuestions.map((reviewQuestion) => {
        const reviewKey = String(reviewQuestion?.sourceKey || '').trim();
        let primaryQuestion = primaryByKey.get(reviewKey) || null;
        if (!primaryQuestion) {
            const identity = canonicalQuestionIdentity(reviewQuestion);
            if (identity && primaryByIdentity.has(identity)) primaryQuestion = primaryByIdentity.get(identity);
        }
        if (primaryQuestion) {
            const primaryKey = String(primaryQuestion.sourceKey || '').trim();
            if (usedPrimaryKeys.has(primaryKey))
                throw Object.assign(new Error('REVIEW 多个题目映射到同一 PRIMARY 题目'), { code: 'QUESTION_SET_MISMATCH' });
            usedPrimaryKeys.add(primaryKey);
            return {
                ...reviewQuestion,
                sourceKey: primaryQuestion.sourceKey,
                sourceQuestionLabel: primaryQuestion.sourceQuestionLabel,
                sourceRegion: primaryQuestion.sourceRegion
            };
        }

        const recognizedBeforeGate = canonicalKeys.includes(reviewKey);
        const identity = canonicalQuestionIdentity(reviewQuestion);
        if (!recognizedBeforeGate) {
            if (!allowNewQuestions || !reviewAdditionHasExplicitEvidence(reviewQuestion) || ambiguousPrimaryIdentities.has(identity) || primaryByIdentity.has(identity) || seenAdditionIdentities.has(identity))
                throw Object.assign(new Error('REVIEW 补充题缺少唯一原图归属证据'), { code: 'QUESTION_SET_MISMATCH' });
            seenAdditionIdentities.add(identity);
            trulyNewQuestionCount += 1;
        }
        additions.push(reviewQuestion);
        return reviewQuestion;
    });

    if (!primaryKeys.every((key) => usedPrimaryKeys.has(key))) {
        const contract = primaryReviewQuestionContract(primary);
        const missingPrimaryQuestions = contract.filter((item) => !usedPrimaryKeys.has(item.sourceKey));
        throw Object.assign(new Error('REVIEW 缺少 PRIMARY 已识别题目'), {
            code: 'QUESTION_SET_MISMATCH',
            missingPrimaryQuestionIds: missingPrimaryQuestions.map((item) => item.primaryQuestionId),
            missingPrimaryQuestions
        });
    }
    if (!reviewAuditAllowsNewQuestions(primary, review, trulyNewQuestionCount))
        throw Object.assign(new Error('REVIEW 新增题目未通过独立题数审计'), { code: 'QUESTION_SET_MISMATCH', questionSetAuditDiagnostics: reviewAuditMismatchDiagnostics(primary, review, trulyNewQuestionCount, additions) });
    const alignedKeys = alignedReviewQuestions.map((question) => String(question?.sourceKey || '').trim());
    if (!alignedKeys.every(Boolean) || new Set(alignedKeys).size !== alignedKeys.length)
        throw Object.assign(new Error('REVIEW 对齐后 sourceKey 不唯一'), { code: 'QUESTION_SET_MISMATCH' });

    const alignedByKey = new Map(alignedReviewQuestions.map((question) => [String(question.sourceKey).trim(), question]));
    return {
        review: { ...review, questions: alignedReviewQuestions },
        pairs: primaryQuestions.map((primaryQuestion) => [primaryQuestion, alignedByKey.get(String(primaryQuestion.sourceKey).trim())]),
        additions
    };
}
function reviewQuestionsByPrimaryBaseline(primary, review) {
    const aligned = alignReviewQuestionsToPrimaryBaseline(primary, review);
    return { pairs: aligned.pairs, additions: aligned.additions };
}
function restoreReviewQuestionAttribution(primary, review, { allowUnmapped = false } = {}) {
    if (allowUnmapped) {
        const primaryByKey = new Map((Array.isArray(primary?.questions) ? primary.questions : []).map((question) => [String(question?.sourceKey || '').trim(), question]));
        const primaryByIdentity = new Map();
        const ambiguous = new Set();
        for (const primaryQuestion of Array.isArray(primary?.questions) ? primary.questions : []) {
            const identity = canonicalQuestionIdentity(primaryQuestion);
            if (!identity) continue;
            if (primaryByIdentity.has(identity)) { primaryByIdentity.delete(identity); ambiguous.add(identity); }
            else if (!ambiguous.has(identity)) primaryByIdentity.set(identity, primaryQuestion);
        }
        return {
            ...review,
            questions: (Array.isArray(review?.questions) ? review.questions : []).map((reviewQuestion) => {
                const key = String(reviewQuestion?.sourceKey || '').trim();
                const identity = canonicalQuestionIdentity(reviewQuestion);
                const primaryQuestion = primaryByKey.get(key) || (key && identity && !ambiguous.has(identity) ? primaryByIdentity.get(identity) : null);
                return primaryQuestion ? {
                    ...reviewQuestion,
                    sourceKey: primaryQuestion.sourceKey,
                    sourceQuestionLabel: primaryQuestion.sourceQuestionLabel,
                    sourceRegion: primaryQuestion.sourceRegion
                } : reviewQuestion;
            })
        };
    }
    return alignReviewQuestionsToPrimaryBaseline(primary, review).review;
}
function mergeCarelessTrainingResults(primary, review, strategy = (0, embedded_1.decryptEmbeddedStrategy)()) {
    const { canonicalSourceKeys, ...primaryResult } = primary || {};
    if (primary?.outputSchemaVersion === 'reading-careless.v2') {
      const { pairs, additions } = reviewQuestionsByPrimaryBaseline(primary, review);
      const mergeReferenceFields = (primaryQuestion, reviewQuestion) => ['referenceConditionText', 'referenceRelationText', 'referenceAskText'].reduce((merged, field) => {
          const reviewValue = reviewQuestion[field];
          const primaryValue = primaryQuestion[field];
          return { ...merged, [field]: typeof reviewValue === 'string' && reviewValue.trim() ? reviewValue : typeof primaryValue === 'string' && primaryValue.trim() ? primaryValue : reviewValue };
      }, { ...primaryQuestion, ...reviewQuestion, sourceKey: primaryQuestion.sourceKey, sourceQuestionLabel: primaryQuestion.sourceQuestionLabel, sourceRegion: primaryQuestion.sourceRegion });
      const questions = [...pairs.map(([primaryQuestion, reviewQuestion]) => mergeReferenceFields(primaryQuestion, reviewQuestion)), ...additions];
      return validateCarelessTrainingGradeResult({ ...primaryResult, questionSetAudit: review?.questionSetAudit, questions }, 'final', strategy);
    }
    const nonEmptyReference = (base, next) => ['referenceConditionText', 'referenceRelationText', 'referenceAskText'].reduce((merged, key) => ({ ...merged, [key]: String(next?.[key] || '').trim() || String(base?.[key] || '').trim() || '' }), { ...base, ...next, sourceKey: base.sourceKey, sourceQuestionLabel: base.sourceQuestionLabel, sourceRegion: base.sourceRegion });
    const { pairs, additions } = reviewQuestionsByPrimaryBaseline(primary, review);
    return validateCarelessTrainingGradeResult({ ...primaryResult, questionSetAudit: review?.questionSetAudit, questions: [...pairs.map(([primaryQuestion, reviewQuestion]) => nonEmptyReference(primaryQuestion, reviewQuestion)), ...additions] }, 'final', strategy);
}
function mergeCalculationCarelessTrainingResults(primary, review, strategy) { const { canonicalSourceKeys, ...primaryResult } = primary || {}; const { pairs, additions } = reviewQuestionsByPrimaryBaseline(primary, review); return validateCalculationCarelessTrainingGradeResult({ ...primaryResult, questionSetAudit: review?.questionSetAudit, questions: [...pairs.map(([primaryQuestion, reviewQuestion]) => ({ ...primaryQuestion, ...reviewQuestion, sourceKey: primaryQuestion.sourceKey, sourceQuestionLabel: primaryQuestion.sourceQuestionLabel, sourceRegion: primaryQuestion.sourceRegion })), ...additions] }, strategy); }
function normalizeHardProblemSource(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[，。；：、,.!?！？()（）【】\[\]{}“”‘’'"`]/g, '');
}
function hardProblemSourceEvidence(question) {
    const evidence = [];
    for (const step of Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks : []) {
        for (const value of [step?.solutionText, step?.explanationText]) {
            const normalized = normalizeHardProblemSource(value);
            if (normalized) evidence.push(normalized);
        }
    }
    const studentAnswer = normalizeHardProblemSource(question?.studentAnswer);
    if (studentAnswer) evidence.push(studentAnswer);
    return [...new Set(evidence)];
}
function reviewCoversPrimaryStepEvidence(primaryQuestion, reviewQuestion) {
    const primaryEvidence = hardProblemSourceEvidence(primaryQuestion);
    const reviewEvidence = hardProblemSourceEvidence(reviewQuestion);
    const missing = primaryEvidence.filter((source) => !reviewEvidence.some((candidate) => candidate === source || candidate.includes(source) || (source.length >= 8 && source.includes(candidate) && candidate.length / source.length >= 0.8)));
    return { covered: missing.length === 0, missing };
}
function mergeHardProblemQuestion(primaryQuestion, reviewQuestion) {
    const primarySteps = Array.isArray(primaryQuestion?.stepFeedbacks) ? primaryQuestion.stepFeedbacks : [];
    const reviewSteps = Array.isArray(reviewQuestion?.stepFeedbacks) ? reviewQuestion.stepFeedbacks : [];
    const attribution = { sourceKey: primaryQuestion.sourceKey, sourceQuestionLabel: primaryQuestion.sourceQuestionLabel, sourceRegion: primaryQuestion.sourceRegion };
    if (primaryQuestion?.answerStatus === 'answered' && primaryQuestion?.stepRequired === true && primarySteps.length > reviewSteps.length) {
        const coverage = reviewCoversPrimaryStepEvidence(primaryQuestion, reviewQuestion);
        if (coverage.covered) {
            const warning = `REVIEW_STEP_CONSOLIDATION_ACCEPTED:${primarySteps.length}>${reviewSteps.length}`;
            const validationWarnings = [...new Set([...(Array.isArray(reviewQuestion.validationWarnings) ? reviewQuestion.validationWarnings : []), warning])];
            return { ...primaryQuestion, ...reviewQuestion, ...attribution, validationWarnings };
        }
        const warning = `REVIEW_STEP_OMISSION_PRIMARY_PRESERVED:${primarySteps.length}>${reviewSteps.length}:missing=${coverage.missing.length}`;
        const validationWarnings = [...new Set([...(Array.isArray(primaryQuestion.validationWarnings) ? primaryQuestion.validationWarnings : []), warning])];
        return { ...primaryQuestion, ...attribution, validationWarnings };
    }
    return { ...primaryQuestion, ...reviewQuestion, ...attribution };
}
function mergeHardProblemResults(primary, review, strategy = (0, embedded_1.decryptEmbeddedStrategy)()) {
    const { canonicalSourceKeys, ...primaryResult } = primary || {};
    const { pairs, additions } = reviewQuestionsByPrimaryBaseline(primary, review);
    return validateHardProblemGradeResult({ ...primaryResult, questionSetAudit: review?.questionSetAudit, questions: [...pairs.map(([primaryQuestion, reviewQuestion]) => mergeHardProblemQuestion(primaryQuestion, reviewQuestion)), ...additions] }, strategy);
}
function usesHardProblemDirect(strategy) {
    return strategy?.reviewRules?.hardProblemDirectMode === true;
}
function hardProblemDirectRecoverable(error) {
    const code = String(error?.code || '');
    if (['LLM_JSON_PARSE_ERROR', 'LLM_EMPTY_RESPONSE', 'ARK_OUTPUT_TRUNCATED', 'QWEN_OUTPUT_TRUNCATED', 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR'].includes(code)) return true;
    if (code !== 'LLM_SCHEMA_ERROR') return false;
    const issues = Array.isArray(error?.issues) ? error.issues : [];
    return issues.length > 0 && issues.every((item) => item?.repairable === true);
}
const DIRECT_PROCESS_VERDICTS = new Set(['correct', 'wrong', 'missing', 'unreadable']);
const DIRECT_EXPLANATION_VERDICTS = new Set(['clear', 'partially_clear', 'incorrect', 'missing', 'unreadable']);
const DIRECT_LOGIC_VERDICTS = new Set(['clear', 'insufficient', 'wrong', 'unreadable']);
const DIRECT_FINAL_VERDICTS = new Set(['correct', 'wrong', 'missing', 'unreadable']);
const DIRECT_REVIEW_DECISIONS = new Set(['keep', 'correct']);
function directString(value) { return typeof value === 'string' ? value.trim() : ''; }
function directComparableAnswerText(value) {
    return directString(value)
        .replace(/^\s*(?:答(?!题)|答案|最终答案)\s*[：:]?\s*/u, '')
        .replace(/[\s，,。；;：:]/gu, '');
}
function directAnswerTextFromStep(step) {
    const source = step && typeof step === 'object' && !Array.isArray(step) ? step : {};
    const processText = directString(source.solutionText ?? source.studentProcess ?? source.process);
    if (!processText) return '';
    return processText.replace(/^\s*(?:答(?!题)|答案|最终答案)\s*[：:]?\s*/u, '').trim();
}
function isHardProblemDirectFinalAnswerStep(step, studentAnswer = '') {
    const source = step && typeof step === 'object' && !Array.isArray(step) ? step : {};
    const title = directString(source.stepTitle ?? source.title);
    const processText = directString(source.solutionText ?? source.studentProcess ?? source.process);
    if (!processText) return false;
    const explicitAnswer = /^\s*(?:答(?!题)|答案|最终答案)\s*[：:]?/u.test(processText);
    const answerTitle = /^(?:作答|最终作答|答案|最终答案)$/u.test(title);
    return explicitAnswer || answerTitle;
}
function directStepOutline(draft) {
    return (Array.isArray(draft?.questions) ? draft.questions : []).map((question, qIndex) => ({
        questionIndex: qIndex + 1,
        stepCount: Array.isArray(question?.steps) ? question.steps.length : 0,
        stepTitles: (Array.isArray(question?.steps) ? question.steps : []).map((step) => directString(step?.stepTitle)).filter(Boolean).slice(0, 12)
    }));
}
function directConfidence(value, fallback = 0.8) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; }
function directComparableEvidenceText(value) {
    return directString(value).replace(/[\s，,。；;：:]/gu, '');
}
function directStepIdentityText(step) {
    const source = step && typeof step === 'object' && !Array.isArray(step) ? step : {};
    return [source.solutionText ?? source.studentProcess ?? source.process, source.explanationText ?? source.studentAnalysis ?? source.studentExplanation ?? source.explanation]
        .map(directComparableEvidenceText).filter(Boolean).join('|');
}
function directEnum(value, allowed, fallback) { const normalized = String(value || '').trim().toLowerCase(); return allowed.has(normalized) ? normalized : fallback; }
function directExplanationStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'partial') return 'partially_clear';
    if (normalized === 'wrong') return 'incorrect';
    return DIRECT_EXPLANATION_VERDICTS.has(normalized) ? normalized : '';
}
function directLogicStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'correct') return 'clear';
    return DIRECT_LOGIC_VERDICTS.has(normalized) ? normalized : '';
}
function assertHardProblemDirectText(value, fieldPath) {
    const text = typeof value === 'string' ? value : '';
    if (text.includes('\uFFFD') || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(text)) {
        throw Object.assign(new Error('难题直读结果包含损坏文本'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath });
    }
    return text.trim();
}
function hardProblemDirectStepFullyClear(step) {
    return step?.solutionStatus === 'correct' && step?.explanationStatus === 'clear' && step?.logicStatus === 'clear';
}
function hardProblemDirectStepCorrection(step) {
    if (hardProblemDirectStepFullyClear(step)) return '';
    if (step?.solutionStatus === 'missing') return '请补写这一处对应的解题过程。';
    if (step?.solutionStatus === 'unreadable') return '请把这一处解题过程写清楚或重新拍摄。';
    if (step?.solutionStatus === 'wrong') return '请根据本步分析订正解题过程。';
    if (step?.explanationStatus === 'missing') return '请补充说明这一步为什么这样计算。';
    if (step?.explanationStatus === 'unreadable') return '请把这一处讲解写清楚或重新拍摄。';
    if (step?.explanationStatus === 'partially_clear') return '请补充完整说明这一步使用该方法的原因。';
    if (step?.explanationStatus === 'incorrect') return '请订正这一步的讲解，使它与题目条件和解题过程一致。';
    if (step?.logicStatus === 'wrong') return '请根据题目条件重新梳理这一步的逻辑。';
    if (step?.logicStatus === 'unreadable') return '请把这一处逻辑说明写清楚或重新拍摄。';
    return '请补充这一步与前后步骤之间的逻辑依据。';
}
function hardProblemDirectAnalysisContradictsStatus(step) {
    const analysis = directString(step?.analysis);
    if (!analysis) return true;
    if (step?.solutionStatus === 'missing' && /(解题过程|计算过程|列式|该步计算).{0,8}(正确|完整|无误)/.test(analysis)) return true;
    if (step?.solutionStatus === 'unreadable' && /(解题过程|计算过程|列式|该步计算).{0,8}(正确|完整|无误)/.test(analysis)) return true;
    if (step?.explanationStatus === 'missing' && /(讲解|解释).{0,8}(清楚|完整|正确)/.test(analysis)) return true;
    if (step?.explanationStatus === 'unreadable' && /(讲解|解释).{0,8}(清楚|完整|正确)/.test(analysis)) return true;
    return false;
}
function hardProblemDirectStepAnalysis(step, index) {
    const issues = [];
    if (step.solutionStatus === 'missing') issues.push('缺少解题过程');
    else if (step.solutionStatus === 'unreadable') issues.push('解题过程无法识别');
    else if (step.solutionStatus === 'wrong') issues.push('解题过程有误');
    if (step.explanationStatus === 'missing') issues.push('缺少对应讲解');
    else if (step.explanationStatus === 'unreadable') issues.push('讲解无法识别');
    else if (step.explanationStatus === 'partially_clear') issues.push('讲解不完整');
    else if (step.explanationStatus === 'incorrect') issues.push('讲解有误');
    if (step.logicStatus === 'insufficient') issues.push('逻辑依据不完整');
    else if (step.logicStatus === 'unreadable') issues.push('逻辑无法识别');
    else if (step.logicStatus === 'wrong') issues.push('逻辑有误');
    return issues.length ? `第${index + 1}步${[...new Set(issues)].join('，')}。` : '该步解题过程、讲解和逻辑均正确。';
}
function normalizeHardProblemDirectStep(step, qIndex, sIndex) {
    const source = step && typeof step === 'object' && !Array.isArray(step) ? step : {};
    const base = `questions[${qIndex}].steps[${sIndex}]`;
    const stepTitle = assertHardProblemDirectText(source.stepTitle ?? source.title, `${base}.stepTitle`);
    const solutionText = assertHardProblemDirectText(source.solutionText ?? source.studentProcess ?? source.process, `${base}.solutionText`);
    const explanationText = assertHardProblemDirectText(source.explanationText ?? source.studentAnalysis ?? source.studentExplanation ?? source.explanation, `${base}.explanationText`);
    let solutionStatus = directEnum(source.solutionStatus ?? source.processVerdict, DIRECT_PROCESS_VERDICTS, '');
    let explanationStatus = directExplanationStatus(source.explanationStatus ?? source.explanationVerdict);
    let logicStatus = directLogicStatus(source.logicStatus ?? source.logicVerdict);
    // Backward-compatible input only: older direct drafts used verdict/issueTarget. New prompts never request them.
    if ((!solutionStatus || !explanationStatus || !logicStatus) && directString(source.verdict)) {
        const verdict = String(source.verdict || '').trim().toLowerCase();
        const target = String(source.issueTarget || '').trim().toLowerCase();
        if (verdict === 'unreadable') {
            solutionStatus = solutionText ? 'unreadable' : 'missing';
            explanationStatus = explanationText ? 'unreadable' : 'missing';
            logicStatus = 'unreadable';
        } else if (verdict === 'correct') {
            solutionStatus = solutionText ? 'correct' : 'missing';
            explanationStatus = explanationText ? 'clear' : 'missing';
            logicStatus = 'clear';
        } else if (verdict === 'partial') {
            solutionStatus = !solutionText ? 'missing' : ['process','both'].includes(target) ? 'wrong' : 'correct';
            explanationStatus = !explanationText ? 'missing' : ['analysis','both'].includes(target) ? 'partially_clear' : 'clear';
            logicStatus = ['analysis','both'].includes(target) ? 'insufficient' : 'clear';
        } else if (verdict === 'wrong') {
            solutionStatus = !solutionText ? 'missing' : target === 'analysis' ? 'correct' : 'wrong';
            explanationStatus = !explanationText ? 'missing' : ['analysis','both'].includes(target) ? 'incorrect' : 'clear';
            logicStatus = 'wrong';
        }
    }
    if (!solutionStatus) throw Object.assign(new Error('难题步骤缺少合法 solutionStatus'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `${base}.solutionStatus` });
    if (!explanationStatus) throw Object.assign(new Error('难题步骤缺少合法 explanationStatus'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `${base}.explanationStatus` });
    if (!logicStatus) throw Object.assign(new Error('难题步骤缺少合法 logicStatus'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `${base}.logicStatus` });
    let analysis = assertHardProblemDirectText(source.analysis ?? source.reason, `${base}.analysis`);
    let correctionAdvice = assertHardProblemDirectText(source.correctionAdvice ?? source.advice, `${base}.correctionAdvice`);
    if (!analysis) throw Object.assign(new Error('难题步骤缺少 analysis'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `${base}.analysis` });
    const semanticStep = { solutionStatus, explanationStatus, logicStatus, analysis, correctionAdvice };
    if (hardProblemDirectStepFullyClear(semanticStep)) correctionAdvice = '';
    else if (!correctionAdvice) correctionAdvice = hardProblemDirectStepCorrection(semanticStep);
    if (hardProblemDirectAnalysisContradictsStatus({ ...semanticStep, correctionAdvice })) analysis = hardProblemDirectStepAnalysis(semanticStep, sIndex);
    return {
        stepTitle, solutionText, explanationText, solutionStatus, explanationStatus, logicStatus, analysis, correctionAdvice,
        // Internal aliases keep old persisted direct drafts readable during the rollout; they never enter hard-problem.v2.
        studentProcess: solutionText, studentExplanation: explanationText, processVerdict: solutionStatus,
        explanationVerdict: explanationStatus === 'partially_clear' ? 'partial' : explanationStatus === 'incorrect' ? 'wrong' : explanationStatus,
        logicVerdict: logicStatus === 'clear' ? 'correct' : logicStatus
    };
}
function normalizeHardProblemDirectDraft(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.questions) || raw.questions.length === 0) {
        throw Object.assign(new Error('难题直读结果缺少 questions'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: 'questions' });
    }
    const questions = raw.questions.map((question, qIndex) => {
        if (!question || typeof question !== 'object' || Array.isArray(question)) throw Object.assign(new Error('难题直读题目必须是对象'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `questions[${qIndex}]` });
        const rawSteps = Array.isArray(question.steps) ? question.steps : Array.isArray(question.stepFeedbacks) ? question.stepFeedbacks : [];
        let studentAnswer = assertHardProblemDirectText(question.studentAnswer, `questions[${qIndex}].studentAnswer`);
        const answerLikeSteps = rawSteps.filter((step) => isHardProblemDirectFinalAnswerStep(step, studentAnswer));
        if (!studentAnswer && answerLikeSteps.length > 0) studentAnswer = directAnswerTextFromStep(answerLikeSteps[0]);
        const sourceSteps = rawSteps.filter((step) => !isHardProblemDirectFinalAnswerStep(step, studentAnswer));
        const steps = sourceSteps.map((step, sIndex) => normalizeHardProblemDirectStep(step, qIndex, sIndex));
        const finalAnswerVerdict = directEnum(question.finalAnswerVerdict, DIRECT_FINAL_VERDICTS, '');
        if (!finalAnswerVerdict) throw Object.assign(new Error('难题直读结果缺少合法 finalAnswerVerdict'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `questions[${qIndex}].finalAnswerVerdict` });
        const overallFeedback = assertHardProblemDirectText(question.overallFeedback, `questions[${qIndex}].overallFeedback`);
        if (!overallFeedback) throw Object.assign(new Error('难题直读结果缺少 overallFeedback'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `questions[${qIndex}].overallFeedback` });
        const questionText = assertHardProblemDirectText(question.questionText, `questions[${qIndex}].questionText`);
        if (!questionText) throw Object.assign(new Error('难题直读结果缺少 questionText'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `questions[${qIndex}].questionText` });
        return {
            questionText, studentAnswer,
            standardAnswer: assertHardProblemDirectText(question.standardAnswer, `questions[${qIndex}].standardAnswer`),
            finalAnswerVerdict, steps, overallFeedback, confidence: directConfidence(question.confidence)
        };
    });
    return { questions };
}
function mergeHardProblemDirectReviewCandidate(primaryDraft, correctedRaw) {
    const primaryQuestions = Array.isArray(primaryDraft?.questions) ? primaryDraft.questions : [];
    const correctedQuestions = Array.isArray(correctedRaw?.questions) ? correctedRaw.questions : [];
    if (primaryQuestions.length > 0 && correctedQuestions.length !== primaryQuestions.length) {
        throw Object.assign(new Error('难题复核 correctedResult.questions 数量必须与 PRIMARY 一致，禁止按位置错配题目'), {
            code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR',
            fieldPath: 'correctedResult.questions',
            expectedQuestionCount: primaryQuestions.length,
            actualQuestionCount: correctedQuestions.length
        });
    }
    const count = primaryQuestions.length || correctedQuestions.length;
    const primaryQuestionIdentities = primaryQuestions.map((item) => directComparableEvidenceText(item?.questionText));
    const questions = [];
    for (let qIndex = 0; qIndex < count; qIndex += 1) {
        const base = primaryQuestions[qIndex] && typeof primaryQuestions[qIndex] === 'object' ? primaryQuestions[qIndex] : {};
        const patch = correctedQuestions[qIndex] && typeof correctedQuestions[qIndex] === 'object' ? correctedQuestions[qIndex] : {};
        const baseIdentity = primaryQuestionIdentities[qIndex];
        const patchIdentity = directComparableEvidenceText(patch.questionText);
        if (patchIdentity && baseIdentity && patchIdentity !== baseIdentity) {
            const otherIndex = primaryQuestionIdentities.findIndex((identity, index) => index !== qIndex && identity && identity === patchIdentity);
            if (otherIndex >= 0) {
                throw Object.assign(new Error('难题复核 correctedResult.questions 顺序与 PRIMARY 不一致，禁止按位置错配题目'), {
                    code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `correctedResult.questions[${qIndex}].questionText`,
                    expectedQuestionIndex: qIndex + 1, matchedPrimaryQuestionIndex: otherIndex + 1
                });
            }
        }
        const baseSteps = Array.isArray(base.steps) ? base.steps : [];
        const patchSteps = Array.isArray(patch.steps) ? patch.steps : Array.isArray(patch.stepFeedbacks) ? patch.stepFeedbacks : null;
        let mergedSteps = baseSteps;
        if (patchSteps) {
            if (patchSteps.length === baseSteps.length) {
                const baseStepIdentities = baseSteps.map(directStepIdentityText);
                for (let index = 0; index < patchSteps.length; index += 1) {
                    const patchStepIdentity = directStepIdentityText(patchSteps[index]);
                    const baseStepIdentity = baseStepIdentities[index];
                    if (!patchStepIdentity || !baseStepIdentity || patchStepIdentity === baseStepIdentity) continue;
                    const otherStepIndex = baseStepIdentities.findIndex((identity, candidateIndex) => candidateIndex !== index && identity && identity === patchStepIdentity);
                    if (otherStepIndex >= 0) {
                        throw Object.assign(new Error('难题复核 correctedResult.steps 顺序与 PRIMARY 不一致，禁止按位置错配步骤'), {
                            code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `correctedResult.questions[${qIndex}].steps[${index}]`,
                            expectedStepIndex: index + 1, matchedPrimaryStepIndex: otherStepIndex + 1
                        });
                    }
                }
                mergedSteps = patchSteps.map((step, index) => ({ ...baseSteps[index], ...(step && typeof step === 'object' ? step : {}) }));
            } else {
                mergedSteps = patchSteps;
            }
        }
        const mergedQuestion = { ...base, ...patch, steps: mergedSteps };
        for (const field of ['questionText', 'standardAnswer']) {
            if (!directString(patch[field]) && directString(base[field])) mergedQuestion[field] = base[field];
        }
        questions.push(mergedQuestion);
    }
    return { questions };
}
function normalizeHardProblemDirectReview(raw, primaryDraft = null) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw Object.assign(new Error('难题复核结果必须是对象'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: 'review' });
    }
    if (Array.isArray(raw.questions) && raw.questions.length > 0) {
        const merged = primaryDraft ? mergeHardProblemDirectReviewCandidate(primaryDraft, raw) : raw;
        return { reviewDecision: 'correct', reason: 'review_returned_full_result', correctedResult: normalizeHardProblemDirectDraft(merged) };
    }
    const reviewDecision = directEnum(raw.reviewDecision, DIRECT_REVIEW_DECISIONS, '');
    if (!reviewDecision) throw Object.assign(new Error('难题复核结果缺少 reviewDecision'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: 'reviewDecision' });
    const reason = assertHardProblemDirectText(raw.reason, 'reason');
    if (reviewDecision === 'keep') return { reviewDecision, reason, correctedResult: null };
    const correctedRaw = raw.correctedResult ?? raw.result;
    if (!correctedRaw || typeof correctedRaw !== 'object' || Array.isArray(correctedRaw)) {
        throw Object.assign(new Error('难题复核要求纠错时必须返回 correctedResult'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: 'correctedResult' });
    }
    const merged = primaryDraft ? mergeHardProblemDirectReviewCandidate(primaryDraft, correctedRaw) : correctedRaw;
    return { reviewDecision, reason, correctedResult: normalizeHardProblemDirectDraft(merged) };
}
function directReferenceAnswerForQuestion(context = {}, qIndex = 0, questionCount = 1) {
    const references = Array.isArray(context.referenceAnswers) ? context.referenceAnswers : [];
    const indexedReference = directString(references[qIndex]);
    if (indexedReference) return indexedReference;
    if (questionCount === 1 && references.length === 1) {
        const onlyReference = directString(references[0]);
        if (onlyReference) return onlyReference;
    }
    if (questionCount === 1) return directString(context.manualAnswer);
    return '';
}
function directQuestionHasStudentWork(question) {
    if (directString(question?.studentAnswer)) return true;
    const steps = Array.isArray(question?.steps) ? question.steps : Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks : [];
    return steps.some((step) => directString(step?.solutionText ?? step?.studentProcess ?? step?.process) || directString(step?.explanationText ?? step?.studentAnalysis ?? step?.studentExplanation ?? step?.explanation));
}
function directObjectiveAnswerForQuestion(question, qIndex, questionCount, context = {}) {
    const modelAnswer = directString(question?.standardAnswer);
    if (modelAnswer) return modelAnswer;
    const referenceAnswer = directReferenceAnswerForQuestion(context, qIndex, questionCount);
    if (referenceAnswer) return referenceAnswer;
    const verdict = directEnum(question?.finalAnswerVerdict, DIRECT_FINAL_VERDICTS, '');
    if (verdict === 'correct') return directString(question?.studentAnswer);
    return '';
}
function applyHardProblemDirectDeterministicFields(raw, context = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.questions)) return raw;
    const questionCount = raw.questions.length;
    return { ...raw, questions: raw.questions.map((question, qIndex) => {
        if (!question || typeof question !== 'object' || Array.isArray(question)) return question;
        const standardAnswer = directObjectiveAnswerForQuestion(question, qIndex, questionCount, context);
        return standardAnswer && !directString(question.standardAnswer) ? { ...question, standardAnswer } : { ...question };
    }) };
}
function hardProblemDirectRequiredFieldGaps(raw, context = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.questions)) return [];
    const questionCount = raw.questions.length;
    const gaps = [];
    raw.questions.forEach((question, qIndex) => {
        if (!question || typeof question !== 'object' || Array.isArray(question)) return;
        if (!directString(question.questionText)) gaps.push({ questionIndex: qIndex + 1, field: 'questionText' });
        const verdict = directEnum(question.finalAnswerVerdict, DIRECT_FINAL_VERDICTS, '');
        const requiresStandardAnswer = Boolean(verdict) && verdict !== 'unreadable' && directQuestionHasStudentWork(question);
        if (requiresStandardAnswer && !directObjectiveAnswerForQuestion(question, qIndex, questionCount, context)) gaps.push({ questionIndex: qIndex + 1, field: 'standardAnswer' });
    });
    return gaps;
}
async function repairHardProblemDirectRequiredFields(task, raw, runtime, transportAttempt, studentUrls, answerUrls, strategy, executionFence) {
    const context = { manualAnswer: task.manualAnswer, referenceAnswers: task.referenceAnswers };
    let candidate = applyHardProblemDirectDeterministicFields(raw, context);
    const gaps = hardProblemDirectRequiredFieldGaps(candidate, context);
    if (!gaps.length) return candidate;
    const grouped = new Map();
    for (const gap of gaps) {
        if (!grouped.has(gap.questionIndex)) grouped.set(gap.questionIndex, []);
        grouped.get(gap.questionIndex).push(gap.field);
    }
    const repairTargets = [...grouped.entries()].map(([questionIndex, fields]) => ({ questionIndex, fields }));
    const systemPrompt = '你是数学批改结果字段修复器。重新查看原图，只补指定的缺失字段，不修改学生原文、步骤、状态、结论或其他字段。questionText 必须忠实抄写可见题目；standardAnswer 必须是客观正确答案或标准解答，不能照抄错误的学生答案。看不清时不要猜。只输出 JSON。';
    const userPrompt = `需要补齐的字段：${JSON.stringify(repairTargets)}。\n当前第一次批改结果：${JSON.stringify(candidate)}\n返回 {"questions":[{"questionIndex":1,"questionText":"仅在被要求时填写","standardAnswer":"仅在被要求时填写"}]}。只返回被要求的非空字段；questionIndex 从1开始且必须对应原题顺序。`;
    const repaired = await (0, ark_1.callArk)({
        taskId: task._id, tier: runtime.modelTier, logicalPass: 1, transportAttempt, stage: task.currentStage, requestStage: 'hardProblemPrimary',
        outputSchemaVersion: null, structuredOutputMode: runtime.structuredOutputMode, mode: 'hard_problem_direct_required_field_repair',
        provider: hardProblemModelProvider(task), imageUrls: [...studentUrls, ...answerUrls], systemPrompt, userPrompt, temperature: 0,
        maxOutputTokens: Math.min(Number(runtime.maxOutputTokens || 14000), 2500), timeoutMs: runtime.timeoutMs, maxRepairAttempts: 0, disableModelOutputRepair: true, strategy
    });
    await assertFence(task._id, executionFence);
    if (!repaired || typeof repaired !== 'object' || Array.isArray(repaired) || !Array.isArray(repaired.questions)) {
        throw Object.assign(new Error('难题直读必填字段修复结果格式无效'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: gaps[0]?.field || 'questions' });
    }
    const nextQuestions = candidate.questions.map((question) => ({ ...question }));
    const seen = new Set();
    for (const patch of repaired.questions) {
        const questionIndex = Number(patch?.questionIndex);
        if (!Number.isInteger(questionIndex) || questionIndex < 1 || questionIndex > nextQuestions.length || seen.has(questionIndex)) {
            throw Object.assign(new Error('难题直读必填字段修复题号无效'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: 'questions[].questionIndex' });
        }
        seen.add(questionIndex);
        const requested = new Set(grouped.get(questionIndex) || []);
        for (const field of requested) {
            const value = assertHardProblemDirectText(patch?.[field], `questions[${questionIndex - 1}].${field}`);
            if (!value) throw Object.assign(new Error(`难题直读必填字段修复仍为空: ${field}`), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `questions[${questionIndex - 1}].${field}` });
            nextQuestions[questionIndex - 1][field] = value;
        }
    }
    candidate = applyHardProblemDirectDeterministicFields({ ...candidate, questions: nextQuestions }, context);
    const remaining = hardProblemDirectRequiredFieldGaps(candidate, context);
    if (remaining.length) throw Object.assign(new Error('难题直读必填字段修复不完整'), { code: 'HARD_PROBLEM_DIRECT_SCHEMA_ERROR', fieldPath: `questions[${remaining[0].questionIndex - 1}].${remaining[0].field}` });
    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_REQUIRED_FIELDS_REPAIRED', { taskId: task._id, fields: gaps.map((gap) => `questions[${gap.questionIndex - 1}].${gap.field}`) }, true);
    return candidate;
}

function directStepFullyCorrect(step) {
    return step.solutionStatus === 'correct' && step.explanationStatus === 'clear' && step.logicStatus === 'clear';
}
function adaptHardProblemDirectDraft(draft, strategy, context = {}) {
    const questions = draft.questions.map((q, qIndex) => {
        const studentWorkDetected = Boolean(q.studentAnswer || q.steps.some((s) => s.solutionText || s.explanationText));
        const stepRequired = q.steps.length > 0;
        const answerStatus = !studentWorkDetected ? 'unanswered' : q.finalAnswerVerdict === 'unreadable' ? 'unreadable' : 'answered';
        const finalAnswerCorrect = answerStatus === 'answered' ? q.finalAnswerVerdict === 'correct' : null;
        const stepFeedbacks = realignHardProblemExplanations(q.steps.map((step, sIndex) => ({
            stepIndex: sIndex + 1,
            solutionText: step.solutionText,
            explanationText: step.explanationText,
            solutionStatus: step.solutionStatus,
            explanationStatus: step.explanationStatus,
            logicStatus: step.logicStatus,
            analysis: step.analysis,
            correctionAdvice: step.correctionAdvice
        }))).map(normalizeHardProblemTeachingStep);
        const aggregateState = deriveHardProblemAggregateState({ answerStatus, stepRequired }, stepFeedbacks);
        const stepStatus = aggregateState.stepStatus;
        const logicStatus = aggregateState.logicStatus;
        const categories = new Set();
        if (answerStatus === 'answered' && finalAnswerCorrect === false) categories.add('answer_error');
        for (const step of stepFeedbacks) {
            if (step.solutionStatus === 'wrong') categories.add('method_error');
            if (step.logicStatus === 'wrong' || step.logicStatus === 'insufficient' || ['incorrect','partially_clear','missing'].includes(step.explanationStatus)) categories.add('logic_error');
        }
        const provisionalErrorType = answerStatus === 'unanswered' ? 'unanswered' : answerStatus === 'unreadable' ? 'unreadable' : categories.size === 0 ? 'none' : categories.size === 1 ? [...categories][0] : 'multiple';
        let errorType = deriveHardProblemErrorType({ answerStatus, finalAnswerCorrect, stepRequired, errorType: provisionalErrorType }, stepFeedbacks, stepStatus, logicStatus);
        const problemSteps = stepFeedbacks.map((step, index) => ({ step, index })).filter(({ step }) => !directStepFullyCorrect(step));
        const affected = problemSteps.map(({ step, index }) => `第${index + 1}步：${step.analysis || step.correctionAdvice || '需要进一步核对'}`);
        const reasons = problemSteps.map(({ step, index }) => `第${index + 1}步：${step.analysis || '存在问题'}`);
        const suggestions = problemSteps.map(({ step, index }) => `第${index + 1}步：${step.correctionAdvice || '请根据本步反馈补充或订正'}`);
        if (answerStatus === 'answered' && finalAnswerCorrect === false) {
            affected.push('最终答案：需要订正');
            reasons.push(q.studentAnswer ? '最终答案不正确。' : '缺少最终答案。');
            suggestions.push('请根据前面正确过程重新写出最终答案。');
        }
        const firstWrongStep = affected.join('；');
        const errorReason = reasons.join('；');
        const adjustmentSuggestion = suggestions.join('；');
        const fullyCorrect = answerStatus === 'answered' && finalAnswerCorrect === true && stepStatus === 'correct' && logicStatus === 'correct';
        if (fullyCorrect) errorType = 'none';
        const standardAnswer = directObjectiveAnswerForQuestion(q, qIndex, draft.questions.length, context);
        const studentImageCount = Math.max(1, Number(context.studentImageCount || 1));
        const sourceKey = studentImageCount === 1 ? `image-1-question-${qIndex + 1}` : `image-set-${studentImageCount}-question-${qIndex + 1}`;
        const sourceRegion = studentImageCount === 1 ? `image-1:question-${qIndex + 1}` : `images-1-${studentImageCount}:question-${qIndex + 1}`;
        const hasExplanationGap = stepFeedbacks.some((step) => step.explanationStatus !== 'clear');
        const staleExplanationGapFeedback = fullyCorrect && !hasExplanationGap && /(讲解|解释).{0,8}(可补充|需补充|需要补充|不完整|不够完整|依据不足)/.test(String(q.overallFeedback || ''));
        return {
            outputSchemaVersion: 'hard-problem.v2', sourceKey, questionText: q.questionText,
            studentAnswer: q.studentAnswer, standardAnswer, answerStatus, finalAnswerCorrect,
            stepRequired, stepStatus, logicStatus, errorType,
            firstWrongStep: fullyCorrect ? '' : firstWrongStep, errorReason: fullyCorrect ? '' : errorReason,
            adjustmentSuggestion: fullyCorrect ? '' : adjustmentSuggestion, knowledgePoint: '', stepFeedbacks,
            overallFeedback: staleExplanationGapFeedback ? '最终答案、解题过程、讲解和数学逻辑均正确。' : q.overallFeedback,
            confidence: q.confidence, studentWorkDetected, sourceQuestionLabel: `第${qIndex + 1}题`, sourceRegion,
            inputBasis: studentWorkDetected ? 'printed_question_with_work' : 'printed_question_without_work', modeApplicability: q.questionText ? 'applicable' : 'uncertain'
        };
    });
    const result = {
        outputSchemaVersion: 'hard-problem.v2', mode: 'hard-problem',
        route: { difficulty: 'normal', confidence: directConfidence(questions.reduce((sum, q) => sum + Number(q.confidence || 0), 0) / Math.max(1, questions.length)), flags: [] },
        imageQuality: { ok: !questions.some((q) => q.answerStatus === 'unreadable'), issues: [] },
        questionSetAudit: { visibleIndependentQuestionCount: questions.length, emittedQuestionCount: questions.length, excludedQuestionCount: 0, orientation: 'uncertain', countConfidence: directConfidence(questions.reduce((sum, q) => sum + Number(q.confidence || 0), 0) / Math.max(1, questions.length)) },
        questions
    };
    return validateHardProblemGradeResult(result, strategy, { directHardProblemOutput: true, requestStage: 'hardProblemDirectAdapter' });
}
function directDraftFromBusiness(result) {
    return { questions: (Array.isArray(result?.questions) ? result.questions : []).map((q) => ({
        questionText: directString(q.questionText), studentAnswer: directString(q.studentAnswer), standardAnswer: directString(q.standardAnswer),
        finalAnswerVerdict: q.answerStatus === 'unreadable' ? 'unreadable' : q.answerStatus === 'unanswered' ? 'missing' : q.finalAnswerCorrect === true ? 'correct' : 'wrong',
        steps: (Array.isArray(q.stepFeedbacks) ? q.stepFeedbacks : []).map((s) => ({
            stepTitle: '', solutionText: directString(s.solutionText), explanationText: directString(s.explanationText),
            solutionStatus: directEnum(s.solutionStatus, DIRECT_PROCESS_VERDICTS, 'unreadable'),
            explanationStatus: directExplanationStatus(s.explanationStatus) || 'unreadable',
            logicStatus: directLogicStatus(s.logicStatus) || 'unreadable',
            analysis: directString(s.analysis), correctionAdvice: directString(s.correctionAdvice)
        })),
        overallFeedback: directString(q.overallFeedback), confidence: directConfidence(q.confidence)
    })) };
}
function buildHardProblemDirectDiagnostic(result) {
    const questions = Array.isArray(result?.questions) ? result.questions : [];
    const evidenceQuestions = [], planQuestions = [], hypothesisQuestions = [], truthQuestions = [], diagnoses = [];
    for (const [qIndex, q] of questions.entries()) {
        const sourceKey = String(q?.sourceKey || `Q${qIndex + 1}`), steps = Array.isArray(q?.stepFeedbacks) ? q.stepFeedbacks : [];
        const processUnits = [], explanationUnits = [], planSteps = [], nodes = [];
        steps.forEach((step, index) => {
            const stepId = `S${index + 1}`;
            if (directString(step?.solutionText)) processUnits.push({ unitId: `P${index + 1}`, studentStepId: stepId, rawText: String(step.solutionText), text: String(step.solutionText), order: index + 1, confidence: Number(q?.confidence || 0.8) });
            if (directString(step?.explanationText)) explanationUnits.push({ unitId: `E${index + 1}`, studentStepId: stepId, rawText: String(step.explanationText), text: String(step.explanationText), order: index + 1, confidence: Number(q?.confidence || 0.8) });
            const purpose = `学生第${index + 1}步`, expectedReasoning = String(step?.analysis || step?.correctionAdvice || '说明这一步为什么成立。'), dependencies = index > 0 ? [`S${index}`] : [];
            planSteps.push({ stepId, nodeId: stepId, order: index + 1, purpose, expectedReasoning, hintScaffold: String(step?.correctionAdvice || ''), dependencies });
            nodes.push({ nodeId: stepId, order: index + 1, purpose, expectedReasoning, hintScaffold: String(step?.correctionAdvice || ''), dependencies });
            const bottleneckType = step?.solutionStatus === 'wrong' ? 'calculation_or_method' : ['incorrect', 'missing', 'partially_clear'].includes(String(step?.explanationStatus || '')) ? 'explanation' : ['wrong', 'insufficient'].includes(String(step?.logicStatus || '')) ? 'logic' : 'none';
            diagnoses.push({ sourceKey, stepId, nodeId: stepId, expectedNodeIds: [stepId], stepIndex: index + 1, purpose, dependencies, dependents: index + 1 < steps.length ? [`S${index + 2}`] : [], satisfactionStatus: step?.solutionStatus === 'missing' ? 'missing' : 'covered', processStatus: String(step?.solutionStatus || 'unreadable'), explanationStatus: String(step?.explanationStatus || 'unreadable'), logicStatus: String(step?.logicStatus || 'unreadable'), bottleneckType, feedback: String(step?.analysis || ''), correctionAdvice: String(step?.correctionAdvice || ''), confidence: Number(q?.confidence || 0.8) });
        });
        evidenceQuestions.push({ sourceKey, questionText: String(q?.questionText || ''), studentAnswer: String(q?.studentAnswer || ''), studentWorkDetected: q?.studentWorkDetected !== false, verificationState: 'direct_reviewed', evidenceQuality: Number(q?.confidence || 0.8), processUnits, explanationUnits });
        planQuestions.push({ sourceKey, selectedHypothesisId: 'DIRECT', steps: planSteps });
        hypothesisQuestions.push({ sourceKey, hypotheses: [{ hypothesisId: 'DIRECT', methodFamily: 'student_written', confidence: Number(q?.confidence || 0.8), nodes }] });
        truthQuestions.push({ sourceKey, accepted: Boolean(directString(q?.standardAnswer)), questionConsistent: true, referenceAnswerConsistent: true, canonicalAnswerSummary: String(q?.standardAnswer || ''), confidence: Number(q?.confidence || 0.8) });
    }
    const problematic = diagnoses.filter((d) => d.bottleneckType !== 'none'), active = problematic[0] || null;
    const snapshot = { version: 'hard-problem-frontend-contract.v10.8.2', kind: 'DiagnosticSnapshot', evidence: { questions: evidenceQuestions }, problemTruth: { questions: truthQuestions }, reasoningHypotheses: { questions: hypothesisQuestions }, plan: { questions: planQuestions }, diagnoses, causalBottleneckCandidate: active ? { sourceKey: active.sourceKey, stepId: active.stepId, nodeId: active.nodeId, bottleneckType: active.bottleneckType, purpose: active.purpose, dependencies: active.dependencies, causalScore: 10 } : null, activeBottleneckCandidate: active ? { sourceKey: active.sourceKey, stepId: active.stepId, bottleneckType: active.bottleneckType, purpose: active.purpose } : null, consistencyStatus: 'ok', consistencyIssues: [], createdAt: new Date().toISOString() };
    return { ...snapshot, snapshotId: hardProblemV10.sha({ version: snapshot.version, questions: questions.map((q) => ({ sourceKey: q.sourceKey, stepFeedbacks: q.stepFeedbacks, standardAnswer: q.standardAnswer })) }) };
}

function usesHardProblemV10(strategy) {
    if (usesHardProblemDirect(strategy)) return false;
    const required = ['hardProblemEvidenceV10', 'hardProblemEvidenceVerifyV10', 'hardProblemTruthV10', 'hardProblemMethodV10', 'hardProblemHypothesesV10', 'hardProblemHypothesisAuditV10', 'hardProblemCoverageV10', 'hardProblemAdversarialJudgeV10'];
    return required.every((key) => Boolean(strategy?.prompts?.[key]?.system && strategy?.prompts?.[key]?.userTemplate));
}
function v10Prompt(strategy, key, variables) {
    if (typeof strategyRender.hardProblemV9UserPrompt === 'function') return strategyRender.hardProblemV9UserPrompt(strategy, key, variables);
    const template = String(strategy?.prompts?.[key]?.userTemplate || '');
    return Object.entries(variables || {}).reduce((out, [name, value]) => out.split(`{{${name}}}`).join(typeof value === 'string' ? value : JSON.stringify(value)), template);
}
function hardProblemV10TokenBudget(requestStage, runtime) {
    const caps = {
        hardProblemEvidenceV10: 7000,
        hardProblemEvidenceVerifyV10: 7000,
        hardProblemTruthV10: 3500,
        hardProblemMethodV10: 1800,
        hardProblemHypothesesV10: 7000,
        hardProblemHypothesisAuditV10: 3000,
        hardProblemCoverageV10: 6500,
        hardProblemAdversarialJudgeV10: 3500
    };
    return Math.min(Number(runtime.maxOutputTokens || 12000), caps[requestStage] || 5000);
}
async function callHardProblemV10(task, strategy, runtime, transportAttempt, requestStage, promptKey, payload, imageUrls = [], logicalPass = 1, providerOverride = null) {
    return await (0, ark_1.callArk)({
        taskId: task._id,
        tier: runtime.modelTier,
        logicalPass,
        transportAttempt,
        stage: task.currentStage,
        requestStage,
        outputSchemaVersion: null,
        structuredOutputMode: runtime.structuredOutputMode,
        mode: requestStage,
        provider: providerOverride || hardProblemModelProvider(task),
        imageUrls,
        systemPrompt: strategy.prompts[promptKey].system,
        userPrompt: v10Prompt(strategy, promptKey, payload),
        temperature: Math.min(Number(runtime.temperature || 0.2), 0.15),
        maxOutputTokens: hardProblemV10TokenBudget(requestStage, runtime),
        timeoutMs: runtime.timeoutMs,
        maxRepairAttempts: 0,
        strategy
    });
}
function buildHardProblemV10UnreadableEvidence(task, imageCount, reason) {
    return hardProblemV10.normalizeEvidenceLedger({
        questions: Array.from({ length: Math.max(1, Number(imageCount) || 1) }, (_, index) => ({
            sourceKey: `image-${index + 1}-question-1`,
            questionText: '题目内容暂无法可靠识别',
            studentAnswer: '',
            studentWorkDetected: false,
            sourceQuestionLabel: `图片${index + 1}`,
            sourceRegion: `image-${index + 1}:unreadable`,
            inputBasis: 'printed_question_without_work',
            processUnits: [], explanationUnits: [], evidenceQuality: 0,
            verificationState: 'failed', warnings: [`EVIDENCE_ACQUISITION_FAILED:${String(reason || '').slice(0, 80)}`]
        }))
    });
}
function conservativeHardProblemV10Truth(evidence, reason) {
    return hardProblemV10.normalizeProblemTruth({ questions: evidence.questions.map((q) => ({
        sourceKey: q.sourceKey, accepted: false, questionText: q.questionText, referenceAnswerConsistent: false,
        canonicalAnswerSummary: '', confidence: 0.20, issues: [`TRUTH_SAFE_REFUSAL:${String(reason || '').slice(0, 80)}`]
    })) }, evidence);
}
function conservativeHardProblemV10Hypotheses(evidence, problemTruth, method, reason) {
    const truth = problemTruth.questions.map((q) => ({ ...q, accepted: true, confidence: Math.max(0.20, Number(q.confidence || 0.20)) }));
    const safeTruth = hardProblemV10.normalizeProblemTruth({ questions: truth }, evidence);
    return hardProblemV10.normalizeReasoningHypotheses({ questions: evidence.questions.map((q) => ({
        sourceKey: q.sourceKey,
        hypotheses: [{ hypothesisId: 'H_SAFE', methodFamily: 'unknown', label: '保守复核路径', confidence: 0.20,
            nodes: [{ nodeId: 'N1', order: 1, purpose: '完整说明本题解题思路', expectedReasoning: '根据题目说明所用数量关系、公式或推理依据，并给出完整作答。', hintScaffold: '回到题目条件，指出当前目标直接依赖的数量关系、定义或公式方向，不要完成后续推导。', dependencies: [] }],
            warnings: [`HYPOTHESIS_SAFE_REFUSAL:${String(reason || '').slice(0, 80)}`] }],
        confidence: 0.20, warnings: [`HYPOTHESIS_SAFE_REFUSAL:${String(reason || '').slice(0, 80)}`]
    })) }, evidence, safeTruth, method);
}
function conservativeHardProblemV10Coverage(evidence, hypotheses, reason) {
    return hardProblemV10.normalizeTypedCoverage({ questions: evidence.questions.map((q) => {
        const hq = hypotheses.questions.find((x) => x.sourceKey === q.sourceKey);
        const h = hq?.hypotheses?.[0]; const nodeId = h?.nodes?.[0]?.nodeId || 'N1';
        return { sourceKey: q.sourceKey, selectedHypothesisId: h?.hypothesisId || 'H_SAFE',
            edges: [...q.processUnits, ...q.explanationUnits].map((unit) => ({ nodeId, evidenceId: unit.unitId, relation: 'partial_support', supportRole: 'preserved_source', confidence: Math.max(0.45, Number(unit.confidence || 0.45)) })),
            confidence: 0.20, warnings: [`COVERAGE_SAFE_REFUSAL:${String(reason || '').slice(0, 80)}`] };
    }) }, evidence, hypotheses, null);
}
function hardProblemV10SafeIssueProfile(diagnostic, sourceKey = '') {
    const issues = Array.isArray(diagnostic?.consistencyIssues) ? diagnostic.consistencyIssues.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const scoped = sourceKey ? issues.filter((issue) => !issue.includes(':') || issue.includes(sourceKey)) : issues;
    const evidenceRisk = scoped.some((issue) => /^(EVIDENCE_QUALITY_INSUFFICIENT|EVIDENCE_VERIFICATION_CONFLICT|WORK_DETECTION_CONFLICT)/.test(issue));
    const pipelineRisk = scoped.some((issue) => /^(REVIEW_PIPELINE_|FINAL_CONTRACT_|ADVERSARIAL_JUDGMENT_REJECTED|ADVERSARIAL_BLOCK|HYPOTHESIS_AUDIT_REJECTED|SELECTED_HYPOTHESIS_NOT_AUDITED|COVERAGE_CONFIDENCE_INSUFFICIENT|STUDENT_EVIDENCE_UNMAPPED|PROBLEM_TRUTH_REJECTED)/.test(issue));
    return {
        issues: scoped,
        evidenceRisk,
        pipelineRisk,
        message: evidenceRisk
            ? '已识别到你的作答，但部分原图证据清晰度或核验结果存在冲突。系统已保留可见的逐步原文，暂不判断对错。'
            : '已识别到你的作答和逐步过程，但系统复核链之间存在冲突。系统已保留每一步学生原文，暂不输出可能错误的数学判断。',
        suggestion: evidenceRisk
            ? '请重新拍摄清晰、完整、无反光的题目与作答图片；系统会继续按原步骤逐步复核。'
            : '请先核对下方保留的逐步原文；可以重新提交本题或由教师复核，不需要因为系统复核冲突而重写已经清晰的步骤。'
    };
}
function hardProblemV10UnitText(unit) {
    return String(unit?.rawText || unit?.text || '').trim();
}
function hardProblemV10VisibleFragments(unit) {
    const raw = hardProblemV10UnitText(unit);
    if (!raw) return [];
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [{ text: raw, visualBand: Number.isFinite(Number(unit?.visualBand)) ? Number(unit.visualBand) : null, unitId: String(unit?.unitId || '') }];
    const mathLike = lines.filter((line) => /(?:=|＋|\+|－|-|×|÷|\/|答[:：]?|设.+为|解[:：]?)/.test(line)).length;
    if (mathLike < 2) return [{ text: raw, visualBand: Number.isFinite(Number(unit?.visualBand)) ? Number(unit.visualBand) : null, unitId: String(unit?.unitId || '') }];
    return lines.map((line, index) => ({ text: line, visualBand: Number.isFinite(Number(unit?.visualBand)) ? Number(unit.visualBand) : null, unitId: `${String(unit?.unitId || '')}#${index + 1}` }));
}
function buildHardProblemV10EvidenceSafeSteps(evidenceQuestion, alignedQuestion, reviewedQuestion, message, suggestion) {
    const canonical = hardProblemV10.buildCanonicalStudentSteps(evidenceQuestion || {});
    const reviewedSteps = Array.isArray(reviewedQuestion?.stepFeedbacks) ? reviewedQuestion.stepFeedbacks : [];
    const alignedSteps = Array.isArray(alignedQuestion?.pairedSteps) ? alignedQuestion.pairedSteps : [];
    return canonical.studentSteps.map((studentStep, index) => {
        const aligned = alignedSteps[index] || null;
        const reviewed = reviewedSteps[index] || null;
        const solutionText = String(studentStep?.solutionText || aligned?.solutionText || reviewed?.solutionText || '').trim();
        const explanationText = String(studentStep?.explanationText || aligned?.explanationText || reviewed?.explanationText || '').trim();
        return {
            stepIndex: index + 1,
            solutionText,
            explanationText,
            solutionStatus: solutionText ? 'unreadable' : 'missing',
            explanationStatus: explanationText ? 'unreadable' : 'missing',
            logicStatus: solutionText || explanationText ? 'unreadable' : 'insufficient',
            analysis: message,
            correctionAdvice: suggestion
        };
    });
}

function hardProblemV10FatalIssuesForSource(diagnostic, sourceKey, allSourceKeys = []) {
    const declared = Array.isArray(diagnostic?.consistencyFatalIssues) ? diagnostic.consistencyFatalIssues : [];
    const fallback = Array.isArray(diagnostic?.consistencyIssues) ? diagnostic.consistencyIssues.filter((issue) => /^(WORK_DETECTION_CONFLICT|EVIDENCE_VERIFICATION_CONFLICT|EVIDENCE_QUALITY_INSUFFICIENT|PROBLEM_TRUTH_REJECTED|ADVERSARIAL_BLOCK)/.test(String(issue || ''))) : [];
    const fatal = (declared.length ? declared : fallback).map((item) => String(item || '').trim()).filter(Boolean);
    return fatal.filter((issue) => {
        if (issue.includes(`:${sourceKey}`)) return true;
        const scopedToOtherQuestion = allSourceKeys.some((key) => key && key !== sourceKey && issue.includes(`:${key}`));
        return !scopedToOtherQuestion;
    });
}
function buildHardProblemV10SafeRefusalResult(diagnostic, reviewed, strategy, alignment = null) {
    const reviewedByKey = new Map((Array.isArray(reviewed?.questions) ? reviewed.questions : []).map((q) => [String(q?.sourceKey || ''), q]));
    const alignedByKey = new Map((Array.isArray(alignment?.questions) ? alignment.questions : []).map((q) => [String(q?.sourceKey || ''), q]));
    const truthByKey = new Map((Array.isArray(diagnostic?.problemTruth?.questions) ? diagnostic.problemTruth.questions : []).map((q) => [String(q?.sourceKey || ''), q]));
    const evidenceQuestions = Array.isArray(diagnostic?.evidence?.questions) ? diagnostic.evidence.questions : [];
    const allSourceKeys = evidenceQuestions.map((q, index) => String(q?.sourceKey || `Q${index + 1}`));
    const questions = evidenceQuestions.map((eq, index) => {
        const sourceKey = String(eq.sourceKey || `Q${index + 1}`);
        const rq = reviewedByKey.get(sourceKey) || {};
        const aq = alignedByKey.get(sourceKey) || null;
        const tq = truthByKey.get(sourceKey) || {};
        const truthReliable = tq.accepted === true && tq.questionConsistent !== false && tq.referenceAnswerConsistent !== false;
        const standardAnswer = String(rq.standardAnswer || (truthReliable ? tq.canonicalAnswerSummary : '') || '').trim();
        const fatalIssues = hardProblemV10FatalIssuesForSource(diagnostic, sourceKey, allSourceKeys);
        // A fatal issue in one question must never erase trusted judgments from another question.
        // Keep the already validated fixed-step review byte-for-byte in business semantics, only filling a
        // trusted standard answer when the review omitted it.
        const reviewedReady = rq?.outputSchemaVersion === 'hard-problem.v2'
            && String(rq?.sourceKey || '').trim() === sourceKey
            && ['answered', 'unanswered', 'unreadable'].includes(String(rq?.answerStatus || ''))
            && Array.isArray(rq?.stepFeedbacks);
        if (fatalIssues.length === 0 && reviewedReady) {
            return { ...rq, standardAnswer: String(rq.standardAnswer || standardAnswer || '').trim() };
        }
        const profile = hardProblemV10SafeIssueProfile({ ...diagnostic, consistencyIssues: fatalIssues.length ? fatalIssues : diagnostic?.consistencyIssues }, sourceKey);
        const hasWork = eq.studentWorkDetected === true;
        const stepFeedbacks = buildHardProblemV10EvidenceSafeSteps(eq, aq, rq, profile.message, profile.suggestion);
        return {
            outputSchemaVersion: 'hard-problem.v2',
            sourceKey,
            questionText: String(eq.questionText || rq.questionText || '题目内容暂无法可靠判断'),
            studentAnswer: String(eq.studentAnswer || rq.studentAnswer || ''),
            standardAnswer,
            answerStatus: hasWork ? 'unreadable' : 'unanswered',
            finalAnswerCorrect: null,
            stepRequired: true,
            stepStatus: hasWork ? 'unreadable' : 'missing',
            logicStatus: hasWork ? 'unreadable' : 'insufficient',
            errorType: hasWork ? 'unreadable' : 'unanswered',
            firstWrongStep: '',
            errorReason: hasWork ? profile.message : '未检测到学生作答。',
            adjustmentSuggestion: hasWork ? profile.suggestion : '请写出答案，并尽量补充每一步解题过程和对应讲解。',
            knowledgePoint: '',
            stepFeedbacks,
            overallFeedback: hasWork ? profile.message : '本题未检测到学生作答。',
            confidence: 0,
            studentWorkDetected: hasWork,
            sourceQuestionLabel: String(eq.sourceQuestionLabel || rq.sourceQuestionLabel || `第${index + 1}题`),
            sourceRegion: String(eq.sourceRegion || rq.sourceRegion || ''),
            inputBasis: ['printed_question_with_work', 'printed_question_without_work', 'work_only_complete', 'work_only_incomplete'].includes(String(eq.inputBasis || ''))
                ? String(eq.inputBasis)
                : (eq.questionText ? (hasWork ? 'printed_question_with_work' : 'printed_question_without_work') : (hasWork ? 'work_only_incomplete' : 'printed_question_without_work')),
            modeApplicability: hasWork ? 'uncertain' : 'applicable'
        };
    });
    const issues = Array.isArray(diagnostic?.consistencyIssues) ? diagnostic.consistencyIssues : [];
    const imageEvidenceRisk = issues.some((issue) => /^(EVIDENCE_QUALITY_INSUFFICIENT|EVIDENCE_VERIFICATION_CONFLICT|WORK_DETECTION_CONFLICT)/.test(String(issue || '')));
    const raw = {
        outputSchemaVersion: 'hard-problem.v2',
        mode: 'hard-problem',
        route: { difficulty: 'hard', confidence: 0, flags: ['V10_SAFE_REFUSAL', 'V10_SOURCE_PRESERVED_STEPS'] },
        imageQuality: { ok: !imageEvidenceRisk, issues: imageEvidenceRisk ? ['v10_evidence_quality_blocked'] : [] },
        questionSetAudit: {
            visibleIndependentQuestionCount: questions.length,
            emittedQuestionCount: questions.length,
            excludedQuestionCount: 0,
            orientation: 'uncertain',
            countConfidence: 0
        },
        validationWarnings: ['HARD_PROBLEM_V10_SAFE_REFUSAL', 'HARD_PROBLEM_V10_SAFE_REFUSAL_STEPS_PRESERVED', ...issues],
        questions,
        _modelDiagnostics: reviewed?._modelDiagnostics || null
    };
    const normalized = normalizeFixedHardProblemAggregates(raw);
    return validateHardProblemGradeResult(normalized, strategy, { fixedStepReview: true, requestStage: 'hardProblemReview' });
}
function buildHardProblemV10EmergencySafeRefusalResult(diagnostic, strategy) {
    const evidenceQuestions = Array.isArray(diagnostic?.evidence?.questions) ? diagnostic.evidence.questions : [];
    const truthByKey = new Map((Array.isArray(diagnostic?.problemTruth?.questions) ? diagnostic.problemTruth.questions : []).map((q) => [String(q?.sourceKey || ''), q]));
    const questions = (evidenceQuestions.length ? evidenceQuestions : [{ sourceKey: 'Q1', questionText: '题目内容暂无法可靠判断', studentAnswer: '', studentWorkDetected: false, sourceQuestionLabel: '第1题', sourceRegion: '', inputBasis: 'printed_question_without_work' }]).map((eq, index) => {
        const hasWork = eq.studentWorkDetected === true;
        const emergencyMessage = '系统复核链未能形成可靠结论，已保留当前可见学生原文，暂不判断对错。';
        const emergencySuggestion = '请核对下方保留的逐步原文；可以重新提交本题或由教师复核。';
        const stepFeedbacks = hasWork ? buildHardProblemV10EvidenceSafeSteps(eq, null, null, emergencyMessage, emergencySuggestion) : [];
        const tq = truthByKey.get(String(eq.sourceKey || '')) || {};
        const standardAnswer = tq.accepted === true && tq.referenceAnswerConsistent !== false ? String(tq.canonicalAnswerSummary || '').trim() : '';
        return {
            outputSchemaVersion: 'hard-problem.v2',
            sourceKey: String(eq.sourceKey || `Q${index + 1}`),
            questionText: String(eq.questionText || '题目内容暂无法可靠判断'),
            studentAnswer: String(eq.studentAnswer || ''),
            standardAnswer,
            answerStatus: hasWork ? 'unreadable' : 'unanswered',
            finalAnswerCorrect: null,
            stepRequired: true,
            stepStatus: hasWork ? 'unreadable' : 'missing',
            logicStatus: hasWork ? 'unreadable' : 'insufficient',
            errorType: hasWork ? 'unreadable' : 'unanswered',
            firstWrongStep: '',
            errorReason: hasWork ? '系统复核链未能形成可靠结论，已进入最小安全结果。' : '未检测到学生作答。',
            adjustmentSuggestion: hasWork ? '请重新提交本题或由教师复核。系统诊断中仍保留原始证据。' : '请写出答案和必要过程后重新提交。',
            knowledgePoint: '',
            stepFeedbacks,
            overallFeedback: hasWork ? emergencyMessage : '本题未检测到学生作答。',
            confidence: 0,
            studentWorkDetected: hasWork,
            sourceQuestionLabel: String(eq.sourceQuestionLabel || `第${index + 1}题`),
            sourceRegion: String(eq.sourceRegion || ''),
            inputBasis: ['printed_question_with_work', 'printed_question_without_work', 'work_only_complete', 'work_only_incomplete'].includes(String(eq.inputBasis || '')) ? String(eq.inputBasis) : (hasWork ? 'work_only_incomplete' : 'printed_question_without_work'),
            modeApplicability: hasWork ? 'uncertain' : 'applicable'
        };
    });
    const raw = {
        outputSchemaVersion: 'hard-problem.v2',
        mode: 'hard-problem',
        route: { difficulty: 'hard', confidence: 0, flags: ['V10_EMERGENCY_SAFE_REFUSAL'] },
        imageQuality: { ok: false, issues: ['v10_runtime_recovery'] },
        questionSetAudit: { visibleIndependentQuestionCount: questions.length, emittedQuestionCount: questions.length, excludedQuestionCount: 0, orientation: 'uncertain', countConfidence: 0 },
        validationWarnings: ['HARD_PROBLEM_V10_EMERGENCY_SAFE_REFUSAL', ...(Array.isArray(diagnostic?.consistencyIssues) ? diagnostic.consistencyIssues : [])],
        questions
    };
    return validateHardProblemGradeResult(normalizeFixedHardProblemAggregates(raw), strategy, { fixedStepReview: true, requestStage: 'hardProblemReview' });
}
function buildHardProblemV10SafeRefusalNoThrow(diagnostic, reviewed, strategy, alignment = null) {
    try {
        return buildHardProblemV10SafeRefusalResult(diagnostic, reviewed, strategy, alignment);
    } catch (error) {
        const emergency = buildHardProblemV10EmergencySafeRefusalResult(diagnostic, strategy);
        emergency.validationWarnings = [...new Set([...(Array.isArray(emergency.validationWarnings) ? emergency.validationWarnings : []), `SAFE_REFUSAL_PRIMARY_BUILD_FAILED:${String(error?.code || 'UNKNOWN').slice(0, 80)}`])];
        return emergency;
    }
}
function buildHardProblemV10RecoveryDiagnostic(task, draft, error, stage) {
    const diagnostics = hardProblemFailureDiagnostics(error, task, stage);
    const issue = `${stage === STAGES.FINALIZING_RESULT ? 'FINAL_CONTRACT_RECOVERY' : 'REVIEW_PIPELINE_RECOVERY'}:${diagnostics.errorCode || 'UNKNOWN'}${diagnostics.fieldPath ? `:${diagnostics.fieldPath}` : ''}`;
    const base = draft && typeof draft === 'object' ? draft : {};
    const snapshot = {
        version: hardProblemV10.VERSION,
        evidence: base.evidence || { questions: [] },
        problemTruth: base.problemTruth || null,
        method: base.method || null,
        reasoningHypotheses: base.reasoningHypotheses || null,
        hypothesisAudit: base.hypothesisAudit || null,
        coverage: base.coverage || null,
        plan: base.plan || null,
        route: base.route || { path: 'deep', reasons: ['runtime_recovery'] },
        diagnoses: [],
        consistencyStatus: 'blocked',
        consistencyIssues: [issue],
        recoveryDiagnostics: diagnostics,
        createdAt: (0, utils_1.now)()
    };
    return { ...snapshot, snapshotId: hardProblemV10.sha({ taskId: task?._id || '', issue, evidence: snapshot.evidence?.evidenceFingerprint || '' }) };
}

async function gradeHardProblemV10Understanding(task, transportAttempt, studentUrls, answerUrls, strategy, executionFence) {
    await assertFence(task._id, executionFence);
    const runtime = getModelRuntimeStage(strategy, 'hardProblemPrimary');
    let evidence;
    try {
        const perceptionProvider = hardProblemPerceptionProvider(task);
        const rawEvidence = await callHardProblemV10(task, strategy, runtime, transportAttempt, 'hardProblemEvidenceV10', 'hardProblemEvidenceV10', {
            META_JSON: { studentImageCount: studentUrls.length, imageAttachments: studentUrls.map((_, index) => ({ imageIndex: index + 1, purpose: 'student_work', trustBoundary: 'untrusted_student_data' })), passRole: 'visual_perception_draft' }
        }, studentUrls, 1, perceptionProvider);
        evidence = hardProblemV10.normalizeEvidenceLedger(rawEvidence);
        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_PERCEPTION_DRAFT_READY', {
            taskId: task._id,
            provider: perceptionProvider,
            questions: evidence.questions.map((q) => ({ sourceKey: q.sourceKey, processUnitCount: q.processUnits.length, explanationUnitCount: q.explanationUnits.length }))
        }, true);
    } catch (error) {
        const wrapped = Object.assign(new Error('难题 V10 EvidenceLedger 提取失败'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', causeCode: error?.code || 'HARD_PROBLEM_V10_EVIDENCE_INVALID', requestStage: 'hardProblemEvidenceV10', modelProvider: hardProblemPerceptionProvider(task) });
        if (Number(task.hardProblemEvidenceRetryCount || 0) < 1) throw wrapped;
        evidence = buildHardProblemV10UnreadableEvidence(task, studentUrls.length, wrapped.causeCode);
        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_EVIDENCE_SAFE_REFUSAL', { taskId: task._id, causeCode: wrapped.causeCode }, true);
    }
    let verified = false;
    if (hardProblemV10.shouldVerifyEvidence(evidence)) {
        const primaryStructureProvider = hardProblemModelProvider(task);
        const perceptionProvider = hardProblemPerceptionProvider(task);
        const structureProviders = [...new Set([primaryStructureProvider, perceptionProvider])];
        if (structureProviders.length === 1) structureProviders.push(primaryStructureProvider);
        let lastStructureError = null;
        for (let structureAttempt = 1; structureAttempt <= 2 && !verified; structureAttempt += 1) {
            const structureProvider = structureProviders[Math.min(structureAttempt - 1, structureProviders.length - 1)];
            try {
                const verification = await callHardProblemV10(task, strategy, runtime, transportAttempt, 'hardProblemEvidenceVerifyV10', 'hardProblemEvidenceVerifyV10', {
                    EVIDENCE_JSON: { questions: evidence.questions },
                    META_JSON: {
                        passRole: 'student_structure_correction',
                        rule: 'see-original-image-and-correct-first-pass-only',
                        structureAttempt,
                        previousFailure: lastStructureError ? { code: String(lastStructureError?.code || 'VERIFY_FAILED').slice(0, 80), fieldPath: lastStructureError?.fieldPath || null } : null
                    }
                }, studentUrls, structureAttempt, structureProvider);
                evidence = hardProblemV10.applyEvidenceVerification(evidence, verification);
                verified = evidence.questions.every((q) => q.studentWorkDetected !== true || q.verificationState === 'structure_verified');
                if (!verified) throw Object.assign(new Error('StudentStep 结构复核未锁定全部学生作答'), { code: 'HARD_PROBLEM_V10_STRUCTURE_NOT_LOCKED' });
                (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_STUDENT_STRUCTURE_LOCKED', {
                    taskId: task._id,
                    provider: structureProvider,
                    structureAttempt,
                    verified,
                    questions: evidence.questions.map((q) => ({
                        sourceKey: q.sourceKey,
                        studentStepCount: Number(q.studentStepCount || new Set(q.processUnits.map((u) => String(u.studentStepId || ''))).size),
                        processUnitCount: q.processUnits.length,
                        explanationUnitCount: q.explanationUnits.length,
                        structureConfidence: Number(q.structureConfidence ?? q.evidenceQuality ?? 0)
                    }))
                }, true);
            } catch (error) {
                lastStructureError = error;
                (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_EVIDENCE_VERIFY_FAILED', {
                    taskId: task._id,
                    provider: structureProvider,
                    structureAttempt,
                    willRetry: structureAttempt < 2,
                    errorCode: String(error?.code || 'VERIFY_FAILED').slice(0, 80),
                    fieldPath: error?.fieldPath || null
                }, true);
            }
        }
        if (!verified) {
            (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_STRUCTURE_FALLBACK_TO_PERCEPTION_DRAFT', {
                taskId: task._id,
                providersTried: structureProviders.slice(0, 2),
                errorCode: String(lastStructureError?.code || 'VERIFY_FAILED').slice(0, 80),
                questions: evidence.questions.map((q) => ({ sourceKey: q.sourceKey, processUnitCount: q.processUnits.length, explanationUnitCount: q.explanationUnits.length }))
            }, true);
        }
    }
    await assertFence(task._id, executionFence);
    const truthInput = { questions: evidence.questions.map((q) => ({ sourceKey: q.sourceKey, questionText: q.questionText })), manualAnswer: task.manualAnswer || '', referenceAnswers: Array.isArray(task.referenceAnswers) ? task.referenceAnswers : [], answerImageCount: answerUrls.length };
    let problemTruth; let truthFailure = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const rawTruth = await callHardProblemV10(task, strategy, runtime, transportAttempt, 'hardProblemTruthV10', 'hardProblemTruthV10', { INPUT_JSON: { ...truthInput, attempt } }, answerUrls, 1);
            problemTruth = hardProblemV10.normalizeProblemTruth(rawTruth, evidence);
            if (hardProblemV10.problemTruthAccepted(problemTruth)) break;
            truthFailure = 'PROBLEM_TRUTH_REJECTED';
        } catch (error) { truthFailure = String(error?.code || 'PROBLEM_TRUTH_INVALID'); }
    }
    if (!problemTruth || !hardProblemV10.problemTruthAccepted(problemTruth)) {
        problemTruth = problemTruth || conservativeHardProblemV10Truth(evidence, truthFailure || 'PROBLEM_TRUTH_FAILED');
        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_TRUTH_SAFE_REFUSAL', { taskId: task._id, reason: truthFailure || 'PROBLEM_TRUTH_FAILED' }, true);
    }
    const methodInput = { questions: evidence.questions.map((q) => ({ sourceKey: q.sourceKey, questionText: q.questionText, studentExpressionSummary: [...q.processUnits, ...q.explanationUnits].map((u) => u.rawText || u.text).filter(Boolean).join('\n').slice(0, 6000) })) };
    let method;
    try {
        const rawMethod = await callHardProblemV10(task, strategy, runtime, transportAttempt, 'hardProblemMethodV10', 'hardProblemMethodV10', { INPUT_JSON: methodInput }, [], 1);
        method = hardProblemV10.normalizeMethodSignal(rawMethod, evidence.questions.map((q) => q.sourceKey));
    } catch {
        method = hardProblemV10.normalizeMethodSignal({ questions: [] }, evidence.questions.map((q) => q.sourceKey));
    }
    let hypotheses; let hypothesisAudit = { accepted: false, questions: [] }; let hypothesisFailure = '';
    if (hardProblemV10.problemTruthAccepted(problemTruth)) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const rawHypotheses = await callHardProblemV10(task, strategy, runtime, transportAttempt, 'hardProblemHypothesesV10', 'hardProblemHypothesesV10', { INPUT_JSON: { problemTruth, methodSignal: method, manualAnswer: truthInput.manualAnswer, referenceAnswers: truthInput.referenceAnswers, attempt, priorAudit: attempt ? hypothesisAudit : null } }, answerUrls, 1);
                const candidate = hardProblemV10.normalizeReasoningHypotheses(rawHypotheses, evidence, problemTruth, method);
                const rawAudit = await callHardProblemV10(task, strategy, runtime, transportAttempt, 'hardProblemHypothesisAuditV10', 'hardProblemHypothesisAuditV10', { INPUT_JSON: { problemTruth, hypotheses: candidate.questions, manualAnswer: truthInput.manualAnswer, referenceAnswers: truthInput.referenceAnswers } }, answerUrls, 1);
                hypothesisAudit = hardProblemV10.auditReasoningHypotheses(candidate, rawAudit);
                if (hypothesisAudit.accepted) { hypotheses = candidate; break; }
                hypothesisFailure = 'HYPOTHESIS_AUDIT_REJECTED';
            } catch (error) { hypothesisFailure = String(error?.code || 'HYPOTHESIS_INVALID'); }
        }
    } else hypothesisFailure = 'PROBLEM_TRUTH_NOT_ACCEPTED';
    if (!hypotheses) {
        hypotheses = conservativeHardProblemV10Hypotheses(evidence, problemTruth, method, hypothesisFailure || 'HYPOTHESIS_FAILED');
        hypothesisAudit = { accepted: false, questions: hypotheses.questions.map((q) => ({ sourceKey: q.sourceKey, acceptedHypothesisIds: [q.hypotheses[0].hypothesisId], confidence: 0.20, reason: hypothesisFailure || 'HYPOTHESIS_FAILED' })) };
        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_HYPOTHESIS_SAFE_REFUSAL', { taskId: task._id, reason: hypothesisFailure || 'HYPOTHESIS_FAILED' }, true);
    }
    let coverage; let coverageFailure = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const rawCoverage = await callHardProblemV10(task, strategy, runtime, transportAttempt, 'hardProblemCoverageV10', 'hardProblemCoverageV10', { INPUT_JSON: { evidence: { questions: evidence.questions }, problemTruth, methodSignal: method, hypotheses: { questions: hypotheses.questions }, hypothesisAudit, retry: attempt } }, [], 1);
            coverage = hardProblemV10.normalizeTypedCoverage(rawCoverage, evidence, hypotheses, hypothesisAudit);
            break;
        } catch (error) { coverageFailure = String(error?.code || 'COVERAGE_INVALID'); }
    }
    if (!coverage) {
        coverage = conservativeHardProblemV10Coverage(evidence, hypotheses, coverageFailure || 'COVERAGE_FAILED');
        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_COVERAGE_SAFE_REFUSAL', { taskId: task._id, reason: coverageFailure || 'COVERAGE_FAILED' }, true);
    }
    const alignment = hardProblemV10.buildFixedAlignment(evidence, hypotheses, coverage);
    const route = hardProblemV10.routeRisk({ evidence, problemTruth, method, hypotheses, hypothesisAudit, coverage });
    const selectedPlan = hardProblemV10.buildSelectedPlan(hypotheses, coverage);
    const draft = { version: hardProblemV10.VERSION, evidence, problemTruth, method, reasoningHypotheses: hypotheses, hypothesisAudit, coverage, plan: selectedPlan, route, verified, createdAt: (0, utils_1.now)() };
    return { draft, alignment };
}

function usesHardProblemV9(strategy) {
    if (usesHardProblemDirect(strategy)) return false;
    const required = ['hardProblemEvidenceV9', 'hardProblemEvidenceVerify', 'hardProblemMethod', 'hardProblemPlan', 'hardProblemPlanAudit', 'hardProblemCoverage'];
    return required.every((key) => Boolean(strategy?.prompts?.[key]?.system && strategy?.prompts?.[key]?.userTemplate));
}
function v9Prompt(strategy, key, variables) {
    if (typeof strategyRender.hardProblemV9UserPrompt === 'function') return strategyRender.hardProblemV9UserPrompt(strategy, key, variables);
    const template = String(strategy?.prompts?.[key]?.userTemplate || '');
    return Object.entries(variables || {}).reduce((out, [name, value]) => out.split(`{{${name}}}`).join(typeof value === 'string' ? value : JSON.stringify(value)), template);
}
async function callHardProblemV9(task, strategy, runtime, transportAttempt, requestStage, promptKey, payload, imageUrls = [], logicalPass = 1) {
    const result = await (0, ark_1.callArk)({
        taskId: task._id,
        tier: runtime.modelTier,
        logicalPass,
        transportAttempt,
        stage: task.currentStage,
        requestStage,
        outputSchemaVersion: null,
        structuredOutputMode: runtime.structuredOutputMode,
        mode: requestStage,
        provider: hardProblemModelProvider(task),
        imageUrls,
        systemPrompt: strategy.prompts[promptKey].system,
        userPrompt: v9Prompt(strategy, promptKey, payload),
        temperature: Math.min(Number(runtime.temperature || 0.2), 0.2),
        maxOutputTokens: Math.min(Number(runtime.maxOutputTokens || 20000), 12000),
        timeoutMs: runtime.timeoutMs,
        maxRepairAttempts: 0,
        strategy
    });
    return result;
}
function buildHardProblemV9UnreadableEvidence(task, imageCount, reason) {
    return hardProblemV9.normalizeStudentEvidence({
        questions: Array.from({ length: Math.max(1, Number(imageCount) || 1) }, (_, index) => ({
            sourceKey: `image-${index + 1}-question-1`,
            questionText: '题目内容暂无法可靠识别',
            studentAnswer: '',
            studentWorkDetected: false,
            sourceQuestionLabel: `图片${index + 1}`,
            sourceRegion: `image-${index + 1}:unreadable`,
            inputBasis: 'printed_question_without_work',
            processUnits: [], explanationUnits: [], evidenceQuality: 0,
            verificationState: 'failed', warnings: [`EVIDENCE_ACQUISITION_FAILED:${String(reason || '').slice(0, 80)}`]
        }))
    });
}
function conservativeHardProblemV9Plan(evidence, method, reason) {
    return hardProblemV9.normalizePlan({ questions: evidence.questions.map((question) => ({
        sourceKey: question.sourceKey,
        steps: [{ stepId: 'S1', order: 1, purpose: '完整说明本题解题思路', expectedReasoning: '根据题目说明所用数量关系、公式或推理依据，并给出完整作答。', dependencies: [] }],
        confidence: 0.25, warnings: [`PLAN_SAFE_DEGRADE:${String(reason || '').slice(0, 80)}`]
    })) }, evidence, method);
}
function conservativeHardProblemV9Coverage(evidence, plan, reason) {
    return hardProblemV9.normalizeCoverage({ questions: evidence.questions.map((question) => ({
        sourceKey: question.sourceKey,
        edges: [...question.processUnits, ...question.explanationUnits].map((unit) => ({ stepId: plan.questions.find((q) => q.sourceKey === question.sourceKey)?.steps?.[0]?.stepId || 'S1', evidenceId: unit.unitId, supportRole: 'preserved_source', confidence: Math.max(0.5, Number(unit.confidence || 0.5)) })),
        confidence: 0.25, warnings: [`COVERAGE_SAFE_DEGRADE:${String(reason || '').slice(0, 80)}`]
    })) }, evidence, plan);
}
async function gradeHardProblemV9Understanding(task, transportAttempt, studentUrls, answerUrls, strategy, executionFence) {
    await assertFence(task._id, executionFence);
    const runtime = getModelRuntimeStage(strategy, 'hardProblemPrimary');
    let evidence;
    try {
        const rawEvidence = await callHardProblemV9(task, strategy, runtime, transportAttempt, 'hardProblemEvidenceV9', 'hardProblemEvidenceV9', {
            META_JSON: { studentImageCount: studentUrls.length, imageAttachments: studentUrls.map((_, index) => ({ imageIndex: index + 1, purpose: 'student_work' })) }
        }, studentUrls, 1);
        evidence = hardProblemV9.normalizeStudentEvidence(rawEvidence);
    } catch (error) {
        const wrapped = Object.assign(new Error('难题 StudentEvidence 提取失败'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', causeCode: error?.code || 'HARD_PROBLEM_V9_EVIDENCE_INVALID', requestStage: 'hardProblemEvidenceV9', modelProvider: hardProblemModelProvider(task) });
        if (Number(task.hardProblemEvidenceRetryCount || 0) < 1) throw wrapped;
        evidence = buildHardProblemV9UnreadableEvidence(task, studentUrls.length, wrapped.causeCode);
        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V9_EVIDENCE_SAFE_REFUSAL', { taskId: task._id, causeCode: wrapped.causeCode }, true);
    }
    await assertFence(task._id, executionFence);
    if (hardProblemV9.shouldVerifyEvidence(evidence)) {
        try {
            const verification = await callHardProblemV9(task, strategy, runtime, transportAttempt, 'hardProblemEvidenceVerify', 'hardProblemEvidenceVerify', { EVIDENCE_JSON: hardProblemV9.publicDiagnostic ? { questions: evidence.questions } : evidence }, studentUrls, 1);
            evidence = hardProblemV9.applyEvidenceVerification(evidence, verification);
        } catch (error) {
            (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V9_EVIDENCE_VERIFY_SKIPPED', { taskId: task._id, errorCode: String(error?.code || 'VERIFY_FAILED').slice(0, 80) }, true);
        }
    }
    const methodInput = { questions: evidence.questions.map((question) => ({ sourceKey: question.sourceKey, questionText: question.questionText, studentExpressionSummary: [...question.processUnits, ...question.explanationUnits].map((unit) => unit.text).filter(Boolean).join('\n').slice(0, 6000) })) };
    let method;
    try {
        const rawMethod = await callHardProblemV9(task, strategy, runtime, transportAttempt, 'hardProblemMethod', 'hardProblemMethod', { INPUT_JSON: methodInput }, [], 1);
        method = hardProblemV9.normalizeMethodFingerprint(rawMethod, evidence.questions.map((q) => q.sourceKey));
    } catch {
        method = hardProblemV9.normalizeMethodFingerprint({ questions: [] }, evidence.questions.map((q) => q.sourceKey));
    }
    const planInput = { questions: evidence.questions.map((question) => ({ sourceKey: question.sourceKey, questionText: question.questionText, method: method.questions.find((q) => q.sourceKey === question.sourceKey) || null })), manualAnswer: task.manualAnswer || '', referenceAnswers: Array.isArray(task.referenceAnswers) ? task.referenceAnswers : [], answerImageCount: answerUrls.length };
    let plan;
    let planAudit = { accepted: false, rejected: [{ reason: 'not_run' }] };
    let planFailure = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const rawPlan = await callHardProblemV9(task, strategy, runtime, transportAttempt, 'hardProblemPlan', 'hardProblemPlan', { INPUT_JSON: { ...planInput, auditRecovery: attempt ? planAudit.rejected : [] } }, answerUrls, 1);
            const candidate = hardProblemV9.normalizePlan(rawPlan, evidence, method);
            const rawAudit = await callHardProblemV9(task, strategy, runtime, transportAttempt, 'hardProblemPlanAudit', 'hardProblemPlanAudit', { INPUT_JSON: { questions: candidate.questions, referenceAnswers: planInput.referenceAnswers, manualAnswer: planInput.manualAnswer } }, answerUrls, 1);
            planAudit = hardProblemV9.auditPlan(candidate, rawAudit);
            if (planAudit.accepted) { plan = candidate; break; }
            planFailure = 'PLAN_AUDIT_REJECTED';
        } catch (error) { planFailure = String(error?.code || 'PLAN_INVALID'); }
    }
    if (!plan) {
        plan = conservativeHardProblemV9Plan(evidence, method, planFailure || 'PLAN_FAILED');
        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V9_PLAN_SAFE_DEGRADE', { taskId: task._id, reason: planFailure || 'PLAN_FAILED' }, true);
    }
    const coverageInput = { evidence: { questions: evidence.questions }, plan: { questions: plan.questions } };
    let coverage;
    let coverageFailure = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const rawCoverage = await callHardProblemV9(task, strategy, runtime, transportAttempt, 'hardProblemCoverage', 'hardProblemCoverage', { INPUT_JSON: { ...coverageInput, retry: attempt } }, [], 1);
            coverage = hardProblemV9.normalizeCoverage(rawCoverage, evidence, plan);
            break;
        } catch (error) { coverageFailure = String(error?.code || 'COVERAGE_INVALID'); }
    }
    if (!coverage) {
        if (!plan.questions.every((q) => q.steps.length === 1)) plan = conservativeHardProblemV9Plan(evidence, method, coverageFailure || 'COVERAGE_FAILED');
        coverage = conservativeHardProblemV9Coverage(evidence, plan, coverageFailure || 'COVERAGE_FAILED');
        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V9_COVERAGE_SAFE_DEGRADE', { taskId: task._id, reason: coverageFailure || 'COVERAGE_FAILED' }, true);
    }
    const alignment = hardProblemV9.buildFixedAlignment(evidence, plan, coverage);
    const draft = { version: hardProblemV9.VERSION, evidence, method, plan, coverage, planAudit, createdAt: (0, utils_1.now)() };
    return { draft, alignment };
}

function buildHardProblemEvidenceSafeFallback(task, studentImageCount, error) {
    const imageCount = Math.max(1, Number(studentImageCount) || 1);
    const diagnostics = hardProblemFailureDiagnostics(error, task, STAGES.PRIMARY_GRADING);
    return {
        outputSchemaVersion: 'hard-problem-evidence.v2',
        layoutType: 'uncertain',
        questions: Array.from({ length: imageCount }, (_, index) => ({
            sourceKey: `image-${index + 1}-question-1`,
            layoutType: 'uncertain',
            questionText: '题目内容暂无法可靠识别',
            studentAnswer: '',
            studentWorkDetected: false,
            sourceQuestionLabel: `图片${index + 1}`,
            sourceRegion: `image-${index + 1}:unreadable`,
            inputBasis: 'printed_question_without_work',
            modeApplicability: 'uncertain',
            expectedSteps: [{
                stepId: 'S1', order: 1, purpose: '重新识别完整解题过程',
                expectedReasoning: '当前图片或模型输出无法可靠还原题目与学生步骤，请重新上传清晰、完整、方向正确的图片。',
                processUnitIds: [], explanationUnitIds: []
            }],
            processUnits: [], explanationUnits: [], confidence: 0,
            warnings: ['HARD_PROBLEM_EVIDENCE_SAFE_FALLBACK']
        })),
        _modelDiagnostics: { safeFallback: true, ...diagnostics }
    };
}
async function gradeHardProblemEvidence(task, transportAttempt, studentUrls, answerUrls, strategy, executionFence) {
    await assertFence(task._id, executionFence);
    assertHardProblemExplanationContract(strategy);
    const runtime = getModelRuntimeStage(strategy, 'hardProblemPrimary');
    const meta = {
        studentImageCount: studentUrls.length,
        answerImageCount: answerUrls.length,
        imageAttachments: [
            ...studentUrls.map((_, index) => ({ imageIndex: index + 1, purpose: 'student_work' })),
            ...answerUrls.map((_, index) => ({ imageIndex: studentUrls.length + index + 1, purpose: 'answer_reference' }))
        ],
        manualAnswer: task.manualAnswer || '',
        referenceAnswers: Array.isArray(task.referenceAnswers) ? task.referenceAnswers : []
    };
    let result;
    try {
        result = await (0, ark_1.callArk)({
            taskId: task._id,
            tier: runtime.modelTier,
            logicalPass: 1,
            transportAttempt,
            stage: task.currentStage,
            requestStage: 'hardProblemPrimary',
            outputSchemaVersion: null,
            structuredOutputMode: runtime.structuredOutputMode,
            mode: 'hard_problem_evidence',
            provider: hardProblemModelProvider(task),
            imageUrls: [...studentUrls, ...answerUrls],
            systemPrompt: strategy.prompts.hardProblemEvidence.system,
            userPrompt: strategyRender.hardProblemEvidenceUserPrompt(strategy, meta),
            temperature: runtime.temperature,
            maxOutputTokens: Math.min(Number(runtime.maxOutputTokens || 20000), 12000),
            timeoutMs: runtime.timeoutMs,
            maxRepairAttempts: 0,
            strategy
        });
    } catch (error) {
        if (['LLM_JSON_PARSE_ERROR', 'LLM_SCHEMA_REPAIR_FAILED', 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', 'LLM_EMPTY_RESPONSE', 'QWEN_OUTPUT_TRUNCATED', 'ARK_OUTPUT_TRUNCATED'].includes(String(error?.code || ''))) {
            const wrapped = Object.assign(new Error('难题原文提取结果无效'), { code: 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR', causeCode: error.code, fieldPath: error.fieldPath || null, requestStage: 'hardProblemPrimary', modelProvider: hardProblemModelProvider(task) });
            if (Number(task.hardProblemEvidenceRetryCount || 0) >= 1) {
                (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_EVIDENCE_SAFE_FALLBACK', { taskId: task._id, ...hardProblemFailureDiagnostics(wrapped, task, STAGES.PRIMARY_GRADING) }, true);
                return buildHardProblemEvidenceSafeFallback(task, studentUrls.length, wrapped);
            }
            throw wrapped;
        }
        throw error;
    }
    await assertFence(task._id, executionFence);
    try {
        const evidence = validateHardProblemEvidenceResult(result);
        return { ...evidence, _modelDiagnostics: result?._modelDiagnostics || evidence._modelDiagnostics || null };
    } catch (error) {
        if (String(error?.code || '') === 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR' && Number(task.hardProblemEvidenceRetryCount || 0) >= 1) {
            (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_EVIDENCE_SAFE_FALLBACK', { taskId: task._id, ...hardProblemFailureDiagnostics(error, task, STAGES.PRIMARY_GRADING) }, true);
            return buildHardProblemEvidenceSafeFallback(task, studentUrls.length, error);
        }
        throw error;
    }
}
async function gradeHardProblemFixedSteps(task, transportAttempt, studentUrls, answerUrls, strategy, alignment, executionFence) {
    await assertFence(task._id, executionFence);
    assertHardProblemExplanationContract(strategy);
    const runtime = getModelRuntimeStage(strategy, 'hardProblemReview');
    const baseline = alignment.questions.map(({ sourceKey, sourceQuestionLabel, sourceRegion }) => ({ sourceKey, sourceQuestionLabel, sourceRegion }));
    const meta = {
        studentImageCount: studentUrls.length,
        answerImageCount: answerUrls.length,
        imageAttachments: [
            ...studentUrls.map((_, index) => ({ imageIndex: index + 1, purpose: 'student_work' })),
            ...answerUrls.map((_, index) => ({ imageIndex: studentUrls.length + index + 1, purpose: 'answer_reference' }))
        ],
        manualAnswer: task.manualAnswer || '',
        referenceAnswers: Array.isArray(task.referenceAnswers) ? task.referenceAnswers : [],
        independentReview: true,
        fixedEvidenceMode: true,
        layoutType: alignment.layoutType,
        fixedEvidenceQuestions: fixedStepMeta(alignment)
    };
    let raw;
    try {
        raw = await (0, ark_1.callArk)({
            taskId: task._id,
            tier: runtime.modelTier,
            logicalPass: 2,
            transportAttempt,
            stage: task.currentStage,
            requestStage: 'hardProblemReview',
            outputSchemaVersion: 'hard-problem.v2',
            structuredOutputMode: runtime.structuredOutputMode,
            mode: 'hard_problem_fixed_steps',
            provider: hardProblemModelProvider(task),
            imageUrls: [...studentUrls, ...answerUrls],
            systemPrompt: strategy.prompts.hardProblem.system,
            userPrompt: strategyRender.hardProblemUserPrompt(strategy, meta) + hardProblemReviewRecoveryInstruction(task, alignment),
            temperature: runtime.temperature,
            maxOutputTokens: runtime.maxOutputTokens,
            timeoutMs: runtime.timeoutMs,
            maxRepairAttempts: 1,
            strategy,
            reviewQuestionAttributionBaseline: baseline,
            fixedEvidenceQuestions: fixedStepMeta(alignment)
        });
    }
    catch (error) {
        if (['LLM_JSON_PARSE_ERROR', 'LLM_SCHEMA_ERROR', 'LLM_SCHEMA_REPAIR_FAILED', 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', 'LLM_EMPTY_RESPONSE'].includes(String(error?.code || ''))) {
            throw Object.assign(new Error('固定步骤批改结果无效'), {
                code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH',
                causeCode: error.code,
                fieldPath: error.fieldPath || error?.schemaValidation?.fieldPath || null,
                requestStage: 'hardProblemReview',
                modelProvider: hardProblemModelProvider(task),
                providerRequestId: error?.providerRequestId || null,
                repairAttempted: error?.repairAttempted === true,
                repairAttemptCount: Number(error?.repairAttemptCount || 0),
                repairFailureStage: error?.repairFailureStage || null
            });
        }
        error.requestStage = error.requestStage || 'hardProblemReview';
        error.modelProvider = error.modelProvider || hardProblemModelProvider(task);
        throw error;
    }
    await assertFence(task._id, executionFence);
    const evidenceAudit = raw?.evidenceAudit && typeof raw.evidenceAudit === 'object' ? {
        hasClearOmission: raw.evidenceAudit.hasClearOmission === true,
        omissions: Array.isArray(raw.evidenceAudit.omissions) ? raw.evidenceAudit.omissions.map((item) => ({ sourceKey: evidenceString(item?.sourceKey), reason: evidenceString(item?.reason) })).filter((item) => item.sourceKey || item.reason) : []
    } : { hasClearOmission: false, omissions: [] };
    try {
        const cleanRaw = raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'evidenceAudit')) : raw;
        const restored = restoreReviewQuestionAttribution({ questions: alignment.questions }, cleanRaw, { allowUnmapped: true });
        const enforced = enforceFixedHardProblemSteps(restored, alignment, { allowSafeFallback: Number(task.hardProblemReviewRecoveryCount || 0) >= HARD_PROBLEM_REVIEW_MAX_RECOVERY });
        const normalized = alignment?._v9 ? normalizeV9FixedHardProblemAggregates(enforced, alignment) : normalizeFixedHardProblemAggregates(enforced);
        return { result: validateHardProblemGradeResult(normalized, strategy, { fixedStepReview: true, requestStage: 'hardProblemReview' }), evidenceAudit };
    }
    catch (error) {
        if (String(error?.code || '') === 'HARD_PROBLEM_FIXED_RESULT_MISMATCH') {
            error.requestStage = error.requestStage || 'hardProblemReview';
            error.modelProvider = error.modelProvider || hardProblemModelProvider(task);
            error.providerRequestId = error.providerRequestId || raw?._modelDiagnostics?.providerRequestId || null;
            error.repairAttempted = error.repairAttempted === true || raw?._modelDiagnostics?.repairAttempted === true;
            error.repairAttemptCount = Number(error.repairAttemptCount || raw?._modelDiagnostics?.repairAttemptCount || 0);
            throw error;
        }
        throw Object.assign(new Error('固定步骤批改结果未通过最终契约校验'), {
            code: 'HARD_PROBLEM_FIXED_RESULT_MISMATCH',
            causeCode: String(error?.code || 'FINAL_CONTRACT_VALIDATION_FAILED'),
            fieldPath: error?.fieldPath || error?.schemaValidation?.fieldPath || null,
            requestStage: 'hardProblemReview',
            modelProvider: hardProblemModelProvider(task),
            providerRequestId: raw?._modelDiagnostics?.providerRequestId || null,
            repairAttempted: raw?._modelDiagnostics?.repairAttempted === true,
            repairAttemptCount: Number(raw?._modelDiagnostics?.repairAttemptCount || 0)
        });
    }
}

async function grade(task, tier, logicalPass, transportAttempt, studentUrls, answerUrls, strategy, primary, executionFence, directConflict = null) {
    await assertFence(task._id, executionFence);
    const requestStage = requestStageFor(task, logicalPass === 3 ? 2 : logicalPass);
    const runtime = getModelRuntimeStage(strategy, requestStage);
    if (isCareless(task)) {
        const reviewQuestionAttributionBaseline = logicalPass === 2 ? primaryReviewQuestionContract(primary) : null;
        const recoveryContext = logicalPass === 2 ? (task.carelessReviewRecoveryContext || null) : null;
        const independentReview = logicalPass === 2 ? {
            independentReview: true,
            primaryDraft: compactReviewPayload(primary),
            primaryQuestionContract: reviewQuestionAttributionBaseline,
            reviewRecovery: recoveryContext,
            reviewInstruction: strategy.reviewRules.independentReviewInstruction,
            reviewContractInstruction: reviewContractInstruction(primary, recoveryContext)
        } : {};
        const meta = { studentImageCount: studentUrls.length, imageAttachments: studentUrls.map((_, index) => ({ imageIndex: index + 1, purpose: 'student_work' })), ...independentReview };
        const result = await (0, ark_1.callArk)({ taskId: task._id, tier: runtime.modelTier, logicalPass, transportAttempt, stage: task.currentStage, requestStage, outputSchemaVersion: runtime.outputSchemaVersion, structuredOutputMode: runtime.structuredOutputMode, mode: isCalculationCareless(task) ? 'calculationCarelessTrainingGrade' : 'carelessTrainingGrade', imageUrls: studentUrls, systemPrompt: isCalculationCareless(task) ? strategy.prompts.calculationCarelessTraining.system : strategy.prompts.carelessTraining.system, userPrompt: isCalculationCareless(task) ? strategyRender.calculationCarelessTrainingUserPrompt(strategy, meta) : strategyRender.carelessTrainingUserPrompt(strategy, meta), temperature: runtime.temperature, maxOutputTokens: runtime.maxOutputTokens, timeoutMs: runtime.timeoutMs, maxRepairAttempts: runtime.maxRepairAttempts, strategy, reviewQuestionAttributionBaseline });
        await assertFence(task._id, executionFence);
        return result;
    }
    assertHardProblemExplanationContract(strategy);
    if (usesHardProblemDirect(strategy)) {
        const attachmentNote = `前${studentUrls.length}张图片是学生作答${answerUrls.length ? `，后${answerUrls.length}张是参考答案` : ''}。`;
        const manual = directString(task.manualAnswer) ? `教师文字标准答案：${directString(task.manualAnswer)}。` : '';
        const references = Array.isArray(task.referenceAnswers) && task.referenceAnswers.length ? `参考答案文本：${JSON.stringify(task.referenceAnswers)}。` : '';
        const promptConfig = strategy?.prompts?.hardProblem || {};
        if (logicalPass === 2) {
            const primaryForReview = directDraftFromBusiness(primary);
            const reviewSystem = String(promptConfig.reviewSystem || '你是数学老师。重新看同一张学生原图，检查第一次批改有没有实质错误。没错就保留；有错就纠正。不要为了措辞、换行或表达不同而改结果。只输出JSON。');
            const reviewTemplate = String(promptConfig.reviewUserTemplate || '返回 {"reviewDecision":"keep|correct","reason":"","correctedResult":null}。若 reviewDecision=correct，correctedResult 必须给出完整修正后的第一次输出结构；若 keep，correctedResult 为 null。只返回JSON。');
            const userPrompt = `${attachmentNote}${manual}${references}\n第一次批改结果：${JSON.stringify(primaryForReview)}\n${reviewTemplate}`;
            const raw = await (0, ark_1.callArk)({ taskId: task._id, tier: runtime.modelTier, logicalPass, transportAttempt, stage: task.currentStage, requestStage, outputSchemaVersion: null, structuredOutputMode: runtime.structuredOutputMode, mode: 'hard_problem_direct_review', provider: hardProblemModelProvider(task), imageUrls: [...studentUrls, ...answerUrls], systemPrompt: reviewSystem, userPrompt, temperature: runtime.temperature, maxOutputTokens: Math.min(Number(runtime.maxOutputTokens || 14000), 9000), timeoutMs: runtime.timeoutMs, maxRepairAttempts: 0, disableModelOutputRepair: true, strategy });
            await assertFence(task._id, executionFence);
            const normalizedReview = normalizeHardProblemDirectReview(raw, primaryForReview);
            if (audit_1?.monitor) (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_REVIEW_MODEL_SHAPE', {
                taskId: task._id,
                decision: normalizedReview.reviewDecision,
                correctedOutline: normalizedReview.correctedResult ? directStepOutline(normalizedReview.correctedResult) : []
            }, true);
            if (normalizedReview.reviewDecision === 'keep') return { reviewDecision: 'keep', reason: normalizedReview.reason, result: null };
            return { reviewDecision: 'correct', reason: normalizedReview.reason, result: adaptHardProblemDirectDraft(normalizedReview.correctedResult, strategy, { manualAnswer: task.manualAnswer, referenceAnswers: task.referenceAnswers, studentImageCount: studentUrls.length }) };
        }
        const userPrompt = `${attachmentNote}${manual}${references}\n${String(promptConfig.userTemplate || '')}`;
        const raw = await (0, ark_1.callArk)({ taskId: task._id, tier: runtime.modelTier, logicalPass, transportAttempt, stage: task.currentStage, requestStage, outputSchemaVersion: null, structuredOutputMode: runtime.structuredOutputMode, mode: 'hard_problem_direct', provider: hardProblemModelProvider(task), imageUrls: [...studentUrls, ...answerUrls], systemPrompt: promptConfig.system, userPrompt, temperature: runtime.temperature, maxOutputTokens: Math.min(Number(runtime.maxOutputTokens || 14000), 9000), timeoutMs: runtime.timeoutMs, maxRepairAttempts: 0, disableModelOutputRepair: true, strategy });
        await assertFence(task._id, executionFence);
        const directContext = { manualAnswer: task.manualAnswer, referenceAnswers: task.referenceAnswers };
        let preparedRaw = applyHardProblemDirectDeterministicFields(raw, directContext);
        if (Number(task.hardProblemDirectRetryCount || 0) >= 1 && hardProblemDirectRequiredFieldGaps(preparedRaw, directContext).length) {
            preparedRaw = await repairHardProblemDirectRequiredFields(task, preparedRaw, runtime, transportAttempt, studentUrls, answerUrls, strategy, executionFence);
        }
        const normalizedDraft = normalizeHardProblemDirectDraft(preparedRaw);
        if (audit_1?.monitor) (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_PRIMARY_MODEL_SHAPE', { taskId: task._id, outline: directStepOutline(normalizedDraft) }, true);
        return adaptHardProblemDirectDraft(normalizedDraft, strategy, { manualAnswer: task.manualAnswer, referenceAnswers: task.referenceAnswers, studentImageCount: studentUrls.length });
    }
    if (audit_1?.monitor) (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_STRATEGY_RESOLVED', { strategyVersion: String(strategy?.strategyVersion || strategy?.version || ''), requestStage, stepFeedbacksRequired: true, overallFeedbackRequired: true, nestedStepContractComplete: true }, true);
    const reviewQuestionAttributionBaseline = logicalPass === 2 ? compactReviewPayload(primary).questions.map(({ sourceKey, sourceQuestionLabel, sourceRegion }) => ({ sourceKey, sourceQuestionLabel, sourceRegion })) : null;
    const independentReview = logicalPass === 2 ? { independentReview: true, primaryDraft: compactReviewPayload(primary), reviewInstruction: strategy.reviewRules.independentReviewInstruction } : {};
    const meta = { studentImageCount: studentUrls.length, answerImageCount: answerUrls.length, imageAttachments: [...studentUrls.map((_, index) => ({ imageIndex: index + 1, purpose: 'student_work' })), ...answerUrls.map((_, index) => ({ imageIndex: studentUrls.length + index + 1, purpose: 'answer_reference' }))], manualAnswer: task.manualAnswer || '', referenceAnswers: Array.isArray(task.referenceAnswers) ? task.referenceAnswers : [], ...independentReview };
    const result = await (0, ark_1.callArk)({ taskId: task._id, tier: runtime.modelTier, logicalPass, transportAttempt, stage: task.currentStage, requestStage, outputSchemaVersion: runtime.outputSchemaVersion, structuredOutputMode: runtime.structuredOutputMode, mode: 'hard_problem', provider: hardProblemModelProvider(task), imageUrls: [...studentUrls, ...answerUrls], systemPrompt: strategy.prompts.hardProblem.system, userPrompt: strategyRender.hardProblemUserPrompt(strategy, meta), temperature: runtime.temperature, maxOutputTokens: runtime.maxOutputTokens, timeoutMs: runtime.timeoutMs, maxRepairAttempts: runtime.maxRepairAttempts, strategy, reviewQuestionAttributionBaseline });
    await assertFence(task._id, executionFence);
    return result;
}

async function markContinuationFailureIfStillQueued(taskId, stage, error) {
    const failureId = (0, utils_1.randomId)('failure');
    const outcome = await context_1.db.runTransaction(async (transaction) => {
        const ref = transaction.collection(constants_1.C.tasks).doc(taskId);
        const task = firstDocument(await ref.get());
        if (!task)
            return { written: false, reason: 'TASK_NOT_FOUND' };
        if (['FAILED', 'COMPLETED', 'NEED_CONFIRMATION', 'NEED_ANSWER'].includes(String(task.status || '')))
            return { written: false, reason: 'TASK_TERMINAL' };
        if (String(task.status || '') !== 'QUEUED' || String(task.currentStage || '') !== stage || task.leaseOwner || (task.leaseUntil && new Date(task.leaseUntil).getTime() > Date.now())) {
            return { written: false, reason: 'TASK_ALREADY_CONTINUED' };
        }
        await ref.update({ data: {
                status: 'FAILED',
                currentStage: 'FAILED',
                failedStage: stage,
                errorCode: 'TASK_WORKER_CONTINUATION_FAILED',
                errorMessage: '批改任务阶段续跑失败',
                errorSuggestion: '请重新提交任务',
                retryable: true,
                failureCategory: 'unknown',
                failureId,
                failedAt: (0, utils_1.now)(),
                leaseOwner: null,
                leaseUntil: null,
                updatedAt: (0, utils_1.now)(),
            } });
        return { written: true, reason: 'TASK_MARKED_FAILED' };
    });
    if (outcome.written) {
        (0, audit_1.monitor)(auditSource, 'TASK_CONTINUATION_FAILED', { taskId, stage, errorCode: error?.code || 'TASK_WORKER_CONTINUATION_FAILED', errorMessage: (0, utils_1.safeError)(error) }, true);
    }
    else {
        (0, audit_1.monitor)(auditSource, 'TASK_CONTINUATION_FAILURE_IGNORED', { taskId, stage, status: outcome.reason, errorCode: error?.code || 'TASK_WORKER_CONTINUATION_FAILED' });
    }
    return outcome;
}
async function triggerContinuation(taskId, stage) {
    try {
        return await scheduleNextStageHook({ taskId, stage });
    }
    catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await markContinuationFailureIfStillQueued(taskId, stage, error);
        return { success: false, code: 'TASK_WORKER_CONTINUATION_FAILED' };
    }
}
async function schedule(taskId, stage, patch = {}, executionFence = null) {
    const handoffAt = (0, utils_1.now)();
    const handoffToken = (0, utils_1.randomId)('stage_handoff');
    const handoffPatch = {
        ...patch,
        progress: progressFor(stage),
        statusMessage: patch.statusMessage || stageMessage(stage),
        stageHandoffToken: handoffToken,
        stageHandoffTo: stage,
        stageHandoffAt: handoffAt,
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: handoffAt
    };
    if (deferStagePersistence) {
        await assertFence(taskId, executionFence);
        return { outcome: 'CONTINUE', nextStage: stage, handoffPatch, handoffToken };
    }
    const written = await updateTaskWithFence(taskId, {
        ...handoffPatch,
        status: 'QUEUED',
        currentStage: stage
    }, executionFence);
    if (!written) throw leaseLost();
    await triggerContinuation(taskId, stage);
    return { outcome: 'CONTINUE', nextStage: stage, handoffPatch, handoffToken };
}

function monitorCarelessDraftShape(task, tier, logicalPass, result) {
    const questions = Array.isArray(result?.questions) ? result.questions : [];
    const any = (question, fields) => fields.some((field) => String(question?.[field] || '').trim());
    (0, audit_1.monitor)(auditSource, 'CARELESS_DRAFT_SHAPE', { taskId: task._id, tier, logicalPass, questionCount: questions.length, questionTextPresentCount: questions.filter((question) => !Array.isArray(question?.schemaWarnings) || !question.schemaWarnings.includes('missing_questionText') ? Boolean(String(question?.questionText || '').trim()) : false).length, studentGridPresentCount: questions.filter((question) => any(question, ['studentConditionText', 'studentRelationText', 'studentAskText'])).length, referenceGridPresentCount: questions.filter((question) => any(question, ['referenceConditionText', 'referenceRelationText', 'referenceAskText'])).length, usableQuestionCount: questions.filter((question) => any(question, ['questionText', 'studentConditionText', 'studentRelationText', 'studentAskText', 'referenceConditionText', 'referenceRelationText', 'referenceAskText'])).length });
}
function wrongQuestionDocumentId(taskId, sourceKey) {
    return `${String(taskId)}_${createHash('sha256').update(String(sourceKey)).digest('hex').slice(0, 32)}`;
}
function legacyCarelessTypeForWrongRecord(question, wrongRecord) {
    if (question?.outputSchemaVersion === 'calculation-careless.v2') {
        if (wrongRecord?.resultCategory === 'careless') return 'careless';
        if (wrongRecord?.resultCategory === 'knowledge_or_method') return 'method_error';
        return 'none';
    }
    return String(question?.carelessType || 'none');
}
async function persistResult(task, result, executionFence = null, strategyVersion = '', strategy = null) {
    const finalQuestions = excludePrintedQuestionsWithoutWork(result?.questions);
    const primaryResult = { ...task.primaryDraft, questions: excludePrintedQuestionsWithoutWork(task.primaryDraft?.questions) };
    const reviewResult = { ...task.reviewDraft, questions: excludePrintedQuestionsWithoutWork(task.reviewDraft?.questions) };
    if (finalQuestions.length || strategyRequiresQuestionSetAudit(strategy, result?.outputSchemaVersion)) {
        result = validateFinalResultContract({ finalResult: { ...result, questions: finalQuestions }, primaryResult, reviewResult, requireQuestionSetAudit: strategyRequiresQuestionSetAudit(strategy, result?.outputSchemaVersion) });
    }
    else {
        const summary = isCalculationCareless(task) ? calculationCarelessSummary([]) : isCareless(task) ? carelessSummary([]) : hardSummary([]);
        result = { ...result, questions: [], summary };
    }
    const primaryModelTier = getModelRuntimeStage(strategy, requestStageFor(task, 1))?.modelTier;
    const reviewModelTier = getModelRuntimeStage(strategy, requestStageFor(task, 2))?.modelTier;
    const modelTier = `${primaryModelTier}+${reviewModelTier}`;
  const resultDoc = { taskId: task._id, studentId: task.studentId, dataSpace: dataSpaceOf(task), grade: task.grade, className: task.className, modelProvider: isCareless(task) ? 'ark_lite' : hardProblemModelProvider(task), carelessTrainingType: isCareless(task) ? (task.carelessTrainingType === 'CALCULATION' ? 'CALCULATION' : 'READING') : null, outputSchemaRegistryVersion: outputSchemaRegistry.OUTPUT_SCHEMA_REGISTRY_VERSION, downstreamSemanticsVersion: outputSchemaRegistry.DOWNSTREAM_SEMANTICS_VERSION, ...(isCalculationCareless(task) ? { outputSchemaVersion: 'calculation-careless.v2', strategyVersion: String(strategyVersion || task.strategyVersion || result.strategyVersion || ''), modelTier } : result.outputSchemaVersion === 'hard-problem.v2' || result.outputSchemaVersion === 'reading-careless.v2' ? { outputSchemaVersion: result.outputSchemaVersion, strategyVersion: String(strategyVersion || task.strategyVersion || result.strategyVersion || ''), modelTier, ...(Array.isArray(result.validationWarnings) && result.validationWarnings.length ? { validationWarnings: result.validationWarnings } : {}) } : { modelTier }), ...(result.questionSetAudit ? { questionSetAudit: result.questionSetAudit } : {}), questions: result.questions, summary: result.summary, audioNarration: { status: 'PENDING' }, teacherReviewed: false, createdAt: (0, utils_1.now)(), updatedAt: (0, utils_1.now)() };
    await assertFence(task._id, executionFence);
    resultDoc.modelDiagnostics = { primary: task.primaryDraft?._modelDiagnostics || null, review: task.reviewDraft?._modelDiagnostics || null, final: result._modelDiagnostics || null };
    await context_1.db.collection(constants_1.C.results).doc(task._id).set({ data: resultDoc });
    if (!isCareless(task) && (task.hardProblemV10DiagnosticDraft || task.hardProblemV9DiagnosticDraft) && constants_1.C.hardProblemDiagnostics) {
        const diagnostic = task.hardProblemV10DiagnosticDraft || task.hardProblemV9DiagnosticDraft;
        const runtimeVersion = String(diagnostic?.version || (task.hardProblemV10DiagnosticDraft ? hardProblemV10.VERSION : hardProblemV9.VERSION));
        await context_1.db.collection(constants_1.C.hardProblemDiagnostics).doc(task._id).set({ data: {
            taskId: task._id, studentId: task.studentId, dataSpace: dataSpaceOf(task), strategyVersion: String(strategyVersion || task.strategyVersion || ''),
            runtimeVersion, snapshotId: diagnostic.snapshotId, diagnosticSnapshot: diagnostic,
            createdAt: (0, utils_1.now)(), updatedAt: (0, utils_1.now)()
        } });
    }
    for (const question of result.questions) {
    const wrongRecord = resultSemantics.wrongQuestionProjection(question, task.mode);
    if (wrongRecord.wrongQuestionDisposition !== 'CREATE') continue;
        const id = wrongQuestionDocumentId(task._id, question.sourceKey);
    await context_1.db.collection(constants_1.C.wrong).doc(id).set({ data: { studentId: task.studentId, taskId: task._id, dataSpace: dataSpaceOf(task), ...wrongRecord, carelessType: legacyCarelessTypeForWrongRecord(question, wrongRecord), mastered: false, createdAt: (0, utils_1.now)(), updatedAt: (0, utils_1.now)() } });
    }
    const completedAt = (0, utils_1.now)();
    const written = await updateTaskWithFence(task._id, { status: 'COMPLETED', currentStage: 'COMPLETED', progress: 100, statusMessage: '批改完成', resultId: task._id, completedAt, errorCode: null, errorMessage: null, errorSuggestion: null, failedStage: null, leaseOwner: null, leaseUntil: null, questionCount: result.questions.length, correctCount: result.summary.correctCount || result.summary.fullyCorrectCount || 0, updatedAt: completedAt }, executionFence);
    if (!written) throw leaseLost();
    if (result.questions.length) await (0, checkin_1.recordQualifiedQuestions)(task, result.questions).catch((error) => {
        (0, audit_1.monitor)(auditSource, 'CHECKIN_QUALIFIED_QUESTIONS_FAILED', { taskId: task._id, studentIdPresent: Boolean(task.studentId), taskDateKey: (0, utils_1.shanghaiDateKey)(new Date(task.createdAt || Date.now())), eligibleQuestionCount: (result.questions || []).filter((question) => question?.checkinEligible === true).length, errorCode: String(error?.code || error?.errCode || 'CHECKIN_QUALIFIED_QUESTIONS_FAILED').slice(0, 100), errorMessage: safeCheckinDiagnosticMessage(error), errorStage: 'recordQualifiedQuestions' }, true);
    });
    if (task.parentTaskId && result.summary.allCorrect) {
        const previous = await context_1.db.collection(constants_1.C.wrong).where({ studentId: task.studentId, taskId: task.parentTaskId }).limit(100).get();
        for (const item of previous.data)
            await context_1.db.collection(constants_1.C.wrong).doc(item._id).update({ data: { mastered: true, masteredAt: (0, utils_1.now)(), masteredByTaskId: task._id, updatedAt: (0, utils_1.now)() } });
    }
    if (result.questions.length) void enqueueTtsHook({ resultId: task._id }).catch(() => { });
    return { outcome: 'COMPLETED', resultId: task._id };
}

async function process(task, startedAt, executionFence = null) {
    const strategy = await (0, remote_1.loadRuntimeStrategy)();
    let stage = task.currentStage || STAGES.PREPARING_IMAGES;
    if (stage === STAGES.PREPARING_IMAGES) {
        const ids = (task.studentImageFileIds || []).filter(Boolean);
        (0, audit_1.monitor)(auditSource, 'PREPARING_IMAGES_DIAGNOSTIC', { taskId: task._id, stage, diagnostics: { studentImageCount: ids.length, fileIds: ids.map((fileId) => ({ isString: typeof fileId === 'string', environmentMatched: typeof fileId === 'string' && fileId.startsWith('cloud://cloudbase-d5g764d4w29a8d93e') })) } }, true);
        if (!ids.length)
            throw Object.assign(new Error('未找到作业图片'), { code: 'IMAGE_NOT_FOUND' });
        await tempUrls(ids, { taskId: task._id, stage });
        return await schedule(task._id, STAGES.PRIMARY_GRADING, {}, executionFence);
    }
    if (!canStartAi(startedAt)) {
        return await schedule(task._id, stage, {}, executionFence);
    }
    const studentUrls = await tempUrls((task.studentImageFileIds || []).filter(Boolean));
    const answerUrls = isCareless(task) ? [] : await tempUrls((task.answerImageFileIds || []).filter(Boolean));
    const field = transportField(stage);
    const transportAttempt = Number(task[field] || 0) + 1;
    try {
        if (stage === STAGES.PRIMARY_GRADING) {
            if (!isCareless(task) && usesHardProblemDirect(strategy)) {
                const primary = await grade(task, 'lite', 1, transportAttempt, studentUrls, answerUrls, strategy, null, executionFence);
                const gatedPrimary = primary;
                validateQuestionAttribution(gatedPrimary);
                (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_PRIMARY_READY', {
                    taskId: task._id,
                    questionCount: gatedPrimary.questions.length,
                    stepCounts: gatedPrimary.questions.map((q) => ({ sourceKey: q.sourceKey, stepCount: Array.isArray(q.stepFeedbacks) ? q.stepFeedbacks.length : 0 }))
                }, true);
                return await schedule(task._id, STAGES.REVIEW_GRADING, {
                    primaryDraft: { ...gatedPrimary, canonicalSourceKeys: gatedPrimary.questions.map((question) => String(question.sourceKey || '').trim()), attributionDiagnostics: questionAttributionDiagnostics(gatedPrimary) },
                    reviewDraft: null,
                    mergedDraft: null,
                    hardProblemDirectRetryCount: 0,
                    hardProblemV10Draft: null,
                    hardProblemV9Draft: null,
                    hardProblemEvidenceDraft: null,
                    hardProblemAlignmentDraft: null,
                    hardProblemV10DiagnosticDraft: null,
                    primaryTransportAttempt: 0,
                    reviewTransportAttempt: 0
                }, executionFence);
            }
            if (!isCareless(task) && usesHardProblemV10(strategy)) {
                const v10 = await gradeHardProblemV10Understanding(task, transportAttempt, studentUrls, answerUrls, strategy, executionFence);
                const draftBytes = hardProblemDraftBytes(v10.draft);
                if (draftBytes > HARD_PROBLEM_TASK_DRAFT_MAX_BYTES) {
                    const oversizeDiagnostic = {
                        ...v10.draft,
                        consistencyStatus: 'blocked',
                        consistencyIssues: [`REVIEW_PIPELINE_DRAFT_OVERSIZE:${draftBytes}`],
                        snapshotId: hardProblemV10.sha({ taskId: task._id, evidence: v10.draft?.evidence?.evidenceFingerprint || '', draftBytes })
                    };
                    const safeResult = buildHardProblemV10SafeRefusalNoThrow(oversizeDiagnostic, { questions: [] }, strategy, v10.alignment);
                    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_DRAFT_OVERSIZE_SAFE_REFUSAL', {
                        taskId: task._id,
                        draftBytes,
                        maxBytes: HARD_PROBLEM_TASK_DRAFT_MAX_BYTES,
                        preservedQuestionCount: Array.isArray(safeResult?.questions) ? safeResult.questions.length : 0,
                        preservedStepCount: Array.isArray(safeResult?.questions) ? safeResult.questions.reduce((sum, question) => sum + (Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks.length : 0), 0) : 0
                    }, true);
                    return await schedule(task._id, STAGES.FINALIZING_RESULT, {
                        primaryDraft: safeResult,
                        reviewDraft: safeResult,
                        mergedDraft: safeResult,
                        hardProblemV10Draft: null,
                        hardProblemV9Draft: null,
                        hardProblemAlignmentDraft: null,
                        hardProblemV10DiagnosticDraft: null,
                        hardProblemReviewRecoveryCount: 0,
                        hardProblemReviewLastFailure: null,
                        finalizationRecoveryCount: 0,
                        statusMessage: '分析信息较多，已保留逐步原文并生成安全结果'
                    }, executionFence);
                }
                (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_UNDERSTANDING_READY', { taskId: task._id, route: v10.draft.route?.path || 'unknown', questionCount: v10.alignment.questions.length, stepCount: v10.alignment.questions.reduce((n, q) => n + q.pairedSteps.length, 0), draftBytes }, true);
                return await schedule(task._id, STAGES.REVIEW_GRADING, {
                    hardProblemV10Draft: v10.draft, hardProblemAlignmentDraft: compactHardProblemAlignmentDraft(v10.alignment),
                    hardProblemV9Draft: null, hardProblemEvidenceDraft: null, primaryDraft: null, primaryTransportAttempt: 0,
                    hardProblemReviewRecoveryCount: 0, hardProblemReviewLastFailure: null
                }, executionFence);
            }
            if (!isCareless(task) && usesHardProblemV9(strategy)) {
                const v9 = await gradeHardProblemV9Understanding(task, transportAttempt, studentUrls, answerUrls, strategy, executionFence);
                const draftBytes = hardProblemDraftBytes(v9.draft);
                if (draftBytes > HARD_PROBLEM_TASK_DRAFT_MAX_BYTES) throw Object.assign(new Error('难题V9诊断草稿超过任务文档安全预算'), { code: 'HARD_PROBLEM_V9_DRAFT_OVERSIZE' });
                (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V9_UNDERSTANDING_READY', { taskId: task._id, questionCount: v9.alignment.questions.length, stepCount: v9.alignment.questions.reduce((n, q) => n + q.pairedSteps.length, 0), draftBytes }, true);
                return await schedule(task._id, STAGES.REVIEW_GRADING, {
                    hardProblemV9Draft: v9.draft, hardProblemAlignmentDraft: compactHardProblemAlignmentDraft(v9.alignment),
                    hardProblemEvidenceDraft: null, primaryDraft: null, primaryTransportAttempt: 0,
                    hardProblemReviewRecoveryCount: 0, hardProblemReviewLastFailure: null
                }, executionFence);
            }
            if (!isCareless(task) && usesHardProblemEvidencePipeline(strategy)) {
                let evidence = await gradeHardProblemEvidence(task, transportAttempt, studentUrls, answerUrls, strategy, executionFence);
                let evidenceBytes = hardProblemDraftBytes(evidence);
                if (evidenceBytes > HARD_PROBLEM_TASK_DRAFT_MAX_BYTES) {
                    const oversizeError = Object.assign(new Error('难题原文证据超过任务文档安全预算'), {
                        code: 'HARD_PROBLEM_EVIDENCE_OVERSIZE', evidenceBytes, maxBytes: HARD_PROBLEM_TASK_DRAFT_MAX_BYTES,
                        requestStage: 'hardProblemPrimary', modelProvider: hardProblemModelProvider(task)
                    });
                    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_EVIDENCE_OVERSIZE_FALLBACK', {
                        taskId: task._id, evidenceBytes, maxBytes: HARD_PROBLEM_TASK_DRAFT_MAX_BYTES,
                        ...hardProblemFailureDiagnostics(oversizeError, task, STAGES.PRIMARY_GRADING)
                    }, true);
                    // Never persist oversized model material in the task document. Finish safely with a
                    // bounded unreadable/missing plan instead of failing the whole task or truncating JSON.
                    evidence = buildHardProblemEvidenceSafeFallback(task, studentUrls.length, oversizeError);
                    evidenceBytes = hardProblemDraftBytes(evidence);
                }
                const alignment = alignHardProblemEvidence(evidence);
                const alignmentDraft = compactHardProblemAlignmentDraft(alignment);
                const alignmentDraftBytes = hardProblemDraftBytes(alignmentDraft);
                (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_EVIDENCE_ALIGNED', {
                    taskId: task._id,
                    layoutType: alignment.layoutType,
                    questionCount: alignment.questions.length,
                    processUnitCount: alignment.questions.reduce((sum, question) => sum + question.processUnits.length, 0),
                    explanationUnitCount: alignment.questions.reduce((sum, question) => sum + question.explanationUnits.length, 0),
                    pairedStepCount: alignment.questions.reduce((sum, question) => sum + question.pairedSteps.length, 0),
                    evidenceDraftBytes: evidenceBytes,
                    alignmentDraftBytes,
                    taskDraftMaxBytes: HARD_PROBLEM_TASK_DRAFT_MAX_BYTES
                }, true);
                return await schedule(task._id, STAGES.REVIEW_GRADING, {
                    hardProblemEvidenceDraft: evidence,
                    hardProblemAlignmentDraft: alignmentDraft,
                    primaryDraft: null,
                    primaryTransportAttempt: 0,
                    hardProblemReviewRecoveryCount: 0,
                    hardProblemReviewLastFailure: null
                }, executionFence);
            }
            const primary = isCareless(task) ? (isCalculationCareless(task) ? validateCalculationCarelessTrainingGradeResult(await grade(task, 'mini', 1, transportAttempt, studentUrls, answerUrls, strategy, null, executionFence), strategy) : validateCarelessTrainingGradeResult(await grade(task, 'mini', 1, transportAttempt, studentUrls, answerUrls, strategy, null, executionFence), 'draft', strategy)) : validateHardProblemGradeResult(await grade(task, 'lite', 1, transportAttempt, studentUrls, answerUrls, strategy, null, executionFence), strategy);
            if (isCareless(task))
                monitorCarelessDraftShape(task, 'mini', 1, primary);
            const gatedPrimary = gateStudentVisibleText(primary, task, 'primary');
            return await schedule(task._id, STAGES.REVIEW_GRADING, { primaryDraft: { ...gatedPrimary, canonicalSourceKeys: primary.questions.map((question) => String(question.sourceKey || '').trim()), attributionDiagnostics: questionAttributionDiagnostics(gatedPrimary) }, primaryTransportAttempt: 0 }, executionFence);
        }
        if (stage === STAGES.REVIEW_GRADING) {
            if (!isCareless(task) && usesHardProblemDirect(strategy)) {
                if (!task.primaryDraft) {
                    const recoveryCount = Number(task.hardProblemDirectHandoffRecoveryCount || 0);
                    if (recoveryCount < 1) {
                        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_PRIMARY_HANDOFF_RECOVERY', { taskId: task._id, recoveryAttempt: recoveryCount + 1 }, true);
                        return await schedule(task._id, STAGES.PRIMARY_GRADING, {
                            primaryDraft: null, reviewDraft: null, mergedDraft: null,
                            hardProblemDirectHandoffRecoveryCount: recoveryCount + 1,
                            primaryTransportAttempt: 0, reviewTransportAttempt: 0,
                            statusMessage: '首次批改结果交接不完整，正在自动重建'
                        }, executionFence);
                    }
                    throw Object.assign(new Error('缺少首次难题批改结果'), { code: 'TASK_PRIMARY_DRAFT_MISSING', recoveryCount });
                }
                let finalReview;
                try {
                    const review = await grade(task, 'lite', 2, transportAttempt, studentUrls, answerUrls, strategy, task.primaryDraft, executionFence);
                    if (review?.reviewDecision === 'correct') {
                        finalReview = review.result;
                        validateQuestionAttribution(finalReview);
                        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_REVIEW_CORRECTED', {
                            taskId: task._id,
                            reason: String(review.reason || '').slice(0, 300),
                            primaryStepCounts: task.primaryDraft.questions.map((q) => ({ sourceKey: q.sourceKey, stepCount: Array.isArray(q.stepFeedbacks) ? q.stepFeedbacks.length : 0 })),
                            finalStepCounts: finalReview.questions.map((q) => ({ sourceKey: q.sourceKey, stepCount: Array.isArray(q.stepFeedbacks) ? q.stepFeedbacks.length : 0 }))
                        }, true);
                    } else {
                        finalReview = task.primaryDraft;
                        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_REVIEW_KEPT', { taskId: task._id, reason: String(review?.reason || '').slice(0, 300) }, true);
                    }
                    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_REVIEW_APPLIED', {
                        taskId: task._id,
                        decision: review?.reviewDecision === 'correct' ? 'correct' : 'keep',
                        primaryStepCounts: task.primaryDraft.questions.map((q) => ({ sourceKey: q.sourceKey, stepCount: Array.isArray(q.stepFeedbacks) ? q.stepFeedbacks.length : 0 })),
                        reviewStepCounts: finalReview.questions.map((q) => ({ sourceKey: q.sourceKey, stepCount: Array.isArray(q.stepFeedbacks) ? q.stepFeedbacks.length : 0 }))
                    }, true);
                } catch (error) {
                    if (!hardProblemDirectRecoverable(error)) throw error;
                    finalReview = { ...task.primaryDraft, validationWarnings: [...new Set([...(Array.isArray(task.primaryDraft.validationWarnings) ? task.primaryDraft.validationWarnings : []), `DIRECT_REVIEW_UNAVAILABLE_PRIMARY_PRESERVED:${String(error?.code || 'UNKNOWN').slice(0, 80)}`])] };
                    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_REVIEW_FALLBACK_TO_PRIMARY', {
                        taskId: task._id,
                        errorCode: String(error?.code || 'UNKNOWN').slice(0, 100),
                        fieldPath: typeof error?.fieldPath === 'string' ? error.fieldPath.slice(0, 200) : null
                    }, true);
                }
                const diagnostic = buildHardProblemDirectDiagnostic(finalReview);
                const primaryDraft = { ...task.primaryDraft };
                return await schedule(task._id, STAGES.FINALIZING_RESULT, {
                    primaryDraft,
                    reviewDraft: finalReview,
                    mergedDraft: finalReview,
                    hardProblemV10DiagnosticDraft: diagnostic,
                    hardProblemV10Draft: null,
                    hardProblemV9Draft: null,
                    hardProblemEvidenceDraft: null,
                    hardProblemAlignmentDraft: null,
                    hardProblemReviewRecoveryCount: 0,
                    hardProblemReviewLastFailure: null,
                    hardProblemDirectRetryCount: 0,
                    hardProblemDirectHandoffRecoveryCount: 0,
                    reviewTransportAttempt: 0,
                    finalizationRecoveryCount: 0
                }, executionFence);
            }
            if (!isCareless(task) && usesHardProblemV10(strategy)) {
                if (!task.hardProblemV10Draft) {
                    const understandingRecoveryCount = Number(task.hardProblemUnderstandingRecoveryCount || 0);
                    if (understandingRecoveryCount < HARD_PROBLEM_UNDERSTANDING_MAX_RECOVERY) {
                        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_UNDERSTANDING_HANDOFF_RECOVERY', {
                            taskId: task._id, stage, recoveryAttempt: understandingRecoveryCount + 1
                        }, true);
                        return await schedule(task._id, STAGES.PRIMARY_GRADING, {
                            hardProblemV10Draft: null, hardProblemV10DiagnosticDraft: null, hardProblemAlignmentDraft: null,
                            primaryDraft: null, reviewDraft: null, mergedDraft: null,
                            hardProblemUnderstandingRecoveryCount: understandingRecoveryCount + 1,
                            primaryTransportAttempt: 0, reviewTransportAttempt: 0,
                            statusMessage: '理解结果交接不完整，正在自动重建'
                        }, executionFence);
                    }
                    throw Object.assign(new Error('缺少难题V10理解快照'), { code: 'TASK_HARD_PROBLEM_V10_DRAFT_MISSING', recoveryCount: understandingRecoveryCount });
                }
                const d = task.hardProblemV10Draft;
                const alignment = hardProblemV10.buildFixedAlignment(d.evidence, d.reasoningHypotheses, d.coverage);
                const fixedReview = await gradeHardProblemFixedSteps(task, transportAttempt, studentUrls, answerUrls, strategy, alignment, executionFence);
                const reviewed = fixedReview.result;
                const gated = gateStudentVisibleText(reviewed, task, 'review');
                validateQuestionAttribution(gated);
                let adversarial = { accepted: true, confidence: 1, issues: [], skipped: true };
                if (hardProblemV10.shouldRunAdversarialJudge({ route: d.route, evidence: d.evidence, problemTruth: d.problemTruth, hypotheses: d.reasoningHypotheses, coverage: d.coverage, reviewResult: gated })) {
                    try {
                        const runtime = getModelRuntimeStage(strategy, 'hardProblemReview');
                        const rawJudge = await callHardProblemV10(task, strategy, runtime, transportAttempt, 'hardProblemAdversarialJudgeV10', 'hardProblemAdversarialJudgeV10', { INPUT_JSON: { evidence: { questions: d.evidence.questions }, problemTruth: d.problemTruth, selectedPlan: d.plan, coverage: d.coverage, review: gated } }, [], 2);
                        adversarial = hardProblemV10.normalizeAdversarialJudgment(rawJudge);
                    } catch (error) {
                        // Adversarial Judge is an auxiliary safety reviewer. Its transport/runtime failure must not erase
                        // an otherwise valid student-step review. Record the outage and continue with the trusted
                        // Evidence + ProblemTruth + fixed student-step result.
                        adversarial = hardProblemV10.normalizeAdversarialJudgment({ accepted: true, skipped: true, confidence: 0, issues: [{ code: 'JUDGE_UNAVAILABLE', severity: 'low', reason: String(error?.code || 'judge_failed'), confidence: 1 }] });
                        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_ADVERSARIAL_JUDGE_UNAVAILABLE', { taskId: task._id, errorCode: String(error?.code || 'JUDGE_FAILED').slice(0, 80), fallback: 'non_blocking' }, true);
                    }
                }
                const diagnostic = hardProblemV10.buildDiagnosticSnapshot({ evidence: d.evidence, problemTruth: d.problemTruth, method: d.method, hypotheses: d.reasoningHypotheses, hypothesisAudit: d.hypothesisAudit, coverage: d.coverage, alignment, reviewResult: gated, adversarialJudgment: adversarial, route: d.route });
                const finalReview = diagnostic.consistencyStatus === 'ok' ? gated : buildHardProblemV10SafeRefusalNoThrow(diagnostic, gated, strategy, alignment);
                if (diagnostic.consistencyStatus === 'ok' && Array.isArray(diagnostic.consistencyWarnings) && diagnostic.consistencyWarnings.length) (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_CONSISTENCY_WARNINGS', {
                    taskId: task._id,
                    warningCount: diagnostic.consistencyWarnings.length,
                    warnings: diagnostic.consistencyWarnings.slice(0, 20),
                    studentStepCounts: alignment.questions.map((q) => ({ sourceKey: q.sourceKey, studentStepCount: q.pairedSteps.length, expectedNodeCount: q.expectedSteps.length, unmatchedExplanationCount: Array.isArray(q.unmatchedExplanationUnits) ? q.unmatchedExplanationUnits.length : 0 }))
                }, true);
                if (diagnostic.consistencyStatus !== 'ok') (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_CONSISTENCY_SAFE_REFUSAL', {
                    taskId: task._id,
                    issueCount: Array.isArray(diagnostic.consistencyIssues) ? diagnostic.consistencyIssues.length : 0,
                    issues: Array.isArray(diagnostic.consistencyIssues) ? diagnostic.consistencyIssues.slice(0, 20) : [],
                    fatalIssues: Array.isArray(diagnostic.consistencyFatalIssues) ? diagnostic.consistencyFatalIssues.slice(0, 20) : [],
                    warnings: Array.isArray(diagnostic.consistencyWarnings) ? diagnostic.consistencyWarnings.slice(0, 20) : [],
                    studentStepCounts: alignment.questions.map((q) => ({ sourceKey: q.sourceKey, studentStepCount: q.pairedSteps.length, expectedNodeCount: q.expectedSteps.length, unmatchedExplanationCount: Array.isArray(q.unmatchedExplanationUnits) ? q.unmatchedExplanationUnits.length : 0 })),
                    issueClasses: Array.isArray(diagnostic.consistencyIssues) ? [...new Set(diagnostic.consistencyIssues.map((issue) => String(issue || '').split(':')[0]).filter(Boolean))].slice(0, 20) : [],
                    preservedQuestionCount: Array.isArray(finalReview?.questions) ? finalReview.questions.length : 0,
                    preservedStepCount: Array.isArray(finalReview?.questions) ? finalReview.questions.reduce((sum, question) => sum + (Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks.length : 0), 0) : 0,
                    safeRefusalSourcePreserved: true
                }, true);
                const primaryDraft = { ...finalReview, canonicalSourceKeys: finalReview.questions.map((question) => String(question.sourceKey || '').trim()), attributionDiagnostics: questionAttributionDiagnostics(finalReview) };
                return await schedule(task._id, STAGES.FINALIZING_RESULT, {
                    primaryDraft, reviewDraft: finalReview, mergedDraft: finalReview, hardProblemV10DiagnosticDraft: diagnostic,
                    hardProblemV10Draft: null, hardProblemV9Draft: null, hardProblemAlignmentDraft: null, hardProblemEvidenceRetryCount: 0,
                    hardProblemReviewRecoveryCount: 0, hardProblemReviewLastFailure: null, reviewTransportAttempt: 0, finalizationRecoveryCount: 0
                }, executionFence);
            }
            if (!isCareless(task) && usesHardProblemV9(strategy)) {
                if (!task.hardProblemV9Draft) throw Object.assign(new Error('缺少难题V9理解快照'), { code: 'TASK_HARD_PROBLEM_V9_DRAFT_MISSING' });
                const d = task.hardProblemV9Draft;
                const alignment = hardProblemV9.buildFixedAlignment(d.evidence, d.plan, d.coverage);
                const fixedReview = await gradeHardProblemFixedSteps(task, transportAttempt, studentUrls, answerUrls, strategy, alignment, executionFence);
                const reviewed = fixedReview.result;
                const gated = gateStudentVisibleText(reviewed, task, 'review');
                validateQuestionAttribution(gated);
                const diagnostic = hardProblemV9.buildDiagnosticSnapshot({ evidence: d.evidence, method: d.method, plan: d.plan, coverage: d.coverage, alignment, reviewResult: gated });
                const primaryDraft = { ...gated, canonicalSourceKeys: gated.questions.map((question) => String(question.sourceKey || '').trim()), attributionDiagnostics: questionAttributionDiagnostics(gated) };
                return await schedule(task._id, STAGES.FINALIZING_RESULT, {
                    primaryDraft, reviewDraft: gated, mergedDraft: gated, hardProblemV9DiagnosticDraft: diagnostic,
                    hardProblemV9Draft: null, hardProblemAlignmentDraft: null, hardProblemEvidenceRetryCount: 0,
                    hardProblemReviewRecoveryCount: 0, hardProblemReviewLastFailure: null, reviewTransportAttempt: 0, finalizationRecoveryCount: 0
                }, executionFence);
            }
            if (!isCareless(task) && usesHardProblemEvidencePipeline(strategy)) {
                if (!task.hardProblemEvidenceDraft || !task.hardProblemAlignmentDraft)
                    throw Object.assign(new Error('缺少难题原文提取或配对结果'), { code: 'TASK_HARD_PROBLEM_EVIDENCE_MISSING' });
                const alignment = alignHardProblemEvidence(task.hardProblemEvidenceDraft);
                const fixedReview = await gradeHardProblemFixedSteps(task, transportAttempt, studentUrls, answerUrls, strategy, alignment, executionFence);
                if (fixedReview.evidenceAudit.hasClearOmission && Number(task.hardProblemEvidenceRetryCount || 0) < 1) {
                    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_EVIDENCE_RETRY_REQUESTED', { taskId: task._id, omissions: fixedReview.evidenceAudit.omissions.map((item) => ({ sourceKey: item.sourceKey, reasonPresent: Boolean(item.reason) })) }, true);
                    return await schedule(task._id, STAGES.PRIMARY_GRADING, {
                        hardProblemEvidenceDraft: null,
                        hardProblemAlignmentDraft: null,
                        primaryDraft: null,
                        reviewDraft: null,
                        mergedDraft: null,
                        hardProblemEvidenceRetryCount: 1,
                        hardProblemReviewRecoveryCount: 0,
                        hardProblemReviewLastFailure: null,
                        primaryTransportAttempt: 0,
                        reviewTransportAttempt: 0,
                        statusMessage: '检测到原文可能遗漏，正在重新识别'
                    }, executionFence);
                }
                const reviewed = fixedReview.result;
                if (fixedReview.evidenceAudit.hasClearOmission) {
                    reviewed.validationWarnings = [...new Set([...(Array.isArray(reviewed.validationWarnings) ? reviewed.validationWarnings : []), 'HARD_PROBLEM_EVIDENCE_OMISSION_UNRESOLVED'])];
                }
                const gated = gateStudentVisibleText(reviewed, task, 'review');
                validateQuestionAttribution(gated);
                const evidenceDiagnostics = task.hardProblemEvidenceDraft?._modelDiagnostics || null;
                const primaryDraft = { ...gated, _modelDiagnostics: evidenceDiagnostics, canonicalSourceKeys: gated.questions.map((question) => String(question.sourceKey || '').trim()), attributionDiagnostics: questionAttributionDiagnostics(gated) };
                return await schedule(task._id, STAGES.FINALIZING_RESULT, {
                    primaryDraft,
                    reviewDraft: gated,
                    mergedDraft: gated,
                    hardProblemEvidenceDraft: null,
                    hardProblemAlignmentDraft: null,
                    hardProblemEvidenceRetryCount: 0,
                    hardProblemReviewRecoveryCount: 0,
                    hardProblemReviewLastFailure: null,
                    reviewTransportAttempt: 0,
                    finalizationRecoveryCount: 0
                }, executionFence);
            }
            if (!task.primaryDraft)
                throw Object.assign(new Error('缺少首次批改结果'), { code: 'TASK_PRIMARY_DRAFT_MISSING' });
            const rawReview = await grade(task, 'lite', 2, transportAttempt, studentUrls, answerUrls, strategy, task.primaryDraft, executionFence);
            const restoredRawReview = restoreReviewQuestionAttribution(task.primaryDraft, rawReview, { allowUnmapped: true });
            const review = isCareless(task) ? (isCalculationCareless(task) ? validateCalculationCarelessTrainingGradeResult(restoredRawReview, strategy) : validateCarelessTrainingGradeResult(restoredRawReview, 'draft', strategy)) : validateHardProblemGradeResult(restoredRawReview, strategy);
            if (isCareless(task))
                monitorCarelessDraftShape(task, 'lite', 2, review);
            const gatedReview = gateStudentVisibleText(review, task, 'review');
            const restoredReview = restoreReviewQuestionAttribution(task.primaryDraft, gatedReview);
            validateQuestionAttribution(restoredReview);
            const merged = isCareless(task) ? (isCalculationCareless(task) ? mergeCalculationCarelessTrainingResults(task.primaryDraft, restoredReview, strategy) : mergeCarelessTrainingResults(task.primaryDraft, restoredReview, strategy)) : mergeHardProblemResults(task.primaryDraft, restoredReview, strategy);
            validateQuestionAttribution(merged);
            return await schedule(task._id, STAGES.FINALIZING_RESULT, { reviewDraft: restoredReview, mergedDraft: merged, reviewTransportAttempt: 0, carelessReviewRecoveryContext: null, finalizationRecoveryCount: 0 }, executionFence);
        }
        if (stage === STAGES.FINALIZING_RESULT) {
            if (!task.primaryDraft || !task.reviewDraft || !task.mergedDraft) {
                const missingDrafts = ['primaryDraft', 'reviewDraft', 'mergedDraft'].filter((fieldName) => !task[fieldName]);
                const recoveryCount = Number(task.finalizationRecoveryCount || 0);
                if (!isCareless(task) && usesHardProblemDirect(strategy) && recoveryCount < 1) {
                    const nextStage = task.primaryDraft ? STAGES.REVIEW_GRADING : STAGES.PRIMARY_GRADING;
                    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_FINAL_HANDOFF_RECOVERY', { taskId: task._id, missingDrafts, nextStage, recoveryAttempt: recoveryCount + 1 }, true);
                    return await schedule(task._id, nextStage, {
                        ...(task.primaryDraft ? {} : { primaryDraft: null }),
                        reviewDraft: null,
                        mergedDraft: null,
                        finalizationRecoveryCount: recoveryCount + 1,
                        primaryTransportAttempt: nextStage === STAGES.PRIMARY_GRADING ? 0 : Number(task.primaryTransportAttempt || 0),
                        reviewTransportAttempt: 0,
                        statusMessage: nextStage === STAGES.REVIEW_GRADING ? '复核结果交接不完整，正在自动复核' : '批改结果交接不完整，正在自动重建'
                    }, executionFence);
                }
                if (isCareless(task) && recoveryCount < 1) {
                    const nextStage = task.primaryDraft ? STAGES.REVIEW_GRADING : STAGES.PRIMARY_GRADING;
                    (0, audit_1.monitor)(auditSource, 'CARELESS_FINAL_HANDOFF_RECOVERY', { taskId: task._id, missingDrafts, nextStage, recoveryAttempt: recoveryCount + 1 }, true);
                    return await schedule(task._id, nextStage, {
                        ...(nextStage === STAGES.PRIMARY_GRADING ? { primaryDraft: null, carelessPrimaryRecoveryCount: 0 } : {}),
                        reviewDraft: null,
                        mergedDraft: null,
                        carelessReviewRecoveryCount: 0,
                        finalizationRecoveryCount: recoveryCount + 1,
                        primaryTransportAttempt: nextStage === STAGES.PRIMARY_GRADING ? 0 : Number(task.primaryTransportAttempt || 0),
                        reviewTransportAttempt: 0,
                        statusMessage: nextStage === STAGES.REVIEW_GRADING ? '复核结果交接不完整，正在自动复核' : '批改结果交接不完整，正在自动重建'
                    }, executionFence);
                }
                const v10RecoveryBase = !isCareless(task) && usesHardProblemV10(strategy)
                    ? (task.hardProblemV10DiagnosticDraft?.evidence ? task.hardProblemV10DiagnosticDraft : task.hardProblemV10Draft?.evidence ? task.hardProblemV10Draft : null)
                    : null;
                if (v10RecoveryBase?.evidence && recoveryCount < 1) {
                    const recoveryError = Object.assign(new Error('V10 最终结果交接不完整'), { code: 'TASK_REVIEW_DRAFT_MISSING', fieldPath: missingDrafts.join(',') });
                    const diagnostic = buildHardProblemV10RecoveryDiagnostic(task, v10RecoveryBase, recoveryError, STAGES.FINALIZING_RESULT);
                    let alignment = null;
                    try {
                        if (v10RecoveryBase.reasoningHypotheses && v10RecoveryBase.coverage) alignment = hardProblemV10.buildFixedAlignment(v10RecoveryBase.evidence, v10RecoveryBase.reasoningHypotheses, v10RecoveryBase.coverage);
                    } catch (alignmentError) {
                        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_FINAL_HANDOFF_ALIGNMENT_FAILED', { taskId: task._id, errorCode: String(alignmentError?.code || 'ALIGNMENT_FAILED').slice(0, 80) }, true);
                    }
                    const safeResult = buildHardProblemV10SafeRefusalNoThrow(diagnostic, { questions: [] }, strategy, alignment);
                    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_FINAL_HANDOFF_SAFE_RECOVERY', {
                        taskId: task._id, missingDrafts, recoveryAttempt: recoveryCount + 1,
                        preservedQuestionCount: Array.isArray(safeResult?.questions) ? safeResult.questions.length : 0,
                        preservedStepCount: Array.isArray(safeResult?.questions) ? safeResult.questions.reduce((sum, question) => sum + (Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks.length : 0), 0) : 0
                    }, true);
                    const safeTask = { ...task, primaryDraft: safeResult, reviewDraft: safeResult, mergedDraft: safeResult, hardProblemV10DiagnosticDraft: diagnostic, finalizationRecoveryCount: recoveryCount + 1 };
                    return await persistResult(safeTask, safeResult, executionFence, strategy.version || strategy.strategyVersion || '', strategy);
                }
                const canRecoverHardProblem = !isCareless(task)
                    && Boolean(task.hardProblemEvidenceDraft)
                    && Boolean(task.hardProblemAlignmentDraft)
                    && recoveryCount < 1;
                if (canRecoverHardProblem) {
                    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_FINALIZATION_DRAFT_RECOVERY', {
                        taskId: task._id,
                        stage,
                        diagnostics: { missingDrafts, recoveryCount }
                    }, true);
                    return await schedule(task._id, STAGES.REVIEW_GRADING, {
                        primaryDraft: null,
                        reviewDraft: null,
                        mergedDraft: null,
                        finalizationRecoveryCount: recoveryCount + 1,
                        reviewTransportAttempt: 0,
                        statusMessage: '复核结果交接不完整，正在自动恢复'
                    }, executionFence);
                }
                throw Object.assign(new Error('复核结果不完整'), {
                    code: 'TASK_REVIEW_DRAFT_MISSING',
                    diagnostics: { missingDrafts, recoveryCount, evidenceDraftPresent: Boolean(task.hardProblemEvidenceDraft), alignmentDraftPresent: Boolean(task.hardProblemAlignmentDraft) }
                });
            }
            if (isCareless(task))
                task.mergedDraft = isCalculationCareless(task) ? validateCalculationCarelessTrainingGradeResult(task.mergedDraft, strategy) : validateCarelessTrainingGradeResult(task.mergedDraft, 'final', strategy);
            try {
                return await persistResult(task, task.mergedDraft, executionFence, strategy.version || strategy.strategyVersion || '', strategy);
            } catch (error) {
                if (!isCareless(task) && usesHardProblemV10(strategy) && task.hardProblemV10DiagnosticDraft?.evidence && hardProblemFinalRecoverable(error)) {
                    const baseDiagnostic = task.hardProblemV10DiagnosticDraft;
                    const recoveryDiagnostic = buildHardProblemV10RecoveryDiagnostic(task, baseDiagnostic, error, STAGES.FINALIZING_RESULT);
                    recoveryDiagnostic.consistencyIssues = [...new Set([...(Array.isArray(baseDiagnostic.consistencyIssues) ? baseDiagnostic.consistencyIssues : []), ...(Array.isArray(recoveryDiagnostic.consistencyIssues) ? recoveryDiagnostic.consistencyIssues : [])])];
                    let alignment = null;
                    try { alignment = hardProblemV10.buildFixedAlignment(baseDiagnostic.evidence, baseDiagnostic.reasoningHypotheses, baseDiagnostic.coverage); }
                    catch (alignmentError) {
                        (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_FINAL_RECOVERY_ALIGNMENT_FAILED', { taskId: task._id, errorCode: String(alignmentError?.code || 'ALIGNMENT_FAILED').slice(0, 80) }, true);
                    }
                    const safeResult = buildHardProblemV10SafeRefusalNoThrow(recoveryDiagnostic, task.reviewDraft || task.mergedDraft || { questions: [] }, strategy, alignment);
                    (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_FINAL_CONTRACT_SAFE_REFUSAL', {
                        taskId: task._id,
                        errorCode: String(error?.code || 'FINAL_CONTRACT_FAILED').slice(0, 100),
                        fieldPath: typeof error?.fieldPath === 'string' ? error.fieldPath.slice(0, 200) : null,
                        preservedQuestionCount: Array.isArray(safeResult?.questions) ? safeResult.questions.length : 0,
                        preservedStepCount: Array.isArray(safeResult?.questions) ? safeResult.questions.reduce((sum, question) => sum + (Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks.length : 0), 0) : 0
                    }, true);
                    const safeTask = { ...task, primaryDraft: safeResult, reviewDraft: safeResult, mergedDraft: safeResult, hardProblemV10DiagnosticDraft: recoveryDiagnostic };
                    return await persistResult(safeTask, safeResult, executionFence, strategy.version || strategy.strategyVersion || '', strategy);
                }
                throw error;
            }
        }
        throw Object.assign(new Error(`不支持的任务阶段: ${stage}`), { code: 'TASK_STAGE_UNSUPPORTED' });
    }
    catch (error) {
        if (isCareless(task) && carelessStageRecoverable(error, stage)) {
            const recoveryField = stage === STAGES.PRIMARY_GRADING ? 'carelessPrimaryRecoveryCount' : 'carelessReviewRecoveryCount';
            const recoveryCount = Number(task[recoveryField] || 0);
            if (recoveryCount < CARELESS_STAGE_MAX_RECOVERY) {
                const diagnostics = hardProblemFailureDiagnostics(error, task, stage);
                const reviewRecoveryContext = stage === STAGES.REVIEW_GRADING ? carelessReviewRecoveryContextFromError(error, recoveryCount + 1) : null;
                (0, audit_1.monitor)(auditSource, 'CARELESS_STAGE_RECOVERY_SCHEDULED', {
                    taskId: task._id, stage, recoveryAttempt: recoveryCount + 1, recoveryField,
                    ...(Array.isArray(error?.missingPrimaryQuestionIds) && error.missingPrimaryQuestionIds.length ? { missingPrimaryQuestionIds: error.missingPrimaryQuestionIds.slice(0, 20) } : {}),
                    ...(error?.questionSetAuditDiagnostics ? { diagnostics: { ...diagnostics, questionSetAudit: error.questionSetAuditDiagnostics } } : {}),
                    ...diagnostics
                }, true);
                return await schedule(task._id, stage, {
                    [recoveryField]: recoveryCount + 1,
                    ...(stage === STAGES.PRIMARY_GRADING
                        ? { primaryDraft: null, reviewDraft: null, mergedDraft: null, carelessReviewRecoveryContext: null, primaryTransportAttempt: 0, reviewTransportAttempt: 0 }
                        : {
                            reviewDraft: null, mergedDraft: null, reviewTransportAttempt: 0,
                            carelessReviewRecoveryContext: reviewRecoveryContext
                        }),
                    statusMessage: stage === STAGES.PRIMARY_GRADING ? '首次识别结果不完整，正在重新识别' : (Array.isArray(error?.missingPrimaryQuestionIds) && error.missingPrimaryQuestionIds.length ? '复核遗漏已识别题目，正在定向重新复核' : '复核题目归属异常，正在重新复核')
                }, executionFence);
            }
        }
        const directRetryCount = Number(task.hardProblemDirectRetryCount || 0);
        if (stage === STAGES.PRIMARY_GRADING && !isCareless(task) && usesHardProblemDirect(strategy)
            && hardProblemDirectRecoverable(error) && directRetryCount < 1) {
            (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_DIRECT_PRIMARY_RETRY_SCHEDULED', {
                taskId: task._id,
                recoveryAttempt: directRetryCount + 1,
                errorCode: String(error?.code || 'UNKNOWN').slice(0, 100),
                fieldPath: typeof error?.fieldPath === 'string' ? error.fieldPath.slice(0, 200) : null
            }, true);
            return await schedule(task._id, STAGES.PRIMARY_GRADING, {
                hardProblemDirectRetryCount: directRetryCount + 1,
                primaryDraft: null, reviewDraft: null, mergedDraft: null,
                primaryTransportAttempt: 0, reviewTransportAttempt: 0,
                statusMessage: '首次批改结果格式异常，正在重新批改'
            }, executionFence);
        }
        const evidenceRetryCount = Number(task.hardProblemEvidenceRetryCount || 0);
        if (stage === STAGES.PRIMARY_GRADING && !isCareless(task) && (usesHardProblemV10(strategy) || usesHardProblemV9(strategy) || usesHardProblemEvidencePipeline(strategy))
            && String(error?.code || '') === 'HARD_PROBLEM_EVIDENCE_SCHEMA_ERROR' && evidenceRetryCount < 1) {
            const diagnostics = hardProblemFailureDiagnostics(error, task, stage);
            (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_EVIDENCE_RECOVERY_SCHEDULED', {
                taskId: task._id, stage, recoveryAttempt: evidenceRetryCount + 1, ...diagnostics
            }, true);
            return await schedule(task._id, stage, {
                hardProblemEvidenceRetryCount: evidenceRetryCount + 1,
                hardProblemV10Draft: null,
                hardProblemV9Draft: null,
                hardProblemEvidenceDraft: null,
                hardProblemAlignmentDraft: null,
                primaryTransportAttempt: 0,
                statusMessage: '原文结构异常，正在重新识别'
            }, executionFence);
        }
        const reviewRecoveryCount = Number(task.hardProblemReviewRecoveryCount || 0);
        if (stage === STAGES.REVIEW_GRADING && !isCareless(task) && (usesHardProblemV10(strategy) || usesHardProblemV9(strategy) || usesHardProblemEvidencePipeline(strategy))
            && hardProblemReviewRecoverable(error) && reviewRecoveryCount < HARD_PROBLEM_REVIEW_MAX_RECOVERY) {
            const diagnostics = hardProblemFailureDiagnostics(error, task, stage);
            (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_REVIEW_RECOVERY_SCHEDULED', {
                taskId: task._id,
                stage,
                recoveryAttempt: reviewRecoveryCount + 1,
                ...diagnostics
            }, true);
            return await schedule(task._id, stage, {
                hardProblemReviewRecoveryCount: reviewRecoveryCount + 1,
                hardProblemReviewLastFailure: diagnostics,
                reviewTransportAttempt: 0,
                statusMessage: '批改结果结构异常，正在自动修复并重试'
            }, executionFence);
        }
        if (stage === STAGES.REVIEW_GRADING && !isCareless(task) && usesHardProblemV10(strategy)
            && hardProblemReviewRecoverable(error) && reviewRecoveryCount >= HARD_PROBLEM_REVIEW_MAX_RECOVERY
            && task.hardProblemV10Draft?.evidence) {
            const diagnostics = hardProblemFailureDiagnostics(error, task, stage);
            const d = task.hardProblemV10Draft;
            let alignment = null;
            try { alignment = hardProblemV10.buildFixedAlignment(d.evidence, d.reasoningHypotheses, d.coverage); }
            catch (alignmentError) {
                (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_RECOVERY_ALIGNMENT_FAILED', { taskId: task._id, errorCode: String(alignmentError?.code || 'ALIGNMENT_FAILED').slice(0, 80) }, true);
            }
            const diagnostic = buildHardProblemV10RecoveryDiagnostic(task, d, error, stage);
            const safeResult = buildHardProblemV10SafeRefusalNoThrow(diagnostic, task.reviewDraft || task.primaryDraft || { questions: [] }, strategy, alignment);
            (0, audit_1.monitor)(auditSource, 'HARD_PROBLEM_V10_REVIEW_TERMINAL_SAFE_REFUSAL', {
                taskId: task._id,
                recoveryAttempt: reviewRecoveryCount,
                preservedQuestionCount: Array.isArray(safeResult?.questions) ? safeResult.questions.length : 0,
                preservedStepCount: Array.isArray(safeResult?.questions) ? safeResult.questions.reduce((sum, question) => sum + (Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks.length : 0), 0) : 0,
                ...diagnostics
            }, true);
            return await schedule(task._id, STAGES.FINALIZING_RESULT, {
                primaryDraft: safeResult,
                reviewDraft: safeResult,
                mergedDraft: safeResult,
                hardProblemV10DiagnosticDraft: diagnostic,
                hardProblemV10Draft: null,
                hardProblemV9Draft: null,
                hardProblemAlignmentDraft: null,
                hardProblemReviewLastFailure: diagnostics,
                reviewTransportAttempt: 0,
                finalizationRecoveryCount: 0,
                statusMessage: '复核结果异常，已保留逐步原文并生成安全结果'
            }, executionFence);
        }
        if (transient(error) && transportAttempt === 1) {
            return await schedule(task._id, stage, { [field]: 1, statusMessage: '批改服务短暂波动，正在自动重试' }, executionFence);
        }
        throw error;
    }
}
async function claim(taskId) {
    if (!taskId)
        return { reason: 'MISSING_TASK_ID' };
    return context_1.db.runTransaction(async (transaction) => {
        const ref = transaction.collection(constants_1.C.tasks).doc(taskId);
        const task = firstDocument(await ref.get());
        if (!task)
            return { reason: 'TASK_NOT_FOUND' };
        if (['FAILED', 'COMPLETED', 'NEED_CONFIRMATION', 'NEED_ANSWER'].includes(task.status))
            return { reason: 'TASK_TERMINAL' };
        if (task.leaseUntil && new Date(task.leaseUntil).getTime() > Date.now())
            return { reason: 'LEASE_ACTIVE' };
        const currentStage = task.currentStage === 'QUEUED' ? STAGES.PREPARING_IMAGES : (task.currentStage || STAGES.PREPARING_IMAGES);
        const patch = { status: 'PROCESSING', currentStage, progress: Math.max(Number(task.progress || 0), progressFor(currentStage)), statusMessage: stageMessage(currentStage), leaseOwner: (0, utils_1.randomId)('lease'), leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: (0, utils_1.now)() };
        await ref.update({ data: patch });
        return { reason: 'CLAIMED', task: { ...task, ...patch } };
    });
}
async function failTask({ taskId, stage, error, executionFence = null }) {
    const failure = (0, task_error_1.mapTaskFailure)(error, stage);
    const task = await readTask(taskId).catch(() => null);
    const failureId = (0, utils_1.randomId)('failure');
    const failureDiagnostics = hardProblemFailureDiagnostics(error, task, stage);
    const written = await updateTaskWithFence(taskId, {
        status: failure.status || 'FAILED', currentStage: failure.stage || 'FAILED', failedStage: failure.status === 'FAILED' ? stage : null,
        errorCode: failure.errorCode, errorMessage: failure.userMessage, errorSuggestion: failure.userSuggestion,
        retryable: failure.retryable, failureCategory: failure.failureCategory, failureId,
        failureCauseCode: failureDiagnostics.causeCode, failureFieldPath: failureDiagnostics.fieldPath,
        failureRequestStage: failureDiagnostics.requestStage, failureModelProvider: failureDiagnostics.modelProvider,
        failureModelName: failureDiagnostics.modelName, failureProviderRequestIdPresent: failureDiagnostics.providerRequestIdPresent,
        failureRepairAttempted: failureDiagnostics.repairAttempted, failureRepairAttemptCount: failureDiagnostics.repairAttemptCount,
        failureRepairFailureStage: failureDiagnostics.repairFailureStage,
        failedAt: (0, utils_1.now)(), leaseOwner: null, leaseUntil: null, updatedAt: (0, utils_1.now)()
    }, executionFence);
    if (!written) return false;
    const failedTask = await readTask(taskId).catch(() => null);
    if (failedTask?.status === 'FAILED') {
      await taskFailureCase.archiveTaskFailureCase({
        db: context_1.db,
        task: failedTask,
        error,
        archiveSource: auditSource,
        runtimeBuildId: null,
        archivedAt: failedTask.failedAt || (0, utils_1.now)()
      }).catch((archiveError) => {
        (0, audit_1.monitor)(auditSource, 'TASK_FAILURE_ARCHIVE_FAILED', {
          taskId,
          errorCode: String(archiveError?.code || 'TASK_FAILURE_ARCHIVE_FAILED').slice(0, 100)
        }, true);
      });
    }
    const errorDetails = (0, utils_1.safeError)(error);
    const diagnostics = errorDetails.schemaValidation ? { schemaValidation: errorDetails.schemaValidation }
        : errorDetails.strategyContract ? { strategyContract: errorDetails.strategyContract }
            : errorDetails.repairValidation ? { repairValidation: errorDetails.repairValidation } : null;
    (0, audit_1.monitor)(auditSource, 'TASK_STAGE_FAILED', {
        taskId, stage, failureId,
        errorCode: errorDetails.code || 'TASK_PROCESS_FAILED', causeCode: failureDiagnostics.causeCode,
        fieldPath: failureDiagnostics.fieldPath, requestStage: failureDiagnostics.requestStage,
        modelProvider: failureDiagnostics.modelProvider, modelName: failureDiagnostics.modelName,
        providerRequestIdPresent: failureDiagnostics.providerRequestIdPresent,
        repairAttempted: failureDiagnostics.repairAttempted, repairAttemptCount: failureDiagnostics.repairAttemptCount,
        errorMessage: errorDetails.message, errorDetails, diagnostics
    }, true);
    return true;
}

  const loadTask = async (taskId) => firstDocument(await context_1.db.collection(constants_1.C.tasks).doc(taskId).get());
  return { context: context_1, claim, loadTask, process, fail: failTask, defaultStage: STAGES.PREPARING_IMAGES, test: { STAGES, process, tempUrls, transient, schedule, triggerContinuation, markContinuationFailureIfStillQueued, validateCarelessTrainingGradeResult, validateCalculationCarelessTrainingGradeResult, validateHardProblemGradeResult, normalizeHardProblemsResult, restoreReviewQuestionAttribution, mergeCarelessTrainingResults, consolidateReadingQuestions, canonicalizeQuestionBaseline, readingQuestionIdentity, readingImageIdentity, canonicalQuestionIdentity, calculationCarelessSummary, wrongQuestionDocumentId, legacyCarelessTypeForWrongRecord, mergeCalculationCarelessTrainingResults, mergeHardProblemResults, compactReviewPayload, primaryReviewQuestionContract, reviewContractInstruction, hardProblemReviewRecoveryInstruction, assertHardProblemExplanationContract, usesHardProblemDirect, normalizeHardProblemDirectDraft, normalizeHardProblemDirectReview, adaptHardProblemDirectDraft, directDraftFromBusiness, directReferenceAnswerForQuestion, directObjectiveAnswerForQuestion, applyHardProblemDirectDeterministicFields, hardProblemDirectRequiredFieldGaps, usesHardProblemV10, usesHardProblemV9, usesHardProblemEvidencePipeline, hardProblemPerceptionProvider, hardProblemDirectRecoverable, buildHardProblemDirectDiagnostic, validateHardProblemEvidenceResult, alignHardProblemEvidence, buildExpectedPlanGroups, enforceFixedHardProblemSteps, normalizeFixedHardProblemAggregates, fixedStepMeta, hardProblemReviewRecoverable, hardProblemFailureDiagnostics, hardProblemDraftBytes, compactHardProblemAlignmentDraft, buildHardProblemV10SafeRefusalResult, buildHardProblemV10SafeRefusalNoThrow, buildHardProblemV10EmergencySafeRefusalResult, hardProblemFinalRecoverable, carelessStageRecoverable, carelessReviewRecoveryContextFromError, CARELESS_STAGE_MAX_RECOVERY, HARD_PROBLEM_TASK_DRAFT_MAX_BYTES, HARD_PROBLEM_REVIEW_MAX_RECOVERY, HARD_PROBLEM_UNDERSTANDING_MAX_RECOVERY, LEASE_MS, WORKER_BUDGET_MS, AI_TIMEOUT_MS } };
}

function createGradingRuntimeFromModuleRoot({ moduleRoot, context, auditSource, scheduleNextStage, enqueueTts, getFirstDocument, deferStagePersistence = false }) {
  const load = (file) => require(path.join(moduleRoot, file));
  return createGradingRuntime({
    context,
    auditSource,
    constants: load('constants'),
    audit: load('audit'),
    ark: load('ark'),
    utils: load('utils'),
    checkin: load('checkin'),
    taskError: load('task-error'),
    taskFailureCase: load('task-failure-case'),
    json: load('json'),
    embedded: load('strategy/embedded'),
    remote: load('strategy/remote'),
    strategyRender: load('strategy/render'),
    resultSemantics: load('result-semantics'),
    scheduleNextStage,
    enqueueTts,
    getFirstDocument,
    deferStagePersistence
  });
}

module.exports = { executeGradingTask, createGradingRuntime, createGradingRuntimeFromModuleRoot };
