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
Page({
    data: {
        loading: false,
        grade: '',
        className: '',
        studentName: '',
        dateFrom: '',
        dateTo: '',
        resultIndex: 0,
        resultLabels: ['全部结果', '全部正确', '存在错误', '批改失败', '待确认'],
        resultValues: ['', 'all_correct', 'has_errors', 'failed', 'need_confirmation'],
        checkinIndex: 0,
        checkinLabels: ['全部打卡', '打卡成功', '打卡失败'],
    },
    set: function (e) {
        var _a;
        this.setData((_a = {}, _a[e.currentTarget.dataset.k] = e.detail.value, _a));
    },
    setResult: function (e) { this.setData({ resultIndex: Number(e.detail.value) }); },
    setCheckin: function (e) { this.setData({ checkinIndex: Number(e.detail.value) }); },
    filters: function () {
        var checkinIndex = Number(this.data.checkinIndex);
        var filters = {
            grade: String(this.data.grade || '').trim(),
            className: String(this.data.className || '').trim(),
            studentName: String(this.data.studentName || '').trim(),
            dateFrom: String(this.data.dateFrom || '').trim(),
            dateTo: String(this.data.dateTo || '').trim(),
            resultType: this.data.resultValues[this.data.resultIndex] || '',
        };
        if (checkinIndex === 1)
            filters.checkinSuccess = true;
        if (checkinIndex === 2)
            filters.checkinSuccess = false;
        return filters;
    },
    export: function (e) {
        return __awaiter(this, void 0, void 0, function () {
            var type, data, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.loading)
                            return [2 /*return*/];
                        type = String(e.currentTarget.dataset.type || 'combined');
                        this.setData({ loading: true });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, 5, 6]);
                        return [4 /*yield*/, (0, cloud_1.callFunction)('exportData', { type: type, filters: this.filters() }, 120000)];
                    case 2:
                        data = _a.sent();
                        return [4 /*yield*/, wx.setClipboardData({ data: data.url })];
                    case 3:
                        _a.sent();
                        wx.showModal({ title: '导出完成', content: '临时下载链接已复制，请尽快打开下载。', showCancel: false });
                        return [3 /*break*/, 6];
                    case 4:
                        error_1 = _a.sent();
                        wx.showModal({ title: '导出失败', content: error_1.message || '请稍后重试', showCancel: false });
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
