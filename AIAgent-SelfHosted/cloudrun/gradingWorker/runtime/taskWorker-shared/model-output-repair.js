'use strict';

const { resolveRuntimeSchema, matchesRuntimeType, nullableValueAllowed, collectNewModelResultIssues, deriveHardProblemAggregateState, deriveHardProblemErrorType, normalizeHardProblemQuestion } = require('./output-schema-validator');

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function repairValidationDiagnostics(strategy = null, diagnostics = {}) {
  const source = isObject(diagnostics) ? diagnostics : {};
  return { ...source, strategy: source.strategy || strategy || null };
}

function isRepairableModelOutputError(error, strategy = null, diagnostics = {}) {
  if (error?.code === 'LLM_SCHEMA_ERROR') return true;
  if (!Array.isArray(error?.issues) || !error.issues.length || !error.issues.every((item) => item?.repairable === true) || !isObject(error?.modelOutput)) return false;
  const schema = resolveRuntimeSchema(strategy, error.modelOutput.outputSchemaVersion);
  if (!schema) return false;
  const currentIssues = collectNewModelResultIssues(error.modelOutput, repairValidationDiagnostics(strategy, diagnostics));
  if (!currentIssues.length || currentIssues.some((item) => item.repairable !== true) || error.code !== currentIssues[0].code) return false;
  const suppliedIssueKeys = new Set(error.issues.map(issueKey));
  return currentIssues.every((item) => suppliedIssueKeys.has(issueKey(item)));
}

// This protects the atomic merge boundary. Repair planning itself relies only on
// collectNewModelResultIssues so validation and planning cannot drift apart.
function hasProtectedStructure(output, schema) {
  if (!isObject(output) || output.outputSchemaVersion !== schema.schemaId || !Array.isArray(output.questions)) return true;
  const sourceKeys = new Set();
  for (const question of output.questions) {
    if (!isObject(question) || question.outputSchemaVersion !== schema.schemaId) return true;
    if (typeof question.sourceKey !== 'string' || !question.sourceKey.trim() || typeof question.questionText !== 'string' || !question.questionText.trim()) return true;
    if (sourceKeys.has(question.sourceKey)) return true;
    sourceKeys.add(question.sourceKey);
  }
  return false;
}

const issueKey = (item) => `${item.code || 'LLM_SCHEMA_ERROR'}:${item.fieldPath || ''}`;
const sameJsonValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function hasSameQuestionIdentity(originalOutput, candidateOutput) {
  if (!Array.isArray(originalOutput?.questions) || !Array.isArray(candidateOutput?.questions) || originalOutput.questions.length !== candidateOutput.questions.length) return false;
  return originalOutput.questions.every((question, index) => question?.sourceKey === candidateOutput.questions[index]?.sourceKey);
}

function prepareModelOutputRepair(error, strategy = null, diagnostics = {}) {
  const originalOutput = error?.modelOutput;
  const validationDiagnostics = repairValidationDiagnostics(strategy, diagnostics);
  if (!isRepairableModelOutputError(error, strategy, validationDiagnostics) || !isObject(originalOutput)) return null;
  const schema = resolveRuntimeSchema(strategy, originalOutput.outputSchemaVersion);
  if (!schema) return null;
  const issues = collectNewModelResultIssues(originalOutput, validationDiagnostics);
  if (!issues.length || issues.some((item) => item.repairable !== true)) return null;
  const baseRepairIssues = issues.filter((item) => item.repairable === true).flatMap((issue) => {
    if (issue.code !== 'CALCULATION_CARELESS_WORK_COMPLETE_CONSTRAINT' && issue.code !== 'CALCULATION_CARELESS_WORK_INCOMPLETE_CONSTRAINT') return [issue];
    return [issue, ...(issue.relatedFieldPaths || []).map((fieldPath) => ({ ...issue, fieldPath }))];
  });
  const dependencyExpansion = expandHardProblemStepDependencies(originalOutput, baseRepairIssues);
  const repairIssues = dependencyExpansion.issues;
  const repairFields = repairIssues.filter((item, index, all) => all.findIndex((candidate) => candidate.fieldPath === item.fieldPath) === index).map((issue) => {
    const { fieldPath, message, reason, validator } = issue;
    const rule = repairFieldRule(fieldPath, repairFieldLocation(fieldPath), originalOutput, schema);
    return { fieldPath, issueCode: issue.code, validator, expectedType: rule.expectedType, nullable: rule.nullable, allowedEnums: rule.allowedEnums, validCandidateValues: validCandidateValues(originalOutput, schema, validationDiagnostics, issues, issue, rule), semanticConstraint: issue.semanticConstraint || null, relatedFieldPaths: issue.relatedFieldPaths || [], repairReason: issue.repairReason || reason || null, numericMinimum: rule.numericMinimum, numericMaximum: rule.numericMaximum, questionIndex: rule.question ? repairFieldLocation(fieldPath)[1] : null, expectedSourceKey: rule.expectedSourceKey, originalValidationReason: reason || issue.repairReason || `${validator}: ${message}` };
  });
  return { originalOutput, schema, issues, fields: repairFields, fieldPaths: repairFields.map(({ fieldPath }) => fieldPath), validationContext: { ...validationDiagnostics, strategy: validationDiagnostics.strategy || null, initialIssues: issues, hardProblemDerivedQuestionIndexes: dependencyExpansion.derivedQuestionIndexes } };
}

function expandHardProblemStepDependencies(originalOutput, issues) {
  const expanded = [...issues];
  const aggregateFields = new Set(['stepStatus', 'logicStatus', 'errorType', 'firstWrongStep', 'errorReason', 'adjustmentSuggestion', 'overallFeedback']);
  const upstreamJudgmentFields = new Set(['finalAnswerCorrect']);
  const add = (fieldPath, semanticConstraint, relatedFieldPaths = []) => {
    if (expanded.some((item) => item.fieldPath === fieldPath)) return;
    expanded.push({
      code: 'LLM_SCHEMA_ERROR',
      fieldPath,
      validator: 'hard-problem-step-dependent-repair',
      repairable: true,
      semanticConstraint,
      repairReason: semanticConstraint,
      relatedFieldPaths,
    });
  };
  const parentArrayQuestions = new Set();
  const stepAffectedQuestions = new Set();
  const derivedQuestionIndexes = new Set();
  const affectedStepStatuses = new Map();
  for (const issue of issues) {
    const fieldPath = String(issue?.fieldPath || '');
    const parentMatch = /^questions\[(\d+)\]\.stepFeedbacks$/.exec(fieldPath);
    if (parentMatch) {
      const questionIndex = Number(parentMatch[1]);
      parentArrayQuestions.add(questionIndex);
      stepAffectedQuestions.add(questionIndex);
      derivedQuestionIndexes.add(questionIndex);
      continue;
    }
    const nestedMatch = /^questions\[(\d+)\]\.stepFeedbacks\[(\d+)\]\.([A-Za-z_$][\w$]*)$/.exec(fieldPath);
    if (nestedMatch) {
      const questionIndex = Number(nestedMatch[1]);
      const stepIndex = Number(nestedMatch[2]);
      const itemField = nestedMatch[3];
      if (['solutionStatus', 'explanationStatus', 'logicStatus', 'correctionAdvice'].includes(itemField)) {
        stepAffectedQuestions.add(questionIndex);
        derivedQuestionIndexes.add(questionIndex);
      }
      if (['solutionStatus', 'explanationStatus', 'logicStatus'].includes(itemField)) {
        const key = `${questionIndex}:${stepIndex}`;
        affectedStepStatuses.set(key, { questionIndex, stepIndex });
      }
      continue;
    }
    const aggregateMatch = /^questions\[(\d+)\]\.([A-Za-z_$][\w$]*)$/.exec(fieldPath);
    if (aggregateMatch && (aggregateFields.has(aggregateMatch[2]) || upstreamJudgmentFields.has(aggregateMatch[2]))) derivedQuestionIndexes.add(Number(aggregateMatch[1]));
  }
  for (const { questionIndex, stepIndex } of affectedStepStatuses.values()) {
    if (parentArrayQuestions.has(questionIndex)) continue;
    const base = `questions[${questionIndex}].stepFeedbacks[${stepIndex}]`;
    const constraint = 'Keep the visible solutionText and explanationText unchanged. Repair the step judgment coherently. The runtime will deterministically recompute aggregate fields after the patch.';
    add(`${base}.correctionAdvice`, constraint, [`${base}.solutionStatus`, `${base}.explanationStatus`, `${base}.logicStatus`]);
  }
  // When a step array or nested step field is being repaired, aggregate fields
  // are derived by trusted runtime code after the patch. Do not ask the model
  // to patch both the source step structure and all dependent summaries in one
  // envelope; that previously produced non-converging repairs in Cloud Run.
  const filtered = expanded.filter((issue, index, all) => {
    const fieldPath = String(issue?.fieldPath || '');
    if (all.findIndex((candidate) => candidate.fieldPath === fieldPath) !== index) return false;
    const nestedMatch = /^questions\[(\d+)\]\.stepFeedbacks\[/.exec(fieldPath);
    if (nestedMatch && parentArrayQuestions.has(Number(nestedMatch[1]))) return false;
    const aggregateMatch = /^questions\[(\d+)\]\.([A-Za-z_$][\w$]*)$/.exec(fieldPath);
    if (aggregateMatch && stepAffectedQuestions.has(Number(aggregateMatch[1])) && aggregateFields.has(aggregateMatch[2])) return false;
    return true;
  });
  return { issues: filtered, derivedQuestionIndexes: [...derivedQuestionIndexes].sort((a, b) => a - b) };
}

const HARD_PROBLEM_AGGREGATE_FIELDS = ['stepStatus', 'logicStatus', 'errorType', 'firstWrongStep', 'errorReason', 'adjustmentSuggestion', 'overallFeedback'];
const cleanText = (value) => String(value || '').trim();
function hardStepIssueLabels(step) {
  const labels = [];
  if (step.solutionStatus === 'missing') labels.push('缺少解题过程');
  else if (step.solutionStatus === 'unreadable') labels.push('解题过程无法识别');
  else if (step.solutionStatus === 'wrong') labels.push('解题过程有误');
  if (step.explanationStatus === 'missing') labels.push('缺少对应讲解');
  else if (step.explanationStatus === 'unreadable') labels.push('讲解无法识别');
  else if (step.explanationStatus === 'partially_clear') labels.push('讲解不完整');
  else if (step.explanationStatus === 'incorrect') labels.push('讲解有误');
  if (step.logicStatus === 'insufficient') labels.push('逻辑依据不完整');
  else if (step.logicStatus === 'unreadable') labels.push('逻辑无法识别');
  else if (step.logicStatus === 'wrong') labels.push('逻辑有误');
  return [...new Set(labels)];
}
function hardStepFullyClear(step) {
  return step?.solutionStatus === 'correct' && step?.explanationStatus === 'clear' && step?.logicStatus === 'clear';
}
function hardStepCorrection(step) {
  if (hardStepFullyClear(step)) return '';
  if (step?.solutionStatus === 'missing') return '请补写这一处对应的解题过程。';
  if (step?.solutionStatus === 'unreadable') return '请把这一处解题过程写清楚或重新拍摄。';
  if (step?.solutionStatus === 'wrong') return '请根据分析订正这一处解题过程。';
  if (step?.explanationStatus === 'missing') return '请补充说明这一步为什么这样计算。';
  if (step?.explanationStatus === 'unreadable') return '请把这一处讲解写清楚或重新拍摄。';
  if (step?.explanationStatus === 'partially_clear') return '请补充完整说明这一步使用该方法的原因。';
  if (step?.explanationStatus === 'incorrect') return '请订正这一步的讲解，使它与题目条件和解题过程一致。';
  if (step?.logicStatus === 'wrong') return '请根据题目条件重新梳理这一步的逻辑。';
  if (step?.logicStatus === 'unreadable') return '请把这一处逻辑说明写清楚或重新拍摄。';
  return '请补充这一步与前后步骤之间的逻辑依据。';
}
function hardAnalysisContradictsStatus(step) {
  const analysis = cleanText(step?.analysis);
  if (!analysis) return true;
  if (step?.solutionStatus === 'missing' && /(解题过程|计算过程|列式|该步计算).{0,8}(正确|完整|无误)/.test(analysis)) return true;
  if (step?.solutionStatus === 'unreadable' && /(解题过程|计算过程|列式|该步计算).{0,8}(正确|完整|无误)/.test(analysis)) return true;
  if (step?.explanationStatus === 'missing' && /(讲解|解释).{0,8}(清楚|完整|正确)/.test(analysis)) return true;
  if (step?.explanationStatus === 'unreadable' && /(讲解|解释).{0,8}(清楚|完整|正确)/.test(analysis)) return true;
  return false;
}
function hardStepAnalysis(step, index) {
  const issues = hardStepIssueLabels(step);
  if (!issues.length) return '该步解题过程、讲解和逻辑均正确。';
  return `第${index + 1}步${issues.join('，')}。`;
}
function hardAggregateStatuses(question) {
  return deriveHardProblemAggregateState(question, question?.stepFeedbacks);
}

function hardIssueSummaries(question, steps) {
  const affected = [];
  const reasons = [];
  const suggestions = [];
  steps.forEach((step, index) => {
    const labels = hardStepIssueLabels(step);
    if (!labels.length) return;
    affected.push(`${affected.length + 1}. 第${index + 1}步：${labels.join('、')}`);
    reasons.push(`第${index + 1}步${labels.join('、')}`);
    const advice = cleanText(step.correctionAdvice) || hardStepCorrection(step);
    if (advice) suggestions.push(`第${index + 1}步：${advice}`);
  });
  if (question.finalAnswerCorrect === false) {
    affected.push(`${affected.length + 1}. 最终答案：需要订正`);
    reasons.push('最终答案不正确');
    suggestions.push('请根据订正后的过程重新核对最终答案。');
  }
  return {
    firstWrongStep: affected.join('；'),
    errorReason: reasons.join('；'),
    adjustmentSuggestion: [...new Set(suggestions)].join('；'),
  };
}
function hardOverallFeedback(question, aggregate) {
  const parts = [];
  if (question.finalAnswerCorrect === true) parts.push('最终答案正确');
  else if (question.finalAnswerCorrect === false) parts.push('最终答案需要订正');
  else parts.push('最终答案暂时无法判断');
  if (aggregate.stepStatus === 'correct') parts.push('可见解题过程正确');
  else if (aggregate.stepStatus === 'missing') parts.push('部分必要解题过程未写出');
  else if (aggregate.stepStatus === 'unreadable') parts.push('部分解题过程无法识别');
  else parts.push('解题过程仍有需要订正或补充的地方');
  if (aggregate.logicStatus === 'correct') parts.push('逐步讲解和逻辑清楚');
  else if (aggregate.logicStatus === 'insufficient') parts.push('部分讲解或逻辑依据不完整');
  else if (aggregate.logicStatus === 'unreadable') parts.push('部分讲解或逻辑无法识别');
  else parts.push('部分讲解或逻辑需要订正');
  return `${parts.join('，')}。`;
}
function stabilizeHardProblemRepairDependents(output, fields, validationContext = null) {
  const indexes = new Set(Array.isArray(validationContext?.hardProblemDerivedQuestionIndexes) ? validationContext.hardProblemDerivedQuestionIndexes : []);
  for (const field of fields || []) {
    const path = String(field?.fieldPath || '');
    const parentOrAggregate = /^questions\[(\d+)\]\.(?:stepFeedbacks|finalAnswerCorrect|stepStatus|logicStatus|errorType|firstWrongStep|errorReason|adjustmentSuggestion|overallFeedback)$/.exec(path);
    const dependentNested = /^questions\[(\d+)\]\.stepFeedbacks\[\d+\]\.(?:solutionStatus|explanationStatus|logicStatus|correctionAdvice)$/.exec(path);
    const match = parentOrAggregate || dependentNested;
    if (match) indexes.add(Number(match[1]));
  }
  const deterministicFieldPaths = [];
  for (const questionIndex of indexes) {
    const question = output?.questions?.[questionIndex];
    if (!question || question.outputSchemaVersion !== 'hard-problem.v2' || !Array.isArray(question.stepFeedbacks)) continue;
    question.stepFeedbacks.forEach((step, index) => {
      if (!isObject(step)) return;
      if (step.stepIndex !== index + 1) { step.stepIndex = index + 1; deterministicFieldPaths.push(`questions[${questionIndex}].stepFeedbacks[${index}].stepIndex`); }
      const expectedAdvice = hardStepCorrection(step);
      if (hardStepFullyClear(step)) {
        if (cleanText(step.correctionAdvice)) { step.correctionAdvice = ''; deterministicFieldPaths.push(`questions[${questionIndex}].stepFeedbacks[${index}].correctionAdvice`); }
      } else if (!cleanText(step.correctionAdvice)) {
        step.correctionAdvice = expectedAdvice;
        deterministicFieldPaths.push(`questions[${questionIndex}].stepFeedbacks[${index}].correctionAdvice`);
      }
      if (hardAnalysisContradictsStatus(step)) {
        step.analysis = hardStepAnalysis(step, index);
        deterministicFieldPaths.push(`questions[${questionIndex}].stepFeedbacks[${index}].analysis`);
      }
    });
    const aggregate = hardAggregateStatuses(question);
    const normalizedQuestion = normalizeHardProblemQuestion(question);
    if (question.answerStatus !== 'answered' || question.stepRequired !== true || question.stepFeedbacks.length === 0) {
      for (const field of ['stepStatus', 'logicStatus', 'errorType', 'firstWrongStep', 'errorReason', 'adjustmentSuggestion', 'overallFeedback']) {
        if (question[field] !== normalizedQuestion[field]) { question[field] = normalizedQuestion[field]; deterministicFieldPaths.push(`questions[${questionIndex}].${field}`); }
      }
      continue;
    }
    const errorType = deriveHardProblemErrorType(question, question.stepFeedbacks, aggregate.stepStatus, aggregate.logicStatus);
    for (const [field, value] of [['stepStatus', aggregate.stepStatus], ['logicStatus', aggregate.logicStatus], ['errorType', errorType]]) {
      if (question[field] !== value) { question[field] = value; deterministicFieldPaths.push(`questions[${questionIndex}].${field}`); }
    }
    const needsCorrection = question.finalAnswerCorrect !== true || !aggregate.fullyClear;
    const summaries = needsCorrection ? hardIssueSummaries(question, question.stepFeedbacks) : { firstWrongStep: '', errorReason: '', adjustmentSuggestion: '' };
    for (const field of ['firstWrongStep', 'errorReason', 'adjustmentSuggestion']) {
      if (question[field] !== summaries[field]) { question[field] = summaries[field]; deterministicFieldPaths.push(`questions[${questionIndex}].${field}`); }
    }
    const overallFeedback = hardOverallFeedback(question, aggregate);
    if (question.overallFeedback !== overallFeedback) { question.overallFeedback = overallFeedback; deterministicFieldPaths.push(`questions[${questionIndex}].overallFeedback`); }
  }
  return [...new Set(deterministicFieldPaths)];
}

function validCandidateValues(originalOutput, schema, validationDiagnostics, initialIssues, targetIssue, rule) {
  if (!Array.isArray(rule.allowedEnums)) return null;
  const parts = repairFieldLocation(targetIssue.fieldPath);
  const initialIssueKeys = new Set(initialIssues.map(issueKey));
  return rule.allowedEnums.filter((candidate) => {
    const temporaryOutput = structuredClone(originalOutput);
    const parent = readPath(temporaryOutput, parts.slice(0, -1));
    if (!parent.found) return false;
    parent.value[parts.at(-1)] = candidate;
    if (!hasSameQuestionIdentity(originalOutput, temporaryOutput)) return false;
    const candidateIssues = collectNewModelResultIssues(temporaryOutput, validationDiagnostics || {});
    return !candidateIssues.some((item) => issueKey(item) === issueKey(targetIssue)) && !candidateIssues.some((item) => item.repairable !== true || !initialIssueKeys.has(issueKey(item)));
  });
}

function modelOutputRepairInstructions({ fields, schema, originalOutput, originalRawResponse, originalRequest }) {
  const repairList = fields.map((field) => JSON.stringify(field)).join('\n');
  const fixedStepRepairQuestions = (Array.isArray(originalRequest?.fixedEvidenceQuestions) ? originalRequest.fixedEvidenceQuestions : [])
    .map((question) => ({
      sourceKey: typeof question?.sourceKey === 'string' ? question.sourceKey : '',
      fixedSteps: Array.isArray(question?.fixedSteps) ? question.fixedSteps.map((step, index) => ({
        stepIndex: index + 1,
        expectedStepId: typeof step?.expectedStepId === 'string' ? step.expectedStepId : `S${index + 1}`,
        expectedPurpose: typeof step?.expectedPurpose === 'string' ? step.expectedPurpose : '',
        expectedReasoning: typeof step?.expectedReasoning === 'string' ? step.expectedReasoning : '',
        stepKind: step?.stepKind === 'student_extra' ? 'student_extra' : 'expected',
        solutionText: typeof step?.solutionText === 'string' ? step.solutionText : '',
        explanationText: typeof step?.explanationText === 'string' ? step.explanationText : '',
      })) : [],
    }))
    .filter((question) => question.sourceKey && question.fixedSteps.length)
    .filter((question) => fields.some((field) => field.fieldPath === `questions[${field.questionIndex}].stepFeedbacks` && field.expectedSourceKey === question.sourceKey))
    .map((question) => ({ ...question, expectedStepCount: question.fixedSteps.length }));
  const schemaConstraints = JSON.stringify({
    requiredFields: schema.requiredFields,
    fieldTypes: schema.fieldTypes,
    enumFields: schema.enumFields,
    nullableFields: schema.nullableFields,
    arrayItemSchemas: schema.arrayItemSchemas,
    numericRanges: schema.numericRanges,
    consistencyRules: schema.consistencyRules,
    topLevelRequiredFields: schema.topLevelRequiredFields,
    topLevelFieldTypes: schema.topLevelFieldTypes,
    topLevelEnumFields: schema.topLevelEnumFields,
    topLevelObjectSchemas: schema.topLevelObjectSchemas,
  });
  return {
    systemPrompt: 'You are performing a schema-constrained JSON field repair. Return only one valid JSON patch envelope.',
    userPrompt: [
      'Return exactly {"repairs":[{"fieldPath":"questions[0].field","value":<value>}]} with no Markdown or other keys. Nested paths such as questions[0].stepFeedbacks[0].analysis must be returned exactly as requested.',
      'repairs must contain every requested fieldPath exactly once and no other paths.',
      'Never change questionText, studentAnswer, solutionText, or explanationText unless that exact source-text fieldPath is explicitly requested. Status or aggregate conflicts must be repaired in the requested judgment field, not by erasing or inventing student source text.',
      'Each value must eliminate its specified issueCode in the complete original context. If validCandidateValues is present, choose only from that list.',
      'Use relatedFieldPaths and semanticConstraint to assess the value. Do not return the failing original value, a complete question, or any unrequested field.',
      'For every missing or invalid business-judgment field, use the original image and evidence in the original grading context to determine its value. Do not mechanically use false, an empty string, or a fixed enum value.',
      'Do not infer values mechanically; use the original images and grading context.',
      'For HARD_PROBLEM_CHECK stepFeedbacks repairs, first re-separate visible solution/calculation source, student explanation source, and final answer source. Missing, unreadable, unnumbered, unequal-count, and unpaired units are valid; preserve them with empty source fields and matching statuses instead of duplicating, forcing pairs, or inventing standard-solution steps.',
      'When repairing a complete stepFeedbacks array, account for every visible student source block exactly once across solutionText, explanationText, or studentAnswer. A final answer that merely restates an immediately preceding computed result must not become an extra student-authored step. When fixedEvidenceQuestions are present, never collapse a student who wrote only a final answer or nothing at all into one item: preserve the complete locked ExpectedReasoningPlan and mark every unsupported source field missing without fabricating work.',
      ...(fixedStepRepairQuestions.length ? [
        'For the following fixedEvidenceQuestions, each requested questions[i].stepFeedbacks patch must rebuild the entire array. Return exactly expectedStepCount entries in the listed order, with stepIndex 1 through expectedStepCount, and copy every fixedSteps.solutionText and fixedSteps.explanationText exactly. Do not merge visible calculation steps to match explanation paragraphs. expectedPurpose and expectedReasoning are AI planning metadata only and must never be copied into solutionText or explanationText. When a fixed step has no student solutionText or explanationText, keep the source field empty and use the matching missing status; use expectedReasoning only to write concrete analysis/correctionAdvice.',
        'fixedEvidenceQuestions:',
        JSON.stringify(fixedStepRepairQuestions),
      ] : []),
      `Complete runtime schema constraints for ${schema.schemaId}:`,
      schemaConstraints,
      'Repair field paths and validation reasons:',
      repairList,
      'Original grading system prompt context:',
      String(originalRequest?.systemPrompt || ''),
      'Original grading user prompt context:',
      String(originalRequest?.userPrompt || ''),
      'Original model JSON response:',
      String(originalRawResponse || JSON.stringify(originalOutput)),
      'Canonical original JSON document (context only; do not repeat it):',
      JSON.stringify(originalOutput)
    ].join('\n')
  };
}

function repairFieldLocation(fieldPath) {
  if (typeof fieldPath !== 'string' || !/^[A-Za-z_$][\w$]*(?:\.([A-Za-z_$][\w$]*|\d+)|\[(\d+)\])*$/.test(fieldPath)) throw repairFailure('Invalid model output repair field path', fieldPath || null);
  return Array.from(fieldPath.matchAll(/[A-Za-z_$][\w$]*|\d+/g), (match) => /^\d+$/.test(match[0]) ? Number(match[0]) : match[0]);
}

function repairFailure(message, fieldPath = null, details = {}) { return Object.assign(new Error(message), { code: 'LLM_SCHEMA_REPAIR_FAILED', fieldPath, repairFailureStage: 'REPAIR_PATCH_VALIDATION', ...details }); }
const repairDiagnostics = new WeakMap();
function readPath(object, parts) {
  let value = object;
  for (const part of parts) {
    if (!isObject(value) && !Array.isArray(value)) return { found: false };
    if (!Object.hasOwn(value, part)) return { found: false };
    value = value[part];
  }
  return { found: true, value };
}
function repairFieldRule(fieldPath, parts, originalOutput, schema) {
  if (parts[0] === 'questions' && Number.isInteger(parts[1]) && typeof parts[2] === 'string') {
    const question = originalOutput.questions?.[parts[1]];
    if (!question) throw repairFailure('Repair field path is not permitted', fieldPath, { failureReason: 'INVALID_FIELD_PATH' });
    if (parts.length === 3) {
      const field = parts[2];
      if (!Object.hasOwn(schema.fieldTypes || {}, field) || ['outputSchemaVersion', 'sourceKey', 'questionText'].includes(field)) throw repairFailure('Repair field path is not permitted', fieldPath, { failureReason: 'INVALID_FIELD_PATH' });
      return { question, field, schema, expectedType: schema.fieldTypes[field], nullable: nullableValueAllowed(question, schema, field), allowedEnums: schema.enumFields?.[field] || null, numericMinimum: schema.numericRanges?.[field]?.min ?? null, numericMaximum: schema.numericRanges?.[field]?.max ?? null, expectedSourceKey: question.sourceKey };
    }
    const arrayField = parts[2];
    const itemIndex = parts[3];
    const itemSchema = schema.arrayItemSchemas?.[arrayField];
    const items = question[arrayField];
    if (!itemSchema || !Array.isArray(items) || !Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= items.length) throw repairFailure('Repair field path is not permitted', fieldPath, { failureReason: 'INVALID_FIELD_PATH' });
    if (parts.length === 4) {
      return { question, field: arrayField, schema, expectedType: 'object', nullable: false, allowedEnums: null, numericMinimum: null, numericMaximum: null, expectedSourceKey: question.sourceKey };
    }
    if (parts.length === 5 && typeof parts[4] === 'string') {
      const itemField = parts[4];
      if (!Object.hasOwn(itemSchema.fieldTypes || {}, itemField)) throw repairFailure('Repair field path is not permitted', fieldPath, { failureReason: 'INVALID_FIELD_PATH' });
      return { question, field: itemField, schema, expectedType: itemSchema.fieldTypes[itemField], nullable: false, allowedEnums: itemSchema.enumFields?.[itemField] || null, numericMinimum: itemSchema.numericRanges?.[itemField]?.min ?? null, numericMaximum: itemSchema.numericRanges?.[itemField]?.max ?? null, expectedSourceKey: question.sourceKey };
    }
    throw repairFailure('Repair field path is not permitted', fieldPath, { failureReason: 'INVALID_FIELD_PATH' });
  }
  if (parts.includes('questions') || ['outputSchemaVersion', 'questions'].includes(parts[0])) throw repairFailure('Repair field path is not permitted', fieldPath, { failureReason: 'INVALID_FIELD_PATH' });
  const type = schema.topLevelFieldTypes?.[fieldPath];
  if (!type) throw repairFailure('Repair field path has no schema type', fieldPath, { failureReason: 'INVALID_FIELD_PATH' });
  const parent = readPath(originalOutput, parts.slice(0, -1));
  if (!parent.found || !isObject(parent.value)) throw repairFailure('Repair field path does not exist', fieldPath, { failureReason: 'INVALID_FIELD_PATH' });
  return { question: null, field: parts.at(-1), schema, expectedType: type, nullable: false, allowedEnums: schema.topLevelEnumFields?.[fieldPath] || null, numericMinimum: schema.topLevelNumericRanges?.[fieldPath]?.min ?? null, numericMaximum: schema.topLevelNumericRanges?.[fieldPath]?.max ?? null, expectedSourceKey: null };
}
function normalizedFailure(message, fieldPath, rule, actualValue, failureReason, normalizationAttempted) {
  throw repairFailure(message, fieldPath, { expectedType: rule.expectedType, actualType: Array.isArray(actualValue) ? 'array' : actualValue === null ? 'null' : typeof actualValue, failureReason, normalizationAttempted, normalizationSucceeded: false });
}
function normalizeRepairValue(value, rule, fieldPath) {
  let normalized = value;
  let normalizationAttempted = false;
  if (rule.expectedType === 'string' && Array.isArray(value)) {
    normalizationAttempted = true;
    if (!value.every((item) => typeof item === 'string')) normalizedFailure('Repair response string array is unsafe', fieldPath, rule, value, 'UNSAFE_NORMALIZATION_REJECTED', true);
    normalized = value.join('\n');
  }
  else if (rule.expectedType === 'array' && typeof value === 'string') {
    normalizationAttempted = true;
    normalized = [value];
  }
  else if (['number', 'integer_min_0', 'number_0_to_1'].includes(rule.expectedType) && typeof value === 'string') {
    normalizationAttempted = true;
    const text = value.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text)) normalizedFailure('Repair response numeric text is invalid', fieldPath, rule, value, 'INVALID_NUMERIC_VALUE', true);
    normalized = Number(text);
  }
  else if (rule.expectedType === 'boolean' && (value === 'true' || value === 'false')) {
    normalizationAttempted = true;
    normalized = value === 'true';
  }
  else if (rule.allowedEnums && typeof value === 'string') {
    normalizationAttempted = value !== value.trim();
    normalized = value.trim();
  }
  if (normalized === null && !rule.nullable) normalizedFailure('Repair response null is not allowed', fieldPath, rule, value, 'NULL_NOT_ALLOWED', normalizationAttempted);
  if (normalized !== null && !matchesRuntimeType(normalized, rule.expectedType)) normalizedFailure('Repair response has an invalid value type', fieldPath, rule, value, ['number', 'integer_min_0', 'number_0_to_1'].includes(rule.expectedType) ? 'INVALID_NUMERIC_VALUE' : normalizationAttempted ? 'UNSAFE_NORMALIZATION_REJECTED' : 'INVALID_VALUE_TYPE', normalizationAttempted);
  if (rule.allowedEnums && !rule.allowedEnums.includes(normalized)) normalizedFailure('Repair response has an invalid enum value', fieldPath, rule, value, 'INVALID_ENUM_VALUE', normalizationAttempted);
  if (['number', 'integer_min_0', 'number_0_to_1'].includes(rule.expectedType) && !Number.isFinite(normalized)) normalizedFailure('Repair response has an invalid numeric value', fieldPath, rule, value, 'INVALID_NUMERIC_VALUE', normalizationAttempted);
  if ((rule.numericMinimum !== null && normalized < rule.numericMinimum) || (rule.numericMaximum !== null && normalized > rule.numericMaximum)) normalizedFailure('Repair response has an invalid numeric range', fieldPath, rule, value, 'INVALID_NUMERIC_RANGE', normalizationAttempted);
  return { value: normalized, normalizationAttempted, normalizationSucceeded: normalizationAttempted };
}
function mergeRepairedOutput(originalOutput, repairedOutput, fields, schema, validationContext = null) {
  if (hasProtectedStructure(originalOutput, schema)) throw repairFailure('Original output structure cannot be matched safely', null, { failureReason: 'QUESTION_IDENTITY_CHANGED' });
  if (!isObject(repairedOutput) || !Array.isArray(repairedOutput.repairs)) throw repairFailure('Repair response must contain repairs', null, { failureReason: 'INVALID_REPAIR_ENVELOPE' });
  const allowed = new Set(fields.map((item) => item.fieldPath));
  const seen = new Set();
  const ignoredFieldPaths = [];
  const validatedRepairs = [];
  for (const repair of repairedOutput.repairs) {
    if (!isObject(repair) || typeof repair.fieldPath !== 'string') { ignoredFieldPaths.push(null); continue; }
    if (!allowed.has(repair.fieldPath)) { ignoredFieldPaths.push(repair.fieldPath); continue; }
    if (seen.has(repair.fieldPath)) throw repairFailure('Repair response has a duplicate field path', repair.fieldPath, { failureReason: 'DUPLICATE_FIELD_PATH' });
    seen.add(repair.fieldPath);
    const fieldPath = repair.fieldPath;
    const parts = repairFieldLocation(fieldPath);
    const rule = repairFieldRule(fieldPath, parts, originalOutput, schema);
    if (rule.question && repair.sourceKey !== undefined && repair.sourceKey !== rule.expectedSourceKey) throw repairFailure('Repair response sourceKey does not match', fieldPath, { failureReason: 'QUESTION_IDENTITY_CHANGED', expectedSourceKey: rule.expectedSourceKey });
    if (!rule.question && repair.sourceKey !== undefined) throw repairFailure('Repair response must not identify a non-question field', fieldPath, { failureReason: 'QUESTION_IDENTITY_CHANGED' });
    const normalized = normalizeRepairValue(repair.value, rule, fieldPath);
    validatedRepairs.push({ parts, value: structuredClone(normalized.value), normalizationAttempted: normalized.normalizationAttempted, normalizationSucceeded: normalized.normalizationSucceeded });
  }
  if (seen.size !== allowed.size) {
    const missingRequiredFieldPaths = [...allowed].filter((fieldPath) => !seen.has(fieldPath));
    throw repairFailure('Repair response omitted a field path', null, { failureReason: 'MISSING_REQUIRED_PATCH', missingRequiredFieldPaths });
  }
  const mergedOutput = JSON.parse(JSON.stringify(originalOutput));
  for (const { parts, value } of validatedRepairs) {
    const parent = readPath(mergedOutput, parts.slice(0, -1));
    parent.value[parts.at(-1)] = value;
  }
  const deterministicFieldPaths = stabilizeHardProblemRepairDependents(mergedOutput, fields, validationContext);
  validateRepairedContext(originalOutput, mergedOutput, fields, validationContext);
  repairDiagnostics.set(mergedOutput, { ignoredFieldPaths, ignoredTopLevelKeys: Object.keys(repairedOutput).filter((key) => key !== 'repairs'), normalizationAttempted: validatedRepairs.some((repair) => repair.normalizationAttempted), normalizationSucceeded: validatedRepairs.every((repair) => !repair.normalizationAttempted || repair.normalizationSucceeded), deterministicFieldPaths });
  return mergedOutput;
}

function validateRepairedContext(originalOutput, mergedOutput, fields, validationContext) {
  if (!validationContext) return;
  if (!hasSameQuestionIdentity(originalOutput, mergedOutput)) throw repairFailure('Repair changed question identity', null, { failureReason: 'QUESTION_IDENTITY_CHANGED', repairFailureStage: 'REPAIR_CONTEXT_VALIDATION' });
  const initialIssues = validationContext.initialIssues || [];
  const postIssues = collectNewModelResultIssues(mergedOutput, repairValidationDiagnostics(validationContext.strategy || null, validationContext));
  if (validationContext.deferRepairablePostIssues === true && postIssues.length > 0 && postIssues.every((item) => item?.repairable === true)) return;
  const targetKeys = new Set(fields.filter((field) => field.issueCode).map((field) => issueKey({ code: field.issueCode, fieldPath: field.fieldPath })));
  const unresolved = postIssues.filter((item) => targetKeys.has(issueKey(item)));
  const initialIssueKeys = new Set(initialIssues.map(issueKey));
  const introduced = postIssues.filter((item) => !initialIssueKeys.has(issueKey(item)));
  const unchanged = unresolved.length > 0 && unresolved.every((item) => {
    const parts = repairFieldLocation(item.fieldPath);
    return sameJsonValue(readPath(originalOutput, parts).value, readPath(mergedOutput, parts).value);
  });
  if (introduced.length) throw repairFailure('Repair introduced a new validation issue', introduced[0].fieldPath, { failureReason: 'REPAIR_INTRODUCED_NEW_ISSUE', repairFailureStage: 'REPAIR_CONTEXT_VALIDATION', issueCode: introduced[0].code, issues: postIssues, sameValue: false });
  if (unresolved.length) throw repairFailure('Repair did not eliminate its semantic constraint', unresolved[0].fieldPath, { failureReason: unchanged ? 'REPAIR_NO_EFFECT' : 'REPAIR_SEMANTIC_CONSTRAINT_UNRESOLVED', repairFailureStage: 'REPAIR_CONTEXT_VALIDATION', issueCode: unresolved[0].code, issues: postIssues, sameValue: unchanged });
  if (postIssues.length) throw repairFailure('Repair left unresolved validation issues', postIssues[0].fieldPath, { failureReason: 'REPAIR_SEMANTIC_CONSTRAINT_UNRESOLVED', repairFailureStage: 'REPAIR_CONTEXT_VALIDATION', issueCode: postIssues[0].code, issues: postIssues, sameValue: false });
}

function getRepairDiagnostics(output) { return repairDiagnostics.get(output) || { ignoredFieldPaths: [], ignoredTopLevelKeys: [], normalizationAttempted: false, normalizationSucceeded: false, deterministicFieldPaths: [] }; }
module.exports = { prepareModelOutputRepair, modelOutputRepairInstructions, mergeRepairedOutput, getRepairDiagnostics, stabilizeHardProblemRepairDependents };
