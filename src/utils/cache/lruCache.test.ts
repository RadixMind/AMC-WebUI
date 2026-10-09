import { describe, expect, it, vi } from 'vitest';
import { createLruCache } from './lruCache';

describe('createLruCache', () => {
  it('stores and retrieves cached items', () => {
    const cache = createLruCache<number>({ limit: 3 });
    cache.set('a', 1);
    cache.set('b', 2);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('evicts the least recently used item when exceeding limit', () => {
    const cache = createLruCache<string>({ limit: 2 });
    cache.set('a', 'alpha');
    cache.set('b', 'beta');
    // Access 'a' to make 'b' the least recently used
    expect(cache.get('a')).toBe('alpha');

    // Add 'c' -> 'b' should be evicted
    cache.set('c', 'gamma');

    expect(cache.get('a')).toBe('alpha');
    expect(cache.get('c')).toBe('gamma');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('triggers onEvict callback when items are evicted', () => {
    const onEvict = vi.fn();
    const cache = createLruCache<string>({ limit: 2, onEvict });

    cache.set('k1', 'val1');
    cache.set('k2', 'val2');
    cache.set('k3', 'val3');

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith('val1', 'k1');
  });

  it('supports delete and clear methods', () => {
    const cache = createLruCache<number>({ limit: 5 });
    cache.set('x', 10);
    cache.set('y', 20);

    expect(cache.delete('x')).toBe(true);
    expect(cache.get('x')).toBeUndefined();
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('y')).toBeUndefined();
  });
});
