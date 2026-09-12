'use strict';

const { getDatabase } = require('../lib/document-db');
const storage = require('../lib/storage');
const { getRuntimeContext } = require('../lib/runtime-context');

const DYNAMIC_CURRENT_ENV = 'selfhost';
function init() { return undefined; }
function database() { return getDatabase(); }
function getWXContext() { return getRuntimeContext(); }
async function callFunction({ name, data } = {}) {
  const { invokeFunction } = require('../lib/function-registry');
  return { result: await invokeFunction(name, data || {}) };
}

module.exports = {
  DYNAMIC_CURRENT_ENV,
  init,
  database,
  getWXContext,
  callFunction,
  uploadFile: storage.uploadFile,
  downloadFile: storage.downloadFile,
  deleteFile: storage.deleteFile,
  getTempFileURL: storage.getTempFileURL,
};
