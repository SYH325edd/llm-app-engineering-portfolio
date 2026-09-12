import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStrategyContracts } from './strategy-contract-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'strategy', 'source');
const expectedSchemas = ['calculation-careless.v2', 'hard-problem.v2', 'reading-careless.v2'];
const expectedStages = {
  hardProblemPrimary: 'hard-problem.v2', hardProblemReview: 'hard-problem.v2',
  readingCarelessPrimary: 'reading-careless.v2', readingCarelessReview: 'reading-careless.v2',
  calculationCarelessPrimary: 'calculation-careless.v2', calculationCarelessReview: 'calculation-careless.v2',
};

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function validateOutputSchemaRegistry(registry) {
  if (registry?.outputSchemaRegistryVersion !== 'output-schema-registry.v1') throw new Error('outputSchemaRegistryVersion is invalid');
  if (registry.downstreamSemanticsVersion !== 'result-semantics.v1' || !Array.isArray(registry.schemas)) throw new Error('output schema registry is invalid');
  const ids = registry.schemas.map((schema) => schema?.schemaId).sort();
  if (!sameValues(ids, expectedSchemas)) throw new Error('required output schemas are missing');
  for (const schema of registry.schemas) {
    for (const field of ['schemaId', 'version', 'mode', 'strategyContractKey', 'promptKey', 'requiredFields', 'fieldTypes', 'downstreamSemanticsVersion']) {
      if (schema?.[field] === undefined) throw new Error(`${schema?.schemaId || 'schema'} registry field is missing: ${field}`);
    }
    if (!sameValues(schema.requiredFields, Object.keys(schema.fieldTypes)) || schema.downstreamSemanticsVersion !== 'result-semantics.v1') throw new Error(`${schema.schemaId} is invalid`);
  }
}

export function validateStrategyForPublish(strategy, options = {}) {
  const registry = options.registry || JSON.parse(fs.readFileSync(path.join(options.sourceDir || sourceDir, 'output-schema-registry.json'), 'utf8'));
  validateOutputSchemaRegistry(registry);
  if (strategy?.downstreamSemanticsVersion !== 'result-semantics.v1') throw new Error('downstreamSemanticsVersion must be result-semantics.v1');
  if (strategy.outputSchemaRegistryVersion !== registry.outputSchemaRegistryVersion) throw new Error('outputSchemaRegistryVersion is invalid');
  if (!sameValues([...strategy.outputSchemaIds || []].sort(), expectedSchemas)) throw new Error('outputSchemaIds are invalid');
  for (const schema of registry.schemas) {
    const contract = strategy.contracts?.[schema.strategyContractKey];
    const prompt = strategy.prompts?.[schema.promptKey];
    if (contract?.outputSchemaVersion !== schema.schemaId || !prompt) throw new Error(`${schema.schemaId} strategy contract or prompt is missing`);
    if (schema.schemaId === 'hard-problem.v2' && !`${prompt.system || ''}\n${prompt.userTemplate || ''}`.includes(schema.schemaId)) throw new Error('hard-problem prompt requirement is missing: hard-problem.v2');
    for (const field of schema.requiredFields) if (!contract.requiredFields?.includes(field)) throw new Error(`${schema.schemaId} required field is missing: ${field}`);
    for (const [field, contractField] of Object.entries(schema.contractEnumFields || {})) {
      if (!sameValues(contract[contractField], schema.enumFields[field])) throw new Error(`${schema.schemaId} enum is invalid: ${contractField}`);
    }
  }
  validateStrategyContracts(strategy, registry);
  const semantics = strategy.downstreamSemantics;
  for (const [mode, states] of Object.entries({
    'hard-problem.v2': ['CORRECT', 'WRONG', 'UNANSWERED', 'UNREADABLE'],
    'reading-careless.v2': ['CORRECT', 'WRONG', 'UNDETERMINED'],
    'calculation-careless.v2': ['CORRECT', 'WRONG', 'UNDETERMINED'],
  })) {
    if (!semantics?.modes?.[mode]) throw new Error(`${mode} downstream semantics is missing`);
    for (const state of states) {
      const rule = semantics.modes[mode].rules?.[state];
      if (!rule) throw new Error(`${mode} ${state} rule is missing`);
      for (const field of ['normalizedStatus', 'isCorrect', 'resultCategory', 'shouldRecordWrongQuestion', 'wrongQuestionDisposition', 'checkinEligible', 'reviewDisposition', 'ttsDisposition']) {
        if (rule[field] === undefined) throw new Error(`${mode} ${state} rule is missing ${field}`);
      }
    }
  }
  if (Object.values(semantics.modes['hard-problem.v2'].rules).some((rule) => String(rule.resultCategory).includes('careless'))) throw new Error('hard-problem downstream semantics must not contain careless classification');
  if (JSON.stringify(semantics.modes['reading-careless.v2']).includes('finalAnswerCorrect') || JSON.stringify(semantics.modes['reading-careless.v2']).includes('completeCalculationProcess')) throw new Error('reading-careless downstream semantics must not depend on final answer or complete calculation process');
  if (Object.values(semantics.modes['calculation-careless.v2'].rules).some((rule) => (rule.dependsOn || []).includes('carelessDetected=false'))) throw new Error('calculation-careless downstream semantics must not derive correctness from carelessDetected=false');
  if (strategy.modelRuntimeContractVersion !== 'model-runtime.v1') throw new Error('modelRuntimeContractVersion is invalid');
  const stages = strategy.modelRuntime?.stages || {};
  if (!sameValues(Object.keys(stages).sort(), Object.keys(expectedStages).sort())) throw new Error('model-runtime.v1 stages are incomplete');
  for (const [stage, schemaId] of Object.entries(expectedStages)) {
    const definition = stages[stage];
    if (definition?.outputSchemaVersion !== schemaId) throw new Error(`${stage} outputSchemaVersion is invalid`);
    const model = strategy.models?.[definition.modelTier];
    if (!model) throw new Error(`${stage} modelTier is invalid`);
    if (typeof definition.temperature !== 'number' || definition.temperature < 0 || definition.temperature > 1) throw new Error(`${stage} temperature is invalid`);
    if (!Number.isInteger(definition.maxOutputTokens) || definition.maxOutputTokens <= 0) throw new Error(`${stage} maxOutputTokens is invalid`);
    if (!Number.isInteger(model.maxOutputTokens) || definition.maxOutputTokens > (definition.modelTier === 'lite' ? 20000 : model.maxOutputTokens)) throw new Error(`${stage} maxOutputTokens is invalid`);
    if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs <= 0) throw new Error(`${stage} timeoutMs is invalid`);
    const expectedStructuredOutputMode = model.apiMode === 'chat_completions' ? 'json_object'
      : model.apiMode === 'responses' ? 'none' : null;
    if (definition.structuredOutputMode !== expectedStructuredOutputMode) throw new Error(`${stage} structuredOutputMode is invalid`);
    if (![0, 1, 2].includes(definition.maxRepairAttempts)) throw new Error(`${stage} maxRepairAttempts is invalid`);
    if (definition.reviewPayloadMode !== 'compact') throw new Error(`${stage} reviewPayloadMode is invalid`);
  }
  const repair = strategy.modelOutputRepairPolicy;
  const prohibitedRepairs = ['do_not_guess_student_answer_correctness', 'do_not_change_null_to_false', 'do_not_fabricate_missing_business_judgment_fields', 'do_not_fabricate_business_conclusions', 'do_not_rewrite_sourceKey', 'do_not_add_delete_or_merge_questions', 'do_not_auto_correct_invalid_enums', 'do_not_change_v2_business_conclusions'];
  if (repair?.version !== 'model-output-repair.v1' || repair.maxAttempts !== 2 || repair.repairOnlyStructuralErrors !== true || repair.failureHandling !== 'retry_once_then_fail_explicitly') throw new Error('modelOutputRepairPolicy is invalid');
  if (!prohibitedRepairs.every((rule) => repair.prohibitedRepairs?.includes(rule))) throw new Error('modelOutputRepairPolicy prohibitedRepairs is invalid');
}
