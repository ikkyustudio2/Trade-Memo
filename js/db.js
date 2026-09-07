// IndexedDB storage layer for Trade Memo
// Stores: days (key: date 'YYYY-MM-DD'), images (key: id), settings (key: 'main')

const DB_NAME = 'trade-memo';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('days')) {
        db.createObjectStore('days', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('images')) {
        const s = db.createObjectStore('images', { keyPath: 'id' });
        s.createIndex('byDate', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqToPromise(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function emptyDay(date) {
  return {
    date,
    plan: { bias: '', setup: '', entryRules: '', riskNotes: '', notes: '', images: [] },
    trades: [],
    review: { notes: '', lessons: '', mood: '', images: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export const Days = {
  get: (date) => reqToPromise('days', 'readonly', s => s.get(date)),
  getOrCreate: async (date) => (await Days.get(date)) || emptyDay(date),
  put: (day) => { day.updatedAt = Date.now(); return tx('days', 'readwrite', s => s.put(day)); },
  putRaw: (day) => tx('days', 'readwrite', s => s.put(day)),
  delete: (date) => tx('days', 'readwrite', s => s.delete(date)),
  all: () => reqToPromise('days', 'readonly', s => s.getAll()),
};

export const Images = {
  get: (id) => reqToPromise('images', 'readonly', s => s.get(id)),
  put: (img) => tx('images', 'readwrite', s => s.put(img)),
  delete: (id) => tx('images', 'readwrite', s => s.delete(id)),
  all: () => reqToPromise('images', 'readonly', s => s.getAll()),
  allMeta: async () => (await Images.all()).map(({ blob, ...m }) => m),
  byDate: (date) => reqToPromise('images', 'readonly', s => s.index('byDate').getAll(date)),
  async add(blob, date, kind, name) {
    const img = { id: uid(), date, kind, name: name || 'image.png', type: blob.type || 'image/png', size: blob.size, blob, createdAt: Date.now() };
    await Images.put(img);
    return img;
  },
};

export const Settings = {
  async get() {
    const s = await reqToPromise('settings', 'readonly', st => st.get('main'));
    const v = s ? s.value : {};
    if (v.geminiModel === 'gemini-2.5-flash' || v.geminiModel === 'gemini-2.5-pro') v.geminiModel = 'gemini-3.6-flash';
    return Object.assign({
      claudeKey: '',
      claudeModel: 'claude-opus-5',
      geminiKey: '',
      geminiModel: 'gemini-3.6-flash',
      aiEngine: 'claude',
      driveClientId: '',
      driveFolderName: 'Trade Memo',
      currency: 'USD',
      startingBalance: 0,
      lastSync: 0,
    }, v);
  },
  async set(patch) {
    const cur = await Settings.get();
    const next = Object.assign(cur, patch);
    await tx('settings', 'readwrite', st => st.put({ key: 'main', value: next }));
    return next;
  },
};

export async function exportAll() {
  const days = await Days.all();
  const images = await Images.allMeta();
  return { version: 1, exportedAt: Date.now(), days, images };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
