'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'cloudfunctions/taskWorker/shared');
const targetRoot = path.join(root, 'cloudrun/gradingWorker/runtime/taskWorker-shared');
const files = [
  'ark.js', 'audit.js', 'checkin.js', 'constants.js', 'json.js',
  'runtime-config.js', 'task-error.js', 'utils.js', 'model-runtime.js', 'model-output-repair.js', 'output-schema-registry.js', 'output-schema-validator.js',
  'explanation-matcher.js', 'task-failure-case.js',
  'strategy/contract.js', 'strategy/embedded-bundle.js', 'strategy/embedded.js',
  'strategy/remote.js', 'strategy/render.js'
];

try {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  for (const file of files) {
    const source = path.join(sourceRoot, file);
    if (!fs.existsSync(source)) throw new Error(`runtime source file does not exist: ${source}`);
    const target = path.join(targetRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  const cloudRunContext = path.join(root, 'cloudrun/gradingWorker/runtime/cloudrun-context.js');
  if (!fs.existsSync(cloudRunContext)) throw new Error(`CloudRun context template does not exist: ${cloudRunContext}`);
  fs.copyFileSync(cloudRunContext, path.join(targetRoot, 'context.js'));
  const resultSemantics = path.join(root, 'cloudrun/gradingWorker/shared/result-semantics.js');
  if (!fs.existsSync(resultSemantics)) throw new Error(`CloudRun result semantics source does not exist: ${resultSemantics}`);
  fs.copyFileSync(resultSemantics, path.join(targetRoot, 'result-semantics.js'));
  const gradingCoreSource = path.join(sourceRoot, 'grading-core/execute-grading-task.js');
  const gradingCoreTarget = path.join(root, 'cloudrun/gradingWorker/shared/grading-core/execute-grading-task.js');
  const rootGradingCoreTarget = path.join(root, 'shared/grading-core/execute-grading-task.js');
  if (!fs.existsSync(gradingCoreSource)) throw new Error(`grading core source does not exist: ${gradingCoreSource}`);
  fs.mkdirSync(path.dirname(gradingCoreTarget), { recursive: true });
  fs.copyFileSync(gradingCoreSource, gradingCoreTarget);
  fs.mkdirSync(path.dirname(rootGradingCoreTarget), { recursive: true });
  fs.copyFileSync(gradingCoreSource, rootGradingCoreTarget);
  const validatorSource = path.join(sourceRoot, 'output-schema-validator.js');
  const validatorTargets = [
    path.join(root, 'shared/output-schema-validator.js'),
    path.join(root, 'cloudrun/gradingWorker/shared/output-schema-validator.js'),
    path.join(targetRoot, 'output-schema-validator.js')
  ];
  for (const target of validatorTargets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(validatorSource, target);
  }
  for (const file of ['output-schema-registry.js', 'output-schema-validator.js']) {
    if (!fs.readFileSync(path.join(sourceRoot, file)).equals(fs.readFileSync(path.join(targetRoot, file)))) {
      throw new Error(`runtime output schema build hash mismatch: ${file}`);
    }
  }
  if (!fs.readFileSync(resultSemantics).equals(fs.readFileSync(path.join(targetRoot, 'result-semantics.js')))) {
    throw new Error('runtime result semantics build hash mismatch');
  }
  if (!fs.readFileSync(gradingCoreSource).equals(fs.readFileSync(gradingCoreTarget))) {
    throw new Error('grading core build hash mismatch');
  }
  if (!fs.readFileSync(gradingCoreSource).equals(fs.readFileSync(rootGradingCoreTarget))) {
    throw new Error('root grading core build hash mismatch');
  }
  const validatorHashes = [validatorSource, ...validatorTargets].map((file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  if (new Set(validatorHashes).size !== 1) throw new Error('output schema validator SHA-256 mismatch across four runtime copies');
  const explanationMatcherSource = path.join(sourceRoot, 'explanation-matcher.js');
  const explanationMatcherTargets = [
    path.join(root, 'shared/explanation-matcher.js'),
    path.join(root, 'cloudrun/gradingWorker/shared/explanation-matcher.js'),
    path.join(targetRoot, 'explanation-matcher.js')
  ];
  for (const target of explanationMatcherTargets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(explanationMatcherSource, target);
  }
  const explanationMatcherHashes = [explanationMatcherSource, ...explanationMatcherTargets].map((file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  if (new Set(explanationMatcherHashes).size !== 1) throw new Error('explanation matcher SHA-256 mismatch across runtime copies');
  const failureCaseSource = path.join(sourceRoot, 'task-failure-case.js');
  const failureCaseTargets = [
    path.join(root, 'cloudfunctions/appApi/shared/task-failure-case.js'),
    path.join(root, 'cloudrun/gradingWorker/shared/task-failure-case.js'),
    path.join(targetRoot, 'task-failure-case.js'),
    path.join(root, 'shared/task-failure-case.js')
  ];
  for (const target of failureCaseTargets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(failureCaseSource, target);
  }
  const failureCaseHashes = [failureCaseSource, ...failureCaseTargets].map((file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  if (new Set(failureCaseHashes).size !== 1) throw new Error('task failure case build hash mismatch');
} catch (error) {
  console.error(`Failed to build grading-worker runtime: ${error.message}`);
  process.exitCode = 1;
}
