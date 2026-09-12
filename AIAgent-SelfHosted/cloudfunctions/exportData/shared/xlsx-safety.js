"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XLSX_LIMITS = void 0;
exports.assertXlsxFileSize = assertXlsxFileSize;
exports.assertWorkbookShape = assertWorkbookShape;
exports.limitRows = limitRows;
exports.XLSX_LIMITS = { maxFileBytes: 5 * 1024 * 1024, maxSheets: 20, maxRowsPerSheet: 5000, maxColumnsPerRow: 50 };
function assertXlsxFileSize(file) {
    const size = Number(file?.length || file?.byteLength || 0);
    if (!size || size > exports.XLSX_LIMITS.maxFileBytes)
        throw Object.assign(new Error('Excel文件不能超过5MB'), { code: 'XLSX_FILE_TOO_LARGE', retryable: false });
}
function assertWorkbookShape(workbook) {
    const names = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
    if (!names.length)
        throw Object.assign(new Error('Excel文件没有可读取的工作表'), { code: 'XLSX_EMPTY' });
    if (names.length > exports.XLSX_LIMITS.maxSheets)
        throw Object.assign(new Error(`Excel工作表不能超过${exports.XLSX_LIMITS.maxSheets}个`), { code: 'XLSX_TOO_MANY_SHEETS' });
}
function limitRows(rows) {
    if (rows.length > exports.XLSX_LIMITS.maxRowsPerSheet)
        throw Object.assign(new Error(`单个工作表不能超过${exports.XLSX_LIMITS.maxRowsPerSheet}行`), { code: 'XLSX_TOO_MANY_ROWS' });
    return rows.map((row) => Array.isArray(row) ? row.slice(0, exports.XLSX_LIMITS.maxColumnsPerRow) : []);
}
