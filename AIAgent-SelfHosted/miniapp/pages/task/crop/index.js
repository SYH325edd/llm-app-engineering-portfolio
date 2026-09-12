Page({
    data: { kind: 'student', index: 0, originalPath: '', renderPath: '', loadState: 'loading', ready: false },
    onLoad: function (query) {
        var _a, _b;
        if (query === void 0) { query = {}; }
        var pending = wx.getStorageSync('pendingTaskImageCrop') || {};
        var originalPath = String(pending.sourcePath || '');
        this.setData({ kind: String(query.kind || pending.kind || 'student'), index: Number((_b = (_a = query.index) !== null && _a !== void 0 ? _a : pending.index) !== null && _b !== void 0 ? _b : 0), originalPath: originalPath });
        this.loadImage();
    },
    loadImage: function () {
        var _this = this;
        var originalPath = this.data.originalPath;
        if (!originalPath) {
            this.setData({ loadState: 'failed', ready: false });
            return;
        }
        wx.getImageInfo({ src: originalPath, success: function (info) { return _this.setData({ renderPath: String(info.path || originalPath), loadState: 'ready' }); }, fail: function () { return _this.setData({ loadState: 'failed', ready: false }); } });
    },
    retry: function () { this.setData({ loadState: 'loading', ready: false }); this.loadImage(); },
    imageLoaded: function () { if (this.data.loadState === 'ready')
        this.setData({ ready: true }); },
    useOriginal: function () { wx.removeStorageSync('pendingTaskImageCrop'); wx.navigateBack(); },
    confirm: function () {
        var _this = this;
        var _a;
        if (!this.data.ready)
            return;
        var exportCrop = function () { return wx.canvasToTempFilePath({ canvasId: 'cropCanvas', quality: 1, success: function (result) { wx.setStorageSync('pendingTaskImageCropResult', { status: 'DONE', kind: _this.data.kind, index: _this.data.index, sourcePath: _this.data.originalPath, croppedPath: String(result.tempFilePath || '') }); wx.removeStorageSync('pendingTaskImageCrop'); wx.navigateBack(); }, complete: function () { } }); };
        var context = (_a = wx.createCanvasContext) === null || _a === void 0 ? void 0 : _a.call(wx, 'cropCanvas', this);
        if (!context) {
            exportCrop();
            return;
        }
        context.drawImage(this.data.renderPath, 0, 0, 1, 1);
        context.draw(false, exportCrop);
    },
});
