'use strict';

let sharedClient;

const WRITE_METHODS = new Set(['update', 'set', 'add']);

function selfHostedEnabled() {
  return String(process.env.SELF_HOSTED || '').toLowerCase() === 'true';
}

function createSelfHostedClient() {
  const { getDatabase } = require('../../server/lib/document-db');
  const storage = require('../../server/lib/storage');
  const db = getDatabase();

  async function callFunction({ name, data } = {}) {
    const base = String(process.env.INTERNAL_API_URL || 'http://api:3100').replace(/\/$/, '');
    const token = String(process.env.INTERNAL_SERVICE_TOKEN || '').trim();
    if (!token) throw Object.assign(new Error('INTERNAL_SERVICE_TOKEN is required'), { code: 'INTERNAL_SERVICE_TOKEN_MISSING' });
    const response = await fetch(`${base}/internal/function/${encodeURIComponent(String(name || ''))}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(data || {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(String(payload?.message || 'Internal function call failed')), { code: String(payload?.code || 'INTERNAL_FUNCTION_FAILED'), status: response.status });
    return { result: payload };
  }

  const cloud = { getTempFileURL: storage.getTempFileURL, callFunction };
  return { app: null, database: () => db, getTempFileURL: storage.getTempFileURL, callFunction, cloud };
}

function unwrapLegacyWrite(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === 'data' && value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    ? value.data
    : value;
}

function adaptReference(reference) {
  return new Proxy(reference, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      if (WRITE_METHODS.has(property)) return (payload, ...args) => value.call(target, unwrapLegacyWrite(payload), ...args);
      return value.bind(target);
    }
  });
}

function adaptCollection(collection) {
  return new Proxy(collection, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      if (property === 'doc') return (...args) => adaptReference(value.apply(target, args));
      if (WRITE_METHODS.has(property)) return (payload, ...args) => value.call(target, unwrapLegacyWrite(payload), ...args);
      return value.bind(target);
    }
  });
}

function adaptTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object') return transaction;
  return new Proxy(transaction, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      if (property === 'collection') return (...args) => adaptCollection(value.apply(target, args));
      return value.bind(target);
    }
  });
}

function adaptDatabase(database) {
  return new Proxy(database, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      if (property === 'collection') return (...args) => adaptCollection(value.apply(target, args));
      if (property === 'runTransaction') return (callback, ...args) => value.call(target, (transaction) => callback(adaptTransaction(transaction)), ...args);
      return value.bind(target);
    }
  });
}

function errorMessage(error) {
  if (typeof error === 'string' && error) return error;
  if (error && typeof error.message === 'string' && error.message) return error.message;
  if (error && typeof error.errMsg === 'string' && error.errMsg) return error.errMsg;
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch {}
  return 'STORAGE_SIGNED_URL_FAILED';
}

function createCloudbaseClient({ cloudbase, envId = process.env.CLOUDBASE_ENV_ID } = {}) {
  if (selfHostedEnabled() && !cloudbase) return createSelfHostedClient();
  cloudbase ||= require('@cloudbase/js-sdk');
  const normalizedEnvId = String(envId || '').trim();
  if (!normalizedEnvId) {
    const error = new Error('CLOUDBASE_ENV_ID is required');
    error.code = 'CLOUDBASE_ENV_ID_MISSING';
    throw error;
  }
  const app = cloudbase.init({ env: normalizedEnvId });
  const db = adaptDatabase(app.database());
  const storage = app.storage.from();

  async function getTempFileURL({ fileList = [] } = {}) {
    const files = Array.isArray(fileList) ? fileList : [];
    return { fileList: await Promise.all(files.map(async (fileID) => {
      try {
        const { data, error } = await storage.createSignedUrl(fileID, 3600);
        if (error) throw error;
        if (!data || !data.signedUrl) throw new Error('STORAGE_SIGNED_URL_MISSING');
        return { fileID, status: 0, errMsg: '', tempFileURL: data.signedUrl };
      } catch (error) {
        return { fileID, status: -1, errMsg: errorMessage(error), tempFileURL: '' };
      }
    })) };
  }

  async function callFunction(options) {
    if (typeof app.callFunction !== 'function') {
      return { skipped: true, code: 'CLOUDBASE_CALL_FUNCTION_UNAVAILABLE' };
    }
    return app.callFunction(options);
  }

  const cloud = { getTempFileURL, callFunction };
  return { app, database: () => db, getTempFileURL, callFunction, cloud };
}

function getCloudbaseClient() {
  return sharedClient ||= createCloudbaseClient();
}

module.exports = { createCloudbaseClient, getCloudbaseClient };
