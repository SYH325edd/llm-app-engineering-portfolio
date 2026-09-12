"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptEmbeddedStrategy = decryptEmbeddedStrategy;
exports.resetEmbeddedStrategyForTests = resetEmbeddedStrategyForTests;
const crypto = require('crypto');
const embedded_bundle_1 = require("./embedded-bundle");
const contract_1 = require("./contract");
let cached = null;
function resolveKeyHex(env = process.env) {
    const configured = String(env.STRATEGY_BUNDLE_KEY || '').trim();
    if (/^[a-f0-9]{64}$/i.test(configured))
        return configured;
    throw Object.assign(new Error('策略解密密钥未配置'), { code: 'STRATEGY_KEY_NOT_CONFIGURED', retryable: false });
}
function decryptEmbeddedStrategy(env = process.env) {
    if (cached)
        return cached;
    const keyHex = resolveKeyHex(env);
    if (!/^[a-f0-9]{64}$/i.test(keyHex))
        throw Object.assign(new Error('策略解密密钥格式错误'), { code: 'STRATEGY_KEY_INVALID', retryable: false });
    const bundle = embedded_bundle_1.EMBEDDED_STRATEGY_BUNDLE;
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(bundle.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(bundle.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plaintext);
    (0, contract_1.assertStrategyBundle)(parsed);
    cached = parsed;
    return parsed;
}
function resetEmbeddedStrategyForTests() { cached = null; }
