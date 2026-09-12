"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.questionKey = questionKey;
exports.qualifiedQuestion = qualifiedQuestion;
exports.normalizeCheckinRecord = normalizeCheckinRecord;
exports.writableCheckinRecord = writableCheckinRecord;
exports.applyQualifiedCheckinState = applyQualifiedCheckinState;
exports.recordPractice = recordPractice;
exports.recordQualifiedQuestions = recordQualifiedQuestions;
const crypto = require('crypto');
const context_1 = require("./context");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const audit_1 = require("./audit");
function getFirstDocument(snapshot) {
    if (!snapshot)
        return null;
    if (Array.isArray(snapshot.data))
        return snapshot.data[0] || null;
    return snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : null;
}
function safeCheckinDiagnosticMessage(error) { return String(error?.message || error?.errMsg || 'Unknown error').replace(/cloud:\/\/[^\s",}]+/g, '[REDACTED_FILE_ID]').replace(/https?:\/\/\S+/g, '[REDACTED_URL]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/(token|authorization|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 500); }
function isDocumentNotFound(error) { const code = String(error?.code || error?.errCode || '').toUpperCase(); const message = String(error?.message || error?.errMsg || ''); return /(?:DOCUMENT|DOC).*(?:NOT[_ -]?(?:FOUND|EXIST))|DATABASE_DOCUMENT_NOT_EXIST/.test(code) || /(?:document|文档).*(?:not found|does not exist|不存在|未找到)/i.test(message); }
async function readCheckinDocument(ref) { try { return getFirstDocument(await ref.get()); } catch (error) { if (isDocumentNotFound(error)) return null; throw error; } }
function questionKey(question, task) { const taskId = String(task?._id || task?.taskId || ''); const outputSchemaVersion = String(question?.outputSchemaVersion || task?.outputSchemaVersion || ''); const sourceKey = String(question?.sourceKey || ''); return `q_${crypto.createHash('sha256').update(JSON.stringify([taskId, outputSchemaVersion, sourceKey])).digest('hex').slice(0, 32)}`; }
function dataSpaceOf(record) { return record?.dataSpace === 'developer_test' ? 'developer_test' : 'production'; }
function qualifiedQuestion(question, mode, carelessTrainingType) { return question?.checkinEligible === true; }
function nonNegativeCount(value) { if (value === null || value === undefined || (typeof value === 'string' && !value.trim()))
    return null; const count = Number(value); return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null; }
function normalizeCheckinRecord(record = {}) { const keyValues = Array.isArray(record.qualifiedQuestionKeys) ? record.qualifiedQuestionKeys : []; const recordValues = Array.isArray(record.qualifiedQuestions) ? record.qualifiedQuestions : []; const qualifiedQuestionKeys = [...new Set(keyValues.map(String).filter(Boolean))]; const questionKeys = [...new Set(recordValues.map((item) => String(item?.questionKey || '')).filter(Boolean))]; const recordedCount = nonNegativeCount(record.qualifiedQuestionCount); const uniqueCount = nonNegativeCount(record.uniqueQuestionCount); const keys = qualifiedQuestionKeys.length ? qualifiedQuestionKeys : questionKeys; const qualifiedQuestionCount = keys.length || (recordedCount === null ? (uniqueCount || 0) : recordedCount); const requiredValue = Number(record.requiredQuestionCount); const requiredQuestionCount = Number.isFinite(requiredValue) && requiredValue > 0 ? Math.floor(requiredValue) : 3; const completed = qualifiedQuestionCount >= requiredQuestionCount; return { ...record, qualifiedQuestionKeys: keys, qualifiedQuestions: recordValues, qualifiedQuestionCount, requiredQuestionCount, practiced: record.practiced === true || (!record.practiced && Boolean(record.taskId)), completed, completedAt: completed ? (record.completedAt || null) : null }; }
function writableCheckinRecord(record = {}) { const { _id, _openid, ...writable } = record || {}; return writable; }
function qualifiedCheckinState(old, questionKeys, records, at) { const normalized = normalizeCheckinRecord(old), qualifiedQuestionKeys = [...new Set((questionKeys || []).map(String).filter(Boolean))], qualifiedQuestions = [...(records || [])], legacyCount = Math.max(0, normalized.qualifiedQuestionCount - normalized.qualifiedQuestionKeys.length), qualifiedQuestionCount = legacyCount + qualifiedQuestionKeys.length, modeBreakdown = { hardProblemCount: qualifiedQuestions.filter((x) => x.mode !== 'CARELESS_TRAINING').length, carelessTrainingCount: qualifiedQuestions.filter((x) => x.mode === 'CARELESS_TRAINING').length }, completed = qualifiedQuestionCount >= normalized.requiredQuestionCount; return { qualifiedQuestionKeys, qualifiedQuestions, qualifiedQuestionCount, requiredQuestionCount: normalized.requiredQuestionCount, modeBreakdown, completed, completedAt: completed ? (normalized.completedAt || at) : null }; }
function applyQualifiedCheckinState(old, additions, at) { const normalized = normalizeCheckinRecord(old), keys = new Set(normalized.qualifiedQuestionKeys || []), records = [...(normalized.qualifiedQuestions || [])]; for (const item of additions || [])
    if (item?.questionKey && !keys.has(item.questionKey)) {
        keys.add(item.questionKey);
        records.push(item);
    } return qualifiedCheckinState(normalized, [...keys], records, at); }
async function recordPractice(task) { const dateKey = (0, utils_1.shanghaiDateKey)(new Date(task.createdAt || Date.now())), id = `${task.studentId}_${dateKey}`, at = (0, utils_1.now)(); await context_1.db.runTransaction(async (tx) => { const old = writableCheckinRecord(await readCheckinDocument(tx.collection(constants_1.C.checkins).doc(id)) || {}), normalized = normalizeCheckinRecord(old), state = applyQualifiedCheckinState(normalized, [], at), ids = [...(old.submittedTaskIds || []), task._id || task.taskId].filter(Boolean); await tx.collection(constants_1.C.checkins).doc(id).set({ data: { ...old, dataSpace: dataSpaceOf(task), checkinVersion: 2, studentId: task.studentId, dateKey, requiredQuestionCount: state.requiredQuestionCount, practiced: true, firstPracticeAt: old.firstPracticeAt || at, lastPracticeAt: at, submittedTaskIds: [...new Set(ids)], ...state, createdAt: old.createdAt || at, updatedAt: at } }); }); (0, audit_1.monitor)('checkin', 'CHECKIN_PRACTICE_RECORDED', { studentId: task.studentId, taskId: task._id || task.taskId, dateKey }); }
async function recordQualifiedQuestions(task, questions) { const dateKey = (0, utils_1.shanghaiDateKey)(new Date(task.createdAt || Date.now())), id = `${task.studentId}_${dateKey}`, mode = task.mode === 'CARELESS_TRAINING' ? 'CARELESS_TRAINING' : 'HARD_PROBLEM_CHECK', at = (0, utils_1.now)(); let eligibleQuestionCount = 0, uniqueQuestionCount = 0, operationStage = 'runTransaction'; try {
    await context_1.db.runTransaction(async (tx) => { const old = writableCheckinRecord(await readCheckinDocument(tx.collection(constants_1.C.checkins).doc(id)) || {}), normalized = normalizeCheckinRecord(old), taskId = String(task._id || task.taskId || ''), currentKeys = new Set((questions || []).map((q) => questionKey(q, task))), removedKeys = new Set((normalized.qualifiedQuestions || []).filter((item) => String(item?.taskId || '') === taskId).map((item) => String(item?.questionKey || '')).filter(Boolean)), keys = new Set(normalized.qualifiedQuestionKeys || []), records = (normalized.qualifiedQuestions || []).filter((item) => String(item?.taskId || '') !== taskId && !currentKeys.has(String(item?.questionKey || ''))); for (const key of [...removedKeys, ...currentKeys])
        keys.delete(key); for (const q of questions || []) {
        if (!qualifiedQuestion(q, mode, task.carelessTrainingType))
            continue;
        eligibleQuestionCount++;
        const key = questionKey(q, task);
        if (keys.has(key))
            continue;
        keys.add(key);
        records.push({ questionKey: key, taskId: task._id, sourceKey: q.sourceKey || '', mode, firstQualifiedAt: at });
        uniqueQuestionCount++;
        (0, audit_1.monitor)('checkin', 'CHECKIN_QUESTION_QUALIFIED', { studentId: task.studentId, taskId: task._id, dateKey, questionKey: key.slice(0, 8), mode });
    } const state = qualifiedCheckinState(normalized, [...keys], records, at); operationStage = 'writeCheckin'; await tx.collection(constants_1.C.checkins).doc(id).set({ data: { ...old, dataSpace: dataSpaceOf(task), checkinVersion: 2, studentId: task.studentId, dateKey, requiredQuestionCount: state.requiredQuestionCount, practiced: true, firstPracticeAt: old.firstPracticeAt || at, lastPracticeAt: at, submittedTaskIds: [...new Set([...(old.submittedTaskIds || []), task._id].filter(Boolean))], ...state, createdAt: old.createdAt || at, updatedAt: at } }); if (state.completed && !normalized.completedAt)
        (0, audit_1.monitor)('checkin', 'CHECKIN_COMPLETED', { studentId: task.studentId, taskId: task._id, dateKey, mode, qualifiedQuestionCount: state.qualifiedQuestionCount, completed: state.completed }); });
}
catch (error) {
    (0, audit_1.monitor)('checkin', 'CHECKIN_DATABASE_WRITE_FAILED', { documentId: id, dateKey, eligibleQuestionCount, uniqueQuestionCount, operationStage, errorCode: String(error?.code || error?.errCode || 'CHECKIN_DATABASE_WRITE_FAILED').slice(0, 100), errorMessage: safeCheckinDiagnosticMessage(error) }, true);
    throw error;
} }
