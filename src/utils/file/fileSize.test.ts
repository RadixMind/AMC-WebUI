import { describe, expect, it } from 'vitest';
import { formatFileSize } from './fileSize';

describe('formatFileSize', () => {
  it('returns empty string for non-positive or non-finite inputs', () => {
    expect(formatFileSize(0)).toBe('');
    expect(formatFileSize(-100)).toBe('');
    expect(formatFileSize(NaN)).toBe('');
    expect(formatFileSize(Infinity)).toBe('');
    expect(formatFileSize(-Infinity)).toBe('');
  });

  it('formats byte-level sizes (< 1024 B)', () => {
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobyte sizes with 1 decimal place', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 100)).toBe('100.0 KB');
  });

  it('formats megabyte sizes with 2 decimal places', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.50 MB');
    expect(formatFileSize(10.25 * 1024 * 1024)).toBe('10.25 MB');
  });

  it('formats gigabyte sizes with 2 decimal places', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
  });

  it('formats terabyte sizes with 2 decimal places', () => {
    expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1.00 TB');
    expect(formatFileSize(5 * 1024 * 1024 * 1024 * 1024)).toBe('5.00 TB');
  });
});
