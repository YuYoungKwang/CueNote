import type {
  ImportCorrection,
  ImportDetectionSnapshot,
  ImportPage,
  ImportPreferences,
  ImportProject,
  ImportProjectId,
  ImportSource,
  ImportSourceId
} from '@cuenote/score-domain';
import {
  createCueNoteDbAdapter,
  IMPORT_CORRECTIONS_STORE,
  IMPORT_DETECTION_SNAPSHOTS_STORE,
  IMPORT_PAGES_STORE,
  IMPORT_PREFERENCES_STORE,
  IMPORT_PROJECTS_STORE,
  IMPORT_SOURCE_BLOBS_STORE,
  IMPORT_SOURCES_STORE
} from './cuenoteDb';
import type { IndexedDbAdapter } from './indexedDbAdapter';

interface SourceBlobRecord {
  sourceId: ImportSourceId;
  blob: Blob;
  createdAt: number;
}

export interface ImportProjectBundle {
  project: ImportProject;
  source: ImportSource | null;
  pages: ImportPage[];
  snapshots: ImportDetectionSnapshot[];
  corrections: ImportCorrection[];
  preferences: ImportPreferences | null;
}

export interface ImportProjectRepository {
  listProjects(): Promise<ImportProject[]>;
  loadProject(projectId: ImportProjectId): Promise<ImportProjectBundle | null>;
  saveProject(project: ImportProject): Promise<void>;
  saveSource(source: ImportSource, bytes: Blob): Promise<void>;
  readSourceBlob(source: ImportSource): Promise<Blob | null>;
  savePage(page: ImportPage): Promise<void>;
  saveSnapshot(snapshot: ImportDetectionSnapshot): Promise<void>;
  saveCorrection(correction: ImportCorrection): Promise<void>;
  clearCorrections(pageId: string): Promise<void>;
  savePreferences(preferences: ImportPreferences): Promise<void>;
  deleteProject(projectId: ImportProjectId): Promise<void>;
}

export function createImportProjectRepository(adapter: IndexedDbAdapter = createCueNoteDbAdapter()): ImportProjectRepository {
  return {
    async listProjects() {
      const projects = await adapter.getAll<ImportProject>(IMPORT_PROJECTS_STORE);
      return projects.sort((left, right) => right.updatedAt - left.updatedAt);
    },

    async loadProject(projectId) {
      const project = await adapter.get<ImportProject>(IMPORT_PROJECTS_STORE, projectId);
      if (!project) {
        return null;
      }

      const [sources, pages, snapshots, corrections, preferences] = await Promise.all([
        adapter.getAll<ImportSource>(IMPORT_SOURCES_STORE),
        adapter.getAll<ImportPage>(IMPORT_PAGES_STORE),
        adapter.getAll<ImportDetectionSnapshot>(IMPORT_DETECTION_SNAPSHOTS_STORE),
        adapter.getAll<ImportCorrection>(IMPORT_CORRECTIONS_STORE),
        adapter.get<ImportPreferences>(IMPORT_PREFERENCES_STORE, projectId)
      ]);

      return {
        project,
        source: sources.find((source) => source.id === project.sourceId) ?? null,
        pages: pages.filter((page) => page.projectId === projectId).sort((left, right) => left.pageIndex - right.pageIndex),
        snapshots: snapshots.filter((snapshot) => snapshot.projectId === projectId),
        corrections: corrections.filter((correction) => correction.projectId === projectId).sort((left, right) => left.createdAt - right.createdAt),
        preferences: preferences ?? null
      };
    },

    async saveProject(project) {
      await adapter.set(IMPORT_PROJECTS_STORE, project.id, project);
    },

    async saveSource(source, bytes) {
      await adapter.set(IMPORT_SOURCES_STORE, source.id, source);
      if (source.storageBackend === 'OPFS') {
        try {
          await writeOpfsBlob(source.storageKey, bytes);
          return;
        } catch {
          await adapter.set<SourceBlobRecord>(IMPORT_SOURCE_BLOBS_STORE, source.id, {
            sourceId: source.id,
            blob: bytes,
            createdAt: Date.now()
          });
          return;
        }
      }

      await adapter.set<SourceBlobRecord>(IMPORT_SOURCE_BLOBS_STORE, source.id, {
        sourceId: source.id,
        blob: bytes,
        createdAt: Date.now()
      });
    },

    async readSourceBlob(source) {
      if (source.storageBackend === 'OPFS') {
        const opfsBlob = await readOpfsBlob(source.storageKey);
        if (opfsBlob) {
          return opfsBlob;
        }
      }

      const fallback = await adapter.get<SourceBlobRecord>(IMPORT_SOURCE_BLOBS_STORE, source.id);
      return fallback?.blob ?? null;
    },

    async savePage(page) {
      await adapter.set(IMPORT_PAGES_STORE, page.id, page);
    },

    async saveSnapshot(snapshot) {
      await adapter.set(IMPORT_DETECTION_SNAPSHOTS_STORE, snapshot.id, snapshot);
    },

    async saveCorrection(correction) {
      await adapter.set(IMPORT_CORRECTIONS_STORE, correction.id, correction);
    },

    async clearCorrections(pageId) {
      const corrections = await adapter.getAll<ImportCorrection>(IMPORT_CORRECTIONS_STORE);
      await Promise.all(corrections.filter((correction) => correction.pageId === pageId).map((correction) => adapter.delete(IMPORT_CORRECTIONS_STORE, correction.id)));
    },

    async savePreferences(preferences) {
      await adapter.set(IMPORT_PREFERENCES_STORE, preferences.projectId, preferences);
    },

    async deleteProject(projectId) {
      const bundle = await this.loadProject(projectId);
      if (!bundle) {
        return;
      }

      await Promise.all([
        adapter.delete(IMPORT_PROJECTS_STORE, projectId),
        adapter.delete(IMPORT_PREFERENCES_STORE, projectId),
        ...bundle.pages.map((page) => adapter.delete(IMPORT_PAGES_STORE, page.id)),
        ...bundle.snapshots.map((snapshot) => adapter.delete(IMPORT_DETECTION_SNAPSHOTS_STORE, snapshot.id)),
        ...bundle.corrections.map((correction) => adapter.delete(IMPORT_CORRECTIONS_STORE, correction.id))
      ]);
      if (bundle.source) {
        await adapter.delete(IMPORT_SOURCES_STORE, bundle.source.id);
        await adapter.delete(IMPORT_SOURCE_BLOBS_STORE, bundle.source.id);
        await deleteOpfsBlob(bundle.source.storageKey);
      }
    }
  };
}

export function canUseOpfs(source: Pick<Navigator, 'storage'> | undefined = navigator): boolean {
  return typeof source?.storage?.getDirectory === 'function';
}

async function getCueNoteDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!canUseOpfs()) {
    return null;
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('cuenote-imports', { create: true });
}

async function writeOpfsBlob(key: string, blob: Blob): Promise<void> {
  const directory = await getCueNoteDirectory();
  if (!directory) {
    throw new Error('OPFS unavailable');
  }
  const handle = await directory.getFileHandle(key, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function readOpfsBlob(key: string): Promise<Blob | null> {
  try {
    const directory = await getCueNoteDirectory();
    if (!directory) {
      return null;
    }
    const handle = await directory.getFileHandle(key);
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function deleteOpfsBlob(key: string): Promise<void> {
  try {
    const directory = await getCueNoteDirectory();
    await directory?.removeEntry(key);
  } catch {
    // Best effort cleanup. The IndexedDB metadata is the source of truth.
  }
}
