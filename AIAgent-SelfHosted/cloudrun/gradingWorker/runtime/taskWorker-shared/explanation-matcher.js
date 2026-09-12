'use strict';

function text(value) { return String(value || '').trim(); }
function numbers(value) { return text(value).match(/\d+(?:\.\d+)?/g) || []; }
function variables(value) { return text(value).match(/[a-zA-Z]/g) || []; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function chineseBigrams(value) {
  const compact = text(value).replace(/[^\u4e00-\u9fff]/g, '');
  const out = [];
  for (let i = 0; i + 1 < compact.length; i += 1) out.push(compact.slice(i, i + 2));
  return unique(out).filter((token) => !['这步','一步','这个','可以','进行','得到','根据','所以','然后','学生','正确','数量'].includes(token));
}
function intersectionSize(left, right) {
  const set = new Set(right);
  return unique(left).filter((item) => set.has(item)).length;
}
function semanticSignals(explanation, step) {
  const exp = text(explanation);
  const target = [step?.stepTitle, step?.solutionText, step?.analysis].map(text).filter(Boolean).join(' ');
  let score = 0;
  const commonNumbers = intersectionSize(numbers(exp), numbers(target));
  score += Math.min(6, commonNumbers * 3);
  const commonVariables = intersectionSize(variables(exp.toLowerCase()), variables(target.toLowerCase()));
  score += Math.min(3, commonVariables);
  const operations = [
    [/(相加|加起来|求和|总数|总量|合计)/, /[+＋]|相加|求和|总数|总量|合计/],
    [/(相减|减去|差|剩下)/, /[-－−]|相减|减去|差|剩下/],
    [/(相乘|乘以|倍|倍数)/, /[×*]|相乘|乘以|倍/],
    [/(相除|除以|平均|每份)/, /[÷/]|相除|除以|平均|每份/],
    [/(方程|解方程|设|未知数)/, /[=＝]|方程|未知数|[xXyY]/],
  ];
  for (const [expPattern, targetPattern] of operations) if (expPattern.test(exp) && targetPattern.test(target)) score += 3;
  const commonBigrams = intersectionSize(chineseBigrams(exp), chineseBigrams(target));
  score += Math.min(8, commonBigrams * 2);
  if (/求出|得到|得出|解得/.test(exp) && /求出|得到|得出|解得|=|＝/.test(target)) score += 1;
  return score;
}

function realignHardProblemExplanations(inputSteps) {
  const steps = (Array.isArray(inputSteps) ? inputSteps : []).map((step) => ({ ...step }));
  const sourceSteps = steps.map((step) => ({ ...step }));
  for (let index = 0; index < steps.length; index += 1) {
    const target = steps[index];
    if (text(target.explanationText) || target.explanationStatus !== 'missing') continue;
    if (!text(target.solutionText) || ['missing', 'unreadable'].includes(target.solutionStatus)) continue;
    const candidates = [index - 1, index + 1]
      .filter((candidateIndex) => candidateIndex >= 0 && candidateIndex < steps.length)
      .map((candidateIndex) => ({ candidateIndex, step: sourceSteps[candidateIndex] }))
      .filter(({ step }) => text(step.explanationText) && ['clear', 'partially_clear'].includes(step.explanationStatus))
      .map(({ candidateIndex, step }) => {
        const targetScore = semanticSignals(step.explanationText, target);
        const ownScore = semanticSignals(step.explanationText, step);
        const targetText = [target?.stepTitle, target?.solutionText, target?.analysis].map(text).filter(Boolean).join(' ');
        const concreteOverlap = intersectionSize(numbers(step.explanationText), numbers(targetText)) > 0
          || intersectionSize(variables(text(step.explanationText).toLowerCase()), variables(targetText.toLowerCase())) > 0
          || intersectionSize(chineseBigrams(step.explanationText), chineseBigrams(targetText)) >= 3;
        return { candidateIndex, step, targetScore, totalScore: targetScore + Math.min(4, ownScore) + 2, concreteOverlap };
      })
      .filter((candidate) => candidate.targetScore >= 3 && candidate.totalScore >= 9 && (candidate.targetScore >= 5 || candidate.concreteOverlap))
      .sort((a, b) => b.totalScore - a.totalScore || Math.abs(a.candidateIndex - index) - Math.abs(b.candidateIndex - index));
    const best = candidates[0];
    if (!best) continue;
    target.explanationText = text(best.step.explanationText); // exact student-authored text only
    target.explanationStatus = best.step.explanationStatus;
    target.matchedExplanationSourceStepIndex = best.candidateIndex + 1;
    if (target.solutionStatus === 'correct' && target.explanationStatus === 'clear' && target.logicStatus === 'clear') {
      target.analysis = '该步解题过程、对应讲解和数学逻辑均正确。';
      target.correctionAdvice = '';
    }
  }
  return steps;
}

module.exports = { realignHardProblemExplanations, semanticSignals };
