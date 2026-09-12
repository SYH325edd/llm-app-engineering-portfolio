'use strict';

process.env.SELF_HOSTED = 'true';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Busboy = require('busboy');
const { exchangeCode } = require('./lib/wechat');
const { issueSession, verifySession, bearerToken } = require('./lib/session');
const { invokeFunction } = require('./lib/function-registry');
const { runWithRuntimeContext } = require('./lib/runtime-context');
const storage = require('./lib/storage');
const { getDatabase, closeDatabase } = require('./lib/document-db');

const PORT = Math.max(1, Math.min(65535, Number(process.env.PORT || 3100)));
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = Math.max(5 * 1024 * 1024, Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024));
const PUBLIC_FUNCTIONS = new Set(['appApi', 'exportData']);
const INTERNAL_FUNCTIONS = new Set(['ttsWorker', 'taskWorker', 'purgeArchived', 'initDatabase']);

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function safeError(error) {
  return {
    code: String(error?.code || 'INTERNAL_ERROR').slice(0, 100),
    message: /secret|token|password|api[_-]?key/i.test(String(error?.message || ''))
      ? 'Internal server error'
      : String(error?.message || 'Internal server error').slice(0, 300),
  };
}

async function readJson(req, limit = MAX_JSON_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body too large'), { code: 'REQUEST_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { code: 'INVALID_JSON', status: 400 }); }
}

function requireIdentity(req) {
  const token = bearerToken(req.headers);
  if (!token) throw Object.assign(new Error('Authentication required'), { code: 'UNAUTHORIZED', status: 401 });
  return verifySession(token);
}

async function uploadDataSpace(identity) {
  const openid = String(identity?.openid || '').trim();
  if (!openid) return 'production';
  const userId = `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`;
  const user = await (await getDatabase().native()).collection('users').findOne({ _id: userId });
  if (user?.role === 'developer_admin' && user.status === 'ACTIVE') return 'developer-test';
  if (user?.role === 'student' && user.status === 'ACTIVE' && user.dataSpace === 'developer_test') return 'developer-test';
  return 'production';
}

function trustedUploadPath(cloudPath, dataSpace) {
  const raw = String(cloudPath || '').replace(/\\/g, '/');
  const segments = raw.replace(/^\/+/, '').split('/');
  if (segments.some((segment) => segment === '..') || ['production', 'developer-test'].includes(segments[0])) {
    throw Object.assign(new Error('Invalid file path'), { code: 'FILE_PATH_INVALID', status: 400 });
  }
  const normalized = storage.fileIdFromPath(raw).slice('local://'.length);
  return `${dataSpace === 'developer-test' ? 'developer-test' : 'production'}/${normalized}`;
}

function requireInternal(req) {
  const expected = String(process.env.INTERNAL_SERVICE_TOKEN || '').trim();
  const supplied = bearerToken(req.headers);
  if (!expected || supplied !== expected) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', status: 403 });
}

async function handleLogin(req, res) {
  const body = await readJson(req, 16 * 1024);
  const identity = await exchangeCode(body.code);
  json(res, 200, { success: true, token: issueSession(identity), expiresIn: Number(process.env.SESSION_TTL_SECONDS || 604800) });
}

async function handlePublicFunction(req, res, name) {
  if (!PUBLIC_FUNCTIONS.has(name)) throw Object.assign(new Error('Function not found'), { code: 'FUNCTION_NOT_FOUND', status: 404 });
  const identity = requireIdentity(req);
  const body = await readJson(req);
  const result = await invokeFunction(name, body, identity);
  json(res, 200, result);
}

async function handleInternalFunction(req, res, name) {
  requireInternal(req);
  if (!INTERNAL_FUNCTIONS.has(name)) throw Object.assign(new Error('Function not found'), { code: 'FUNCTION_NOT_FOUND', status: 404 });
  const body = await readJson(req);
  const result = await runWithRuntimeContext({ APPID: process.env.WECHAT_APP_ID || '' }, () => invokeFunction(name, body));
  json(res, 200, result);
}

async function handleUpload(req, res, url) {
  const identity = requireIdentity(req);
  const dataSpace = await uploadDataSpace(identity);
  const cloudPath = trustedUploadPath(url.searchParams.get('cloudPath') || '', dataSpace);
  await new Promise((resolve, reject) => {
    let fileBuffer = null;
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_UPLOAD_BYTES, fields: 4 } });
    busboy.on('file', (_name, stream) => {
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => { size += chunk.length; chunks.push(chunk); });
      stream.on('limit', () => reject(Object.assign(new Error('File too large'), { code: 'FILE_TOO_LARGE', status: 413 })));
      stream.on('end', () => { if (size <= MAX_UPLOAD_BYTES) fileBuffer = Buffer.concat(chunks); });
      stream.on('error', reject);
    });
    busboy.on('error', reject);
    busboy.on('finish', async () => {
      try {
        if (!fileBuffer) throw Object.assign(new Error('Upload file is missing'), { code: 'UPLOAD_FILE_MISSING', status: 400 });
        const result = await storage.uploadFile({ cloudPath, fileContent: fileBuffer });
        json(res, 200, result);
        resolve();
      } catch (error) { reject(error); }
    });
    req.pipe(busboy);
  });
}

async function handleDelete(req, res) {
  requireIdentity(req);
  const body = await readJson(req, 256 * 1024);
  json(res, 200, await storage.deleteFile({ fileList: body.fileList || [] }));
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pdf': 'application/pdf', '.json': 'application/json; charset=utf-8',
  })[ext] || 'application/octet-stream';
}

async function handleSignedFile(req, res, url) {
  const fileID = url.searchParams.get('fileId') || '';
  const expires = url.searchParams.get('expires') || '';
  const sig = url.searchParams.get('sig') || '';
  if (!storage.verifySignedRequest(fileID, expires, sig)) throw Object.assign(new Error('Signed URL is invalid or expired'), { code: 'SIGNED_URL_INVALID', status: 403 });
  const filePath = storage.absolutePath(fileID);
  const stat = await fs.promises.stat(filePath);
  const range = String(req.headers.range || '');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        res.writeHead(206, {
          'content-type': mimeType(filePath), 'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1,
          'cache-control': 'private, max-age=300',
        });
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }
    }
  }
  res.writeHead(200, { 'content-type': mimeType(filePath), 'content-length': stat.size, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=300' });
  fs.createReadStream(filePath).pipe(res);
}

async function handleStrategy(req, res) {
  const handler = require('../cloudfunctions/strategyService/index.js').main;
  const body = req.method === 'POST' ? await readJson(req, 16 * 1024) : {};
  const response = await handler({ httpMethod: req.method, body });
  res.writeHead(Number(response.statusCode || 200), response.headers || { 'content-type': 'application/json; charset=utf-8' });
  res.end(String(response.body || ''));
}

async function handler(req, res) {
  const startedAt = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      await getDatabase().native().then((db) => db.command({ ping: 1 }));
      return json(res, 200, { ok: true, service: 'AIAgent API', runtime: 'selfhost', uptime: Math.floor(process.uptime()) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/wechat') return await handleLogin(req, res);
    if (req.method === 'POST' && url.pathname.startsWith('/api/function/')) return await handlePublicFunction(req, res, decodeURIComponent(url.pathname.slice('/api/function/'.length)));
    if (req.method === 'POST' && url.pathname.startsWith('/internal/function/')) return await handleInternalFunction(req, res, decodeURIComponent(url.pathname.slice('/internal/function/'.length)));
    if (req.method === 'POST' && url.pathname === '/api/storage/upload') return await handleUpload(req, res, url);
    if (req.method === 'POST' && url.pathname === '/api/storage/delete') return await handleDelete(req, res);
    if (req.method === 'GET' && url.pathname === '/api/storage/file') return await handleSignedFile(req, res, url);
    if (url.pathname === '/v1/strategy/latest' && ['GET', 'POST'].includes(req.method)) return await handleStrategy(req, res);
    return json(res, 404, { code: 'NOT_FOUND', message: 'Not found' });
  } catch (error) {
    const status = Number(error?.status || (error?.code === 'ENOENT' ? 404 : 500));
    const payload = safeError(error);
    console.error('[api]', JSON.stringify({ method: req.method, path: url.pathname, status, code: payload.code, durationMs: Date.now() - startedAt }));
    if (!res.headersSent) json(res, status, payload);
    else res.destroy();
  }
}

const server = http.createServer(handler);
server.requestTimeout = 360000;
server.headersTimeout = 65000;
server.keepAliveTimeout = 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`[api] listening on :${PORT}`));

async function shutdown(signal) {
  console.log(`[api] ${signal} received`);
  server.close(async () => {
    await closeDatabase().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
