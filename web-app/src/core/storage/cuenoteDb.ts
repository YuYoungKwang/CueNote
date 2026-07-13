import { createIndexedDbAdapter, type IndexedDbAdapter } from './indexedDbAdapter';

export const CUENOTE_DB_NAME = 'cuenote';
export const CUENOTE_DB_VERSION = 3;

export const RECENT_SCORES_STORE = 'recent_scores';
export const ANNOTATIONS_STORE = 'annotations';
export const ANNOTATION_PREFERENCES_STORE = 'annotation_preferences';
export const ANNOTATION_SYNC_QUEUE_STORE = 'annotation_sync_queue';

export function createCueNoteDbAdapter(): IndexedDbAdapter {
  return createIndexedDbAdapter({
    name: CUENOTE_DB_NAME,
    version: CUENOTE_DB_VERSION,
    upgrade: upgradeCueNoteDb
  });
}

function upgradeCueNoteDb(database: IDBDatabase) {
  if (!database.objectStoreNames.contains(RECENT_SCORES_STORE)) {
    database.createObjectStore(RECENT_SCORES_STORE);
  }

  if (!database.objectStoreNames.contains(ANNOTATIONS_STORE)) {
    database.createObjectStore(ANNOTATIONS_STORE);
  }

  if (!database.objectStoreNames.contains(ANNOTATION_PREFERENCES_STORE)) {
    database.createObjectStore(ANNOTATION_PREFERENCES_STORE);
  }

  if (!database.objectStoreNames.contains(ANNOTATION_SYNC_QUEUE_STORE)) {
    database.createObjectStore(ANNOTATION_SYNC_QUEUE_STORE);
  }
}
