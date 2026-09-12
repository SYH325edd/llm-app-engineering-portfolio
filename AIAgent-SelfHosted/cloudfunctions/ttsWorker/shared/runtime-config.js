"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeConfig = void 0;
exports.assertNoPlaceholderSecret = assertNoPlaceholderSecret;
function text(value) { return String(value || '').trim(); }
exports.runtimeConfig = {
    arkApiKey: () => text(process.env.ARK_API_KEY),
    arkBaseUrl: () => text(process.env.ARK_BASE_URL) || 'https://ark.cn-beijing.volces.com/api/v3',
    arkMiniEndpoint: () => text(process.env.ARK_MINI_ENDPOINT),
    arkLiteEndpoint: () => text(process.env.ARK_LITE_ENDPOINT),
    ttsApiKey: () => text(process.env.TTS_API_KEY),
    ttsSpeaker: () => text(process.env.TTS_SPEAKER),
    strategyServiceUrl: () => text(process.env.STRATEGY_SERVICE_URL),
    strategyCustomerId: () => text(process.env.STRATEGY_CUSTOMER_ID),
    strategyLicenseId: () => text(process.env.STRATEGY_LICENSE_ID),
};
function assertNoPlaceholderSecret(name, value) {
    const normalized = text(value).toLowerCase();
    if (!normalized)
        return;
    if (/your_|placeholder|请填写|请替换|example/.test(normalized)) {
        throw Object.assign(new Error(`${name} 仍为占位符`), { code: 'CONFIG_PLACEHOLDER' });
    }
}
