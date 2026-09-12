"use strict";
function formatDate(value) {
    var text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text))
        return text;
    var date = text ? new Date(text) : new Date();
    if (Number.isNaN(date.getTime()))
        date = new Date();
    return "".concat(date.getFullYear(), "-").concat(String(date.getMonth() + 1).padStart(2, '0'), "-").concat(String(date.getDate()).padStart(2, '0'));
}
function formatTime(value) {
    var date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime()))
        date = new Date();
    return "".concat(String(date.getHours()).padStart(2, '0'), ":").concat(String(date.getMinutes()).padStart(2, '0'));
}
Page({
    data: {
        mode: 'result_hidden',
        title: '已上传，等待老师批改',
        description: '作业已提交，详细批改结果将由老师查看并进行讲解。',
        taskDateKey: '',
        dailySequence: 0,
        createdTime: '',
        uploaded: false,
    },
    onLoad: function (options) {
        var mode = String((options === null || options === void 0 ? void 0 : options.mode) || '') === 'uploaded' ? 'uploaded' : 'result_hidden';
        var uploaded = mode === 'uploaded';
        this.setData({
            mode: mode,
            uploaded: uploaded,
            title: uploaded ? '作业上传成功' : '已上传，等待老师批改',
            description: uploaded ? '作业已提交，老师可以在批改完成后查看详细结果。' : '作业已提交，详细批改结果将由老师查看并进行讲解。',
            taskDateKey: uploaded ? formatDate(options === null || options === void 0 ? void 0 : options.taskDateKey) : '',
            dailySequence: uploaded ? Math.max(0, Number((options === null || options === void 0 ? void 0 : options.dailySequence) || 0)) : 0,
            createdTime: uploaded ? formatTime(options === null || options === void 0 ? void 0 : options.createdAt) : '',
        });
    },
    goHome: function () { wx.switchTab({ url: '/pages/home/index' }); },
    continueUpload: function () { wx.navigateTo({ url: '/pages/task/create/index' }); },
});
