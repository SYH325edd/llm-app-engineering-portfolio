'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'shared/grading-core');
const targets = [
  path.join(root, 'cloudfunctions/taskWorker/shared/grading-core'),
  path.join(root, 'cloudrun/gradingWorker/shared/grading-core')
];
const resultSemanticsSource = path.join(root, 'shared/result-semantics.js');
const resultSemanticsTargets = [
  path.join(root, 'cloudfunctions/taskWorker/shared/result-semantics.js'),
  path.join(root, 'cloudfunctions/appApi/shared/result-semantics.js'),
  path.join(root, 'cloudfunctions/ttsWorker/shared/result-semantics.js'),
  path.join(root, 'cloudrun/gradingWorker/shared/result-semantics.js')
];
const outputSchemaFiles = ['output-schema-registry.js', 'output-schema-validator.js'];
const outputSchemaTargets = [
  path.join(root, 'cloudfunctions/taskWorker/shared'),
  path.join(root, 'cloudfunctions/appApi/shared'),
  path.join(root, 'cloudfunctions/ttsWorker/shared'),
  path.join(root, 'cloudrun/gradingWorker/shared')
];
const appApiContractTarget = path.join(root, 'cloudfunctions/appApi/shared/strategy/contract.js');

try {
  if (!fs.existsSync(source)) {
    throw new Error(`grading-core source directory does not exist: ${source}`);
  }
  for (const target of targets) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
  }
  for (const target of targets) {
    fs.copyFileSync(path.join(root, 'shared', 'model-runtime.js'), path.join(path.dirname(target), 'model-runtime.js'));
  }
  if (!fs.existsSync(resultSemanticsSource)) {
    throw new Error(`result semantics source does not exist: ${resultSemanticsSource}`);
  }
  for (const target of resultSemanticsTargets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(resultSemanticsSource, target);
  }
  for (const target of outputSchemaTargets) {
    fs.mkdirSync(target, { recursive: true });
    for (const file of outputSchemaFiles) fs.copyFileSync(path.join(root, 'shared', file), path.join(target, file));
  }
  fs.mkdirSync(path.dirname(appApiContractTarget), { recursive: true });
  fs.copyFileSync(path.join(root, 'cloudfunctions/taskWorker/shared/strategy/contract.js'), appApiContractTarget);
  fs.copyFileSync(path.join(root, 'shared', 'model-runtime.js'), path.join(root, 'cloudfunctions/appApi/shared/model-runtime.js'));
  for (const file of outputSchemaFiles) {
    const expected = fs.readFileSync(path.join(root, 'shared', file));
    for (const target of outputSchemaTargets) {
      if (!fs.readFileSync(path.join(target, file)).equals(expected)) throw new Error(`output schema build hash mismatch: ${file}`);
    }
  }
} catch (error) {
  console.error(`Failed to build grading-core runtime: ${error.message}`);
  process.exitCode = 1;
}
