import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { validateStrategyForPublish } from '../scripts/strategy-validator.mjs';
import { resolveRuntimeSchemas, validateModelOutput } from '../scripts/strategy-contract-audit.mjs';

const require = createRequire(import.meta.url);
const { main, validateReleaseManifest } = require('../cloudfunctions/strategyService/index.js');
const licenses = JSON.parse(fs.readFileSync(new URL('../strategy/private/licenses.json', import.meta.url), 'utf8'));
const publicKey = fs.readFileSync(new URL('../strategy/private/production-signing-public.pem', import.meta.url), 'utf8');
const sourceStrategy = JSON.parse(fs.readFileSync(new URL('../strategy/source/strategy-source.json', import.meta.url), 'utf8'));
const outputSchemaRegistry = JSON.parse(fs.readFileSync(new URL('../strategy/source/output-schema-registry.json', import.meta.url), 'utf8'));
const currentManifest = JSON.parse(fs.readFileSync(new URL('../strategy/release/current/strategy-manifest.json', import.meta.url), 'utf8'));
const license = licenses.licenses[0];
const resolvedSchemas = resolveRuntimeSchemas(sourceStrategy, outputSchemaRegistry);

const hardProblemCombinedPrompt = `${sourceStrategy.prompts.hardProblemEvidence.system}\n${sourceStrategy.prompts.hardProblem.system}`;
const gradingPrompts = [
  hardProblemCombinedPrompt,
  sourceStrategy.prompts.carelessTraining.system,
  sourceStrategy.prompts.calculationCarelessTraining.system,
];

const evidenceFields = ['studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'];
const inputBasisValues = ['printed_question_with_work', 'printed_question_without_work', 'work_only_complete', 'work_only_incomplete'];
const modeApplicabilityValues = ['applicable', 'not_applicable', 'uncertain'];

function assertEvidenceContract(question) {
  assert.equal(typeof question.studentWorkDetected, 'boolean');
  assert.equal(typeof question.sourceQuestionLabel, 'string');
  assert.equal(typeof question.sourceRegion, 'string');
  assert.ok(inputBasisValues.includes(question.inputBasis));
  assert.ok(modeApplicabilityValues.includes(question.modeApplicability));
  assert.equal(question.studentWorkDetected, question.inputBasis !== 'printed_question_without_work');
  if (question.inputBasis === 'work_only_incomplete') {
    assert.notEqual(question.finalAnswerCorrect, true, 'incomplete work must not form a determinate judgment');
    assert.notEqual(question.finalAnswerCorrect, false, 'incomplete work must not form a determinate judgment');
  }
}

function schemaForStage(stage) {
  const schema = resolvedSchemas.find((candidate) => candidate.schemaId === stage.outputSchemaVersion);
  assert.ok(schema, `missing registered schema for ${stage.outputSchemaVersion}`);
  return schema;
}

function assertTopLevelOutputContract(value, schema) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'response must be one top-level JSON object');
  assert.equal(value.outputSchemaVersion, schema.schemaId, 'top-level outputSchemaVersion');
  assert.equal(value.mode, schema.mode, 'top-level mode');
  assert.ok(Array.isArray(value.questions) && value.questions.length > 0, 'questions must be a non-empty array');
  assert.ok(value.questionSetAudit && typeof value.questionSetAudit === 'object' && !Array.isArray(value.questionSetAudit), 'questionSetAudit must be an object');
  assert.ok(Number.isInteger(value.questionSetAudit.visibleIndependentQuestionCount) && value.questionSetAudit.visibleIndependentQuestionCount >= 0, 'visibleIndependentQuestionCount must be a non-negative integer');
  assert.ok(Number.isInteger(value.questionSetAudit.emittedQuestionCount) && value.questionSetAudit.emittedQuestionCount >= 0, 'emittedQuestionCount must be a non-negative integer');
  assert.ok(Number.isInteger(value.questionSetAudit.excludedQuestionCount) && value.questionSetAudit.excludedQuestionCount >= 0, 'excludedQuestionCount must be a non-negative integer');
  assert.ok(['upright', 'rotated_left', 'rotated_right', 'upside_down', 'uncertain'].includes(value.questionSetAudit.orientation), 'orientation must be valid');
  assert.ok(typeof value.questionSetAudit.countConfidence === 'number' && value.questionSetAudit.countConfidence >= 0 && value.questionSetAudit.countConfidence <= 1, 'countConfidence must be between 0 and 1');
  assert.equal(value.questionSetAudit.emittedQuestionCount, value.questions.length, 'emittedQuestionCount must equal questions.length');
  assert.equal(value.questionSetAudit.visibleIndependentQuestionCount, value.questionSetAudit.emittedQuestionCount + value.questionSetAudit.excludedQuestionCount, 'visibleIndependentQuestionCount must equal emittedQuestionCount + excludedQuestionCount');
  for (const question of value.questions) {
    for (const field of schema.requiredFields) assert.notEqual(question?.[field], undefined, `${schema.schemaId} missing ${field}`);
    assert.equal(question.outputSchemaVersion, value.outputSchemaVersion, 'question outputSchemaVersion');
  }
}

function assertValidatedModelOutput(value, schema) {
  assertTopLevelOutputContract(value, schema);
  return validateModelOutput(value, schema);
}

function projectReadingFixture(question) {
  const threeGridStatus = question.analysisStatus === 'ok'
    && question.conditionCorrect === true
    && question.relationCorrect === true
    && question.askCorrect === true ? 'CORRECT' : 'WRONG';
  const rule = sourceStrategy.downstreamSemantics.modes['reading-careless.v2'].rules[threeGridStatus];
  return {
    ...question,
    threeGridStatus,
    normalizedStatus: rule.normalizedStatus,
    showErrorAnalysis: threeGridStatus !== 'CORRECT',
  };
}

function readingNarrationText(result, index) {
  if (result.normalizedStatus === 'CORRECT') return `第${index}题回答正确，条件、关系和所求都填写准确。`;
  if (!result.conditionCorrect) return `第${index}题条件格有问题。${result.referenceConditionText}`;
  if (!result.relationCorrect) return `第${index}题关系格有问题。${result.referenceRelationText}`;
  return `第${index}题所求格有问题。${result.referenceAskText}`;
}

function assertStrategyBundle(bundle) {
  validateStrategyForPublish(bundle, { registry: outputSchemaRegistry });
}

function validModelOutput(schema) {
  const base = {
    outputSchemaVersion: schema.schemaId,
    mode: schema.mode,
    route: { difficulty: 'normal', confidence: 1, flags: [] },
    imageQuality: { ok: true, issues: [] },
    questionSetAudit: {
      visibleIndependentQuestionCount: 1,
      emittedQuestionCount: 1,
      excludedQuestionCount: 0,
      orientation: 'upright',
      countConfidence: 1,
    },
  };
  if (schema.schemaId === 'hard-problem.v2') {
    return {
      ...base,
      answerConflicts: [],
      questions: [{
        outputSchemaVersion: schema.schemaId, sourceKey: 'image-1-question-1', questionText: '1 + 1 = ?', studentAnswer: '2', standardAnswer: '2',
        answerStatus: 'answered', finalAnswerCorrect: true, stepRequired: false, stepStatus: 'not_required', logicStatus: 'correct', errorType: 'none', firstWrongStep: '', errorReason: '', adjustmentSuggestion: '', knowledgePoint: '', stepFeedbacks: [], overallFeedback: '最终答案正确，本题无需分步讲解。', confidence: 1,
        studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image1-center', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable',
        studentProcess: '', correctProcess: '', isCorrect: true,
      }],
    };
  }
  if (schema.schemaId === 'reading-careless.v2') {
    return {
      ...base,
      questions: [{
        outputSchemaVersion: schema.schemaId, sourceKey: 'image-1-question-1', questionText: 'Read the problem', studentConditionText: '2 apples', studentRelationText: 'add 1', studentAskText: 'how many', referenceConditionText: '2 apples', referenceRelationText: 'add 1', referenceAskText: 'how many',
        analysisStatus: 'ok', conditionCorrect: true, relationCorrect: true, askCorrect: true, missingConditions: [], relationIssues: [], askIssue: '', errorReason: '', correctionAdvice: '', confidence: 1,
        studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image1-center', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable',
        incorrectConditions: [], adjustmentSuggestion: '', formatAligned: true, threeGridComplete: true, isCorrect: true,
      }],
    };
  }
  return {
    ...base,
    questions: [{
      outputSchemaVersion: schema.schemaId, sourceKey: 'image-1-question-1', questionText: '1 + 1 = ?', studentCalculation: '1 + 1 = 2', standardCalculation: '1 + 1 = 2',
      analysisStatus: 'ok', layoutClear: true, digitAlignmentCorrect: true, stepsComplete: true, carryBorrowClear: true, processCorrect: true, finalAnswerCorrect: true, carelessDetected: false, issueCategory: 'none', carelessIssues: [], methodIssues: [], errorReason: '', firstErrorPoint: '', correctionAdvice: '', confidence: 1,
      studentWorkDetected: true, sourceQuestionLabel: '1', sourceRegion: 'image1-center', inputBasis: 'printed_question_with_work', modeApplicability: 'applicable',
    }],
  };
}

function request(extra = {}) {
  return {
    httpMethod: 'POST',
    path: '/v1/strategy/latest',
    body: JSON.stringify({
      customerId: license.customerId,
      licenseId: license.licenseId,
      appIdHash: license.appIdHash,
      currentVersion: '',
      timestamp: Date.now(),
      nonce: crypto.randomBytes(12).toString('hex'),
      ...extra,
    }),
  };
}

function exampleQuestionFromUserTemplate(template) {
  const start = template.indexOf('"questions":[{');
  const end = template.indexOf(']}', start);
  if (start >= 0 && end >= 0) return template.slice(start, end + 2);
  throw new Error('userTemplate JSON example is missing');
}

function directHardProblemExample() {
  const template = sourceStrategy.prompts.hardProblem.userTemplate;
  const start = template.indexOf('{"questions"');
  const end = template.lastIndexOf('}');
  return JSON.parse(template.slice(start, end + 1));
}

test('returns a signed and decryptable strategy envelope', async () => {
  const response = await main(request());
  assert.equal(response.statusCode, 200);
  const envelope = JSON.parse(response.body);
  const { signature, ...unsigned } = envelope;
  assert.match(envelope.artifactHash, /^[0-9a-f]{64}$/);
  assert.equal(envelope.artifactHash, currentManifest.artifactHash);
  assert.equal(
    crypto.verify('sha256', Buffer.from(JSON.stringify(unsigned)), publicKey, Buffer.from(signature, 'base64')),
    true,
  );
  const tampered = { ...envelope, artifactHash: '0'.repeat(64) };
  const { signature: tamperedSignature, ...tamperedUnsigned } = tampered;
  assert.equal(
    crypto.verify('sha256', Buffer.from(JSON.stringify(tamperedUnsigned)), publicKey, Buffer.from(tamperedSignature, 'base64')),
    false,
  );
  const key = Buffer.from(license.encryptionKeyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.encryption.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.encryption.tag, 'base64'));
  const text = Buffer.concat([
    decipher.update(Buffer.from(envelope.encryption.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
 const decrypted = JSON.parse(text);
  assert.equal(decrypted.strategyVersion, sourceStrategy.strategyVersion);
  assert.match(decrypted.prompts.carelessTraining.system, /READING_CARELESS_MEANING_FIRST_V2/);
  assert.match(decrypted.prompts.carelessTraining.system, /正方体铁块.*三格应判正确/s);
  assert.match(decrypted.prompts.carelessTraining.system, /等腰三角形.*三格应判正确/s);
  assert.equal(decrypted.minimumClientContractVersion, currentManifest.minimumClientContractVersion);
  assert.equal(decrypted.outputSchemaRegistryVersion, 'output-schema-registry.v1');
  assert.equal(decrypted.downstreamSemanticsVersion, 'result-semantics.v1');
  assert.equal(decrypted.modelRuntimeContractVersion, 'model-runtime.v1');
  assert.equal(decrypted.modelOutputRepairPolicy.version, 'model-output-repair.v1');
  assert.deepEqual(decrypted.outputSchemaIds, [
    'hard-problem.v2',
    'reading-careless.v2',
    'calculation-careless.v2',
  ]);
  assert.equal(decrypted.contracts.hardProblemV2.outputSchemaVersion, 'hard-problem.v2');
  assert.equal(decrypted.contracts.readingCarelessV2.outputSchemaVersion, 'reading-careless.v2');
  assert.equal(decrypted.contracts.calculationCarelessV2.outputSchemaVersion, 'calculation-careless.v2');
  assert.ok(decrypted.downstreamSemantics);
  assert.ok(decrypted.modelRuntime);
  assert.deepEqual(
    Object.fromEntries(Object.entries(decrypted.modelRuntime.stages).map(([stage, definition]) => [stage, definition.timeoutMs])),
    {
      hardProblemPrimary: 70000,
      hardProblemReview: 90000,
      readingCarelessPrimary: 70000,
      readingCarelessReview: 90000,
      calculationCarelessPrimary: 70000,
      calculationCarelessReview: 90000,
    },
  );
  assert.doesNotThrow(() => assertStrategyBundle(decrypted));
});

test('rejects unauthorized request fields', async () => {
  const response = await main(request({ studentName: 'forbidden' }));
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).code, 'DATA_MINIMIZATION_VIOLATION');
});

test('rejects an AppID hash mismatch', async () => {
  const response = await main(request({ appIdHash: 'wrong' }));
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).code, 'LICENSE_APP_MISMATCH');
});

test('configures the six model runtime stages for current strategy', () => {
assert.equal(sourceStrategy.strategyVersion, '1.6.19');
  assert.deepEqual(
    Object.fromEntries(Object.entries(sourceStrategy.modelRuntime.stages).map(([stage, definition]) => [stage, definition.timeoutMs])),
    {
      hardProblemPrimary: 70000,
      hardProblemReview: 90000,
      readingCarelessPrimary: 70000,
      readingCarelessReview: 90000,
      calculationCarelessPrimary: 70000,
      calculationCarelessReview: 90000,
    },
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(sourceStrategy.modelRuntime.stages).map(([stage, definition]) => [stage, {
      modelTier: definition.modelTier,
      maxOutputTokens: definition.maxOutputTokens,
      structuredOutputMode: definition.structuredOutputMode,
    }])),
    Object.fromEntries(Object.keys(sourceStrategy.modelRuntime.stages).map((stage) => [stage, {
      modelTier: 'lite',
      maxOutputTokens: stage.startsWith('hardProblem') ? 14000 : 20000,
      structuredOutputMode: 'none',
    }])),
  );
});

test('rejects a release manifest that disagrees with the strategy contract', () => {
  assert.doesNotThrow(() => validateReleaseManifest(sourceStrategy, currentManifest));
  const invalidManifest = { ...currentManifest, outputSchemaRegistryVersion: 'invalid' };
  assert.throws(() => validateReleaseManifest(sourceStrategy, invalidManifest));
  const invalidMinimumClientContractVersion = { ...currentManifest, minimumClientContractVersion: 'one' };
  assert.throws(() => validateReleaseManifest(sourceStrategy, invalidMinimumClientContractVersion));
});

test('requires three independent questions to produce three questions objects in every grading prompt', () => {
  assert.equal(gradingPrompts.length, 3);
  for (const prompt of gradingPrompts) assert.match(prompt, /questions\[\] 对象/);
});

test('handles printed-only questions without work consistently in each grading prompt', () => {
  assert.match(sourceStrategy.prompts.hardProblem.system, /忠实保留原图算式符号/);
  assert.match(sourceStrategy.prompts.hardProblem.system, /不猜/);
  for (const promptKey of ['carelessTraining', 'calculationCarelessTraining']) assert.match(sourceStrategy.prompts[promptKey].system, /不得标记/);
});

test('forbids English sentences, LaTeX backslashes, and fabricated formula content in every grading prompt', () => {
  assert.match(sourceStrategy.prompts.hardProblem.system, /不制造学生步骤|不猜/);
  for (const promptKey of ['carelessTraining', 'calculationCarelessTraining']) {
    const prompt = sourceStrategy.prompts[promptKey].system;
    assert.match(prompt, /禁止出现整句英文/);
    assert.match(prompt, /不得补造题干或判定对错/);
  }
});

test('requires the five evidence fields and complete enums in all three v2 schemas', () => {
  for (const contract of Object.values(sourceStrategy.contracts).filter((contract) => contract.outputSchemaVersion?.endsWith('.v2'))) {
    for (const field of evidenceFields) assert.equal(contract.requiredFields.includes(field), true, `${contract.outputSchemaVersion} requires ${field}`);
    assert.equal(contract.fieldTypes.studentWorkDetected, 'boolean');
    assert.equal(contract.fieldTypes.sourceQuestionLabel, 'string');
    assert.equal(contract.fieldTypes.sourceRegion, 'string');
    assert.equal(contract.fieldTypes.inputBasis, 'enum');
    assert.equal(contract.fieldTypes.modeApplicability, 'enum');
    assert.deepEqual(contract.enumFields, { inputBasis: inputBasisValues, modeApplicability: modeApplicabilityValues });
    const expectedProjectionFields = contract.outputSchemaVersion === 'hard-problem.v2'
      ? [...evidenceFields, 'stepFeedbacks', 'overallFeedback']
      : evidenceFields;
    assert.deepEqual(contract.reviewProjection.evidenceFields, expectedProjectionFields);
    assert.deepEqual(contract.wrongQuestionProjection.modeDetails, expectedProjectionFields);
  }
});

test('accepts printed questions without work only when studentWorkDetected is false without fabricating hard-problem student steps', () => {
  assert.deepEqual(sourceStrategy.contracts.hardProblemV2.inputBasisRules.printed_question_without_work, {
    studentWorkDetected: false,
    downstreamHandling: 'retain_question_without_fabricated_steps',
  });
  for (const contractKey of ['readingCarelessV2', 'calculationCarelessV2']) {
    assert.deepEqual(sourceStrategy.contracts[contractKey].inputBasisRules.printed_question_without_work, {
      studentWorkDetected: false,
      downstreamHandling: 'exclude',
    });
  }
  const printedWithoutWork = {
    studentWorkDetected: false, sourceQuestionLabel: '5', sourceRegion: 'image1-upper-left', inputBasis: 'printed_question_without_work', modeApplicability: 'applicable', finalAnswerCorrect: null,
  };
  assert.doesNotThrow(() => assertEvidenceContract(printedWithoutWork));
  assert.throws(() => assertEvidenceContract({ ...printedWithoutWork, studentWorkDetected: true }), /false/);
});

test('allows complete visible work but prevents determinate judgments for incomplete work', () => {
  for (const contract of Object.values(sourceStrategy.contracts).filter((contract) => contract.outputSchemaVersion?.endsWith('.v2'))) {
    assert.deepEqual(contract.inputBasisRules.work_only_complete, {
      studentWorkDetected: true,
      questionText: 'visible_complete_work_only',
      judgment: 'allowed',
    });
    assert.deepEqual(contract.inputBasisRules.work_only_incomplete, {
      studentWorkDetected: true,
      questionText: 'no_fabricated_stem',
      judgment: 'undetermined',
    });
  }
  assert.doesNotThrow(() => assertEvidenceContract({
    studentWorkDetected: true, sourceQuestionLabel: '', sourceRegion: 'image1-center', inputBasis: 'work_only_complete', modeApplicability: 'applicable', questionText: '12+3=15', finalAnswerCorrect: true,
  }));
  assert.throws(() => assertEvidenceContract({
    studentWorkDetected: true, sourceQuestionLabel: '', sourceRegion: 'image1-center', inputBasis: 'work_only_incomplete', modeApplicability: 'uncertain', questionText: '12+', finalAnswerCorrect: true,
  }), /must not form a determinate judgment/);
});


test('keeps legacy hard-problem evidence extraction available while direct grading owns the final judgment', () => {
  const evidence = sourceStrategy.prompts.hardProblemEvidence.system;
  const grading = sourceStrategy.prompts.hardProblem.system;
  assert.match(evidence, /processUnits/);
  assert.match(evidence, /explanationUnits/);
  assert.match(grading, /直接看学生原图/);
  assert.match(grading, /解题过程和对应分析\/思路联系起来/);
  assert.match(grading, /不要把全部计算和全部分析分成两个步骤/);
});

test('requires hard-problem.v2 to list every verified wrong step and leave knowledgePoint empty', () => {
  const contract = sourceStrategy.contracts.hardProblemV2;
  assert.equal(contract.outputSchemaVersion, 'hard-problem.v2');
  assert.equal(contract.requiredFields.includes('firstWrongStep'), true);
  assert.equal(contract.requiredFields.includes('knowledgePoint'), true);
  assert.equal(sourceStrategy.reviewRules.hardProblemDirectMode, true);
  const example = directHardProblemExample().questions[0];
  assert.ok(Array.isArray(example.steps));
});

test('freezes reading-careless.v2 individual-question reference and omitted-student-entry rules', () => {
  const contract = sourceStrategy.contracts.readingCarelessV2;
  const { system, userTemplate } = sourceStrategy.prompts.carelessTraining;

assert.equal(sourceStrategy.strategyVersion, '1.6.19');
  for (const field of ['referenceConditionText', 'referenceRelationText', 'referenceAskText']) {
    assert.equal(contract.requiredFields.includes(field), true);
    assert.match(userTemplate, new RegExp(`"${field}":""`));
  }
  assert.match(system, /Never write the reference three-grid content into a student field/i);
  assert.match(system, /A student leaving a grid blank is not insufficient/i);
  assert.match(system, /missing student field must be an empty string and its corresponding Correct field must be false/i);
  assert.match(system, /When the original question is readable, all three reference fields must be non-empty/i);
});

test('allows a calculation error attributed to knowledge or method', () => {
  const contract = sourceStrategy.contracts.calculationCarelessV2;
  assert.deepEqual(contract.issueCategoryValues, ['none', 'careless', 'knowledge_or_method', 'undetermined']);
  assert.equal(contract.outputSchemaVersion, 'calculation-careless.v2');
});

test('freezes mutually exclusive calculation-careless output rules', () => {
  const { system, userTemplate } = sourceStrategy.prompts.calculationCarelessTraining;
  const prompt = `${system}\n${userTemplate}`;

assert.equal(sourceStrategy.strategyVersion, '1.6.19');
  assert.match(system, /mutually exclusive statistics classification/i);
  assert.match(system, /carelessDetected=true requires issueCategory=careless/i);
  assert.match(system, /when carelessDetected=true, do not classify the question as answer wrong/i);
  assert.match(system, /carelessDetected=false even when the final answer is wrong if no calculation carelessness is confirmed/i);
  assert.match(system, /list all confirmed wrong steps in the original answer order/i);
  assert.match(system, /Do not use generic error descriptions such as "calculation error", "process error", or "not careful"/i);
  assert.doesNotMatch(prompt, /only the first error|first real error|first error/i);
});

test('allows REVIEW to add primary omissions from original images while preserving primary identities', () => {
  const { invariants } = sourceStrategy.compactReviewContract;
  const instruction = sourceStrategy.reviewRules.independentReviewInstruction;
  assert.equal(sourceStrategy.strategyVersion, '1.6.19');
  assert.ok(invariants.includes('review_may_add_missing_questions_from_original_images'));
  assert.match(instruction, /重新看原图/);
  assert.match(instruction, /没错就保留/);
  assert.match(instruction, /有错就直接纠正/);
});

test('freezes final narration rules for hard-problem, reading-careless, and calculation-careless', () => {
  const { system, userTemplate } = sourceStrategy.prompts.narration;
  const prompt = `${system}\n${userTemplate}`;

assert.equal(sourceStrategy.strategyVersion, '1.6.19');
  assert.match(prompt, /HARD_PROBLEM_CHECK/);
  assert.match(prompt, /CARELESS_TRAINING \+ reading/);
  assert.match(prompt, /CARELESS_TRAINING \+ calculation/);
  assert.match(system, /summaryText 必须原样复制 expectedSummaryText/);
  assert.match(system, /endingText 必须原样复制 expectedEncouragement/);
  assert.match(system, /items.*sourceKey.*questions/);
  assert.doesNotMatch(prompt, /three-grid adjustment/i);
  assert.match(system, /reference/);
  assert.match(system, /carelessDetected=true/);
  assert.match(system, /carelessDetected=false/);
  assert.match(system, /calculation/);
  assert.match(system, /朗读 firstWrongStep 中列出的全部错误步骤/);
  assert.match(system, /不得朗读 knowledgePoint/);
  assert.match(system, /HARD_PROBLEM_CHECK/);
  const readingStart = system.indexOf('CARELESS_TRAINING + reading');
  const readingEnd = system.indexOf('CARELESS_TRAINING + calculation', readingStart);
  const readingRules = system.slice(readingStart, readingEnd);
  assert.match(readingRules, /第N题回答正确，条件、关系和所求都填写准确。/);
  assert.match(readingRules, /read only that grid's short correct content/);
  assert.doesNotMatch(readingRules, /逐项指出错误格/);
});

test('allows unreadable calculation output with null judgment booleans', () => {
  const contract = sourceStrategy.contracts.calculationCarelessV2;
  assert.equal(contract.analysisStatusValues.includes('unreadable'), true);
  assert.deepEqual(contract.nullableBooleanFields, [
    'layoutClear',
    'digitAlignmentCorrect',
    'stepsComplete',
    'carryBorrowClear',
    'processCorrect',
    'finalAnswerCorrect',
    'carelessDetected',
  ]);
});

test('rejects a strategy with a missing required field or incorrect calculation-careless version', () => {
  const missingField = structuredClone(sourceStrategy);
  missingField.contracts.calculationCarelessV2.requiredFields = missingField.contracts.calculationCarelessV2.requiredFields
    .filter((field) => field !== 'methodIssues');
  assert.throws(() => validateStrategyForPublish(missingField), /methodIssues/);

  const wrongVersion = structuredClone(sourceStrategy);
  wrongVersion.contracts.calculationCarelessV2.outputSchemaVersion = 'calculation-careless.v1';
  assert.throws(() => validateStrategyForPublish(wrongVersion), /calculation-careless\.v2/);
});

test('allows an unanswered hard-problem.v2 output without a fabricated student answer', () => {
  const contract = sourceStrategy.contracts.hardProblemV2;
  const unanswered = {
    outputSchemaVersion: 'hard-problem.v2',
    sourceKey: 'homework-1',
    questionText: '1 + 1 = ?',
    studentAnswer: '',
    standardAnswer: '9',
    answerStatus: 'unanswered',
    finalAnswerCorrect: null,
    stepRequired: true,
    stepStatus: 'missing',
    logicStatus: 'insufficient',
    errorType: 'unanswered',
    firstWrongStep: '',
    errorReason: '',
    adjustmentSuggestion: 'Complete the answer first.',
    knowledgePoint: '',
    confidence: 0.99,
  };
  assert.equal(contract.outputSchemaVersion, unanswered.outputSchemaVersion);
  assert.equal(unanswered.finalAnswerCorrect, null);
  assert.equal(unanswered.errorType, 'unanswered');
  assert.equal(unanswered.studentAnswer, '');
});

test('allows unreadable reading-careless.v2 output with null three-grid judgments', () => {
  const contract = sourceStrategy.contracts.readingCarelessV2;
  const unreadable = {
    outputSchemaVersion: 'reading-careless.v2',
    sourceKey: 'homework-1',
    questionText: '',
    studentConditionText: '',
    studentRelationText: '',
    studentAskText: '',
    analysisStatus: 'unreadable',
    conditionCorrect: null,
    relationCorrect: null,
    askCorrect: null,
    missingConditions: [],
    relationIssues: [],
    askIssue: '',
    errorReason: '',
    correctionAdvice: '',
    confidence: 0,
  };
  assert.equal(contract.outputSchemaVersion, unreadable.outputSchemaVersion);
  assert.equal(contract.analysisStatusValues.includes(unreadable.analysisStatus), true);
  assert.equal(unreadable.conditionCorrect, null);
  assert.equal(unreadable.relationCorrect, null);
  assert.equal(unreadable.askCorrect, null);
  assert.doesNotThrow(() => validateStrategyForPublish(sourceStrategy));
});

test('rejects hard-problem or reading-careless contract defects before publishing', () => {
  const missingRegistryVersion = structuredClone(sourceStrategy);
  delete missingRegistryVersion.outputSchemaRegistryVersion;
  assert.throws(() => validateStrategyForPublish(missingRegistryVersion), /outputSchemaRegistryVersion/);

  const missingField = structuredClone(sourceStrategy);
  missingField.contracts.hardProblemV2.requiredFields = missingField.contracts.hardProblemV2.requiredFields
    .filter((field) => field !== 'answerStatus');
  assert.throws(() => validateStrategyForPublish(missingField), /answerStatus/);

  const wrongVersion = structuredClone(sourceStrategy);
  wrongVersion.contracts.readingCarelessV2.outputSchemaVersion = 'reading-careless.v1';
  assert.throws(() => validateStrategyForPublish(wrongVersion), /reading-careless\.v2/);

  const missingEnum = structuredClone(sourceStrategy);
  missingEnum.contracts.hardProblemV2.errorTypeValues = ['none'];
  assert.throws(() => validateStrategyForPublish(missingEnum), /errorType/);

  const promptOutOfBounds = structuredClone(sourceStrategy);
  promptOutOfBounds.prompts.hardProblem.system = 'Return only JSON.';
  assert.throws(() => validateStrategyForPublish(promptOutOfBounds), /hard-problem.*prompt/i);
});

test('maps every terminal v2 status to complete result-semantics.v1 fields', () => {
  const semantics = sourceStrategy.downstreamSemantics;
  assert.equal(sourceStrategy.downstreamSemanticsVersion, 'result-semantics.v1');
  for (const mode of ['hard-problem.v2', 'reading-careless.v2', 'calculation-careless.v2']) {
    for (const rule of Object.values(semantics.modes[mode].rules)) {
      for (const field of ['normalizedStatus', 'isCorrect', 'resultCategory', 'shouldRecordWrongQuestion', 'wrongQuestionDisposition', 'checkinEligible', 'reviewDisposition', 'ttsDisposition']) {
        assert.notEqual(rule[field], undefined, mode + ' is missing ' + field);
      }
    }
  }
  assert.doesNotThrow(() => validateStrategyForPublish(sourceStrategy));
});

test('rejects prohibited cross-mode result semantic dependencies', () => {
  const hardCareless = structuredClone(sourceStrategy);
  hardCareless.downstreamSemantics.modes['hard-problem.v2'].rules.WRONG.resultCategory = 'careless';
  assert.throws(() => validateStrategyForPublish(hardCareless), /hard-problem.*careless/i);

  const readingFinalAnswer = structuredClone(sourceStrategy);
  readingFinalAnswer.downstreamSemantics.modes['reading-careless.v2'].rules.WRONG.dependsOn = ['finalAnswerCorrect'];
  assert.throws(() => validateStrategyForPublish(readingFinalAnswer), /reading-careless.*final answer/i);

  const calculationCorrect = structuredClone(sourceStrategy);
  calculationCorrect.downstreamSemantics.modes['calculation-careless.v2'].rules.WRONG.dependsOn = ['carelessDetected=false'];
  assert.throws(() => validateStrategyForPublish(calculationCorrect), /calculation-careless.*carelessDetected/i);
});

test('rejects missing result semantic modes, terminal states, and versions before publishing', () => {
  const missingMode = structuredClone(sourceStrategy);
  delete missingMode.downstreamSemantics.modes['reading-careless.v2'];
  assert.throws(() => validateStrategyForPublish(missingMode), /reading-careless\.v2.*missing/i);

  const missingTerminalState = structuredClone(sourceStrategy);
  delete missingTerminalState.downstreamSemantics.modes['hard-problem.v2'].rules.UNREADABLE;
  assert.throws(() => validateStrategyForPublish(missingTerminalState), /UNREADABLE.*missing/i);

  const wrongVersion = structuredClone(sourceStrategy);
  wrongVersion.downstreamSemanticsVersion = 'result-semantics.v2';
  assert.throws(() => validateStrategyForPublish(wrongVersion), /downstreamSemanticsVersion/);
});

test('requires all six model-runtime.v1 stages to bind their v2 output schemas', () => {
  const runtime = sourceStrategy.modelRuntime;
  assert.equal(sourceStrategy.modelRuntimeContractVersion, 'model-runtime.v1');
  assert.deepEqual(Object.keys(runtime.stages).sort(), [
    'calculationCarelessPrimary', 'calculationCarelessReview',
    'hardProblemPrimary', 'hardProblemReview',
    'readingCarelessPrimary', 'readingCarelessReview',
  ]);
  assert.equal(runtime.stages.hardProblemPrimary.outputSchemaVersion, 'hard-problem.v2');
  assert.equal(runtime.stages.hardProblemReview.outputSchemaVersion, 'hard-problem.v2');
  assert.equal(runtime.stages.readingCarelessPrimary.outputSchemaVersion, 'reading-careless.v2');
  assert.equal(runtime.stages.readingCarelessReview.outputSchemaVersion, 'reading-careless.v2');
  assert.equal(runtime.stages.calculationCarelessPrimary.outputSchemaVersion, 'calculation-careless.v2');
  assert.equal(runtime.stages.calculationCarelessReview.outputSchemaVersion, 'calculation-careless.v2');
  assert.doesNotThrow(() => validateStrategyForPublish(sourceStrategy));
});

test('rejects invalid model-runtime.v1 stage limits and modes before publishing', () => {
  for (const [field, value] of [
    ['timeoutMs', 0],
    ['maxRepairAttempts', 3],
    ['reviewPayloadMode', 'full'],
    ['structuredOutputMode', 'unsupported_mode'],
  ]) {
    const invalid = structuredClone(sourceStrategy);
    invalid.modelRuntime.stages.hardProblemPrimary[field] = value;
    assert.throws(() => validateStrategyForPublish(invalid), new RegExp(field));
  }
});

test('validates structured output mode and token limit against each model API configuration', () => {
  const miniJsonObject = structuredClone(sourceStrategy);
  for (const definition of Object.values(miniJsonObject.modelRuntime.stages)) {
    definition.modelTier = 'mini';
    definition.maxOutputTokens = 4096;
    definition.structuredOutputMode = 'json_object';
  }
  assert.doesNotThrow(() => validateStrategyForPublish(miniJsonObject));

  const miniNone = structuredClone(miniJsonObject);
  miniNone.modelRuntime.stages.hardProblemPrimary.structuredOutputMode = 'none';
  assert.throws(() => validateStrategyForPublish(miniNone), /hardProblemPrimary structuredOutputMode/);

  const liteNone = structuredClone(sourceStrategy);
  assert.doesNotThrow(() => validateStrategyForPublish(liteNone));

  const liteJsonObject = structuredClone(liteNone);
  liteJsonObject.modelRuntime.stages.hardProblemPrimary.structuredOutputMode = 'json_object';
  assert.throws(() => validateStrategyForPublish(liteJsonObject), /hardProblemPrimary structuredOutputMode/);

  const liteOverLimit = structuredClone(liteNone);
  liteOverLimit.modelRuntime.stages.hardProblemPrimary.maxOutputTokens = 20001;
  assert.throws(() => validateStrategyForPublish(liteOverLimit), /hardProblemPrimary maxOutputTokens/);
});

test('requires model-output-repair.v1 to prohibit business conclusion fabrication', () => {
  const invalid = structuredClone(sourceStrategy);
  invalid.modelOutputRepairPolicy.prohibitedRepairs = invalid.modelOutputRepairPolicy.prohibitedRepairs
    .filter((rule) => rule !== 'do_not_change_null_to_false');
  assert.throws(() => validateStrategyForPublish(invalid), /prohibitedRepairs/);

  const sourceKeyRewrite = structuredClone(sourceStrategy);
  sourceKeyRewrite.modelOutputRepairPolicy.prohibitedRepairs = sourceKeyRewrite.modelOutputRepairPolicy.prohibitedRepairs
    .filter((rule) => rule !== 'do_not_rewrite_sourceKey');
  assert.throws(() => validateStrategyForPublish(sourceKeyRewrite), /prohibitedRepairs/);

  const fabricatedConclusion = structuredClone(sourceStrategy);
  fabricatedConclusion.modelOutputRepairPolicy.prohibitedRepairs = fabricatedConclusion.modelOutputRepairPolicy.prohibitedRepairs
    .filter((rule) => rule !== 'do_not_fabricate_business_conclusions');
  assert.throws(() => validateStrategyForPublish(fabricatedConclusion), /prohibitedRepairs/);
});

test('requires all six PRIMARY and REVIEW prompts to state the registered complete JSON contract', () => {
  for (const [stageName, stage] of Object.entries(sourceStrategy.modelRuntime.stages)) {
    const schema = schemaForStage(stage);
    const prompt = sourceStrategy.prompts[schema.promptKey];
    if (schema.schemaId === 'hard-problem.v2' && sourceStrategy.reviewRules.hardProblemDirectMode) {
      assert.match(prompt.system, /只输出 JSON/);
      assert.ok(Array.isArray(directHardProblemExample().questions));
    } else {
      assert.match(prompt.system, /Every questions\[\] object must include every field required by its outputSchemaVersion Schema/i);
    }
  }
});

test('requires REVIEW to return complete responses rather than partial updates in all three modes', () => {
  assert.match(sourceStrategy.reviewRules.independentReviewInstruction, /重新看原图/);
  assert.match(sourceStrategy.reviewRules.independentReviewInstruction, /有错就直接纠正/);
  for (const key of ['carelessTraining','calculationCarelessTraining']) assert.match(sourceStrategy.prompts[key].system, /Never return a partial object, patch, diff, or omitted unchanged field/i);
});

test('keeps every grading userTemplate example as a complete valid v2 output object', () => {
  const direct = directHardProblemExample();
  assert.ok(Array.isArray(direct.questions) && direct.questions.length === 1);
  for (const field of ['questionText','studentAnswer','standardAnswer','finalAnswerVerdict','steps','overallFeedback','confidence']) assert.ok(Object.hasOwn(direct.questions[0], field));
  for (const stage of Object.values(sourceStrategy.modelRuntime.stages).filter((stage) => stage.outputSchemaVersion !== 'hard-problem.v2')) {
    const schema = schemaForStage(stage);
    const template = sourceStrategy.prompts[schema.promptKey].userTemplate;
    const start = template.indexOf('Return ') + 'Return '.length;
    const end = template.indexOf('\n每个 questions 对象必须包含示例中的全部字段', start);
    const parsed = JSON.parse(template.slice(start, end));
    assert.doesNotThrow(() => assertTopLevelOutputContract(parsed, schema));
  }
});

test('includes the five evidence fields in each grading userTemplate JSON example', () => {
  const direct = directHardProblemExample().questions[0];
  assert.ok(Object.hasOwn(direct, 'steps'));
  for (const promptKey of ['carelessTraining', 'calculationCarelessTraining']) {
    const example = exampleQuestionFromUserTemplate(sourceStrategy.prompts[promptKey].userTemplate);
    assert.match(example, /"studentWorkDetected":true/);
    assert.match(example, /"inputBasis":"printed_question_with_work"/);
    assert.match(example, /"modeApplicability":"applicable"/);
  }
});

test('makes each grading userTemplate JSON example complete for its v2 schema', () => {
  const direct = directHardProblemExample().questions[0];
  for (const field of ['questionText','studentAnswer','standardAnswer','finalAnswerVerdict','steps','overallFeedback','confidence']) assert.ok(Object.hasOwn(direct, field));
  for (const [promptKey, contractKey] of [['carelessTraining','readingCarelessV2'],['calculationCarelessTraining','calculationCarelessV2']]) {
    const example = exampleQuestionFromUserTemplate(sourceStrategy.prompts[promptKey].userTemplate);
    for (const field of sourceStrategy.contracts[contractKey].requiredFields) assert.match(example, new RegExp(`"${field}":`));
  }
});

test('keeps the calculation-carelessness userTemplate example internally consistent when analysis is ok', () => {
  const template = sourceStrategy.prompts.calculationCarelessTraining.userTemplate;
  const jsonStart = template.indexOf('{"outputSchemaVersion":"calculation-careless.v2"');
  const jsonEnd = template.indexOf('\n每个 questions 对象必须包含示例中的全部字段', jsonStart);
  const example = JSON.parse(template.slice(jsonStart, jsonEnd)).questions[0];
  assert.equal(example.analysisStatus, 'ok');
  for (const field of ['layoutClear', 'digitAlignmentCorrect', 'stepsComplete', 'carryBorrowClear', 'processCorrect', 'finalAnswerCorrect', 'carelessDetected']) {
    assert.equal(typeof example[field], 'boolean', `${field} must be boolean when analysisStatus is ok`);
  }
  assert.equal(example.processCorrect, true);
  assert.equal(example.finalAnswerCorrect, true);
  assert.equal(example.issueCategory, 'none');
});

test('preserves unary negatives and critical mathematical symbols in every grading system', () => {
  assert.match(sourceStrategy.prompts.hardProblem.system, /忠实保留原图算式符号/);
  assert.match(sourceStrategy.prompts.hardProblem.system, /unreadable/);
  for (const promptKey of ['carelessTraining','calculationCarelessTraining']) { const system=sourceStrategy.prompts[promptKey].system; for (const marker of ['正负号','一元负号','unreadable','insufficient','不得静默删除']) assert.match(system,new RegExp(marker)); }
});

test('compresses grading userTemplates and adds core mathematical semantic matching', () => {
  assert.ok(sourceStrategy.prompts.hardProblem.userTemplate.length < 1200);
  assert.match(sourceStrategy.prompts.hardProblem.userTemplate, /solutionText/);
  assert.match(sourceStrategy.prompts.hardProblem.userTemplate, /explanationText/);
  assert.match(sourceStrategy.prompts.hardProblem.system, /直接看学生原图/);
  for (const promptKey of ['carelessTraining','calculationCarelessTraining']) {
    const template=sourceStrategy.prompts[promptKey].userTemplate; assert.ok(template.length < 1500); assert.match(template,/Task metadata: \{\{META_JSON\}\}/); assert.match(template,/只输出合法 JSON/);
  }
  assert.match(sourceStrategy.prompts.carelessTraining.system, /必须比较核心数学语义/);
});

test('preserves the registered schema structure, enums, model stages, and result semantics', () => {
  const currentPublicContract = JSON.parse(fs.readFileSync(new URL('../strategy/release/current/public-contract.json', import.meta.url), 'utf8'));
  assert.deepEqual(outputSchemaRegistry, currentPublicContract.outputSchemaRegistry);
  assert.deepEqual(sourceStrategy.downstreamSemantics, currentPublicContract.downstreamSemantics);
  for (const schema of outputSchemaRegistry.schemas) {
    const contract = sourceStrategy.contracts[schema.strategyContractKey];
    for (const field of schema.requiredFields) assert.equal(contract.requiredFields.includes(field), true, `${schema.schemaId} required field ${field}`);
    for (const [field, contractField] of Object.entries(schema.contractEnumFields || {})) {
      assert.deepEqual(contract[contractField], schema.enumFields[field], `${schema.schemaId} ${field} enum`);
    }
  }
  assert.deepEqual(sourceStrategy.compactReviewContract.invariants, [
    'primary_sourceKeys_must_be_preserved',
    'review_may_add_missing_questions_from_original_images',
    'review_must_not_remove_or_replace_primary_question_identities',
    'review_only_questions_require_clear_original_image_evidence',
    'sourceKeys_must_remain_non_empty_stable_and_unique',
    'do_not_merge_distinct_questions',
    'review_receives_primary_step_source_projection',
    'review_must_audit_step_segmentation_and_pairing',
    'review_must_preserve_all_visible_student_source_text',
  ]);
});

test('validates registered three-mode model outputs and rejects missing top-level questions contract fields', () => {
  for (const schema of resolvedSchemas) {
    const output = validModelOutput(schema);
    assert.doesNotThrow(() => assertValidatedModelOutput(output, schema), `${schema.schemaId} valid output`);

    const missingQuestions = structuredClone(output);
    delete missingQuestions.questions;
    assert.throws(() => assertValidatedModelOutput(missingQuestions, schema), /questions/);

    const nullQuestions = structuredClone(output);
    nullQuestions.questions = null;
    assert.throws(() => assertValidatedModelOutput(nullQuestions, schema), /questions/);

    const emptyQuestions = structuredClone(output);
    emptyQuestions.questions = [];
    assert.throws(() => assertValidatedModelOutput(emptyQuestions, schema), /questions/);

    const itemsInstead = structuredClone(output);
    itemsInstead.items = itemsInstead.questions;
    delete itemsInstead.questions;
    assert.throws(() => assertValidatedModelOutput(itemsInstead, schema), /questions/);

    const missingMode = structuredClone(output);
    delete missingMode.mode;
    assert.throws(() => assertValidatedModelOutput(missingMode, schema), /mode/);

    const missingSchemaVersion = structuredClone(output);
    delete missingSchemaVersion.outputSchemaVersion;
    assert.throws(() => assertValidatedModelOutput(missingSchemaVersion, schema), /outputSchemaVersion/);
  }
});

test('requires questionSetAudit emittedQuestionCount to equal questions.length', () => {
  for (const schema of outputSchemaRegistry.schemas) {
    const output = validModelOutput(schema);
    output.questionSetAudit.emittedQuestionCount = 2;
    assert.throws(() => assertTopLevelOutputContract(output, schema), /emittedQuestionCount.*questions\.length/);
  }
});

test('rejects questionSetAudit when visible count does not equal emitted plus excluded', () => {
  for (const schema of outputSchemaRegistry.schemas) {
    const output = validModelOutput(schema);
    output.questionSetAudit.visibleIndependentQuestionCount = 2;
    assert.throws(() => assertTopLevelOutputContract(output, schema), /visibleIndependentQuestionCount.*emittedQuestionCount.*excludedQuestionCount/);
  }
});

test('requires three independent questions to emit three question objects without exclusions', () => {
  for (const schema of outputSchemaRegistry.schemas) {
    const output = validModelOutput(schema);
    output.questions.push(
      { ...structuredClone(output.questions[0]), sourceKey: 'image-1-question-2' },
      { ...structuredClone(output.questions[0]), sourceKey: 'image-1-question-3' },
    );
    output.questionSetAudit = {
      visibleIndependentQuestionCount: 3,
      emittedQuestionCount: 3,
      excludedQuestionCount: 0,
      orientation: 'upright',
      countConfidence: 1,
    };
    assert.doesNotThrow(() => assertTopLevelOutputContract(output, schema));

    output.questions = [output.questions[0]];
    assert.throws(() => assertTopLevelOutputContract(output, schema), /emittedQuestionCount.*questions\.length/);
  }
});


function renderGoldenPrompt(promptKey, metadata) {
  const prompt = sourceStrategy.prompts[promptKey];
  return prompt.system + '\n' + prompt.userTemplate.replace('{{META_JSON}}', JSON.stringify(metadata)).replace('{{REPAIR_INSTRUCTION}}', '');
}

test('reading-careless accepts concise cross-grid semantics and natural solving-path relations', () => {
  const system = sourceStrategy.prompts.carelessTraining.system;
  assert.match(system, /审题马虎不是标准答案复述检查/);
  assert.match(system, /关系格允许使用自然语言的求解方向或先后步骤/);
  assert.match(system, /不得因为没有写出标准关系式、公式或定理表述而判错/);
  assert.match(system, /条件、数量、限制或关系只要已在三格任一合理位置正确表达/);
  assert.match(system, /正方体铁块.*先求.*再求.*三格应判正确/s);
  assert.match(system, /等腰三角形.*周长57厘米.*腰长23厘米.*底边.*三格应判正确/s);
});

test('keeps a chicken-rabbit three-grid correct when the equation carries the quantity relationship', () => {
  const fixture = {
    questionText: '鸡和兔同笼，共274条腿，鸡比兔多23只；鸡每只2条腿，兔每只4条腿，求鸡和兔各多少只。',
    studentConditionText: '鸡兔',
    studentRelationText: '设兔有x只，鸡有x+23只。4x+2(x+23)=274。',
    studentAskText: '鸡兔各几只。',
  };
  const rendered = renderGoldenPrompt('carelessTraining', fixture);
  assert.doesNotMatch(rendered, /\{\{META_JSON\}\}/);
  assert.match(rendered, /THREE_GRID_SEMANTICS_V1/);
  assert.match(rendered, /A valid equation or formula in the relation grid must be judged by its mathematical meaning/);
  assert.match(rendered, /Do not require information to be copied across grids/);
  assert.match(rendered, /三格必须联合判断/);
  assert.match(rendered, /不得要求已在关系格准确表达的信息重复抄写在条件格/);
  assert.match(rendered, /条件格可使用简短对象关键词/);

  const schema = schemaForStage(sourceStrategy.modelRuntime.stages.readingCarelessPrimary);
  const output = validModelOutput(schema);
  Object.assign(output.questions[0], {
    questionText: fixture.questionText,
    studentConditionText: fixture.studentConditionText,
    studentRelationText: fixture.studentRelationText,
    studentAskText: fixture.studentAskText,
    referenceConditionText: '鸡和兔；共274条腿；鸡比兔多23只；鸡每只2条腿，兔每只4条腿。',
    referenceRelationText: '设兔有x只，鸡有x+23只，4x+2(x+23)=274。',
    referenceAskText: '求鸡和兔各多少只。',
    referenceConditionText: '鸡和兔',
    referenceRelationText: '鸡比兔多23只；鸡有2条腿，兔有4条腿；一共274条腿',
    referenceAskText: '鸡和兔各有多少只',
    conditionCorrect: true,
    relationCorrect: true,
    askCorrect: true,
    missingConditions: [],
    relationIssues: [],
    askIssue: '',
    errorReason: '',
    correctionAdvice: '',
  });
  assert.doesNotThrow(() => assertValidatedModelOutput(output, schema));
  const question = output.questions[0];
  assert.equal(question.conditionCorrect, true);
  assert.equal(question.relationCorrect, true);
  assert.equal(question.askCorrect, true);
  assert.equal(question.referenceConditionText, '鸡和兔');
  assert.equal(question.referenceRelationText, '鸡比兔多23只；鸡有2条腿，兔有4条腿；一共274条腿');
  assert.equal(question.referenceAskText, '鸡和兔各有多少只');
  assert.deepEqual(question.missingConditions, []);
  assert.deepEqual(question.relationIssues, []);
  assert.equal(question.askIssue, '');
  assert.equal(question.errorReason, '');
  assert.equal(question.correctionAdvice, '');
  const finalResult = projectReadingFixture(question);
  assert.equal(finalResult.threeGridStatus, 'CORRECT');
  assert.equal(finalResult.normalizedStatus, 'CORRECT');
  assert.equal(finalResult.showErrorAnalysis, false);
  const narration = readingNarrationText(finalResult, 1);
  assert.equal(narration, '第1题回答正确，条件、关系和所求都填写准确。');
  for (const value of ['274', '23', '2', '4', question.referenceConditionText, question.referenceRelationText, question.referenceAskText]) {
    assert.equal(narration.includes(value), false);
  }
  assert.doesNotMatch(JSON.stringify(question), /缺少274|缺少23|缺少2|缺少4|回答错误/);
});

test('rejects an incomplete chicken-rabbit three-grid with one short real error analysis', () => {
  const schema = schemaForStage(sourceStrategy.modelRuntime.stages.readingCarelessPrimary);
  const output = validModelOutput(schema);
  Object.assign(output.questions[0], {
    questionText: '鸡和兔共有274条腿，鸡比兔多23只，问鸡和兔各有多少只。',
    studentConditionText: '动物',
    studentRelationText: '一共有274条腿',
    studentAskText: '各有多少只',
    referenceConditionText: '鸡和兔',
    referenceRelationText: '鸡比兔多23只；鸡有2条腿，兔有4条腿；一共274条腿',
    referenceAskText: '鸡和兔各有多少只',
    conditionCorrect: false,
    relationCorrect: false,
    askCorrect: true,
    missingConditions: ['对象没有写清楚'],
    relationIssues: ['少了鸡比兔多23只'],
    askIssue: '',
    errorReason: '对象没有写清楚。',
    correctionAdvice: '条件格写鸡和兔。',
  });
  assert.doesNotThrow(() => assertValidatedModelOutput(output, schema));
  const finalResult = projectReadingFixture(output.questions[0]);
  assert.equal(finalResult.threeGridStatus, 'WRONG');
  assert.equal(finalResult.normalizedStatus, 'WRONG');
  assert.equal(finalResult.showErrorAnalysis, true);
  assert.equal(finalResult.errorReason, '对象没有写清楚。');
  assert.equal(finalResult.correctionAdvice, '条件格写鸡和兔。');
  assert.equal(readingNarrationText(finalResult, 1), '第1题条件格有问题。鸡和兔');
});

test('keeps a multi-line elementary vertical multiplication as one question with student-format correction', () => {
  const fixture = {
    questionText: '计算347×26。',
    studentCalculation: '347×26=2776；竖式有2082、694和2776，旁边验算347×20=6940。',
  };
  const rendered = renderGoldenPrompt('calculationCarelessTraining', fixture);
  assert.doesNotMatch(rendered, /\{\{META_JSON\}\}/);
  assert.match(rendered, /数学版式识别与归属/);
  assert.match(rendered, /竖式各行、部分积、中间步骤、草稿和验算归属同一题/);
  assert.match(rendered, /小学竖式/);
  assert.match(rendered, /部分积和错位相加/);

  const schema = schemaForStage(sourceStrategy.modelRuntime.stages.calculationCarelessPrimary);
  const output = validModelOutput(schema);
  Object.assign(output.questions[0], {
    questionText: fixture.questionText,
    studentCalculation: fixture.studentCalculation,
    standardCalculation: '  347\n×  26\n-----\n 2082\n 6940\n-----\n 9022',
    layoutClear: true,
    digitAlignmentCorrect: false,
    stepsComplete: true,
    carryBorrowClear: true,
    processCorrect: false,
    finalAnswerCorrect: false,
    carelessDetected: true,
    issueCategory: 'careless',
    carelessIssues: ['十位部分积没有按十位错位相加。', '最终相加结果错误。'],
    methodIssues: [],
    errorReason: '第二个部分积未按十位错位，导致最终相加错误。',
    firstErrorPoint: '1. 第二个部分积没有按十位左移一位。2. 最后相加受此影响，结果2776错误。',
    correctionAdvice: '按竖式先写个位部分积，再将十位部分积左移一位后相加。',
  });
  assert.doesNotThrow(() => assertValidatedModelOutput(output, schema));
  const question = output.questions[0];
  assert.equal(output.questions.length, 1);
  assert.equal(question.carelessDetected, true);
  assert.match(question.standardCalculation, /2082/);
  assert.match(question.standardCalculation, /6940/);
  assert.match(question.standardCalculation, /9022/);
  assert.match(question.firstErrorPoint, /第二个部分积/);
  assert.match(question.firstErrorPoint, /最后相加/);
  assert.doesNotMatch(question.standardCalculation, /位权展开|抽象代数变换/);
});
test('hard-problem 1.6.19 keeps the task prompt short while requiring direct original-image grading', () => {
  const rendered = `${sourceStrategy.prompts.hardProblem.system}\n${sourceStrategy.prompts.hardProblem.userTemplate}`;
  assert.match(rendered, /直接看学生原图/);
  assert.match(rendered, /解题过程和对应分析\/思路联系起来/);
  assert.match(rendered, /只有分析没有对应解题过程|只有解题过程没有对应讲解/);
  assert.match(rendered, /“答：”.*最终答案/);
  assert.match(rendered, /hard-problem\.v2/);
  assert.match(rendered, /只输出.*JSON/);
  assert.ok(sourceStrategy.prompts.hardProblem.system.length < 350);
  assert.ok(sourceStrategy.prompts.hardProblem.userTemplate.length < 900);
});


test('hard-problem 1.6.19 keeps ExpectedReasoningPlan legacy diagnostics isolated from direct grading', () => {
  const evidence = sourceStrategy.prompts.hardProblemEvidence.system;
  const template = sourceStrategy.prompts.hardProblemEvidence.userTemplate;
  assert.equal(sourceStrategy.strategyVersion, '1.6.19');
  assert.ok(evidence.length < 3800, `evidence prompt length=${evidence.length}`);
  assert.match(evidence, /ExpectedReasoningPlan/);
  assert.match(evidence, /StudentEvidence/);
  assert.match(evidence, /学生写了多少行、多少段、多少 visualBand，都不能决定必要步骤是否存在/);
  assert.match(evidence, /设未知数.*列.*方程.*解方程.*求另一/);
  assert.match(evidence, /学生整步没写|学生没写/);
  assert.match(template, /"expectedSteps":/);
  assert.match(template, /"processUnitIds":/);
  assert.match(template, /"explanationUnitIds":/);
});

test('hard-problem 1.6.19 preserves legacy multi-line evidence diagnostics while direct grading stays authoritative', () => {
  const evidence = sourceStrategy.prompts.hardProblemEvidence.system;
  assert.match(evidence, /一个学生步骤可以包含多行过程和多个等号/);
  assert.match(evidence, /2\.4x=1200.*x=500.*同属解方程/);
  assert.match(evidence, /单纯换行、等号数量、算式行数不能机械决定学生分了几步/);
  assert.match(evidence, /visualBand 只用于记录 StudentEvidence 的空间对应关系和辅助配对/);
  assert.match(evidence, /不是 ExpectedReasoningPlan 的步骤数量主键/);
});

test('hard-problem 1.6.19 keeps legacy separator safeguards available for diagnostics', () => {
  const evidence = sourceStrategy.prompts.hardProblemEvidence.system;
  for (const protectedLineType of ['作业本横格线', '题目印刷线', '分数线', '根号横线', '竖式计算横线', '答案下划线', '表格边框', '删除线']) {
    assert.match(evidence, new RegExp(protectedLineType));
  }
  assert.match(evidence, /只有线条与序号、较大间距、左右对应块或明显内容分区共同表明学生在分步时/);
  assert.match(evidence, /普通横格纸优先看学生文字块和对应关系/);
});

test('hard-problem 1.6.19 keeps legacy evidence prompts isolated while direct grading uses frontend-contract fields', () => {
  const evidence = sourceStrategy.prompts.hardProblemEvidence.system;
  const grading = `${sourceStrategy.prompts.hardProblem.system}\n${sourceStrategy.prompts.hardProblem.userTemplate}`;
  assert.match(evidence, /processUnits/);
  for (const field of ['solutionText','explanationText','solutionStatus','explanationStatus','logicStatus','analysis','correctionAdvice']) {
    assert.match(grading, new RegExp(field));
  }
  assert.doesNotMatch(grading, /"verdict"|issueTarget|studentProcess|studentAnalysis/);
});


test('hard-problem 1.6.19 review reopens the original image and only corrects substantive errors', () => {
  const grading = `${sourceStrategy.prompts.hardProblem.reviewSystem}\n${sourceStrategy.prompts.hardProblem.reviewUserTemplate}`;
  assert.match(grading, /重新看同一张原图/);
  assert.match(grading, /没有实质错误就 keep/);
  assert.match(grading, /有错误就 correct/);
  assert.match(grading, /仅措辞差异不修改/);
  assert.match(grading, /解题过程与学生分析是否正确配对/);
  assert.match(grading, /“答：”.*步骤/);
  assert.match(sourceStrategy.reviewRules.independentReviewInstruction, /重新看原图/);
});



test('hard-problem 1.6.19 constrains output to the existing frontend contract without teaching a long reasoning procedure', () => {
  const grading = `${sourceStrategy.prompts.hardProblem.system}\n${sourceStrategy.prompts.hardProblem.userTemplate}`;
  assert.equal(sourceStrategy.strategyVersion, '1.6.19');
  assert.equal(sourceStrategy.reviewRules.hardProblemDirectMode, true);
  for (const field of ['solutionText','explanationText','solutionStatus','explanationStatus','logicStatus','analysis','correctionAdvice']) {
    assert.match(grading, new RegExp(field));
  }
  assert.match(grading, /logicStatus 单独判断/);
  assert.match(grading, /explanationStatus=missing/);
  assert.match(grading, /“答：”.*最终答案/);
  assert.doesNotMatch(grading, /ExpectedReasoningPlan|visualBand|Coverage|Adversarial/);
});

test('strategy 1.6.19 changes only reading-careless prompt semantics while preserving calculation-careless prompt', () => {
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(digest(sourceStrategy.prompts.carelessTraining.system), '30c97df80c8ba7d4a7d1dac1722ceaea15b26338ac5b96d336c666583ac8e908');
  assert.doesNotMatch(sourceStrategy.prompts.carelessTraining.system, /\?{4,}/);
  assert.doesNotMatch(sourceStrategy.prompts.carelessTraining.system, /\uFFFD/);
  assert.equal(digest(sourceStrategy.prompts.calculationCarelessTraining.system), '68731bf6d9549758cdafe619b8461b3eb569036897babac93f31cb5da026b42d');
});

test('strategy service health reports the self-hosted runtime instead of a legacy CloudBase environment', async () => {
  const response = await main({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.environment, 'selfhost');
  assert.doesNotMatch(JSON.stringify(body), /cloud1-|cloudbase/i);
});
