// Siparişler, personel, yapılacaklar
import { Router } from 'express';
import { q, insert, update, tx, nextCounter } from '../db.js';
import { isManager, requireRole } from '../auth.js';
import {
  bad, int, money, str, oneOf, optDate, localNow, localToday, log, ownRow, like, range, CASH_METHODS,
} from '../util.js';

const r = Router();
const mgr = requireRole('owner', 'manager');

// ======================= SİPARİŞLER =======================
export const ORDER_STATUSES = ['new', 'ordered', 'arrived', 'notified', 'delivered', 'cancelled'];

function readOrderItems(req, list) {
  if (!Array.isArray(list) || !list.length) throw bad('Siparişe en az bir ürün ekleyin');
  return list.map((it) => {
    const variant = it.variant_id ? ownRow('variants', it.variant_id, req.store.id, 'Varyant bulunamadı') : null;
    return {
      variant_id: variant?.id || null,
      description: str(it.description, { required: true, max: 200, name: 'Ürün açıklaması' }),
      size: str(it.size, { max: 20 }), color: str(it.color, { max: 40 }),
      qty: int(it.qty, { min: 1, max: 1000, name: 'Adet' }),
      unit_price: money(it.unit_price, { name: 'Fiyat' }),
    };
  });
}

r.get('/orders', (req, res) => {
  const where = ['o.store_id = ?'];
  const params = [req.store.id];
  const st = req.query.status || 'open';
  if (st === 'open') where.push("o.status NOT IN ('delivered','cancelled')");
  else if (st !== 'all') { where.push('o.status = ?'); params.push(st); }
  if (req.query.q) {
    where.push(`(o.no LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR o.phone LIKE ? ESCAPE '\\')`);
    const l = like(req.query.q); params.push(l, l, l);
  }
  const rows = q.all(`SELECT o.*, s.name AS staff_name,
      (SELECT GROUP_CONCAT(description || COALESCE(' ' || size, '') || ' x' || qty, ', ') FROM order_items WHERE order_id = o.id) AS summary
    FROM orders o LEFT JOIN staff s ON s.id = o.staff_id WHERE ${where.join(' AND ')}
    ORDER BY CASE WHEN o.status IN ('delivered','cancelled') THEN 1 ELSE 0 END, COALESCE(o.due_date, '9999'), o.id DESC LIMIT 300`, ...params);
  const counts = Object.fromEntries(q.all('SELECT status, COUNT(*) n FROM orders WHERE store_id = ? GROUP BY status', req.store.id).map((x) => [x.status, x.n]));
  res.json({ rows, counts });
});

r.get('/orders/:id', (req, res) => {
  const o = ownRow('orders', req.params.id, req.store.id, 'Sipariş bulunamadı');
  o.items = q.all(`SELECT oi.*, v.barcode, v.stock FROM order_items oi LEFT JOIN variants v ON v.id = oi.variant_id WHERE oi.order_id = ? ORDER BY oi.id`, o.id);
  o.staff_name = o.staff_id ? q.val('SELECT name FROM staff WHERE id = ?', o.staff_id) : null;
  o.sale_no = o.sale_id ? q.val('SELECT no FROM sales WHERE id = ?', o.sale_id) : null;
  o.deposits = q.all("SELECT * FROM transactions WHERE store_id = ? AND ref_type = 'order' AND ref_id = ? ORDER BY id", req.store.id, o.id);
  res.json(o);
});

r.post('/orders', (req, res) => {
  const b = req.body || {};
  const sid = req.store.id;
  const customer = b.customer_id ? ownRow('customers', b.customer_id, sid, 'Müşteri bulunamadı') : null;
  const items = readOrderItems(req, b.items);
  const total = items.reduce((s, x) => s + x.qty * x.unit_price, 0);
  const deposit = money(b.deposit ?? 0, { name: 'Kapora' });
  if (deposit > total) throw bad('Kapora, sipariş tutarını aşamaz');
  const method = oneOf(b.deposit_method || 'cash', CASH_METHODS, 'Kapora ödeme yöntemi');
  const now = localNow(req.store.timezone);
  const name = customer?.name || str(b.customer_name, { required: true, max: 120, name: 'Müşteri adı' });
  const id = tx(() => {
    const no = `SP${String(nextCounter(sid, 'order')).padStart(5, '0')}`;
    const oid = insert('orders', {
      store_id: sid, no, customer_id: customer?.id, customer_name: name, phone: customer?.phone || str(b.phone, { max: 20 }),
      staff_id: b.staff_id ? ownRow('staff', b.staff_id, sid, 'Personel bulunamadı').id : (req.user.staff_id || null),
      status: 'new', due_date: optDate(b.due_date, 'Teslim tarihi'), total, deposit, note: str(b.note, { max: 1000 }),
      user_id: req.user.id, created_at: now, updated_at: now,
    });
    items.forEach((it) => insert('order_items', { order_id: oid, ...it }));
    if (deposit) {
      insert('transactions', {
        store_id: sid, kind: 'income', category: 'Sipariş Kaporası', amount: deposit, method, date: now.slice(0, 10),
        description: `${no} — ${name}`, pl: 0, ref_type: 'order', ref_id: oid, customer_id: customer?.id, user_id: req.user.id, created_at: now,
      });
    }
    return oid;
  });
  log(req, 'Sipariş alındı', `${name} — ${(total / 100).toFixed(2)} ₺`);
  res.json({ id });
});

r.put('/orders/:id', (req, res) => {
  const o = ownRow('orders', req.params.id, req.store.id, 'Sipariş bulunamadı');
  if (o.status === 'delivered' || o.status === 'cancelled') throw bad('Kapanmış sipariş düzenlenemez');
  const b = req.body || {};
  const items = readOrderItems(req, b.items);
  const total = items.reduce((s, x) => s + x.qty * x.unit_price, 0);
  if (o.deposit > total) throw bad('Sipariş tutarı alınan kaporadan düşük olamaz');
  tx(() => {
    update('orders', o.id, req.store.id, {
      customer_name: str(b.customer_name ?? o.customer_name, { required: true, max: 120, name: 'Müşteri adı' }),
      phone: str(b.phone ?? o.phone, { max: 20 }), due_date: optDate(b.due_date, 'Teslim tarihi'),
      note: str(b.note, { max: 1000 }), total, updated_at: localNow(req.store.timezone),
      staff_id: b.staff_id ? ownRow('staff', b.staff_id, req.store.id).id : o.staff_id,
    });
    q.run('DELETE FROM order_items WHERE order_id = ?', o.id);
    items.forEach((it) => insert('order_items', { order_id: o.id, ...it }));
  });
  res.json({ ok: true });
});

r.post('/orders/:id/status', (req, res) => {
  const o = ownRow('orders', req.params.id, req.store.id, 'Sipariş bulunamadı');
  const status = oneOf(req.body?.status, ORDER_STATUSES.filter((s) => s !== 'delivered'), 'Durum');
  if (o.status === 'delivered') throw bad('Teslim edilmiş siparişin durumu değiştirilemez');
  if (o.status === 'cancelled') throw bad('İptal edilmiş sipariş yeniden açılamaz');
  const now = localNow(req.store.timezone);
  tx(() => {
    q.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', status, now, o.id);
    // İptalde kapora iadesi (isteğe bağlı)
    if (status === 'cancelled' && o.deposit > 0 && req.body?.refund_deposit) {
      insert('transactions', {
        store_id: req.store.id, kind: 'expense', category: 'Kapora İadesi', amount: o.deposit, method: oneOf(req.body.refund_method || 'cash', CASH_METHODS),
        date: now.slice(0, 10), description: `${o.no} — ${o.customer_name}`, pl: 0, ref_type: 'order', ref_id: o.id, customer_id: o.customer_id, user_id: req.user.id, created_at: now,
      });
      q.run('UPDATE orders SET deposit = 0 WHERE id = ?', o.id);
    } else if (status === 'cancelled' && o.deposit > 0) {
      // Kapora iade edilmediyse kâra yansır. Nakit, kapora alınırken kasaya zaten girdiği için yöntem 'none' (kasayı etkilemez).
      insert('transactions', {
        store_id: req.store.id, kind: 'income', category: 'Yanan Kapora', amount: o.deposit, method: 'none', date: now.slice(0, 10),
        description: `${o.no} — ${o.customer_name} (iade edilmedi)`, pl: 1, ref_type: 'order_forfeit', ref_id: o.id, user_id: req.user.id, created_at: now,
      });
    }
  });
  log(req, 'Sipariş durumu', `${o.no}: ${status}`);
  res.json({ ok: true });
});

r.post('/orders/:id/deposit', (req, res) => {
  const o = ownRow('orders', req.params.id, req.store.id, 'Sipariş bulunamadı');
  if (['delivered', 'cancelled'].includes(o.status)) throw bad('Kapalı siparişe kapora eklenemez');
  const amount = money(req.body?.amount, { min: 1, name: 'Kapora' });
  if (o.deposit + amount > o.total) throw bad('Toplam kapora, sipariş tutarını aşamaz');
  const method = oneOf(req.body?.method || 'cash', CASH_METHODS, 'Ödeme yöntemi');
  const now = localNow(req.store.timezone);
  tx(() => {
    q.run('UPDATE orders SET deposit = deposit + ?, updated_at = ? WHERE id = ?', amount, now, o.id);
    insert('transactions', {
      store_id: req.store.id, kind: 'income', category: 'Sipariş Kaporası', amount, method, date: now.slice(0, 10),
      description: `${o.no} — ${o.customer_name} (ek kapora)`, pl: 0, ref_type: 'order', ref_id: o.id, customer_id: o.customer_id, user_id: req.user.id, created_at: now,
    });
  });
  res.json({ ok: true });
});

// ======================= PERSONEL =======================
function readStaff(b) {
  return {
    name: str(b.name, { required: true, max: 120, name: 'Ad soyad' }),
    phone: str(b.phone, { max: 20 }), email: str(b.email, { max: 120 }),
    position: str(b.position, { max: 60, name: 'Görev' }),
    tc_no: str(b.tc_no, { max: 11, name: 'TC kimlik no' }),
    iban: str(b.iban, { max: 40 }),
    start_date: optDate(b.start_date, 'İşe giriş tarihi'), end_date: optDate(b.end_date, 'Çıkış tarihi'),
    salary: money(b.salary ?? 0, { name: 'Maaş' }),
    commission_rate: (() => {
      const n = Number(b.commission_rate || 0);
      if (!(n >= 0 && n <= 100)) throw bad('Prim oranı 0 ile 100 arasında olmalıdır');
      return n;
    })(),
    notes: str(b.notes, { max: 1000 }),
  };
}

r.get('/staff', (req, res) => {
  const { fromTs, toTs, from, to } = range(req, 30);
  const month = localToday(req.store.timezone).slice(0, 7);
  const rows = q.all(`SELECT st.*,
      (SELECT COALESCE(SUM(total),0) FROM sales s WHERE s.staff_id = st.id AND s.created_at BETWEEN ? AND ?) AS sales_total,
      (SELECT COUNT(*) FROM sales s WHERE s.staff_id = st.id AND s.total > 0 AND s.created_at BETWEEN ? AND ?) AS sales_count,
      (SELECT COALESCE(SUM(item_count),0) FROM sales s WHERE s.staff_id = st.id AND s.created_at BETWEEN ? AND ?) AS items,
      (SELECT COALESCE(SUM(amount),0) FROM transactions t WHERE t.staff_id = st.id AND t.kind = 'expense' AND substr(t.date,1,7) = ?) AS paid_this_month,
      (SELECT COALESCE(SUM(amount),0) FROM transactions t WHERE t.staff_id = st.id AND t.category = 'Avans' AND substr(t.date,1,7) = ?) AS advance_this_month,
      (SELECT u.id FROM users u WHERE u.staff_id = st.id AND u.active = 1 LIMIT 1) AS user_id
    FROM staff st WHERE st.store_id = ? AND (st.active = 1 OR ? = 'all') ORDER BY st.active DESC, st.name COLLATE NOCASE`,
  fromTs, toTs, fromTs, toTs, fromTs, toTs, month, month, req.store.id, req.query.status || 'active');
  rows.forEach((s) => {
    s.commission = Math.round((s.sales_total * s.commission_rate) / 100);
    if (!isManager(req)) { delete s.salary; delete s.tc_no; delete s.iban; delete s.paid_this_month; delete s.advance_this_month; delete s.commission; }
  });
  res.json({ from, to, rows });
});

r.get('/staff/:id', mgr, (req, res) => {
  const st = ownRow('staff', req.params.id, req.store.id, 'Personel bulunamadı');
  const { fromTs, toTs, from, to } = range(req, 30);
  st.range = { from, to };
  st.perf = q.get(`SELECT COALESCE(SUM(total),0) AS total, COUNT(CASE WHEN total > 0 THEN 1 END) AS count,
      COALESCE(SUM(item_count),0) AS items, COALESCE(SUM(total - cost_total),0) AS profit
    FROM sales WHERE staff_id = ? AND created_at BETWEEN ? AND ?`, st.id, fromTs, toTs);
  st.perf.commission = Math.round((st.perf.total * st.commission_rate) / 100);
  st.perf.avg_basket = st.perf.count ? Math.round(st.perf.total / st.perf.count) : 0;
  st.daily = q.all(`SELECT substr(created_at,1,10) AS d, SUM(total) AS total, COUNT(*) AS n FROM sales
    WHERE staff_id = ? AND created_at BETWEEN ? AND ? GROUP BY d ORDER BY d`, st.id, fromTs, toTs);
  st.payments = q.all("SELECT * FROM transactions WHERE staff_id = ? AND store_id = ? ORDER BY date DESC, id DESC LIMIT 100", st.id, req.store.id);
  st.monthly = q.all(`SELECT substr(created_at,1,7) AS m, SUM(total) AS total, COUNT(*) AS n FROM sales
    WHERE staff_id = ? GROUP BY m ORDER BY m DESC LIMIT 12`, st.id);
  st.monthly.forEach((m) => { m.commission = Math.round((m.total * st.commission_rate) / 100); });
  res.json(st);
});

r.post('/staff', mgr, (req, res) => {
  const data = readStaff(req.body || {});
  const id = insert('staff', { store_id: req.store.id, ...data, created_at: localNow(req.store.timezone) });
  log(req, 'Personel eklendi', data.name);
  res.json({ id });
});

r.put('/staff/:id', mgr, (req, res) => {
  const st = ownRow('staff', req.params.id, req.store.id, 'Personel bulunamadı');
  const data = readStaff(req.body || {});
  update('staff', st.id, req.store.id, { ...data, active: req.body?.active === 0 || req.body?.active === false ? 0 : 1 });
  if (req.body?.active === 0 || req.body?.active === false) q.run('UPDATE users SET active = 0 WHERE staff_id = ? AND role != ?', st.id, 'owner');
  res.json({ ok: true });
});

// Maaş / avans / prim ödemesi
r.post('/staff/:id/pay', mgr, (req, res) => {
  const st = ownRow('staff', req.params.id, req.store.id, 'Personel bulunamadı');
  const category = oneOf(req.body?.category, ['Maaş', 'Avans', 'Prim', 'Mesai', 'Yol/Yemek'], 'Ödeme türü');
  const amount = money(req.body?.amount, { min: 1, name: 'Tutar' });
  const method = oneOf(req.body?.method || 'cash', CASH_METHODS, 'Ödeme yöntemi');
  const now = localNow(req.store.timezone);
  insert('transactions', {
    store_id: req.store.id, kind: 'expense', category, amount, method, date: optDate(req.body?.date) || now.slice(0, 10),
    description: `${st.name}${req.body?.note ? ' — ' + str(req.body.note, { max: 200 }) : ''}`, pl: 1, staff_id: st.id, user_id: req.user.id, created_at: now,
  });
  log(req, 'Personel ödemesi', `${st.name}: ${category} ${(amount / 100).toFixed(2)} ₺`);
  res.json({ ok: true });
});

// ======================= YAPILACAKLAR =======================
r.get('/tasks', (req, res) => {
  res.json(q.all(`SELECT t.*, u.name AS user_name FROM tasks t LEFT JOIN users u ON u.id = t.user_id
    WHERE t.store_id = ? AND (t.done = 0 OR t.done_at >= date(?, '-7 days'))
    ORDER BY t.done, COALESCE(t.due_date, '9999'), t.id`, req.store.id, localToday(req.store.timezone)));
});
r.post('/tasks', (req, res) => {
  const id = insert('tasks', {
    store_id: req.store.id, title: str(req.body?.title, { required: true, max: 200, name: 'Görev' }),
    due_date: optDate(req.body?.due_date), user_id: req.user.id, created_at: localNow(req.store.timezone),
  });
  res.json({ id });
});
r.put('/tasks/:id', (req, res) => {
  const t = ownRow('tasks', req.params.id, req.store.id);
  const done = req.body?.done ? 1 : 0;
  update('tasks', t.id, req.store.id, {
    done, done_at: done ? localNow(req.store.timezone) : null,
    title: req.body?.title !== undefined ? str(req.body.title, { required: true, max: 200, name: 'Görev' }) : t.title,
    due_date: req.body?.due_date !== undefined ? optDate(req.body.due_date) : t.due_date,
  });
  res.json({ ok: true });
});
r.delete('/tasks/:id', (req, res) => {
  const t = ownRow('tasks', req.params.id, req.store.id);
  q.run('DELETE FROM tasks WHERE id = ?', t.id);
  res.json({ ok: true });
});

export default r;
