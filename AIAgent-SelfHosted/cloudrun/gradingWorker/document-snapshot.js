'use strict';

const RESPONSE_WRAPPER_KEYS = new Set([
  'data',
  'result',
  'body',
  'list',
  'documents',
  'records',
  'requestId',
  'requestID',
  'code',
  'message',
  'errMsg',
  'statusCode',
  'headers',
  'method',
  'transactionId',
  'errCode',
  'success'
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getFirstDocument(value, depth = 0) {
  if (!value || depth > 8) return null;
  if (Array.isArray(value)) {
    return value.length ? getFirstDocument(value[0], depth + 1) : null;
  }
  if (!isObject(value)) return null;

  const keys = Object.keys(value);
  const hasBusinessKey = keys.some((key) => !RESPONSE_WRAPPER_KEYS.has(key));
  if (hasBusinessKey) return value;

  for (const key of ['data', 'result', 'body', 'list', 'documents', 'records']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const document = getFirstDocument(value[key], depth + 1);
    if (document) return document;
  }
  return null;
}

function describeSnapshot(value, depth = 0) {
  if (depth > 3) return { type: 'max_depth' };
  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      first: value.length ? describeSnapshot(value[0], depth + 1) : null
    };
  }
  if (typeof value !== 'object') return { type: typeof value };
  const keys = Object.keys(value).sort().slice(0, 20);
  const nested = {};
  for (const key of ['data', 'result', 'body', 'list', 'documents', 'records']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) nested[key] = describeSnapshot(value[key], depth + 1);
  }
  return { type: 'object', keys, nested };
}

module.exports = { getFirstDocument, describeSnapshot };
