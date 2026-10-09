import { describe, expect, it } from 'vitest';
import { parseTimeOffsetSeconds, parseTimeOffsetSecondsOrZero } from './timeOffset';

describe('timeOffset', () => {
  describe('parseTimeOffsetSeconds', () => {
    it('parses valid second strings with s suffix', () => {
      expect(parseTimeOffsetSeconds('10s')).toBe(10);
      expect(parseTimeOffsetSeconds('10.5s')).toBe(10.5);
      expect(parseTimeOffsetSeconds('1.250s')).toBe(1.25);
      expect(parseTimeOffsetSeconds('0s')).toBe(0);
      expect(parseTimeOffsetSeconds('0.100S')).toBe(0.1);
    });

    it('parses valid numbers without suffix', () => {
      expect(parseTimeOffsetSeconds('10')).toBe(10);
      expect(parseTimeOffsetSeconds('15.2')).toBe(15.2);
    });

    it('returns null on invalid formats or empty inputs', () => {
      expect(parseTimeOffsetSeconds(undefined)).toBeNull();
      expect(parseTimeOffsetSeconds(null)).toBeNull();
      expect(parseTimeOffsetSeconds('')).toBeNull();
      expect(parseTimeOffsetSeconds('   ')).toBeNull();
      expect(parseTimeOffsetSeconds('00:10')).toBeNull();
      expect(parseTimeOffsetSeconds('invalid')).toBeNull();
      expect(parseTimeOffsetSeconds('12abc')).toBeNull();
    });
  });

  describe('parseTimeOffsetSecondsOrZero', () => {
    it('returns parsed seconds for valid strings', () => {
      expect(parseTimeOffsetSecondsOrZero('1.250s')).toBe(1.25);
      expect(parseTimeOffsetSecondsOrZero('15s')).toBe(15);
    });

    it('falls back to 0 for invalid inputs', () => {
      expect(parseTimeOffsetSecondsOrZero(undefined)).toBe(0);
      expect(parseTimeOffsetSecondsOrZero('')).toBe(0);
      expect(parseTimeOffsetSecondsOrZero('invalid')).toBe(0);
    });
  });
});
