'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const context = require('./shared/context');
const constants = require('./shared/constants');
const audit = require('./shared/audit');
const ark = require('./shared/ark');
const utils = require('./shared/utils');
const checkin = require('./shared/checkin');
const taskError = require('./shared/task-error');
const json = require('./shared/json');
const embedded = require('./shared/strategy/embedded');
const remote = require('./shared/strategy/remote');
const strategyRender = require('./shared/strategy/render');
const { createGradingRuntime } = require('./shared/grading-core/execute-grading-task');

function resolveTimeout(value = process.env.GRADING_WORKER_ENQUEUE_TIMEOUT_MS) {
  const milliseconds = Number(value);
  return Number.isInteger(milliseconds) && milliseconds >= 2000 && milliseconds <= 10000
    ? milliseconds
    : 5000;
}

function forwardToGradingWorker(taskId) {
  const baseUrl = String(process.env.GRADING_WORKER_BASE_URL || '').trim();
  const token = String(process.env.GRADING_WORKER_TOKEN || '').trim();
  if (!baseUrl || !token) {
    return Promise.resolve({
      success: false,
      code: 'GRADING_WORKER_CONFIG_MISSING',
      taskId,
      forwarded: false
    });
  }

  const url = new URL('/internal/jobs/enqueue', baseUrl);
  const body = JSON.stringify({ taskId });
  return new Promise((resolve) => {
    const transport = url.protocol === 'http:' ? http : https;
    const request = transport.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(data || '{}'); } catch {}
        const accepted = response.statusCode >= 200 && response.statusCode < 300;
        resolve({
          success: accepted,
          code: payload.code || (accepted ? 'TASK_ENQUEUED' : `GRADING_WORKER_HTTP_${response.statusCode}`),
          taskId,
          forwarded: accepted
        });
      });
    });
    request.setTimeout(resolveTimeout(), () => request.destroy());
    request.on('error', (error) => resolve({
      success: false,
      code: String(error?.code || 'GRADING_WORKER_NETWORK_ERROR'),
      taskId,
      forwarded: false
    }));
    request.write(body);
    request.end();
  });
}

// Keep the existing runtime test surface for regression tests, but do not use it as a production executor.
const runtime = createGradingRuntime({
  context,
  constants,
  audit,
  ark,
  utils,
  checkin,
  taskError,
  json,
  embedded,
  remote,
  strategyRender,
  getFirstDocument(snapshot) {
    if (!snapshot) return null;
    if (Array.isArray(snapshot.data)) return snapshot.data[0] || null;
    return snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : null;
  },
  scheduleNextStage: async () => ({ scheduled: false, mode: 'legacy_worker_disabled' }),
  enqueueTts: ({ resultId }) => context.cloud.callFunction({ name: 'ttsWorker', data: { resultId } })
});

exports.__test = runtime.test;
exports.forwardToGradingWorker = forwardToGradingWorker;
exports.main = async (event = {}) => {
  const taskId = String(event.taskId || event.data?.taskId || '').trim();
  if (!taskId) return { success: false, code: 'MISSING_TASK_ID', forwarded: false };
  return forwardToGradingWorker(taskId);
};
