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
    data: { name: '', region: '', loading: false },
    set: function (e) {
        var _a;
        this.setData((_a = {}, _a[e.currentTarget.dataset.k] = e.detail.value, _a));
    },
    submit: function () {
        return __awaiter(this, void 0, void 0, function () {
            var name, region, error_1, requestId, content;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (this.data.loading)
                            return [2 /*return*/];
                        name = this.data.name.trim();
                        region = this.data.region.trim();
                        if (!name || !region) {
                            wx.showToast({ title: '请填写姓名和任教地区', icon: 'none' });
                            return [2 /*return*/];
                        }
                        this.setData({ loading: true });
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, (0, cloud_1.call)('registerTeacher', { name: name, scopes: [{ grade: '', className: region }] })];
                    case 2:
                        _b.sent();
                        wx.reLaunch({ url: '/pages/auth/pending/index?status=PENDING' });
                        return [3 /*break*/, 5];
                    case 3:
                        error_1 = _b.sent();
                        requestId = (error_1 === null || error_1 === void 0 ? void 0 : error_1.requestId) ? "\n\u8BF7\u6C42\u7F16\u53F7\uFF1A".concat(error_1.requestId) : '';
                        content = (error_1 === null || error_1 === void 0 ? void 0 : error_1.code) === 'COLLECTION_NOT_FOUND'
                            ? "\u6570\u636E\u5E93\u5C1A\u672A\u521D\u59CB\u5316\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u521D\u59CB\u5316 ".concat(((_a = error_1 === null || error_1 === void 0 ? void 0 : error_1.data) === null || _a === void 0 ? void 0 : _a.collection) || '所需集合', "\u3002").concat(requestId)
                            : "".concat(error_1.message || '提交失败，请稍后重试').concat(requestId);
                        wx.showModal({ title: '提交失败', content: content, showCancel: false });
                        return [3 /*break*/, 5];
                    case 4:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    },
});
