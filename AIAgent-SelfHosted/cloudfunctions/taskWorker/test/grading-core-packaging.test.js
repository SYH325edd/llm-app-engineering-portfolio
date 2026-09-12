const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');
const source = path.join(root, 'shared/grading-core/execute-grading-task.js');
const taskWorkerCopy = path.join(root, 'cloudfunctions/taskWorker/shared/grading-core/execute-grading-task.js');
const gradingWorkerCopy = path.join(root, 'cloudrun/gradingWorker/shared/grading-core/execute-grading-task.js');

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('build creates byte-identical grading-core deployment copies without mutating the live test tree', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grading-core-build-'));
  try {
    fs.mkdirSync(path.join(temporaryRoot, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts/build-grading-core.js'), path.join(temporaryRoot, 'scripts/build-grading-core.js'));
    fs.cpSync(path.join(root, 'shared'), path.join(temporaryRoot, 'shared'), { recursive: true });
    fs.cpSync(path.join(root, 'cloudfunctions/taskWorker/shared'), path.join(temporaryRoot, 'cloudfunctions/taskWorker/shared'), { recursive: true });
    for (const relative of ['cloudfunctions/appApi/shared', 'cloudfunctions/ttsWorker/shared', 'cloudrun/gradingWorker/shared']) {
      fs.mkdirSync(path.join(temporaryRoot, relative), { recursive: true });
    }
    execFileSync(process.execPath, [path.join(temporaryRoot, 'scripts/build-grading-core.js')], { cwd: temporaryRoot });
    const temporarySource = path.join(temporaryRoot, 'shared/grading-core/execute-grading-task.js');
    const sourceHash = sha256(temporarySource);
    assert.equal(sha256(path.join(temporaryRoot, 'cloudfunctions/taskWorker/shared/grading-core/execute-grading-task.js')), sourceHash);
    assert.equal(sha256(path.join(temporaryRoot, 'cloudrun/gradingWorker/shared/grading-core/execute-grading-task.js')), sourceHash);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('each copied deployment directory can load its local grading-core', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grading-core-deploy-'));
  try {
    const taskWorkerDir = path.join(temporaryRoot, 'taskWorker');
    const gradingWorkerDir = path.join(temporaryRoot, 'gradingWorker');
    fs.cpSync(path.join(root, 'cloudfunctions/taskWorker'), taskWorkerDir, { recursive: true });
    fs.cpSync(path.join(root, 'cloudrun/gradingWorker'), gradingWorkerDir, { recursive: true });
    const taskWorkerCore = require(path.join(taskWorkerDir, 'shared/grading-core/execute-grading-task'));
    const gradingWorkerCore = require(path.join(gradingWorkerDir, 'shared/grading-core/execute-grading-task'));
    assert.equal(typeof taskWorkerCore.executeGradingTask, 'function');
    assert.equal(typeof taskWorkerCore.createGradingRuntime, 'function');
    assert.equal(typeof gradingWorkerCore.executeGradingTask, 'function');
    assert.equal(typeof gradingWorkerCore.createGradingRuntime, 'function');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('production imports and Dockerfile do not read grading-core from outside deployment directories', () => {
  const taskWorkerIndex = fs.readFileSync(path.join(root, 'cloudfunctions/taskWorker/index.js'), 'utf8');
  const gradingWorkerDockerfile = fs.readFileSync(path.join(root, 'cloudrun/gradingWorker/Dockerfile'), 'utf8');
  assert.match(taskWorkerIndex, /require\(["']\.\/shared\/grading-core\/execute-grading-task["']\)/);
  assert.doesNotMatch(taskWorkerIndex, /require\(["']\.\.\//);
  assert.doesNotMatch(gradingWorkerDockerfile, /COPY\s+\.\.\//);
});
