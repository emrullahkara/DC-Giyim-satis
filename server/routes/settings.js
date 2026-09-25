// Mağaza ayarları, kullanıcılar, işlem geçmişi ve yedekleme
import { Router } from 'express';
import { q, insert } from '../db.js';
import { requireRole, hashPassword } from '../auth.js';
import { bad, int, str, oneOf, localNow, log, ownRow, page } from '../util.js';

const r = Router();
const owner = requireRole('owner');
const mgr = requireRole('owner', 'manager');

r.get('/settings/store', (req, res) => res.json(req.store));

r.put('/settings/store', owner, (req, res) => {
  const b = req.body || {};
  const tz = str(b.timezone, { max: 60 }) || 'Europe/Istanbul';
  try { new Intl.DateTimeFormat('tr-TR', { timeZone: tz }); } catch { throw bad('Saat dilimi geçersiz'); }
  q.run(`UPDATE stores SET name = ?, phone = ?, email = ?, address = ?, city = ?, tax_office = ?, tax_no = ?, receipt_footer = ?,
      return_days = ?, default_vat = ?, timezone = ?, low_stock_default = ?, dead_stock_days = ?, allow_negative_stock = ? WHERE id = ?`,
  str(b.name, { required: true, max: 100, name: 'Mağaza adı' }), str(b.phone, { max: 30 }), str(b.email, { max: 120 }),
  str(b.address, { max: 300 }), str(b.city, { max: 60 }), str(b.tax_office, { max: 60 }), str(b.tax_no, { max: 20 }),
  str(b.receipt_footer, { max: 500 }), int(b.return_days, { min: 0, max: 365, name: 'İade süresi' }),
  int(b.default_vat, { min: 0, max: 100, name: 'KDV' }), tz, int(b.low_stock_default, { min: 0, max: 1000, name: 'Kritik stok' }),
  int(b.dead_stock_days, { min: 7, max: 1000, name: 'Ölü stok süresi' }), b.allow_negative_stock ? 1 : 0, req.store.id);
  log(req, 'Mağaza ayarları güncellendi');
  res.json({ ok: true });
});

// ---- Kullanıcılar ----
const ROLES = ['owner', 'manager', 'cashier'];

r.get('/users', mgr, (req, res) => {
  res.json(q.all(`SELECT u.id, u.name, u.email, u.role, u.staff_id, u.active, u.last_login, u.created_at, s.name AS staff_name
    FROM users u LEFT JOIN staff s ON s.id = u.staff_id WHERE u.store_id = ? ORDER BY u.active DESC, u.id`, req.store.id));
});

r.post('/users', owner, (req, res) => {
  const b = req.body || {};
  const email = str(b.email, { required: true, max: 150, name: 'E-posta' }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Geçerli bir e-posta adresi girin');
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) throw bad('Bu e-posta ile kayıtlı bir kullanıcı zaten var');
  if (String(b.password || '').length < 6) throw bad('Şifre en az 6 karakter olmalıdır');
  const staffId = b.staff_id ? ownRow('staff', b.staff_id, req.store.id, 'Personel bulunamadı').id : null;
  const id = insert('users', {
    store_id: req.store.id, name: str(b.name, { required: true, max: 100, name: 'Ad soyad' }), email,
    password_hash: hashPassword(String(b.password)), role: oneOf(b.role, ROLES, 'Rol'), staff_id: staffId,
    created_at: localNow(req.store.timezone),
  });
  log(req, 'Kullanıcı eklendi', email);
  res.json({ id });
});

r.put('/users/:id', owner, (req, res) => {
  const u = q.get('SELECT * FROM users WHERE id = ? AND store_id = ?', Number(req.params.id), req.store.id);
  if (!u) throw bad('Kullanıcı bulunamadı');
  const b = req.body || {};
  const role = oneOf(b.role ?? u.role, ROLES, 'Rol');
  const active = b.active === undefined ? u.active : (b.active ? 1 : 0);
  if (u.id === req.user.id && (role !== 'owner' || !active)) throw bad('Kendi yetkinizi düşüremez veya hesabınızı pasif yapamazsınız');
  const staffId = b.staff_id ? ownRow('staff', b.staff_id, req.store.id, 'Personel bulunamadı').id : null;
  q.run('UPDATE users SET name = ?, role = ?, active = ?, staff_id = ? WHERE id = ?',
    str(b.name ?? u.name, { required: true, max: 100, name: 'Ad soyad' }), role, active, staffId, u.id);
  if (b.password) {
    if (String(b.password).length < 6) throw bad('Şifre en az 6 karakter olmalıdır');
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(b.password)), u.id);
    q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  }
  if (!active) q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  log(req, 'Kullanıcı güncellendi', u.email);
  res.json({ ok: true });
});

r.get('/activity', mgr, (req, res) => {
  const { limit, offset } = page(req, 100);
  res.json(q.all(`SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.store_id = ? ORDER BY a.id DESC LIMIT ? OFFSET ?`, req.store.id, limit, offset));
});

// ---- Yedek (tüm mağaza verisini JSON olarak indir) ----
const BACKUP_TABLES = [
  'categories', 'size_sets', 'suppliers', 'products', 'variants', 'stock_movements', 'customers', 'customer_ledger',
  'supplier_ledger', 'staff', 'sales', 'sale_items', 'payments', 'transactions', 'purchases', 'orders', 'tasks', 'day_closings',
];

r.get('/backup', owner, (req, res) => {
  const sid = req.store.id;
  const data = { app: 'DC Giyim Satış', version: 1, exported_at: localNow(req.store.timezone), store: req.store };
  for (const t of BACKUP_TABLES) data[t] = q.all(`SELECT * FROM ${t} WHERE store_id = ?`, sid);
  data.purchase_items = q.all('SELECT pi.* FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id WHERE p.store_id = ?', sid);
  data.order_items = q.all('SELECT oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.store_id = ?', sid);
  data.users = q.all('SELECT id, name, email, role, staff_id, active, created_at FROM users WHERE store_id = ?', sid);
  log(req, 'Yedek alındı');
  const fname = `dc-giyim-yedek-${data.exported_at.slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.json(data);
});

export default r;
