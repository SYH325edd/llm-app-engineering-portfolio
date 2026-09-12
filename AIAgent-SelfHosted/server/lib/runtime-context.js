'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function runWithRuntimeContext(context, callback) {
  return storage.run(Object.freeze({
    OPENID: String(context?.OPENID || ''),
    APPID: String(context?.APPID || process.env.WECHAT_APP_ID || ''),
    UNIONID: String(context?.UNIONID || ''),
    ENV: 'selfhost',
  }), callback);
}

function getRuntimeContext() {
  return storage.getStore() || {
    OPENID: '',
    APPID: String(process.env.WECHAT_APP_ID || ''),
    UNIONID: '',
    ENV: 'selfhost',
  };
}

module.exports = { runWithRuntimeContext, getRuntimeContext };
