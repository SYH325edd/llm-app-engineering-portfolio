const assert = require('node:assert/strict');
const test = require('node:test');

function loadImportPage(call) {
  const pagePath = require.resolve('./index');
  const cloudPath = require.resolve('../../../services/cloud');
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalCloud = require.cache[cloudPath];
  let definition;
  const uploads = [];
  const wxStub = {
    chooseMessageFile: async () => ({ tempFiles: [{ path: '/tmp/roster.xlsx', name: 'roster.xlsx', size: 1024 }] }),
    cloud: {
      uploadFile: async (input) => { uploads.push(input); return { fileID: 'local://production/imports/roster.xlsx' }; },
      deleteFile: async () => ({ fileList: [] }),
    },
    showModal() {},
  };
  try {
    require.cache[cloudPath] = { id: cloudPath, filename: cloudPath, loaded: true, exports: { call } };
    global.Page = (value) => { definition = value; };
    global.wx = wxStub;
    delete require.cache[pagePath];
    require('./index');
  } finally {
    delete require.cache[pagePath];
    global.Page = originalPage;
    global.wx = originalWx;
    if (originalCloud) require.cache[cloudPath] = originalCloud;
    else delete require.cache[cloudPath];
  }
  definition.data = { ...definition.data, authorizationConfirmed: true };
  definition.setData = (patch) => Object.assign(definition.data, patch);
  definition.selectComponent = () => null;
  return { page: definition, uploads, wxStub, originalWx };
}

test('roster import uses the selected file path and selfhost file id for importRoster', async () => {
  const calls = [];
  const { page, uploads, wxStub, originalWx } = loadImportPage(async (action, data) => {
    calls.push({ action, data });
    return { created: 1, updated: 0, conflicts: 0, errors: [] };
  });

  global.wx = wxStub;
  try {
    await page.choose();
  } finally {
    global.wx = originalWx;
  }

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].filePath, '/tmp/roster.xlsx');
  assert.match(uploads[0].cloudPath, /^imports\/.+_roster\.xlsx$/);
  assert.deepEqual(calls, [{ action: 'importRoster', data: {
    fileID: 'local://production/imports/roster.xlsx',
    consentConfirmed: true,
    consentVersion: page.data.authorizationVersion,
  } }]);
  assert.equal(page.data.report.created, 1);
});
