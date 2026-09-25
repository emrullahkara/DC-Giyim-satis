// Gösterge paneli ve raporlar
import { Router } from 'express';
import { q } from '../db.js';
import { isManager, requireRole } from '../auth.js';
import { localNow, addDays, range } from '../util.js';
import { cashSummary } from './finance.js';

const r = Router();
const mgr = requireRole('owner', 'manager');

const dayRange = (d) => [`${d} 00:00:00`, `${d} 23:59:59`];

function salesAgg(sid, from, to) {
  return q.get(`SELECT COUNT(CASE WHEN total > 0 THEN 1 END) AS count, COALESCE(SUM(total),0) AS total,
      COALESCE(SUM(total - cost_total),0) AS profit, COALESCE(SUM(item_count),0) AS items
    FROM sales WHERE store_id = ? AND created_at BETWEEN ? AND ?`, sid, from, to);
}

r.get('/dashboard', (req, res) => {
  const sid = req.store.id;
  const now = localNow(req.store.timezone);
  const today = now.slice(0, 10);
  const manager = isManager(req);
  const monthStart = `${today.slice(0, 8)}01`;
  const d = new Date(`${today}T12:00:00Z`);
  const prevMonthDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const prevMonthStart = prevMonthDate.toISOString().slice(0, 10);
  const prevMonthDays = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).getUTCDate();
  const prevSameDay = `${prevMonthStart.slice(0, 8)}${String(Math.min(d.getUTCDate(), prevMonthDays)).padStart(2, '0')}`;

  const out = {
    now,
    today: salesAgg(sid, ...dayRange(today)),
    yesterday: salesAgg(sid, ...dayRange(addDays(today, -1))),
    lastWeekSameDay: salesAgg(sid, `${addDays(today, -7)} 00:00:00`, `${addDays(today, -7)} ${now.slice(11)}`),
    month: salesAgg(sid, `${monthStart} 00:00:00`, `${today} 23:59:59`),
    prevMonthToDate: salesAgg(sid, `${prevMonthStart} 00:00:00`, `${prevSameDay} ${now.slice(11)}`),
  };
  out.series = q.all(`SELECT substr(created_at,1,10) AS d, SUM(total) AS total, SUM(total - cost_total) AS profit, COUNT(CASE WHEN total > 0 THEN 1 END) AS n
    FROM sales WHERE store_id = ? AND created_at >= ? GROUP BY d ORDER BY d`, sid, `${addDays(today, -29)} 00:00:00`);
  out.todayPayments = q.all(`SELECT method, SUM(amount) AS total FROM payments WHERE store_id = ? AND created_at >= ? GROUP BY method`, sid, `${today} 00:00:00`);
  out.topProducts = q.all(`SELECT si.product_id, si.name, SUM(si.qty) AS qty, SUM(si.total) AS total FROM sale_items si
    WHERE si.store_id = ? AND si.created_at >= ? GROUP BY si.product_id ORDER BY qty DESC LIMIT 6`, sid, `${addDays(today, -6)} 00:00:00`);
  out.recentSales = q.all(`SELECT s.id, s.no, s.total, s.item_count, s.created_at, c.name AS customer_name, st.name AS staff_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN staff st ON st.id = s.staff_id
    WHERE s.store_id = ? ORDER BY s.id DESC LIMIT 8`, sid);
  out.staffBoard = q.all(`SELECT st.id, st.name, COALESCE(SUM(s.total),0) AS total, COUNT(s.id) AS n FROM staff st
    LEFT JOIN sales s ON s.staff_id = st.id AND s.created_at >= ?
    WHERE st.store_id = ? AND st.active = 1 GROUP BY st.id ORDER BY total DESC LIMIT 6`, `${monthStart} 00:00:00`, sid);

  // --- Uyarılar ---
  const lowWhere = 'v.store_id = ? AND v.active = 1 AND p.active = 1 AND v.stock <= v.min_stock';
  out.lowStock = {
    count: q.val(`SELECT COUNT(*) FROM variants v JOIN products p ON p.id = v.product_id WHERE ${lowWhere}`, sid),
    negative: q.val('SELECT COUNT(*) FROM variants v JOIN products p ON p.id = v.product_id WHERE v.store_id = ? AND v.active = 1 AND v.stock < 0', sid),
    items: q.all(`SELECT v.id, v.product_id, p.name, v.size, v.color, v.stock, v.min_stock,
        (SELECT COALESCE(SUM(qty),0) FROM sale_items si WHERE si.variant_id = v.id AND si.created_at >= ?) AS sold_30
      FROM variants v JOIN products p ON p.id = v.product_id WHERE ${lowWhere}
      ORDER BY sold_30 DESC, v.stock LIMIT 8`, `${addDays(today, -30)} 00:00:00`, sid),
  };
  out.receivables = {
    total: q.val(`SELECT COALESCE(SUM(b),0) FROM (SELECT SUM(amount) b FROM customer_ledger WHERE store_id = ? GROUP BY customer_id HAVING b > 0)`, sid),
    top: q.all(`SELECT c.id, c.name, c.phone, SUM(l.amount) AS balance, MAX(CASE WHEN l.amount < 0 THEN l.created_at END) AS last_payment,
        MIN(l.due_date) AS due FROM customer_ledger l JOIN customers c ON c.id = l.customer_id
      WHERE l.store_id = ? GROUP BY c.id HAVING balance > 0 ORDER BY balance DESC LIMIT 6`, sid),
  };
  const soon = addDays(today, 3);
  out.orders = {
    open: q.val("SELECT COUNT(*) FROM orders WHERE store_id = ? AND status NOT IN ('delivered','cancelled')", sid),
    arrived: q.val("SELECT COUNT(*) FROM orders WHERE store_id = ? AND status = 'arrived'", sid),
    due: q.all(`SELECT id, no, customer_name, phone, status, due_date, total, deposit FROM orders
      WHERE store_id = ? AND status NOT IN ('delivered','cancelled') AND (due_date <= ? OR status = 'arrived')
      ORDER BY COALESCE(due_date, '9999') LIMIT 8`, sid, soon),
  };
  const bdays = Array.from({ length: 7 }, (_, i) => addDays(today, i).slice(5));
  out.birthdays = q.all(`SELECT id, name, phone, birthday FROM customers WHERE store_id = ? AND active = 1
    AND substr(birthday, 6, 5) IN (${bdays.map(() => '?').join(',')}) ORDER BY (substr(birthday,6,5) < ?), substr(birthday,6,5) LIMIT 10`, sid, ...bdays, today.slice(5));
  out.tasks = q.all(`SELECT * FROM tasks WHERE store_id = ? AND done = 0 ORDER BY COALESCE(due_date,'9999'), id LIMIT 8`, sid);

  if (manager) {
    out.payables = {
      total: q.val(`SELECT COALESCE(SUM(b),0) FROM (SELECT SUM(amount) b FROM supplier_ledger WHERE store_id = ? GROUP BY supplier_id HAVING b > 0)`, sid),
      due: q.all(`SELECT s.id, s.name, l.due_date, l.amount, l.note FROM supplier_ledger l JOIN suppliers s ON s.id = l.supplier_id
        WHERE l.store_id = ? AND l.due_date IS NOT NULL AND l.due_date <= ? AND l.amount > 0
        AND (SELECT SUM(amount) FROM supplier_ledger x WHERE x.supplier_id = s.id) > 0 ORDER BY l.due_date LIMIT 6`, sid, addDays(today, 7)),
    };
    const cash = cashSummary(req.store);
    out.cash = { expected: cash.expected_cash, last_closing: cash.last_closing?.created_at || null };
    out.monthExpenses = q.val("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE store_id = ? AND kind = 'expense' AND pl = 1 AND date >= ?", sid, monthStart);
    out.stockValue = q.get(`SELECT COALESCE(SUM(CASE WHEN v.stock > 0 THEN v.stock * p.buy_price END),0) AS cost,
        COALESCE(SUM(CASE WHEN v.stock > 0 THEN v.stock * COALESCE(v.sale_price, p.sale_price) END),0) AS sale, COALESCE(SUM(CASE WHEN v.stock > 0 THEN v.stock END),0) AS units
      FROM variants v JOIN products p ON p.id = v.product_id WHERE v.store_id = ? AND v.active = 1 AND p.active = 1`, sid);
  } else {
    for (const k of ['today', 'yesterday', 'lastWeekSameDay', 'month', 'prevMonthToDate']) delete out[k].profit;
    out.series.forEach((x) => delete x.profit);
  }
  res.json(out);
});

// ---------------- Satış raporu ----------------
r.get('/reports/sales', mgr, (req, res) => {
  const sid = req.store.id;
  const { from, to, fromTs, toTs } = range(req, 30);
  const P = [sid, fromTs, toTs];
  const W = 'si.store_id = ? AND si.created_at BETWEEN ? AND ?';
  const summary = q.get(`SELECT
      COALESCE(SUM(CASE WHEN qty > 0 THEN total END),0) AS gross,
      COALESCE(SUM(CASE WHEN qty < 0 THEN -total END),0) AS returns,
      COALESCE(SUM(total),0) AS net,
      COALESCE(SUM(CASE WHEN qty > 0 THEN discount + cart_discount_share END),0) AS discount,
      COALESCE(SUM(CASE WHEN qty > 0 THEN qty * unit_price END),0) AS list_total,
      COALESCE(SUM(unit_cost * qty),0) AS cost,
      COALESCE(SUM(CASE WHEN qty > 0 THEN qty END),0) AS items,
      COALESCE(SUM(CASE WHEN qty < 0 THEN -qty END),0) AS returned_items,
      COALESCE(SUM(total * vat_rate * 1.0 / (100 + vat_rate)),0) AS vat
    FROM sale_items si WHERE ${W}`, ...P);
  summary.vat = Math.round(summary.vat);
  summary.profit = summary.net - summary.cost;
  summary.margin = summary.net ? summary.profit / summary.net : 0;
  summary.count = q.val('SELECT COUNT(*) FROM sales WHERE store_id = ? AND created_at BETWEEN ? AND ? AND total > 0', ...P);
  summary.customers = q.val('SELECT COUNT(DISTINCT customer_id) FROM sales WHERE store_id = ? AND created_at BETWEEN ? AND ? AND customer_id IS NOT NULL', ...P);
  summary.avg_basket = summary.count ? Math.round(summary.gross / summary.count) : 0;
  summary.items_per_basket = summary.count ? summary.items / summary.count : 0;
  summary.return_rate = summary.items ? summary.returned_items / summary.items : 0;

  const group = (expr, join = '', extra = '', limit = 100) => q.all(`SELECT ${expr} AS k, COALESCE(SUM(CASE WHEN si.qty > 0 THEN si.qty END),0) AS qty,
      COALESCE(SUM(CASE WHEN si.qty < 0 THEN -si.qty END),0) AS returned,
      SUM(si.total) AS total, SUM(si.total - si.unit_cost * si.qty) AS profit ${extra}
    FROM sale_items si ${join} WHERE ${W} GROUP BY k ORDER BY total DESC LIMIT ${limit}`, ...P);

  res.json({
    from, to, summary,
    daily: q.all(`SELECT substr(created_at,1,10) AS d, SUM(total) AS total, SUM(total - cost_total) AS profit, COUNT(CASE WHEN total > 0 THEN 1 END) AS n
      FROM sales WHERE store_id = ? AND created_at BETWEEN ? AND ? GROUP BY d ORDER BY d`, ...P),
    byCategory: group("COALESCE(c.name, 'Kategorisiz')", 'LEFT JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id'),
    byBrand: group("COALESCE(NULLIF(p.brand,''), 'Markasız')", 'LEFT JOIN products p ON p.id = si.product_id', '', 30),
    byProduct: group('si.product_id', '', ', MAX(si.name) AS name, (SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = si.product_id AND v.active = 1) AS stock', 50),
    bySize: group("COALESCE(NULLIF(si.size,''), 'Tek Beden')", '', '', 40),
    byColor: group("COALESCE(NULLIF(si.color,''), 'Renksiz')", '', '', 30),
    byStaff: q.all(`SELECT COALESCE(st.name, 'Atanmamış') AS k, st.commission_rate, COUNT(CASE WHEN s.total > 0 THEN 1 END) AS n, SUM(s.total) AS total,
        SUM(s.total - s.cost_total) AS profit, SUM(s.item_count) AS qty
      FROM sales s LEFT JOIN staff st ON st.id = s.staff_id WHERE s.store_id = ? AND s.created_at BETWEEN ? AND ? GROUP BY s.staff_id ORDER BY total DESC`, ...P)
      .map((x) => ({ ...x, commission: Math.round(((x.total || 0) * (x.commission_rate || 0)) / 100) })),
    byMethod: q.all('SELECT method AS k, SUM(amount) AS total, COUNT(*) AS n FROM payments WHERE store_id = ? AND created_at BETWEEN ? AND ? GROUP BY method ORDER BY total DESC', ...P),
    byHour: q.all(`SELECT CAST(substr(created_at,12,2) AS INTEGER) AS k, SUM(total) AS total, COUNT(*) AS n FROM sales
      WHERE store_id = ? AND created_at BETWEEN ? AND ? AND total > 0 GROUP BY k ORDER BY k`, ...P),
    byWeekday: q.all(`SELECT CAST(strftime('%w', created_at) AS INTEGER) AS k, SUM(total) AS total, COUNT(*) AS n FROM sales
      WHERE store_id = ? AND created_at BETWEEN ? AND ? AND total > 0 GROUP BY k ORDER BY k`, ...P),
    byCustomer: q.all(`SELECT c.id, c.name AS k, COUNT(*) AS n, SUM(s.total) AS total FROM sales s JOIN customers c ON c.id = s.customer_id
      WHERE s.store_id = ? AND s.created_at BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC LIMIT 20`, ...P),
  });
});

// ---------------- Stok raporu ----------------
r.get('/reports/stock', mgr, (req, res) => {
  const sid = req.store.id;
  const now = localNow(req.store.timezone);
  const today = now.slice(0, 10);
  const deadDays = Number(req.query.days) || req.store.dead_stock_days || 90;
  const since = `${addDays(today, -deadDays)} 00:00:00`;
  const base = 'FROM variants v JOIN products p ON p.id = v.product_id WHERE v.store_id = ? AND v.active = 1 AND p.active = 1';
  const totals = q.get(`SELECT COALESCE(SUM(CASE WHEN v.stock > 0 THEN v.stock END),0) AS units,
      COALESCE(SUM(CASE WHEN v.stock > 0 THEN v.stock * p.buy_price END),0) AS cost,
      COALESCE(SUM(CASE WHEN v.stock > 0 THEN v.stock * COALESCE(v.sale_price, p.discount_price, p.sale_price) END),0) AS sale,
      COUNT(DISTINCT p.id) AS products, COUNT(*) AS variants,
      COUNT(CASE WHEN v.stock <= 0 THEN 1 END) AS out_of_stock,
      COUNT(CASE WHEN v.stock > 0 AND v.stock <= v.min_stock THEN 1 END) AS low
    ${base}`, sid);
  const byCategory = q.all(`SELECT COALESCE(c.name,'Kategorisiz') AS k, COALESCE(SUM(CASE WHEN v.stock > 0 THEN v.stock END),0) AS units,
      COALESCE(SUM(CASE WHEN v.stock > 0 THEN v.stock * p.buy_price END),0) AS cost,
      COALESCE(SUM(CASE WHEN v.stock > 0 THEN v.stock * COALESCE(v.sale_price, p.sale_price) END),0) AS sale
    FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN categories c ON c.id = p.category_id
    WHERE v.store_id = ? AND v.active = 1 AND p.active = 1 GROUP BY k ORDER BY cost DESC`, sid);
  const dead = q.all(`SELECT p.id, p.name, p.code, p.brand, p.season, p.sale_price, p.buy_price, p.created_at,
      SUM(CASE WHEN v.stock > 0 THEN v.stock END) AS stock,
      (SELECT MAX(si.created_at) FROM sale_items si WHERE si.product_id = p.id AND si.qty > 0) AS last_sale
    ${base} AND p.created_at < ? GROUP BY p.id HAVING stock > 0 AND (last_sale IS NULL OR last_sale < ?)
    ORDER BY stock * p.buy_price DESC LIMIT 100`, sid, since, since);
  const sellThrough = q.all(`SELECT p.id, p.name, p.code,
      (SELECT COALESCE(SUM(qty),0) FROM sale_items si WHERE si.product_id = p.id AND si.created_at >= ?) AS sold,
      (SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS stock
    FROM products p WHERE p.store_id = ? AND p.active = 1 ORDER BY sold DESC LIMIT 60`, `${addDays(today, -30)} 00:00:00`, sid)
    .map((x) => ({ ...x, rate: x.sold + Math.max(0, x.stock) ? x.sold / (x.sold + Math.max(0, x.stock)) : 0, days_left: x.sold > 0 ? Math.round((Math.max(0, x.stock) / x.sold) * 30) : null }));
  // Beden analizi: stoktaki beden dağılımı ile satılan beden dağılımını karşılaştırır (sipariş planlaması için)
  const sizeStock = q.all(`SELECT v.size AS k, SUM(CASE WHEN v.stock > 0 THEN v.stock ELSE 0 END) AS stock ${base} AND v.size != '' GROUP BY v.size`, sid);
  const sizeSold = q.all(`SELECT si.size AS k, SUM(si.qty) AS sold FROM sale_items si WHERE si.store_id = ? AND si.created_at >= ? AND si.size != '' GROUP BY si.size`, sid, `${addDays(today, -90)} 00:00:00`);
  const sizes = new Map();
  sizeStock.forEach((x) => sizes.set(x.k, { k: x.k, stock: x.stock, sold: 0 }));
  sizeSold.forEach((x) => { const e = sizes.get(x.k) || { k: x.k, stock: 0, sold: 0 }; e.sold = x.sold; sizes.set(x.k, e); });
  const low = q.all(`SELECT v.id, p.id AS product_id, p.name, p.code, v.size, v.color, v.stock, v.min_stock, v.barcode,
      (SELECT COALESCE(SUM(qty),0) FROM sale_items si WHERE si.variant_id = v.id AND si.created_at >= ?) AS sold_30,
      (SELECT name FROM suppliers WHERE id = p.supplier_id) AS supplier
    ${base} AND v.stock <= v.min_stock ORDER BY sold_30 DESC, v.stock LIMIT 200`, `${addDays(today, -30)} 00:00:00`, sid);
  res.json({ totals, byCategory, dead, deadDays, sellThrough, sizes: [...sizes.values()], low });
});

// ---------------- Finans (kâr/zarar) raporu ----------------
r.get('/reports/finance', mgr, (req, res) => {
  const sid = req.store.id;
  const { from, to, fromTs, toTs } = range(req, 30);
  const s = q.get('SELECT COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(cost_total),0) AS cogs FROM sales WHERE store_id = ? AND created_at BETWEEN ? AND ?', sid, fromTs, toTs);
  const expenses = q.all("SELECT category AS k, SUM(amount) AS total FROM transactions WHERE store_id = ? AND kind = 'expense' AND pl = 1 AND date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC", sid, from, to);
  const otherIncome = q.all("SELECT category AS k, SUM(amount) AS total FROM transactions WHERE store_id = ? AND kind = 'income' AND pl = 1 AND date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC", sid, from, to);
  const expTotal = expenses.reduce((a, x) => a + x.total, 0);
  const incTotal = otherIncome.reduce((a, x) => a + x.total, 0);
  const gross = s.revenue - s.cogs;
  // Son 12 ay trendi
  const monthly = q.all(`SELECT m, SUM(rev) AS revenue, SUM(cogs) AS cogs, SUM(exp) AS expense, SUM(inc) AS income FROM (
      SELECT substr(created_at,1,7) AS m, total AS rev, cost_total AS cogs, 0 AS exp, 0 AS inc FROM sales WHERE store_id = ?
      UNION ALL SELECT substr(date,1,7), 0, 0, CASE WHEN kind='expense' THEN amount ELSE 0 END, CASE WHEN kind='income' THEN amount ELSE 0 END
        FROM transactions WHERE store_id = ? AND pl = 1
    ) GROUP BY m ORDER BY m DESC LIMIT 12`, sid, sid).reverse()
    .map((x) => ({ ...x, net: x.revenue - x.cogs - x.expense + x.income }));
  const cashflow = q.all(`SELECT method AS k, SUM(inn) AS inn, SUM(out) AS out FROM (
      SELECT method, CASE WHEN amount > 0 THEN amount ELSE 0 END AS inn, CASE WHEN amount < 0 THEN -amount ELSE 0 END AS out FROM payments
        WHERE store_id = ? AND created_at BETWEEN ? AND ? AND method IN ('cash','card','transfer')
      UNION ALL SELECT method, CASE WHEN kind='income' THEN amount ELSE 0 END, CASE WHEN kind='expense' THEN amount ELSE 0 END FROM transactions
        WHERE store_id = ? AND date BETWEEN ? AND ? AND method IN ('cash','card','transfer')
    ) GROUP BY method`, sid, fromTs, toTs, sid, from, to);
  res.json({
    from, to,
    revenue: s.revenue, cogs: s.cogs, gross, expenses, expTotal, otherIncome, incTotal,
    net: gross - expTotal + incTotal, margin: s.revenue ? (gross - expTotal + incTotal) / s.revenue : 0,
    monthly, cashflow,
    receivables: q.val('SELECT COALESCE(SUM(b),0) FROM (SELECT SUM(amount) b FROM customer_ledger WHERE store_id = ? GROUP BY customer_id HAVING b > 0)', sid),
    payables: q.val('SELECT COALESCE(SUM(b),0) FROM (SELECT SUM(amount) b FROM supplier_ledger WHERE store_id = ? GROUP BY supplier_id HAVING b > 0)', sid),
  });
});

export default r;
