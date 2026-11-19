// Every network call the app makes lives here. All access is checked
// server-side by Row Level Security (see supabase/schema.sql).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'brain-arcade-auth' },
}) : null;

const BUCKET = 'quest-proof';
let me = null;
export const myId = () => me;

function ok({ data, error }) { if (error) throw error; return data; }
const rpc = async (fn, args) => ok(await sb.rpc(fn, args));

// ───────── auth ─────────
export async function getSession() {
  const { data } = await sb.auth.getSession();
  me = data.session?.user?.id || null;
  return data.session;
}
export function onAuth(cb) {
  sb.auth.onAuthStateChange((_e, session) => { me = session?.user?.id || null; cb(session); });
}
export async function sendCode(email) {
  ok(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
}
export async function verifyCode(email, token) {
  const d = ok(await sb.auth.verifyOtp({ email, token, type: 'email' }));
  me = d.session?.user?.id || null;
  return d.session;
}
export async function signOut() { await sb.auth.signOut(); me = null; }

// ───────── profile + stats ─────────
export async function getProfile() {
  return ok(await sb.from('profiles').select('*').eq('id', me).single());
}
export async function updateProfile(patch) {
  return ok(await sb.from('profiles').update(patch).eq('id', me).select().single());
}
export const stats = () => rpc('my_stats');

// ───────── quests ─────────
export async function listQuests() {
  const quests = ok(await sb.from('quests').select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(200));
  if (!quests.length) return [];
  const minis = ok(await sb.from('mini_quests').select('*').in('quest_id', quests.map(q => q.id)).order('position'));
  for (const q of quests) q.minis = minis.filter(m => m.quest_id === q.id);
  return quests;
}
export async function createQuest({ title, emoji, minis }) {
  const q = ok(await sb.from('quests').insert({ title, emoji, user_id: me }).select().single());
  if (minis.length) {
    q.minis = ok(await sb.from('mini_quests').insert(minis.map((t, i) => ({ quest_id: q.id, user_id: me, title: t, position: i }))).select());
  } else q.minis = [];
  return q;
}
export async function addMini(questId, title, position) {
  return ok(await sb.from('mini_quests').insert({ quest_id: questId, user_id: me, title, position }).select().single());
}
export async function deleteMini(id) { ok(await sb.from('mini_quests').delete().eq('id', id)); }
export const setMini = (id, done) => rpc('set_mini_done', { p_mini: id, p_done: done });
export const completeQuest = (id, outcome) => rpc('complete_quest', { p_quest: id, p_outcome: outcome });
export const reopenQuest = id => rpc('reopen_quest', { p_quest: id });
export async function deleteQuest(id) { ok(await sb.from('quests').delete().eq('id', id)); }

// ───────── friends ─────────
async function profilesFor(ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return {};
  const rows = ok(await sb.from('profiles').select('id, display_name, mascot').in('id', ids));
  return Object.fromEntries(rows.map(r => [r.id, r]));
}
export async function listFriends() {
  const rows = ok(await sb.from('friendships').select('friend_id, created_at').eq('user_id', me));
  const p = await profilesFor(rows.map(r => r.friend_id));
  // a friend whose profile is hidden has blocked us → not shown
  return rows.filter(r => p[r.friend_id]).map(r => ({ ...p[r.friend_id], since: r.created_at }));
}
export const createInvite = () => rpc('create_invite');
export const acceptInvite = code => rpc('accept_invite', { p_code: code });
export const disconnect = id => rpc('disconnect_friend', { p_friend: id });
export const block = id => rpc('block_user', { p_user: id });
export const unblock = id => rpc('unblock_user', { p_user: id });
export async function listBlocked() {
  return ok(await sb.from('blocks').select('blocked_id, blocked_name, created_at').eq('blocker_id', me));
}

// ───────── proofs ─────────
export async function inbox() {
  const rows = ok(await sb.from('proofs').select('*').eq('friend_id', me)
    .in('status', ['pending', 'clarify', 'verified']).eq('friend_access', true)
    .order('created_at', { ascending: false }).limit(60));
  const p = await profilesFor(rows.map(r => r.owner_id));
  return rows.filter(r => p[r.owner_id]).map(r => ({ ...r, owner: p[r.owner_id] }));
}
export async function sent() {
  const rows = ok(await sb.from('proofs').select('*').eq('owner_id', me).order('created_at', { ascending: false }).limit(100));
  const p = await profilesFor(rows.map(r => r.friend_id));
  return rows.map(r => ({ ...r, friend: p[r.friend_id] || { display_name: 'Former friend', mascot: 'bleep' } }));
}
export async function proofDetail(id) {
  const proof = ok(await sb.from('proofs').select('*').eq('id', id).maybeSingle());
  if (!proof) return null;
  const [photos, reactions, comments, badges] = await Promise.all([
    sb.from('proof_photos').select('*').eq('proof_id', id).order('created_at').then(ok),
    sb.from('proof_reactions').select('*').eq('proof_id', id).then(ok),
    sb.from('proof_comments').select('*').eq('proof_id', id).order('created_at').then(ok),
    sb.from('badges').select('*').eq('proof_id', id).then(ok),
  ]);
  const people = await profilesFor([proof.owner_id, proof.friend_id, ...comments.map(c => c.author_id)]);
  return { proof, photos, reactions, comments, badges, people };
}
export async function reactionsFor(ids) {
  if (!ids.length) return [];
  return ok(await sb.from('proof_reactions').select('*').in('proof_id', ids));
}
export async function cheersReceived(myProofIds) {
  if (!myProofIds.length) return [];
  const rows = ok(await sb.from('proof_comments').select('*').in('proof_id', myProofIds)
    .neq('author_id', me).order('created_at', { ascending: false }).limit(30));
  const p = await profilesFor(rows.map(r => r.author_id));
  return rows.map(r => ({ ...r, author: p[r.author_id] }));
}

// Create → upload chosen photos → attach → send. Friend sees nothing until the last step.
export async function submitProof({ friendId, quest, caption, outcome, progress, photos }, onStep) {
  const proof = ok(await sb.from('proofs').insert({
    owner_id: me, friend_id: friendId, quest_id: quest.id, quest_title: quest.title,
    quest_emoji: quest.emoji, caption: caption || null, outcome, progress,
  }).select().single());
  const uploaded = [];
  try {
    let i = 0;
    for (const ph of photos) {
      onStep && onStep(++i, photos.length);
      const path = `${me}/${proof.id}/${crypto.randomUUID()}.jpg`;
      ok(await sb.storage.from(BUCKET).upload(path, ph.blob, { contentType: 'image/jpeg', upsert: false }));
      uploaded.push(path);
      ok(await sb.from('proof_photos').insert({ proof_id: proof.id, owner_id: me, kind: ph.kind, storage_path: path, width: ph.width, height: ph.height }));
    }
    const bonus = await rpc('send_proof', { p_proof: proof.id });
    return { proof, bonus };
  } catch (e) {
    // tidy up the half-sent proof so nothing lingers
    if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded);
    await sb.from('proofs').delete().eq('id', proof.id);
    throw e;
  }
}
export async function addPhotoToProof(proofId, ph) {
  const path = `${me}/${proofId}/${crypto.randomUUID()}.jpg`;
  ok(await sb.storage.from(BUCKET).upload(path, ph.blob, { contentType: 'image/jpeg', upsert: false }));
  try {
    ok(await sb.from('proof_photos').insert({ proof_id: proofId, owner_id: me, kind: ph.kind, storage_path: path, width: ph.width, height: ph.height }));
  } catch (e) { await sb.storage.from(BUCKET).remove([path]); throw e; }
}
export async function deletePhoto(photo) {
  ok(await sb.storage.from(BUCKET).remove([photo.storage_path]));
  ok(await sb.from('proof_photos').delete().eq('id', photo.id));
  urlCache.delete(photo.storage_path);
}
export async function deleteProof(proofId) {
  const photos = ok(await sb.from('proof_photos').select('storage_path').eq('proof_id', proofId));
  if (photos.length) ok(await sb.storage.from(BUCKET).remove(photos.map(p => p.storage_path)));
  ok(await sb.from('proofs').delete().eq('id', proofId));
}
// Remove every photo file I have ever uploaded (and the proofs they belong to).
export async function deleteAllMyPhotos() {
  const folders = ok(await sb.storage.from(BUCKET).list(me, { limit: 1000 }));
  let n = 0;
  for (const f of folders) {
    const files = ok(await sb.storage.from(BUCKET).list(`${me}/${f.name}`, { limit: 1000 }));
    const paths = files.map(x => `${me}/${f.name}/${x.name}`);
    if (paths.length) { ok(await sb.storage.from(BUCKET).remove(paths)); n += paths.length; }
  }
  ok(await sb.from('proof_photos').delete().eq('owner_id', me));
  urlCache.clear();
  return n;
}

const urlCache = new Map();
export async function photoUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const d = ok(await sb.storage.from(BUCKET).createSignedUrl(path, 3600));
  urlCache.set(path, { url: d.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return d.signedUrl;
}

export async function react(proofId, emoji, on) {
  if (on) ok(await sb.from('proof_reactions').upsert({ proof_id: proofId, user_id: me, emoji }, { ignoreDuplicates: true }));
  else ok(await sb.from('proof_reactions').delete().match({ proof_id: proofId, user_id: me, emoji }));
}
export async function comment(proofId, body, kind = 'cheer') {
  return ok(await sb.from('proof_comments').insert({ proof_id: proofId, author_id: me, body, kind }).select().single());
}
export const verify = (id, bonus, badge, message) => rpc('verify_proof', { p_proof: id, p_bonus: bonus, p_badge: badge, p_message: message });
export const clarify = (id, message) => rpc('request_clarification', { p_proof: id, p_message: message });
export const resend = id => rpc('resend_proof', { p_proof: id });
export const giveBadge = (id, badge) => rpc('give_badge', { p_proof: id, p_badge: badge });
export const markSeen = () => rpc('mark_proofs_seen');
export async function bonusFor(proofId) {
  const rows = ok(await sb.from('coin_ledger').select('amount').eq('user_id', me).eq('reason', 'friend_bonus').eq('ref_id', proofId));
  return rows.reduce((a, r) => a + r.amount, 0);
}

// ───────── achievements, board, challenges ─────────
export async function badgesReceived() {
  const rows = ok(await sb.from('badges').select('*').eq('to_user', me).order('created_at', { ascending: false }));
  const p = await profilesFor(rows.map(r => r.from_user));
  return rows.map(r => ({ ...r, from: p[r.from_user] }));
}
export const leaderboard = () => rpc('friend_leaderboard');
export const challenges = () => rpc('challenge_board');
export const createChallenge = (title, goal, days, friends) => rpc('create_challenge', { p_title: title, p_goal: goal, p_days: days, p_friends: friends });
export const respondChallenge = (id, join) => rpc('respond_challenge', { p_challenge: id, p_join: join });

// ───────── live sync between phones ─────────
let channel = null;
export function subscribe(onChange) {
  if (channel) sb.removeChannel(channel);
  const fire = (table) => (payload) => onChange(table, payload);
  channel = sb.channel('brain-arcade-' + me)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'proofs', filter: `friend_id=eq.${me}` }, fire('proofs'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'proofs', filter: `owner_id=eq.${me}` }, fire('proofs'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'proof_comments' }, fire('comments'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'proof_reactions' }, fire('reactions'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'badges', filter: `to_user=eq.${me}` }, fire('badges'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_id=eq.${me}` }, fire('friends'))
    .subscribe();
}
export function unsubscribe() { if (channel) { sb.removeChannel(channel); channel = null; } }
