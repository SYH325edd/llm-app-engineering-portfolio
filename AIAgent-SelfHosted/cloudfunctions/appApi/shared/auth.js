"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicUser = void 0;
exports.currentUser = currentUser;
exports.requireRole = requireRole;
exports.requireActiveStudent = requireActiveStudent;
exports.reviewSessionStatus = reviewSessionStatus;
exports.openReviewSession = openReviewSession;
exports.switchReviewSession = switchReviewSession;
exports.closeReviewSession = closeReviewSession;
exports.sanitizeCloudData = sanitizeCloudData;
const context_1 = require("./context");
const constants_1 = require("./constants");
const context_2 = require("./context");
const utils_1 = require("./utils");
const audit_1 = require("./audit");
const crypto = require("crypto");
Object.defineProperty(exports, "publicUser", { enumerable: true, get: function () { return utils_1.publicUser; } });
async function currentUser(create = true) {
    const { openid } = (0, context_2.context)();
    if (!openid)
        throw Object.assign(new Error('未取得微信身份'), { code: 'NO_OPENID' });
    const reviewUser = await reviewSessionForOpenid(openid);
    if (reviewUser)
        return reviewUser;
    const userId = (0, utils_1.userIdFromOpenid)(openid);
    const ref = context_1.db.collection(constants_1.C.users).doc(userId);
    let user = (await ref.get()).data;
    if (!user && create) {
        user = { userId, status: 'NEW', createdAt: (0, utils_1.now)(), updatedAt: (0, utils_1.now)() };
        await ref.set({ data: user });
    }
    if (user?.role === 'developer_admin' && user.status === 'ACTIVE')
        user = { ...user, role: 'super_admin', _realRole: 'developer_admin' };
    return user;
}
const REVIEW_SESSION_COLLECTION = 'review_sessions';
const REVIEW_STUDENT_ID = 'review_student_fixed';
const REVIEW_TEACHER_ID = 'review_teacher_fixed';
const REVIEW_ROSTER_ID = 'review_roster_fixed';
function reviewChannelConfig() {
    const enabled = process.env.REVIEW_CHANNEL_ENABLED === 'true';
    const accessCodeHash = String(process.env.REVIEW_ACCESS_CODE_HASH || '').trim().toLowerCase();
    const expiresAt = new Date(String(process.env.REVIEW_CHANNEL_EXPIRES_AT || '').trim());
    if (!enabled || !/^[a-f0-9]{64}$/.test(accessCodeHash) || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())
        return null;
    return { accessCodeHash, expiresAt };
}
function requiredReviewChannelConfig() {
    if (process.env.REVIEW_CHANNEL_ENABLED !== 'true')
        throw Object.assign(new Error('review channel is disabled'), { code: 'REVIEW_CHANNEL_DISABLED' });
    const accessCodeHash = String(process.env.REVIEW_ACCESS_CODE_HASH || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(accessCodeHash))
        throw Object.assign(new Error('review access-code hash is invalid'), { code: 'REVIEW_ACCESS_CODE_HASH_INVALID' });
    const expiresAt = new Date(String(process.env.REVIEW_CHANNEL_EXPIRES_AT || '').trim());
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())
        throw Object.assign(new Error('review channel is expired'), { code: 'REVIEW_CHANNEL_EXPIRED' });
    return { accessCodeHash, expiresAt };
}
function reviewRole(value) {
    const role = String(value || '').trim();
    if (!['student', 'teacher'].includes(role))
        throw Object.assign(new Error('review role is invalid'), { code: 'INVALID_REVIEW_ROLE' });
    return role;
}
function reviewUserId(role) { return role === 'student' ? REVIEW_STUDENT_ID : REVIEW_TEACHER_ID; }
function sanitizeCloudData(value) {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint')
        return undefined;
    if (typeof value === 'number' && !Number.isFinite(value))
        return undefined;
    if (value === null || value instanceof Date || ['string', 'number', 'boolean'].includes(typeof value))
        return value;
    if (Array.isArray(value))
        return value.map(sanitizeCloudData).filter((item) => item !== undefined);
    if (typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
        return undefined;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== '_id')
        .map(([key, item]) => [key, sanitizeCloudData(item)])
        .filter(([, item]) => item !== undefined));
}
async function readReviewRecord(ref) {
    try {
        const response = await ref.get();
        const data = response?.data;
        if (Array.isArray(data))
            return data[0] && typeof data[0] === 'object' ? data[0] : null;
        return data && typeof data === 'object' ? data : null;
    }
    catch (error) {
        if (['DOCUMENT_NOT_FOUND', 'DATABASE_DOCUMENT_NOT_EXIST', 'NOT_FOUND'].includes(String(error?.code || error?.errCode || '')))
            return null;
        throw error;
    }
}
async function findFixedRecord(collectionName, fixedId) {
    const response = await context_1.db.collection(collectionName).where({ _id: fixedId }).limit(1).get();
    const data = response?.data;
    if (Array.isArray(data))
        return data[0] && typeof data[0] === 'object' ? data[0] : null;
    return data && typeof data === 'object' ? data : null;
}
async function findReviewSessionByOpenidHash(openidHash) {
    try {
        const response = await context_1.db.collection(REVIEW_SESSION_COLLECTION).where({ openidHash }).limit(1).get();
        const data = response?.data;
        if (Array.isArray(data))
            return data[0] && typeof data[0] === 'object' ? data[0] : null;
        return data && typeof data === 'object' ? data : null;
    }
    catch (error) {
        const reviewCauseCode = String(error?.errCode || error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 120) || 'UNKNOWN';
        throw Object.assign(new Error('review session store is not ready'), { code: 'REVIEW_SESSION_STORE_NOT_READY', reviewCauseCode });
    }
}
function reviewSecurityEvent(event, errorCode, stage) {
    (0, audit_1.monitor)('appApi', event, { errorCode: String(errorCode || 'UNKNOWN'), stage }, true);
}
async function reviewSessionForOpenid(openid, skipLookupFailure = true) {
    const config = reviewChannelConfig();
    if (!config)
        return null;
    const openidHash = (0, utils_1.hash)(openid);
    let session;
    try {
        session = await findReviewSessionByOpenidHash(openidHash);
    }
    catch (error) {
        if (!skipLookupFailure)
            throw error;
        reviewSecurityEvent('REVIEW_SESSION_LOOKUP_SKIPPED', error?.reviewCauseCode || error?.code || error?.errCode, 'review_session_lookup');
        return null;
    }
    if (!session || session.active !== true || new Date(session.expiresAt).getTime() <= Date.now())
        return null;
    const role = String(session.effectiveRole || '');
    const effectiveUserId = reviewUserId(role);
    if (!['student', 'teacher'].includes(role) || session.effectiveUserId !== effectiveUserId) {
        reviewSecurityEvent('REVIEW_SESSION_IDENTITY_INVALID', 'REVIEW_SESSION_IDENTITY_INVALID', 'review_session_identity');
        return null;
    }
    const user = await readReviewRecord(context_1.db.collection(constants_1.C.users).doc(effectiveUserId)).catch(() => null);
    if (!user || user.reviewOnly !== true || user.role !== role || user.status !== 'ACTIVE') {
        reviewSecurityEvent('REVIEW_SESSION_IDENTITY_INVALID', 'REVIEW_FIXED_IDENTITY_INVALID', 'review_session_identity');
        return null;
    }
    return { ...user, reviewMode: true };
}
async function ensureReviewRecords(setStage) {
    const changedAt = (0, utils_1.now)();
    const ensure = async (stage, collectionName, fixedId, desired, requiredKeys) => {
        setStage(stage);
        try {
            const existing = await findFixedRecord(collectionName, fixedId);
            if (existing && existing.reviewOnly !== true)
                throw Object.assign(new Error('fixed review ID conflicts with a formal record'), { code: 'REVIEW_FIXED_ID_CONFLICT' });
            const ref = context_1.db.collection(collectionName).doc(fixedId);
            if (!existing) {
                await ref.set({ data: sanitizeCloudData({ ...desired, createdAt: changedAt, updatedAt: changedAt }) });
            }
            else {
                const missing = sanitizeCloudData(Object.fromEntries(Object.entries(desired).filter(([key]) => existing[key] === undefined || existing[key] === null)));
                if (Object.keys(missing).length)
                    await ref.update({ data: missing });
            }
            const stored = await findFixedRecord(collectionName, fixedId);
            if (!stored || requiredKeys.some((key) => stored[key] !== desired[key]))
                throw Object.assign(new Error('fixed review record is invalid'), { code: 'REVIEW_FIXED_RECORD_INVALID' });
        }
        catch (error) {
            if (['REVIEW_FIXED_ID_CONFLICT', 'REVIEW_FIXED_RECORD_INVALID'].includes(error?.code))
                throw error;
            const reviewCauseCode = String(error?.errCode || error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 120) || 'UNKNOWN';
            throw Object.assign(new Error('fixed review record initialization failed'), { code: 'REVIEW_FIXED_RECORD_INIT_FAILED', reviewCauseCode });
        }
    };
    await ensure('review_teacher_init', constants_1.C.users, REVIEW_TEACHER_ID, { userId: REVIEW_TEACHER_ID, role: 'teacher', status: 'ACTIVE', name: '微信审核老师', reviewOnly: true }, ['userId', 'role', 'status', 'reviewOnly']);
    await ensure('review_student_init', constants_1.C.users, REVIEW_STUDENT_ID, { userId: REVIEW_STUDENT_ID, role: 'student', status: 'ACTIVE', name: '微信审核学生', rosterId: REVIEW_ROSTER_ID, reviewOnly: true }, ['userId', 'role', 'status', 'rosterId', 'reviewOnly']);
    await ensure('review_roster_init', constants_1.C.roster, REVIEW_ROSTER_ID, { rosterId: REVIEW_ROSTER_ID, boundUserId: REVIEW_STUDENT_ID, ownerTeacherId: REVIEW_TEACHER_ID, name: '微信审核学生', className: '微信审核专用', archived: false, reviewOnly: true }, ['rosterId', 'boundUserId', 'ownerTeacherId', 'archived', 'reviewOnly']);
}
async function reviewSessionStatus(openid) {
    const user = await reviewSessionForOpenid(openid, false);
    const config = reviewChannelConfig();
    return user && config ? { active: true, effectiveRole: user.role, effectiveUserId: user.userId, expiresAt: config.expiresAt } : { active: false };
}
async function openReviewSession(openid, accessCode, roleValue) {
    let stage = 'review_config';
    const setStage = (value) => { stage = value; };
    try {
        const config = requiredReviewChannelConfig();
        setStage('access_code_validation');
        const submittedHash = (0, utils_1.hash)(String(accessCode || ''));
        const submittedBuffer = Buffer.from(submittedHash, 'hex');
        const configuredBuffer = Buffer.from(config.accessCodeHash, 'hex');
        if (submittedBuffer.length !== configuredBuffer.length || !crypto.timingSafeEqual(submittedBuffer, configuredBuffer))
            throw Object.assign(new Error('review access code is invalid'), { code: 'REVIEW_ACCESS_CODE_INVALID' });
        const role = reviewRole(roleValue);
        await ensureReviewRecords(setStage);
        const openedAt = (0, utils_1.now)();
        const session = { openidHash: (0, utils_1.hash)(openid), active: true, effectiveRole: role, effectiveUserId: reviewUserId(role), expiresAt: config.expiresAt, createdAt: openedAt, updatedAt: openedAt };
        const ref = context_1.db.collection(REVIEW_SESSION_COLLECTION).doc(`review_${session.openidHash}`);
        setStage('review_session_lookup');
        const existing = await findReviewSessionByOpenidHash(session.openidHash);
        setStage('review_session_write');
        try {
            await ref.set({ data: sanitizeCloudData({ ...(existing || {}), ...session, createdAt: existing?.createdAt || openedAt }) });
            const stored = await findReviewSessionByOpenidHash(session.openidHash);
            if (!stored)
                throw Object.assign(new Error('review session write verification failed'), { code: 'REVIEW_SESSION_STORE_NOT_READY' });
        }
        catch (error) {
            if (error?.code === 'REVIEW_SESSION_STORE_NOT_READY')
                throw error;
            throw Object.assign(new Error('review session store is not ready'), { code: 'REVIEW_SESSION_STORE_NOT_READY' });
        }
        setStage('review_session_response');
        return { active: true, effectiveRole: role, effectiveUserId: session.effectiveUserId, expiresAt: config.expiresAt };
    }
    catch (error) {
        error.reviewStage = error.reviewStage || stage;
        throw error;
    }
}
async function switchReviewSession(openid, roleValue) {
    const config = reviewChannelConfig();
    if (!config)
        throw Object.assign(new Error('review session is invalid'), { code: 'REVIEW_SESSION_INVALID' });
    if (!(await reviewSessionStatus(openid)).active)
        throw Object.assign(new Error('review session is invalid'), { code: 'REVIEW_SESSION_INVALID' });
    const role = reviewRole(roleValue);
    await context_1.db.collection(REVIEW_SESSION_COLLECTION).doc(`review_${(0, utils_1.hash)(openid)}`).update({ data: { effectiveRole: role, effectiveUserId: reviewUserId(role), expiresAt: config.expiresAt, updatedAt: (0, utils_1.now)() } });
    return reviewSessionStatus(openid);
}
async function closeReviewSession(openid) {
    const openidHash = (0, utils_1.hash)(openid);
    const session = await findReviewSessionByOpenidHash(openidHash);
    if (!session)
        return { active: false };
    await context_1.db.collection(REVIEW_SESSION_COLLECTION).doc(`review_${openidHash}`).update({ data: { active: false, updatedAt: (0, utils_1.now)() } });
    return { active: false };
}
function requireRole(user, roles) { if (!user || !roles.includes(user.role) || user.status === 'DISABLED')
    throw Object.assign(new Error('没有权限'), { code: 'FORBIDDEN' }); }
function requireActiveStudent(user) { requireRole(user, ['student']); if (user.status !== 'ACTIVE')
    throw Object.assign(new Error('学生账号未激活'), { code: 'STUDENT_NOT_ACTIVE' }); }
