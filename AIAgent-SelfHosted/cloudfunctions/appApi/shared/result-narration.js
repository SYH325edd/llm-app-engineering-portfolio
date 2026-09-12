"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NARRATION_VERSION = void 0;
exports.expectedSummaryText = expectedSummaryText;
exports.buildNarrationInput = buildNarrationInput;
exports.withResultNarration = withResultNarration;
exports.fallbackNarration = fallbackNarration;
exports.validateNarration = validateNarration;
exports.NARRATION_VERSION = 6;
const INTERNAL_TEXT = /置信度|数据源|primary|review|merged|adjudicated|selectedSource|finalSource|选择第二个结果|采用复核结果|模型返回|schema|json/i;
const HARD_MODES = ['HARD_PROBLEM_CHECK'];
function text(value) {
    const valueText = String(value ?? '').trim();
    return INTERNAL_TEXT.test(valueText) ? '' : valueText;
}
function questionNumber(question, index) {
    const number = Number(question?.questionNumber);
    if (Number.isInteger(number) && number > 0)
        return number;
    const matched = text(question?.sourceKey).match(/第?(\d+)题?/);
    return matched ? Number(matched[1]) : index + 1;
}
function modeForRead(mode) { return HARD_MODES.includes(String(mode || '')) ? 'HARD_PROBLEM_CHECK' : String(mode) === 'CARELESS_TRAINING' ? 'CARELESS_TRAINING' : 'HARD_PROBLEM_CHECK'; }
function isUnanswered(question) { return question?.isUnanswered === true || text(question?.answerStatus) === 'unanswered' || text(question?.errorType) === 'unanswered'; }
function hardState(question) {
    if (isUnanswered(question))
        return 'UNANSWERED';
    if (question?.isCorrect === true && question?.finalAnswerCorrect === true && ['correct', 'not_required'].includes(text(question?.stepStatus)) && text(question?.logicStatus) === 'correct')
        return 'FULLY_CORRECT';
    if (question?.finalAnswerCorrect === true && question?.isCorrect !== true)
        return 'ANSWER_CORRECT_PROCESS_WRONG';
    return 'WRONG';
}
function carelessState(question) {
    const status = text(question?.normalizedStatus || question?.threeGridStatus);
    if (status === 'CORRECT') return 'THREE_GRID_CORRECT';
    if (status === 'WRONG') return 'NEEDS_ADJUSTMENT';
    if (status === 'UNDETERMINED') return 'UNDETERMINED';
    if (question?.isCorrect === true && question?.conditionCorrect === true && question?.relationCorrect === true && question?.askCorrect === true)
        return 'THREE_GRID_CORRECT';
    return question?.analysisStatus && text(question.analysisStatus) !== 'ok' ? 'UNDETERMINED' : 'NEEDS_ADJUSTMENT';
}
function errorTypeText(errorType) {
    return { calculation: '计算环节出现错误', transcription: '抄写时出现错误', sign: '符号处理出现错误', formula: '公式使用出现错误', logic: '解题逻辑出现错误', unit: '单位处理出现错误', step_omission: '关键步骤缺失' }[text(errorType)] || '';
}
function append(parts, sentence) { if (sentence)
    parts.push(sentence); }
function adjustmentSuggestionForRead(value) {
    return text(value).replace(/^建议(?:[：:]|是)?\s*/, '');
}
function displayList(value) { return Array.isArray(value) ? value.map(text).filter(Boolean).join('、') : text(value); }
function expectedSummaryText(summary, mode = 'HARD_PROBLEM_CHECK') {
    if (modeForRead(mode) === 'CARELESS_TRAINING')
        return `本次共检测${Number(summary.totalCount || 0)}题，其中三格法填写正确${Number(summary.correctCount || 0)}题，需要调整${Number(summary.adjustCount || 0)}题，填写不完整${Number(summary.incompleteCount || 0)}题。`;
    return `本次共检测${Number(summary.totalCount || 0)}题，其中完全正确${Number(summary.fullyCorrectCount || 0)}题，结果正确但过程需要调整${Number(summary.answerCorrectProcessWrongCount || 0)}题，回答错误${Number(summary.wrongCount || 0)}题，未作答${Number(summary.unansweredCount || 0)}题。`;
}
function encouragement(summary, mode) {
    if (mode === 'CARELESS_TRAINING') {
        if (summary.totalCount > 0 && summary.correctCount === summary.totalCount)
            return '这次条件、关系和所求都整理得很清楚，保持先审题再计算的习惯。';
        return '这次没关系，下次先找出题目给了什么，再把条件、关系和所求分别写清楚，完成后检查一遍。';
    }
    if (summary.totalCount > 0 && summary.fullyCorrectCount === summary.totalCount)
        return '这次答案、步骤和逻辑都很完整，继续保持这样的检查习惯。';
    if (summary.answerCorrectProcessWrongCount > 0)
        return '你的最终思路已经接近正确，把刚才指出的过程再检查一遍，答案会更稳定。';
    if (summary.wrongCount > 0 && summary.fullyCorrectCount > 0)
        return '已经有一部分题目完成得很好，先改正第一处错误，再重新验算后面的步骤。';
    return '先从题目给出的条件开始，一步一步写清过程，不着急，完成后再逐步检查。';
}
function hardQuestion(question, index) {
    return {
        sourceKey: text(question.sourceKey), questionNumber: questionNumber(question, index), state: hardState(question),
        studentAnswer: text(question.studentAnswer), standardAnswer: text(question.standardAnswer), studentProcess: text(question.studentProcess || question.studentCalculation), correctProcess: text(question.correctProcess || question.correctMethod),
        finalAnswerCorrect: question?.finalAnswerCorrect === true, stepStatus: text(question.stepStatus), logicStatus: text(question.logicStatus), isCorrect: question?.isCorrect === true,
        errorType: text(question.errorType), firstWrongStep: text(question.firstWrongStep || question.stepAnalysis), errorReason: text(question.errorReason || question.briefFeedback), adjustmentSuggestion: text(question.adjustmentSuggestion),
        isUnanswered: isUnanswered(question), answerStatus: text(question.answerStatus),
    };
}
function carelessQuestion(question, index) {
    return {
        sourceKey: text(question.sourceKey), questionNumber: questionNumber(question, index), state: carelessState(question),
        studentConditionText: text(question.studentConditionText), studentRelationText: text(question.studentRelationText), studentAskText: text(question.studentAskText),
        referenceConditionText: text(question.referenceConditionText), referenceRelationText: text(question.referenceRelationText), referenceAskText: text(question.referenceAskText),
        conditionCorrect: question?.conditionCorrect === true, relationCorrect: question?.relationCorrect === true, askCorrect: question?.askCorrect === true,
        missingConditions: displayList(question.missingConditions), incorrectConditions: displayList(question.incorrectConditions), relationIssues: displayList(Array.isArray(question.relationIssues) ? [...new Set(question.relationIssues.map((issue) => ['未填写任何关系内容', '未填写关系', '关系为空', '没有填写关系'].includes(String(issue).trim()) ? '未填写，请补充题目中已知量之间的数学关系' : issue))] : ['未填写任何关系内容', '未填写关系', '关系为空', '没有填写关系'].includes(text(question.relationIssues)) ? '未填写，请补充题目中已知量之间的数学关系' : question.relationIssues), askIssue: text(question.askIssue),
        formatAligned: question?.formatAligned !== false, threeGridComplete: question?.threeGridComplete === true, isCorrect: question?.isCorrect === true, adjustmentSuggestion: text(question.adjustmentSuggestion),
    };
}
function buildNarrationInput(result, taskMode) {
    const mode = modeForRead(taskMode || result?.mode);
    const source = Array.isArray(result?.questions) ? result.questions : [];
    const questions = source.map(mode === 'CARELESS_TRAINING' ? carelessQuestion : hardQuestion).sort((left, right) => left.questionNumber - right.questionNumber).map((question, index) => ({ ...question, questionNumber: index + 1 }));
    const summary = mode === 'CARELESS_TRAINING'
        ? questions.reduce((value, question) => { value.totalCount += 1; if (question.state === 'THREE_GRID_CORRECT')
            value.correctCount += 1; else if (question.state === 'UNDETERMINED') value.incompleteCount += 1; else value.needsAdjustmentCount += 1; return value; }, { totalCount: 0, correctCount: 0, incompleteCount: 0, needsAdjustmentCount: 0 })
        : questions.reduce((value, question) => { value.totalCount += 1; if (question.state === 'FULLY_CORRECT')
            value.fullyCorrectCount += 1;
        else if (question.state === 'ANSWER_CORRECT_PROCESS_WRONG')
            value.answerCorrectProcessWrongCount += 1;
        else if (question.state === 'UNANSWERED')
            value.unansweredCount += 1;
        else
            value.wrongCount += 1; return value; }, { totalCount: 0, fullyCorrectCount: 0, answerCorrectProcessWrongCount: 0, wrongCount: 0, unansweredCount: 0 });
    if (mode === 'CARELESS_TRAINING') {
        summary.adjustCount = summary.needsAdjustmentCount;
    }
    return { mode, summary, expectedSummaryText: expectedSummaryText(summary, mode), expectedEncouragement: encouragement(summary, mode), questions };
}
function withResultNarration(questions) { return { questions: (Array.isArray(questions) ? questions : []).map((question, index) => ({ ...question, questionNumber: questionNumber(question, index) })), resultNarrationText: '' }; }
function hardItemNarration(question) {
    const prefix = `第${question.questionNumber}题`;
    if (question.state === 'FULLY_CORRECT')
        return `${prefix}完全正确。`;
    if (question.state === 'UNANSWERED')
        return `${prefix}未作答。请先尝试写出关键步骤。`;
    const parts = [question.state === 'ANSWER_CORRECT_PROCESS_WRONG' ? `${prefix}最终结果正确，但解题过程需要调整。` : `${prefix}回答错误。`];
    const student = question.studentProcess || question.studentAnswer;
    const correct = question.correctProcess || question.standardAnswer;
    append(parts, student ? `学生的计算为${student}。` : '');
    append(parts, correct ? `正确的计算为${correct}。` : '');
    append(parts, question.firstWrongStep ? `第一处问题出现在${question.firstWrongStep}。` : '');
    append(parts, question.errorReason ? `原因是${question.errorReason}。` : '');
    append(parts, errorTypeText(question.errorType) ? `${errorTypeText(question.errorType)}。` : '');
    const adjustmentSuggestion = adjustmentSuggestionForRead(question.adjustmentSuggestion);
    append(parts, adjustmentSuggestion ? `建议${adjustmentSuggestion}。` : '');
    return parts.join('');
}
function carelessItemNarration(question) {
    const prefix = `第${question.questionNumber}题`;
    if (question.state === 'THREE_GRID_CORRECT')
        return `${prefix}三格法填写正确，条件、关系和所求都已经列清楚。${question.formatAligned === false ? '内容判断正确，下次可以分别写入条件、关系和求三个区域，检查起来会更清楚。' : ''}`;
    const parts = [`${prefix}三格法需要调整。`];
    const conditionIssue = question.missingConditions ? `遗漏了${question.missingConditions}` : question.incorrectConditions ? question.incorrectConditions : '';
    append(parts, !question.conditionCorrect && conditionIssue ? `条件部分${conditionIssue}。` : '');
    const referenceRelationText = text(question.referenceRelationText);
    const relationGuidance = !question.relationCorrect && referenceRelationText
        ? (text(question.studentRelationText) ? `关系填写错误，正确关系为：${referenceRelationText}` : `未填写关系，应填写：${referenceRelationText}`)
        : text(question.relationIssues);
    append(parts, !question.relationCorrect && relationGuidance ? `关系部分${relationGuidance}。` : '');
    append(parts, !question.askCorrect && question.askIssue ? `所求部分${question.askIssue}。` : '');
    const adjustmentSuggestion = adjustmentSuggestionForRead(question.adjustmentSuggestion);
    append(parts, adjustmentSuggestion ? `建议${adjustmentSuggestion}。` : '');
    return parts.join('');
}
function itemNarration(question, mode) { return mode === 'CARELESS_TRAINING' ? carelessItemNarration(question) : hardItemNarration(question); }
function fallbackNarration(input) {
    return [text(input?.expectedSummaryText) || expectedSummaryText(input?.summary, input?.mode), ...(input?.questions || []).map((question) => itemNarration(question, input?.mode)), text(input?.expectedEncouragement) || encouragement(input?.summary || {}, modeForRead(input?.mode))].filter(Boolean).join('');
}
function validateNarration(output, input) {
    const summaryText = text(output?.summaryText);
    const endingText = text(output?.endingText);
    const items = Array.isArray(output?.items) ? output.items : [];
    const expected = Array.isArray(input?.questions) ? input.questions : [];
    if (summaryText !== text(input?.expectedSummaryText) || endingText !== text(input?.expectedEncouragement) || items.length !== expected.length)
        return null;
    for (let index = 0; index < expected.length; index += 1) {
        const question = expected[index], item = items[index], value = text(item?.text);
        if (text(item?.sourceKey) !== question.sourceKey || !value || value.length > 420)
            return null;
        if (input.mode === 'CARELESS_TRAINING') {
            const referenceRelationText = text(question.referenceRelationText);
            if (!question.relationCorrect && referenceRelationText && !value.includes(referenceRelationText))
                return null;
            if (/(学生答案|正确答案|最终答案|计算过程|回答正确|回答错误|calculation|transcription|sign|formula|logic|unit|step_omission)/i.test(value))
                return null;
            if (question.state === 'THREE_GRID_CORRECT' ? value !== `第${question.questionNumber}题三格法填写正确，条件、关系和所求都已经列清楚。${question.formatAligned === false ? '内容判断正确，下次可以分别写入条件、关系和求三个区域，检查起来会更清楚。' : ''}` : !value.includes('三格法需要调整'))
                return null;
        }
        else {
            if (/(马虎|粗心|careless)/i.test(value))
                return null;
            if (question.state === 'FULLY_CORRECT' ? value !== `第${question.questionNumber}题完全正确。` : question.state === 'ANSWER_CORRECT_PROCESS_WRONG' ? !value.includes('最终结果正确，但解题过程需要调整') : question.state === 'UNANSWERED' ? !value.includes('未作答') : !value.includes('回答错误'))
                return null;
        }
    }
    return { summaryText, endingText, items: items.map((item) => ({ sourceKey: text(item.sourceKey), text: text(item.text) })), text: [summaryText, ...items.map((item) => text(item.text)), endingText].join('') };
}
