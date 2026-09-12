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
Page({
    data: { parentTaskId: '', carelessTrainingExpanded: false },
    onLoad: function (query) { this.setData({ parentTaskId: String(query.parentTaskId || '') }); },
    selectMode: function (event) {
        var requestedMode = String(event.currentTarget.dataset.mode);
        if (requestedMode === 'CARELESS_TRAINING' && !event.currentTarget.dataset.type) {
            this.setData({ carelessTrainingExpanded: !this.data.carelessTrainingExpanded });
            return;
        }
        var mode = requestedMode === 'CARELESS_TRAINING' ? 'CARELESS_TRAINING' : 'HARD_PROBLEM_CHECK';
        var carelessTrainingType = mode === 'CARELESS_TRAINING' && String(event.currentTarget.dataset.type) === 'CALCULATION' ? 'CALCULATION' : 'READING';
        var draft = wx.getStorageSync('pendingTaskDraft') || {};
        wx.setStorageSync('pendingTaskDraft', mode === 'CARELESS_TRAINING' ? __assign(__assign({}, draft), { parentTaskId: this.data.parentTaskId || draft.parentTaskId || '', mode: mode, carelessTrainingType: carelessTrainingType, answerPaths: [], manualAnswer: '' }) : __assign(__assign({}, draft), { parentTaskId: this.data.parentTaskId || draft.parentTaskId || '', mode: mode }));
        wx.navigateTo({ url: "/pages/task/upload/index?mode=".concat(mode, "&carelessTrainingType=").concat(carelessTrainingType, "&parentTaskId=").concat(encodeURIComponent(this.data.parentTaskId)) });
    },
});
