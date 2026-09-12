'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v10 = require('../shared/grading-core/hard-problem-v10');

function makeEvidence({ processUnits, explanationUnits, answer = '文艺书500本，科技书700本' }) {
  return v10.normalizeEvidenceLedger({ questions: [{
    sourceKey: 'Q1',
    questionText: '科技书是文艺书的1.4倍，两类书一共1200本，分别多少本？',
    studentAnswer: answer,
    studentWorkDetected: true,
    inputBasis: 'printed_question_with_work',
    processUnits,
    explanationUnits,
    evidenceQuality: .98
  }] });
}
function truth(ev) {
  return v10.normalizeProblemTruth({ questions: [{ sourceKey: 'Q1', accepted: true, questionConsistent: true, referenceAnswerConsistent: true, questionText: ev.questions[0].questionText, canonicalAnswerSummary: '文艺书500本，科技书700本', confidence: .99 }] }, ev);
}
function method() { return v10.normalizeMethodSignal({ questions: [{ sourceKey: 'Q1', methodFamily: 'equation', confidence: .98 }] }, ['Q1']); }
function hypotheses(ev, nodeCount = 5) {
  const tr = truth(ev);
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({ nodeId: `N${i+1}`, order: i+1, purpose: `标准节点${i+1}`, expectedReasoning: `标准逻辑${i+1}`, hintScaffold: `提示${i+1}`, dependencies: i ? [`N${i}`] : [] }));
  return { tr, hs: v10.normalizeReasoningHypotheses({ questions: [{ sourceKey: 'Q1', confidence: .98, hypotheses: [{ hypothesisId: 'H1', methodFamily: 'equation', confidence: .98, nodes }] }] }, ev, tr, method()) };
}
function audit(hs) { return v10.auditReasoningHypotheses(hs, { questions: [{ sourceKey: 'Q1', accepted: true, acceptedHypothesisIds: ['H1'], confidence: .98 }] }); }
function pu(id, sid, text, order) { return { unitId: id, studentStepId: sid, rawText: text, order, readability: 'readable', confidence: .98, visualBand: order }; }
function eu(id, sid, text, order) { return { unitId: id, studentStepId: sid, rawText: text, order, readability: 'readable', confidence: .98, visualBand: order }; }

test('4 student process steps plus 4 explanations remain exactly 4 StudentSteps', () => {
  const ev = makeEvidence({
    processUnits: [
      pu('P1','S1','设文艺书为x本',1),
      pu('P2','S2','x+1.4x=1200',2),
      pu('P3','S3','2.4x=1200\nx=500',3),
      pu('P4','S4','1200-500=700（本）',4)
    ],
    explanationUnits: [
      eu('E1','S1','用x表示文艺书数量',1),
      eu('E2','S2','科技书是文艺书的1.4倍，两类总数是1200',2),
      eu('E3','S3','合并同类项后解方程',3),
      eu('E4','S4','用总量减去文艺书数量求科技书',4)
    ]
  });
  const canonical = v10.buildCanonicalStudentSteps(ev.questions[0]);
  assert.equal(canonical.studentSteps.length, 4);
  assert.deepEqual(canonical.studentSteps.map(s => s.studentStepId), ['S1','S2','S3','S4']);
  assert.equal(canonical.studentSteps[2].solutionText, '2.4x=1200\nx=500');
  assert.equal(canonical.studentSteps[3].explanationText, '用总量减去文艺书数量求科技书');
});

test('explanation text accidentally emitted under processUnits is reclassified without creating extra steps', () => {
  const ev = makeEvidence({
    processUnits: [
      pu('P1','S1','设文艺书为x本',1),
      pu('X1','S1','因为要用一个未知数表示文艺书数量',1),
      pu('P2','S2','x+1.4x=1200',2),
      pu('X2','S2','因为科技书是文艺书的1.4倍，总数是1200',2),
      pu('P3','S3','2.4x=1200\nx=500',3),
      pu('X3','S3','根据等式两边同时进行相同运算来解方程',3),
      pu('P4','S4','1200-500=700（本）',4),
      pu('X4','S4','用总量减去文艺书数量求科技书',4)
    ],
    explanationUnits: []
  });
  const canonical = v10.buildCanonicalStudentSteps(ev.questions[0]);
  assert.equal(canonical.studentSteps.length, 4);
  assert.equal(canonical.reclassifiedExplanationUnitIds.length, 4);
  assert.match(canonical.studentSteps[1].explanationText, /1.4倍/);
  assert.equal(canonical.studentSteps.some(s => !s.solutionText), false);
});

test('5 reasoning nodes may map onto 4 student steps; reasoning-node count never changes display step count', () => {
  const ev = makeEvidence({
    processUnits: [pu('P1','S1','设x',1),pu('P2','S2','x+1.4x=1200',2),pu('P3','S3','2.4x=1200\nx=500',3),pu('P4','S4','1200-500=700',4)],
    explanationUnits: [eu('E1','S1','设未知数',1),eu('E2','S2','根据倍数和总数关系',2),eu('E3','S3','化简并解方程',3),eu('E4','S4','总量减去已知部分',4)]
  });
  const { hs } = hypotheses(ev, 5); const a = audit(hs);
  const coverage = v10.normalizeTypedCoverage({ questions: [{ sourceKey: 'Q1', selectedHypothesisId: 'H1', confidence: .98, edges: [
    {nodeId:'N1',evidenceId:'P1',relation:'supports',confidence:.98},
    {nodeId:'N2',evidenceId:'P2',relation:'supports',confidence:.98},
    {nodeId:'N3',evidenceId:'P3',relation:'supports',confidence:.98},
    {nodeId:'N4',evidenceId:'P3',relation:'supports',confidence:.95},
    {nodeId:'N5',evidenceId:'P4',relation:'supports',confidence:.98},
    {nodeId:'N1',evidenceId:'E1',relation:'supports',confidence:.95},
    {nodeId:'N2',evidenceId:'E2',relation:'supports',confidence:.95},
    {nodeId:'N3',evidenceId:'E3',relation:'supports',confidence:.95},
    {nodeId:'N4',evidenceId:'E3',relation:'supports',confidence:.90},
    {nodeId:'N5',evidenceId:'E4',relation:'supports',confidence:.95}
  ] }] }, ev, hs, a);
  const alignment = v10.buildFixedAlignment(ev, hs, coverage);
  assert.equal(alignment.questions[0].expectedSteps.length, 5);
  assert.equal(alignment.questions[0].pairedSteps.length, 4);
  assert.deepEqual(alignment.questions[0].pairedSteps[2].expectedNodeIds, ['N3','N4']);
  assert.equal(alignment.questions[0].missingExpectedNodes.length, 0);
});

test('an uncovered reasoning node is recorded internally but never fabricated as a fifth student step', () => {
  const ev = makeEvidence({
    processUnits: [pu('P1','S1','设x',1),pu('P2','S2','x+1.4x=1200',2),pu('P3','S3','x=500',3),pu('P4','S4','1200-500=700',4)],
    explanationUnits: [eu('E1','S1','设未知数',1),eu('E2','S2','列方程',2),eu('E3','S3','解方程',3),eu('E4','S4','求另一量',4)]
  });
  const { hs } = hypotheses(ev, 5); const a = audit(hs);
  const edges = [1,2,3,4].flatMap(i => [
    {nodeId:`N${i}`,evidenceId:`P${i}`,relation:'supports',confidence:.98},
    {nodeId:`N${i}`,evidenceId:`E${i}`,relation:'supports',confidence:.95}
  ]);
  const coverage = v10.normalizeTypedCoverage({ questions: [{ sourceKey:'Q1', selectedHypothesisId:'H1', confidence:.95, edges }] }, ev, hs, a);
  const alignment = v10.buildFixedAlignment(ev, hs, coverage);
  assert.equal(alignment.questions[0].pairedSteps.length, 4);
  assert.deepEqual(alignment.questions[0].missingExpectedNodes.map(n => n.nodeId), ['N5']);
});

test('non-fatal coverage or hypothesis-review uncertainty does not erase an otherwise reviewable result', () => {
  const ev = makeEvidence({ processUnits: [pu('P1','S1','x+1=2',1)], explanationUnits: [eu('E1','S1','根据等式关系',1)] });
  const { tr, hs } = hypotheses(ev, 1);
  const weakAudit = v10.auditReasoningHypotheses(hs, { questions: [{ sourceKey:'Q1', accepted:false, acceptedHypothesisIds:[], confidence:.2 }] });
  const coverage = v10.normalizeTypedCoverage({ questions: [{ sourceKey:'Q1', selectedHypothesisId:'H1', confidence:.4, edges:[{nodeId:'N1',evidenceId:'P1',relation:'supports',confidence:.7}] }] }, ev, hs, null);
  const alignment = v10.buildFixedAlignment(ev, hs, coverage);
  const review = { questions: [{ sourceKey:'Q1', finalAnswerCorrect:true, stepFeedbacks:[{solutionStatus:'correct',explanationStatus:'clear',logicStatus:'clear',confidence:.95}] }] };
  const snapshot = v10.buildDiagnosticSnapshot({ evidence:ev, problemTruth:tr, method:method(), hypotheses:hs, hypothesisAudit:weakAudit, coverage, alignment, reviewResult:review, adversarialJudgment:{accepted:true,confidence:.9,issues:[]}, route:{path:'deep',reasons:[]} });
  assert.equal(snapshot.consistencyStatus, 'ok');
  assert.ok(snapshot.consistencyWarnings.some(x => x.startsWith('HYPOTHESIS_AUDIT_REJECTED')));
  assert.ok(snapshot.consistencyWarnings.some(x => x.startsWith('COVERAGE_CONFIDENCE_INSUFFICIENT')));
  assert.equal(snapshot.consistencyFatalIssues.length, 0);
});

test('real evidence/truth blockers remain fatal', () => {
  const ev0 = makeEvidence({ processUnits: [pu('P1','S1','x+1=2',1)], explanationUnits: [] });
  const ev = v10.applyEvidenceVerification(ev0, { decisions: [{ sourceKey:'Q1', unitId:'P1', agreesWithExtraction:false, confirmedText:'x+1=3', confidence:.99 }] });
  const { tr, hs } = hypotheses(ev, 1); const a = audit(hs);
  const coverage = v10.normalizeTypedCoverage({ questions: [{ sourceKey:'Q1', selectedHypothesisId:'H1', confidence:.9, edges:[{nodeId:'N1',evidenceId:'P1',relation:'supports',confidence:.9}] }] }, ev, hs, a);
  const alignment = v10.buildFixedAlignment(ev, hs, coverage);
  const snapshot = v10.buildDiagnosticSnapshot({ evidence:ev, problemTruth:tr, method:method(), hypotheses:hs, hypothesisAudit:a, coverage, alignment, reviewResult:{questions:[{sourceKey:'Q1',finalAnswerCorrect:null,stepFeedbacks:[{solutionStatus:'unreadable',explanationStatus:'missing',logicStatus:'unreadable',confidence:.3}]}]}, adversarialJudgment:{accepted:true,confidence:.9,issues:[]}, route:{path:'deep',reasons:[]} });
  assert.equal(snapshot.consistencyStatus, 'blocked');
  assert.ok(snapshot.consistencyFatalIssues.some(x => x.startsWith('EVIDENCE_VERIFICATION_CONFLICT')));
});

test('a verbal student process remains a StudentStep when it has no companion process in the same student step', () => {
  const ev = makeEvidence({
    processUnits: [
      pu('P1','S1','根据题意先设文艺书有x本',1),
      pu('P2','S2','x+1.4x=1200',2)
    ],
    explanationUnits: [eu('E2','S2','科技书是文艺书的1.4倍，两类总数是1200',2)]
  });
  const canonical = v10.buildCanonicalStudentSteps(ev.questions[0]);
  assert.equal(canonical.studentSteps.length, 2);
  assert.equal(canonical.studentSteps[0].studentStepId, 'S1');
  assert.match(canonical.studentSteps[0].solutionText, /设文艺书有x本/);
  assert.equal(canonical.reclassifiedExplanationUnitIds.includes('P1'), false);
});

test('V10.5 structure review may correct a one-block perception draft into four locked StudentSteps', () => {
  const draft = makeEvidence({
    processUnits: [{ unitId:'P0', rawText:'设文艺书为x本\nx+1.4x=1200\n2.4x=1200\nx=500\n1200-500=700（本）', order:1, readability:'readable', confidence:.9, visualBand:1 }],
    explanationUnits: [{ unitId:'E0', rawText:'科技书是文艺书的1.4倍\n根据总数列方程\n合并同类项解方程\n用总量减文艺书求科技书', order:1, readability:'readable', confidence:.9, visualBand:2 }]
  });
  const reviewed = v10.applyEvidenceStructureReview(draft, { questions:[{
    sourceKey:'Q1', questionText:draft.questions[0].questionText, studentAnswer:draft.questions[0].studentAnswer, studentWorkDetected:true, inputBasis:'printed_question_with_work', structureConfidence:.97,
    processUnits:[
      pu('P1','A','设文艺书为x本',1),
      pu('P2','B','x+1.4x=1200',2),
      pu('P3','C','2.4x=1200\nx=500',3),
      pu('P4','D','1200-500=700（本）',4)
    ],
    explanationUnits:[
      eu('E1','A','用x表示文艺书数量',1),
      eu('E2','B','科技书是文艺书的1.4倍，两类总数是1200',2),
      eu('E3','C','合并同类项后解方程',3),
      eu('E4','D','用总量减去文艺书数量求科技书',4)
    ]
  }] });
  const canonical = v10.buildCanonicalStudentSteps(reviewed.questions[0]);
  assert.equal(reviewed.questions[0].verificationState, 'structure_verified');
  assert.equal(canonical.studentSteps.length, 4);
  assert.deepEqual(canonical.studentSteps.map(s => s.studentStepId), ['S1','S2','S3','S4']);
  assert.equal(canonical.studentSteps[2].solutionText, '2.4x=1200\nx=500');
});

test('visualBand never merges independent process units when explicit studentStepId is absent', () => {
  const ev = makeEvidence({
    processUnits: [
      {unitId:'P1',rawText:'步骤A',order:1,readability:'readable',confidence:.9,visualBand:1},
      {unitId:'P2',rawText:'步骤B',order:2,readability:'readable',confidence:.9,visualBand:1},
      {unitId:'P3',rawText:'步骤C',order:3,readability:'readable',confidence:.9,visualBand:1}
    ],
    explanationUnits: []
  });
  const canonical = v10.buildCanonicalStudentSteps(ev.questions[0]);
  assert.equal(canonical.studentSteps.length, 3);
});

test('structure review rejects explanation-only steps that do not bind an existing process step', () => {
  const draft = makeEvidence({ processUnits:[pu('P1','S1','x+1=2',1)], explanationUnits:[] });
  assert.throws(() => v10.applyEvidenceStructureReview(draft, { questions:[{
    sourceKey:'Q1', studentWorkDetected:true, inputBasis:'printed_question_with_work', structureConfidence:.9,
    processUnits:[pu('P1','S1','x+1=2',1)],
    explanationUnits:[eu('E1','S2','这段解释被错误当成新步骤',1)]
  }] }), /(学生解释必须绑定到已存在的学生过程步骤|学生解释引用了不存在的学生步骤)/);
});

test('V10.5 structure correction can expand a two-block perception draft to the four student-written steps seen in the image', () => {
  const draft = makeEvidence({
    processUnits: [
      { unitId:'P0', rawText:'设文艺书为x本\nx+1.4x=1200\n2.4x=1200\nx=500', order:1, readability:'readable', confidence:.9, visualBand:1 },
      { unitId:'P9', rawText:'1200-500=700（本）', order:2, readability:'readable', confidence:.9, visualBand:2 }
    ],
    explanationUnits: [{ unitId:'E0', rawText:'科技书是文艺书的1.4倍\n根据总数列方程\n合并同类项解方程\n用总量减文艺书求科技书', order:1, readability:'readable', confidence:.9, visualBand:3 }]
  });
  const reviewed = v10.applyEvidenceStructureReview(draft, { questions:[{
    sourceKey:'Q1', studentWorkDetected:true, inputBasis:'printed_question_with_work', structureConfidence:.98,
    processUnits:[pu('P1','X1','设文艺书为x本',1),pu('P2','X2','x+1.4x=1200',2),pu('P3','X3','2.4x=1200\nx=500',3),pu('P4','X4','1200-500=700（本）',4)],
    explanationUnits:[eu('E1','X1','用x表示文艺书数量',1),eu('E2','X2','根据倍数和总数关系列方程',2),eu('E3','X3','合并同类项后解方程',3),eu('E4','X4','用总量减去文艺书数量',4)]
  }] });
  const canonical = v10.buildCanonicalStudentSteps(reviewed.questions[0]);
  assert.equal(canonical.studentSteps.length, 4);
  assert.equal(reviewed.questions[0].studentStepCount, 4);
});

test('V10.5 structure correction can repair eight process-like draft blocks into four process plus four explanation pairs without doubling steps', () => {
  const draft = makeEvidence({
    processUnits: [
      pu('P1','A','设文艺书为x本',1), pu('X1','A','因为用一个未知数表示文艺书',1),
      pu('P2','B','x+1.4x=1200',2), pu('X2','B','因为科技书是文艺书的1.4倍且总数1200',2),
      pu('P3','C','2.4x=1200\nx=500',3), pu('X3','C','合并同类项并解方程',3),
      pu('P4','D','1200-500=700（本）',4), pu('X4','D','用总量减文艺书求科技书',4)
    ], explanationUnits: []
  });
  const reviewed = v10.applyEvidenceStructureReview(draft, { questions:[{
    sourceKey:'Q1', studentWorkDetected:true, inputBasis:'printed_question_with_work', structureConfidence:.99,
    processUnits:[pu('P1','A','设文艺书为x本',1),pu('P2','B','x+1.4x=1200',2),pu('P3','C','2.4x=1200\nx=500',3),pu('P4','D','1200-500=700（本）',4)],
    explanationUnits:[eu('X1','A','因为用一个未知数表示文艺书',1),eu('X2','B','因为科技书是文艺书的1.4倍且总数1200',2),eu('X3','C','合并同类项并解方程',3),eu('X4','D','用总量减文艺书求科技书',4)]
  }] });
  const canonical = v10.buildCanonicalStudentSteps(reviewed.questions[0]);
  assert.equal(canonical.studentSteps.length, 4);
  assert.equal(reviewed.questions[0].processUnits.length, 4);
  assert.equal(reviewed.questions[0].explanationUnits.length, 4);
  assert.equal(canonical.studentSteps.every((step) => step.solutionText && step.explanationText), true);
});

test('V10.5 structure review must return explicit full process/explanation arrays and cannot fake a lock by omission', () => {
  const draft = makeEvidence({ processUnits:[pu('P1','S1','x+1=2',1)], explanationUnits:[] });
  assert.throws(() => v10.applyEvidenceStructureReview(draft, { questions:[{ sourceKey:'Q1', structureConfidence:.9 }] }), /必须显式返回完整 processUnits 和 explanationUnits/);
});

test('V10.5 allows identical student text in two genuinely separate steps when the reviewer preserves distinct step ids', () => {
  const draft = makeEvidence({ processUnits:[pu('P0','S1','x=1',1)], explanationUnits:[] });
  const reviewed = v10.applyEvidenceStructureReview(draft, { questions:[{
    sourceKey:'Q1', studentWorkDetected:true, inputBasis:'printed_question_with_work', structureConfidence:.95,
    processUnits:[pu('P1','A','x=1',1),pu('P2','B','x=1',2)], explanationUnits:[]
  }] });
  assert.equal(v10.buildCanonicalStudentSteps(reviewed.questions[0]).studentSteps.length, 2);
});

test('V10.5 locked StudentStep authority survives reload only when ids, explanation bindings, and declared count stay consistent', () => {
  assert.throws(() => v10.normalizeEvidenceLedger({ questions:[{
    sourceKey:'Q1', questionText:'题目', studentWorkDetected:true, inputBasis:'printed_question_with_work', verificationState:'structure_verified', studentStepCount:4,
    processUnits:[pu('P1','S1','a',1),pu('P2','S2','b',2)], explanationUnits:[]
  }] }), /StudentStep 数量与实际结构不一致/);
  assert.throws(() => v10.normalizeEvidenceLedger({ questions:[{
    sourceKey:'Q1', questionText:'题目', studentWorkDetected:true, inputBasis:'printed_question_with_work', verificationState:'structure_verified', studentStepCount:1,
    processUnits:[pu('P1','S1','a',1)], explanationUnits:[eu('E1','S2','解释',1)]
  }] }), /学生解释引用了不存在的学生步骤/);
});
