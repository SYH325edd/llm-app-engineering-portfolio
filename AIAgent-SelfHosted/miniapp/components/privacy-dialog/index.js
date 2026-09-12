Component({
    data: {
        visible: false,
        privacyContractName: '用户隐私保护指引',
    },
    pendingAuthorization: null,
    methods: {
        noop: function () { },
        requestAuthorization: function () {
            var _this = this;
            return new Promise(function (resolve, reject) {
                var api = wx;
                if (typeof api.getPrivacySetting !== 'function') {
                    resolve();
                    return;
                }
                api.getPrivacySetting({
                    success: function (setting) {
                        if (!(setting === null || setting === void 0 ? void 0 : setting.needAuthorization)) {
                            resolve();
                            return;
                        }
                        var previous = _this.pendingAuthorization;
                        if (previous)
                            previous.reject(Object.assign(new Error('新的隐私授权请求已发起'), { code: 'PRIVACY_REQUEST_REPLACED' }));
                        _this.pendingAuthorization = { resolve: resolve, reject: reject };
                        _this.setData({ visible: true, privacyContractName: String(setting.privacyContractName || '用户隐私保护指引') });
                    },
                    fail: function () { return resolve(); },
                });
            });
        },
        openContract: function () {
            var api = wx;
            if (typeof api.openPrivacyContract === 'function')
                api.openPrivacyContract({ fail: function () { return wx.showToast({ title: '暂时无法打开隐私指引', icon: 'none' }); } });
        },
        agreePrivacyAuthorization: function (event) {
            var _a;
            var pending = this.pendingAuthorization;
            this.pendingAuthorization = null;
            this.setData({ visible: false });
            var errMsg = String(((_a = event === null || event === void 0 ? void 0 : event.detail) === null || _a === void 0 ? void 0 : _a.errMsg) || '');
            if (errMsg && errMsg.indexOf(':fail') >= 0) {
                pending === null || pending === void 0 ? void 0 : pending.reject(Object.assign(new Error('未完成隐私授权'), { code: 'PRIVACY_AUTH_FAILED' }));
                return;
            }
            pending === null || pending === void 0 ? void 0 : pending.resolve();
        },
        rejectAuthorization: function () {
            var pending = this.pendingAuthorization;
            this.pendingAuthorization = null;
            this.setData({ visible: false });
            pending === null || pending === void 0 ? void 0 : pending.reject(Object.assign(new Error('用户拒绝隐私授权'), { code: 'PRIVACY_DENIED' }));
        },
    },
});
