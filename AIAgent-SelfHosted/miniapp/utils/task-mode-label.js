"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTaskModeLabel = getTaskModeLabel;
exports.withTaskModeLabel = withTaskModeLabel;
function getTaskModeLabel(mode, carelessTrainingType) {
    if (String(mode || '') === 'HARD_PROBLEM_CHECK')
        return '难题检测';
    if (String(mode || '') !== 'CARELESS_TRAINING')
        return '';
    return String(carelessTrainingType || '') === 'CALCULATION' ? '马虎训练－计算马虎' : '马虎训练－审题马虎';
}
function withTaskModeLabel(task) {
    var taskModeLabel = getTaskModeLabel(task === null || task === void 0 ? void 0 : task.mode, task === null || task === void 0 ? void 0 : task.carelessTrainingType);
    var displayTitle = String((task === null || task === void 0 ? void 0 : task.displayTitle) || (task === null || task === void 0 ? void 0 : task.title) || '').trim();
    return __assign(__assign({}, task), { taskModeLabel: taskModeLabel, displayTitle: String((task === null || task === void 0 ? void 0 : task.mode) || '') === 'CARELESS_TRAINING' ? "".concat(displayTitle, " \u00B7 ").concat(taskModeLabel) : displayTitle });
}
