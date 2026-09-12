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
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeStudentsWithCheckins = mergeStudentsWithCheckins;
var cloud_1 = require("../../../services/cloud");
var page_refresh_1 = require("../../../utils/page-refresh");
function mergeStudentsWithCheckins(items, overview) {
    var byId = new Map(((overview === null || overview === void 0 ? void 0 : overview.students) || []).map(function (student) { return [String(student.studentId), student]; }));
    var order = { IN_PROGRESS: 0, NOT_PRACTICED: 1, COMPLETED: 2 };
    return (items || []).map(function (item, index) {
        var _a;
        var checkin = byId.get(String(item.boundUserId || item._id)) || {};
        var rawStatus = String(checkin.todayStatus || 'NOT_PRACTICED');
        var todayStatus = rawStatus === 'NOT_PRACTISED' ? 'NOT_PRACTICED' : rawStatus;
        var answeredQuestionCount = Math.max(0, Number(checkin.answeredQuestionCount || 0));
        var correctQuestionCount = Math.max(0, Math.min(answeredQuestionCount, Number(checkin.correctQuestionCount || 0)));
        var accuracyRate = Number(checkin.accuracyRate || 0);
        if (!Number.isFinite(accuracyRate))
            accuracyRate = 0;
        if (accuracyRate >= 0 && accuracyRate <= 1)
            accuracyRate *= 100;
        accuracyRate = Math.max(0, Math.min(100, accuracyRate));
        var checkinRate = Number(checkin.checkinRate || 0);
        if (!Number.isFinite(checkinRate))
            checkinRate = 0;
        if (checkinRate >= 0 && checkinRate <= 1)
            checkinRate *= 100;
        checkinRate = Math.max(0, Math.min(100, checkinRate));
        return __assign(__assign(__assign({}, item), checkin), { _order: (_a = order[todayStatus]) !== null && _a !== void 0 ? _a : order.NOT_PRACTICED, _index: index, todayStatus: todayStatus, todayStatusText: todayStatus === 'COMPLETED' ? '已完成' : todayStatus === 'IN_PROGRESS' ? '进行中' : '未练习', qualifiedQuestionCount: Number(checkin.qualifiedQuestionCount || 0), requiredQuestionCount: Number(checkin.requiredQuestionCount || 3), practiceDays: Number(checkin.practiceDays || 0), successfulCheckinDays: Number(checkin.successfulCheckinDays || 0), answeredQuestionCount: answeredQuestionCount, correctQuestionCount: correctQuestionCount, accuracyRateText: "".concat(Math.round(accuracyRate * 10) / 10, "%"), checkinRateText: "".concat(Math.round(checkinRate * 10) / 10, "%") });
    }).sort(function (left, right) { return left._order - right._order || left._index - right._index; });
}
Page({
    data: {
        items: [],
        duplicateRequests: [],
        grade: '',
        className: '',
        archived: false,
        loading: false,
        bindingUserId: '', checkinError: '',
    },
    set: function (e) {
        var _a;
        this.setData((_a = {}, _a[e.currentTarget.dataset.k] = e.detail.value, _a));
    },
    toggleArchived: function (e) {
        this.setData({ archived: Boolean(e.detail.value) });
        void this.load();
    },
    load: function () {
        return __awaiter(this, void 0, void 0, function () {
            var filters, requests, overview, checkinError, _1, _a, items, duplicateRequests, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (this.data.loading)
                            return [2 /*return*/];
                        this.setData({ loading: true });
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 7, 8, 9]);
                        filters = {
                            grade: String(this.data.grade || '').trim(),
                            className: String(this.data.className || '').trim(),
                            archived: this.data.archived,
                        };
                        requests = this.data.archived ? Promise.resolve([]) : (0, cloud_1.call)('duplicateStudentRequests');
                        overview = null;
                        checkinError = '';
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, (0, cloud_1.call)('getCheckinOverview')];
                    case 3:
                        overview = _b.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        _1 = _b.sent();
                        checkinError = '打卡数据暂时无法加载，请稍后重试。';
                        return [3 /*break*/, 5];
                    case 5: return [4 /*yield*/, Promise.all([(0, cloud_1.call)('listStudents', filters), requests])];
                    case 6:
                        _a = __read.apply(void 0, [_b.sent(), 2]), items = _a[0], duplicateRequests = _a[1];
                        this.setData({
                            items: mergeStudentsWithCheckins(items, overview),
                            duplicateRequests: (duplicateRequests || []).map(function (request) { return (__assign(__assign({}, request), { candidates: (request.candidates || []).map(function (candidate) { return (__assign(__assign({}, candidate), { extraSummary: Object.entries(candidate.extraFields || {})
                                        .slice(0, 3)
                                        .map(function (_a) {
                                        var _b = __read(_a, 2), key = _b[0], value = _b[1];
                                        return "".concat(key, ":").concat(value);
                                    })
                                        .join('；') })); }) })); }),
                            checkinError: checkinError,
                        });
                        return [3 /*break*/, 9];
                    case 7:
                        error_1 = _b.sent();
                        wx.showToast({ title: error_1.message || '加载失败', icon: 'none' });
                        return [3 /*break*/, 9];
                    case 8:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 9: return [2 /*return*/];
                }
            });
        });
    },
    ensureRefreshController: function () {
        if (!this._pageRefreshController)
            this._pageRefreshController = (0, page_refresh_1.createPageRefreshController)(this, this.load, 60000);
        return this._pageRefreshController;
    },
    onShow: function () { return this.ensureRefreshController().show(); },
    onHide: function () { if (this._pageRefreshController) this._pageRefreshController.hide(); },
    onUnload: function () { if (this._pageRefreshController) this._pageRefreshController.unload(); },
    onPullDownRefresh: function () { return this.ensureRefreshController().manual().finally(function () { if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh(); }); },
    open: function (e) {
        var id = e.currentTarget.dataset.id;
        if (id)
            wx.navigateTo({ url: "/pages/teacher/student-detail/index?id=".concat(encodeURIComponent(id)) });
    },
    add: function () { wx.navigateTo({ url: '/pages/teacher/student-detail/index' }); },
    bindDuplicate: function (e) {
        return __awaiter(this, void 0, void 0, function () {
            var userId, rosterId, modal, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.bindingUserId)
                            return [2 /*return*/];
                        userId = String(e.currentTarget.dataset.userId || '');
                        rosterId = String(e.currentTarget.dataset.rosterId || '');
                        if (!userId || !rosterId)
                            return [2 /*return*/];
                        return [4 /*yield*/, wx.showModal({
                                title: '确认绑定',
                                content: '确认后，该微信账号将绑定到所选学生名单。',
                            })];
                    case 1:
                        modal = _a.sent();
                        if (!modal.confirm)
                            return [2 /*return*/];
                        this.setData({ bindingUserId: userId });
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 5, 6, 7]);
                        return [4 /*yield*/, (0, cloud_1.call)('bindDuplicateStudent', { userId: userId, rosterId: rosterId })];
                    case 3:
                        _a.sent();
                        wx.showToast({ title: '绑定成功' });
                        return [4 /*yield*/, this.load()];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 7];
                    case 5:
                        error_2 = _a.sent();
                        wx.showModal({ title: '绑定失败', content: error_2.message || '请稍后重试', showCancel: false });
                        return [3 /*break*/, 7];
                    case 6:
                        this.setData({ bindingUserId: '' });
                        return [7 /*endfinally*/];
                    case 7: return [2 /*return*/];
                }
            });
        });
    },
});
