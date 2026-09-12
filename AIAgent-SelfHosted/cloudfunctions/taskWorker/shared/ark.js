"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveArkOutputTokens = resolveArkOutputTokens;
exports.resolveNarrationOutputTokens = resolveNarrationOutputTokens;
exports.resolveGradingTimeout = resolveGradingTimeout;
exports.resolveArkApiMode = resolveArkApiMode;
exports.resolveArkJsonMode = resolveArkJsonMode;
exports.resolveArkRequestTimeout = resolveArkRequestTimeout;
exports.callArk = callArk;
exports.narrationUserPrompt = narrationUserPrompt;
exports.generateNarration = generateNarration;
exports.answerExtractionUserPrompt = answerExtractionUserPrompt;
exports.gradeUserPrompt = gradeUserPrompt;
exports.hardProblemUserPrompt = hardProblemUserPrompt;
exports.carelessTrainingUserPrompt = carelessTrainingUserPrompt;
exports.__arkTest = void 0;
const https = require('https');
const { URL } = require('url');
const json_1 = require("./json");
const outputSchemaValidator = require("./output-schema-validator");
const modelOutputRepair = require("./model-output-repair");
const context_1 = require("./context");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const ARK_BUILD_ID = 'build-20260815-primary-review-question-contract-v10.9.0';
const INTERNAL_REPAIR_PARSE_ONLY = Symbol('INTERNAL_REPAIR_PARSE_ONLY');
const INTERNAL_GRADING_EXECUTION_STARTED_AT = Symbol('INTERNAL_GRADING_EXECUTION_STARTED_AT');
const GRADING_EXECUTION_BUDGET_MS = 300000;
const GRADING_EXECUTION_SAFETY_MARGIN_MS = 5000;
const REQUIRED_REPAIR_BUDGET_MS = 30000;
const audit_1 = require("./audit");
const embedded_1 = require("./strategy/embedded");
const strategyRender = __importStar(require("./strategy/render"));
const remote_1 = require("./strategy/remote");
const baseUrl = () => String(process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
const HARD_PROBLEM_MODEL_PROVIDERS = ['ark_lite', 'qwen3_vl_plus'];
function normalizeModelProvider(value) {
    const provider = String(value || '').trim();
    return HARD_PROBLEM_MODEL_PROVIDERS.includes(provider) ? provider : 'ark_lite';
}
function resolveQwenChatCompletionsUrl(env = process.env) {
    const configured = String(env.QWEN_BASE_URL || '').trim().replace(/\/$/, '');
    if (!configured)
        return '';
    try {
        const url = new URL(configured);
        if (url.protocol !== 'https:' || !url.hostname || !/\/compatible-mode\/v1(?:\/chat\/completions)?$/.test(url.pathname))
            return '';
        return configured.endsWith('/chat/completions') ? configured : `${configured}/chat/completions`;
    }
    catch {
        return '';
    }
}
function resolveQwenApiKey(env = process.env) {
    return String(env.QWEN_API_KEY || env.DASHSCOPE_API_KEY || '').trim();
}
function resolveQwenModel(env = process.env) {
    const model = String(env.QWEN_MODEL || 'qwen3.7-plus').trim() || 'qwen3.7-plus';
    return /^qwen3\.7-plus(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ? model : '';
}
function embeddedStrategy() { return (0, embedded_1.decryptEmbeddedStrategy)(); }
function resolveArkOutputTokens(tier, env = process.env, strategy = embeddedStrategy()) {
    const maxAllowedTokens = Number(strategy.models[tier].maxOutputTokens);
    const configuredValue = Number(env[tier === 'lite' ? 'ARK_LITE_MAX_OUTPUT_TOKENS' : 'ARK_MINI_MAX_OUTPUT_TOKENS']);
    const configuredMaxTokens = Number.isFinite(configuredValue) && configuredValue > 0 ? Math.floor(configuredValue) : maxAllowedTokens;
    return { configuredMaxTokens, effectiveMaxTokens: Math.min(configuredMaxTokens, maxAllowedTokens) };
}
function resolveNarrationOutputTokens(env = process.env, strategy = embeddedStrategy()) {
    const maximum = Number(strategy.models.narration.maxOutputTokens);
    const value = Number(env.ARK_NARRATION_MAX_OUTPUT_TOKENS || maximum);
    return Math.min(maximum, Number.isFinite(value) && value > 0 ? Math.floor(value) : maximum);
}
function resolveGradingTimeout(env = process.env, strategy = embeddedStrategy()) {
    const grading = strategy.models.grading;
    const value = Number(env.ARK_GRADING_TIMEOUT_MS || grading.timeoutMs);
    return Math.max(grading.minimumTimeoutMs, Math.min(grading.maximumTimeoutMs, Number.isFinite(value) && value > 0 ? Math.floor(value) : grading.timeoutMs));
}
function contentText(response) {
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content.map((item) => item?.text || item?.content || '').join('');
    }
    return '';
}
function resolveArkApiMode(tier, env = process.env) {
    const expected = tier === 'lite' ? 'responses' : 'chat_completions';
    const configured = String(env[tier === 'lite' ? 'ARK_LITE_API_MODE' : 'ARK_MINI_API_MODE'] || expected).toLowerCase();
    if (configured !== expected)
        throw Object.assign(new Error(`ARK ${tier} API mode must be ${expected}`), { code: 'ARK_INVALID_PARAMETER', retryable: false });
    return expected;
}
function resolveArkJsonMode(imageCount, env = process.env) {
    const configured = String(env.ARK_MULTIMODAL_JSON_MODE || env.ARK_ENABLE_JSON_MODE || 'auto').toLowerCase();
    return configured === 'enabled' || (configured === 'auto' && imageCount === 0);
}
function resolveArkRequestTimeout(env = process.env) {
    const fallback = GRADING_EXECUTION_BUDGET_MS;
    const value = Number(env.ARK_REQUEST_TIMEOUT_MS);
    if (!Number.isFinite(value) || value <= 0)
        return fallback;
    return Math.max(30000, Math.min(GRADING_EXECUTION_BUDGET_MS, Math.floor(value)));
}
function resolveGradingExecutionBudget(executionStartedAt, now = Date.now()) {
    const elapsedMs = Math.max(0, now - executionStartedAt);
    const remainingBudgetMs = Math.max(0, GRADING_EXECUTION_BUDGET_MS - elapsedMs);
    const requestTimeoutMs = Math.max(0, remainingBudgetMs - GRADING_EXECUTION_SAFETY_MARGIN_MS);
    return {
        totalBudgetMs: GRADING_EXECUTION_BUDGET_MS,
        remainingBudgetMs,
        requestTimeoutMs,
        canStartRepair: remainingBudgetMs >= REQUIRED_REPAIR_BUDGET_MS + GRADING_EXECUTION_SAFETY_MARGIN_MS,
    };
}
function responsesText(payload) { if (typeof payload?.output_text === 'string' && payload.output_text.trim())
    return payload.output_text; const output = Array.isArray(payload?.output) ? payload.output : []; return output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).filter((item) => item?.type === 'output_text').map((item) => String(item?.text?.value || item?.text || '')).join(''); }
function classifyModelOutputError(error) {
    if (error?.code === 'ARK_OUTPUT_TRUNCATED') return 'NON_REPAIRABLE_TRUNCATED';
    if (error?.code === 'LLM_SCHEMA_ERROR' || error?.code === 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION') return 'NON_REPAIRABLE_SCHEMA';
    return 'NON_REPAIRABLE_UNKNOWN';
}
function locateJsonEnvelope(text) {
    const first = text.search(/[\[{]/);
    if (first < 0) return text;
    let depth = 0, inString = false, escaped = false;
    for (let index = first; index < text.length; index += 1) {
        const ch = text[index];
        if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') depth += 1;
        else if (ch === '}' || ch === ']') depth -= 1;
        if (depth === 0) return text.slice(first, index + 1);
    }
    return text.slice(first);
}
function removeTrailingCommasOutsideStrings(text) {
    let result = '', inString = false, escaped = false, changed = false;
    for (let index = 0; index < text.length; index += 1) {
        const ch = text[index];
        if (inString) { result += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
        if (ch === '"') { inString = true; result += ch; continue; }
        if (ch === ',') { let next = index + 1; while (/\s/.test(text[next] || '')) next += 1; if (text[next] === '}' || text[next] === ']') { changed = true; continue; } }
        result += ch;
    }
    return { text: result, changed };
}
function normalizeOutputSchemaVersion(value, expectedVersion) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
    const receivedVersion = value.outputSchemaVersion;
    const isMissingVersion = receivedVersion === undefined || receivedVersion === null || (typeof receivedVersion === 'string' && receivedVersion.trim() === '');
    const hasTrustedExpectedVersion = typeof expectedVersion === 'string' && expectedVersion.trim() !== '';
    const hasUnsupportedVersionAlias = Object.hasOwn(value, 'schemaVersion') || Object.hasOwn(value, 'schema_version');
    const normalizedValue = isMissingVersion && hasTrustedExpectedVersion && !hasUnsupportedVersionAlias ? { ...value, outputSchemaVersion: expectedVersion.trim() } : value;
    if (!Array.isArray(normalizedValue.questions) || !hasTrustedExpectedVersion)
        return normalizedValue;
    let questionsChanged = false;
    const questions = normalizedValue.questions.map((question) => {
        if (!question || typeof question !== 'object' || Array.isArray(question) || (Object.getPrototypeOf(question) !== Object.prototype && Object.getPrototypeOf(question) !== null))
            return question;
        const questionVersion = question.outputSchemaVersion;
        const isMissingQuestionVersion = questionVersion === undefined || questionVersion === null || (typeof questionVersion === 'string' && questionVersion.trim() === '');
        const hasUnsupportedQuestionVersionAlias = Object.hasOwn(question, 'schemaVersion') || Object.hasOwn(question, 'schema_version');
        if (!isMissingQuestionVersion || hasUnsupportedQuestionVersionAlias)
            return question;
        questionsChanged = true;
        return { ...question, outputSchemaVersion: expectedVersion.trim() };
    });
    return questionsChanged ? { ...normalizedValue, questions } : normalizedValue;
}
function restoreReviewQuestionAttribution(value, options) {
    if (Number(options?.logicalPass) !== 2 || !value || typeof value !== 'object' || !Array.isArray(value.questions))
        return value;
    const baseline = (Array.isArray(options?.reviewQuestionAttributionBaseline) ? options.reviewQuestionAttributionBaseline : [])
        .filter((question) => question && typeof question === 'object' && !Array.isArray(question));
    const primaryByQuestionId = new Map(baseline
        .filter((question) => String(question.primaryQuestionId || '').trim())
        .map((question) => [String(question.primaryQuestionId).trim(), question]));
    const primaryBySourceKey = new Map(baseline
        .filter((question) => String(question.sourceKey || '').trim())
        .map((question) => [String(question.sourceKey).trim(), question]));
    if (!primaryByQuestionId.size && !primaryBySourceKey.size) return value;
    return { ...value, questions: value.questions.map((question) => {
        if (!question || typeof question !== 'object' || Array.isArray(question)) return question;
        const questionId = String(question.primaryQuestionId || '').trim();
        const primaryQuestion = (questionId ? primaryByQuestionId.get(questionId) : null) || primaryBySourceKey.get(String(question.sourceKey || '').trim());
        const { primaryQuestionId, ...cleanQuestion } = question;
        return primaryQuestion ? { ...cleanQuestion, sourceKey: primaryQuestion.sourceKey, sourceQuestionLabel: primaryQuestion.sourceQuestionLabel, sourceRegion: primaryQuestion.sourceRegion } : cleanQuestion;
    }) };
}

function fixedStepReviewEnabled(options = {}) {
    return Array.isArray(options?.fixedEvidenceQuestions) && options.fixedEvidenceQuestions.some((question) => Array.isArray(question?.fixedSteps) && question.fixedSteps.length > 0);
}
function modelValidationDiagnostics(options = {}) {
    return { requestStage: options?.requestStage ?? null, strategy: options?.strategy || null, fixedStepReview: fixedStepReviewEnabled(options), directHardProblemOutput: options?.directHardProblemOutput === true };
}
function parseAndValidateModelOutput(raw, options = {}) {
    const text = locateJsonEnvelope(String(raw || '').replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    let depth = 0, inString = false, escaped = false;
    for (const ch of text) {
        if (inString) { if (escaped)
            escaped = false;
        else if (ch === '\\')
            escaped = true;
        else if (ch === '"')
            inString = false;
        continue; }
        if (ch === '"')
            inString = true;
        else if (ch === '{' || ch === '[')
            depth += 1;
        else if (ch === '}' || ch === ']')
            depth -= 1;
    }
    if (['length', 'max_tokens'].includes(String(options.finishReason || '').toLowerCase()) || depth > 0 || inString || escaped)
        throw Object.assign(new Error('模型输出被截断'), { code: 'ARK_OUTPUT_TRUNCATED', finishReason: options.finishReason || null, tokenUsage: options.tokenUsage || null });
    const validate = (value) => {
        if (options[INTERNAL_REPAIR_PARSE_ONLY] === true)
            return value;
        value = restoreReviewQuestionAttribution(normalizeOutputSchemaVersion(value, options?.outputSchemaVersion), options);
        value = outputSchemaValidator.normalizeNewModelResult(value);
        if (!options.outputSchemaVersion) return value;
        const receivedVersion = value?.outputSchemaVersion ?? null;
        const expectedVersion = options?.outputSchemaVersion ?? null;
        if (receivedVersion !== expectedVersion) throw Object.assign(new Error('输出 Schema 版本不一致'), { code: 'UNSUPPORTED_OUTPUT_SCHEMA_VERSION', receivedVersion, expectedVersion, supportedVersions: expectedVersion ? [expectedVersion] : [], fieldPath: 'outputSchemaVersion', requestStage: options?.requestStage ?? null, topLevelKeys: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 30) : [] });
        try {
            outputSchemaValidator.validateNewModelResult(value, modelValidationDiagnostics(options));
        }
        catch (error) {
            Object.defineProperty(error, 'modelOutput', { value, enumerable: false });
            throw error;
        }
        return value;
    };
    try {
        return { value: validate(JSON.parse(text)), diagnostics: { repairAttempted: false, repairAttemptCount: 0, repairSucceeded: false, repairFailureReason: null, repairClassification: null, originalValidationSummary: null, repairedValidationSummary: null } };
    }
    catch (error) {
        if (error?.code) throw error;
        const repaired = removeTrailingCommasOutsideStrings(text);
        if (!repaired.changed) throw Object.assign(new Error('模型返回 JSON 无法解析'), { code: 'LLM_JSON_PARSE_ERROR', repairAttempted: false, repairAttemptCount: 0, repairFailureReason: null, repairClassification: 'NON_REPAIRABLE_UNKNOWN' });
        try {
            return { value: validate(JSON.parse(repaired.text)), diagnostics: { repairAttempted: true, repairAttemptCount: 1, repairSucceeded: true, repairFailureReason: null, repairClassification: 'REPAIRABLE_TRAILING_COMMA', originalValidationSummary: 'JSON_PARSE_ERROR', repairedValidationSummary: 'VALID' } };
        }
        catch (repairError) {
            throw Object.assign(new Error('模型 JSON 结构修复失败'), { code: 'LLM_SCHEMA_REPAIR_FAILED', repairAttempted: true, repairAttemptCount: 1, repairSucceeded: false, repairFailureReason: repairError?.code || 'JSON_PARSE_ERROR', repairClassification: classifyModelOutputError(repairError) });
        }
    }
}
async function requestArk(body, timeoutMs, apiMode) {
    const configuredTimeoutMs = Math.max(1000, Math.floor(Number(timeoutMs) || resolveArkRequestTimeout()));
    const url = new URL(`${baseUrl()}/${apiMode === 'responses' ? 'responses' : 'chat/completions'}`);
    const requestBody = JSON.stringify(body);
    const summary = (value) => String(value || '').replace(/https?:\/\/\S+/g, '[REDACTED_URL]').replace(/[A-Za-z0-9+/=]{80,}/g, '[REDACTED]').slice(0, 300);
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
        };
        const request = https.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: 'POST', headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, 'Content-Type': 'application/json' } }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
            response.on('error', (error) => fail(Object.assign(new Error(String(error?.message || 'Ark 响应读取失败')), { code: 'ARK_REQUEST_FAILED', errMsg: String(error?.errMsg || error?.message || '') })));
            response.on('end', () => {
                if (settled)
                    return;
                const text = Buffer.concat(chunks).toString('utf8');
                const status = Number(response.statusCode || 0);
                const providerRequestId = String(response.headers?.['x-request-id'] || '');
                if (status < 200 || status >= 300) {
                    const error = Object.assign(new Error(`Ark HTTP ${status}`), { code: 'ARK_HTTP_ERROR', status, errMsg: summary(text), providerRequestId });
                    if ([429, 500, 502, 503, 504].includes(status))
                        error.retryable = true;
                    fail(error);
                    return;
                }
                try {
                    const payload = JSON.parse(text);
                    settled = true;
                    resolve({ payload, providerRequestId: String(providerRequestId || payload?.request_id || payload?.id || '') });
                }
                catch (error) {
                    fail(Object.assign(new Error('Ark 返回无效 JSON'), { code: 'ARK_INVALID_JSON', errMsg: summary(text), providerRequestId }));
                }
            });
        });
        request.on('error', (error) => {
            const code = error?.code === 'ARK_REQUEST_TIMEOUT' ? 'ARK_REQUEST_TIMEOUT' : 'ARK_REQUEST_FAILED';
            fail(Object.assign(new Error(String(error?.message || 'Ark 请求失败')), { code, errMsg: String(error?.errMsg || error?.message || '') }));
        });
        if (typeof request.setTimeout === 'function')
            request.setTimeout(configuredTimeoutMs, () => request.destroy(Object.assign(new Error('Ark 请求超时'), { code: 'ARK_REQUEST_TIMEOUT', configuredTimeoutMs })));
        request.write(requestBody);
        request.end();
    });
}
async function requestQwen(body, timeoutMs, env = process.env) {
    const configuredTimeoutMs = Math.max(1000, Math.floor(Number(timeoutMs) || resolveArkRequestTimeout(env)));
    const endpoint = resolveQwenChatCompletionsUrl(env);
    const apiKey = resolveQwenApiKey(env);
    if (!endpoint || !apiKey)
        throw Object.assign(new Error('千问环境变量未配置'), { code: 'QWEN_NOT_CONFIGURED', retryable: false });
    const url = new URL(endpoint);
    const requestBody = JSON.stringify(body);
    const summary = (value) => String(value || '').replace(/https?:\/\/\S+/g, '[REDACTED_URL]').replace(/[A-Za-z0-9+/=]{80,}/g, '[REDACTED]').slice(0, 300);
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
        };
        const request = https.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(requestBody) } }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
            response.on('error', (error) => fail(Object.assign(new Error(String(error?.message || '千问响应读取失败')), { code: 'QWEN_REQUEST_FAILED', errMsg: String(error?.errMsg || error?.message || '') })));
            response.on('end', () => {
                if (settled)
                    return;
                const text = Buffer.concat(chunks).toString('utf8');
                const status = Number(response.statusCode || 0);
                const providerRequestId = String(response.headers?.['x-request-id'] || '');
                if (status < 200 || status >= 300) {
                    const error = Object.assign(new Error(`Qwen HTTP ${status}`), { code: 'QWEN_HTTP_ERROR', status, errMsg: summary(text), providerRequestId });
                    if ([408, 409, 429, 500, 502, 503, 504].includes(status))
                        error.retryable = true;
                    else
                        error.retryable = false;
                    fail(error);
                    return;
                }
                try {
                    const payload = JSON.parse(text);
                    settled = true;
                    resolve({ payload, providerRequestId: String(providerRequestId || payload?.request_id || payload?.id || '') });
                }
                catch {
                    fail(Object.assign(new Error('千问返回无效 JSON'), { code: 'QWEN_INVALID_JSON', errMsg: summary(text), providerRequestId }));
                }
            });
        });
        request.on('error', (error) => {
            const code = error?.code === 'QWEN_REQUEST_TIMEOUT' ? 'QWEN_REQUEST_TIMEOUT' : 'QWEN_REQUEST_FAILED';
            const wrapped = Object.assign(new Error(String(error?.message || '千问请求失败')), { code, errMsg: String(error?.errMsg || error?.message || '') });
            if (code === 'QWEN_REQUEST_TIMEOUT' || ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(String(error?.code || '')))
                wrapped.retryable = true;
            fail(wrapped);
        });
        if (typeof request.setTimeout === 'function')
            request.setTimeout(configuredTimeoutMs, () => request.destroy(Object.assign(new Error('千问请求超时'), { code: 'QWEN_REQUEST_TIMEOUT', configuredTimeoutMs })));
        request.write(requestBody);
        request.end();
    });
}
exports.__arkTest = { requestArk, requestQwen, normalizeModelProvider, resolveQwenChatCompletionsUrl, resolveQwenModel, resolveArkRequestTimeout, resolveGradingExecutionBudget, parseModelResponse: parseAndValidateModelOutput, parseAndValidateModelOutput };
async function callArk(options) {
    const invocationId = (0, utils_1.randomId)('ai');
    const startedAt = Date.now();
    const executionStartedAt = Number.isFinite(options[INTERNAL_GRADING_EXECUTION_STARTED_AT]) ? options[INTERNAL_GRADING_EXECUTION_STARTED_AT] : startedAt;
    const executionBudget = resolveGradingExecutionBudget(executionStartedAt, startedAt);
    if (executionBudget.requestTimeoutMs <= 0)
        throw Object.assign(new Error('批改模型执行预算已耗尽'), { code: 'ARK_EXECUTION_BUDGET_EXHAUSTED', totalBudgetMs: executionBudget.totalBudgetMs, remainingBudgetMs: executionBudget.remainingBudgetMs });
    const provider = normalizeModelProvider(options.provider);
    const qwenSelected = provider === 'qwen3_vl_plus';
    const endpoint = options.tier === 'lite' ? process.env.ARK_LITE_ENDPOINT : process.env.ARK_MINI_ENDPOINT;
    const tier = options.tier === 'lite' ? 'lite' : 'mini';
    const explicitOutputTokens = Number(options.maxOutputTokens);
    const defaults = Number.isFinite(explicitOutputTokens) && explicitOutputTokens > 0 ? { configuredMaxTokens: Math.floor(explicitOutputTokens), effectiveMaxTokens: Math.floor(explicitOutputTokens) } : resolveArkOutputTokens(tier);
    const configuredMaxTokens = defaults.configuredMaxTokens;
    const effectiveMaxTokens = defaults.effectiveMaxTokens;
    if (qwenSelected) {
        if (!resolveQwenApiKey() || !resolveQwenChatCompletionsUrl()) {
            (0, audit_1.monitor)('shared/ark', 'QWEN_REQUEST_FAILED', { taskId: options.taskId, provider, errorCode: 'QWEN_NOT_CONFIGURED', errorMessage: '千问环境变量未配置或地址无效' }, true);
            throw Object.assign(new Error('千问环境变量未配置或地址无效'), { code: 'QWEN_NOT_CONFIGURED', retryable: false });
        }
        if (!resolveQwenModel()) {
            (0, audit_1.monitor)('shared/ark', 'QWEN_REQUEST_FAILED', { taskId: options.taskId, provider, errorCode: 'QWEN_INVALID_MODEL', errorMessage: '千问模型名称无效' }, true);
            throw Object.assign(new Error('千问模型名称无效'), { code: 'QWEN_INVALID_MODEL', retryable: false });
        }
    }
    else if (!process.env.ARK_API_KEY || !endpoint) {
        (0, audit_1.monitor)('shared/ark', 'ARK_REQUEST_FAILED', { taskId: options.taskId, tier: options.tier, provider, errorCode: 'ARK_NOT_CONFIGURED', errorMessage: '方舟环境变量未配置' }, true);
        throw Object.assign(new Error('方舟环境变量未配置'), { code: 'ARK_NOT_CONFIGURED' });
    }
    const imageItems = (options.imageUrls || []).map((url) => ({
        type: 'image_url',
        image_url: { url },
    }));
    const promptChars = String(options.systemPrompt || '').length + String(options.userPrompt || '').length;
    const imageCount = imageItems.length;
    const logicalPass = Math.max(1, Number(options.logicalPass || options.attempt || 1));
    const transportAttempt = Math.max(1, Number(options.transportAttempt || 1));
    const parseOnlyForModelOutputRepair = options[INTERNAL_REPAIR_PARSE_ONLY] === true;
    const apiMode = qwenSelected ? 'chat_completions' : resolveArkApiMode(tier);
    const qwenUrl = qwenSelected ? new URL(resolveQwenChatCompletionsUrl()) : null;
    const endpointPath = qwenSelected ? `${qwenUrl.pathname}${qwenUrl.search}` : (apiMode === 'responses' ? '/api/v3/responses' : '/api/v3/chat/completions');
    const jsonMode = qwenSelected || options.structuredOutputMode === 'json_object';
    if (!['none', 'json_object'].includes(options.structuredOutputMode || 'none'))
        throw Object.assign(new Error('不支持的结构化输出模式'), { code: 'UNSUPPORTED_STRUCTURED_OUTPUT_MODE', requestStage: options.requestStage });
    if (!qwenSelected && jsonMode && apiMode !== 'chat_completions')
        throw Object.assign(new Error('当前 Ark 接口不支持所需的结构化输出模式'), { code: 'UNSUPPORTED_STRUCTURED_OUTPUT_MODE', requestStage: options.requestStage });
    const body = qwenSelected ? {
        model: resolveQwenModel(),
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0,
        max_completion_tokens: effectiveMaxTokens,
        enable_thinking: false,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: options.systemPrompt },
            { role: 'user', content: [{ type: 'text', text: options.userPrompt }, ...imageItems] },
        ],
    } : apiMode === 'responses' ? {
        model: endpoint, max_output_tokens: effectiveMaxTokens,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: [options.systemPrompt, options.userPrompt].filter(Boolean).join('\n') }, ...(options.imageUrls || []).map((url) => ({ type: 'input_image', image_url: url }))] }],
    } : {
        model: endpoint,
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0,
        max_tokens: effectiveMaxTokens,
        messages: [
            { role: 'system', content: options.systemPrompt },
            { role: 'user', content: [{ type: 'text', text: options.userPrompt }, ...imageItems] },
        ],
    };
    if (!qwenSelected && jsonMode && apiMode === 'chat_completions')
        body.response_format = { type: 'json_object' };
    const timeoutMs = executionBudget.requestTimeoutMs;
    const configuredTimeoutMs = timeoutMs;
    let raw = '';
    let payload = null;
    let lastError = null;
    const attempt = transportAttempt;
    try {
        (0, audit_1.monitor)('shared/ark', 'ARK_API_MODE_SELECTED', { buildId: ARK_BUILD_ID, taskId: options.taskId, provider, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, jsonMode });
        (0, audit_1.monitor)('shared/ark', 'ARK_REQUEST_START', { buildId: ARK_BUILD_ID, taskId: options.taskId, provider, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, jsonMode, promptChars, imageCount, requestTimeoutMs: timeoutMs, totalExecutionBudgetMs: executionBudget.totalBudgetMs, remainingBudgetMs: executionBudget.remainingBudgetMs, configuredMaxTokens, effectiveMaxTokens, completionTokens: null, finishReason: null, questionCount: null, jsonParseSuccess: null });
        const transport = qwenSelected ? await requestQwen(body, timeoutMs) : await requestArk(body, timeoutMs, apiMode);
        payload = transport.payload;
        raw = apiMode === 'responses' ? responsesText(payload) : contentText(payload);
        const finishReason = apiMode === 'responses' ? payload?.status : payload?.choices?.[0]?.finish_reason;
        const completionTokens = Number(payload?.usage?.output_tokens || payload?.usage?.completion_tokens || 0);
        (0, audit_1.monitor)('shared/ark', 'ARK_RESPONSE_RECEIVED', { taskId: options.taskId, provider, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, jsonMode, providerRequestId: transport.providerRequestId || null, durationMs: Date.now() - startedAt, httpStatus: 200, responseLength: raw.length, promptChars, imageCount, configuredMaxTokens, effectiveMaxTokens, completionTokens, finishReason: finishReason || null, questionCount: null, jsonParseSuccess: null });
        if (finishReason === 'length' || finishReason === 'max_tokens') {
            throw Object.assign(new Error('模型输出被截断'), { code: qwenSelected ? 'QWEN_OUTPUT_TRUNCATED' : 'ARK_OUTPUT_TRUNCATED', requestStage: options.requestStage, outputSchemaVersion: options.outputSchemaVersion, modelTier: tier, modelProvider: provider, modelName: qwenSelected ? resolveQwenModel() : endpoint, providerRequestId: transport.providerRequestId || null, finishReason, tokenUsage: payload?.usage || null });
        }
        if (!raw.trim()) {
            throw Object.assign(new Error('模型返回为空'), { code: 'LLM_EMPTY_RESPONSE' });
        }
        let parsed;
        try {
            let parsedResponse;
            try {
                parsedResponse = parseAndValidateModelOutput(raw, { finishReason, tokenUsage: payload?.usage || null, outputSchemaVersion: options.outputSchemaVersion, requestStage: options.requestStage, strategy: options.strategy || null, logicalPass, reviewQuestionAttributionBaseline: options.reviewQuestionAttributionBaseline, parseOnlyForModelOutputRepair, fixedEvidenceQuestions: options.fixedEvidenceQuestions, [INTERNAL_REPAIR_PARSE_ONLY]: options[INTERNAL_REPAIR_PARSE_ONLY] === true });
            }
            catch (initialError) {
                const allowedRepairAttempts = Math.max(0, Math.floor(Number(options.maxRepairAttempts ?? 1)));
                const repairPlan = allowedRepairAttempts < 1 || options.disableModelOutputRepair || options.disableConfidenceRepair ? null : modelOutputRepair.prepareModelOutputRepair(initialError, options.strategy || null, modelValidationDiagnostics(options));
                if (!repairPlan)
                    throw initialError;
                const initialIssueCount = repairPlan.issues.length;
                const repairableIssueCount = repairPlan.issues.filter((item) => item.repairable === true).length;
                const attemptedFieldPaths = [...repairPlan.fieldPaths];
                let repairAttemptCount = 0;
                let returnedFieldCount = null;
                const returnedFieldCounts = [];
                const accumulatedIgnoredFieldPaths = [];
                const accumulatedIgnoredTopLevelKeys = [];
                const accumulatedDeterministicFieldPaths = [];
                let lastRepairMergedOutput = null;
                (0, audit_1.monitor)('shared/ark', 'ARK_MODEL_OUTPUT_REPAIR_ATTEMPT', { taskId: options.taskId, tier, stage: options.stage || options.requestStage || null, diagnostics: { repairAttemptNumber: 1, initialIssueCount, repairableIssueCount, nonRepairableIssueCount: initialIssueCount - repairableIssueCount, repairFieldCount: repairPlan.fieldPaths.length, repairFieldPaths: repairPlan.fieldPaths, requestStage: options.requestStage || null } });
                const requestRepairPatch = async (plan, attemptNumber, deferRepairablePostIssues) => {
                    const requestRepairEnvelope = async (requestPlan, requestAttemptNumber) => {
                        const repairBudget = resolveGradingExecutionBudget(executionStartedAt);
                        if (!repairBudget.canStartRepair)
                            throw Object.assign(new Error('剩余执行预算不足以发起 Repair'), { code: 'ARK_EXECUTION_BUDGET_EXHAUSTED', failureReason: 'REPAIR_BUDGET_EXHAUSTED', totalBudgetMs: repairBudget.totalBudgetMs, remainingBudgetMs: repairBudget.remainingBudgetMs });
                        const instructions = modelOutputRepair.modelOutputRepairInstructions({ ...requestPlan, originalRawResponse: requestAttemptNumber > 1 ? JSON.stringify(requestPlan.originalOutput) : raw, originalRequest: options });
                        const repairedResult = await callArk({ ...options, imageUrls: Array.isArray(options.imageUrls) ? options.imageUrls : [], systemPrompt: instructions.systemPrompt, userPrompt: instructions.userPrompt, maxRepairAttempts: 0, disableModelOutputRepair: true, [INTERNAL_REPAIR_PARSE_ONLY]: true, [INTERNAL_GRADING_EXECUTION_STARTED_AT]: executionStartedAt });
                        const repairedOutput = { ...repairedResult };
                        delete repairedOutput._modelDiagnostics;
                        returnedFieldCounts.push(Array.isArray(repairedOutput.repairs) ? repairedOutput.repairs.length : null);
                        repairAttemptCount = requestAttemptNumber;
                        return repairedOutput;
                    };
                    let repairedOutput = await requestRepairEnvelope(plan, attemptNumber);
                    const validationContext = deferRepairablePostIssues ? { ...plan.validationContext, deferRepairablePostIssues: true } : plan.validationContext;
                    let merged;
                    try {
                        merged = outputSchemaValidator.normalizeNewModelResult(modelOutputRepair.mergeRepairedOutput(plan.originalOutput, repairedOutput, plan.fields, plan.schema, validationContext));
                    }
                    catch (repairError) {
                        const missingRequiredFieldPaths = Array.isArray(repairError?.missingRequiredFieldPaths) ? repairError.missingRequiredFieldPaths.filter(Boolean) : [];
                        if (attemptNumber !== 1 || repairError?.failureReason !== 'MISSING_REQUIRED_PATCH' || !missingRequiredFieldPaths.length)
                            throw repairError;
                        const missing = new Set(missingRequiredFieldPaths);
                        const completionPlan = { ...plan, fields: plan.fields.filter((field) => missing.has(field.fieldPath)), fieldPaths: missingRequiredFieldPaths };
                        (0, audit_1.monitor)('shared/ark', 'ARK_MODEL_OUTPUT_REPAIR_COMPLETION', { taskId: options.taskId, tier, stage: options.stage || options.requestStage || null, diagnostics: { repairAttemptNumber: 2, missingRequiredFieldPaths, requestedFieldCount: plan.fieldPaths.length, returnedFieldCount: Array.isArray(repairedOutput.repairs) ? repairedOutput.repairs.length : null, imageCount: Array.isArray(options.imageUrls) ? options.imageUrls.length : 0, requestStage: options.requestStage || null } }, true);
                        const completionOutput = await requestRepairEnvelope(completionPlan, 2);
                        repairedOutput = { repairs: [...(Array.isArray(repairedOutput.repairs) ? repairedOutput.repairs : []), ...(Array.isArray(completionOutput.repairs) ? completionOutput.repairs : [])] };
                        merged = outputSchemaValidator.normalizeNewModelResult(modelOutputRepair.mergeRepairedOutput(plan.originalOutput, repairedOutput, plan.fields, plan.schema, validationContext));
                    }
                    returnedFieldCount = Array.isArray(repairedOutput.repairs) ? repairedOutput.repairs.length : null;
                    lastRepairMergedOutput = merged;
                    const diagnostics = modelOutputRepair.getRepairDiagnostics(merged);
                    accumulatedIgnoredFieldPaths.push(...(diagnostics.ignoredFieldPaths || []));
                    accumulatedIgnoredTopLevelKeys.push(...(diagnostics.ignoredTopLevelKeys || []));
                    accumulatedDeterministicFieldPaths.push(...(diagnostics.deterministicFieldPaths || []));
                    return { merged, diagnostics };
                };
                try {
                    let repairResult = await requestRepairPatch(repairPlan, 1, true);
                    let mergedOutput = repairResult.merged;
                    let repairDiagnostics = repairResult.diagnostics;
                    let postRepairIssues = outputSchemaValidator.collectNewModelResultIssues(mergedOutput, modelValidationDiagnostics(options));
                    if (postRepairIssues.length && allowedRepairAttempts >= 2) {
                        const secondError = Object.assign(new Error('第一次修复后仍存在可修复字段'), { code: postRepairIssues[0]?.code || 'LLM_SCHEMA_ERROR', fieldPath: postRepairIssues[0]?.fieldPath || null, issues: postRepairIssues, modelOutput: mergedOutput });
                        const secondPlan = postRepairIssues.every((item) => item?.repairable === true) ? modelOutputRepair.prepareModelOutputRepair(secondError, options.strategy || null, modelValidationDiagnostics(options)) : null;
                        if (!secondPlan) throw Object.assign(new Error('模型修复后仍不符合完整 Schema'), { code: 'LLM_SCHEMA_ERROR', fieldPath: postRepairIssues[0]?.fieldPath || null, issues: postRepairIssues, issueCount: postRepairIssues.length, repairFailureStage: 'SECOND_REPAIR_PLANNING' });
                        attemptedFieldPaths.push(...secondPlan.fieldPaths.filter((fieldPath) => !attemptedFieldPaths.includes(fieldPath)));
                        (0, audit_1.monitor)('shared/ark', 'ARK_MODEL_OUTPUT_REPAIR_RETRY', { taskId: options.taskId, tier, stage: options.stage || options.requestStage || null, diagnostics: { repairAttemptNumber: 2, remainingIssueCount: postRepairIssues.length, remainingIssuePaths: postRepairIssues.map((item) => item.fieldPath).filter(Boolean), repairFieldCount: secondPlan.fieldPaths.length, repairFieldPaths: secondPlan.fieldPaths, requestStage: options.requestStage || null } });
                        repairResult = await requestRepairPatch(secondPlan, 2, false);
                        mergedOutput = repairResult.merged;
                        repairDiagnostics = repairResult.diagnostics;
                        postRepairIssues = outputSchemaValidator.collectNewModelResultIssues(mergedOutput, modelValidationDiagnostics(options));
                    }
                    if (postRepairIssues.length) throw Object.assign(new Error('模型修复后仍不符合完整 Schema'), { code: 'LLM_SCHEMA_ERROR', fieldPath: postRepairIssues[0].fieldPath, issues: postRepairIssues, issueCount: postRepairIssues.length, repairFailureStage: 'POST_REPAIR_FULL_VALIDATION' });
                    outputSchemaValidator.validateNewModelResult(mergedOutput, modelValidationDiagnostics(options));
                    parsedResponse = { value: mergedOutput, diagnostics: { repairAttempted: true, repairAttemptCount, repairSucceeded: true, repairFailureReason: null, repairClassification: repairAttemptCount > 1 ? 'REPAIRABLE_FIELD_PATCH_RETRY' : 'REPAIRABLE_FIELD_PATCH', repairFieldPaths: attemptedFieldPaths, ignoredRepairFieldPaths: [...new Set(accumulatedIgnoredFieldPaths)], ignoredRepairTopLevelKeys: [...new Set(accumulatedIgnoredTopLevelKeys)], normalizationAttempted: repairDiagnostics.normalizationAttempted, normalizationSucceeded: repairDiagnostics.normalizationSucceeded, deterministicRepairFieldPaths: [...new Set(accumulatedDeterministicFieldPaths)], originalValidationSummary: `LLM_SCHEMA_ERROR:${attemptedFieldPaths.join(',')}`, repairedValidationSummary: 'VALID' } };
                    (0, audit_1.monitor)('shared/ark', 'ARK_MODEL_OUTPUT_REPAIR_SUCCEEDED', { taskId: options.taskId, tier, stage: options.stage || options.requestStage || null, diagnostics: { repairAttemptCount, initialIssueCount, repairableIssueCount, nonRepairableIssueCount: initialIssueCount - repairableIssueCount, repairFieldCount: attemptedFieldPaths.length, postRepairIssueCount: 0, repairFieldPaths: attemptedFieldPaths, deterministicRepairFieldPaths: [...new Set(accumulatedDeterministicFieldPaths)], ignoredRepairFieldPaths: [...new Set(accumulatedIgnoredFieldPaths)], ignoredRepairTopLevelKeys: [...new Set(accumulatedIgnoredTopLevelKeys)], normalizationAttempted: repairDiagnostics.normalizationAttempted, normalizationSucceeded: repairDiagnostics.normalizationSucceeded, requestStage: options.requestStage || null } });
                }
                catch (repairError) {
                    const postRepairIssues = Array.isArray(repairError?.issues) ? repairError.issues : [];
                    const postRepairIssue = postRepairIssues[0] || null;
                    const postRepairQuestionIndex = Number(String(postRepairIssue?.fieldPath || repairError?.fieldPath || '').match(/^questions\[(\d+)\]/)?.[1]);
                    const expectedFixedQuestion = Number.isInteger(postRepairQuestionIndex) ? (Array.isArray(options.fixedEvidenceQuestions) ? options.fixedEvidenceQuestions : [])[postRepairQuestionIndex] : null;
                    const expectedFixedSteps = Array.isArray(expectedFixedQuestion?.fixedSteps) ? expectedFixedQuestion.fixedSteps : [];
                    const actualRepairSteps = Number.isInteger(postRepairQuestionIndex) && Array.isArray(lastRepairMergedOutput?.questions?.[postRepairQuestionIndex]?.stepFeedbacks) ? lastRepairMergedOutput.questions[postRepairQuestionIndex].stepFeedbacks : [];
                    const missingRequiredFieldPaths = Array.isArray(repairError?.missingRequiredFieldPaths) ? repairError.missingRequiredFieldPaths.filter(Boolean) : [];
                    (0, audit_1.monitor)('shared/ark', 'ARK_MODEL_OUTPUT_REPAIR_FAILED', { taskId: options.taskId, tier, stage: options.stage || options.requestStage || null, errorCode: repairError?.code || 'LLM_SCHEMA_REPAIR_FAILED', diagnostics: { failureReason: repairError?.failureReason || (repairError?.code === 'LLM_SCHEMA_ERROR' ? 'FULL_SCHEMA_VALIDATION_FAILED' : 'REPAIR_MERGE_OR_VALIDATE'), missingRequiredFieldPaths, requestedFieldCount: attemptedFieldPaths.length, returnedFieldCount, returnedFieldCounts, repairAttemptCount, repairFailureStage: repairError?.repairFailureStage || 'REPAIR_MERGE_OR_VALIDATE', repairFailureFieldPath: repairError?.fieldPath || null, requestStage: options.requestStage || null, initialIssueCount, repairableIssueCount, nonRepairableIssueCount: initialIssueCount - repairableIssueCount, repairFieldCount: attemptedFieldPaths.length, postRepairIssueCount: postRepairIssues.length, postRepairIssuePaths: postRepairIssues.map((item) => item.fieldPath).filter(Boolean), postRepairIssueCode: postRepairIssue?.code || null, expectedStepCount: expectedFixedSteps.length || null, actualStepCount: actualRepairSteps.length || null, expectedStepIndexes: expectedFixedSteps.map((_, index) => index + 1), actualStepIndexes: actualRepairSteps.map((step) => Number.isInteger(step?.stepIndex) ? step.stepIndex : null), repairFieldPaths: attemptedFieldPaths, repairFailureCode: repairError?.code || 'LLM_SCHEMA_REPAIR_FAILED', repairIssueCode: repairError?.issueCode || null, sameValue: repairError?.sameValue === true, expectedType: repairError?.expectedType || null, actualType: repairError?.actualType || null, normalizationAttempted: repairError?.normalizationAttempted === true, normalizationSucceeded: repairError?.normalizationSucceeded === true } }, true);
                    throw Object.assign(new Error('模型受限字段修复失败'), { code: 'LLM_SCHEMA_REPAIR_FAILED', fieldPath: repairError?.fieldPath || initialError.fieldPath, questionIndex: Number((repairError?.fieldPath || initialError.fieldPath || '').match(/\[(\d+)\]/)?.[1]), requestStage: options.requestStage || null, repairAttempted: true, repairAttemptCount: Math.max(1, repairAttemptCount), repairSucceeded: false, repairFailureReason: repairError?.code || 'LLM_SCHEMA_REPAIR_FAILED', repairClassification: repairAttemptCount > 1 ? 'REPAIRABLE_FIELD_PATCH_RETRY' : 'REPAIRABLE_FIELD_PATCH', repairFailureStage: repairError?.repairFailureStage || 'REPAIR_MERGE_OR_VALIDATE', failureReason: repairError?.failureReason || null, missingRequiredFieldPaths, issueCode: repairError?.issueCode || null, expectedType: repairError?.expectedType || null, actualType: repairError?.actualType || null, requestedFieldCount: attemptedFieldPaths.length, returnedFieldCount, returnedFieldCounts, postRepairIssuePaths: postRepairIssues.map((item) => item.fieldPath).filter(Boolean) });
                }
            }
            parsed = parseOnlyForModelOutputRepair ? parsedResponse.value : options.mode === 'grade' ? (0, json_1.validateGrade)((0, json_1.normalizeGradeResult)(parsedResponse.value)) : parsedResponse.value;
            parsed._modelDiagnostics = { modelRuntimeContractVersion: 'model-runtime.v1', outputSchemaRegistryVersion: 'output-schema-registry.v1', downstreamSemanticsVersion: 'result-semantics.v1', outputSchemaVersion: options.outputSchemaVersion || parsed.outputSchemaVersion || null, requestStage: options.requestStage || null, modelTier: tier, modelProvider: provider, modelName: qwenSelected ? resolveQwenModel() : endpoint, providerRequestIdPresent: Boolean(transport.providerRequestId), durationMs: Date.now() - startedAt, finishReason: finishReason || null, tokenUsage: payload?.usage || null, responseHash: require('crypto').createHash('sha256').update(raw).digest('hex'), responseLength: raw.length, ...parsedResponse.diagnostics };
        }
        catch (error) {
            error.requestStage = error.requestStage || options.requestStage || null;
            error.modelProvider = error.modelProvider || provider;
            error.modelName = error.modelName || (qwenSelected ? resolveQwenModel() : endpoint);
            error.providerRequestId = error.providerRequestId || transport.providerRequestId || null;
            const schemaValidation = (0, utils_1.safeError)(error).schemaValidation;
            (0, audit_1.monitor)('shared/ark', 'ARK_RESPONSE_INVALID', { taskId: options.taskId, provider, tier, attempt, errorCode: error?.code || 'ARK_RESPONSE_INVALID', errorMessage: error?.message, diagnostics: schemaValidation ? { schemaValidation } : null, promptChars, imageCount, configuredMaxTokens, effectiveMaxTokens, completionTokens, finishReason: finishReason || null, questionCount: null, jsonParseSuccess: false }, true);
            throw error;
        }
        const questionCount = Array.isArray(parsed?.questions) ? parsed.questions.length : null;
        await context_1.db.collection(constants_1.C.ai).add({ data: {
                invocationId,
                taskId: options.taskId,
                tier,
                provider,
                attempt,
                durationMs: Date.now() - startedAt,
                responseLength: raw.length,
                promptChars,
                imageCount,
                configuredMaxTokens,
                effectiveMaxTokens,
                completionTokens,
                finishReason: finishReason || null,
                questionCount,
                jsonParseSuccess: true,
                usage: payload?.usage || null,
                status: 'SUCCESS',
                createdAt: (0, utils_1.now)(),
            } });
        (0, audit_1.monitor)('shared/ark', 'ARK_REQUEST_COMPLETE', { taskId: options.taskId, provider, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, providerRequestId: transport.providerRequestId || null, durationMs: Date.now() - startedAt, httpStatus: 200, responseLength: raw.length, promptChars, imageCount, configuredMaxTokens, effectiveMaxTokens, completionTokens, finishReason: finishReason || null, questionCount, jsonParseSuccess: true });
        return parsed;
    }
    catch (error) {
        lastError = error;
        error.requestStage = error.requestStage || options.requestStage || null;
        error.outputSchemaVersion = error.outputSchemaVersion || options.outputSchemaVersion || null;
        error.modelTier = error.modelTier || tier;
        error.modelProvider = error.modelProvider || provider;
        error.modelName = error.modelName || (qwenSelected ? resolveQwenModel() : endpoint);
        error.repairAttempted = error.repairAttempted === true;
        error.safeMessage = error.safeMessage || '模型响应处理失败';
        const timedOut = error?.name === 'AbortError' || ['ARK_REQUEST_TIMEOUT', 'QWEN_REQUEST_TIMEOUT'].includes(error?.code);
        if (timedOut) {
            error.code = qwenSelected ? 'QWEN_REQUEST_TIMEOUT' : 'ARK_REQUEST_TIMEOUT';
            error.retryable = true;
        }
        if (error?.name === 'TypeError' && !error?.code) {
            error.code = qwenSelected ? 'QWEN_CONNECTION_ERROR' : 'ARK_CONNECTION_ERROR';
            error.retryable = true;
        }
        if (!error.providerRequestId)
            error.providerRequestId = String(error?.request_id || error?.requestId || String(error?.message || '').match(/Request id:\s*([^\s,]+)/i)?.[1] || '');
        const schemaValidation = (0, utils_1.safeError)(error).schemaValidation;
        (0, audit_1.monitor)('shared/ark', timedOut ? 'ARK_REQUEST_TIMEOUT' : 'ARK_REQUEST_FAILED', { taskId: options.taskId, provider, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, jsonMode, durationMs: Date.now() - startedAt, httpStatus: error?.status || null, responseLength: raw.length, errorCode: error?.code || 'ARK_REQUEST_FAILED', providerRequestId: error?.providerRequestId || null, errorMessage: error?.message, diagnostics: { configuredTimeoutMs, actualDurationMs: Date.now() - startedAt, ...(schemaValidation ? { schemaValidation } : {}) }, promptChars, imageCount, requestTimeoutMs: configuredTimeoutMs, configuredMaxTokens, effectiveMaxTokens, completionTokens: Number(payload?.usage?.output_tokens || payload?.usage?.completion_tokens || 0), finishReason: apiMode === 'responses' ? payload?.status : payload?.choices?.[0]?.finish_reason || null, questionCount: null, jsonParseSuccess: false, retryable: error?.retryable !== false }, true);
    }
    await context_1.db.collection(constants_1.C.ai).add({ data: {
            invocationId,
            taskId: options.taskId,
            tier,
            provider,
            durationMs: Date.now() - startedAt,
            responseLength: raw.length,
            promptChars,
            imageCount,
            configuredMaxTokens,
            effectiveMaxTokens,
            completionTokens: Number(payload?.usage?.completion_tokens || 0),
            finishReason: payload?.choices?.[0]?.finish_reason || null,
            questionCount: null,
            jsonParseSuccess: false,
            status: 'FAILED',
            error: (0, utils_1.safeError)(lastError),
            createdAt: (0, utils_1.now)(),
        } }).catch(() => { });
    throw lastError;
}
// 开发兼容函数：只在明确调用时读取内置策略；正式业务链路使用 loadRuntimeStrategy。
function narrationUserPrompt(input) { return strategyRender.narrationUserPrompt(embeddedStrategy(), input); }
async function generateNarration(narrationInput, taskId) {
    const strategy = await (0, remote_1.loadRuntimeStrategy)();
    return callArk({ taskId, tier: 'mini', mode: 'narration', imageUrls: [], systemPrompt: strategy.prompts.narration.system, userPrompt: strategyRender.narrationUserPrompt(strategy, narrationInput), temperature: strategy.models.narration.temperature, maxOutputTokens: resolveNarrationOutputTokens(process.env, strategy), timeoutMs: Number(process.env.ARK_NARRATION_TIMEOUT_MS || strategy.models.narration.timeoutMs) });
}
function answerExtractionUserPrompt() { return strategyRender.answerExtractionUserPrompt(embeddedStrategy()); }
function gradeUserPrompt(meta) { return strategyRender.gradeUserPrompt(embeddedStrategy(), meta); }
function hardProblemUserPrompt(meta) { return strategyRender.hardProblemUserPrompt(embeddedStrategy(), meta); }
function carelessTrainingUserPrompt(meta) { return strategyRender.carelessTrainingUserPrompt(embeddedStrategy(), meta); }
