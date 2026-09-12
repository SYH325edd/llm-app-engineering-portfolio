"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCustomTabBar = void 0;
var syncCustomTabBar = function (page, pagePath) {
    var sync = function () {
        var _a;
        try {
            var tabBar = (_a = page === null || page === void 0 ? void 0 : page.getTabBar) === null || _a === void 0 ? void 0 : _a.call(page);
            if (!(tabBar === null || tabBar === void 0 ? void 0 : tabBar.setData))
                return false;
            tabBar.setData({ activePath: pagePath });
            return true;
        }
        catch (_b) {
            return false;
        }
    };
    if (!sync() && typeof wx !== 'undefined' && typeof wx.nextTick === 'function')
        wx.nextTick(function () { sync(); });
};
exports.syncCustomTabBar = syncCustomTabBar;
