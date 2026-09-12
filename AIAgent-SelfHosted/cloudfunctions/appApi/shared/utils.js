"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = exports.randomId = exports.userIdFromOpenid = exports.normalizeName = exports.normalizeText = exports.hash = exports.now = void 0;
exports.dataSpaceOf = dataSpaceOf;
exports.canAccessDataSpace = canAccessDataSpace;
exports.safeError = safeError;
exports.redact = redact;
exports.scopeKey = scopeKey;
exports.hasScope = hasScope;
exports.publicUser = publicUser;
exports.shanghaiDateKey = shanghaiDateKey;
const crypto = require('crypto');
const now = () => new Date();
exports.now = now;
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
exports.hash = hash;
const normalizeText = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
exports.normalizeText = normalizeText;
const normalizeName = (v) => (0, exports.normalizeText)(v).replace(/[·•]/g, '');
exports.normalizeName = normalizeName;
const userIdFromOpenid = (openid) => `u_${(0, exports.hash)(openid).slice(0, 32)}`;
exports.userIdFromOpenid = userIdFromOpenid;
const randomId = (prefix = 'id') => `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
exports.randomId = randomId;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
exports.sleep = sleep;
function dataSpaceOf(record) {
    return record?.dataSpace === 'developer_test' ? 'developer_test' : 'production';
}
function canAccessDataSpace(user, record) {
    return user?._realRole === 'developer_admin' || dataSpaceOf(record) === 'production';
}
function safeError(e) { return { name: e?.name || 'Error', message: String(e?.message || e), code: e?.code || 'UNKNOWN' }; }
function redact(value) { const s = String(value ?? ''); if (!s)
    return ''; return s.length < 9 ? '****' : `${s.slice(0, 3)}****${s.slice(-4)}`; }
function scopeKey(grade, className) { return `${(0, exports.normalizeText)(grade)}::${(0, exports.normalizeText)(className)}`; }
function hasScope(user, grade, className) { if (user?.role === 'super_admin')
    return true; const key = scopeKey(grade, className); return (user?.scopes || []).some((x) => scopeKey(x.grade, x.className) === key); }
function publicUser(user) { if (!user)
    return null; const { openid, _realRole, ...rest } = user; return rest; }
function shanghaiDateKey(date = new Date()) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const m = Object.fromEntries(parts.map((x) => [x.type, x.value])); return `${m.year}-${m.month}-${m.day}`; }
