import { describe, it, expect } from 'vitest';
import { sanitizeMcpTimeout } from './mcpServerConfig';

describe('sanitizeMcpTimeout', () => {
  it('keeps integer seconds within range', () => {
    expect(sanitizeMcpTimeout(60)).toBe(60);
    expect(sanitizeMcpTimeout(1)).toBe(1);
    expect(sanitizeMcpTimeout(3600)).toBe(3600);
  });
  it('drops non-integer, zero, negative and oversized values', () => {
    for (const bad of [0, -5, 1.5, '90', null, Number.POSITIVE_INFINITY, 3601]) {
      expect(sanitizeMcpTimeout(bad)).toBeUndefined();
    }
  });
});
