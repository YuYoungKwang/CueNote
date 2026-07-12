export interface IndexedDbAdapter {
  readonly name: string;
  readonly version: number;
  open(): Promise<IDBDatabase>;
  get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined>;
  set<T>(storeName: string, key: IDBValidKey, value: T): Promise<void>;
  delete(storeName: string, key: IDBValidKey): Promise<void>;
  clear(storeName: string): Promise<void>;
}

export interface IndexedDbAdapterOptions {
  name: string;
  version: number;
  upgrade?: (database: IDBDatabase, oldVersion: number, newVersion: number | null, transaction: IDBTransaction) => void;
}

export function createIndexedDbAdapter(options: IndexedDbAdapterOptions): IndexedDbAdapter {
  const openDatabase = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(options.name, options.version);

      request.onupgradeneeded = () => {
        const database = request.result;
        const transaction = request.transaction;

        if (transaction) {
          options.upgrade?.(database, request.oldVersion, database.version, transaction);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });

  const run = async <T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) => {
    const database = await openDatabase();

    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${mode} failed`));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error(`IndexedDB transaction failed for ${storeName}`));
      };
    });
  };

  return {
    name: options.name,
    version: options.version,
    open: openDatabase,
    async get<T>(storeName, key) {
      return run<T | undefined>(storeName, 'readonly', (store) => store.get(key));
    },
    async set<T>(storeName, key, value) {
      await run(storeName, 'readwrite', (store) => store.put(value, key));
    },
    async delete(storeName, key) {
      await run(storeName, 'readwrite', (store) => store.delete(key));
    },
    async clear(storeName) {
      await run(storeName, 'readwrite', (store) => store.clear());
    }
  };
}
