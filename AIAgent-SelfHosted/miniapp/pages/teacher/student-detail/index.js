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
exports.normalizeStudentCheckin = normalizeStudentCheckin;
exports.studentCheckinStatus = studentCheckinStatus;
var cloud_1 = require("../../../services/cloud");
var page_refresh_1 = require("../../../utils/page-refresh");
var EMPTY_CHECKIN = {
    today: { qualifiedQuestionCount: 0, requiredQuestionCount: 3, completed: false, remainingCount: 3 },
    practiceDays: 0,
    successfulCheckinDays: 0,
    incompletePracticeDays: 0,
    totalQualifiedQuestions: 0,
    answeredQuestionCount: 0,
    correctQuestionCount: 0,
    accuracyRate: 0,
    accuracyRateText: '0%',
    checkinRate: 0,
    checkinRateText: '0%',
    successfulDates: [],
};
function normalizeStudentCheckin(value) {
    var _a;
    var today = (value === null || value === void 0 ? void 0 : value.today) || {};
    var answeredQuestionCount = Math.max(0, Number((value === null || value === void 0 ? void 0 : value.answeredQuestionCount) || 0));
    var correctQuestionCount = Math.max(0, Math.min(answeredQuestionCount, Number((value === null || value === void 0 ? void 0 : value.correctQuestionCount) || 0)));
    var accuracyRate = Number((value === null || value === void 0 ? void 0 : value.accuracyRate) || 0);
    if (!Number.isFinite(accuracyRate))
        accuracyRate = 0;
    if (accuracyRate >= 0 && accuracyRate <= 1)
        accuracyRate *= 100;
    accuracyRate = Math.max(0, Math.min(100, accuracyRate));
    var checkinRate = Number((value === null || value === void 0 ? void 0 : value.checkinRate) || 0);
    if (!Number.isFinite(checkinRate))
        checkinRate = 0;
    if (checkinRate >= 0 && checkinRate <= 1)
        checkinRate *= 100;
    checkinRate = Math.max(0, Math.min(100, checkinRate));
    return {
        today: {
            dateKey: String(today.dateKey || ''),
            qualifiedQuestionCount: Number(today.qualifiedQuestionCount || 0),
            requiredQuestionCount: Number(today.requiredQuestionCount || 3),
            completed: today.completed === true,
            remainingCount: Math.max(0, Number((_a = today.remainingCount) !== null && _a !== void 0 ? _a : 3 - Number(today.qualifiedQuestionCount || 0))),
        },
        practiceDays: Number((value === null || value === void 0 ? void 0 : value.practiceDays) || 0),
        successfulCheckinDays: Number((value === null || value === void 0 ? void 0 : value.successfulCheckinDays) || 0),
        incompletePracticeDays: Number((value === null || value === void 0 ? void 0 : value.incompletePracticeDays) || 0),
        totalQualifiedQuestions: Number((value === null || value === void 0 ? void 0 : value.totalQualifiedQuestions) || 0),
        answeredQuestionCount: answeredQuestionCount,
        correctQuestionCount: correctQuestionCount,
        accuracyRate: accuracyRate,
        accuracyRateText: "".concat(Math.round(accuracyRate * 10) / 10, "%"),
        checkinRate: checkinRate,
        checkinRateText: "".concat(Math.round(checkinRate * 10) / 10, "%"),
        successfulDates: Array.isArray(value === null || value === void 0 ? void 0 : value.successfulDates) ? value.successfulDates.slice(0, 10).map(function (dateKey) { return String(dateKey); }) : [],
    };
}
function studentCheckinStatus(today) {
    if ((today === null || today === void 0 ? void 0 : today.completed) === true)
        return '已完成';
    return Number((today === null || today === void 0 ? void 0 : today.qualifiedQuestionCount) || 0) > 0 ? '进行中' : '未练习';
}
Page({
    data: {
        id: '',
        student: { name: '', grade: '', className: '', extraFields: {}, archived: false },
        extraText: '{}',
        loading: false,
        studentLoaded: false,
        checkinLoading: false,
        checkin: EMPTY_CHECKIN,
        checkinStatus: '未练习',
        checkinError: '',
    },
    onLoad: function (query) {
        var _this = this;
        var id = String(query.id || '');
        if (!id)
            return Promise.resolve();
        this.setData({ id: id, loading: true });
        return (0, cloud_1.call)('getStudent', { studentId: id }).then(function (student) {
            _this.setData({ student: __assign(__assign({}, student), { className: student.region || student.className || '' }), studentLoaded: true, extraText: JSON.stringify(student.extraFields || {}, null, 2) });
        }).catch(function (error) {
            wx.showModal({ title: '加载失败', content: error.message || '学生记录不存在', showCancel: false });
        }).finally(function () {
            _this.setData({ loading: false });
        });
    },
    ensureRefreshController: function () {
        if (!this._pageRefreshController)
            this._pageRefreshController = (0, page_refresh_1.createPageRefreshController)(this, this.loadCheckinStats, 60000);
        return this._pageRefreshController;
    },
    onShow: function () { return this.ensureRefreshController().show(); },
    onHide: function () { if (this._pageRefreshController) this._pageRefreshController.hide(); },
    onUnload: function () { if (this._pageRefreshController) this._pageRefreshController.unload(); },
    onPullDownRefresh: function () { return this.ensureRefreshController().manual().finally(function () { if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh(); }); },
    loadCheckinStats: function () {
        return __awaiter(this, void 0, void 0, function () {
            var studentId, checkin, normalized, _1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        studentId = String(this.data.id || '');
                        if (!studentId || this.data.checkinLoading)
                            return [2 /*return*/];
                        this.setData({ checkinLoading: true });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, (0, cloud_1.call)('getStudentCheckinStats', { studentId: studentId })];
                    case 2:
                        checkin = _a.sent();
                        normalized = normalizeStudentCheckin(checkin);
                        this.setData({ checkin: normalized, checkinStatus: studentCheckinStatus(normalized.today), checkinError: '' });
                        return [3 /*break*/, 5];
                    case 3:
                        _1 = _a.sent();
                        this.setData({ checkinError: '打卡数据暂时无法加载，请稍后重试。' });
                        return [3 /*break*/, 5];
                    case 4:
                        this.setData({ checkinLoading: false });
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    },
    set: function (e) {
        var _a;
        this.setData((_a = {}, _a["student.".concat(e.currentTarget.dataset.k)] = e.detail.value, _a));
    },
    setExtra: function (e) { this.setData({ extraText: e.detail.value }); },
    parseExtra: function () {
        var text = String(this.data.extraText || '{}').trim() || '{}';
        var value = JSON.parse(text);
        if (!value || Array.isArray(value) || typeof value !== 'object')
            throw new Error('扩展信息必须是JSON对象');
        return value;
    },
    save: function () {
        return __awaiter(this, void 0, void 0, function () {
            var student, extraFields, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.loading)
                            return [2 /*return*/];
                        student = {
                            name: String(this.data.student.name || '').trim(),
                            grade: String(this.data.student.grade || '').trim(),
                            className: String(this.data.student.className || '').trim(),
                        };
                        if (!student.name || !student.className) {
                            wx.showToast({ title: '请完整填写姓名和地区', icon: 'none' });
                            return [2 /*return*/];
                        }
                        try {
                            extraFields = this.parseExtra();
                        }
                        catch (error) {
                            wx.showToast({ title: error.message || '扩展信息格式错误', icon: 'none' });
                            return [2 /*return*/];
                        }
                        this.setData({ loading: true });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 6, 7, 8]);
                        if (!this.data.id) return [3 /*break*/, 3];
                        return [4 /*yield*/, (0, cloud_1.call)('updateStudent', { studentId: this.data.id, patch: __assign(__assign({}, student), { extraFields: extraFields }) })];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 3: return [4 /*yield*/, (0, cloud_1.call)('createStudent', { student: __assign(__assign({}, student), { extraFields: extraFields }) })];
                    case 4:
                        _a.sent();
                        _a.label = 5;
                    case 5:
                        wx.navigateBack();
                        return [3 /*break*/, 8];
                    case 6:
                        error_2 = _a.sent();
                        wx.showModal({ title: '保存失败', content: error_2.message || '请稍后重试', showCancel: false });
                        return [3 /*break*/, 8];
                    case 7:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 8: return [2 /*return*/];
                }
            });
        });
    },
    archive: function () {
        return __awaiter(this, void 0, void 0, function () {
            var modal, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.data.id || this.data.loading)
                            return [2 /*return*/];
                        return [4 /*yield*/, wx.showModal({
                                title: '确认归档',
                                content: '学生将立即停用，30天内可恢复，之后永久删除全部个人数据。',
                            })];
                    case 1:
                        modal = _a.sent();
                        if (!modal.confirm)
                            return [2 /*return*/];
                        this.setData({ loading: true });
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, 5, 6]);
                        return [4 /*yield*/, (0, cloud_1.call)('archiveStudent', { studentId: this.data.id })];
                    case 3:
                        _a.sent();
                        wx.navigateBack();
                        return [3 /*break*/, 6];
                    case 4:
                        error_3 = _a.sent();
                        wx.showModal({ title: '归档失败', content: error_3.message || '请稍后重试', showCancel: false });
                        return [3 /*break*/, 6];
                    case 5:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
    restore: function () {
        return __awaiter(this, void 0, void 0, function () {
            var modal, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.data.id || this.data.loading)
                            return [2 /*return*/];
                        return [4 /*yield*/, wx.showModal({ title: '恢复学生', content: '恢复后，该学生可以继续使用小程序。' })];
                    case 1:
                        modal = _a.sent();
                        if (!modal.confirm)
                            return [2 /*return*/];
                        this.setData({ loading: true });
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, 5, 6]);
                        return [4 /*yield*/, (0, cloud_1.call)('restoreStudent', { studentId: this.data.id })];
                    case 3:
                        _a.sent();
                        wx.showToast({ title: '已恢复' });
                        this.setData({ 'student.archived': false, 'student.archivedAt': null, 'student.purgeAt': null });
                        return [3 /*break*/, 6];
                    case 4:
                        error_4 = _a.sent();
                        wx.showModal({ title: '恢复失败', content: error_4.message || '请稍后重试', showCancel: false });
                        return [3 /*break*/, 6];
                    case 5:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
});
