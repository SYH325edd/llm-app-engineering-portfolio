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
var page_refresh_1 = require("../../utils/page-refresh");
var task_title_1 = require("../../utils/task-title");
var task_mode_label_1 = require("../../utils/task-mode-label");
var custom_tab_bar_1 = require("../../utils/custom-tab-bar");
var student_result_visibility_1 = require("../../utils/student-result-visibility");
var formatSubmissionTime = function (value) {
    var date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime()))
        return '';
    return "".concat(date.getMonth() + 1, "\u6708").concat(date.getDate(), "\u65E5 ").concat(String(date.getHours()).padStart(2, '0'), ":").concat(String(date.getMinutes()).padStart(2, '0'));
};
var studentStatus = function (status) {
    var value = String(status || '');
    if (value === 'COMPLETED')
        return { text: '已完成', icon: '✓' };
    if (value === 'FAILED')
        return { text: '失败', icon: '×' };
    if (value === 'NEED_CONFIRMATION')
        return { text: '待确认', icon: '!' };
    return { text: '处理中', icon: '◷' };
};
var withStudentTaskPresentation = function (task) {
    var item = (0, task_title_1.withDecodedTaskTitle)(task);
    var status = studentStatus(item.status);
    return __assign(__assign({}, (0, task_mode_label_1.withTaskModeLabel)(item)), { statusText: status.text, statusIcon: status.icon, displayTime: formatSubmissionTime(item.createdAt), progressPercent: Math.max(0, Math.min(100, Number(item.progress || 0))) });
};
var checkinPresentation = function (value) {
    var _a, _b, _c;
    var requiredQuestionCount = Number(((_a = value === null || value === void 0 ? void 0 : value.today) === null || _a === void 0 ? void 0 : _a.requiredQuestionCount) || 3);
    var qualifiedQuestionCount = Math.max(0, Number(((_b = value === null || value === void 0 ? void 0 : value.today) === null || _b === void 0 ? void 0 : _b.qualifiedQuestionCount) || 0));
    var completed = ((_c = value === null || value === void 0 ? void 0 : value.today) === null || _c === void 0 ? void 0 : _c.completed) === true;
    var remainingCount = Math.max(0, requiredQuestionCount - qualifiedQuestionCount);
    var statusText = completed ? '今日打卡成功' : qualifiedQuestionCount === 0 ? '今天还没有完成合格题' : "\u4ECA\u5929\u5DF2\u5B8C\u6210".concat(qualifiedQuestionCount, "\u9898\uFF0C\u8FD8\u5DEE").concat(remainingCount, "\u9898");
    return { qualifiedQuestionCount: qualifiedQuestionCount, requiredQuestionCount: requiredQuestionCount, progress: Math.min(100, Math.round(qualifiedQuestionCount / requiredQuestionCount * 100)), statusText: statusText };
};
var checkinOverviewView = function (value) {
    var count = function (key) { return Math.max(0, Number(value === null || value === void 0 ? void 0 : value[key]) || 0); };
    var normalizeRate = function (input) {
        var rate = Number(input);
        if (!Number.isFinite(rate))
            rate = 0;
        if (rate >= 0 && rate <= 1)
            rate *= 100;
        return Math.max(0, Math.min(100, rate));
    };
    var rateTone = function (rate) { return rate >= 90 ? 'rate-high' : rate >= 60 ? 'rate-medium' : 'rate-low'; };
    var completionRate = normalizeRate(value === null || value === void 0 ? void 0 : value.completionRate);
    var accuracyRate = normalizeRate(value === null || value === void 0 ? void 0 : value.accuracyRate);
    return { studentTotal: count('studentTotal'), practicedStudentCount: count('practicedStudentCount'), completedStudentCount: count('completedStudentCount'), inProgressStudentCount: count('inProgressStudentCount'), notPracticedStudentCount: count('notPracticedStudentCount'), completionRateText: "".concat(Math.round(completionRate * 10) / 10, "%"), completionRateTone: rateTone(completionRate), accuracyRateText: "".concat(Math.round(accuracyRate * 10) / 10, "%"), accuracyRateTone: rateTone(accuracyRate) };
};
Page({
    ensureRefreshController: function () {
        if (!this._pageRefreshController)
            this._pageRefreshController = (0, page_refresh_1.createPageRefreshController)(this, this.refreshPage, 60000);
        return this._pageRefreshController;
    },
    onShow: function () { return this.ensureRefreshController().show(); },
    onHide: function () { if (this._pageRefreshController) this._pageRefreshController.hide(); },
    onUnload: function () { if (this._pageRefreshController) this._pageRefreshController.unload(); },
    onPullDownRefresh: function () {
        return this.ensureRefreshController().manual().finally(function () { if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh(); });
    },
    data: { user: { name: '', role: '' }, recent: [], stats: { uploaded: 0, processing: 0, completed: 0, failed: 0 }, checkin: { today: { qualifiedQuestionCount: 0, requiredQuestionCount: 3, remainingCount: 3, completed: false }, practiceDays: 0, successfulCheckinDays: 0, incompletePracticeDays: 0, totalQualifiedQuestions: 0, successfulDates: [] }, checkinProgress: 0, checkinStatusText: '今天还没有完成合格题', checkinError: '', activeTask: null, isStudent: false, isManager: false, isSuperAdmin: false, studentResultHidden: false, loading: false, redirecting: false, managerClasses: [], selectedClassIndex: 0, selectedClass: null, classSummary: null, checkinOverview: null, managerLoading: false, managerError: '' },
    refreshPage: function () {
        return __awaiter(this, void 0, void 0, function () {
            var data, user, isStudent, isManager, app, checkin, presentation, _1, error_1, fallbackUser;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        (0, custom_tab_bar_1.syncCustomTabBar)(this, 'pages/home/index');
                        if (this.data.loading || this.data.redirecting)
                            return [2 /*return*/];
                        this.setData({ loading: true });
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 11, 12, 13]);
                        return [4 /*yield*/, (0, cloud_1.call)('home')];
                    case 2:
                        data = _c.sent();
                        user = data.user || { name: '', role: '' };
                        isStudent = user.role === 'student';
                        isManager = user.role === 'teacher' || user.role === 'super_admin';
                        if (!((!isStudent && !isManager) || user.status !== 'ACTIVE')) return [3 /*break*/, 4];
                        this.setData({ redirecting: true });
                        app = getApp();
                        return [4 /*yield*/, app.navigateToResolvedRoute('home-auth')];
                    case 3:
                        _c.sent();
                        return [2 /*return*/];
                    case 4:
                        this.setData({ user: user, isStudent: isStudent, isManager: isManager, isSuperAdmin: user.role === 'super_admin', studentResultHidden: (0, student_result_visibility_1.isCurrentStudentResultHidden)(user), recent: isStudent && Array.isArray(data.recent) ? data.recent.slice(0, 3).map(withStudentTaskPresentation) : [], stats: isStudent ? (data.stats || this.data.stats) : this.data.stats, activeTask: isStudent && data.activeTask ? withStudentTaskPresentation(data.activeTask) : null });
                        this.setData({ reviewMode: user.reviewMode === true });
                        if (!isStudent) return [3 /*break*/, 8];
                        _c.label = 5;
                    case 5:
                        _c.trys.push([5, 7, , 8]);
                        return [4 /*yield*/, (0, cloud_1.call)('getMyCheckinStats')];
                    case 6:
                        checkin = _c.sent();
                        presentation = checkinPresentation(checkin);
                        this.setData({ checkin: checkin, checkinProgress: presentation.progress, checkinStatusText: presentation.statusText, checkinError: '' });
                        return [3 /*break*/, 8];
                    case 7:
                        _1 = _c.sent();
                        this.setData({ checkinError: '打卡数据暂时无法加载，请稍后重试。' });
                        return [3 /*break*/, 8];
                    case 8:
                        if (!isManager) return [3 /*break*/, 10];
                        return [4 /*yield*/, this.loadManagerClasses()];
                    case 9:
                        _c.sent();
                        _c.label = 10;
                    case 10: return [3 /*break*/, 13];
                    case 11:
                        error_1 = _c.sent();
                        fallbackUser = ((_b = (_a = getApp()) === null || _a === void 0 ? void 0 : _a.globalData) === null || _b === void 0 ? void 0 : _b.user) || this.data.user;
                        this.setData({ user: fallbackUser, isStudent: (fallbackUser === null || fallbackUser === void 0 ? void 0 : fallbackUser.role) === 'student', isManager: (fallbackUser === null || fallbackUser === void 0 ? void 0 : fallbackUser.role) === 'teacher' || (fallbackUser === null || fallbackUser === void 0 ? void 0 : fallbackUser.role) === 'super_admin', isSuperAdmin: (fallbackUser === null || fallbackUser === void 0 ? void 0 : fallbackUser.role) === 'super_admin' });
                        wx.showToast({ title: String((error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || '首页数据加载失败，请重试'), icon: 'none' });
                        return [3 /*break*/, 13];
                    case 12:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 13: return [2 /*return*/];
                }
            });
        });
    },
    loadManagerClasses: function () {
        return __awaiter(this, void 0, void 0, function () {
            var response, managerClasses, current_1, selectedClassIndex, selectedClass, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.managerLoading)
                            return [2 /*return*/];
                        this.setData({ managerLoading: true, managerError: '' });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 5, 6, 7]);
                        return [4 /*yield*/, (0, cloud_1.call)('managerClassDashboard')];
                    case 2:
                        response = _a.sent();
                        managerClasses = (response === null || response === void 0 ? void 0 : response.classSummary) ? [{}] : [];
                        current_1 = this.data.selectedClass;
                        selectedClassIndex = Math.max(0, managerClasses.findIndex(function (item) { return item.grade === (current_1 === null || current_1 === void 0 ? void 0 : current_1.grade) && item.className === (current_1 === null || current_1 === void 0 ? void 0 : current_1.className); }));
                        selectedClass = managerClasses[selectedClassIndex] || null;
                        this.setData({ managerClasses: managerClasses, selectedClassIndex: selectedClassIndex, selectedClass: selectedClass, classSummary: null, checkinOverview: null, recent: [] });
                        if (!selectedClass) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.loadManagerDashboard()];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4: return [3 /*break*/, 7];
                    case 5:
                        error_2 = _a.sent();
                        this.setData({ managerError: String((error_2 === null || error_2 === void 0 ? void 0 : error_2.message) || '加载失败') });
                        return [3 /*break*/, 7];
                    case 6:
                        this.setData({ managerLoading: false });
                        return [7 /*endfinally*/];
                    case 7: return [2 /*return*/];
                }
            });
        });
    },
    loadManagerDashboard: function () {
        return __awaiter(this, void 0, void 0, function () {
            var selectedClass, response, checkinOverview, _a, recent;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        selectedClass = this.data.selectedClass;
                        if (!selectedClass)
                            return [2 /*return*/];
                        return [4 /*yield*/, (0, cloud_1.call)('managerClassDashboard')];
                    case 1:
                        response = _b.sent();
                        _a = checkinOverviewView;
                        return [4 /*yield*/, (0, cloud_1.call)('getCheckinOverview')];
                    case 2:
                        checkinOverview = _a.apply(void 0, [_b.sent()]);
                        recent = Array.isArray(response === null || response === void 0 ? void 0 : response.recentSubmissions) ? response.recentSubmissions.map(function (item) { return (__assign(__assign({}, (0, task_mode_label_1.withTaskModeLabel)((0, task_title_1.withDecodedTaskTitle)(item))), { displayTime: formatSubmissionTime(item.createdAt) })); }) : [];
                        this.setData({ classSummary: (response === null || response === void 0 ? void 0 : response.classSummary) || null, checkinOverview: checkinOverview, recent: recent });
                        return [2 /*return*/];
                }
            });
        });
    },
    chooseManagerClass: function (e) {
        return __awaiter(this, void 0, void 0, function () {
            var selectedClassIndex, selectedClass, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        selectedClassIndex = Number(e.detail.value || 0);
                        selectedClass = this.data.managerClasses[selectedClassIndex];
                        if (!selectedClass || selectedClassIndex === this.data.selectedClassIndex)
                            return [2 /*return*/];
                        this.setData({ selectedClassIndex: selectedClassIndex, selectedClass: selectedClass, managerLoading: true, managerError: '', classSummary: null, checkinOverview: null, recent: [] });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, this.loadManagerDashboard()];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 3:
                        error_3 = _a.sent();
                        this.setData({ managerError: String((error_3 === null || error_3 === void 0 ? void 0 : error_3.message) || '加载失败') });
                        return [3 /*break*/, 5];
                    case 4:
                        this.setData({ managerLoading: false });
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    },
    start: function () { wx.navigateTo({ url: '/pages/task/create/index' }); },
    history: function () { wx.switchTab({ url: '/pages/history/index' }); },
    openReviewPanel: function () { wx.reLaunch({ url: '/pages/auth/role/index?review=1' }); },
    switchReviewRole: function () { return __awaiter(this, void 0, void 0, function () { var error_4, app; return __generator(this, function (_a) { switch (_a.label) { case 0: _a.trys.push([0, 2, , 3]); return [4 /*yield*/, (0, cloud_1.call)('reviewSession', { operation: 'switch', role: 'teacher' })]; case 1: _a.sent(); app = getApp(); if (app && app.globalData) { app.globalData.user = null; app.globalData.authSnapshot = null; } wx.reLaunch({ url: '/pages/teacher/home/index' }); return [3 /*break*/, 3]; case 2: error_4 = _a.sent(); wx.showToast({ title: String(error_4.message || '审核会话已失效'), icon: 'none' }); return [3 /*break*/, 3]; case 3: return [2 /*return*/]; } }); }); },
    closeReviewSession: function () { return __awaiter(this, void 0, void 0, function () { var app; return __generator(this, function (_a) { switch (_a.label) { case 0: return [4 /*yield*/, (0, cloud_1.call)('reviewSession', { operation: 'close' })]; case 1: _a.sent(); app = getApp(); if (app && app.globalData) { app.globalData.user = null; app.globalData.authSnapshot = null; } wx.reLaunch({ url: '/pages/auth/role/index' }); return [2 /*return*/]; } }); }); },
    filter: function (e) { wx.setStorageSync('historyStatus', String(e.currentTarget.dataset.status || 'ALL')); wx.switchTab({ url: '/pages/history/index' }); },
    open: function (e) { var taskId = String(e.currentTarget.dataset.taskId || ''); var task = this.data.recent.find(function (item) { return String(item._id || item.taskId || item.id || '').trim() === taskId; }) || this.data.activeTask; if (!taskId)
        return; var viewerQuery = ''; if (this.data.isManager) {
        var studentId = String((task === null || task === void 0 ? void 0 : task.studentId) || '').trim();
        if (!studentId) {
            wx.showToast({ title: '学生信息不完整，请刷新后重试', icon: 'none' });
            return;
        }
        viewerQuery = "&viewerMode=teacher&targetStudentId=".concat(encodeURIComponent(studentId));
    } if (this.data.isManager)
        wx.navigateTo({ url: (task === null || task === void 0 ? void 0 : task.status) === 'COMPLETED' ? "/pages/result/detail/index?taskId=".concat(encodeURIComponent(taskId)).concat(viewerQuery) : "/pages/task/processing/index?taskId=".concat(encodeURIComponent(taskId)).concat(viewerQuery) });
    else {
        var route = (0, student_result_visibility_1.resolveStudentTaskRoute)(task, this.data.studentResultHidden);
        if (route)
            wx.navigateTo({ url: route });
    } },
});
