// Tiny UI toolkit: element builder, sheets, toasts, celebrations.
import { mascotSVG } from './mascots.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (s, r = document) => r.querySelector(s);
// append children, flattening arrays and skipping null/false (DOM append() would print them)
export function put(el, ...kids) { add(el, kids); return el; }
export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }
export function mascot(kind, mood = 'happy', cls = '') {
  const w = h('div', { class: 'mascot ' + cls, 'aria-hidden': 'true' });
  w.innerHTML = mascotSVG(kind, mood);
  return w;
}

// ── toasts
export function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}
export function friendlyError(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || '');
  if (/fetch|network|Failed to/i.test(m)) return 'No connection right now — your stuff is safe. Try again in a sec!';
  if (/JWT|session|auth/i.test(m) && !/code/i.test(m)) return 'Your sign-in timed out. Please sign in again.';
  return m.replace(/^.*?:\s(?=[A-Z])/, '') || 'Something wobbled. Try again?';
}
export function oops(e) { console.error(e); toast(friendlyError(e), 'warn'); }

// ── busy buttons
export async function busy(btn, fn) {
  if (!btn || btn.disabled) return;
  const old = [...btn.childNodes];
  btn.disabled = true; clear(btn).append(h('span', { class: 'spinner' }));
  try { return await fn(); }
  finally { if (btn.isConnected) { btn.disabled = false; clear(btn).append(...old); } }
}

// ── bottom sheets
const stack = [];
export function sheet({ title = '', full = false, onClose } = {}) {
  const layer = $('#layer');
  const back = h('div', { class: 'backdrop' });
  const body = h('div', { class: 'sheet-body' });
  const closeBtn = h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: () => close() }, '✕');
  const el = h('div', { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    full ? null : h('div', { class: 'grab' }),
    h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-title' }, title), closeBtn),
    body);
  const wrap = h('div', { style: { position: 'absolute', inset: 0 } }, full ? null : back, el);
  back.addEventListener('click', () => close());
  layer.append(wrap);
  document.body.style.overflow = 'hidden';
  let closed = false;
  function close(result) {
    if (closed) return; closed = true;
    wrap.remove(); stack.splice(stack.indexOf(api), 1);
    if (!stack.length) document.body.style.overflow = '';
    onClose && onClose(result);
  }
  const api = { el, body, close, setTitle: t => { $('.sheet-title', el).textContent = t; } };
  stack.push(api);
  return api;
}
export function closeAllSheets() { [...stack].reverse().forEach(s => s.close()); }

export function confirmSheet({ title, text, yes = 'Yes', no = 'Never mind', danger = false }) {
  return new Promise(res => {
    const s = sheet({ title, onClose: r => res(!!r) });
    s.body.append(
      h('p', { class: 'lead' }, text),
      h('div', { class: 'stack' },
        h('button', { class: 'btn block ' + (danger ? 'danger' : 'primary'), onclick: () => s.close(true) }, yes),
        h('button', { class: 'btn block ghost', onclick: () => s.close(false) }, no)));
  });
}

// ── rewards
export function coinPop(amount, from) {
  if (!amount) return;
  const r = from && from.getBoundingClientRect ? from.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0 };
  const p = h('div', { class: 'coin-pop', style: { left: (r.left + r.width / 2 - 20) + 'px', top: (r.top - 10) + 'px' } }, `+${amount} 🪙`);
  document.body.append(p);
  setTimeout(() => p.remove(), 1200);
  buzz(15);
}
export function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

export function confetti(target, n = 70) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#ff4fa3', '#39e5ff', '#ffd23f', '#5dff9b', '#b79cff', '#ff9f43'];
  for (let i = 0; i < n; i++) {
    const c = h('i', { class: 'confetti', style: {
      left: Math.random() * 100 + '%', background: colors[i % colors.length],
      animationDuration: (1.6 + Math.random() * 1.8) + 's', animationDelay: Math.random() * .6 + 's',
      borderRadius: Math.random() > .5 ? '50%' : '2px' } });
    target.append(c);
  }
}

export function celebrate({ title, sub = '', reward = '', mascots = ['bleep', 'coinny'], extra = null, button = 'YAY!' }) {
  return new Promise(res => {
    const inner = h('div', { class: 'inner' },
      h('div', { class: 'big' }, title),
      sub ? h('div', { class: 'sub' }, sub) : null,
      h('div', { class: 'mascots' }, mascots.map(m => mascot(m, 'cheer'))),
      reward ? h('div', { class: 'reward' }, reward) : null,
      extra,
      h('button', { class: 'btn gold block', style: { marginTop: '16px' }, onclick: () => { el.remove(); res(); } }, button));
    const el = h('div', { class: 'celebrate', role: 'dialog', 'aria-label': title }, inner);
    document.body.append(el);
    confetti(el);
    buzz([30, 40, 30]);
  });
}

export function lightbox(src, alt = '') {
  const el = h('div', { class: 'lightbox', onclick: () => el.remove() },
    h('img', { src, alt }),
    h('button', { class: 'iconbtn', 'aria-label': 'Close', style: { position: 'absolute', top: 'calc(env(safe-area-inset-top) + 10px)', right: '10px' } }, '✕'));
  document.body.append(el);
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}
