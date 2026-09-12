import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const exists = (...parts) => fs.existsSync(path.join(root, ...parts));

test('self-hosted runtime is an additive adapter around the existing business handlers', () => {
  for (const file of [
    ['server', 'index.js'],
    ['server', 'lib', 'document-db.js'],
    ['server', 'lib', 'storage.js'],
    ['server', 'lib', 'session.js'],
    ['server', 'compat', 'wx-server-sdk.js'],
    ['miniapp', 'services', 'selfhost-cloud.js'],
    ['docker-compose.yml'],
    ['server', 'Dockerfile'],
  ]) assert.equal(exists(...file), true, `missing ${file.join('/')}`);

  const appApiContext = read('cloudfunctions', 'appApi', 'shared', 'context.js');
  assert.match(appApiContext, /SELF_HOSTED/);
  assert.match(appApiContext, /server\/compat\/wx-server-sdk/);

  const workerClient = read('cloudrun', 'gradingWorker', 'cloudbase-client.js');
  assert.match(workerClient, /SELF_HOSTED/);
  assert.match(workerClient, /document-db/);

  const app = read('miniapp', 'app.js');
  assert.match(app, /installSelfHostedCloud/);
});

test('deployment keeps the existing services isolated and only publishes the API loopback port', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /127\.0\.0\.1:3100:3100/);
  assert.doesNotMatch(compose, /3306:3306|27017:27017/);
  assert.match(compose, /\/data\/aiagent/);
  assert.match(compose, /aiagent_net/);
});
