// Shared app state + loaders.
import * as api from './api.js';
import { $, coinPop } from './ui.js';

export const S = {
  tab: 'quests',
  profile: null,
  stats: { coins: 0, coins_week: 0, quests_done: 0, verified: 0, badges: 0 },
  quests: [], friends: [], inbox: [], sent: [],
  loaded: { quests: false, social: false },
};

const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const changed = what => listeners.forEach(fn => fn(what));

export async function loadStats(popFrom) {
  const before = S.stats.coins;
  S.stats = await api.stats();
  const el = $('#coin-count');
  if (el) {
    el.textContent = S.stats.coins;
    if (S.stats.coins > before) {
      const wrap = $('.coins'); wrap.classList.remove('bump'); void wrap.offsetWidth; wrap.classList.add('bump');
    }
  }
  if (popFrom && S.stats.coins > before) coinPop(S.stats.coins - before, popFrom);
  changed('stats');
}
export async function loadQuests() { S.quests = await api.listQuests(); S.loaded.quests = true; changed('quests'); }
export async function loadSocial() {
  const [friends, inbox, sent] = await Promise.all([api.listFriends(), api.inbox(), api.sent()]);
  Object.assign(S, { friends, inbox, sent }); S.loaded.social = true;
  changed('social');
}
export const pendingCount = () => S.inbox.filter(p => p.status === 'pending').length;
