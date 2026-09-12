"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const context_1 = require("./shared/context");
const constants_1 = require("./shared/constants");
const auth_1 = require("./shared/auth");
const utils_1 = require("./shared/utils");
const audit_1 = require("./shared/audit");
const generated_files_1 = require("./shared/generated-files");
const XLSX = require('xlsx');
function parseDateStart(value) {
    if (!value)
        return null;
    const time = new Date(`${value}T00:00:00+08:00`).getTime();
    return Number.isFinite(time) ? time : null;
}
function regionOf(value) {
    return String(value?.region || value?.className || '').trim();
}
function managerId(user) {
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
function canManageRoster(user, student) {
    if (user?.role === 'super_admin')
        return true;
    if (!['teacher', 'admin'].includes(String(user?.role || '')) || !student)
        return false;
    const explicitManagers = rosterManagerIds(student);
    if (explicitManagers.length)
        return explicitManagers.includes(managerId(user));
    return (0, utils_1.hasScope)(user, student.grade, regionOf(student));
}
function isProductionData(record) { return record?.dataSpace !== 'developer_test'; }
function exportCloudPath(userId, dataSpace = 'production') {
    const storagePrefix = dataSpace === 'developer_test' ? 'developer-test' : 'production';
    return `${storagePrefix}/exports/${userId}/${(0, utils_1.randomId)('export')}.xlsx`;
}
const { summarizeQuestionsForExport } = require('./shared/export-result-semantics');
function taskMatches(task, filters) {
    const from = parseDateStart(filters.dateFrom);
    const toStart = parseDateStart(filters.dateTo);
    const to = toStart == null ? null : toStart + 86400000;
    const createdAt = new Date(task.createdAt).getTime();
    if (filters.grade && task.grade !== filters.grade)
        return false;
    if (filters.className && regionOf(task) !== filters.className)
        return false;
    if (filters.studentId && task.studentId !== filters.studentId)
        return false;
    if (filters.studentName && !String(task.studentName || '').includes(String(filters.studentName)))
        return false;
    if (filters.status && task.status !== filters.status)
        return false;
    if (filters.checkinSuccess !== undefined && task.checkinSuccess !== filters.checkinSuccess)
        return false;
    if (from != null && createdAt < from)
        return false;
    if (to != null && createdAt >= to)
        return false;
    if (filters.resultType === 'all_correct' && !(task.status === 'COMPLETED' && task.questionCount > 0 && task.correctCount === task.questionCount))
        return false;
    if (filters.resultType === 'has_errors' && !(task.status === 'COMPLETED' && task.correctCount < task.questionCount))
        return false;
    if (filters.resultType === 'failed' && task.status !== 'FAILED')
        return false;
    if (filters.resultType === 'need_confirmation' && task.status !== 'NEED_CONFIRMATION')
        return false;
    return true;
}
exports.main = async (event) => {
    const user = await (0, auth_1.currentUser)();
    (0, auth_1.requireRole)(user, ['teacher', 'admin', 'super_admin']);
    const type = event.type || 'combined';
    const filters = event.filters || {};
    let students = (await context_1.db.collection(constants_1.C.roster).where({ archived: false }).limit(1000).get()).data
        .filter((item) => canManageRoster(user, item))
        .filter(isProductionData);
    const boundStudentIds = new Set(students.map((student) => String(student.boundUserId || '').trim()).filter(Boolean));
    let tasks = (await context_1.db.collection(constants_1.C.tasks).orderBy('createdAt', 'desc').limit(1000).get()).data
        .filter((item) => (user.role === 'super_admin' || boundStudentIds.has(String(item.studentId || '').trim())) && isProductionData(item));
    students = students.filter((student) => (!filters.grade || student.grade === filters.grade)
        && (!filters.className || regionOf(student) === filters.className)
        && (!filters.studentName || String(student.name || '').includes(String(filters.studentName))));
    tasks = tasks.filter((task) => taskMatches(task, filters));
    const visibleTaskIds = new Set(tasks.map((task) => String(task._id || task.taskId || '')).filter(Boolean));
    const resultResponse = await context_1.db.collection(constants_1.C.results).orderBy('createdAt', 'desc').limit(1000).get();
    const resultByTask = new Map(resultResponse.data
        .filter((result) => visibleTaskIds.has(String(result.taskId || result._id || '')) && isProductionData(result))
        .map((result) => [result.taskId || result._id, result]));
    const workbook = XLSX.utils.book_new();
    if (type === 'roster' || type === 'combined') {
        const rows = students.map((student) => ({
            姓名: student.name,
            地区: regionOf(student),
        }));
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '学生名单');
    }
    if (type === 'submissions' || type === 'combined') {
        const rows = tasks.map((task) => {
            const result = resultByTask.get(task._id);
            const questions = result?.questions || [];
            const exportSummary = summarizeQuestionsForExport(questions);
            const careless = exportSummary.carelessCount;
            const knowledgeGap = exportSummary.knowledgeGapCount;
            const methodError = exportSummary.methodErrorCount;
            const errorSummary = exportSummary.errorSummary;
            return {
                学生: task.studentName,
                地区: regionOf(task),
                提交时间: task.createdAt,
                状态: task.status,
                题目数: questions.length || task.questionCount || 0,
                正确数: questions.length ? exportSummary.correctCount : (task.correctCount || 0),
                得分: task.awardedScore || 0,
                总分: task.totalScore || 0,
                打卡成功: task.checkinSuccess ? '是' : '否',
                马虎题数: careless,
                知识缺口题数: knowledgeGap,
                方法错误题数: methodError,
                错误摘要: errorSummary,
                老师已复核: result?.teacherReviewed ? '是' : '否',
                模型: task.modelTier || '',
            };
        });
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '批改记录');
    }
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const exportDataSpace = 'production';
    const cloudPath = exportCloudPath(user.userId, exportDataSpace);
    const upload = await context_1.cloud.uploadFile({ cloudPath, fileContent: buffer });
    await (0, generated_files_1.recordGeneratedFile)({ fileId: String(upload.fileID || ''), kind: 'excel_export', ownerId: user.userId, sourceId: type, dataSpace: exportDataSpace });
    const url = (await context_1.cloud.getTempFileURL({ fileList: [upload.fileID] })).fileList[0].tempFileURL;
    await (0, audit_1.audit)(user, 'DATA_EXPORTED', 'export', upload.fileID, null, { type, filters });
    return { success: true, code: 'OK', message: '导出成功', data: { fileID: upload.fileID, url, retentionDays: generated_files_1.GENERATED_FILE_RETENTION_DAYS } };
};
exports.__test = { exportCloudPath };
