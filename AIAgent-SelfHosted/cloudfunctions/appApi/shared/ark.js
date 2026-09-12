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
exports.callArk = callArk;
exports.narrationUserPrompt = narrationUserPrompt;
exports.generateNarration = generateNarration;
exports.answerExtractionUserPrompt = answerExtractionUserPrompt;
exports.gradeUserPrompt = gradeUserPrompt;
exports.hardProblemUserPrompt = hardProblemUserPrompt;
exports.carelessTrainingUserPrompt = carelessTrainingUserPrompt;
const json_1 = require("./json");
const context_1 = require("./context");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const ARK_BUILD_ID = 'build-20260725-retry-v3';
const audit_1 = require("./audit");
const embedded_1 = require("./strategy/embedded");
const strategyRender = __importStar(require("./strategy/render"));
const remote_1 = require("./strategy/remote");
const baseUrl = () => String(process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
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
function responsesText(payload) { if (typeof payload?.output_text === 'string' && payload.output_text.trim())
    return payload.output_text; const output = Array.isArray(payload?.output) ? payload.output : []; return output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).filter((item) => item?.type === 'output_text').map((item) => String(item?.text?.value || item?.text || '')).join(''); }
async function requestArk(body, timeoutMs, apiMode) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${baseUrl()}/${apiMode === 'responses' ? 'responses' : 'chat/completions'}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.ARK_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload?.error?.message || `Ark HTTP ${response.status}`);
            const providerCode = String(payload?.error?.code || '');
            error.code = /invalidparameter/i.test(providerCode) ? 'ARK_INVALID_PARAMETER' : providerCode || 'ARK_HTTP_ERROR';
            error.providerRequestId = String(payload?.error?.request_id || payload?.error?.requestId || payload?.request_id || payload?.requestId || response.headers?.get?.('x-request-id') || '');
            if (error.code === 'ARK_INVALID_PARAMETER')
                error.retryable = false;
            if ([429, 500, 502, 503, 504].includes(response.status) || /InternalServiceError/i.test(providerCode))
                error.retryable = true;
            error.status = response.status;
            throw error;
        }
        return { payload, providerRequestId: String(response.headers?.get?.('x-request-id') || payload?.request_id || payload?.id || '') };
    }
    finally {
        clearTimeout(timer);
    }
}
async function callArk(options) {
    const invocationId = (0, utils_1.randomId)('ai');
    const startedAt = Date.now();
    const endpoint = options.tier === 'lite' ? process.env.ARK_LITE_ENDPOINT : process.env.ARK_MINI_ENDPOINT;
    const tier = options.tier === 'lite' ? 'lite' : 'mini';
    const explicitOutputTokens = Number(options.maxOutputTokens);
    const defaults = Number.isFinite(explicitOutputTokens) && explicitOutputTokens > 0 ? { configuredMaxTokens: Math.floor(explicitOutputTokens), effectiveMaxTokens: Math.floor(explicitOutputTokens) } : resolveArkOutputTokens(tier);
    const configuredMaxTokens = defaults.configuredMaxTokens;
    const effectiveMaxTokens = defaults.effectiveMaxTokens;
    if (!process.env.ARK_API_KEY || !endpoint) {
        (0, audit_1.monitor)('shared/ark', 'ARK_REQUEST_FAILED', { taskId: options.taskId, tier: options.tier, errorCode: 'ARK_NOT_CONFIGURED', errorMessage: '方舟环境变量未配置' }, true);
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
    const apiMode = resolveArkApiMode(tier);
    const endpointPath = apiMode === 'responses' ? '/api/v3/responses' : '/api/v3/chat/completions';
    const jsonMode = resolveArkJsonMode(imageCount);
    const body = apiMode === 'responses' ? {
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
    if (jsonMode && apiMode === 'chat_completions')
        body.response_format = { type: 'json_object' };
    const timeoutMs = Math.max(1000, Math.min(90000, Number(options.timeoutMs || 30000)));
    let raw = '';
    let payload = null;
    let lastError = null;
    const attempt = transportAttempt;
    try {
        (0, audit_1.monitor)('shared/ark', 'ARK_API_MODE_SELECTED', { buildId: ARK_BUILD_ID, taskId: options.taskId, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, jsonMode });
        (0, audit_1.monitor)('shared/ark', 'ARK_REQUEST_START', { buildId: ARK_BUILD_ID, taskId: options.taskId, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, jsonMode, promptChars, imageCount, requestTimeoutMs: timeoutMs, configuredMaxTokens, effectiveMaxTokens, completionTokens: null, finishReason: null, questionCount: null, jsonParseSuccess: null });
        const transport = await requestArk(body, timeoutMs, apiMode);
        payload = transport.payload;
        raw = apiMode === 'responses' ? responsesText(payload) : contentText(payload);
        const finishReason = apiMode === 'responses' ? payload?.status : payload?.choices?.[0]?.finish_reason;
        const completionTokens = Number(payload?.usage?.output_tokens || payload?.usage?.completion_tokens || 0);
        (0, audit_1.monitor)('shared/ark', 'ARK_RESPONSE_RECEIVED', { taskId: options.taskId, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, jsonMode, providerRequestId: transport.providerRequestId || null, durationMs: Date.now() - startedAt, httpStatus: 200, responseLength: raw.length, promptChars, imageCount, configuredMaxTokens, effectiveMaxTokens, completionTokens, finishReason: finishReason || null, questionCount: null, jsonParseSuccess: null });
        if (finishReason === 'length') {
            throw Object.assign(new Error('模型输出被截断'), { code: 'LLM_TRUNCATED_RESPONSE' });
        }
        if (!raw.trim()) {
            throw Object.assign(new Error('模型返回为空'), { code: 'LLM_EMPTY_RESPONSE' });
        }
        let parsed;
        try {
            parsed = options.mode === 'grade' ? (0, json_1.validateGrade)((0, json_1.normalizeGradeResult)((0, json_1.extractJson)(raw))) : (0, json_1.extractJson)(raw);
        }
        catch (error) {
            (0, audit_1.monitor)('shared/ark', 'ARK_RESPONSE_INVALID', { taskId: options.taskId, tier, attempt, errorCode: error?.code || 'ARK_RESPONSE_INVALID', errorMessage: error?.message, promptChars, imageCount, configuredMaxTokens, effectiveMaxTokens, completionTokens, finishReason: finishReason || null, questionCount: null, jsonParseSuccess: false }, true);
            throw error;
        }
        const questionCount = Array.isArray(parsed?.questions) ? parsed.questions.length : null;
        await context_1.db.collection(constants_1.C.ai).add({ data: {
                invocationId,
                taskId: options.taskId,
                tier,
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
        (0, audit_1.monitor)('shared/ark', 'ARK_REQUEST_COMPLETE', { taskId: options.taskId, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, providerRequestId: transport.providerRequestId || null, durationMs: Date.now() - startedAt, httpStatus: 200, responseLength: raw.length, promptChars, imageCount, configuredMaxTokens, effectiveMaxTokens, completionTokens, finishReason: finishReason || null, questionCount, jsonParseSuccess: true });
        return parsed;
    }
    catch (error) {
        lastError = error;
        const timedOut = error?.name === 'AbortError';
        if (timedOut) {
            error.code = 'ARK_TIMEOUT';
            error.retryable = true;
        }
        if (error?.name === 'TypeError' && !error?.code) {
            error.code = 'ARK_CONNECTION_ERROR';
            error.retryable = true;
        }
        if (!error.providerRequestId)
            error.providerRequestId = String(error?.request_id || error?.requestId || String(error?.message || '').match(/Request id:\s*([^\s,]+)/i)?.[1] || '');
        (0, audit_1.monitor)('shared/ark', timedOut ? 'ARK_REQUEST_TIMEOUT' : 'ARK_REQUEST_FAILED', { taskId: options.taskId, tier, logicalPass, transportAttempt, stage: options.stage || null, apiMode, endpointPath, jsonMode, durationMs: Date.now() - startedAt, httpStatus: error?.status || null, responseLength: raw.length, errorCode: error?.code || 'ARK_REQUEST_FAILED', providerRequestId: error?.providerRequestId || null, errorMessage: error?.message, promptChars, imageCount, requestTimeoutMs: timeoutMs, configuredMaxTokens, effectiveMaxTokens, completionTokens: Number(payload?.usage?.output_tokens || payload?.usage?.completion_tokens || 0), finishReason: apiMode === 'responses' ? payload?.status : payload?.choices?.[0]?.finish_reason || null, questionCount: null, jsonParseSuccess: false, retryable: error?.retryable !== false }, true);
    }
    await context_1.db.collection(constants_1.C.ai).add({ data: {
            invocationId,
            taskId: options.taskId,
            tier,
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
