"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloud = exports.cmd = exports.db = void 0;
exports.context = context;
const cloud = String(process.env.SELF_HOSTED || '').toLowerCase() === 'true'
    ? require('../../../server/compat/wx-server-sdk')
    : require('wx-server-sdk');
exports.cloud = cloud;
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
// 显式指定当前云函数所在环境，避免数据库访问错误地继承客户端安全规则。
exports.db = cloud.database({ env: cloud.DYNAMIC_CURRENT_ENV });
exports.cmd = exports.db.command;
function context() {
    const wxContext = cloud.getWXContext();
    return {
        openid: wxContext.OPENID,
        appid: wxContext.APPID,
        unionid: wxContext.UNIONID,
        env: wxContext.ENV,
    };
}
