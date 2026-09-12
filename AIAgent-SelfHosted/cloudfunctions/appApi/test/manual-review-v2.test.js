'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../index');

test('teacher correct override makes reading-careless fields internally consistent instead of leaving wrong grid flags behind', () => {
  const [q] = __test.normalizeReviewedQuestions([{
    outputSchemaVersion:'reading-careless.v2', sourceKey:'r1', questionText:'题目', isCorrect:true,
    threeGridStatus:'WRONG', analysisStatus:'ok', conditionCorrect:false, relationCorrect:true, askCorrect:false,
    studentConditionText:'A', studentRelationText:'B', studentAskText:'C', missingConditions:['D'], relationIssues:[], askIssue:'所求错', errorReason:'旧错误', correctionAdvice:'旧建议'
  }]);
  assert.equal(q.teacherOverrideApplied, true);
  assert.equal(q.normalizedStatus, 'CORRECT');
  assert.equal(q.threeGridStatus, 'CORRECT');
  assert.deepEqual([q.conditionCorrect, q.relationCorrect, q.askCorrect], [true,true,true]);
  assert.deepEqual(q.missingConditions, []);
  assert.equal(q.askIssue, '');
  assert.equal(q.errorReason, '');
});

test('teacher correct override makes calculation-careless result mutually consistent and clears stale careless evidence', () => {
  const [q] = __test.normalizeReviewedQuestions([{
    outputSchemaVersion:'calculation-careless.v2', sourceKey:'c1', questionText:'题目', isCorrect:true,
    calculationStatus:'WRONG', analysisStatus:'ok', processCorrect:false, finalAnswerCorrect:false,
    carelessDetected:true, issueCategory:'careless', carelessIssues:['抄错'], methodIssues:[], firstErrorPoint:'第1步', errorReason:'旧错误', correctionAdvice:'旧建议'
  }]);
  assert.equal(q.normalizedStatus, 'CORRECT');
  assert.equal(q.calculationStatus, 'CORRECT');
  assert.equal(q.processCorrect, true);
  assert.equal(q.finalAnswerCorrect, true);
  assert.equal(q.carelessDetected, false);
  assert.equal(q.issueCategory, 'none');
  assert.deepEqual(q.carelessIssues, []);
  assert.equal(q.carelessType, 'none');
});

test('teacher wrong override preserves existing calculation careless category instead of downgrading it to legacy none', () => {
  const [q] = __test.normalizeReviewedQuestions([{
    outputSchemaVersion:'calculation-careless.v2', sourceKey:'c2', questionText:'题目', isCorrect:false,
    calculationStatus:'WRONG', analysisStatus:'ok', processCorrect:false, finalAnswerCorrect:false,
    carelessDetected:true, issueCategory:'careless', carelessIssues:['抄错']
  }]);
  assert.equal(q.normalizedStatus, 'WRONG');
  assert.equal(q.resultCategory, 'careless');
  assert.equal(q.carelessType, 'careless');
});

test('calculation history summary keeps teacher WRONG override after reload even if stale AI fields say correct', () => {
  const q = { outputSchemaVersion:'calculation-careless.v2', teacherOverrideApplied:true, teacherOverrideStatus:'WRONG', normalizedStatus:'WRONG', analysisStatus:'ok', calculationStatus:'CORRECT', processCorrect:true, finalAnswerCorrect:true, carelessDetected:false, issueCategory:'none' };
  const summary = __test.deriveV2Summary('calculation-careless.v2', [q]);
  assert.deepEqual({correct:summary.correctCount, wrong:summary.wrongCount, careless:summary.carelessCount, incomplete:summary.incompleteCount}, {correct:0, wrong:1, careless:0, incomplete:0});
});

test('calculation history summary keeps teacher CORRECT override after reload even if stale AI fields say careless', () => {
  const q = { outputSchemaVersion:'calculation-careless.v2', teacherOverrideApplied:true, teacherOverrideStatus:'CORRECT', normalizedStatus:'CORRECT', analysisStatus:'ok', calculationStatus:'WRONG', processCorrect:false, finalAnswerCorrect:false, carelessDetected:true, issueCategory:'careless' };
  const summary = __test.deriveV2Summary('calculation-careless.v2', [q]);
  assert.deepEqual({correct:summary.correctCount, wrong:summary.wrongCount, careless:summary.carelessCount, incomplete:summary.incompleteCount}, {correct:1, wrong:0, careless:0, incomplete:0});
});
