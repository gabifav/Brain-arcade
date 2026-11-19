// QUESTS tab: tasks broken into mini-quests, coins for every bit of progress.
import * as api from './api.js';
import { S, loadQuests, loadStats } from './state.js';
import { h, mascot, sheet, toast, oops, busy, confirmSheet, celebrate, coinPop, buzz, clear, put } from './ui.js';
import { MASCOTS } from './mascots.js';
import * as store from './photo-store.js';
import { openProofWizard } from './proof.js';

const EMOJIS = ['🛏️', '🧺', '🍽️', '📚', '💼', '🧹', '🛁', '🌿', '💊', '📞', '✉️', '🐶', '🏃', '⭐'];
const TEMPLATES = [
  { title: 'Clean bedroom', emoji: '🛏️', steps: ['Pick up clothes', 'Clear the desk', 'Make the bed', 'Rubbish in the bin', 'Open a window'] },
  { title: 'Do the dishes', emoji: '🍽️', steps: ['Clear the sink', 'Wash 5 things', 'Wash the rest', 'Wipe the bench'] },
  { title: 'Laundry', emoji: '🧺', steps: ['Gather clothes', 'Start the wash', 'Hang or dry', 'Fold', 'Put away'] },
  { title: 'Study session', emoji: '📚', steps: ['Open the book or laptop', '10 focused minutes', 'Stretch break', '10 more minutes'] },
  { title: 'Life admin', emoji: '✉️', steps: ['Find the thing', 'Open the email or form', 'Fill it in', 'Send it'] },
  { title: 'Look after me', emoji: '🌿', steps: ['Drink some water', 'Shower', 'Fresh clothes', 'Something kind for me'] },
];
const PEP = [
  'Pick ONE tiny step. That\'s the whole job right now.',
  'Half-done still counts. Coins for every step!',
  'Messy progress is still progress.',
  'Start with the easiest bit — momentum is magic.',
  'You don\'t have to finish to earn coins today.',
];

const localPhotos = new Map(); // questId → [records]
async function photosOf(qid) {
  if (!localPhotos.has(qid)) localPhotos.set(qid, await store.photosFor(qid).catch(() => []));
  return localPhotos.get(qid);
}
export function invalidatePhotos(qid) { localPhotos.delete(qid); }

let root = null;
export function renderQuests(main) {
  root = main;
  const active = S.quests.filter(q => q.status === 'active');
  const done = S.quests.filter(q => q.status === 'done').slice(0, 12);
  const m = S.profile?.mascot || 'bleep';

  put(clear(main), 
    h('div', { class: 'hero' }, mascot(m, active.length ? 'happy' : 'think'),
      h('div', { class: 'speech grow' }, active.length ? PEP[new Date().getDate() % PEP.length] : MASCOTS[m].line)),
    h('button', { class: 'btn primary block', style: { margin: '12px 0 4px' }, onclick: newQuestSheet }, '＋  NEW QUEST'),
    h('div', { class: 'h2' }, 'ACTIVE QUESTS', active.length ? h('span', { class: 'count' }, active.length) : null),
    !S.loaded.quests ? h('div', { class: 'empty' }, 'Loading…')
      : active.length ? active.map(questCard)
      : h('div', { class: 'empty' }, mascot('coinny', 'happy'), h('div', null, 'No quests yet. Make a tiny one — even "drink water" counts!')),
    done.length ? [h('div', { class: 'h2' }, 'RECENTLY DONE 🏁'), h('div', { class: 'done-list' }, done.map(doneCard))] : null,
  );
}
function rerender() { if (root && root.isConnected && S.tab === 'quests') renderQuests(root); }

function questCard(q) {
  const total = q.minis.length, ticked = q.minis.filter(x => x.done).length;
  const pct = total ? Math.round(ticked / total * 100) : 0;
  const photoRow = h('div');
  photosOf(q.id).then(ps => {
    const before = ps.find(p => p.kind === 'before');
    put(clear(photoRow), before
      ? h('div', { class: 'row', style: { marginTop: '12px' } },
          h('img', { class: 'before-thumb', src: store.blobUrl(before), alt: 'Before photo' }),
          h('div', { class: 'small grow' }, '📸 Before photo saved', h('br'), h('span', { class: 'tiny' }, '🔒 Only on this phone')))
      : h('button', { class: 'btn sm ghost block', style: { marginTop: '12px' }, onclick: () => beforePhotoSheet(q) }, '📸 Snap a before photo (optional)'));
  });

  const input = h('input', { class: 'input', placeholder: 'Add a tiny step…', maxlength: 80, enterkeyhint: 'done' });
  const addStep = async () => {
    const t = input.value.trim(); if (!t) return;
    input.value = '';
    try { q.minis.push(await api.addMini(q.id, t, total)); rerender(); }
    catch (e) { oops(e); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } });

  return h('div', { class: 'card' + (total && ticked === total ? ' glow' : '') },
    h('div', { class: 'quest-head' },
      h('div', { class: 'quest-emoji' }, q.emoji),
      h('div', { class: 'grow' },
        h('div', { class: 'quest-title' }, q.title),
        total ? [h('div', { class: 'small' }, `${ticked}/${total} steps · +2 🪙 each`), h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } }))]
              : h('div', { class: 'small' }, 'Add tiny steps to earn coins as you go')),
      h('button', { class: 'iconbtn', 'aria-label': 'Quest options', onclick: () => questMenu(q) }, '⋯')),
    total ? h('ul', { class: 'minis' }, q.minis.map(mi => miniRow(q, mi))) : null,
    h('div', { class: 'add-mini' }, input, h('button', { class: 'btn sm', onclick: addStep, 'aria-label': 'Add step' }, '＋')),
    photoRow,
    h('div', { class: 'quest-actions' },
      h('button', { class: 'btn go', onclick: () => finishSheet(q) }, ticked === total && total ? "🎉 I'M DONE!" : "✅ I'M DONE")),
  );
}

function miniRow(q, mi) {
  const li = h('li', { class: 'mini' + (mi.done ? ' done' : '') });
  const btn = h('button', { class: 'check', role: 'checkbox', 'aria-checked': String(mi.done), 'aria-label': mi.title }, mi.done ? '✓' : '');
  btn.addEventListener('click', async () => {
    const next = !mi.done; mi.done = next; buzz(10);
    li.classList.toggle('done', next); btn.textContent = next ? '✓' : ''; btn.setAttribute('aria-checked', String(next));
    try {
      const coins = await api.setMini(mi.id, next);
      if (coins) { coinPop(coins, btn); loadStats(); }
      if (next && q.minis.every(x => x.done)) toast('All steps done! Tap I\'M DONE to claim your quest 🎉');
      rerender();
    } catch (e) { mi.done = !next; rerender(); oops(e); }
  });
  li.append(btn, h('span', { class: 'mini-t' }, mi.title),
    h('button', { class: 'iconbtn mini-x', 'aria-label': 'Remove step ' + mi.title, onclick: async () => {
      try { await api.deleteMini(mi.id); q.minis = q.minis.filter(x => x !== mi); rerender(); } catch (e) { oops(e); }
    } }, '✕'));
  return li;
}

function doneCard(q) {
  const shared = S.sent.filter(p => p.quest_id === q.id && p.status !== 'withdrawn');
  return h('div', { class: 'card' },
    h('div', { class: 'quest-head' },
      h('div', { class: 'quest-emoji' }, q.emoji),
      h('div', { class: 'grow' },
        h('div', { class: 'quest-title' }, q.title),
        h('div', { class: 'wrap', style: { marginTop: '4px' } },
          h('span', { class: 'pill ok' }, q.outcome === 'partial' ? 'PROGRESS MADE 🌱' : 'FINISHED 🏆'),
          shared.map(p => h('span', { class: 'pill ' + (p.status === 'verified' ? 'ok' : 'wait') },
            p.status === 'verified' ? `✓ ${p.friend.display_name}` : `→ ${p.friend.display_name}`))))),
    h('div', { class: 'quest-actions' },
      h('button', { class: 'btn sm cyan', onclick: () => openProofWizard(q) }, '📸 Share proof'),
      h('button', { class: 'btn sm ghost', onclick: () => questMenu(q) }, '⋯ More')));
}

// ── new quest
function newQuestSheet() {
  const s = sheet({ title: 'NEW QUEST' });
  let emoji = '⭐'; let steps = [];
  const title = h('input', { class: 'input', placeholder: 'e.g. Clean bedroom', maxlength: 120, autocomplete: 'off' });
  const emojiRow = h('div', { class: 'wrap' });
  const stepList = h('div', { class: 'stack' });
  const stepIn = h('input', { class: 'input', placeholder: 'Add a tiny step…', maxlength: 80, enterkeyhint: 'enter' });
  const drawEmoji = () => put(clear(emojiRow), ...EMOJIS.map(e =>
    h('button', { class: 'chip', 'aria-pressed': String(e === emoji), onclick: () => { emoji = e; drawEmoji(); } }, e)));
  const drawSteps = () => put(clear(stepList), ...steps.map((t, i) =>
    h('div', { class: 'row' }, h('span', { class: 'grow' }, `${i + 1}. ${t}`),
      h('button', { class: 'iconbtn', 'aria-label': 'Remove ' + t, onclick: () => { steps.splice(i, 1); drawSteps(); } }, '✕'))));
  const addStep = () => { const t = stepIn.value.trim(); if (t && steps.length < 20) { steps.push(t); stepIn.value = ''; drawSteps(); } stepIn.focus(); };
  stepIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } });
  drawEmoji(); drawSteps();

  const create = h('button', { class: 'btn primary block' }, "LET'S GO! 🚀");
  create.addEventListener('click', () => busy(create, async () => {
    if (stepIn.value.trim()) addStep();
    const t = title.value.trim();
    if (!t) { toast('Give your quest a name first ✏️'); title.focus(); return; }
    try {
      const q = await api.createQuest({ title: t, emoji, minis: steps });
      S.quests.unshift(q); s.close(); rerender();
      beforePhotoSheet(q, true);
    } catch (e) { oops(e); }
  }));

  put(s.body, 
    h('div', { class: 'small', style: { marginBottom: '8px' } }, 'Quick start:'),
    h('div', { class: 'wrap', style: { marginBottom: '14px' } }, TEMPLATES.map(tp =>
      h('button', { class: 'chip', onclick: () => { title.value = tp.title; emoji = tp.emoji; steps = [...tp.steps]; drawEmoji(); drawSteps(); } }, tp.emoji + ' ' + tp.title))),
    h('div', { class: 'field' }, h('label', null, 'Quest name'), title),
    h('div', { class: 'field' }, h('label', null, 'Pick an icon'), emojiRow),
    h('div', { class: 'field' }, h('label', null, 'Tiny steps (each one = +2 🪙)'), stepList, h('div', { class: 'add-mini' }, stepIn, h('button', { class: 'btn sm', onclick: addStep }, '＋'))),
    create);
  setTimeout(() => title.focus(), 300);
}

// ── before photo (optional, stays local)
function beforePhotoSheet(q, afterCreate = false) {
  const s = sheet({ title: afterCreate ? 'BEFORE PHOTO?' : 'BEFORE PHOTO' });
  const take = async (cam) => {
    const file = await store.pickPhoto(cam);
    if (!file) return;
    try {
      const n = await store.normalise(file);
      await store.savePhoto({ id: crypto.randomUUID(), questId: q.id, kind: 'before', ...n, createdAt: Date.now() });
      invalidatePhotos(q.id); s.close(); toast('Before photo saved on this phone 📸'); rerender();
    } catch (e) { oops(e); }
  };
  put(s.body, 
    h('div', { class: 'hero' }, mascot('bleep', 'happy'), h('div', { class: 'speech grow' }, 'A before photo makes the glow-up extra satisfying! Totally optional.')),
    h('div', { class: 'privacy-note' }, '🔒', h('div', null, 'Photos stay on this phone. Nothing is shared unless you pick it later and choose a friend.')),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: () => take(true) }, '📷 Take photo'),
      h('button', { class: 'btn block', onclick: () => take(false) }, '🖼️ Choose one photo'),
      h('button', { class: 'btn ghost block', onclick: () => s.close() }, afterCreate ? 'Skip — just start' : 'Not now')));
}

// ── finishing (full OR partial — both rewarded, no friend needed)
function finishSheet(q) {
  const s = sheet({ title: 'HOW DID IT GO?' });
  const go = (outcome, btn) => busy(btn, async () => {
    try {
      const coins = await api.completeQuest(q.id, outcome);
      s.close();
      q.status = 'done'; q.outcome = outcome; q.completed_at = new Date().toISOString();
      rerender(); loadStats();
      await celebrate({
        title: outcome === 'full' ? 'QUEST COMPLETE!' : 'PROGRESS DETECTED!',
        sub: outcome === 'full' ? 'YOU ABSOLUTE LEGEND' : 'EVERY STEP COUNTS',
        reward: coins ? `+${coins} 🪙` : 'Coins already claimed today — still proud of you!',
        mascots: [S.profile?.mascot || 'bleep', 'coinny'], button: 'NICE!',
      });
      shareNudge(q);
    } catch (e) { oops(e); }
  });
  const full = h('button', { class: 'btn gold block' }, '🏆 I finished it!  +10 🪙');
  const part = h('button', { class: 'btn cyan block' }, '🌱 I did some of it!  +5 🪙');
  full.onclick = () => go('full', full); part.onclick = () => go('partial', part);
  put(s.body, 
    h('p', { class: 'lead' }, 'Both answers earn coins. Partial progress is real progress.'),
    h('div', { class: 'stack' }, full, part, h('button', { class: 'btn ghost block', onclick: () => s.close() }, 'Keep going')));
}

function shareNudge(q) {
  const s = sheet({ title: 'SHOW A FRIEND?' });
  put(s.body, 
    h('div', { class: 'hero' }, mascot('pip', 'happy'), h('div', { class: 'speech grow' }, 'Want to show a trusted friend? Totally optional — your quest already counts!')),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: () => { s.close(); openProofWizard(q); } }, '📸 Share Quest Proof  (+3 🪙 with a photo)'),
      h('button', { class: 'btn ghost block', onclick: () => s.close() }, 'Not now')));
}

function questMenu(q) {
  const s = sheet({ title: q.emoji + ' ' + q.title.slice(0, 24) });
  put(s.body, h('div', { class: 'stack' },
    q.status === 'done'
      ? h('button', { class: 'btn block', onclick: async () => { try { await api.reopenQuest(q.id); q.status = 'active'; s.close(); rerender(); toast('Back on the board — coins kept 🪙'); } catch (e) { oops(e); } } }, '↺ Put back on the board')
      : h('button', { class: 'btn block', onclick: () => { s.close(); openProofWizard(q); } }, '📸 Share progress proof now'),
    h('button', { class: 'btn block', onclick: () => { s.close(); beforePhotoSheet(q); } }, '📸 Add / replace before photo'),
    h('button', { class: 'btn block ghost', onclick: async () => {
      const ps = await photosOf(q.id);
      if (!ps.length) { toast('No photos on this phone for this quest'); return; }
      if (await confirmSheet({ title: 'DELETE PHOTOS?', text: `Delete ${ps.length} photo(s) saved on this phone for this quest? Photos you already shared stay with that proof (you can delete them in Friends → Sent).`, yes: 'Delete from phone', danger: true })) {
        await store.deletePhotosFor(q.id); ps.forEach(p => store.forgetUrl(p.id)); invalidatePhotos(q.id); s.close(); rerender(); toast('Deleted from this phone');
      }
    } }, '🗑️ Delete photos on this phone'),
    h('button', { class: 'btn block danger', onclick: async () => {
      if (await confirmSheet({ title: 'DELETE QUEST?', text: 'This removes the quest and its photos on this phone. You keep every coin you earned.', yes: 'Delete quest', danger: true })) {
        try { await api.deleteQuest(q.id); await store.deletePhotosFor(q.id); invalidatePhotos(q.id); S.quests = S.quests.filter(x => x.id !== q.id); s.close(); rerender(); }
        catch (e) { oops(e); }
      }
    } }, 'Delete quest')));
}

export async function refreshQuests() { try { await loadQuests(); rerender(); } catch (e) { oops(e); } }
