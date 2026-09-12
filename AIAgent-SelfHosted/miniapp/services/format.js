"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusText = void 0;
var statusText = function (s) { return ({ QUEUED: '排队中', CLAIMED: '准备处理', PROCESSING: '处理中', NEED_CONFIRMATION: '待确认', COMPLETED: '已完成', FAILED: '失败' }[s] || s); };
exports.statusText = statusText;
