'use strict';

const path = require('node:path');
const { runWithRuntimeContext, getRuntimeContext } = require('./runtime-context');

const root = path.resolve(__dirname, '..', '..');
const handlers = Object.freeze({
  appApi: () => require(path.join(root, 'cloudfunctions/appApi/index.js')).main,
  ttsWorker: () => require(path.join(root, 'cloudfunctions/ttsWorker/index.js')).main,
  exportData: () => require(path.join(root, 'cloudfunctions/exportData/index.js')).main,
  purgeArchived: () => require(path.join(root, 'cloudfunctions/purgeArchived/index.js')).main,
  initDatabase: () => require(path.join(root, 'cloudfunctions/initDatabase/index.js')).main,
  taskWorker: () => require(path.join(root, 'cloudfunctions/taskWorker/index.js')).main,
});

async function invokeFunction(name, data = {}, identity = undefined) {
  const loader = handlers[String(name || '')];
  if (!loader) throw Object.assign(new Error('Function not found'), { code: 'FUNCTION_NOT_FOUND' });
  const current = identity || getRuntimeContext();
  return runWithRuntimeContext({
    OPENID: current.OPENID || current.openid || '',
    APPID: current.APPID || current.appid || process.env.WECHAT_APP_ID || '',
    UNIONID: current.UNIONID || current.unionid || '',
  }, () => loader()(data || {}));
}

module.exports = { invokeFunction };
