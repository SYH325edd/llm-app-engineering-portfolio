const supportedFieldTypes = new Set([
  'string',
  'boolean',
  'number',
  'array',
  'object',
  'enum',
  'integer_min_0',
  'number_0_to_1',
]);

const expectedStages = {
  hardProblemPrimary: 'hard-problem.v2',
  hardProblemReview: 'hard-problem.v2',
  readingCarelessPrimary: 'reading-careless.v2',
  readingCarelessReview: 'reading-careless.v2',
  calculationCarelessPrimary: 'calculation-careless.v2',
  calculationCarelessReview: 'calculation-careless.v2',
};

const topLevelDefaults = {
  outputSchemaVersion: 'string',
  mode: 'string',
  route: 'object',
  imageQuality: 'object',
  questions: 'array',
  questionSetAudit: 'object',
};

function fail(message) {
  throw new Error(`strategy contract: ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertFieldType(type, context) {
  if (!supportedFieldTypes.has(type)) fail(`${context} has unsupported type ${String(type)}`);
}

function hasField(fields, field, context) {
  if (!Object.hasOwn(fields, field)) fail(`${context} references unknown field ${field}`);
}

function validateRuleReferences(rule, fields, context) {
  if (!isPlainObject(rule)) fail(`${context} must be an object`);
  for (const key of ['when', 'require', 'requireTypes']) {
    if (rule[key] !== undefined && !isPlainObject(rule[key])) fail(`${context}.${key} must be an object`);
  }
  for (const key of ['requireNull', 'requireNonEmptyStrings']) {
    if (rule[key] !== undefined && !Array.isArray(rule[key])) fail(`${context}.${key} must be an array`);
  }
  for (const field of Object.keys(rule.when || {})) hasField(fields, field, `${context}.when`);
  for (const field of Object.keys(rule.require || {})) hasField(fields, field, `${context}.require`);
  for (const [field, type] of Object.entries(rule.requireTypes || {})) {
    hasField(fields, field, `${context}.requireTypes`);
    assertFieldType(type, `${context}.requireTypes.${field}`);
  }
  for (const key of ['requireNull', 'requireNonEmptyStrings']) {
    for (const field of rule[key] || []) hasField(fields, field, `${context}.${key}`);
  }
}

function validateObjectSchema(schema, context) {
  if (!isPlainObject(schema) || !Array.isArray(schema.requiredFields) || !isPlainObject(schema.fieldTypes)) {
    fail(`${context} must define requiredFields and fieldTypes`);
  }
  for (const field of schema.requiredFields) {
    if (typeof field !== 'string' || !field) fail(`${context} has an invalid required field`);
    hasField(schema.fieldTypes, field, context);
  }
  for (const [field, type] of Object.entries(schema.fieldTypes)) assertFieldType(type, `${context}.${field}`);
  for (const [field, values] of Object.entries(schema.enumFields || {})) {
    hasField(schema.fieldTypes, field, `${context}.enumFields`);
    if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== 'string' || !value)) {
      fail(`${context}.enumFields.${field} must be a non-empty string enum`);
    }
  }
  for (const [field, type] of Object.entries(schema.fieldTypes)) {
    if (type === 'enum' && (!Array.isArray(schema.enumFields?.[field]) || schema.enumFields[field].length === 0)) {
      fail(`${context}.${field} enum is missing enumFields`);
    }
  }
  for (const field of schema.arrayFields || []) {
    hasField(schema.fieldTypes, field, `${context}.arrayFields`);
    if (schema.fieldTypes[field] !== 'array') fail(`${context}.arrayFields.${field} must be array`);
  }
  for (const [field, itemSchema] of Object.entries(schema.arrayItemSchemas || {})) {
    hasField(schema.fieldTypes, field, `${context}.arrayItemSchemas`);
    if (schema.fieldTypes[field] !== 'array') fail(`${context}.arrayItemSchemas.${field} must reference an array field`);
    validateObjectSchema(itemSchema, `${context}.arrayItemSchemas.${field}`);
  }
  for (const [field, range] of Object.entries(schema.numericRanges || {})) {
    hasField(schema.fieldTypes, field, `${context}.numericRanges`);
    if (!['number', 'number_0_to_1', 'integer_min_0'].includes(schema.fieldTypes[field])) {
      fail(`${context}.numericRanges.${field} must reference a numeric field`);
    }
    if (!isPlainObject(range) || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max) {
      fail(`${context}.numericRanges.${field} must be a valid range`);
    }
  }
  for (const rule of schema.consistencyRules || []) {
    if (typeof rule === 'string') {
      if (!['emittedQuestionCount_equals_questions_length', 'visibleIndependentQuestionCount_equals_emittedQuestionCount_plus_excludedQuestionCount'].includes(rule)) {
        fail(`${context}.consistencyRules has an unsupported named rule`);
      }
    } else {
      validateRuleReferences(rule, schema.fieldTypes, `${context}.consistencyRules`);
    }
  }
}

export function resolveRuntimeSchemas(strategy, registry) {
  if (!isPlainObject(strategy?.contracts) || !Array.isArray(registry?.schemas)) fail('strategy contracts or schema registry is missing');
  return registry.schemas.map((schema) => {
    const contract = strategy.contracts[schema.strategyContractKey];
    if (!isPlainObject(contract)) fail(`${schema.schemaId} is missing strategy contract ${schema.strategyContractKey}`);
    return {
      ...schema,
      registrySchema: schema,
      contract,
      requiredFields: [...new Set([...(schema.requiredFields || []), ...(contract.requiredFields || [])])],
      fieldTypes: { ...(schema.fieldTypes || {}), ...(contract.fieldTypes || {}) },
      enumFields: { ...(schema.enumFields || {}), ...(contract.enumFields || {}) },
      arrayFields: [...new Set([...(schema.arrayFields || []), ...(contract.arrayFields || [])])],
      arrayItemSchemas: { ...(schema.arrayItemSchemas || {}), ...(contract.arrayItemSchemas || {}) },
      topLevelRequiredFields: contract.topLevelRequiredFields,
      topLevelFieldTypes: { ...topLevelDefaults, ...(contract.topLevelFieldTypes || {}) },
      topLevelEnumFields: contract.topLevelEnumFields || {},
      topLevelObjectSchemas: contract.topLevelObjectSchemas || {},
    };
  });
}

function extractJsonExample(template) {
  const start = template.indexOf('{"outputSchemaVersion"');
  if (start < 0) fail('prompt userTemplate has no JSON example');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < template.length; index += 1) {
    const char = template[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(template.slice(start, index + 1));
    }
  }
  fail('prompt userTemplate JSON example is incomplete');
}

function validatePromptCoverage(strategy, resolvedSchema) {
  const prompt = strategy.prompts?.[resolvedSchema.promptKey];
  if (!isPlainObject(prompt) || typeof prompt.system !== 'string' || typeof prompt.userTemplate !== 'string') {
    fail(`${resolvedSchema.schemaId} prompt is missing`);
  }
  if (resolvedSchema.schemaId === 'hard-problem.v2' && strategy?.reviewRules?.hardProblemDirectMode === true) {
    if (!/直接看学生原图/.test(prompt.system) || !/只输出.*JSON/.test(prompt.system)) fail('hard-problem direct prompt must require original-image JSON grading');
    const text = prompt.userTemplate;
    const start = text.indexOf('{"questions"');
    if (start < 0) fail('hard-problem direct prompt has no JSON example');
    let depth = 0, quoted = false, escaped = false, example = null;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === '{') depth += 1;
      else if (char === '}') { depth -= 1; if (depth === 0) { example = JSON.parse(text.slice(start, index + 1)); break; } }
    }
    if (!example || !Array.isArray(example.questions) || !example.questions.length) fail('hard-problem direct prompt example questions is invalid');
    const q = example.questions[0];
    for (const field of ['questionText','studentAnswer','standardAnswer','finalAnswerVerdict','steps','overallFeedback','confidence']) if (!Object.hasOwn(q, field)) fail(`hard-problem direct prompt example omits ${field}`);
    if (!Array.isArray(q.steps) || !q.steps.length) fail('hard-problem direct prompt example steps is invalid');
    for (const field of ['stepTitle','solutionText','explanationText','solutionStatus','explanationStatus','logicStatus','analysis','correctionAdvice']) if (!Object.hasOwn(q.steps[0], field)) fail(`hard-problem direct prompt step omits ${field}`);
    return;
  }
  if (!/Every questions\[\] object must include every field required by its outputSchemaVersion Schema/i.test(prompt.system)) {
    fail(`${resolvedSchema.schemaId} prompt does not require the complete schema`);
  }
  const example = extractJsonExample(prompt.userTemplate);
  for (const field of resolvedSchema.topLevelRequiredFields) {
    if (!Object.hasOwn(example, field)) fail(`${resolvedSchema.schemaId} prompt example omits top-level ${field}`);
  }
  if (!Array.isArray(example.questions) || example.questions.length === 0) fail(`${resolvedSchema.schemaId} prompt example questions is invalid`);
  for (const field of resolvedSchema.requiredFields) {
    if (!Object.hasOwn(example.questions[0], field)) fail(`${resolvedSchema.schemaId} prompt example omits ${field}`);
  }
  for (const [field, itemSchema] of Object.entries(resolvedSchema.arrayItemSchemas || {})) {
    const items = example.questions[0][field];
    if (!Array.isArray(items) || items.length === 0) fail(`${resolvedSchema.schemaId} prompt example ${field} is invalid`);
    for (const itemField of itemSchema.requiredFields || []) if (!Object.hasOwn(items[0], itemField)) fail(`${resolvedSchema.schemaId} prompt example ${field} omits ${itemField}`);
  }
  if (resolvedSchema.schemaId === 'hard-problem.v2') {
    const question = example.questions[0];
    for (const field of ['sourceKey', 'questionText', 'sourceQuestionLabel', 'sourceRegion', 'overallFeedback']) {
      if (typeof question[field] !== 'string' || !question[field].trim()) fail(`hard-problem.v2 prompt example ${field} must be non-empty`);
    }
    const firstStep = question.stepFeedbacks?.[0];
    for (const field of ['solutionText', 'explanationText', 'analysis']) {
      if (typeof firstStep?.[field] !== 'string' || !firstStep[field].trim()) fail(`hard-problem.v2 prompt example stepFeedbacks.${field} must be non-empty`);
    }
    if (firstStep.solutionStatus === 'correct' && !firstStep.solutionText.trim()) fail('hard-problem.v2 correct solution example must include source text');
    if (firstStep.explanationStatus === 'clear' && !firstStep.explanationText.trim()) fail('hard-problem.v2 clear explanation example must include source text');
  }
}


function sameStringSet(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}
function normalizeContractType(type) { return type === 'enum' ? 'string' : type; }
function validateHardRegistryContractAlignment(schema) {
  if (schema.schemaId !== 'hard-problem.v2') return;
  const registrySchema = schema.registrySchema;
  const contract = schema.contract;
  if (!sameStringSet(registrySchema.requiredFields, contract.requiredFields)) fail('hard-problem.v2 registry requiredFields differ from strategy contract');
  for (const [field, type] of Object.entries(contract.fieldTypes || {})) {
    if (registrySchema.fieldTypes?.[field] !== normalizeContractType(type)) fail(`hard-problem.v2 registry fieldTypes.${field} differs from strategy contract`);
  }
  for (const [field, values] of Object.entries(contract.enumFields || {})) {
    if (JSON.stringify(registrySchema.enumFields?.[field] || []) !== JSON.stringify(values)) fail(`hard-problem.v2 registry enumFields.${field} differs from strategy contract`);
  }
  if (JSON.stringify(registrySchema.arrayItemSchemas?.stepFeedbacks || {}) !== JSON.stringify(contract.arrayItemSchemas?.stepFeedbacks || {})) fail('hard-problem.v2 registry stepFeedbacks schema differs from strategy contract');
  if (JSON.stringify(registrySchema.reviewProjection || {}) !== JSON.stringify(contract.reviewProjection || {})) fail('hard-problem.v2 reviewProjection differs from strategy contract');
  if (JSON.stringify(registrySchema.wrongQuestionProjection || {}) !== JSON.stringify(contract.wrongQuestionProjection || {})) fail('hard-problem.v2 wrongQuestionProjection differs from strategy contract');
}

export function validateStrategyContracts(strategy, registry) {
  const schemas = resolveRuntimeSchemas(strategy, registry);
  if (schemas.length !== 3) fail('schema registry must contain exactly three schemas');
  for (const schema of schemas) {
    if (!schema.schemaId?.endsWith('.v2') || !schema.mode || !schema.promptKey) fail('schema identity is invalid');
    validateObjectSchema(schema, schema.schemaId);
    validateHardRegistryContractAlignment(schema);
    validateObjectSchema({
      requiredFields: schema.topLevelRequiredFields,
      fieldTypes: schema.topLevelFieldTypes,
      enumFields: schema.topLevelEnumFields,
      arrayFields: [],
      numericRanges: {},
      consistencyRules: [],
    }, `${schema.schemaId}.topLevel`);
    for (const [name, objectSchema] of Object.entries(schema.topLevelObjectSchemas)) {
      hasField(schema.topLevelFieldTypes, name, `${schema.schemaId}.topLevelObjectSchemas`);
      if (schema.topLevelFieldTypes[name] !== 'object') fail(`${schema.schemaId}.${name} must be object`);
      validateObjectSchema(objectSchema, `${schema.schemaId}.${name}`);
    }
    const enumValues = new Set(Object.values(schema.enumFields).flat());
    for (const [field, statuses] of Object.entries(schema.nullableFields || {})) {
      hasField(schema.fieldTypes, field, `${schema.schemaId}.nullableFields`);
      if (!Array.isArray(statuses) || statuses.length === 0 || statuses.some((status) => !enumValues.has(status))) {
        fail(`${schema.schemaId}.nullableFields.${field} has invalid status condition`);
      }
    }
    for (const [field, contractKey] of Object.entries(schema.contractEnumFields || {})) {
      if (!Array.isArray(schema.enumFields[field]) || !Array.isArray(schema.contract[contractKey])) fail(`${schema.schemaId}.${field} enum contract is missing`);
      if (JSON.stringify(schema.enumFields[field]) !== JSON.stringify(schema.contract[contractKey])) {
        fail(`${schema.schemaId}.${field} enum differs from strategy contract`);
      }
    }
    validatePromptCoverage(strategy, schema);
  }
  const stages = strategy.modelRuntime?.stages;
  if (!isPlainObject(stages) || JSON.stringify(Object.keys(stages).sort()) !== JSON.stringify(Object.keys(expectedStages).sort())) {
    fail('model runtime must define the six expected stages');
  }
  for (const [stage, schemaId] of Object.entries(expectedStages)) {
    if (stages[stage]?.outputSchemaVersion !== schemaId) fail(`${stage} must bind ${schemaId}`);
  }
  return schemas;
}

function matchesType(value, type) {
  if (value === null) return false;
  if (type === 'string' || type === 'enum') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number' || type === 'number_0_to_1') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer_min_0') return Number.isInteger(value) && value >= 0;
  if (type === 'array') return Array.isArray(value);
  return isPlainObject(value);
}

export function validateModelOutput(output, schema) {
  if (!isPlainObject(output)) fail(`${schema.schemaId} output must be an object`);
  for (const field of schema.topLevelRequiredFields) {
    if (!Object.hasOwn(output, field)) fail(`${schema.schemaId} output misses top-level ${field}`);
    if (!matchesType(output[field], schema.topLevelFieldTypes[field])) fail(`${schema.schemaId} top-level ${field} has invalid type`);
  }
  if (output.outputSchemaVersion !== schema.schemaId || output.mode !== schema.mode) fail(`${schema.schemaId} top-level identity is invalid`);
  if (!Array.isArray(output.questions) || output.questions.length === 0) fail(`${schema.schemaId} questions must be non-empty`);
  const audit = schema.topLevelObjectSchemas.questionSetAudit;
  for (const field of audit.requiredFields) {
    if (!Object.hasOwn(output.questionSetAudit, field) || !matchesType(output.questionSetAudit[field], audit.fieldTypes[field])) fail(`${schema.schemaId} questionSetAudit.${field} is invalid`);
  }
  if (!audit.enumFields.orientation.includes(output.questionSetAudit.orientation)) fail(`${schema.schemaId} questionSetAudit.orientation is invalid`);
  if (output.questionSetAudit.countConfidence < 0 || output.questionSetAudit.countConfidence > 1) fail(`${schema.schemaId} questionSetAudit.countConfidence is invalid`);
  if (output.questionSetAudit.emittedQuestionCount !== output.questions.length) fail(`${schema.schemaId} question count is inconsistent`);
  if (output.questionSetAudit.visibleIndependentQuestionCount !== output.questionSetAudit.emittedQuestionCount + output.questionSetAudit.excludedQuestionCount) fail(`${schema.schemaId} visible question count is inconsistent`);
  for (const question of output.questions) {
    if (!isPlainObject(question)) fail(`${schema.schemaId} question must be an object`);
    for (const field of schema.requiredFields) {
      if (!Object.hasOwn(question, field)) fail(`${schema.schemaId} question misses ${field}`);
      const nullable = Object.hasOwn(schema.nullableFields || {}, field) && question[field] === null;
      if (!nullable && !matchesType(question[field], schema.fieldTypes[field])) fail(`${schema.schemaId}.${field} has invalid type`);
      if (schema.enumFields[field] && !schema.enumFields[field].includes(question[field])) fail(`${schema.schemaId}.${field} has invalid enum`);
      const range = schema.numericRanges?.[field];
      if (range && (question[field] < range.min || question[field] > range.max)) fail(`${schema.schemaId}.${field} is outside range`);
    }
    for (const [field, itemSchema] of Object.entries(schema.arrayItemSchemas || {})) {
      for (const [itemIndex, item] of question[field].entries()) {
        if (!isPlainObject(item)) fail(`${schema.schemaId}.${field}[${itemIndex}] must be an object`);
        for (const itemField of itemSchema.requiredFields || []) {
          if (!Object.hasOwn(item, itemField)) fail(`${schema.schemaId}.${field}[${itemIndex}] misses ${itemField}`);
          if (!matchesType(item[itemField], itemSchema.fieldTypes[itemField])) fail(`${schema.schemaId}.${field}[${itemIndex}].${itemField} has invalid type`);
          if (itemSchema.enumFields?.[itemField] && !itemSchema.enumFields[itemField].includes(item[itemField])) fail(`${schema.schemaId}.${field}[${itemIndex}].${itemField} has invalid enum`);
        }
      }
    }
    for (const rule of schema.consistencyRules || []) {
      if (Object.entries(rule.when || {}).every(([field, value]) => question[field] === value)) {
        for (const [field, value] of Object.entries(rule.require || {})) if (question[field] !== value) fail(`${schema.schemaId}.${field} violates consistency rule`);
        for (const field of rule.requireNull || []) if (question[field] !== null) fail(`${schema.schemaId}.${field} must be null`);
        for (const [field, type] of Object.entries(rule.requireTypes || {})) if (!matchesType(question[field], type)) fail(`${schema.schemaId}.${field} must be ${type}`);
        for (const field of rule.requireNonEmptyStrings || []) if (typeof question[field] !== 'string' || !question[field]) fail(`${schema.schemaId}.${field} must be non-empty`);
      }
    }
  }
}

export { expectedStages, supportedFieldTypes };
