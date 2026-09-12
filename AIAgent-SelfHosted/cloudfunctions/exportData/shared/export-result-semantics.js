'use strict';
function normalizedQuestionStatus(question) {
    const schema = String(question?.outputSchemaVersion || '');
    if (question?.teacherOverrideApplied === true && ['CORRECT', 'WRONG'].includes(String(question?.teacherOverrideStatus || ''))) return String(question.teacherOverrideStatus);
    const normalized = String(question?.normalizedStatus || '');
    if (normalized) return normalized;
    if (schema === 'hard-problem.v2') return String(question?.evaluationStatus || 'UNDETERMINED');
    if (schema === 'reading-careless.v2') return String(question?.threeGridStatus || 'UNDETERMINED');
    if (schema === 'calculation-careless.v2') return String(question?.calculationStatus || 'UNDETERMINED');
    return question?.isCorrect === true ? 'CORRECT' : 'WRONG';
}
function exportQuestionCategory(question) {
    const schema = String(question?.outputSchemaVersion || '');
    const status = normalizedQuestionStatus(question);
    if (status === 'CORRECT') return 'correct';
    if (['UNANSWERED', 'UNREADABLE', 'UNDETERMINED', 'INCOMPLETE'].includes(status)) return 'incomplete';
    if (schema === 'calculation-careless.v2') return question?.carelessDetected === true || question?.issueCategory === 'careless' ? 'careless' : 'method_error';
    if (schema === 'hard-problem.v2') return question?.errorType === 'method_error' || question?.errorType === 'logic_error' ? 'method_error' : 'wrong';
    if (schema === 'reading-careless.v2') return 'wrong';
    const carelessType = String(question?.carelessType || '');
    if (carelessType === 'careless') return 'careless';
    if (carelessType === 'knowledge_gap') return 'knowledge_gap';
    if (carelessType === 'method_error') return 'method_error';
    return 'wrong';
}
function exportQuestionErrorSummary(question) {
    const schema = String(question?.outputSchemaVersion || '');
    const values = schema === 'calculation-careless.v2'
        ? [question?.firstErrorPoint, ...(Array.isArray(question?.carelessIssues) ? question.carelessIssues : []), ...(Array.isArray(question?.methodIssues) ? question.methodIssues : []), question?.errorReason]
        : schema === 'reading-careless.v2'
            ? [...(Array.isArray(question?.missingConditions) ? question.missingConditions : []), ...(Array.isArray(question?.relationIssues) ? question.relationIssues : []), question?.askIssue, question?.errorReason]
            : schema === 'hard-problem.v2'
                ? [question?.firstWrongStep, question?.errorReason, question?.errorType]
                : [question?.errorReason, question?.carelessType];
    const text = values.flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => String(value || '').trim()).filter(Boolean);
    return [...new Set(text)].join('、') || '错误';
}
function summarizeQuestionsForExport(questions) {
    const source = Array.isArray(questions) ? questions : [];
    const categories = source.map(exportQuestionCategory);
    return {
        totalCount: source.length,
        correctCount: categories.filter((value) => value === 'correct').length,
        carelessCount: categories.filter((value) => value === 'careless').length,
        knowledgeGapCount: categories.filter((value) => value === 'knowledge_gap').length,
        methodErrorCount: categories.filter((value) => value === 'method_error').length,
        errorSummary: source.filter((question) => exportQuestionCategory(question) !== 'correct').map((question) => `${question.sourceKey || '未编号'}:${exportQuestionErrorSummary(question)}`).join('；')
    };
}

module.exports = { normalizedQuestionStatus, exportQuestionCategory, exportQuestionErrorSummary, summarizeQuestionsForExport };
