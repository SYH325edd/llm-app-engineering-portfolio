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
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.overallProgress = overallProgress;
exports.uploadTaskImages = uploadTaskImages;
exports.uploadImages = uploadImages;
function extension(path) { var match = /\.([a-z0-9]+)$/i.exec(path); var ext = ((match === null || match === void 0 ? void 0 : match[1]) || 'jpg').toLowerCase(); if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext))
    throw new Error('仅支持 JPG、PNG、WEBP 图片'); return ext; }
function info(path) {
    return __awaiter(this, void 0, void 0, function () { return __generator(this, function (_a) {
        return [2 /*return*/, new Promise(function (resolve, reject) { return wx.getFileInfo({ filePath: path, success: resolve, fail: reject }); })];
    }); });
}
function remove(fileIds) {
    return __awaiter(this, void 0, void 0, function () { return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!fileIds.length) return [3 /*break*/, 2];
                return [4 /*yield*/, wx.cloud.deleteFile({ fileList: fileIds }).catch(function () { })];
            case 1:
                _a.sent();
                _a.label = 2;
            case 2: return [2 /*return*/];
        }
    }); });
}
function uploadOne(cloudPath, filePath, progress) {
    return new Promise(function (resolve, reject) {
        var _a;
        var task = wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: filePath, success: function (result) { return (result === null || result === void 0 ? void 0 : result.fileID) ? resolve(result.fileID) : reject(new Error('云存储未返回文件编号')); }, fail: reject });
        if (typeof (task === null || task === void 0 ? void 0 : task.then) === 'function')
            task.then(function (result) { return (result === null || result === void 0 ? void 0 : result.fileID) ? resolve(result.fileID) : reject(new Error('Cloud storage did not return file ID')); }).catch(reject);
        else
            (_a = task.onProgressUpdate) === null || _a === void 0 ? void 0 : _a.call(task, function (event) { return progress(Math.max(0, Math.min(100, Number(event.progress || 0)))); });
    });
}
function overallProgress(index, current, total) { return total ? Math.round(((index + current / 100) / total) * 100) : 0; }
function uploadTaskImages(studentPaths, answerPaths, onProgress) {
    return __awaiter(this, void 0, void 0, function () {
        var entries, unique, entries_1, entries_1_1, entry, file, e_1_1, uploaded, studentImageFileIds, answerImageFileIds, _loop_1, index, error_1;
        var e_1, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    entries = __spreadArray(__spreadArray([], __read(studentPaths.map(function (path) { return ({ path: path, kind: 'student' }); })), false), __read(answerPaths.map(function (path) { return ({ path: path, kind: 'answer' }); })), false);
                    if (!studentPaths.length || studentPaths.length > 3 || answerPaths.length > 3)
                        throw new Error('Invalid image count');
                    unique = new Set(entries.map(function (entry) { return entry.path; }));
                    if (unique.size !== entries.length)
                        throw new Error('请勿重复选择同一图片');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 6, 7, 8]);
                    entries_1 = __values(entries), entries_1_1 = entries_1.next();
                    _b.label = 2;
                case 2:
                    if (!!entries_1_1.done) return [3 /*break*/, 5];
                    entry = entries_1_1.value;
                    if (!entry.path)
                        throw new Error('Image file is missing');
                    extension(entry.path);
                    return [4 /*yield*/, info(entry.path)];
                case 3:
                    file = _b.sent();
                    if (Number(file.size || 0) > 5 * 1024 * 1024)
                        throw new Error('Image exceeds 5MB');
                    _b.label = 4;
                case 4:
                    entries_1_1 = entries_1.next();
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 8];
                case 6:
                    e_1_1 = _b.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 8];
                case 7:
                    try {
                        if (entries_1_1 && !entries_1_1.done && (_a = entries_1.return)) _a.call(entries_1);
                    }
                    finally { if (e_1) throw e_1.error; }
                    return [7 /*endfinally*/];
                case 8:
                    uploaded = [];
                    studentImageFileIds = [];
                    answerImageFileIds = [];
                    _b.label = 9;
                case 9:
                    _b.trys.push([9, 14, , 16]);
                    _loop_1 = function (index) {
                        var entry, ext, id;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    entry = entries[index];
                                    ext = extension(entry.path);
                                    onProgress({ currentIndex: index + 1, totalCount: entries.length, currentFileProgress: 0, overallProgress: overallProgress(index, 0, entries.length), successCount: uploaded.length, failedCount: 0, uploadMessage: "Uploading ".concat(index + 1, "/").concat(entries.length) });
                                    return [4 /*yield*/, uploadOne("uploads/".concat(entry.kind, "/").concat(Date.now(), "_").concat(index, ".").concat(ext), entry.path, function (currentFileProgress) { return onProgress({ currentIndex: index + 1, totalCount: entries.length, currentFileProgress: currentFileProgress, overallProgress: overallProgress(index, currentFileProgress, entries.length), successCount: uploaded.length, failedCount: 0, uploadMessage: "Uploading ".concat(index + 1, "/").concat(entries.length) }); })];
                                case 1:
                                    id = _c.sent();
                                    uploaded.push(id);
                                    (entry.kind === 'student' ? studentImageFileIds : answerImageFileIds).push(id);
                                    return [2 /*return*/];
                            }
                        });
                    };
                    index = 0;
                    _b.label = 10;
                case 10:
                    if (!(index < entries.length)) return [3 /*break*/, 13];
                    return [5 /*yield**/, _loop_1(index)];
                case 11:
                    _b.sent();
                    _b.label = 12;
                case 12:
                    index += 1;
                    return [3 /*break*/, 10];
                case 13:
                    onProgress({ currentIndex: entries.length, totalCount: entries.length, currentFileProgress: 100, overallProgress: 100, successCount: uploaded.length, failedCount: 0, uploadMessage: '图片上传完成' });
                    return [2 /*return*/, { studentImageFileIds: studentImageFileIds, answerImageFileIds: answerImageFileIds }];
                case 14:
                    error_1 = _b.sent();
                    return [4 /*yield*/, remove(uploaded)];
                case 15:
                    _b.sent();
                    onProgress({ currentIndex: uploaded.length + 1, totalCount: entries.length, currentFileProgress: 0, overallProgress: overallProgress(uploaded.length, 0, entries.length), successCount: 0, failedCount: 1, uploadMessage: "Upload failed: ".concat(String((error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || 'retry').slice(0, 80)) });
                    throw error_1;
                case 16: return [2 /*return*/];
            }
        });
    });
}
// Compatibility for the confirmation page, which uploads supplementary images separately.
function uploadImages(paths, kind) {
    return __awaiter(this, void 0, void 0, function () {
        var paths_1, paths_1_1, path, file, e_2_1, uploaded, index, ext, _a, _b, error_2;
        var e_2, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (!paths.length || paths.length > 3)
                        throw new Error('Invalid image count');
                    if (new Set(paths).size !== paths.length)
                        throw new Error('Duplicate image file');
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 6, 7, 8]);
                    paths_1 = __values(paths), paths_1_1 = paths_1.next();
                    _d.label = 2;
                case 2:
                    if (!!paths_1_1.done) return [3 /*break*/, 5];
                    path = paths_1_1.value;
                    if (!path)
                        throw new Error('Image file is missing');
                    extension(path);
                    return [4 /*yield*/, info(path)];
                case 3:
                    file = _d.sent();
                    if (Number(file.size || 0) > 5 * 1024 * 1024)
                        throw new Error('Image exceeds 5MB');
                    _d.label = 4;
                case 4:
                    paths_1_1 = paths_1.next();
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 8];
                case 6:
                    e_2_1 = _d.sent();
                    e_2 = { error: e_2_1 };
                    return [3 /*break*/, 8];
                case 7:
                    try {
                        if (paths_1_1 && !paths_1_1.done && (_c = paths_1.return)) _c.call(paths_1);
                    }
                    finally { if (e_2) throw e_2.error; }
                    return [7 /*endfinally*/];
                case 8:
                    uploaded = [];
                    _d.label = 9;
                case 9:
                    _d.trys.push([9, 14, , 16]);
                    index = 0;
                    _d.label = 10;
                case 10:
                    if (!(index < paths.length)) return [3 /*break*/, 13];
                    ext = extension(paths[index]);
                    _b = (_a = uploaded).push;
                    return [4 /*yield*/, uploadOne("uploads/".concat(kind, "/").concat(Date.now(), "_").concat(index, ".").concat(ext), paths[index], function () { })];
                case 11:
                    _b.apply(_a, [_d.sent()]);
                    _d.label = 12;
                case 12:
                    index += 1;
                    return [3 /*break*/, 10];
                case 13: return [2 /*return*/, uploaded];
                case 14:
                    error_2 = _d.sent();
                    return [4 /*yield*/, remove(uploaded)];
                case 15:
                    _d.sent();
                    throw error_2;
                case 16: return [2 /*return*/];
            }
        });
    });
}
