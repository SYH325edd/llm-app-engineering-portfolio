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
var cloud_1 = require("../../services/cloud");
var result_view_1 = require("./result-view");
var grading_summary_1 = require("./grading-summary");
var task_title_1 = require("../../utils/task-title");
var manager_view_1 = require("../../utils/manager-view");
var custom_tab_bar_1 = require("../../utils/custom-tab-bar");
var student_result_visibility_1 = require("../../utils/student-result-visibility");
var V2_RESULT_SCHEMAS = new Set(['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2']);
function countValue(value, fallback) {
    if (fallback === void 0) { fallback = 0; }
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function deriveV2Summary(schemaVersion, questions) {
    var source = Array.isArray(questions) ? questions : [];
    var summary = { totalCount: source.length, correctCount: 0, wrongCount: 0, incompleteCount: 0, carelessCount: 0 };
    source.forEach(function (question) {
        if (schemaVersion === 'reading-careless.v2') {
            var status_1 = String((question === null || question === void 0 ? void 0 : question.normalizedStatus) || (question === null || question === void 0 ? void 0 : question.threeGridStatus) || 'UNDETERMINED');
            if (status_1 === 'CORRECT')
                summary.correctCount += 1;
            else if (status_1 === 'WRONG')
                summary.wrongCount += 1;
            else
                summary.incompleteCount += 1;
            return;
        }
        if (schemaVersion === 'calculation-careless.v2') {
            var status_2 = String((question === null || question === void 0 ? void 0 : question.teacherOverrideApplied) === true ? (question === null || question === void 0 ? void 0 : question.teacherOverrideStatus) : ((question === null || question === void 0 ? void 0 : question.normalizedStatus) || (question === null || question === void 0 ? void 0 : question.calculationStatus) || 'UNDETERMINED'));
            if (status_2 === 'CORRECT')
                summary.correctCount += 1;
            else if (status_2 === 'WRONG') {
                if ((question === null || question === void 0 ? void 0 : question.carelessDetected) === true || (question === null || question === void 0 ? void 0 : question.issueCategory) === 'careless')
                    summary.carelessCount += 1;
                else
                    summary.wrongCount += 1;
            }
            else if ((question === null || question === void 0 ? void 0 : question.analysisStatus) !== 'ok' || (question === null || question === void 0 ? void 0 : question.carelessDetected) == null)
                summary.incompleteCount += 1;
            else if ((question === null || question === void 0 ? void 0 : question.carelessDetected) === true)
                summary.carelessCount += 1;
            else if ((question === null || question === void 0 ? void 0 : question.processCorrect) === true && (question === null || question === void 0 ? void 0 : question.finalAnswerCorrect) === true)
                summary.correctCount += 1;
            else
                summary.wrongCount += 1;
            return;
        }
        var status = String((question === null || question === void 0 ? void 0 : question.normalizedStatus) || (question === null || question === void 0 ? void 0 : question.evaluationStatus) || 'UNDETERMINED');
        if (status === 'CORRECT')
            summary.correctCount += 1;
        else if (status === 'WRONG')
            summary.wrongCount += 1;
        else
            summary.incompleteCount += 1;
    });
    return summary;
}
function summaryForResult(result) {
    var schemaVersion = String((result === null || result === void 0 ? void 0 : result.outputSchemaVersion) || '');
    if (!V2_RESULT_SCHEMAS.has(schemaVersion))
        return null;
    var derived = deriveV2Summary(schemaVersion, result === null || result === void 0 ? void 0 : result.questions);
    var source = (result === null || result === void 0 ? void 0 : result.summary) && typeof result.summary === 'object' ? result.summary : {};
    var summary = {
        totalCount: derived.totalCount,
        correctCount: derived.correctCount,
        wrongCount: derived.wrongCount,
        incompleteCount: derived.incompleteCount,
        carelessCount: derived.carelessCount
    };
    summary.unansweredCount = schemaVersion === 'hard-problem.v2' ? (result.questions || []).filter(function (question) { return String((question === null || question === void 0 ? void 0 : question.normalizedStatus) || (question === null || question === void 0 ? void 0 : question.evaluationStatus) || '') === 'UNANSWERED'; }).length : derived.incompleteCount;
    summary.incorrectTotal = derived.wrongCount + derived.carelessCount;
    return summary;
}
Page({
    data: {
        loading: true, switching: false, completedTasks: [], selectedTaskId: '', selectedTaskIndex: 0,
        selectedTask: null, homeworkImages: [], answerImages: [], questions: [], summary: null, displayMode: 'default',
        empty: false, errorMessage: '', studentResultHidden: false,
        isManager: false, managerClasses: [], managerVisible: [], managerKeyword: '', managerLoading: false, managerError: '',
    },
    resultCache: {},
    requestSequence: 0,
    onShow: function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        (0, custom_tab_bar_1.syncCustomTabBar)(this, 'pages/result/index');
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 5, , 6]);
                        _a = manager_view_1.isManagerRole;
                        return [4 /*yield*/, (0, manager_view_1.currentRole)()];
                    case 2:
                        if (!_a.apply(void 0, [_b.sent()])) return [3 /*break*/, 4];
                        this.setData({ isManager: true });
                        return [4 /*yield*/, this.loadManagerClasses()];
                    case 3:
                        _b.sent();
                        return [2 /*return*/];
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        error_1 = _b.sent();
                        this.setData({ loading: false, errorMessage: String((error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || '加载失败') });
                        return [2 /*return*/];
                    case 6:
                        this.setData({ isManager: false, studentResultHidden: (0, student_result_visibility_1.isCurrentStudentResultHidden)() });
                        if (this.data.studentResultHidden) {
                            this.setData({ loading: false, switching: false, errorMessage: '' });
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, this.loadCompletedTasks()];
                    case 7:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    },
    loadManagerClasses: function () {
        return __awaiter(this, void 0, void 0, function () { var response, error_2; return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (this.data.managerLoading)
                        return [2 /*return*/];
                    this.setData({ managerLoading: true, managerError: '' });
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, (0, cloud_1.call)('managerClassStudents', { mode: 'result' })];
                case 2:
                    response = _a.sent();
                    this.setData({ managerClasses: Array.isArray(response === null || response === void 0 ? void 0 : response.students) ? response.students : [] });
                    this.filterManagerClasses();
                    return [3 /*break*/, 5];
                case 3:
                    error_2 = _a.sent();
                    this.setData({ managerError: String((error_2 === null || error_2 === void 0 ? void 0 : error_2.message) || '加载失败') });
                    return [3 /*break*/, 5];
                case 4:
                    this.setData({ managerLoading: false });
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        }); });
    },
    managerSearch: function (e) { this.setData({ managerKeyword: e.detail.value }); this.filterManagerClasses(); },
    filterManagerClasses: function () { var keyword = String(this.data.managerKeyword || '').trim(); this.setData({ managerVisible: this.data.managerClasses.filter(function (item) { return !keyword || String(item.name || '').includes(keyword) || String(item.studentNumber || '').includes(keyword); }) }); },
    openManagerClass: function (e) { var rosterId = String(e.currentTarget.dataset.rosterId || ''); if (rosterId)
        wx.navigateTo({ url: "/pages/teacher/student-tasks/index?mode=result&rosterId=".concat((0, manager_view_1.encoded)(rosterId)) }); },
    loadCompletedTasks: function () {
        return __awaiter(this, void 0, void 0, function () {
            var response, completedTasks, selectedTaskId_1, selectedTaskIndex, error_3;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.loading === false)
                            this.setData({ loading: true });
                        this.setData({ empty: false, errorMessage: '' });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 5, 6, 7]);
                        return [4 /*yield*/, (0, cloud_1.call)('listCompletedTasks')];
                    case 2:
                        response = _a.sent();
                        completedTasks = Array.isArray(response === null || response === void 0 ? void 0 : response.tasks) ? response.tasks.map(function (task) { return (__assign(__assign({}, (0, task_title_1.withDecodedTaskTitle)(task)), { title: String((task === null || task === void 0 ? void 0 : task.displayTitle) || (task === null || task === void 0 ? void 0 : task.title) || '未命名作业') })); }) : [];
                        if (!completedTasks.length) {
                            this.setData({ completedTasks: completedTasks, empty: true });
                            return [2 /*return*/];
                        }
                        selectedTaskId_1 = completedTasks.some(function (task) { return task.taskId === _this.data.selectedTaskId; }) ? this.data.selectedTaskId : completedTasks[0].taskId;
                        selectedTaskIndex = completedTasks.findIndex(function (task) { return task.taskId === selectedTaskId_1; });
                        this.setData({ completedTasks: completedTasks, selectedTaskId: selectedTaskId_1, selectedTaskIndex: selectedTaskIndex, empty: false });
                        if (!(!this.data.selectedTask || this.data.selectedTaskId !== selectedTaskId_1)) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.loadTask(selectedTaskId_1)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4: return [3 /*break*/, 7];
                    case 5:
                        error_3 = _a.sent();
                        this.setData({ errorMessage: String((error_3 === null || error_3 === void 0 ? void 0 : error_3.message) || '批改结果加载失败') });
                        return [3 /*break*/, 7];
                    case 6:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 7: return [2 /*return*/];
                }
            });
        });
    },
    loadTask: function (taskId) {
        return __awaiter(this, void 0, void 0, function () {
            var requestId, cached, response, _a, task, result, summaryTask, questions, error_4;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        requestId = ++this.requestSequence;
                        cached = this.resultCache[taskId];
                        this.setData({ switching: Boolean(this.data.selectedTask) });
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 4, 5, 6]);
                        _a = cached;
                        if (_a) return [3 /*break*/, 3];
                        return [4 /*yield*/, (0, cloud_1.call)('getTask', { taskId: taskId })];
                    case 2:
                        _a = (_b.sent());
                        _b.label = 3;
                    case 3:
                        response = _a;
                        if (requestId !== this.requestSequence || taskId !== this.data.selectedTaskId)
                            return [2 /*return*/];
                        this.resultCache[taskId] = response;
                        task = (response === null || response === void 0 ? void 0 : response.task) || {};
                        result = (response === null || response === void 0 ? void 0 : response.result) || {};
                        summaryTask = this.data.completedTasks.find(function (item) { return item.taskId === taskId; }) || {};
                        questions = (0, result_view_1.mapQuestions)(result.questions);
                        this.setData({ selectedTask: __assign(__assign({}, (0, task_title_1.withDecodedTaskTitle)(__assign(__assign({}, summaryTask), task))), { title: String((task === null || task === void 0 ? void 0 : task.displayTitle) || (summaryTask === null || summaryTask === void 0 ? void 0 : summaryTask.displayTitle) || (task === null || task === void 0 ? void 0 : task.title) || (summaryTask === null || summaryTask === void 0 ? void 0 : summaryTask.title) || '未命名作业') }), homeworkImages: (0, result_view_1.normalizeImages)(task.homeworkImages), answerImages: (0, result_view_1.normalizeImages)(task.answerImages), questions: questions, summary: summaryForResult(result) || (0, grading_summary_1.buildGradingSummary)(questions), displayMode: (result === null || result === void 0 ? void 0 : result.outputSchemaVersion) === 'reading-careless.v2' ? 'reading' : (result === null || result === void 0 ? void 0 : result.outputSchemaVersion) === 'hard-problem.v2' ? 'hard' : (result === null || result === void 0 ? void 0 : result.outputSchemaVersion) === 'calculation-careless.v2' ? 'calculation' : 'default', errorMessage: '' });
                        return [3 /*break*/, 6];
                    case 4:
                        error_4 = _b.sent();
                        if (requestId === this.requestSequence)
                            this.setData({ errorMessage: this.data.selectedTask ? '切换记录失败，请重试' : String((error_4 === null || error_4 === void 0 ? void 0 : error_4.message) || '批改结果加载失败') });
                        return [3 /*break*/, 6];
                    case 5:
                        if (requestId === this.requestSequence)
                            this.setData({ switching: false });
                        return [7 /*endfinally*/];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
    chooseTask: function (e) {
        return __awaiter(this, void 0, void 0, function () {
            var selectedTaskIndex, task;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        selectedTaskIndex = Number(e.detail.value);
                        task = this.data.completedTasks[selectedTaskIndex];
                        if (!task || task.taskId === this.data.selectedTaskId)
                            return [2 /*return*/];
                        this.setData({ selectedTaskId: task.taskId, selectedTaskIndex: selectedTaskIndex });
                        return [4 /*yield*/, this.loadTask(task.taskId)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    },
    openHardProblemTraining: function () {
        var taskId = String((this.data.selectedTask && (this.data.selectedTask._id || this.data.selectedTask.taskId)) || '');
        if (!taskId) { wx.showToast({ title: '未找到任务编号', icon: 'none' }); return; }
        wx.navigateTo({ url: '/pages/hard-problem-training/index?taskId=' + encodeURIComponent(taskId) });
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
        var index = Number(e.currentTarget.dataset.index);
        this.setData((_a = {}, _a["".concat(key, "[").concat(index, "].loadFailed")] = true, _a));
    },
    retryLoad: function () { if (!this.data.loading)
        this.loadCompletedTasks(); },
    openDetail: function () { if (this.data.selectedTaskId)
        wx.navigateTo({ url: "/pages/result/detail/index?taskId=".concat(encodeURIComponent(this.data.selectedTaskId)) }); },
    goHome: function () { wx.switchTab({ url: '/pages/home/index' }); },
    continueUpload: function () { wx.navigateTo({ url: '/pages/task/create/index' }); },
});
