"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkinStats = checkinStats;
exports.taskAccuracyStats = taskAccuracyStats;
exports.teacherOwnsRoster = teacherOwnsRoster;
exports.createTaskCoreFlow = createTaskCoreFlow;
exports.dispatchTask = dispatchTask;
const context_1 = require("./shared/context");
const constants_1 = require("./shared/constants");
const auth_1 = require("./shared/auth");
const audit_1 = require("./shared/audit");
const utils_1 = require("./shared/utils");
const task_title_1 = require("./shared/task-title");
const result_narration_1 = require("./shared/result-narration");
const result_semantics_1 = require("./shared/result-semantics");
const checkin_1 = require("./shared/checkin");
const http = require('http');
const https = require('https');
const { URL } = require('url');
const XLSX = require('xlsx');
const xlsx_safety_1 = require("./shared/xlsx-safety");
const remote_1 = require("./shared/strategy/remote");
const hard_problem_training_1 = require("./shared/hard-problem-training");
const task_failure_case_1 = require("./shared/task-failure-case");
const CHILDREN_PRIVACY_VERSION = '1.0.1';
const HARD_PROBLEM_PROVIDER_SETTING_ID = 'hard_problem_model_provider';
const HARD_PROBLEM_MODEL_PROVIDERS = ['ark_lite', 'qwen3_vl_plus'];
const DEFAULT_HARD_PROBLEM_MODEL_PROVIDER = 'ark_lite';
const ok = (data) => ({ success: true, code: 'OK', message: '操作成功', data });
function appError(code, message) {
    throw Object.assign(new Error(message), { code });
}
function taskAccuracyStats(tasks = []) {
    return tasks.reduce((stats, task) => {
        if (!(task?.resultId || task?.status === 'COMPLETED'))
            return stats;
        const questionCount = Math.max(0, Number(task?.questionCount || 0));
        const correctCount = Math.max(0, Math.min(questionCount, Number(task?.correctCount || 0)));
        stats.answeredQuestionCount += questionCount;
        stats.correctQuestionCount += correctCount;
        return stats;
    }, { answeredQuestionCount: 0, correctQuestionCount: 0 });
}
function checkinStats(rows, dateKey, tasks = []) {
    const normalized = rows.map(checkin_1.normalizeCheckinRecord);
    const today = normalized.find((record) => record.dateKey === dateKey) || (0, checkin_1.normalizeCheckinRecord)({ dateKey });
    const successfulDates = normalized.filter((record) => record.completed).map((record) => record.dateKey).filter(Boolean).sort().reverse();
    const practiceDates = new Set(tasks.filter((task) => task?.resultId || task?.status === 'COMPLETED').map(taskDateKey).filter(Boolean));
    const accuracy = taskAccuracyStats(tasks);
    return {
        today: { dateKey, qualifiedQuestionCount: today.qualifiedQuestionCount, requiredQuestionCount: today.requiredQuestionCount, completed: today.completed, remainingCount: Math.max(0, today.requiredQuestionCount - today.qualifiedQuestionCount) },
        practiceDays: practiceDates.size,
        successfulCheckinDays: successfulDates.length,
        incompletePracticeDays: normalized.filter((record) => record.practiced && !record.completed).length,
        totalQualifiedQuestions: normalized.reduce((total, record) => total + record.qualifiedQuestionCount, 0),
        answeredQuestionCount: accuracy.answeredQuestionCount,
        correctQuestionCount: accuracy.correctQuestionCount,
        accuracyRate: accuracy.answeredQuestionCount ? accuracy.correctQuestionCount / accuracy.answeredQuestionCount : 0,
        checkinRate: practiceDates.size ? successfulDates.length / practiceDates.size : 0,
        successfulDates,
    };
}
function rosterImportTemplatePayload() {
    const headers = ['姓名', '地区', '学号（选填）'];
    const examples = [
        ['示例学生一', '示例地区一', '20260001'],
        ['示例学生二', '示例地区一', '20260002'],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...examples]);
    worksheet['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 18 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '学生名单');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
    return {
        fileName: '学生名单导入模板.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from(buffer).toString('base64'),
        columns: [
            { key: 'name', label: '姓名', required: true },
            { key: 'className', label: '地区', required: true },
            { key: 'studentNumber', label: '学号', required: false },
        ],
        examples: examples.map((row) => ({ name: row[0], className: row[1], studentNumber: row[2] })),
    };
}
function taskModeForRead(task) {
    const mode = String(task?.mode || '');
    return constants_1.TASK_MODES.includes(mode) ? mode : constants_1.DEFAULT_TASK_MODE;
}
function carelessTrainingTypeForRead(task) {
    return taskModeForRead(task) === 'CARELESS_TRAINING' ? (0, constants_1.normalizeCarelessTrainingType)(task?.carelessTrainingType) : null;
}
function taskModeForCreate(value) {
    if (value == null || value === '')
        return constants_1.DEFAULT_TASK_MODE;
    const mode = String(value);
    if (!constants_1.TASK_MODES.includes(mode))
        appError('INVALID_TASK_MODE', '训练模式无效');
    return mode;
}
function isCollectionNotFound(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    return /COLLECTION.*(NOT[_ -]?FOUND|NOT[_ -]?EXIST)|DATABASE_COLLECTION_NOT_EXIST/.test(code)
        || /collection.*(not found|not exist)|集合.*(不存在|未创建)/i.test(message);
}
function isDocumentNotFound(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    return /(?:DOCUMENT|DOC).*(?:NOT[_ -]?(?:FOUND|EXIST))|DATABASE_DOCUMENT_NOT_EXIST/.test(code)
        || /(?:document|文档).*(?:not found|does not exist|不存在|未找到)/i.test(message);
}
function missingCollectionForAction(action, error) {
    if (error?.collection)
        return String(error.collection);
    const message = String(error?.message || '');
    const match = message.match(/(?:collection|集合)[\s:：'"`]*([a-z][a-z0-9_]*)/i);
    if (match?.[1])
        return match[1];
    if (action === 'registerTeacher')
        return constants_1.C.teacherApplications;
    return undefined;
}
function getFirstDocument(snapshot) {
    if (!snapshot)
        return null;
    if (Array.isArray(snapshot.data))
        return snapshot.data[0] || null;
    return snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : null;
}
async function studentResultClientConfig() {
    try {
        const response = await context_1.db.collection(constants_1.C.settings).where({ _id: 'student_result_visibility' }).limit(1).get();
        const record = getFirstDocument(response);
        return { studentResultVisibility: String(record?.mode || '') === 'visible' ? 'visible' : 'hidden' };
    }
    catch {
        return { studentResultVisibility: 'hidden' };
    }
}
function taskHasReadyResult(task) {
    return task?.status === 'COMPLETED' && Boolean(task?.resultId);
}
function resolveEnqueueTimeout(value = process.env.GRADING_WORKER_ENQUEUE_TIMEOUT_MS) {
    const milliseconds = Number(value);
    return Number.isInteger(milliseconds) && milliseconds >= 2000 && milliseconds <= 10000 ? milliseconds : 5000;
}
function normalizeHardProblemModelProvider(value) {
    const provider = String(value || '').trim();
    return HARD_PROBLEM_MODEL_PROVIDERS.includes(provider) ? provider : DEFAULT_HARD_PROBLEM_MODEL_PROVIDER;
}
async function readHardProblemModelProvider() {
    try {
        const snapshot = await context_1.db.collection(constants_1.C.settings).doc(HARD_PROBLEM_PROVIDER_SETTING_ID).get();
        const record = getFirstDocument(snapshot);
        return normalizeHardProblemModelProvider(record?.provider);
    }
    catch (error) {
        if (!isDocumentNotFound(error))
            (0, audit_1.monitor)('appApi', 'HARD_PROBLEM_MODEL_PROVIDER_READ_FAILED', { errorCode: String(error?.code || 'DATABASE_ERROR').slice(0, 120) }, true);
        return DEFAULT_HARD_PROBLEM_MODEL_PROVIDER;
    }
}
async function writeHardProblemModelProvider(provider, user) {
    const normalized = normalizeHardProblemModelProvider(provider);
    if (normalized !== String(provider || '').trim())
        appError('INVALID_MODEL_PROVIDER', '难题训练模型无效');
    await context_1.db.collection(constants_1.C.settings).doc(HARD_PROBLEM_PROVIDER_SETTING_ID).set({ data: {
            provider: normalized,
            updatedBy: String(user?.userId || ''),
            updatedAt: (0, utils_1.now)(),
        } });
    return normalized;
}
function gradingWorkerRequest(pathName, payload = {}, timeoutMs = resolveEnqueueTimeout()) {
    const baseUrl = String(process.env.GRADING_WORKER_BASE_URL || '').trim();
    const token = String(process.env.GRADING_WORKER_TOKEN || '').trim();
    if (!baseUrl || !token)
        return Promise.reject(Object.assign(new Error('grading worker configuration is missing'), { code: 'GRADING_WORKER_CONFIG_MISSING' }));
    const url = new URL(pathName, baseUrl);
    const body = JSON.stringify(payload || {});
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'http:' ? http : https;
        const request = transport.request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (response) => {
            let data = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                let responsePayload;
                try {
                    responsePayload = JSON.parse(data);
                }
                catch {
                    return reject(Object.assign(new Error('invalid grading worker response'), { code: 'GRADING_WORKER_INVALID_RESPONSE' }));
                }
                if (response.statusCode < 200 || response.statusCode >= 300)
                    return reject(Object.assign(new Error('grading worker request failed'), { code: responsePayload?.code || `GRADING_WORKER_HTTP_${response.statusCode}` }));
                resolve(responsePayload);
            });
        });
        request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('grading worker request timeout'), { code: 'GRADING_WORKER_TIMEOUT' })));
        request.on('error', (error) => reject(Object.assign(error, { code: error.code || 'GRADING_WORKER_NETWORK_ERROR' })));
        request.write(body);
        request.end();
    });
}
let hardProblemTrainingServiceInstance = null;
function getHardProblemTrainingService() {
    if (!hardProblemTrainingServiceInstance)
        hardProblemTrainingServiceInstance = (0, hard_problem_training_1.createHardProblemTrainingService)({ gradingWorkerRequest });
    return hardProblemTrainingServiceInstance;
}
async function runHardProblemTrainingAction(action, method, event, user, requestId) {
    try {
        return await method({ ...event, requestId: event.requestId || requestId }, user);
    }
    catch (error) {
        const taskId = String(event?.taskId || '').trim();
        const task = taskId
            ? await context_1.db.collection(constants_1.C.tasks).doc(taskId).get().then(getFirstDocument).catch(() => null)
            : null;
        await (0, task_failure_case_1.archiveTrainingFailureEvent)({
            db: context_1.db,
            task,
            user,
            action,
            event,
            error,
            failedAt: (0, utils_1.now)()
        }).catch((archiveError) => {
            (0, audit_1.monitor)('appApi', 'TRAINING_FAILURE_ARCHIVE_FAILED', {
                taskId: taskId || null,
                action,
                errorCode: String(archiveError?.code || 'TRAINING_FAILURE_ARCHIVE_FAILED').slice(0, 100)
            }, true);
        });
        throw error;
    }
}
function workerRequest(taskId, pathName = '/internal/jobs/enqueue', timeoutMs = resolveEnqueueTimeout()) {
    return gradingWorkerRequest(pathName, { taskId }, timeoutMs);
}
async function hardProblemProviderStatus() {
    const response = await gradingWorkerRequest('/internal/providers/status', {}, 5000);
    if (!response?.providers || typeof response.providers !== 'object')
        throw Object.assign(new Error('grading worker provider status is invalid'), { code: 'GRADING_WORKER_INVALID_RESPONSE' });
    if (response.providerStatusContractVersion !== 'hard-problem-provider-status.v2')
        throw Object.assign(new Error('grading worker provider status version is unsupported'), { code: 'GRADING_WORKER_VERSION_UNSUPPORTED' });
    return {
        providers: response.providers,
        providerStatusContractVersion: response.providerStatusContractVersion,
        runtimeBuildId: typeof response.runtimeBuildId === 'string' ? response.runtimeBuildId : null,
    };
}
function canKickTask(task, now = Date.now()) {
    if (!task || ['COMPLETED', 'FAILED', 'CANCELLED', 'NEED_ANSWER', 'NEED_CONFIRMATION'].includes(String(task.status || '')))
        return false;
    const queueStatus = String(task.workerQueueStatus || '');
    const nextDispatchAt = task.workerNextDispatchAt ? new Date(task.workerNextDispatchAt).getTime() : 0;
    const due = !nextDispatchAt || nextDispatchAt <= now;
    const dispatchExpired = queueStatus === 'DISPATCHED' && (!task.workerLeaseUntil || new Date(task.workerLeaseUntil).getTime() <= now);
    const runningExpired = queueStatus === 'RUNNING' && task.workerLeaseUntil && new Date(task.workerLeaseUntil).getTime() <= now;
    return due && (queueStatus === 'PENDING' || dispatchExpired || runningExpired);
}
async function kickTaskIfEligible(taskId) {
    const now = new Date();
    const qualified = await context_1.db.runTransaction(async (transaction) => {
        const ref = transaction.collection(constants_1.C.tasks).doc(taskId);
        const task = getFirstDocument(await ref.get());
        if (!canKickTask(task, now.getTime()))
            return false;
        await ref.update({ data: { workerNextDispatchAt: new Date(now.getTime() + 15000), updatedAt: (0, utils_1.now)() } });
        return true;
    });
    if (!qualified)
        return;
    try {
        await workerRequest(taskId, '/internal/jobs/kick', 5000);
        await context_1.db.collection(constants_1.C.tasks).doc(taskId).update({ data: { workerQueueError: null } });
    }
    catch (error) {
        await context_1.db.collection(constants_1.C.tasks).doc(taskId).update({ data: { workerQueueError: String(error?.code || 'GRADING_WORKER_KICK_FAILED').slice(0, 120), workerNextDispatchAt: new Date(Date.now() + 15000), updatedAt: (0, utils_1.now)() } });
    }
}
async function dispatchTask(taskId, reason = 'unspecified') {
    const ref = context_1.db.collection(constants_1.C.tasks).doc(taskId);
    const task = getFirstDocument(await ref.get());
    if (!task)
        appError('TASK_NOT_FOUND', '任务不存在');
    if (taskHasReadyResult(task))
        return 'COMPLETED';
    const now = (0, utils_1.now)();
    await ref.update({ data: {
            workerStatus: 'PENDING',
            workerQueueStatus: 'PENDING',
            workerQueuedAt: task.workerQueuedAt || now,
            workerNextDispatchAt: now,
            workerQueueError: null,
            workerDispatchReason: String(reason || 'unspecified').slice(0, 80),
            workerDispatchRequestedAt: now,
            workerLeaseOwner: null,
            workerLeaseUntil: null,
            workerFinishedAt: null,
            updatedAt: now,
        } });
    try {
        const response = await workerRequest(taskId);
        if (['TASK_ENQUEUED', 'TASK_ALREADY_ENQUEUED', 'TASK_ALREADY_RUNNING'].includes(response?.code))
            return 'ENQUEUED';
        if (response?.code === 'TASK_ALREADY_COMPLETED')
            return 'COMPLETED';
        throw Object.assign(new Error('enqueue rejected'), { code: response?.code || 'GRADING_WORKER_REJECTED' });
    }
    catch (error) {
        const errorCode = String(error?.code || 'GRADING_WORKER_ENQUEUE_FAILED').slice(0, 120);
        const recoveryStatus = await context_1.db.runTransaction(async (transaction) => {
            const transactionRef = transaction.collection(constants_1.C.tasks).doc(taskId);
            const currentTask = getFirstDocument(await transactionRef.get());
            if (!currentTask)
                return 'PENDING';
            if (taskHasReadyResult(currentTask))
                return 'COMPLETED';
            const queueStatus = String(currentTask.workerQueueStatus || '');
            const workerStatus = String(currentTask.workerStatus || '');
            if (['DISPATCHED', 'RUNNING'].includes(queueStatus)
                || ['DISPATCHED', 'RUNNING'].includes(workerStatus))
                return 'ENQUEUED';
            if (queueStatus === 'PENDING') {
                await transactionRef.update({ data: {
                        workerQueueError: errorCode,
                        workerNextDispatchAt: new Date(Date.now() + 15000),
                        updatedAt: (0, utils_1.now)(),
                    } });
            }
            return 'PENDING';
        });
        (0, audit_1.monitor)('appApi', recoveryStatus === 'ENQUEUED'
            ? 'TASK_DISPATCH_RESPONSE_LOST'
            : 'TASK_DISPATCH_DEFERRED', { taskId, reason, errorCode, recoveryStatus }, true);
        return recoveryStatus;
    }
}
async function createTaskCoreFlow(taskId, task, actions) {
    await actions.saveTask(taskId, task);
    void Promise.resolve().then(() => actions.recordPractice(task)).catch((error) => actions.monitor('appApi', 'TASK_PRACTICE_RECORD_FAILED', { taskId, errorCode: error?.code || 'CHECKIN_PRACTICE_FAILED' }, true));
    return { taskId, dispatchStatus: await dispatchTask(taskId, 'create_task') };
}
function safeDiagnostic(value, maxLength = 1000) {
    return String(value || '')
        .replace(/(openid|phone|mobile|api[_-]?key|authorization|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
        .replace(/cloud:\/\/[^\s,;]+/gi, '[REDACTED_FILE]')
        .slice(0, maxLength);
}
function reviewOpenDiagnostics(error, requestId) {
    const configuredHash = String(process.env.REVIEW_ACCESS_CODE_HASH || '').trim();
    const expiresAt = String(process.env.REVIEW_CHANNEL_EXPIRES_AT || '').trim();
    const expiresAtValue = new Date(expiresAt);
    const stage = String(error?.reviewStage || 'review_config');
    const causeCode = String(error?.reviewCauseCode || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 120);
    return {
        operation: 'open', stage,
        errorName: String(error?.name || 'Error'), errorCode: String(error?.code || 'INTERNAL_ERROR'), errorMessage: causeCode ? `review session open failed: ${causeCode}` : 'review session open failed',
        environmentEnabled: process.env.REVIEW_CHANNEL_ENABLED === 'true', hashConfigured: Boolean(configuredHash), hashLength: configuredHash.length,
        expiresAtConfigured: Boolean(expiresAt), expiresAtValid: !Number.isNaN(expiresAtValue.getTime()) && expiresAtValue.getTime() > Date.now(),
        reviewSessionsCollectionStep: stage.startsWith('review_session_') ? stage : null, requestId,
    };
}
function fail(error, requestId, action, operation) {
    const reviewData = action === 'reviewSession' && operation === 'open'
        ? { review_stage: String(error?.reviewStage || 'review_config'), review_error_code: String(error?.code || 'INTERNAL_ERROR') }
        : {};
    if (isCollectionNotFound(error)) {
        const collection = missingCollectionForAction(action, error);
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return {
            success: false,
            code: 'COLLECTION_NOT_FOUND',
            message: isDevelopment ? '数据库集合未初始化' : '服务初始化未完成，请联系管理员',
            data: { ...(isDevelopment && collection && !(action === 'reviewSession' && operation === 'open') ? { collection } : {}), ...reviewData, request_id: requestId },
        };
    }
    const code = error?.code || 'INTERNAL_ERROR';
    const safeMessages = {
        FORBIDDEN: '没有权限',
        NO_OPENID: '未取得微信身份，请重新进入小程序',
        STUDENT_NOT_ACTIVE: '学生账号未激活',
        INVALID_INPUT: String(error?.message || '输入信息不完整'),
        INVALID_IMAGE_COUNT: '作业图片必须为1至3张',
        INVALID_PARENT_TASK: '订正任务无效',
        TASK_NOT_FOUND: '任务不存在',
        RESULT_NOT_FOUND: '批改结果不存在',
        STUDENT_NOT_FOUND: '学生不存在',
        STUDENT_DUPLICATE: '姓名存在重复，请联系教师处理',
        STUDENT_ALREADY_BOUND: '该学生信息已绑定其他微信账号。',
        TEACHER_APPLICATION_NOT_FOUND: '老师申请不存在',
        ROSTER_BOUND: '该学生名单已绑定其他微信',
        ROSTER_NOT_FOUND: '未在学生名单中',
        DUPLICATE_REQUEST_NOT_FOUND: '同名学生确认请求不存在',
        DUPLICATE_CANDIDATE_INVALID: '所选学生名单与注册信息不匹配',
        SUPER_ADMIN_LIMIT: '超级管理员最多2名',
        LAST_SUPER_ADMIN: '系统必须保留至少1名有效超级管理员',
        INVALID_ROLE: '不允许设置该角色',
        INVALID_STATUS: '当前状态不允许此操作',
        INVALID_MODEL_PROVIDER: '难题训练模型无效',
        MODEL_PROVIDER_NOT_READY: String(error?.message || '所选模型尚未配置完成'),
        STUDENT_DATA_AUTHORIZATION_REQUIRED: '请先确认已取得学生信息处理授权',
    };
    return {
        success: false,
        code,
        message: safeMessages[code] || '系统暂时无法处理，请稍后重试',
        data: { ...reviewData, request_id: requestId },
    };
}
function normalizeImportHeader(value) {
    return String(value ?? '').trim().replace(/[\s\u3000\r\n\t]+/g, '').replace(/[，,。.;；:：】【、】【\[\]()（）_-]+/g, '').toLowerCase();
}
function importHeaderColumns(row, nextRow = []) {
    const aliases = {
        name: new Set(['姓名', '学生姓名', '名字', '学生', 'name']),
        studentNumber: new Set(['学号', '学生学号', '编号', '学生编号', 'studentnumber', 'studentno', 'id']),
        grade: new Set(['年级', '所在年级', 'grade']),
        className: new Set(['地区', '所在地区', '区域', 'region', '班级', '所在班级', '班级名称', '年级班级', '班别', '行政班', 'class', 'classname']),
    };
    const columns = {};
    const length = Math.max(row.length, nextRow.length);
    for (let index = 0; index < length; index += 1) {
        const headers = [row[index], nextRow[index], `${String(row[index] ?? '')}${String(nextRow[index] ?? '')}`].map(normalizeImportHeader);
        for (const [field, names] of Object.entries(aliases)) {
            if (columns[field] === undefined && headers.some((header) => names.has(header)))
                columns[field] = index;
        }
    }
    return columns;
}
function importCell(row, column) {
    return column === undefined ? '' : String(row[column] ?? '').trim();
}
function isImportedName(value) {
    const text = String(value ?? '').trim();
    return /^[\u4e00-\u9fa5]{2,6}$/.test(text) || /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(text);
}
function isImportedStudentNumber(value) {
    const text = String(value ?? '').trim();
    return /^[A-Za-z0-9]{4,32}$/.test(text) && !/^[0-9]{1,3}$/.test(text);
}
function isImportedRegion(value) {
    const text = String(value ?? '').trim();
    return Boolean(text) && /(?:省|市|自治州|地区|盟|州|区|县|旗|班)$/.test(text);
}
function inferImportColumns(rows, start, known) {
    const width = Math.max(0, ...rows.map((row) => row.length));
    const samples = rows.slice(start, start + 30).filter((row) => row.some((value) => String(value ?? '').trim()));
    const scores = { name: [], studentNumber: [], className: [] };
    for (let index = 0; index < width; index += 1) {
        const values = samples.map((row) => importCell(row, index)).filter(Boolean);
        if (!values.length)
            continue;
        const ratio = (predicate) => values.filter(predicate).length / values.length;
        scores.name.push({ index, score: ratio(isImportedName) });
        scores.studentNumber.push({ index, score: ratio(isImportedStudentNumber) * (new Set(values).size / values.length) });
        scores.className.push({ index, score: ratio(isImportedRegion) });
    }
    const columns = { ...known };
    for (const field of ['name', 'className', 'studentNumber']) {
        if (columns[field] !== undefined)
            continue;
        const candidate = scores[field].filter((item) => !Object.values(columns).includes(item.index)).sort((left, right) => right.score - left.score)[0];
        if (candidate && candidate.score >= (field === 'studentNumber' ? 0.65 : 0.6))
            columns[field] = candidate.index;
    }
    const confidence = ['name', 'className'].reduce((total, field) => total + (columns[field] === undefined ? 0 : (scores[field].find((item) => item.index === columns[field])?.score || 0.75)), 0) / 2;
    const stableRows = samples.slice(0, 3).filter((row) => isImportedName(importCell(row, columns.name)) && isImportedRegion(importCell(row, columns.className))).length;
    return { columns, confidence, stableRows };
}
function columnLabel(row, index) {
    return index === undefined ? '' : String(row[index] || `第${index + 1}列`).trim() || `第${index + 1}列`;
}
function analyzeRosterSheet(sheet, sheetName) {
    const rows = (0, xlsx_safety_1.limitRows)(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false }));
    let best = null;
    const limit = Math.min(20, rows.length);
    for (let headerRowIndex = 0; headerRowIndex < limit; headerRowIndex += 1) {
        if (!(rows[headerRowIndex] || []).some((value) => String(value ?? '').trim()))
            continue;
        const headerColumns = importHeaderColumns(rows[headerRowIndex] || [], rows[headerRowIndex + 1] || []);
        const hasHeader = headerColumns.name !== undefined || headerColumns.className !== undefined;
        const nextHeaderColumns = importHeaderColumns(rows[headerRowIndex + 1] || []);
        const hasSecondHeaderRow = hasHeader && Object.keys(nextHeaderColumns).length > 0;
        const dataStart = hasHeader ? headerRowIndex + (hasSecondHeaderRow ? 2 : 1) : headerRowIndex;
        const inferred = inferImportColumns(rows, dataStart, headerColumns);
        const hasRequired = inferred.columns.name !== undefined && inferred.columns.className !== undefined;
        const confidence = Math.min(1, inferred.confidence + (headerColumns.name !== undefined ? 0.12 : 0) + (headerColumns.className !== undefined ? 0.12 : 0));
        const candidate = { sheetName, rows, headerRowIndex, dataStart, columns: inferred.columns, confidence, stableRows: inferred.stableRows, hasHeader, hasRequired };
        if (!best || candidate.confidence > best.confidence)
            best = candidate;
    }
    if (!best)
        return { sheetName, rows, headerRowIndex: -1, dataStart: 0, columns: {}, confidence: 0, stableRows: 0, hasHeader: false, hasRequired: false };
    best.columnLabels = Object.fromEntries(Object.entries(best.columns).map(([field, index]) => [field, columnLabel(best.rows[best.headerRowIndex] || [], index)]));
    return best;
}
function cleanScopes(input) {
    if (!Array.isArray(input))
        return [];
    const seen = new Set();
    const scopes = [];
    for (const raw of input) {
        const grade = String(raw?.grade || '').trim();
        const className = String(raw?.region || raw?.className || '').trim();
        if (!className)
            continue;
        const key = (0, utils_1.scopeKey)(grade, className);
        if (seen.has(key))
            continue;
        seen.add(key);
        scopes.push({ grade, className });
    }
    return scopes;
}
function assertStudentFields(student) {
    const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const name = normalize(student?.name);
    const grade = normalize(student?.grade);
    const className = normalize(student?.region || student?.className);
    if (!name || !className)
        appError('INVALID_INPUT', '请完整填写姓名和地区');
    return { name, grade, className };
}
function normalizeRosterMatch(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function regionOf(value) {
    return String(value?.region || value?.className || '').trim();
}
function normalizeChineseNumber(value) {
    return String(value || '')
        .replace(/十二/g, '12').replace(/十一/g, '11').replace(/十/g, '10')
        .replace(/一/g, '1').replace(/二/g, '2').replace(/三/g, '3').replace(/四/g, '4').replace(/五/g, '5')
        .replace(/六/g, '6').replace(/七/g, '7').replace(/八/g, '8').replace(/九/g, '9');
}
function normalizeGrade(value) {
    const normalized = normalizeChineseNumber(String(value || '').trim().replace(/\s+/g, ''));
    const match = normalized.match(/(\d+)年级/);
    return match ? `${match[1]}年级` : normalized;
}
function normalizeClassName(value) {
    const normalized = normalizeChineseNumber(String(value || '').trim().replace(/\s+/g, ''));
    const match = normalized.match(/(?:\d+年级)?(\d+)班$/);
    return match ? `${match[1]}班` : normalized;
}
function requireActiveSuperAdmin(user) {
    (0, auth_1.requireRole)(user, ['super_admin']);
    if (user.status !== 'ACTIVE')
        appError('FORBIDDEN', '没有权限');
}
async function ensureClass(grade, className) {
    const id = `c_${Buffer.from((0, utils_1.scopeKey)(grade, className)).toString('hex').slice(0, 40)}`;
    await context_1.db.collection(constants_1.C.classes).doc(id).set({ data: { grade, className, updatedAt: (0, utils_1.now)() } });
    return id;
}
function normalizeFileIds(...values) {
    const seen = new Set();
    const ids = [];
    for (const value of values) {
        if (!Array.isArray(value))
            continue;
        for (const raw of value) {
            const fileId = String(raw || '').trim();
            if (fileId && !seen.has(fileId)) {
                seen.add(fileId);
                ids.push(fileId);
            }
        }
    }
    return ids;
}
function taskImageIds(task) {
    return {
        homework: normalizeFileIds(task?.studentImageFileIds, task?.homeworkImageFileIds, task?.homeworkImageIds, task?.studentImageIds, task?.homeworkImages, task?.imageIds, task?.fileIds),
        answer: normalizeFileIds(task?.answerImageFileIds, task?.answerImageFileIds, task?.standardAnswerImageFileIds, task?.standardAnswerImageIds, task?.answerImageIds, task?.answerImages),
    };
}
async function temporaryImages(fileIds) {
    let urls = {};
    try {
        const fileList = fileIds.length ? (await context_1.cloud.getTempFileURL({ fileList: fileIds })).fileList : [];
        urls = Object.fromEntries(fileList.filter((item) => item?.fileID && item?.tempFileURL).map((item) => [item.fileID, item.tempFileURL]));
    }
    catch { }
    return fileIds.map((fileId, index) => ({ fileId, tempUrl: urls[fileId] || '', index: index + 1, loadFailed: !urls[fileId] }));
}
function taskDateKey(task) {
    if (task?.taskDateKey)
        return String(task.taskDateKey);
    try {
        return task?.createdAt ? (0, utils_1.shanghaiDateKey)(new Date(task.createdAt)) : '';
    }
    catch {
        return '';
    }
}
function displayTasks(tasks) {
    const groups = new Map();
    for (const task of tasks) {
        const dateKey = taskDateKey(task);
        const key = `${String(task?.studentId || '')}:${dateKey}`;
        groups.set(key, [...(groups.get(key) || []), task]);
    }
    const titles = new Map();
    for (const group of groups.values()) {
        group.sort((left, right) => new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime() || String(left._id || left.taskId).localeCompare(String(right._id || right.taskId)));
        group.forEach((task, index) => {
            const dateKey = taskDateKey(task);
            const dailySequence = index + 1;
            const displayTitle = dateKey ? (0, task_title_1.automaticTaskTitleForDateKey)(dateKey, dailySequence) : '未命名作业';
            titles.set(String(task._id || task.taskId || ''), { displayTitle, taskDateKey: dateKey, dailySequence });
        });
    }
    return tasks.map((task) => ({ ...task, mode: taskModeForRead(task), carelessTrainingType: carelessTrainingTypeForRead(task), ...(titles.get(String(task._id || task.taskId || '')) || {}) }));
}
function rosterStudentNumber(student) {
    const extra = student?.extraFields || {};
    return String(student?.studentNumber || student?.studentNo || extra['学号'] || extra.studentNumber || extra.studentNo || extra.studentIdNumber || '').trim();
}
function currentManagerId(user) {
    return String(user?.userId || user?._id || '').trim();
}
function rosterManagerIds(student) {
    return [...new Set([
            student?.ownerTeacherId,
            student?.teacherId,
            student?.managerId,
            ...(Array.isArray(student?.teacherIds) ? student.teacherIds : []),
            ...(Array.isArray(student?.managerIds) ? student.managerIds : []),
        ].map((value) => String(value || '').trim()).filter(Boolean))];
}
function teacherOwnsRoster(user, student) {
    if (user?.role === 'super_admin')
        return true;
    if (user?.role !== 'teacher' || !student)
        return false;
    const explicitManagers = rosterManagerIds(student);
    if (explicitManagers.length)
        return explicitManagers.includes(currentManagerId(user));
    return (0, utils_1.hasScope)(user, student.grade, regionOf(student));
}
function reviewRosterFilter(user) {
    const reviewMode = user?.reviewMode === true;
    return (student) => reviewMode ? student?.reviewOnly === true : student?.reviewOnly !== true;
}
function reviewTaskFilter(user) {
    const reviewMode = user?.reviewMode === true;
    return (task) => reviewMode ? String(task?.studentId || '') === 'review_student_fixed' : String(task?.studentId || '') !== 'review_student_fixed';
}
async function visibleRosterStudents(user, archived = false) {
    (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
    const response = await context_1.db.collection(constants_1.C.roster).where({ archived }).limit(1000).get();
    return (user.role === 'super_admin' ? response.data : response.data.filter((student) => teacherOwnsRoster(user, student))).filter((student) => (0, utils_1.canAccessDataSpace)(user, student)).filter(reviewRosterFilter(user));
}
async function teacherBoundStudentIds(user) {
    const roster = await visibleRosterStudents(user, false);
    return new Set(roster.map((student) => String(student.boundUserId || '').trim()).filter(Boolean));
}
async function visibleStudentTasks(user) {
    if (user.role === 'student') {
        (0, auth_1.requireActiveStudent)(user);
        return (await context_1.db.collection(constants_1.C.tasks).where({ studentId: user.userId }).limit(1000).get()).data.filter((task) => (0, utils_1.dataSpaceOf)(task) === (0, utils_1.dataSpaceOf)(user));
    }
    (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
    const tasks = (await context_1.db.collection(constants_1.C.tasks).limit(1000).get()).data.filter((task) => task.studentId);
    if (user.role === 'super_admin')
        return tasks.filter((task) => (0, utils_1.canAccessDataSpace)(user, task)).filter(reviewTaskFilter(user));
    const boundStudentIds = await teacherBoundStudentIds(user);
    return tasks.filter((task) => boundStudentIds.has(String(task.studentId || '').trim()) && (0, utils_1.canAccessDataSpace)(user, task));
}
async function assertTaskAccess(task, user) {
    if (!task)
        appError('TASK_NOT_FOUND', '任务不存在');
    if (user.role === 'student' && (task.studentId !== user.userId || (0, utils_1.dataSpaceOf)(task) !== (0, utils_1.dataSpaceOf)(user)))
        appError('FORBIDDEN', '没有权限');
    if (user.role !== 'student' && !(0, utils_1.canAccessDataSpace)(user, task))
        appError('FORBIDDEN', '没有权限');
    if (user.role === 'teacher') {
        const boundStudentIds = await teacherBoundStudentIds(user);
        if (!boundStudentIds.has(String(task.studentId || '').trim()))
            appError('FORBIDDEN', '没有权限');
    }
    if (!['student', 'teacher', 'super_admin'].includes(user.role))
        appError('FORBIDDEN', '没有权限');
}
async function assertTaskViewerAccess(task, user, event, requireTeacherViewer = false) {
    if (user.role === 'student') {
        (0, auth_1.requireActiveStudent)(user);
        await assertTaskAccess(task, user);
        return;
    }
    const viewerMode = String(event?.viewerMode || '').trim();
    if (!['teacher', 'super_admin'].includes(user.role) || (requireTeacherViewer && viewerMode !== 'teacher'))
        appError('FORBIDDEN', '没有权限');
    if (viewerMode === 'teacher') {
        const targetStudentId = String(event?.targetStudentId || '').trim();
        if (!targetStudentId || String(task?.studentId || '').trim() !== targetStudentId)
            appError('FORBIDDEN', '没有权限');
    }
    await assertTaskAccess(task, user);
}
async function taskWithUrls(task, user) {
    await assertTaskAccess(task, user);
    const imageIds = taskImageIds(task);
    return {
        task: {
            taskId: String(task._id || task.taskId || ''), title: String(task.displayTitle || task.title || '未命名作业'), displayTitle: String(task.displayTitle || task.title || '未命名作业'), status: String(task.status || ''), mode: taskModeForRead(task),
            carelessTrainingType: carelessTrainingTypeForRead(task), currentStage: String(task.currentStage || 'QUEUED'), stage: String(task.currentStage || 'QUEUED'), progress: Number(task.progress || 0), statusMessage: String(task.statusMessage || ''), resultId: String(task.resultId || ''), resultReady: taskHasReadyResult(task),
            reviewRequired: task.reviewRequired === true, reviewReason: Array.isArray(task.reviewReason) ? task.reviewReason : [], adjudicationRequired: task.adjudicationRequired === true, finalSource: String(task.finalSource || ''), voiceStatus: String(task.voiceStatus || 'PENDING'), errorCode: String(task.errorCode || ''),
            errorMessage: String(task.errorMessage || ''), errorSuggestion: String(task.errorSuggestion || ''), failureId: String(task.failureId || ''), retryable: task.retryable !== false, failureCategory: String(task.failureCategory || ''),
            createdAt: task.createdAt || null, updatedAt: task.updatedAt || null, completedAt: task.completedAt || null,
            homeworkImages: await temporaryImages(imageIds.homework), answerImages: await temporaryImages(imageIds.answer),
        },
        result: null,
    };
}
async function resultWithAudioNarration(result) {
    if (!result)
        return result;
    const reviewProjection = Array.isArray(result.questions) ? result.questions.map((question) => (0, result_semantics_1.reviewProjection)(question)) : [];
    const audio = result.audioNarration;
    if (!audio)
        return { ...result, reviewProjection };
    let tempUrl = '';
    if (audio.status === 'READY' && audio.fileId) {
        try {
            const response = await context_1.cloud.getTempFileURL({ fileList: [audio.fileId] });
            tempUrl = String(response.fileList?.[0]?.tempFileURL || '');
        }
        catch { }
    }
    return { ...result, reviewProjection, audioNarration: { status: String(audio.status || ''), tempUrl, durationMs: Number(audio.durationMs || 0), mimeType: String(audio.mimeType || ''), generatedAt: audio.generatedAt || null } };
}
async function resolveBoundTeachersForStudent(student) {
    let roster = null;
    const rosterId = String(student?.rosterId || '').trim();
    if (rosterId) {
        try {
            roster = (await context_1.db.collection(constants_1.C.roster).doc(rosterId).get()).data || null;
        }
        catch (error) {
            if (!isDocumentNotFound(error))
                throw error;
        }
    }
    const ownerTeacherId = String(roster?.ownerTeacherId || '').trim();
    if (!ownerTeacherId)
        return [];
    let teacher = null;
    try {
        teacher = (await context_1.db.collection(constants_1.C.users).doc(ownerTeacherId).get()).data || null;
    }
    catch (error) {
        if (!isDocumentNotFound(error))
            throw error;
    }
    if (!teacher || teacher.status !== 'ACTIVE' || !['teacher', 'super_admin'].includes(teacher.role))
        return [];
    return [{ userId: ownerTeacherId, name: String(teacher.name || ''), role: teacher.role }];
}
async function profileForStudent(user) {
    const boundTeachers = await resolveBoundTeachersForStudent(user);
    const boundTeacherNames = boundTeachers.map((teacher) => teacher.name).filter(Boolean).join('、') || '暂未绑定';
    const classId = String(user.classId || '');
    const { openid, scopes, requestedScopes, ...safe } = user;
    return { ...safe, region: regionOf(user), avatarUrl: String(user.avatarUrl || ''), classId, boundTeachers, boundTeacherNames };
}
function applyTeacherCorrectOverride(question, teacherCorrect) {
    if (!teacherCorrect) return { ...question };
    const schemaVersion = String(question?.outputSchemaVersion || '');
    if (schemaVersion === 'hard-problem.v2') return {
        ...question, evaluationStatus: 'CORRECT', answerStatus: 'answered', finalAnswerCorrect: true,
        errorType: 'none', firstWrongStep: '', errorReason: '', adjustmentSuggestion: ''
    };
    if (schemaVersion === 'reading-careless.v2') return {
        ...question, analysisStatus: 'ok', threeGridStatus: 'CORRECT', conditionCorrect: true, relationCorrect: true, askCorrect: true,
        threeGridComplete: true, missingConditions: [], incorrectConditions: [], relationIssues: [], askIssue: '', errorReason: '', correctionAdvice: ''
    };
    if (schemaVersion === 'calculation-careless.v2') return {
        ...question, analysisStatus: 'ok', calculationStatus: 'CORRECT', processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none',
        carelessIssues: [], methodIssues: [], firstErrorPoint: '', errorReason: '', correctionAdvice: ''
    };
    return { ...question };
}
function legacyCarelessTypeForReviewedQuestion(question, normalized) {
    if (question?.outputSchemaVersion === 'calculation-careless.v2') {
        if (normalized?.resultCategory === 'careless') return 'careless';
        if (normalized?.resultCategory === 'knowledge_or_method') return 'method_error';
        return 'none';
    }
    return String(question?.carelessType || 'none');
}
function normalizeReviewedQuestions(questions) {
    if (!Array.isArray(questions) || !questions.length)
        appError('INVALID_INPUT', '批改结果必须包含题目');
    return questions.map((question, index) => {
        const maxScore = Math.max(0, Number(question?.maxScore ?? 1));
        const score = Math.max(0, Math.min(maxScore, Number(question?.score ?? 0)));
        const teacherCorrect = Boolean(question?.isCorrect);
        const teacherOverrideStatus = teacherCorrect ? 'CORRECT' : 'WRONG';
        const schemaVersion = String(question?.outputSchemaVersion || '');
        const sourceKey = String(question?.sourceKey || '').trim();
        if (V2_RESULT_SCHEMAS.has(schemaVersion) && !sourceKey) appError('INVALID_INPUT', `第${index + 1}题缺少 sourceKey，无法安全复核`);
        const consistentQuestion = applyTeacherCorrectOverride(question, teacherCorrect);
        const reviewedQuestion = { ...consistentQuestion, teacherOverrideApplied: true, teacherOverrideStatus };
        const normalized = (0, result_semantics_1.normalizeDownstreamSemantics)(reviewedQuestion);
        return {
            ...reviewedQuestion,
            ...normalized,
            sourceKey: sourceKey || `作业题${index + 1}`,
            maxScore,
            score,
            isCorrect: teacherCorrect,
            carelessType: legacyCarelessTypeForReviewedQuestion(reviewedQuestion, normalized),
            errorReason: String(reviewedQuestion?.errorReason || ''),
            briefFeedback: String(question?.briefFeedback || ''),
        };
    });
}
function buildGradingSummary(questions) {
    const summary = { totalCount: 0, correctCount: 0, carelessCount: 0, wrongCount: 0, unansweredCount: 0, incorrectTotal: 0 };
    for (const question of Array.isArray(questions) ? questions : []) {
        summary.totalCount += 1;
        const answerStatus = String(question?.answerStatus || '').trim().toLowerCase();
        const errorType = String(question?.errorType || '').trim().toLowerCase();
        const mistakeType = String(question?.mistakeType || '').trim().toLowerCase();
        const isUnanswered = question?.isUnanswered === true || answerStatus === 'unanswered' || ['unanswered', '未作答'].includes(String(question?.status || '').trim().toLowerCase()) || ['unanswered', '未作答'].includes(errorType) || ['unanswered', '未作答'].includes(mistakeType);
        const carelessType = String(question?.carelessType || '').trim().toLowerCase();
        const isCalculationCareless = question?.outputSchemaVersion === 'calculation-careless.v2' && (question?.carelessDetected === true || question?.issueCategory === 'careless');
        const isCareless = isCalculationCareless || question?.isCareless === true || String(question?.carelessStatus || '').trim().toLowerCase() === 'careless' || (carelessType && !['none', 'not_careless', 'false'].includes(carelessType)) || ['careless', '马虎'].includes(errorType) || ['careless', '马虎'].includes(mistakeType);
        if (question?.isCorrect === true || answerStatus === 'correct')
            summary.correctCount += 1;
        else if (isUnanswered)
            summary.unansweredCount += 1;
        else if (isCareless)
            summary.carelessCount += 1;
        else
            summary.wrongCount += 1;
    }
    summary.incorrectTotal = summary.carelessCount + summary.wrongCount;
    return summary;
}
const V2_RESULT_SCHEMAS = new Set(['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2']);
function countValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function deriveV2Summary(outputSchemaVersion, questions) {
    const source = Array.isArray(questions) ? questions : [];
    const summary = { totalCount: source.length, correctCount: 0, wrongCount: 0, incompleteCount: 0, carelessCount: 0 };
    for (const question of source) {
        if (outputSchemaVersion === 'reading-careless.v2') {
            const status = String(question?.normalizedStatus || question?.threeGridStatus || 'UNDETERMINED');
            if (status === 'CORRECT') summary.correctCount += 1;
            else if (status === 'WRONG') summary.wrongCount += 1;
            else summary.incompleteCount += 1;
            continue;
        }
        if (outputSchemaVersion === 'calculation-careless.v2') {
            const status = String(question?.teacherOverrideApplied === true ? question?.teacherOverrideStatus : (question?.normalizedStatus || question?.calculationStatus || 'UNDETERMINED'));
            if (status === 'CORRECT') summary.correctCount += 1;
            else if (status === 'WRONG') {
                if (question?.carelessDetected === true || question?.issueCategory === 'careless') summary.carelessCount += 1;
                else summary.wrongCount += 1;
            }
            else if (question?.analysisStatus !== 'ok' || question?.carelessDetected == null) summary.incompleteCount += 1;
            else if (question?.carelessDetected === true) summary.carelessCount += 1;
            else if (question?.processCorrect === true && question?.finalAnswerCorrect === true) summary.correctCount += 1;
            else summary.wrongCount += 1;
            continue;
        }
        const status = String(question?.normalizedStatus || question?.evaluationStatus || 'UNDETERMINED');
        if (status === 'CORRECT') summary.correctCount += 1;
        else if (status === 'WRONG') summary.wrongCount += 1;
        else summary.incompleteCount += 1;
    }
    return summary;
}
function summaryForCompletedResult(result) {
    const outputSchemaVersion = String(result?.outputSchemaVersion || '');
    const questions = Array.isArray(result?.questions) ? result.questions : [];
    if (!V2_RESULT_SCHEMAS.has(outputSchemaVersion))
        return { ...(result?.summary || {}), ...buildGradingSummary(questions) };
    const derived = deriveV2Summary(outputSchemaVersion, questions);
    const source = result?.summary && typeof result.summary === 'object' ? result.summary : {};
    const summary = {
        ...source,
        ...derived,
    };
    if (outputSchemaVersion === 'hard-problem.v2') {
        summary.unansweredCount = questions.filter((question) => String(question?.normalizedStatus || question?.evaluationStatus || '') === 'UNANSWERED').length;
        summary.unreadableCount = questions.filter((question) => String(question?.normalizedStatus || question?.evaluationStatus || '') === 'UNREADABLE').length;
    } else {
        summary.unansweredCount = derived.incompleteCount;
    }
    summary.incorrectTotal = summary.wrongCount + summary.carelessCount;
    return summary;
}
function summarizeQuestions(questions) {
    const totalScore = questions.reduce((sum, question) => sum + Number(question.maxScore || 0), 0);
    const awardedScore = questions.reduce((sum, question) => sum + Number(question.score || 0), 0);
    const gradingSummary = buildGradingSummary(questions);
    return {
        totalScore,
        awardedScore,
        ...gradingSummary,
        allCorrect: questions.length > 0 && gradingSummary.correctCount === questions.length,
    };
}
function latestCompletedTaskPayload(task, result) {
    const rawQuestions = Array.isArray(result?.questions) ? result.questions : [];
    const questions = rawQuestions.map((question, index) => ({
        sourceKey: String(question?.sourceKey || `题目 ${index + 1}`),
        questionText: String(question?.questionText || ''),
        score: Number(question?.score || 0),
        maxScore: Number(question?.maxScore || 0),
        isCorrect: Boolean(question?.isCorrect),
        carelessType: String(question?.carelessType || 'none'),
        briefFeedback: String(question?.briefFeedback || ''),
    }));
    const summary = summaryForCompletedResult(result);
    return {
        task: task ? {
            taskId: String(task._id || task.taskId || ''),
            mode: taskModeForRead(task),
            title: String(task.taskName || task.statusMessage || ''),
            status: String(task.status || ''),
            createdAt: task.createdAt || null,
            completedAt: task.completedAt || null,
            imageCount: Number(task.imageCount || (task.studentImageFileIds || []).length || 0),
        } : null,
        result: task ? {
            questions,
            summary: {
                totalCount: Number(summary.totalCount),
                correctCount: Number(summary.correctCount),
                wrongCount: Number(summary.wrongCount),
                carelessCount: Number(summary.carelessCount),
                unansweredCount: Number(summary.unansweredCount),
                incorrectTotal: Number(summary.incorrectTotal),
                totalScore: Number(summary.totalScore ?? task.totalScore ?? 0),
                awardedScore: Number(summary.awardedScore ?? task.awardedScore ?? 0),
            },
            imageQuality: result?.imageQuality || null,
        } : null,
    };
}
function completedTaskSummary(task, result) {
    const summary = summaryForCompletedResult(result);
    const resultSummary = result ? {
        totalQuestionCount: Number(summary.totalCount),
        correctCount: Number(summary.correctCount),
        wrongCount: Number(summary.wrongCount),
        incompleteCount: Number(summary.incompleteCount ?? summary.unansweredCount ?? 0),
    } : null;
    return {
        taskId: String(task._id || task.taskId || ''), status: String(task.status || ''), stage: String(task.currentStage || ''), progress: Number(task.progress || 0), mode: taskModeForRead(task), title: String(task.displayTitle || task.title || '未命名作业'), displayTitle: String(task.displayTitle || task.title || '未命名作业'),
        createdAt: task.createdAt || null, completedAt: task.completedAt || null,
        resultId: String(task.resultId || ''), resultSummary,
        totalQuestionCount: resultSummary?.totalQuestionCount ?? null,
        questionCount: resultSummary?.totalQuestionCount ?? null,
        imageCount: taskImageIds(task).homework.length,
        correctCount: resultSummary?.correctCount ?? null,
        wrongCount: resultSummary?.wrongCount ?? null,
        incompleteCount: resultSummary?.incompleteCount ?? null,
        carelessCount: Number(summary.carelessCount),
        unansweredCount: Number(summary.unansweredCount),
        incorrectTotal: Number(summary.incorrectTotal),
    };
}
async function resultsForTasks(tasks, user = null) {
    const resultIds = [...new Set(tasks.map((task) => String(task?.resultId || '').trim()).filter(Boolean))];
    const batches = [];
    for (let index = 0; index < resultIds.length; index += 10)
        batches.push(resultIds.slice(index, index + 10));
    const responses = await Promise.all(batches.map((ids) => context_1.db.collection(constants_1.C.results).where({ _id: context_1.cmd.in(ids) }).limit(100).get()));
    return new Map(responses.flatMap((response) => response.data).filter((result) => !user || (user.role === 'student' ? (0, utils_1.dataSpaceOf)(result) === (0, utils_1.dataSpaceOf)(user) : (0, utils_1.canAccessDataSpace)(user, result))).map((result) => [String(result._id || ''), result]));
}
async function readTodayCheckin(studentId, dateKey) {
    try {
        const response = await context_1.db.collection(constants_1.C.checkins).doc(`${studentId}_${dateKey}`).get();
        return Array.isArray(response?.data) ? (response.data[0] || null) : (response?.data || null);
    }
    catch (error) {
        if (isDocumentNotFound(error))
            return null;
        throw error;
    }
}
async function reconcileTodayCheckin(studentId, dateKey, rows, tasks, user = null) {
    const current = rows.find((record) => record?.studentId === studentId && record?.dateKey === dateKey) || null;
    const normalized = (0, checkin_1.normalizeCheckinRecord)(current || { dateKey });
    const completedTasks = tasks.filter((task) => task?.studentId === studentId
        && task?.status === 'COMPLETED'
        && Boolean(String(task?.resultId || '').trim())
        && taskDateKey(task) === dateKey);
    if ((current && normalized.qualifiedQuestionCount >= normalized.requiredQuestionCount) || !completedTasks.length)
        return rows;
    let resultCount = 0;
    try {
        const results = await resultsForTasks(completedTasks, user);
        resultCount = results.size;
        for (const task of completedTasks) {
            const result = results.get(String(task.resultId || ''));
            if (!result)
                continue;
            const questions = (Array.isArray(result.questions) ? result.questions : []).map((question) => ({
                ...question,
                ...(0, result_semantics_1.normalizeDownstreamSemantics)(question, task.mode),
            }));
            await (0, checkin_1.recordQualifiedQuestions)(task, questions);
        }
        const reconciled = await readTodayCheckin(studentId, dateKey);
        if (!reconciled)
            return rows;
        return [...rows.filter((record) => !(record?.studentId === studentId && record?.dateKey === dateKey)), reconciled];
    }
    catch (error) {
        (0, audit_1.monitor)('checkin', 'CHECKIN_RECONCILE_FAILED', {
            studentIdExists: Boolean(studentId),
            dateKey,
            completedTaskCount: completedTasks.length,
            resultCount,
            errorCode: String(error?.code || error?.errCode || 'UNKNOWN'),
        }, true);
        return rows;
    }
}
async function removeAnswerExtractions(taskId) {
    while (true) {
        const response = await context_1.db.collection(constants_1.C.answerExtractions).where({ taskId }).limit(100).get();
        if (!response.data.length)
            break;
        for (const item of response.data)
            await context_1.db.collection(constants_1.C.answerExtractions).doc(item._id).remove();
    }
}
async function removeWrongQuestionsForTask(taskId) {
    while (true) {
        const response = await context_1.db.collection(constants_1.C.wrong).where({ taskId }).limit(100).get();
        if (!response.data.length)
            break;
        for (const item of response.data)
            await context_1.db.collection(constants_1.C.wrong).doc(item._id).remove();
    }
}
async function rebuildDerivedRecordsAfterReview(task, questions, summary) {
    await removeWrongQuestionsForTask(task._id);
    for (const question of questions) {
        const wrongRecord = (0, result_semantics_1.wrongQuestionProjection)(question, task.mode);
        if (wrongRecord.wrongQuestionDisposition !== 'CREATE')
            continue;
        const id = `${task._id}_${(0, utils_1.hash)(String(question.sourceKey)).slice(0, 32)}`;
        await context_1.db.collection(constants_1.C.wrong).doc(id).set({ data: {
                studentId: task.studentId,
                taskId: task._id,
                dataSpace: (0, utils_1.dataSpaceOf)(task),
                ...wrongRecord,
                carelessType: question.carelessType || 'none',
                mastered: false,
                teacherReviewed: true,
                createdAt: (0, utils_1.now)(),
                updatedAt: (0, utils_1.now)(),
            } });
    }
    if (task.parentTaskId && summary.allCorrect) {
        const previous = await context_1.db.collection(constants_1.C.wrong)
            .where({ studentId: task.studentId, taskId: task.parentTaskId })
            .limit(100)
            .get();
        for (const item of previous.data) {
            await context_1.db.collection(constants_1.C.wrong).doc(item._id).update({ data: {
                    mastered: true,
                    masteredAt: (0, utils_1.now)(),
                    masteredByTaskId: task._id,
                    updatedAt: (0, utils_1.now)(),
                } });
        }
    }
    await (0, checkin_1.recordQualifiedQuestions)(task, questions);
}
function validSubmittedAt(value) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time > 0;
}
function teacherApplicationInvalidReason(application, user, openid) {
    if (!application)
        return 'APPLICATION_NOT_FOUND';
    if (!validSubmittedAt(application.submittedAt))
        return 'MISSING_SUBMITTED_AT';
    if (application.submitSource !== 'USER_EXPLICIT_ACTION')
        return 'MISSING_OR_INVALID_SUBMIT_SOURCE';
    const applicantMatches = String(application.applicantUserId || '') === String(user?.userId || '');
    const openidMatches = Boolean(openid) && String(application.openid || '') === openid;
    if (!applicantMatches && !openidMatches)
        return 'APPLICANT_IDENTITY_MISMATCH';
    const applicationData = application.applicationData || {};
    const name = String(applicationData.name || application.name || '').trim();
    const scopes = cleanScopes(applicationData.scopes || application.requestedScopes);
    if (!name || !scopes.length || !scopes.every((scope) => scope.className))
        return 'APPLICATION_DATA_MISSING';
    return '';
}
async function currentTeacherApplication(user) {
    if (!user?.userId)
        return null;
    try {
        return (await context_1.db.collection(constants_1.C.teacherApplications).doc(user.userId).get()).data;
    }
    catch (error) {
        if (isDocumentNotFound(error))
            return null;
        throw error;
    }
}
function withoutUndefined(value) {
    if (Array.isArray(value))
        return value.map(withoutUndefined).filter((item) => item !== undefined);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, withoutUndefined(item)]));
    }
    return value;
}
async function submitTeacherApplication(event, user, requestId, openid) {
    let step = 'VALIDATE_INPUT';
    try {
        const name = String(event.name || '').trim();
        const scopes = cleanScopes(event.scopes);
        const grade = String(scopes[0]?.grade || '').trim();
        const className = String(scopes[0]?.className || '').trim();
        if (!name || !className)
            appError('INVALID_INPUT', '请填写姓名和任教地区');
        step = 'LOAD_USER';
        const byOpenid = openid ? await context_1.db.collection(constants_1.C.users).where({ openid }).limit(100).get() : { data: [] };
        const candidates = [...byOpenid.data, user].filter(Boolean).reduce((items, item) => {
            const id = String(item._id || item.userId || '');
            return id && !items.some((saved) => String(saved._id || saved.userId || '') === id) ? [...items, item] : items;
        }, []);
        const canonical = candidates.find((item) => String(item._id || item.userId || '') === String(user.userId)) || candidates[0];
        const userId = String(canonical?._id || canonical?.userId || user.userId || '');
        if (!userId)
            appError('INVALID_INPUT', '未取得用户身份');
        step = 'LOAD_APPLICATION';
        const [byApplicant, byUser] = await Promise.all([
            context_1.db.collection(constants_1.C.teacherApplications).where({ applicantUserId: userId }).limit(100).get(),
            context_1.db.collection(constants_1.C.teacherApplications).where({ userId }).limit(100).get(),
        ]);
        const applications = [...byApplicant.data, ...byUser.data].filter((item, index, all) => !all.slice(0, index).some((saved) => String(saved._id || saved.userId || '') === String(item._id || item.userId || '')));
        const existing = applications.find((item) => item.status === 'PENDING') || applications.find((item) => item.status === 'APPROVED') || applications[0] || null;
        if (existing?.status === 'APPROVED')
            return ok({ accountStatus: 'ACTIVE', needsRegistration: false });
        const submittedAt = (0, utils_1.now)();
        step = 'CREATE_OR_UPDATE_USER';
        const userData = withoutUndefined({
            ...(canonical || {}), userId, openid, role: 'teacher', status: 'PENDING', accountStatus: 'PENDING', name, grade, className,
            requestedScopes: scopes, createdAt: canonical?.createdAt || submittedAt, updatedAt: submittedAt,
        });
        await context_1.db.collection(constants_1.C.users).doc(userId).set({ data: userData });
        step = 'CREATE_OR_UPDATE_APPLICATION';
        const applicationData = withoutUndefined({ name, scopes, grade, className });
        const applicationId = String(existing?._id || existing?.userId || userId);
        await context_1.db.collection(constants_1.C.teacherApplications).doc(applicationId).set({ data: withoutUndefined({
                ...(existing || {}), userId, applicantUserId: userId, openid, name, applicationData, requestedScopes: scopes,
                status: 'PENDING', submitSource: 'USER_EXPLICIT_ACTION', submittedAt, createdAt: existing?.createdAt || submittedAt, updatedAt: submittedAt,
            }) });
        step = 'WRITE_AUDIT';
        await (0, audit_1.audit)({ ...user, userId, role: 'teacher' }, 'TEACHER_APPLIED', 'teacher', userId, null, { scopes }, true, requestId)
            .catch((auditError) => console.error('[registerTeacher-audit-failed]', { requestId, errCode: auditError?.code || '', errMsg: safeDiagnostic(auditError?.message, 500) }));
        step = 'COMMIT';
        return ok({ accountStatus: 'TEACHER_PENDING', needsRegistration: false });
    }
    catch (error) {
        console.error('[registerTeacher-failed]', { requestId, step, errCode: error?.code || error?.errCode || '', errMsg: safeDiagnostic(error?.message, 1000) });
        throw error;
    }
}
async function repairTeacherApplication(event, user, requestId) {
    requireActiveSuperAdmin(user);
    const targetUserId = String(event.targetUserId || '').trim();
    const reason = String(event.reason || '').trim();
    if (!targetUserId || reason !== 'LEGACY_OR_UNINTENDED_APPLICATION') {
        appError('INVALID_INPUT', '修复参数无效');
    }
    const application = (await context_1.db.collection(constants_1.C.teacherApplications).doc(targetUserId).get()).data;
    if (!application)
        appError('TEACHER_APPLICATION_NOT_FOUND', '老师申请不存在');
    const target = (await context_1.db.collection(constants_1.C.users).doc(targetUserId).get()).data;
    if (application.status === 'APPROVED' || ['super_admin', 'developer_admin'].includes(target?.role)) {
        appError('INVALID_STATUS', '已批准教师不得修复');
    }
    const invalidatedAt = (0, utils_1.now)();
    await context_1.db.runTransaction(async (transaction) => {
        await transaction.collection(constants_1.C.teacherApplications).doc(targetUserId).update({ data: {
                status: 'INVALID', invalidReason: reason, invalidatedAt, invalidatedBy: user.userId, updatedAt: invalidatedAt,
            } });
        if (target && target.role !== 'student') {
            await transaction.collection(constants_1.C.users).doc(targetUserId).update({ data: { status: 'NEW', updatedAt: invalidatedAt } });
        }
    });
    await (0, audit_1.audit)(user, 'TEACHER_APPLICATION_INVALIDATED', 'teacher', targetUserId, { status: application.status }, {
        targetUserId, reason, invalidatedAt, invalidatedBy: user.userId,
    }, true, requestId);
    return ok({ repaired: true, targetUserId, status: 'INVALID', invalidReason: reason });
}
async function submitStudentRegistration(event, user, requestId, openid) {
    let step = 'VALIDATE_INPUT';
    try {
        const name = String(event.name || '').trim().replace(/\s+/g, ' ');
        const region = String(event.region || event.className || '').trim().replace(/\s+/g, ' ');
        if (!name || !region)
            appError('INVALID_INPUT', '请完整填写姓名和地区');
        step = 'LOAD_USER';
        const byOpenid = openid ? await context_1.db.collection(constants_1.C.users).where({ openid }).limit(100).get() : { data: [] };
        const candidates = [...byOpenid.data, user].filter(Boolean).reduce((items, item) => {
            const id = String(item._id || item.userId || '');
            return id && !items.some((saved) => String(saved._id || saved.userId || '') === id) ? [...items, item] : items;
        }, []);
        const canonical = candidates.find((item) => String(item._id || item.userId || '') === String(user.userId)) || candidates[0];
        const userId = String(canonical?._id || canonical?.userId || user.userId || '');
        if (!userId)
            appError('INVALID_INPUT', '未取得用户身份');
        if ((canonical?.role === 'super_admin' || canonical?.role === 'teacher') && canonical?.status === 'ACTIVE')
            appError('FORBIDDEN', '当前账号不能注册为学生');
        step = 'MATCH_ROSTER';
        const roster = await context_1.db.collection(constants_1.C.roster).where({ archived: false }).limit(1000).get();
        const matches = roster.data.filter((item) => normalizeRosterMatch(item.name) === normalizeRosterMatch(name));
        if (matches.length === 0)
            appError('STUDENT_NOT_FOUND', '未找到对应学生信息，请检查姓名。');
        if (matches.length > 1)
            appError('STUDENT_DUPLICATE', '姓名存在重复，请联系教师处理');
        const rosterItem = matches[0];
        step = 'CHECK_BINDING';
        const grade = String(rosterItem.grade || '').trim();
        const className = regionOf(rosterItem) || region;
        if (rosterItem.boundUserId && rosterItem.boundUserId !== userId)
            appError('STUDENT_ALREADY_BOUND', '该学生信息已绑定其他微信账号。');
        const committedAt = (0, utils_1.now)();
        step = 'COMMIT';
        await context_1.db.runTransaction(async (transaction) => {
            step = 'WRITE_USER';
            await transaction.collection(constants_1.C.users).doc(userId).set({ data: withoutUndefined({
                    ...(canonical || {}), userId, openid, role: 'student', status: 'ACTIVE', name: rosterItem.name, grade,
                    className, rosterId: rosterItem._id, dataSpace: (0, utils_1.dataSpaceOf)(rosterItem), createdAt: canonical?.createdAt || committedAt, updatedAt: committedAt,
                }) });
            step = 'BIND_ROSTER';
            await transaction.collection(constants_1.C.roster).doc(rosterItem._id).update({ data: withoutUndefined({
                    boundUserId: userId, boundAt: committedAt, activatedAt: committedAt, updatedAt: committedAt,
                }) });
        });
        await (0, audit_1.audit)({ ...user, userId, role: 'student' }, 'STUDENT_ACTIVATED', 'student', userId, null, { grade, className }, true, requestId)
            .catch((auditError) => console.error('[registerStudent-audit-failed]', { requestId, errCode: auditError?.code || '', errMsg: safeDiagnostic(auditError?.message, 500) }));
        return ok({ status: 'ACTIVE' });
    }
    catch (error) {
        console.error('[registerStudent-failed]', { requestId, step, errCode: error?.code || error?.errCode || '', errMsg: safeDiagnostic(error?.message, 1000) });
        throw error;
    }
}
async function dispatch(action, event, user, requestId, openid) {
    switch (action) {
        case 'reviewSession': {
            const operation = String(event.operation || '');
            if (operation === 'status')
                return ok(await (0, auth_1.reviewSessionStatus)(openid));
            if (operation === 'open') {
                try {
                    return ok(await (0, auth_1.openReviewSession)(openid, event.accessCode, event.role));
                }
                catch (error) {
                    (0, audit_1.monitor)('appApi', 'REVIEW_SESSION_OPEN_FAILED', reviewOpenDiagnostics(error, requestId), true);
                    throw error;
                }
            }
            if (operation === 'switch')
                return ok(await (0, auth_1.switchReviewSession)(openid, event.role));
            if (operation === 'close')
                return ok(await (0, auth_1.closeReviewSession)(openid));
            appError('INVALID_INPUT', 'review session operation is invalid');
        }
        case 'bootstrap': {
            const clientConfig = await studentResultClientConfig();
            const bootstrapOk = (data) => ok({ ...data, clientConfig });
            if (!user)
                return bootstrapOk({ user: null, needsRegistration: true, accountStatus: 'UNREGISTERED' });
            if (user.role === 'super_admin' && user.status === 'ACTIVE') {
                return bootstrapOk({ user: (0, auth_1.publicUser)(user), needsRegistration: false, accountStatus: 'ACTIVE' });
            }
            const compatibleRole = user.role === 'admin' && user.status === 'ACTIVE' ? 'teacher' : user.role;
            const compatibleUser = compatibleRole === user.role ? user : { ...user, role: compatibleRole };
            const application = await currentTeacherApplication(user);
            const invalidReason = teacherApplicationInvalidReason(application, user, openid);
            if (compatibleUser.role === 'teacher' && compatibleUser.status === 'ACTIVE') {
                return bootstrapOk({ user: (0, auth_1.publicUser)(compatibleUser), needsRegistration: false, accountStatus: 'ACTIVE' });
            }
            if (compatibleUser.role === 'teacher' && compatibleUser.status === 'PENDING' && !invalidReason && application?.status === 'PENDING') {
                return bootstrapOk({ user: (0, auth_1.publicUser)(compatibleUser), needsRegistration: false, accountStatus: 'PENDING' });
            }
            if (compatibleUser.role === 'teacher' && compatibleUser.status === 'REJECTED') {
                return bootstrapOk({ user: (0, auth_1.publicUser)(compatibleUser), needsRegistration: false, accountStatus: 'REJECTED' });
            }
            if (compatibleUser.role === 'student' && compatibleUser.status === 'ACTIVE') {
                return bootstrapOk({ user: (0, auth_1.publicUser)(compatibleUser), needsRegistration: false, accountStatus: 'ACTIVE' });
            }
            return bootstrapOk({ user: null, needsRegistration: true, accountStatus: 'UNREGISTERED' });
        }
        case 'registerStudent':
            return submitStudentRegistration(event, user, requestId, openid);
        case 'registerTeacher':
            return submitTeacherApplication(event, user, requestId, openid);
        case 'home': {
            if (user.role === 'student') {
                const tasks = await context_1.db.collection(constants_1.C.tasks).where({ studentId: user.userId }).orderBy('createdAt', 'desc').limit(5).get();
                const all = await context_1.db.collection(constants_1.C.tasks).where({ studentId: user.userId }).limit(1000).get();
                const visibleTasks = all.data.filter((task) => (0, utils_1.dataSpaceOf)(task) === (0, utils_1.dataSpaceOf)(user));
                const visibleRecent = tasks.data.filter((task) => (0, utils_1.dataSpaceOf)(task) === (0, utils_1.dataSpaceOf)(user));
                const displayed = displayTasks(visibleTasks);
                const displayedById = new Map(displayed.map((task) => [String(task._id || task.taskId || ''), task]));
                const counts = visibleTasks.reduce((total, task) => {
                    total.uploaded += 1;
                    if (['QUEUED', 'CLAIMED', 'PROCESSING', 'NEED_CONFIRMATION'].includes(task.status))
                        total.processing += 1;
                    if (task.status === 'COMPLETED')
                        total.completed += 1;
                    if (task.status === 'FAILED')
                        total.failed += 1;
                    return total;
                }, { uploaded: 0, processing: 0, completed: 0, failed: 0 });
                const activeTask = visibleRecent.find((task) => ['QUEUED', 'CLAIMED', 'PROCESSING', 'NEED_CONFIRMATION'].includes(task.status)) || null;
                return ok({ user: await profileForStudent(user), recent: visibleRecent.map((task) => displayedById.get(String(task._id || task.taskId || '')) || task), stats: counts, activeTask: activeTask ? (displayedById.get(String(activeTask._id || activeTask.taskId || '')) || activeTask) : null });
            }
            if (['teacher', 'super_admin'].includes(user.role)) {
                const visibleStudents = await visibleRosterStudents(user, false);
                const boundStudentIds = new Set(visibleStudents.map((student) => String(student.boundUserId || '').trim()).filter(Boolean));
                const allTasks = await context_1.db.collection(constants_1.C.tasks).limit(1000).get();
                const tasks = (user.role === 'super_admin' ? allTasks.data : allTasks.data.filter((task) => boundStudentIds.has(String(task.studentId || '').trim()))).filter((task) => (0, utils_1.canAccessDataSpace)(user, task)).filter(reviewTaskFilter(user));
                const classKeys = new Set(visibleStudents.map((student) => (0, utils_1.scopeKey)(student.grade, regionOf(student))));
                const stats = tasks.reduce((total, task) => { total.total += 1; if (['QUEUED', 'CLAIMED', 'PROCESSING', 'VERIFYING', 'NEED_CONFIRMATION'].includes(task.status))
                    total.processing += 1; if (task.status === 'COMPLETED')
                    total.completed += 1; if (task.status === 'FAILED')
                    total.failed += 1; return total; }, { students: visibleStudents.length, classes: classKeys.size, total: 0, processing: 0, completed: 0, failed: 0 });
                const withModes = tasks.map((task) => ({ ...task, mode: taskModeForRead(task) }));
                return ok({ user: (0, auth_1.publicUser)(user), stats, recent: withModes.slice(0, 5), failed: withModes.filter((task) => task.status === 'FAILED').slice(0, 5) });
            }
            return ok({ user: (0, auth_1.publicUser)(user) });
        }
        case ['getMy', 'CheckinStats'].join(''): {
            (0, auth_1.requireActiveStudent)(user);
            let rows = (await context_1.db.collection(constants_1.C.checkins).where({ studentId: user.userId }).limit(1000).get()).data.filter((record) => (0, utils_1.dataSpaceOf)(record) === (0, utils_1.dataSpaceOf)(user));
            const tasks = (await context_1.db.collection(constants_1.C.tasks).where({ studentId: user.userId }).limit(1000).get()).data.filter((task) => (0, utils_1.dataSpaceOf)(task) === (0, utils_1.dataSpaceOf)(user));
            const dateKey = (0, utils_1.shanghaiDateKey)(new Date());
            rows = await reconcileTodayCheckin(user.userId, dateKey, rows, tasks, user);
            return ok(checkinStats(rows, dateKey, tasks));
        }
        case ['getCheckin', 'Overview'].join(''): {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const dateKey = (0, utils_1.shanghaiDateKey)(new Date());
            const grade = String(event.grade || '').trim(), className = regionOf(event);
            const students = (await visibleRosterStudents(user, false)).filter((x) => (!className || regionOf(x) === className) && (!grade || x.grade === grade));
            let rows = (await context_1.db.collection(constants_1.C.checkins).limit(1000).get()).data.filter((record) => (0, utils_1.canAccessDataSpace)(user, record));
            const tasks = (await context_1.db.collection(constants_1.C.tasks).limit(1000).get()).data.filter((task) => (0, utils_1.canAccessDataSpace)(user, task));
            for (const student of students) {
                const studentId = String(student.boundUserId || '').trim();
                if (studentId)
                    rows = await reconcileTodayCheckin(studentId, dateKey, rows, tasks.filter((task) => task.studentId === studentId), user);
            }
            const list = students.map((student) => { const studentId = String(student.boundUserId || '').trim(), mine = studentId ? rows.filter((record) => record.studentId === studentId) : [], mineTasks = studentId ? tasks.filter((task) => task.studentId === studentId) : [], stats = checkinStats(mine, dateKey, mineTasks), today = stats.today, todayRecord = (0, checkin_1.normalizeCheckinRecord)(mine.find((record) => record.dateKey === dateKey) || {}); return { rosterId: String(student._id || ''), studentId, name: student.name, grade: student.grade, className: regionOf(student), qualifiedQuestionCount: today.qualifiedQuestionCount, requiredQuestionCount: today.requiredQuestionCount, completed: today.completed, remainingCount: today.remainingCount, todayStatus: today.completed ? 'COMPLETED' : todayRecord.practiced ? 'IN_PROGRESS' : 'NOT_PRACTICED', practiceDays: stats.practiceDays, successfulCheckinDays: stats.successfulCheckinDays, answeredQuestionCount: stats.answeredQuestionCount, correctQuestionCount: stats.correctQuestionCount, accuracyRate: stats.accuracyRate, checkinRate: stats.checkinRate }; });
            const completedStudentCount = list.filter((x) => x.todayStatus === 'COMPLETED').length, practicedStudentCount = list.filter((x) => x.todayStatus !== 'NOT_PRACTICED').length;
            const checkedInToday = completedStudentCount, notCheckedInToday = Math.max(0, list.length - checkedInToday);
            const totals = list.reduce((sum, item) => ({ answered: sum.answered + item.answeredQuestionCount, correct: sum.correct + item.correctQuestionCount }), { answered: 0, correct: 0 });
            return ok({ studentTotal: list.length, checkedInToday, notCheckedInToday, practicedStudentCount, completedStudentCount, inProgressStudentCount: list.filter((x) => x.todayStatus === 'IN_PROGRESS').length, notPracticedStudentCount: list.length - practicedStudentCount, completionRate: list.length ? completedStudentCount / list.length : 0, answeredQuestionCount: totals.answered, correctQuestionCount: totals.correct, accuracyRate: totals.answered ? totals.correct / totals.answered : 0, students: list });
        }
        case ['getStudentCheckin', 'Stats'].join(''): {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const studentId = String(event.studentId || '').trim();
            if (!studentId)
                appError('INVALID_INPUT', 'studentId 无效');
            const student = (await context_1.db.collection(constants_1.C.roster).doc(studentId).get()).data;
            if (!student)
                appError('STUDENT_NOT_FOUND', '学生不存在');
            if (!(0, utils_1.canAccessDataSpace)(user, student) || (user.role === 'teacher' && !teacherOwnsRoster(user, student)))
                appError('FORBIDDEN', '没有权限');
            const boundStudentId = student.boundUserId || studentId;
            let rows = (await context_1.db.collection(constants_1.C.checkins).where({ studentId: boundStudentId }).limit(1000).get()).data.filter((record) => (0, utils_1.canAccessDataSpace)(user, record));
            const tasks = (await context_1.db.collection(constants_1.C.tasks).where({ studentId: boundStudentId }).limit(1000).get()).data.filter((task) => (0, utils_1.canAccessDataSpace)(user, task));
            const dateKey = (0, utils_1.shanghaiDateKey)(new Date());
            rows = await reconcileTodayCheckin(boundStudentId, dateKey, rows, tasks, user);
            return ok(checkinStats(rows, dateKey, tasks));
        }
        case 'createTask': {
            const createStartedAt = Date.now();
            (0, audit_1.monitor)('appApi', 'TASK_CREATE_REQUEST', { taskId: null, status: 'REQUESTED', stage: 'CREATE' });
            (0, auth_1.requireActiveStudent)(user);
            const mode = taskModeForCreate(event.mode);
            const carelessTrainingType = mode === 'CARELESS_TRAINING' ? (0, constants_1.normalizeCarelessTrainingType)(event.carelessTrainingType) : null;
            const hardProblemModelProvider = mode === 'HARD_PROBLEM_CHECK' ? await readHardProblemModelProvider() : null;
            let roster = null;
            if (user.rosterId) {
                roster = (await context_1.db.collection(constants_1.C.roster).doc(user.rosterId).get()).data;
                if (roster && (0, utils_1.dataSpaceOf)(roster) !== (0, utils_1.dataSpaceOf)(user))
                    appError('FORBIDDEN', '学生数据域不一致');
            }
            const dataSpace = roster ? (0, utils_1.dataSpaceOf)(roster) : (0, utils_1.dataSpaceOf)(user);
            const studentImageFileIds = Array.isArray(event.studentImageFileIds) ? event.studentImageFileIds.filter(Boolean) : [];
            const answerImageFileIds = mode === 'CARELESS_TRAINING' ? [] : (Array.isArray(event.answerImageFileIds) ? event.answerImageFileIds.filter(Boolean) : []);
            const manualAnswer = mode === 'CARELESS_TRAINING' ? '' : String(event.manualAnswer || '');
            const answerMode = mode === 'CARELESS_TRAINING' ? 'none' : String(event.answerMode || 'none');
            if (studentImageFileIds.length > 3 || answerImageFileIds.length > 3)
                appError('INVALID_IMAGE_COUNT', '作业和标准答案图片最多各3张');
            if (!studentImageFileIds.length || studentImageFileIds.length > 50)
                appError('INVALID_IMAGE_COUNT', '题目图片必须为1至50张');
            (0, audit_1.monitor)('appApi', 'TASK_CREATE_VALIDATED', { taskId: null, status: 'VALIDATED', stage: 'CREATE', imageCount: studentImageFileIds.length + answerImageFileIds.length });
            if (event.parentTaskId) {
                const parent = (await context_1.db.collection(constants_1.C.tasks).doc(event.parentTaskId).get()).data;
                if (!parent || parent.studentId !== user.userId || parent.status !== 'COMPLETED' || (0, utils_1.dataSpaceOf)(parent) !== dataSpace) {
                    appError('INVALID_PARENT_TASK', '订正任务无效');
                }
            }
            const taskId = (0, utils_1.randomId)('task');
            const createdAt = (0, utils_1.now)();
            const existingTasks = await context_1.db.collection(constants_1.C.tasks).where({ studentId: user.userId }).limit(1000).get();
            const taskDateKey = (0, utils_1.shanghaiDateKey)(createdAt);
            const sameDayCount = existingTasks.data.filter((item) => item.createdAt && (0, utils_1.shanghaiDateKey)(new Date(item.createdAt)) === taskDateKey).length;
            const dailySequence = sameDayCount + 1;
            const displayTitle = (0, task_title_1.automaticTaskTitle)(createdAt, dailySequence);
            const task = {
                taskId,
                taskName: displayTitle,
                title: displayTitle,
                displayTitle,
                taskDateKey,
                dailySequence,
                studentId: user.userId,
                studentName: user.name,
                grade: user.grade,
                className: regionOf(user),
                dataSpace,
                mode,
                modeVersion: 1,
                carelessTrainingType,
                ...(mode === 'HARD_PROBLEM_CHECK' ? { hardProblemModelProvider } : {}),
                status: 'QUEUED',
                progress: 2,
                currentStage: 'PREPARING_IMAGES',
                statusMessage: '任务已提交，正在启动批改',
                studentImageFileIds,
                answerImageFileIds,
                manualAnswer,
                answerMode,
                parentTaskId: event.parentTaskId || null,
                attempt: 0,
                leaseUntil: null,
                createdAt,
                updatedAt: createdAt,
            };
            const dispatch = await createTaskCoreFlow(taskId, task, { saveTask: (id, data) => context_1.db.collection(constants_1.C.tasks).doc(id).set({ data }), recordPractice: checkin_1.recordPractice, monitor: audit_1.monitor });
            (0, audit_1.monitor)('appApi', 'TASK_IMAGES_SAVED', { taskId, status: task.status, stage: task.currentStage, progress: task.progress, imageCount: studentImageFileIds.length + answerImageFileIds.length });
            void (0, audit_1.audit)(user, 'TASK_CREATED', 'task', taskId, null, {
                imageCount: studentImageFileIds.length,
                answerImageCount: answerImageFileIds.length,
            }).catch((error) => (0, audit_1.monitor)('appApi', 'TASK_AUDIT_FAILED', { taskId, errorCode: error?.code || 'TASK_AUDIT_FAILED' }, true));
            (0, audit_1.monitor)('appApi', 'TASK_CREATED', { taskId, status: task.status, stage: task.currentStage, progress: task.progress, imageCount: studentImageFileIds.length + answerImageFileIds.length, durationMs: Date.now() - createStartedAt });
            (0, audit_1.monitor)('appApi', 'TASK_QUEUED', { taskId, status: task.status, stage: task.currentStage, progress: task.progress, imageCount: studentImageFileIds.length + answerImageFileIds.length, durationMs: Date.now() - createStartedAt });
            return ok({ taskId, status: 'QUEUED', mode, ...(hardProblemModelProvider ? { hardProblemModelProvider } : {}), dispatchStatus: dispatch.dispatchStatus, taskDateKey, dailySequence, createdAt, displayTitle });
        }
        case 'updateProfile': {
            (0, auth_1.requireActiveStudent)(user);
            const name = String(event.name || '').trim();
            const grade = '';
            const className = regionOf(event);
            if (!name || !className)
                appError('INVALID_INPUT', '请完整填写姓名和地区');
            await context_1.db.collection(constants_1.C.users).doc(user.userId).update({ data: { name, grade, className, updatedAt: (0, utils_1.now)() } });
            await (0, audit_1.audit)(user, 'STUDENT_PROFILE_UPDATED', 'student', user.userId, null, { grade, className });
            const updated = { ...user, name, grade, className };
            return ok(await profileForStudent(updated));
        }
        case 'latestCompletedTask': {
            (0, auth_1.requireActiveStudent)(user);
            try {
                const response = await context_1.db.collection(constants_1.C.tasks)
                    .where({ studentId: user.userId, status: 'COMPLETED' })
                    .limit(1000)
                    .get();
                const task = response.data.filter(taskHasReadyResult).filter((item) => (0, utils_1.dataSpaceOf)(item) === (0, utils_1.dataSpaceOf)(user)).sort((left, right) => {
                    const leftTime = new Date(left.completedAt || left.updatedAt || left.createdAt || 0).getTime();
                    const rightTime = new Date(right.completedAt || right.updatedAt || right.createdAt || 0).getTime();
                    return rightTime - leftTime;
                })[0];
                if (!task)
                    return ok(latestCompletedTaskPayload(null, null));
                let result = null;
                try {
                    const resultId = String(task.resultId || '');
                    result = resultId ? (await context_1.db.collection(constants_1.C.results).doc(resultId).get()).data : null;
                    if (result && (result.taskId !== task._id || result.studentId !== user.userId || (0, utils_1.dataSpaceOf)(result) !== (0, utils_1.dataSpaceOf)(task)))
                        result = null;
                }
                catch (error) {
                    if (!/not found|does not exist|document/i.test(String(error?.message || '')))
                        throw error;
                }
                return ok(latestCompletedTaskPayload(task, result));
            }
            catch (error) {
                if (error?.code)
                    throw error;
                appError('DATABASE_ERROR', '结果数据读取失败');
            }
        }
        case 'listCompletedTasks': {
            const limit = Math.max(1, Math.min(50, Number(event.limit || 20)));
            const tasks = displayTasks(await visibleStudentTasks(user)).filter(taskHasReadyResult).sort((left, right) => new Date(right.completedAt || right.updatedAt || right.createdAt || 0).getTime() - new Date(left.completedAt || left.updatedAt || left.createdAt || 0).getTime()).slice(0, limit);
            const resultsById = await resultsForTasks(tasks, user);
            const summaries = tasks.map((task) => {
                const result = resultsById.get(String(task.resultId || ''));
                return completedTaskSummary(task, result?.taskId === task._id && result?.studentId === task.studentId ? result : null);
            });
            return ok({ tasks: summaries });
        }
        case 'getTaskStatus': {
            const task = (await context_1.db.collection(constants_1.C.tasks).doc(event.taskId).get()).data;
            await assertTaskViewerAccess(task, user, event, true);
            return ok({
                taskId: String(task._id || task.taskId || event.taskId || ''),
                status: String(task.status || ''),
                currentStage: String(task.currentStage || ''),
                stage: String(task.currentStage || ''),
                progress: Number(task.progress || 0),
                statusMessage: String(task.statusMessage || ''),
                errorCode: String(task.errorCode || ''),
                errorMessage: String(task.errorMessage || ''),
                resultId: String(task.resultId || ''),
                audioNarrationStatus: String(task.voiceStatus || task.audioNarrationStatus || 'PENDING'),
                createdAt: task.createdAt || null,
                updatedAt: task.updatedAt || null,
            });
        }
        case 'getTask': {
            let task = (await context_1.db.collection(constants_1.C.tasks).doc(event.taskId).get()).data;
            await assertTaskViewerAccess(task, user, event);
            if (task?.status === 'COMPLETED' && !task.resultId) {
                const repairedAt = (0, utils_1.now)();
                const repair = {
                    status: 'FAILED',
                    currentStage: 'FAILED',
                    failedStage: task.currentStage || 'FINALIZING_RESULT',
                    errorCode: 'TASK_RESULT_NOT_READY',
                    errorMessage: '批改结果未完整保存',
                    errorSuggestion: '请点击重新提交，系统会继续处理原任务',
                    retryable: true,
                    failureCategory: 'system',
                    workerStatus: 'FAILED',
                    workerQueueStatus: 'FAILED',
                    workerQueueError: 'TASK_RESULT_NOT_READY',
                    workerNextDispatchAt: null,
                    workerLeaseOwner: null,
                    workerLeaseUntil: null,
                    updatedAt: repairedAt,
                };
                await context_1.db.collection(constants_1.C.tasks).doc(event.taskId).update({ data: repair });
                task = { ...task, ...repair };
                (0, audit_1.monitor)('appApi', 'TASK_FALSE_COMPLETION_REPAIRED', { taskId: String(task._id || task.taskId || event.taskId), errorCode: repair.errorCode }, true);
            }
            if (task && canKickTask(task)) {
                const taskId = String(task._id || task.taskId || event.taskId);
                let kickTimer;
                try {
                    await Promise.race([
                        kickTaskIfEligible(taskId),
                        new Promise((_, reject) => { kickTimer = setTimeout(() => reject(Object.assign(new Error('kick timeout'), { code: 'GRADING_WORKER_TIMEOUT' })), 5000); })
                    ]);
                }
                catch (error) {
                    await context_1.db.collection(constants_1.C.tasks).doc(taskId).update({ data: { workerQueueError: String(error?.code || 'GRADING_WORKER_KICK_FAILED').slice(0, 120), workerNextDispatchAt: new Date(Date.now() + 15000), updatedAt: (0, utils_1.now)() } }).catch(() => {});
                }
                finally { clearTimeout(kickTimer); }
            }
            const studentTasks = user.role === 'student' ? await context_1.db.collection(constants_1.C.tasks).where({ studentId: user.userId }).limit(1000).get() : null;
            if (studentTasks)
                studentTasks.data = studentTasks.data.filter((item) => (0, utils_1.dataSpaceOf)(item) === (0, utils_1.dataSpaceOf)(user));
            const displayedTask = studentTasks ? displayTasks(studentTasks.data).find((item) => String(item._id || item.taskId || '') === String(task?._id || task?.taskId || '')) || task : task;
            const full = await taskWithUrls(displayedTask, user);
            full.task = {
                ...full.task,
                manualAnswer: String(task.manualAnswer || ''),
                answerImageFileIds: Array.isArray(task.answerImageFileIds) ? task.answerImageFileIds : [],
                answerMode: String(task.answerMode || 'none'),
            };
            if (task.status === 'NEED_CONFIRMATION') {
                full.task = {
                    ...full.task,
                    confirmationPayload: task.confirmationPayload || null,
                    referenceAnswers: Array.isArray(task.referenceAnswers) ? task.referenceAnswers : [],
                };
            }
            if (taskHasReadyResult(task)) {
                try {
                    const result = (await context_1.db.collection(constants_1.C.results).doc(task.resultId).get()).data;
                    if (result?.taskId === task._id && result?.studentId === task.studentId && (0, utils_1.dataSpaceOf)(result) === (0, utils_1.dataSpaceOf)(task))
                        full.result = await resultWithAudioNarration(result);
                }
                catch { }
            }
            const finalQuestions = Array.isArray(full.result?.questions) ? full.result.questions : [];
            const effectiveQuestionCount = finalQuestions.length || Number(full.result?.summary?.totalCount || 0) || Number(full.result?.summary?.questionCount || 0) || Number(task.questionCount || 0) || 0;
            full.task.questionCount = effectiveQuestionCount;
            if (full.result)
                full.result.effectiveQuestionCount = effectiveQuestionCount;
            return ok(full);
        }
        case 'updateTaskAnswers': {
            const task = (await context_1.db.collection(constants_1.C.tasks).doc(event.taskId).get()).data;
            if (!task)
                appError('TASK_NOT_FOUND', '任务不存在');
            if (task.studentId !== user.userId || (0, utils_1.dataSpaceOf)(task) !== (0, utils_1.dataSpaceOf)(user))
                appError('FORBIDDEN', '没有权限');
            if (task.mode === 'CARELESS_TRAINING')
                appError('CARELESS_TRAINING_DOES_NOT_REQUIRE_ANSWER', '马虎训练不需要标准答案确认');
            if (task.status !== 'NEED_CONFIRMATION')
                appError('INVALID_STATUS', '当前任务不需要确认');
            const answerImageFileIds = Array.isArray(event.answerImageFileIds) ? event.answerImageFileIds.filter(Boolean) : [];
            const manualAnswer = String(event.manualAnswer || '').trim();
            if (!manualAnswer && !answerImageFileIds.length)
                appError('INVALID_INPUT', '请填写正确答案或上传答案图片');
            await removeAnswerExtractions(task._id);
            await context_1.db.collection(constants_1.C.tasks).doc(task._id).update({ data: {
                    manualAnswer,
                    answerImageFileIds,
                    answerMode: String(event.answerMode || 'none'),
                    confirmation: event.confirmation || null,
                    status: 'QUEUED',
                    progress: 25,
                    currentStage: 'PRIMARY_GRADING',
                    statusMessage: '答案已更新，正在继续批改',
                    confirmationPayload: null,
                    answerBatchCursor: 0,
                    answerBatchTotal: null,
                    primaryDraft: null,
                    reviewDraft: null,
                    mergedDraft: null,
                    primaryTransportAttempt: 0,
                    reviewTransportAttempt: 0,
                    leaseOwner: null,
                    leaseUntil: null,
                    errorCode: null,
                    errorMessage: null,
                    errorSuggestion: null,
                    failedStage: null,
                    updatedAt: (0, utils_1.now)(),
                } });
            const dispatchStatus = await dispatchTask(String(task._id), 'answers_updated');
            await (0, audit_1.audit)(user, 'TASK_ANSWERS_UPDATED', 'task', task._id, null, { answerImageCount: answerImageFileIds.length });
            return ok({ taskId: task._id, status: 'QUEUED', dispatchStatus, manualAnswer, answerImageFileIds, answerMode: String(event.answerMode || 'none') });
        }
        case 'resolveConfirmation': {
            const task = (await context_1.db.collection(constants_1.C.tasks).doc(event.taskId).get()).data;
            if (!task)
                appError('TASK_NOT_FOUND', '任务不存在');
            if (task.studentId !== user.userId)
                (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            await assertTaskAccess(task, user);
            if (task.mode === 'CARELESS_TRAINING')
                appError('CARELESS_TRAINING_DOES_NOT_REQUIRE_ANSWER', '马虎训练不需要标准答案确认');
            if (task.status !== 'NEED_CONFIRMATION')
                appError('INVALID_STATUS', '当前任务不需要确认');
            const resumeStage = task.primaryDraft
                ? (task.reviewDraft && task.mergedDraft ? 'FINALIZING_RESULT' : 'REVIEW_GRADING')
                : 'PRIMARY_GRADING';
            const resumeProgress = resumeStage === 'FINALIZING_RESULT' ? 85 : resumeStage === 'REVIEW_GRADING' ? 60 : 25;
            await context_1.db.collection(constants_1.C.tasks).doc(task._id).update({ data: {
                    confirmation: event.confirmation,
                    status: 'QUEUED',
                    progress: resumeProgress,
                    currentStage: resumeStage,
                    statusMessage: '已确认，正在继续批改',
                    confirmationPayload: null,
                    leaseOwner: null,
                    leaseUntil: null,
                    errorCode: null,
                    errorMessage: null,
                    errorSuggestion: null,
                    failedStage: null,
                    updatedAt: (0, utils_1.now)(),
                } });
            const dispatchStatus = await dispatchTask(String(task._id), 'confirmation_resolved');
            await (0, audit_1.audit)(user, 'TASK_CONFIRMATION_RESOLVED', 'task', task._id, null, event.confirmation);
            return ok({ taskId: task._id, status: 'QUEUED', dispatchStatus });
        }
        case ['resumeCareless', 'Training'].join(''): {
            const task = (await context_1.db.collection(constants_1.C.tasks).doc(event.taskId).get()).data;
            if (!task)
                appError('TASK_NOT_FOUND', '任务不存在');
            if (task.studentId !== user.userId || (0, utils_1.dataSpaceOf)(task) !== (0, utils_1.dataSpaceOf)(user))
                appError('FORBIDDEN', '没有权限');
            if (task.mode !== 'CARELESS_TRAINING' || task.status !== 'NEED_CONFIRMATION')
                appError('INVALID_STATUS', '当前任务无需恢复三格识别');
            await context_1.db.collection(constants_1.C.tasks).doc(task._id).update({ data: { confirmation: null, confirmationPayload: null, errorCode: null, errorMessage: null, errorDetail: null, errorSuggestion: null, failedStage: null, leaseOwner: null, leaseUntil: null, answerImageFileIds: [], manualAnswer: '', answerMode: 'none', primaryDraft: null, reviewDraft: null, mergedDraft: null, primaryTransportAttempt: 0, reviewTransportAttempt: 0, status: 'QUEUED', currentStage: 'PRIMARY_GRADING', progress: 25, statusMessage: '正在恢复三格识别', updatedAt: (0, utils_1.now)() } });
            const dispatchStatus = await dispatchTask(String(task._id), 'careless_training_resumed');
            return ok({ taskId: task._id, status: 'QUEUED', dispatchStatus, mode: 'CARELESS_TRAINING' });
        }
        case 'startHardProblemTraining':
            return ok(await runHardProblemTrainingAction(action, getHardProblemTrainingService().start, event, user, requestId));
        case 'submitHardProblemExplanation':
            return ok(await runHardProblemTrainingAction(action, getHardProblemTrainingService().submitExplanation, event, user, requestId));
        case 'submitHardProblemRetell':
            return ok(await runHardProblemTrainingAction(action, getHardProblemTrainingService().submitRetell, event, user, requestId));
        case 'submitHardProblemVariant':
            return ok(await runHardProblemTrainingAction(action, getHardProblemTrainingService().submitVariant, event, user, requestId));
        case 'getHardProblemReview':
            return ok(await runHardProblemTrainingAction(action, getHardProblemTrainingService().getReview, event, user, requestId));
        case 'submitHardProblemReview':
            return ok(await runHardProblemTrainingAction(action, getHardProblemTrainingService().submitReview, event, user, requestId));
        case 'history': {
            const limit = Math.max(1, Math.min(100, Number(event.limit || 50)));
            const sourceTasks = displayTasks(await visibleStudentTasks(user)).sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()).slice(0, limit);
            const resultsById = await resultsForTasks(sourceTasks, user);
            const tasks = sourceTasks.map((task) => {
                const result = resultsById.get(String(task.resultId || ''));
                return {
                    ...task,
                    ...completedTaskSummary(task, result?.taskId === task._id && result?.studentId === task.studentId ? result : null),
                };
            });
            return ok(tasks);
        }
        case 'managerClassSummaries': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const mode = String(event.mode || '');
            if (!['history', 'result'].includes(mode))
                appError('INVALID_INPUT', 'mode 必须为 history 或 result');
            const rosterResponse = await context_1.db.collection(constants_1.C.roster).where({ archived: false }).limit(1000).get();
            const roster = (user.role === 'super_admin' ? rosterResponse.data : rosterResponse.data.filter((student) => teacherOwnsRoster(user, student))).filter((student) => (0, utils_1.canAccessDataSpace)(user, student)).filter(reviewRosterFilter(user));
            const boundUserIds = new Set(roster.map((student) => String(student.boundUserId || '').trim()).filter(Boolean));
            const taskResponse = await context_1.db.collection(constants_1.C.tasks).limit(1000).get();
            const wrongResponse = boundUserIds.size ? await context_1.db.collection(constants_1.C.wrong).limit(1000).get() : { data: [] };
            const tasksByStudent = new Map();
            const classByStudent = new Map();
            for (const student of roster)
                classByStudent.set(String(student.boundUserId || '').trim(), regionOf(student));
            for (const task of taskResponse.data) {
                const studentId = String(task.studentId || '').trim();
                if (!boundUserIds.has(studentId) || !(0, utils_1.canAccessDataSpace)(user, task))
                    continue;
                tasksByStudent.set(studentId, [...(tasksByStudent.get(studentId) || []), task]);
            }
            const summaries = new Map();
            for (const student of roster) {
                const key = regionOf(student);
                const summary = summaries.get(key) || { grade: '', className: key, region: key, studentCount: 0, taskCount: 0, processingCount: 0, completedCount: 0, wrongCount: 0, failedCount: 0 };
                summary.studentCount += 1;
                for (const task of tasksByStudent.get(String(student.boundUserId || '').trim()) || []) {
                    summary.taskCount += 1;
                    if (['QUEUED', 'CLAIMED', 'PROCESSING', 'VERIFYING', 'NEED_CONFIRMATION'].includes(task.status))
                        summary.processingCount += 1;
                    if (task.status === 'COMPLETED')
                        summary.completedCount += 1;
                    if (task.status === 'FAILED')
                        summary.failedCount += 1;
                }
                summaries.set(key, summary);
            }
            for (const wrong of wrongResponse.data) {
                if (wrong.mastered === true || !(0, utils_1.canAccessDataSpace)(user, wrong))
                    continue;
                const key = classByStudent.get(String(wrong.studentId || '').trim());
                const summary = key ? summaries.get(key) : null;
                if (summary)
                    summary.wrongCount += 1;
            }
            const classes = [...summaries.values()].sort((left, right) => left.className.localeCompare(right.className, 'zh-CN', { numeric: true }));
            return ok({ mode, classes });
        }
        case 'managerClassDashboard': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const grade = String(event.grade || '').trim();
            const className = regionOf(event);
            const rosterResponse = await context_1.db.collection(constants_1.C.roster).where({ archived: false }).limit(1000).get();
            const roster = rosterResponse.data.filter((student) => (0, utils_1.canAccessDataSpace)(user, student) && reviewRosterFilter(user)(student) && (!className || regionOf(student) === className) && (user.role === 'super_admin' || teacherOwnsRoster(user, student)));
            const boundUserIds = new Set(roster.map((student) => String(student.boundUserId || '').trim()).filter(Boolean));
            const studentNames = new Map(roster.map((student) => [String(student.boundUserId || '').trim(), String(student.name || '')]));
            const taskResponse = boundUserIds.size ? await context_1.db.collection(constants_1.C.tasks).limit(1000).get() : { data: [] };
            const tasks = taskResponse.data.filter((task) => boundUserIds.has(String(task.studentId || '').trim()) && (0, utils_1.canAccessDataSpace)(user, task));
            const wrongResponse = boundUserIds.size ? await context_1.db.collection(constants_1.C.wrong).limit(1000).get() : { data: [] };
            const activeWrongQuestions = wrongResponse.data
                .filter((wrong) => boundUserIds.has(String(wrong.studentId || '').trim()) && wrong.mastered !== true && (0, utils_1.canAccessDataSpace)(user, wrong))
                .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime());
            const wrongQuestions = activeWrongQuestions.slice(0, 50)
                .map((wrong) => ({ taskId: String(wrong.taskId || ''), studentName: studentNames.get(String(wrong.studentId || '').trim()) || '', sourceKey: String(wrong.sourceKey || ''), questionText: String(wrong.questionText || ''), errorReason: String(wrong.errorReason || ''), knowledgePoint: String(wrong.knowledgePoint || ''), updatedAt: wrong.updatedAt || wrong.createdAt || null }));
            const classSummary = tasks.reduce((summary, task) => {
                summary.taskCount += 1;
                if (['QUEUED', 'CLAIMED', 'PROCESSING', 'VERIFYING', 'NEED_CONFIRMATION'].includes(task.status))
                    summary.processingCount += 1;
                if (task.status === 'COMPLETED')
                    summary.completedCount += 1;
                if (task.status === 'FAILED')
                    summary.failedCount += 1;
                return summary;
            }, { grade: '', className, region: className, studentCount: roster.length, taskCount: 0, processingCount: 0, completedCount: 0, wrongCount: activeWrongQuestions.length, failedCount: 0 });
            const recentSubmissions = displayTasks(tasks).sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()).slice(0, 5).map((task) => ({ taskId: String(task._id || task.taskId || ''), studentId: String(task.studentId || '').trim(), title: String(task.displayTitle || task.title || '未命名作业'), displayTitle: String(task.displayTitle || task.title || '未命名作业'), studentName: studentNames.get(String(task.studentId || '').trim()) || String(task.studentName || ''), status: String(task.status || ''), mode: taskModeForRead(task), createdAt: task.createdAt || null }));
            return ok({ classSummary, recentSubmissions, wrongQuestions, classes: className || grade ? undefined : [{ ...classSummary }] });
        }
        case 'managerClassStudents': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const grade = String(event.grade || '').trim();
            const className = regionOf(event);
            const mode = String(event.mode || '');
            if (!['history', 'result'].includes(mode))
                appError('INVALID_INPUT', 'mode 无效');
            const rosterResponse = await context_1.db.collection(constants_1.C.roster).where({ archived: false }).limit(1000).get();
            rosterResponse.data = rosterResponse.data.filter((student) => (0, utils_1.canAccessDataSpace)(user, student) && reviewRosterFilter(user)(student) && (!className || regionOf(student) === className) && (!grade || String(student.grade || '') === grade) && (user.role === 'super_admin' || teacherOwnsRoster(user, student)));
            const boundUserIds = new Set(rosterResponse.data.map((student) => String(student.boundUserId || '').trim()).filter(Boolean));
            const taskResponse = boundUserIds.size ? await context_1.db.collection(constants_1.C.tasks).limit(1000).get() : { data: [] };
            const resultResponse = boundUserIds.size ? await context_1.db.collection(constants_1.C.results).limit(1000).get() : { data: [] };
            const checkinResponse = boundUserIds.size ? await context_1.db.collection(constants_1.C.checkins).where({ dateKey: (0, utils_1.shanghaiDateKey)(new Date()) }).limit(1000).get() : { data: [] };
            const tasksByStudent = new Map();
            for (const task of taskResponse.data) {
                const studentId = String(task.studentId || '').trim();
                if (!boundUserIds.has(studentId) || !(0, utils_1.canAccessDataSpace)(user, task))
                    continue;
                tasksByStudent.set(studentId, [...(tasksByStudent.get(studentId) || []), task]);
            }
            const resultsByStudent = new Map();
            for (const result of resultResponse.data) {
                const studentId = String(result.studentId || '').trim();
                if (!boundUserIds.has(studentId) || !(0, utils_1.canAccessDataSpace)(user, result))
                    continue;
                resultsByStudent.set(studentId, [...(resultsByStudent.get(studentId) || []), result]);
            }
            const checkinsByStudent = new Map();
            for (const record of checkinResponse.data) {
                const studentId = String(record.studentId || '').trim();
                if (boundUserIds.has(studentId) && (0, utils_1.canAccessDataSpace)(user, record))
                    checkinsByStudent.set(studentId, (0, checkin_1.normalizeCheckinRecord)(record));
            }
            const students = rosterResponse.data.map((student) => {
                const extra = student.extraFields || {};
                const studentNumber = String(student.studentNumber || student.studentNo || extra['学号'] || extra.studentNumber || extra.studentNo || extra.studentIdNumber || '').trim();
                const studentId = String(student.boundUserId || '').trim();
                const tasks = tasksByStudent.get(studentId) || [];
                const completedQuestionCount = (resultsByStudent.get(studentId) || []).reduce((total, result) => {
                    const summaryCount = Number(result?.summary?.totalCount);
                    return total + (Number.isFinite(summaryCount) ? Math.max(0, summaryCount) : Array.isArray(result?.questions) ? result.questions.length : 0);
                }, 0);
                const today = checkinsByStudent.get(studentId);
                const todayStatus = today?.completed ? 'COMPLETED' : today?.practiced ? 'IN_PROGRESS' : 'NOT_PRACTICED';
                return { rosterId: String(student._id || ''), name: String(student.name || ''), region: regionOf(student), studentNumber, taskCount: tasks.length, completedCount: tasks.filter((task) => task.status === 'COMPLETED').length, completedQuestionCount, todayStatus, failedCount: tasks.filter((task) => task.status === 'FAILED').length };
            }).sort((left, right) => {
                return left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
            });
            return ok({ mode, grade, className, region: className, students });
        }
        case 'managerStudentTasks': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const rosterId = String(event.rosterId || '').trim();
            const mode = String(event.mode || '');
            if (!rosterId || !['history', 'result'].includes(mode))
                appError('INVALID_INPUT', 'rosterId 和 mode 无效');
            let roster = null;
            try {
                roster = (await context_1.db.collection(constants_1.C.roster).doc(rosterId).get()).data;
            }
            catch (error) {
                if (isDocumentNotFound(error))
                    appError('STUDENT_NOT_FOUND', '学生不存在');
                throw error;
            }
            if (!roster || roster.archived === true || !(0, utils_1.canAccessDataSpace)(user, roster) || !reviewRosterFilter(user)(roster))
                appError('STUDENT_NOT_FOUND', '学生不存在');
            if (user.role === 'teacher' && !teacherOwnsRoster(user, roster))
                appError('FORBIDDEN', '没有权限');
            const boundUserId = String(roster.boundUserId || '').trim();
            const allTasks = boundUserId ? (await context_1.db.collection(constants_1.C.tasks).where({ studentId: boundUserId }).limit(1000).get()).data.filter((task) => (0, utils_1.canAccessDataSpace)(user, task)) : [];
            const displayed = displayTasks(allTasks).sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime() || String(right._id || right.taskId || '').localeCompare(String(left._id || left.taskId || '')));
            const resultsById = await resultsForTasks(displayed, user);
            const taskCount = displayed.length;
            const student = { rosterId: String(roster._id || rosterId), studentId: boundUserId, name: String(roster.name || ''), studentNumber: rosterStudentNumber(roster), taskCount, completedCount: displayed.filter(taskHasReadyResult).length, failedCount: displayed.filter((task) => task.status === 'FAILED').length };
            const taskViews = (mode === 'result' ? displayed.filter(taskHasReadyResult) : displayed).map((task) => {
                const result = resultsById.get(String(task.resultId || ''));
                const validResult = result?.taskId === task._id && result?.studentId === boundUserId && (0, utils_1.dataSpaceOf)(result) === (0, utils_1.dataSpaceOf)(task) ? result : null;
                return {
                    ...completedTaskSummary(task, validResult),
                    taskDateKey: taskDateKey(task),
                    statusMessage: String(task.statusMessage || ''),
                    failureId: String(task.failureId || ''),
                    errorMessage: String(task.errorMessage || ''),
                    errorSuggestion: String(task.errorSuggestion || ''),
                    retryable: task.retryable !== false,
                };
            });
            return ok({ mode, student, tasks: taskViews });
        }
        case 'wrongQuestions': {
            (0, auth_1.requireActiveStudent)(user);
            const result = await context_1.db.collection(constants_1.C.wrong).where({ studentId: user.userId }).orderBy('updatedAt', 'desc').limit(100).get();
            return ok(result.data.filter((item) => (0, utils_1.dataSpaceOf)(item) === (0, utils_1.dataSpaceOf)(user)));
        }
        case 'listStudents': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const where = { archived: Boolean(event.archived) };
            const region = regionOf(event);
            const response = await context_1.db.collection(constants_1.C.roster).where(where).limit(1000).get();
            const items = response.data
                .filter((item) => reviewRosterFilter(user)(item))
                .filter((item) => (0, utils_1.canAccessDataSpace)(user, item))
                .filter((item) => user.role !== 'teacher' || teacherOwnsRoster(user, item))
                .filter((item) => !event.grade || item.grade === String(event.grade).trim())
                .filter((item) => !region || regionOf(item) === region)
                .map((item) => ({ ...item, region: regionOf(item) }));
            return ok(items);
        }
        case 'duplicateStudentRequests': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const response = await context_1.db.collection(constants_1.C.users).where({ role: 'student', status: 'DUPLICATE_REVIEW' }).limit(200).get();
            const requests = [];
            for (const request of response.data) {
                if (!(0, utils_1.canAccessDataSpace)(user, request) || !(0, utils_1.hasScope)(user, request.grade, regionOf(request)))
                    continue;
                const candidates = await context_1.db.collection(constants_1.C.roster).where({
                    normalizedName: (0, utils_1.normalizeName)(request.name),
                    grade: request.grade,
                    className: regionOf(request),
                    region: regionOf(request),
                    archived: false,
                }).limit(50).get();
                const visibleCandidates = (user.role === 'super_admin' ? candidates.data : candidates.data.filter((candidate) => teacherOwnsRoster(user, candidate))).filter((candidate) => (0, utils_1.canAccessDataSpace)(user, candidate));
                if (!visibleCandidates.length)
                    continue;
                requests.push({
                    userId: request.userId || request._id,
                    name: request.name,
                    grade: request.grade,
                    className: request.className,
                    createdAt: request.updatedAt || request.createdAt,
                    candidates: visibleCandidates.map((candidate) => ({
                        _id: candidate._id,
                        name: candidate.name,
                        grade: candidate.grade,
                        className: regionOf(candidate),
                        region: regionOf(candidate),
                        extraFields: candidate.extraFields || {},
                        alreadyBound: Boolean(candidate.boundUserId && candidate.boundUserId !== request.userId),
                    })),
                });
            }
            return ok(requests);
        }
        case 'bindDuplicateStudent': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const target = (await context_1.db.collection(constants_1.C.users).doc(event.userId).get()).data;
            if (!target || target.role !== 'student' || target.status !== 'DUPLICATE_REVIEW') {
                appError('DUPLICATE_REQUEST_NOT_FOUND', '同名学生确认请求不存在');
            }
            if (!(0, utils_1.hasScope)(user, target.grade, regionOf(target)))
                appError('FORBIDDEN', '没有权限');
            const roster = (await context_1.db.collection(constants_1.C.roster).doc(event.rosterId).get()).data;
            if (!roster || roster.archived || !(0, utils_1.canAccessDataSpace)(user, roster) || !teacherOwnsRoster(user, roster) || (0, utils_1.normalizeName)(roster.name) !== (0, utils_1.normalizeName)(target.name)
                || roster.grade !== target.grade || roster.className !== target.className) {
                appError('DUPLICATE_CANDIDATE_INVALID', '所选学生名单与注册信息不匹配');
            }
            if (roster.boundUserId && roster.boundUserId !== target.userId)
                appError('ROSTER_BOUND', '该学生名单已绑定其他微信');
            await context_1.db.runTransaction(async (transaction) => {
                await transaction.collection(constants_1.C.roster).doc(roster._id).update({ data: {
                        boundUserId: target.userId,
                        activatedAt: (0, utils_1.now)(),
                        updatedAt: (0, utils_1.now)(),
                    } });
                await transaction.collection(constants_1.C.users).doc(target.userId).update({ data: {
                        status: 'ACTIVE',
                        rosterId: roster._id,
                        dataSpace: (0, utils_1.dataSpaceOf)(roster),
                        updatedAt: (0, utils_1.now)(),
                    } });
            });
            await (0, audit_1.audit)(user, 'DUPLICATE_STUDENT_BOUND', 'student', target.userId, null, {
                rosterId: roster._id,
                grade: target.grade,
                className: target.className,
            });
            return ok({ activated: true });
        }
        case 'getStudent': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const student = (await context_1.db.collection(constants_1.C.roster).doc(event.studentId).get()).data;
            if (!student)
                appError('STUDENT_NOT_FOUND', '学生不存在');
            if (!(0, utils_1.canAccessDataSpace)(user, student) || !teacherOwnsRoster(user, student))
                appError('FORBIDDEN', '没有权限');
            return ok({ ...student, region: regionOf(student) });
        }
        case 'createStudent': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const importerId = currentManagerId(user);
            if (!importerId)
                appError('FORBIDDEN', '当前账号缺少有效用户编号');
            const fields = assertStudentFields(event.student || {});
            await ensureClass(fields.grade, fields.className);
            const id = (0, utils_1.randomId)('stu');
            const doc = {
                ...fields,
                normalizedName: (0, utils_1.normalizeName)(fields.name),
                extraFields: event.student?.extraFields || {},
                ownerTeacherId: importerId,
                dataSpace: user?._realRole === 'developer_admin' ? 'developer_test' : 'production',
                archived: false,
                createdAt: (0, utils_1.now)(),
                updatedAt: (0, utils_1.now)(),
            };
            await context_1.db.collection(constants_1.C.roster).doc(id).set({ data: doc });
            await (0, audit_1.audit)(user, 'STUDENT_CREATED', 'student', id, null, doc);
            return ok({ _id: id, ...doc });
        }
        case 'updateStudent': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const ref = context_1.db.collection(constants_1.C.roster).doc(event.studentId);
            const before = (await ref.get()).data;
            if (!before)
                appError('STUDENT_NOT_FOUND', '学生不存在');
            if (!(0, utils_1.canAccessDataSpace)(user, before) || !teacherOwnsRoster(user, before))
                appError('FORBIDDEN', '没有权限');
            const source = event.patch || {};
            const next = {
                name: source.name === undefined ? before.name : String(source.name).trim(),
                grade: source.grade === undefined ? before.grade : String(source.grade).trim(),
                className: source.region === undefined && source.className === undefined ? regionOf(before) : String(source.region || source.className).trim(),
                extraFields: source.extraFields === undefined ? before.extraFields || {} : source.extraFields,
            };
            assertStudentFields(next);
            if (!(0, utils_1.hasScope)(user, next.grade, regionOf(next)))
                appError('FORBIDDEN', '不能移入无权管理的地区');
            await ensureClass(next.grade, next.className);
            await ref.update({ data: {
                    ...next,
                    normalizedName: (0, utils_1.normalizeName)(next.name),
                    updatedAt: (0, utils_1.now)(),
                } });
            if (before.boundUserId) {
                await context_1.db.collection(constants_1.C.users).doc(before.boundUserId).update({ data: {
                        name: next.name,
                        grade: next.grade,
                        className: next.className,
                        updatedAt: (0, utils_1.now)(),
                    } });
            }
            await (0, audit_1.audit)(user, 'STUDENT_UPDATED', 'student', event.studentId, before, next);
            return ok({ updated: true });
        }
        case 'archiveStudent': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const ref = context_1.db.collection(constants_1.C.roster).doc(event.studentId);
            const before = (await ref.get()).data;
            if (!before)
                appError('STUDENT_NOT_FOUND', '学生不存在');
            if (!(0, utils_1.canAccessDataSpace)(user, before) || !teacherOwnsRoster(user, before))
                appError('FORBIDDEN', '没有权限');
            if (before.archived)
                return ok({ purgeAt: before.purgeAt });
            const archivedAt = (0, utils_1.now)();
            const purgeAt = new Date(Date.now() + 30 * 86400000);
            await ref.update({ data: { archived: true, archivedAt, purgeAt, updatedAt: (0, utils_1.now)() } });
            if (before.boundUserId) {
                await context_1.db.collection(constants_1.C.users).doc(before.boundUserId).update({ data: { status: 'ARCHIVED', updatedAt: (0, utils_1.now)() } });
            }
            await (0, audit_1.audit)(user, 'STUDENT_ARCHIVED', 'student', event.studentId, before, { archivedAt, purgeAt });
            return ok({ purgeAt });
        }
        case 'restoreStudent': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const ref = context_1.db.collection(constants_1.C.roster).doc(event.studentId);
            const before = (await ref.get()).data;
            if (!before)
                appError('STUDENT_NOT_FOUND', '学生不存在');
            if (!(0, utils_1.canAccessDataSpace)(user, before) || !teacherOwnsRoster(user, before))
                appError('FORBIDDEN', '没有权限');
            if (!before.archived)
                return ok({ restored: true });
            await ref.update({ data: { archived: false, archivedAt: null, purgeAt: null, updatedAt: (0, utils_1.now)() } });
            if (before.boundUserId) {
                await context_1.db.collection(constants_1.C.users).doc(before.boundUserId).update({ data: { status: 'ACTIVE', updatedAt: (0, utils_1.now)() } });
            }
            await (0, audit_1.audit)(user, 'STUDENT_RESTORED', 'student', event.studentId, before, { archived: false });
            return ok({ restored: true });
        }
        case 'getRosterImportTemplate': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            return ok(rosterImportTemplatePayload());
        }
        case 'importRoster': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const importerId = currentManagerId(user);
            const importDataSpace = user?._realRole === 'developer_admin' ? 'developer_test' : 'production';
            if (!importerId)
                appError('FORBIDDEN', '当前账号缺少有效用户编号');
            const consentVersion = String(event.consentVersion || '').trim();
            if (event.consentConfirmed !== true || consentVersion !== CHILDREN_PRIVACY_VERSION) {
                appError('STUDENT_DATA_AUTHORIZATION_REQUIRED', '请先确认已依据学校管理要求或取得学生监护人的授权');
            }
            if (!event.fileID)
                appError('INVALID_INPUT', '请选择Excel文件');
            const file = (await context_1.cloud.downloadFile({ fileID: event.fileID })).fileContent;
            (0, xlsx_safety_1.assertXlsxFileSize)(file);
            const workbook = XLSX.read(file, { type: 'buffer', dense: true, cellFormula: false, cellHTML: false, cellStyles: false, cellDates: false, WTF: false });
            (0, xlsx_safety_1.assertWorkbookShape)(workbook);
            const analyses = workbook.SheetNames
                .map((sheetName) => analyzeRosterSheet(workbook.Sheets[sheetName], sheetName))
                .filter((analysis) => analysis.rows.some((row) => row.some((value) => String(value ?? '').trim())));
            const analysis = analyses.sort((left, right) => right.confidence - left.confidence)[0];
            const report = { created: 0, updated: 0, conflicts: 0, errors: [], detection: null };
            const unconfirmedFields = ['name', 'className'].filter((field) => analysis?.columns?.[field] === undefined);
            if (!analysis || !analysis.hasRequired || analysis.confidence < 0.7 || (!analysis.hasHeader && analysis.stableRows < 3)) {
                report.detection = { sheetName: analysis?.sheetName || '', columns: analysis?.columnLabels || {}, confidence: Number(analysis?.confidence || 0).toFixed(2), unconfirmedFields, diagnostic: '无法可靠识别学生名单结构，未写入任何数据' };
                report.errors.push({ row: '诊断', error: report.detection.diagnostic });
                await (0, audit_1.audit)(user, 'ROSTER_IMPORTED', 'roster', 'batch', null, report);
                return ok(report);
            }
            report.detection = { sheetName: analysis.sheetName, columns: analysis.columnLabels, confidence: Number(analysis.confidence).toFixed(2), unconfirmedFields: [] };
            const consentBatchId = (0, utils_1.randomId)('consent_batch');
            const consentClassIds = new Set();
            const pendingRows = [];
            for (let index = analysis.dataStart; index < analysis.rows.length; index += 1) {
                const rows = analysis.rows;
                const row = rows[index] || [];
                if (!row.some((value) => String(value ?? '').trim()))
                    continue;
                const repeatedHeader = importHeaderColumns(row, rows[index + 1] || []);
                if (repeatedHeader.name !== undefined && repeatedHeader.className !== undefined)
                    continue;
                const rowText = normalizeImportHeader(row.join(' '));
                if (/^(合计|备注|制表人|日期|填表人|说明)/.test(rowText))
                    continue;
                const name = importCell(row, analysis.columns.name);
                const studentNumber = importCell(row, analysis.columns.studentNumber);
                const className = importCell(row, analysis.columns.className);
                if (!name && !className)
                    continue;
                if (!name || !className) {
                    report.errors.push({ row: index + 1, error: !name ? '缺少姓名' : '缺少地区' });
                    continue;
                }
                const grade = '';
                pendingRows.push({ index, name, studentNumber, grade, className });
            }
            const classIds = new Map();
            for (const item of pendingRows) {
                const classKey = `${item.grade}\u0000${item.className}`;
                if (classIds.has(classKey))
                    continue;
                const classId = await ensureClass(item.grade, item.className);
                classIds.set(classKey, classId);
                if (!consentClassIds.has(classId)) {
                    consentClassIds.add(classId);
                    await context_1.db.collection(constants_1.C.teacherPrivacyConsents).doc((0, utils_1.randomId)('consent')).set({ data: {
                            teacherId: importerId,
                            classId,
                            consentConfirmed: true,
                            consentVersion,
                            confirmedAt: (0, utils_1.now)(),
                            operatorOpenId: openid,
                            consentBatchId,
                            source: 'roster_import',
                        } });
                }
            }
            const involvedClasses = new Set([...classIds.keys()]);
            const rosterByMatch = new Map();
            const rosterPageSize = 1000;
            let rosterOffset = 0;
            while (true) {
                const existingRoster = await context_1.db.collection(constants_1.C.roster)
                    .where({ archived: false })
                    .skip(rosterOffset)
                    .limit(rosterPageSize)
                    .get();
                for (const item of existingRoster.data) {
                    const matchKey = `${String(item.grade || '')}\u0000${regionOf(item)}`;
                    if (!involvedClasses.has(matchKey) || (0, utils_1.dataSpaceOf)(item) !== importDataSpace)
                        continue;
                    const rosterKey = `${(0, utils_1.normalizeName)(item.name)}\u0000${matchKey}`;
                    const matches = rosterByMatch.get(rosterKey) || [];
                    matches.push(item);
                    rosterByMatch.set(rosterKey, matches);
                }
                if (existingRoster.data.length < rosterPageSize)
                    break;
                rosterOffset += existingRoster.data.length;
            }
            for (const { index, name, studentNumber, grade, className } of pendingRows) {
                const matchKey = `${grade}\u0000${className}`;
                const rosterKey = `${(0, utils_1.normalizeName)(name)}\u0000${matchKey}`;
                const matches = rosterByMatch.get(rosterKey) || [];
                const inaccessibleMatches = user.role === 'teacher' ? matches.filter((item) => !teacherOwnsRoster(user, item)) : [];
                if (inaccessibleMatches.length) {
                    report.conflicts += 1;
                    report.errors.push({ row: index + 1, error: '该学生已由其他教师管理，未修改原记录' });
                    continue;
                }
                try {
                    if (matches.length === 0) {
                        const id = (0, utils_1.randomId)('stu');
                        const created = {
                            _id: id,
                            name,
                            normalizedName: (0, utils_1.normalizeName)(name),
                            grade,
                            className,
                            studentNumber,
                            extraFields: {},
                            ownerTeacherId: importerId,
                            dataSpace: importDataSpace,
                            archived: false,
                            createdAt: (0, utils_1.now)(),
                            updatedAt: (0, utils_1.now)(),
                        };
                        await context_1.db.collection(constants_1.C.roster).doc(id).set({ data: created });
                        rosterByMatch.set(rosterKey, [created]);
                        report.created += 1;
                    }
                    else if (matches.length === 1) {
                        const old = matches[0];
                        const update = {
                            name,
                            ...(studentNumber ? { studentNumber } : {}),
                            ...(!String(old.ownerTeacherId || '').trim() ? { ownerTeacherId: importerId } : {}),
                            updatedAt: (0, utils_1.now)(),
                        };
                        await context_1.db.collection(constants_1.C.roster).doc(old._id).update({ data: update });
                        Object.assign(old, update);
                        report.updated += 1;
                    }
                    else {
                        await context_1.db.collection(constants_1.C.importConflicts).add({ data: {
                                name,
                                grade,
                                className,
                                row: { name, studentNumber, grade, className },
                                matchIds: matches.map((item) => item._id),
                                status: 'PENDING',
                                createdAt: (0, utils_1.now)(),
                            } });
                        report.conflicts += 1;
                        report.errors.push({ row: index + 1, error: '同地区同名记录不唯一，请在学生管理中单独编辑' });
                    }
                }
                catch (error) {
                    report.errors.push({ row: index + 1, error: '该行写入失败，请稍后重试' });
                }
            }
            await (0, audit_1.audit)(user, 'ROSTER_IMPORTED', 'roster', 'batch', null, report);
            return ok(report);
        }
        case 'listTeachers': {
            requireActiveSuperAdmin(user);
            const response = await context_1.db.collection(constants_1.C.users)
                .where({ role: context_1.cmd.in(['teacher', 'super_admin']) })
                .limit(200)
                .get();
            return ok(response.data.filter((teacher) => teacher.reviewOnly !== true).map(auth_1.publicUser));
        }
        case 'refreshRuntimeStrategy': {
            requireActiveSuperAdmin(user);
            return ok(await (0, remote_1.refreshRuntimeStrategy)());
        }
        case 'getHardProblemModelProvider': {
            requireActiveSuperAdmin(user);
            const provider = await readHardProblemModelProvider();
            try {
                const status = await hardProblemProviderStatus();
                return ok({ provider, providers: status.providers, providerStatusContractVersion: status.providerStatusContractVersion, runtimeBuildId: status.runtimeBuildId, statusAvailable: true });
            }
            catch (error) {
                const statusErrorCode = String(error?.code || 'GRADING_WORKER_STATUS_FAILED').slice(0, 120);
                (0, audit_1.monitor)('appApi', 'HARD_PROBLEM_PROVIDER_STATUS_FAILED', { errorCode: statusErrorCode }, true);
                return ok({ provider, providers: {
                        ark_lite: { ready: false, reason: 'status_unavailable' },
                        qwen3_vl_plus: { ready: false, reason: 'status_unavailable' },
                    }, runtimeBuildId: null, statusAvailable: false, statusErrorCode });
            }
        }
        case 'setHardProblemModelProvider': {
            requireActiveSuperAdmin(user);
            const requestedProvider = String(event.provider || '').trim();
            if (!HARD_PROBLEM_MODEL_PROVIDERS.includes(requestedProvider))
                appError('INVALID_MODEL_PROVIDER', '难题训练模型无效');
            const status = await hardProblemProviderStatus();
            const providers = status.providers;
            if (providers?.[requestedProvider]?.ready !== true) {
                const reason = String(providers?.[requestedProvider]?.reason || 'not_ready');
                const qwenMessages = {
                    missing_api_key: '千问 API Key 未配置',
                    missing_base_url: '千问 Base URL 未配置',
                    invalid_base_url: '千问 Base URL 格式错误',
                    invalid_model: '千问模型必须配置为 qwen3.7-plus',
                    status_unavailable: '无法读取 grading-worker 模型状态',
                };
                appError('MODEL_PROVIDER_NOT_READY', requestedProvider === 'qwen3_vl_plus' ? (qwenMessages[reason] || '千问 Qwen3.7 Plus 尚未配置完成') : '豆包 Seed Lite 尚未配置完成');
            }
            const previousProvider = await readHardProblemModelProvider();
            const provider = await writeHardProblemModelProvider(requestedProvider, user);
            await (0, audit_1.audit)(user, 'HARD_PROBLEM_MODEL_PROVIDER_UPDATED', 'system_setting', HARD_PROBLEM_PROVIDER_SETTING_ID, { provider: previousProvider }, { provider });
            return ok({ provider, providers, appliesToNewTasksOnly: true });
        }
        case 'teacherApplications': {
            requireActiveSuperAdmin(user);
            const response = await context_1.db.collection(constants_1.C.teacherApplications)
                .where({ status: 'PENDING' })
                .orderBy('createdAt', 'asc')
                .limit(100)
                .get();
            const applications = [];
            for (const application of response.data) {
                const target = (await context_1.db.collection(constants_1.C.users).doc(application.userId).get()).data;
                if (target?.role !== 'super_admin')
                    applications.push(application);
            }
            return ok(applications);
        }
        case 'repairTeacherApplication':
            return repairTeacherApplication(event, user, requestId);
        case 'reviewTeacher': {
            requireActiveSuperAdmin(user);
            const application = (await context_1.db.collection(constants_1.C.teacherApplications).doc(event.userId).get()).data;
            if (!application)
                appError('TEACHER_APPLICATION_NOT_FOUND', '老师申请不存在');
            const target = (await context_1.db.collection(constants_1.C.users).doc(event.userId).get()).data;
            if (!target || ['super_admin', 'developer_admin'].includes(target.role))
                appError('INVALID_STATUS', '不能审核超级管理员');
            const approved = Boolean(event.approved);
            const scopes = cleanScopes(Array.isArray(event.scopes) && event.scopes.length ? event.scopes : application.requestedScopes);
            if (approved && !scopes.length)
                appError('INVALID_INPUT', '审核通过时必须分配至少一个地区');
            const rejectReason = String(event.rejectReason || '').trim();
            if (!approved && !rejectReason)
                appError('INVALID_INPUT', '请填写拒绝原因');
            const status = approved ? 'ACTIVE' : 'REJECTED';
            const role = 'teacher';
            const reviewedAt = (0, utils_1.now)();
            await context_1.db.runTransaction(async (transaction) => {
                await transaction.collection(constants_1.C.users).doc(event.userId).update({ data: {
                        role,
                        status,
                        scopes: approved ? scopes : [],
                        updatedAt: reviewedAt,
                    } });
                await transaction.collection(constants_1.C.teacherApplications).doc(event.userId).update({ data: {
                        status: approved ? 'APPROVED' : 'REJECTED',
                        ...(approved ? { approvedAt: reviewedAt, approvedBy: user.userId } : { rejectedAt: reviewedAt, rejectedBy: user.userId, rejectReason }),
                        reviewedScopes: scopes,
                        updatedAt: reviewedAt,
                    } });
            });
            await (0, audit_1.audit)(user, approved ? 'TEACHER_APPROVED' : 'TEACHER_REJECTED', 'teacher', event.userId, null, { role, scopes, rejectReason });
            return ok({ role, status, scopes });
        }
        case 'promoteTeacherToSuperAdmin': {
            requireActiveSuperAdmin(user);
            const target = (await context_1.db.collection(constants_1.C.users).doc(event.userId).get()).data;
            if (!target || target.role !== 'teacher' || target.status !== 'ACTIVE')
                appError('INVALID_ROLE', '只能提升已审核通过的有效教师');
            const promotedAt = (0, utils_1.now)();
            await context_1.db.runTransaction(async (transaction) => {
                const count = await transaction.collection(constants_1.C.users).where({ role: 'super_admin', status: 'ACTIVE' }).count();
                if (count.total >= 2)
                    appError('SUPER_ADMIN_LIMIT', '超级管理员最多2名');
                await transaction.collection(constants_1.C.users).doc(event.userId).update({ data: { role: 'super_admin', status: 'ACTIVE', updatedAt: promotedAt } });
            });
            await (0, audit_1.audit)(user, 'TEACHER_PROMOTED_TO_SUPER_ADMIN', 'teacher', event.userId, { role: target.role, status: target.status }, { role: 'super_admin', status: 'ACTIVE', promotedAt }, true, requestId);
            return ok({ role: 'super_admin', status: 'ACTIVE' });
        }
        case 'submissions': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const visibleTasks = await visibleStudentTasks(user);
            const from = event.dateFrom ? new Date(`${event.dateFrom}T00:00:00+08:00`).getTime() : null;
            const to = event.dateTo ? new Date(`${event.dateTo}T00:00:00+08:00`).getTime() + 86400000 : null;
            const data = visibleTasks
                .filter((item) => !event.grade || item.grade === event.grade)
                .filter((item) => !regionOf(event) || regionOf(item) === regionOf(event))
                .filter((item) => !event.studentId || item.studentId === event.studentId)
                .filter((item) => !event.studentName || String(item.studentName || '').includes(String(event.studentName)))
                .filter((item) => !event.status || item.status === event.status)
                .filter((item) => event.checkinSuccess === undefined || item.checkinSuccess === event.checkinSuccess)
                .filter((item) => !from || new Date(item.createdAt).getTime() >= from)
                .filter((item) => !to || new Date(item.createdAt).getTime() < to)
                .filter((item) => !event.resultType || (event.resultType === 'all_correct' ? item.status === 'COMPLETED' && item.questionCount > 0 && item.correctCount === item.questionCount
                : event.resultType === 'has_errors' ? item.status === 'COMPLETED' && item.correctCount < item.questionCount
                    : event.resultType === 'failed' ? item.status === 'FAILED'
                        : event.resultType === 'need_confirmation' ? item.status === 'NEED_CONFIRMATION'
                            : true));
            return ok(data);
        }
        case 'retryTask': {
            if (user.role === 'student')
                (0, auth_1.requireActiveStudent)(user);
            else
                (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const task = (await context_1.db.collection(constants_1.C.tasks).doc(String(event.taskId || '')).get()).data;
            if (!task)
                appError('TASK_NOT_FOUND', '任务不存在');
            await assertTaskAccess(task, user);
            if (task.status !== 'FAILED')
                appError('INVALID_STATUS', '任务当前不处于失败状态');
            if (task.retryable === false)
                appError('RETRY_NOT_ALLOWED', task.errorSuggestion || '该任务不允许重新处理');
            if (Number(task.retryCount || 0) >= 2)
                appError('RETRY_LIMIT_REACHED', '已达到最大重试次数');
            if (task.leaseUntil && new Date(task.leaseUntil).getTime() > Date.now())
                appError('TASK_BUSY', '任务仍在处理中');
            const failureHistory = [...(Array.isArray(task.failureHistory) ? task.failureHistory : []), { errorCode: task.errorCode || '', errorMessage: task.errorMessage || '', failedAt: task.failedAt || (0, utils_1.now)(), failedStage: task.failedStage || task.currentStage || '' }];
            const retryStage = ['PRIMARY_GRADING', 'REVIEW_GRADING'].includes(String(task.failedStage || '')) ? String(task.failedStage) : 'PRIMARY_GRADING';
            await context_1.db.collection(constants_1.C.tasks).doc(task._id).update({ data: { status: 'QUEUED', currentStage: retryStage, progress: retryStage === 'REVIEW_GRADING' ? 60 : 25, statusMessage: retryStage === 'REVIEW_GRADING' ? '正在重新进行独立复核' : '正在重新进行首次批改', retryCount: Number(task.retryCount || 0) + 1, stageRetryCount: 0, failureHistory, errorCode: null, errorMessage: null, errorSuggestion: null, failureCategory: null, failureId: null, failureCauseCode: null, failureFieldPath: null, failureRequestStage: null, failureModelProvider: null, failureModelName: null, failureProviderRequestIdPresent: null, failureRepairAttempted: null, failureRepairAttemptCount: null, failureRepairFailureStage: null, failedStage: null, failureArchivedAt: null, failureArchiveVersion: null, failureArchiveFailureId: null, failureArchiveGeneration: null, retryable: null, hardProblemReviewRecoveryCount: 0, hardProblemReviewLastFailure: null, hardProblemUnderstandingRecoveryCount: 0, hardProblemDirectRetryCount: 0, hardProblemDirectHandoffRecoveryCount: 0, carelessPrimaryRecoveryCount: 0, carelessReviewRecoveryCount: 0, carelessReviewRecoveryContext: null, finalizationRecoveryCount: 0, primaryTransportAttempt: 0, reviewTransportAttempt: 0, ...(retryStage === 'PRIMARY_GRADING' ? { primaryDraft: null, reviewDraft: null, mergedDraft: null } : { reviewDraft: null, mergedDraft: null }), leaseOwner: null, leaseUntil: null, updatedAt: (0, utils_1.now)() } });
            const dispatchStatus = await dispatchTask(String(task._id), 'task_retry');
            await (0, audit_1.audit)(user, 'TASK_REQUEUED', 'task', task._id, { status: task.status, retryCount: task.retryCount || 0 }, { retryCount: Number(task.retryCount || 0) + 1 });
            return ok({ taskId: task._id, status: 'QUEUED', dispatchStatus, retryCount: Number(task.retryCount || 0) + 1 });
        }
        case 'manualReview': {
            (0, auth_1.requireRole)(user, ['teacher', 'super_admin']);
            const task = (await context_1.db.collection(constants_1.C.tasks).doc(event.taskId).get()).data;
            if (!task)
                appError('TASK_NOT_FOUND', '任务不存在');
            await assertTaskAccess(task, user);
            const resultRef = context_1.db.collection(constants_1.C.results).doc(event.taskId);
            const before = (await resultRef.get()).data;
            if (!before)
                appError('RESULT_NOT_FOUND', '批改结果不存在');
            if (before.taskId !== task._id || before.studentId !== task.studentId || (0, utils_1.dataSpaceOf)(before) !== (0, utils_1.dataSpaceOf)(task))
                appError('RESULT_NOT_FOUND', '批改结果不存在');
            const questions = normalizeReviewedQuestions(event.patch?.questions || before.questions || []);
            const narrated = (0, result_narration_1.withResultNarration)(questions);
            const summary = summarizeQuestions(narrated.questions);
            const updatedResult = {
                ...before,
                questions: narrated.questions,
                resultNarrationText: narrated.resultNarrationText,
                narrationSource: '',
                narrationVersion: null,
                narrationGeneratedAt: null,
                audioNarration: { status: 'PENDING' },
                summary: { ...(before.summary || {}), ...summary },
                teacherReviewed: true,
                reviewedBy: user.userId,
                reviewedAt: (0, utils_1.now)(),
                updatedAt: (0, utils_1.now)(),
            };
            await resultRef.update({ data: updatedResult });
            await rebuildDerivedRecordsAfterReview(task, narrated.questions, summary);
            await context_1.db.collection(constants_1.C.tasks).doc(event.taskId).update({ data: {
                    checkinSuccess: summary.allCorrect,
                    totalScore: summary.totalScore,
                    awardedScore: summary.awardedScore,
                    questionCount: questions.length,
                    correctCount: summary.correctCount,
                    teacherReviewed: true,
                    voiceStatus: 'PENDING',
                    updatedAt: (0, utils_1.now)(),
                } });
            if (typeof context_1.cloud?.callFunction === 'function') {
                void context_1.cloud.callFunction({ name: 'ttsWorker', data: { resultId: event.taskId } }).catch((error) => {
                    (0, audit_1.monitor)('appApi', 'MANUAL_REVIEW_TTS_ENQUEUE_FAILED', { taskId: event.taskId, errorCode: String(error?.code || error?.errCode || 'TTS_ENQUEUE_FAILED') }, true);
                });
            }
            await (0, audit_1.audit)(user, 'RESULT_MANUALLY_REVIEWED', 'result', event.taskId, before, {
                questions: narrated.questions,
                summary,
            });
            return ok({ reviewed: true, summary });
        }
        case 'auditLogs': {
            (0, auth_1.requireRole)(user, ['super_admin']);
            const limit = Math.max(1, Math.min(500, Number(event.limit || 200)));
            const response = await context_1.db.collection(constants_1.C.audit).orderBy('createdAt', 'desc').limit(limit).get();
            return ok(response.data);
        }
        default:
            appError('ACTION_NOT_FOUND', '当前云端接口版本过旧，请重新部署appApi');
    }
}
exports.main = async (event) => {
    const requestId = (0, utils_1.randomId)('req');
    const action = String(event?.action || '');
    const operation = String(event?.operation || '');
    try {
        const openid = (0, context_1.context)().openid;
        if (action === 'reviewSession') {
            if (!openid)
                appError('NO_OPENID', '未取得微信身份');
            const response = await dispatch(action, event || {}, undefined, requestId, openid);
            return { ...response, request_id: requestId };
        }
        let user;
        try {
            user = await (0, auth_1.currentUser)(action !== 'bootstrap');
        }
        catch (error) {
            if (!['registerTeacher', 'registerStudent'].includes(action) || !isDocumentNotFound(error) || !openid)
                throw error;
            const registration = action === 'registerStudent' ? 'registerStudent' : 'registerTeacher';
            console.error(`[${registration}-failed]`, { requestId, step: 'LOAD_USER', errCode: error?.code || error?.errCode || '', errMsg: safeDiagnostic(error?.message, 1000) });
            user = { userId: (0, utils_1.userIdFromOpenid)(openid) };
        }
        const response = await dispatch(action, event || {}, user, requestId, openid);
        return { ...response, request_id: requestId };
    }
    catch (error) {
        if (action === 'createTask')
            (0, audit_1.monitor)('appApi', 'TASK_CREATE_FAILED', { taskId: event?.taskId || null, status: 'FAILED', stage: 'CREATE', errorCode: error?.code || 'TASK_CREATE_FAILED', errorMessage: error?.message }, true);
        if (action === 'getTask')
            (0, audit_1.monitor)('appApi', 'TASK_STATUS_QUERY_FAILED', { taskId: event?.taskId || null, errorCode: error?.code || 'TASK_STATUS_QUERY_FAILED', errorMessage: error?.message }, true);
        const collection = isCollectionNotFound(error) ? missingCollectionForAction(action, error) : undefined;
        await (0, audit_1.systemLog)('ERROR', 'APP_API_ERROR', {
            requestId,
            action,
            errorName: error?.name || 'Error',
            code: error?.code,
            message: safeDiagnostic(error?.message, 500),
            ...(collection ? { collection } : {}),
            stack: safeDiagnostic(String(error?.stack || '').split('\n').slice(0, 3).join(' | ')),
        });
        return { ...fail(error, requestId, action, operation), request_id: requestId };
    }
};

exports.__test = { normalizeReviewedQuestions, applyTeacherCorrectOverride, legacyCarelessTypeForReviewedQuestion, buildGradingSummary, deriveV2Summary, runHardProblemTrainingAction };
