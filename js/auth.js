// Sign in with an emailed 6-digit code (works inside the iPhone home-screen app,
// unlike magic links which open in Safari instead).
import * as api from './api.js';
import { h, mascot, toast, busy, friendlyError, clear, put } from './ui.js';
import { MASCOTS } from './mascots.js';

export function renderSetup(app) {
  put(clear(app), h('div', { class: 'auth' },
    mascot('bleep', 'think'),
    h('div', { class: 'logo' }, 'BRAIN', h('br'), 'ARCADE'),
    h('div', { class: 'card' },
      h('b', null, 'Almost ready to play!'),
      h('p', { class: 'small' }, 'This copy of Brain Arcade isn\'t connected to its Supabase project yet. Add the Project URL and anon key to js/config.js — the README walks through it step by step.'))));
}

export function renderSignIn(app, onDone) {
  let email = localStorage.getItem('ba-email') || '';
  const box = h('div');
  const shell = h('div', { class: 'auth' },
    mascot('bleep', 'cheer'),
    h('div', { class: 'logo' }, 'BRAIN', h('br'), 'ARCADE'),
    h('div', { class: 'tag' }, 'TINY STEPS · BIG WINS · GOOD FRIENDS'),
    box);
  put(clear(app), shell);
  stepEmail();

  function stepEmail() {
    const inp = h('input', { class: 'input', type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.com', value: email || null, autocapitalize: 'off' });
    const go = h('button', { class: 'btn primary block', style: { marginTop: '12px' } }, 'Send me a code ✉️');
    const submit = () => busy(go, async () => {
      email = inp.value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) { toast('That email looks a bit off — check it?', 'warn'); return; }
      try { await api.sendCode(email); localStorage.setItem('ba-email', email); stepCode(); }
      catch (e) { toast(/rate|security purposes|seconds/i.test(e.message) ? 'Code already sent — check your inbox (or wait a minute and try again).' : friendlyError(e), 'warn'); }
    });
    go.onclick = submit;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    put(clear(box), h('div', { class: 'card' },
      h('div', { class: 'field' }, h('label', null, 'Your email'), inp),
      h('div', { class: 'tiny' }, 'No password to remember. We\'ll email you a code.'), go));
  }
  function stepCode() {
    const inp = h('input', { class: 'input code-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 10, placeholder: '••••••' });
    const go = h('button', { class: 'btn go block', style: { marginTop: '12px' } }, 'Start playing 🕹️');
    const submit = () => busy(go, async () => {
      const code = inp.value.replace(/\D/g, '');
      if (code.length < 6) { toast('Type the code from the email'); return; }
      try { const session = await api.verifyCode(email, code); onDone(session); }
      catch (e) { toast(/expired|invalid/i.test(e.message) ? 'That code didn\'t match or has expired. Try again or get a new one!' : friendlyError(e), 'warn'); }
    });
    go.onclick = submit;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    put(clear(box), h('div', { class: 'card' },
      h('p', { style: { marginTop: 0 } }, 'Code sent to ', h('b', null, email), ' ✉️'),
      h('div', { class: 'field' }, h('label', null, 'Code from the email'), inp), go,
      h('div', { class: 'row', style: { marginTop: '10px', gap: '8px' } },
        h('button', { class: 'btn sm ghost grow', onclick: stepEmail }, 'Change email'),
        h('button', { class: 'btn sm ghost grow', onclick: e => busy(e.currentTarget, async () => { try { await api.sendCode(email); toast('New code sent ✉️'); } catch (er) { toast(friendlyError(er), 'warn'); } }) }, 'Resend'))));
    setTimeout(() => inp.focus(), 200);
  }
}

export function renderOnboarding(app, profile, onDone) {
  let pick = profile.mascot || 'bleep';
  const name = h('input', { class: 'input', maxlength: 30, placeholder: 'e.g. Amelie', autocomplete: 'given-name', value: profile.display_name !== 'Player' ? profile.display_name : null });
  const grid = h('div', { class: 'mascot-pick' });
  const draw = () => put(clear(grid), ...Object.entries(MASCOTS).map(([k, m]) =>
    h('button', { 'aria-pressed': String(pick === k), onclick: () => { pick = k; draw(); } }, mascot(k, pick === k ? 'cheer' : 'happy'), m.name)));
  draw();
  const go = h('button', { class: 'btn primary block', style: { marginTop: '16px' } }, "LET'S PLAY! 🎮");
  go.onclick = () => busy(go, async () => {
    const n = name.value.trim();
    if (!n) { toast('What should friends call you?'); name.focus(); return; }
    try { const p = await api.updateProfile({ display_name: n, mascot: pick }); onDone(p); } catch (e) { toast(friendlyError(e), 'warn'); }
  });
  put(clear(app), h('div', { class: 'auth' },
    h('div', { class: 'logo', style: { fontSize: '18px' } }, 'NEW PLAYER!'),
    h('div', { class: 'card' },
      h('div', { class: 'field' }, h('label', null, 'Your name (friends will see this)'), name),
      h('div', { class: 'field' }, h('label', null, 'Pick your buddy'), grid), go)));
}
