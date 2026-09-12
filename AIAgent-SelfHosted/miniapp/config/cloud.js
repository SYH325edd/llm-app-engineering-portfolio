"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOUD_ENV_ID = void 0;
exports.isCloudEnvConfigured = isCloudEnvConfigured;
/** Self-Hosted 模式兼容标识；实际 API 地址见 config/backend.js。 */
exports.CLOUD_ENV_ID = 'selfhost';
function isCloudEnvConfigured() {
    return Boolean(String(exports.CLOUD_ENV_ID || '').trim());
}
