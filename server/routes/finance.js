// Gelir-gider, kasa durumu ve gün sonu (kasa kapanışı)
import { Router } from 'express';
import { q, insert, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { bad, money, str, oneOf, optDate, localNow, log, ownRow, range, like, CASH_METHODS } from '../util.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../defaults.js';

const r = Router();
const mgr = requireRole('owner', 'manager');

// Kâr/zarara yansımayan (sadece para hareketi olan) kategoriler
const NON_PL = ['Veresiye Tahsilatı', 'Tedarikçi Ödemesi', 'Sipariş Kaporası', 'Kapora İadesi', 'Kasa Açılış', 'Ortak Para Girişi', 'Ortak Para Çekişi', 'Bankaya Yatan', 'Bankadan Çekilen'];

r.get('/transactions/meta', (req, res) => {
  const used = q.all('SELECT DISTINCT kind, category FROM transactions WHERE store_id = ?', req.store.id);
  const exp = new Set(EXPENSE_CATEGORIES); const inc = new Set(INCOME_CATEGORIES);
  used.forEach((u) => (u.kind === 'expense' ? exp : inc).add(u.category));
  ['Ortak Para Girişi'].forEach((c) => inc.add(c));
  ['Ortak Para Çekişi'].forEach((c) => exp.add(c));
  res.json({ expense: [...exp], income: [...inc], nonPl: NON_PL });
});

r.get('/transactions', mgr, (req, res) => {
  const { from, to } = range(req, 30);
  const where = ['t.store_id = ?', 't.date BETWEEN ? AND ?'];
  const params = [req.store.id, from, to];
  if (req.query.kind) { where.push('t.kind = ?'); params.push(String(req.query.kind)); }
  if (req.query.category) { where.push('t.category = ?'); params.push(String(req.query.category)); }
  if (req.query.method) { where.push('t.method = ?'); params.push(String(req.query.method)); }
  if (req.query.q) { where.push(`t.description LIKE ? ESCAPE '\\'`); params.push(like(req.query.q)); }
  const w = where.join(' AND ');
  const rows = q.all(`SELECT t.*, u.name AS user_name, s.name AS staff_name FROM transactions t
    LEFT JOIN users u ON u.id = t.user_id LEFT JOIN staff s ON s.id = t.staff_id
    WHERE ${w} ORDER BY t.date DESC, t.id DESC LIMIT 1000`, ...params);
  const byCategory = q.all(`SELECT kind, category, SUM(amount) AS total, COUNT(*) n FROM transactions t WHERE ${w} GROUP BY kind, category ORDER BY total DESC`, ...params);
  const totals = q.get(`SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN kind='expense' THEN amount END),0) AS expense,
      COALESCE(SUM(CASE WHEN kind='expense' AND pl=1 THEN amount END),0) AS pl_expense,
      COALESCE(SUM(CASE WHEN kind='income' AND pl=1 THEN amount END),0) AS pl_income
    FROM transactions t WHERE ${w}`, ...params);
  res.json({ from, to, rows, byCategory, totals });
});

r.post('/transactions', (req, res) => {
  const b = req.body || {};
  const kind = oneOf(b.kind, ['income', 'expense'], 'Tür');
  const category = str(b.category, { required: true, max: 60, name: 'Kategori' });
  const amount = money(b.amount, { min: 1, name: 'Tutar' });
  const method = oneOf(b.method || 'cash', CASH_METHODS, 'Ödeme yöntemi');
  const now = localNow(req.store.timezone);
  const id = insert('transactions', {
    store_id: req.store.id, kind, category, amount, method, date: optDate(b.date) || now.slice(0, 10),
    description: str(b.description, { max: 300, name: 'Açıklama' }), pl: NON_PL.includes(category) ? 0 : 1,
    user_id: req.user.id, created_at: now,
  });
  log(req, kind === 'income' ? 'Gelir eklendi' : 'Gider eklendi', `${category}: ${(amount / 100).toFixed(2)} ₺`);
  res.json({ id });
});

r.delete('/transactions/:id', mgr, (req, res) => {
  const t = ownRow('transactions', req.params.id, req.store.id, 'Kayıt bulunamadı');
  if (t.ref_type) throw bad('Bu kayıt otomatik oluşturuldu (tahsilat, kapora, tedarikçi ödemesi). İlgili ekrandan düzeltme yapın.');
  q.run('DELETE FROM transactions WHERE id = ?', t.id);
  log(req, 'Gelir/gider silindi', `${t.category}: ${(t.amount / 100).toFixed(2)} ₺`);
  res.json({ ok: true });
});

// ---- Kasa ----
// Akışlar kayıt kimliklerine (id) göre hesaplanır; böylece gün sonu anında yapılan işlemler asla kaybolmaz veya iki kez sayılmaz.
function flows(storeId, cond) {
  const out = {};
  const pw = cond.ids ? 'id > ?' : 'created_at BETWEEN ? AND ?';
  const pp = cond.ids ? [cond.ids.payment] : [cond.from, cond.to];
  const tw = cond.ids ? 'id > ?' : 'created_at BETWEEN ? AND ?';
  const tp = cond.ids ? [cond.ids.tx] : [cond.from, cond.to];
  for (const m of CASH_METHODS) {
    const sales = q.get(`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END),0) AS inn, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END),0) AS refund
      FROM payments WHERE store_id = ? AND method = ? AND ${pw}`, storeId, m, ...pp);
    const t = q.get(`SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount END),0) AS inc, COALESCE(SUM(CASE WHEN kind='expense' THEN amount END),0) AS exp
      FROM transactions WHERE store_id = ? AND method = ? AND ${tw}`, storeId, m, ...tp);
    out[m] = { sales: sales.inn, refunds: sales.refund, income: t.inc, expense: t.exp, net: sales.inn - sales.refund + t.inc - t.exp };
  }
  return out;
}

export function cashSummary(store) {
  const last = q.get('SELECT * FROM day_closings WHERE store_id = ? ORDER BY id DESC LIMIT 1', store.id);
  const ids = { payment: last?.last_payment_id || 0, tx: last?.last_tx_id || 0, sale: last?.last_sale_id || 0 };
  const f = flows(store.id, { ids });
  const opening = last ? last.counted_cash : 0;
  return { last_closing: last || null, ids, opening, flows: f, expected_cash: opening + f.cash.net };
}

r.get('/cash', mgr, (req, res) => {
  const s = cashSummary(req.store);
  const today = localNow(req.store.timezone).slice(0, 10);
  s.today = flows(req.store.id, { from: `${today} 00:00:00`, to: `${today} 23:59:59` });
  s.today_sales = q.get('SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM sales WHERE store_id = ? AND created_at >= ?', req.store.id, `${today} 00:00:00`);
  s.period_sales = q.get('SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM sales WHERE store_id = ? AND id > ?', req.store.id, s.ids.sale);
  s.pending = q.all(`SELECT t.id, t.date, t.category, t.kind, t.amount, t.method, t.description, t.created_at FROM transactions t
    WHERE t.store_id = ? AND t.id > ? AND t.method = 'cash' ORDER BY t.id DESC LIMIT 50`, req.store.id, s.ids.tx);
  s.closings = q.all(`SELECT d.*, u.name AS user_name FROM day_closings d LEFT JOIN users u ON u.id = d.user_id
    WHERE d.store_id = ? ORDER BY d.id DESC LIMIT 60`, req.store.id);
  res.json(s);
});

r.post('/cash/close', mgr, (req, res) => {
  const counted = money(req.body?.counted_cash, { name: 'Sayılan nakit' });
  const id = tx(() => {
    const s = cashSummary(req.store);
    const now = localNow(req.store.timezone);
    const sales = q.get('SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM sales WHERE store_id = ? AND id > ?', req.store.id, s.ids.sale);
    return insert('day_closings', {
      store_id: req.store.id, expected_cash: s.expected_cash, counted_cash: counted, diff: counted - s.expected_cash,
      cash_in: s.flows.cash.sales + s.flows.cash.income, cash_out: s.flows.cash.refunds + s.flows.cash.expense,
      card_total: s.flows.card.net, transfer_total: s.flows.transfer.net, sales_total: sales.total, sales_count: sales.n,
      last_payment_id: q.val('SELECT COALESCE(MAX(id),0) FROM payments WHERE store_id = ?', req.store.id),
      last_tx_id: q.val('SELECT COALESCE(MAX(id),0) FROM transactions WHERE store_id = ?', req.store.id),
      last_sale_id: q.val('SELECT COALESCE(MAX(id),0) FROM sales WHERE store_id = ?', req.store.id),
      note: str(req.body?.note, { max: 300 }), user_id: req.user.id, created_at: now,
    });
  });
  const c = q.get('SELECT * FROM day_closings WHERE id = ?', id);
  log(req, 'Gün sonu alındı', `Beklenen ${(c.expected_cash / 100).toFixed(2)} ₺, sayılan ${(counted / 100).toFixed(2)} ₺`);
  res.json(c);
});

export default r;
