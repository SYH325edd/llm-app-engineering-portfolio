'use strict';
process.env.SELF_HOSTED = 'true';
const { invokeFunction } = require('../lib/function-registry');

(async () => {
  const token = String(process.argv[2] || process.env.DATABASE_BOOTSTRAP_TOKEN || '').trim();
  if (!token) throw new Error('DATABASE_BOOTSTRAP_TOKEN is required');
  const result = await invokeFunction('initDatabase', { token });
  console.log(JSON.stringify(result, null, 2));
  if (!result?.success && result?.code !== 'BOOTSTRAP_CLOSED') process.exitCode = 1;
})().catch((error) => { console.error(error?.stack || error); process.exit(1); });
