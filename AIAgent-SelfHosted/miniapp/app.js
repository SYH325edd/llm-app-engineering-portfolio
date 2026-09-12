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
var cloud_1 = require("./config/cloud");
var runtime_compat_1 = require("./utils/runtime-compat");
var entry_route_1 = require("./utils/entry-route");
var selfhost_cloud_1 = require("./services/selfhost-cloud");
(0, selfhost_cloud_1.installSelfHostedCloud)();
function sanitizeErrorText(value) {
    return String(value).replace(/(openid|token|authorization|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 500);
}
function getErrorCode(error) {
    return String((error === null || error === void 0 ? void 0 : error.errCode) || (error === null || error === void 0 ? void 0 : error.code) || '').toUpperCase();
}
function getErrorMessage(error) {
    return sanitizeErrorText((error === null || error === void 0 ? void 0 : error.errMsg) || (error === null || error === void 0 ? void 0 : error.message) || error || 'unknown error');
}
function isEnvironmentError(error) {
    var detail = "".concat(getErrorCode(error), " ").concat(getErrorMessage(error)).toUpperCase();
    return /(ENVIRONMENT|ENV).*(NOT[ _-]?(FOUND|EXIST)|INVALID)/.test(detail)
        || /APPID.*MISMATCH/.test(detail);
}
function isFunctionNotFound(error) {
    var detail = "".concat(getErrorCode(error), " ").concat(getErrorMessage(error)).toUpperCase();
    return detail.indexOf('FUNCTION_NOT_FOUND') >= 0 || detail.indexOf('FUNCTION NOT FOUND') >= 0;
}
function isTimeoutError(error) {
    var detail = "".concat(getErrorCode(error), " ").concat(getErrorMessage(error)).toUpperCase();
    return detail.indexOf('CLOUD_CALL_TIMEOUT') >= 0 || detail.indexOf('TIMEOUT') >= 0;
}
function isNetworkError(error) {
    var detail = "".concat(getErrorCode(error), " ").concat(getErrorMessage(error)).toUpperCase();
    return /NETWORK|ERR_NETWORK|REQUEST:FAIL|CONNECTION.*FAIL/.test(detail);
}
function isInfrastructureError(error) {
    var code = getErrorCode(error);
    return isFunctionNotFound(error)
        || isEnvironmentError(error)
        || isTimeoutError(error)
        || isNetworkError(error)
        || code === 'PERMISSION_DENIED'
        || code === 'WX_CLOUD_UNAVAILABLE'
        || code === 'COLLECTION_NOT_FOUND';
}
function cloudError(error, functionName) {
    var source = error instanceof Error ? error : new Error(getErrorMessage(error));
    return Object.assign(source, {
        code: String((error === null || error === void 0 ? void 0 : error.code) || (error === null || error === void 0 ? void 0 : error.errCode) || source.name || 'CLOUD_CALL_FAILED'),
        errCode: String((error === null || error === void 0 ? void 0 : error.errCode) || (error === null || error === void 0 ? void 0 : error.code) || ''),
        errMsg: getErrorMessage(error),
        functionName: functionName,
        environmentId: cloud_1.CLOUD_ENV_ID,
    });
}
function callAppApiWithTimeout() {
    return new Promise(function (resolve, reject) {
        var settled = false;
        var finish = function (callback, value) {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };
        var timer = setTimeout(function () {
            finish(reject, cloudError({ code: 'CLOUD_CALL_TIMEOUT', errCode: 'CLOUD_CALL_TIMEOUT', errMsg: '云服务连接超时，请重试。' }, 'appApi'));
        }, 15000);
        try {
            Promise.resolve(wx.cloud.callFunction({ name: 'appApi', data: { action: 'bootstrap' } }))
                .then(function (response) { return finish(resolve, response); }, function (error) { return finish(reject, cloudError(error, 'appApi')); });
        }
        catch (error) {
            finish(reject, cloudError(error, 'appApi'));
        }
    });
}
App({
    globalData: {
        user: null,
        cloudReady: false,
        startupError: '',
        startupErrorInfo: null,
        cloudEnvId: cloud_1.CLOUD_ENV_ID,
        authSnapshot: null,
    },
    onLaunch: function () {
        (0, runtime_compat_1.installRuntimeCompat)();
        try {
            this.initCloud();
        }
        catch (error) {
            this.setStartupError('connection', error);
        }
    },
    initCloud: function () {
        this.globalData.cloudReady = false;
        this.globalData.startupError = '';
        this.globalData.startupErrorInfo = null;
        if (!wx.cloud) {
            this.setStartupError('connection', { errCode: 'WX_CLOUD_UNAVAILABLE', errMsg: 'wx.cloud is unavailable', functionName: 'wx.cloud.init' });
            return false;
        }
        if (!(0, cloud_1.isCloudEnvConfigured)()) {
            this.setStartupError('configuration', { errCode: 'CLOUD_ENV_NOT_CONFIGURED', errMsg: 'CLOUD_ENV_ID is empty or placeholder' });
            return false;
        }
        try {
            wx.cloud.init({ env: cloud_1.CLOUD_ENV_ID, traceUser: true });
            this.globalData.cloudReady = true;
            return true;
        }
        catch (error) {
            this.setStartupError(isEnvironmentError(error) ? 'configuration' : 'connection', error);
            return false;
        }
    },
    setStartupError: function (kind, error) {
        var code = getErrorCode(error);
        var detail = getErrorMessage(error);
        var systemInfo = {};
        try {
            systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
        }
        catch (_a) { }
        var message = isFunctionNotFound(error)
            ? 'appApi尚未部署或部署环境不一致。'
            : isEnvironmentError(error)
                ? '云环境配置异常。'
                : isTimeoutError(error)
                    ? '云服务连接超时，请重试。'
                    : isNetworkError(error)
                        ? '网络连接异常，请检查网络后重试。'
                        : kind === 'configuration'
                            ? '小程序运行环境待配置，请检查云环境设置。'
                            : '云服务暂时不可用，请稍后重试。';
        this.globalData.startupError = message;
        this.globalData.startupErrorInfo = {
            kind: kind,
            code: code,
            message: message,
            detail: detail,
            functionName: String((error === null || error === void 0 ? void 0 : error.functionName) || ''),
            environmentId: String((error === null || error === void 0 ? void 0 : error.environmentId) || cloud_1.CLOUD_ENV_ID),
            platform: String(systemInfo.platform || ''),
            SDKVersion: String(systemInfo.SDKVersion || ''),
        };
    },
    bootstrapPromise: null,
    navigationInFlight: false,
    bootstrap: function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                if (this.bootstrapPromise)
                    return [2 /*return*/, this.bootstrapPromise];
                this.bootstrapPromise = this.bootstrapOnce().finally(function () { _this.bootstrapPromise = null; });
                return [2 /*return*/, this.bootstrapPromise];
            });
        });
    },
    bootstrapOnce: function () {
        return __awaiter(this, void 0, void 0, function () {
            var response, body, error, snapshot_1, snapshot, error_1;
            var _a, _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        _e.trys.push([0, 2, , 3]);
                        if (!this.globalData.cloudReady && !this.initCloud())
                            throw new Error(this.globalData.startupError || '微信云开发尚未就绪');
                        return [4 /*yield*/, callAppApiWithTimeout()];
                    case 1:
                        response = _e.sent();
                        body = response === null || response === void 0 ? void 0 : response.result;
                        if (!(body === null || body === void 0 ? void 0 : body.success)) {
                            error = cloudError({
                                code: (body === null || body === void 0 ? void 0 : body.code) || 'BOOTSTRAP_FAILED',
                                errCode: (body === null || body === void 0 ? void 0 : body.code) || 'BOOTSTRAP_FAILED',
                                errMsg: (body === null || body === void 0 ? void 0 : body.message) || '初始化失败',
                                functionName: 'appApi',
                            }, 'appApi');
                            if (isInfrastructureError(error))
                                throw error;
                            snapshot_1 = {
                                user: null,
                                needsRegistration: false,
                                accountStatus: String((body === null || body === void 0 ? void 0 : body.code) || 'ACCOUNT_STATUS_ERROR'),
                                message: getErrorMessage(error),
                                businessError: true,
                                role: '', status: '', resolvedRoute: (0, entry_route_1.resolveEntryRoute)({ user: null, needsRegistration: true }),
                            };
                            this.globalData.authSnapshot = snapshot_1;
                            return [2 /*return*/, snapshot_1];
                        }
                        this.globalData.user = body.data.user;
                        this.globalData.startupError = '';
                        this.globalData.startupErrorInfo = null;
                        snapshot = __assign(__assign({}, body.data), { role: String(((_b = (_a = body.data) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.role) || ''), status: String(((_d = (_c = body.data) === null || _c === void 0 ? void 0 : _c.user) === null || _d === void 0 ? void 0 : _d.status) || ''), resolvedRoute: (0, entry_route_1.resolveEntryRoute)(body.data) });
                        this.globalData.authSnapshot = snapshot;
                        return [2 /*return*/, snapshot];
                    case 2:
                        error_1 = _e.sent();
                        if (isInfrastructureError(error_1))
                            this.setStartupError(isEnvironmentError(error_1) ? 'configuration' : 'connection', error_1);
                        throw error_1;
                    case 3: return [2 /*return*/];
                }
            });
        });
    },
    navigateToResolvedRoute: function (source, snapshot) {
        return __awaiter(this, void 0, void 0, function () {
            var auth, _a, targetRoute, currentRoute, pages, finish, options;
            var _this = this;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _a = snapshot || this.globalData.authSnapshot;
                        if (_a) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.bootstrap()];
                    case 1:
                        _a = (_c.sent());
                        _c.label = 2;
                    case 2:
                        auth = _a;
                        targetRoute = (0, entry_route_1.routePath)(auth.resolvedRoute);
                        currentRoute = '';
                        try {
                            pages = getCurrentPages();
                            currentRoute = String(((_b = pages[pages.length - 1]) === null || _b === void 0 ? void 0 : _b.route) || '');
                        }
                        catch (_d) { }
                        if (this.navigationInFlight || currentRoute === targetRoute)
                            return [2 /*return*/, false];
                        this.navigationInFlight = true;
                        finish = function () { _this.navigationInFlight = false; };
                        options = { url: "/".concat(auth.resolvedRoute), success: finish, fail: finish };
                        if (targetRoute === 'pages/teacher/home/index' || targetRoute === 'pages/home/index')
                            wx.switchTab(options);
                        else
                            wx.reLaunch(options);
                        return [2 /*return*/, true];
                }
            });
        });
    },
});
