// QUEST PROOF: build a submission (photos optional), and view / verify one.
import * as api from './api.js';
import { S, loadSocial, loadStats } from './state.js';
import { h, mascot, sheet, toast, oops, busy, confirmSheet, celebrate, lightbox, timeAgo, clear, put } from './ui.js';
import { BADGES, REACTIONS } from './mascots.js';
import * as store from './photo-store.js';
import { editPhoto } from './photo-editor.js';

const CAPTIONS = ['I FINALLY DID IT!', 'Small steps count!', 'Progress, not perfection 💪', 'Look at this glow-up ✨', 'It was hard but I did a bit!'];
const CHEERS = ['QUEST VERIFIED!', 'YOUR BESTIE APPROVES!', 'LEGENDARY EFFORT!', 'PROGRESS DETECTED!', 'So proud of you 💖'];
const ASKS = ['Could I see a bit more? 😊', 'What was the hardest bit?', "A photo didn't load for me — could you try again?", 'Tell me more about it!'];
const MAX_PHOTOS = 6;

// ───────────────── before/after slider ─────────────────
export function compareSlider(beforeSrc, afterSrc) {
  const range = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Slide to compare before and after' });
  const box = h('div', { class: 'compare' },
    h('img', { src: afterSrc, alt: 'After' }),
    h('img', { class: 'before', src: beforeSrc, alt: 'Before' }),
    h('div', { class: 'handle' }),
    h('span', { class: 'lbl l' }, 'BEFORE'), h('span', { class: 'lbl r' }, 'AFTER'),
    range);
  range.addEventListener('input', () => box.style.setProperty('--pos', range.value + '%'));
  return box;
}

// ───────────────── submission wizard ─────────────────
export async function openProofWizard(quest) {
  const s = sheet({ title: 'QUEST PROOF 📸', full: true });
  let photos = await store.photosFor(quest.id).catch(() => []);
  const picked = new Set();               // opt-in: nothing is selected until you tap it
  const progress = (quest.minis || []).map(m => ({ title: m.title, done: m.done, include: true }));
  let caption = '';
  let friendId = S.friends.length === 1 ? S.friends[0].id : null;
  let step = 1;

  const draw = () => {
    clear(s.body);
    put(s.body, h('div', { class: 'steps' }, [1, 2, 3, 4].map(i => h('i', { class: i <= step ? 'on' : '' }))));
    put(s.body, h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('div', { class: 'quest-emoji' }, quest.emoji), h('div', { class: 'quest-title grow' }, quest.title)));
    ({ 1: stepPhotos, 2: stepDetails, 3: stepFriend, 4: stepReview })[step]();
    s.el.scrollTop = 0;
  };
  const nav = (backFn, nextLabel, nextFn, nextDisabled) => h('div', { class: 'row', style: { marginTop: '18px', gap: '10px' } },
    backFn ? h('button', { class: 'btn ghost', onclick: backFn }, '← Back') : null,
    h('button', { class: 'btn primary grow', onclick: nextFn, disabled: nextDisabled || null }, nextLabel));

  // STEP 1 — photos (optional)
  function slot(kind) {
    const rec = photos.find(p => p.kind === kind);
    if (!rec) return h('div', { class: 'photo-slot' },
      h('div', { class: 'tag' }, kind.toUpperCase()),
      h('div', { class: 'small' }, kind === 'before' ? 'No before photo' : 'Show your progress!'),
      h('div', { class: 'slot-btns' },
        h('button', { class: 'btn sm primary', onclick: () => addPhoto(kind, true) }, '📷 Camera'),
        h('button', { class: 'btn sm', onclick: () => addPhoto(kind, false) }, '🖼️ Choose')));
    return photoTile(rec);
  }
  function photoTile(rec) {
    const on = picked.has(rec.id);
    return h('div', { class: 'photo-slot has' + (on ? ' picked' : ''), role: 'button', tabindex: 0, 'aria-pressed': String(on),
        'aria-label': `${rec.kind} photo — ${on ? 'will be shared' : 'not shared'}. Tap to ${on ? 'leave out' : 'include'}.`,
        onclick: (e) => { if (e.target.closest('.tools')) return; on ? picked.delete(rec.id) : picked.add(rec.id); draw(); } },
      h('img', { src: store.blobUrl(rec), alt: '' }),
      h('div', { class: 'tag' }, rec.kind.toUpperCase()),
      h('div', { class: 'pick' }, on ? '✓' : ''),
      h('div', { class: 'tools' },
        h('button', { onclick: async () => {
          const out = await editPhoto(rec);
          if (!out) return;
          store.forgetUrl(rec.id); Object.assign(rec, out); await store.savePhoto(rec); draw();
        } }, '✂️ Crop/Hide'),
        h('button', { 'aria-label': 'Delete photo from phone', onclick: async () => {
          if (!await confirmSheet({ title: 'REMOVE PHOTO?', text: 'Delete this photo from this phone?', yes: 'Delete', danger: true })) return;
          await store.deletePhoto(rec.id); store.forgetUrl(rec.id); picked.delete(rec.id);
          photos = photos.filter(p => p !== rec); draw();
        } }, '🗑️')));
  }
  async function addPhoto(kind, cam) {
    if (photos.length >= MAX_PHOTOS) { toast(`Up to ${MAX_PHOTOS} photos per quest`); return; }
    const file = await store.pickPhoto(cam);
    if (!file) return;
    try {
      const n = await store.normalise(file);
      if (kind !== 'extra') { // replace an existing before/after
        for (const old of photos.filter(p => p.kind === kind)) { await store.deletePhoto(old.id); store.forgetUrl(old.id); picked.delete(old.id); }
        photos = photos.filter(p => p.kind !== kind);
      }
      const rec = { id: crypto.randomUUID(), questId: quest.id, kind, ...n, createdAt: Date.now() };
      await store.savePhoto(rec); photos.push(rec); picked.add(rec.id); // you just took it for this, so it starts ticked — tap to untick
      draw();
    } catch (e) { oops(e); }
  }
  function stepPhotos() {
    const before = photos.find(p => p.kind === 'before'), after = photos.find(p => p.kind === 'after');
    const extras = photos.filter(p => p.kind === 'extra');
    put(s.body, 
      h('div', { class: 'h2', style: { marginTop: '4px' } }, 'STEP 1 · PHOTOS (OPTIONAL)'),
      h('p', { class: 'lead' }, 'Tap a photo to include it. Only photos with a ✓ get sent. Use ✂️ to crop or hide anything private.'),
      h('div', { class: 'photo-grid' }, slot('before'), slot('after'), extras.map(photoTile),
        photos.length < MAX_PHOTOS ? h('div', { class: 'photo-slot' }, h('div', { class: 'small' }, 'Another photo?'),
          h('div', { class: 'slot-btns' },
            h('button', { class: 'btn sm', onclick: () => addPhoto('extra', true) }, '📷'),
            h('button', { class: 'btn sm', onclick: () => addPhoto('extra', false) }, '🖼️'))) : null),
      before && after && picked.has(before.id) && picked.has(after.id)
        ? [h('div', { class: 'h2' }, 'BEFORE ↔ AFTER PREVIEW'), compareSlider(store.blobUrl(before), store.blobUrl(after))] : null,
      h('div', { class: 'privacy-note' }, '🔒', h('div', null, 'Photos are never taken from your library automatically. You picked each one, and they only leave this phone when you press Send.')),
      nav(null, picked.size ? `Next (${picked.size} photo${picked.size > 1 ? 's' : ''}) →` : 'Next — no photos →', () => { step = 2; draw(); }));
  }

  // STEP 2 — caption + which steps to show
  function stepDetails() {
    const ta = h('textarea', { class: 'input', maxlength: 200, placeholder: 'Say something about it (optional)' }, caption);
    ta.addEventListener('input', () => { caption = ta.value; });
    put(s.body, 
      h('div', { class: 'h2', style: { marginTop: '4px' } }, 'STEP 2 · CAPTION'),
      h('div', { class: 'wrap', style: { marginBottom: '10px' } }, CAPTIONS.map(c =>
        h('button', { class: 'chip', onclick: () => { caption = c; ta.value = c; } }, c))),
      ta,
      progress.length ? [
        h('div', { class: 'h2' }, 'STEPS TO SHOW'),
        h('p', { class: 'small' }, 'Untick anything you\'d rather keep to yourself.'),
        h('div', { class: 'stack' }, progress.map(p => h('label', { class: 'switch' },
          h('span', null, (p.done ? '✅ ' : '⬜ ') + p.title),
          h('input', { type: 'checkbox', class: 'toggle', checked: p.include || null, onchange: e => { p.include = e.target.checked; } }))))] : null,
      nav(() => { step = 1; draw(); }, 'Next →', () => { step = 3; draw(); }));
  }

  // STEP 3 — choose ONE trusted friend
  function stepFriend() {
    put(s.body, h('div', { class: 'h2', style: { marginTop: '4px' } }, 'STEP 3 · WHO GETS TO SEE IT?'));
    if (!S.friends.length) {
      put(s.body, h('div', { class: 'empty' }, mascot('pip', 'think'),
        h('p', null, 'You haven\'t connected a trusted friend yet. Invite someone from the Friends tab — then come back here!')),
        h('button', { class: 'btn primary block', onclick: () => { s.close(); document.dispatchEvent(new CustomEvent('ba:tab', { detail: 'friends' })); } }, '💛 Go to Friends'),
        nav(() => { step = 2; draw(); }, 'Send', () => {}, true));
      return;
    }
    put(s.body, 
      h('div', { class: 'radio-list' }, S.friends.map(f => h('button', { 'aria-pressed': String(friendId === f.id), onclick: () => { friendId = f.id; draw(); } },
        h('div', { class: 'avatar' }, mascot(f.mascot)), h('span', { class: 'grow' }, f.display_name), friendId === f.id ? '✓' : ''))),
      h('p', { class: 'small', style: { marginTop: '10px' } }, 'Only this one friend can open it. Not public, not anyone else.'),
      nav(() => { step = 2; draw(); }, 'Review →', () => { step = 4; draw(); }, !friendId));
  }

  // STEP 4 — review + send
  function stepReview() {
    const f = S.friends.find(x => x.id === friendId);
    const chosen = photos.filter(p => picked.has(p.id));
    const shown = progress.filter(p => p.include);
    const sendBtn = h('button', { class: 'btn primary block' }, `🚀 SEND TO ${f.display_name.toUpperCase()}`);
    const status = h('div', { class: 'small', style: { textAlign: 'center', marginTop: '8px' } });
    sendBtn.onclick = () => busy(sendBtn, async () => {
      try {
        const { bonus } = await api.submitProof({
          friendId, quest, caption: caption.trim(), outcome: quest.status === 'done' ? quest.outcome : 'partial',
          progress: shown.map(p => ({ title: p.title, done: p.done })),
          photos: chosen.map(p => ({ kind: p.kind, blob: p.blob, width: p.width, height: p.height })),
        }, (i, n) => { status.textContent = `Uploading photo ${i} of ${n}…`; });
        s.close();
        loadSocial(); loadStats();
        await celebrate({ title: 'PROOF SENT!', sub: `${f.display_name.toUpperCase()} WILL SEE IT SOON`,
          reward: bonus ? `+${bonus} 🪙 proof bonus` : 'Your quest already counts — this is just for fun!', mascots: ['bleep', f.mascot] });
      } catch (e) { status.textContent = ''; oops(e); }
    });
    put(s.body, 
      h('div', { class: 'h2', style: { marginTop: '4px' } }, 'STEP 4 · CHECK & SEND'),
      h('div', { class: 'card' },
        h('div', { class: 'row' }, h('div', { class: 'avatar' }, mascot(f.mascot)), h('div', null, h('b', null, f.display_name), h('div', { class: 'small' }, 'is the only person who can see this'))),
        chosen.length ? h('div', { class: 'thumbs', style: { marginTop: '12px' } }, chosen.map(p => h('img', { src: store.blobUrl(p), alt: p.kind + ' photo' })))
                      : h('p', { class: 'small' }, 'No photos — just your words. That\'s totally fine!'),
        caption.trim() ? h('div', { class: 'caption' }, caption.trim()) : null,
        shown.length ? h('ul', { class: 'progress-list' }, shown.map(p => h('li', null, (p.done ? '✅ ' : '⬜ ') + p.title))) : null),
      h('div', { class: 'privacy-note' }, '🛡️', h('div', null, `Sending ${chosen.length} photo${chosen.length === 1 ? '' : 's'}. Stored privately. You can delete it any time from Friends → Sent, and disconnecting removes ${f.display_name}'s access.`)),
      sendBtn, status,
      h('button', { class: 'btn ghost block', style: { marginTop: '10px' }, onclick: () => { step = 3; draw(); } }, '← Back'));
  }

  draw();
}

// ───────────────── viewing a proof ─────────────────
let openView = null;
export function refreshOpenProof() { if (openView) openView(); }

export async function openProofView(proofId) {
  const s = sheet({ title: 'QUEST PROOF', full: true, onClose: () => { openView = null; } });
  put(s.body, h('div', { class: 'empty' }, 'Loading…'));
  const load = async () => {
    let d;
    try { d = await api.proofDetail(proofId); } catch (e) { oops(e); return; }
    if (!d) { put(clear(s.body), h('div', { class: 'empty' }, mascot('bleep', 'think'), 'This proof isn\'t available any more.')); return; }
    render(d);
  };
  openView = load;

  async function render({ proof, photos, reactions, comments, badges, people }) {
    const me = api.myId();
    const isOwner = proof.owner_id === me;
    const owner = people[proof.owner_id] || { display_name: 'Friend', mascot: 'bleep' };
    const friend = people[proof.friend_id] || { display_name: 'your friend', mascot: 'bleep' };
    const urls = {};
    await Promise.all(photos.map(async p => { try { urls[p.id] = await api.photoUrl(p.storage_path); } catch {} }));
    const before = photos.find(p => p.kind === 'before'), after = photos.find(p => p.kind === 'after');
    const useSlider = before && after && urls[before.id] && urls[after.id];
    const rest = useSlider ? photos.filter(p => p !== before && p !== after) : photos;
    const allDone = proof.progress.length && proof.progress.every(p => p.done);

    const statusPill = {
      pending: h('span', { class: 'pill wait' }, isOwner ? `WAITING FOR ${friend.display_name.toUpperCase()}` : 'WAITING FOR YOU'),
      clarify: h('span', { class: 'pill ask' }, isOwner ? `${friend.display_name.toUpperCase()} ASKED A QUESTION` : 'YOU ASKED A QUESTION'),
      verified: h('span', { class: 'pill ok' }, 'QUEST VERIFIED ✓'),
      withdrawn: h('span', { class: 'pill off' }, 'NO LONGER SHARED'),
      sending: h('span', { class: 'pill off' }, 'NOT SENT'),
    }[proof.status];

    put(clear(s.body), 
      h('div', { class: 'proof-meta' },
        h('div', { class: 'avatar' }, mascot(owner.mascot)),
        h('div', { class: 'grow' }, h('b', null, isOwner ? 'Your quest' : `${owner.display_name}'s quest`), h('div', { class: 'tiny' }, timeAgo(proof.sent_at || proof.created_at))),
        statusPill),
      h('div', { class: 'row' }, h('div', { class: 'quest-emoji' }, proof.quest_emoji), h('div', { class: 'quest-title grow' }, proof.quest_title)),
      useSlider ? h('div', { style: { marginTop: '12px' } }, compareSlider(urls[before.id], urls[after.id])) : null,
      rest.length ? h('div', { class: 'thumbs', style: { marginTop: '10px' } }, rest.map(p => urls[p.id]
        ? h('div', { style: { position: 'relative' } },
            h('img', { src: urls[p.id], alt: p.kind + ' photo', onclick: () => lightbox(urls[p.id]) }),
            isOwner ? h('button', { class: 'iconbtn', style: { position: 'absolute', top: '4px', right: '4px', width: '34px', height: '34px', background: '#000b' }, 'aria-label': 'Delete photo', onclick: () => delPhoto(p) }, '🗑️') : null)
        : h('div', { class: 'photo-slot' }, '🖼️'))) : null,
      isOwner && useSlider ? h('div', { class: 'row', style: { marginTop: '8px', gap: '8px' } },
        h('button', { class: 'btn sm ghost grow', onclick: () => delPhoto(before) }, '🗑️ Before'),
        h('button', { class: 'btn sm ghost grow', onclick: () => delPhoto(after) }, '🗑️ After')) : null,
      proof.caption ? h('div', { class: 'caption' }, '“' + proof.caption + '”') : null,
      proof.progress.length ? h('div', { class: 'card', style: { marginTop: '12px' } },
        h('div', { class: 'h2', style: { margin: '0 0 6px' } }, allDone ? 'ALL STEPS DONE! 🏆' : 'PROGRESS DETECTED! 🌱'),
        h('ul', { class: 'progress-list' }, proof.progress.map(p => h('li', null, (p.done ? '✅ ' : '⬜ ') + p.title)))) : null,
      badges.length ? h('div', { class: 'wrap', style: { margin: '10px 0' } }, badges.map(b => h('span', { class: 'chip' }, BADGES[b.badge_key].ico + ' ' + BADGES[b.badge_key].name))) : null,
      reactionRow(proof, reactions, me),
      actions(),
      h('div', { class: 'h2' }, 'MESSAGES 💬'),
      comments.length ? comments.map(c => h('div', { class: 'comment' + (c.kind === 'clarify' ? ' clarify' : '') },
        h('b', null, (people[c.author_id]?.display_name || 'Friend') + (c.kind === 'clarify' ? ' asked' : '')), ' ', h('span', { class: 'tiny' }, timeAgo(c.created_at)),
        h('div', null, c.body))) : h('p', { class: 'small' }, isOwner ? 'No messages yet.' : 'Be the first to cheer!'),
      composer(),
      isOwner ? h('button', { class: 'btn danger block', style: { marginTop: '24px' }, onclick: delProof }, '🗑️ Delete this submission & its photos') : null,
    );

    function actions() {
      if (!isOwner && (proof.status === 'pending' || proof.status === 'clarify')) {
        return h('div', { class: 'stack', style: { marginTop: '14px' } },
          h('button', { class: 'btn go block', onclick: () => approveSheet(proof, owner, load) }, '✅ APPROVE QUEST'),
          proof.status === 'pending' ? h('button', { class: 'btn ghost block', onclick: () => askSheet(proof, owner, load) }, '💬 Ask a friendly question') : null);
      }
      if (!isOwner && proof.status === 'verified') {
        return h('button', { class: 'btn gold block', style: { marginTop: '14px' }, onclick: () => badgeSheet(proof, badges, load) }, '🏅 Give a badge');
      }
      if (isOwner && proof.status === 'clarify') {
        return h('div', { class: 'card glow', style: { marginTop: '14px' } },
          h('p', { style: { marginTop: 0 } }, `${friend.display_name} has a question — no stress! Reply below, add a photo if you like, then send it back. You keep all your coins either way.`),
          h('div', { class: 'stack' },
            h('button', { class: 'btn block', onclick: () => addPhotoToSent(proof, load) }, '📸 Add a photo'),
            h('button', { class: 'btn primary block', onclick: async (e) => busy(e.currentTarget, async () => {
              try { await api.resend(proof.id); toast(`Sent back to ${friend.display_name} 🚀`); load(); loadSocial(); } catch (er) { oops(er); }
            }) }, `🚀 Send back to ${friend.display_name}`)));
      }
      return null;
    }

    function composer() {
      if (proof.status === 'withdrawn' || proof.status === 'sending') return null;
      const ta = h('textarea', { class: 'input', maxlength: 500, placeholder: isOwner ? 'Reply…' : 'Send some encouragement…', style: { minHeight: '64px' } });
      const send = h('button', { class: 'btn cyan block', style: { marginTop: '8px' } }, 'Send 💌');
      send.onclick = () => busy(send, async () => {
        const t = ta.value.trim(); if (!t) return;
        try { await api.comment(proof.id, t, isOwner ? 'reply' : 'cheer'); load(); } catch (e) { oops(e); }
      });
      return h('div', null,
        !isOwner ? h('div', { class: 'wrap', style: { margin: '6px 0' } }, CHEERS.map(c => h('button', { class: 'chip', onclick: () => { ta.value = c; } }, c))) : null,
        ta, send);
    }
    async function delPhoto(p) {
      if (!await confirmSheet({ title: 'DELETE PHOTO?', text: 'Delete this photo from the proof? Your friend won\'t be able to see it any more.', yes: 'Delete', danger: true })) return;
      try { await api.deletePhoto(p); toast('Photo deleted'); load(); } catch (e) { oops(e); }
    }
    async function delProof() {
      if (!await confirmSheet({ title: 'DELETE SUBMISSION?', text: 'This deletes the proof, its photos and messages for both of you. Your coins stay.', yes: 'Delete it', danger: true })) return;
      try { await api.deleteProof(proof.id); s.close(); toast('Deleted'); loadSocial(); } catch (e) { oops(e); }
    }
  }
  load();
}

function reactionRow(proof, reactions, me) {
  if (proof.status === 'withdrawn' || proof.status === 'sending') return null;
  const row = h('div', { class: 'reactions' });
  const draw = () => put(clear(row), ...REACTIONS.map(e => {
    const n = reactions.filter(r => r.emoji === e).length;
    const mine = reactions.some(r => r.emoji === e && r.user_id === me);
    return h('button', { 'aria-pressed': String(mine), 'aria-label': `React ${e}`, onclick: async () => {
      try {
        await api.react(proof.id, e, !mine);
        if (mine) reactions = reactions.filter(r => !(r.emoji === e && r.user_id === me));
        else reactions = [...reactions, { emoji: e, user_id: me }];
        draw();
      } catch (er) { oops(er); }
    } }, e, n ? h('small', null, n) : null);
  }));
  draw();
  return row;
}

function approveSheet(proof, owner, reload) {
  const s = sheet({ title: 'APPROVE QUEST ✅' });
  let bonus = 5, badge = null;
  const ta = h('textarea', { class: 'input', maxlength: 500, placeholder: 'Add a message (optional)' });
  const bonusRow = h('div', { class: 'wrap' }), badgeGrid = h('div', { class: 'badge-grid' });
  const draw = () => {
    put(clear(bonusRow), ...[0, 5, 10, 15, 25].map(n => h('button', { class: 'chip', 'aria-pressed': String(bonus === n), onclick: () => { bonus = n; draw(); } }, n ? `+${n} 🪙` : 'No bonus')));
    put(clear(badgeGrid), ...Object.entries(BADGES).map(([k, b]) => h('button', { class: 'badge', 'aria-pressed': String(badge === k), onclick: () => { badge = badge === k ? null : k; draw(); } }, h('span', { class: 'b-ico' }, b.ico), b.name)));
  };
  draw();
  const go = h('button', { class: 'btn go block', style: { marginTop: '16px' } }, '✅ VERIFY QUEST');
  go.onclick = () => busy(go, async () => {
    try {
      const r = await api.verify(proof.id, bonus, badge, ta.value.trim() || null);
      s.close(); reload(); loadSocial(); loadStats();
      await celebrate({ title: 'QUEST VERIFIED!', sub: `YOU CHEERED FOR ${owner.display_name.toUpperCase()}`,
        reward: `+2 🪙 cheerleader coins${r && r.bonus ? ` · gave +${r.bonus} 🪙` : ''}`, mascots: ['zap', owner.mascot] });
    } catch (e) { oops(e); }
  });
  put(s.body, 
    h('p', { class: 'lead' }, `Celebrate ${owner.display_name}! Everything here is optional.`),
    h('div', { class: 'field' }, h('label', null, 'Bonus coins (free to give — they don\'t come from your coins)'), bonusRow),
    h('div', { class: 'field' }, h('label', null, 'Award a badge'), badgeGrid),
    h('div', { class: 'field' }, h('label', null, 'Message'), h('div', { class: 'wrap', style: { marginBottom: '6px' } }, CHEERS.map(c => h('button', { class: 'chip', onclick: () => { ta.value = c; } }, c))), ta),
    go);
}

function askSheet(proof, owner, reload) {
  const s = sheet({ title: 'ASK A QUESTION 💬' });
  const ta = h('textarea', { class: 'input', maxlength: 500, placeholder: 'Keep it kind and curious 💖' });
  const go = h('button', { class: 'btn cyan block', style: { marginTop: '12px' } }, 'Send question');
  go.onclick = () => busy(go, async () => {
    if (!ta.value.trim()) { toast('Write a short note first ✏️'); return; }
    try { await api.clarify(proof.id, ta.value.trim()); s.close(); toast(`Asked ${owner.display_name} 💬`); reload(); loadSocial(); } catch (e) { oops(e); }
  });
  put(s.body, 
    h('div', { class: 'privacy-note' }, '💖', h('div', null, `Asking never removes coins and never marks the quest as failed — ${owner.display_name}'s quest already counts. It just opens a friendly chat.`)),
    h('div', { class: 'wrap', style: { margin: '8px 0' } }, ASKS.map(a => h('button', { class: 'chip', onclick: () => { ta.value = a; } }, a))),
    ta, go);
}

function badgeSheet(proof, existing, reload) {
  const s = sheet({ title: 'GIVE A BADGE 🏅' });
  const have = new Set(existing.map(b => b.badge_key));
  put(s.body, h('div', { class: 'badge-grid' }, Object.entries(BADGES).map(([k, b]) =>
    h('button', { class: 'badge' + (have.has(k) ? ' locked' : ''), disabled: have.has(k) || null, onclick: async () => {
      try { await api.giveBadge(proof.id, k); s.close(); toast(`${b.ico} ${b.name} badge given!`); reload(); } catch (e) { oops(e); }
    } }, h('span', { class: 'b-ico' }, b.ico), b.name))));
}

async function addPhotoToSent(proof, reload) {
  const s = sheet({ title: 'ADD A PHOTO' });
  const local = proof.quest_id ? await store.photosFor(proof.quest_id).catch(() => []) : [];
  const upload = async (rec) => {
    try {
      const out = await editPhoto(rec);  // chance to crop / hide first
      const final = out || rec;
      await api.addPhotoToProof(proof.id, { kind: 'extra', blob: final.blob, width: final.width, height: final.height });
      s.close(); toast('Photo added 📸'); reload();
    } catch (e) { oops(e); }
  };
  const fresh = async (cam) => {
    const f = await store.pickPhoto(cam); if (!f) return;
    try { const n = await store.normalise(f); upload({ id: crypto.randomUUID(), ...n }); } catch (e) { oops(e); }
  };
  put(s.body, 
    h('p', { class: 'small' }, 'You\'ll get a chance to crop or hide details before it\'s sent.'),
    local.length ? [h('div', { class: 'h2' }, 'FROM THIS QUEST'), h('div', { class: 'thumbs' }, local.map(r => h('img', { src: store.blobUrl(r), alt: r.kind, onclick: () => upload(r) })))] : null,
    h('div', { class: 'stack', style: { marginTop: '12px' } },
      h('button', { class: 'btn primary block', onclick: () => fresh(true) }, '📷 Take photo'),
      h('button', { class: 'btn block', onclick: () => fresh(false) }, '🖼️ Choose one photo')));
}
