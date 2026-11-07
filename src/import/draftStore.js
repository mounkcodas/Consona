let connection;
function openDatabase() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('consona-import-workspace', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('drafts'); request.result.createObjectStore('assets'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = null; reject(request.error); };
  });
  return connection;
}
async function access(store, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = operation(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Armazenamento interrompido.'));
  });
}
export const loadDraft = userId => access('drafts', 'readonly', store => store.get(userId));
export const persistDraft = (userId, value) => access('drafts', 'readwrite', store => store.put(value, userId));
export const putAsset = (key, file) => access('assets', 'readwrite', store => store.put(file, key));
export const getAsset = key => access('assets', 'readonly', store => store.get(key));
export async function clearDraftAssets(userId, batchId) {
  await access('assets', 'readwrite', store => {
    const request = store.openCursor(IDBKeyRange.bound(`${userId}:${batchId}:`, `${userId}:${batchId}:\uffff`));
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
  });
}
