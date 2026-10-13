// Persistencia local en IndexedDB (con respaldo en localStorage si IndexedDB no está disponible).
const DB_NAME = 'job-tailor';
const STORE = 'kv';
const KEY = 'state';

export const STATUSES = [
  { id: 'saved', label: 'Guardada' },
  { id: 'ready', label: 'CV listo' },
  { id: 'applied', label: 'Aplicada' },
  { id: 'interview', label: 'Entrevista' },
  { id: 'offer', label: 'Oferta' },
  { id: 'rejected', label: 'Rechazada' },
];

export function defaultState() {
  return {
    version: 1,
    settings: {
      provider: 'gemini',
      keys: {},
      models: {},
      baseUrls: {},
      lang: 'auto',
      level: 'balanced',
      length: '1',
      tone: 'professional',
      template: 'classic',
      extra: '',
      delay: 4,
    },
    profile: { raw: '', notes: '', resume: null, updatedAt: null },
    jobs: [],
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadState() {
  let data = null;
  try {
    const db = await openDb();
    data = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    try { data = JSON.parse(localStorage.getItem(DB_NAME) || 'null'); } catch { data = null; }
  }
  return mergeDefaults(data);
}

export function mergeDefaults(data) {
  const base = defaultState();
  if (!data || typeof data !== 'object') return base;
  return {
    ...base,
    ...data,
    settings: { ...base.settings, ...(data.settings || {}) },
    profile: { ...base.profile, ...(data.profile || {}) },
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
  };
}

let saveTimer = null;
export function saveState(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeState(state), 250);
}

async function writeState(state) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(JSON.parse(JSON.stringify(state)), KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { localStorage.setItem(DB_NAME, JSON.stringify(state)); } catch (e) { console.error('No se pudo guardar', e); }
  }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
