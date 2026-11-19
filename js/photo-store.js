// Photos stay ON THIS PHONE (IndexedDB) until you choose to share one.
// Nothing here is uploaded automatically.
const DB = 'brain-arcade-photos', STORE = 'photos';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('questId', 'questId');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(STORE, mode); const s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}
export const savePhoto = rec => tx('readwrite', s => { s.put(rec); return rec; });
export const photosFor = questId => tx('readonly', s => s.index('questId').getAll(questId));
export const deletePhoto = id => tx('readwrite', s => s.delete(id));
export async function deletePhotosFor(questId) {
  const all = await photosFor(questId);
  await Promise.all(all.map(p => deletePhoto(p.id)));
}
export const clearAll = () => tx('readwrite', s => s.clear());
export const countAll = () => tx('readonly', s => s.count());

// Load any picked/taken image, fix orientation, shrink to ≤1600px and re-encode
// as JPEG. Re-encoding through a canvas strips hidden metadata such as GPS location.
export async function normalise(file, max = 1600) {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), hgt = Math.round(img.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(img, 0, 0, w, hgt);
  if (img.close) img.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  return { blob, width: w, height: hgt };
}
export async function loadImage(src) {
  if (src instanceof Blob && 'createImageBitmap' in window) {
    try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch {}
  }
  return new Promise((res, rej) => {
    const i = new Image();
    const url = src instanceof Blob ? URL.createObjectURL(src) : src;
    i.onload = () => { res(i); if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000); };
    i.onerror = () => rej(new Error("Couldn't open that photo — try a different one?"));
    i.src = url;
  });
}

// Ask the phone for ONE photo — either the camera or a single pick from the library.
export function pickPhoto(useCamera) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if (useCamera) inp.setAttribute('capture', 'environment');
    inp.style.display = 'none';
    inp.onchange = () => { res(inp.files && inp.files[0] || null); inp.remove(); };
    // iOS fires no event on cancel; the promise just stays pending, which is harmless.
    document.body.append(inp);
    inp.click();
  });
}

const urls = new Map();
export function blobUrl(rec) {
  if (!urls.has(rec.id)) urls.set(rec.id, URL.createObjectURL(rec.blob));
  return urls.get(rec.id);
}
export function forgetUrl(id) { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } }
