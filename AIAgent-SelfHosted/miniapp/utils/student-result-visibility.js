"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.studentResultVisibilityMode = studentResultVisibilityMode;
exports.shouldHideStudentResult = shouldHideStudentResult;
exports.isCurrentStudentResultHidden = isCurrentStudentResultHidden;
exports.resolveCurrentStudentResultHidden = resolveCurrentStudentResultHidden;
exports.resolveStudentTaskRoute = resolveStudentTaskRoute;
exports.resultNoticeUrl = resultNoticeUrl;
exports.uploadedNoticeUrl = uploadedNoticeUrl;
function currentSnapshot() {
    var _a;
    var app = typeof getApp === 'function' ? getApp() : null;
    return ((_a = app === null || app === void 0 ? void 0 : app.globalData) === null || _a === void 0 ? void 0 : _a.authSnapshot) || null;
}
function studentResultVisibilityMode(snapshot) {
    var _a;
    return String((_a = snapshot === null || snapshot === void 0 ? void 0 : snapshot.clientConfig) === null || _a === void 0 ? void 0 : _a.studentResultVisibility) === 'visible' ? 'visible' : 'hidden';
}
function shouldHideStudentResult(snapshot, fallbackUser) {
    var user = fallbackUser || (snapshot === null || snapshot === void 0 ? void 0 : snapshot.user) || null;
    return studentResultVisibilityMode(snapshot) === 'hidden'
        && (user === null || user === void 0 ? void 0 : user.role) === 'student'
        && (user === null || user === void 0 ? void 0 : user.reviewMode) !== true
        && (user === null || user === void 0 ? void 0 : user.reviewOnly) !== true;
}
function isCurrentStudentResultHidden(fallbackUser) {
    return shouldHideStudentResult(currentSnapshot(), fallbackUser);
}
function resolveCurrentStudentResultHidden(fallbackUser) {
    var app = typeof getApp === 'function' ? getApp() : null;
    if (!app || typeof app.bootstrap !== 'function')
        return Promise.resolve(isCurrentStudentResultHidden(fallbackUser));
    var snapshot = app.globalData && app.globalData.authSnapshot;
    return Promise.resolve(snapshot || app.bootstrap()).then(function (resolved) { return shouldHideStudentResult(resolved, fallbackUser); });
}
function resultNoticeUrl(taskId) {
    var query = taskId ? "&taskId=".concat(encodeURIComponent(String(taskId))) : '';
    return "/pages/result/notice/index?mode=result_hidden".concat(query);
}
function uploadedNoticeUrl(data) {
    var value = data || {};
    var params = [
        ['mode', 'uploaded'],
        ['taskId', value.taskId],
        ['taskDateKey', value.taskDateKey],
        ['dailySequence', value.dailySequence],
        ['createdAt', value.createdAt],
    ].filter(function (item) { return item[1] !== undefined && item[1] !== null && String(item[1]) !== ''; })
        .map(function (item) { return "".concat(item[0], "=").concat(encodeURIComponent(String(item[1]))); });
    return "/pages/result/notice/index?".concat(params.join('&'));
}
function resolveStudentTaskRoute(task, hidden) {
    var value = task || {};
    var taskId = String(value.taskId || value._id || value.id || '').trim();
    if (!taskId)
        return '';
    var status = String(value.status || '').toUpperCase();
    if (status === 'NEED_CONFIRMATION' || status === 'NEED_ANSWER')
        return "/pages/task/confirm/index?taskId=".concat(encodeURIComponent(taskId));
    if (hidden)
        return resultNoticeUrl(taskId);
    return status === 'COMPLETED'
        ? "/pages/result/detail/index?taskId=".concat(encodeURIComponent(taskId))
        : "/pages/task/processing/index?taskId=".concat(encodeURIComponent(taskId));
}
