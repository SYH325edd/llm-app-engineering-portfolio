var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Component({
    data: {
        activePath: 'pages/home/index',
        tabs: [
            { text: '首页', pagePath: 'pages/home/index', icon: '⌂' },
            { text: '记录', pagePath: 'pages/history/index', icon: '◷' },
            { text: '结果', pagePath: 'pages/result/index', icon: '▤' },
            { text: '管理', pagePath: 'pages/teacher/home/index', icon: '▦' },
            { text: '我的', pagePath: 'pages/profile/index', icon: '◯' },
        ],
        visibleTabs: [],
    },
    lifetimes: { attached: function () { void this.sync(); } },
    pageLifetimes: { show: function () { void this.sync(); } },
    methods: {
        sync: function () {
            return __awaiter(this, void 0, void 0, function () {
                var route, pages, user, manager;
                var _a, _b, _c, _d, _e, _f;
                return __generator(this, function (_g) {
                    route = 'pages/home/index';
                    try {
                        pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
                        route = String(((_a = pages[pages.length - 1]) === null || _a === void 0 ? void 0 : _a.route) || route);
                    }
                    catch (_h) { }
                    this.setData({ activePath: route, visibleTabs: this.data.tabs.filter(function (tab) { return tab.pagePath !== 'pages/teacher/home/index'; }) });
                    user = ((_d = (_c = (_b = getApp()) === null || _b === void 0 ? void 0 : _b.globalData) === null || _c === void 0 ? void 0 : _c.authSnapshot) === null || _d === void 0 ? void 0 : _d.user) || ((_f = (_e = getApp()) === null || _e === void 0 ? void 0 : _e.globalData) === null || _f === void 0 ? void 0 : _f.user);
                    manager = (user === null || user === void 0 ? void 0 : user.role) === 'teacher' || (user === null || user === void 0 ? void 0 : user.role) === 'super_admin';
                    this.setData({ visibleTabs: this.data.tabs.filter(function (tab) { return manager || tab.pagePath !== 'pages/teacher/home/index'; }), activePath: route });
                    return [2 /*return*/];
                });
            });
        },
        switchTab: function (e) {
            var _this = this;
            var pagePath = String(e.currentTarget.dataset.pagePath || '');
            if (!pagePath || pagePath === this.data.activePath)
                return;
            wx.switchTab({ url: "/".concat(pagePath), success: function () {
                    var _a;
                    var route = pagePath;
                    try {
                        var pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
                        route = String(((_a = pages[pages.length - 1]) === null || _a === void 0 ? void 0 : _a.route) || pagePath);
                    }
                    catch (_b) { }
                    _this.setData({ activePath: route });
                } });
        },
    },
});
