import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const exists = (...parts) => fs.existsSync(path.join(root, ...parts));
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('keeps a compact single-source project layout', () => {
  const allowedRootEntries = new Set([
    '.dockerignore', '.env.example', '.gitignore', 'README.md', 'cloudbase', 'cloudfunctions', 'cloudrun',
    'docker-compose.yml', 'docs', 'miniapp', 'minitest', 'package.json', 'project.config.json', 'project.private.config.json', 'scripts', 'server',
    'shared', 'strategy', 'templates', 'tests',
  ]);
  const unexpected = fs.readdirSync(root).filter((name) => !allowedRootEntries.has(name));
  assert.deepEqual(unexpected, []);

  assert.equal(exists('strategy', 'source', 'strategy-source.json'), true);
  assert.equal(exists('strategy', 'source', 'output-schema-registry.json'), true);
  assert.equal(exists('strategy', 'private', 'licenses.json'), true);
  assert.equal(exists('strategy', 'private', 'production-signing-private.pem'), true);
  assert.equal(exists('strategy', 'private', 'production-signing-public.pem'), true);
  assert.equal(exists('strategy', 'release', 'current', 'strategy-manifest.json'), true);
  assert.equal(exists('cloudfunctions', 'strategyService', 'private'), false, 'strategyService must consume the unified project strategy source');

  const packageJson = JSON.parse(read('package.json'));
  assert.match(packageJson.scripts?.['strategy:publish'] || '', /publish-strategy\.mjs/);
  assert.equal(Object.entries(packageJson.scripts || {}).some(([name, command]) => /strategy.*sync|sync.*strategy/i.test(`${name} ${command}`)), false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'scripts')).filter((name) => /^sync-/i.test(name)), []);
});

test('README presents AIAgent as one authoritative source project', () => {
  const readme = read('README.md');
  assert.match(readme, /唯一源码|单一源码/);
});
