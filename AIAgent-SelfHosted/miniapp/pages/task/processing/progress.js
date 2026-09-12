"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAGE_PROGRESS_LIMITS = void 0;
exports.stageProgressLimit = stageProgressLimit;
exports.nextEstimatedProgress = nextEstimatedProgress;
exports.STAGE_PROGRESS_LIMITS = { PREPARING_IMAGES: 15, ANSWER_EXTRACTION: 30, MINI_GRADING: 64, LITE_GRADING: 84, RESULT_VALIDATION: 94, RESULT_SAVING: 99, COMPLETED: 100 };
function stageProgressLimit(stage) { return exports.STAGE_PROGRESS_LIMITS[String(stage || '').toUpperCase()] || 0; }
function nextEstimatedProgress(displayProgress, targetProgress, stage) {
    var limit = stageProgressLimit(stage);
    return displayProgress >= targetProgress && displayProgress < limit ? displayProgress + 1 : displayProgress;
}
