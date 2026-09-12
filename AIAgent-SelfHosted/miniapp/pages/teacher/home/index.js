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
var cloud_1 = require("../../../services/cloud");
var page_refresh_1 = require("../../../utils/page-refresh");
var features_1 = require("../../../config/features");
var custom_tab_bar_1 = require("../../../utils/custom-tab-bar");
var formatUpdatedTime = function (value) {
    var date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime()))
        return '';
    return "".concat(date.getMonth() + 1, "\u6708").concat(date.getDate(), "\u65E5 ").concat(String(date.getHours()).padStart(2, '0'), ":").concat(String(date.getMinutes()).padStart(2, '0'));
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
    data: { features: features_1.TEACHER_FEATURES, user: { role: '', name: '' }, loading: false, error: '', managerClasses: [], selectedClassIndex: 0, selectedClass: null, classSummary: null, recent: [], wrongQuestions: [], managerLoading: false, managerError: '' },
    refreshPage: function () {
        return __awaiter(this, void 0, void 0, function () {
            var app, snapshot, _a, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        (0, custom_tab_bar_1.syncCustomTabBar)(this, 'pages/teacher/home/index');
                        if (this.data.loading)
                            return [2 /*return*/];
                        this.setData({ loading: true });
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 7, 8, 9]);
                        app = getApp();
                        _a = app.globalData.authSnapshot;
                        if (_a) return [3 /*break*/, 3];
                        return [4 /*yield*/, app.bootstrap()];
                    case 2:
                        _a = (_b.sent());
                        _b.label = 3;
                    case 3:
                        snapshot = _a;
                        if (!(snapshot.resolvedRoute !== 'pages/teacher/home/index')) return [3 /*break*/, 5];
                        return [4 /*yield*/, app.navigateToResolvedRoute('teacher-home-auth', snapshot)];
                    case 4:
                        _b.sent();
                        return [2 /*return*/];
                    case 5:
                        this.setData({ user: snapshot.user || { role: '' }, reviewMode: snapshot.user && snapshot.user.reviewMode === true, error: '' });
                        return [4 /*yield*/, this.loadManagerClasses()];
                    case 6:
                        _b.sent();
                        return [3 /*break*/, 9];
                    case 7:
                        error_1 = _b.sent();
                        this.setData({ error: error_1.message || '无法进入管理中心' });
                        return [3 /*break*/, 9];
                    case 8:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 9: return [2 /*return*/];
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
                        this.setData({ managerClasses: managerClasses, selectedClassIndex: selectedClassIndex, selectedClass: selectedClass, classSummary: null, recent: [], wrongQuestions: [] });
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
            var selectedClass, response, wrongQuestions;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        selectedClass = this.data.selectedClass;
                        if (!selectedClass)
                            return [2 /*return*/];
                        return [4 /*yield*/, (0, cloud_1.call)('managerClassDashboard')];
                    case 1:
                        response = _a.sent();
                        wrongQuestions = Array.isArray(response === null || response === void 0 ? void 0 : response.wrongQuestions) ? response.wrongQuestions.map(function (item) { return (__assign(__assign({}, item), { displayTime: formatUpdatedTime(item.updatedAt) })); }) : [];
                        this.setData({ classSummary: (response === null || response === void 0 ? void 0 : response.classSummary) || null, recent: Array.isArray(response === null || response === void 0 ? void 0 : response.recentSubmissions) ? response.recentSubmissions : [], wrongQuestions: wrongQuestions });
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
                        this.setData({ selectedClassIndex: selectedClassIndex, selectedClass: selectedClass, managerLoading: true, managerError: '', classSummary: null, recent: [], wrongQuestions: [] });
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
    go: function (e) {
        var url = String(e.currentTarget.dataset.url || '');
        if (url)
            wx.navigateTo({ url: url });
    },
    settings: function () { wx.navigateTo({ url: '/pages/settings/index' }); },
    openReviewPanel: function () { wx.reLaunch({ url: '/pages/auth/role/index?review=1' }); },
    switchReviewRole: function () { return __awaiter(this, void 0, void 0, function () { var error_4, app; return __generator(this, function (_a) { switch (_a.label) { case 0: _a.trys.push([0, 2, , 3]); return [4 /*yield*/, (0, cloud_1.call)('reviewSession', { operation: 'switch', role: 'student' })]; case 1: _a.sent(); app = getApp(); if (app && app.globalData) { app.globalData.user = null; app.globalData.authSnapshot = null; } wx.reLaunch({ url: '/pages/home/index' }); return [3 /*break*/, 3]; case 2: error_4 = _a.sent(); wx.showToast({ title: String(error_4.message || '审核会话已失效'), icon: 'none' }); return [3 /*break*/, 3]; case 3: return [2 /*return*/]; } }); }); },
    closeReviewSession: function () { return __awaiter(this, void 0, void 0, function () { var app; return __generator(this, function (_a) { switch (_a.label) { case 0: return [4 /*yield*/, (0, cloud_1.call)('reviewSession', { operation: 'close' })]; case 1: _a.sent(); app = getApp(); if (app && app.globalData) { app.globalData.user = null; app.globalData.authSnapshot = null; } wx.reLaunch({ url: '/pages/auth/role/index' }); return [2 /*return*/]; } }); }); },
    openWrong: function (e) { var taskId = String(e.currentTarget.dataset.taskId || ''); if (taskId)
        wx.navigateTo({ url: "/pages/result/detail/index?taskId=".concat(encodeURIComponent(taskId)) }); },
});
