// Google Drive sync via Google Identity Services (token flow) + Drive REST v3.
// Scope drive.file: the app only sees files it created.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DATA_FILE = 'trade-memo-data.json';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

function loadGIS() {
  if (window.google && window.google.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = resolve; s.onerror = () => reject(new Error('โหลด Google Identity script ไม่สำเร็จ (ต้องต่อเน็ต)'));
    document.head.appendChild(s);
  });
}

export async function getToken(clientId, { interactive = true } = {}) {
  if (!clientId) throw new Error('ยังไม่ได้ใส่ Google OAuth Client ID ในหน้าตั้งค่า');
  if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
  await loadGIS();
  return new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        resolve(accessToken);
      },
      error_callback: (e) => reject(new Error(e.message || e.type || 'auth error')),
    });
    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export function signOut() {
  if (accessToken && window.google) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null; tokenExpiresAt = 0;
}

async function api(path, { method = 'GET', query = {}, body, headers = {}, raw = false } = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = (path.startsWith('http') ? path : 'https://www.googleapis.com/drive/v3' + path) + (qs ? '?' + qs : '');
  const res = await fetch(url, { method, headers: { Authorization: 'Bearer ' + accessToken, ...headers }, body });
  if (!res.ok) {
    let msg = `Drive ${res.status}`;
    try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch {}
    throw new Error(msg);
  }
  return raw ? res : res.json();
}

async function findByName(name, parentId, mimeType) {
  let q = `name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  if (mimeType) q += ` and mimeType = '${mimeType}'`;
  const r = await api('/files', { query: { q, fields: 'files(id,name,modifiedTime,size)', pageSize: 10, spaces: 'drive' } });
  return r.files[0] || null;
}

export async function ensureFolder(name, parentId) {
  const f = await findByName(name, parentId, 'application/vnd.google-apps.folder');
  if (f) return f.id;
  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const r = await api('/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta), query: { fields: 'id' } });
  return r.id;
}

async function uploadMultipart(meta, blob, existingId) {
  const boundary = 'tm' + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`;
  const body = new Blob([head, blob, `\r\n--${boundary}--`]);
  const url = 'https://www.googleapis.com/upload/drive/v3/files' + (existingId ? '/' + existingId : '');
  return api(url, { method: existingId ? 'PATCH' : 'POST', query: { uploadType: 'multipart', fields: 'id,name,modifiedTime' }, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
}

export async function listFolder(folderId) {
  const files = []; let pageToken;
  do {
    const r = await api('/files', { query: { q: `'${folderId}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,modifiedTime,size,mimeType)', pageSize: 1000, ...(pageToken ? { pageToken } : {}) } });
    files.push(...r.files); pageToken = r.nextPageToken;
  } while (pageToken);
  return files;
}

export async function downloadJson(fileId) {
  const res = await api(`/files/${fileId}`, { query: { alt: 'media' }, raw: true });
  return res.json();
}
export async function downloadBlob(fileId) {
  const res = await api(`/files/${fileId}`, { query: { alt: 'media' }, raw: true });
  return res.blob();
}

/**
 * Push: upload data JSON (overwrite) + any images missing on Drive.
 * Pull: download JSON, merge days by updatedAt, fetch images missing locally.
 * `store` is an adapter: {exportAll, importDays, getImageBlob, listImageMeta, addImage}
 */
export async function sync({ clientId, folderName, store, onProgress = () => {} }) {
  await getToken(clientId);
  onProgress('กำลังหาโฟลเดอร์บน Drive…');
  const rootId = await ensureFolder(folderName || 'Trade Memo');
  const imgFolderId = await ensureFolder('images', rootId);

  // ---- pull first (merge remote into local) ----
  const remoteFiles = await listFolder(rootId);
  const dataFile = remoteFiles.find(f => f.name === DATA_FILE);
  let merged = { added: 0, updated: 0, imagesDown: 0, imagesUp: 0 };
  if (dataFile) {
    onProgress('กำลังดึงข้อมูลจาก Drive…');
    const remote = await downloadJson(dataFile.id);
    const r = await store.importDays(remote.days || []);
    merged.added = r.added; merged.updated = r.updated;
    // images referenced remotely but missing locally
    const localMeta = await store.listImageMeta();
    const localIds = new Set(localMeta.map(m => m.id));
    const remoteImgs = await listFolder(imgFolderId);
    const byName = new Map(remoteImgs.map(f => [f.name, f]));
    for (const m of remote.images || []) {
      if (localIds.has(m.id)) continue;
      const f = byName.get(fileNameFor(m));
      if (!f) continue;
      onProgress(`ดาวน์โหลดรูป ${merged.imagesDown + 1}…`);
      const blob = await downloadBlob(f.id);
      await store.addImage({ ...m, blob: new Blob([blob], { type: m.type || blob.type }) });
      merged.imagesDown++;
    }
  }

  // ---- push (local is now the union) ----
  onProgress('กำลังอัปโหลดข้อมูล…');
  const all = await store.exportAll();
  const jsonBlob = new Blob([JSON.stringify(all)], { type: 'application/json' });
  await uploadMultipart(dataFile ? { name: DATA_FILE } : { name: DATA_FILE, parents: [rootId] }, jsonBlob, dataFile ? dataFile.id : undefined);

  const remoteImgs = await listFolder(imgFolderId);
  const have = new Set(remoteImgs.map(f => f.name));
  for (const m of all.images) {
    const name = fileNameFor(m);
    if (have.has(name)) continue;
    const blob = await store.getImageBlob(m.id);
    if (!blob) continue;
    onProgress(`อัปโหลดรูป ${merged.imagesUp + 1}…`);
    await uploadMultipart({ name, parents: [imgFolderId] }, blob);
    merged.imagesUp++;
  }
  onProgress('เสร็จแล้ว');
  return merged;
}

function fileNameFor(m) {
  const ext = (m.type || 'image/png').split('/')[1].replace('jpeg', 'jpg');
  return `${m.id}.${ext}`;
}
