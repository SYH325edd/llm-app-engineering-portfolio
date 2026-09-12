'use strict';

async function exchangeCode(code) {
  const appid = String(process.env.WECHAT_APP_ID || '').trim();
  const secret = String(process.env.WECHAT_APP_SECRET || '').trim();
  const jsCode = String(code || '').trim();
  if (!appid || !secret) throw Object.assign(new Error('WeChat server credentials are not configured'), { code: 'WECHAT_CONFIG_MISSING' });
  if (!jsCode) throw Object.assign(new Error('Missing wx.login code'), { code: 'WECHAT_CODE_MISSING' });

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', jsCode);
  url.searchParams.set('grant_type', 'authorization_code');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.errcode || !payload.openid) {
      const error = new Error('WeChat login verification failed');
      error.code = 'WECHAT_LOGIN_FAILED';
      error.wechatCode = payload.errcode || response.status;
      throw error;
    }
    return { openid: String(payload.openid), unionid: String(payload.unionid || ''), appid };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { exchangeCode };
