import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStrategyForPublish, validateOutputSchemaRegistry } from './strategy-validator.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicFileNames = ['public-contract.json', 'strategy-public.envelope.json', 'strategy-manifest.json', 'strategy-signing-public.pem'];

function canonicalJson(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function compareVersions(left, right) {
  const parse = (value) => String(value).split('.').map((part) => Number(part));
  const a = parse(left);
  const b = parse(right);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((part) => !Number.isInteger(part) || part < 0)) throw new Error('strategyVersion must be a semantic version');
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function requireVersion(value, expected, name) {
  if (value !== expected) throw new Error(`${name} must be ${expected}`);
}

function encryptionKeyFromEnvironment(privateDir) {
  let encoded = String(process.env.STRATEGY_ENCRYPTION_KEY_BASE64 || '').trim();
  if (!encoded && privateDir) {
    const keyPath = path.join(privateDir, 'secrets', 'strategy-encryption-key.base64');
    if (fs.existsSync(keyPath)) encoded = fs.readFileSync(keyPath, 'utf8').trim();
  }
  if (!encoded) throw new Error('strategy encryption key is required');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('strategy encryption key must decode to 32 bytes');
  return key;
}

export function buildPublicContract(strategy, registry, publishedAt) {
  validateOutputSchemaRegistry(registry);
  requireVersion(strategy.downstreamSemanticsVersion, 'result-semantics.v1', 'downstreamSemanticsVersion');
  requireVersion(strategy.outputSchemaRegistryVersion, registry.outputSchemaRegistryVersion, 'outputSchemaRegistryVersion');
  requireVersion(strategy.modelRuntimeContractVersion, 'model-runtime.v1', 'modelRuntimeContractVersion');
  requireVersion(strategy.modelOutputRepairPolicy?.version, 'model-output-repair.v1', 'modelOutputRepairPolicy.version');
  if (!Array.isArray(strategy.outputSchemaIds) || strategy.outputSchemaIds.length !== 3) throw new Error('outputSchemaIds are incomplete');
  if (!String(strategy.strategyVersion || '').trim()) throw new Error('strategyVersion is missing');

  return {
    strategyVersion: strategy.strategyVersion,
    publishedAt,
    outputSchemaRegistryVersion: strategy.outputSchemaRegistryVersion,
    downstreamSemanticsVersion: strategy.downstreamSemanticsVersion,
    modelRuntimeContractVersion: strategy.modelRuntimeContractVersion,
    modelOutputRepairPolicyVersion: strategy.modelOutputRepairPolicy.version,
    outputSchemaIds: strategy.outputSchemaIds,
    minimumClientContractVersion: strategy.minimumClientContractVersion || '1',
    sourceHash: sha256(canonicalJson(strategy)),
    outputSchemaRegistry: registry,
    contracts: strategy.contracts,
    downstreamSemantics: strategy.downstreamSemantics,
    modelRuntime: strategy.modelRuntime,
    modelOutputRepairPolicy: strategy.modelOutputRepairPolicy,
  };
}

function assertNoSensitivePublicData(value) {
  const serialized = canonicalJson(value).toLowerCase();
  for (const forbidden of ['"prompts"', 'privatekey', 'signingkey', 'encryptionkey', 'customer-deployment-secrets']) {
    if (serialized.includes(forbidden)) throw new Error(`public artifact contains forbidden material: ${forbidden}`);
  }
}

export function createPublicArtifacts(contract, signingPrivateKeyPath, encryptionKey) {
  const plaintext = Buffer.from(canonicalJson(contract));
  const artifactHash = crypto.createHash('sha256').update(plaintext).digest('hex');
  const signature = crypto.sign('RSA-SHA256', plaintext, fs.readFileSync(signingPrivateKeyPath)).toString('base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = {
    algorithm: 'AES-256-GCM',
    artifactHash,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    signature,
  };
  const manifest = {
    strategyVersion: contract.strategyVersion,
    publishedAt: contract.publishedAt,
    outputSchemaRegistryVersion: contract.outputSchemaRegistryVersion,
    downstreamSemanticsVersion: contract.downstreamSemanticsVersion,
    modelRuntimeContractVersion: contract.modelRuntimeContractVersion,
    modelOutputRepairPolicyVersion: contract.modelOutputRepairPolicyVersion,
    outputSchemaIds: contract.outputSchemaIds,
    artifactHash,
    signatureAlgorithm: 'RSA-SHA256',
    minimumClientContractVersion: contract.minimumClientContractVersion,
    sourceHash: contract.sourceHash,
  };
  return { contract, envelope, manifest };
}

export function verifyPublicArtifacts(artifacts, publicKeyPath, encryptionKey) {
  const plaintext = Buffer.from(canonicalJson(artifacts.contract));
  if (sha256(plaintext) !== artifacts.envelope.artifactHash || artifacts.manifest.artifactHash !== artifacts.envelope.artifactHash) {
    throw new Error('release hash does not match payload');
  }
  if (artifacts.manifest.strategyVersion !== artifacts.contract.strategyVersion || artifacts.manifest.sourceHash !== artifacts.contract.sourceHash) {
    throw new Error('release manifest does not match payload metadata');
  }
  const publicKey = fs.readFileSync(publicKeyPath);
  if (!crypto.verify('RSA-SHA256', plaintext, publicKey, Buffer.from(artifacts.envelope.signature, 'base64'))) throw new Error('release signature verification failed');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(artifacts.envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(artifacts.envelope.tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(artifacts.envelope.ciphertext, 'base64')), decipher.final()]);
  if (!decrypted.equals(plaintext)) throw new Error('release encryption round-trip failed');
}

function assertSigningKeysMatch(privateKeyPath, publicKeyPath) {
  const proof = Buffer.from('strategy-release-key-check');
  const signature = crypto.sign('RSA-SHA256', proof, fs.readFileSync(privateKeyPath));
  if (!crypto.verify('RSA-SHA256', proof, fs.readFileSync(publicKeyPath), signature)) throw new Error('signing public and private keys do not match');
}

function assertReleaseLineage(strategy, releaseDir) {
  const currentManifestPath = path.join(releaseDir, 'current', 'strategy-manifest.json');
  if (!fs.existsSync(currentManifestPath)) return;
  const current = JSON.parse(fs.readFileSync(currentManifestPath, 'utf8'));
  if (compareVersions(strategy.strategyVersion, current.strategyVersion) <= 0) throw new Error('strategyVersion must increase beyond current release');
  const currentContractPath = path.join(releaseDir, 'current', 'public-contract.json');
  if (fs.existsSync(currentContractPath)) {
    const currentContract = fs.readFileSync(currentContractPath);
    if (sha256(currentContract) === current.artifactHash && current.sourceHash && current.sourceHash === sha256(canonicalJson(strategy))) {
      throw new Error('current and candidate releases have identical source content');
    }
  }
}

function writeArtifacts(directory, artifacts, publicKeyPath) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'public-contract.json'), canonicalJson(artifacts.contract));
  fs.writeFileSync(path.join(directory, 'strategy-public.envelope.json'), canonicalJson(artifacts.envelope));
  fs.writeFileSync(path.join(directory, 'strategy-manifest.json'), canonicalJson(artifacts.manifest));
  fs.copyFileSync(publicKeyPath, path.join(directory, 'strategy-signing-public.pem'));
}

function replaceCurrentRelease(stageDir, releaseDir) {
  const currentDir = path.join(releaseDir, 'current');
  const previousDir = path.join(releaseDir, 'previous');
  fs.mkdirSync(releaseDir, { recursive: true });
  const backupDir = `${previousDir}.next-${process.pid}`;
  try {
    if (fs.existsSync(previousDir)) fs.renameSync(previousDir, backupDir);
    if (fs.existsSync(currentDir)) fs.renameSync(currentDir, previousDir);
    fs.renameSync(stageDir, currentDir);
    if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(currentDir) && fs.existsSync(previousDir)) fs.renameSync(previousDir, currentDir);
    if (!fs.existsSync(previousDir) && fs.existsSync(backupDir)) fs.renameSync(backupDir, previousDir);
    throw error;
  }
}

export function publishStrategy(options = {}) {
  const sourceDir = options.sourceDir || path.join(root, 'strategy', 'source');
  const releaseDir = options.releaseDir || path.join(root, 'strategy', 'release');
  const strategy = JSON.parse(fs.readFileSync(path.join(sourceDir, 'strategy-source.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(sourceDir, 'output-schema-registry.json'), 'utf8'));
  validateStrategyForPublish(strategy, { registry });
  if (!options.dryRun) assertReleaseLineage(strategy, releaseDir);
  const contract = buildPublicContract(strategy, registry, options.publishedAt || new Date().toISOString());
  assertNoSensitivePublicData(contract);

  const privateDir = options.privateSourceDir || path.join(root, 'strategy', 'private');
  const signingPrivateKeyPath = options.signingPrivateKeyPath || process.env.STRATEGY_SIGNING_PRIVATE_KEY_PATH || path.join(privateDir, 'production-signing-private.pem');
  const signingPublicKeyPath = options.signingPublicKeyPath || process.env.STRATEGY_SIGNING_PUBLIC_KEY_PATH || path.join(privateDir, 'production-signing-public.pem');
  if (!fs.existsSync(signingPrivateKeyPath) || !fs.existsSync(signingPublicKeyPath)) throw new Error('strategy signing key pair is required');
  const encryptionKey = options.encryptionKey || encryptionKeyFromEnvironment(privateDir);
  assertSigningKeysMatch(signingPrivateKeyPath, signingPublicKeyPath);
  const artifacts = createPublicArtifacts(contract, signingPrivateKeyPath, encryptionKey);
  verifyPublicArtifacts(artifacts, signingPublicKeyPath, encryptionKey);
  assertNoSensitivePublicData(artifacts);
  if (options.dryRun) return { publicArtifacts: artifacts };

  const stageDir = path.join(path.dirname(releaseDir), `.${path.basename(releaseDir)}-stage-${process.pid}-${Date.now()}`);
  try {
    writeArtifacts(stageDir, artifacts, signingPublicKeyPath);
    replaceCurrentRelease(stageDir, releaseDir);
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }
  return { publicArtifacts: artifacts, releaseDir: path.join(releaseDir, 'current') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = publishStrategy({ dryRun: process.argv.includes('--dry-run') });
    console.log(`${result.publicArtifacts.manifest.strategyVersion} ${result.publicArtifacts.manifest.artifactHash}`);
  } catch (error) {
    console.error(`STRATEGY_PUBLISH_FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}

export { publicFileNames };
