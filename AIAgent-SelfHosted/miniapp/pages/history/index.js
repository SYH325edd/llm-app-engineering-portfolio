"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
var cloud_1 = require("../../services/cloud");
var task_title_1 = require("../../utils/task-title");
var task_mode_label_1 = require("../../utils/task-mode-label");
var manager_view_1 = require("../../utils/manager-view");
var custom_tab_bar_1 = require("../../utils/custom-tab-bar");
var student_result_visibility_1 = require("../../utils/student-result-visibility");
var processing = ['QUEUED', 'CLAIMED', 'PROCESSING', 'NEED_CONFIRMATION'];
Page({
    data: { items: [], visible: [], status: 'ALL', keyword: '', loading: false, isManager: false, managerClasses: [], managerVisible: [], managerKeyword: '', managerLoading: false, managerError: '', studentResultHidden: false },
    onShow: function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, error_1, status;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        (0, custom_tab_bar_1.syncCustomTabBar)(this, 'pages/history/index');
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 5, , 6]);
                        _a = manager_view_1.isManagerRole;
                        return [4 /*yield*/, (0, manager_view_1.currentRole)()];
                    case 2:
                        if (!_a.apply(void 0, [_b.sent()])) return [3 /*break*/, 4];
                        this.setData({ isManager: true });
                        return [4 /*yield*/, this.loadManagerClasses()];
                    case 3:
                        _b.sent();
                        return [2 /*return*/];
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        error_1 = _b.sent();
                        wx.showToast({ title: error_1.message, icon: 'none' });
                        return [2 /*return*/];
                    case 6:
                        this.setData({ isManager: false, studentResultHidden: (0, student_result_visibility_1.isCurrentStudentResultHidden)() });
                        status = String(wx.getStorageSync('historyStatus') || 'ALL');
                        wx.removeStorageSync('historyStatus');
                        this.setData({ status: status });
                        return [4 /*yield*/, this.load()];
                    case 7:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    },
    load: function () {
        return __awaiter(this, void 0, void 0, function () { var items, error_2; return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (this.data.loading)
                        return [2 /*return*/];
                    this.setData({ loading: true });
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, (0, cloud_1.call)('history')];
                case 2:
                    items = _a.sent();
                    this.setData({ items: Array.isArray(items) ? items.map(task_title_1.withDecodedTaskTitle).map(task_mode_label_1.withTaskModeLabel) : [] });
                    this.filter();
                    return [3 /*break*/, 5];
                case 3:
                    error_2 = _a.sent();
                    wx.showToast({ title: error_2.message, icon: 'none' });
                    return [3 /*break*/, 5];
                case 4:
                    this.setData({ loading: false });
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        }); });
    },
    loadManagerClasses: function () {
        return __awaiter(this, void 0, void 0, function () { var response, error_3; return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (this.data.managerLoading)
                        return [2 /*return*/];
                    this.setData({ managerLoading: true, managerError: '' });
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, (0, cloud_1.call)('managerClassStudents', { mode: 'history' })];
                case 2:
                    response = _a.sent();
                    this.setData({ managerClasses: Array.isArray(response === null || response === void 0 ? void 0 : response.students) ? response.students : [] });
                    this.filterManagerClasses();
                    return [3 /*break*/, 5];
                case 3:
                    error_3 = _a.sent();
                    this.setData({ managerError: String((error_3 === null || error_3 === void 0 ? void 0 : error_3.message) || '加载失败') });
                    return [3 /*break*/, 5];
                case 4:
                    this.setData({ managerLoading: false });
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        }); });
    },
    managerSearch: function (e) { this.setData({ managerKeyword: e.detail.value }); this.filterManagerClasses(); },
    filterManagerClasses: function () { var keyword = String(this.data.managerKeyword || '').trim(); this.setData({ managerVisible: this.data.managerClasses.filter(function (item) { return !keyword || String(item.name || '').includes(keyword) || String(item.studentNumber || '').includes(keyword); }) }); },
    openManagerClass: function (e) { var rosterId = String(e.currentTarget.dataset.rosterId || ''); if (rosterId)
        wx.navigateTo({ url: "/pages/teacher/student-tasks/index?mode=history&rosterId=".concat((0, manager_view_1.encoded)(rosterId)) }); },
    choose: function (e) { this.setData({ status: e.currentTarget.dataset.status }); this.filter(); },
    search: function (e) { this.setData({ keyword: e.detail.value }); this.filter(); },
    filter: function () { var _a = this.data, items = _a.items, status = _a.status, keyword = _a.keyword; var term = String(keyword).trim(); this.setData({ visible: items.filter(function (item) { return (status === 'ALL' || (status === 'PROCESSING' ? processing.includes(item.status) : item.status === status)) && (!term || String(item.taskName || item.createdAt || '').includes(term)); }) }); },
    open: function (e) { var id = String(e.currentTarget.dataset.taskId || ''); var task = this.data.items.find(function (item) { return String(item._id || item.taskId || item.id || '').trim() === id; }); var route = (0, student_result_visibility_1.resolveStudentTaskRoute)(task, this.data.studentResultHidden); if (id && route)
        wx.navigateTo({ url: route }); },
});
