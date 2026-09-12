"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOMER_DISPLAY_CONFIG = void 0;
exports.isServicePhoneConfigured = isServicePhoneConfigured;
exports.isComplaintPhoneConfigured = isComplaintPhoneConfigured;
/** 客户正式发布展示配置。 */
exports.CUSTOMER_DISPLAY_CONFIG = {
    serviceName: '智能题目分析',
    operatorName: '示例教育科技有限公司',
    serviceDescription: '提供学生作业上传、人工智能辅助识别与批改、学习结果展示、教师管理和数据导出服务。',
    serviceScope: '教育辅助、作业分析、学习结果展示与教师管理',
    servicePhone: '4000000000',
    complaintPhone: '4000000000',
    agreementVersion: '1.0.1',
    privacyVersion: '1.0.1',
    childrenPrivacyVersion: '1.0.1',
    agreementEffectiveDate: '2026年7月26日',
    privacyEffectiveDate: '2026年7月26日',
    childrenPrivacyEffectiveDate: '2026年7月26日',
    filingNumber: '京ICP备2022012716号-2X',
};
function isServicePhoneConfigured() {
    return /^1\d{10}$|^0\d{2,3}-?\d{7,8}$/.test(String(exports.CUSTOMER_DISPLAY_CONFIG.servicePhone || '').trim());
}
function isComplaintPhoneConfigured() {
    return /^1\d{10}$|^0\d{2,3}-?\d{7,8}$/.test(String(exports.CUSTOMER_DISPLAY_CONFIG.complaintPhone || '').trim());
}
