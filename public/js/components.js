// Tekrar kullanılan arayüz bileşenleri: tablo, grafik, barkod, seçiciler, tarih aralığı
import { h, mount, tl, tlShort, num, today, addDays, debounce, ORDER_STATUS, MONTHS_LONG } from './core.js';
import { icon } from './icons.js';

export const badge = (text, type = '') => h('span', { class: `badge ${type}` }, text);
export const statusBadge = (s) => badge(...(ORDER_STATUS[s] || [s, '']));

export function empty(title, text, action) {
  return h('div', { class: 'empty' }, icon('box'), h('b', null, title), text && h('div', null, text), action && h('div', { style: { marginTop: '12px' } }, action));
}

export function card(title, body, { actions, flush = false, cls = '' } = {}) {
  return h('div', { class: `card ${cls}` },
    title !== null && title !== undefined ? h('div', { class: 'card-h' }, typeof title === 'string' ? h('h2', null, title) : title, actions && h('div', { class: 'actions' }, actions)) : null,
    h('div', { class: `card-b ${flush ? 'flush' : ''}` }, body));
}

export function delta(cur, prev, { invert = false } = {}) {
  if (!prev) return cur ? h('span', { class: 'delta up' }, 'yeni') : null;
  const d = (cur - prev) / Math.abs(prev);
  const up = d >= 0;
  const good = invert ? !up : up;
  return h('span', { class: `delta ${good ? 'up' : 'down'}` }, icon(up ? 'trendUp' : 'trendDown', { class: '' }), `%${Math.abs(Math.round(d * 100))}`);
}

export function kpi(label, value, { sub, cls = '', ico } = {}) {
  return h('div', { class: `card kpi ${cls}` }, h('div', { class: 'lbl' }, ico && icon(ico, { class: '' }), label), h('div', { class: 'val' }, value), sub && h('div', { class: 'cmp' }, sub));
}

/**
 * Tablo. columns: [{label, key, render(row), right, cls, sort}]
 * opts: onRow(row), foot: [cells], emptyText
 */
export function table(columns, rows, { onRow, foot, emptyText = 'Kayıt bulunamadı', compact = false, rowClass } = {}) {
  if (!rows.length) return empty(emptyText);
  return h('div', { class: 'table-wrap' }, h('table', { class: `t ${compact ? 'compact' : ''}` },
    h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.right ? 'right' : c.cls }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', {
      class: [onRow && 'click', rowClass?.(r)].filter(Boolean).join(' '),
      onclick: onRow ? (e) => { if (!e.target.closest('button, a, input, select')) onRow(r); } : undefined,
    }, columns.map((c) => h('td', { class: [c.right ? 'right num' : '', c.cls].join(' ') }, c.render ? c.render(r) : r[c.key]))))),
    foot ? h('tfoot', null, h('tr', null, foot.map((f, i) => h('td', { class: columns[i]?.right ? 'right num' : '' }, f)))) : null));
}

export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([key, label, count]) => h('button', {
    class: key === active ? 'on' : '', role: 'tab', 'aria-selected': key === active ? 'true' : 'false', onclick: () => onChange(key),
  }, label, count ? badge(String(count)) : null)));
}

export function segmented(items, active, onChange) {
  return h('div', { class: 'btn-group' }, items.map(([key, label]) => h('button', { class: `btn sm ${key === active ? 'on' : ''}`, onclick: () => onChange(key) }, label)));
}

// ---------- Tarih aralığı ----------
export function presetRange(key) {
  const t = today();
  const y = Number(t.slice(0, 4));
  const monthStart = `${t.slice(0, 8)}01`;
  const dow = (new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7; // Pazartesi = 0
  const prevMonthEnd = addDays(monthStart, -1);
  switch (key) {
    case 'today': return [t, t];
    case 'yesterday': return [addDays(t, -1), addDays(t, -1)];
    case 'week': return [addDays(t, -dow), t];
    case '7': return [addDays(t, -6), t];
    case 'month': return [monthStart, t];
    case 'lastmonth': return [`${prevMonthEnd.slice(0, 8)}01`, prevMonthEnd];
    case '90': return [addDays(t, -89), t];
    case 'year': return [`${y}-01-01`, t];
    case '365': return [addDays(t, -364), t];
    default: return [addDays(t, -29), t];
  }
}

export function dateRange(value, onChange) {
  const presets = [['today', 'Bugün'], ['yesterday', 'Dün'], ['week', 'Bu hafta'], ['7', 'Son 7 gün'], ['month', 'Bu ay'], ['lastmonth', 'Geçen ay'], ['30', 'Son 30 gün'], ['90', 'Son 90 gün'], ['year', 'Bu yıl'], ['365', 'Son 1 yıl'], ['custom', 'Özel aralık']];
  const from = h('input', { type: 'date', value: value.from, style: { width: 'auto' } });
  const to = h('input', { type: 'date', value: value.to, style: { width: 'auto' } });
  const custom = h('span', { class: `row ${value.preset === 'custom' ? '' : 'hidden'}` }, from, h('span', { class: 'faint' }, '–'), to);
  const sel = h('select', { style: { width: 'auto' }, onchange: () => {
    if (sel.value === 'custom') { custom.classList.remove('hidden'); return; }
    custom.classList.add('hidden');
    const [f, t] = presetRange(sel.value);
    onChange({ preset: sel.value, from: f, to: t });
  } }, presets.map(([k, l]) => h('option', { value: k, selected: k === value.preset }, l)));
  const fire = () => { if (from.value && to.value && from.value <= to.value) onChange({ preset: 'custom', from: from.value, to: to.value }); };
  from.onchange = fire; to.onchange = fire;
  return h('div', { class: 'row wrap' }, icon('calendar', { class: 'faint' }), sel, custom);
}
export const defaultRange = (preset = '30') => { const [from, to] = presetRange(preset); return { preset, from, to }; };
export const rangeLabel = (r) => `${r.from.split('-').reverse().join('.')} – ${r.to.split('-').reverse().join('.')}`;

// ---------- Grafikler ----------
function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  kids.flat().forEach((k) => k && el.append(k));
  return el;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * Çubuk grafik. data: [{label, values:[n...], tip}], series: [{name, cls}]
 * Tek seride lejant gösterilmez (başlık adlandırır); çok seride lejant eklenir.
 */
export function barChart(data, { height = 220, series = [{ name: '' }], fmt = tlShort, tipFmt = tl, labelEvery } = {}) {
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip hidden' });
  const draw = () => {
    const W = wrap.clientWidth || 600;
    const H = height;
    const padL = 58; const padB = 24; const padT = 8;
    const plotW = W - padL - 4; const plotH = H - padB - padT;
    const allVals = data.flatMap((d) => d.values);
    const maxV = niceMax(Math.max(0, ...allVals));
    const minV = Math.min(0, ...allVals);
    const minN = minV < 0 ? -niceMax(-minV) : 0;
    const span = maxV - minN;
    const y = (v) => padT + plotH - ((v - minN) / span) * plotH;
    const svg = svgEl('svg', { height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' });
    const axis = svgEl('g', { class: 'axis' });
    for (let i = 0; i <= 4; i++) {
      const v = minN + (span * i) / 4;
      axis.append(svgEl('line', { class: 'gridline', x1: padL, x2: W, y1: y(v), y2: y(v) }));
      const t = svgEl('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end' }); t.textContent = fmt(v); axis.append(t);
    }
    svg.append(axis);
    const n = data.length || 1;
    const slot = plotW / n;
    const gap = 2;
    const groupW = Math.max(2, Math.min(slot - Math.max(gap, slot * 0.28), 56));
    const barW = Math.max(1, (groupW - gap * (series.length - 1)) / series.length);
    const every = labelEvery || Math.ceil(n / Math.max(1, Math.floor(plotW / 54)));
    data.forEach((d, i) => {
      const x0 = padL + i * slot + (slot - groupW) / 2;
      d.values.forEach((v, si) => {
        const x = x0 + si * (barW + gap);
        const top = y(Math.max(v, 0)); const bot = y(Math.min(v, 0));
        const hgt = Math.max(v === 0 ? 0 : 1, bot - top);
        const r = Math.min(4, barW / 2, hgt);
        // Veri ucu yuvarlatılmış, taban düz çubuk
        const path = v >= 0
          ? `M${x},${bot} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${bot} Z`
          : `M${x},${top} V${bot - r} Q${x},${bot} ${x + r},${bot} H${x + barW - r} Q${x + barW},${bot} ${x + barW},${bot - r} V${top} Z`;
        svg.append(svgEl('path', { d: hgt ? path : '', class: `bar ${series[si]?.cls || ''} ${d.hl ? 'hl' : ''}` }));
      });
      const hit = svgEl('rect', { x: padL + i * slot, y: padT, width: slot, height: plotH, fill: 'transparent', class: 'hit' });
      hit.addEventListener('mouseenter', () => {
        mount(tip, h('b', null, d.tip || d.label), series.map((s, si) => h('div', null, s.name ? `${s.name}: ` : '', tipFmt(d.values[si]))), d.extra ? h('div', null, d.extra) : null);
        tip.classList.remove('hidden');
        tip.style.left = `${Math.min(Math.max(padL + i * slot + slot / 2, 70), W - 70)}px`;
        tip.style.top = `${y(Math.max(...d.values, 0))}px`;
      });
      hit.addEventListener('mouseleave', () => tip.classList.add('hidden'));
      svg.append(hit);
      if (i % every === 0) {
        const t = svgEl('text', { x: padL + i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle' }); t.textContent = d.label;
        const g = svgEl('g', { class: 'axis' }, t); svg.append(g);
      }
    });
    mount(wrap, svg, tip);
  };
  const ro = new ResizeObserver(debounce(draw, 60));
  requestAnimationFrame(() => { draw(); ro.observe(wrap); });
  const legend = series.length > 1 ? h('div', { class: 'legend', style: { marginBottom: '8px' } }, series.map((s, i) => h('span', null, h('span', { class: 'swatch', style: { background: `var(--series-${i + 1})` } }), s.name))) : null;
  return h('div', null, legend, wrap);
}

/** Yatay çubuk listesi (sıralama/karşılaştırma) — değerler her zaman metin olarak da yazılır */
export function hbars(rows, { fmt = tl, max, color, sub } = {}) {
  if (!rows.length) return empty('Veri yok');
  const m = max || Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return h('div', null, rows.map((r) => h('div', { class: 'hbar', title: `${r.label}: ${fmt(r.value)}` },
    h('div', { class: 'ellipsis' }, r.label, sub && r.sub ? h('div', { class: 'tiny faint' }, r.sub) : null),
    h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${Math.max(0, (r.value / m) * 100)}%`, background: color || r.color || null } })),
    h('div', { class: 'num right', style: { minWidth: '80px' } }, fmt(r.value)))));
}

export const dayLabel = (d) => `${Number(d.slice(8, 10))}.${d.slice(5, 7)}`;
export const monthLabel = (m) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1].slice(0, 3)} ${m.slice(2, 4)}`;

/** Tarih aralığındaki tüm günleri doldurur (satış olmayan günler 0 görünür) */
export function fillDays(rows, from, to, keys = ['total']) {
  const map = new Map(rows.map((r) => [r.d, r]));
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(map.get(d) || Object.fromEntries([['d', d], ...keys.map((k) => [k, 0])]));
  return out;
}

// ---------- Barkod (EAN-13 / Code128) ----------
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];

function eanValid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (s % 10)) % 10 === Number(code[12]);
}

function modules(code) {
  if (eanValid(code)) {
    const par = EAN_P[Number(code[0])];
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? EAN_L : EAN_G)[Number(code[i])];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += EAN_R[Number(code[i])];
    return bits + '101';
  }
  // Code128-B
  const vals = [104];
  for (const ch of code) { const c = ch.charCodeAt(0); vals.push(c >= 32 && c <= 126 ? c - 32 : 0); }
  let sum = 104;
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, 106);
  let bits = '';
  for (const v of vals) {
    const p = C128[v];
    for (let i = 0; i < p.length; i++) bits += (i % 2 ? '0' : '1').repeat(Number(p[i]));
  }
  return bits;
}

export function barcodeSVG(code, { height = 40, showText = true } = {}) {
  const bits = modules(String(code));
  const quiet = 8;
  const W = bits.length + quiet * 2;
  const H = height + (showText ? 12 : 0);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'shape-rendering': 'crispEdges' });
  let d = '';
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') d += `M${i + quiet},0h1v${height}h-1z`;
  svg.append(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' }), svgEl('path', { d, fill: '#000' }));
  if (showText) {
    const t = svgEl('text', { x: W / 2, y: H - 1, 'text-anchor': 'middle', 'font-size': 10, 'font-family': 'monospace', fill: '#000' });
    t.textContent = code; svg.append(t);
  }
  return svg;
}

// ---------- Aranabilir seçici ----------
/**
 * picker({ placeholder, search(q) → Promise<items>, render(item) → node, onSelect(item), minChars })
 * Klavye: ↑ ↓ Enter Esc
 */
export function picker({ placeholder = 'Ara…', search, render, onSelect, minChars = 1, value = '', autofocus = false, big = false, onEnterRaw }) {
  let items = []; let sel = 0; let seq = 0;
  const list = h('div', { class: 'gsearch-results hidden' });
  const input = h('input', { type: 'search', placeholder, value, autocomplete: 'off', autofocus, class: big ? 'big' : '' });
  const close = () => list.classList.add('hidden');
  const paint = () => {
    mount(list, items.length ? items.map((it, i) => h('div', {
      class: `gs-item ${i === sel ? 'sel' : ''}`, onmousedown: (e) => { e.preventDefault(); choose(it); },
    }, render(it))) : h('div', { class: 'gs-item faint' }, 'Sonuç bulunamadı'));
    list.classList.remove('hidden');
  };
  const choose = (it) => { close(); onSelect(it, input); };
  const doSearch = debounce(async () => {
    const qv = input.value.trim();
    if (qv.length < minChars) { close(); return; }
    const my = ++seq;
    const res = await search(qv).catch(() => []);
    if (my !== seq) return;
    items = res; sel = 0; paint();
  }, 180);
  input.addEventListener('input', doSearch);
  input.addEventListener('focus', () => { if (items.length && input.value.trim()) paint(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', async (e) => {
    const open = !list.classList.contains('hidden');
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); paint(); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (onEnterRaw && await onEnterRaw(input.value.trim(), input)) { close(); return; }
      if (open && items[sel]) choose(items[sel]);
    } else if (e.key === 'Escape') close();
  });
  return h('div', { class: 'gsearch', style: { maxWidth: 'none' } }, icon('search'), input, list);
}

export const colorSwatch = (name) => {
  const map = {
    siyah: '#111', beyaz: '#fff', kırmızı: '#d0312d', bordo: '#6d1a2b', lacivert: '#1d2951', mavi: '#2a6fd6', 'açık mavi': '#8ec5ff', yeşil: '#2f8f46',
    haki: '#7a7a4a', 'zeytin yeşili': '#6b6b2e', sarı: '#f2c230', turuncu: '#f08a24', pembe: '#f2a0c0', pudra: '#e8c4c0', mor: '#6c3a9c', lila: '#b99bd8', gri: '#8c8c8c',
    antrasit: '#3c3f44', bej: '#d9c6a5', krem: '#f3ead3', kahverengi: '#6b4226', camel: '#b98a55', vizon: '#9c8a7a', ekru: '#efe6d2', gümüş: '#c0c0c0', altın: '#d4af37',
    fuşya: '#d0317a', mint: '#98e0c8', indigo: '#3f4aa8', taba: '#a0582b', 'koyu mavi': '#1f3b73', füme: '#5a5a5a', turkuaz: '#1fb5b0', somon: '#f28b75', 'çok renkli': 'linear-gradient(90deg,#e33,#fd3,#3c3,#39f)',
  };
  const c = map[String(name || '').toLocaleLowerCase('tr').trim()];
  return c ? h('span', { class: 'swatch', style: { background: c } }) : null;
};

export const staffOptions = (staff) => staff.map((s) => [s.id, s.name]);
export { num };
