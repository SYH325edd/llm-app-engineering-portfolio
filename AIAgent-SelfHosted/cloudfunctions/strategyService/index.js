'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const STRATEGY_ROOT = path.join(PROJECT_ROOT, 'strategy');
const strategy = JSON.parse(fs.readFileSync(path.join(STRATEGY_ROOT, 'source', 'strategy-source.json'), 'utf8'));
const releaseManifest = JSON.parse(fs.readFileSync(path.join(STRATEGY_ROOT, 'release', 'current', 'strategy-manifest.json'), 'utf8'));
const licenseConfig = JSON.parse(fs.readFileSync(path.join(STRATEGY_ROOT, 'private', 'licenses.json'), 'utf8'));
const privateKeyPem = fs.readFileSync(path.join(STRATEGY_ROOT, 'private', 'production-signing-private.pem'), 'utf8');

const REQUEST_KEYS = ['customerId', 'licenseId', 'appIdHash', 'currentVersion', 'timestamp', 'nonce'];

function sameValues(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function validateReleaseManifest(strategyValue, manifest) {
  if (manifest?.strategyVersion !== strategyValue.strategyVersion) throw new Error('strategy release manifest strategyVersion is invalid');
  if (!/^[0-9a-f]{64}$/i.test(String(manifest.artifactHash || ''))) throw new Error('strategy release manifest artifactHash is invalid');
  if (typeof manifest.minimumClientContractVersion !== 'string' || !/^\d+$/.test(manifest.minimumClientContractVersion)) throw new Error('strategy release manifest minimumClientContractVersion is invalid');
  if (manifest.outputSchemaRegistryVersion !== strategyValue.outputSchemaRegistryVersion) throw new Error('strategy release manifest outputSchemaRegistryVersion is invalid');
  if (manifest.downstreamSemanticsVersion !== strategyValue.downstreamSemanticsVersion) throw new Error('strategy release manifest downstreamSemanticsVersion is invalid');
  if (manifest.modelRuntimeContractVersion !== strategyValue.modelRuntimeContractVersion) throw new Error('strategy release manifest modelRuntimeContractVersion is invalid');
  if (manifest.modelOutputRepairPolicyVersion !== strategyValue.modelOutputRepairPolicy?.version) throw new Error('strategy release manifest modelOutputRepairPolicyVersion is invalid');
  if (!sameValues(manifest.outputSchemaIds, strategyValue.outputSchemaIds)) throw new Error('strategy release manifest outputSchemaIds is invalid');
}

validateReleaseManifest(strategy, releaseManifest);

const runtimeStrategy = {
  ...strategy,
  minimumClientContractVersion: String(releaseManifest.minimumClientContractVersion),
};

function errorWithCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertMetadataOnly(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw errorWithCode('请求格式错误', 'INVALID_REQUEST');
  }
  const unknown = Object.keys(body).filter((key) => !REQUEST_KEYS.includes(key));
  if (unknown.length) {
    throw errorWithCode(`请求包含未授权字段: ${unknown.join(',')}`, 'DATA_MINIMIZATION_VIOLATION');
  }
  for (const key of ['customerId', 'licenseId', 'timestamp', 'nonce']) {
    if (!String(body[key] ?? '').trim()) {
      throw errorWithCode(`缺少字段: ${key}`, 'INVALID_REQUEST');
    }
  }
  const timestamp = Number(body.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    throw errorWithCode('请求时间无效或已过期', 'REQUEST_EXPIRED');
  }
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(String(body.nonce))) {
    throw errorWithCode('nonce 格式错误', 'INVALID_REQUEST');
  }
}

function buildEnvelope({ selectedLicense, now = new Date() }) {
  if (!['active', 'grace'].includes(selectedLicense.status)) {
    throw errorWithCode('授权不可用', `LICENSE_${String(selectedLicense.status).toUpperCase()}`);
  }

  const expiresAtTime = new Date(selectedLicense.expiresAt).getTime();
  const graceUntilTime = expiresAtTime + Number(selectedLicense.graceDays || 0) * 86400000;
  if (!Number.isFinite(expiresAtTime) || now.getTime() > graceUntilTime) {
    throw errorWithCode('授权已到期', 'LICENSE_EXPIRED');
  }

  const effectiveStatus = now.getTime() > expiresAtTime ? 'grace' : selectedLicense.status;
  const encryptionKey = Buffer.from(String(selectedLicense.encryptionKeyHex || ''), 'hex');
  if (encryptionKey.length !== 32) {
    throw errorWithCode('授权加密密钥无效', 'LICENSE_KEY_INVALID');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(runtimeStrategy), 'utf8')),
    cipher.final(),
  ]);

  const issuedAt = now.toISOString();
  const expiresAt = new Date(expiresAtTime).toISOString();
  const graceUntil = new Date(graceUntilTime).toISOString();

  const unsigned = {
    schemaVersion: 1,
    strategyVersion: strategy.strategyVersion,
    artifactHash: releaseManifest.artifactHash,
    licenseStatus: effectiveStatus,
    issuedAt,
    expiresAt,
    graceUntil,
    encryption: {
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    },
  };

  const signature = crypto
    .sign('sha256', Buffer.from(JSON.stringify(unsigned), 'utf8'), privateKeyPem)
    .toString('base64');

  return { ...unsigned, signature };
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

function parseBody(event) {
  if (event && event.body && typeof event.body === 'object') return event.body;
  let raw = String(event?.body || '');
  if (event?.isBase64Encoded && raw) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) {
    throw errorWithCode('请求体过大', 'REQUEST_TOO_LARGE');
  }
  return JSON.parse(raw || '{}');
}

exports.main = async (event = {}) => {
  const method = String(event.httpMethod || event.requestContext?.httpMethod || 'POST').toUpperCase();

  if (method === 'GET') {
    return jsonResponse(200, {
      ok: true,
      service: 'AIAgent Strategy Service',
      strategyVersion: strategy.strategyVersion,
      environment: 'selfhost',
    });
  }

  if (method !== 'POST') {
    return jsonResponse(405, { code: 'METHOD_NOT_ALLOWED', message: '只允许 POST 请求' });
  }

  try {
    const body = parseBody(event);
    assertMetadataOnly(body);

    const selectedLicense = (licenseConfig.licenses || []).find(
      (item) => item.customerId === body.customerId && item.licenseId === body.licenseId,
    );
    if (!selectedLicense) throw errorWithCode('授权不存在', 'LICENSE_NOT_FOUND');
    if (selectedLicense.appIdHash && selectedLicense.appIdHash !== body.appIdHash) {
      throw errorWithCode('AppID 授权不匹配', 'LICENSE_APP_MISMATCH');
    }

    return jsonResponse(200, buildEnvelope({ selectedLicense }));
  } catch (error) {
    const code = String(error?.code || 'STRATEGY_SERVICE_ERROR');
    const status = code.startsWith('LICENSE_') ? 403 : 400;
    return jsonResponse(status, {
      code,
      message: String(error?.message || '请求失败'),
    });
  }
};

exports.validateReleaseManifest = validateReleaseManifest;
