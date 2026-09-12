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
var task_mode_label_1 = require("../../../utils/task-mode-label");
Page({
    data: {
        items: [],
        grade: '',
        className: '',
        studentName: '',
        status: '',
        checkin: '',
        dateFrom: '',
        dateTo: '',
        resultType: '',
        resultIndex: 0,
        resultLabels: ['全部结果', '全部正确', '存在错误', '批改失败', '待确认'],
        checkinLabels: ['全部打卡', '打卡成功', '打卡失败'],
        loading: false,
    },
    set: function (e) {
        var _a;
        this.setData((_a = {}, _a[e.currentTarget.dataset.k] = e.detail.value, _a));
    },
    load: function () {
        return __awaiter(this, void 0, void 0, function () {
            var payload, items, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.loading)
                            return [2 /*return*/];
                        this.setData({ loading: true });
                        payload = {
                            grade: this.data.grade.trim(),
                            className: this.data.className.trim(),
                            studentName: this.data.studentName.trim(),
                            status: this.data.status.trim(),
                            dateFrom: this.data.dateFrom.trim(),
                            dateTo: this.data.dateTo.trim(),
                            resultType: this.data.resultType,
                        };
                        if (this.data.checkin === 'yes')
                            payload.checkinSuccess = true;
                        if (this.data.checkin === 'no')
                            payload.checkinSuccess = false;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, (0, cloud_1.call)('submissions', payload, 30000)];
                    case 2:
                        items = _a.sent();
                        this.setData({ items: Array.isArray(items) ? items.map(task_mode_label_1.withTaskModeLabel).map(function (item) { return (__assign(__assign({}, item), { statusMessage: item.mode === 'CARELESS_TRAINING' ? [item.taskModeLabel, item.statusMessage].filter(Boolean).join(' · ') : item.statusMessage })); }) : [] });
                        return [3 /*break*/, 5];
                    case 3:
                        error_1 = _a.sent();
                        wx.showToast({ title: error_1.message, icon: 'none' });
                        return [3 /*break*/, 5];
                    case 4:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    },
    setResult: function (e) {
        var index = Number(e.detail.value || 0);
        var values = ['', 'all_correct', 'has_errors', 'failed', 'need_confirmation'];
        this.setData({ resultIndex: index, resultType: values[index] || '' });
    },
    setCheckin: function (e) {
        var index = Number(e.detail.value || 0);
        var values = ['', 'yes', 'no'];
        this.setData({ checkin: values[index] || '' });
    },
    clear: function () {
        var _this = this;
        this.setData({
            grade: '', className: '', studentName: '', status: '', checkin: '',
            dateFrom: '', dateTo: '', resultType: '', resultIndex: 0,
        }, function () { return void _this.load(); });
    },
    onShow: function () { void this.load(); },
    open: function (e) {
        var id = e.currentTarget.dataset.id;
        if (id)
            wx.navigateTo({ url: "/pages/teacher/submission-detail/index?taskId=".concat(encodeURIComponent(id)) });
    },
    retry: function (e) {
        return __awaiter(this, void 0, void 0, function () {
            var taskId, confirmed, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        taskId = String(e.currentTarget.dataset.taskId || '');
                        if (!taskId || this.data.loading)
                            return [2 /*return*/];
                        return [4 /*yield*/, new Promise(function (resolve) { return wx.showModal({ title: '重新处理', content: '确定重新处理该失败任务吗？', success: function (result) { return resolve(Boolean(result.confirm)); } }); })];
                    case 1:
                        confirmed = _a.sent();
                        if (!confirmed)
                            return [2 /*return*/];
                        this.setData({ loading: true });
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 5, 6, 7]);
                        return [4 /*yield*/, (0, cloud_1.call)('retryTask', { taskId: taskId })];
                    case 3:
                        _a.sent();
                        wx.showToast({ title: '任务已重新加入处理队列' });
                        return [4 /*yield*/, this.load()];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 7];
                    case 5:
                        error_2 = _a.sent();
                        wx.showModal({ title: '无法重新处理', content: error_2.message || '请稍后重试', showCancel: false });
                        return [3 /*break*/, 7];
                    case 6:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 7: return [2 /*return*/];
                }
            });
        });
    },
});
