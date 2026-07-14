import { createIndexedDbAdapter, type IndexedDbAdapter } from './indexedDbAdapter';

export const CUENOTE_DB_NAME = 'cuenote';
export const CUENOTE_DB_VERSION = 8;

export const RECENT_SCORES_STORE = 'recent_scores';
export const ANNOTATIONS_STORE = 'annotations';
export const ANNOTATION_PREFERENCES_STORE = 'annotation_preferences';
export const ANNOTATION_SYNC_QUEUE_STORE = 'annotation_sync_queue';
export const REHEARSAL_PREFERENCES_STORE = 'rehearsal_preferences';
export const SCORE_EDIT_DRAFTS_STORE = 'score_edit_drafts';
export const SCORE_EDIT_PREFERENCES_STORE = 'score_edit_preferences';
export const IMPORT_PROJECTS_STORE = 'import_projects';
export const IMPORT_PAGES_STORE = 'import_pages';
export const IMPORT_SOURCES_STORE = 'import_sources';
export const IMPORT_SOURCE_BLOBS_STORE = 'import_source_blobs';
export const IMPORT_DETECTION_SNAPSHOTS_STORE = 'import_detection_snapshots';
export const IMPORT_CORRECTIONS_STORE = 'import_corrections';
export const IMPORT_PREFERENCES_STORE = 'import_preferences';
export const OMR_MODEL_MANIFESTS_STORE = 'omr_model_manifests';
export const OMR_MODEL_CACHE_METADATA_STORE = 'omr_model_cache_metadata';
export const OMR_ANALYSIS_JOBS_STORE = 'omr_analysis_jobs';
export const OMR_DETECTION_RESULTS_STORE = 'omr_detection_results';
export const OMR_DETECTION_CORRECTIONS_STORE = 'omr_detection_corrections';
export const OMR_EVALUATION_REPORTS_STORE = 'omr_evaluation_reports';
export const OMR_PREFERENCES_STORE = 'omr_preferences';

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

  if (!database.objectStoreNames.contains(REHEARSAL_PREFERENCES_STORE)) {
    database.createObjectStore(REHEARSAL_PREFERENCES_STORE);
  }

  if (!database.objectStoreNames.contains(SCORE_EDIT_DRAFTS_STORE)) {
    database.createObjectStore(SCORE_EDIT_DRAFTS_STORE);
  }

  if (!database.objectStoreNames.contains(SCORE_EDIT_PREFERENCES_STORE)) {
    database.createObjectStore(SCORE_EDIT_PREFERENCES_STORE);
  }

  if (!database.objectStoreNames.contains(IMPORT_PROJECTS_STORE)) {
    database.createObjectStore(IMPORT_PROJECTS_STORE);
  }

  if (!database.objectStoreNames.contains(IMPORT_PAGES_STORE)) {
    database.createObjectStore(IMPORT_PAGES_STORE);
  }

  if (!database.objectStoreNames.contains(IMPORT_SOURCES_STORE)) {
    database.createObjectStore(IMPORT_SOURCES_STORE);
  }

  if (!database.objectStoreNames.contains(IMPORT_SOURCE_BLOBS_STORE)) {
    database.createObjectStore(IMPORT_SOURCE_BLOBS_STORE);
  }

  if (!database.objectStoreNames.contains(IMPORT_DETECTION_SNAPSHOTS_STORE)) {
    database.createObjectStore(IMPORT_DETECTION_SNAPSHOTS_STORE);
  }

  if (!database.objectStoreNames.contains(IMPORT_CORRECTIONS_STORE)) {
    database.createObjectStore(IMPORT_CORRECTIONS_STORE);
  }

  if (!database.objectStoreNames.contains(IMPORT_PREFERENCES_STORE)) {
    database.createObjectStore(IMPORT_PREFERENCES_STORE);
  }

  if (!database.objectStoreNames.contains(OMR_MODEL_MANIFESTS_STORE)) {
    database.createObjectStore(OMR_MODEL_MANIFESTS_STORE);
  }

  if (!database.objectStoreNames.contains(OMR_MODEL_CACHE_METADATA_STORE)) {
    database.createObjectStore(OMR_MODEL_CACHE_METADATA_STORE);
  }

  if (!database.objectStoreNames.contains(OMR_ANALYSIS_JOBS_STORE)) {
    database.createObjectStore(OMR_ANALYSIS_JOBS_STORE);
  }

  if (!database.objectStoreNames.contains(OMR_DETECTION_RESULTS_STORE)) {
    database.createObjectStore(OMR_DETECTION_RESULTS_STORE);
  }

  if (!database.objectStoreNames.contains(OMR_DETECTION_CORRECTIONS_STORE)) {
    database.createObjectStore(OMR_DETECTION_CORRECTIONS_STORE);
  }

  if (!database.objectStoreNames.contains(OMR_EVALUATION_REPORTS_STORE)) {
    database.createObjectStore(OMR_EVALUATION_REPORTS_STORE);
  }

  if (!database.objectStoreNames.contains(OMR_PREFERENCES_STORE)) {
    database.createObjectStore(OMR_PREFERENCES_STORE);
  }
}
