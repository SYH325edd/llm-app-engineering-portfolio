"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERATED_FILE_RETENTION_DAYS = void 0;
exports.generatedFileExpiresAt = generatedFileExpiresAt;
exports.recordGeneratedFile = recordGeneratedFile;
const context_1 = require("./context");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
exports.GENERATED_FILE_RETENTION_DAYS = 90;
function generatedFileExpiresAt(from = Date.now()) { return new Date(from + exports.GENERATED_FILE_RETENTION_DAYS * 86400000); }
async function recordGeneratedFile(input) {
    const fileId = String(input.fileId || '').trim();
    if (!fileId)
        return;
    const id = `gf_${(0, utils_1.hash)(fileId).slice(0, 40)}`;
    await context_1.db.collection(constants_1.C.generatedFiles).doc(id).set({ data: { fileId, kind: input.kind, ownerId: String(input.ownerId || ''), sourceId: String(input.sourceId || ''), dataSpace: input.dataSpace === 'developer_test' ? 'developer_test' : 'production', createdAt: (0, utils_1.now)(), expiresAt: generatedFileExpiresAt() } });
}
