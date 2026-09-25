// Ortak yardımcılar: DOM oluşturma, API, biçimlendirme, bildirim, modal
import { icon } from './icons.js';

export const state = { user: null, meta: null };

// ---------- DOM ----------
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'ref') v(el);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- API ----------
export class ApiError extends Error {}

export async function api(path, { method = 'GET', body, query } = {}) {
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...qs].length) url += `?${qs}`;
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-DC-Istek': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Sunucuya ulaşılamıyor. İnternet bağlantınızı kontrol edin.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* boş yanıt */ }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    state.user = null;
    location.hash = '#/giris';
    throw new ApiError('Oturum süresi doldu, lütfen tekrar giriş yapın');
  }
  if (!res.ok) throw new ApiError(data?.error || `İşlem başarısız (${res.status})`);
  return data;
}
api.get = (p, query) => api(p, { query });
api.post = (p, body = {}) => api(p, { method: 'POST', body });
api.put = (p, body = {}) => api(p, { method: 'PUT', body });
api.del = (p) => api(p, { method: 'DELETE' });

// ---------- Biçimlendirme ----------
const nf = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** Kuruş → "1.234,50 ₺" */
export const tl = (k) => `${nf.format((Number(k) || 0) / 100)} ₺`;
/** Kuruş → kısa: "12,5 B ₺" */
export function tlShort(k) {
  const v = (Number(k) || 0) / 100;
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)} Mn ₺`;
  if (a >= 1e4) return `${nf1.format(v / 1e3)} B ₺`;
  return `${nf0.format(v)} ₺`;
}
export const num = (n) => nf0.format(Number(n) || 0);
export const pct = (x, d = 1) => `%${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: d }).format((Number(x) || 0) * 100)}`;
/** Kuruş → giriş alanı değeri: "1234,50" */
export const toInput = (k) => (k === null || k === undefined || k === '' ? '' : ((Number(k) || 0) / 100).toFixed(2).replace('.', ',').replace(/,00$/, ''));

/** "1.234,50" | "1234.5" | "1234" → kuruş (tam sayı). Geçersizse NaN. */
export function parseTL(s) {
  if (typeof s === 'number') return Math.round(s * 100);
  let t = String(s ?? '').trim().replace(/[₺\s]/g, '');
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  else if (/^\d{1,3}\.\d{3}$/.test(t)) t = t.replace('.', '');
  if (!/^-?\d*\.?\d*$/.test(t)) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const MONTHS_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** '2026-09-25' veya '2026-09-25 14:03:00' → '25 Eyl 2026' */
export function fdate(s, { year = true } = {}) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}${year ? ` ${y}` : ''}`;
}
export function fdt(s) {
  if (!s) return '—';
  return `${fdate(s)} ${String(s).slice(11, 16)}`;
}
export const ftime = (s) => (s ? String(s).slice(11, 16) : '');
/** Göreli zaman: "bugün 14:03", "dün", "3 gün önce" */
export function rel(s) {
  if (!s) return '—';
  const d = String(s).slice(0, 10);
  const t = today();
  if (d === t) return `bugün ${ftime(s)}`.trim();
  const diff = Math.round((Date.parse(t) - Date.parse(d)) / 864e5);
  if (diff === 1) return 'dün';
  if (diff > 1 && diff < 7) return `${diff} gün önce`;
  return fdate(s, { year: d.slice(0, 4) !== t.slice(0, 4) });
}

export function today() {
  const tz = state.user?.store?.timezone || 'Europe/Istanbul';
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch { return new Date().toISOString().slice(0, 10); }
}
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const METHOD = { cash: 'Nakit', card: 'Kredi Kartı', transfer: 'Havale/EFT', credit: 'Veresiye', deposit: 'Kapora', none: '—' };
export const ROLE = { owner: 'Mağaza Sahibi', manager: 'Müdür', cashier: 'Satış Danışmanı' };
export const ORDER_STATUS = {
  new: ['Yeni', 'info'], ordered: ['Sipariş Verildi', 'warn'], arrived: ['Mağazaya Geldi', 'brand'],
  notified: ['Müşteriye Haber Verildi', 'brand'], delivered: ['Teslim Edildi', 'ok'], cancelled: ['İptal', 'bad'],
};

export const isManager = () => ['owner', 'manager'].includes(state.user?.role);
export const isOwner = () => state.user?.role === 'owner';
export const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toLocaleUpperCase('tr')).join('');

/** WhatsApp mesaj bağlantısı (Türkiye numaraları için) */
export function waLink(phone, text = '') {
  let p = String(phone || '').replace(/\D/g, '');
  if (!p) return null;
  if (p.startsWith('0')) p = `9${p}`;
  else if (p.length === 10) p = `90${p}`;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

// ---------- Bildirim ----------
export function toast(msg, type = '') {
  const el = h('div', { class: `toast ${type}` }, type === 'err' ? icon('alert') : type === 'ok' ? icon('check') : null, h('span', null, msg));
  document.getElementById('toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, type === 'err' ? 5000 : 2800);
  setTimeout(() => el.remove(), type === 'err' ? 5400 : 3200);
}

/** Async işlemi çalıştırır; hata olursa kırmızı bildirim gösterir. Butonu işlem süresince kilitler. */
export async function run(fn, btn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.message || 'Bir hata oluştu', 'err');
    if (!(e instanceof ApiError)) console.error(e);
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- Modal ----------
export function modal({ title, body, footer, size = '', onClose, dismissable = true }) {
  const prevFocus = document.activeElement;
  const close = () => {
    bg.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); }
  };
  const box = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-h' }, h('h2', null, title),
      h('button', { class: 'btn ghost icon sm x', 'aria-label': 'Kapat', onclick: close }, icon('x'))),
    h('div', { class: 'modal-b' }, body),
    footer ? h('div', { class: 'modal-f' }, footer) : null);
  const bg = h('div', { class: 'modal-bg', onmousedown: (e) => { if (e.target === bg && dismissable) close(); } }, box);
  document.body.append(bg);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => box.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), select, textarea')?.focus(), 30);
  return { close, box, body: box.querySelector('.modal-b') };
}

export function confirmBox(message, { title = 'Emin misiniz?', ok = 'Evet', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: h('p', { style: { margin: 0 } }, message),
      footer: [
        h('button', { class: 'btn', onclick: () => m.close() }, 'Vazgeç'),
        h('button', { class: `btn ${danger ? 'danger solid' : 'primary'}`, autofocus: true, onclick: () => { done = true; m.close(); resolve(true); } }, ok),
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/**
 * Form modalı: alanlar tanımından form oluşturur, kaydedince onSubmit(values) çağırır.
 * field: {name, label, type: text|money|number|date|select|textarea|check, options, required, hint, span, value}
 */
export function formModal({ title, fields, values = {}, submit = 'Kaydet', onSubmit, size = '', intro }) {
  const inputs = {};
  const grid = h('div', { class: 'form-grid' }, fields.map((f) => {
    if (f.type === 'section') return h('div', { class: 'span-all', style: { marginTop: '6px' } }, h('h3', null, f.label));
    const el = fieldInput(f, values[f.name]);
    inputs[f.name] = { f, el };
    if (f.type === 'check') return h('div', { class: `field ${f.span || ''}` }, h('label', { class: 'check' }, el, f.label), f.hint && h('span', { class: 'hint' }, f.hint));
    return h('div', { class: `field ${f.span || ''}` }, h('label', null, f.label, f.required ? ' *' : ''), el, f.hint && h('span', { class: 'hint' }, f.hint));
  }));
  const btn = h('button', { class: 'btn primary', type: 'submit' }, submit);
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const out = {};
    for (const [name, { f, el }] of Object.entries(inputs)) {
      const v = readField(f, el);
      if (v === undefined) { el.focus(); return toast(`${f.label}: geçersiz tutar`, 'err'); }
      if (f.required && (v === '' || v === null)) { el.focus(); return toast(`${f.label} zorunludur`, 'err'); }
      out[name] = v;
    }
    const ok = await run(() => onSubmit(out), btn);
    if (ok !== undefined && ok !== false) m.close();
  } }, intro, grid, h('button', { type: 'submit', class: 'hidden' }));
  const m = modal({ title, body: form, size, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Vazgeç'), btn] });
  btn.addEventListener('click', () => form.requestSubmit());
  btn.type = 'button';
  return m;
}

export function fieldInput(f, value) {
  const common = { name: f.name, placeholder: f.placeholder || '', autofocus: f.autofocus, disabled: f.disabled };
  switch (f.type) {
    case 'money':
      return h('input', { ...common, type: 'text', inputmode: 'decimal', class: 'money-in', value: toInput(value), autocomplete: 'off' });
    case 'number':
      return h('input', { ...common, type: 'number', value: value ?? '', min: f.min, max: f.max, step: f.step || 'any' });
    case 'date':
      return h('input', { ...common, type: 'date', value: value || '' });
    case 'textarea':
      return h('textarea', { ...common, rows: f.rows || 3 }, value || '');
    case 'check':
      return h('input', { type: 'checkbox', name: f.name, checked: !!value });
    case 'select': {
      const opts = typeof f.options === 'function' ? f.options() : f.options;
      return h('select', common, f.empty !== undefined ? h('option', { value: '' }, f.empty) : null,
        opts.map((o) => {
          const [v, l] = Array.isArray(o) ? o : typeof o === 'object' ? [o.id, o.name] : [o, o];
          return h('option', { value: v, selected: String(v) === String(value ?? '') }, l);
        }));
    }
    default:
      return h('input', { ...common, type: f.type || 'text', value: value ?? '', maxlength: f.max, list: f.list, autocomplete: f.autocomplete || 'off' });
  }
}

export function readField(f, el) {
  if (f.type === 'check') return el.checked;
  if (f.type === 'money') {
    if (el.value.trim() === '') return f.nullable ? null : 0;
    const k = parseTL(el.value);
    return Number.isNaN(k) ? undefined : k;
  }
  if (f.type === 'number') return el.value === '' ? null : Number(el.value);
  return el.value.trim();
}

export function downloadCSV(filename, rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(';')];
  for (const r of rows) lines.push(columns.map((c) => esc(c.csv ? c.csv(r) : r[c.key])).join(';'));
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
/** CSV'de para: "1234,50" (Excel TR uyumlu) */
export const csvMoney = (k) => ((Number(k) || 0) / 100).toFixed(2).replace('.', ',');

export function printHTML(node) {
  const area = document.getElementById('print-area');
  mount(area, node);
  setTimeout(() => {
    window.print();
    setTimeout(() => area.replaceChildren(), 500);
  }, 60);
}

export async function loadMeta(force = false) {
  if (!state.meta || force) state.meta = await api.get('/products/meta');
  return state.meta;
}
