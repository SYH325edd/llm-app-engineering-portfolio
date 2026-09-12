'use strict';
process.env.SELF_HOSTED = 'true';
const { invokeFunction } = require('./lib/function-registry');

const intervalMs = Math.max(3600000, Number(process.env.MAINTENANCE_INTERVAL_MS || 21600000));
let running = false;
async function run() {
  if (running) return;
  running = true;
  try {
    const result = await invokeFunction('purgeArchived', {});
    console.log('[maintenance]', JSON.stringify({ at: new Date().toISOString(), result }));
  } catch (error) {
    console.error('[maintenance]', JSON.stringify({ at: new Date().toISOString(), code: error?.code || 'ERROR', message: String(error?.message || '').slice(0, 300) }));
  } finally { running = false; }
}
run();
const timer = setInterval(run, intervalMs);
process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
process.on('SIGINT', () => { clearInterval(timer); process.exit(0); });
