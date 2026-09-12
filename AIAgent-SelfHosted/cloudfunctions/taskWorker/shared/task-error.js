"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapTaskFailure = mapTaskFailure;
exports.imageUnreadableFailure = imageUnreadableFailure;
function mapTaskFailure(error, stage) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    const result = (errorCode, userMessage, userSuggestion, retryable, failureCategory, status = 'FAILED') => ({ errorCode, userMessage, userSuggestion, retryable, failureCategory, status, stage: status === 'NEED_CONFIRMATION' ? 'NEED_CONFIRMATION' : 'FAILED' });
    if (code === 'ARK_NOT_CONFIGURED')
        return result(code, 'AI服务尚未配置完成', '请联系管理员检查AI模型配置', false, 'configuration');
    if (code === 'QWEN_NOT_CONFIGURED' || code === 'QWEN_INVALID_MODEL')
        return result(code, '千问模型尚未配置完成', '请联系管理员检查云托管中的千问模型配置', false, 'configuration');
    if (code === 'ARK_INVALID_PARAMETER')
        return result(code, 'AI服务配置参数无效', '请联系管理员检查AI模型配置', false, 'configuration');
    if (code === 'QWEN_HTTP_ERROR' && error?.retryable === false)
        return result(code, '千问模型请求配置无效', '请联系管理员检查千问API Key、地域地址和模型名称', false, 'configuration');
    if (code === 'STRATEGY_CONTRACT_INCOMPATIBLE')
        return result(code, '批改策略与当前程序版本不兼容', '请联系管理员更新批改策略和云托管服务', false, 'configuration');
    if (code === 'HARD_PROBLEM_FIXED_RESULT_MISMATCH') {
        const qwen = String(error?.modelProvider || '') === 'qwen3_vl_plus';
        return result(code,
            qwen ? '千问已识别题目，但批改结果结构未通过校验' : '难题批改结果结构未通过校验',
            '系统已完成自动修复和重试；仍失败时请重新提交，并将错误编号提供给管理员',
            true,
            'ai_response');
    }
    if (code === 'ARK_REQUEST_TIMEOUT' || code === 'ARK_TIMEOUT' || code === 'QWEN_REQUEST_TIMEOUT' || error?.name === 'AbortError' || /timeout|超时/.test(message))
        return result('ARK_REQUEST_TIMEOUT', 'AI服务响应超时', '当前服务可能繁忙，请稍后重新尝试', true, 'ai_timeout');
    if (Number(error?.status) === 429 || /RATE_LIMIT|OVERLOAD|BUSY|INTERNALSERVICEERROR/.test(code) || /rate|overload|busy|internalserviceerror/.test(message))
        return result(code || 'AI_BUSY', 'AI服务当前请求较多', '请稍后重新尝试', true, 'ai_busy');
    if (code === 'ARK_OUTPUT_TRUNCATED' || code === 'QWEN_OUTPUT_TRUNCATED' || code === 'LLM_TRUNCATED_RESPONSE')
        return result(code, '题目内容较多，AI结果生成不完整', '请减少单张图片中的题目数量后重新上传', false, 'ai_response');
    if (code === 'LLM_EMPTY_RESPONSE' || code === 'LLM_SCHEMA_REPAIR_FAILED' || /LLM_(JSON_PARSE_ERROR|MULTIPLE_JSON_VALUES|SCHEMA_ERROR)/.test(code))
        return result(code, 'AI返回的批改结果格式异常', '请联系管理员处理', false, 'ai_response');
    if (code === 'STORAGE_TEMP_URL_INVALID_RESPONSE' || code === 'STORAGE_TEMP_URL_FAILED' || code === 'IMAGE_DOWNLOAD_FAILED')
        return result(code, '系统暂时无法读取已上传的作业图片', '请稍后重新尝试', false, 'storage');
    if (/STORAGE|TEMP_URL|FILE.*(NOT_FOUND|EXPIRED)|IMAGE.*(NOT_FOUND|READ)/.test(code) || /图片.*(无法读取|不存在|失效)/.test(message))
        return result(code || 'IMAGE_READ_FAILED', '系统无法读取已上传的作业图片', '请重新上传图片', true, 'storage');
    if (/DATABASE|DB_|SAVE|WRITE/.test(code) || stage === 'SAVING')
        return result(code || 'RESULT_SAVE_FAILED', '批改结果保存失败', '请稍后重新尝试；无需立即重复上传图片', true, 'database');
    return result(code || 'TASK_FAILED', '系统处理任务时发生异常', '请稍后重新尝试', true, 'unknown');
}
function imageUnreadableFailure() { return { errorCode: 'IMAGE_UNREADABLE', userMessage: '图片内容不够清晰，无法可靠识别题目和答案', userSuggestion: '请重新拍摄，确保图片清晰、完整、无反光', retryable: true, failureCategory: 'image', status: 'NEED_CONFIRMATION', stage: 'NEED_CONFIRMATION' }; }
