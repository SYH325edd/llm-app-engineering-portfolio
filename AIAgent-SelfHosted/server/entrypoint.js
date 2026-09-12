'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function loadStrategyEnvironment() {
  const root = path.resolve(__dirname, '..', 'strategy', 'private');
  const licensesPath = path.join(root, 'licenses.json');
  const publicKeyPath = path.join(root, 'production-signing-public.pem');
  if (!fs.existsSync(licensesPath) || !fs.existsSync(publicKeyPath)) return;

  const config = JSON.parse(fs.readFileSync(licensesPath, 'utf8'));
  const appid = String(process.env.WECHAT_APP_ID || '').trim();
  const appIdHash = appid ? crypto.createHash('sha256').update(appid).digest('hex') : '';
  const licenses = Array.isArray(config.licenses) ? config.licenses : [];
  const license = licenses.find((item) => item.appIdHash === appIdHash && ['active', 'grace'].includes(item.status))
    || licenses.find((item) => ['active', 'grace'].includes(item.status))
    || licenses[0];
  if (!license) throw new Error('No strategy license is configured');

  process.env.STRATEGY_CUSTOMER_ID ||= String(license.customerId || '');
  process.env.STRATEGY_LICENSE_ID ||= String(license.licenseId || '');
  process.env.STRATEGY_APP_ID_HASH ||= String(license.appIdHash || appIdHash || '');
  process.env.STRATEGY_LICENSE_KEY ||= String(license.encryptionKeyHex || '');
  process.env.STRATEGY_PUBLIC_KEY_BASE64 ||= Buffer.from(fs.readFileSync(publicKeyPath, 'utf8'), 'utf8').toString('base64');
  process.env.STRATEGY_REMOTE_REQUIRED ||= 'true';
}

process.env.SELF_HOSTED = 'true';
loadStrategyEnvironment();

const target = String(process.argv[2] || 'api');
const targets = {
  api: './index.js',
  worker: '../cloudrun/gradingWorker/server.js',
  maintenance: './maintenance.js',
};
if (!targets[target]) throw new Error(`Unknown runtime target: ${target}`);

if (target === 'worker') {
  const worker = require(path.resolve(__dirname, targets[target]));
  const port = Number(process.env.PORT) || 8080;
  console.log(`GRADING_WORKER_RUNTIME_BUILD_ID=${worker.RUNTIME_BUILD_ID}`);
  const server = worker.createServer();
  const beginShutdown = async () => {
    try {
      await server.beginShutdown();
    } catch (error) {
      console.error('[gradingWorker] shutdown failed', error);
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', beginShutdown);
  process.once('SIGINT', beginShutdown);
  server.once('error', (error) => {
    console.error('[gradingWorker] server error', error);
    process.exitCode = 1;
  });
  server.listen(port);
} else {
  require(path.resolve(__dirname, targets[target]));
}
