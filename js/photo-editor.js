// Crop / hide-sensitive-stuff editor. Everything happens on the phone.
// "Hide" paints SOLID blocks (not blur), so hidden details can't be recovered.
import { h, buzz, clear, put } from './ui.js';
import { loadImage } from './photo-store.js';

const HIDE_COLORS = ['#2c1f5c', '#ff4fa3', '#39e5ff', '#ffd23f'];

export function editPhoto(rec) {
  return new Promise(async (resolve) => {
    let src = await toCanvas(await loadImage(rec.blob));
    let crop = { x: 0, y: 0, w: src.width, h: src.height };
    let boxes = [];
    let mode = 'hide';
    let colorIx = 0;

    const cv = h('canvas');
    const ctx = cv.getContext('2d');
    const stage = h('div', { class: 'editor-stage' }, cv);
    const hint = h('div', { class: 'editor-hint' });
    const tabs = h('div', { class: 'editor-tabs' });
    const root = h('div', { class: 'editor', role: 'dialog', 'aria-label': 'Edit photo' },
      h('div', { class: 'editor-top' },
        h('button', { class: 'btn sm ghost', onclick: () => done(null) }, 'Cancel'),
        h('div', { class: 'sheet-title' }, 'EDIT PHOTO'),
        h('button', { class: 'btn sm go', onclick: save }, 'Done ✓')),
      stage, hint, tabs);
    document.body.append(root);

    function renderTabs() {
      put(clear(tabs), 
        h('button', { class: 'chip', 'aria-pressed': String(mode === 'hide'), onclick: () => setMode('hide') }, '🙈 Hide'),
        h('button', { class: 'chip', 'aria-pressed': String(mode === 'crop'), onclick: () => setMode('crop') }, '✂️ Crop'),
        h('button', { class: 'chip', onclick: rotate }, '↻ Rotate'),
        mode === 'hide' ? h('button', { class: 'chip', onclick: () => { colorIx = (colorIx + 1) % HIDE_COLORS.length; draw(); renderTabs(); } },
          h('span', { style: { width: '18px', height: '18px', borderRadius: '5px', background: HIDE_COLORS[colorIx], display: 'inline-block', border: '2px solid #fff' } }), 'Colour') : null,
        h('button', { class: 'chip', onclick: undo, disabled: mode === 'hide' ? !boxes.length : null }, mode === 'hide' ? '↶ Undo' : '⟲ Reset'));
      hint.textContent = mode === 'hide'
        ? 'Drag over anything private (faces, names, addresses, screens) to cover it.'
        : 'Drag the corners to crop. Drag the middle to move.';
    }
    function setMode(m) { mode = m; renderTabs(); draw(); }
    function undo() {
      if (mode === 'hide') boxes.pop(); else crop = { x: 0, y: 0, w: src.width, h: src.height };
      renderTabs(); draw();
    }
    function rotate() {
      const r = document.createElement('canvas'); r.width = src.height; r.height = src.width;
      const g = r.getContext('2d'); g.translate(r.width, 0); g.rotate(Math.PI / 2);
      g.drawImage(bake(false), 0, 0); // keep hidden boxes when rotating
      src = r; boxes = []; crop = { x: 0, y: 0, w: src.width, h: src.height };
      fit(); renderTabs(); draw();
    }

    function fit() {
      cv.width = src.width; cv.height = src.height;
      const sw = stage.clientWidth - 16, sh = stage.clientHeight - 16;
      const s = Math.min(sw / src.width, sh / src.height);
      cv.style.width = Math.floor(src.width * s) + 'px';
      cv.style.height = Math.floor(src.height * s) + 'px';
    }
    const scale = () => cv.width / cv.getBoundingClientRect().width;

    function paintBoxes(g, list, dx = 0, dy = 0) {
      for (const b of list) {
        const x = Math.min(b.x, b.x + b.w) - dx, y = Math.min(b.y, b.y + b.h) - dy;
        const w = Math.abs(b.w), hh = Math.abs(b.h);
        g.fillStyle = b.c; g.fillRect(x, y, w, hh);
        const fs = Math.max(14, Math.min(w, hh) * 0.5);
        g.font = `${fs}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('🙈', x + w / 2, y + hh / 2);
      }
    }
    function draw(live) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(src, 0, 0);
      paintBoxes(ctx, live ? [...boxes, live] : boxes);
      if (mode === 'crop' || crop.w < src.width || crop.h < src.height) {
        ctx.fillStyle = 'rgba(5,2,12,.65)';
        ctx.fillRect(0, 0, cv.width, crop.y);
        ctx.fillRect(0, crop.y + crop.h, cv.width, cv.height - crop.y - crop.h);
        ctx.fillRect(0, crop.y, crop.x, crop.h);
        ctx.fillRect(crop.x + crop.w, crop.y, cv.width - crop.x - crop.w, crop.h);
      }
      if (mode === 'crop') {
        const s = scale();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * s; ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
        ctx.fillStyle = '#ff4fa3';
        const r = 11 * s;
        for (const [cx, cy] of corners()) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); ctx.stroke(); }
      }
    }
    const corners = () => [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]];

    function pt(e) {
      const r = cv.getBoundingClientRect(), s = cv.width / r.width;
      return { x: Math.max(0, Math.min(cv.width, (e.clientX - r.left) * s)), y: Math.max(0, Math.min(cv.height, (e.clientY - r.top) * s)) };
    }
    let drag = null;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      const p = pt(e);
      if (mode === 'hide') { drag = { kind: 'box', box: { x: p.x, y: p.y, w: 0, h: 0, c: HIDE_COLORS[colorIx] } }; return; }
      const near = 34 * scale();
      const ci = corners().findIndex(([cx, cy]) => Math.hypot(cx - p.x, cy - p.y) < near);
      if (ci >= 0) drag = { kind: 'corner', ci, start: { ...crop } };
      else if (p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h) drag = { kind: 'move', p0: p, start: { ...crop } };
    });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      const p = pt(e);
      if (drag.kind === 'box') { drag.box.w = p.x - drag.box.x; drag.box.h = p.y - drag.box.y; draw(drag.box); return; }
      const min = Math.min(src.width, src.height) * 0.12;
      const s = drag.start;
      if (drag.kind === 'move') {
        crop.x = Math.max(0, Math.min(src.width - s.w, s.x + p.x - drag.p0.x));
        crop.y = Math.max(0, Math.min(src.height - s.h, s.y + p.y - drag.p0.y));
      } else {
        let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
        if (drag.ci === 0 || drag.ci === 2) x1 = Math.min(p.x, x2 - min); else x2 = Math.max(p.x, x1 + min);
        if (drag.ci === 0 || drag.ci === 1) y1 = Math.min(p.y, y2 - min); else y2 = Math.max(p.y, y1 + min);
        crop = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      draw();
    });
    const end = () => {
      if (drag && drag.kind === 'box' && Math.abs(drag.box.w) > 8 && Math.abs(drag.box.h) > 8) { boxes.push(drag.box); buzz(10); renderTabs(); }
      drag = null; draw();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    function bake(cropIt = true) {
      const c = cropIt ? crop : { x: 0, y: 0, w: src.width, h: src.height };
      const out = document.createElement('canvas');
      out.width = Math.round(c.w); out.height = Math.round(c.h);
      const g = out.getContext('2d');
      g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
      paintBoxes(g, boxes, c.x, c.y);
      return out;
    }
    async function save() {
      const out = bake(true);
      const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.85));
      done({ blob, width: out.width, height: out.height });
    }
    function done(v) { removeEventListener('resize', onResize); root.remove(); resolve(v); }
    const onResize = () => { fit(); draw(); };
    addEventListener('resize', onResize);

    renderTabs();
    requestAnimationFrame(() => { fit(); draw(); });
  });
}

async function toCanvas(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}
