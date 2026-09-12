'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function root() {
  return path.resolve(String(process.env.STORAGE_ROOT || '/data/aiagent/files'));
}

function signingSecret() {
  const value = String(process.env.FILE_SIGNING_SECRET || '').trim();
  if (value.length < 32) throw Object.assign(new Error('FILE_SIGNING_SECRET must be at least 32 characters'), { code: 'FILE_SIGNING_SECRET_INVALID' });
  return value;
}

function normalizeCloudPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) throw Object.assign(new Error('Invalid file path'), { code: 'FILE_PATH_INVALID' });
  const safe = path.posix.normalize(normalized);
  if (safe === '..' || safe.startsWith('../') || path.posix.isAbsolute(safe)) throw Object.assign(new Error('Invalid file path'), { code: 'FILE_PATH_INVALID' });
  return safe;
}

function fileIdFromPath(cloudPath) { return `local://${normalizeCloudPath(cloudPath)}`; }
function cloudPathFromFileId(fileID) {
  const value = String(fileID || '');
  if (!value.startsWith('local://')) throw Object.assign(new Error('Unsupported file id'), { code: 'FILE_ID_UNSUPPORTED' });
  return normalizeCloudPath(value.slice('local://'.length));
}
function absolutePath(fileID) {
  const relative = cloudPathFromFileId(fileID);
  const candidate = path.resolve(root(), relative);
  if (candidate !== root() && !candidate.startsWith(`${root()}${path.sep}`)) throw Object.assign(new Error('Invalid file path'), { code: 'FILE_PATH_INVALID' });
  return candidate;
}
function publicBase() { return String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, ''); }
function signature(fileID, expires) { return crypto.createHmac('sha256', signingSecret()).update(`${fileID}|${expires}`).digest('hex'); }
function signedUrl(fileID, expires = Math.floor(Date.now() / 1000) + 3600) {
  const base = publicBase();
  if (!base) throw Object.assign(new Error('PUBLIC_BASE_URL is required'), { code: 'PUBLIC_BASE_URL_MISSING' });
  const sig = signature(fileID, expires);
  return `${base}/api/storage/file?fileId=${encodeURIComponent(fileID)}&expires=${expires}&sig=${sig}`;
}
function verifySignedRequest(fileID, expires, sig) {
  const timestamp = Number(expires);
  if (!fileID || !Number.isFinite(timestamp) || timestamp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signature(fileID, timestamp));
  const actual = Buffer.from(String(sig || ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function uploadFile({ cloudPath, fileContent }) {
  const fileID = fileIdFromPath(cloudPath);
  const target = absolutePath(fileID);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent));
  return { fileID };
}
async function downloadFile({ fileID }) { return { fileContent: await fs.readFile(absolutePath(fileID)) }; }
async function deleteFile({ fileList = [] } = {}) {
  const results = [];
  for (const fileID of Array.isArray(fileList) ? fileList : []) {
    try { await fs.unlink(absolutePath(fileID)); results.push({ fileID, status: 0, errMsg: '' }); }
    catch (error) {
      if (error?.code === 'ENOENT') results.push({ fileID, status: 0, errMsg: '' });
      else results.push({ fileID, status: -1, errMsg: String(error?.code || 'DELETE_FAILED') });
    }
  }
  return { fileList: results };
}
async function getTempFileURL({ fileList = [] } = {}) {
  return { fileList: (Array.isArray(fileList) ? fileList : []).map((fileID) => {
    try { return { fileID, status: 0, errMsg: '', tempFileURL: signedUrl(fileID) }; }
    catch (error) { return { fileID, status: -1, errMsg: String(error?.code || 'SIGNED_URL_FAILED'), tempFileURL: '' }; }
  }) };
}

module.exports = {
  uploadFile, downloadFile, deleteFile, getTempFileURL,
  absolutePath, fileIdFromPath, cloudPathFromFileId, signedUrl, verifySignedRequest,
};
