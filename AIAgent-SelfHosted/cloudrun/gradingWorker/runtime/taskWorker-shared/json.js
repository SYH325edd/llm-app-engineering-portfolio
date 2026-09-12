"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractJson = extractJson;
exports.normalizeGradeResult = normalizeGradeResult;
exports.normalizeCarelessTrainingResult = normalizeCarelessTrainingResult;
exports.validateGrade = validateGrade;
exports.validateHardProblemResult = validateHardProblemResult;
exports.validateCarelessTrainingResult = validateCarelessTrainingResult;
exports.validateCalculationCarelessTrainingResult = validateCalculationCarelessTrainingResult;
const outputSchemaValidator = require('./output-schema-validator');
function extractJson(input) {
    if (input && typeof input === 'object')
        return input;
    const text = String(input ?? '').replace(/^\uFEFF/, '').trim();
    if (!text)
        throw Object.assign(new Error('模型返回为空'), { code: 'LLM_EMPTY_RESPONSE' });
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    for (let start = 0; start < cleaned.length; start++) {
        if (cleaned[start] !== '{' && cleaned[start] !== '[')
            continue;
        let depth = 0, inString = false, escaped = false;
        for (let i = start; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (inString) {
                if (escaped)
                    escaped = false;
                else if (ch === '\\')
                    escaped = true;
                else if (ch === '"')
                    inString = false;
                continue;
            }
            if (ch === '"') {
                inString = true;
                continue;
            }
            if (ch === '{' || ch === '[')
                depth++;
            if (ch === '}' || ch === ']')
                depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(cleaned.slice(start, i + 1));
                }
                catch {
                    break;
                }
            }
        }
    }
    throw Object.assign(new Error('模型返回 JSON 无法解析'), { code: 'LLM_JSON_PARSE_ERROR' });
}
const STEP_STATUSES = ['correct', 'wrong', 'incomplete', 'unreadable', 'not_required'];
const CARELESS_TYPES = ['careless', 'knowledge_gap', 'method_error', 'none'];
const HARD_ERROR_TYPES = ['calculation', 'transcription', 'sign', 'formula', 'logic', 'unit', 'step_omission', 'none'];
function normalizeGradeResult(value) {
    if (!value || !Array.isArray(value.questions))
        return value;
    return { ...value, questions: value.questions.map((question) => {
            const q = { ...(question || {}) };
            const confidence = Number(q.confidence);
            q.confidence = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0;
            if (q.isCorrect === false && !String(q.errorReason || '').trim()) {
                if (q.stepStatus === 'incomplete')
                    q.errorReason = '未作答或作答不完整';
                if (q.stepStatus === 'unreadable')
                    q.errorReason = '作答内容无法清晰识别';
            }
            return q;
        }) };
}
function normalizeCarelessTrainingResult(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.questions))
        return value;
    if (value.outputSchemaVersion === 'reading-careless.v2')
        return value;
    const route = value.route && typeof value.route === 'object' && !Array.isArray(value.route) ? value.route : {};
    const routeConfidence = Number(route.confidence);
    const imageQuality = value.imageQuality && typeof value.imageQuality === 'object' && !Array.isArray(value.imageQuality) ? value.imageQuality : {};
    return { ...value,
        route: { ...route, difficulty: ['normal', 'hard', 'very_hard'].includes(route.difficulty) ? route.difficulty : 'normal', confidence: Number.isFinite(routeConfidence) && routeConfidence >= 0 && routeConfidence <= 1 ? routeConfidence : 0, flags: Array.isArray(route.flags) ? route.flags : [] },
        imageQuality: { ...imageQuality, ok: imageQuality.ok === false ? false : true, issues: Array.isArray(imageQuality.issues) ? imageQuality.issues : [] },
        questions: value.questions.map((question, index) => {
            const original = question && typeof question === 'object' && !Array.isArray(question) ? question : {};
            const warnings = [];
            const text = (key, fallback = '') => {
                const current = original[key];
                if (current === undefined || current === null || (key === 'sourceKey' && !String(current).trim()))
                    warnings.push(`missing_${key}`);
                return typeof current === 'string' ? current : fallback;
            };
            const confidence = Number(original.confidence);
            if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
                warnings.push('missing_confidence');
            const array = (key) => { if (!Array.isArray(original[key]))
                warnings.push(`missing_${key}`); return Array.isArray(original[key]) ? original[key] : []; };
            const bool = (key) => { if (original[key] !== true && original[key] !== false)
                warnings.push(`missing_${key}`); return original[key] === true; };
            const sourceKey = text('sourceKey', `作业图?:第${index + 1}题`) || `作业图?:第${index + 1}题`;
            return { ...original, sourceKey, questionText: text('questionText'), studentConditionText: text('studentConditionText'), studentRelationText: text('studentRelationText'), studentAskText: text('studentAskText'), referenceConditionText: text('referenceConditionText'), referenceRelationText: text('referenceRelationText'), referenceAskText: text('referenceAskText'), askIssue: text('askIssue'), adjustmentSuggestion: text('adjustmentSuggestion'), missingConditions: array('missingConditions'), incorrectConditions: array('incorrectConditions'), relationIssues: array('relationIssues'), conditionCorrect: bool('conditionCorrect'), relationCorrect: bool('relationCorrect'), askCorrect: bool('askCorrect'), formatAligned: bool('formatAligned'), threeGridComplete: bool('threeGridComplete'), isCorrect: bool('isCorrect'), confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0, schemaWarnings: [...new Set([...(Array.isArray(original.schemaWarnings) ? original.schemaWarnings : []), ...warnings])] };
        })
    };
}
function questionError(index, question, field, actual) {
    const sourceKey = String(question?.sourceKey || '(缺少 sourceKey)');
    const display = actual === undefined ? '缺失' : actual === null ? 'null' : JSON.stringify(actual);
    return Object.assign(new Error(`questions[${index}] ${sourceKey} 字段 ${field} 无效：${display}`), { code: 'LLM_SCHEMA_ERROR' });
}
function validateGrade(v, _options = {}) {
    v = normalizeGradeResult(v);
    if (!v || typeof v !== 'object' || !Array.isArray(v.questions))
        throw Object.assign(new Error('缺少 questions'), { code: 'LLM_SCHEMA_ERROR' });
    if (!v.route || !['normal', 'hard', 'very_hard'].includes(v.route.difficulty) || !Number.isFinite(Number(v.route.confidence)) || !Array.isArray(v.route.flags))
        throw Object.assign(new Error('缺少或无效 route'), { code: 'LLM_SCHEMA_ERROR' });
    for (let index = 0; index < v.questions.length; index += 1) {
        const q = v.questions[index];
        for (const key of ['sourceKey', 'questionText', 'studentAnswer', 'standardAnswer', 'stepRequired', 'finalAnswerCorrect', 'stepStatus', 'isCorrect', 'score', 'maxScore', 'carelessType', 'confidence', 'errorReason', 'stepAnalysis', 'correctMethod', 'knowledgePoint'])
            if (q?.[key] === undefined)
                throw questionError(index, q, key, undefined);
        if (typeof q.stepRequired !== 'boolean')
            throw questionError(index, q, 'stepRequired', q.stepRequired);
        if (typeof q.finalAnswerCorrect !== 'boolean')
            throw questionError(index, q, 'finalAnswerCorrect', q.finalAnswerCorrect);
        if (typeof q.isCorrect !== 'boolean')
            throw questionError(index, q, 'isCorrect', q.isCorrect);
        if (!Number.isFinite(Number(q.confidence)) || Number(q.confidence) < 0 || Number(q.confidence) > 1)
            throw questionError(index, q, 'confidence', q.confidence);
        if (!STEP_STATUSES.includes(q.stepStatus))
            throw questionError(index, q, 'stepStatus', q.stepStatus);
        if (!CARELESS_TYPES.includes(q.carelessType))
            throw questionError(index, q, 'carelessType', q.carelessType);
        if (q.stepRequired && q.stepStatus === 'not_required')
            throw questionError(index, q, 'stepStatus', q.stepStatus);
    }
    return v;
}
function validateHardProblemResult(v, diagnostics = {}) {
    const routed = outputSchemaValidator.validateNewModelResult(v, diagnostics);
    if (routed.schema.schemaId !== 'hard-problem.v2')
        throw Object.assign(new Error('outputSchemaVersion does not match hard-problem route'), { code: 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', receivedVersion: v?.outputSchemaVersion ?? null, supportedVersions: ['hard-problem.v2'], fieldPath: 'outputSchemaVersion' });
    return v;
}
function validateCarelessTrainingResult(v, phase = 'final') {
    if (!['draft', 'final'].includes(phase))
        throw Object.assign(new Error('invalid careless validation phase'), { code: 'LLM_SCHEMA_ERROR' });
    const routed = outputSchemaValidator.validateNewModelResult(v);
    if (routed.schema.schemaId !== 'reading-careless.v2')
        throw Object.assign(new Error('outputSchemaVersion does not match reading-careless route'), { code: 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', receivedVersion: v?.outputSchemaVersion ?? null, supportedVersions: ['reading-careless.v2'], fieldPath: 'outputSchemaVersion' });
    return v;
    if (v?.outputSchemaVersion === 'reading-careless.v2') {
        if (!Array.isArray(v.questions))
            throw Object.assign(new Error('missing questions'), { code: 'LLM_SCHEMA_ERROR' });
        for (let index = 0; index < v.questions.length; index += 1) {
            const q = v.questions[index];
            for (const key of ['sourceKey', 'questionText', 'studentConditionText', 'studentRelationText', 'studentAskText', 'analysisStatus', 'conditionCorrect', 'relationCorrect', 'askCorrect', 'missingConditions', 'relationIssues', 'askIssue', 'errorReason', 'correctionAdvice', 'confidence'])
                if (q?.[key] === undefined)
                    throw questionError(index, q, key, undefined);
            if (!String(q.sourceKey || '').trim() || !['ok', 'unreadable', 'insufficient'].includes(q.analysisStatus) || !Array.isArray(q.missingConditions) || !Array.isArray(q.relationIssues) || !Number.isFinite(Number(q.confidence)) || Number(q.confidence) < 0 || Number(q.confidence) > 1)
                throw questionError(index, q, 'reading-careless.v2 field', q);
            for (const key of ['conditionCorrect', 'relationCorrect', 'askCorrect'])
                if (q[key] !== true && q[key] !== false && q[key] !== null)
                    throw questionError(index, q, key, q[key]);
            if ((q.analysisStatus === 'ok' && ['conditionCorrect', 'relationCorrect', 'askCorrect'].some((key) => typeof q[key] !== 'boolean')) || (q.analysisStatus !== 'ok' && ['conditionCorrect', 'relationCorrect', 'askCorrect'].some((key) => q[key] !== null)))
                throw questionError(index, q, 'reading-careless.v2 consistency', q);
        }
        return v;
    }
    v = normalizeCarelessTrainingResult(v);
    if (!v || typeof v !== 'object' || !Array.isArray(v.questions))
        throw Object.assign(new Error('missing questions'), { code: 'LLM_SCHEMA_ERROR' });
    if (!v.route || !['normal', 'hard', 'very_hard'].includes(v.route.difficulty) || !Number.isFinite(Number(v.route.confidence)) || Number(v.route.confidence) < 0 || Number(v.route.confidence) > 1 || !Array.isArray(v.route.flags))
        throw Object.assign(new Error('invalid route'), { code: 'LLM_SCHEMA_ERROR' });
    if (!v.imageQuality || typeof v.imageQuality.ok !== 'boolean' || !Array.isArray(v.imageQuality.issues))
        throw Object.assign(new Error('invalid imageQuality'), { code: 'LLM_SCHEMA_ERROR' });
    const usableFields = ['questionText', 'studentConditionText', 'studentRelationText', 'studentAskText', 'referenceConditionText', 'referenceRelationText', 'referenceAskText'];
    const usableQuestionCount = v.questions.filter((q) => usableFields.some((key) => String(q?.[key] || '').trim())).length;
    if (!v.questions.length || !usableQuestionCount)
        throw Object.assign(new Error('questions 缺少可识别题目'), { code: 'CARELESS_TRAINING_ANALYSIS_UNAVAILABLE' });
    v.questions = v.questions.map((q, index) => {
        const warnings = new Set(Array.isArray(q.schemaWarnings) ? q.schemaWarnings : []);
        const hasReferenceGrid = ['referenceConditionText', 'referenceRelationText', 'referenceAskText'].some((key) => String(q?.[key] || '').trim());
        if (!String(q.questionText || '').trim()) {
            warnings.add('missing_questionText');
            q = { ...q, questionText: String(q.sourceKey || `第${index + 1}题`) };
        }
        if (!hasReferenceGrid)
            warnings.add('missing_reference_grid');
        return { ...q, schemaWarnings: [...warnings] };
    });
    const textFields = ['sourceKey', 'questionText', 'studentConditionText', 'studentRelationText', 'studentAskText', 'referenceConditionText', 'referenceRelationText', 'referenceAskText', 'askIssue', 'adjustmentSuggestion'];
    for (let index = 0; index < v.questions.length; index += 1) {
        const q = v.questions[index];
        for (const key of textFields)
            if (q?.[key] === undefined)
                throw questionError(index, q, key, undefined);
        for (const key of ['missingConditions', 'incorrectConditions', 'relationIssues'])
            if (!Array.isArray(q?.[key]))
                throw questionError(index, q, key, q?.[key]);
        for (const key of ['conditionCorrect', 'relationCorrect', 'askCorrect', 'formatAligned', 'threeGridComplete', 'isCorrect'])
            if (typeof q?.[key] !== 'boolean')
                throw questionError(index, q, key, q?.[key]);
        if (!Number.isFinite(Number(q?.confidence)) || Number(q.confidence) < 0 || Number(q.confidence) > 1)
            throw questionError(index, q, 'confidence', q?.confidence);
    }
    if (phase === 'final' && v.questions.some((q) => !String(q.referenceConditionText || '').trim() || !String(q.referenceRelationText || '').trim() || !String(q.referenceAskText || '').trim()))
        throw Object.assign(new Error('questions 缺少完整参考三格'), { code: 'CARELESS_TRAINING_REFERENCE_UNAVAILABLE' });
    return v;
}
const CALCULATION_BOOLEAN_FIELDS = ['layoutClear', 'digitAlignmentCorrect', 'stepsComplete', 'carryBorrowClear', 'processCorrect', 'finalAnswerCorrect', 'carelessDetected'];
function validateCalculationCarelessTrainingResult(v) {
    const routed = outputSchemaValidator.validateNewModelResult(v);
    if (routed.schema.schemaId !== 'calculation-careless.v2')
        throw Object.assign(new Error('outputSchemaVersion does not match calculation-careless route'), { code: 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', receivedVersion: v?.outputSchemaVersion ?? null, supportedVersions: ['calculation-careless.v2'], fieldPath: 'outputSchemaVersion' });
    return v;
    if (!v || typeof v !== 'object' || !Array.isArray(v.questions))
        throw Object.assign(new Error('missing questions'), { code: 'LLM_SCHEMA_ERROR' });
    if (!v.route || !['normal', 'hard', 'very_hard'].includes(v.route.difficulty) || !Number.isFinite(Number(v.route.confidence)) || !Array.isArray(v.route.flags))
        throw Object.assign(new Error('invalid route'), { code: 'LLM_SCHEMA_ERROR' });
    if (!v.imageQuality || typeof v.imageQuality.ok !== 'boolean' || !Array.isArray(v.imageQuality.issues))
        throw Object.assign(new Error('invalid imageQuality'), { code: 'LLM_SCHEMA_ERROR' });
    if (!v.questions.length)
        throw Object.assign(new Error('questions missing'), { code: 'CARELESS_TRAINING_ANALYSIS_UNAVAILABLE' });
    if (v.outputSchemaVersion !== 'calculation-careless.v2')
        throw Object.assign(new Error(`outputSchemaVersion invalid: ${JSON.stringify(v.outputSchemaVersion)}`), { code: 'LLM_SCHEMA_ERROR' });
    for (let index = 0; index < v.questions.length; index += 1) {
        const q = v.questions[index];
        for (const key of ['sourceKey', 'questionText', 'studentCalculation', 'standardCalculation', 'analysisStatus', 'issueCategory', 'errorReason', 'firstErrorPoint', 'correctionAdvice'])
            if (typeof q?.[key] !== 'string')
                throw questionError(index, q, key, q?.[key]);
        if (!['ok', 'unreadable', 'insufficient'].includes(q.analysisStatus))
            throw questionError(index, q, 'analysisStatus', q.analysisStatus);
        if (!['none', 'careless', 'knowledge_or_method', 'undetermined'].includes(q.issueCategory))
            throw questionError(index, q, 'issueCategory', q.issueCategory);
        for (const key of CALCULATION_BOOLEAN_FIELDS)
            if (q?.[key] !== true && q?.[key] !== false && q?.[key] !== null)
                throw questionError(index, q, key, q?.[key]);
        for (const key of ['processCorrect', 'finalAnswerCorrect', 'carelessDetected'])
            if (q.analysisStatus === 'ok' && typeof q[key] !== 'boolean')
                throw questionError(index, q, key, q[key]);
        if (!Array.isArray(q?.carelessIssues) || !Array.isArray(q?.methodIssues) || !Number.isFinite(Number(q?.confidence)) || Number(q.confidence) < 0 || Number(q.confidence) > 1)
            throw questionError(index, q, 'calculation field', q);
    }
    return v;
}
