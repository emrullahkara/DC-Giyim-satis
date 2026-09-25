import { insert, q } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Kayıt bulunamadı') => new HttpError(404, msg);
export const forbidden = (msg = 'Bu işlem için yetkiniz yok') => new HttpError(403, msg);

// Yalnızca demo veri üretiminde (seed) geçmiş tarihli kayıt oluşturmak için kullanılır.
let fakeNow = null;
export function setFakeNow(d) { fakeNow = d; }

/** Mağazanın saat dilimine göre 'YYYY-MM-DD HH:MM:SS' biçiminde yerel zaman. */
export function localNow(tz = 'Europe/Istanbul', date = fakeNow || new Date()) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(date).replace('T', ' ');
  } catch {
    return new Date(date.getTime() + 3 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  }
}

export const localToday = (tz) => localNow(tz).slice(0, 10);

/** 'YYYY-MM-DD' tarihine gün ekler. */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// --- Doğrulama yardımcıları ---
export function str(v, { max = 500, required = false, name = 'Alan' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${name} geçersiz`);
  const s = String(v).trim();
  if (required && !s) throw bad(`${name} zorunludur`);
  if (s.length > max) throw bad(`${name} en fazla ${max} karakter olabilir`);
  return s || null;
}

export function int(v, { min = -Infinity, max = Infinity, name = 'Değer', required = false, def = 0 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} zorunludur`);
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw bad(`${name} geçerli bir tam sayı olmalıdır`);
  if (n < min) throw bad(`${name} en az ${min} olmalıdır`);
  if (n > max) throw bad(`${name} en fazla ${max} olabilir`);
  return n;
}

/** Kuruş cinsinden para değeri doğrular. */
export const money = (v, opts = {}) => int(v, { min: 0, max: 1e12, name: 'Tutar', ...opts });

export function oneOf(v, list, name = 'Değer') {
  if (!list.includes(v)) throw bad(`${name} geçersiz`);
  return v;
}

export function optDate(v, name = 'Tarih') {
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) throw bad(`${name} geçersiz`);
  return v;
}

export const PAY_METHODS = ['cash', 'card', 'transfer', 'credit', 'deposit'];
export const CASH_METHODS = ['cash', 'card', 'transfer'];
export const METHOD_LABELS = {
  cash: 'Nakit', card: 'Kredi Kartı', transfer: 'Havale/EFT', credit: 'Veresiye', deposit: 'Kapora',
};

export function log(req, action, detail = '') {
  insert('activity', {
    store_id: req.store.id,
    user_id: req.user.id,
    action,
    detail: String(detail).slice(0, 500),
    created_at: localNow(req.store.timezone),
  });
}

export function ownRow(table, id, storeId, msg) {
  const row = q.get(`SELECT * FROM ${table} WHERE id = ? AND store_id = ?`, Number(id) || 0, storeId);
  if (!row) throw notFound(msg);
  return row;
}

/** Tarih aralığı parametrelerini okur; varsayılan: son 30 gün. */
export function range(req, defDays = 30) {
  const today = localToday(req.store.timezone);
  const to = isDate(req.query.to) ? req.query.to : today;
  const from = isDate(req.query.from) ? req.query.from : addDays(to, -(defDays - 1));
  if (from > to) throw bad('Başlangıç tarihi bitiş tarihinden sonra olamaz');
  return { from, to, fromTs: `${from} 00:00:00`, toTs: `${to} 23:59:59` };
}

export function page(req, def = 50) {
  const limit = Math.min(Math.max(Number(req.query.limit) || def, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  return { limit, offset };
}

export const like = (s) => `%${String(s).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
