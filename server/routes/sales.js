import { Router } from 'express';
import { q, insert, tx, nextCounter } from '../db.js';
import { isManager, requireRole } from '../auth.js';
import { moveStock } from '../stock.js';
import {
  bad, forbidden, int, money, str, oneOf, localNow, log, ownRow, like, range, page, addDays, PAY_METHODS, METHOD_LABELS,
} from '../util.js';

const r = Router();

const effPrice = (p, v) => (v.sale_price != null ? v.sale_price : (p.discount_price != null ? p.discount_price : p.sale_price));

/**
 * Satış / iade / değişim — tek uç nokta.
 * items: yeni satılan ürünler, returns: önceki fişlerden iade edilen satırlar.
 * Toplam negatifse müşteriye para iadesi yapılır; pozitifse müşteri öder.
 */
r.post('/sales', (req, res) => {
  const b = req.body || {};
  const sid = req.store.id;
  const items = Array.isArray(b.items) ? b.items : [];
  const returns = Array.isArray(b.returns) ? b.returns : [];
  if (!items.length && !returns.length) throw bad('Sepet boş');
  if (items.length > 300 || returns.length > 300) throw bad('Sepette çok fazla satır var');
  const now = localNow(req.store.timezone);

  const customer = b.customer_id ? ownRow('customers', b.customer_id, sid, 'Müşteri bulunamadı') : null;
  const staffId = b.staff_id ? ownRow('staff', b.staff_id, sid, 'Personel bulunamadı').id : (req.user.staff_id || null);
  const order = b.order_id ? ownRow('orders', b.order_id, sid, 'Sipariş bulunamadı') : null;
  if (order && (order.status === 'delivered' || order.status === 'cancelled')) throw bad('Bu sipariş zaten kapatılmış');

  const result = tx(() => {
    // --- Satış satırları ---
    const lines = items.map((it) => {
      const v = ownRow('variants', it.variant_id, sid, 'Ürün varyantı bulunamadı');
      const p = q.get('SELECT * FROM products WHERE id = ?', v.product_id);
      const qty = int(it.qty, { min: 1, max: 10000, name: 'Adet' });
      const listPrice = effPrice(p, v);
      const unit = it.unit_price === undefined || it.unit_price === null ? listPrice : money(it.unit_price, { name: 'Birim fiyat' });
      const gross = qty * unit;
      const discount = money(it.discount ?? 0, { name: 'Satır indirimi' });
      if (discount > gross) throw bad(`${p.name} için indirim, satır tutarını aşamaz`);
      if (req.store.allow_negative_stock === 0 && v.stock < qty) throw bad(`${p.name} (${v.size} ${v.color}) için yeterli stok yok (stok: ${v.stock})`);
      return { v, p, qty, unit, gross, discount, net: gross - discount, share: 0 };
    });

    const netSum = lines.reduce((s, l) => s + l.net, 0);
    const cartDiscount = money(b.cart_discount ?? 0, { name: 'Sepet indirimi' });
    if (cartDiscount > netSum) throw bad('Sepet indirimi, satış tutarını aşamaz');
    if (cartDiscount) {
      let given = 0;
      lines.forEach((l) => { l.share = Math.floor((cartDiscount * l.net) / netSum); given += l.share; });
      const biggest = lines.reduce((a, l) => (l.net > a.net ? l : a), lines[0]);
      biggest.share += cartDiscount - given;
    }

    // --- İade satırları ---
    const seen = new Set();
    const retLines = returns.map((rt) => {
      const orig = ownRow('sale_items', rt.sale_item_id, sid, 'İade edilecek satış satırı bulunamadı');
      if (seen.has(orig.id)) throw bad('Aynı satır iki kez iade listesine eklenmiş');
      seen.add(orig.id);
      if (orig.qty <= 0 || orig.return_of) throw bad('Bu satır iade edilemez');
      const remaining = orig.qty - orig.returned_qty;
      if (remaining <= 0) throw bad(`${orig.name} zaten tamamen iade edilmiş`);
      const qty = int(rt.qty, { min: 1, max: remaining, name: 'İade adedi' });
      if (!isManager(req) && req.store.return_days > 0 && orig.created_at < addDays(now.slice(0, 10), -req.store.return_days)) {
        throw forbidden(`${req.store.return_days} günlük iade süresi geçmiş. Yönetici onayı gerekir.`);
      }
      let amount;
      if (qty === remaining) {
        const refunded = -q.val('SELECT COALESCE(SUM(total),0) FROM sale_items WHERE return_of = ?', orig.id);
        amount = orig.total - refunded;
      } else amount = Math.round((orig.total * qty) / orig.qty);
      return { orig, qty, amount };
    });

    const total = lines.reduce((s, l) => s + l.net - l.share, 0) - retLines.reduce((s, x) => s + x.amount, 0);

    // --- Ödemeler ---
    const pays = (Array.isArray(b.payments) ? b.payments : []).map((pm) => ({
      method: oneOf(pm.method, PAY_METHODS, 'Ödeme yöntemi'),
      amount: int(pm.amount, { min: -1e12, max: 1e12, name: 'Ödeme tutarı' }),
    })).filter((pm) => pm.amount !== 0);
    const paySum = pays.reduce((s, pm) => s + pm.amount, 0);
    if (paySum !== total) throw bad(`Ödemeler toplamı (${(paySum / 100).toFixed(2)}) ile fiş toplamı (${(total / 100).toFixed(2)}) eşit değil`);
    for (const pm of pays) {
      if (Math.sign(pm.amount) !== Math.sign(total)) throw bad('Ödeme yönleri fiş toplamıyla uyumsuz');
      if (pm.method === 'credit' && !customer) throw bad('Veresiye satış için müşteri seçmelisiniz');
      if (pm.method === 'deposit') {
        if (!order) throw bad('Kapora yalnızca sipariş teslimatında kullanılabilir');
        if (pm.amount > order.deposit) throw bad('Kullanılan kapora, alınan kaporayı aşamaz');
      }
    }
    const creditAmt = pays.filter((pm) => pm.method === 'credit').reduce((s, pm) => s + pm.amount, 0);
    if (customer && creditAmt > 0 && customer.credit_limit) {
      const bal = q.val('SELECT COALESCE(SUM(amount),0) FROM customer_ledger WHERE customer_id = ?', customer.id);
      if (bal + creditAmt > customer.credit_limit && !(isManager(req) && b.force_credit)) {
        throw bad(`Müşterinin veresiye limiti aşılıyor (limit: ${(customer.credit_limit / 100).toFixed(2)} ₺, mevcut borç: ${(bal / 100).toFixed(2)} ₺)`);
      }
    }

    // --- Kayıt ---
    const no = `S${String(nextCounter(sid, 'sale')).padStart(6, '0')}`;
    const subtotal = lines.reduce((s, l) => s + l.gross, 0);
    const lineDiscount = lines.reduce((s, l) => s + l.discount, 0);
    const cost = lines.reduce((s, l) => s + l.p.buy_price * l.qty, 0) - retLines.reduce((s, x) => s + x.orig.unit_cost * x.qty, 0);
    const itemCount = lines.reduce((s, l) => s + l.qty, 0);
    const saleId = insert('sales', {
      store_id: sid, no, customer_id: customer?.id, staff_id: staffId, user_id: req.user.id, order_id: order?.id,
      subtotal, line_discount: lineDiscount, cart_discount: cartDiscount, total, cost_total: cost,
      item_count: itemCount, has_return: retLines.length ? 1 : 0, note: str(b.note, { max: 300 }), created_at: now,
    });
    for (const l of lines) {
      insert('sale_items', {
        store_id: sid, sale_id: saleId, variant_id: l.v.id, product_id: l.p.id, name: l.p.name, size: l.v.size, color: l.v.color,
        barcode: l.v.barcode, qty: l.qty, unit_price: l.unit, discount: l.discount, cart_discount_share: l.share,
        total: l.net - l.share, unit_cost: l.p.buy_price, vat_rate: l.p.vat_rate, created_at: now,
      });
      moveStock({ storeId: sid, variantId: l.v.id, qty: -l.qty, type: 'sale', refType: 'sale', refId: saleId, userId: req.user.id, now });
    }
    for (const x of retLines) {
      const o = x.orig;
      insert('sale_items', {
        store_id: sid, sale_id: saleId, variant_id: o.variant_id, product_id: o.product_id, name: o.name, size: o.size, color: o.color,
        barcode: o.barcode, qty: -x.qty, unit_price: o.unit_price, discount: 0, cart_discount_share: 0,
        total: -x.amount, unit_cost: o.unit_cost, vat_rate: o.vat_rate, return_of: o.id, created_at: now,
      });
      q.run('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?', x.qty, o.id);
      q.run('UPDATE sales SET has_return = 1 WHERE id = ?', o.sale_id);
      if (o.variant_id && q.get('SELECT 1 FROM variants WHERE id = ?', o.variant_id)) {
        moveStock({ storeId: sid, variantId: o.variant_id, qty: x.qty, type: 'return', refType: 'sale', refId: saleId, note: `İade (fiş ${q.val('SELECT no FROM sales WHERE id = ?', o.sale_id)})`, userId: req.user.id, now });
      }
    }
    for (const pm of pays) {
      insert('payments', { store_id: sid, sale_id: saleId, method: pm.method, amount: pm.amount, created_at: now });
      if (pm.method === 'credit') {
        insert('customer_ledger', {
          store_id: sid, customer_id: customer.id, amount: pm.amount, type: pm.amount > 0 ? 'sale' : 'return',
          ref_type: 'sale', ref_id: saleId, due_date: b.due_date || null,
          note: `${no} numaralı fiş ${pm.amount > 0 ? '(veresiye satış)' : '(iade — borçtan düşüldü)'}`, user_id: req.user.id, created_at: now,
        });
      }
    }
    if (order) {
      q.run("UPDATE orders SET status = 'delivered', sale_id = ?, updated_at = ? WHERE id = ?", saleId, now, order.id);
    }
    return { id: saleId, no, total };
  });

  log(req, result.total < 0 ? 'İade yapıldı' : (returns.length ? 'Değişim yapıldı' : 'Satış yapıldı'), `${result.no} — ${(result.total / 100).toFixed(2)} ₺`);
  res.json(result);
});

r.get('/sales', (req, res) => {
  const sid = req.store.id;
  const { fromTs, toTs } = range(req, 30);
  const where = ['s.store_id = ?', 's.created_at BETWEEN ? AND ?'];
  const params = [sid, fromTs, toTs];
  if (req.query.q) {
    where.push(`(s.no LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM sale_items x WHERE x.sale_id = s.id AND (x.barcode = ? OR x.name LIKE ? ESCAPE '\\')))`);
    const l = like(req.query.q);
    params.push(l, l, l, String(req.query.q).trim(), l);
  }
  if (req.query.staff_id) { where.push('s.staff_id = ?'); params.push(Number(req.query.staff_id)); }
  if (req.query.customer_id) { where.push('s.customer_id = ?'); params.push(Number(req.query.customer_id)); }
  if (req.query.type === 'return') where.push('s.total < 0');
  if (req.query.type === 'exchange') where.push("EXISTS (SELECT 1 FROM sale_items x WHERE x.sale_id = s.id AND x.qty < 0)");
  if (req.query.method) { where.push('EXISTS (SELECT 1 FROM payments pm WHERE pm.sale_id = s.id AND pm.method = ?)'); params.push(String(req.query.method)); }
  const w = where.join(' AND ');
  const { limit, offset } = page(req, 100);
  const summary = q.get(`SELECT COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total, COALESCE(SUM(s.total - s.cost_total),0) AS profit,
      COALESCE(SUM(s.item_count),0) AS items
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE ${w}`, ...params);
  const rows = q.all(`SELECT s.*, c.name AS customer_name, st.name AS staff_name, u.name AS user_name,
      (SELECT GROUP_CONCAT(method || ':' || amount) FROM payments pm WHERE pm.sale_id = s.id) AS pays,
      (SELECT COALESCE(SUM(-qty),0) FROM sale_items x WHERE x.sale_id = s.id AND x.qty < 0) AS returned_items
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN staff st ON st.id = s.staff_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  if (!isManager(req)) { delete summary.profit; rows.forEach((x) => delete x.cost_total); }
  res.json({ summary, rows });
});

function saleDetail(req, sale) {
  sale.items = q.all(`SELECT si.*, (SELECT no FROM sales WHERE id = (SELECT sale_id FROM sale_items WHERE id = si.return_of)) AS return_of_no
    FROM sale_items si WHERE si.sale_id = ? ORDER BY si.id`, sale.id);
  sale.payments = q.all('SELECT method, amount FROM payments WHERE sale_id = ? ORDER BY id', sale.id);
  sale.customer = sale.customer_id ? q.get('SELECT id, name, phone FROM customers WHERE id = ?', sale.customer_id) : null;
  if (sale.customer) sale.customer.balance = q.val('SELECT COALESCE(SUM(amount),0) FROM customer_ledger WHERE customer_id = ?', sale.customer.id);
  sale.staff_name = sale.staff_id ? q.val('SELECT name FROM staff WHERE id = ?', sale.staff_id) : null;
  sale.user_name = sale.user_id ? q.val('SELECT name FROM users WHERE id = ?', sale.user_id) : null;
  const st = req.store;
  sale.store = { name: st.name, phone: st.phone, address: st.address, city: st.city, tax_office: st.tax_office, tax_no: st.tax_no, receipt_footer: st.receipt_footer, return_days: st.return_days };
  sale.vat = q.all('SELECT vat_rate, SUM(total) AS total FROM sale_items WHERE sale_id = ? GROUP BY vat_rate', sale.id)
    .map((x) => ({ rate: x.vat_rate, total: x.total, vat: Math.round((x.total * x.vat_rate) / (100 + x.vat_rate)) }));
  if (!isManager(req)) { delete sale.cost_total; sale.items.forEach((i) => delete i.unit_cost); }
  return sale;
}

r.get('/sales/find', (req, res) => {
  const code = String(req.query.no || '').trim().toUpperCase();
  if (!code) throw bad('Fiş numarası girin');
  const norm = /^\d+$/.test(code) ? `S${code.padStart(6, '0')}` : code;
  const sale = q.get('SELECT * FROM sales WHERE store_id = ? AND no = ?', req.store.id, norm);
  if (!sale) return res.json(null);
  res.json(saleDetail(req, sale));
});

// Müşterinin iade edilebilir son alışverişleri (fişsiz iade için)
r.get('/sales/returnable', (req, res) => {
  const sid = req.store.id;
  const params = [sid];
  let w = 'si.store_id = ? AND si.qty > 0 AND si.returned_qty < si.qty';
  if (req.query.customer_id) { w += ' AND s.customer_id = ?'; params.push(Number(req.query.customer_id)); }
  if (req.query.barcode) { w += ' AND si.barcode = ?'; params.push(String(req.query.barcode).trim()); }
  if (params.length === 1) return res.json([]);
  res.json(q.all(`SELECT si.*, s.no, s.created_at AS sale_date FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE ${w} ORDER BY si.id DESC LIMIT 50`, ...params));
});

r.get('/sales/:id', (req, res) => {
  const sale = ownRow('sales', req.params.id, req.store.id, 'Satış bulunamadı');
  res.json(saleDetail(req, sale));
});

// Hatalı fişin iptali — yalnızca mağaza sahibi; tüm etkiler geri alınır
r.delete('/sales/:id', requireRole('owner'), (req, res) => {
  const sale = ownRow('sales', req.params.id, req.store.id, 'Satış bulunamadı');
  const items = q.all('SELECT * FROM sale_items WHERE sale_id = ?', sale.id);
  if (items.some((i) => i.returned_qty > 0)) throw bad('Bu fişten iade yapılmış. Önce iade fişini iptal edin.');
  const now = localNow(req.store.timezone);
  tx(() => {
    for (const i of items) {
      if (i.return_of) q.run('UPDATE sale_items SET returned_qty = returned_qty - ? WHERE id = ?', -i.qty, i.return_of);
      if (i.variant_id && q.get('SELECT 1 FROM variants WHERE id = ?', i.variant_id)) {
        moveStock({ storeId: req.store.id, variantId: i.variant_id, qty: i.qty, type: 'adjust', refType: 'sale', refId: sale.id, note: `Fiş iptali ${sale.no}`, userId: req.user.id, now });
      }
    }
    q.run("DELETE FROM customer_ledger WHERE ref_type = 'sale' AND ref_id = ? AND store_id = ?", sale.id, req.store.id);
    q.run('DELETE FROM payments WHERE sale_id = ?', sale.id);
    q.run('DELETE FROM sale_items WHERE sale_id = ?', sale.id);
    q.run('DELETE FROM sales WHERE id = ?', sale.id);
    if (sale.order_id) q.run("UPDATE orders SET status = 'arrived', sale_id = NULL WHERE id = ?", sale.order_id);
  });
  log(req, 'Fiş iptal edildi', `${sale.no} — ${(sale.total / 100).toFixed(2)} ₺`);
  res.json({ ok: true });
});

export { METHOD_LABELS };
export default r;
