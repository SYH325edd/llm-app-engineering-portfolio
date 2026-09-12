"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const context_1 = require("./shared/context");
const constants_1 = require("./shared/constants");
const utils_1 = require("./shared/utils");
const collections = Object.values(constants_1.C);
function isAlreadyExists(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    return /ALREADY[_ -]?EXISTS|COLLECTION_EXIST/.test(code)
        || /already exists|集合.*已存在/i.test(message);
}
async function main(event = {}) {
    const requestId = (0, utils_1.randomId)('dbinit');
    let lock = null;
    try {
        lock = (await context_1.db.collection(constants_1.C.settings).doc('database_bootstrap_lock').get()).data;
    }
    catch { }
    if (lock?.completed === true)
        return { success: false, code: 'BOOTSTRAP_CLOSED', message: '数据库初始化已完成，入口已自动关闭', request_id: requestId };
    if (!process.env.DATABASE_BOOTSTRAP_TOKEN) {
        return { success: false, code: 'BOOTSTRAP_NOT_CONFIGURED', message: 'DATABASE_BOOTSTRAP_TOKEN 未配置', request_id: requestId };
    }
    if (event.token !== process.env.DATABASE_BOOTSTRAP_TOKEN) {
        return { success: false, code: 'FORBIDDEN', message: '初始化密钥无效', request_id: requestId };
    }
    const results = [];
    for (const collection of collections) {
        try {
            await context_1.db.createCollection(collection);
            results.push({ collection, status: 'created' });
        }
        catch (error) {
            if (isAlreadyExists(error)) {
                results.push({ collection, status: 'exists' });
            }
            else {
                results.push({ collection, status: 'failed', error: `${error?.code || error?.name || 'ERROR'}: ${String(error?.message || '').slice(0, 300)}` });
            }
        }
    }
    const success = results.every((item) => item.status !== 'failed');
    if (success)
        await context_1.db.collection(constants_1.C.settings).doc('database_bootstrap_lock').set({ data: { completed: true, completedAt: new Date(), requestId } });
    return { success, request_id: requestId, results, closed: success };
}
exports.main = main;
