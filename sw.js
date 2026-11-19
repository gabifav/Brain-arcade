// Brain Arcade service worker: app shell offline, never caches your data.
const CACHE = 'brain-arcade-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/api.js', 'js/auth.js', 'js/config.js', 'js/friends.js', 'js/mascots.js', 'js/me.js',
  'js/photo-editor.js', 'js/photo-store.js', 'js/proof.js', 'js/quests.js', 'js/state.js', 'js/ui.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Never cache Supabase (accounts, quests, private photos).
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;
  const sameOrigin = url.origin === location.origin;
  const isLib = url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!sameOrigin && !isLib) return;
  // Network first (so updates arrive), fall back to cache when offline.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
