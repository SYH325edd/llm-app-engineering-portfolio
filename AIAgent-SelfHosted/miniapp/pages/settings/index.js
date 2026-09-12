"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var customer_1 = require("../../config/customer");
var cloud = require("../../services/cloud");
function providerStatusText(provider, state, statusAvailable) {
    if (!statusAvailable)
        return '状态检测失败';
    if (state && state.ready === true)
        return '已配置';
    var reason = String((state === null || state === void 0 ? void 0 : state.reason) || 'not_ready');
    if (provider !== 'qwen3_vl_plus')
        return '未配置';
    return ({
        missing_api_key: '缺少API Key',
        missing_base_url: '缺少Base URL',
        invalid_base_url: 'URL格式错误',
        invalid_model: '模型名错误',
        status_unavailable: '状态检测失败',
    })[reason] || '未配置';
}
function providerStatusErrorText(code) {
    var value = String(code || '');
    if (value === 'GRADING_WORKER_HTTP_404' || value === 'GRADING_WORKER_VERSION_UNSUPPORTED')
        return '当前 grading-worker 版本不支持千问状态检测，请部署 Runtime v7.3 并切流。';
    if (value === 'UNAUTHORIZED')
        return 'appApi 与 grading-worker 的 Token 不一致。';
    if (value === 'GRADING_WORKER_TIMEOUT')
        return 'grading-worker 状态检测超时，请检查云托管运行状态。';
    if (value === 'GRADING_WORKER_CONFIG_MISSING')
        return 'appApi 尚未配置 grading-worker 地址或 Token。';
    return '无法读取云托管模型配置，请检查 Runtime v7.3、流量和连接配置。';
}
Page({
    data: {
        serviceName: customer_1.CUSTOMER_DISPLAY_CONFIG.serviceName,
        operatorName: customer_1.CUSTOMER_DISPLAY_CONFIG.operatorName,
        servicePhone: customer_1.CUSTOMER_DISPLAY_CONFIG.servicePhone,
        complaintPhone: customer_1.CUSTOMER_DISPLAY_CONFIG.complaintPhone,
        agreementVersion: customer_1.CUSTOMER_DISPLAY_CONFIG.agreementVersion,
        privacyVersion: customer_1.CUSTOMER_DISPLAY_CONFIG.privacyVersion,
        filingNumber: customer_1.CUSTOMER_DISPLAY_CONFIG.filingNumber,
        phoneConfigured: (0, customer_1.isComplaintPhoneConfigured)(),
        isSuperAdmin: false,
        modelProviderLoading: false,
        modelProviderSaving: false,
        hardProblemModelProvider: 'ark_lite',
        providerStatusAvailable: false,
        providerStatusErrorCode: '',
        providerStatusErrorText: '',
        workerRuntimeBuildId: '',
        providerStatusContractVersion: '',
        modelProviders: [
            { value: 'ark_lite', name: '豆包 Seed Lite', description: '现有难题训练模型', ready: false },
            { value: 'qwen3_vl_plus', name: '千问 Qwen3.7 Plus', description: '仅用于难题训练的识别、首次批改和复核', ready: false, reason: 'status_unavailable', statusText: '状态检测失败' },
        ],
    },
    onShow: function () {
        var _a, _b;
        var user = (_b = (_a = getApp()) === null || _a === void 0 ? void 0 : _a.globalData) === null || _b === void 0 ? void 0 : _b.user;
        var isSuperAdmin = Boolean(user && user.role === 'super_admin' && user.status === 'ACTIVE');
        this.setData({ isSuperAdmin: isSuperAdmin });
        if (isSuperAdmin)
            this.loadHardProblemModelProvider();
    },
    loadHardProblemModelProvider: function () {
        var _this = this;
        if (this.data.modelProviderLoading)
            return;
        this.setData({ modelProviderLoading: true });
        cloud.call('getHardProblemModelProvider', {}, 10000).then(function (result) {
            var providers = result.providers || {};
            _this.setData({
                hardProblemModelProvider: result.provider === 'qwen3_vl_plus' ? 'qwen3_vl_plus' : 'ark_lite',
                providerStatusAvailable: result.statusAvailable === true,
                providerStatusErrorCode: String(result.statusErrorCode || ''),
                providerStatusErrorText: result.statusAvailable === true ? '' : providerStatusErrorText(result.statusErrorCode),
                workerRuntimeBuildId: String(result.runtimeBuildId || ''),
                providerStatusContractVersion: String(result.providerStatusContractVersion || ''),
                modelProviders: _this.data.modelProviders.map(function (item) {
                    var state = providers[item.value] || {};
                    return Object.assign({}, item, {
                        ready: state.ready === true,
                        reason: String(state.reason || ''),
                        statusText: providerStatusText(item.value, state, result.statusAvailable === true),
                        model: String(state.model || ''),
                    });
                }),
            });
        }).catch(function (error) {
            wx.showToast({ title: String((error === null || error === void 0 ? void 0 : error.message) || '模型状态读取失败').slice(0, 20), icon: 'none' });
        }).finally(function () { return _this.setData({ modelProviderLoading: false }); });
    },
    chooseHardProblemModelProvider: function (event) {
        var _this = this;
        var provider = String(event.currentTarget.dataset.provider || '');
        var option = this.data.modelProviders.find(function (item) { return item.value === provider; });
        if (!option || provider === this.data.hardProblemModelProvider || this.data.modelProviderSaving)
            return;
        if (!option.ready) {
            wx.showToast({ title: String(option.statusText || (provider === 'qwen3_vl_plus' ? '千问尚未配置' : '当前模型尚未配置')).slice(0, 20), icon: 'none' });
            return;
        }
        wx.showModal({
            title: '切换难题训练模型',
            content: "切换为".concat(option.name, "？仅影响之后新提交的难题训练任务，进行中的任务不会改变。"),
            confirmText: '确认切换',
            success: function (modal) {
                if (!modal.confirm)
                    return;
                _this.setData({ modelProviderSaving: true });
                cloud.call('setHardProblemModelProvider', { provider: provider }, 10000).then(function (result) {
                    _this.setData({ hardProblemModelProvider: result.provider });
                    wx.showToast({ title: '切换成功', icon: 'success' });
                }).catch(function (error) {
                    wx.showToast({ title: String((error === null || error === void 0 ? void 0 : error.message) || '切换失败').slice(0, 20), icon: 'none' });
                }).finally(function () { return _this.setData({ modelProviderSaving: false }); });
            }
        });
    },
    privacy: function () { wx.navigateTo({ url: '/pages/legal/privacy/index' }); },
    agreement: function () { wx.navigateTo({ url: '/pages/legal/agreement/index' }); },
    childrenPrivacy: function () { wx.navigateTo({ url: '/pages/legal/children-privacy/index' }); },
    contact: function () {
        if (!this.data.phoneConfigured)
            return;
        wx.makePhoneCall({ phoneNumber: this.data.complaintPhone });
    },
});
