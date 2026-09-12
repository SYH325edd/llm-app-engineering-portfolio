const assert = require('node:assert/strict');
const test = require('node:test');

const { createCloudbaseClient } = require('../cloudbase-client');

function createSdk() {
  const database = { runTransaction: async (callback) => callback('transaction') };
  const calls = [];
  return {
    SYMBOL_CURRENT_ENV: Symbol('current-env'),
    calls,
    init(options) {
      calls.push(options);
      return {
        database: () => database,
        storage: { from: () => ({
          async createSignedUrl(fileID) {
            if (fileID === 'cloud://bad') return { data: null, error: { message: 'storage denied' } };
            return { data: { signedUrl: `https://signed.example/${fileID.slice('cloud://'.length)}` }, error: null };
          }
        }) }
      };
    }
  };
}

test('uses CLOUDBASE_ENV_ID when it is configured and exposes one database instance', async () => {
  const sdk = createSdk();
  const client = createCloudbaseClient({ cloudbase: sdk, envId: 'production-env' });
  assert.deepEqual(sdk.calls, [{ env: 'production-env' }]);
  assert.equal(client.database(), client.database());
  assert.equal(await client.database().runTransaction(async (value) => value), 'transaction');
});

test('requires an explicit CloudBase environment and preserves per-file signed-url errors', async () => {
  const missingSdk = createSdk();
  assert.throws(
    () => createCloudbaseClient({ cloudbase: missingSdk, envId: '' }),
    (error) => error.code === 'CLOUDBASE_ENV_ID_MISSING'
  );

  const sdk = createSdk();
  const client = createCloudbaseClient({ cloudbase: sdk, envId: 'production-env' });
  assert.deepEqual(await client.getTempFileURL({ fileList: ['cloud://good', 'cloud://bad'] }), {
    fileList: [
      { fileID: 'cloud://good', status: 0, errMsg: '', tempFileURL: 'https://signed.example/good' },
      { fileID: 'cloud://bad', status: -1, errMsg: 'storage denied', tempFileURL: '' }
    ]
  });
});

test('unwraps legacy write wrappers for ordinary and transaction references', async () => {
  const writes = [];
  const reference = { update: async (value) => writes.push(value), set: async (value) => writes.push(value) };
  const collection = { doc: () => reference, add: async (value) => writes.push(value) };
  const database = {
    collection: () => collection,
    runTransaction: async (callback) => callback({ collection: () => collection })
  };
  const sdk = {
    SYMBOL_CURRENT_ENV: Symbol('current-env'),
    init: () => ({ database: () => database, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/file' }, error: null }) }) } })
  };
  const db = createCloudbaseClient({ cloudbase: sdk, envId: 'production-env' }).database();

  await db.collection('grading_tasks').doc('task-1').update({ data: { workerQueueStatus: 'PENDING' } });
  await db.collection('grading_tasks').add({ data: { workerDispatchAttempt: 1 } });
  await db.collection('grading_tasks').doc('task-1').set({ data: { retained: true }, documentType: 'business-document' });
  await db.runTransaction(async (transaction) => {
    await transaction.collection('grading_tasks').doc('task-1').set({ data: { workerLeaseOwner: 'owner-1' } });
  });

  assert.deepEqual(writes, [
    { workerQueueStatus: 'PENDING' },
    { workerDispatchAttempt: 1 },
    { data: { retained: true }, documentType: 'business-document' },
    { workerLeaseOwner: 'owner-1' }
  ]);
});
