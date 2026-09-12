"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installSelfHostedCloud = installSelfHostedCloud;

var backend_1 = require("../config/backend");
var TOKEN_KEY = 'aiagent_selfhost_session_v1';
var loginPromise = null;

function apiUrl(path) {
    return String(backend_1.API_BASE_URL || '').replace(/\/$/, '') + path;
}

function wxLogin() {
    return new Promise(function (resolve, reject) {
        wx.login({ success: resolve, fail: reject });
    });
}

function request(options) {
    return new Promise(function (resolve, reject) {
        wx.request(Object.assign({}, options, { success: resolve, fail: reject }));
    });
}

function storedToken() {
    try { return String(wx.getStorageSync(TOKEN_KEY) || ''); }
    catch (_) { return ''; }
}
function saveToken(token) {
    try { wx.setStorageSync(TOKEN_KEY, token); }
    catch (_) { }
}
function clearToken() {
    try { wx.removeStorageSync(TOKEN_KEY); }
    catch (_) { }
}

function login() {
    if (loginPromise) return loginPromise;
    loginPromise = Promise.resolve().then(function () { return wxLogin(); }).then(function (result) {
        if (!result || !result.code) throw new Error('wx.login 未返回 code');
        return request({
            url: apiUrl('/api/auth/wechat'),
            method: 'POST',
            header: { 'content-type': 'application/json' },
            data: { code: result.code },
            timeout: 15000,
        });
    }).then(function (response) {
        var body = response && response.data;
        if (!response || response.statusCode < 200 || response.statusCode >= 300 || !body || !body.token)
            throw new Error((body && body.message) || '微信登录验证失败');
        saveToken(body.token);
        return body.token;
    }).finally(function () { loginPromise = null; });
    return loginPromise;
}

function ensureToken(force) {
    var token = !force && storedToken();
    return token ? Promise.resolve(token) : login();
}

function authedJson(path, data, retry) {
    if (retry === void 0) retry = true;
    return ensureToken(false).then(function (token) {
        return request({
            url: apiUrl(path), method: 'POST',
            header: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
            data: data || {}, timeout: 120000,
        });
    }).then(function (response) {
        if (response.statusCode === 401 && retry) {
            clearToken();
            return ensureToken(true).then(function () { return authedJson(path, data, false); });
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
            var body = response.data || {};
            var error = new Error(body.message || ('HTTP ' + response.statusCode));
            error.code = body.code || 'HTTP_ERROR';
            throw error;
        }
        return response.data;
    });
}

function callFunction(options) {
    options = options || {};
    return authedJson('/api/function/' + encodeURIComponent(String(options.name || '')), options.data || {})
        .then(function (result) { return { result: result }; });
}

function uploadFile(options) {
    options = options || {};
    var actualTask = null;
    var progressHandlers = [];
    var aborted = false;
    var promise = ensureToken(false).then(function (token) {
        return new Promise(function (resolve, reject) {
            if (aborted) return reject(new Error('upload aborted'));
            actualTask = wx.uploadFile({
                url: apiUrl('/api/storage/upload?cloudPath=' + encodeURIComponent(String(options.cloudPath || ''))),
                filePath: options.filePath,
                name: 'file',
                header: { authorization: 'Bearer ' + token },
                timeout: 120000,
                success: function (response) {
                    var body = {};
                    try { body = typeof response.data === 'string' ? JSON.parse(response.data) : (response.data || {}); } catch (_) { }
                    if (response.statusCode >= 200 && response.statusCode < 300 && body.fileID) {
                        var result = { fileID: body.fileID };
                        if (typeof options.success === 'function') options.success(result);
                        resolve(result);
                    } else {
                        var error = new Error(body.message || ('upload HTTP ' + response.statusCode));
                        error.code = body.code || 'UPLOAD_FAILED';
                        if (typeof options.fail === 'function') options.fail(error);
                        reject(error);
                    }
                },
                fail: function (error) {
                    if (typeof options.fail === 'function') options.fail(error);
                    reject(error);
                },
            });
            progressHandlers.forEach(function (handler) { if (actualTask && actualTask.onProgressUpdate) actualTask.onProgressUpdate(handler); });
        });
    });
    return {
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        finally: promise.finally.bind(promise),
        onProgressUpdate: function (handler) {
            if (typeof handler !== 'function') return;
            progressHandlers.push(handler);
            if (actualTask && actualTask.onProgressUpdate) actualTask.onProgressUpdate(handler);
        },
        abort: function () { aborted = true; if (actualTask && actualTask.abort) actualTask.abort(); },
    };
}

function deleteFile(options) {
    options = options || {};
    return authedJson('/api/storage/delete', { fileList: options.fileList || [] });
}

function installSelfHostedCloud() {
    if (!(0, backend_1.isSelfHosted)()) return false;
    if (typeof wx === 'undefined') return false;
    wx.cloud = { init: function () { }, callFunction: callFunction, uploadFile: uploadFile, deleteFile: deleteFile };
    return true;
}
