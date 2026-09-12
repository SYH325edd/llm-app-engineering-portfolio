"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeImages = normalizeImages;
exports.mapQuestions = mapQuestions;
exports.normalizeCarelessTrainingSummary = normalizeCarelessTrainingSummary;
function normalizeImages(images) {
    return (Array.isArray(images) ? images : []).map(function (image, index) { return ({
        fileId: String((image === null || image === void 0 ? void 0 : image.fileId) || '').trim(), tempUrl: String((image === null || image === void 0 ? void 0 : image.tempUrl) || '').trim(), index: Number((image === null || image === void 0 ? void 0 : image.index) || index + 1), loadFailed: Boolean(image === null || image === void 0 ? void 0 : image.loadFailed),
    }); });
}
function text(value) { return String(value || '').trim(); }
function normalizeCarelessTrainingSummary(summary) {
    var source = summary && typeof summary === 'object' ? summary : {};
    var count = function (value) { var number = Number(value); return Number.isFinite(number) ? number : 0; };
    var firstDefined = function (primary, legacy) { return source[primary] !== undefined && source[primary] !== null ? source[primary] : source[legacy]; };
    return {
        totalCount: count(source.totalCount),
        correctCount: count(source.correctCount),
        needsAdjustmentCount: count(firstDefined('wrongCount', 'needsAdjustmentCount')),
        incompleteCount: count(firstDefined('undeterminedCount', 'incompleteCount')),
        carelessCount: count(source.carelessCount)
    };
}
function meaningfulReason(value) {
    var reason = text(value);
    return /^(正确|错误|回答正确|回答错误)$/.test(reason) ? '' : reason;
}
function mapQuestions(items) {
    return (Array.isArray(items) ? items : []).map(function (item, index) {
        if ((item === null || item === void 0 ? void 0 : item.outputSchemaVersion) === 'hard-problem.v2') {
            var evaluationStatus = (item === null || item === void 0 ? void 0 : item.normalizedStatus) || (item === null || item === void 0 ? void 0 : item.evaluationStatus) || ((item === null || item === void 0 ? void 0 : item.answerStatus) === 'unanswered' ? 'UNANSWERED' : (item === null || item === void 0 ? void 0 : item.answerStatus) === 'unreadable' ? 'UNREADABLE' : (item === null || item === void 0 ? void 0 : item.isCorrect) ? 'CORRECT' : 'WRONG');
            var processNeedsAdjustment = ((item === null || item === void 0 ? void 0 : item.finalAnswerCorrect) === true && evaluationStatus === 'WRONG') || evaluationStatus === 'ANSWER_CORRECT_PROCESS_WRONG';
            var hardResultState = processNeedsAdjustment ? 'process_wrong' : { CORRECT: 'correct', WRONG: 'wrong', UNANSWERED: 'unanswered', UNREADABLE: 'unreadable' }[evaluationStatus] || 'wrong';
            var answerStatus_1 = hardResultState === 'process_wrong' ? 'wrong' : hardResultState;
            return {
                number: index + 1, sourceKey: text(item === null || item === void 0 ? void 0 : item.sourceKey) || "第".concat(index + 1, "题"), questionText: text(item === null || item === void 0 ? void 0 : item.questionText),
                studentAnswer: text(item === null || item === void 0 ? void 0 : item.studentAnswer), correctAnswer: text(item === null || item === void 0 ? void 0 : item.standardAnswer), answerStatus: answerStatus_1, hardResultState: hardResultState,
                answerLabel: hardResultState === 'process_wrong' ? '最终答案正确，过程或讲解需调整' : { correct: '回答正确', wrong: '回答错误', unanswered: '未作答', unreadable: '暂无法判断' }[answerStatus_1], evaluationStatus: evaluationStatus,
                finalAnswerCorrect: item === null || item === void 0 ? void 0 : item.finalAnswerCorrect, stepRequired: item === null || item === void 0 ? void 0 : item.stepRequired, stepStatus: item === null || item === void 0 ? void 0 : item.stepStatus, logicStatus: item === null || item === void 0 ? void 0 : item.logicStatus,
                errorType: item === null || item === void 0 ? void 0 : item.errorType, firstWrongStep: text(item === null || item === void 0 ? void 0 : item.firstWrongStep), errorReason: text(item === null || item === void 0 ? void 0 : item.errorReason), adjustmentSuggestion: text(item === null || item === void 0 ? void 0 : item.adjustmentSuggestion), knowledgePoint: text(item === null || item === void 0 ? void 0 : item.knowledgePoint),
                stepFeedbacks: Array.isArray(item === null || item === void 0 ? void 0 : item.stepFeedbacks) ? item.stepFeedbacks.map(function (step) { return ({ stepIndex: Number(step === null || step === void 0 ? void 0 : step.stepIndex), solutionText: text(step === null || step === void 0 ? void 0 : step.solutionText), explanationText: text(step === null || step === void 0 ? void 0 : step.explanationText), solutionStatus: text(step === null || step === void 0 ? void 0 : step.solutionStatus), explanationStatus: text(step === null || step === void 0 ? void 0 : step.explanationStatus), logicStatus: text(step === null || step === void 0 ? void 0 : step.logicStatus), analysis: text(step === null || step === void 0 ? void 0 : step.analysis), correctionAdvice: text(step === null || step === void 0 ? void 0 : step.correctionAdvice) }); }) : [],
                stepFeedbackCount: Array.isArray(item === null || item === void 0 ? void 0 : item.stepFeedbacks) ? item.stepFeedbacks.length : 0,
                overallFeedback: text(item === null || item === void 0 ? void 0 : item.overallFeedback)
            };
        }
        if ((item === null || item === void 0 ? void 0 : item.outputSchemaVersion) === 'reading-careless.v2') {
            var analysisStatus = String((item === null || item === void 0 ? void 0 : item.analysisStatus) || 'insufficient');
            var threeGridStatus = (item === null || item === void 0 ? void 0 : item.normalizedStatus) || (item === null || item === void 0 ? void 0 : item.threeGridStatus) || (analysisStatus !== 'ok' ? 'UNDETERMINED' : (item === null || item === void 0 ? void 0 : item.conditionCorrect) === true && (item === null || item === void 0 ? void 0 : item.relationCorrect) === true && (item === null || item === void 0 ? void 0 : item.askCorrect) === true ? 'CORRECT' : 'WRONG');
            return {
                number: index + 1, sourceKey: text(item === null || item === void 0 ? void 0 : item.sourceKey) || "第".concat(index + 1, "题"), questionText: text(item === null || item === void 0 ? void 0 : item.questionText), analysisStatus: analysisStatus,
                threeGridStatus: threeGridStatus, threeGridLabel: analysisStatus === 'unreadable' ? '图片不可读' : analysisStatus === 'insufficient' ? '信息不足' : threeGridStatus === 'CORRECT' ? '三格判断正确' : '三格存在问题',
                conditionCorrect: item === null || item === void 0 ? void 0 : item.conditionCorrect, relationCorrect: item === null || item === void 0 ? void 0 : item.relationCorrect, askCorrect: item === null || item === void 0 ? void 0 : item.askCorrect,
                studentConditionText: text(item === null || item === void 0 ? void 0 : item.studentConditionText), studentRelationText: text(item === null || item === void 0 ? void 0 : item.studentRelationText), studentAskText: text(item === null || item === void 0 ? void 0 : item.studentAskText),
                missingConditions: Array.isArray(item === null || item === void 0 ? void 0 : item.missingConditions) ? item.missingConditions : [], relationIssues: Array.isArray(item === null || item === void 0 ? void 0 : item.relationIssues) ? item.relationIssues : [], askIssue: text(item === null || item === void 0 ? void 0 : item.askIssue), errorReason: text(item === null || item === void 0 ? void 0 : item.errorReason), correctionAdvice: text(item === null || item === void 0 ? void 0 : item.correctionAdvice)
            };
        }
        if ((item === null || item === void 0 ? void 0 : item.outputSchemaVersion) === 'calculation-careless.v2') {
            var analysisStatus_1 = String((item === null || item === void 0 ? void 0 : item.analysisStatus) || 'insufficient');
            var calculationStatus = String((item === null || item === void 0 ? void 0 : item.normalizedStatus) || (item === null || item === void 0 ? void 0 : item.calculationStatus) || (analysisStatus_1 !== 'ok' || (item === null || item === void 0 ? void 0 : item.processCorrect) == null || (item === null || item === void 0 ? void 0 : item.finalAnswerCorrect) == null ? 'UNDETERMINED' : (item === null || item === void 0 ? void 0 : item.processCorrect) === true && (item === null || item === void 0 ? void 0 : item.finalAnswerCorrect) === true ? 'CORRECT' : 'WRONG'));
            var carelessDetected = item === null || item === void 0 ? void 0 : item.carelessDetected;
            var answerStatus_2 = calculationStatus === 'CORRECT' ? 'correct' : calculationStatus === 'WRONG' ? 'wrong' : 'uncertain';
            var carelessStatus_1 = analysisStatus_1 !== 'ok' || carelessDetected == null ? 'uncertain' : carelessDetected === true ? 'careless' : 'not_careless';
            var carelessIssues = Array.isArray(item === null || item === void 0 ? void 0 : item.carelessIssues) ? item.carelessIssues.filter(Boolean).join('；') : '';
            var methodIssues = Array.isArray(item === null || item === void 0 ? void 0 : item.methodIssues) ? item.methodIssues.filter(Boolean).join('；') : '';
            return {
                number: index + 1,
                sourceKey: text(item === null || item === void 0 ? void 0 : item.sourceKey) || "第".concat(index + 1, "题"),
                questionText: text(item === null || item === void 0 ? void 0 : item.questionText) || '未识别',
                studentAnswer: text(item === null || item === void 0 ? void 0 : item.studentCalculation) || '未识别',
                correctAnswer: text(item === null || item === void 0 ? void 0 : item.standardCalculation) || '未识别',
                answerStatus: answerStatus_2,
                answerLabel: calculationStatus === 'CORRECT' ? '计算正确' : calculationStatus === 'UNDETERMINED' ? '无法判断' : carelessDetected === true ? '计算中存在马虎' : '回答错误',
                carelessStatus: carelessStatus_1,
                carelessLabel: carelessStatus_1 === 'careless' ? '存在马虎' : carelessStatus_1 === 'not_careless' ? '未发现明显马虎' : '无法判断是否马虎',
                judgementReason: meaningfulReason(item === null || item === void 0 ? void 0 : item.firstErrorPoint),
                errorReason: answerStatus_2 === 'wrong' && carelessDetected !== true ? meaningfulReason(methodIssues || (item === null || item === void 0 ? void 0 : item.errorReason)) : '',
                carelessReason: carelessStatus_1 === 'careless' ? meaningfulReason(carelessIssues || (item === null || item === void 0 ? void 0 : item.errorReason)) : '',
                calculationStatus: calculationStatus,
                analysisStatus: analysisStatus_1,
                processCorrect: item === null || item === void 0 ? void 0 : item.processCorrect,
                finalAnswerCorrect: item === null || item === void 0 ? void 0 : item.finalAnswerCorrect,
                carelessDetected: carelessDetected,
                issueCategory: text(item === null || item === void 0 ? void 0 : item.issueCategory)
            };
        }
        var answerStatus = (item === null || item === void 0 ? void 0 : item.unreadable) ? 'uncertain' : (item === null || item === void 0 ? void 0 : item.isCorrect) ? 'correct' : 'wrong';
        var carelessStatus = (item === null || item === void 0 ? void 0 : item.unreadable) ? 'uncertain' : ((item === null || item === void 0 ? void 0 : item.carelessType) && item.carelessType !== 'none') ? 'careless' : 'not_careless';
        return {
            number: index + 1,
            sourceKey: text(item === null || item === void 0 ? void 0 : item.sourceKey) || "\u7B2C".concat(index + 1, "\u9898"),
            questionText: text(item === null || item === void 0 ? void 0 : item.questionText) || '未识别',
            studentAnswer: text(item === null || item === void 0 ? void 0 : item.studentAnswer) || '未识别',
            correctAnswer: text(item === null || item === void 0 ? void 0 : item.standardAnswer) || '未识别',
            answerStatus: answerStatus,
            answerLabel: answerStatus === 'correct' ? '回答正确' : answerStatus === 'wrong' ? '回答错误' : '无法判断',
            carelessStatus: carelessStatus,
            carelessLabel: carelessStatus === 'careless' ? '存在马虎' : carelessStatus === 'not_careless' ? '未发现明显马虎' : '无法判断是否马虎',
            judgementReason: meaningfulReason(item === null || item === void 0 ? void 0 : item.briefFeedback),
            errorReason: answerStatus === 'wrong' ? meaningfulReason(item === null || item === void 0 ? void 0 : item.errorReason) : '',
            carelessReason: carelessStatus === 'careless' ? meaningfulReason(item === null || item === void 0 ? void 0 : item.carelessReason) : '',
        };
    });
}
