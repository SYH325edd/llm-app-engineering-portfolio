const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.wxml'), 'utf8');

test('teacher submission detail renders each v2 schema with its real fields and keeps legacy carelessType out of v2 branches', () => {
  assert.match(source, /hard-problem\.v2/);
  assert.match(source, /reading-careless\.v2/);
  assert.match(source, /calculation-careless\.v2/);
  assert.match(source, /studentConditionText/);
  assert.match(source, /studentCalculation/);
  assert.match(source, /stepStatus/);
  const legacyBranch = source.match(/<view wx:else>[\s\S]*?<\/view>\s*\n\s*<view class="field"><text class="label">得分/);
  assert.ok(legacyBranch);
  assert.match(legacyBranch[0], /carelessType/);
});
