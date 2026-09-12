"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloud = exports.cmd = exports.db = void 0;
exports.context = context;
const { getCloudbaseClient } = require('../../cloudbase-client');
const client = getCloudbaseClient();
exports.cloud = client.cloud;
// CloudRun 使用 @cloudbase/js-sdk 数据库适配器。
exports.db = client.database();
exports.cmd = exports.db.command;
function context() {
    return {
        env: process.env.CLOUDBASE_ENV_ID || '',
    };
}
