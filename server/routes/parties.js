// Müşteriler, tedarikçiler ve mal alımları (alış faturaları)
import { Router } from 'express';
import { q, insert, update, tx } from '../db.js';
import { isManager, requireRole } from '../auth.js';
import { moveStock } from '../stock.js';
import {
  bad, int, money, str, oneOf, optDate, localNow, localToday, addDays, log, ownRow, like, page, CASH_METHODS,
} from '../util.js';

const r = Router();
const mgr = requireRole('owner', 'manager');

const normPhone = (p) => {
  const s = String(p || '').replace(/\D/g, '');
  if (!s) return null;
  if (s.length === 10 && s.startsWith('5')) return `0${s}`;
  if (s.length === 12 && s.startsWith('90')) return `0${s.slice(2)}`;
  return s.slice(0, 20);
};

// ======================= MÜŞTERİLER =======================
function readCustomer(b) {
  const birthday = b.birthday ? String(b.birthday) : null;
  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw bad('Doğum tarihi geçersiz');
  return {
    name: str(b.name, { required: true, max: 120, name: 'Müşteri adı' }),
    phone: normPhone(b.phone),
    email: str(b.email, { max: 120, name: 'E-posta' }),
    birthday,
    gender: str(b.gender, { max: 20 }),
    city: str(b.city, { max: 60 }),
    address: str(b.address, { max: 400, name: 'Adres' }),
    tax_no: str(b.tax_no, { max: 20, name: 'TC/Vergi no' }),
    sizes_note: str(b.sizes_note, { max: 300, name: 'Beden notu' }),
    notes: str(b.notes, { max: 1000, name: 'Not' }),
    credit_limit: b.credit_limit === '' || b.credit_limit == null ? null : money(b.credit_limit, { name: 'Veresiye limiti' }),
  };
}

r.get('/customers', (req, res) => {
  const sid = req.store.id;
  const where = ['c.store_id = ?', 'c.active = 1'];
  const params = [sid];
  if (req.query.q) {
    where.push(`(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')`);
    const l = like(req.query.q);
    const digits = String(req.query.q).replace(/\D/g, '');
    params.push(l, digits.length >= 3 ? like(digits) : l, l);
  }
  const today = localToday(req.store.timezone);
  if (req.query.filter === 'debt') where.push('(SELECT COALESCE(SUM(amount),0) FROM customer_ledger l WHERE l.customer_id = c.id) > 0');
  if (req.query.filter === 'birthday') {
    const days = Array.from({ length: 30 }, (_, i) => addDays(today, i).slice(5));
    where.push(`substr(c.birthday, 6, 5) IN (${days.map(() => '?').join(',')})`);
    params.push(...days);
  }
  if (req.query.filter === 'inactive') {
    where.push("COALESCE((SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id), '0') < date(?, '-90 days')");
    params.push(today);
  }
  const sorts = { name: 'c.name COLLATE NOCASE', spent: 'spent DESC', balance: 'balance DESC', recent: 'last_visit DESC', new: 'c.id DESC' };
  const w = where.join(' AND ');
  const { limit, offset } = page(req, 50);
  const total = q.val(`SELECT COUNT(*) FROM customers c WHERE ${w}`, ...params);
  const rows = q.all(`SELECT c.*,
      (SELECT COALESCE(SUM(amount),0) FROM customer_ledger l WHERE l.customer_id = c.id) AS balance,
      (SELECT COALESCE(SUM(total),0) FROM sales s WHERE s.customer_id = c.id) AS spent,
      (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.total > 0) AS visits,
      (SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id) AS last_visit
    FROM customers c WHERE ${w} ORDER BY ${req.query.filter === 'birthday' ? `(substr(c.birthday, 6, 5) < '${today.slice(5)}'), substr(c.birthday, 6, 5)` : (sorts[req.query.sort] || sorts.name)} LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ total, rows });
});

r.get('/customers/:id', (req, res) => {
  const c = ownRow('customers', req.params.id, req.store.id, 'Müşteri bulunamadı');
  c.balance = q.val('SELECT COALESCE(SUM(amount),0) FROM customer_ledger WHERE customer_id = ?', c.id);
  c.stats = q.get(`SELECT COALESCE(SUM(total),0) AS spent, COUNT(CASE WHEN total > 0 THEN 1 END) AS visits,
      MIN(created_at) AS first_visit, MAX(created_at) AS last_visit, COALESCE(SUM(item_count),0) AS items
    FROM sales WHERE customer_id = ?`, c.id);
  c.ledger = q.all(`SELECT l.*, u.name AS user_name, (SELECT no FROM sales WHERE id = l.ref_id AND l.ref_type = 'sale') AS sale_no
    FROM customer_ledger l LEFT JOIN users u ON u.id = l.user_id WHERE l.customer_id = ? ORDER BY l.id DESC LIMIT 200`, c.id);
  c.sales = q.all(`SELECT s.id, s.no, s.total, s.item_count, s.created_at, s.has_return,
      (SELECT GROUP_CONCAT(name || ' ' || size, ', ') FROM sale_items WHERE sale_id = s.id AND qty > 0) AS summary
    FROM sales s WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 100`, c.id);
  c.orders = q.all('SELECT id, no, status, total, deposit, due_date, created_at FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 50', c.id);
  c.top_sizes = q.all(`SELECT si.size, COUNT(*) n FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.customer_id = ? AND si.qty > 0 AND si.size != '' GROUP BY si.size ORDER BY n DESC LIMIT 5`, c.id);
  c.top_categories = q.all(`SELECT cat.name, SUM(si.qty) n FROM sale_items si JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id JOIN categories cat ON cat.id = p.category_id
    WHERE s.customer_id = ? AND si.qty > 0 GROUP BY cat.id ORDER BY n DESC LIMIT 5`, c.id);
  res.json(c);
});

r.post('/customers', (req, res) => {
  const data = readCustomer(req.body || {});
  if (data.phone && q.get('SELECT 1 FROM customers WHERE store_id = ? AND phone = ? AND active = 1', req.store.id, data.phone)) {
    throw bad('Bu telefon numarasıyla kayıtlı bir müşteri zaten var');
  }
  const id = insert('customers', { store_id: req.store.id, ...data, created_at: localNow(req.store.timezone) });
  const opening = int(req.body?.opening_balance, { min: -1e12, max: 1e12, def: 0 });
  if (opening && isManager(req)) {
    insert('customer_ledger', { store_id: req.store.id, customer_id: id, amount: opening, type: 'opening', note: 'Açılış bakiyesi', user_id: req.user.id, created_at: localNow(req.store.timezone) });
  }
  log(req, 'Müşteri eklendi', data.name);
  res.json({ id });
});

r.put('/customers/:id', (req, res) => {
  const c = ownRow('customers', req.params.id, req.store.id, 'Müşteri bulunamadı');
  const data = readCustomer(req.body || {});
  if (data.phone && q.get('SELECT 1 FROM customers WHERE store_id = ? AND phone = ? AND active = 1 AND id != ?', req.store.id, data.phone, c.id)) {
    throw bad('Bu telefon numarasıyla kayıtlı başka bir müşteri var');
  }
  if (!isManager(req)) delete data.credit_limit;
  update('customers', c.id, req.store.id, data);
  res.json({ ok: true });
});

r.delete('/customers/:id', mgr, (req, res) => {
  const c = ownRow('customers', req.params.id, req.store.id, 'Müşteri bulunamadı');
  const bal = q.val('SELECT COALESCE(SUM(amount),0) FROM customer_ledger WHERE customer_id = ?', c.id);
  if (bal !== 0) throw bad('Bakiyesi sıfır olmayan müşteri silinemez');
  if (q.get('SELECT 1 FROM sales WHERE customer_id = ? LIMIT 1', c.id) || q.get('SELECT 1 FROM customer_ledger WHERE customer_id = ? LIMIT 1', c.id)) {
    q.run('UPDATE customers SET active = 0 WHERE id = ?', c.id);
  } else q.run('DELETE FROM customers WHERE id = ?', c.id);
  log(req, 'Müşteri silindi', c.name);
  res.json({ ok: true });
});

// Veresiye tahsilatı
r.post('/customers/:id/collect', (req, res) => {
  const c = ownRow('customers', req.params.id, req.store.id, 'Müşteri bulunamadı');
  const amount = money(req.body?.amount, { min: 1, name: 'Tahsilat tutarı' });
  const method = oneOf(req.body?.method || 'cash', CASH_METHODS, 'Ödeme yöntemi');
  const note = str(req.body?.note, { max: 200 });
  const now = localNow(req.store.timezone);
  tx(() => {
    const lid = insert('customer_ledger', { store_id: req.store.id, customer_id: c.id, amount: -amount, type: 'payment', method, note: note || 'Tahsilat', user_id: req.user.id, created_at: now });
    insert('transactions', {
      store_id: req.store.id, kind: 'income', category: 'Veresiye Tahsilatı', amount, method, date: now.slice(0, 10),
      description: `${c.name}${note ? ' — ' + note : ''}`, pl: 0, ref_type: 'customer_ledger', ref_id: lid, customer_id: c.id, user_id: req.user.id, created_at: now,
    });
  });
  log(req, 'Tahsilat alındı', `${c.name}: ${(amount / 100).toFixed(2)} ₺`);
  res.json({ ok: true, balance: q.val('SELECT COALESCE(SUM(amount),0) FROM customer_ledger WHERE customer_id = ?', c.id) });
});

// Manuel borç/alacak kaydı (açılış bakiyesi, düzeltme)
r.post('/customers/:id/ledger', mgr, (req, res) => {
  const c = ownRow('customers', req.params.id, req.store.id, 'Müşteri bulunamadı');
  const amount = int(req.body?.amount, { min: -1e12, max: 1e12, name: 'Tutar', required: true });
  if (!amount) throw bad('Tutar sıfır olamaz');
  insert('customer_ledger', {
    store_id: req.store.id, customer_id: c.id, amount, type: 'adjust', due_date: optDate(req.body?.due_date),
    note: str(req.body?.note, { max: 200 }) || 'Manuel kayıt', user_id: req.user.id, created_at: localNow(req.store.timezone),
  });
  log(req, 'Müşteri bakiyesi düzeltildi', `${c.name}: ${(amount / 100).toFixed(2)} ₺`);
  res.json({ ok: true });
});

// ======================= TEDARİKÇİLER =======================
function readSupplier(b) {
  return {
    name: str(b.name, { required: true, max: 120, name: 'Firma adı' }),
    contact: str(b.contact, { max: 100, name: 'Yetkili' }),
    phone: normPhone(b.phone),
    email: str(b.email, { max: 120 }),
    address: str(b.address, { max: 400 }),
    tax_office: str(b.tax_office, { max: 60 }),
    tax_no: str(b.tax_no, { max: 20 }),
    iban: str(b.iban, { max: 40 }),
    notes: str(b.notes, { max: 1000 }),
  };
}

r.get('/suppliers', mgr, (req, res) => {
  const where = ['s.store_id = ?', 's.active = 1'];
  const params = [req.store.id];
  if (req.query.q) { where.push(`(s.name LIKE ? ESCAPE '\\' OR s.contact LIKE ? ESCAPE '\\')`); params.push(like(req.query.q), like(req.query.q)); }
  res.json(q.all(`SELECT s.*,
      (SELECT COALESCE(SUM(amount),0) FROM supplier_ledger l WHERE l.supplier_id = s.id) AS balance,
      (SELECT COALESCE(SUM(total),0) FROM purchases p WHERE p.supplier_id = s.id) AS purchased,
      (SELECT MAX(date) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase,
      (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.active = 1) AS product_count
    FROM suppliers s WHERE ${where.join(' AND ')} ORDER BY s.name COLLATE NOCASE`, ...params));
});

r.get('/suppliers/:id', mgr, (req, res) => {
  const s = ownRow('suppliers', req.params.id, req.store.id, 'Tedarikçi bulunamadı');
  s.balance = q.val('SELECT COALESCE(SUM(amount),0) FROM supplier_ledger WHERE supplier_id = ?', s.id);
  s.ledger = q.all(`SELECT l.*, u.name AS user_name FROM supplier_ledger l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.supplier_id = ? ORDER BY l.id DESC LIMIT 200`, s.id);
  s.purchases = q.all('SELECT * FROM purchases WHERE supplier_id = ? ORDER BY date DESC, id DESC LIMIT 100', s.id);
  s.products = q.all(`SELECT p.id, p.name, p.code, p.sale_price, p.buy_price,
      (SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS stock,
      (SELECT COALESCE(SUM(qty),0) FROM sale_items si WHERE si.product_id = p.id) AS sold
    FROM products p WHERE p.supplier_id = ? AND p.active = 1 ORDER BY sold DESC LIMIT 100`, s.id);
  res.json(s);
});

r.post('/suppliers', mgr, (req, res) => {
  const data = readSupplier(req.body || {});
  const now = localNow(req.store.timezone);
  const id = insert('suppliers', { store_id: req.store.id, ...data, created_at: now });
  const opening = int(req.body?.opening_balance, { min: -1e12, max: 1e12, def: 0 });
  if (opening) insert('supplier_ledger', { store_id: req.store.id, supplier_id: id, amount: opening, type: 'opening', note: 'Açılış bakiyesi', user_id: req.user.id, created_at: now });
  log(req, 'Tedarikçi eklendi', data.name);
  res.json({ id });
});

r.put('/suppliers/:id', mgr, (req, res) => {
  const s = ownRow('suppliers', req.params.id, req.store.id, 'Tedarikçi bulunamadı');
  update('suppliers', s.id, req.store.id, readSupplier(req.body || {}));
  res.json({ ok: true });
});

r.delete('/suppliers/:id', mgr, (req, res) => {
  const s = ownRow('suppliers', req.params.id, req.store.id, 'Tedarikçi bulunamadı');
  if (q.val('SELECT COALESCE(SUM(amount),0) FROM supplier_ledger WHERE supplier_id = ?', s.id) !== 0) throw bad('Bakiyesi sıfır olmayan tedarikçi silinemez');
  q.run('UPDATE suppliers SET active = 0 WHERE id = ?', s.id);
  log(req, 'Tedarikçi silindi', s.name);
  res.json({ ok: true });
});

r.post('/suppliers/:id/pay', mgr, (req, res) => {
  const s = ownRow('suppliers', req.params.id, req.store.id, 'Tedarikçi bulunamadı');
  const amount = money(req.body?.amount, { min: 1, name: 'Ödeme tutarı' });
  const method = oneOf(req.body?.method || 'cash', CASH_METHODS, 'Ödeme yöntemi');
  const note = str(req.body?.note, { max: 200 });
  const now = localNow(req.store.timezone);
  tx(() => payToSupplier(req, s, amount, method, note || 'Ödeme', now));
  log(req, 'Tedarikçiye ödeme', `${s.name}: ${(amount / 100).toFixed(2)} ₺`);
  res.json({ ok: true });
});

function payToSupplier(req, s, amount, method, note, now, ref = {}) {
  const lid = insert('supplier_ledger', { store_id: req.store.id, supplier_id: s.id, amount: -amount, type: 'payment', method, note, user_id: req.user.id, created_at: now, ...ref });
  insert('transactions', {
    store_id: req.store.id, kind: 'expense', category: 'Tedarikçi Ödemesi', amount, method, date: now.slice(0, 10),
    description: `${s.name} — ${note}`, pl: 0, ref_type: 'supplier_ledger', ref_id: lid, supplier_id: s.id, user_id: req.user.id, created_at: now,
  });
}

r.post('/suppliers/:id/ledger', mgr, (req, res) => {
  const s = ownRow('suppliers', req.params.id, req.store.id, 'Tedarikçi bulunamadı');
  const amount = int(req.body?.amount, { min: -1e12, max: 1e12, name: 'Tutar', required: true });
  if (!amount) throw bad('Tutar sıfır olamaz');
  insert('supplier_ledger', {
    store_id: req.store.id, supplier_id: s.id, amount, type: 'adjust', due_date: optDate(req.body?.due_date),
    note: str(req.body?.note, { max: 200 }) || 'Manuel kayıt', user_id: req.user.id, created_at: localNow(req.store.timezone),
  });
  res.json({ ok: true });
});

// ======================= MAL ALIMI =======================
r.get('/purchases', mgr, (req, res) => {
  const { limit, offset } = page(req, 100);
  res.json(q.all(`SELECT p.*, s.name AS supplier_name, u.name AS user_name FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id
    WHERE p.store_id = ? ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?`, req.store.id, limit, offset));
});

r.get('/purchases/:id', mgr, (req, res) => {
  const p = ownRow('purchases', req.params.id, req.store.id, 'Alış bulunamadı');
  p.supplier_name = p.supplier_id ? q.val('SELECT name FROM suppliers WHERE id = ?', p.supplier_id) : null;
  p.items = q.all(`SELECT pi.*, v.size, v.color, v.barcode, pr.name, pr.code, pr.id AS product_id FROM purchase_items pi
    JOIN variants v ON v.id = pi.variant_id JOIN products pr ON pr.id = v.product_id WHERE pi.purchase_id = ? ORDER BY pi.id`, p.id);
  res.json(p);
});

r.post('/purchases', mgr, (req, res) => {
  const b = req.body || {};
  const sid = req.store.id;
  const supplier = b.supplier_id ? ownRow('suppliers', b.supplier_id, sid, 'Tedarikçi bulunamadı') : null;
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw bad('Alış listesi boş');
  const date = optDate(b.date) || localToday(req.store.timezone);
  const now = localNow(req.store.timezone);
  const paid = money(b.paid_amount ?? 0, { name: 'Ödenen tutar' });
  const method = oneOf(b.paid_method || 'cash', CASH_METHODS, 'Ödeme yöntemi');
  if (paid && !supplier) throw bad('Ödeme kaydı için tedarikçi seçin');
  const id = tx(() => {
    const parsed = items.map((it) => ({
      v: ownRow('variants', it.variant_id, sid, 'Varyant bulunamadı'),
      qty: int(it.qty, { min: 1, max: 100000, name: 'Adet' }),
      cost: money(it.unit_cost, { name: 'Birim maliyet' }),
    }));
    const total = parsed.reduce((s, x) => s + x.qty * x.cost, 0);
    const pid = insert('purchases', {
      store_id: sid, supplier_id: supplier?.id, invoice_no: str(b.invoice_no, { max: 50, name: 'Fatura no' }), date, total,
      item_count: parsed.reduce((s, x) => s + x.qty, 0), note: str(b.note, { max: 300 }), user_id: req.user.id, created_at: now,
    });
    // Ağırlıklı ortalama maliyet güncellemesi (ürün bazında)
    const byProduct = new Map();
    for (const x of parsed) {
      insert('purchase_items', { purchase_id: pid, variant_id: x.v.id, qty: x.qty, unit_cost: x.cost });
      const agg = byProduct.get(x.v.product_id) || { qty: 0, cost: 0 };
      agg.qty += x.qty; agg.cost += x.qty * x.cost;
      byProduct.set(x.v.product_id, agg);
    }
    if (b.update_cost !== false) {
      for (const [productId, agg] of byProduct) {
        const p = q.get('SELECT buy_price FROM products WHERE id = ?', productId);
        const stock = Math.max(0, q.val('SELECT COALESCE(SUM(stock),0) FROM variants WHERE product_id = ? AND active = 1', productId));
        const avg = stock + agg.qty > 0 ? Math.round((stock * p.buy_price + agg.cost) / (stock + agg.qty)) : p.buy_price;
        q.run('UPDATE products SET buy_price = ?, updated_at = ? WHERE id = ?', avg, now, productId);
      }
    }
    for (const x of parsed) {
      moveStock({ storeId: sid, variantId: x.v.id, qty: x.qty, type: 'purchase', refType: 'purchase', refId: pid, note: supplier ? supplier.name : 'Mal alımı', userId: req.user.id, now });
    }
    if (supplier) {
      insert('supplier_ledger', {
        store_id: sid, supplier_id: supplier.id, amount: total, type: 'purchase', ref_type: 'purchase', ref_id: pid,
        due_date: optDate(b.due_date), note: `Alış faturası ${b.invoice_no || '#' + pid}`, user_id: req.user.id, created_at: now,
      });
      if (paid) payToSupplier(req, supplier, paid, method, `Alış ödemesi ${b.invoice_no || '#' + pid}`, now);
    }
    return pid;
  });
  log(req, 'Mal alımı yapıldı', `${supplier?.name || 'Tedarikçisiz'} — #${id}`);
  res.json({ id });
});

export default r;
