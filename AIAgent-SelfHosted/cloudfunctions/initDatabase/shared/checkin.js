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
function questionKey(question, task) { const text = String(question?.questionText || '').normalize('NFKC').replace(/[\s\p{P}]/gu, ''); const rootTaskId = task.parentTaskId || task._id || task.taskId; const source = String(question?.sourceKey || ''); const input = text || `${rootTaskId}:${source}`; return `q_${crypto.createHash('sha256').update(input).digest('hex').slice(0, 32)}`; }
function qualifiedQuestion(question, mode) { if (mode === 'CARELESS_TRAINING')
    return question?.isCorrect === true && question?.conditionCorrect === true && question?.relationCorrect === true && question?.askCorrect === true; return question?.isCorrect === true && question?.finalAnswerCorrect === true && ['correct', 'not_required'].includes(question?.stepStatus) && question?.logicStatus === 'correct'; }
function normalizeCheckinRecord(record = {}) { const keyValues = Array.isArray(record.qualifiedQuestionKeys) ? record.qualifiedQuestionKeys : []; const recordValues = Array.isArray(record.qualifiedQuestions) ? record.qualifiedQuestions : []; const qualifiedQuestionKeys = [...new Set(keyValues.map(String).filter(Boolean))]; const questionKeys = [...new Set(recordValues.map((item) => String(item?.questionKey || '')).filter(Boolean))]; const recordedCount = Number(record.qualifiedQuestionCount); const legacyCount = Number.isFinite(recordedCount) && recordedCount >= 0 ? Math.floor(recordedCount) : 0; const qualifiedQuestionCount = qualifiedQuestionKeys.length || questionKeys.length || legacyCount; const requiredValue = Number(record.requiredQuestionCount); const requiredQuestionCount = Number.isFinite(requiredValue) && requiredValue > 0 ? Math.floor(requiredValue) : 3; const completed = qualifiedQuestionCount >= requiredQuestionCount; return { ...record, qualifiedQuestionKeys: qualifiedQuestionKeys.length ? qualifiedQuestionKeys : questionKeys, qualifiedQuestions: recordValues, qualifiedQuestionCount, requiredQuestionCount, practiced: record.practiced === true || (!record.practiced && Boolean(record.taskId)), completed, completedAt: completed ? (record.completedAt || null) : null }; }
function writableCheckinRecord(record = {}) { const { _id, _openid, ...writable } = record || {}; return writable; }
function applyQualifiedCheckinState(old, additions, at) { const normalized = normalizeCheckinRecord(old), keys = new Set(normalized.qualifiedQuestionKeys || []), records = [...(normalized.qualifiedQuestions || [])]; let added = 0; for (const item of additions || [])
    if (item?.questionKey && !keys.has(item.questionKey)) {
        keys.add(item.questionKey);
        records.push(item);
        added++;
    } const qualifiedQuestionKeys = [...keys], qualifiedQuestionCount = Math.max(qualifiedQuestionKeys.length, normalized.qualifiedQuestionCount + (normalized.qualifiedQuestionKeys.length ? 0 : added)), modeBreakdown = { hardProblemCount: records.filter((x) => x.mode !== 'CARELESS_TRAINING').length, carelessTrainingCount: records.filter((x) => x.mode === 'CARELESS_TRAINING').length }, completed = qualifiedQuestionCount >= normalized.requiredQuestionCount; return { qualifiedQuestionKeys, qualifiedQuestions: records, qualifiedQuestionCount, requiredQuestionCount: normalized.requiredQuestionCount, modeBreakdown, completed, completedAt: completed ? (normalized.completedAt || at) : null }; }
async function recordPractice(task) { const dateKey = (0, utils_1.shanghaiDateKey)(new Date(task.createdAt || Date.now())), id = `${task.studentId}_${dateKey}`, at = (0, utils_1.now)(); await context_1.db.runTransaction(async (tx) => { let old = {}; try {
    old = writableCheckinRecord((await tx.collection(constants_1.C.checkins).doc(id).get()).data || {});
}
catch { } const normalized = normalizeCheckinRecord(old), state = applyQualifiedCheckinState(normalized, [], at), ids = [...(old.submittedTaskIds || []), task._id || task.taskId].filter(Boolean); await tx.collection(constants_1.C.checkins).doc(id).set({ data: { ...old, checkinVersion: 2, studentId: task.studentId, dateKey, requiredQuestionCount: state.requiredQuestionCount, practiced: true, firstPracticeAt: old.firstPracticeAt || at, lastPracticeAt: at, submittedTaskIds: [...new Set(ids)], ...state, createdAt: old.createdAt || at, updatedAt: at } }); }); (0, audit_1.monitor)('checkin', 'CHECKIN_PRACTICE_RECORDED', { studentId: task.studentId, taskId: task._id || task.taskId, dateKey }); }
async function recordQualifiedQuestions(task, questions) { const dateKey = (0, utils_1.shanghaiDateKey)(new Date(task.createdAt || Date.now())), id = `${task.studentId}_${dateKey}`, mode = task.mode === 'CARELESS_TRAINING' ? 'CARELESS_TRAINING' : 'HARD_PROBLEM_CHECK', at = (0, utils_1.now)(); try {
    await context_1.db.runTransaction(async (tx) => { let old = {}; try {
        old = writableCheckinRecord((await tx.collection(constants_1.C.checkins).doc(id).get()).data || {});
    }
    catch { } const normalized = normalizeCheckinRecord(old), existing = new Set(normalized.qualifiedQuestionKeys || []), additions = []; for (const q of questions || []) {
        if (!qualifiedQuestion(q, mode))
            continue;
        const key = questionKey(q, task);
        if (existing.has(key)) {
            (0, audit_1.monitor)('checkin', 'CHECKIN_DUPLICATE_IGNORED', { studentId: task.studentId, taskId: task._id, dateKey, questionKey: key.slice(0, 8), mode });
            continue;
        }
        existing.add(key);
        additions.push({ questionKey: key, taskId: task._id, sourceKey: q.sourceKey || '', mode, firstQualifiedAt: at });
        (0, audit_1.monitor)('checkin', 'CHECKIN_QUESTION_QUALIFIED', { studentId: task.studentId, taskId: task._id, dateKey, questionKey: key.slice(0, 8), mode });
    } const state = applyQualifiedCheckinState(normalized, additions, at); await tx.collection(constants_1.C.checkins).doc(id).set({ data: { ...old, checkinVersion: 2, studentId: task.studentId, dateKey, requiredQuestionCount: state.requiredQuestionCount, practiced: true, firstPracticeAt: old.firstPracticeAt || at, lastPracticeAt: at, submittedTaskIds: [...new Set([...(old.submittedTaskIds || []), task._id].filter(Boolean))], ...state, createdAt: old.createdAt || at, updatedAt: at } }); if (state.completed && !normalized.completedAt)
        (0, audit_1.monitor)('checkin', 'CHECKIN_COMPLETED', { studentId: task.studentId, taskId: task._id, dateKey, mode, qualifiedQuestionCount: state.qualifiedQuestionCount, completed: state.completed }); });
}
catch (error) {
    (0, audit_1.monitor)('checkin', 'CHECKIN_UPDATE_FAILED', { studentId: task.studentId, taskId: task._id, dateKey, mode, qualifiedQuestionCount: 0, completed: false }, true);
    throw error;
} }
