"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = exports.randomId = exports.userIdFromOpenid = exports.normalizeName = exports.normalizeText = exports.hash = exports.now = void 0;
exports.safeError = safeError;
exports.redact = redact;
exports.scopeKey = scopeKey;
exports.hasScope = hasScope;
exports.publicUser = publicUser;
exports.shanghaiDateKey = shanghaiDateKey;
const crypto = require('crypto');
const now = () => new Date();
exports.now = now;
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
exports.hash = hash;
const normalizeText = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
exports.normalizeText = normalizeText;
const normalizeName = (v) => (0, exports.normalizeText)(v).replace(/[·•]/g, '');
exports.normalizeName = normalizeName;
const userIdFromOpenid = (openid) => `u_${(0, exports.hash)(openid).slice(0, 32)}`;
exports.userIdFromOpenid = userIdFromOpenid;
const randomId = (prefix = 'id') => `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
exports.randomId = randomId;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
exports.sleep = sleep;
function safeError(e) {
    if (typeof e === 'string')
        return { name: 'Error', message: e, errMsg: e, code: 'UNKNOWN', errCode: '', status: null, stack: '' };
    const value = e && typeof e === 'object' ? e : {};
    const message = String(value.message || value.errMsg || value.errorMessage || value.error || 'Unknown error');
    const rawIssues = Array.isArray(value.issues) ? value.issues : [];
    const hasSafeValidatorIssues = rawIssues.length > 0
        && rawIssues.every((item) => item && typeof item.code === 'string' && typeof item.fieldPath === 'string' && typeof item.validator === 'string' && typeof item.repairable === 'boolean')
        && (value.code === 'LLM_SCHEMA_ERROR' || rawIssues.some((item) => item.code === value.code));
    const schemaValidation = value.code === 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION'
        ? { receivedVersion: value.receivedVersion ?? null, expectedVersion: value.expectedVersion ?? null, supportedVersions: Array.isArray(value.supportedVersions) ? value.supportedVersions : [], fieldPath: value.fieldPath ?? null, requestStage: value.requestStage ?? null }
        : (value.code === 'LLM_SCHEMA_ERROR' || hasSafeValidatorIssues)
            ? (() => {
                const issues = rawIssues.slice(0, 5).map((item) => ({ code: String(item?.code || 'LLM_SCHEMA_ERROR').slice(0, 100), fieldPath: typeof item?.fieldPath === 'string' ? item.fieldPath.slice(0, 200) : null, validator: typeof item?.validator === 'string' ? item.validator.slice(0, 100) : null, sourceKey: typeof item?.sourceKey === 'string' ? item.sourceKey.slice(0, 100) : null, repairable: item?.repairable === true }));
                const primary = rawIssues[0] || null;
                const questionIndex = Number.isInteger(value.questionIndex) ? value.questionIndex : Number.isInteger(primary?.questionIndex) ? primary.questionIndex : null;
                const question = Number.isInteger(questionIndex) ? value.modelOutput?.questions?.[questionIndex] : null;
                const calculationWorkCompleteIssue = rawIssues.find((item) => item?.code === 'CALCULATION_CARELESS_WORK_COMPLETE_CONSTRAINT') || null;
                const isCalculationWorkComplete = Boolean(calculationWorkCompleteIssue);
                const dependencies = isCalculationWorkComplete ? { studentWorkDetected: true, modeApplicability: 'applicable', analysisStatus: 'ok' } : null;
                const emptyOrConflictingFields = dependencies ? Object.entries(dependencies).filter(([field, expected]) => question?.[field] === undefined || question?.[field] === null || question?.[field] === '' || question?.[field] !== expected).map(([field]) => field) : [];
                return { errorCode: String(value.code || 'LLM_SCHEMA_ERROR'), fieldPath: value.fieldPath ?? issues[0]?.fieldPath ?? null, questionIndex, sourceKey: typeof primary?.sourceKey === 'string' ? primary.sourceKey.slice(0, 100) : null, issueCode: String(primary?.code || value.code || 'LLM_SCHEMA_ERROR').slice(0, 100), validator: typeof primary?.validator === 'string' ? primary.validator.slice(0, 100) : null, repairable: primary?.repairable === true, workComplete: isCalculationWorkComplete ? true : null, emptyOrConflictingFields, issueCount: Number.isInteger(value.issueCount) ? value.issueCount : issues.length, issues };
            })()
            : null;
    const strategyContract = value.code === 'STRATEGY_CONTRACT_INCOMPATIBLE' ? {
        strategyVersion: String(value.strategyVersion || '').slice(0, 50),
        missingQuestionFields: Array.isArray(value.missingQuestionFields) ? value.missingQuestionFields.slice(0, 30).map(String) : [],
        missingStepFields: Array.isArray(value.missingStepFields) ? value.missingStepFields.slice(0, 30).map(String) : [],
        missingPromptFields: Array.isArray(value.missingPromptFields) ? value.missingPromptFields.slice(0, 30).map(String) : [],
        invalidStepEnumFields: Array.isArray(value.invalidStepEnumFields) ? value.invalidStepEnumFields.slice(0, 20).map(String) : [],
        invalidRuntimeStages: Array.isArray(value.invalidRuntimeStages) ? value.invalidRuntimeStages.slice(0, 10).map(String) : [],
        missingTopLevelFields: Array.isArray(value.missingTopLevelFields) ? value.missingTopLevelFields.slice(0, 20).map(String) : [],
        invalidTopLevelEnums: Array.isArray(value.invalidTopLevelEnums) ? value.invalidTopLevelEnums.slice(0, 10).map(String) : [],
        invalidTopLevelObjectSchemas: Array.isArray(value.invalidTopLevelObjectSchemas) ? value.invalidTopLevelObjectSchemas.slice(0, 10).map(String) : []
    } : null;
    const repairValidation = value.code === 'LLM_SCHEMA_REPAIR_FAILED' ? {
        fieldPath: typeof value.fieldPath === 'string' ? value.fieldPath.slice(0, 200) : null,
        repairFailureStage: typeof value.repairFailureStage === 'string' ? value.repairFailureStage.slice(0, 100) : null,
        failureReason: typeof value.failureReason === 'string' ? value.failureReason.slice(0, 100) : null,
        issueCode: typeof value.issueCode === 'string' ? value.issueCode.slice(0, 100) : null,
        requestStage: typeof value.requestStage === 'string' ? value.requestStage.slice(0, 100) : null
    } : null;
    return {
        name: String(value.name || 'Error'),
        message,
        errMsg: String(value.errMsg || message),
        code: String(value.code || 'UNKNOWN'),
        errCode: String(value.errCode || ''),
        status: value.status ?? null,
        stack: String(value.stack || ''),
        imageIndex: Number.isInteger(value.imageIndex) ? value.imageIndex : null,
        fileId: value.fileId ? redact(value.fileId) : '',
        causeCode: typeof value.causeCode === 'string' ? value.causeCode.slice(0, 100) : '',
        fieldPath: typeof value.fieldPath === 'string' ? value.fieldPath.slice(0, 200) : '',
        requestStage: typeof value.requestStage === 'string' ? value.requestStage.slice(0, 100) : '',
        modelProvider: typeof value.modelProvider === 'string' ? value.modelProvider.slice(0, 50) : '',
        modelName: typeof value.modelName === 'string' ? value.modelName.slice(0, 100) : '',
        providerRequestIdPresent: Boolean(value.providerRequestId),
        repairAttempted: value.repairAttempted === true,
        repairAttemptCount: Number.isFinite(Number(value.repairAttemptCount)) ? Number(value.repairAttemptCount) : 0,
        repairFailureStage: typeof value.repairFailureStage === 'string' ? value.repairFailureStage.slice(0, 100) : '',
        ...(schemaValidation ? { schemaValidation } : {}),
        ...(strategyContract ? { strategyContract } : {}),
        ...(repairValidation ? { repairValidation } : {}),
    };
}
function redact(value) { const s = String(value ?? ''); if (!s)
    return ''; return s.length < 9 ? '****' : `${s.slice(0, 3)}****${s.slice(-4)}`; }
function scopeKey(grade, className) { return `${(0, exports.normalizeText)(grade)}::${(0, exports.normalizeText)(className)}`; }
function hasScope(user, grade, className) { if (user?.role === 'super_admin')
    return true; const key = scopeKey(grade, className); return (user?.scopes || []).some((x) => scopeKey(x.grade, x.className) === key); }
function publicUser(user) { if (!user)
    return null; const { openid, ...rest } = user; return rest; }
function shanghaiDateKey(date = new Date()) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const m = Object.fromEntries(parts.map((x) => [x.type, x.value])); return `${m.year}-${m.month}-${m.day}`; }
