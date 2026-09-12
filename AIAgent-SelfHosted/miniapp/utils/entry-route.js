"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEntryRoute = resolveEntryRoute;
exports.routePath = routePath;
function resolveEntryRoute(bootstrapData) {
    var user = (bootstrapData === null || bootstrapData === void 0 ? void 0 : bootstrapData.user) || {};
    var role = String(user.role || '');
    var status = String(user.status || '');
    if (role === 'super_admin' && status === 'ACTIVE')
        return 'pages/teacher/home/index';
    if (role === 'teacher' && status === 'ACTIVE')
        return 'pages/teacher/home/index';
    if (role === 'teacher' && status === 'PENDING' && (bootstrapData === null || bootstrapData === void 0 ? void 0 : bootstrapData.accountStatus) === 'PENDING')
        return 'pages/auth/pending/index?status=PENDING';
    if (role === 'teacher' && status === 'REJECTED')
        return 'pages/auth/pending/index?status=REJECTED';
    if (role === 'student' && status === 'ACTIVE')
        return 'pages/home/index';
    return 'pages/auth/role/index';
}
function routePath(route) { return String(route || '').split('?')[0].replace(/^\//, ''); }
