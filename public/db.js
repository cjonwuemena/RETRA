// Minimal IndexedDB wrapper. Everything the app stores — meeting metadata,
// the recorded audio blob, and the transcript — lives in this one local
// per-origin database. Nothing ever leaves the machine.
const DB_NAME = 'meeting-scribe';
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meetings')) {
        db.createObjectStore('meetings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('audio')) {
        db.createObjectStore('audio', { keyPath: 'meetingId' });
      }
      if (!db.objectStoreNames.contains('transcripts')) {
        db.createObjectStore('transcripts', { keyPath: 'meetingId' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async addMeeting(meta) {
    await withStore('meetings', 'readwrite', (s) => s.put(meta));
    return meta;
  },

  async updateMeeting(id, patch) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meetings', 'readwrite');
      const store = tx.objectStore('meetings');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result;
        if (!current) { resolve(null); return; }
        const updated = { ...current, ...patch };
        store.put(updated);
        tx.oncomplete = () => resolve(updated);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  async listMeetings() {
    const db = await openDb();
    const tx = db.transaction('meetings', 'readonly');
    const all = await reqToPromise(tx.objectStore('meetings').getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getMeeting(id) {
    const db = await openDb();
    const tx = db.transaction('meetings', 'readonly');
    return reqToPromise(tx.objectStore('meetings').get(id)) || null;
  },

  async deleteMeeting(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['meetings', 'audio', 'transcripts'], 'readwrite');
      tx.objectStore('meetings').delete(id);
      tx.objectStore('audio').delete(id);
      tx.objectStore('transcripts').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async saveAudioBlob(meetingId, blob) {
    await withStore('audio', 'readwrite', (s) => s.put({ meetingId, blob }));
  },

  async getAudioBlob(meetingId) {
    const db = await openDb();
    const tx = db.transaction('audio', 'readonly');
    const row = await reqToPromise(tx.objectStore('audio').get(meetingId));
    return row ? row.blob : null;
  },

  async saveTranscript(meetingId, transcript) {
    await withStore('transcripts', 'readwrite', (s) => s.put({ meetingId, ...transcript }));
  },

  async getTranscript(meetingId) {
    const db = await openDb();
    const tx = db.transaction('transcripts', 'readonly');
    const row = await reqToPromise(tx.objectStore('transcripts').get(meetingId));
    if (!row) return null;
    const { meetingId: _drop, ...rest } = row;
    return rest;
  },

  async setSetting(key, value) {
    await withStore('settings', 'readwrite', (s) => s.put({ key, value }));
  },

  async getSetting(key) {
    const db = await openDb();
    const tx = db.transaction('settings', 'readonly');
    const row = await reqToPromise(tx.objectStore('settings').get(key));
    return row ? row.value : null;
  },
};

window.DB = DB;
