// SVG 4象限マップ
export const AXES = {
  tone: { key: 'toneScore', name: 'テンション', neg: '落ち着き（メロウ）', pos: 'テンション（ハイ）' },
  dialect: { key: 'dialectScore', name: '方言の濃さ', neg: '標準語', pos: '方言・訛りが濃い' },
  tempo: { key: 'tempoScore', name: 'テンポ', neg: 'ロジカル・早口', pos: 'まったり・ゆるふわ' }
};

export const MAPS = [
  {
    id: 'tone-dialect', x: 'tone', y: 'dialect', label: 'テンション × 方言',
    quads: { tr: 'にぎやか地元っ子', tl: 'しっとりお国ことば', bl: 'クールな標準語', br: 'はつらつアナウンサー' }
  },
  {
    id: 'tone-tempo', x: 'tone', y: 'tempo', label: 'テンション × テンポ',
    quads: { tr: '陽気なのんびり屋', tl: '癒やしのささやき', bl: '冷静な解説者', br: '早口ムードメーカー' }
  },
  {
    id: 'dialect-tempo', x: 'dialect', y: 'tempo', label: '方言 × テンポ',
    quads: { tr: 'ほっこり方言', tl: 'おっとり標準語', bl: 'きびきび標準語', br: '方言マシンガン' }
  }
];

export const REGIONS = {
  hokkaido: { name: '北海道', color: '#3B82C4' },
  tohoku: { name: '東北', color: '#2F9C8A' },
  kanto: { name: '関東', color: '#7A6BD1' },
  chubu: { name: '中部', color: '#5E9E3B' },
  kansai: { name: '関西', color: '#E0532F' },
  chugoku: { name: '中国', color: '#C27C0E' },
  shikoku: { name: '四国', color: '#1F8FB8' },
  kyushu: { name: '九州', color: '#D23A79' },
  okinawa: { name: '沖縄', color: '#0FA3A3' },
  standard: { name: '標準語', color: '#6B7489' },
  unknown: { name: '不明', color: '#9AA1B2' }
};

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 640, PAD = 56;
const INNER = SIZE - PAD * 2;

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (text != null) e.textContent = text;
  return e;
}

function toXY(px, py) {
  return { x: PAD + ((px + 100) / 200) * INNER, y: PAD + ((100 - py) / 200) * INNER };
}

function jitter(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return { dx: ((h & 0xff) / 255 - 0.5) * 8, dy: (((h >> 8) & 0xff) / 255 - 0.5) * 8 };
}

/** 3軸の距離から相性を出す（0〜100） */
export function closeness(a, b) {
  const d = Math.hypot(a.toneScore - b.toneScore, a.dialectScore - b.dialectScore, a.tempoScore - b.tempoScore);
  return Math.round(100 - (d / (Math.sqrt(3) * 200)) * 100);
}

export function pickMatches(users, me, mode, count) {
  if (!me || mode === 'all') return null;
  const target = mode === 'near' ? me : { toneScore: -me.toneScore, dialectScore: -me.dialectScore, tempoScore: -me.tempoScore };
  return users.filter(u => !u.isMe)
    .map(u => ({ u, score: closeness(u, target) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

/**
 * マップを描画
 * opts: { users, me, map, highlight:Set|null, onHover(u, evt|null), onSelect(u) }
 */
export function renderMap(svg, opts) {
  const { users, me, map, highlight, onHover, onSelect } = opts;
  const ax = AXES[map.x], ay = AXES[map.y];
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${map.label}のマップ`);

  const mid = PAD + INNER / 2;
  const q = [
    { k: 'tl', x: PAD, y: PAD }, { k: 'tr', x: mid, y: PAD },
    { k: 'bl', x: PAD, y: mid }, { k: 'br', x: mid, y: mid }
  ];
  q.forEach(({ k, x, y }) => {
    svg.appendChild(el('rect', { x, y, width: INNER / 2, height: INNER / 2, class: `quad quad-${k}` }));
    const tx = k.endsWith('l') ? x + 12 : x + INNER / 2 - 12;
    const ty = k.startsWith('t') ? y + 26 : y + INNER / 2 - 14;
    svg.appendChild(el('text', { x: tx, y: ty, class: 'quad-label', 'text-anchor': k.endsWith('l') ? 'start' : 'end' }, map.quads[k]));
  });

  // 目盛りの同心リング（声の波紋）
  [0.25, 0.5, 0.75].forEach(r => svg.appendChild(el('circle', { cx: mid, cy: mid, r: (INNER / 2) * r, class: 'ring' })));
  svg.appendChild(el('line', { x1: PAD, y1: mid, x2: PAD + INNER, y2: mid, class: 'axis' }));
  svg.appendChild(el('line', { x1: mid, y1: PAD, x2: mid, y2: PAD + INNER, class: 'axis' }));

  svg.appendChild(el('text', { x: PAD, y: PAD + INNER + 30, class: 'axis-label', 'text-anchor': 'start' }, '← ' + ax.neg));
  svg.appendChild(el('text', { x: PAD + INNER, y: PAD + INNER + 30, class: 'axis-label', 'text-anchor': 'end' }, ax.pos + ' →'));
  svg.appendChild(el('text', { x: mid, y: PAD - 22, class: 'axis-label', 'text-anchor': 'middle' }, '↑ ' + ay.pos));
  svg.appendChild(el('text', { x: mid, y: PAD + INNER + 50, class: 'axis-label', 'text-anchor': 'middle' }, '↓ ' + ay.neg));

  const layer = el('g', { class: 'dots' });
  svg.appendChild(layer);
  const ordered = [...users].sort((a, b) => (a.isMe ? 1 : 0) - (b.isMe ? 1 : 0));

  ordered.forEach(u => {
    const { x, y } = toXY(u[ax.key], u[ay.key]);
    const j = u.isMe ? { dx: 0, dy: 0 } : jitter(u.userId);
    const region = REGIONS[u.regionKey] || REGIONS.unknown;
    const dim = highlight && !u.isMe && !highlight.has(u.userId);
    const g = el('g', {
      class: `dot${u.isMe ? ' dot-me' : ''}${dim ? ' dot-dim' : ''}${highlight && highlight.has(u.userId) ? ' dot-hit' : ''}`,
      transform: `translate(${(x + j.dx).toFixed(1)},${(y + j.dy).toFixed(1)})`,
      tabindex: dim ? '-1' : '0',
      role: 'button',
      'aria-label': `${u.nickname}、${u.badge}`
    });
    if (u.isMe) {
      g.appendChild(el('circle', { r: 22, class: 'me-pulse' }));
      g.appendChild(el('circle', { r: 13, class: 'me-core' }));
      g.appendChild(el('text', { y: 5, class: 'me-text', 'text-anchor': 'middle' }, 'わたし'));
    } else {
      g.appendChild(el('circle', { r: 16, class: 'hit-area' }));
      g.appendChild(el('circle', { r: 8.5, fill: region.color, class: 'core' }));
      if (u.hasIntro) g.appendChild(el('circle', { r: 12, class: 'voice-ring', stroke: region.color }));
    }
    g.addEventListener('pointerenter', e => onHover(u, e));
    g.addEventListener('pointermove', e => onHover(u, e));
    g.addEventListener('pointerleave', () => onHover(null));
    g.addEventListener('focus', () => onHover(u, { target: g }));
    g.addEventListener('blur', () => onHover(null));
    g.addEventListener('click', () => onSelect(u));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(u); } });
    layer.appendChild(g);
  });
}
