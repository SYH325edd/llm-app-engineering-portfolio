"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NARRATION_VERSION = void 0;
exports.expectedSummaryText = expectedSummaryText;
exports.buildNarrationInput = buildNarrationInput;
exports.withResultNarration = withResultNarration;
exports.fallbackNarration = fallbackNarration;
exports.validateNarration = validateNarration;
exports.NARRATION_VERSION = 13;
const INTERNAL_TEXT = /置信度|数据源|primary|review|merged|adjudicated|selectedSource|finalSource|选择第二个结果|采用复核结果|模型返回|schema|json/i;
const HARD_MODES = ['HARD_PROBLEM_CHECK'];
const CALCULATION_CARELESS_MODE = 'CALCULATION_CARELESS';
function text(value) {
    const valueText = String(value ?? '').trim();
    return INTERNAL_TEXT.test(valueText) ? '' : valueText;
}
function questionNumber(question, index) {
    const number = Number(question?.questionNumber);
    if (Number.isInteger(number) && number > 0)
        return number;
    const printedNumber = Number(question?.printedQuestionNumber);
    if (Number.isInteger(printedNumber) && printedNumber > 0)
        return printedNumber;
    const matched = text(question?.sourceKey).match(/第(\d+)(?:小题|题)/);
    return matched ? Number(matched[1]) : index + 1;
}
function modeForRead(mode, result) {
    if (String(mode || '') === CALCULATION_CARELESS_MODE || result?.outputSchemaVersion === 'calculation-careless.v2' || result?.carelessTrainingType === 'CALCULATION')
        return CALCULATION_CARELESS_MODE;
    return HARD_MODES.includes(String(mode || '')) ? 'HARD_PROBLEM_CHECK' : String(mode) === 'CARELESS_TRAINING' ? 'CARELESS_TRAINING' : 'HARD_PROBLEM_CHECK';
}
function isUnanswered(question) { return question?.isUnanswered === true || text(question?.answerStatus) === 'unanswered' || text(question?.errorType) === 'unanswered'; }
function hardState(question) {
    if (question?.teacherOverrideApplied === true && question?.teacherOverrideStatus === 'CORRECT') return 'FULLY_CORRECT';
    if (question?.teacherOverrideApplied === true && question?.teacherOverrideStatus === 'WRONG') return 'WRONG';
    const status = text(question?.normalizedStatus || question?.evaluationStatus);
    if (status === 'UNANSWERED') return 'UNANSWERED';
    if (status === 'UNREADABLE') return 'UNREADABLE';
    if (status === 'UNDETERMINED') return 'UNDETERMINED';
    if (isUnanswered(question)) return 'UNANSWERED';
    if (question?.finalAnswerCorrect === true && ((text(question?.stepStatus) && !['correct', 'not_required'].includes(text(question?.stepStatus))) || (text(question?.logicStatus) && text(question?.logicStatus) !== 'correct'))) return 'ANSWER_CORRECT_PROCESS_WRONG';
    if (status === 'CORRECT' || (question?.finalAnswerCorrect === true && question?.isCorrect === true && ['correct', 'not_required'].includes(text(question?.stepStatus)) && text(question?.logicStatus) === 'correct')) return 'FULLY_CORRECT';
    return 'WRONG';
}
function carelessState(question) {
    if (question?.teacherOverrideApplied === true && question?.teacherOverrideStatus === 'CORRECT') return 'THREE_GRID_CORRECT';
    if (question?.teacherOverrideApplied === true && question?.teacherOverrideStatus === 'WRONG') return 'NEEDS_ADJUSTMENT';
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
    return text(value).replace(/^建议(?:[：:]|是)?\s*/, '').replace(/[。！？!?]+$/, '');
}
function narrationValue(value) { return text(value).replace(/[。！？!?]+$/, ''); }
function displayList(value) { return Array.isArray(value) ? value.map(text).filter(Boolean).join('、') : text(value); }
function expectedSummaryText(summary, mode = 'HARD_PROBLEM_CHECK') {
    if (modeForRead(mode) === 'CARELESS_TRAINING')
        return `本次共检查${Number(summary?.totalCount || 0)}道题，其中回答正确${Number(summary?.correctCount || 0)}道，回答错误${Number(summary?.wrongCount || 0)}道，填写不完整${Number(summary?.incompleteCount || 0)}道。`;
    if (modeForRead(mode) === CALCULATION_CARELESS_MODE)
        return `本次共检查${Number(summary?.totalCount || 0)}道题，其中回答正确${Number(summary?.correctCount || 0)}道，回答错误${Number(summary?.wrongCount || 0)}道，存在马虎${Number(summary?.carelessCount || 0)}道。`;
    return `本次共批改${Number(summary?.totalCount || 0)}道题，其中回答正确${Number(summary?.correctCount || 0)}道，回答错误${Number(summary?.wrongCount || 0)}道，未作答或无法判断${Number(summary?.incompleteCount || 0)}道。`;
}
function encouragement(summary, mode, questions = []) {
    const list = Array.isArray(questions) ? questions : [];
    if (mode === 'HARD_PROBLEM_CHECK') {
        if (list.length > 0 && list.every((question) => question.state === 'FULLY_CORRECT'))
            return '这次答案、步骤和逻辑都很完整，继续保持。';
        const unanswered = list.find((question) => question.state === 'UNANSWERED');
        if (unanswered)
            return `第${unanswered.questionNumber}题先写出第一步或主要过程，再继续完成。`;
        const question = list.find((item) => item.state === 'ANSWER_CORRECT_PROCESS_WRONG') || list.find((item) => item.state === 'WRONG');
        if (question) {
            const advice = adjustmentSuggestionForRead(question.adjustmentSuggestion);
            if (advice)
                return `第${question.questionNumber}题${advice}。`;
            const detail = text(question.firstWrongStep) || text(question.errorReason);
            return question.state === 'ANSWER_CORRECT_PROCESS_WRONG'
                ? `第${question.questionNumber}题答案正确，请调整${detail || '解题步骤和逻辑'}。`
                : `第${question.questionNumber}题请订正${detail || '第一处错误步骤'}，再检查逻辑。`;
        }
        return '请写出完整的步骤和逻辑，再核对答案。';
    }
    if (mode === 'CARELESS_TRAINING') {
        if (list.length > 0 && list.every((question) => question.state === 'THREE_GRID_CORRECT'))
            return '这次审题和信息整理很清楚，继续保持。';
        const question = list.find((item) => text(item.missingConditions) || text(item.relationIssues) || text(item.askIssue) || text(item.correctionAdvice));
        if (question) {
            const advice = adjustmentSuggestionForRead(question.correctionAdvice);
            if (advice)
                return `第${question.questionNumber}题${advice}。`;
            if (text(question.missingConditions))
                return `第${question.questionNumber}题请先整理条件。`;
            if (text(question.relationIssues))
                return `第${question.questionNumber}题请梳理数量关系。`;
            return `第${question.questionNumber}题请确认所求。`;
        }
        return '请把条件、数量关系和所求整理清楚。';
    }
    if (mode === CALCULATION_CARELESS_MODE) {
        const safeText = (value) => displayList(value).replace(/三格|条件|关系|所求|先审题再计算/g, '');
        if (list.length > 0 && list.every((question) => (question.teacherOverrideApplied === true && question.teacherOverrideStatus === 'CORRECT') || question.state === 'CORRECT'))
            return '这次计算过程和结果都正确，继续保持。';
        const teacherWrong = list.find((question) => question.teacherOverrideApplied === true && question.teacherOverrideStatus === 'WRONG');
        if (teacherWrong) return `第${teacherWrong.questionNumber}题请根据教师复核结果订正。`;
        const active = list.filter((question) => !(question.teacherOverrideApplied === true && question.teacherOverrideStatus === 'CORRECT'));
        const carelessQuestion = active.find((question) => question.carelessDetected === true || question.issueCategory === 'careless' || safeText(question.carelessIssues));
        if (carelessQuestion) {
            const advice = safeText(carelessQuestion.correctionAdvice);
            const issue = safeText(carelessQuestion.carelessIssues) || safeText(carelessQuestion.firstErrorPoint);
            return `第${carelessQuestion.questionNumber}题请按提示检查：${advice || issue || '逐步核对计算'}。`;
        }
        const methodQuestion = active.find((question) => question.issueCategory === 'knowledge_or_method' || safeText(question.methodIssues));
        if (methodQuestion) {
            const advice = safeText(methodQuestion.correctionAdvice);
            const issue = safeText(methodQuestion.methodIssues) || safeText(methodQuestion.firstErrorPoint);
            return `第${methodQuestion.questionNumber}题请重新确认公式和方法：${advice || issue || '补全关键步骤'}。`;
        }
        return '请补全计算过程，方便继续判断。';
    }
    return encouragement(summary, 'HARD_PROBLEM_CHECK', list);
}
function hardQuestion(question, index) {
    return {
        sourceKey: narrationSourceKey(question), questionNumber: questionNumber(question, index), state: hardState(question), normalizedStatus: text(question.normalizedStatus || question.evaluationStatus || hardState(question)), teacherOverrideApplied: question?.teacherOverrideApplied === true, teacherOverrideStatus: text(question?.teacherOverrideStatus),
        studentAnswer: text(question.studentAnswer), standardAnswer: text(question.standardAnswer), studentProcess: text(question.studentProcess || question.studentCalculation), correctProcess: text(question.correctProcess || question.correctMethod),
        finalAnswerCorrect: question?.finalAnswerCorrect ?? null, stepRequired: question?.stepRequired ?? null, stepStatus: text(question.stepStatus), logicStatus: text(question.logicStatus), isCorrect: question?.isCorrect === true,
        errorType: text(question.errorType), firstWrongStep: question?.firstWrongStep ?? question?.stepAnalysis ?? '', errorReason: text(question.errorReason || question.briefFeedback), adjustmentSuggestion: text(question.adjustmentSuggestion),
        stepFeedbacks: (Array.isArray(question?.stepFeedbacks) ? question.stepFeedbacks : []).map((step, stepIndex) => ({
            stepIndex: Number.isInteger(Number(step?.stepIndex)) && Number(step?.stepIndex) > 0 ? Number(step.stepIndex) : stepIndex + 1,
            solutionText: text(step?.solutionText), explanationText: text(step?.explanationText), solutionStatus: text(step?.solutionStatus), explanationStatus: text(step?.explanationStatus), logicStatus: text(step?.logicStatus), analysis: text(step?.analysis), correctionAdvice: text(step?.correctionAdvice),
        })),
        overallFeedback: text(question.overallFeedback),
        isUnanswered: isUnanswered(question), answerStatus: text(question.answerStatus),
    };
}
function carelessQuestion(question, index) {
    return {
        sourceKey: narrationSourceKey(question), questionNumber: questionNumber(question, index), state: carelessState(question), analysisStatus: text(question.analysisStatus), threeGridStatus: text(question.threeGridStatus),
        studentConditionText: text(question.studentConditionText), studentRelationText: text(question.studentRelationText), studentAskText: text(question.studentAskText),
        referenceConditionText: text(question.referenceConditionText), referenceRelationText: text(question.referenceRelationText), referenceAskText: text(question.referenceAskText),
        conditionCorrect: question?.conditionCorrect ?? null, relationCorrect: question?.relationCorrect ?? null, askCorrect: question?.askCorrect ?? null,
        missingConditions: displayList(question.missingConditions), incorrectConditions: displayList(question.incorrectConditions), relationIssues: displayList(Array.isArray(question.relationIssues) ? [...new Set(question.relationIssues.map((issue) => ['未填写任何关系内容', '未填写关系', '关系为空', '没有填写关系'].includes(String(issue).trim()) ? '未填写，请补充题目中已知量之间的数学关系' : issue))] : ['未填写任何关系内容', '未填写关系', '关系为空', '没有填写关系'].includes(text(question.relationIssues)) ? '未填写，请补充题目中已知量之间的数学关系' : question.relationIssues), askIssue: text(question.askIssue),
        formatAligned: question?.formatAligned !== false, threeGridComplete: question?.threeGridComplete === true, isCorrect: question?.isCorrect === true, correctionAdvice: text(question.correctionAdvice || question.adjustmentSuggestion), errorReason: text(question.errorReason), adjustmentSuggestion: text(question.adjustmentSuggestion || question.correctionAdvice),
    };
}
function calculationQuestion(question, index) {
    return {
        sourceKey: narrationSourceKey(question), questionNumber: questionNumber(question, index), state: text(question.normalizedStatus || question.calculationStatus || question.analysisStatus),
        teacherOverrideApplied: question?.teacherOverrideApplied === true, teacherOverrideStatus: text(question?.teacherOverrideStatus),
        analysisStatus: text(question.analysisStatus), calculationStatus: text(question.calculationStatus), processCorrect: question?.processCorrect ?? null, finalAnswerCorrect: question?.finalAnswerCorrect ?? null,
        carelessDetected: question?.carelessDetected ?? null, issueCategory: text(question.issueCategory), firstErrorPoint: question?.firstErrorPoint ?? '',
        carelessIssues: question?.carelessIssues ?? [], methodIssues: question?.methodIssues ?? [], errorReason: text(question.errorReason), correctionAdvice: text(question.correctionAdvice),
        studentCalculation: text(question.studentCalculation), standardCalculation: text(question.standardCalculation),
    };
}
function narrationSourceKey(question) {
    const sourceKey = question?.sourceKey;
    if (typeof sourceKey !== 'string' || !sourceKey.trim()) {
        const error = new Error('Narration input requires a non-empty sourceKey.');
        error.code = 'NARRATION_SOURCE_KEY_INVALID';
        throw error;
    }
    return sourceKey;
}
function validateNarrationQuestions(source, questions) {
    if (questions.length !== source.length) {
        const error = new Error('Narration input question count does not match result.questions.');
        error.code = 'NARRATION_SOURCE_KEY_INVALID';
        throw error;
    }
    const sourceKeys = new Set();
    for (const question of questions) {
        if (!question.sourceKey || sourceKeys.has(question.sourceKey)) {
            const error = new Error('Narration input requires unique non-empty sourceKey values.');
            error.code = 'NARRATION_SOURCE_KEY_INVALID';
            throw error;
        }
        sourceKeys.add(question.sourceKey);
    }
}
function buildNarrationInput(result, taskMode) {
    const mode = modeForRead(taskMode || result?.mode, result);
    const source = Array.isArray(result?.questions) ? result.questions : [];
    const questionBuilder = mode === 'CARELESS_TRAINING' ? carelessQuestion : mode === CALCULATION_CARELESS_MODE ? calculationQuestion : hardQuestion;
    const questions = source.map(questionBuilder);
    validateNarrationQuestions(source, questions);
    const summary = deriveNarrationSummary(questions, mode);
    return { mode, summary, expectedSummaryText: expectedSummaryText(summary, mode), expectedEncouragement: encouragement(summary, mode, questions), questions };
}
function deriveNarrationSummary(questions, mode) {
    const summary = { totalCount: questions.length, correctCount: 0, wrongCount: 0, incompleteCount: 0, carelessCount: 0 };
    for (const question of questions) {
        if (mode === CALCULATION_CARELESS_MODE) {
            if (question.teacherOverrideApplied === true && question.teacherOverrideStatus === 'CORRECT') summary.correctCount += 1;
            else if (question.teacherOverrideApplied === true && question.teacherOverrideStatus === 'WRONG') summary.wrongCount += 1;
            else if (question.carelessDetected === true) summary.carelessCount += 1;
            else if (question.carelessDetected == null || question.state === 'UNDETERMINED') summary.incompleteCount += 1;
            else if (question.processCorrect === true && question.finalAnswerCorrect === true) summary.correctCount += 1;
            else summary.wrongCount += 1;
            continue;
        }
        if (mode === 'CARELESS_TRAINING') {
            if (question.state === 'THREE_GRID_CORRECT') summary.correctCount += 1;
            else if (question.state === 'UNDETERMINED') summary.incompleteCount += 1;
            else summary.wrongCount += 1;
            continue;
        }
        if (question.state === 'FULLY_CORRECT') summary.correctCount += 1;
        else if (question.state === 'WRONG' || question.state === 'ANSWER_CORRECT_PROCESS_WRONG') summary.wrongCount += 1;
        else summary.incompleteCount += 1;
    }
    return summary;
}
function withResultNarration(questions) { return { questions: (Array.isArray(questions) ? questions : []).map((question, index) => ({ ...question, questionNumber: questionNumber(question, index) })), resultNarrationText: '' }; }
function hardStepStatusText(step) {
    return {
        solution: { correct: '解题过程正确', wrong: '解题过程错误', missing: '没有写出解题过程', unreadable: '解题过程无法识别' }[step.solutionStatus] || '解题过程无法判断',
        explanation: { clear: '讲解清楚', partially_clear: '讲解不完整', incorrect: '讲解错误', missing: '没有写对应讲解', unreadable: '讲解无法识别' }[step.explanationStatus] || '讲解无法判断',
        logic: { clear: '逻辑清楚', insufficient: '逻辑不充分', wrong: '逻辑错误', unreadable: '逻辑无法识别' }[step.logicStatus] || '逻辑无法判断',
    };
}
function hardStepNarration(step) {
    const labels = hardStepStatusText(step);
    const parts = [`第${step.stepIndex}步。`];
    append(parts, step.solutionText ? `解题过程是：${step.solutionText}。` : step.solutionStatus === 'unreadable' ? '这一步的解题过程无法识别。' : '学生没有写出这一步的解题过程。');
    append(parts, step.explanationText ? `学生解释是：${step.explanationText}。` : step.explanationStatus === 'unreadable' ? '这一步的对应讲解无法识别。' : '学生没有写出这一步的对应讲解。');
    append(parts, `${labels.solution}，${labels.explanation}，${labels.logic}。`);
    append(parts, step.analysis ? `分析：${narrationValue(step.analysis)}。` : '');
    const advice = adjustmentSuggestionForRead(step.correctionAdvice);
    append(parts, advice ? `改进建议：${advice}。` : '');
    return parts.join('');
}
function hardItemNarration(question) {
    const prefix = `第${question.questionNumber}题`;
    if (question.state === 'FULLY_CORRECT') return `${prefix}回答正确。`;
    if (question.state === 'UNANSWERED') return `${prefix}未作答。`;
    if (question.state === 'UNREADABLE' || question.state === 'UNDETERMINED') return `${prefix}当前无法准确判断，请检查作答是否完整清晰。`;
    const parts = [`${prefix}回答错误。`];
    const steps = Array.isArray(question.stepFeedbacks) ? question.stepFeedbacks : [];
    for (const step of steps) {
        const problems = [];
        if (step.solutionStatus && step.solutionStatus !== 'correct') append(problems, hardStepStatusText(step).solution);
        if (step.explanationStatus && step.explanationStatus !== 'clear') append(problems, hardStepStatusText(step).explanation);
        if (step.logicStatus && step.logicStatus !== 'clear') append(problems, hardStepStatusText(step).logic);
        if (!problems.length) continue;
        const detail = [`第${step.stepIndex}步${problems.join('，')}。`];
        append(detail, step.analysis ? `分析：${narrationValue(step.analysis)}。` : '');
        const stepAdvice = adjustmentSuggestionForRead(step.correctionAdvice);
        append(detail, stepAdvice ? `改进建议：${stepAdvice}。` : '');
        parts.push(detail.join(''));
    }
    const wrongSteps = displayList(question.firstWrongStep);
    append(parts, wrongSteps ? `错误步骤包括：${narrationValue(wrongSteps)}。` : '');
    append(parts, question.errorReason ? `原因是${narrationValue(question.errorReason)}。` : '');
    const advice = adjustmentSuggestionForRead(question.adjustmentSuggestion);
    append(parts, advice ? `建议${advice}。` : '');
    return parts.join('');
}
function carelessItemNarration(question) {
    const prefix = `第${question.questionNumber}题`;
    if (question.state === 'THREE_GRID_CORRECT') return `${prefix}回答正确，条件、关系和所求都填写准确。`;
    if (question.state === 'UNDETERMINED') return `${prefix}当前无法准确判断，请检查作答是否完整清晰。`;
    const parts = [];
    const wrongGrids = [];
    if (question.conditionCorrect === false) wrongGrids.push(['条件', text(question.referenceConditionText)]);
    if (question.relationCorrect === false) wrongGrids.push(['关系', text(question.referenceRelationText)]);
    if (question.askCorrect === false) wrongGrids.push(['所求', text(question.referenceAskText)]);
    if (!wrongGrids.length) return `${prefix}当前无法准确判断，请检查作答是否完整清晰。`;
    for (const [label, reference] of wrongGrids) {
        const sentence = `${prefix}${label}有问题。`;
        parts.push(reference ? `${sentence}正确${label}应为：${reference}。` : sentence);
    }
    return parts.join('');
}
function calculationItemNarration(question) {
    const prefix = `第${question.questionNumber}题`;
    if (question.teacherOverrideApplied === true && question.teacherOverrideStatus === 'CORRECT') return `${prefix}计算正确。`;
    if (question.teacherOverrideApplied === true && question.teacherOverrideStatus === 'WRONG') return `${prefix}经教师复核需要订正。`;
    if (question.state === 'UNDETERMINED' || question.carelessDetected == null) return `${prefix}当前无法判断是否存在计算马虎，请检查作答过程是否完整清晰。`;
    if (question.carelessDetected === true) {
        const parts = [`${prefix}存在马虎。`];
        append(parts, displayList(question.firstErrorPoint) ? `错误步骤包括：${narrationValue(displayList(question.firstErrorPoint))}。` : '');
        append(parts, displayList(question.carelessIssues) ? `马虎点包括：${narrationValue(displayList(question.carelessIssues))}。` : '');
        append(parts, question.errorReason ? `原因是：${narrationValue(question.errorReason)}。` : '');
        const advice = adjustmentSuggestionForRead(question.correctionAdvice);
        append(parts, advice ? `建议${advice}。` : '');
        return parts.join('');
    }
    if (question.processCorrect === true && question.finalAnswerCorrect === true) return `${prefix}计算正确。`;
    const parts = [`${prefix}回答错误，但没有发现明显计算马虎。`];
    append(parts, displayList(question.firstErrorPoint) ? `错误步骤包括：${narrationValue(displayList(question.firstErrorPoint))}。` : '');
    append(parts, displayList(question.methodIssues) ? `方法问题包括：${narrationValue(displayList(question.methodIssues))}。` : '');
    append(parts, question.errorReason ? `原因是：${narrationValue(question.errorReason)}。` : '');
    const advice = adjustmentSuggestionForRead(question.correctionAdvice);
    append(parts, advice ? `建议${advice}。` : '');
    return parts.join('');
}
function itemNarration(question, mode) { return mode === 'CARELESS_TRAINING' ? carelessItemNarration(question) : mode === CALCULATION_CARELESS_MODE ? calculationItemNarration(question) : hardItemNarration(question); }
function fallbackNarration(input) {
    return [text(input?.expectedSummaryText) || expectedSummaryText(input?.summary, input?.mode), ...(input?.questions || []).map((question) => itemNarration(question, input?.mode)), text(input?.expectedEncouragement) || encouragement(input?.summary || {}, modeForRead(input?.mode), input?.questions || [])].filter(Boolean).join('');
}
function validateNarration(output, input) {
    const summaryText = text(output?.summaryText);
    const endingText = text(output?.endingText);
    const items = Array.isArray(output?.items) ? output.items : [];
    const expected = Array.isArray(input?.questions) ? input.questions : [];
    if (summaryText !== text(input?.expectedSummaryText) || endingText !== text(input?.expectedEncouragement) || items.length !== expected.length) return null;
    for (let index = 0; index < expected.length; index += 1) {
        const question = expected[index], item = items[index], value = text(item?.text);
        const stepCount = input.mode === 'HARD_PROBLEM_CHECK' && Array.isArray(question.stepFeedbacks) ? question.stepFeedbacks.length : 0;
        const maxLength = stepCount > 0 ? Math.min(8000, 700 + stepCount * 900) : 420;
        if (text(item?.sourceKey) !== question.sourceKey || !value || value.length > maxLength) return null;
        const expectedText = itemNarration(question, input.mode);
        if (value !== expectedText) return null;
    }
    return { summaryText, endingText, items: items.map((item) => ({ sourceKey: text(item.sourceKey), text: text(item.text) })), text: [summaryText, ...items.map((item) => text(item.text)), endingText].join('') };
}
