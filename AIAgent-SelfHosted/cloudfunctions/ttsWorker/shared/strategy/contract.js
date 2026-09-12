"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertStrategyBundle = assertStrategyBundle;
function assertStrategyBundle(value) {
    if (!value || typeof value !== 'object')
        throw Object.assign(new Error('策略包为空'), { code: 'STRATEGY_INVALID' });
    if (!String(value.strategyVersion || '').trim())
        throw Object.assign(new Error('策略版本缺失'), { code: 'STRATEGY_INVALID' });
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
