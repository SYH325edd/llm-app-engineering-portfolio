const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
const auditRows = [];
const db = { collection() { return { add: async ({ data }) => auditRows.push(data) }; } };

Module._load = function (request, parent, isMain) {
  if (request === './context') return { db };
  return originalLoad.call(this, request, parent, isMain);
};
const { audit } = require('../shared/audit');
Module._load = originalLoad;

test('audit records developer_admin as its real operator role', async () => {
  auditRows.length = 0;

  await audit({ userId: 'developer-1', role: 'super_admin', _realRole: 'developer_admin' }, 'TEST', 'system', 'test-1');

  assert.equal(auditRows[0].operatorRole, 'developer_admin');
});
