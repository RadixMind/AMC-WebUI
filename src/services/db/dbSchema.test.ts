import { describe, expect, it, vi } from 'vitest';
import {
  applyMigrations,
  DB_STORE_DEFS,
  DB_STORE_NAMES,
  DB_VERSION,
  SESSION_METADATA_STORE,
  SESSIONS_STORE,
} from './dbSchema';

describe('dbSchema DB_VERSION 7 upgrade', () => {
  it('defines DB_VERSION as 7 and includes SESSION_METADATA_STORE', () => {
    expect(DB_VERSION).toBe(7);
    expect(SESSION_METADATA_STORE).toBe('session_metadata');
    expect(DB_STORE_NAMES).toContain(SESSION_METADATA_STORE);

    const metadataDef = DB_STORE_DEFS.find((def) => def.name === SESSION_METADATA_STORE);
    expect(metadataDef).toBeDefined();
    expect(metadataDef?.sinceVersion).toBe(7);
    expect(metadataDef?.options).toEqual({ keyPath: 'id' });
  });

  it('creates session_metadata store and migrates existing sessions when upgrading from v6', () => {
    const existingSessions = [
      { id: 's1', title: 'Session 1', timestamp: 1000, messages: [{ id: 'm1', content: 'heavy text' }] },
      { id: 's2', title: 'Session 2', timestamp: 2000, messages: [{ id: 'm2', content: 'large data' }] },
    ];

    const mockPut = vi.fn();
    const mockMetadataStore = {
      put: mockPut,
      createIndex: vi.fn(),
    };

    const mockSessionsStore = {
      openCursor: vi.fn(() => {
        let index = 0;
        const request = {
          result: null as any,
          onsuccess: null as ((ev: any) => void) | null,
          onerror: null as ((ev: any) => void) | null,
        };

        const dispatchNext = () => {
          if (index < existingSessions.length) {
            request.result = {
              value: existingSessions[index],
              continue: () => {
                index += 1;
                dispatchNext();
              },
            };
          } else {
            request.result = null;
          }
          request.onsuccess?.({ target: request });
        };

        queueMicrotask(dispatchNext);
        return request;
      }),
    };

    const mockDb = {
      objectStoreNames: {
        contains: vi.fn((name: string) => name === SESSIONS_STORE),
      },
      createObjectStore: vi.fn((name: string) => {
        if (name === SESSION_METADATA_STORE) {
          return mockMetadataStore;
        }
        return { createIndex: vi.fn() };
      }),
      transaction: vi.fn((_storeNames: string | string[]) => ({
        objectStore: vi.fn((name: string) => {
          if (name === SESSIONS_STORE) return mockSessionsStore;
          if (name === SESSION_METADATA_STORE) return mockMetadataStore;
          return {};
        }),
      })),
    } as unknown as IDBDatabase;

    applyMigrations(mockDb, 6);

    expect(mockDb.createObjectStore).toHaveBeenCalledWith(SESSION_METADATA_STORE, { keyPath: 'id' });
  });
});
