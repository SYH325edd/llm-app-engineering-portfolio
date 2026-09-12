'use strict';

const OUTPUT_SCHEMA_REGISTRY_VERSION = 'output-schema-registry.v1';
const DOWNSTREAM_SEMANTICS_VERSION = 'result-semantics.v1';

const schemas = [
  {
    "schemaId": "hard-problem.v2",
    "version": "v2",
    "mode": "hard-problem",
    "requiredFields": [
      "outputSchemaVersion",
      "sourceKey",
      "questionText",
      "studentAnswer",
      "standardAnswer",
      "answerStatus",
      "finalAnswerCorrect",
      "stepRequired",
      "stepStatus",
      "logicStatus",
      "errorType",
      "firstWrongStep",
      "errorReason",
      "adjustmentSuggestion",
      "knowledgePoint",
      "stepFeedbacks",
      "overallFeedback",
      "confidence",
      "studentWorkDetected",
      "sourceQuestionLabel",
      "sourceRegion",
      "inputBasis",
      "modeApplicability"
    ],
    "optionalFields": [],
    "fieldTypes": {
      "outputSchemaVersion": "string",
      "sourceKey": "string",
      "questionText": "string",
      "studentAnswer": "string",
      "standardAnswer": "string",
      "answerStatus": "string",
      "finalAnswerCorrect": "boolean",
      "stepRequired": "boolean",
      "stepStatus": "string",
      "logicStatus": "string",
      "errorType": "string",
      "firstWrongStep": "string",
      "errorReason": "string",
      "adjustmentSuggestion": "string",
      "knowledgePoint": "string",
      "confidence": "number",
      "studentWorkDetected": "boolean",
      "sourceQuestionLabel": "string",
      "sourceRegion": "string",
      "inputBasis": "string",
      "modeApplicability": "string",
      "stepFeedbacks": "array",
      "overallFeedback": "string"
    },
    "nullableFields": {
      "finalAnswerCorrect": [
        "unanswered",
        "unreadable"
      ]
    },
    "enumFields": {
      "answerStatus": [
        "answered",
        "unanswered",
        "unreadable"
      ],
      "stepStatus": [
        "correct",
        "wrong",
        "missing",
        "not_required",
        "unreadable"
      ],
      "logicStatus": [
        "correct",
        "wrong",
        "insufficient",
        "unreadable"
      ],
      "errorType": [
        "none",
        "answer_error",
        "calculation_error",
        "method_error",
        "logic_error",
        "unanswered",
        "unreadable",
        "multiple"
      ],
      "inputBasis": [
        "printed_question_with_work",
        "printed_question_without_work",
        "work_only_complete",
        "work_only_incomplete"
      ],
      "modeApplicability": [
        "applicable",
        "not_applicable",
        "uncertain"
      ]
    },
    "arrayFields": [
      "stepFeedbacks"
    ],
    "numericRanges": {
      "confidence": {
        "min": 0,
        "max": 1
      }
    },
    "consistencyRules": [
      {
        "when": {
          "answerStatus": "unanswered"
        },
        "require": {
          "finalAnswerCorrect": null,
          "errorType": "unanswered"
        }
      },
      {
        "when": {
          "answerStatus": "unreadable"
        },
        "require": {
          "finalAnswerCorrect": null,
          "logicStatus": "unreadable",
          "errorType": "unreadable"
        }
      },
      {
        "when": {
          "stepRequired": false
        },
        "require": {
          "stepStatus": "not_required"
        }
      },
      {
        "when": {
          "finalAnswerCorrect": true,
          "stepStatus": "correct",
          "logicStatus": "correct"
        },
        "require": {
          "errorType": "none"
        }
      }
    ],
    "legacyAliases": [
      "hard-problem.legacy"
    ],
    "downstreamSemanticsVersion": "result-semantics.v1",
    "reviewProjection": {
      "evidenceFields": [
        "studentWorkDetected",
        "sourceQuestionLabel",
        "sourceRegion",
        "inputBasis",
        "modeApplicability",
        "stepFeedbacks",
        "overallFeedback"
      ]
    },
    "wrongQuestionProjection": {
      "modeDetails": [
        "studentWorkDetected",
        "sourceQuestionLabel",
        "sourceRegion",
        "inputBasis",
        "modeApplicability",
        "stepFeedbacks",
        "overallFeedback"
      ]
    },
    "arrayItemSchemas": {
      "stepFeedbacks": {
        "requiredFields": [
          "stepIndex",
          "solutionText",
          "explanationText",
          "solutionStatus",
          "explanationStatus",
          "logicStatus",
          "analysis",
          "correctionAdvice"
        ],
        "fieldTypes": {
          "stepIndex": "integer_min_0",
          "solutionText": "string",
          "explanationText": "string",
          "solutionStatus": "enum",
          "explanationStatus": "enum",
          "logicStatus": "enum",
          "analysis": "string",
          "correctionAdvice": "string"
        },
        "enumFields": {
          "solutionStatus": [
            "correct",
            "wrong",
            "missing",
            "unreadable"
          ],
          "explanationStatus": [
            "clear",
            "partially_clear",
            "incorrect",
            "missing",
            "unreadable"
          ],
          "logicStatus": [
            "clear",
            "insufficient",
            "wrong",
            "unreadable"
          ]
        }
      }
    }
  },
  {
    "schemaId": "reading-careless.v2",
    "version": "v2",
    "mode": "reading-careless",
    "requiredFields": [
      "outputSchemaVersion",
      "sourceKey",
      "questionText",
      "studentConditionText",
      "studentRelationText",
      "studentAskText",
      "referenceConditionText",
      "referenceRelationText",
      "referenceAskText",
      "analysisStatus",
      "conditionCorrect",
      "relationCorrect",
      "askCorrect",
      "missingConditions",
      "relationIssues",
      "askIssue",
      "errorReason",
      "correctionAdvice",
      "confidence",
      "studentWorkDetected",
      "sourceQuestionLabel",
      "sourceRegion",
      "inputBasis",
      "modeApplicability"
    ],
    "optionalFields": [],
    "fieldTypes": {
      "outputSchemaVersion": "string",
      "sourceKey": "string",
      "questionText": "string",
      "studentConditionText": "string",
      "studentRelationText": "string",
      "studentAskText": "string",
      "referenceConditionText": "string",
      "referenceRelationText": "string",
      "referenceAskText": "string",
      "analysisStatus": "string",
      "conditionCorrect": "boolean",
      "relationCorrect": "boolean",
      "askCorrect": "boolean",
      "missingConditions": "array",
      "relationIssues": "array",
      "askIssue": "string",
      "errorReason": "string",
      "correctionAdvice": "string",
      "confidence": "number",
      "studentWorkDetected": "boolean",
      "sourceQuestionLabel": "string",
      "sourceRegion": "string",
      "inputBasis": "string",
      "modeApplicability": "string"
    },
    "nullableFields": {
      "conditionCorrect": [
        "unreadable",
        "insufficient"
      ],
      "relationCorrect": [
        "unreadable",
        "insufficient"
      ],
      "askCorrect": [
        "unreadable",
        "insufficient"
      ]
    },
    "enumFields": {
      "analysisStatus": [
        "ok",
        "unreadable",
        "insufficient"
      ],
      "inputBasis": [
        "printed_question_with_work",
        "printed_question_without_work",
        "work_only_complete",
        "work_only_incomplete"
      ],
      "modeApplicability": [
        "applicable",
        "not_applicable",
        "uncertain"
      ]
    },
    "arrayFields": [
      "missingConditions",
      "relationIssues"
    ],
    "numericRanges": {
      "confidence": {
        "min": 0,
        "max": 1
      }
    },
    "consistencyRules": [
      {
        "when": {
          "analysisStatus": "unreadable"
        },
        "require": {
          "conditionCorrect": null,
          "relationCorrect": null,
          "askCorrect": null
        }
      },
      {
        "when": {
          "analysisStatus": "insufficient"
        },
        "require": {
          "conditionCorrect": null,
          "relationCorrect": null,
          "askCorrect": null
        }
      },
      {
        "when": {
          "analysisStatus": "ok"
        },
        "requireTypes": {
          "conditionCorrect": "boolean",
          "relationCorrect": "boolean",
          "askCorrect": "boolean"
        },
        "requireNonEmptyStrings": [
          "referenceConditionText",
          "referenceRelationText",
          "referenceAskText"
        ]
      }
    ],
    "legacyAliases": [
      "reading-careless.legacy"
    ],
    "downstreamSemanticsVersion": "result-semantics.v1",
    "reviewProjection": {
      "evidenceFields": [
        "studentWorkDetected",
        "sourceQuestionLabel",
        "sourceRegion",
        "inputBasis",
        "modeApplicability"
      ]
    },
    "wrongQuestionProjection": {
      "modeDetails": [
        "studentWorkDetected",
        "sourceQuestionLabel",
        "sourceRegion",
        "inputBasis",
        "modeApplicability"
      ]
    }
  },
  {
    "schemaId": "calculation-careless.v2",
    "version": "v2",
    "mode": "calculation-careless",
    "requiredFields": [
      "outputSchemaVersion",
      "sourceKey",
      "questionText",
      "studentCalculation",
      "standardCalculation",
      "analysisStatus",
      "layoutClear",
      "digitAlignmentCorrect",
      "stepsComplete",
      "carryBorrowClear",
      "processCorrect",
      "finalAnswerCorrect",
      "carelessDetected",
      "issueCategory",
      "carelessIssues",
      "methodIssues",
      "errorReason",
      "firstErrorPoint",
      "correctionAdvice",
      "confidence",
      "studentWorkDetected",
      "sourceQuestionLabel",
      "sourceRegion",
      "inputBasis",
      "modeApplicability"
    ],
    "optionalFields": [],
    "fieldTypes": {
      "outputSchemaVersion": "string",
      "sourceKey": "string",
      "questionText": "string",
      "studentCalculation": "string",
      "standardCalculation": "string",
      "analysisStatus": "string",
      "layoutClear": "boolean",
      "digitAlignmentCorrect": "boolean",
      "stepsComplete": "boolean",
      "carryBorrowClear": "boolean",
      "processCorrect": "boolean",
      "finalAnswerCorrect": "boolean",
      "carelessDetected": "boolean",
      "issueCategory": "string",
      "carelessIssues": "array",
      "methodIssues": "array",
      "errorReason": "string",
      "firstErrorPoint": "string",
      "correctionAdvice": "string",
      "confidence": "number",
      "studentWorkDetected": "boolean",
      "sourceQuestionLabel": "string",
      "sourceRegion": "string",
      "inputBasis": "string",
      "modeApplicability": "string"
    },
    "nullableFields": {
      "layoutClear": [
        "unreadable",
        "insufficient"
      ],
      "digitAlignmentCorrect": [
        "unreadable",
        "insufficient"
      ],
      "stepsComplete": [
        "unreadable",
        "insufficient"
      ],
      "carryBorrowClear": [
        "unreadable",
        "insufficient"
      ],
      "processCorrect": [
        "unreadable",
        "insufficient"
      ],
      "finalAnswerCorrect": [
        "unreadable",
        "insufficient"
      ],
      "carelessDetected": [
        "unreadable",
        "insufficient"
      ]
    },
    "enumFields": {
      "analysisStatus": [
        "ok",
        "unreadable",
        "insufficient"
      ],
      "issueCategory": [
        "none",
        "careless",
        "knowledge_or_method",
        "undetermined"
      ],
      "inputBasis": [
        "printed_question_with_work",
        "printed_question_without_work",
        "work_only_complete",
        "work_only_incomplete"
      ],
      "modeApplicability": [
        "applicable",
        "not_applicable",
        "uncertain"
      ]
    },
    "arrayFields": [
      "carelessIssues",
      "methodIssues"
    ],
    "numericRanges": {
      "confidence": {
        "min": 0,
        "max": 1
      }
    },
    "consistencyRules": [
      {
        "when": {
          "analysisStatus": "unreadable"
        },
        "requireNull": [
          "layoutClear",
          "digitAlignmentCorrect",
          "stepsComplete",
          "carryBorrowClear",
          "processCorrect",
          "finalAnswerCorrect",
          "carelessDetected"
        ]
      },
      {
        "when": {
          "analysisStatus": "insufficient"
        },
        "requireNull": [
          "layoutClear",
          "digitAlignmentCorrect",
          "stepsComplete",
          "carryBorrowClear",
          "processCorrect",
          "finalAnswerCorrect",
          "carelessDetected"
        ]
      },
      {
        "when": {
          "analysisStatus": "ok"
        },
        "requireTypes": {
          "layoutClear": "boolean",
          "digitAlignmentCorrect": "boolean",
          "stepsComplete": "boolean",
          "carryBorrowClear": "boolean",
          "processCorrect": "boolean",
          "finalAnswerCorrect": "boolean",
          "carelessDetected": "boolean"
        }
      },
      {
        "when": {
          "processCorrect": true,
          "finalAnswerCorrect": true
        },
        "require": {
          "issueCategory": "none"
        }
      }
    ],
    "legacyAliases": [
      "calculation-careless.legacy"
    ],
    "downstreamSemanticsVersion": "result-semantics.v1",
    "reviewProjection": {
      "evidenceFields": [
        "studentWorkDetected",
        "sourceQuestionLabel",
        "sourceRegion",
        "inputBasis",
        "modeApplicability"
      ]
    },
    "wrongQuestionProjection": {
      "modeDetails": [
        "studentWorkDetected",
        "sourceQuestionLabel",
        "sourceRegion",
        "inputBasis",
        "modeApplicability"
      ]
    }
  }
];

const QUESTION_EVIDENCE_FIELDS = ['studentWorkDetected', 'sourceQuestionLabel', 'sourceRegion', 'inputBasis', 'modeApplicability'];
const INPUT_BASIS_VALUES = ['printed_question_with_work', 'printed_question_without_work', 'work_only_complete', 'work_only_incomplete'];
const MODE_APPLICABILITY_VALUES = ['applicable', 'not_applicable', 'uncertain'];
const QUESTION_SET_AUDIT_CONTRACT = {
  requiredFields: ['visibleIndependentQuestionCount', 'emittedQuestionCount', 'excludedQuestionCount', 'orientation', 'countConfidence'],
  fieldTypes: { visibleIndependentQuestionCount: 'integer_min_0', emittedQuestionCount: 'integer_min_0', excludedQuestionCount: 'integer_min_0', orientation: 'enum', countConfidence: 'number_0_to_1' },
  enumFields: { orientation: ['upright', 'rotated_left', 'rotated_right', 'upside_down', 'uncertain'] }
};

for (const schema of schemas) {
  for (const field of QUESTION_EVIDENCE_FIELDS) if (!schema.requiredFields.includes(field)) schema.requiredFields.push(field);
  Object.assign(schema.fieldTypes, { studentWorkDetected: 'boolean', sourceQuestionLabel: 'string', sourceRegion: 'string', inputBasis: 'string', modeApplicability: 'string' });
  Object.assign(schema.enumFields, { inputBasis: INPUT_BASIS_VALUES, modeApplicability: MODE_APPLICABILITY_VALUES });
  schema.reviewProjection = { ...(schema.reviewProjection || {}), evidenceFields: [...new Set([...(schema.reviewProjection?.evidenceFields || []), ...QUESTION_EVIDENCE_FIELDS])] };
  schema.wrongQuestionProjection = { ...(schema.wrongQuestionProjection || {}), modeDetails: [...new Set([...(schema.wrongQuestionProjection?.modeDetails || []), ...QUESTION_EVIDENCE_FIELDS])] };
  if (schema.schemaId === 'reading-careless.v2' || schema.schemaId === 'calculation-careless.v2') {
    schema.topLevelRequiredFields = [...new Set([...(schema.topLevelRequiredFields || []), 'questionSetAudit'])];
    schema.topLevelFieldTypes = { ...(schema.topLevelFieldTypes || {}), questionSetAudit: 'object' };
    schema.topLevelObjectSchemas = { ...(schema.topLevelObjectSchemas || {}), questionSetAudit: QUESTION_SET_AUDIT_CONTRACT };
  }
}

const byVersion = new Map(schemas.map((schema) => [schema.schemaId, schema]));
module.exports = { OUTPUT_SCHEMA_REGISTRY_VERSION, DOWNSTREAM_SEMANTICS_VERSION, schemas, getSchema: (version) => byVersion.get(version) || null, supportedVersions: () => [...byVersion.keys()] };
