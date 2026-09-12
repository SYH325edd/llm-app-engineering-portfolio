const assert = require('node:assert/strict');
const test = require('node:test');

const { createPageRefreshController } = require('./page-refresh');

function fakeTimers() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let nextId = 1;
  const timers = new Map();
  global.setTimeout = (callback, delay) => {
    const id = nextId++;
    timers.set(id, { callback, delay, cleared: false });
    return id;
  };
  global.clearTimeout = (id) => {
    const timer = timers.get(id);
    if (timer) timer.cleared = true;
  };
  return {
    timers,
    active() { return [...timers.entries()].filter(([, timer]) => !timer.cleared); },
    restore() { global.setTimeout = originalSetTimeout; global.clearTimeout = originalClearTimeout; }
  };
}

test('page refresh runs immediately on show and schedules the next refresh 60 seconds after completion', async () => {
  const clock = fakeTimers();
  const calls = [];
  try {
    const page = { name: 'page' };
    const controller = createPageRefreshController(page, async function () { calls.push(this.name); }, 60000);
    await controller.show();
    assert.deepEqual(calls, ['page']);
    const active = clock.active();
    assert.equal(active.length, 1);
    assert.equal(active[0][1].delay, 60000);
  } finally {
    clock.restore();
  }
});

test('manual refresh cancels the existing countdown and starts a new 60-second countdown from that refresh', async () => {
  const clock = fakeTimers();
  let calls = 0;
  try {
    const controller = createPageRefreshController({}, async () => { calls += 1; }, 60000);
    await controller.show();
    const firstTimer = clock.active()[0];
    await controller.manual();
    assert.equal(calls, 2);
    assert.equal(clock.timers.get(firstTimer[0]).cleared, true);
    const active = clock.active();
    assert.equal(active.length, 1);
    assert.notEqual(active[0][0], firstTimer[0]);
    assert.equal(active[0][1].delay, 60000);
  } finally {
    clock.restore();
  }
});

test('hiding a page stops its pending refresh countdown', async () => {
  const clock = fakeTimers();
  try {
    const controller = createPageRefreshController({}, async () => {}, 60000);
    await controller.show();
    controller.hide();
    assert.equal(clock.active().length, 0);
    assert.equal(controller.isActive(), false);
  } finally {
    clock.restore();
  }
});
