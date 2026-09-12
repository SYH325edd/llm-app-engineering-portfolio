"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var customer_1 = require("../../../config/customer");
Page({
    data: {
        serviceName: customer_1.CUSTOMER_DISPLAY_CONFIG.serviceName,
        operatorName: customer_1.CUSTOMER_DISPLAY_CONFIG.operatorName,
        complaintPhone: customer_1.CUSTOMER_DISPLAY_CONFIG.complaintPhone,
        phoneConfigured: (0, customer_1.isComplaintPhoneConfigured)(),
        version: customer_1.CUSTOMER_DISPLAY_CONFIG.agreementVersion,
        effectiveDate: customer_1.CUSTOMER_DISPLAY_CONFIG.agreementEffectiveDate,
    },
    privacy: function () { wx.navigateTo({ url: '/pages/legal/privacy/index' }); },
    childrenPrivacy: function () { wx.navigateTo({ url: '/pages/legal/children-privacy/index' }); },
    contact: function () {
        if (!this.data.phoneConfigured)
            return;
        wx.makePhoneCall({ phoneNumber: this.data.complaintPhone });
    },
});
