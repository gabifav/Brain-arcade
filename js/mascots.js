// Brain Arcade's own mascots, drawn in SVG.
// bleep  – a little arcade robot with a screen face
// coinny – a cheerful gold coin
// zap    – an energetic lightning bolt
// pip    – a squishy pixel-heart

export const MASCOTS = {
  bleep:  { name: 'Bleep',  line: 'Beep boop! One tiny step at a time.' },
  coinny: { name: 'Coinny', line: 'Every bit of progress is worth coins!' },
  zap:    { name: 'Zap',    line: "Let's GO! Short bursts count!" },
  pip:    { name: 'Pip',    line: "You're doing better than you think 💖" },
};

function face(mood, cx, cy, ink = '#1a1033') {
  const e = 9;
  if (mood === 'cheer') return `
    <path d="M${cx - e - 4} ${cy - 2} q4 -6 8 0" stroke="${ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M${cx + e - 4} ${cy - 2} q4 -6 8 0" stroke="${ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M${cx - 8} ${cy + 6} q8 10 16 0 z" fill="${ink}"/><path d="M${cx - 4} ${cy + 9} q4 3 8 0" fill="#ff7bb5"/>`;
  if (mood === 'think') return `
    <circle cx="${cx - e}" cy="${cy}" r="3.4" fill="${ink}"/><circle cx="${cx + e}" cy="${cy - 2}" r="3.4" fill="${ink}"/>
    <path d="M${cx - 5} ${cy + 9} h10" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  if (mood === 'sleepy') return `
    <path d="M${cx - e - 4} ${cy} h8 M${cx + e - 4} ${cy} h8" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy + 9}" r="3" fill="${ink}"/>`;
  return `
    <circle cx="${cx - e}" cy="${cy}" r="3.8" fill="${ink}"/><circle cx="${cx + e}" cy="${cy}" r="3.8" fill="${ink}"/>
    <circle cx="${cx - e + 1.3}" cy="${cy - 1.3}" r="1.2" fill="#fff"/><circle cx="${cx + e + 1.3}" cy="${cy - 1.3}" r="1.2" fill="#fff"/>
    <path d="M${cx - 6} ${cy + 7} q6 6 12 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
}
const blush = (cx, cy) => `<ellipse cx="${cx - 16}" cy="${cy + 6}" rx="4.5" ry="2.6" fill="#ff7bb5" opacity=".7"/><ellipse cx="${cx + 16}" cy="${cy + 6}" rx="4.5" ry="2.6" fill="#ff7bb5" opacity=".7"/>`;

export function mascotSVG(kind = 'bleep', mood = 'happy') {
  const arms = mood === 'cheer';
  let body = '';
  if (kind === 'coinny') {
    body = `
      <ellipse cx="50" cy="92" rx="22" ry="4" fill="#0004"/>
      ${arms ? '<path d="M18 52 L6 34 M82 52 L94 34" stroke="#e0a800" stroke-width="6" stroke-linecap="round"/>' : '<path d="M18 58 L8 66 M82 58 L92 66" stroke="#e0a800" stroke-width="6" stroke-linecap="round"/>'}
      <circle cx="50" cy="52" r="36" fill="#e0a800"/><circle cx="50" cy="50" r="36" fill="#ffd23f"/>
      <circle cx="50" cy="50" r="28" fill="none" stroke="#f0b400" stroke-width="3" stroke-dasharray="4 5"/>
      <path d="M30 28 q8 -8 18 -8" stroke="#fff7c2" stroke-width="5" fill="none" stroke-linecap="round"/>
      ${face(mood, 50, 50, '#5a3a00')}${blush(50, 50)}`;
  } else if (kind === 'zap') {
    body = `
      <ellipse cx="50" cy="93" rx="20" ry="4" fill="#0004"/>
      ${arms ? '<path d="M28 44 L12 26 M70 50 L90 34" stroke="#ff9f43" stroke-width="6" stroke-linecap="round"/>' : ''}
      <path d="M58 4 L20 54 H46 L36 96 L82 38 H54 L66 4 Z" fill="#ff9f43" stroke="#c96a12" stroke-width="3" stroke-linejoin="round"/>
      <path d="M57 10 L30 48" stroke="#ffd7a8" stroke-width="4" stroke-linecap="round"/>
      ${face(mood, 51, 46, '#3a1800')}`;
  } else if (kind === 'pip') {
    body = `
      <ellipse cx="50" cy="93" rx="24" ry="4" fill="#0004"/>
      ${arms ? '<path d="M16 46 L4 30 M84 46 L96 30" stroke="#e23a87" stroke-width="6" stroke-linecap="round"/>' : ''}
      <path d="M50 88 C20 70 8 52 12 34 C16 18 36 14 50 30 C64 14 84 18 88 34 C92 52 80 70 50 88 Z" fill="#ff4fa3" stroke="#c22a72" stroke-width="3"/>
      <rect x="22" y="28" width="8" height="8" fill="#ffa3cf"/><rect x="30" y="22" width="8" height="8" fill="#ffa3cf"/>
      ${face(mood, 50, 50, '#4a0628')}`;
  } else { // bleep
    body = `
      <ellipse cx="50" cy="94" rx="24" ry="4" fill="#0004"/>
      <line x1="50" y1="16" x2="50" y2="6" stroke="#b79cff" stroke-width="4"/><circle cx="50" cy="6" r="5" fill="#ff4fa3"/>
      ${arms ? '<path d="M18 56 L6 36 M82 56 L94 36" stroke="#8a6fe0" stroke-width="7" stroke-linecap="round"/>' : '<path d="M18 60 L8 72 M82 60 L92 72" stroke="#8a6fe0" stroke-width="7" stroke-linecap="round"/>'}
      <rect x="16" y="16" width="68" height="66" rx="18" fill="#8a6fe0"/><rect x="16" y="14" width="68" height="64" rx="18" fill="#b79cff"/>
      <rect x="24" y="22" width="52" height="40" rx="10" fill="#39e5ff"/><rect x="24" y="22" width="52" height="12" rx="6" fill="#8ff2ff" opacity=".6"/>
      ${face(mood, 50, 42, '#0b2a44')}
      <circle cx="34" cy="70" r="4" fill="#ffd23f"/><circle cx="46" cy="70" r="4" fill="#5dff9b"/><rect x="58" y="67" width="14" height="6" rx="3" fill="#ff4fa3"/>
      <rect x="30" y="82" width="10" height="8" rx="3" fill="#8a6fe0"/><rect x="60" y="82" width="10" height="8" rx="3" fill="#8a6fe0"/>`;
  }
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${body}</svg>`;
}

export function coinSVG() {
  return `<svg class="coin" viewBox="0 0 24 24"><circle cx="12" cy="12.6" r="10" fill="#c98f00"/><circle cx="12" cy="12" r="10" fill="#ffd23f"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="#e0a800" stroke-width="2"/><path d="M8 7.5 q2 -2 5 -2" stroke="#fff6b8" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
}

export const BADGES = {
  legend:   { ico: '🏆', name: 'Legend' },
  glowup:   { ico: '✨', name: 'Glow Up' },
  brave:    { ico: '🦁', name: 'Brave Start' },
  tidy:     { ico: '🧹', name: 'Tidy Titan' },
  focus:    { ico: '🎯', name: 'Laser Focus' },
  comeback: { ico: '🔁', name: 'Comeback' },
  kind:     { ico: '💖', name: 'Self-Kind' },
  starter:  { ico: '🚀', name: 'Just Started' },
};

export const REACTIONS = ['🎉', '🔥', '💪', '🌟', '💖', '👏', '🏆', '🚀'];
