// FRIENDS tab: the Accountability Dashboard.
import * as api from './api.js';
import { S, loadSocial, pendingCount } from './state.js';
import { h, mascot, sheet, toast, oops, busy, confirmSheet, celebrate, timeAgo, clear, put } from './ui.js';
import { BADGES } from './mascots.js';
import { openProofView } from './proof.js';
import { APP_URL } from './config.js';

let root = null;
export function renderFriends(main) {
  root = main;
  const pending = S.inbox.filter(p => p.status === 'pending' || p.status === 'clarify');
  const sentOpen = S.sent.filter(p => p.status !== 'withdrawn' && p.status !== 'sending').slice(0, 8);
  const approved = S.sent.filter(p => p.status === 'verified');
  const cheersBox = h('div', null, h('div', { class: 'small' }, 'Loading…'));
  const achBox = h('div', null);
  const chalBox = h('div', null);
  const boardBox = h('div', null);

  put(clear(main), 
    h('div', { class: 'row between' },
      h('div', { class: 'h1' }, 'FRIENDS 💛'),
      h('button', { class: 'btn sm primary', onclick: () => inviteSheet() }, '＋ Invite')),

    !S.loaded.social ? h('div', { class: 'empty' }, 'Loading…') : null,

    S.loaded.social && !S.friends.length ? h('div', { class: 'card glow' },
      h('div', { class: 'hero' }, mascot('pip', 'happy'),
        h('div', { class: 'grow' }, h('b', null, 'Team up with a trusted friend!'),
          h('div', { class: 'small' }, 'Share wins, get cheered on, and cheer them back. Invite codes only connect the two of you.'))),
      h('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } },
        h('button', { class: 'btn primary grow', onclick: () => inviteSheet() }, 'Get my code'),
        h('button', { class: 'btn grow', onclick: () => inviteSheet(true) }, 'I have a code'))) : null,

    h('div', { class: 'h2' }, 'PROOF REQUESTS', pending.length ? h('span', { class: 'count' }, pending.length) : null),
    pending.length ? pending.map(p => proofCard(p, 'in'))
      : h('div', { class: 'empty' }, 'No proofs waiting. Your friends\' wins will pop up here! 🎉'),

    sentOpen.length ? [h('div', { class: 'h2' }, 'YOUR SUBMISSIONS'), sentOpen.map(p => proofCard(p, 'out'))] : null,

    h('div', { class: 'h2' }, 'ENCOURAGING MESSAGES 💌'), cheersBox,

    approved.length ? [h('div', { class: 'h2' }, 'APPROVED QUESTS ✓', h('span', { class: 'count' }, approved.length)),
      h('div', { class: 'card' }, approved.slice(0, 8).map(p => h('div', { class: 'row', style: { padding: '6px 0', cursor: 'pointer' }, onclick: () => openProofView(p.id) },
        h('span', { style: { fontSize: '22px' } }, p.quest_emoji), h('span', { class: 'grow ellipsis' }, p.quest_title),
        h('span', { class: 'tiny' }, `✓ ${p.friend.display_name}`))))] : null,

    h('div', { class: 'h2' }, 'SHARED ACHIEVEMENTS 🏅'), achBox,
    h('div', { class: 'h2' }, 'SHARED CHALLENGES 🤝'), chalBox,
    S.profile?.leaderboard_enabled ? [h('div', { class: 'h2' }, 'SQUAD ENERGY · THIS WEEK ⚡'), boardBox] : null,

    h('div', { class: 'h2' }, 'YOUR SQUAD', S.friends.length ? h('span', { class: 'count' }, S.friends.length) : null),
    S.friends.length ? h('div', { class: 'card' }, S.friends.map(f => h('div', { class: 'row', style: { padding: '6px 0' } },
      h('div', { class: 'avatar' }, mascot(f.mascot)),
      h('div', { class: 'grow' }, h('b', null, f.display_name), h('div', { class: 'tiny' }, 'friends since ' + new Date(f.since).toLocaleDateString())),
      h('button', { class: 'iconbtn', 'aria-label': 'Options for ' + f.display_name, onclick: () => friendMenu(f) }, '⋯'))))
      : h('p', { class: 'small' }, 'Nobody yet — tap ＋ Invite.'),
    h('button', { class: 'btn ghost block', style: { marginTop: '8px' }, onclick: () => inviteSheet(true) }, '🔑 Enter a friend\'s code'),
  );

  if (!S.loaded.social) return;
  loadCheers(cheersBox); loadAchievements(achBox); loadChallenges(chalBox);
  if (S.profile?.leaderboard_enabled) loadBoard(boardBox);
}
export function rerenderFriends() { if (root && root.isConnected && S.tab === 'friends') renderFriends(root); }

function proofCard(p, dir) {
  const person = dir === 'in' ? p.owner : p.friend;
  const label = dir === 'in'
    ? { pending: h('span', { class: 'pill wait' }, 'NEEDS YOUR ✓'), clarify: h('span', { class: 'pill ask' }, 'YOU ASKED'), verified: h('span', { class: 'pill ok' }, 'VERIFIED') }[p.status]
    : { pending: h('span', { class: 'pill wait' }, 'WAITING'), clarify: h('span', { class: 'pill ask' }, 'QUESTION 💬'), verified: h('span', { class: 'pill ok' }, 'VERIFIED ✓') }[p.status];
  return h('div', { class: 'card tap' + (dir === 'in' && p.status === 'pending' || dir === 'out' && p.status === 'clarify' ? ' glow' : ''), role: 'button', tabindex: 0, onclick: () => openProofView(p.id) },
    h('div', { class: 'row' },
      h('div', { class: 'quest-emoji' }, p.quest_emoji),
      h('div', { class: 'grow' },
        h('div', { class: 'quest-title ellipsis' }, p.quest_title),
        h('div', { class: 'small' }, dir === 'in' ? `from ${person.display_name}` : `to ${person.display_name}`, ' · ', timeAgo(p.sent_at || p.created_at))),
      label));
}

async function loadCheers(box) {
  try {
    const mine = S.sent.map(p => p.id);
    const cheers = await api.cheersReceived(mine);
    const byProof = Object.fromEntries(S.sent.map(p => [p.id, p]));
    put(clear(box), cheers.length
      ? h('div', { class: 'stack' }, cheers.slice(0, 6).map(c => h('div', { class: 'comment' + (c.kind === 'clarify' ? ' clarify' : ''), style: { cursor: 'pointer' }, onclick: () => openProofView(c.proof_id) },
          h('b', null, c.author?.display_name || 'A friend'), ' ', h('span', { class: 'tiny' }, `on ${byProof[c.proof_id]?.quest_title || 'your quest'} · ${timeAgo(c.created_at)}`),
          h('div', null, c.body))))
      : h('div', { class: 'empty' }, 'Cheers from friends will collect here 💌'));
  } catch (e) { clear(box); oops(e); }
}

async function loadAchievements(box) {
  try {
    const badges = await api.badgesReceived();
    const cheered = S.inbox.filter(p => p.status === 'verified');
    if (!badges.length && !cheered.length) { put(clear(box), h('div', { class: 'empty' }, 'Badges and wins you share with friends show up here 🏅')); return; }
    put(clear(box), h('div', { class: 'card' },
      badges.slice(0, 6).map(b => h('div', { class: 'row', style: { padding: '6px 0' } },
        h('span', { style: { fontSize: '26px' } }, BADGES[b.badge_key].ico),
        h('div', { class: 'grow' }, h('b', null, BADGES[b.badge_key].name), h('div', { class: 'tiny' }, `from ${b.from?.display_name || 'a friend'} · ${timeAgo(b.created_at)}`)))),
      cheered.slice(0, 6).map(p => h('div', { class: 'row', style: { padding: '6px 0', cursor: 'pointer' }, onclick: () => openProofView(p.id) },
        h('span', { style: { fontSize: '26px' } }, '📣'),
        h('div', { class: 'grow' }, h('b', null, `You verified ${p.owner.display_name}'s quest`), h('div', { class: 'tiny ellipsis' }, `${p.quest_emoji} ${p.quest_title}`))))));
  } catch (e) { clear(box); oops(e); }
}

async function loadChallenges(box) {
  try {
    const list = await api.challenges();
    put(clear(box), 
      list.length ? list.map(challengeCard) : h('div', { class: 'empty' }, 'Team up on a goal together — totally optional!'),
      S.friends.length ? h('button', { class: 'btn block', onclick: challengeSheet }, '＋ Start a team challenge') : null);
  } catch (e) { clear(box); oops(e); }
}
function challengeCard(c) {
  const joined = c.members.filter(m => m.status === 'joined');
  const total = joined.reduce((a, m) => a + m.done, 0);
  const pct = Math.min(100, Math.round(total / c.goal * 100));
  const ended = new Date(c.ends_at) < new Date();
  const daysLeft = Math.max(0, Math.ceil((new Date(c.ends_at) - Date.now()) / 86400000));
  return h('div', { class: 'card' + (c.my_status === 'invited' ? ' glow' : '') },
    h('div', { class: 'row between' }, h('b', null, c.title), h('span', { class: 'pill ' + (ended ? 'off' : 'wait') }, ended ? 'ENDED' : `${daysLeft}d left`)),
    h('div', { class: 'small', style: { marginTop: '4px' } }, `Team goal: ${total} / ${c.goal} quests ${total >= c.goal ? '🎉 SMASHED IT!' : ''}`),
    h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })),
    h('div', { class: 'wrap', style: { marginTop: '10px' } }, c.members.map(m => h('span', { class: 'chip' },
      m.display_name, ' ', m.status === 'joined' ? `· ${m.done}` : '· invited'))),
    c.my_status === 'invited' ? h('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } },
      h('button', { class: 'btn sm go grow', onclick: () => respond(c, true) }, 'Join! 🤝'),
      h('button', { class: 'btn sm ghost grow', onclick: () => respond(c, false) }, 'No thanks'))
      : h('button', { class: 'btn sm ghost', style: { marginTop: '10px' }, onclick: () => respond(c, false, true) }, 'Leave challenge'));
}
async function respond(c, join, confirmLeave) {
  if (confirmLeave && !await confirmSheet({ title: 'LEAVE CHALLENGE?', text: 'No worries at all — you can always start a new one.', yes: 'Leave' })) return;
  try { await api.respondChallenge(c.id, join); toast(join ? 'You joined! 🤝' : 'Done'); rerenderFriends(); } catch (e) { oops(e); }
}
function challengeSheet() {
  const s = sheet({ title: 'TEAM CHALLENGE 🤝' });
  let title = 'Tidy-up week 🧹', goal = 10, days = 7; const chosen = new Set(S.friends.length === 1 ? [S.friends[0].id] : []);
  const body = h('div'); let goalLbl;
  const draw = () => put(clear(body), 
    h('div', { class: 'field' }, h('label', null, 'Name'),
      h('div', { class: 'wrap', style: { marginBottom: '6px' } }, ['Tidy-up week 🧹', 'Homework heroes 📚', 'Self-care squad 🌿', 'Admin attack ✉️'].map(t =>
        h('button', { class: 'chip', 'aria-pressed': String(title === t), onclick: () => { title = t; draw(); } }, t))),
      h('input', { class: 'input', value: title, maxlength: 60, oninput: e => { title = e.target.value; } })),
    h('div', { class: 'field' }, goalLbl = h('label', null, `Team goal: ${goal} quests together`),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { goal = Math.max(1, goal - 1); draw(); } }, '−'),
        h('input', { type: 'range', min: 1, max: 50, value: goal, class: 'grow', oninput: e => { goal = +e.target.value; goalLbl.textContent = `Team goal: ${goal} quests together`; } }),
        h('button', { class: 'btn sm', onclick: () => { goal = Math.min(50, goal + 1); draw(); } }, '＋'))),
    h('div', { class: 'field' }, h('label', null, 'How long?'),
      h('div', { class: 'wrap' }, [3, 7, 14, 30].map(d => h('button', { class: 'chip', 'aria-pressed': String(days === d), onclick: () => { days = d; draw(); } }, `${d} days`)))),
    h('div', { class: 'field' }, h('label', null, 'Who\'s in?'),
      h('div', { class: 'radio-list' }, S.friends.map(f => h('button', { 'aria-pressed': String(chosen.has(f.id)), onclick: () => { chosen.has(f.id) ? chosen.delete(f.id) : chosen.add(f.id); draw(); } },
        h('div', { class: 'avatar' }, mascot(f.mascot)), h('span', { class: 'grow' }, f.display_name), chosen.has(f.id) ? '✓' : '')))),
    h('p', { class: 'small' }, 'Everyone\'s finished quests (full or partial) add up toward ONE team goal. No losers.'),
    h('button', { class: 'btn primary block', disabled: !chosen.size || !title.trim() || null, onclick: (e) => busy(e.currentTarget, async () => {
      try { await api.createChallenge(title.trim(), goal, days, [...chosen]); s.close(); toast('Challenge started! 🤝'); rerenderFriends(); } catch (er) { oops(er); }
    }) }, 'Start challenge'));
  draw(); put(s.body, body);
}

async function loadBoard(box) {
  try {
    const rows = await api.leaderboard();
    const max = Math.max(1, ...rows.map(r => Number(r.coins_week)));
    put(clear(box), h('div', { class: 'card' },
      rows.map(r => h('div', { class: 'lb-row' },
        h('div', { class: 'avatar', style: { width: '36px', height: '36px' } }, mascot(r.mascot)),
        h('div', { class: 'nm ellipsis' }, r.is_me ? 'You' : r.display_name),
        h('div', { class: 'bar' }, h('i', { style: { width: Math.max(4, Number(r.coins_week) / max * 100) + '%' } })),
        h('div', { class: 'n' }, Number(r.coins_week)))),
      h('p', { class: 'tiny', style: { margin: '8px 0 0' } }, 'Everyone who shows up is winning. Turn this off any time in Me → Settings.')));
  } catch (e) { clear(box); oops(e); }
}

// ── invites
export function inviteSheet(enterMode = false, prefill = '') {
  const s = sheet({ title: enterMode ? 'ENTER A CODE 🔑' : 'INVITE A FRIEND 💛' });
  const codeBox = h('div', { class: 'invite-code' }, '········');
  const inp = h('input', { class: 'input code-input', placeholder: 'ABCD-2345', maxlength: 12, autocapitalize: 'characters', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', value: prefill || null });
  const connect = h('button', { class: 'btn go block', style: { marginTop: '10px' } }, 'Connect 🤝');
  connect.onclick = () => busy(connect, async () => {
    if (!inp.value.trim()) { toast('Type the code first'); return; }
    try {
      const r = await api.acceptInvite(inp.value);
      if (!r.ok) { toast(r.message, 'warn'); return; }
      s.close(); await loadSocial(); rerenderFriends();
      celebrate({ title: 'SQUAD UP!', sub: `YOU + ${String(r.display_name).toUpperCase()}`, reward: 'You can now share Quest Proof with each other 💛', mascots: ['pip', 'bleep'] });
    } catch (e) { oops(e); }
  });

  if (!enterMode) {
    put(s.body, 
      h('p', { class: 'lead' }, 'Send this code to ONE trusted friend. It works once and expires in 7 days.'),
      codeBox,
      h('div', { class: 'row', style: { gap: '8px' } },
        h('button', { class: 'btn primary grow', onclick: share }, '📤 Share'),
        h('button', { class: 'btn grow', onclick: copy }, '📋 Copy')),
      h('div', { class: 'privacy-note' }, '🔐', h('div', null, 'The code only lets someone who is signed in connect with you. It never opens your photos or quests by itself — you choose what to send, one proof at a time.')),
      h('div', { class: 'h2' }, 'GOT A CODE FROM THEM?'));
  }
  put(s.body, inp, connect);

  let code = '';
  if (!enterMode) api.createInvite().then(r => { code = r.code; codeBox.textContent = fmt(code); }).catch(e => { codeBox.textContent = '—'; oops(e); });
  else setTimeout(() => inp.focus(), 300);

  async function share() {
    if (!code) return;
    const url = (APP_URL || location.origin + location.pathname) + '?invite=' + code;
    const text = `Be my Brain Arcade quest buddy! 🕹️ My friend code: ${fmt(code)}\n${url}`;
    try { if (navigator.share) await navigator.share({ title: 'Brain Arcade', text }); else { await navigator.clipboard.writeText(text); toast('Copied! Paste it to your friend 💛'); } } catch {}
  }
  async function copy() { if (code) { try { await navigator.clipboard.writeText(fmt(code)); toast('Code copied 📋'); } catch { toast(fmt(code)); } } }
}
const fmt = c => c ? c.slice(0, 4) + '-' + c.slice(4) : '';

function friendMenu(f) {
  const s = sheet({ title: f.display_name });
  put(s.body, h('div', { class: 'stack' },
    h('button', { class: 'btn block', onclick: async () => {
      if (!await confirmSheet({ title: 'DISCONNECT?', text: `${f.display_name} will lose access to every proof you've sent them (and you to theirs). You can reconnect later with a new code.`, yes: 'Disconnect' })) return;
      try { await api.disconnect(f.id); s.close(); toast('Disconnected'); await loadSocial(); rerenderFriends(); } catch (e) { oops(e); }
    } }, '👋 Disconnect'),
    h('button', { class: 'btn block danger', onclick: async () => {
      if (!await confirmSheet({ title: 'BLOCK?', text: `${f.display_name} will be disconnected, lose access to everything you've shared, and won't be able to connect with you again unless you unblock them (Me → Settings).`, yes: 'Block', danger: true })) return;
      try { await api.block(f.id); s.close(); toast('Blocked'); await loadSocial(); rerenderFriends(); } catch (e) { oops(e); }
    } }, '🚫 Block'),
    h('button', { class: 'btn ghost block', onclick: () => s.close() }, 'Cancel')));
}

export { pendingCount };
