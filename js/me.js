// ME tab: coins, badges, settings, privacy controls.
import * as api from './api.js';
import { S, loadSocial } from './state.js';
import { h, mascot, toast, oops, busy, confirmSheet, clear, put } from './ui.js';
import { MASCOTS, BADGES } from './mascots.js';
import * as store from './photo-store.js';

let root = null;
export function renderMe(main) {
  root = main;
  const p = S.profile, st = S.stats;
  const badgeBox = h('div', { class: 'badge-grid' });
  const blockedBox = h('div');
  const name = h('input', { class: 'input', value: p.display_name, maxlength: 30, autocomplete: 'nickname' });

  put(clear(main), 
    h('div', { class: 'hero', style: { marginTop: '10px' } }, mascot(p.mascot, 'cheer'),
      h('div', { class: 'grow' }, h('div', { class: 'h1', style: { margin: 0 } }, p.display_name), h('div', { class: 'small' }, MASCOTS[p.mascot].line))),
    h('div', { class: 'stat-grid', style: { marginTop: '12px' } },
      stat(st.coins, '🪙 total coins'), stat(st.coins_week, '⚡ this week'),
      stat(st.quests_done, '🏁 quests done'), stat(st.verified, '✅ verified by friends')),

    h('div', { class: 'h2' }, 'BADGE COLLECTION'), badgeBox,

    h('div', { class: 'h2' }, 'HOW COINS WORK'),
    h('div', { class: 'card small' },
      h('div', null, '✅ Each tiny step: +2'), h('div', null, '🏆 Finish a quest: +10'), h('div', null, '🌱 Did some of it: +5'),
      h('div', null, '📸 Share proof with a photo: +3 (optional)'), h('div', null, '💛 Friend bonus: up to +25'), h('div', null, '📣 Verify a friend\'s quest: +2'),
      h('p', { style: { margin: '8px 0 0' } }, 'Coins are never taken away — not for missed tasks, not for questions from friends. Ever.')),

    h('div', { class: 'h2' }, 'SETTINGS'),
    h('div', { class: 'card' },
      h('div', { class: 'field' }, h('label', null, 'Your name (what friends see)'),
        h('div', { class: 'row' }, name, h('button', { class: 'btn sm', onclick: e => busy(e.currentTarget, async () => {
          const v = name.value.trim(); if (!v) return;
          try { S.profile = await api.updateProfile({ display_name: v }); toast('Saved ✓'); renderMe(main); } catch (er) { oops(er); }
        }) }, 'Save'))),
      h('div', { class: 'field' }, h('label', null, 'Your mascot'),
        h('div', { class: 'mascot-pick' }, Object.entries(MASCOTS).map(([k, m]) => h('button', { 'aria-pressed': String(p.mascot === k), onclick: async () => {
          try { S.profile = await api.updateProfile({ mascot: k }); renderMe(main); } catch (er) { oops(er); }
        } }, mascot(k), m.name)))),
      toggle('Show the squad leaderboard', 'You can switch off comparing entirely.', 'leaderboard_enabled'),
      toggle('Show my score to friends', 'Friends won\'t see your weekly coins when off.', 'show_on_leaderboard')),

    h('div', { class: 'h2' }, 'PRIVACY & SAFETY 🛡️'),
    h('div', { class: 'card' },
      h('div', { class: 'small', style: { marginBottom: '10px' } }, 'Photos are private. Only the one friend you send a proof to can open its photos — never the public, never your whole library.'),
      h('b', null, 'Blocked people'), blockedBox,
      h('div', { class: 'stack', style: { marginTop: '14px' } },
        h('button', { class: 'btn block', onclick: async () => {
          const n = await store.countAll().catch(() => 0);
          if (!await confirmSheet({ title: 'CLEAR THIS PHONE?', text: `Delete ${n} quest photo(s) saved on this phone? Already-sent proofs aren't affected.`, yes: 'Delete', danger: true })) return;
          await store.clearAll(); toast('Photos on this phone deleted');
        } }, '📱 Delete photos saved on this phone'),
        h('button', { class: 'btn block danger', onclick: e => deleteAll(e.currentTarget) }, '☁️ Delete ALL my shared photos'),
        h('button', { class: 'btn block ghost', onclick: async () => {
          if (await confirmSheet({ title: 'SIGN OUT?', text: 'Your coins and quests are saved to your account.', yes: 'Sign out' })) { await api.signOut(); location.reload(); }
        } }, 'Sign out'))),
    h('p', { class: 'tiny', style: { textAlign: 'center', marginTop: '20px' } }, 'Brain Arcade · made with 💖 for brains that work differently'),
  );

  function stat(n, label) { return h('div', { class: 'stat' }, h('b', null, n ?? 0), h('span', null, label)); }
  function toggle(label, sub, key) {
    return h('label', { class: 'switch' }, h('div', null, h('b', null, label), h('div', { class: 'tiny' }, sub)),
      h('input', { type: 'checkbox', class: 'toggle', checked: p[key] || null, onchange: async e => {
        try { S.profile = await api.updateProfile({ [key]: e.target.checked }); toast('Saved ✓'); } catch (er) { e.target.checked = !e.target.checked; oops(er); }
      } }));
  }

  api.badgesReceived().then(list => {
    const counts = {}; list.forEach(b => { counts[b.badge_key] = (counts[b.badge_key] || 0) + 1; });
    put(clear(badgeBox), ...Object.entries(BADGES).map(([k, b]) => h('div', { class: 'badge' + (counts[k] ? '' : ' locked') },
      h('span', { class: 'b-ico' }, b.ico), b.name, counts[k] ? h('span', { class: 'n' }, '×' + counts[k]) : null)));
  }).catch(oops);
  drawBlocked();

  async function drawBlocked() {
    try {
      const list = await api.listBlocked();
      put(clear(blockedBox), list.length ? list.map(b => h('div', { class: 'row', style: { padding: '6px 0' } },
        h('span', { class: 'grow' }, b.blocked_name),
        h('button', { class: 'btn sm ghost', onclick: async () => {
          if (!await confirmSheet({ title: 'UNBLOCK?', text: `${b.blocked_name} could connect with you again if you share a new code. Nothing is reconnected automatically.`, yes: 'Unblock' })) return;
          try { await api.unblock(b.blocked_id); drawBlocked(); } catch (e) { oops(e); }
        } }, 'Unblock'))) : h('div', { class: 'tiny' }, 'Nobody. 🙂'));
    } catch (e) { oops(e); }
  }
}

async function deleteAll(btn) {
  if (!await confirmSheet({ title: 'DELETE ALL SHARED PHOTOS?', text: 'Every photo you have ever sent in a Quest Proof will be permanently deleted from the cloud. Captions, messages and coins stay.', yes: 'Delete everything', danger: true })) return;
  busy(btn, async () => {
    try { const n = await api.deleteAllMyPhotos(); toast(`Deleted ${n} photo${n === 1 ? '' : 's'} ✓`); loadSocial(); } catch (e) { oops(e); }
  });
}
export function rerenderMe() { if (root && root.isConnected && S.tab === 'me') renderMe(root); }
