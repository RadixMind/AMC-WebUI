export const DB_NAME = 'AllModelChatDB';
export const DB_VERSION = 7;

export const SESSIONS_STORE = 'sessions';
export const SESSION_METADATA_STORE = 'session_metadata';
export const FILES_STORE = 'files';
export const GROUPS_STORE = 'groups';
export const SCENARIOS_STORE = 'scenarios';
export const KEY_VALUE_STORE = 'keyValueStore';
export const LOGS_STORE = 'logs';
export const API_USAGE_STORE = 'api_usage';
export const EMBEDDINGS_STORE = 'multimodal_embeddings';

export const DB_STORE_NAMES = [
  SESSIONS_STORE,
  SESSION_METADATA_STORE,
  FILES_STORE,
  GROUPS_STORE,
  SCENARIOS_STORE,
  KEY_VALUE_STORE,
  LOGS_STORE,
  API_USAGE_STORE,
  EMBEDDINGS_STORE,
] as const;

export const LOCK_NAME = 'all_model_chat_db_write_lock';

type StoreIndexDef = {
  name: string;
  keyPath: string;
  unique?: boolean;
};

/** Single source of truth for object-store shape (keyPath, indexes). */
type StoreDef = {
  name: string;
  /** First schema version that introduces this store. */
  sinceVersion: number;
  options?: IDBObjectStoreParameters;
  indexes?: readonly StoreIndexDef[];
};

/**
 * Store definitions. Version comments below document history; shapes live here
 * so migrations and the safety-net path cannot drift.
 *
 * Version 1: Initial schema (sessions, groups, scenarios, keyValueStore)
 * Version 2: Add logs store
 * Version 3: Reserved by an earlier migration without retained schema changes
 * Version 4: Add persisted session files store
 * Version 5: Add API usage store
 * Version 6: Add multimodal embeddings store (one record per embedding)
 * Version 7: Add session metadata store for lightweight O(1) startup list loading
 */
export const DB_STORE_DEFS: readonly StoreDef[] = [
  { name: SESSIONS_STORE, sinceVersion: 1, options: { keyPath: 'id' } },
  { name: SESSION_METADATA_STORE, sinceVersion: 7, options: { keyPath: 'id' } },
  { name: GROUPS_STORE, sinceVersion: 1, options: { keyPath: 'id' } },
  { name: SCENARIOS_STORE, sinceVersion: 1, options: { keyPath: 'id' } },
  { name: KEY_VALUE_STORE, sinceVersion: 1 },
  {
    name: LOGS_STORE,
    sinceVersion: 2,
    options: { keyPath: 'id', autoIncrement: true },
    indexes: [{ name: 'timestamp', keyPath: 'timestamp', unique: false }],
  },
  {
    name: FILES_STORE,
    sinceVersion: 4,
    options: { keyPath: 'id' },
    indexes: [{ name: 'sessionId', keyPath: 'sessionId', unique: false }],
  },
  {
    name: API_USAGE_STORE,
    sinceVersion: 5,
    options: { keyPath: 'id', autoIncrement: true },
    indexes: [{ name: 'timestamp', keyPath: 'timestamp', unique: false }],
  },
  {
    name: EMBEDDINGS_STORE,
    sinceVersion: 6,
    options: { keyPath: 'id' },
    indexes: [{ name: 'updatedAt', keyPath: 'updatedAt', unique: false }],
  },
];

const createStoreIfMissing = (db: IDBDatabase, def: StoreDef) => {
  if (db.objectStoreNames.contains(def.name)) {
    return;
  }

  const store = def.options ? db.createObjectStore(def.name, def.options) : db.createObjectStore(def.name);
  for (const index of def.indexes ?? []) {
    store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
  }
};

export const applyMigrations = (db: IDBDatabase, oldVersion: number, transaction?: IDBTransaction | null) => {
  // Versioned upgrades: run once when opening a DB that is still below DB_VERSION.
  // DB_STORE_DEFS is the source of truth for store shape and introduction version.
  for (const def of DB_STORE_DEFS) {
    if (oldVersion < def.sinceVersion) {
      createStoreIfMissing(db, def);
    }
  }

  // Version 7 migration: populate session_metadata from existing sessions
  if (oldVersion < 7 && transaction && db.objectStoreNames.contains(SESSIONS_STORE)) {
    try {
      const sessionsStore = transaction.objectStore(SESSIONS_STORE);
      const metadataStore = transaction.objectStore(SESSION_METADATA_STORE);
      const cursorRequest = sessionsStore.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          const session = cursor.value;
          if (session && session.id) {
            metadataStore.put({ ...session, messages: [] });
          }
          cursor.continue();
        }
      };
    } catch {
      // Ignore migration error during initial metadata population
    }
  }

  // Safety net (intentionally not version-gated): repair partially migrated or
  // hand-edited DBs that report a high version but are missing stores.
  ensureObjectStores(db);
};

const ensureObjectStores = (db: IDBDatabase) => {
  for (const def of DB_STORE_DEFS) {
    createStoreIfMissing(db, def);
  }
};
