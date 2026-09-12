"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var cloud_1 = require("../../../services/cloud");
var upload_1 = require("../../../services/upload");
var student_result_visibility_1 = require("../../../utils/student-result-visibility");
var fallbackMessage = '系统未能稳定识别标准答案，请输入正确答案或上传清晰的答案图片。';
var confirmationItems = function (payload, referenceAnswers) {
    var references = Array.isArray(referenceAnswers) ? referenceAnswers : [];
    var mapItem = function (item, type) {
        var sourceKey = String((item === null || item === void 0 ? void 0 : item.sourceKey) || (item === null || item === void 0 ? void 0 : item.questionText) || '').trim();
        var reference = references.find(function (answer) { return String((answer === null || answer === void 0 ? void 0 : answer.sourceKey) || '').trim() === sourceKey; }) || {};
        return {
            type: type,
            sourceKey: sourceKey || '未标识题目',
            reason: String((item === null || item === void 0 ? void 0 : item.reason) || '').trim() || fallbackMessage,
            recognizedAnswer: String((reference === null || reference === void 0 ? void 0 : reference.answer) || (item === null || item === void 0 ? void 0 : item.answer) || '').trim(),
            suggestion: '请核对该题标准答案，填写正确文字答案或上传清晰答案图片。',
        };
    };
    var conflicts = Array.isArray(payload === null || payload === void 0 ? void 0 : payload.answerConflicts) ? payload.answerConflicts.map(function (item) { return mapItem(item, '答案冲突'); }) : [];
    var unmatched = Array.isArray(payload === null || payload === void 0 ? void 0 : payload.unmatchedQuestions) ? payload.unmatchedQuestions.map(function (item) { return mapItem(item, '题目未匹配'); }) : [];
    return __spreadArray(__spreadArray([], __read(conflicts), false), __read(unmatched), false);
};
Page({
    data: {
        taskId: '',
        task: {},
        confirmationItems: [],
        manualAnswer: '',
        answerPaths: [],
        keptFileIds: [],
        existingAnswerImages: [],
        loading: false,
        canSubmit: false,
    },
    onLoad: function (query) {
        return __awaiter(this, void 0, void 0, function () {
            var taskId, response, task, keptFileIds, answerImages_1, existingAnswerImages, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        taskId = String(query.taskId || '');
                        if (!taskId) {
                            wx.showModal({ title: '无法打开', content: '缺少任务编号', showCancel: false });
                            return [2 /*return*/];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 5, , 6]);
                        return [4 /*yield*/, (0, cloud_1.call)('getTask', { taskId: taskId })];
                    case 2:
                        response = _a.sent();
                        task = (response === null || response === void 0 ? void 0 : response.task) || response || {};
                        if (!(task.mode === 'CARELESS_TRAINING')) return [3 /*break*/, 4];
                        return [4 /*yield*/, (0, cloud_1.call)('resumeCarelessTraining', { taskId: taskId })];
                    case 3:
                        _a.sent();
                        wx.redirectTo({ url: (0, student_result_visibility_1.isCurrentStudentResultHidden)()
                                ? (0, student_result_visibility_1.uploadedNoticeUrl)({ taskId: taskId, createdAt: task.createdAt })
                                : "/pages/task/processing/index?taskId=".concat(encodeURIComponent(taskId)) });
                        return [2 /*return*/];
                    case 4:
                        keptFileIds = Array.isArray(task.answerImageFileIds) ? task.answerImageFileIds : [];
                        answerImages_1 = Array.isArray(task.answerImages) ? task.answerImages : [];
                        existingAnswerImages = keptFileIds.map(function (fileId) { return answerImages_1.find(function (image) { return image.fileId === fileId; }) || { fileId: fileId, tempUrl: '' }; });
                        this.setData({ taskId: taskId, task: task, confirmationItems: confirmationItems(task.confirmationPayload, task.referenceAnswers), manualAnswer: String(task.manualAnswer || ''), keptFileIds: keptFileIds, existingAnswerImages: existingAnswerImages });
                        this.syncAnswerState();
                        return [3 /*break*/, 6];
                    case 5:
                        error_1 = _a.sent();
                        wx.showModal({ title: '加载失败', content: String((error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || '无法读取任务确认信息'), showCancel: false });
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
    syncAnswerState: function () { this.setData({ canSubmit: Boolean(this.data.manualAnswer.trim() || this.data.keptFileIds.length || this.data.answerPaths.length) }); },
    set: function (e) { this.setData({ manualAnswer: e.detail.value }); this.syncAnswerState(); },
    add: function () {
        return __awaiter(this, void 0, void 0, function () {
            var remaining, privacyDialog, result, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        remaining = Math.max(0, 3 - this.data.keptFileIds.length - this.data.answerPaths.length);
                        if (!remaining) {
                            wx.showToast({ title: '最多保留3张答案图片', icon: 'none' });
                            return [2 /*return*/];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 5, , 6]);
                        privacyDialog = this.selectComponent('#privacyDialog');
                        if (!(privacyDialog === null || privacyDialog === void 0 ? void 0 : privacyDialog.requestAuthorization)) return [3 /*break*/, 3];
                        return [4 /*yield*/, privacyDialog.requestAuthorization()];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3: return [4 /*yield*/, wx.chooseMedia({ count: remaining, mediaType: ['image'], sourceType: ['album', 'camera'] })];
                    case 4:
                        result = _a.sent();
                        this.setData({ answerPaths: __spreadArray(__spreadArray([], __read(this.data.answerPaths), false), __read(result.tempFiles.map(function (item) { return item.tempFilePath; })), false) });
                        this.syncAnswerState();
                        return [3 /*break*/, 6];
                    case 5:
                        error_2 = _a.sent();
                        if (String((error_2 === null || error_2 === void 0 ? void 0 : error_2.errMsg) || '').indexOf('cancel') < 0)
                            wx.showToast({ title: '选择图片失败', icon: 'none' });
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
    previewOld: function (e) { var url = String(e.currentTarget.dataset.url || ''); if (url)
        wx.previewImage({ current: url, urls: this.data.existingAnswerImages.map(function (item) { return item.tempUrl; }).filter(Boolean) }); },
    previewNew: function (e) { var url = String(e.currentTarget.dataset.url || ''); if (url)
        wx.previewImage({ current: url, urls: this.data.answerPaths }); },
    removeOld: function (e) {
        var index = Number(e.currentTarget.dataset.i);
        this.setData({ keptFileIds: this.data.keptFileIds.filter(function (_, itemIndex) { return itemIndex !== index; }), existingAnswerImages: this.data.existingAnswerImages.filter(function (_, itemIndex) { return itemIndex !== index; }) });
        this.syncAnswerState();
    },
    removeNew: function (e) {
        var index = Number(e.currentTarget.dataset.i);
        this.setData({ answerPaths: this.data.answerPaths.filter(function (_, itemIndex) { return itemIndex !== index; }) });
        this.syncAnswerState();
    },
    submit: function () {
        return __awaiter(this, void 0, void 0, function () {
            var newIds, _a, answerImageFileIds, manualAnswer, answerMode, updated, refreshed, task_1, error_3;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (this.data.loading)
                            return [2 /*return*/];
                        if (!this.data.canSubmit) {
                            wx.showToast({ title: '请填写正确答案或上传答案图片', icon: 'none' });
                            return [2 /*return*/];
                        }
                        this.setData({ loading: true });
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 7, 8, 9]);
                        if (!this.data.answerPaths.length) return [3 /*break*/, 3];
                        return [4 /*yield*/, (0, upload_1.uploadImages)(this.data.answerPaths, 'answer')];
                    case 2:
                        _a = _b.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _a = [];
                        _b.label = 4;
                    case 4:
                        newIds = _a;
                        answerImageFileIds = __spreadArray(__spreadArray([], __read(this.data.keptFileIds), false), __read(newIds), false);
                        manualAnswer = this.data.manualAnswer.trim();
                        answerMode = manualAnswer && answerImageFileIds.length ? 'mixed' : manualAnswer ? 'manual' : 'image';
                        return [4 /*yield*/, (0, cloud_1.call)('updateTaskAnswers', { taskId: this.data.taskId, manualAnswer: manualAnswer, answerImageFileIds: answerImageFileIds, answerMode: answerMode, confirmation: { resolvedAt: Date.now(), source: 'student_confirmation' } }, 30000)];
                    case 5:
                        updated = _b.sent();
                        if ((updated === null || updated === void 0 ? void 0 : updated.status) !== 'QUEUED')
                            throw new Error('任务答案未成功更新，请重试');
                        return [4 /*yield*/, (0, cloud_1.call)('getTask', { taskId: this.data.taskId })];
                    case 6:
                        refreshed = _b.sent();
                        task_1 = (refreshed === null || refreshed === void 0 ? void 0 : refreshed.task) || refreshed || {};
                        if (task_1.status === 'NEED_CONFIRMATION' || String(task_1.manualAnswer || '') !== manualAnswer || !answerImageFileIds.every(function (fileId) { return (task_1.answerImageFileIds || []).includes(fileId); }))
                            throw new Error('任务状态未成功更新，请重试');
                        wx.redirectTo({ url: (0, student_result_visibility_1.isCurrentStudentResultHidden)()
                                ? (0, student_result_visibility_1.uploadedNoticeUrl)({ taskId: this.data.taskId, taskDateKey: task_1.taskDateKey, dailySequence: task_1.dailySequence, createdAt: task_1.createdAt })
                                : "/pages/task/processing/index?taskId=".concat(encodeURIComponent(this.data.taskId)) });
                        return [3 /*break*/, 9];
                    case 7:
                        error_3 = _b.sent();
                        wx.showModal({ title: '更新失败', content: String((error_3 === null || error_3 === void 0 ? void 0 : error_3.message) || '答案未保存，请重试'), showCancel: false });
                        return [3 /*break*/, 9];
                    case 8:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 9: return [2 /*return*/];
                }
            });
        });
    },
});
