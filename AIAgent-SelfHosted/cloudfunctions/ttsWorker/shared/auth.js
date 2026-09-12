"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicUser = void 0;
exports.currentUser = currentUser;
exports.requireRole = requireRole;
exports.requireActiveStudent = requireActiveStudent;
const context_1 = require("./context");
const constants_1 = require("./constants");
const context_2 = require("./context");
const utils_1 = require("./utils");
Object.defineProperty(exports, "publicUser", { enumerable: true, get: function () { return utils_1.publicUser; } });
async function currentUser(create = true) {
    const { openid } = (0, context_2.context)();
    if (!openid)
        throw Object.assign(new Error('未取得微信身份'), { code: 'NO_OPENID' });
    const userId = (0, utils_1.userIdFromOpenid)(openid);
    const ref = context_1.db.collection(constants_1.C.users).doc(userId);
    let user = (await ref.get()).data;
    if (!user && create) {
        user = { userId, status: 'NEW', createdAt: (0, utils_1.now)(), updatedAt: (0, utils_1.now)() };
        await ref.set({ data: user });
    }
    return user;
}
function requireRole(user, roles) { if (!user || !roles.includes(user.role) || user.status === 'DISABLED')
    throw Object.assign(new Error('没有权限'), { code: 'FORBIDDEN' }); }
function requireActiveStudent(user) { requireRole(user, ['student']); if (user.status !== 'ACTIVE')
    throw Object.assign(new Error('学生账号未激活'), { code: 'STUDENT_NOT_ACTIVE' }); }
