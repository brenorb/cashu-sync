import type { Page } from "@playwright/test";

export type IndexedDbLocation = {
  database: string;
  store: string;
  key: string | number;
};

export async function readLocalStorage(
  page: Page
): Promise<Record<string, string>> {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}

export async function writeIndexedDbRecord(
  page: Page,
  location: IndexedDbLocation & { value: string | number | boolean | null }
): Promise<void> {
  await page.evaluate(async ({ database, store, key, value }) => {
    await new Promise<void>((resolveWrite, reject) => {
      const request = indexedDB.open(database, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store);
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(store, "readwrite");
        transaction.objectStore(store).put(value, key);
        transaction.oncomplete = () => {
          db.close();
          resolveWrite();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  }, location);
}

export async function readIndexedDbRecord(
  page: Page,
  location: IndexedDbLocation
): Promise<unknown | undefined> {
  return page.evaluate(async ({ database, store, key }) => {
    const databases = await indexedDB.databases();
    if (!databases.some((entry) => entry.name === database)) return undefined;

    return new Promise<unknown | undefined>((resolveRead, reject) => {
      const request = indexedDB.open(database);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(store)) {
          db.close();
          resolveRead(undefined);
          return;
        }
        const transaction = db.transaction(store, "readonly");
        const getRequest = transaction.objectStore(store).get(key);
        getRequest.onsuccess = () => resolveRead(getRequest.result);
        getRequest.onerror = () => reject(getRequest.error);
        transaction.oncomplete = () => db.close();
      };
    });
  }, location);
}

export async function inspectIndexedDb(page: Page): Promise<
  Array<{
    name: string;
    version: number;
    stores: Record<string, unknown[]>;
  }>
> {
  return page.evaluate(async () => {
    const descriptors = await indexedDB.databases();
    return Promise.all(
      descriptors.flatMap((descriptor) => {
        if (!descriptor.name) return [];
        return [
          new Promise<{
            name: string;
            version: number;
            stores: Record<string, unknown[]>;
          }>((resolveDatabase, reject) => {
            const request = indexedDB.open(descriptor.name!);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const storeNames = Array.from(db.objectStoreNames);
              if (storeNames.length === 0) {
                resolveDatabase({
                  name: db.name,
                  version: db.version,
                  stores: {},
                });
                db.close();
                return;
              }
              const transaction = db.transaction(storeNames, "readonly");
              const stores: Record<string, unknown[]> = {};
              Promise.all(
                storeNames.map(
                  (store) =>
                    new Promise<void>((resolveStore, rejectStore) => {
                      const getAll = transaction.objectStore(store).getAll();
                      getAll.onsuccess = () => {
                        stores[store] = getAll.result;
                        resolveStore();
                      };
                      getAll.onerror = () => rejectStore(getAll.error);
                    })
                )
              )
                .then(() =>
                  resolveDatabase({
                    name: db.name,
                    version: db.version,
                    stores,
                  })
                )
                .catch(reject);
              transaction.oncomplete = () => db.close();
            };
          }),
        ];
      })
    );
  });
}
