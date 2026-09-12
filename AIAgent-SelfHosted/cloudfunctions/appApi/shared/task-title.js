"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.automaticTaskTitle = automaticTaskTitle;
exports.automaticTaskTitleForDateKey = automaticTaskTitleForDateKey;
const utils_1 = require("./utils");
function automaticTaskTitle(createdAt, ordinal) {
    return automaticTaskTitleForDateKey((0, utils_1.shanghaiDateKey)(createdAt), ordinal);
}
function automaticTaskTitleForDateKey(dateKey, ordinal) {
    const [, month, day] = String(dateKey || '').split('-');
    return `${Number(month)}月${Number(day)}日第${Math.max(1, ordinal)}次作业`;
}
