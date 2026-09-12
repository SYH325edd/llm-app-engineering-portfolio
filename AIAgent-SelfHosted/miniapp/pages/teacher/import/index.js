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
var customer_1 = require("../../../config/customer");
var cloud_1 = require("../../../services/cloud");
Page({
    data: {
        report: null,
        loading: false,
        templateLoading: false,
        templatePreviewVisible: false,
        templateData: null,
        authorizationConfirmed: false,
        authorizationVersion: customer_1.CUSTOMER_DISPLAY_CONFIG.childrenPrivacyVersion,
    },
    loadTemplateData: function () {
        var _this = this;
        if (this.data.templateData) return Promise.resolve(this.data.templateData);
        if (this._templateRequest) return this._templateRequest;
        this.setData({ templateLoading: true });
        this._templateRequest = (0, cloud_1.call)('getRosterImportTemplate').then(function (data) {
            _this.setData({ templateData: data });
            return data;
        }).finally(function () {
            _this._templateRequest = null;
            _this.setData({ templateLoading: false });
        });
        return this._templateRequest;
    },
    previewTemplate: function () {
        var _this = this;
        return this.loadTemplateData().then(function () {
            _this.setData({ templatePreviewVisible: !_this.data.templatePreviewVisible });
        }).catch(function (error) {
            wx.showModal({ title: '模板加载失败', content: error.message || '请稍后重试', showCancel: false });
        });
    },
    downloadTemplate: function () {
        return this.loadTemplateData().then(function (data) {
            return new Promise(function (resolve, reject) {
                var filePath = wx.env.USER_DATA_PATH + '/' + String(data.fileName || '学生名单导入模板.xlsx');
                wx.getFileSystemManager().writeFile({
                    filePath: filePath,
                    data: data.base64,
                    encoding: 'base64',
                    success: function () {
                        wx.openDocument({ filePath: filePath, fileType: 'xlsx', showMenu: true, success: resolve, fail: reject });
                    },
                    fail: reject,
                });
            });
        }).catch(function (error) {
            wx.showModal({ title: '模板下载失败', content: error.message || error.errMsg || '请稍后重试', showCancel: false });
        });
    },
    toggleAuthorization: function () {
        if (this.data.loading)
            return;
        this.setData({ authorizationConfirmed: !this.data.authorizationConfirmed });
    },
    openChildrenPrivacy: function () {
        wx.navigateTo({ url: '/pages/legal/children-privacy/index' });
    },
    choose: function () {
        return __awaiter(this, void 0, void 0, function () {
            var uploadedFileId, privacyDialog, result, file, upload, report, error_1, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (this.data.loading)
                            return [2 /*return*/];
                        if (!this.data.authorizationConfirmed) {
                            wx.showToast({ title: '请先确认学生信息授权', icon: 'none' });
                            return [2 /*return*/];
                        }
                        this.setData({ loading: true });
                        uploadedFileId = '';
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 7, 8, 13]);
                        privacyDialog = this.selectComponent('#privacyDialog');
                        if (!(privacyDialog === null || privacyDialog === void 0 ? void 0 : privacyDialog.requestAuthorization)) return [3 /*break*/, 3];
                        return [4 /*yield*/, privacyDialog.requestAuthorization()];
                    case 2:
                        _b.sent();
                        _b.label = 3;
                    case 3: return [4 /*yield*/, wx.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx', 'xls'] })];
                    case 4:
                        result = _b.sent();
                        file = result.tempFiles && result.tempFiles[0];
                        if (!file || !file.path)
                            throw new Error('没有读取到Excel文件');
                        if (Number(file.size || 0) > 5 * 1024 * 1024)
                            throw new Error('Excel文件不能超过5MB');
                        return [4 /*yield*/, wx.cloud.uploadFile({
                                cloudPath: "imports/".concat(Date.now(), "_").concat(Math.random().toString(36).slice(2, 8), "_").concat(file.name || 'roster.xlsx'),
                                filePath: file.path,
                            })];
                    case 5:
                        upload = _b.sent();
                        uploadedFileId = upload.fileID;
                        return [4 /*yield*/, (0, cloud_1.call)('importRoster', {
                                fileID: uploadedFileId,
                                consentConfirmed: true,
                                consentVersion: this.data.authorizationVersion,
                            }, 180000)];
                    case 6:
                        report = _b.sent();
                        this.setData({ report: report });
                        return [3 /*break*/, 13];
                    case 7:
                        error_1 = _b.sent();
                        if (String(error_1 && error_1.errMsg || '').indexOf('cancel') < 0) {
                            wx.showModal({ title: '导入失败', content: error_1.message || error_1.errMsg || '导入失败', showCancel: false });
                        }
                        return [3 /*break*/, 13];
                    case 8:
                        if (!(uploadedFileId && wx.cloud && typeof wx.cloud.deleteFile === 'function')) return [3 /*break*/, 12];
                        _b.label = 9;
                    case 9:
                        _b.trys.push([9, 11, , 12]);
                        return [4 /*yield*/, wx.cloud.deleteFile({ fileList: [uploadedFileId] })];
                    case 10:
                        _b.sent();
                        return [3 /*break*/, 12];
                    case 11:
                        _a = _b.sent();
                        return [3 /*break*/, 12];
                    case 12:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 13: return [2 /*return*/];
                }
            });
        });
    },
});
