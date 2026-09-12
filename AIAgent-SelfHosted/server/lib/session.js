'use strict';

const crypto = require('node:crypto');

function secret() {
  const value = String(process.env.SESSION_SECRET || '').trim();
  if (value.length < 32) {
    const error = new Error('SESSION_SECRET must be at least 32 characters');
    error.code = 'SESSION_SECRET_INVALID';
    throw error;
  }
  return value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signature(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function issueSession(identity, now = Date.now()) {
  const ttlSeconds = Math.max(3600, Math.min(30 * 86400, Number(process.env.SESSION_TTL_SECONDS || 7 * 86400)));
  const payload = encode({
    v: 1,
    openid: String(identity?.openid || ''),
    unionid: String(identity?.unionid || ''),
    appid: String(identity?.appid || process.env.WECHAT_APP_ID || ''),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ttlSeconds,
  });
  return `${payload}.${signature(payload)}`;
}

function verifySession(token, now = Date.now()) {
  const [payload, suppliedSignature, extra] = String(token || '').split('.');
  if (!payload || !suppliedSignature || extra) throw Object.assign(new Error('Invalid session'), { code: 'SESSION_INVALID' });
  const expected = signature(payload);
  const actualBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw Object.assign(new Error('Invalid session'), { code: 'SESSION_INVALID' });
  }
  const value = decode(payload);
  if (!value.openid || !value.appid || Number(value.exp || 0) <= Math.floor(now / 1000)) {
    throw Object.assign(new Error('Session expired'), { code: 'SESSION_EXPIRED' });
  }
  if (process.env.WECHAT_APP_ID && value.appid !== process.env.WECHAT_APP_ID) {
    throw Object.assign(new Error('Session app mismatch'), { code: 'SESSION_APP_MISMATCH' });
  }
  return value;
}

function bearerToken(headers = {}) {
  const value = String(headers.authorization || headers.Authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : '';
}

module.exports = { issueSession, verifySession, bearerToken };
