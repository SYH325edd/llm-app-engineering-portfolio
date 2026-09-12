"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_BASE_URL = exports.BACKEND_MODE = void 0;
exports.isSelfHosted = isSelfHosted;

/** AIAgent 唯一后端运行模式。正式环境通过腾讯云 API 域名访问。 */
exports.BACKEND_MODE = 'selfhost';
exports.API_BASE_URL = 'https://api.example.invalid';

function isSelfHosted() {
    return exports.BACKEND_MODE === 'selfhost';
}
