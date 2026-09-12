"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const context_1 = require("./shared/context");
const constants_1 = require("./shared/constants");
const audit_1 = require("./shared/audit");
const utils_1 = require("./shared/utils");
async function removeQuery(collection, where) {
    let removed = 0;
    while (true) {
        const response = await context_1.db.collection(collection).where(where).limit(100).get();
        if (!response.data.length)
            break;
        for (const item of response.data) {
            await context_1.db.collection(collection).doc(item._id).remove();
            removed += 1;
        }
    }
    return removed;
}
async function collectTaskFiles(studentId) {
    const files = new Set();
    let cursor = null;
    while (true) {
        let query = context_1.db.collection(constants_1.C.tasks).where({ studentId }).orderBy('createdAt', 'asc').limit(100);
        if (cursor)
            query = context_1.db.collection(constants_1.C.tasks).where({ studentId, createdAt: context_1.cmd.gt(cursor) }).orderBy('createdAt', 'asc').limit(100);
        const response = await query.get();
        if (!response.data.length)
            break;
        for (const task of response.data) {
            for (const fileId of [...(task.studentImageFileIds || []), ...(task.answerImageFileIds || [])])
                files.add(fileId);
        }
        cursor = response.data[response.data.length - 1].createdAt;
        if (response.data.length < 100)
            break;
    }
    return [...files];
}
async function deleteFiles(fileIds) {
    for (let index = 0; index < fileIds.length; index += 50) {
        await context_1.cloud.deleteFile({ fileList: fileIds.slice(index, index + 50) }).catch(() => { });
    }
}
async function purgeExpiredGeneratedFiles() {
    let removed = 0;
    let failed = 0;
    while (true) {
        const response = await context_1.db.collection(constants_1.C.generatedFiles).where({ expiresAt: context_1.cmd.lte((0, utils_1.now)()) }).limit(50).get();
        if (!response.data.length)
            break;
        for (const item of response.data) {
            try {
                if (item.fileId)
                    await context_1.cloud.deleteFile({ fileList: [item.fileId] }).catch(() => { });
                await context_1.db.collection(constants_1.C.generatedFiles).doc(item._id).remove();
                removed += 1;
            }
            catch (error) {
                failed += 1;
                await (0, audit_1.systemLog)('ERROR', 'GENERATED_FILE_PURGE_FAILED', { fileHash: (0, utils_1.hash)(String(item.fileId || item._id)), message: String(error?.message || '').slice(0, 200) });
            }
        }
        if (response.data.length < 50)
            break;
    }
    return { removed, failed };
}
exports.main = async () => {
    const generatedFiles = await purgeExpiredGeneratedFiles();
    const due = await context_1.db.collection(constants_1.C.roster).where({ archived: true, purgeAt: context_1.cmd.lte((0, utils_1.now)()) }).limit(50).get();
    let purged = 0;
    let failed = 0;
    for (const student of due.data) {
        try {
            const anonymousId = (0, utils_1.hash)(student._id);
            if (student.boundUserId) {
                const files = await collectTaskFiles(student.boundUserId);
                await deleteFiles(files);
                const taskIds = [];
                while (true) {
                    const tasks = await context_1.db.collection(constants_1.C.tasks).where({ studentId: student.boundUserId }).limit(100).get();
                    if (!tasks.data.length)
                        break;
                    for (const task of tasks.data) {
                        taskIds.push(task._id);
                        await context_1.db.collection(constants_1.C.tasks).doc(task._id).remove();
                    }
                }
                for (const taskId of taskIds)
                    await removeQuery(constants_1.C.answerExtractions, { taskId });
                await removeQuery(constants_1.C.results, { studentId: student.boundUserId });
                await removeQuery(constants_1.C.wrong, { studentId: student.boundUserId });
                await removeQuery(constants_1.C.checkins, { studentId: student.boundUserId });
                await removeQuery(constants_1.C.hardProblemDiagnostics, { studentId: student.boundUserId });
                await removeQuery(constants_1.C.hardProblemTrainingSessions, { studentId: student.boundUserId });
                await removeQuery(constants_1.C.hardProblemLearningRecords, { studentId: student.boundUserId });
                await context_1.db.collection(constants_1.C.users).doc(student.boundUserId).remove().catch(() => { });
            }
            await context_1.db.collection(constants_1.C.roster).doc(student._id).remove();
            await (0, audit_1.audit)({ userId: 'system', role: 'system' }, 'STUDENT_PURGED', 'student', anonymousId, null, { reason: 'archived_30_days', personalDataRemoved: true });
            purged += 1;
        }
        catch (error) {
            failed += 1;
            await (0, audit_1.systemLog)('ERROR', 'PURGE_FAILED', { studentHash: (0, utils_1.hash)(student._id), message: error?.message });
        }
    }
    return { success: true, purged, failed, generatedFiles };
};
