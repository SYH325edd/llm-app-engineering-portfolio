"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.narrationUserPrompt = narrationUserPrompt;
exports.answerExtractionUserPrompt = answerExtractionUserPrompt;
exports.gradeUserPrompt = gradeUserPrompt;
exports.hardProblemUserPrompt = hardProblemUserPrompt;
exports.carelessTrainingUserPrompt = carelessTrainingUserPrompt;
exports.calculationCarelessTrainingUserPrompt = calculationCarelessTrainingUserPrompt;
function json(value) { return JSON.stringify(value); }
function replaceAll(template, variables) {
    return Object.entries(variables).reduce((result, [key, value]) => result.split(`{{${key}}}`).join(value), template);
}
function narrationUserPrompt(strategy, input) {
    return replaceAll(strategy.prompts.narration.userTemplate, { NARRATION_INPUT_JSON: json(input) });
}
function answerExtractionUserPrompt(strategy) { return strategy.prompts.answerExtraction.userTemplate; }
function gradeUserPrompt(strategy, meta) {
    return replaceAll(strategy.prompts.grade.userTemplate, { META_JSON: json(meta) });
}
function hardProblemUserPrompt(strategy, meta) {
    return replaceAll(strategy.prompts.hardProblem.userTemplate, {
        META_JSON: json(meta), STUDENT_IMAGE_COUNT: String(Number(meta?.studentImageCount || 0)), ANSWER_IMAGE_COUNT: String(Number(meta?.answerImageCount || 0)),
    });
}
function carelessTrainingUserPrompt(strategy, meta) {
    const repair = Array.isArray(meta?.repairMissingFields) && meta.repairMissingFields.length
        ? `\n这是一次结构修复：请基于同一批图片重新返回完整三格 JSON，并特别补齐以下缺失字段：${meta.repairMissingFields.join(', ')}。`
        : '';
    return replaceAll(strategy.prompts.carelessTraining.userTemplate, { META_JSON: json(meta), REPAIR_INSTRUCTION: repair });
}
function calculationCarelessTrainingUserPrompt(strategy, meta) {
    return replaceAll(strategy.prompts.calculationCarelessTraining.userTemplate, { META_JSON: json(meta) });
}
