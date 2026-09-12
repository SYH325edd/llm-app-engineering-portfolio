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
exports.call = call;
exports.getTaskStatus = getTaskStatus;
exports.callFunction = callFunction;
function appReady() {
    var _a;
    var app = getApp();
    return Boolean((_a = app === null || app === void 0 ? void 0 : app.globalData) === null || _a === void 0 ? void 0 : _a.cloudReady);
}
function normalizeError(error) {
    var _a, _b, _c, _d;
    var message = String((error === null || error === void 0 ? void 0 : error.message) ||
        (error === null || error === void 0 ? void 0 : error.errMsg) ||
        ((_a = error === null || error === void 0 ? void 0 : error.result) === null || _a === void 0 ? void 0 : _a.message) ||
        error ||
        '请求失败');
    var e = new Error(message);
    e.code = (error === null || error === void 0 ? void 0 : error.code) || (error === null || error === void 0 ? void 0 : error.errCode) || ((_b = error === null || error === void 0 ? void 0 : error.result) === null || _b === void 0 ? void 0 : _b.code) || 'CLOUD_FUNCTION_ERROR';
    e.requestId = (error === null || error === void 0 ? void 0 : error.requestId) || (error === null || error === void 0 ? void 0 : error.requestID) || ((_c = error === null || error === void 0 ? void 0 : error.result) === null || _c === void 0 ? void 0 : _c.request_id);
    e.data = (error === null || error === void 0 ? void 0 : error.data) || ((_d = error === null || error === void 0 ? void 0 : error.result) === null || _d === void 0 ? void 0 : _d.data);
    return e;
}
function withTimeout(promise_1) {
    return __awaiter(this, arguments, void 0, function (promise, timeoutMs) {
        var timer;
        if (timeoutMs === void 0) { timeoutMs = 20000; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    timer = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 3, 4]);
                    return [4 /*yield*/, Promise.race([
                            promise,
                            new Promise(function (_, reject) {
                                timer = setTimeout(function () { return reject(new Error('请求超时，请稍后重试')); }, timeoutMs);
                            }),
                        ])];
                case 2: return [2 /*return*/, _a.sent()];
                case 3:
                    if (timer)
                        clearTimeout(timer);
                    return [7 /*endfinally*/];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function call(action_1) {
    return __awaiter(this, arguments, void 0, function (action, data, timeoutMs) {
        var response, body, error, error_1;
        if (data === void 0) { data = {}; }
        if (timeoutMs === void 0) { timeoutMs = 20000; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!appReady()) {
                        throw new Error('微信云开发尚未就绪，请先完成启动配置');
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, withTimeout(wx.cloud.callFunction({ name: 'appApi', data: __assign({ action: action }, data) }), timeoutMs)];
                case 2:
                    response = _a.sent();
                    body = response === null || response === void 0 ? void 0 : response.result;
                    if (!(body === null || body === void 0 ? void 0 : body.success)) {
                        error = new Error((body === null || body === void 0 ? void 0 : body.message) || '请求失败');
                        error.code = body === null || body === void 0 ? void 0 : body.code;
                        error.requestId = (body === null || body === void 0 ? void 0 : body.request_id) || (body === null || body === void 0 ? void 0 : body.requestId);
                        error.data = body === null || body === void 0 ? void 0 : body.data;
                        throw error;
                    }
                    return [2 /*return*/, body.data];
                case 3:
                    error_1 = _a.sent();
                    throw normalizeError(error_1);
                case 4: return [2 /*return*/];
            }
        });
    });
}
function getTaskStatus(taskId, timeoutMs, viewerParams) {
    if (viewerParams === void 0) { viewerParams = {}; }
    return call('getTaskStatus', __assign({ taskId: taskId }, viewerParams), timeoutMs);
}
function callFunction(name_1) {
    return __awaiter(this, arguments, void 0, function (name, data, timeoutMs) {
        var response, body, error, error_2;
        if (data === void 0) { data = {}; }
        if (timeoutMs === void 0) { timeoutMs = 20000; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!appReady()) {
                        throw new Error('微信云开发尚未就绪，请先完成启动配置');
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, withTimeout(wx.cloud.callFunction({ name: name, data: data }), timeoutMs)];
                case 2:
                    response = _a.sent();
                    body = response === null || response === void 0 ? void 0 : response.result;
                    if (!(body === null || body === void 0 ? void 0 : body.success)) {
                        error = new Error((body === null || body === void 0 ? void 0 : body.message) || '请求失败');
                        error.code = body === null || body === void 0 ? void 0 : body.code;
                        error.requestId = (body === null || body === void 0 ? void 0 : body.request_id) || (body === null || body === void 0 ? void 0 : body.requestId);
                        throw error;
                    }
                    return [2 /*return*/, body.data];
                case 3:
                    error_2 = _a.sent();
                    throw normalizeError(error_2);
                case 4: return [2 /*return*/];
            }
        });
    });
}
