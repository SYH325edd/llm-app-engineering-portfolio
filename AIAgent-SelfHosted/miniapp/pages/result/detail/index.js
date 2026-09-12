"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
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
exports.getHardProblemQuestionState = getHardProblemQuestionState;
var cloud_1 = require("../../../services/cloud");
var student_result_visibility_1 = require("../../../utils/student-result-visibility");
var result_view_1 = require("../result-view");
var grading_summary_1 = require("../grading-summary");
var AUDIO_POLL_INTERVAL_MS = 6000;
var MATH_TEXT_FALLBACK = '公式或文本未能可靠识别，请重新上传方向正确、清晰完整的图片';
function cleanText(value) {
    var text = String(value || '').trim();
    return text && (text.includes('\uFFFD') || /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(text) || /\\(?:frac|sqrt|begin|text)\b/.test(text)) ? MATH_TEXT_FALLBACK : text;
}
function isInternalDecision(value) { return /置信度|数据源|第二个数据源|第二次结果|第二个结果|选择第二个|采用第二次|采用primary|采用review|primary|review|merged|adjudicated|selectedSource|finalSource/i.test(cleanText(value)); }
function isCorrectConclusion(value) { return /结果正确|回答正确|完成正确|未发现明显马虎|无需修改/.test(cleanText(value)); }
function visibleErrorText() {
    var values = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        values[_i] = arguments[_i];
    }
    return values.map(cleanText).find(function (value) { return value && !isInternalDecision(value) && !isCorrectConclusion(value) && !/^(null|undefined)$/i.test(value); }) || '';
}
function comparable(value) { return cleanText(value).replace(/[\s，。、“”‘’；：、,.!?！？()（）【】\[\]{}]/g, ''); }
function requiresAnalysis(question) { var stepStatus = cleanText(question === null || question === void 0 ? void 0 : question.stepStatus); return (question === null || question === void 0 ? void 0 : question.isCorrect) !== true || (question === null || question === void 0 ? void 0 : question.carelessType) === 'careless' || ['wrong', 'incomplete', 'unreadable'].includes(stepStatus) || ((question === null || question === void 0 ? void 0 : question.finalAnswerCorrect) === true && stepStatus !== 'correct'); }
function errorType(question, errorLocation) {
    if ((question === null || question === void 0 ? void 0 : question.carelessType) === 'method_error')
        return '解题方法错误';
    if ((question === null || question === void 0 ? void 0 : question.carelessType) === 'knowledge_gap')
        return '知识点掌握错误';
    if ((question === null || question === void 0 ? void 0 : question.carelessType) !== 'careless')
        return '';
    if (/加法|相加/.test(errorLocation))
        return '加法计算粗心失误';
    if (/减法/.test(errorLocation))
        return '减法计算粗心失误';
    if (/乘法/.test(errorLocation))
        return '乘法计算粗心失误';
    if (/除法/.test(errorLocation))
        return '除法计算粗心失误';
    if (/符号|正负/.test(errorLocation))
        return '符号书写粗心失误';
    return '粗心失误';
}
function buildDetailQuestions(rawQuestions) {
    var source = Array.isArray(rawQuestions) ? rawQuestions : [];
    var rawBySourceKey = new Map(source.map(function (question) { return [cleanText(question === null || question === void 0 ? void 0 : question.sourceKey), question]; }));
    return (0, result_view_1.mapQuestions)(source).map(function (question) {
        var raw = rawBySourceKey.get(cleanText(question.sourceKey)) || {};
        if (!requiresAnalysis(raw))
            return __assign(__assign({}, question), { showAnalysis: false, correctCalculation: '', studentCalculation: '', errorLocation: '', errorTypeText: '' });
        var correctMethod = cleanText(raw.correctMethod);
        var standardAnswer = cleanText(raw.standardAnswer);
        var correctCalculation = correctMethod && comparable(correctMethod) !== comparable(standardAnswer) && !isInternalDecision(correctMethod) ? correctMethod : '';
        var studentCalculation = visibleErrorText(raw.studentCalculation);
        var errorLocation = visibleErrorText(raw.errorReason, raw.stepAnalysis, raw.briefFeedback);
        return __assign(__assign({}, question), { showAnalysis: true, correctCalculation: correctCalculation, studentCalculation: studentCalculation, errorLocation: errorLocation, errorTypeText: errorType(raw, errorLocation) });
    });
}
function buildCarelessTrainingQuestions(rawQuestions) { return (Array.isArray(rawQuestions) ? rawQuestions : []).map(function (q, index) { var studentRelationText = cleanText(q.studentRelationText), referenceRelationText = cleanText(q.referenceRelationText); var relationIssues = !q.relationCorrect && referenceRelationText ? (studentRelationText ? "\u5173\u7CFB\u586B\u5199\u9519\u8BEF\uFF0C\u6B63\u786E\u5173\u7CFB\u4E3A\uFF1A".concat(referenceRelationText) : "\u672A\u586B\u5199\u5173\u7CFB\uFF0C\u5E94\u586B\u5199\uFF1A".concat(referenceRelationText)) : __spreadArray([], __read(new Set((q.relationIssues || []).filter(Boolean).map(function (issue) { return ['未填写任何关系内容', '未填写关系', '关系为空', '没有填写关系'].includes(String(issue).trim()) ? '未填写，请补充题目中已知量之间的数学关系' : issue; }))), false).join('；'); return __assign(__assign({}, q), { number: index + 1, missingConditions: (q.missingConditions || []).filter(Boolean).join('；'), incorrectConditions: (q.incorrectConditions || []).filter(Boolean).join('；'), relationIssues: relationIssues }); }); }
function calculationState(q) { return (q === null || q === void 0 ? void 0 : q.carelessDetected) === true ? 'CAREFULNESS_FOUND' : (q === null || q === void 0 ? void 0 : q.carelessDetected) === null ? 'UNDETERMINED' : 'NO_CARELESS_FOUND'; }
function calculationStatus(q) { return q.calculationStatus || (q.processCorrect === true && q.finalAnswerCorrect === true ? 'CORRECT' : q.processCorrect == null || q.finalAnswerCorrect == null ? 'UNDETERMINED' : 'WRONG'); }
function calculationIssueCategory(q, status) { return q.issueCategory || (status === 'CORRECT' ? 'none' : status === 'UNDETERMINED' ? 'undetermined' : q.carelessDetected === true ? 'careless' : 'knowledge_or_method'); }
function buildCalculationCarelessSummary(questions) { var summary = { totalCount: questions.length, correctCount: 0, wrongCount: 0, carelessCount: 0, methodIssueCount: 0, undeterminedCount: 0, allCorrect: false }; questions.forEach(function (q) { if ((q === null || q === void 0 ? void 0 : q.issueCategory) === 'knowledge_or_method') summary.methodIssueCount += 1; if ((q === null || q === void 0 ? void 0 : q.analysisStatus) !== 'ok' || (q === null || q === void 0 ? void 0 : q.processCorrect) == null || (q === null || q === void 0 ? void 0 : q.finalAnswerCorrect) == null || (q === null || q === void 0 ? void 0 : q.carelessDetected) == null) summary.undeterminedCount += 1; else if ((q === null || q === void 0 ? void 0 : q.carelessDetected) === true) summary.carelessCount += 1; else if ((q === null || q === void 0 ? void 0 : q.processCorrect) === true && (q === null || q === void 0 ? void 0 : q.finalAnswerCorrect) === true) summary.correctCount += 1; else summary.wrongCount += 1; }); summary.allCorrect = summary.totalCount > 0 && summary.correctCount === summary.totalCount; return summary; }
function buildCalculationCarelessQuestions(rawQuestions) { return (Array.isArray(rawQuestions) ? rawQuestions : []).map(function (q, index) { var status = calculationStatus(q), issueCategory = calculationIssueCategory(q, status); return __assign(__assign({}, q), { number: index + 1, calculationStatus: status, issueCategory: issueCategory, calculationState: status, calculationLabel: { CORRECT: '\u8ba1\u7b97\u6b63\u786e', WRONG: '\u8ba1\u7b97\u9519\u8bef', UNDETERMINED: '\u65e0\u6cd5\u5224\u65ad' }[status], issueCategoryLabel: { none: '\u672a\u53d1\u73b0\u9519\u8bef', careless: '\u5b58\u5728\u9a6c\u864e', knowledge_or_method: '\u77e5\u8bc6\u6216\u65b9\u6cd5\u95ee\u9898', undetermined: '\u65e0\u6cd5\u5224\u65ad' }[issueCategory], carelessIssues: (q.carelessIssues || []).filter(Boolean).join('\u3001'), methodIssues: (q.methodIssues || []).filter(Boolean).join('\u3001') }); }); }
function isCarelessTrainingResult(task, questions) { return (task === null || task === void 0 ? void 0 : task.mode) === 'CARELESS_TRAINING' && questions.some(function (q) { return q && q.conditionCorrect !== undefined && q.relationCorrect !== undefined && q.askCorrect !== undefined; }); }
function getHardProblemQuestionState(question) {
    if ((question === null || question === void 0 ? void 0 : question.normalizedStatus) === 'UNREADABLE')
        return 'UNREADABLE';
    if ((question === null || question === void 0 ? void 0 : question.normalizedStatus) === 'UNANSWERED')
        return 'UNANSWERED';
    if ((question === null || question === void 0 ? void 0 : question.evaluationStatus) === 'UNREADABLE' || (question === null || question === void 0 ? void 0 : question.answerStatus) === 'unreadable' || (question === null || question === void 0 ? void 0 : question.errorType) === 'unreadable')
        return 'UNREADABLE';
    if ((question === null || question === void 0 ? void 0 : question.isUnanswered) === true || (question === null || question === void 0 ? void 0 : question.answerStatus) === 'unanswered' || (question === null || question === void 0 ? void 0 : question.errorType) === 'unanswered')
        return 'UNANSWERED';
    var stepStatus = cleanText(question === null || question === void 0 ? void 0 : question.stepStatus);
    if ((question === null || question === void 0 ? void 0 : question.isCorrect) === true && (question === null || question === void 0 ? void 0 : question.finalAnswerCorrect) === true && ['correct', 'not_required'].includes(stepStatus) && (question === null || question === void 0 ? void 0 : question.logicStatus) === 'correct')
        return 'FULLY_CORRECT';
    if ((question === null || question === void 0 ? void 0 : question.finalAnswerCorrect) === true && (question === null || question === void 0 ? void 0 : question.isCorrect) !== true)
        return 'ANSWER_CORRECT_PROCESS_WRONG';
    return 'WRONG';
}
function hardVisibleText(value) { var text = cleanText(value); return text && !/置信度|数据源|primary|review|merged|adjudicated|selectedSource|finalSource|第二次结果|选择第二个|采用复核结果/i.test(text) ? text : ''; }
function hardStudentProcess(value) { var text = hardVisibleText(value); return /^(correct long multiplication|correct partial products|partial products summed correctly|aligned by place value|sum is accurate|steps align|result is correct)$/i.test(text) ? '' : text; }
function hardErrorType(errorType) { return { calculation: '计算错误', transcription: '抄写错误', sign: '符号错误', formula: '公式使用错误', logic: '解题逻辑错误', unit: '单位错误', step_omission: '步骤缺失' }[String(errorType || '')] || ''; }
function buildHardProblemQuestions(rawQuestions) { return (Array.isArray(rawQuestions) ? rawQuestions : []).map(function (q, index) { var state = getHardProblemQuestionState(q); return __assign(__assign({}, q), { number: index + 1, hardState: state, hardLabel: { FULLY_CORRECT: '完全正确', ANSWER_CORRECT_PROCESS_WRONG: '结果正确，过程需要调整', WRONG: '回答错误', UNANSWERED: '未作答', UNREADABLE: '暂无法判断' }[state], studentAnswer: state === 'UNANSWERED' ? '未作答' : cleanText(q.studentAnswer), studentProcess: state === 'UNANSWERED' ? '' : hardStudentProcess(q.studentProcess), correctProcess: hardVisibleText(q.correctProcess), firstWrongStep: state === 'FULLY_CORRECT' || state === 'UNANSWERED' || state === 'UNREADABLE' ? '' : hardVisibleText(q.firstWrongStep), errorReason: state === 'FULLY_CORRECT' || state === 'UNANSWERED' ? '' : hardVisibleText(q.errorReason), adjustmentSuggestion: state === 'FULLY_CORRECT' || state === 'UNANSWERED' ? '' : hardVisibleText(q.adjustmentSuggestion), errorTypeText: state === 'WRONG' ? hardErrorType(q.errorType) : '' }); }); }
function isHardProblemResult(task) { return (task === null || task === void 0 ? void 0 : task.mode) === 'HARD_PROBLEM_CHECK' || (task === null || task === void 0 ? void 0 : task.mode) == null || (task === null || task === void 0 ? void 0 : task.mode) === ''; }
function buildHardProblemSummary(questions) {
    var e_1, _a;
    var summary = { totalCount: 0, fullyCorrectCount: 0, answerCorrectProcessWrongCount: 0, wrongCount: 0, unansweredCount: 0 };
    try {
        for (var _b = __values(questions || []), _c = _b.next(); !_c.done; _c = _b.next()) {
            var q = _c.value;
            summary.totalCount++;
            var state = q.hardState || getHardProblemQuestionState(q);
            if (state === 'FULLY_CORRECT')
                summary.fullyCorrectCount++;
            else if (state === 'ANSWER_CORRECT_PROCESS_WRONG')
                summary.answerCorrectProcessWrongCount++;
            else if (state === 'UNANSWERED')
                summary.unansweredCount++;
            else
                summary.wrongCount++;
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
        }
        finally { if (e_1) throw e_1.error; }
    }
    return summary;
}
function displayModeForResult(result) {
    var schemaVersion = cleanText(result === null || result === void 0 ? void 0 : result.outputSchemaVersion);
    if (schemaVersion === 'reading-careless.v2')
        return 'reading';
    if (schemaVersion === 'calculation-careless.v2')
        return 'calculation';
    return 'hard';
}
function displayQuestionNumber(question, index) {
    var questionNumber = Number(question === null || question === void 0 ? void 0 : question.questionNumber);
    if (Number.isInteger(questionNumber) && questionNumber > 0)
        return questionNumber;
    var printedQuestionNumber = Number(question === null || question === void 0 ? void 0 : question.printedQuestionNumber);
    return Number.isInteger(printedQuestionNumber) && printedQuestionNumber > 0 ? printedQuestionNumber : index + 1;
}
function displayText(value, fallback) { var text = cleanText(value); return text || fallback; }
function displayList(value) { return Array.isArray(value) ? value.map(function (item) { return cleanText(item); }) : cleanText(value) ? [cleanText(value)] : []; }
function hardConclusionLabel(status) { return { CORRECT: '回答正确', FULLY_CORRECT: '回答正确', WRONG: '回答错误', ANSWER_CORRECT_PROCESS_WRONG: '最终答案正确，过程或讲解需调整', UNANSWERED: '未作答', UNREADABLE: '暂无法判断' }[status] || '无法判断'; }
function judgementLabel(value) { return value === true ? '正确' : value === false ? '回答错误' : '无法判断'; }
function hardStepSolutionLabel(value) { return { correct: '正确', wrong: '错误', missing: '未写出', unreadable: '暂无法判断' }[cleanText(value)] || '无法判断'; }
function hardStepExplanationLabel(value) { return { clear: '讲解清楚', partially_clear: '讲解不完整', incorrect: '讲解错误', missing: '未写讲解', unreadable: '暂无法判断' }[cleanText(value)] || '无法判断'; }
function hardStepLogicLabel(value) { return { clear: '逻辑清楚', insufficient: '逻辑不充分', wrong: '逻辑错误', unreadable: '暂无法判断' }[cleanText(value)] || '无法判断'; }
function buildHardStepFeedbacks(value) {
    return (Array.isArray(value) ? value : []).map(function (step, index) {
        var solutionText = cleanText(step === null || step === void 0 ? void 0 : step.solutionText), explanationText = cleanText(step === null || step === void 0 ? void 0 : step.explanationText), correctionAdvice = cleanText(step === null || step === void 0 ? void 0 : step.correctionAdvice);
        var solutionStatus = cleanText(step === null || step === void 0 ? void 0 : step.solutionStatus), explanationStatus = cleanText(step === null || step === void 0 ? void 0 : step.explanationStatus);
        return {
            stepIndex: Number.isInteger(Number(step === null || step === void 0 ? void 0 : step.stepIndex)) && Number(step === null || step === void 0 ? void 0 : step.stepIndex) > 0 ? Number(step.stepIndex) : index + 1,
            solutionText: solutionText || (solutionStatus === 'unreadable' ? '解题过程无法识别' : '未写出解题过程'), explanationText: explanationText || (explanationStatus === 'unreadable' ? '对应讲解无法识别' : '未写出对应讲解'),
            solutionStatusText: hardStepSolutionLabel(step === null || step === void 0 ? void 0 : step.solutionStatus), explanationStatusText: hardStepExplanationLabel(step === null || step === void 0 ? void 0 : step.explanationStatus), logicStatusText: hardStepLogicLabel(step === null || step === void 0 ? void 0 : step.logicStatus),
            analysis: displayText(step === null || step === void 0 ? void 0 : step.analysis, '未提供分析'), correctionAdvice: correctionAdvice, showCorrectionAdvice: Boolean(correctionAdvice)
        };
    });
}
function readingConclusionLabel(status) { return { CORRECT: '回答正确', WRONG: '回答错误', INCOMPLETE: '填写不完整', UNDETERMINED: '无法判断' }[status] || '无法判断'; }
function calculationConclusion(question) {
    if ((question === null || question === void 0 ? void 0 : question.teacherOverrideApplied) === true) {
        var teacherStatus = cleanText(question === null || question === void 0 ? void 0 : question.teacherOverrideStatus) || cleanText(question === null || question === void 0 ? void 0 : question.normalizedStatus);
        if (teacherStatus === 'CORRECT') return '回答正确';
        if (teacherStatus === 'WRONG') return '回答错误';
    }
    if ((question === null || question === void 0 ? void 0 : question.carelessDetected) === true)
        return '存在马虎';
    if ((question === null || question === void 0 ? void 0 : question.carelessDetected) === false && (question === null || question === void 0 ? void 0 : question.calculationStatus) === 'CORRECT')
        return '回答正确';
    if ((question === null || question === void 0 ? void 0 : question.carelessDetected) === false && (question === null || question === void 0 ? void 0 : question.calculationStatus) === 'WRONG')
        return '回答错误';
    return '无法判断';
}
function buildDisplayQuestionLegacy(question, index, mode) {
    var base = { sourceKey: question === null || question === void 0 ? void 0 : question.sourceKey, number: displayQuestionNumber(question, index) };
    if (mode === 'reading')
        return __assign(__assign({}, base), { studentConditionText: displayText(question === null || question === void 0 ? void 0 : question.studentConditionText, '未填写'), studentRelationText: displayText(question === null || question === void 0 ? void 0 : question.studentRelationText, '未填写'), studentAskText: displayText(question === null || question === void 0 ? void 0 : question.studentAskText, '未填写'), referenceConditionText: displayText(question === null || question === void 0 ? void 0 : question.referenceConditionText, '无法确定'), referenceRelationText: displayText(question === null || question === void 0 ? void 0 : question.referenceRelationText, '无法确定'), referenceAskText: displayText(question === null || question === void 0 ? void 0 : question.referenceAskText, '无法确定'), conditionJudgement: judgementLabel(question === null || question === void 0 ? void 0 : question.conditionCorrect), relationJudgement: judgementLabel(question === null || question === void 0 ? void 0 : question.relationCorrect), askJudgement: judgementLabel(question === null || question === void 0 ? void 0 : question.askCorrect), threeGridStatus: cleanText(question === null || question === void 0 ? void 0 : question.threeGridStatus), conclusion: readingConclusionLabel(cleanText(question === null || question === void 0 ? void 0 : question.threeGridStatus)), errorReason: displayText(question === null || question === void 0 ? void 0 : question.errorReason, '未提供'), correctionAdvice: displayText(question === null || question === void 0 ? void 0 : question.correctionAdvice, '未提供') });
    if (mode === 'calculation')
        return __assign(__assign({}, base), { questionText: displayText(question === null || question === void 0 ? void 0 : question.questionText, '未提供'), studentCalculation: displayText(question === null || question === void 0 ? void 0 : question.studentCalculation, '未提供'), standardCalculation: displayText(question === null || question === void 0 ? void 0 : question.standardCalculation, '未提供'), calculationStatus: cleanText(question === null || question === void 0 ? void 0 : question.calculationStatus), processJudgement: judgementLabel(question === null || question === void 0 ? void 0 : question.processCorrect), finalAnswerJudgement: judgementLabel(question === null || question === void 0 ? void 0 : question.finalAnswerCorrect), carelessJudgement: (question === null || question === void 0 ? void 0 : question.carelessDetected) === true ? '存在马虎' : (question === null || question === void 0 ? void 0 : question.carelessDetected) === false ? '未发现马虎' : '无法判断', issueCategory: cleanText(question === null || question === void 0 ? void 0 : question.issueCategory), mainConclusion: calculationConclusion(question), firstErrorPoint: displayText(question === null || question === void 0 ? void 0 : question.firstErrorPoint, '未提供'), carelessIssues: displayList(question === null || question === void 0 ? void 0 : question.carelessIssues), methodIssues: displayList(question === null || question === void 0 ? void 0 : question.methodIssues), errorReason: displayText(question === null || question === void 0 ? void 0 : question.errorReason, '未提供'), correctionAdvice: displayText(question === null || question === void 0 ? void 0 : question.correctionAdvice, '未提供') });
    return __assign(__assign({}, base), { questionText: displayText(question === null || question === void 0 ? void 0 : question.questionText, '未提供'), studentAnswer: displayText(question === null || question === void 0 ? void 0 : question.studentAnswer, '未填写'), standardAnswer: displayText(question === null || question === void 0 ? void 0 : question.standardAnswer, '未提供'), evaluationStatus: cleanText(question === null || question === void 0 ? void 0 : question.evaluationStatus), conclusion: hardConclusionLabel(cleanText(question === null || question === void 0 ? void 0 : question.evaluationStatus)), stepStatus: cleanText(question === null || question === void 0 ? void 0 : question.stepStatus), logicStatus: cleanText(question === null || question === void 0 ? void 0 : question.logicStatus), firstWrongSteps: displayList(question === null || question === void 0 ? void 0 : question.firstWrongStep), errorReason: displayText(question === null || question === void 0 ? void 0 : question.errorReason, '未提供'), adjustmentSuggestion: displayText(question === null || question === void 0 ? void 0 : question.adjustmentSuggestion, '未提供') });
}
function detailList(value) { return (Array.isArray(value) ? value : [value]).map(cleanText).filter(Boolean); }
function detailIssueDetails() { var values = []; for (var _i = 0; _i < arguments.length; _i++) { values[_i] = arguments[_i]; } var details = []; values.forEach(function (value) { detailList(value).forEach(function (item) { if (!details.includes(item)) details.push(item); }); }); return details; }
function detailFirst() { var values = []; for (var _i = 0; _i < arguments.length; _i++) { values[_i] = arguments[_i]; } for (var _a = 0, values_1 = values; _a < values_1.length; _a++) { var value = values_1[_a]; var items = detailList(value); if (items.length) return items.join('；'); } return ''; }
function detailStatus(question, mode) {
    var normalizedStatus = cleanText(question === null || question === void 0 ? void 0 : question.normalizedStatus);
    if ((question === null || question === void 0 ? void 0 : question.teacherOverrideApplied) === true && ['CORRECT', 'WRONG'].includes(normalizedStatus)) return normalizedStatus;
    var evaluationStatus = cleanText(question === null || question === void 0 ? void 0 : question.evaluationStatus);
    var primaryStatus = normalizedStatus || evaluationStatus;
    if (['UNANSWERED', 'UNREADABLE', 'UNDETERMINED', 'CORRECT'].includes(primaryStatus)) return primaryStatus;
    if (mode === 'hard' && primaryStatus === 'WRONG' && (question === null || question === void 0 ? void 0 : question.finalAnswerCorrect) === true) {
        var stepStatus = cleanText(question === null || question === void 0 ? void 0 : question.stepStatus), logicStatus = cleanText(question === null || question === void 0 ? void 0 : question.logicStatus);
        if (((question === null || question === void 0 ? void 0 : question.stepRequired) === true && ['wrong', 'missing'].includes(stepStatus)) || ['wrong', 'insufficient'].includes(logicStatus)) return 'ANSWER_CORRECT_PROCESS_WRONG';
    }
    if (primaryStatus === 'WRONG') return 'WRONG';
    var statuses = [question === null || question === void 0 ? void 0 : question.hardState, question === null || question === void 0 ? void 0 : question.threeGridStatus, question === null || question === void 0 ? void 0 : question.calculationStatus].map(cleanText);
    if (statuses.includes('UNANSWERED')) return 'UNANSWERED';
    if (statuses.includes('UNREADABLE')) return 'UNREADABLE';
    if (statuses.includes('UNDETERMINED')) return 'UNDETERMINED';
    if (statuses.includes('CORRECT') || statuses.includes('FULLY_CORRECT')) return 'CORRECT';
    if (statuses.includes('WRONG') || statuses.includes('ANSWER_CORRECT_PROCESS_WRONG')) return 'WRONG';
    return statuses.includes('INCOMPLETE') ? 'INCOMPLETE' : 'UNDETERMINED';
}
function detailCorrectMethod(mode, question) {
    if (mode === 'reading') {
        var values = [];
        [['条件', question === null || question === void 0 ? void 0 : question.referenceConditionText], ['关系', question === null || question === void 0 ? void 0 : question.referenceRelationText], ['所求', question === null || question === void 0 ? void 0 : question.referenceAskText], ['', question === null || question === void 0 ? void 0 : question.correctionAdvice]].forEach(function (entry) { var text = cleanText(entry[1]); if (text) values.push(entry[0] ? "".concat(entry[0], "：").concat(text) : text); });
        return values.join('；');
    }
    if (mode === 'calculation') return cleanText(question === null || question === void 0 ? void 0 : question.standardCalculation);
    return detailFirst(question === null || question === void 0 ? void 0 : question.standardAnswer, question === null || question === void 0 ? void 0 : question.correctProcess, question === null || question === void 0 ? void 0 : question.correctMethod);
}
function detailErrorFields(mode, status, question) {
    if (!['WRONG', 'ANSWER_CORRECT_PROCESS_WRONG'].includes(status)) return { showErrorCard: false, errorLocation: '', errorReason: '', correctMethod: '', adjustmentSuggestion: '', errorFallbackMessage: '' };
    var errorLocation = '', errorReason = '', correctMethod = detailCorrectMethod(mode, question), adjustmentSuggestion = '';
    if (mode === 'hard') {
        errorLocation = detailFirst(question === null || question === void 0 ? void 0 : question.firstWrongStep, question === null || question === void 0 ? void 0 : question.firstErrorPoint, question === null || question === void 0 ? void 0 : question.stepAnalysis);
        errorReason = detailFirst(question === null || question === void 0 ? void 0 : question.errorReason, question === null || question === void 0 ? void 0 : question.briefFeedback);
        adjustmentSuggestion = detailFirst(question === null || question === void 0 ? void 0 : question.adjustmentSuggestion, question === null || question === void 0 ? void 0 : question.correctionAdvice);
    }
    else if (mode === 'reading') {
        errorReason = detailIssueDetails(question === null || question === void 0 ? void 0 : question.missingConditions, question === null || question === void 0 ? void 0 : question.incorrectConditions, question === null || question === void 0 ? void 0 : question.relationIssues, question === null || question === void 0 ? void 0 : question.askIssue, question === null || question === void 0 ? void 0 : question.errorReason).join('；');
    }
    else {
        errorLocation = cleanText(question === null || question === void 0 ? void 0 : question.firstErrorPoint);
        errorReason = detailIssueDetails(question === null || question === void 0 ? void 0 : question.carelessIssues, question === null || question === void 0 ? void 0 : question.methodIssues, question === null || question === void 0 ? void 0 : question.errorReason).join('；');
        adjustmentSuggestion = cleanText(question === null || question === void 0 ? void 0 : question.correctionAdvice);
    }
    return { showErrorCard: true, errorLocation: errorLocation, errorReason: errorReason, correctMethod: correctMethod, adjustmentSuggestion: adjustmentSuggestion, errorFallbackMessage: errorLocation || errorReason || correctMethod || adjustmentSuggestion ? '' : '本题已判定为回答错误，但具体错误说明生成不完整，请重新批改。' };
}
function detailConclusion(status) { return { CORRECT: '回答正确', FULLY_CORRECT: '回答正确', WRONG: '回答错误', ANSWER_CORRECT_PROCESS_WRONG: '最终答案正确，过程或讲解需调整', INCOMPLETE: '填写不完整', UNANSWERED: '未作答', UNREADABLE: '图片不可读', UNDETERMINED: '无法判断' }[status] || '无法判断'; }
function buildDisplayQuestion(question, index, mode) {
    var base = { sourceKey: question === null || question === void 0 ? void 0 : question.sourceKey, number: displayQuestionNumber(question, index) };
    if (mode === 'reading') {
        var status_1 = detailStatus(question, mode), errorFields_1 = detailErrorFields(mode, status_1, question);
        var readingTeacherCorrect = (question === null || question === void 0 ? void 0 : question.teacherOverrideApplied) === true && status_1 === 'CORRECT';
        var readingTeacherWrongOverAiCorrect = (question === null || question === void 0 ? void 0 : question.teacherOverrideApplied) === true && status_1 === 'WRONG' && cleanText(question === null || question === void 0 ? void 0 : question.threeGridStatus) === 'CORRECT';
        var readingOverrideLabel = readingTeacherWrongOverAiCorrect ? '以教师复核为准' : null;
        return __assign(__assign(__assign({}, base), { questionText: displayText(question === null || question === void 0 ? void 0 : question.questionText, '未提供'), studentConditionText: displayText(question === null || question === void 0 ? void 0 : question.studentConditionText, '未填写'), studentRelationText: displayText(question === null || question === void 0 ? void 0 : question.studentRelationText, '未填写'), studentAskText: displayText(question === null || question === void 0 ? void 0 : question.studentAskText, '未填写'), referenceConditionText: displayText(question === null || question === void 0 ? void 0 : question.referenceConditionText, ''), referenceRelationText: displayText(question === null || question === void 0 ? void 0 : question.referenceRelationText, ''), referenceAskText: displayText(question === null || question === void 0 ? void 0 : question.referenceAskText, ''), conditionJudgement: readingTeacherCorrect ? '正确' : readingOverrideLabel || judgementLabel(question === null || question === void 0 ? void 0 : question.conditionCorrect), relationJudgement: readingTeacherCorrect ? '正确' : readingOverrideLabel || judgementLabel(question === null || question === void 0 ? void 0 : question.relationCorrect), askJudgement: readingTeacherCorrect ? '正确' : readingOverrideLabel || judgementLabel(question === null || question === void 0 ? void 0 : question.askCorrect), threeGridStatus: status_1, conclusion: detailConclusion(status_1) }), errorFields_1);
    }
    if (mode === 'calculation') {
        var status_2 = detailStatus(question, mode), errorFields_2 = detailErrorFields(mode, status_2, question);
        var calculationTeacherCorrect = (question === null || question === void 0 ? void 0 : question.teacherOverrideApplied) === true && status_2 === 'CORRECT';
        var calculationTeacherWrongOverAiCorrect = (question === null || question === void 0 ? void 0 : question.teacherOverrideApplied) === true && status_2 === 'WRONG' && cleanText(question === null || question === void 0 ? void 0 : question.calculationStatus) === 'CORRECT';
        var calculationOverrideLabel = calculationTeacherWrongOverAiCorrect ? '以教师复核为准' : null;
        return __assign(__assign(__assign({}, base), { questionText: displayText(question === null || question === void 0 ? void 0 : question.questionText, ''), studentCalculation: displayText(question === null || question === void 0 ? void 0 : question.studentCalculation, ''), standardCalculation: displayText(question === null || question === void 0 ? void 0 : question.standardCalculation, ''), calculationStatus: status_2, processJudgement: calculationTeacherCorrect ? '正确' : calculationOverrideLabel || judgementLabel(question === null || question === void 0 ? void 0 : question.processCorrect), finalAnswerJudgement: calculationTeacherCorrect ? '正确' : calculationOverrideLabel || judgementLabel(question === null || question === void 0 ? void 0 : question.finalAnswerCorrect), carelessJudgement: calculationTeacherCorrect ? '未发现马虎' : calculationOverrideLabel || ((question === null || question === void 0 ? void 0 : question.carelessDetected) === true ? '存在马虎' : (question === null || question === void 0 ? void 0 : question.carelessDetected) === false ? '未发现马虎' : '无法判断'), issueCategory: calculationTeacherCorrect ? 'none' : cleanText(question === null || question === void 0 ? void 0 : question.issueCategory), mainConclusion: calculationConclusion(__assign(__assign({}, question), { calculationStatus: status_2 })), carelessIssues: status_2 === 'WRONG' && !calculationTeacherWrongOverAiCorrect ? detailList(question === null || question === void 0 ? void 0 : question.carelessIssues) : [], methodIssues: status_2 === 'WRONG' && !calculationTeacherWrongOverAiCorrect ? detailList(question === null || question === void 0 ? void 0 : question.methodIssues) : [] }), errorFields_2);
    }
    var status = detailStatus(question, mode), errorFields = detailErrorFields(mode, status, question);
    var teacherCorrect = (question === null || question === void 0 ? void 0 : question.teacherOverrideApplied) === true && status === 'CORRECT';
    var teacherWrongOverAiCorrect = (question === null || question === void 0 ? void 0 : question.teacherOverrideApplied) === true && status === 'WRONG' && cleanText(question === null || question === void 0 ? void 0 : question.evaluationStatus) === 'CORRECT';
    var stepStatus = teacherCorrect ? ((question === null || question === void 0 ? void 0 : question.stepRequired) === false ? 'not_required' : 'correct') : teacherWrongOverAiCorrect ? 'teacher_review' : cleanText(question === null || question === void 0 ? void 0 : question.stepStatus), logicStatus = teacherCorrect ? 'correct' : teacherWrongOverAiCorrect ? 'teacher_review' : cleanText(question === null || question === void 0 ? void 0 : question.logicStatus);
    var stepFeedbacks = teacherCorrect || teacherWrongOverAiCorrect ? [] : buildHardStepFeedbacks(question === null || question === void 0 ? void 0 : question.stepFeedbacks), overallFeedback = teacherCorrect || teacherWrongOverAiCorrect ? '' : cleanText(question === null || question === void 0 ? void 0 : question.overallFeedback);
    return __assign(__assign(__assign({}, base), { questionText: displayText(question === null || question === void 0 ? void 0 : question.questionText, ''), studentAnswer: displayText(question === null || question === void 0 ? void 0 : question.studentAnswer, '未填写'), standardAnswer: displayText(question === null || question === void 0 ? void 0 : question.standardAnswer, ''), evaluationStatus: status, conclusion: hardConclusionLabel(status), stepStatus: stepStatus, logicStatus: logicStatus, stepStatusText: teacherWrongOverAiCorrect ? '以教师复核为准' : ({ correct: '正确', wrong: '错误', missing: '缺少步骤', incomplete: '步骤不完整', unreadable: '暂无法判断', not_required: '无需步骤' }[stepStatus] || '无法判断'), logicStatusText: teacherWrongOverAiCorrect ? '以教师复核为准' : ({ correct: '正确', wrong: '错误', insufficient: '信息不足', unreadable: '暂无法判断' }[logicStatus] || '无法判断'), firstWrongSteps: ['WRONG', 'ANSWER_CORRECT_PROCESS_WRONG'].includes(status) && !teacherWrongOverAiCorrect ? detailList(question === null || question === void 0 ? void 0 : question.firstWrongStep) : [], stepFeedbacks: stepFeedbacks, hasStepFeedbacks: stepFeedbacks.length > 0, overallFeedback: overallFeedback, hasOverallFeedback: Boolean(overallFeedback) }), errorFields);
}
function buildDisplayQuestions(rawQuestions, mode) { return (Array.isArray(rawQuestions) ? rawQuestions : []).map(function (question, index) { return buildDisplayQuestion(question, index, mode); }); }
function buildDisplaySummary(summary) { var value = summary || {}; return { totalCount: value.totalCount == null ? 0 : value.totalCount, correctCount: value.correctCount == null ? 0 : value.correctCount, wrongCount: value.wrongCount == null ? 0 : value.wrongCount, incompleteCount: value.incompleteCount == null ? 0 : value.incompleteCount, carelessCount: value.carelessCount == null ? 0 : value.carelessCount }; }
Page({
    data: {
        loading: true, taskId: '', targetStudentId: '', viewerMode: '', errorMessage: '', task: null,
        homeworkImages: [], answerImages: [], questions: [], displayMode: 'hard', displayQuestions: [],
        summary: { totalCount: 0, correctCount: 0, wrongCount: 0, incompleteCount: 0, carelessCount: 0 },
        displaySummary: { totalCount: 0, correctCount: 0, wrongCount: 0, incompleteCount: 0, carelessCount: 0 },
        carelessTraining: false, calculationCarelessTraining: false, trainingQuestions: [], calculationQuestions: [], trainingSummary: { totalCount: 0, correctCount: 0, needsAdjustmentCount: 0, incompleteCount: 0 }, calculationSummary: { totalCount: 0, carelessCount: 0, noCarelessCount: 0, undeterminedCount: 0 },
        hardProblem: false, hardQuestions: [], hardSummary: { totalCount: 0, fullyCorrectCount: 0, answerCorrectProcessWrongCount: 0, wrongCount: 0, unansweredCount: 0 },
        audioNarration: null, voiceStatus: 'PENDING', audioPlaying: false, audioCurrent: 0, audioDuration: 0, audioCurrentText: '0:00', audioDurationText: '0:00', audioError: '',
    },
    audioContext: null,
    audioPollTimer: null,
    audioPollAttempts: 0,
    audioPollGeneration: 0,
    active: false,
    resultVisibilityRedirecting: false,
    resultVisibilityReady: false,
    onLoad: function (options) {
        var taskId = String(options.taskId || '').trim();
        var viewerMode = String(options.viewerMode || '') === 'teacher' ? 'teacher' : '';
        var targetStudentId = viewerMode ? String(options.targetStudentId || '').trim() : '';
        this.active = true;
        this.hasShown = false;
        this.resultVisibilityRedirecting = false;
        this.resultVisibilityReady = false;
        this.setData({ taskId: taskId, viewerMode: viewerMode, targetStudentId: targetStudentId });
        if (!taskId) {
            this.setData({ loading: false, errorMessage: '缺少任务编号' });
            return;
        }
        void this.loadTaskForCurrentUser();
    },
    onShow: function () {
        var wasActive = this.active;
        this.active = true;
        if (this.resultVisibilityReady && !this.resultVisibilityRedirecting && (this.hasShown || !wasActive) && this.data.taskId) {
            this.audioPollAttempts = 0;
            void this.loadTask();
        }
        this.hasShown = true;
    },
    loadTaskForCurrentUser: function () {
        return __awaiter(this, void 0, void 0, function () {
            var hidden, _1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(this.data.viewerMode !== 'teacher')) return [3 /*break*/, 4];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, (0, student_result_visibility_1.resolveCurrentStudentResultHidden)()];
                    case 2:
                        hidden = _a.sent();
                        if (hidden) {
                            this.resultVisibilityRedirecting = true;
                            this.stopAudioPolling();
                            wx.redirectTo({ url: (0, student_result_visibility_1.resultNoticeUrl)(this.data.taskId) });
                            return [2 /*return*/];
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        _1 = _a.sent();
                        return [3 /*break*/, 4];
                    case 4:
                        this.resultVisibilityReady = true;
                        return [4 /*yield*/, this.loadTask()];
                    case 5:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    },
    stopAudioPolling: function () {
        this.audioPollGeneration += 1;
        if (this.audioPollTimer) {
            clearTimeout(this.audioPollTimer);
            this.audioPollTimer = null;
        }
    },
    onHide: function () {
        this.active = false;
        this.stopAudioPolling();
    },
    loadTask: function () {
        return __awaiter(this, void 0, void 0, function () {
            var response, task, result, rawQuestions, displayMode, effectiveQuestionCount, questions, summary, displayQuestions, displaySummary, audioNarration, error_1;
            var _a, _b, _c, _d, _e, _f, _g;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        if (!this.data.taskId)
                            return [2 /*return*/];
                        this.setData({ loading: true, errorMessage: '' });
                        _h.label = 1;
                    case 1:
                        _h.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, (0, cloud_1.call)('getTask', this.data.viewerMode === 'teacher' ? { taskId: this.data.taskId, viewerMode: 'teacher', targetStudentId: this.data.targetStudentId } : { taskId: this.data.taskId })];
                    case 2:
                        response = _h.sent();
                        task = (response === null || response === void 0 ? void 0 : response.task) || {};
                        result = (response === null || response === void 0 ? void 0 : response.result) || {};
                        rawQuestions = Array.isArray(result.questions) ? result.questions : [];
                        displayMode = displayModeForResult(result);
                        effectiveQuestionCount = rawQuestions.length;
                        questions = rawQuestions;
                        summary = result.summary || {};
                        displayQuestions = buildDisplayQuestions(rawQuestions, displayMode);
                        displaySummary = buildDisplaySummary(summary);
                        audioNarration = result.audioNarration || null;
                        this.setData({
                            task: __assign(__assign({}, task), { questionCount: effectiveQuestionCount }),
                            homeworkImages: (0, result_view_1.normalizeImages)(task.homeworkImages),
                            answerImages: (0, result_view_1.normalizeImages)(task.answerImages),
                            questions: questions,
                            summary: summary,
                            displayMode: displayMode,
                            displayQuestions: displayQuestions,
                            displaySummary: displaySummary,
                            carelessTraining: false,
                            calculationCarelessTraining: false,
                            trainingQuestions: [], calculationQuestions: [], trainingSummary: { totalCount: 0, correctCount: 0, needsAdjustmentCount: 0, incompleteCount: 0 }, calculationSummary: { totalCount: 0, carelessCount: 0, noCarelessCount: 0, undeterminedCount: 0 },
                            hardProblem: false,
                            hardQuestions: [],
                            hardSummary: { totalCount: 0, fullyCorrectCount: 0, answerCorrectProcessWrongCount: 0, wrongCount: 0, unansweredCount: 0 },
                            audioNarration: audioNarration,
                            voiceStatus: String((task === null || task === void 0 ? void 0 : task.voiceStatus) || (audioNarration === null || audioNarration === void 0 ? void 0 : audioNarration.status) || 'PENDING'), audioPlaying: false, audioCurrent: 0, audioDuration: Number((audioNarration === null || audioNarration === void 0 ? void 0 : audioNarration.durationMs) || 0) / 1000, audioCurrentText: '0:00', audioDurationText: this.formatAudioTime(Number((audioNarration === null || audioNarration === void 0 ? void 0 : audioNarration.durationMs) || 0) / 1000), audioError: '',
                        });
                        this.startAudioPolling(audioNarration);
                        return [3 /*break*/, 5];
                    case 3:
                        error_1 = _h.sent();
                        this.setData({ errorMessage: String((error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || '批改结果加载失败') });
                        return [3 /*break*/, 5];
                    case 4:
                        this.setData({ loading: false });
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    },
    startAudioPolling: function (audioNarration) {
        var _this = this;
        this.stopAudioPolling();
        if (!this.active || !['PENDING', 'GENERATING', 'SYNTHESIZING'].includes(String((audioNarration === null || audioNarration === void 0 ? void 0 : audioNarration.status) || '')) || this.audioPollAttempts >= 15)
            return;
        var audioPollGeneration = this.audioPollGeneration;
        this.audioPollTimer = setTimeout(function () { return __awaiter(_this, void 0, void 0, function () {
            var response, next, audioNarrationStatus, _1;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        this.audioPollTimer = null;
                        if (!this.active || audioPollGeneration !== this.audioPollGeneration)
                            return [2 /*return*/];
                        this.audioPollAttempts += 1;
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, (0, cloud_1.getTaskStatus)(this.data.taskId, 20000, this.data.viewerMode === 'teacher' ? { viewerMode: 'teacher', targetStudentId: this.data.targetStudentId } : {})];
                    case 2:
                        response = _b.sent();
                        if (!this.active || audioPollGeneration !== this.audioPollGeneration)
                            return [2 /*return*/];
                        audioNarrationStatus = String((response === null || response === void 0 ? void 0 : response.audioNarrationStatus) || 'PENDING');
                        next = __assign(__assign({}, this.data.audioNarration || {}), { status: audioNarrationStatus });
                        this.setData({ audioNarration: next, voiceStatus: String((next === null || next === void 0 ? void 0 : next.status) || this.data.voiceStatus), audioDuration: Number((next === null || next === void 0 ? void 0 : next.durationMs) || 0) / 1000, audioDurationText: this.formatAudioTime(Number((next === null || next === void 0 ? void 0 : next.durationMs) || 0) / 1000) });
                        if (audioNarrationStatus === 'READY') {
                            this.stopAudioPolling();
                            void this.loadTask();
                            return [2 /*return*/];
                        }
                        if (audioNarrationStatus === 'FAILED') {
                            this.stopAudioPolling();
                            return [2 /*return*/];
                        }
                        this.startAudioPolling(next);
                        return [3 /*break*/, 4];
                    case 3:
                        _1 = _b.sent();
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        }); }, AUDIO_POLL_INTERVAL_MS);
    },
    retryLoad: function () { void this.loadTask(); },
    backToHistory: function () { wx.switchTab({ url: '/pages/history/index' }); },
    previewImage: function (e) {
        var images = e.currentTarget.dataset.type === 'answer' ? this.data.answerImages : this.data.homeworkImages;
        var urls = images.filter(function (item) { return item.tempUrl && !item.loadFailed; }).map(function (item) { return item.tempUrl; });
        var current = String(e.currentTarget.dataset.url || '');
        if (current && urls.includes(current))
            wx.previewImage({ current: current, urls: urls });
    },
    onImageError: function (e) {
        var _a;
        var key = e.currentTarget.dataset.type === 'answer' ? 'answerImages' : 'homeworkImages';
        this.setData((_a = {}, _a["".concat(key, "[").concat(Number(e.currentTarget.dataset.index), "].loadFailed")] = true, _a));
    },
    ensureAudio: function () {
        var _this = this;
        var _a;
        var source = String(((_a = this.data.audioNarration) === null || _a === void 0 ? void 0 : _a.tempUrl) || '');
        if (!source)
            return null;
        if (this.audioContext)
            return this.audioContext;
        var audio = wx.createInnerAudioContext();
        this.audioContext = audio;
        audio.src = source;
        audio.onTimeUpdate(function () { var current = Number(audio.currentTime || 0); var duration = Number(audio.duration || _this.data.audioDuration || 0); _this.setData({ audioCurrent: current, audioDuration: duration, audioCurrentText: _this.formatAudioTime(current), audioDurationText: _this.formatAudioTime(duration) }); });
        audio.onCanplay(function () { var duration = Number(audio.duration || _this.data.audioDuration || 0); _this.setData({ audioDuration: duration, audioDurationText: _this.formatAudioTime(duration) }); });
        audio.onEnded(function () { return _this.setData({ audioPlaying: false, audioCurrent: 0, audioCurrentText: '0:00' }); });
        audio.onError(function () { return _this.setData({ audioPlaying: false, audioError: '语音讲解播放失败' }); });
        return audio;
    },
    toggleAudio: function () { var audio = this.ensureAudio(); if (!audio)
        return; if (this.data.audioPlaying) {
        audio.pause();
        this.setData({ audioPlaying: false });
    }
    else {
        audio.play();
        this.setData({ audioPlaying: true, audioError: '' });
    } },
    seekAudio: function (e) { var audio = this.ensureAudio(); if (!audio)
        return; var value = Number(e.detail.value || 0); audio.seek(value); this.setData({ audioCurrent: value, audioCurrentText: this.formatAudioTime(value) }); },
    formatAudioTime: function (value) { var seconds = Math.max(0, Math.floor(Number(value || 0))); return "".concat(Math.floor(seconds / 60), ":").concat(String(seconds % 60).padStart(2, '0')); },
    onUnload: function () { this.active = false; this.stopAudioPolling(); if (this.audioContext) {
        this.audioContext.destroy();
        this.audioContext = null;
    } },
});
