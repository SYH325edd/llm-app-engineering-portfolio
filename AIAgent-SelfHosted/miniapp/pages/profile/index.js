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
var customer_1 = require("../../config/customer");
var cloud_1 = require("../../services/cloud");
var page_refresh_1 = require("../../utils/page-refresh");
var custom_tab_bar_1 = require("../../utils/custom-tab-bar");
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
    data: { user: { name: '', grade: '', className: '', avatarUrl: '', boundTeacherNames: '暂未绑定' }, stats: { uploaded: 0, processing: 0, completed: 0, failed: 0 }, loading: false, error: '', isStudent: true, isManager: false, managerClasses: [], managerClassNames: '', managerLoading: false, managerError: '' },
    refreshPage: function () {
        return __awaiter(this, void 0, void 0, function () {
            var data, user, isStudent, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        (0, custom_tab_bar_1.syncCustomTabBar)(this, 'pages/profile/index');
                        if (this.data.loading)
                            return [2 /*return*/];
                        this.setData({ loading: true });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 5, 6, 7]);
                        return [4 /*yield*/, (0, cloud_1.call)('home')];
                    case 2:
                        data = _a.sent();
                        user = data.user || {};
                        if (!['student', 'teacher', 'super_admin'].includes(user.role) || user.status !== 'ACTIVE') {
                            wx.reLaunch({ url: '/pages/setup/index' });
                            return [2 /*return*/];
                        }
                        isStudent = user.role === 'student';
                        this.setData({ user: __assign(__assign({}, user), { boundTeacherNames: user.boundTeacherNames || '暂未绑定', teacherName: user.boundTeacherNames || '暂未绑定' }), stats: data.stats || this.data.stats, isStudent: isStudent, isManager: !isStudent, error: '' });
                        if (!!isStudent) return [3 /*break*/, 4];
                        this.setData({ loading: false });
                        return [4 /*yield*/, this.loadManagerClasses()];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4: return [3 /*break*/, 7];
                    case 5:
                        error_1 = _a.sent();
                        this.setData({ error: '加载失败，请重试' });
                        return [3 /*break*/, 7];
                    case 6:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 7: return [2 /*return*/];
                }
            });
        });
    },
    loadManagerClasses: function () {
        return __awaiter(this, void 0, void 0, function () {
            var response, managerClasses, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.managerLoading)
                            return [2 /*return*/];
                        this.setData({ managerLoading: true, managerError: '' });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, (0, cloud_1.call)('managerClassDashboard')];
                    case 2:
                        response = _a.sent();
                        managerClasses = Array.isArray(response === null || response === void 0 ? void 0 : response.classes) ? response.classes.map(function (item) { return (__assign(__assign({}, item), { processingCount: Math.max(0, Number(item.taskCount || 0) - Number(item.completedCount || 0) - Number(item.failedCount || 0)) })); }) : [];
                        this.setData({ managerClasses: managerClasses, managerClassNames: managerClasses.map(function (item) { return "".concat(item.region || item.className || ''); }).filter(Boolean).join('、') });
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
            });
        });
    },
    edit: function () { wx.navigateTo({ url: '/pages/profile/edit/index' }); },
    history: function () { wx.switchTab({ url: '/pages/history/index' }); },
    privacy: function () { wx.navigateTo({ url: '/pages/legal/privacy/index' }); },
    agreement: function () { wx.navigateTo({ url: '/pages/legal/agreement/index' }); },
    childrenPrivacy: function () { wx.navigateTo({ url: '/pages/legal/children-privacy/index' }); },
    contact: function () {
        if (!(0, customer_1.isServicePhoneConfigured)()) {
            wx.showModal({ title: '联系方式待配置', content: '客户正式部署时填写运营主体的投诉与联系电话。', showCancel: false });
            return;
        }
        wx.makePhoneCall({ phoneNumber: customer_1.CUSTOMER_DISPLAY_CONFIG.servicePhone });
    },
});
