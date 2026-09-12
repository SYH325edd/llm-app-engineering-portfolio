const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const workerRoot = path.resolve(__dirname, '..');

test('Docker build context includes and resolves the task watcher module', async () => {
  const dockerfile = fs.readFileSync(path.join(workerRoot, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^COPY package\.json package-lock\.json \.\/$/m);
  assert.match(dockerfile, /^RUN npm ci --omit=dev$/m);
  assert.match(dockerfile, /^COPY cloudbase-client\.js \.\/$/m);
  assert.match(dockerfile, /^COPY document-snapshot\.js \.\/$/m);
  assert.match(dockerfile, /^COPY task-watcher\.js \.\/$/m);
  assert.match(dockerfile, /^COPY hard-problem-training-runtime\.js \.\/$/m);
  for (const name of ['package.json', 'package-lock.json', 'server.js', 'claim-task.js', 'cloudbase-client.js', 'document-snapshot.js', 'task-watcher.js', 'hard-problem-training-runtime.js', 'shared', 'runtime']) {
    assert.ok(fs.existsSync(path.join(workerRoot, name)), `${name} must be in the Docker build context`);
  }

  const copiedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grading-worker-'));
  try {
    for (const name of ['package.json', 'package-lock.json', 'server.js', 'claim-task.js', 'cloudbase-client.js', 'document-snapshot.js', 'task-watcher.js', 'hard-problem-training-runtime.js', 'shared', 'runtime']) {
      fs.cpSync(path.join(workerRoot, name), path.join(copiedRoot, name), { recursive: true });
    }
    if (process.platform === 'win32') {
      execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --omit=dev'], { cwd: copiedRoot, stdio: 'pipe' });
    } else {
      execFileSync('npm', ['ci', '--omit=dev'], { cwd: copiedRoot, stdio: 'pipe' });
    }
    const requireFromCopy = Module.createRequire(path.join(copiedRoot, 'server.js'));
    assert.equal(requireFromCopy.resolve('./cloudbase-client'), path.join(copiedRoot, 'cloudbase-client.js'));
    assert.equal(requireFromCopy.resolve('./document-snapshot'), path.join(copiedRoot, 'document-snapshot.js'));
    assert.equal(requireFromCopy.resolve('./task-watcher'), path.join(copiedRoot, 'task-watcher.js'));
    assert.equal(requireFromCopy.resolve('./hard-problem-training-runtime'), path.join(copiedRoot, 'hard-problem-training-runtime.js'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(copiedRoot, 'package.json'), 'utf8')).scripts.start, 'node server.js');
    assert.doesNotThrow(() => requireFromCopy('@cloudbase/js-sdk'));
    assert.doesNotThrow(() => requireFromCopy('./runtime/taskWorker-shared/result-semantics'));
    assert.doesNotThrow(() => requireFromCopy('./shared/model-runtime'));
    await new Promise((resolve, reject) => {
      const environment = { ...process.env, PORT: '0' };
      delete environment.NODE_PATH;
      const child = spawn(process.execPath, ['server.js'], { cwd: copiedRoot, env: environment });
      let output = '';
      let settled = false;
      const done = (error) => {
        if (settled) return;
        settled = true;
        const finish = () => error ? reject(error) : resolve();
        if (child.exitCode !== null) return finish();
        child.once('exit', finish);
        child.kill();
      };
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => {
        output += chunk;
        if (/MODULE_NOT_FOUND/.test(output)) done(new Error(output));
      });
      child.on('error', done);
      setTimeout(() => done(/MODULE_NOT_FOUND/.test(output) ? new Error(output) : null), 300);
    });
  } finally {
    fs.rmSync(copiedRoot, { recursive: true, force: true });
  }
});


test('runtime build preserves the CloudRun database context adapter', () => {
  const source = fs.readFileSync(path.join(workerRoot, 'runtime/taskWorker-shared/context.js'), 'utf8');
  assert.match(source, /getCloudbaseClient/);
  assert.match(source, /\.\.\/\.\.\/cloudbase-client/);
  assert.doesNotMatch(source, /wx-server-sdk/);
});

test('runtime build copies and loads result semantics without mutating the live test tree', (t) => {
  const projectRoot = path.resolve(workerRoot, '..', '..');
  const buildScript = path.join(projectRoot, 'scripts', 'build-grading-worker-runtime.js');
  if (!fs.existsSync(buildScript)) return t.skip('standalone Cloud Run artifact does not include source-tree build scripts');
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grading-worker-build-'));
  try {
    fs.mkdirSync(path.join(isolatedRoot, 'scripts'), { recursive: true });
    fs.copyFileSync(buildScript, path.join(isolatedRoot, 'scripts', 'build-grading-worker-runtime.js'));
    fs.cpSync(path.join(projectRoot, 'cloudfunctions', 'taskWorker', 'shared'), path.join(isolatedRoot, 'cloudfunctions', 'taskWorker', 'shared'), { recursive: true });
    fs.mkdirSync(path.join(isolatedRoot, 'cloudrun', 'gradingWorker', 'runtime'), { recursive: true });
    fs.copyFileSync(path.join(workerRoot, 'runtime', 'cloudrun-context.js'), path.join(isolatedRoot, 'cloudrun', 'gradingWorker', 'runtime', 'cloudrun-context.js'));
    fs.cpSync(path.join(workerRoot, 'shared'), path.join(isolatedRoot, 'cloudrun', 'gradingWorker', 'shared'), { recursive: true });

    const result = spawnSync(process.execPath, [path.join(isolatedRoot, 'scripts', 'build-grading-worker-runtime.js')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);

    const source = path.join(isolatedRoot, 'cloudrun', 'gradingWorker', 'shared', 'result-semantics.js');
    const target = path.join(isolatedRoot, 'cloudrun', 'gradingWorker', 'runtime', 'taskWorker-shared', 'result-semantics.js');
    assert.ok(fs.existsSync(target), 'runtime result semantics must exist after build');
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
      crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    );
    assert.doesNotThrow(() => require(target));
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});
