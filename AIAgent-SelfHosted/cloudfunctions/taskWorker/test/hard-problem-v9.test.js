'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v9 = require('../shared/grading-core/hard-problem-v9');

function evidence(processUnits = [{unitId:'P1', text:'综合算式', order:1, confidence:.98}], explanationUnits = [{unitId:'E1', text:'说明原因', order:2, confidence:.98}]) {
  return v9.normalizeStudentEvidence({questions:[{sourceKey:'Q1',questionText:'题目',studentAnswer:'答案',processUnits,explanationUnits,evidenceQuality:.98}]});
}
function method(){ return v9.normalizeMethodFingerprint({questions:[{sourceKey:'Q1',methodFamily:'arithmetic',coreRepresentation:'数量关系',confidence:.95}]}, ['Q1']); }
const rawPlan={questions:[{sourceKey:'Q1',confidence:.96,steps:[{stepId:'S1',order:1,purpose:'建立关系',expectedReasoning:'解释关系'},{stepId:'S2',order:2,purpose:'得到结论',expectedReasoning:'由关系得到结论'}]}]};

test('V9 plan fingerprint is independent from student evidence segmentation',()=>{
  const p1=v9.normalizePlan(rawPlan,evidence(),method());
  const p2=v9.normalizePlan(rawPlan,evidence([{unitId:'P1',text:'第一行',order:1},{unitId:'P2',text:'第二行',order:2}],[]),method());
  assert.equal(p1.planFingerprint,p2.planFingerprint);
});

test('V9 coverage is many-to-many and a shared process unit can satisfy multiple expected steps',()=>{
  const ev=evidence(); const plan=v9.normalizePlan(rawPlan,ev,method());
  const coverage=v9.normalizeCoverage({questions:[{sourceKey:'Q1',edges:[{stepId:'S1',evidenceId:'P1',confidence:.98},{stepId:'S2',evidenceId:'P1',confidence:.98},{stepId:'S2',evidenceId:'E1',confidence:.98}]}]},ev,plan);
  const a=v9.buildFixedAlignment(ev,plan,coverage);
  assert.deepEqual(a.questions[0].pairedSteps[0].processUnitIds,['P1']);
  assert.deepEqual(a.questions[0].pairedSteps[1].processUnitIds,['P1']);
  assert.equal(v9.stepSatisfaction(a.questions[0].pairedSteps[1]).satisfactionStatus,'covered');
});

test('V9 only marks an expected step missing when it has no coverage',()=>{
  const ev=evidence(); const plan=v9.normalizePlan(rawPlan,ev,method());
  const coverage=v9.normalizeCoverage({questions:[{sourceKey:'Q1',edges:[{stepId:'S1',evidenceId:'P1',confidence:.98}]}]},ev,plan);
  const a=v9.buildFixedAlignment(ev,plan,coverage);
  assert.equal(v9.stepSatisfaction(a.questions[0].pairedSteps[0]).satisfactionStatus,'covered');
  assert.equal(v9.stepSatisfaction(a.questions[0].pairedSteps[1]).satisfactionStatus,'missing');
});

test('V9 verification conflict never overwrites original student evidence text',()=>{
  const ev=evidence([{unitId:'P1',text:'12×10',order:1,confidence:.6}],[]);
  const out=v9.applyEvidenceVerification(ev,{decisions:[{sourceKey:'Q1',unitId:'P1',agreesWithExtraction:false,confirmedText:'12×19',confidence:.99}]});
  const u=out.questions[0].processUnits[0];
  assert.equal(u.text,'12×10');
  assert.equal(u.verifierCandidateText,'12×19');
  assert.equal(u.verificationConflict,true);
  assert.ok(u.confidence < .5);
});
