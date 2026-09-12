const assert = require('node:assert/strict');
const test = require('node:test');

function loadRolePage() {
  const pagePath = require.resolve('./index');
  const originalPage = global.Page;
  let definition;
  global.Page = (value) => { definition = value; };
  delete require.cache[pagePath];
  try { require('./index'); } finally { delete require.cache[pagePath]; global.Page = originalPage; }
  return definition;
}

function createInstance(page) {
  return Object.assign({}, page, {
    data: structuredClone(page.data),
    setData(update) { Object.assign(this.data, update); }
  });
}

test('five subtitle taps inside three seconds open the review panel, while four do not', () => {
  const page = loadRolePage();
  const instance = createInstance(page);
  const originalNow = Date.now;
  let time = 1000;
  Date.now = () => time;
  try {
    for (let index = 0; index < 4; index += 1) {
      instance.openReviewChannel();
      time += 500;
    }
    assert.equal(instance.data.reviewPanelVisible, false);
    instance.openReviewChannel();
    assert.equal(instance.data.reviewPanelVisible, true);
  } finally {
    Date.now = originalNow;
  }
});

test('subtitle taps outside the three-second window reset without displaying a hint', () => {
  const page = loadRolePage();
  const instance = createInstance(page);
  const originalNow = Date.now;
  let time = 1000;
  Date.now = () => time;
  try {
    for (let index = 0; index < 4; index += 1) {
      instance.openReviewChannel();
      time += 500;
    }
    time += 3001;
    instance.openReviewChannel();
    assert.equal(instance.data.reviewPanelVisible, false);
    assert.equal(instance.data.reviewTapCount, 1);
  } finally {
    Date.now = originalNow;
  }
});

test('opening review mode clears the formal auth snapshot before re-launch', async () => {
  const page = loadRolePage();
  const instance = createInstance(page);
  instance.data.reviewAccessCode = 'review-code';
  const cloudPath = require.resolve('../../../services/cloud');
  const originalCloud = require.cache[cloudPath];
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const app = { globalData: { user: { role: 'student' }, authSnapshot: { user: { role: 'student' } } } };
  let relaunched = '';
  require.cache[cloudPath] = { id: cloudPath, filename: cloudPath, loaded: true, exports: { call: async () => ({ active: true }) } };
  global.getApp = () => app;
  global.wx = { reLaunch({ url }) { relaunched = url; }, showToast() {} };
  try {
    await instance.enterReview({ currentTarget: { dataset: { role: 'student' } } });
    assert.equal(app.globalData.user, null);
    assert.equal(app.globalData.authSnapshot, null);
    assert.equal(relaunched, '/pages/home/index');
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
    if (originalCloud) require.cache[cloudPath] = originalCloud; else delete require.cache[cloudPath];
  }
});
