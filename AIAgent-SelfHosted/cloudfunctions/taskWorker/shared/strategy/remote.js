"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__strategyTest = void 0;
exports.loadRuntimeStrategy = loadRuntimeStrategy;
exports.refreshRuntimeStrategy = refreshRuntimeStrategy;
exports.resetRuntimeStrategyForTests = resetRuntimeStrategyForTests;
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const context_1 = require("../context");
const constants_1 = require("../constants");
const utils_1 = require("../utils");
const contract_1 = require("./contract");
const embedded_1 = require("./embedded");
const audit_1 = require("../audit");
let memory = null;
let cacheMissLoad = null;
const CACHE_ID = 'active';
function getFirstDocument(snapshot) {
    if (!snapshot)
        return null;
    if (Array.isArray(snapshot.data))
        return snapshot.data[0] || null;
    return snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : null;
}
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
    let text;
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.encryption.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(envelope.encryption.tag, 'base64'));
        text = Buffer.concat([decipher.update(Buffer.from(envelope.encryption.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    }
    catch {
        throw Object.assign(new Error('strategy decrypt failed'), { code: 'STRATEGY_DECRYPT_FAILED', retryable: false });
    }
    let strategy;
    try {
        strategy = JSON.parse(text);
    }
    catch {
        throw Object.assign(new Error('strategy decrypt failed'), { code: 'STRATEGY_DECRYPT_FAILED', retryable: false });
    }
    try {
        (0, contract_1.assertStrategyBundle)(strategy);
    }
    catch (error) {
        throw Object.assign(new Error('strategy contract invalid'), { code: 'STRATEGY_CONTRACT_INVALID', retryable: false, causeCode: error?.code || '' });
    }
    if (strategy.strategyVersion !== envelope.strategyVersion)
        throw Object.assign(new Error('策略版本不一致'), { code: 'STRATEGY_VERSION_MISMATCH' });
    return strategy;
}
async function saveCache(envelope) {
    const updatedAt = (0, utils_1.now)();
    await context_1.db.collection(constants_1.C.strategyCache).doc(CACHE_ID).set({ data: { envelope, strategyVersion: envelope.strategyVersion, artifactHash: envelope.artifactHash, expiresAt: new Date(envelope.expiresAt), graceUntil: new Date(envelope.graceUntil), updatedAt } });
    return updatedAt;
}
function isMissingCacheDocument(error) {
    const code = String(error?.code || error?.errCode || '').toUpperCase();
    const message = String(error?.message || error?.errMsg || '');
    return /DOCUMENT.*NOT.*FOUND|DOCUMENT_NOT_FOUND/.test(code) || /document.*(does not exist|not found)/i.test(message);
}
async function readCache() {
    let record;
    try {
        record = getFirstDocument(await context_1.db.collection(constants_1.C.strategyCache).doc(CACHE_ID).get());
    }
    catch (error) {
        if (isMissingCacheDocument(error))
            return null;
        throw error;
    }
    if (!record?.envelope)
        return null;
    const graceUntil = new Date(record.envelope.graceUntil || record.graceUntil || 0).getTime();
    if (!Number.isFinite(graceUntil) || graceUntil < Date.now())
        return null;
    return { envelope: record.envelope, strategyVersion: String(record.strategyVersion || record.envelope.strategyVersion || ''), artifactHash: String(record.artifactHash || record.envelope.artifactHash || ''), updatedAt: record.updatedAt || null };
}
async function readCacheMetadata() {
    let reference = context_1.db.collection(constants_1.C.strategyCache).doc(CACHE_ID);
    if (typeof reference.field === 'function')
        reference = reference.field({ strategyVersion: true, artifactHash: true, updatedAt: true });
    try {
        const record = getFirstDocument(await reference.get());
        if (!record)
            return null;
        return { strategyVersion: String(record.strategyVersion || ''), artifactHash: String(record.artifactHash || ''), updatedAt: record.updatedAt || null };
    }
    catch (error) {
        if (isMissingCacheDocument(error))
            return null;
        throw error;
    }
}
function memoryFrom(envelope, strategy) {
    return { strategy, artifactHash: String(envelope.artifactHash || ''), strategyVersion: String(envelope.strategyVersion || ''), expiresAt: new Date(envelope.graceUntil).getTime() };
}
function assertRefreshMetadata(envelope, strategy) {
    const artifactHash = String(envelope?.artifactHash || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(artifactHash))
        throw Object.assign(new Error('strategy artifact metadata invalid'), { code: 'STRATEGY_CONTRACT_INVALID', retryable: false });
    const required = String(strategy?.minimumClientContractVersion || '').trim();
    const client = String(process.env.STRATEGY_CLIENT_CONTRACT_VERSION || '1').trim();
    if (!/^\d+$/.test(required) || !/^\d+$/.test(client) || Number(required) > Number(client))
        throw Object.assign(new Error('strategy client incompatible'), { code: 'STRATEGY_CLIENT_INCOMPATIBLE', retryable: false });
}
function safeRefreshError(error) {
    const code = String(error?.code || error?.errCode || '');
    if (['STRATEGY_SIGNATURE_INVALID', 'STRATEGY_DECRYPT_FAILED', 'STRATEGY_CONTRACT_INVALID', 'STRATEGY_CLIENT_INCOMPATIBLE'].includes(code)) return error;
    if (code.startsWith('STRATEGY_REMOTE_') || code.startsWith('STRATEGY_SERVICE_')) return Object.assign(new Error('remote strategy fetch failed'), { code: 'STRATEGY_REMOTE_FETCH_FAILED', retryable: true });
    return Object.assign(new Error('strategy contract invalid'), { code: 'STRATEGY_CONTRACT_INVALID', retryable: false });
}
function responseSummary(value) {
    return String(value || '').replace(/https?:\/\/\S+/g, '[REDACTED_URL]').replace(/[A-Za-z0-9+/=]{80,}/g, '[REDACTED]').slice(0, 300);
}
function requestJson(urlText, body) {
    return new Promise((resolve, reject) => {
        let url;
        try {
            url = new URL(urlText);
        }
        catch (error) {
            reject(Object.assign(new Error('策略服务 URL 无效'), { code: 'STRATEGY_REMOTE_REQUEST_FAILED', errMsg: String(error?.message || '') }));
            return;
        }
        const selfHostedHttp = String(process.env.SELF_HOSTED || '').toLowerCase() === 'true'
            && url.protocol === 'http:'
            && ['api', '127.0.0.1', 'localhost'].includes(url.hostname);
        if (url.protocol !== 'https:' && !selfHostedHttp) {
            reject(Object.assign(new Error('策略服务必须使用 HTTPS（Self-Hosted 内网除外）'), { code: 'STRATEGY_REMOTE_REQUEST_FAILED' }));
            return;
        }
        const timeoutMs = Math.max(1000, Number(process.env.STRATEGY_SERVICE_TIMEOUT_MS || 8000));
        let settled = false;
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
        };
        const transport = url.protocol === 'http:' ? http : https;
        const request = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
            response.on('error', (error) => fail(Object.assign(new Error(String(error?.message || '策略响应读取失败')), { code: 'STRATEGY_REMOTE_REQUEST_FAILED', errMsg: String(error?.errMsg || error?.message || '') })));
            response.on('end', () => {
                if (settled)
                    return;
                const text = Buffer.concat(chunks).toString('utf8');
                if (Number(response.statusCode || 0) < 200 || Number(response.statusCode || 0) >= 300) {
                    fail(Object.assign(new Error(`策略服务 HTTP ${response.statusCode}`), { code: 'STRATEGY_REMOTE_HTTP_ERROR', status: response.statusCode, errMsg: responseSummary(text) }));
                    return;
                }
                try {
                    const payload = JSON.parse(text);
                    settled = true;
                    resolve(payload);
                }
                catch (error) {
                    fail(Object.assign(new Error('策略服务返回无效 JSON'), { code: 'STRATEGY_REMOTE_INVALID_JSON', errMsg: responseSummary(text) }));
                }
            });
        });
        request.on('error', (error) => {
            const code = error?.code === 'STRATEGY_REMOTE_TIMEOUT' ? 'STRATEGY_REMOTE_TIMEOUT' : 'STRATEGY_REMOTE_REQUEST_FAILED';
            fail(Object.assign(new Error(String(error?.message || '策略远程请求失败')), { code, errMsg: String(error?.errMsg || error?.message || '') }));
        });
        if (typeof request.setTimeout === 'function')
            request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('策略远程请求超时'), { code: 'STRATEGY_REMOTE_TIMEOUT' })));
        request.write(body);
        request.end();
    });
}
async function fetchEnvelope(currentVersion) {
    const request = {
        customerId: envText('STRATEGY_CUSTOMER_ID'), licenseId: envText('STRATEGY_LICENSE_ID'), appIdHash: envText('STRATEGY_APP_ID_HASH'),
        currentVersion, timestamp: Date.now(), nonce: crypto.randomBytes(12).toString('hex'),
    };
    if (Object.keys(request).some((key) => !ALLOWED_REQUEST_KEYS.includes(key)))
        throw new Error('策略请求包含未授权字段');
    return requestJson(`${envText('STRATEGY_SERVICE_URL').replace(/\/$/, '')}/v1/strategy/latest`, JSON.stringify(request));
}
async function loadMissingRuntimeStrategy() {
    if (cacheMissLoad)
        return cacheMissLoad;
    cacheMissLoad = (async () => {
        const cached = await readCache();
        if (cached) {
            const strategy = decryptEnvelope(cached.envelope);
            memory = memoryFrom(cached.envelope, strategy);
            return strategy;
        }
        const envelope = await fetchEnvelope('');
        const strategy = decryptEnvelope(envelope);
        assertRefreshMetadata(envelope, strategy);
        await saveCache(envelope);
        memory = memoryFrom(envelope, strategy);
        return strategy;
    })();
    try {
        return await cacheMissLoad;
    }
    finally {
        cacheMissLoad = null;
    }
}
function logCacheMissFailure(error) {
    try {
        Promise.resolve((0, audit_1.systemLog)('error', 'STRATEGY_CACHE_MISS_FETCH_FAILED', { code: String(error?.code || error?.errCode || 'STRATEGY_REMOTE_FETCH_FAILED'), message: 'strategy cache initialization failed', action: 'loadRuntimeStrategy' })).catch(() => { });
    }
    catch { }
}
async function loadRuntimeStrategy() {
    if (memory && memory.expiresAt > Date.now()) {
        return memory.strategy;
    }
    if (!configured()) {
        if (String(process.env.STRATEGY_REMOTE_REQUIRED || 'true').toLowerCase() === 'true')
            throw Object.assign(new Error('远程策略配置不完整，禁止降级到内置旧策略'), { code: 'STRATEGY_REMOTE_CONFIG_MISSING', retryable: false });
        return (0, embedded_1.decryptEmbeddedStrategy)();
    }
    let cacheMiss = false;
    try {
        const cached = await readCache();
        cacheMiss = !cached;
        if (cached) {
            const strategy = decryptEnvelope(cached.envelope);
            memory = memoryFrom(cached.envelope, strategy);
            return strategy;
        }
        return await loadMissingRuntimeStrategy();
    }
    catch (remoteError) {
        if (cacheMiss)
            logCacheMissFailure(remoteError);
        try {
            const cached = await readCache();
            if (cached) {
                const strategy = decryptEnvelope(cached.envelope);
                memory = memoryFrom(cached.envelope, strategy);
                return strategy;
            }
        }
        catch { }
        // 未启用过远程授权时保留现有内置策略；一旦显式要求远程授权，失败则明确报错。
        if (String(process.env.STRATEGY_REMOTE_REQUIRED || 'true').toLowerCase() !== 'true')
            return (0, embedded_1.decryptEmbeddedStrategy)();
        if (remoteError?.code === 'STRATEGY_SIGNATURE_INVALID')
            throw remoteError;
        const code = cacheMiss ? 'STRATEGY_CACHE_MISS_AND_FETCH_FAILED' : 'STRATEGY_REMOTE_FETCH_FAILED';
        throw Object.assign(new Error(String(remoteError?.message || remoteError?.errMsg || '远程策略获取失败')), { code, errMsg: String(remoteError?.errMsg || remoteError?.message || ''), causeCode: remoteError?.code || remoteError?.errCode || '' });
    }
}
async function refreshRuntimeStrategy() {
    if (!configured())
        throw Object.assign(new Error('remote strategy service not configured'), { code: 'STRATEGY_REMOTE_FETCH_FAILED', retryable: true });
    try {
        const previous = await readCache();
        const envelope = await fetchEnvelope(String(previous?.strategyVersion || memory?.strategyVersion || ''));
        const strategy = decryptEnvelope(envelope);
        assertRefreshMetadata(envelope, strategy);
        const previousArtifactHash = String(previous?.artifactHash || memory?.artifactHash || '');
        const previousStrategyVersion = String(previous?.strategyVersion || memory?.strategyVersion || '');
        if (previousArtifactHash && previousArtifactHash === envelope.artifactHash) {
            return { changed: false, previousStrategyVersion, currentStrategyVersion: previousStrategyVersion || envelope.strategyVersion, previousArtifactHash, currentArtifactHash: envelope.artifactHash, refreshedAt: (0, utils_1.now)() };
        }
        const refreshedAt = await saveCache(envelope);
        memory = memoryFrom(envelope, strategy);
        return { changed: true, previousStrategyVersion, currentStrategyVersion: envelope.strategyVersion, previousArtifactHash, currentArtifactHash: envelope.artifactHash, refreshedAt };
    }
    catch (error) {
        throw safeRefreshError(error);
    }
}
function resetRuntimeStrategyForTests() { memory = null; cacheMissLoad = null; }
exports.__strategyTest = { canonical, unsigned, decryptEnvelope, configured, readCache, readCacheMetadata, isMissingCacheDocument, requestJson, ALLOWED_REQUEST_KEYS };
