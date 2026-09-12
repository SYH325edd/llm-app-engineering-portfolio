"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.monitor = monitor;
exports.audit = audit;
exports.systemLog = systemLog;
const context_1 = require("./context");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
function sanitize(value) { return String(value ?? '').replace(/https?:\/\/\S+/g, '[REDACTED_URL]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/(openid|token|authorization|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 500); }
function monitor(functionName, event, data = {}, isError = false) {
    const verbose = process.env.ENABLE_VERBOSE_LOGS === 'true';
    if (!isError && !verbose)
        return;
    const record = { timestamp: new Date().toISOString(), functionName, event, taskId: data.taskId || data.resultId || null, status: data.status || null, stage: data.stage || null, progress: data.progress ?? null, durationMs: data.durationMs ?? null, errorCode: data.errorCode || null, errorMessage: data.errorMessage ? sanitize(data.errorMessage) : null };
    if (isError)
        console.error(JSON.stringify(record));
    else
        console.log(JSON.stringify(record));
}
async function audit(operator, action, targetType, targetId, before = null, after = null, ok = true, requestId = '', error = null) {
    const scrub = (v) => { if (!v)
        return v; const s = JSON.stringify(v, (k, val) => /phone|openid|api.?key|token|image|file/i.test(k) ? '[REDACTED]' : val); return s.length > 4000 ? s.slice(0, 4000) : s; };
    await context_1.db.collection(constants_1.C.audit).add({ data: { operatorId: operator?.userId || 'system', operatorRole: operator?.role || 'system', action, targetType, targetId, before: scrub(before), after: scrub(after), ok, requestId, error: error ? (0, utils_1.safeError)(error) : null, createdAt: (0, utils_1.now)() } });
}
async function systemLog(level, event, data = {}) { const safeData = { code: data?.code || data?.errorCode || null, message: data?.message ? sanitize(data.message) : null, action: data?.action || null, requestId: data?.requestId || null, studentHash: data?.studentHash || null }; await context_1.db.collection(constants_1.C.logs).add({ data: { level, event, data: safeData, createdAt: (0, utils_1.now)() } }).catch(() => { }); }
