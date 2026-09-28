import type { StateStorage } from 'zustand/middleware';
import type { StoreApi } from 'zustand';
import type { z } from 'zod';
import type { SyncMessage } from '@/types/sync';
import {
  createPersistedStateStorage,
  PERSISTED_STATE_ORIGIN_ID,
  getDefaultStorageArea,
  getChatSyncChannel,
  CHAT_SYNC_CHANNEL_NAME,
  type StorageArea,
} from './persistentStorage';

// Re-export single origin/channel for consumers; keep legacy name alias for compatibility
export { PERSISTED_STATE_ORIGIN_ID };
export const SYNCED_PERSIST_CHANNEL_NAME = CHAT_SYNC_CHANNEL_NAME;

// Singleton channel reuse - single channel via chatSyncChannel
export const getSingletonChannel = getChatSyncChannel;

export type PersistedStoreApi<T = unknown> = {
  persist: {
    rehydrate: () => Promise<void> | void;
  };
} & Partial<StoreApi<T>>;

export interface SyncedPersistOptions<T> {
  debounceMs?: number;
  schema?: z.ZodType<T>;
  version?: number;
  migrate?: (persisted: unknown, version: number) => T;
  // Exposed for test injection; production stores use default localStorage
  storageArea?: StorageArea;
  // Tab-private stores (drafts, UI chrome) set to false to avoid cross-tab rehydrate
  enableCrossTabSync?: boolean;
}

// --- isEqual (deep) -------------------------------------------------------
function isEqual(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (first === null || second === null) return first === second;
  if (typeof first !== typeof second) return false;

  if (Array.isArray(first) && Array.isArray(second)) {
    if (first.length !== second.length) return false;
    for (let index = 0; index < first.length; index++) {
      if (!isEqual(first[index], second[index])) return false;
    }
    return true;
  }

  if (Array.isArray(first) !== Array.isArray(second)) return false;

  if (typeof first === 'object' && typeof second === 'object') {
    const firstRecord = first as Record<string, unknown>;
    const secondRecord = second as Record<string, unknown>;
    const keysFirst = Object.keys(firstRecord);
    const keysSecond = Object.keys(secondRecord);
    if (keysFirst.length !== keysSecond.length) return false;
    for (const key of keysFirst) {
      if (!(key in secondRecord)) return false;
      if (!isEqual(firstRecord[key], secondRecord[key])) return false;
    }
    return true;
  }

  return false;
}

function isPersistedValueEqual(existingRaw: string | null, nextRaw: string): boolean {
  if (existingRaw === nextRaw) return true;
  if (existingRaw == null) return false;
  try {
    const existingParsed = JSON.parse(existingRaw);
    const nextParsed = JSON.parse(nextRaw);
    return isEqual(existingParsed, nextParsed);
  } catch {
    return false;
  }
}

export const createSyncedPersist = <T>(
  storageKey: string,
  opts: SyncedPersistOptions<T> = {},
): { storage: StateStorage; sync: (store: PersistedStoreApi) => () => void } => {
  // Wrap createPersistedStateStorage to reuse debounce/flush/notify logic centrally (no duplication)
  const enableCrossTabSync = opts.enableCrossTabSync ?? true;
  const baseStorage = createPersistedStateStorage({
    debounceMs: opts.debounceMs,
    storageArea: opts.storageArea,
    // Tab-private stores disable broadcast to avoid cross-tab rehydrate
    ...(enableCrossTabSync ? {} : { notifyUpdate: () => {} }),
  });

  const resolveStorageArea = (): StorageArea | null => opts.storageArea ?? getDefaultStorageArea();

  // Track pending parsed values for debounced dedup (isEqual against pending)
  const pendingParsedCache = new Map<string, unknown>();

  const storage: StateStorage = {
    getItem: (key) => {
      try {
        const rawResult = baseStorage.getItem(key) as unknown;
        const raw = rawResult instanceof Promise ? null : (rawResult as string | null);
        if (raw == null) return null;

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return null;
        }

        if (opts.schema) {
          try {
            opts.schema.parse(parsed);
          } catch {
            if (opts.migrate && typeof opts.version === 'number') {
              try {
                const migrated = opts.migrate(parsed, opts.version);
                opts.schema.parse(migrated);
                const migratedRaw = JSON.stringify(migrated);
                // Optionally persist migrated value for future reads
                try {
                  // Use baseStorage to ensure debounce/notify handling; fallback to direct area
                  baseStorage.setItem(key, migratedRaw);
                } catch {
                  // silent
                }
                return migratedRaw;
              } catch {
                // migrate also failed
              }
            }
            return null;
          }
        }

        return raw;
      } catch {
        return null;
      }
    },

    setItem: (key, value) => {
      const resolvedStorageArea = resolveStorageArea();
      if (!resolvedStorageArea) return;

      // isEqual dedup against existing stored value
      try {
        const existing = (() => {
          try {
            return resolvedStorageArea.getItem(key);
          } catch {
            return null;
          }
        })();
        // Fallback to baseStorage when area is mocked not to reflect base's internal pending
        if (isPersistedValueEqual(existing, value)) return;

        // Dedup against pending parsed cache (covers debounced consecutive writes with same deep value)
        const pendingParsed = pendingParsedCache.get(key);
        if (pendingParsed !== undefined) {
          try {
            const nextParsed = JSON.parse(value);
            if (isEqual(pendingParsed, nextParsed)) return;
          } catch {
            // if not JSON, fallback to string compare already handled
          }
        }

        try {
          pendingParsedCache.set(key, JSON.parse(value));
        } catch {
          pendingParsedCache.set(key, value as unknown);
        }
        // Schedule cache eviction after debounce window (or immediately if no debounce)
        if ((opts.debounceMs ?? 0) > 0) {
          setTimeout(
            () => {
              // Only clear if cache still equals this value's parsed form
              try {
                const currentCachedValue = pendingParsedCache.get(key);
                const thisParsed = JSON.parse(value);
                if (currentCachedValue !== undefined && isEqual(currentCachedValue, thisParsed)) {
                  pendingParsedCache.delete(key);
                }
              } catch {
                pendingParsedCache.delete(key);
              }
            },
            (opts.debounceMs ?? 0) + 20,
          );
        } else {
          // Immediate write will clear via base flush; remove after tick
          pendingParsedCache.delete(key);
        }
      } catch {
        // silent, proceed to write
      }

      try {
        baseStorage.setItem(key, value);
      } catch {
        // silent
      }
      // For immediate mode, ensure cache cleared
      if ((opts.debounceMs ?? 0) <= 0) {
        pendingParsedCache.delete(key);
      }
    },

    removeItem: (key) => {
      pendingParsedCache.delete(key);
      try {
        baseStorage.removeItem(key);
      } catch {
        // silent
      }
    },
  };

  const sync = (store: PersistedStoreApi): (() => void) => {
    if (!enableCrossTabSync) return () => {};
    if (typeof BroadcastChannel === 'undefined') {
      return () => {};
    }

    let channel: BroadcastChannel | null = null;
    try {
      channel = getChatSyncChannel();
    } catch {
      return () => {};
    }
    if (!channel) return () => {};

    const handleMessage = (event: MessageEvent<SyncMessage>): void => {
      try {
        const message = event.data;
        if (
          message.type !== 'PERSISTED_STATE_UPDATED' ||
          message.storageKey !== storageKey ||
          message.originId === PERSISTED_STATE_ORIGIN_ID
        ) {
          return;
        }
        void store.persist.rehydrate();
      } catch {
        // Silent
      }
    };

    channel.addEventListener('message', handleMessage);
    return () => {
      try {
        channel.removeEventListener('message', handleMessage);
      } catch {
        // silent
      }
    };
  };

  return { storage, sync };
};
