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
exports.decodeTaskTitle = decodeTaskTitle;
exports.withDecodedTaskTitle = withDecodedTaskTitle;
function decodeTaskTitle(value) {
    var title = String(value || '').trim();
    for (var index = 0; index < 2 && /%[0-9A-Fa-f]{2}/.test(title); index += 1) {
        try {
            title = decodeURIComponent(title);
        }
        catch (_a) {
            break;
        }
    }
    return title;
}
function withDecodedTaskTitle(task) {
    return __assign(__assign({}, task), { taskName: decodeTaskTitle(task === null || task === void 0 ? void 0 : task.taskName), title: decodeTaskTitle(task === null || task === void 0 ? void 0 : task.title) });
}
