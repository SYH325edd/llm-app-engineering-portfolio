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
exports.replaceCroppedImage = replaceCroppedImage;
var upload_1 = require("../../../services/upload");
var cloud_1 = require("../../../services/cloud");
var student_result_visibility_1 = require("../../../utils/student-result-visibility");
function saveDraft(data) { var previous = wx.getStorageSync('pendingTaskDraft') || {}; wx.setStorageSync('pendingTaskDraft', { studentPaths: data.studentImages, answerPaths: data.answerImages, manualAnswer: data.manualAnswer, title: data.title, grade: data.grade, parentTaskId: data.parentTaskId, mode: data.mode, carelessTrainingType: data.carelessTrainingType || previous.carelessTrainingType || 'READING' }); }
function replaceCroppedImage(paths, index, sourcePath, croppedPath) {
    if (!croppedPath || paths[index] !== sourcePath)
        return paths;
    return paths.map(function (path, currentIndex) { return currentIndex === index ? croppedPath : path; });
}
var minimumCropSize = 80;
Page({
    data: { taskId: '', studentImages: [], answerImages: [], manualAnswer: '', loading: false, uploading: false, title: '', grade: '', parentTaskId: '', mode: 'HARD_PROBLEM_CHECK', uploadProgress: '未上传', cropVisible: false, cropKind: '', cropIndex: -1, cropSourcePath: '', cropImagePath: '', cropImageWidth: 0, cropImageHeight: 0, cropScale: 1, cropLeft: 0, cropTop: 0, cropFrameLeft: 0, cropFrameTop: 0, cropFrameWidth: 0, cropFrameHeight: 0, cropViewportWidth: 0, cropViewportHeight: 0 },
    cropGesture: null,
    onLoad: function (o) { var draft = wx.getStorageSync('pendingTaskDraft') || {}; var requestedMode = String(o.mode || draft.mode || 'HARD_PROBLEM_CHECK'); var mode = requestedMode === 'CARELESS_TRAINING' ? 'CARELESS_TRAINING' : 'HARD_PROBLEM_CHECK'; var answerImages = mode === 'CARELESS_TRAINING' ? [] : (Array.isArray(draft.answerPaths) ? draft.answerPaths : []), manualAnswer = mode === 'CARELESS_TRAINING' ? '' : String(draft.manualAnswer || ''); this.setData({ taskId: String(o.taskId || ''), title: String(o.title || draft.title || ''), grade: String(o.grade || draft.grade || ''), parentTaskId: String(o.parentTaskId || draft.parentTaskId || ''), mode: mode, studentImages: Array.isArray(draft.studentPaths) ? draft.studentPaths : [], answerImages: answerImages, manualAnswer: manualAnswer }); if (mode === 'CARELESS_TRAINING')
        saveDraft(this.data); wx.setNavigationBarTitle({ title: "\u5F53\u524D\u8BAD\u7EC3\uFF1A".concat(mode === 'CARELESS_TRAINING' ? '马虎训练' : '难题检测') }); },
    onShow: function () {
        var _a, _b;
        var result = wx.getStorageSync('pendingTaskImageCropResult');
        if (!result || result.status !== 'DONE')
            return;
        var key = result.kind === 'answer' ? 'answerImages' : 'studentImages';
        var paths = replaceCroppedImage(this.data[key], Number(result.index), String(result.sourcePath || ''), String(result.croppedPath || ''));
        if (paths !== this.data[key]) {
            var data = __assign(__assign({}, this.data), (_a = {}, _a[key] = paths, _a));
            this.setData((_b = {}, _b[key] = paths, _b));
            saveDraft(data);
        }
        wx.removeStorageSync('pendingTaskImageCropResult');
    },
    student: function () { this.choose('student'); },
    answer: function () { this.choose('answer'); },
    choose: function (role) {
        return __awaiter(this, void 0, void 0, function () {
            var key, remaining, privacyDialog, selected, paths, data, error_1;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        key = role === 'student' ? 'studentImages' : 'answerImages';
                        remaining = 3 - this.data[key].length;
                        if (remaining <= 0) {
                            wx.showToast({ title: '最多选择 3 张图片', icon: 'none' });
                            return [2 /*return*/];
                        }
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 5, , 6]);
                        privacyDialog = this.selectComponent('#privacyDialog');
                        if (!(privacyDialog === null || privacyDialog === void 0 ? void 0 : privacyDialog.requestAuthorization)) return [3 /*break*/, 3];
                        return [4 /*yield*/, privacyDialog.requestAuthorization()];
                    case 2:
                        _c.sent();
                        _c.label = 3;
                    case 3: return [4 /*yield*/, wx.chooseMedia({ count: remaining, mediaType: ['image'], sourceType: ['camera', 'album'] })];
                    case 4:
                        selected = _c.sent();
                        paths = (selected.tempFiles || []).map(function (item) { return String(item.tempFilePath || ''); }).filter(Boolean).slice(0, remaining);
                        if (!paths.length)
                            return [2 /*return*/];
                        data = __assign(__assign({}, this.data), (_a = {}, _a[key] = __spreadArray(__spreadArray([], __read(this.data[key]), false), __read(paths), false), _a));
                        this.setData((_b = {}, _b[key] = data[key], _b));
                        saveDraft(data);
                        return [3 /*break*/, 6];
                    case 5:
                        error_1 = _c.sent();
                        if (!String((error_1 === null || error_1 === void 0 ? void 0 : error_1.errMsg) || '').includes('cancel'))
                            wx.showToast({ title: '选择图片失败', icon: 'none' });
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    },
    setAnswer: function (e) { this.setData({ manualAnswer: e.detail.value }); saveDraft(this.data); },
    crop: function (e) {
        var _this = this;
        var cropKind = String(e.currentTarget.dataset.kind) === 'answer' ? 'answer' : 'student';
        var key = cropKind === 'answer' ? 'answerImages' : 'studentImages';
        var cropIndex = Number(e.currentTarget.dataset.index);
        var cropSourcePath = String(this.data[key][cropIndex] || '');
        if (!cropSourcePath)
            return;
        this.setData({ cropVisible: true, cropKind: cropKind, cropIndex: cropIndex, cropSourcePath: cropSourcePath, cropImagePath: '' });
        wx.nextTick(function () { return _this.prepareCrop(); });
    },
    prepareCrop: function () {
        var _this = this;
        wx.createSelectorQuery().in(this).select('.crop-viewport').boundingClientRect(function (rect) {
            if (!rect || !_this.data.cropVisible)
                return;
            var sourcePath = _this.data.cropSourcePath;
            wx.getImageInfo({ src: sourcePath, success: function (info) {
                    if (!_this.data.cropVisible || _this.data.cropSourcePath !== sourcePath)
                        return;
                    var scale = Math.max(rect.width / info.width, rect.height / info.height);
                    var imageWidth = info.width * scale, imageHeight = info.height * scale;
                    var frameWidth = Math.max(minimumCropSize, Math.min(rect.width * .8, imageWidth));
                    var frameHeight = Math.max(minimumCropSize, Math.min(rect.height * .8, imageHeight));
                    _this.setData({ cropImagePath: info.path || _this.data.cropSourcePath, cropImageWidth: info.width, cropImageHeight: info.height, cropViewportWidth: rect.width, cropViewportHeight: rect.height, cropScale: scale, cropLeft: (rect.width - imageWidth) / 2, cropTop: (rect.height - imageHeight) / 2, cropFrameLeft: (rect.width - frameWidth) / 2, cropFrameTop: (rect.height - frameHeight) / 2, cropFrameWidth: frameWidth, cropFrameHeight: frameHeight });
                }, fail: function () { return wx.showToast({ title: '图片读取失败', icon: 'none' }); } });
        }).exec();
    },
    closeCrop: function () { this.cropGesture = null; this.setData({ cropVisible: false, cropKind: '', cropIndex: -1, cropSourcePath: '', cropImagePath: '', cropImageWidth: 0, cropImageHeight: 0, cropScale: 1, cropLeft: 0, cropTop: 0, cropFrameLeft: 0, cropFrameTop: 0, cropFrameWidth: 0, cropFrameHeight: 0, cropViewportWidth: 0, cropViewportHeight: 0 }); },
    stopPropagation: function () { },
    useOriginal: function () { this.closeCrop(); },
    imageTouchStart: function (e) { var touches = e.touches || []; this.cropGesture = { type: 'image', touches: touches.length, x: touches[0].clientX, y: touches[0].clientY, left: this.data.cropLeft, top: this.data.cropTop, scale: this.data.cropScale, distance: touches.length > 1 ? Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY) : 0, center: touches.length > 1 ? { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 } : null }; },
    imageTouchMove: function (e) { var g = this.cropGesture, touches = e.touches || []; if (!g || g.type !== 'image' || !touches.length)
        return; var scale = g.scale, left = g.left, top = g.top; if (touches.length > 1 && g.distance) {
        var distance = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        scale = Math.max(.1, Math.min(8, g.scale * distance / g.distance));
        var center = { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
        left = g.center.x + (g.left - g.center.x) * scale / g.scale + (center.x - g.center.x);
        top = g.center.y + (g.top - g.center.y) * scale / g.scale + (center.y - g.center.y);
    }
    else {
        left = g.left + touches[0].clientX - g.x;
        top = g.top + touches[0].clientY - g.y;
    } this.setImagePosition(left, top, scale); },
    imageTouchEnd: function () { this.cropGesture = null; },
    cropFrameStart: function (e) { var touch = e.touches[0]; this.cropGesture = { type: 'frame', x: touch.clientX, y: touch.clientY, left: this.data.cropFrameLeft, top: this.data.cropFrameTop }; },
    cropHandleStart: function (e) { var touch = e.touches[0]; this.cropGesture = { type: 'handle', handle: String(e.currentTarget.dataset.handle), x: touch.clientX, y: touch.clientY, left: this.data.cropFrameLeft, top: this.data.cropFrameTop, width: this.data.cropFrameWidth, height: this.data.cropFrameHeight }; },
    cropFrameMove: function (e) { var g = this.cropGesture, touch = e.touches[0]; if (!g || !touch)
        return; var dx = touch.clientX - g.x, dy = touch.clientY - g.y; if (g.type === 'frame')
        this.setFrame(g.left + dx, g.top + dy, this.data.cropFrameWidth, this.data.cropFrameHeight); if (g.type === 'handle')
        this.resizeFrame(g, dx, dy); },
    cropFrameEnd: function () { this.cropGesture = null; },
    setImagePosition: function (left, top, scale) { var width = this.data.cropImageWidth * scale, height = this.data.cropImageHeight * scale; var f = this.data; left = Math.min(f.cropFrameLeft, Math.max(f.cropFrameLeft + f.cropFrameWidth - width, left)); top = Math.min(f.cropFrameTop, Math.max(f.cropFrameTop + f.cropFrameHeight - height, top)); this.setData({ cropScale: scale, cropLeft: left, cropTop: top }); },
    setFrame: function (left, top, width, height) { var f = this.data, imageWidth = f.cropImageWidth * f.cropScale, imageHeight = f.cropImageHeight * f.cropScale; width = Math.max(minimumCropSize, Math.min(width, imageWidth)); height = Math.max(minimumCropSize, Math.min(height, imageHeight)); left = Math.max(f.cropLeft, Math.min(left, f.cropLeft + imageWidth - width)); top = Math.max(f.cropTop, Math.min(top, f.cropTop + imageHeight - height)); this.setData({ cropFrameLeft: left, cropFrameTop: top, cropFrameWidth: width, cropFrameHeight: height }); },
    resizeFrame: function (g, dx, dy) { var left = g.left, top = g.top, width = g.width, height = g.height; if (g.handle.includes('left')) {
        left += dx;
        width -= dx;
    } if (g.handle.includes('right'))
        width += dx; if (g.handle.includes('top')) {
        top += dy;
        height -= dy;
    } if (g.handle.includes('bottom'))
        height += dy; if (width < minimumCropSize) {
        if (g.handle.includes('left'))
            left -= minimumCropSize - width;
        width = minimumCropSize;
    } if (height < minimumCropSize) {
        if (g.handle.includes('top'))
            top -= minimumCropSize - height;
        height = minimumCropSize;
    } this.setFrame(left, top, width, height); },
    confirmCrop: function () {
        var _this = this;
        var f = this.data;
        if (!f.cropImageWidth || !f.cropFrameWidth)
            return;
        var x = (f.cropFrameLeft - f.cropLeft) / f.cropScale, y = (f.cropFrameTop - f.cropTop) / f.cropScale, width = f.cropFrameWidth / f.cropScale, height = f.cropFrameHeight / f.cropScale;
        var context = wx.createCanvasContext('uploadCropCanvas', this);
        context.drawImage(f.cropImagePath || f.cropSourcePath, x, y, width, height, 0, 0, width, height);
        context.draw(false, function () { return wx.canvasToTempFilePath({ canvasId: 'uploadCropCanvas', x: 0, y: 0, width: width, height: height, destWidth: Math.round(width), destHeight: Math.round(height), success: function (result) {
                var _a, _b;
                if (!(result === null || result === void 0 ? void 0 : result.tempFilePath)) {
                    wx.showToast({ title: '裁切失败', icon: 'none' });
                    return;
                }
                var key = f.cropKind === 'answer' ? 'answerImages' : 'studentImages';
                var paths = __spreadArray([], __read(_this.data[key]), false);
                paths[f.cropIndex] = result.tempFilePath;
                var data = __assign(__assign({}, _this.data), (_a = {}, _a[key] = paths, _a));
                _this.setData((_b = {}, _b[key] = paths, _b));
                saveDraft(data);
                _this.closeCrop();
            }, fail: function () { return wx.showToast({ title: '裁切失败', icon: 'none' }); } }, _this); });
    },
    removeStudent: function (e) { var index = Number(e.currentTarget.dataset.index); this.setData({ studentImages: this.data.studentImages.filter(function (_, i) { return i !== index; }) }); saveDraft(this.data); },
    removeAnswer: function (e) { var index = Number(e.currentTarget.dataset.index); this.setData({ answerImages: this.data.answerImages.filter(function (_, i) { return i !== index; }) }); saveDraft(this.data); },
    move: function (e) {
        var _a, _b;
        var key = String(e.currentTarget.dataset.kind) === 'student' ? 'studentImages' : 'answerImages';
        var index = Number(e.currentTarget.dataset.index);
        var direction = Number(e.currentTarget.dataset.direction);
        var next = index + direction;
        var values = __spreadArray([], __read(this.data[key]), false);
        if (next < 0 || next >= values.length)
            return;
        _a = __read([values[next], values[index]], 2), values[index] = _a[0], values[next] = _a[1];
        this.setData((_b = {}, _b[key] = values, _b));
        saveDraft(this.data);
    },
    progress: function (state) { this.setData({ uploading: state.overallProgress < 100, uploadProgress: state.uploadMessage || '正在上传图片' }); },
    submit: function () {
        return __awaiter(this, void 0, void 0, function () {
            var draft, mode, carelessTrainingType, files, manualAnswer, data, hidden, error_2;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.data.loading)
                            return [2 /*return*/];
                        if (!this.data.studentImages.length) {
                            wx.showToast({ title: '请上传学生作业', icon: 'none' });
                            return [2 /*return*/];
                        }
                        saveDraft(this.data);
                        draft = wx.getStorageSync('pendingTaskDraft') || {};
                        this.setData({ loading: true, uploading: true, uploadProgress: '正在上传图片' });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 5, 6, 7]);
                        mode = draft.mode === 'CARELESS_TRAINING' ? 'CARELESS_TRAINING' : 'HARD_PROBLEM_CHECK';
                        carelessTrainingType = draft.carelessTrainingType === 'CALCULATION' ? 'CALCULATION' : 'READING';
                        return [4 /*yield*/, (0, upload_1.uploadTaskImages)(draft.studentPaths, mode === 'CARELESS_TRAINING' ? [] : (Array.isArray(draft.answerPaths) ? draft.answerPaths : []), function (state) { return _this.progress(state); })];
                    case 2:
                        files = _a.sent();
                        manualAnswer = mode === 'CARELESS_TRAINING' ? '' : String(draft.manualAnswer || '').trim();
                        return [4 /*yield*/, (0, cloud_1.call)('createTask', __assign(__assign(__assign(__assign({ taskName: String(draft.title || '') }, files), (mode === 'CARELESS_TRAINING' ? { answerImageFileIds: [], manualAnswer: '', answerMode: 'none' } : { manualAnswer: manualAnswer, answerMode: manualAnswer && files.answerImageFileIds.length ? 'mixed' : manualAnswer ? 'manual' : files.answerImageFileIds.length ? 'image' : 'none' })), (mode === 'CARELESS_TRAINING' ? { carelessTrainingType: carelessTrainingType } : {})), { parentTaskId: draft.parentTaskId || null, mode: mode }), 30000)];
                    case 3:
                        data = _a.sent();
                        return [4 /*yield*/, (0, student_result_visibility_1.resolveCurrentStudentResultHidden)()];
                    case 4:
                        hidden = _a.sent();
                        wx.removeStorageSync('pendingTaskDraft');
                        wx.redirectTo({ url: hidden ? (0, student_result_visibility_1.uploadedNoticeUrl)(data) : "/pages/task/processing/index?taskId=".concat(encodeURIComponent(data.taskId)) });
                        return [3 /*break*/, 7];
                    case 5:
                        error_2 = _a.sent();
                        wx.showModal({ title: '启动失败', content: error_2.message || '请稍后重试', showCancel: false });
                        return [3 /*break*/, 7];
                    case 6:
                        this.setData({ loading: false, uploading: false });
                        return [7 /*endfinally*/];
                    case 7: return [2 /*return*/];
                }
            });
        });
    },
});
