"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CARELESS_TRAINING_TYPE = exports.CARELESS_TRAINING_TYPES = exports.DEFAULT_TASK_MODE = exports.TASK_MODES = exports.TERMINAL = exports.ROLES = exports.C = void 0;
exports.normalizeCarelessTrainingType = normalizeCarelessTrainingType;
exports.C = {
    users: 'users', classes: 'classes', roster: 'student_roster', teacherApplications: 'teacher_applications',
    tasks: 'grading_tasks', results: 'grading_results', wrong: 'wrong_questions', checkins: 'checkins', audit: 'audit_logs',
    logs: 'system_logs', ai: 'ai_invocations', importConflicts: 'import_conflicts', settings: 'system_settings', answerExtractions: 'answer_extractions', strategyCache: 'strategy_cache', generatedFiles: 'generated_files', teacherPrivacyConsents: 'teacher_privacy_consents', hardProblemDiagnostics: 'hard_problem_diagnostics', hardProblemTrainingSessions: 'hard_problem_training_sessions', hardProblemLearningRecords: 'hard_problem_learning_records', taskFailureCases: 'task_failure_cases', trainingFailureEvents: 'training_failure_events'
};
exports.ROLES = ['student', 'teacher', 'super_admin'];
exports.TERMINAL = ['COMPLETED', 'FAILED', 'NEED_CONFIRMATION', 'NEED_ANSWER', 'CANCELLED'];
exports.TASK_MODES = ['HARD_PROBLEM_CHECK', 'CARELESS_TRAINING'];
exports.DEFAULT_TASK_MODE = 'HARD_PROBLEM_CHECK';
exports.CARELESS_TRAINING_TYPES = ['READING', 'CALCULATION'];
exports.DEFAULT_CARELESS_TRAINING_TYPE = 'READING';
function normalizeCarelessTrainingType(value) {
    if (value == null || value === '')
        return exports.DEFAULT_CARELESS_TRAINING_TYPE;
    const type = String(value);
    if (!exports.CARELESS_TRAINING_TYPES.includes(type))
        throw Object.assign(new Error('careless training type is invalid'), { code: 'INVALID_CARELESS_TRAINING_TYPE' });
    return type;
}
// HARD_PROBLEM_CHECK 后续只展示正确性/步骤结论；CARELESS_TRAINING 后续使用独立“三格法”结果，均不得沿用普通马虎结果卡片。
