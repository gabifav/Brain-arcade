// BRAIN ARCADE — app entry: auth → shell → tabs, live sync, celebrations.
import * as api from './api.js';
import { S, onChange, loadStats, loadQuests, loadSocial, pendingCount } from './state.js';
import { h, $, oops, toast, celebrate, closeAllSheets, clear, put } from './ui.js';
import { coinSVG, BADGES } from './mascots.js';
import { renderSetup, renderSignIn, renderOnboarding } from './auth.js';
import { renderQuests } from './quests.js';
import { renderFriends, rerenderFriends, inviteSheet } from './friends.js';
import { renderMe, rerenderMe } from './me.js';
import { refreshOpenProof } from './proof.js';

const app = $('#app');

// Remember an invite link (…?invite=CODE) until after sign-in. It only pre-fills
// the code box — connecting still needs you to be signed in and tap Connect.
const params = new URLSearchParams(location.search);
if (params.get('invite')) {
  sessionStorage.setItem('ba-invite', params.get('invite').replace(/[^A-Za-z0-9-]/g, '').slice(0, 12));
  history.replaceState(null, '', location.pathname);
}

async function boot() {
  if (!api.configured) return renderSetup(app);
  try {
    const session = await api.getSession();
    if (!session) return renderSignIn(app, () => start());
    await start();
  } catch (e) { oops(e); renderSignIn(app, () => start()); }
}

async function start() {
  S.profile = await api.getProfile();
  if (S.profile.display_name === 'Player' && !localStorage.getItem('ba-onboarded-' + S.profile.id)) {
    return renderOnboarding(app, S.profile, p => { S.profile = p; localStorage.setItem('ba-onboarded-' + p.id, '1'); start(); });
  }
  renderShell();
  api.onAuth(session => { if (!session) location.reload(); });
  await Promise.all([loadStats(), loadQuests(), loadSocial()]).catch(oops);
  api.subscribe(onLive);
  checkCelebrations();
  const inv = sessionStorage.getItem('ba-invite');
  if (inv) { sessionStorage.removeItem('ba-invite'); setTab('friends'); inviteSheet(true, inv); }
}

function renderShell() {
  const main = h('main', { id: 'view' });
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' },
    navBtn('quests', '🕹️', 'Quests'), navBtn('friends', '💛', 'Friends'), navBtn('me', '🏆', 'Me'));
  const coins = h('div', { class: 'coins', 'aria-label': 'Coins' }); coins.innerHTML = coinSVG();
  coins.append(h('span', { id: 'coin-count' }, S.stats.coins));
  put(clear(app), h('div', { class: 'shell' },
    h('header', { class: 'topbar' }, h('div', { class: 'brand' }, 'BRAIN', h('br'), 'ARCADE'), coins),
    main), nav);
  setTab(S.tab);
}
function navBtn(tab, ico, label) {
  return h('button', { 'data-tab': tab, onclick: () => setTab(tab) }, h('span', { class: 'ico' }, ico), label,
    tab === 'friends' ? h('span', { class: 'dot hidden', id: 'friends-dot' }) : null);
}
function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  const main = $('#view'); if (!main) return;
  ({ quests: renderQuests, friends: renderFriends, me: renderMe })[tab](main);
  scrollTo(0, 0);
  updateDot();
}
document.addEventListener('ba:tab', e => setTab(e.detail));

function updateDot() {
  const d = $('#friends-dot'); if (!d) return;
  const n = pendingCount() + S.sent.filter(p => p.status === 'clarify').length;
  d.textContent = n; d.classList.toggle('hidden', !n);
}

const typing = () => document.activeElement && document.activeElement.matches('input, textarea');
onChange(what => {
  updateDot();
  if (typing()) return; // don't wipe what someone is typing
  if (what === 'social') { rerenderFriends(); if (S.tab === 'quests') renderQuests($('#view')); }
  if (what === 'quests' && S.tab === 'quests') renderQuests($('#view'));
  if (what === 'stats') rerenderMe();
});

// ── live updates from the other phone ──
let liveTimer = null;
function onLive(table) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(async () => {
    try {
      await Promise.all([loadSocial(), loadStats()]);
      refreshOpenProof();
      checkCelebrations();
    } catch (e) { console.warn(e); }
  }, 500);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && api.myId() && S.profile) onLive('focus');
});

// ── "YOUR BESTIE APPROVES!" moment ──
let celebrating = false;
async function checkCelebrations() {
  if (celebrating) return;
  const fresh = S.sent.filter(p => !p.seen_by_owner);
  if (!fresh.length) return;
  celebrating = true;
  try {
    const verified = fresh.filter(p => p.status === 'verified');
    const asked = fresh.filter(p => p.status === 'clarify');
    await api.markSeen();
    fresh.forEach(p => { p.seen_by_owner = true; });
    for (const p of verified) {
      const d = await api.proofDetail(p.id).catch(() => null);
      const bonus = await api.bonusFor(p.id).catch(() => 0);
      const badges = d ? d.badges : [];
      await celebrate({
        title: 'QUEST VERIFIED!',
        sub: `${p.friend.display_name.toUpperCase()} APPROVES! 💛`,
        reward: `${p.quest_emoji} ${p.quest_title}${bonus ? ` · +${bonus} 🪙 bonus!` : ''}`,
        mascots: [S.profile.mascot, p.friend.mascot || 'coinny'],
        extra: h('div', null,
          badges.length ? h('div', { class: 'wrap', style: { justifyContent: 'center', margin: '8px 0' } },
            badges.map(b => h('span', { class: 'chip' }, BADGES[b.badge_key].ico + ' ' + BADGES[b.badge_key].name))) : null,
          d && d.comments.filter(c => c.author_id !== api.myId()).slice(-1).map(c => h('div', { class: 'speech', style: { marginTop: '8px' } }, '“' + c.body + '”'))),
        button: 'LEGENDARY! 🎉',
      });
    }
    if (asked.length) toast(`${asked[0].friend.display_name} has a friendly question about “${asked[0].quest_title}” 💬`);
    loadStats();
  } catch (e) { console.warn(e); }
  finally { celebrating = false; }
}

boot();
