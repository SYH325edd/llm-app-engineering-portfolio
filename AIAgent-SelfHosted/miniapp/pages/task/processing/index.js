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
Object.defineProperty(exports, "__esModule", { value: true });
var cloud_1 = require("../../../services/cloud");
var student_result_visibility_1 = require("../../../utils/student-result-visibility");
var MAX_VISIBLE_POLL_MS = 30 * 60 * 1000;
var POLL_INTERVAL_MS = 6000;
var POLLING_STATUSES = ['QUEUED', 'CLAIMED', 'PROCESSING', 'VERIFYING'];
function normalizeErrorMessage(value) {
    if (typeof value === 'string' && /token|stack/i.test(value))
        return '\u6279\u6539\u670d\u52a1\u6682\u65f6\u7e41\u5fd9\uff0c\u8bf7\u7a0d\u540e\u91cd\u65b0\u5c1d\u8bd5\u3002';
    var safe = function (message) { return /InternalServiceError|unexpected internal error|Request id|Ark HTTP|service unavailable/i.test(message) ? '批改服务暂时繁忙，请稍后重新尝试。' : message; };
    if (typeof value === 'string' && value.trim())
        return safe(value);
    if (value && typeof value === 'object') {
        if (typeof value.message === 'string' && value.message.trim())
            return safe(value.message);
        if (typeof value.errorMessage === 'string' && value.errorMessage.trim())
            return safe(value.errorMessage);
    }
    return '批改服务暂时异常，请重新尝试';
}
function getWorkerQueueStatusMessage(status) {
    return {
        PENDING: '\u4efb\u52a1\u5df2\u8fdb\u5165\u961f\u5217\uff0c\u6b63\u5728\u7b49\u5f85\u6279\u6539',
        DISPATCHED: '\u4efb\u52a1\u6b63\u5728\u5206\u914d\u5904\u7406',
        RUNNING: 'AI\u6b63\u5728\u6279\u6539\uff0c\u8bf7\u7a0d\u5019',
        CANCELLED: '\u4efb\u52a1\u5df2\u53d6\u6d88'
    }[status] || '';
}
Page({
    data: {
        taskId: '', targetStudentId: '', viewerMode: '',
        stageText: '', reviewReasonText: '', processingDescription: '正在检查答案、步骤和解题逻辑',
        targetProgress: 0,
        displayProgress: 0,
        statusMessage: '任务已进入队列',
        errorMessage: '',
        errorSuggestion: '', failureId: '', retryable: true, failureCategory: '',
        task: { status: 'QUEUED', statusMessage: '任务排队中', progress: 0, errorMessage: '' },
        timer: null,
        polling: false,
        consecutiveErrors: 0,
        pollStartedAt: 0,
        pausedMessage: '',
        redirecting: false, carelessResumeAttempted: false,
        hasLoadedTask: false,
        homeworkImages: [], answerImages: [],
    },
    completionTimer: null,
    active: false,
    pollGeneration: 0,
    onLoad: function (query) {
        var taskId = String(query.taskId || '');
        var viewerMode = String(query.viewerMode || '') === 'teacher' ? 'teacher' : '';
        var targetStudentId = viewerMode ? String(query.targetStudentId || '').trim() : '';
        this.resetProgress();
        this.setData({ taskId: taskId, viewerMode: viewerMode, targetStudentId: targetStudentId, pollStartedAt: Date.now() });
        if (!taskId)
            wx.showModal({ title: '无法打开', content: '缺少任务编号', showCancel: false });
    },
    onShow: function () {
        var _a;
        this.active = true;
        if (this.data.viewerMode === 'teacher' || typeof getApp !== 'function') {
            this.resumeVisiblePolling();
            return;
        }
        var app = getApp();
        var snapshot = (_a = app === null || app === void 0 ? void 0 : app.globalData) === null || _a === void 0 ? void 0 : _a.authSnapshot;
        if (snapshot && !(0, student_result_visibility_1.isCurrentStudentResultHidden)()) {
            this.resumeVisiblePolling();
            return;
        }
        void this.openForCurrentUser();
    },
    resumeVisiblePolling: function () {
        if (this.data.timer) {
            clearTimeout(this.data.timer);
            this.setData({ timer: null });
        }
        if (this.data.taskId && !this.data.redirecting && (!this.data.hasLoadedTask || POLLING_STATUSES.includes(String(this.data.task.status || '').toUpperCase()))) {
            if (!this.data.pollStartedAt)
                this.setData({ pollStartedAt: Date.now() });
            this.setData({ pausedMessage: '' });
            void this.poll();
        }
    },
    openForCurrentUser: function () {
        return __awaiter(this, void 0, void 0, function () {
            var hidden, task, status_1, _1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(this.data.viewerMode !== 'teacher')) return [3 /*break*/, 5];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, (0, student_result_visibility_1.resolveCurrentStudentResultHidden)()];
                    case 2:
                        hidden = _a.sent();
                        if (!hidden || !this.data.taskId) return [3 /*break*/, 5];
                        return [4 /*yield*/, (0, cloud_1.getTaskStatus)(this.data.taskId, 15000)];
                    case 3:
                        task = _a.sent();
                        status_1 = String((task === null || task === void 0 ? void 0 : task.status) || '').toUpperCase();
                        this.stop();
                        this.setData({ redirecting: true });
                        wx.redirectTo({ url: status_1 === 'NEED_CONFIRMATION' || status_1 === 'NEED_ANSWER'
                                ? "/pages/task/confirm/index?taskId=".concat(encodeURIComponent(this.data.taskId))
                                : (0, student_result_visibility_1.resultNoticeUrl)(this.data.taskId) });
                        return [2 /*return*/];
                    case 4:
                        _1 = _a.sent();
                        return [3 /*break*/, 5];
                    case 5:
                        this.resumeVisiblePolling();
                        return [2 /*return*/];
                }
            });
        });
    },
    onHide: function () { this.active = false; this.stop(); },
    onUnload: function () { this.active = false; this.stop(); },
    stop: function () {
        this.pollGeneration += 1;
        if (this.data.timer)
            clearTimeout(this.data.timer);
        if (this.completionTimer)
            clearInterval(this.completionTimer);
        this.completionTimer = null;
        this.setData({ timer: null, polling: false });
    },
    schedule: function (delay) {
        var _this = this;
        if (!this.active || this.data.polling || this.data.redirecting || !this.data.taskId || !POLLING_STATUSES.includes(String(this.data.task.status || '').toUpperCase()))
            return;
        if (this.data.timer)
            clearTimeout(this.data.timer);
        var timer = setTimeout(function () { return void _this.poll(); }, delay);
        this.setData({ timer: timer });
    },
    resetProgress: function () {
        this.setData({ targetProgress: 0, displayProgress: 0 });
    },
    updateProgress: function (task, status) {
        var serverProgress = Math.max(0, Math.min(100, Number(task.progress || 0)));
        var progress = status === 'COMPLETED' && Boolean(task.resultId) ? 100 : serverProgress;
        var labels = task.mode === 'CARELESS_TRAINING' ? { PREPARING_IMAGES: '正在准备题目与三格总结图片', PRIMARY_GRADING: '正在识别题目和三格内容', REVIEW_GRADING: '正在复核三格识别结果', FINALIZING_RESULT: '正在生成三格分析结果', RESULT_READY: '三格分析结果已生成', COMPLETED: '三格分析完成' } : { PREPARING_IMAGES: '正在准备作业图片', PRIMARY_GRADING: '正在识别题目并进行首次批改', REVIEW_GRADING: '正在整图复核', FINALIZING_RESULT: '正在生成最终批改结果', RESULT_READY: '文字批改结果已生成', NARRATION_GENERATING: '正在生成语音讲解内容', TTS_GENERATING: '正在合成语音', COMPLETED: '批改完成' };
        var reasons = { incorrect_answer: '发现错题，需要再次核对', careless_detected: '检测到可能存在马虎问题', low_confidence: '部分题目判断置信度不足', image_quality: '部分图片内容需要进一步确认', answer_conflict: '题目或答案识别存在冲突', unmatched_question: '部分题目未能稳定匹配', step_uncertain: '部分解题步骤需要进一步核对' };
        var reviewReasonText = Array.isArray(task.reviewReason) ? task.reviewReason.map(function (x) { return reasons[x] || '部分批改内容需要进一步核对'; }).join('；') : '';
        var modeDescription = task.mode === 'CARELESS_TRAINING' ? '正在检查条件、关系和所求' : '正在检查答案、步骤和解题逻辑';
        this.setData({ targetProgress: progress, displayProgress: progress, stageText: labels[String(task.currentStage || '')] || task.statusMessage || '', reviewReasonText: reviewReasonText, processingDescription: task.statusMessage || modeDescription });
    },
    taskViewerParams: function () {
        return this.data.viewerMode === 'teacher' ? { viewerMode: 'teacher', targetStudentId: this.data.targetStudentId } : {};
    },
    loadFailedTaskImages: function () {
        var _this = this;
        return __awaiter(this, void 0, void 0, function () {
            var generation, fullResponse, fullTask, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.viewerMode !== 'teacher' || !this.data.taskId)
                            return [2 /*return*/];
                        generation = this.pollGeneration;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, (0, cloud_1.call)('getTask', Object.assign({ taskId: this.data.taskId }, this.taskViewerParams()), 15000)];
                    case 2:
                        fullResponse = _a.sent();
                        if (!this.active || this.data.redirecting || generation !== this.pollGeneration)
                            return [2 /*return*/];
                        fullTask = (fullResponse === null || fullResponse === void 0 ? void 0 : fullResponse.task) || fullResponse || {};
                        this.setData({ task: Object.assign({}, this.data.task, fullTask), homeworkImages: Array.isArray(fullTask.homeworkImages) ? fullTask.homeworkImages : [], answerImages: Array.isArray(fullTask.answerImages) ? fullTask.answerImages : [], errorMessage: normalizeErrorMessage(fullTask.errorMessage || this.data.errorMessage), errorSuggestion: fullTask.errorSuggestion || this.data.errorSuggestion, failureId: fullTask.failureId || this.data.failureId, retryable: fullTask.retryable !== false, failureCategory: fullTask.failureCategory || this.data.failureCategory });
                        return [3 /*break*/, 4];
                    case 3:
                        error_2 = _a.sent();
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    },
    finishCompleted: function (task) {
        this.stop();
        this.setData({ redirecting: true });
        var taskId = encodeURIComponent(String(task.taskId || task._id || this.data.taskId));
        var viewerQuery = this.data.viewerMode === 'teacher' ? "&viewerMode=teacher&targetStudentId=".concat(encodeURIComponent(this.data.targetStudentId)) : '';
        wx.redirectTo({ url: "/pages/result/detail/index?taskId=".concat(taskId).concat(viewerQuery) });
    },
    poll: function () {
        var _this = this;
        return __awaiter(this, void 0, void 0, function () {
            var response, task, status_1, workerQueueStatus, resultReady, _a, error_1, consecutiveErrors, pollGeneration;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!this.active || this.data.polling || this.data.redirecting || !this.data.taskId || (this.data.hasLoadedTask && !POLLING_STATUSES.includes(String(this.data.task.status || '').toUpperCase())))
                            return [2 /*return*/];
                        if (this.data.pollStartedAt && Date.now() - this.data.pollStartedAt > MAX_VISIBLE_POLL_MS) {
                            this.stop();
                            this.setData({ pausedMessage: '任务仍在后台处理。为减少请求，页面已暂停自动刷新，可稍后在历史记录中查看。' });
                            return [2 /*return*/];
                        }
                        pollGeneration = this.pollGeneration;
                        this.setData({ polling: true, timer: null });
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 9, , 10]);
                        return [4 /*yield*/, (0, cloud_1.getTaskStatus)(this.data.taskId, 15000, this.taskViewerParams())];
                    case 2:
                        response = _b.sent();
                        if (!this.active || this.data.redirecting || pollGeneration !== this.pollGeneration)
                            return [2 /*return*/];
                        task = (response === null || response === void 0 ? void 0 : response.task) || response;
                        status_1 = String((task === null || task === void 0 ? void 0 : task.status) || '').toUpperCase();
                        workerQueueStatus = String((task === null || task === void 0 ? void 0 : task.workerQueueStatus) || '').toUpperCase();
                        resultReady = status_1 === 'COMPLETED';
                        this.setData({ task: task, statusMessage: task.statusMessage || '任务处理中', errorMessage: normalizeErrorMessage(task.errorMessage || task.errorDetail), errorSuggestion: task.errorSuggestion || '', failureId: task.failureId || '', retryable: task.retryable !== false, failureCategory: task.failureCategory || '', consecutiveErrors: 0 });
                        this.setData({ task: ['FAILED', 'CANCELLED'].includes(workerQueueStatus) ? Object.assign({}, task, { status: workerQueueStatus }) : task, statusMessage: getWorkerQueueStatusMessage(workerQueueStatus) || task.statusMessage || this.data.statusMessage, hasLoadedTask: true });
                        this.updateProgress(task, status_1);
                        if (resultReady) {
                            this.stop();
                            var completionGeneration_1 = this.pollGeneration;
                            void (0, cloud_1.call)('getTask', Object.assign({ taskId: _this.data.taskId }, _this.taskViewerParams()), 15000).then(function (fullResponse) {
                                if (!_this.active || _this.data.redirecting || completionGeneration_1 !== _this.pollGeneration)
                                    return;
                                var fullTask = (fullResponse === null || fullResponse === void 0 ? void 0 : fullResponse.task) || fullResponse;
                                if (String((fullTask === null || fullTask === void 0 ? void 0 : fullTask.status) || '').toUpperCase() === 'COMPLETED' && Boolean(fullTask === null || fullTask === void 0 ? void 0 : fullTask.resultId))
                                    _this.finishCompleted(fullTask);
                            });
                            return [2 /*return*/];
                        }
                        if (!(task.mode === 'CARELESS_TRAINING' && status_1 === 'NEED_CONFIRMATION' && task.legacyCarelessResumeAllowed === true)) return [3 /*break*/, 8];
                        if (!!this.data.carelessResumeAttempted) return [3 /*break*/, 7];
                        this.setData({ carelessResumeAttempted: true, polling: false, statusMessage: '正在恢复三格识别' });
                        _b.label = 3;
                    case 3:
                        _b.trys.push([3, 5, , 6]);
                        return [4 /*yield*/, (0, cloud_1.call)('resumeCarelessTraining', { taskId: this.data.taskId }, 15000)];
                    case 4:
                        _b.sent();
                        return [3 /*break*/, 6];
                    case 5:
                        _a = _b.sent();
                        return [3 /*break*/, 6];
                    case 6:
                        this.schedule(0);
                        return [2 /*return*/];
                    case 7:
                        this.setData({ polling: false });
                        this.schedule(POLL_INTERVAL_MS);
                        return [2 /*return*/];
                    case 8:
                        if (task.mode === 'CARELESS_TRAINING' && status_1 === 'NEED_CONFIRMATION') {
                            this.stop();
                            this.setData({ statusMessage: '任务状态异常，请重新提交', errorMessage: '任务状态异常，请重新提交' });
                            return [2 /*return*/];
                        }
                        if (status_1 === 'NEED_CONFIRMATION' || status_1 === 'NEED_ANSWER') {
                            this.stop();
                            wx.redirectTo({ url: "/pages/task/confirm/index?taskId=".concat(encodeURIComponent(String(task.taskId || task._id || this.data.taskId))) });
                            return [2 /*return*/];
                        }
                        if (status_1 === 'FAILED' || status_1 === 'CANCELLED' || workerQueueStatus === 'FAILED' || workerQueueStatus === 'CANCELLED') {
                            this.stop();
                            if (status_1 === 'FAILED' && this.data.viewerMode === 'teacher')
                                void this.loadFailedTaskImages();
                            return [2 /*return*/];
                        }
                        this.setData({ polling: false });
                        if (POLLING_STATUSES.includes(status_1))
                            this.schedule(POLL_INTERVAL_MS);
                        return [3 /*break*/, 10];
                    case 9:
                        error_1 = _b.sent();
                        consecutiveErrors = this.data.consecutiveErrors + 1;
                        this.setData({ polling: false, consecutiveErrors: consecutiveErrors });
                        if (!this.active || this.data.redirecting || pollGeneration !== this.pollGeneration || (this.data.hasLoadedTask && !POLLING_STATUSES.includes(String(this.data.task.status || '').toUpperCase())))
                            return [2 /*return*/];
                        if (['FORBIDDEN', 'TASK_NOT_FOUND'].includes(String((error_1 === null || error_1 === void 0 ? void 0 : error_1.code) || ''))) {
                            this.stop();
                            this.setData({ task: Object.assign({}, this.data.task, { status: 'FAILED' }), statusMessage: '任务加载失败', errorMessage: normalizeErrorMessage(error_1), errorSuggestion: '', hasLoadedTask: true });
                            return [2 /*return*/];
                        }
                        if (consecutiveErrors >= 5)
                            wx.showToast({ title: '网络不稳定，稍后继续刷新', icon: 'none' });
                        this.schedule(POLL_INTERVAL_MS);
                        return [3 /*break*/, 10];
                    case 10: return [2 /*return*/];
                }
            });
        });
    },
    resume: function () {
        this.setData({ pollStartedAt: Date.now(), pausedMessage: '' });
        void this.poll();
    },
    retry: function () {
        return __awaiter(this, void 0, void 0, function () {
            var error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, (0, cloud_1.call)('retryTask', { taskId: this.data.taskId }, 15000)];
                    case 1:
                        _a.sent();
                        this.setData({ pollStartedAt: Date.now(), errorMessage: '', errorSuggestion: '', statusMessage: '正在继续批改' });
                        void this.poll();
                        return [3 /*break*/, 3];
                    case 2:
                        error_2 = _a.sent();
                        wx.showToast({ title: normalizeErrorMessage(error_2), icon: 'none' });
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    },
    previewImage: function (e) {
        var images = e.currentTarget.dataset.type === 'answer' ? this.data.answerImages : this.data.homeworkImages;
        var urls = images.filter(function (item) { return item.tempUrl && !item.loadFailed; }).map(function (item) { return item.tempUrl; });
        var current = String(e.currentTarget.dataset.url || '');
        if (current && urls.includes(current))
            wx.previewImage({ current: current, urls: urls });
    },
    onImageError: function (e) {
        var _a;
        var key = e.currentTarget.dataset.type === 'answer' ? 'answerImages' : 'homeworkImages';
        this.setData((_a = {}, _a["".concat(key, "[").concat(Number(e.currentTarget.dataset.index), "].loadFailed")] = true, _a));
    },
    history: function () { wx.switchTab({ url: '/pages/history/index' }); },
});
