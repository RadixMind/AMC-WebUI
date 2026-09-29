export type LiveArtifactInteractionPrimitive = string | number | boolean;
export type LiveArtifactInteractionArrayValue = LiveArtifactInteractionPrimitive[];
export type LiveArtifactInteractionValue = LiveArtifactInteractionPrimitive | LiveArtifactInteractionArrayValue;
export type LiveArtifactInteractionScalarPropertyType = 'string' | 'number' | 'integer' | 'boolean';
export type LiveArtifactInteractionPropertyType = LiveArtifactInteractionScalarPropertyType | 'array';

export type LiveArtifactInteractionErrorCode =
  | 'INVALID_JSON'
  | 'NOT_OBJECT'
  | 'SCHEMA_MISSING'
  | 'VERSION_UNSUPPORTED'
  | 'INSTRUCTION_MISSING'
  | 'INSTRUCTION_TOO_LONG'
  | 'TITLE_TOO_LONG'
  | 'DESCRIPTION_TOO_LONG'
  | 'SUBMIT_LABEL_TOO_LONG'
  | 'SCHEMA_NOT_OBJECT'
  | 'PROPERTIES_NOT_OBJECT'
  | 'PROPERTIES_EMPTY'
  | 'TOO_MANY_FIELDS'
  | 'KEY_NON_ASCII'
  | 'KEY_TOO_LONG'
  | 'FIELD_TYPE_UNSUPPORTED'
  | 'ENUM_TOO_MANY'
  | 'ENUM_TYPE_MISMATCH'
  | 'ENUM_NAME_LENGTH_MISMATCH'
  | 'ITEMS_MISSING'
  | 'ITEMS_TYPE_UNSUPPORTED'
  | 'ITEMS_ENUM_MISSING'
  | 'ITEMS_ENUM_TYPE_MIXED'
  | 'ARRAY_DEFAULT_INVALID'
  | 'DEFAULT_NOT_IN_ENUM'
  | 'DEFAULT_TYPE_MISMATCH'
  | 'RANGE_MIN_GT_MAX'
  | 'FORMAT_TYPE_MISMATCH'
  | 'REQUIRED_KEY_MISSING';

export interface LiveArtifactInteractionParseError {
  code: LiveArtifactInteractionErrorCode;
  message: string;
  context?: Record<string, unknown>;
}

export interface LiveArtifactInteractionDiagnosis {
  spec: LiveArtifactInteractionSpec | null;
  errors: LiveArtifactInteractionParseError[];
  repairs: LiveArtifactInteractionParseError[];
}

export interface LiveArtifactInteractionArrayItems {
  type: LiveArtifactInteractionScalarPropertyType;
  enum: LiveArtifactInteractionPrimitive[];
  enumNames?: string[];
}

export interface LiveArtifactInteractionProperty {
  type: LiveArtifactInteractionPropertyType;
  title?: string;
  description?: string;
  enum?: LiveArtifactInteractionPrimitive[];
  enumNames?: string[];
  default?: LiveArtifactInteractionValue;
  format?: 'textarea' | 'range' | 'date' | string;
  minimum?: number;
  maximum?: number;
  items?: LiveArtifactInteractionArrayItems;
}

export interface LiveArtifactInteractionSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, LiveArtifactInteractionProperty>;
}

export interface LiveArtifactInteractionSpec {
  version: 1;
  title?: string;
  description?: string;
  instruction: string;
  submitLabel?: string;
  schema: LiveArtifactInteractionSchema;
}

export interface LiveArtifactInteractionField {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  property: LiveArtifactInteractionProperty;
}
