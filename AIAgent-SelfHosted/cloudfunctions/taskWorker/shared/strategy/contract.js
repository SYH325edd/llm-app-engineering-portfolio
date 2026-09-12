"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertStrategyBundle = assertStrategyBundle;
const outputSchemaValidator = require('../output-schema-validator');
const { getModelRuntimeStage } = require('../model-runtime');
function assertStrategyBundle(value) {
    if (!value || typeof value !== 'object')
        throw Object.assign(new Error('策略包为空'), { code: 'STRATEGY_INVALID' });
    if (!String(value.strategyVersion || '').trim())
        throw Object.assign(new Error('策略版本缺失'), { code: 'STRATEGY_INVALID' });
    outputSchemaValidator.assertStrategyCompatibility(value);
    if (value.modelRuntimeContractVersion !== 'model-runtime.v1')
        throw Object.assign(new Error('不支持的模型运行时契约'), { code: 'UNSUPPORTED_MODEL_RUNTIME_CONTRACT' });
    if (value?.modelOutputRepairPolicy?.version !== 'model-output-repair.v1')
        throw Object.assign(new Error('模型结构修复策略无效'), { code: 'INVALID_MODEL_OUTPUT_REPAIR_POLICY' });
    const stageSchemas = {
        hardProblemPrimary: 'hard-problem.v2', hardProblemReview: 'hard-problem.v2',
        readingCarelessPrimary: 'reading-careless.v2', readingCarelessReview: 'reading-careless.v2',
        calculationCarelessPrimary: 'calculation-careless.v2', calculationCarelessReview: 'calculation-careless.v2'
    };
    for (const [stage, outputSchemaVersion] of Object.entries(stageSchemas)) {
        const config = getModelRuntimeStage(value, stage);
        if (!config || config.outputSchemaVersion !== outputSchemaVersion || !['lite', 'mini'].includes(config.modelTier)
            || !Number.isFinite(Number(config.temperature)) || !Number.isInteger(Number(config.maxOutputTokens)) || Number(config.maxOutputTokens) <= 0
            || !Number.isInteger(Number(config.timeoutMs)) || Number(config.timeoutMs) <= 0 || ![0, 1, 2].includes(Number(config.maxRepairAttempts))
            || config.reviewPayloadMode !== 'compact') {
            throw Object.assign(new Error(`模型运行时配置无效: ${stage}`), { code: 'INVALID_MODEL_RUNTIME_CONFIG', requestStage: stage });
        }
        if (!['none', 'json_object'].includes(config.structuredOutputMode))
            throw Object.assign(new Error(`不支持的结构化输出模式: ${stage}`), { code: 'UNSUPPORTED_STRUCTURED_OUTPUT_MODE', requestStage: stage });
    }
    for (const key of ['narration', 'answerExtraction', 'grade', 'hardProblem', 'carelessTraining', 'calculationCarelessTraining']) {
        if (!String(value?.prompts?.[key]?.system || '').trim() || !String(value?.prompts?.[key]?.userTemplate || '').trim()) {
            throw Object.assign(new Error(`策略 Prompt 缺失: ${key}`), { code: 'STRATEGY_INVALID' });
        }
    }
    if (!Number.isFinite(Number(value?.models?.grading?.timeoutMs)))
        throw Object.assign(new Error('策略模型参数缺失'), { code: 'STRATEGY_INVALID' });
    if (!Array.isArray(value?.reviewRules?.hardProblem?.correctStepStatuses))
        throw Object.assign(new Error('策略复核规则缺失'), { code: 'STRATEGY_INVALID' });
}
