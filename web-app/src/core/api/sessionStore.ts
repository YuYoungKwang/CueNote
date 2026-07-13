import type { AuthSession } from './client';

const SESSION_KEY = 'cuenote.phase4.session';

export interface ServerSessionStore {
  load(): AuthSession | null;
  save(session: AuthSession): void;
  clear(): void;
}

export function createServerSessionStore(storage: Storage = window.localStorage): ServerSessionStore {
  return {
    load() {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw) as AuthSession;
      } catch {
        storage.removeItem(SESSION_KEY);
        return null;
      }
    },
    save(session) {
      storage.setItem(SESSION_KEY, JSON.stringify(session));
    },
    clear() {
      storage.removeItem(SESSION_KEY);
    }
  };
}
