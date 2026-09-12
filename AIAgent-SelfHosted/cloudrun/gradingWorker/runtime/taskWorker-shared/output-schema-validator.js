'use strict';

const registry = require('./output-schema-registry');
const { realignHardProblemExplanations } = require('./explanation-matcher');

function failure(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function fieldPath(index, field) { return `questions[${index}].${field}`; }
const SUPPORTED_FIELD_TYPES = new Set(['string', 'boolean', 'number', 'array', 'object', 'enum', 'integer_min_0', 'number_0_to_1']);
function matchesRuntimeType(value, expected) {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'enum') return typeof value === 'string';
  if (expected === 'integer_min_0') return Number.isInteger(value) && value >= 0;
  if (expected === 'number_0_to_1') return Number.isFinite(value) && value >= 0 && value <= 1;
  return typeof value === expected;
}
function nullableValueAllowed(question, schema, field) {
  const states = schema.nullableFields?.[field];
  if (!Array.isArray(states)) return false;
  return states.includes(question?.[Object.hasOwn(schema.fieldTypes || {}, 'analysisStatus') ? 'analysisStatus' : 'answerStatus']);
}
const EVIDENCE_FIELDS = ['studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'];
const STRATEGY_CONTRACT_KEYS = { 'hard-problem.v2': 'hardProblemV2', 'reading-careless.v2': 'readingCarelessV2', 'calculation-careless.v2': 'calculationCarelessV2' };
function normalizeRuntimeConsistencyRules(outputSchemaVersion, rules) {
  const source = Array.isArray(rules) ? rules : [];
  if (outputSchemaVersion !== 'hard-problem.v2') return source;
  return source.map((rule) => {
    if (rule?.when?.answerStatus !== 'unreadable' || rule?.require?.stepStatus !== 'unreadable') return rule;
    // answer readability and process applicability are independent. When stepRequired=false,
    // stepStatus must remain not_required; unreadable still controls finalAnswerCorrect,
    // logicStatus and errorType. This also makes older 1.6.2 remote contracts satisfiable.
    const require = { ...(rule.require || {}) };
    delete require.stepStatus;
    return { ...rule, require };
  });
}
function resolveRuntimeSchema(strategy, outputSchemaVersion) {
  const localSchema = registry.getSchema(outputSchemaVersion);
  if (!localSchema) return null;
  const strategySchema = strategy?.outputSchemaRegistry?.schemas?.find((schema) => schema?.schemaId === outputSchemaVersion);
  const contractSchema = strategy?.contracts?.[strategySchema?.strategyContractKey || STRATEGY_CONTRACT_KEYS[outputSchemaVersion]];
  const requiredFields = contractSchema?.requiredFields || strategySchema?.requiredFields || localSchema.requiredFields;
  const fieldTypes = { ...localSchema.fieldTypes, ...(strategySchema?.fieldTypes || {}), ...(contractSchema?.fieldTypes || {}) };
  const legacyHardContract = outputSchemaVersion === 'hard-problem.v2' && contractSchema && !requiredFields.includes('stepFeedbacks');
  if (legacyHardContract) {
    delete fieldTypes.stepFeedbacks;
    delete fieldTypes.overallFeedback;
  }
  for (const [field, type] of Object.entries(fieldTypes)) if (type === 'enum') fieldTypes[field] = 'string';
  const enumFields = { ...localSchema.enumFields, ...(strategySchema?.enumFields || {}), ...(contractSchema?.enumFields || {}) };
  const nullableFields = { ...localSchema.nullableFields, ...(strategySchema?.nullableFields || {}), ...(contractSchema?.nullableFields || {}) };
  const arrayFields = (contractSchema?.arrayFields || strategySchema?.arrayFields || localSchema.arrayFields || []).filter((field) => Object.hasOwn(fieldTypes, field));
  const arrayItemSchemas = Object.fromEntries(Object.entries({ ...(localSchema.arrayItemSchemas || {}), ...(strategySchema?.arrayItemSchemas || {}), ...(contractSchema?.arrayItemSchemas || {}) }).filter(([field]) => Object.hasOwn(fieldTypes, field)));
  const numericRanges = { ...localSchema.numericRanges, ...(strategySchema?.numericRanges || {}), ...(contractSchema?.numericRanges || {}) };
  const consistencyRules = normalizeRuntimeConsistencyRules(outputSchemaVersion, contractSchema?.consistencyRules || strategySchema?.consistencyRules || localSchema.consistencyRules || []);
  const topLevelRequiredFields = contractSchema?.topLevelRequiredFields || strategySchema?.topLevelRequiredFields || localSchema.topLevelRequiredFields || [];
  const topLevelFieldTypes = { ...(localSchema.topLevelFieldTypes || {}), ...(strategySchema?.topLevelFieldTypes || {}), ...(contractSchema?.topLevelFieldTypes || {}) };
  const topLevelEnumFields = { ...(localSchema.topLevelEnumFields || {}), ...(strategySchema?.topLevelEnumFields || {}), ...(contractSchema?.topLevelEnumFields || {}) };
  const topLevelObjectSchemas = { ...(localSchema.topLevelObjectSchemas || {}), ...(strategySchema?.topLevelObjectSchemas || {}), ...(contractSchema?.topLevelObjectSchemas || {}) };
  return { ...localSchema, requiredFields, fieldTypes, enumFields, nullableFields, arrayFields, arrayItemSchemas, numericRanges, consistencyRules, topLevelRequiredFields, topLevelFieldTypes, topLevelEnumFields, topLevelObjectSchemas, requiresEvidenceFields: Boolean(strategy) && EVIDENCE_FIELDS.some((field) => requiredFields.includes(field)), requiresQuestionSetAudit: topLevelRequiredFields.includes('questionSetAudit') };
}
function auditRuntimeSchema(schema) {
  const errors = [], types = schema?.fieldTypes || {}, known = new Set(Object.keys(types));
  for (const field of schema?.requiredFields || []) if (!known.has(field)) errors.push(`requiredFields missing type: ${field}`);
  for (const [field, type] of Object.entries(types)) if (!SUPPORTED_FIELD_TYPES.has(type)) errors.push(`unsupported type: ${field}=${type}`);
  for (const field of Object.keys(schema?.enumFields || {})) if (!known.has(field) || types[field] !== 'string') errors.push(`enumFields conflict: ${field}`);
  for (const field of Object.keys(schema?.nullableFields || {})) if (!known.has(field)) errors.push(`nullableFields unknown: ${field}`);
  for (const field of schema?.arrayFields || []) if (!known.has(field) || types[field] !== 'array') errors.push(`arrayFields conflict: ${field}`);
  for (const [field, itemSchema] of Object.entries(schema?.arrayItemSchemas || {})) {
    if (!known.has(field) || types[field] !== 'array') errors.push(`arrayItemSchemas conflict: ${field}`);
    const itemTypes = itemSchema?.fieldTypes || {};
    for (const requiredField of itemSchema?.requiredFields || []) if (!Object.hasOwn(itemTypes, requiredField)) errors.push(`arrayItemSchemas missing type: ${field}.${requiredField}`);
    for (const [itemField, type] of Object.entries(itemTypes)) if (!SUPPORTED_FIELD_TYPES.has(type)) errors.push(`arrayItemSchemas unsupported type: ${field}.${itemField}=${type}`);
    for (const [itemField, values] of Object.entries(itemSchema?.enumFields || {})) if (!Object.hasOwn(itemTypes, itemField) || !Array.isArray(values) || !values.length) errors.push(`arrayItemSchemas enum conflict: ${field}.${itemField}`);
  }
  for (const field of Object.keys(schema?.numericRanges || {})) if (!known.has(field) || !['number', 'integer_min_0', 'number_0_to_1'].includes(types[field])) errors.push(`numericRanges conflict: ${field}`);
  for (const rule of schema?.consistencyRules || []) for (const section of ['when', 'require', 'requireTypes']) for (const field of Object.keys(rule[section] || {})) if (!known.has(field)) errors.push(`consistencyRules unknown: ${field}`);
  return errors;
}
const STUDENT_VISIBLE_FIELDS = {
  'hard-problem.v2': ['questionText', 'studentAnswer', 'standardAnswer', 'firstWrongStep', 'errorReason', 'adjustmentSuggestion', 'knowledgePoint', 'stepFeedbacks', 'overallFeedback'],
  'reading-careless.v2': ['questionText', 'studentConditionText', 'studentRelationText', 'studentAskText', 'referenceConditionText', 'referenceRelationText', 'referenceAskText', 'missingConditions', 'relationIssues', 'askIssue', 'errorReason', 'correctionAdvice'],
  'calculation-careless.v2': ['questionText', 'studentCalculation', 'standardCalculation', 'carelessIssues', 'methodIssues', 'errorReason', 'firstErrorPoint', 'correctionAdvice']
};
function inspectStudentVisibleText(question) {
  const issues = [];
  const inspect = (value, path) => {
    if (Array.isArray(value)) return value.forEach((item, index) => inspect(item, `${path}[${index}]`));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([field, item]) => inspect(item, `${path}.${field}`));
    if (typeof value !== 'string') return;
    if (value.includes('\uFFFD')) issues.push({ fieldPath: path, issueType: 'replacement_character' });
    if (/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(value)) issues.push({ fieldPath: path, issueType: 'control_character' });
    if (/\\(?:frac|sqrt|begin|end|text|left|right)\b/.test(value)) issues.push({ fieldPath: path, issueType: 'latex_command' });
    const words = value.match(/[A-Za-z]+/g) || [];
    if (/(?:\b[A-Za-z]+\b\s+){3,}\b[A-Za-z]+\b/.test(value)) issues.push({ fieldPath: path, issueType: 'english_sentence' });
    else if (words.join('').length >= 24 && (value.match(/[\u3400-\u9FFF]/g) || []).length < 2) issues.push({ fieldPath: path, issueType: 'latin_text_drift' });
  };
  for (const field of STUDENT_VISIBLE_FIELDS[question?.outputSchemaVersion] || []) inspect(question[field], field);
  return issues;
}
function validateStudentWorkDetection(question, index) {
  if (question.inputBasis === undefined || question.studentWorkDetected === undefined) return;
  const expected = question.inputBasis !== 'printed_question_without_work';
  if (question.studentWorkDetected !== expected) throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, 'studentWorkDetected')}`, { fieldPath: fieldPath(index, 'studentWorkDetected') });
}
function validateReadingCarelessApplicability(question, index) {
  if (question.outputSchemaVersion !== 'reading-careless.v2' || question.modeApplicability === undefined) return;
  if (!['applicable', 'not_applicable', 'uncertain'].includes(question.modeApplicability)) throw failure('LLM_SCHEMA_ERROR', `Invalid modeApplicability: ${fieldPath(index, 'modeApplicability')}`, { fieldPath: fieldPath(index, 'modeApplicability') });
  if (['work_only_complete', 'work_only_incomplete'].includes(question.inputBasis) && question.modeApplicability === 'applicable') throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, 'modeApplicability')}`, { fieldPath: fieldPath(index, 'modeApplicability') });
  if (question.modeApplicability === 'uncertain') {
    if (!['insufficient', 'unreadable'].includes(question.analysisStatus)) throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, 'analysisStatus')}`, { fieldPath: fieldPath(index, 'analysisStatus') });
    for (const field of ['conditionCorrect', 'relationCorrect', 'askCorrect']) if (question[field] !== null) throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
  }
}
function validateCalculationCarelessApplicability(question, index) {
  if (question.outputSchemaVersion !== 'calculation-careless.v2' || (question.inputBasis === undefined && question.modeApplicability === undefined && question.studentWorkDetected === undefined)) return;
  const nullableBooleans = ['layoutClear', 'digitAlignmentCorrect', 'stepsComplete', 'carryBorrowClear', 'processCorrect', 'finalAnswerCorrect', 'carelessDetected'];
  if (question.inputBasis === 'work_only_complete') {
    if (question.studentWorkDetected !== true || question.modeApplicability !== 'applicable' || question.analysisStatus !== 'ok') throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, 'inputBasis')}`, { fieldPath: fieldPath(index, 'inputBasis') });
  }
  if (question.inputBasis === 'work_only_incomplete') {
    if (!['uncertain', 'not_applicable'].includes(question.modeApplicability) || !['insufficient', 'unreadable'].includes(question.analysisStatus) || nullableBooleans.some((field) => question[field] !== null) || question.issueCategory !== 'undetermined' || String(question.standardCalculation || '').trim()) throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, 'inputBasis')}`, { fieldPath: fieldPath(index, 'inputBasis') });
  }
}
function nestedFieldPath(questionIndex, arrayField, itemIndex, field = '') {
  return `questions[${questionIndex}].${arrayField}[${itemIndex}]${field ? `.${field}` : ''}`;
}
function validateArrayItemSchemas(question, schema, questionIndex) {
  for (const [arrayField, itemSchema] of Object.entries(schema.arrayItemSchemas || {})) {
    const items = question[arrayField];
    if (!Array.isArray(items)) continue;
    items.forEach((item, itemIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw failure('LLM_SCHEMA_ERROR', `Invalid array item: ${nestedFieldPath(questionIndex, arrayField, itemIndex)}`, { fieldPath: nestedFieldPath(questionIndex, arrayField, itemIndex) });
      for (const field of itemSchema.requiredFields || []) if (item[field] === undefined) throw failure('LLM_SCHEMA_ERROR', `Missing required field: ${nestedFieldPath(questionIndex, arrayField, itemIndex, field)}`, { fieldPath: nestedFieldPath(questionIndex, arrayField, itemIndex, field) });
      for (const [field, type] of Object.entries(itemSchema.fieldTypes || {})) if (!matchesRuntimeType(item[field], type)) throw failure('LLM_SCHEMA_ERROR', `Invalid field type: ${nestedFieldPath(questionIndex, arrayField, itemIndex, field)}`, { fieldPath: nestedFieldPath(questionIndex, arrayField, itemIndex, field) });
      for (const [field, values] of Object.entries(itemSchema.enumFields || {})) if (!values.includes(item[field])) throw failure('LLM_SCHEMA_ERROR', `Invalid enum value: ${nestedFieldPath(questionIndex, arrayField, itemIndex, field)}`, { fieldPath: nestedFieldPath(questionIndex, arrayField, itemIndex, field), receivedValue: item[field], allowedValues: values });
    });
  }
}
function compactStepSourceText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[，。；：、,.!?！？()（）【】\[\]{}“”‘’'"`]/g, '');
}
function looksLikeExplanationSource(value) {
  const text = String(value || '').trim().replace(/^[①②③④⑤⑥⑦⑧⑨⑩\d]+[、.．)）:]?\s*/, '');
  return /^(因为|所以|先|再|然后|求出|相加|相减|相乘|相除|用|根据|表示|说明|得出|最后|从而|已知|要算|计算)/.test(text);
}
function hasExplicitCalculationStructure(value) {
  return /[=＝+＋\-－−×*÷/<>≤≥≈√∛²³^]/.test(String(value || ''));
}
function visibleNumberTokens(value) {
  return String(value || '').match(/\d+(?:\.\d+)?/g) || [];
}
function calculationSignalCount(value) {
  const text = String(value || '');
  const operatorCount = (text.match(/[=＝+＋\-－−×*÷/]/g) || []).length;
  const lineCount = text.split(/\n|；|;/).map((item) => item.trim()).filter(Boolean).length;
  return operatorCount + Math.max(0, lineCount - 1);
}
function explanationMatchesCalculation(explanation, calculation) {
  const exp = String(explanation || '');
  const calc = String(calculation || '');
  const expNumbers = visibleNumberTokens(exp);
  if (expNumbers.length && expNumbers.some((token) => calc.includes(token))) return true;
  if (/相加|加起来|求和/.test(exp) && /[+＋]/.test(calc)) return true;
  if (/相减|差|剩下|减少/.test(exp) && /[\-－−]/.test(calc)) return true;
  if (/相乘|乘以|倍|份数/.test(exp) && /[×*]/.test(calc)) return true;
  if (/相除|除以|平均|每份/.test(exp) && /[÷/]/.test(calc)) return true;
  if (/方程|设|未知数/.test(exp) && /[xXyY=＝]/.test(calc)) return true;
  if (/最终|最多|所以|得出/.test(exp) && visibleNumberTokens(calc).length) return true;
  return false;
}
function analysisClaimsMissingSourceIsCorrect(step) {
  const analysis = String(step?.analysis || '').trim();
  if (!analysis) return false;
  if (['missing', 'unreadable'].includes(step?.solutionStatus) && /(解题过程|计算过程|列式|该步计算).{0,8}(正确|完整|无误)/.test(analysis)) return true;
  if (['missing', 'unreadable'].includes(step?.explanationStatus) && /(讲解|解释).{0,8}(清楚|完整|正确|无误)/.test(analysis)) return true;
  return false;
}
function overallFeedbackContradictsResult(question) {
  const feedback = String(question?.overallFeedback || '').trim();
  if (!feedback) return false;
  const fullyCorrect = question?.answerStatus === 'answered'
    && question?.finalAnswerCorrect === true
    && (question?.stepRequired === false || question?.stepStatus === 'correct')
    && question?.logicStatus === 'correct';
  if (fullyCorrect) {
    return /(?:需要|仍需|应当|请).{0,10}(?:订正|调整|修改|补充|核对)|存在.{0,8}(?:错误|问题)|不正确|有误/.test(feedback);
  }
  return /(整个|全部|所有|完整).{0,10}(过程|步骤|讲解|逻辑).{0,10}(没有错误|均正确|都正确|完全正确|无误)|过程没有错误|无需调整|无需修改/.test(feedback);
}
function numberedExplanationUnitCount(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const circled = text.match(/[①②③④⑤⑥⑦⑧⑨⑩]/g) || [];
  const lineNumbered = text.match(/(?:^|[\n；;])\s*\d{1,2}[、.．)）:]\s*/g) || [];
  return Math.max(circled.length, lineNumbered.length);
}
function explanationPurposeSignalCount(value) {
  const text = String(value || '');
  const groups = [
    /设|假设|未知数/,
    /总数|总量|数量关系|列方程|建立方程/,
    /求出|解方程|中间量/,
    /相加|求和/,
    /相减|差|剩下/,
    /相乘|乘积|倍数/,
    /相除|除以|平均|每份/,
    /所以|最后|最终|最多|结论/
  ];
  return groups.filter((pattern) => pattern.test(text)).length;
}
function visibleCalculationTransformationCount(value) {
  const expressions = String(value || '')
    .split(/\r?\n|[；;]|(?:→|⇒|⟹|⟶)/)
    .map((item) => item.trim())
    .filter((item) => item && item.includes('='))
    .map((item) => ({ left: compactStepSourceText(item.slice(0, item.indexOf('='))), text: compactStepSourceText(item) }))
    .filter((item) => item.left && item.text);
  return expressions.filter((item, index) => index === 0 || item.left !== expressions[index - 1].left || item.text !== expressions[index - 1].text).length;
}
function hardProblemSegmentationWarnings(question) {
  const steps = Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks : [];
  const warnings = [];
  const copiedExplanationPairs = steps.filter((step) => {
    const solution = compactStepSourceText(step?.solutionText);
    const explanation = compactStepSourceText(step?.explanationText);
    return solution.length >= 5 && solution === explanation && looksLikeExplanationSource(step?.solutionText) && !hasExplicitCalculationStructure(step?.solutionText);
  });
  if (copiedExplanationPairs.length >= 2) warnings.push('多个步骤把同一段讲解性原文同时写入 solutionText 和 explanationText，疑似过程区与讲解区混淆。');

  const duplicateSolutions = new Map();
  const duplicateExplanations = new Map();
  steps.forEach((step, index) => {
    const solution = compactStepSourceText(step?.solutionText);
    const explanation = compactStepSourceText(step?.explanationText);
    if (solution.length >= 6) duplicateSolutions.set(solution, [...(duplicateSolutions.get(solution) || []), index]);
    if (explanation.length >= 6) duplicateExplanations.set(explanation, [...(duplicateExplanations.get(explanation) || []), index]);
  });
  if ([...duplicateSolutions.values()].some((indexes) => indexes.length >= 2)) warnings.push('同一段解题过程被重复用于多个步骤，疑似重复切分或来源污染。');
  if ([...duplicateExplanations.values()].some((indexes) => indexes.length >= 2)) warnings.push('同一段学生讲解被重复用于多个步骤，疑似重复配对。');


  if (steps.length <= 2) {
    const overMerged = steps.find((step) => {
      const solution = String(step?.solutionText || '');
      const explanation = String(step?.explanationText || '');
      const numberedUnits = numberedExplanationUnitCount(explanation);
      const purposeSignals = explanationPurposeSignalCount(explanation);
      return calculationSignalCount(solution) >= 4 && (numberedUnits >= 3 || (numberedUnits >= 2 && purposeSignals >= 3));
    });
    if (overMerged) warnings.push('一个步骤疑似合并了综合算式中的多个编号讲解目的；应从原式提取最小可见子表达式分别配对，只有确实无法区分时才合并。');
  }

  if (steps.length >= 3) {
    const first = steps[0];
    const firstSolution = String(first?.solutionText || '').trim();
    const laterExplanationOnly = steps.slice(1).filter((step) => !String(step?.solutionText || '').trim() && ['missing', 'unreadable'].includes(String(step?.solutionStatus || '')) && String(step?.explanationText || '').trim());
    const matchedLater = laterExplanationOnly.filter((step) => explanationMatchesCalculation(step.explanationText, firstSolution));
    if (calculationSignalCount(firstSolution) >= 4 && laterExplanationOnly.length >= 2 && matchedLater.length >= 2) {
      warnings.push('第1步疑似吞入整段综合计算，而后续多个编号讲解被错误标记为缺少过程；应依据可见运算、数字和语义重新拆分或合并对应单元。');
    }
  }

  if (steps.length >= 2) {
    const last = steps[steps.length - 1];
    const previous = steps[steps.length - 2];
    const lastRaw = String(last?.solutionText || '').trim();
    const answerRaw = String(question?.studentAnswer || '').trim();
    const lastWithoutPrefix = lastRaw.replace(/^(答|所以|故|因此)\s*[:：]?\s*/, '');
    const answerWithoutPrefix = answerRaw.replace(/^(答|所以|故|因此)\s*[:：]?\s*/, '');
    const lastNumbers = visibleNumberTokens(lastWithoutPrefix);
    const previousText = String(previous?.solutionText || '');
    const restatesStudentAnswer = compactStepSourceText(lastWithoutPrefix) && compactStepSourceText(lastWithoutPrefix) === compactStepSourceText(answerWithoutPrefix);
    const allResultsAlreadyVisible = lastNumbers.length > 0 && lastNumbers.every((token) => previousText.includes(token));
    const answerOnly = /^(答|所以|故|因此)\s*[:：]?/.test(lastRaw) && !/[=＝+＋\-－−×*÷/]/.test(lastWithoutPrefix);
    const noSeparateExplanation = !String(last?.explanationText || '').trim() && ['missing', 'unreadable'].includes(String(last?.explanationStatus || ''));
    if (answerOnly && restatesStudentAnswer && allResultsAlreadyVisible && noSeparateExplanation) warnings.push('最后一个步骤仅重复前一步已经得到的最终答案，疑似把答语错误拆成额外步骤。');
  }
  return warnings;
}

function hardProblemStepSemanticIssues(question, index, diagnostics = {}) {
  if (question.outputSchemaVersion !== 'hard-problem.v2' || !Array.isArray(question.stepFeedbacks)) return [];
  const issues = [];
  const add = (fieldPath, message, semanticConstraint = null) => {
    if (!issues.some((item) => item.fieldPath === fieldPath)) issues.push({ fieldPath, message, semanticConstraint });
  };
  const steps = question.stepFeedbacks;
  let hasUnreliableStepState = false;
  const answeredWithWork = question.answerStatus === 'answered' && question.stepRequired === true && question.studentWorkDetected !== false && question.modeApplicability !== 'not_applicable';
  if (answeredWithWork && steps.length === 0) { hasUnreliableStepState = true; add(fieldPath(index, 'stepFeedbacks'), `Consistency violation: ${fieldPath(index, 'stepFeedbacks')}`, 'Answered step-required work must contain at least one visible stepFeedbacks item.'); }
  const preservedLockedStepsForUnreadableResult = question.answerStatus === 'unreadable'
    && question.studentWorkDetected !== false
    && question.stepRequired === true
    && question.finalAnswerCorrect === null
    && steps.length > 0;
  if (question.stepRequired === false && steps.length !== 0) add(fieldPath(index, 'stepFeedbacks'), `Consistency violation: ${fieldPath(index, 'stepFeedbacks')}`, 'Step-not-required questions must use an empty stepFeedbacks array.');
  if (question.answerStatus === 'unanswered' && question.stepRequired === true && question.studentWorkDetected === false) {
    steps.forEach((step, stepIndex) => {
      const base = `questions[${index}].stepFeedbacks[${stepIndex}]`;
      if (String(step.solutionText || '').trim()) add(`${base}.solutionText`, `Unanswered question cannot contain student solution source: ${base}.solutionText`, 'Expected missing-step guidance may be retained, but solutionText must remain empty because it represents only student-authored source text.');
      if (String(step.explanationText || '').trim()) add(`${base}.explanationText`, `Unanswered question cannot contain student explanation source: ${base}.explanationText`, 'Expected missing-step guidance may be retained, but explanationText must remain empty because it represents only student-authored source text.');
      if (!['missing', 'unreadable'].includes(step.solutionStatus)) add(`${base}.solutionStatus`, `Unanswered question step must be missing or unreadable: ${base}.solutionStatus`, 'Do not mark a non-existent student solution as correct or wrong.');
      if (!['missing', 'unreadable'].includes(step.explanationStatus)) add(`${base}.explanationStatus`, `Unanswered question explanation must be missing or unreadable: ${base}.explanationStatus`, 'Do not mark a non-existent student explanation as clear, partial, or incorrect.');
      if (!['insufficient', 'unreadable'].includes(step.logicStatus)) add(`${base}.logicStatus`, `Unanswered question logic must be insufficient or unreadable: ${base}.logicStatus`, 'Missing student reasoning cannot be marked logically clear.');
    });
  }
  if (question.answerStatus === 'unreadable' && steps.length !== 0 && !preservedLockedStepsForUnreadableResult) add(fieldPath(index, 'stepFeedbacks'), `Consistency violation: ${fieldPath(index, 'stepFeedbacks')}`, 'An unreadable result may retain fixed stepFeedbacks only when visible student work was detected, finalAnswerCorrect is null, and the steps are preserved for safe manual review.');
  if (!String(question.overallFeedback || '').trim()) add(fieldPath(index, 'overallFeedback'), `Missing overallFeedback: ${fieldPath(index, 'overallFeedback')}`, 'overallFeedback must be a non-empty student-facing summary.');
  if (overallFeedbackContradictsResult(question)) add(fieldPath(index, 'overallFeedback'), `overallFeedback contradicts the structured result: ${fieldPath(index, 'overallFeedback')}`, 'Rewrite overallFeedback so it agrees with finalAnswerCorrect, stepStatus, logicStatus, and stepFeedbacks. Do not claim the whole process is error-free when required process or explanation evidence is missing, unreadable, wrong, or insufficient.');
  steps.forEach((step, stepIndex) => {
    const base = `questions[${index}].stepFeedbacks[${stepIndex}]`;
    if (step.stepIndex !== stepIndex + 1) add(`${base}.stepIndex`, `Step index must be continuous: ${base}.stepIndex`, 'stepIndex must start at 1 and increase continuously without gaps.');
    if (!String(step.analysis || '').trim()) add(`${base}.analysis`, `Step analysis must be non-empty: ${base}.analysis`, 'analysis must be a non-empty, concrete, student-facing judgment.');
    if (analysisClaimsMissingSourceIsCorrect(step)) add(`${base}.analysis`, `Step analysis contradicts missing or unreadable source evidence: ${base}.analysis`, 'Do not describe a missing or unreadable solution/explanation as correct or clear. Rewrite analysis to match the source statuses without inventing student text.');
    const solutionText = String(step.solutionText || '').trim();
    const explanationText = String(step.explanationText || '').trim();
    let stepStateConflict = false;
    if (step.solutionStatus === 'missing' && solutionText) { stepStateConflict = true; add(`${base}.solutionStatus`, `Visible solution text conflicts with missing status: ${base}.solutionStatus`, 'Preserve solutionText and repair solutionStatus to match the visible student work.'); }
    if (['correct', 'wrong'].includes(step.solutionStatus) && !solutionText) { stepStateConflict = true; add(`${base}.solutionStatus`, `Solution status requires visible source text: ${base}.solutionStatus`, 'Do not fabricate solutionText; repair solutionStatus to missing or unreadable as supported by the image.'); }
    if (step.explanationStatus === 'missing' && explanationText) { stepStateConflict = true; add(`${base}.explanationStatus`, `Visible explanation text conflicts with missing status: ${base}.explanationStatus`, 'Preserve explanationText and repair explanationStatus to match the visible student explanation.'); }
    if (['clear', 'partially_clear', 'incorrect'].includes(step.explanationStatus) && !explanationText) { stepStateConflict = true; add(`${base}.explanationStatus`, `Explanation status requires visible source text: ${base}.explanationStatus`, 'Do not fabricate explanationText; repair explanationStatus to missing or unreadable as supported by the image.'); }
    hasUnreliableStepState ||= stepStateConflict;
    const stepFullyClear = step.solutionStatus === 'correct' && step.explanationStatus === 'clear' && step.logicStatus === 'clear';
    const correctionAdvice = String(step.correctionAdvice || '').trim();
    if (!stepStateConflict && !stepFullyClear && !correctionAdvice) add(`${base}.correctionAdvice`, `Step correction advice must be non-empty: ${base}.correctionAdvice`, 'Any wrong, missing, unreadable, partial, or logically insufficient step must include a concrete student-facing correction or re-upload instruction.');
    if (!stepStateConflict && stepFullyClear && correctionAdvice) add(`${base}.correctionAdvice`, `Correct step must not contain correction advice: ${base}.correctionAdvice`, 'A fully correct and clear step must use an empty correctionAdvice string.');
  });
  if (diagnostics.fixedStepReview !== true && diagnostics.directHardProblemOutput !== true) {
    const segmentationWarnings = hardProblemSegmentationWarnings(question);
    if (segmentationWarnings.length) {
      hasUnreliableStepState = true;
      add(fieldPath(index, 'stepFeedbacks'), `Source segmentation requires review: ${fieldPath(index, 'stepFeedbacks')}`, `Re-read the original image and rebuild the complete evidence-backed stepFeedbacks array without inventing or dropping source text. Do not repair only stepIndex. Missing, unreadable, unnumbered, and unmatched units are valid. ${segmentationWarnings.join(' ')}`);
    }
  }
  const aggregate = deriveHardProblemAggregateState(question, steps);
  const fullyClear = aggregate.fullyClear;
  if (String(question.knowledgePoint || '').trim()) add(fieldPath(index, 'knowledgePoint'), `knowledgePoint must remain empty: ${fieldPath(index, 'knowledgePoint')}`, 'HARD_PROBLEM_CHECK does not produce knowledge-point analysis; use an empty string.');
  if (question.answerStatus === 'answered' && !String(question.standardAnswer || '').trim()) add(fieldPath(index, 'standardAnswer'), `Missing standardAnswer: ${fieldPath(index, 'standardAnswer')}`, 'An answered hard-problem question must include a non-empty objective standard solution.');
  if (question.answerStatus === 'answered' && !hasUnreliableStepState) {
    const needsCorrection = question.finalAnswerCorrect !== true || (question.stepRequired === true && !fullyClear);
    if (needsCorrection) {
      if (question.errorType === 'none') add(fieldPath(index, 'errorType'), `errorType conflicts with a result requiring correction: ${fieldPath(index, 'errorType')}`, 'Use a concrete non-none errorType when the final answer, solution process, explanation, or logic requires correction.');
      if (!String(question.firstWrongStep || '').trim()) add(fieldPath(index, 'firstWrongStep'), `Missing affected-step summary: ${fieldPath(index, 'firstWrongStep')}`, 'List every affected solution, explanation, logic step, or the final answer in original order.');
      if (!String(question.errorReason || '').trim()) add(fieldPath(index, 'errorReason'), `Missing concrete errorReason: ${fieldPath(index, 'errorReason')}`, 'Summarize the concrete reasons shown by the final answer and stepFeedbacks.');
      if (!String(question.adjustmentSuggestion || '').trim()) add(fieldPath(index, 'adjustmentSuggestion'), `Missing adjustmentSuggestion: ${fieldPath(index, 'adjustmentSuggestion')}`, 'Summarize the concrete repairs required by the final answer and stepFeedbacks.');
    }
  }
  const expectedStepStatus = aggregate.stepStatus;
  const expectedLogicStatus = aggregate.logicStatus;
  if (question.stepStatus !== expectedStepStatus) add(fieldPath(index, 'stepStatus'), `stepStatus conflicts with stepFeedbacks: ${fieldPath(index, 'stepStatus')}`, `stepStatus must be ${expectedStepStatus} for the current stepFeedbacks.`);
  if (question.logicStatus !== expectedLogicStatus) add(fieldPath(index, 'logicStatus'), `logicStatus conflicts with stepFeedbacks: ${fieldPath(index, 'logicStatus')}`, `logicStatus must be ${expectedLogicStatus} for the current stepFeedbacks. Precedence is wrong, then unreadable, then insufficient, then correct.`);
  return issues;
}
function validateHardProblemStepSemantics(question, index, diagnostics = {}) {
  const issues = hardProblemStepSemanticIssues(question, index, diagnostics);
  if (!issues.length) return;
  const first = issues[0];
  throw failure('LLM_SCHEMA_ERROR', first.message, { fieldPath: first.fieldPath, semanticConstraint: first.semanticConstraint || null });
}
function validateQuestion(question, schema, index, diagnostics = {}) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) throw failure('LLM_SCHEMA_ERROR', 'Question must be an object', { fieldPath: `questions[${index}]` });
  const strictEvidenceFields = diagnostics.requireEvidenceFields === true || schema.requiresEvidenceFields === true;
  const requiredFields = strictEvidenceFields ? schema.requiredFields : schema.requiredFields.filter((field) => !EVIDENCE_FIELDS.includes(field));
  for (const field of requiredFields) if (question[field] === undefined) throw failure('LLM_SCHEMA_ERROR', `Missing required field: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
  for (const field of ['sourceKey', 'questionText']) {
    if (requiredFields.includes(field) && typeof question[field] === 'string' && !question[field].trim()) throw failure('LLM_SCHEMA_ERROR', `Missing ${field}: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
  }
  for (const [field, type] of Object.entries(schema.fieldTypes)) {
    if (!strictEvidenceFields && EVIDENCE_FIELDS.includes(field)) continue;
    if (question[field] === null && nullableValueAllowed(question, schema, field)) continue;
    if (!matchesRuntimeType(question[field], type)) throw failure('LLM_SCHEMA_ERROR', `Invalid field type: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
  }
  for (const [field, values] of Object.entries(schema.enumFields)) if ((strictEvidenceFields || !['inputBasis', 'modeApplicability'].includes(field)) && !values.includes(question[field])) throw failure('LLM_SCHEMA_ERROR', `Invalid enum value: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field), receivedValue: question[field], allowedValues: values, questionIndex: index, requestStage: diagnostics.requestStage ?? null });
  for (const field of schema.arrayFields) if (!Array.isArray(question[field])) throw failure('LLM_SCHEMA_ERROR', `Invalid array field: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
  for (const [field, range] of Object.entries(schema.numericRanges)) if (!Number.isFinite(question[field]) || question[field] < range.min || question[field] > range.max) throw failure('LLM_SCHEMA_ERROR', `Numeric range violation: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
  validateArrayItemSchemas(question, schema, index);
  for (const rule of schema.consistencyRules) {
    if (!Object.entries(rule.when).every(([field, value]) => question[field] === value)) continue;
    for (const [field, value] of Object.entries(rule.require || {})) if (question[field] !== value) throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
    for (const field of rule.requireNull || []) if (question[field] !== null) throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
    for (const [field, type] of Object.entries(rule.requireTypes || {})) if (!matchesRuntimeType(question[field], type)) throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
    for (const field of rule.requireNonEmptyStrings || []) if (typeof question[field] !== 'string' || !question[field].trim()) throw failure('LLM_SCHEMA_ERROR', `Consistency violation: ${fieldPath(index, field)}`, { fieldPath: fieldPath(index, field) });
  }
  validateHardProblemStepSemantics(question, index, diagnostics);
  validateStudentWorkDetection(question, index);
  validateReadingCarelessApplicability(question, index);
  validateCalculationCarelessApplicability(question, index);
}
function issue(issues, details) {
  const field = details.fieldPath;
  if (issues.some((item) => item.fieldPath === field)) return;
  const message = details.message || (details.validator === 'consistency-rule' ? `Consistency violation: ${field}` : 'Model output validation failed');
  issues.push({ code: 'LLM_SCHEMA_ERROR', message, reason: null, expectedType: null, actualType: null, repairable: false, validator: 'schema', relatedFieldPaths: [], questionIndex: null, sourceKey: null, ...details, message });
}
function questionIssue(issues, question, index, details) {
  issue(issues, { questionIndex: index, sourceKey: typeof question?.sourceKey === 'string' ? question.sourceKey : null, ...details });
}
function customSemanticIssue(issues, question, index, schema, details) {
  const field = details.fieldPath.match(/\.([^.]+)$/)?.[1];
  questionIssue(issues, question, index, {
    expectedType: schema.fieldTypes[field],
    allowedEnums: schema.enumFields?.[field] || null,
    repairReason: details.semanticConstraint,
    ...details,
  });
}
function collectCustomSemanticIssues(question, index, issues, schema, diagnostics = {}) {
  const path = (field) => fieldPath(index, field);
  if (question.inputBasis !== undefined && question.studentWorkDetected !== undefined) {
    const expectedStudentWorkDetected = question.inputBasis !== 'printed_question_without_work';
    if (question.studentWorkDetected !== expectedStudentWorkDetected) customSemanticIssue(issues, question, index, schema, { code: 'STUDENT_WORK_DETECTION_INPUT_BASIS_MISMATCH', fieldPath: path('studentWorkDetected'), actualType: typeof question.studentWorkDetected, repairable: true, validator: 'student-work-input-basis', relatedFieldPaths: [path('inputBasis')], semanticConstraint: 'studentWorkDetected must be false only for printed_question_without_work and true for every other supported inputBasis.' });
  }
  if (question.outputSchemaVersion === 'hard-problem.v2') {
    for (const semanticIssue of hardProblemStepSemanticIssues(question, index, diagnostics)) {
      questionIssue(issues, question, index, { code: 'LLM_SCHEMA_ERROR', message: semanticIssue.message, fieldPath: semanticIssue.fieldPath || path('stepFeedbacks'), actualType: 'semantic', repairable: true, validator: 'hard-problem-step-semantics', semanticConstraint: semanticIssue.semanticConstraint || null });
    }
  }
  if (question.outputSchemaVersion === 'reading-careless.v2' && question.modeApplicability !== undefined) {
    if (!['applicable', 'not_applicable', 'uncertain'].includes(question.modeApplicability)) customSemanticIssue(issues, question, index, schema, { code: 'READING_CARELESS_MODE_APPLICABILITY_INVALID', fieldPath: path('modeApplicability'), actualType: typeof question.modeApplicability, repairable: true, validator: 'reading-careless-applicability', relatedFieldPaths: [], semanticConstraint: 'modeApplicability must be a supported reading-careless applicability state.' });
    if (['work_only_complete', 'work_only_incomplete'].includes(question.inputBasis) && question.modeApplicability === 'applicable') customSemanticIssue(issues, question, index, schema, { code: 'READING_CARELESS_WORK_ONLY_APPLICABILITY_CONSTRAINT', fieldPath: path('modeApplicability'), actualType: typeof question.modeApplicability, repairable: true, validator: 'reading-careless-applicability', relatedFieldPaths: [path('inputBasis')], semanticConstraint: 'When inputBasis is work-only, modeApplicability cannot be applicable.' });
    if (question.modeApplicability === 'uncertain') {
      if (!['insufficient', 'unreadable'].includes(question.analysisStatus)) customSemanticIssue(issues, question, index, schema, { code: 'READING_CARELESS_UNCERTAIN_CONSTRAINT', fieldPath: path('analysisStatus'), actualType: typeof question.analysisStatus, repairable: true, validator: 'reading-careless-applicability', relatedFieldPaths: [path('modeApplicability')], semanticConstraint: 'When modeApplicability is uncertain, analysisStatus must be insufficient or unreadable and reading judgments must be null.' });
      for (const field of ['conditionCorrect', 'relationCorrect', 'askCorrect']) if (question[field] !== null) customSemanticIssue(issues, question, index, schema, { code: 'READING_CARELESS_UNCERTAIN_CONSTRAINT', fieldPath: path(field), actualType: question[field] === null ? 'null' : typeof question[field], repairable: true, validator: 'reading-careless-applicability', relatedFieldPaths: [path('modeApplicability'), path('analysisStatus')], semanticConstraint: 'When modeApplicability is uncertain, reading judgments must be null.' });
    }
  }
  if (question.outputSchemaVersion === 'calculation-careless.v2' && !(question.inputBasis === undefined && question.modeApplicability === undefined && question.studentWorkDetected === undefined)) {
    const nullableBooleans = ['layoutClear', 'digitAlignmentCorrect', 'stepsComplete', 'carryBorrowClear', 'processCorrect', 'finalAnswerCorrect', 'carelessDetected'];
    if (question.inputBasis === 'work_only_complete' && (question.studentWorkDetected !== true || question.modeApplicability !== 'applicable' || question.analysisStatus !== 'ok')) customSemanticIssue(issues, question, index, schema, { code: 'CALCULATION_CARELESS_WORK_COMPLETE_CONSTRAINT', fieldPath: path('inputBasis'), actualType: typeof question.inputBasis, repairable: true, validator: 'calculation-careless-applicability', relatedFieldPaths: [path('studentWorkDetected'), path('modeApplicability'), path('analysisStatus')], semanticConstraint: 'When inputBasis is work_only_complete, studentWorkDetected must be true, modeApplicability must be applicable, and analysisStatus must be ok.' });
    if (question.inputBasis === 'work_only_incomplete') {
      const constraint = 'When inputBasis is work_only_incomplete, modeApplicability must be uncertain or not_applicable, analysisStatus must be insufficient or unreadable, calculation judgments must be null, issueCategory must be undetermined, and standardCalculation must be empty.';
      if (!['uncertain', 'not_applicable'].includes(question.modeApplicability)) customSemanticIssue(issues, question, index, schema, { code: 'CALCULATION_CARELESS_WORK_INCOMPLETE_CONSTRAINT', fieldPath: path('modeApplicability'), actualType: typeof question.modeApplicability, repairable: true, validator: 'calculation-careless-applicability', relatedFieldPaths: [path('inputBasis')], semanticConstraint: constraint });
      if (!['insufficient', 'unreadable'].includes(question.analysisStatus)) customSemanticIssue(issues, question, index, schema, { code: 'CALCULATION_CARELESS_WORK_INCOMPLETE_CONSTRAINT', fieldPath: path('analysisStatus'), actualType: typeof question.analysisStatus, repairable: true, validator: 'calculation-careless-applicability', relatedFieldPaths: [path('inputBasis')], semanticConstraint: constraint });
      for (const field of nullableBooleans) if (question[field] !== null) customSemanticIssue(issues, question, index, schema, { code: 'CALCULATION_CARELESS_WORK_INCOMPLETE_CONSTRAINT', fieldPath: path(field), actualType: question[field] === null ? 'null' : typeof question[field], repairable: true, validator: 'calculation-careless-applicability', relatedFieldPaths: [path('inputBasis')], semanticConstraint: constraint });
      if (question.issueCategory !== 'undetermined') customSemanticIssue(issues, question, index, schema, { code: 'CALCULATION_CARELESS_WORK_INCOMPLETE_CONSTRAINT', fieldPath: path('issueCategory'), actualType: typeof question.issueCategory, repairable: true, validator: 'calculation-careless-applicability', relatedFieldPaths: [path('inputBasis')], semanticConstraint: constraint });
      if (String(question.standardCalculation || '').trim()) customSemanticIssue(issues, question, index, schema, { code: 'CALCULATION_CARELESS_WORK_INCOMPLETE_CONSTRAINT', fieldPath: path('standardCalculation'), actualType: typeof question.standardCalculation, repairable: true, validator: 'calculation-careless-applicability', relatedFieldPaths: [path('inputBasis')], semanticConstraint: constraint });
    }
  }
}
function collectArrayItemSchemaIssues(question, schema, questionIndex, issues) {
  for (const [arrayField, itemSchema] of Object.entries(schema.arrayItemSchemas || {})) {
    const items = question[arrayField];
    if (!Array.isArray(items)) continue;
    items.forEach((item, itemIndex) => {
      const base = nestedFieldPath(questionIndex, arrayField, itemIndex);
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        questionIssue(issues, question, questionIndex, { fieldPath: base, expectedType: 'object', actualType: Array.isArray(item) ? 'array' : typeof item, repairable: true, validator: 'array-item' });
        return;
      }
      for (const field of itemSchema.requiredFields || []) if (item[field] === undefined) questionIssue(issues, question, questionIndex, { fieldPath: `${base}.${field}`, reason: 'missing required field', expectedType: itemSchema.fieldTypes[field], actualType: 'undefined', repairable: true, validator: 'array-item-required' });
      for (const [field, type] of Object.entries(itemSchema.fieldTypes || {})) if (!matchesRuntimeType(item[field], type)) questionIssue(issues, question, questionIndex, { fieldPath: `${base}.${field}`, expectedType: type, actualType: Array.isArray(item[field]) ? 'array' : typeof item[field], repairable: true, validator: 'array-item-type' });
      for (const [field, values] of Object.entries(itemSchema.enumFields || {})) if (!values.includes(item[field])) questionIssue(issues, question, questionIndex, { fieldPath: `${base}.${field}`, expectedType: 'enum', actualType: typeof item[field], allowedEnums: values, repairable: true, validator: 'array-item-enum' });
    });
  }
}

function collectTopLevelObjectSchemaIssues(result, field, objectSchema, issues) {
  const value = result?.[field];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  let invalid = false;
  for (const requiredField of objectSchema.requiredFields || []) if (value[requiredField] === undefined) invalid = true;
  for (const [objectField, type] of Object.entries(objectSchema.fieldTypes || {})) {
    if (value[objectField] !== undefined && !matchesRuntimeType(value[objectField], type)) invalid = true;
  }
  for (const [objectField, values] of Object.entries(objectSchema.enumFields || {})) {
    if (!values.includes(value[objectField])) invalid = true;
  }
  for (const namedRule of objectSchema.consistencyRules || []) {
    if (namedRule === 'emittedQuestionCount_equals_questions_length' && value.emittedQuestionCount !== (Array.isArray(result?.questions) ? result.questions.length : null)) invalid = true;
    if (namedRule === 'visibleIndependentQuestionCount_equals_emittedQuestionCount_plus_excludedQuestionCount' && value.visibleIndependentQuestionCount !== value.emittedQuestionCount + value.excludedQuestionCount) invalid = true;
  }
  if (invalid) issue(issues, { fieldPath: field, reason: `invalid ${field} object`, expectedType: 'object', actualType: 'object', repairable: true, validator: 'top-level-object-schema' });
}
function collectTopLevelSchemaIssues(result, schema, issues) {
  const protectedFields = new Set(['outputSchemaVersion', 'questions']);
  for (const field of schema.topLevelRequiredFields || []) {
    if (result?.[field] === undefined) issue(issues, { fieldPath: field, reason: 'missing required top-level field', expectedType: schema.topLevelFieldTypes?.[field] || null, actualType: 'undefined', repairable: !protectedFields.has(field) && Boolean(schema.topLevelFieldTypes?.[field]), validator: 'top-level-required' });
  }
  for (const [field, type] of Object.entries(schema.topLevelFieldTypes || {})) {
    if (result?.[field] === undefined) continue;
    if (!matchesRuntimeType(result[field], type)) issue(issues, { fieldPath: field, expectedType: type, actualType: Array.isArray(result[field]) ? 'array' : typeof result[field], repairable: !protectedFields.has(field), validator: 'top-level-type' });
  }
  for (const [field, values] of Object.entries(schema.topLevelEnumFields || {})) {
    if (result?.[field] !== undefined && !values.includes(result[field])) issue(issues, { fieldPath: field, expectedType: 'enum', actualType: typeof result[field], allowedEnums: values, repairable: !protectedFields.has(field), validator: 'top-level-enum' });
  }
  for (const [field, objectSchema] of Object.entries(schema.topLevelObjectSchemas || {})) collectTopLevelObjectSchemaIssues(result, field, objectSchema, issues);
}

function hardProblemStepDefectLabels(step, index) {
  const labels = [];
  if (step?.solutionStatus === 'wrong') labels.push(`第${index + 1}步解题过程错误`);
  else if (step?.solutionStatus === 'missing') labels.push(`第${index + 1}步缺少解题过程`);
  else if (step?.solutionStatus === 'unreadable') labels.push(`第${index + 1}步解题过程无法辨认`);
  if (step?.explanationStatus === 'incorrect') labels.push(`第${index + 1}步讲解错误`);
  else if (step?.explanationStatus === 'partially_clear') labels.push(`第${index + 1}步讲解不完整`);
  else if (step?.explanationStatus === 'missing') labels.push(`第${index + 1}步缺少讲解`);
  else if (step?.explanationStatus === 'unreadable') labels.push(`第${index + 1}步讲解无法辨认`);
  if (step?.logicStatus === 'wrong') labels.push(`第${index + 1}步逻辑错误`);
  else if (step?.logicStatus === 'insufficient') labels.push(`第${index + 1}步逻辑说明不足`);
  else if (step?.logicStatus === 'unreadable') labels.push(`第${index + 1}步逻辑无法判断`);
  return labels;
}
function deriveHardProblemAggregateState(question, stepsInput = question?.stepFeedbacks) {
  const steps = Array.isArray(stepsInput) ? stepsInput : [];
  const fullyClear = steps.length > 0 && steps.every((step) => step?.solutionStatus === 'correct' && step?.explanationStatus === 'clear' && step?.logicStatus === 'clear');
  const hasSolutionMissing = steps.some((step) => step?.solutionStatus === 'missing');
  const hasSolutionUnreadable = steps.some((step) => step?.solutionStatus === 'unreadable');
  const hasSolutionWrong = steps.some((step) => step?.solutionStatus === 'wrong');
  const hasLogicWrong = steps.some((step) => step?.explanationStatus === 'incorrect' || step?.logicStatus === 'wrong');
  const hasLogicUnreadable = steps.some((step) => step?.explanationStatus === 'unreadable' || step?.logicStatus === 'unreadable' || step?.solutionStatus === 'unreadable');
  const hasLogicInsufficient = steps.some((step) => step?.logicStatus === 'insufficient');

  let stepStatus;
  if (question?.stepRequired === false) stepStatus = 'not_required';
  else if (question?.answerStatus === 'unreadable') stepStatus = 'unreadable';
  else if (!steps.length || hasSolutionMissing) stepStatus = 'missing';
  else if (hasSolutionUnreadable) stepStatus = 'unreadable';
  else if (hasSolutionWrong || !fullyClear) stepStatus = 'wrong';
  else stepStatus = 'correct';

  let logicStatus;
  if (question?.answerStatus === 'unreadable') logicStatus = 'unreadable';
  else if (question?.stepRequired === false) logicStatus = 'correct';
  else if (!steps.length) logicStatus = 'insufficient';
  else if (hasLogicWrong) logicStatus = 'wrong';
  else if (hasLogicUnreadable) logicStatus = 'unreadable';
  else if (hasLogicInsufficient) logicStatus = 'insufficient';
  else logicStatus = 'correct';

  return {
    fullyClear,
    stepStatus,
    logicStatus,
    hasSolutionMissing,
    hasSolutionUnreadable,
    hasSolutionWrong,
    hasLogicWrong,
    hasLogicUnreadable,
    hasLogicInsufficient,
  };
}
function deriveHardProblemStepStatus(question, steps) {
  return deriveHardProblemAggregateState(question, steps).stepStatus;
}
function deriveHardProblemLogicStatus(question, steps) {
  return deriveHardProblemAggregateState(question, steps).logicStatus;
}
function deriveHardProblemEvaluationStatus(question) {
  if (question?.answerStatus === 'unanswered') return 'UNANSWERED';
  if (question?.answerStatus === 'unreadable') return 'UNREADABLE';
  if (question?.finalAnswerCorrect === false) return 'WRONG';
  if (question?.finalAnswerCorrect === true) {
    if (question?.stepRequired !== false && question?.stepStatus === 'unreadable') return 'UNREADABLE';
    if (question?.logicStatus === 'unreadable') return 'UNREADABLE';
    if ((question?.stepRequired === false || question?.stepStatus === 'correct') && question?.logicStatus === 'correct') return 'CORRECT';
  }
  return 'WRONG';
}
function hardProblemPurposeExplanationIsEnoughForElementaryEquation(step) {
  if (step?.solutionStatus !== 'correct' || step?.explanationStatus !== 'partially_clear' || step?.logicStatus !== 'clear') return false;
  const solution = String(step?.solutionText || '').trim();
  const explanation = String(step?.explanationText || '').trim();
  if (!solution || !explanation) return false;
  // Keep this narrow: a correct elementary equation step does not need every mechanical
  // transformation repeated in words when the student has already stated the step's purpose.
  if (!/[a-zA-Z]/.test(solution) || !/[=＝]/.test(solution)) return false;
  const statesPurpose = /(解方程|求出|求得|解出|解得|算出|得到|得出|求[^，。；;]{0,12}(数量|总数|个数|本数|人数|长度|面积|体积|未知数|[xXyY]|量))/.test(explanation);
  if (!statesPurpose) return false;
  const rationale = `${String(step?.analysis || '')} ${String(step?.correctionAdvice || '')}`;
  const onlyMechanicalDetail = /(等式两边|两边同时|同时除以|同时乘以|同除以|同乘以|移项|合并同类项|化简方程|运算依据|推导依据|从.{0,20}[=＝].{0,20}到.{0,20}[=＝]|除以.{0,12}系数)/.test(rationale);
  const substantiveRelationshipGap = /(题目条件|数量关系|倍数关系|总数关系|差量关系|为什么.{0,6}(乘|除|加|减)|因为.{0,16}(倍|总数|相差|每|平均))/.test(rationale);
  return onlyMechanicalDetail && !substantiveRelationshipGap;
}
function normalizeHardProblemTeachingStep(step) {
  let next = { ...step };
  if (hardProblemPurposeExplanationIsEnoughForElementaryEquation(next)) {
    next = { ...next, explanationStatus: 'clear', correctionAdvice: '', analysis: '本步解题过程正确，学生讲解已说明求解目的，数学逻辑成立。' };
  }
  const fullyClear = next?.solutionStatus === 'correct' && next?.explanationStatus === 'clear' && next?.logicStatus === 'clear';
  if (fullyClear) {
    next.correctionAdvice = '';
    const analysis = String(next.analysis || '').trim();
    if (!analysis || analysis.length > 48) next.analysis = '本步解题过程正确，学生讲解与数学逻辑一致。';
  }
  return next;
}

function deriveHardProblemErrorType(question, steps, stepStatusInput = null, logicStatusInput = null) {
  if (question?.answerStatus === 'unanswered') return 'unanswered';
  if (question?.answerStatus === 'unreadable') return 'unreadable';
  const aggregate = stepStatusInput && logicStatusInput
    ? { stepStatus: stepStatusInput, logicStatus: logicStatusInput }
    : deriveHardProblemAggregateState(question, steps);
  const { stepStatus, logicStatus } = aggregate;
  const evaluationStatus = deriveHardProblemEvaluationStatus({ ...question, stepStatus, logicStatus });
  if (evaluationStatus === 'CORRECT') return 'none';
  if (evaluationStatus === 'UNREADABLE') return 'unreadable';

  const hasAnswerError = question?.finalAnswerCorrect === false;
  const hasSolutionError = steps.some((step) => step?.solutionStatus === 'wrong');
  const hasLogicDefect = steps.some((step) => ['incorrect', 'partially_clear', 'missing'].includes(step?.explanationStatus) || ['wrong', 'insufficient'].includes(step?.logicStatus));
  const existing = String(question?.errorType || '').trim();

  // finalAnswerCorrect=false is usually the consequence of a process defect, not a second
  // independent defect category. Preserve a more specific compatible root-cause label.
  const existingCompatible =
    (existing === 'answer_error' && hasAnswerError && !hasSolutionError && !hasLogicDefect)
    || (existing === 'calculation_error' && hasSolutionError && !hasLogicDefect)
    || (existing === 'method_error' && (hasSolutionError || hasLogicDefect))
    || (existing === 'logic_error' && hasLogicDefect && !hasSolutionError)
    || (existing === 'multiple' && hasSolutionError && hasLogicDefect);
  if (existingCompatible) return existing;
  if (hasSolutionError && hasLogicDefect) return 'multiple';
  if (hasSolutionError) return 'calculation_error';
  if (hasLogicDefect) return 'logic_error';
  if (hasAnswerError) return 'answer_error';
  return 'logic_error';
}
function normalizeHardProblemQuestion(question) {
  if (!question || question.outputSchemaVersion !== 'hard-problem.v2') return question;
  const indexedSteps = Array.isArray(question.stepFeedbacks)
    ? question.stepFeedbacks.map((step, index) => ({ ...step, stepIndex: index + 1 }))
    : question.stepFeedbacks;
  if (!Array.isArray(indexedSteps)) return question;
  const steps = realignHardProblemExplanations(indexedSteps)
    .map((step, index) => ({ ...step, stepIndex: index + 1 }))
    .map(normalizeHardProblemTeachingStep);
  const stepStatus = deriveHardProblemStepStatus(question, steps);
  const logicStatus = deriveHardProblemLogicStatus(question, steps);
  const errorType = deriveHardProblemErrorType(question, steps, stepStatus, logicStatus);
  const defects = steps.flatMap(hardProblemStepDefectLabels);
  if (question.finalAnswerCorrect === false) defects.push('最终答案错误');
  const fullyCorrect = question.answerStatus === 'answered' && question.finalAnswerCorrect === true && (question.stepRequired === false || stepStatus === 'correct') && logicStatus === 'correct';
  let firstWrongStep = String(question.firstWrongStep || '').trim();
  let errorReason = String(question.errorReason || '').trim();
  let adjustmentSuggestion = String(question.adjustmentSuggestion || '').trim();
  let overallFeedback = String(question.overallFeedback || '').trim();
  if (fullyCorrect) {
    firstWrongStep = '';
    errorReason = '';
    adjustmentSuggestion = '';
    if (!overallFeedback || overallFeedbackContradictsResult({ ...question, stepStatus, logicStatus, finalAnswerCorrect: true })) overallFeedback = question.stepRequired === false ? '最终答案正确，本题无需额外解题步骤。' : '最终答案、解题过程和讲解均正确。';
  } else if (question.answerStatus === 'unanswered') {
    firstWrongStep = firstWrongStep || '';
    errorReason = errorReason || '未检测到学生作答。';
    adjustmentSuggestion = adjustmentSuggestion || '请写出答案，并尽量补充解题过程和讲解。';
    overallFeedback = overallFeedback || '本题未作答，暂时无法进行逐步分析。';
  } else if (question.answerStatus === 'unreadable') {
    firstWrongStep = firstWrongStep || '';
    errorReason = errorReason || '关键作答内容无法可靠辨认。';
    adjustmentSuggestion = adjustmentSuggestion || '请重新拍摄清晰、完整的作答图片。';
    overallFeedback = overallFeedback || '图片中的关键作答内容无法辨认，需要重新拍摄。';
  } else {
    const defectSummary = [...new Set(defects)].join('；');
    firstWrongStep = firstWrongStep || defectSummary;
    errorReason = errorReason || defectSummary || '解题过程或讲解需要进一步核对。';
    adjustmentSuggestion = adjustmentSuggestion || steps.map((step) => String(step?.correctionAdvice || '').trim()).filter(Boolean).join('；') || '请根据逐步分析补充或订正对应内容。';
    if (!overallFeedback || overallFeedbackContradictsResult({ ...question, stepStatus, logicStatus, overallFeedback })) {
      overallFeedback = question.finalAnswerCorrect === true ? '最终答案正确，但部分解题过程或讲解需要补充或调整。' : '最终答案或解题过程存在问题，请根据逐步分析订正。';
    }
  }
  return { ...question, stepFeedbacks: steps, stepStatus, logicStatus, errorType, firstWrongStep, errorReason, adjustmentSuggestion, knowledgePoint: '', overallFeedback };
}
function normalizeNewModelResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  let normalized = result;
  if (result.outputSchemaVersion === 'hard-problem.v2' && Array.isArray(result.questions)) {
    normalized = { ...result, questions: result.questions.map(normalizeHardProblemQuestion) };
  }
  if (normalized.questionSetAudit && typeof normalized.questionSetAudit === 'object' && !Array.isArray(normalized.questionSetAudit) && Array.isArray(normalized.questions)) {
    normalized = { ...normalized, questionSetAudit: { ...normalized.questionSetAudit, emittedQuestionCount: normalized.questions.length } };
  }
  return normalized;
}
function collectNewModelResultIssues(result, diagnostics = {}) {
  const issues = [], receivedVersion = result?.outputSchemaVersion;
  if (typeof receivedVersion !== 'string' || !registry.getSchema(receivedVersion)) {
    issue(issues, { code: 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', message: 'Unsupported output schema version', fieldPath: 'outputSchemaVersion', expectedType: 'supported schema version', actualType: typeof receivedVersion, receivedVersion, supportedVersions: registry.schemas.map((schema) => schema.schemaId), repairable: false, validator: 'schema-version' });
    return issues;
  }
  const schema = resolveRuntimeSchema(diagnostics.strategy, receivedVersion);
  const strictHardTopLevel = receivedVersion === 'hard-problem.v2' && ['outputSchemaVersion', 'mode', 'route', 'imageQuality', 'questions', 'questionSetAudit'].every((field) => schema.topLevelRequiredFields?.includes(field) && schema.topLevelFieldTypes?.[field]);
  if (!Array.isArray(result.questions)) { issue(issues, { fieldPath: 'questions', expectedType: 'array', actualType: typeof result?.questions, repairable: false, validator: 'questions-structure' }); return issues; }
  if (Array.isArray(schema.topLevelRequiredFields) && schema.topLevelRequiredFields.length) collectTopLevelSchemaIssues(result, schema, issues);
  if (strictHardTopLevel && result.questions.length === 0) { issue(issues, { fieldPath: 'questions', expectedType: 'non-empty array', actualType: 'empty array', repairable: false, validator: 'questions-structure' }); return issues; }
  const strictEvidenceFields = diagnostics.requireEvidenceFields === true || schema.requiresEvidenceFields === true;
  const requiredFields = strictEvidenceFields ? schema.requiredFields : schema.requiredFields.filter((field) => !EVIDENCE_FIELDS.includes(field));
  const sourceKeys = new Set();
  result.questions.forEach((question, index) => {
    if (!question || typeof question !== 'object' || Array.isArray(question)) { issue(issues, { fieldPath: `questions[${index}]`, expectedType: 'object', actualType: Array.isArray(question) ? 'array' : typeof question, repairable: false, validator: 'questions-structure', questionIndex: index }); return; }
    if (question.outputSchemaVersion !== receivedVersion) { questionIssue(issues, question, index, { fieldPath: fieldPath(index, 'outputSchemaVersion'), expectedType: 'string', actualType: typeof question.outputSchemaVersion, repairable: false, validator: 'question-identity' }); return; }
    if (typeof question.sourceKey === 'string' && question.sourceKey.trim()) {
      if (sourceKeys.has(question.sourceKey)) questionIssue(issues, question, index, { code: 'QUESTION_SOURCE_KEY_DUPLICATE', fieldPath: fieldPath(index, 'sourceKey'), expectedType: 'unique string', actualType: 'string', repairable: false, validator: 'question-identity' });
      sourceKeys.add(question.sourceKey);
    }
    for (const field of requiredFields) if (question[field] === undefined) questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), reason: 'missing required field', expectedType: schema.fieldTypes[field], actualType: 'undefined', repairable: !['outputSchemaVersion', 'sourceKey', 'questionText'].includes(field), validator: 'required-field' });
    for (const field of ['sourceKey', 'questionText']) {
      if (requiredFields.includes(field) && typeof question[field] === 'string' && !question[field].trim()) {
        questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), reason: 'empty required identity field', expectedType: 'non-empty string', actualType: 'string', repairable: false, validator: 'non-empty-identity' });
      }
    }
    for (const field of ['sourceQuestionLabel', 'sourceRegion']) {
      if (question[field] !== undefined && (typeof question[field] !== 'string' || !question[field].trim())) {
        questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), reason: 'empty attribution field', expectedType: 'non-empty string', actualType: typeof question[field], repairable: true, validator: 'non-empty-string' });
      }
    }
    for (const [field, type] of Object.entries(schema.fieldTypes)) {
      if (!strictEvidenceFields && EVIDENCE_FIELDS.includes(field)) continue;
      if (question[field] === null && nullableValueAllowed(question, schema, field)) continue;
      if (!matchesRuntimeType(question[field], type)) questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), expectedType: type, actualType: Array.isArray(question[field]) ? 'array' : typeof question[field], repairable: !['outputSchemaVersion', 'sourceKey', 'questionText'].includes(field), validator: 'field-type' });
    }
    for (const [field, values] of Object.entries(schema.enumFields)) if ((strictEvidenceFields || !['inputBasis', 'modeApplicability'].includes(field)) && !values.includes(question[field])) questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), expectedType: 'enum', actualType: typeof question[field], repairable: !['outputSchemaVersion', 'sourceKey', 'questionText'].includes(field), validator: 'enum' });
    for (const field of schema.arrayFields) if (!Array.isArray(question[field])) questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), expectedType: 'array', actualType: typeof question[field], repairable: true, validator: 'array' });
    for (const [field, range] of Object.entries(schema.numericRanges)) if (!Number.isFinite(question[field]) || question[field] < range.min || question[field] > range.max) questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), expectedType: schema.fieldTypes[field], actualType: typeof question[field], repairable: true, validator: 'numeric-range' });
    collectArrayItemSchemaIssues(question, schema, index, issues);
    for (const rule of schema.consistencyRules) if (Object.entries(rule.when).every(([field, value]) => question[field] === value)) {
      for (const [field, value] of Object.entries(rule.require || {})) if (question[field] !== value) questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), expectedType: schema.fieldTypes[field], actualType: typeof question[field], repairable: true, validator: 'consistency-rule' });
      for (const field of rule.requireNull || []) if (question[field] !== null) questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), expectedType: schema.fieldTypes[field], actualType: typeof question[field], repairable: true, validator: 'consistency-rule' });
      for (const [field, type] of Object.entries(rule.requireTypes || {})) if (!matchesRuntimeType(question[field], type)) questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), expectedType: type, actualType: typeof question[field], repairable: true, validator: 'consistency-rule' });
      for (const field of rule.requireNonEmptyStrings || []) if (typeof question[field] !== 'string' || !question[field].trim()) questionIssue(issues, question, index, { fieldPath: fieldPath(index, field), expectedType: 'string', actualType: typeof question[field], repairable: true, validator: 'consistency-rule' });
    }
    collectCustomSemanticIssues(question, index, issues, schema, diagnostics);
  });
  return issues;
}
function validateNewModelResult(result, diagnostics = {}) {
  const issues = collectNewModelResultIssues(result, diagnostics);
  const schema = typeof result?.outputSchemaVersion === 'string' ? resolveRuntimeSchema(diagnostics.strategy, result.outputSchemaVersion) : null;
  if (!issues.length) return { result, schema };
  const primary = issues[0];
  throw failure(primary.code, primary.message, { fieldPath: primary.fieldPath, questionIndex: primary.questionIndex, sourceKey: primary.sourceKey, receivedVersion: primary.receivedVersion, supportedVersions: primary.supportedVersions, issues, issueCount: issues.length });
}
const QUESTION_SET_ORIENTATIONS = new Set(['upright', 'rotated_left', 'rotated_right', 'upside_down', 'uncertain']);
function validateQuestionSetAudit(result, { required = false } = {}) {
  const audit = result?.questionSetAudit;
  if (audit === undefined || audit === null) {
    if (required) throw failure('QUESTION_SET_AUDIT_MISSING', 'Missing required questionSetAudit', { fieldPath: 'questionSetAudit' });
    return null;
  }
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) throw failure('QUESTION_SET_AUDIT_INVALID', 'Invalid questionSetAudit', { fieldPath: 'questionSetAudit' });
  for (const field of ['visibleIndependentQuestionCount', 'emittedQuestionCount', 'excludedQuestionCount']) {
    if (!Number.isInteger(audit[field]) || audit[field] < 0) throw failure('QUESTION_SET_AUDIT_INVALID', `Invalid questionSetAudit.${field}`, { fieldPath: `questionSetAudit.${field}` });
  }
  if (!QUESTION_SET_ORIENTATIONS.has(audit.orientation)) throw failure('QUESTION_SET_AUDIT_INVALID', 'Invalid questionSetAudit.orientation', { fieldPath: 'questionSetAudit.orientation' });
  if (!Number.isFinite(audit.countConfidence) || audit.countConfidence < 0 || audit.countConfidence > 1) throw failure('QUESTION_SET_AUDIT_INVALID', 'Invalid questionSetAudit.countConfidence', { fieldPath: 'questionSetAudit.countConfidence' });
  const actualCount = Array.isArray(result?.questions) ? result.questions.length : null;
  if (audit.emittedQuestionCount !== actualCount || audit.visibleIndependentQuestionCount !== audit.emittedQuestionCount + audit.excludedQuestionCount) {
    throw failure('QUESTION_SET_AUDIT_COUNT_MISMATCH', 'questionSetAudit counts do not match questions', { fieldPath: 'questionSetAudit' });
  }
  return { visibleIndependentQuestionCount: audit.visibleIndependentQuestionCount, emittedQuestionCount: audit.emittedQuestionCount, excludedQuestionCount: audit.excludedQuestionCount, orientation: audit.orientation, countConfidence: audit.countConfidence };
}
function mapLegacyResult(result, mode) {
  const schema = registry.schemas.find((item) => item.mode === mode);
  if (!schema) throw failure('UNSUPPORTED_LEGACY_MODE', 'Unsupported legacy mode', { fieldPath: 'mode' });
  return { ...result, outputSchemaVersion: schema.legacyAliases[0] };
}
function assertStrategyCompatibility(metadata) {
  if (metadata?.outputSchemaRegistryVersion !== registry.OUTPUT_SCHEMA_REGISTRY_VERSION) throw failure('UNSUPPORTED_SCHEMA_REGISTRY_VERSION', 'Unsupported schema registry version', { receivedVersion: metadata?.outputSchemaRegistryVersion, supportedVersion: registry.OUTPUT_SCHEMA_REGISTRY_VERSION, fieldPath: 'outputSchemaRegistryVersion' });
  if (metadata?.downstreamSemanticsVersion !== registry.DOWNSTREAM_SEMANTICS_VERSION) throw failure('UNSUPPORTED_DOWNSTREAM_SEMANTICS_VERSION', 'Unsupported downstream semantics version', { receivedVersion: metadata?.downstreamSemanticsVersion, supportedVersion: registry.DOWNSTREAM_SEMANTICS_VERSION, fieldPath: 'downstreamSemanticsVersion' });
  const advertised = new Set(metadata?.outputSchemaIds);
  for (const version of registry.supportedVersions()) if (!advertised.has(version)) throw failure('REQUIRED_OUTPUT_SCHEMA_MISSING', `Required output schema missing: ${version}`, { receivedVersion: version, fieldPath: 'outputSchemaIds' });
}
function questionSourceKeys(result, resultName) {
  if (!Array.isArray(result?.questions)) throw failure('LLM_SCHEMA_ERROR', `${resultName}.questions must be an array`, { fieldPath: `${resultName}.questions` });
  const keys = result.questions.map((question, index) => {
    const sourceKey = String(question?.sourceKey || '').trim();
    if (!sourceKey) throw failure('LLM_SCHEMA_ERROR', `Missing sourceKey: ${resultName}.questions[${index}].sourceKey`, { fieldPath: `${resultName}.questions[${index}].sourceKey` });
    if (!String(question?.questionText || '').trim()) throw failure('LLM_SCHEMA_ERROR', `Missing questionText: ${resultName}.questions[${index}].questionText`, { fieldPath: `${resultName}.questions[${index}].questionText` });
    return sourceKey;
  });
  if (new Set(keys).size !== keys.length) throw failure('QUESTION_SOURCE_KEY_DUPLICATE', `${resultName}.questions contains duplicate sourceKey values`, { fieldPath: `${resultName}.questions` });
  return keys;
}
function normalizeAttributionText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase() : '';
}
function questionAttributionDiagnostics(result) {
  const questions = Array.isArray(result?.questions) ? result.questions : [];
  const evidenceDeclared = questions.some((question) => question?.sourceQuestionLabel !== undefined || question?.sourceRegion !== undefined);
  if (!evidenceDeclared) return [];
  const diagnostics = [];
  const evidenceByKey = new Map();
  const workByFingerprint = new Map();
  for (const question of questions) {
    const sourceKey = String(question?.sourceKey || '').trim();
    const label = normalizeAttributionText(question?.sourceQuestionLabel);
    const region = normalizeAttributionText(question?.sourceRegion);
    if (!label || !region) {
      diagnostics.push({ sourceKey, conflictingSourceKey: null, issueType: 'QUESTION_ATTRIBUTION_INVALID' });
      continue;
    }
    const evidence = `${label}\u0000${region}`;
    const conflictingSourceKey = evidenceByKey.get(evidence);
    if (conflictingSourceKey && conflictingSourceKey !== sourceKey) diagnostics.push({ sourceKey, conflictingSourceKey, issueType: 'QUESTION_ATTRIBUTION_DUPLICATE' });
    else evidenceByKey.set(evidence, sourceKey);
    const answerFields = question?.outputSchemaVersion === 'calculation-careless.v2'
      ? ['studentCalculation']
      : question?.outputSchemaVersion === 'reading-careless.v2'
        ? ['studentConditionText', 'studentRelationText', 'studentAskText']
        : ['studentAnswer'];
    const fingerprint = answerFields.map((field) => normalizeAttributionText(question?.[field])).join('\u0001');
    if (question?.studentWorkDetected !== true || fingerprint.length < 8) continue;
    const previous = workByFingerprint.get(fingerprint);
    if (previous && previous.sourceKey !== sourceKey && (previous.region === region || previous.evidence === evidence)) {
      diagnostics.push({ sourceKey, conflictingSourceKey: previous.sourceKey, issueType: 'QUESTION_STUDENT_WORK_REUSED' });
    }
    else workByFingerprint.set(fingerprint, { sourceKey, region, evidence });
  }
  return diagnostics;
}
function validateQuestionAttribution(result) {
  const diagnostic = questionAttributionDiagnostics(result)[0];
  if (diagnostic) throw failure(diagnostic.issueType, `Question attribution validation failed: ${diagnostic.issueType}`, diagnostic);
  return result;
}
function sameQuestionSet(left, right) {
  return left.length === right.length && left.every((key) => right.includes(key));
}
function finalSummary(outputSchemaVersion, questions) {
  const totalCount = questions.length;
  let correctCount = 0;
  let wrongCount = 0;
  let incompleteCount = 0;
  let carelessCount = 0;
  const blank = (value) => !String(value || '').trim();
  const incomplete = () => { incompleteCount += 1; };
  const correct = () => { correctCount += 1; };
  const wrong = () => { wrongCount += 1; };
  if (outputSchemaVersion === 'reading-careless.v2') {
    for (const question of questions) {
      if (question.analysisStatus !== 'ok') incomplete();
      else if (question.conditionCorrect === true && question.relationCorrect === true && question.askCorrect === true) correct();
      else wrong();
    }
    return { totalCount, correctCount, wrongCount, incompleteCount, carelessCount };
  }
  if (outputSchemaVersion === 'calculation-careless.v2') {
    for (const question of questions) {
      if (question.analysisStatus !== 'ok' || question.processCorrect === null || question.finalAnswerCorrect === null || question.carelessDetected === null) incomplete();
      else if (question.carelessDetected === true) carelessCount += 1;
      else if (question.carelessDetected === false && question.processCorrect === true && question.finalAnswerCorrect === true) correct();
      else if (question.carelessDetected === false && (question.processCorrect === false || question.finalAnswerCorrect === false)) wrong();
      else incomplete();
    }
    return { totalCount, correctCount, wrongCount, incompleteCount, carelessCount };
  }
  for (const question of questions) {
    const status = deriveHardProblemEvaluationStatus(question);
    if (status === 'CORRECT') correct();
    else if (status === 'WRONG') wrong();
    else incomplete();
  }
  return { totalCount, correctCount, wrongCount, incompleteCount, carelessCount };
}
function validateFinalResultContract({ finalResult, primaryResult = null, reviewResult = null, recognizedQuestionCount = null, requireQuestionSetAudit = false }) {
  const finalKeys = questionSourceKeys(finalResult, 'finalResult');
  try { validateQuestionAttribution(finalResult); }
  catch (error) {
    if (['QUESTION_ATTRIBUTION_INVALID', 'QUESTION_ATTRIBUTION_DUPLICATE', 'QUESTION_STUDENT_WORK_REUSED'].includes(error?.code)) {
      throw failure('FINAL_QUESTION_ATTRIBUTION_INVALID', 'Final question attribution validation failed', { sourceKey: error.sourceKey, conflictingSourceKey: error.conflictingSourceKey, issueType: error.issueType, attributionErrorCode: error.code });
    }
    throw error;
  }
  if (!finalKeys.length && !requireQuestionSetAudit) throw failure('QUESTION_COUNT_MISMATCH', 'Final result must contain at least one question', { expectedQuestionCount: 1, actualQuestionCount: 0 });
  if (requireQuestionSetAudit) {
    try { validateQuestionSetAudit(finalResult, { required: true }); }
    catch (error) {
      if (error?.code === 'QUESTION_SET_AUDIT_COUNT_MISMATCH') throw failure('FINAL_QUESTION_SET_AUDIT_MISMATCH', 'Final questionSetAudit counts do not match merged questions', { fieldPath: 'questionSetAudit' });
      throw error;
    }
  }
  const primaryKeys = primaryResult ? questionSourceKeys(primaryResult, 'primaryResult') : null;
  const reviewKeys = reviewResult ? questionSourceKeys(reviewResult, 'reviewResult') : null;
  if (primaryKeys && reviewKeys && !primaryKeys.every((key) => reviewKeys.includes(key))) throw failure('QUESTION_SET_MISMATCH', 'REVIEW sourceKey set must contain PRIMARY sourceKey set');
  if (reviewKeys && !sameQuestionSet(reviewKeys, finalKeys)) throw failure('QUESTION_SET_MISMATCH', 'REVIEW and final sourceKey sets do not match');
  const expectedQuestionCount = Number.isInteger(recognizedQuestionCount) ? recognizedQuestionCount : primaryKeys?.length;
  if (expectedQuestionCount !== undefined && expectedQuestionCount !== null && finalKeys.length < expectedQuestionCount) throw failure('QUESTION_COUNT_MISMATCH', 'Final question count is smaller than recognized question count', { expectedQuestionCount, actualQuestionCount: finalKeys.length });
  return { ...finalResult, summary: { ...(finalResult.summary || {}), ...finalSummary(finalResult.outputSchemaVersion, finalResult.questions) } };
}
module.exports = { validateNewModelResult, collectNewModelResultIssues, normalizeNewModelResult, normalizeHardProblemQuestion, normalizeHardProblemTeachingStep, deriveHardProblemAggregateState, deriveHardProblemEvaluationStatus, deriveHardProblemErrorType, hardProblemSegmentationWarnings, resolveRuntimeSchema, auditRuntimeSchema, matchesRuntimeType, nullableValueAllowed, SUPPORTED_FIELD_TYPES, mapLegacyResult, assertStrategyCompatibility, validateFinalResultContract, validateQuestionSetAudit, inspectStudentVisibleText, questionAttributionDiagnostics, validateQuestionAttribution };
