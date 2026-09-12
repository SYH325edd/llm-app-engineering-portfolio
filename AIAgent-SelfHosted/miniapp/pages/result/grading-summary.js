"use strict";
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGradingSummary = buildGradingSummary;
function valueOf(item, key) {
    return String((item === null || item === void 0 ? void 0 : item[key]) || '').trim().toLowerCase();
}
function isUnanswered(item) {
    if ((item === null || item === void 0 ? void 0 : item.isUnanswered) === true || valueOf(item, 'answerStatus') === 'unanswered')
        return true;
    return ['unanswered', '\u672a\u4f5c\u7b54'].includes(valueOf(item, 'status'))
        || ['unanswered', '\u672a\u4f5c\u7b54'].includes(valueOf(item, 'errorType'))
        || ['unanswered', '\u672a\u4f5c\u7b54'].includes(valueOf(item, 'mistakeType'));
}
function isCareless(item) {
    if ((item === null || item === void 0 ? void 0 : item.isCareless) === true || valueOf(item, 'carelessStatus') === 'careless')
        return true;
    var carelessType = valueOf(item, 'carelessType');
    if (carelessType && !['none', 'not_careless', 'false'].includes(carelessType))
        return true;
    return ['careless', '\u9a6c\u864e'].includes(valueOf(item, 'errorType'))
        || ['careless', '\u9a6c\u864e'].includes(valueOf(item, 'mistakeType'));
}
function buildGradingSummary(questionResults) {
    var e_1, _a;
    var summary = {
        totalCount: 0,
        correctCount: 0,
        carelessCount: 0,
        wrongCount: 0,
        unansweredCount: 0,
        incorrectTotal: 0,
    };
    try {
        for (var _b = __values(Array.isArray(questionResults) ? questionResults : []), _c = _b.next(); !_c.done; _c = _b.next()) {
            var question = _c.value;
            summary.totalCount += 1;
            if ((question === null || question === void 0 ? void 0 : question.isCorrect) === true || valueOf(question, 'answerStatus') === 'correct') {
                summary.correctCount += 1;
            }
            else if (isUnanswered(question)) {
                summary.unansweredCount += 1;
            }
            else if (isCareless(question)) {
                summary.carelessCount += 1;
            }
            else {
                summary.wrongCount += 1;
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
        }
        finally { if (e_1) throw e_1.error; }
    }
    summary.incorrectTotal = summary.carelessCount + summary.wrongCount;
    return summary;
}
