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
Page({
    data: { applications: [], teachers: [], loading: false },
    onShow: function () {
        return __awaiter(this, void 0, void 0, function () { return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, this.load()];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        }); });
    },
    load: function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, applications, teachers, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (this.data.loading)
                            return [2 /*return*/];
                        this.setData({ loading: true });
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, Promise.all([(0, cloud_1.call)('teacherApplications'), (0, cloud_1.call)('listTeachers')])];
                    case 2:
                        _a = __read.apply(void 0, [_b.sent(), 2]), applications = _a[0], teachers = _a[1];
                        this.setData({ applications: applications || [], teachers: (teachers || []).filter(function (teacher) { return teacher.role === 'teacher' && teacher.status === 'ACTIVE'; }) });
                        return [3 /*break*/, 5];
                    case 3:
                        error_1 = _b.sent();
                        wx.showModal({ title: '无法查看教师审核', content: error_1.message || '请确认超级管理员权限', showCancel: false });
                        return [3 /*break*/, 5];
                    case 4:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    },
    approve: function (e) {
        return __awaiter(this, void 0, void 0, function () {
            var application, modal, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        application = this.data.applications[Number(e.currentTarget.dataset.index)];
                        if (!application)
                            return [2 /*return*/];
                        return [4 /*yield*/, wx.showModal({ title: '审核通过', content: '通过后该教师可进入教师工作台。' })];
                    case 1:
                        modal = _a.sent();
                        if (!modal.confirm)
                            return [2 /*return*/];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 5, , 6]);
                        return [4 /*yield*/, (0, cloud_1.call)('reviewTeacher', { userId: application.userId, approved: true })];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, this.load()];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 6];
                    case 5:
                        error_2 = _a.sent();
                        wx.showModal({ title: '审核失败', content: error_2.message || '请稍后重试', showCancel: false });
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
    reject: function (e) {
        return __awaiter(this, void 0, void 0, function () {
            var application, reason, modal, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        application = this.data.applications[Number(e.currentTarget.dataset.index)];
                        if (!application)
                            return [2 /*return*/];
                        reason = String(application.rejectReason || '').trim();
                        if (!reason) {
                            wx.showToast({ title: '请填写拒绝原因', icon: 'none' });
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, wx.showModal({ title: '拒绝教师申请', content: '拒绝后申请人将看到拒绝原因。' })];
                    case 1:
                        modal = _a.sent();
                        if (!modal.confirm)
                            return [2 /*return*/];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 5, , 6]);
                        return [4 /*yield*/, (0, cloud_1.call)('reviewTeacher', { userId: application.userId, approved: false, rejectReason: reason })];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, this.load()];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 6];
                    case 5:
                        error_3 = _a.sent();
                        wx.showModal({ title: '操作失败', content: error_3.message || '请稍后重试', showCancel: false });
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
    setRejectReason: function (e) {
        var index = Number(e.currentTarget.dataset.index);
        var applications = __spreadArray([], __read(this.data.applications), false);
        if (!applications[index])
            return;
        applications[index] = __assign(__assign({}, applications[index]), { rejectReason: e.detail.value });
        this.setData({ applications: applications });
    },
    promote: function (e) {
        return __awaiter(this, void 0, void 0, function () {
            var teacher, modal, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        teacher = this.data.teachers[Number(e.currentTarget.dataset.index)];
                        if (!teacher)
                            return [2 /*return*/];
                        return [4 /*yield*/, wx.showModal({ title: '提升超级管理员', content: '仅可提升已审核通过的有效教师，系统最多两位超级管理员。' })];
                    case 1:
                        modal = _a.sent();
                        if (!modal.confirm)
                            return [2 /*return*/];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 5, , 6]);
                        return [4 /*yield*/, (0, cloud_1.call)('promoteTeacherToSuperAdmin', { userId: teacher.userId })];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, this.load()];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 6];
                    case 5:
                        error_4 = _a.sent();
                        wx.showModal({ title: '提升失败', content: error_4.message || '请稍后重试', showCancel: false });
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
});
