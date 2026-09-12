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
Page({
    data: {
        agreementAccepted: false,
        entering: false,
        reviewPanelVisible: false,
        reviewTapCount: 0,
        reviewTapStartedAt: 0,
        reviewAccessCode: '',
        reviewSubmitting: false,
    },
    onLoad: function (options) {
        if (String(options && options.review || '') === '1')
            this.setData({ reviewPanelVisible: true });
    },
    openReviewChannel: function () {
        var now = Date.now();
        var startedAt = Number(this.data.reviewTapStartedAt || 0);
        var count = startedAt && now - startedAt <= 3000 ? Number(this.data.reviewTapCount || 0) + 1 : 1;
        if (count >= 5) {
            this.setData({ reviewPanelVisible: true, reviewTapCount: 0, reviewTapStartedAt: 0 });
            return;
        }
        this.setData({ reviewTapCount: count, reviewTapStartedAt: count === 1 ? now : startedAt });
    },
    closeReviewPanel: function () { this.setData({ reviewPanelVisible: false, reviewAccessCode: '', reviewSubmitting: false }); },
    inputReviewAccessCode: function (event) { this.setData({ reviewAccessCode: String(event.detail.value || '') }); },
    enterReview: function (event) {
        return __awaiter(this, void 0, void 0, function () {
            var role, accessCode, app, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.reviewSubmitting)
                            return [2 /*return*/];
                        role = String(event.currentTarget.dataset.role || '');
                        accessCode = String(this.data.reviewAccessCode || '');
                        if (!accessCode) {
                            wx.showToast({ title: '请输入审核体验码', icon: 'none' });
                            return [2 /*return*/];
                        }
                        this.setData({ reviewSubmitting: true });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, require('../../../services/cloud').call('reviewSession', { operation: 'open', role: role, accessCode: accessCode })];
                    case 2:
                        _a.sent();
                        app = getApp();
                        if (app && app.globalData) {
                            app.globalData.user = null;
                            app.globalData.authSnapshot = null;
                        }
                        wx.reLaunch({ url: role === 'teacher' ? '/pages/teacher/home/index' : '/pages/home/index' });
                        return [3 /*break*/, 5];
                    case 3:
                        error_2 = _a.sent();
                        wx.showToast({ title: String(error_2.message || '审核通道未开放'), icon: 'none' });
                        return [3 /*break*/, 5];
                    case 4:
                        this.setData({ reviewSubmitting: false });
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    },
    toggleAgreement: function () {
        if (this.data.entering)
            return;
        this.setData({ agreementAccepted: !this.data.agreementAccepted });
    },
    openAgreement: function () {
        wx.navigateTo({ url: '/pages/legal/agreement/index' });
    },
    openPrivacy: function () {
        wx.navigateTo({ url: '/pages/legal/privacy/index' });
    },
    openChildrenPrivacy: function () {
        wx.navigateTo({ url: '/pages/legal/children-privacy/index' });
    },
    choose: function (event) {
        return __awaiter(this, void 0, void 0, function () {
            var role, privacyDialog, error_1, code;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.entering)
                            return [2 /*return*/];
                        if (!this.data.agreementAccepted) {
                            wx.showToast({ title: '请先阅读并同意用户协议和隐私政策', icon: 'none' });
                            return [2 /*return*/];
                        }
                        role = String(event.currentTarget.dataset.role || '');
                        if (role !== 'student' && role !== 'teacher')
                            return [2 /*return*/];
                        this.setData({ entering: true });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, 5, 6]);
                        privacyDialog = this.selectComponent('#privacyDialog');
                        if (!(privacyDialog === null || privacyDialog === void 0 ? void 0 : privacyDialog.requestAuthorization)) return [3 /*break*/, 3];
                        return [4 /*yield*/, privacyDialog.requestAuthorization()];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        wx.navigateTo({ url: role === 'student' ? '/pages/auth/student/index' : '/pages/auth/teacher/index' });
                        return [3 /*break*/, 6];
                    case 4:
                        error_1 = _a.sent();
                        code = String((error_1 === null || error_1 === void 0 ? void 0 : error_1.code) || '');
                        if (code === 'PRIVACY_DENIED' || code === 'PRIVACY_AUTH_FAILED') {
                            wx.showToast({ title: '需同意隐私授权后才能进入系统', icon: 'none' });
                        }
                        else {
                            wx.showToast({ title: '隐私授权未完成，请重试', icon: 'none' });
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        this.setData({ entering: false });
                        return [7 /*endfinally*/];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
});
