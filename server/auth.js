import crypto from 'node:crypto';
import { q, insert, tx } from './db.js';
import { HttpError, bad, forbidden, localNow, str } from './util.js';
import { seedStoreDefaults } from './defaults.js';

const COOKIE = 'dc_oturum';
const SESSION_DAYS = 30;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}

export function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha(token), userId, new Date().toISOString(), Date.now() + SESSION_DAYS * 864e5);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
  q.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
}

/** Her /api isteğinde oturumu çözer; req.user ve req.store doldurulur. */
export function authenticate(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = q.get(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`, sha(token), Date.now());
    if (row) {
      req.user = row;
      req.store = q.get('SELECT * FROM stores WHERE id = ?', row.store_id);
      req.sessionHash = sha(token);
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Oturum açmanız gerekiyor'));
  next();
}

/** Rol kontrolü: owner (Mağaza Sahibi) > manager (Müdür) > cashier (Satış Danışmanı/Kasiyer). */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const isManager = (req) => req.user.role === 'owner' || req.user.role === 'manager';

// Basit giriş denemesi sınırlama (kaba kuvvet saldırılarına karşı)
const attempts = new Map();
function checkRate(key) {
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, t: now };
  if (now - a.t > 15 * 60e3) { a.n = 0; a.t = now; }
  attempts.set(key, a);
  if (a.n >= 10) throw new HttpError(429, 'Çok fazla hatalı deneme. Lütfen 15 dakika sonra tekrar deneyin.');
  return a;
}

export function publicUser(u, store) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, staff_id: u.staff_id,
    store: store && { id: store.id, name: store.name, timezone: store.timezone },
  };
}

export function registerAuthRoutes(app) {
  app.post('/api/auth/register', (req, res) => {
    const b = req.body || {};
    const storeName = str(b.storeName, { required: true, max: 100, name: 'Mağaza adı' });
    const name = str(b.name, { required: true, max: 100, name: 'Ad soyad' });
    const email = str(b.email, { required: true, max: 150, name: 'E-posta' })?.toLowerCase();
    const password = String(b.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Geçerli bir e-posta adresi girin');
    if (password.length < 6) throw bad('Şifre en az 6 karakter olmalıdır');
    if (q.get('SELECT id FROM users WHERE email = ?', email)) throw bad('Bu e-posta adresiyle kayıtlı bir hesap zaten var');
    const now = localNow();
    const userId = tx(() => {
      const storeId = insert('stores', { name: storeName, phone: str(b.phone, { max: 30 }), created_at: now });
      seedStoreDefaults(storeId, now);
      return insert('users', {
        store_id: storeId, name, email, password_hash: hashPassword(password), role: 'owner', created_at: now,
      });
    });
    createSession(req, res, userId);
    const u = q.get('SELECT * FROM users WHERE id = ?', userId);
    res.json({ user: publicUser(u, q.get('SELECT * FROM stores WHERE id = ?', u.store_id)) });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const a = checkRate(`${req.ip}|${email}`);
    const u = q.get('SELECT * FROM users WHERE email = ?', email);
    if (!u || !verifyPassword(password, u.password_hash)) {
      a.n++;
      throw bad('E-posta veya şifre hatalı');
    }
    if (!u.active) throw forbidden('Bu kullanıcı hesabı pasif durumda. Mağaza sahibiyle görüşün.');
    a.n = 0;
    const store = q.get('SELECT * FROM stores WHERE id = ?', u.store_id);
    q.run('UPDATE users SET last_login = ? WHERE id = ?', localNow(store.timezone), u.id);
    createSession(req, res, u.id);
    res.json({ user: publicUser(u, store) });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionHash) q.run('DELETE FROM sessions WHERE token_hash = ?', req.sessionHash);
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user, req.store) });
  });

  app.post('/api/auth/password', requireAuth, (req, res) => {
    const { current, next: pw } = req.body || {};
    if (!verifyPassword(String(current || ''), req.user.password_hash)) throw bad('Mevcut şifre hatalı');
    if (String(pw || '').length < 6) throw bad('Yeni şifre en az 6 karakter olmalıdır');
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(pw)), req.user.id);
    q.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, req.sessionHash);
    res.json({ ok: true });
  });
}
