"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__strategyTest = void 0;
exports.loadRuntimeStrategy = loadRuntimeStrategy;
exports.resetRuntimeStrategyForTests = resetRuntimeStrategyForTests;
const crypto = require('crypto');
const context_1 = require("../context");
const constants_1 = require("../constants");
const utils_1 = require("../utils");
const contract_1 = require("./contract");
const embedded_1 = require("./embedded");
let memory = null;
const CACHE_ID = 'active';
const ALLOWED_REQUEST_KEYS = ['customerId', 'licenseId', 'appIdHash', 'currentVersion', 'timestamp', 'nonce'];
function envText(name) { return String(process.env[name] || '').trim(); }
function configured() { return Boolean(envText('STRATEGY_SERVICE_URL') && envText('STRATEGY_LICENSE_ID') && envText('STRATEGY_CUSTOMER_ID') && envText('STRATEGY_LICENSE_KEY') && envText('STRATEGY_PUBLIC_KEY_BASE64')); }
function canonical(value) { return JSON.stringify(value); }
function publicKey() { return Buffer.from(envText('STRATEGY_PUBLIC_KEY_BASE64'), 'base64').toString('utf8'); }
function encryptionKey() {
    const value = envText('STRATEGY_LICENSE_KEY');
    if (!/^[a-f0-9]{64}$/i.test(value))
        throw Object.assign(new Error('策略授权密钥格式错误'), { code: 'STRATEGY_LICENSE_KEY_INVALID', retryable: false });
    return Buffer.from(value, 'hex');
}
function unsigned(envelope) {
    const { signature, ...rest } = envelope;
    return rest;
}
function verifyEnvelope(envelope) {
    if (!envelope || envelope.encryption?.algorithm !== 'aes-256-gcm')
        throw Object.assign(new Error('策略响应格式错误'), { code: 'STRATEGY_ENVELOPE_INVALID' });
    const ok = crypto.verify('sha256', Buffer.from(canonical(unsigned(envelope))), publicKey(), Buffer.from(String(envelope.signature || ''), 'base64'));
    if (!ok)
        throw Object.assign(new Error('策略签名校验失败'), { code: 'STRATEGY_SIGNATURE_INVALID', retryable: false });
    if (!['active', 'grace'].includes(envelope.licenseStatus))
        throw Object.assign(new Error('策略授权不可用'), { code: `STRATEGY_LICENSE_${String(envelope.licenseStatus).toUpperCase()}`, retryable: false });
    const graceUntil = new Date(envelope.graceUntil).getTime();
    if (!Number.isFinite(graceUntil) || graceUntil < Date.now())
        throw Object.assign(new Error('策略授权已过期'), { code: 'STRATEGY_LICENSE_EXPIRED', retryable: false });
}
function decryptEnvelope(envelope) {
    verifyEnvelope(envelope);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.encryption.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.encryption.tag, 'base64'));
    const text = Buffer.concat([decipher.update(Buffer.from(envelope.encryption.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    const strategy = JSON.parse(text);
    (0, contract_1.assertStrategyBundle)(strategy);
    if (strategy.strategyVersion !== envelope.strategyVersion)
        throw Object.assign(new Error('策略版本不一致'), { code: 'STRATEGY_VERSION_MISMATCH' });
    return strategy;
}
const DEFAULT_CACHE_REFRESH_DAYS = 7;
function cacheRefreshMs() {
    const days = Number(process.env.STRATEGY_CACHE_REFRESH_DAYS || DEFAULT_CACHE_REFRESH_DAYS);
    const safeDays = Number.isFinite(days) ? Math.min(30, Math.max(1, days)) : DEFAULT_CACHE_REFRESH_DAYS;
    return safeDays * 24 * 60 * 60 * 1000;
}
async function saveCache(envelope) {
    const refreshAfter = new Date(Math.min(new Date(envelope.expiresAt).getTime(), Date.now() + cacheRefreshMs()));
    await context_1.db.collection(constants_1.C.strategyCache).doc(CACHE_ID).set({ data: { envelope, strategyVersion: envelope.strategyVersion, expiresAt: new Date(envelope.expiresAt), graceUntil: new Date(envelope.graceUntil), refreshAfter, updatedAt: (0, utils_1.now)() } });
}
async function readCache() {
    const record = (await context_1.db.collection(constants_1.C.strategyCache).doc(CACHE_ID).get()).data;
    if (!record?.envelope)
        return null;
    const graceUntil = new Date(record.envelope.graceUntil || record.graceUntil || 0).getTime();
    if (!Number.isFinite(graceUntil) || graceUntil < Date.now())
        return null;
    return { envelope: record.envelope, refreshAfter: new Date(record.refreshAfter || 0).getTime() };
}
async function fetchEnvelope(currentVersion) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(process.env.STRATEGY_SERVICE_TIMEOUT_MS || 8000)));
    const request = {
        customerId: envText('STRATEGY_CUSTOMER_ID'), licenseId: envText('STRATEGY_LICENSE_ID'), appIdHash: envText('STRATEGY_APP_ID_HASH'),
        currentVersion, timestamp: Date.now(), nonce: crypto.randomBytes(12).toString('hex'),
    };
    if (Object.keys(request).some((key) => !ALLOWED_REQUEST_KEYS.includes(key)))
        throw new Error('策略请求包含未授权字段');
    try {
        const response = await fetch(`${envText('STRATEGY_SERVICE_URL').replace(/\/$/, '')}/v1/strategy/latest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
            throw Object.assign(new Error(String(payload?.message || `策略服务 HTTP ${response.status}`)), { code: String(payload?.code || 'STRATEGY_SERVICE_ERROR'), status: response.status });
        return payload;
    }
    finally {
        clearTimeout(timer);
    }
}
async function loadRuntimeStrategy() {
    if (memory && memory.expiresAt > Date.now())
        return memory.strategy;
    if (!configured()) {
        if (String(process.env.STRATEGY_REMOTE_REQUIRED || 'true').toLowerCase() === 'true')
            throw Object.assign(new Error('远程策略配置不完整，禁止降级到内置旧策略'), { code: 'STRATEGY_REMOTE_CONFIG_MISSING', retryable: false });
        return (0, embedded_1.decryptEmbeddedStrategy)();
    }
    let currentVersion = '';
    try {
        const cached = await readCache();
        if (cached && Number.isFinite(cached.refreshAfter) && cached.refreshAfter > Date.now()) {
            const strategy = decryptEnvelope(cached.envelope);
            memory = { strategy, expiresAt: Math.min(cached.refreshAfter, Date.now() + cacheRefreshMs()) };
            return strategy;
        }
        currentVersion = String(cached?.envelope?.strategyVersion || '');
        const envelope = await fetchEnvelope(currentVersion);
        const strategy = decryptEnvelope(envelope);
        await saveCache(envelope).catch(() => { });
        memory = { strategy, expiresAt: Math.min(new Date(envelope.expiresAt).getTime(), Date.now() + cacheRefreshMs()) };
        return strategy;
    }
    catch (remoteError) {
        try {
            const cached = await readCache();
            if (cached) {
                const strategy = decryptEnvelope(cached.envelope);
                memory = { strategy, expiresAt: Math.min(new Date(cached.envelope.graceUntil).getTime(), Date.now() + 60 * 60 * 1000) };
                return strategy;
            }
        }
        catch { }
        // 未启用过远程授权时保留现有内置策略；一旦显式要求远程授权，失败则明确报错。
        if (String(process.env.STRATEGY_REMOTE_REQUIRED || 'true').toLowerCase() !== 'true')
            return (0, embedded_1.decryptEmbeddedStrategy)();
        throw remoteError;
    }
}
function resetRuntimeStrategyForTests() { memory = null; }
exports.__strategyTest = { canonical, unsigned, decryptEnvelope, configured, ALLOWED_REQUEST_KEYS };
