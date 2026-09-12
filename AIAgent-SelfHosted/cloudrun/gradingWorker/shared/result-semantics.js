'use strict';

const VERSION = 'result-semantics.v1';
const HARD_ERROR_TYPES = new Set(['answer_error', 'calculation_error', 'method_error', 'logic_error', 'multiple']);

function text(value) { return String(value || '').trim(); }
function modeFor(question, mode) {
  const schemaVersion = text(question?.outputSchemaVersion);
  if (['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2'].includes(schemaVersion)) return schemaVersion;
  if (mode) return mode;
  return 'CARELESS_TRAINING';
}
function statusFor(question) {
  if (question?.teacherOverrideApplied === true && ['CORRECT', 'WRONG'].includes(question?.teacherOverrideStatus)) return question.teacherOverrideStatus;
  if (question.outputSchemaVersion === 'hard-problem.v2') return question.evaluationStatus;
  if (question.outputSchemaVersion === 'reading-careless.v2') return question.threeGridStatus;
  return question.calculationStatus;
}
function readingCategory(question) {
  const errors = [question.conditionCorrect !== true, question.relationCorrect !== true, question.askCorrect !== true];
  const count = errors.filter(Boolean).length;
  if (count !== 1) return 'multiple';
  return errors[0] ? 'reading_condition' : errors[1] ? 'reading_relation' : 'reading_ask';
}
function base(question, mode) {
  return { sourceKey: text(question.sourceKey), mode: modeFor(question, mode), outputSchemaVersion: text(question.outputSchemaVersion), downstreamSemanticsVersion: VERSION };
}
function normalizeDownstreamSemantics(question = {}, mode = '') {
  const result = base(question, mode);
  const status = statusFor(question);
  if (question.outputSchemaVersion === 'hard-problem.v2') {
    if (status === 'CORRECT') return { ...result, normalizedStatus: 'CORRECT', isCorrect: true, resultCategory: 'none', shouldRecordWrongQuestion: false, wrongQuestionDisposition: 'SKIP', checkinEligible: true, reviewDisposition: 'NORMAL', ttsDisposition: 'CORRECT' };
    if (status === 'UNANSWERED') return { ...result, normalizedStatus: 'UNANSWERED', isCorrect: false, resultCategory: 'unanswered', shouldRecordWrongQuestion: true, wrongQuestionDisposition: 'CREATE', checkinEligible: false, reviewDisposition: 'NEEDS_REVIEW', ttsDisposition: 'UNANSWERED' };
    if (status === 'UNREADABLE') return { ...result, normalizedStatus: 'UNREADABLE', isCorrect: false, resultCategory: 'unreadable', shouldRecordWrongQuestion: false, wrongQuestionDisposition: 'NEEDS_REUPLOAD', checkinEligible: false, reviewDisposition: 'NEEDS_REUPLOAD', ttsDisposition: 'NEEDS_REUPLOAD' };
    return { ...result, normalizedStatus: 'WRONG', isCorrect: false, resultCategory: HARD_ERROR_TYPES.has(question.errorType) ? question.errorType : 'multiple', shouldRecordWrongQuestion: true, wrongQuestionDisposition: 'CREATE', checkinEligible: false, reviewDisposition: 'NEEDS_REVIEW', ttsDisposition: 'WRONG' };
  }
  if (question.outputSchemaVersion === 'reading-careless.v2') {
    if (status === 'CORRECT') return { ...result, normalizedStatus: 'CORRECT', isCorrect: true, resultCategory: 'none', shouldRecordWrongQuestion: false, wrongQuestionDisposition: 'SKIP', checkinEligible: true, reviewDisposition: 'NORMAL', ttsDisposition: 'CORRECT' };
    if (status === 'UNDETERMINED') return { ...result, normalizedStatus: 'UNDETERMINED', isCorrect: false, resultCategory: 'undetermined', shouldRecordWrongQuestion: false, wrongQuestionDisposition: 'NEEDS_REUPLOAD', checkinEligible: false, reviewDisposition: 'NEEDS_REUPLOAD', ttsDisposition: 'UNDETERMINED' };
    return { ...result, normalizedStatus: 'WRONG', isCorrect: false, resultCategory: readingCategory(question), shouldRecordWrongQuestion: true, wrongQuestionDisposition: 'CREATE', checkinEligible: false, reviewDisposition: 'NEEDS_REVIEW', ttsDisposition: 'WRONG' };
  }
  if (status === 'CORRECT') return { ...result, normalizedStatus: 'CORRECT', isCorrect: true, resultCategory: 'none', shouldRecordWrongQuestion: false, wrongQuestionDisposition: 'SKIP', checkinEligible: true, reviewDisposition: 'NORMAL', ttsDisposition: 'CORRECT' };
  if (status === 'UNDETERMINED') return { ...result, normalizedStatus: 'UNDETERMINED', isCorrect: false, resultCategory: 'undetermined', shouldRecordWrongQuestion: false, wrongQuestionDisposition: 'NEEDS_REUPLOAD', checkinEligible: false, reviewDisposition: 'NEEDS_REUPLOAD', ttsDisposition: 'UNDETERMINED' };
  return { ...result, normalizedStatus: 'WRONG', isCorrect: false, resultCategory: question.issueCategory === 'careless' ? 'careless' : 'knowledge_or_method', shouldRecordWrongQuestion: true, wrongQuestionDisposition: 'CREATE', checkinEligible: false, reviewDisposition: 'NEEDS_REVIEW', ttsDisposition: 'WRONG' };
}
function modeDetails(question) {
  const commonKeys = ['studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'];
  const modeKeys = question.outputSchemaVersion === 'hard-problem.v2'
    ? ['answerStatus', 'finalAnswerCorrect', 'stepRequired', 'stepStatus', 'logicStatus', 'errorType', 'adjustmentSuggestion', 'stepFeedbacks', 'overallFeedback']
    : question.outputSchemaVersion === 'reading-careless.v2'
      ? ['studentConditionText', 'studentRelationText', 'studentAskText', 'conditionCorrect', 'relationCorrect', 'askCorrect', 'missingConditions', 'relationIssues', 'askIssue']
      : ['processCorrect', 'finalAnswerCorrect', 'carelessDetected', 'issueCategory', 'carelessIssues', 'methodIssues', 'firstErrorPoint', 'correctionAdvice', 'calculationStatus'];
  return Object.fromEntries([...commonKeys, ...modeKeys].map((key) => [key, question[key]]));
}
function wrongQuestionProjection(question, mode) {
  const semantics = normalizeDownstreamSemantics(question, mode);
  const schemaVersion = text(question.outputSchemaVersion);
  const studentResponse = schemaVersion === 'reading-careless.v2'
    ? [question.studentConditionText, question.studentRelationText, question.studentAskText].map(text).filter(Boolean).join('；')
    : text(question.studentResponse || question.studentAnswer || question.studentCalculation);
  const standardResponse = schemaVersion === 'reading-careless.v2' ? '' : text(question.standardResponse || question.standardAnswer || question.standardCalculation);
  const firstErrorPoint = schemaVersion === 'reading-careless.v2' ? text(question.askIssue) : text(question.firstErrorPoint || question.firstWrongStep);
  return { ...semantics, questionText: text(question.questionText), studentResponse, standardResponse, errorReason: text(question.errorReason), firstErrorPoint, correctionAdvice: text(question.correctionAdvice || question.adjustmentSuggestion), knowledgePoint: schemaVersion === 'hard-problem.v2' ? text(question.knowledgePoint) : '', confidence: Number(question.confidence || 0), modeDetails: modeDetails(question) };
}
function reviewProjection(question, mode) {
  const record = wrongQuestionProjection(question, mode);
  return { sourceKey: record.sourceKey, mode: record.mode, normalizedStatus: record.normalizedStatus, resultCategory: record.resultCategory, questionText: record.questionText, studentResponse: record.studentResponse, standardResponse: record.standardResponse, errorReason: record.errorReason, firstErrorPoint: record.firstErrorPoint, correctionAdvice: record.correctionAdvice, confidence: record.confidence, evidenceFields: record.modeDetails, reviewDisposition: record.reviewDisposition };
}
function ttsText(question, index) {
  const semantics = normalizeDownstreamSemantics(question);
  const prefix = `第${index + 1}题`;
  if (semantics.ttsDisposition === 'CORRECT') return `${prefix}当前模式对应内容正确。`;
  if (semantics.ttsDisposition === 'UNANSWERED') return `${prefix}尚未作答。`;
  if (semantics.ttsDisposition === 'NEEDS_REUPLOAD') return `${prefix}当前证据或复核信息不足，暂无法可靠判断；请重新提交，必要时由教师复核。`;
  if (semantics.ttsDisposition === 'UNDETERMINED') return `${prefix}暂时无法判断，请重新上传或补充信息。`;
  return `${prefix}${semantics.resultCategory ? `问题类型为${semantics.resultCategory}。` : ''}${text(question.errorReason)}${text(question.firstErrorPoint || question.firstWrongStep)}${text(question.correctionAdvice || question.adjustmentSuggestion)}`;
}

module.exports = { VERSION, normalizeDownstreamSemantics, wrongQuestionProjection, reviewProjection, ttsText };
