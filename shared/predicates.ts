/**
 * Type guard checking whether a value is a non-null object record (excluding arrays).
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Returns trimmed string if value is a non-empty string, otherwise undefined.
 */
export const asTrimmedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
