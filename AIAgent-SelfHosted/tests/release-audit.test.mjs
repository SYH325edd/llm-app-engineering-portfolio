import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPublicContract, publishStrategy, verifyPublicArtifacts } from '../scripts/publish-strategy.mjs';
import { validateStrategyForPublish } from '../scripts/strategy-validator.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceDir = path.join(root, 'strategy', 'source');
const strategy = JSON.parse(fs.readFileSync(path.join(sourceDir, 'strategy-source.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(sourceDir, 'output-schema-registry.json'), 'utf8'));

function createTestSigningKeys(directory) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = path.join(directory, 'test-private.pem');
  const publicKeyPath = path.join(directory, 'test-public.pem');
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs1', format: 'pem' }));
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'pkcs1', format: 'pem' }));
  return { privateKeyPath, publicKeyPath };
}

test('publishes one complete public contract for all seven versioned contracts', () => {
  const contract = buildPublicContract(strategy, registry, '2026-07-28T00:00:00.000Z');
  assert.deepEqual(contract.outputSchemaIds, [
    'hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2',
  ]);
  assert.equal(contract.downstreamSemanticsVersion, 'result-semantics.v1');
  assert.equal(contract.outputSchemaRegistryVersion, 'output-schema-registry.v1');
  assert.equal(contract.modelRuntimeContractVersion, 'model-runtime.v1');
  assert.equal(contract.modelOutputRepairPolicyVersion, 'model-output-repair.v1');
  assert.equal(Object.keys(contract.modelRuntime.stages).length, 6);
});

test('fails before signing or publishing when a required contract reference is absent', () => {
  const invalid = structuredClone(strategy);
  delete invalid.downstreamSemanticsVersion;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-publish-'));
  try {
    fs.writeFileSync(path.join(scratch, 'strategy-source.json'), JSON.stringify(invalid));
    fs.copyFileSync(path.join(sourceDir, 'output-schema-registry.json'), path.join(scratch, 'output-schema-registry.json'));
    assert.throws(
      () => publishStrategy({ sourceDir: scratch, releaseDir: path.join(scratch, 'release'), dryRun: true }),
      /downstreamSemanticsVersion/,
    );
    assert.equal(fs.existsSync(path.join(scratch, 'release')), false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('generates an encrypted public payload without prompt or secret material', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-public-'));
  try {
    const keys = createTestSigningKeys(scratch);
    const encryptionKey = crypto.randomBytes(32);
    const result = publishStrategy({
      sourceDir,
      releaseDir: path.join(scratch, 'release'),
      dryRun: true,
      encryptionKey,
      signingPrivateKeyPath: keys.privateKeyPath,
      signingPublicKeyPath: keys.publicKeyPath,
    });
    const serialized = JSON.stringify(result.publicArtifacts);
    for (const forbidden of ['"prompts"', 'privateKey', 'signingKey', 'encryptionKey', 'customer-deployment-secrets']) {
      assert.equal(serialized.includes(forbidden), false, forbidden + ' leaked to public artifacts');
    }
    assert.equal(result.publicArtifacts.manifest.signatureAlgorithm, 'RSA-SHA256');
    assert.match(result.publicArtifacts.manifest.artifactHash, /^[a-f0-9]{64}$/);
    assert.doesNotThrow(() => verifyPublicArtifacts(result.publicArtifacts, keys.publicKeyPath, encryptionKey));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('runs 10000 deterministic contract and publish-blocking combinations', () => {
  const invalidType = structuredClone(strategy);
  invalidType.contracts.hardProblemV2.fieldTypes.inputBasis = 'unsupported';
  const missingEnum = structuredClone(strategy);
  missingEnum.contracts.calculationCarelessV2.enumFields.issueCategory = [];
  const invalidRule = structuredClone(strategy);
  invalidRule.contracts.readingCarelessV2.topLevelObjectSchemas.questionSetAudit.fieldTypes.orientation = 'unsupported';
  const invalidStage = structuredClone(strategy);
  invalidStage.modelRuntime.stages.hardProblemReview.outputSchemaVersion = 'reading-careless.v2';
  const invalidPrompt = structuredClone(strategy);
  invalidPrompt.prompts.hardProblem.userTemplate = 'Return {}';
  const cases = [
    [strategy, false], [invalidType, true], [missingEnum, true],
    [invalidRule, true], [invalidStage, true], [invalidPrompt, true],
  ];
  for (let index = 0; index < 10000; index += 1) {
    const [candidate, shouldReject] = cases[index % cases.length];
    if (shouldReject) assert.throws(() => validateStrategyForPublish(candidate, { registry }));
    else assert.doesNotThrow(() => validateStrategyForPublish(candidate, { registry }));
  }
});


test('project strategy publish can use the unified private materials without duplicate environment wiring', () => {
  assert.doesNotThrow(() => publishStrategy({ dryRun: true }));
});

test('publish writes release artifacts without creating a second strategy runtime source', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-single-source-'));
  try {
    const keys = createTestSigningKeys(scratch);
    const releaseDir = path.join(scratch, 'release');
    const legacyServicePrivateDir = path.join(scratch, 'service-private');

    publishStrategy({
      sourceDir,
      releaseDir,
      servicePrivateDir: legacyServicePrivateDir,
      encryptionKey: crypto.randomBytes(32),
      signingPrivateKeyPath: keys.privateKeyPath,
      signingPublicKeyPath: keys.publicKeyPath,
    });

    assert.equal(fs.existsSync(legacyServicePrivateDir), false);
    assert.equal(fs.existsSync(path.join(releaseDir, 'current', 'strategy-manifest.json')), true);
    assert.equal(fs.existsSync(path.join(releaseDir, 'current', 'public-contract.json')), true);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
