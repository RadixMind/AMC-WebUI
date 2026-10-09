export interface LruCacheOptions<V, K = string> {
  limit: number;
  onEvict?: (value: V, key: K) => void;
}

export interface LruCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
}

/**
 * Creates a bounded, in-memory LRU (Least Recently Used) cache backed by a JavaScript Map.
 *
 * Map preserves insertion order. When reading an existing entry, it is re-inserted to refresh recency.
 * When cache size exceeds `limit`, oldest entries are evicted and optional `onEvict` is triggered.
 *
 * @param options - Cache configuration including max item count and optional eviction callback
 */
export function createLruCache<V, K = string>(options: LruCacheOptions<V, K>): LruCache<K, V> {
  const { limit, onEvict } = options;
  const map = new Map<K, V>();

  return {
    get(key: K): V | undefined {
      const value = map.get(key);
      if (value === undefined) return undefined;
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key: K, value: V): void {
      map.delete(key);
      map.set(key, value);
      while (map.size > limit) {
        const oldestEntry = map.entries().next().value;
        if (!oldestEntry) break;
        const [oldestKey, oldestVal] = oldestEntry;
        map.delete(oldestKey);
        if (onEvict) {
          onEvict(oldestVal, oldestKey);
        }
      }
    },
    delete(key: K): boolean {
      return map.delete(key);
    },
    clear(): void {
      map.clear();
    },
    get size(): number {
      return map.size;
    },
  };
}
