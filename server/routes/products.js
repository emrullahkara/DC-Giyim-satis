import { Router } from 'express';
import { q, insert, update, tx } from '../db.js';
import { isManager, requireRole } from '../auth.js';
import { moveStock, generateBarcode } from '../stock.js';
import { bad, int, money, str, localNow, log, ownRow, like, page } from '../util.js';

const r = Router();
const mgr = requireRole('owner', 'manager');

const effPrice = (p, v) => (v && v.sale_price != null ? v.sale_price : (p.discount_price != null ? p.discount_price : p.sale_price));

function stripCost(req, p) {
  if (!isManager(req)) { delete p.buy_price; }
  return p;
}

function readProduct(b, req) {
  const out = {
    code: str(b.code, { max: 50, name: 'Model kodu' }),
    name: str(b.name, { required: true, max: 150, name: 'Ürün adı' }),
    category_id: b.category_id ? int(b.category_id, { min: 1 }) : null,
    brand: str(b.brand, { max: 80, name: 'Marka' }),
    supplier_id: b.supplier_id ? int(b.supplier_id, { min: 1 }) : null,
    season: str(b.season, { max: 50, name: 'Sezon' }),
    gender: str(b.gender, { max: 30 }),
    material: str(b.material, { max: 100, name: 'Kumaş' }),
    description: str(b.description, { max: 2000, name: 'Açıklama' }),
    sale_price: money(b.sale_price, { name: 'Satış fiyatı' }),
    discount_price: b.discount_price === null || b.discount_price === '' || b.discount_price === undefined ? null : money(b.discount_price, { name: 'İndirimli fiyat' }),
    vat_rate: int(b.vat_rate ?? req.store.default_vat, { min: 0, max: 100, name: 'KDV oranı' }),
  };
  if (isManager(req)) out.buy_price = money(b.buy_price, { name: 'Alış fiyatı' });
  if (out.category_id) ownRow('categories', out.category_id, req.store.id, 'Kategori bulunamadı');
  if (out.supplier_id) ownRow('suppliers', out.supplier_id, req.store.id, 'Tedarikçi bulunamadı');
  if (out.discount_price != null && out.discount_price >= out.sale_price) throw bad('İndirimli fiyat, satış fiyatından düşük olmalıdır');
  return out;
}

function addVariant(req, productId, v, now) {
  const size = str(v.size, { max: 20, name: 'Beden' }) || '';
  const color = str(v.color, { max: 40, name: 'Renk' }) || '';
  if (q.get('SELECT 1 FROM variants WHERE product_id = ? AND size = ? AND color = ? AND active = 1', productId, size, color)) {
    throw bad(`${size || '-'} / ${color || '-'} varyantı zaten var`);
  }
  let barcode = str(v.barcode, { max: 40, name: 'Barkod' });
  if (barcode) {
    if (q.get('SELECT 1 FROM variants WHERE store_id = ? AND barcode = ?', req.store.id, barcode)) throw bad(`${barcode} barkodu başka bir üründe kullanılıyor`);
  } else barcode = generateBarcode(req.store.id);
  const id = insert('variants', {
    store_id: req.store.id, product_id: productId, size, color, barcode, stock: 0,
    min_stock: int(v.min_stock ?? req.store.low_stock_default, { min: 0, max: 100000, name: 'Kritik stok' }),
    sale_price: v.sale_price === null || v.sale_price === undefined || v.sale_price === '' ? null : money(v.sale_price),
    sort: int(v.sort, { def: 0 }),
  });
  const stock = int(v.stock, { min: 0, max: 1000000, name: 'Stok' });
  if (stock) moveStock({ storeId: req.store.id, variantId: id, qty: stock, type: 'initial', note: 'Açılış stoğu', userId: req.user.id, now });
  return id;
}

// Ürün listesi
r.get('/products', (req, res) => {
  const sid = req.store.id;
  const where = ['p.store_id = ?'];
  const params = [sid];
  const status = req.query.status || 'active';
  if (status === 'active') where.push('p.active = 1');
  else if (status === 'passive') where.push('p.active = 0');
  if (req.query.q) {
    where.push(`(p.name LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM variants v2 WHERE v2.product_id = p.id AND v2.barcode = ?))`);
    const l = like(req.query.q);
    params.push(l, l, l, String(req.query.q).trim());
  }
  if (req.query.category) { where.push('p.category_id = ?'); params.push(Number(req.query.category)); }
  if (req.query.supplier) { where.push('p.supplier_id = ?'); params.push(Number(req.query.supplier)); }
  if (req.query.season) { where.push('p.season = ?'); params.push(String(req.query.season)); }
  if (req.query.discounted === '1') where.push('p.discount_price IS NOT NULL');
  if (req.query.stock === 'low') where.push('EXISTS (SELECT 1 FROM variants v3 WHERE v3.product_id = p.id AND v3.active = 1 AND v3.stock <= v3.min_stock)');
  if (req.query.stock === 'out') where.push('(SELECT COALESCE(SUM(stock),0) FROM variants v4 WHERE v4.product_id = p.id AND v4.active = 1) <= 0');
  if (req.query.stock === 'in') where.push('(SELECT COALESCE(SUM(stock),0) FROM variants v4 WHERE v4.product_id = p.id AND v4.active = 1) > 0');
  const sorts = {
    new: 'p.id DESC', name: 'p.name COLLATE NOCASE', stock: 'total_stock DESC', price: 'p.sale_price DESC', sold: 'sold_30 DESC',
  };
  const order = sorts[req.query.sort] || sorts.new;
  const { limit, offset } = page(req, 50);
  const w = where.join(' AND ');
  const total = q.val(`SELECT COUNT(*) FROM products p WHERE ${w}`, ...params);
  const rows = q.all(`
    SELECT p.*, c.name AS category_name, s.name AS supplier_name,
      (SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS total_stock,
      (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS variant_count,
      (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.stock <= v.min_stock) AS low_count,
      (SELECT COALESCE(SUM(si.qty),0) FROM sale_items si WHERE si.product_id = p.id AND si.created_at >= datetime(?, '-30 days')) AS sold_30,
      (SELECT GROUP_CONCAT(DISTINCT v.color) FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.color != '') AS colors,
      (SELECT GROUP_CONCAT(DISTINCT v.size) FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.size != '') AS sizes
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, localNow(req.store.timezone), ...params, limit, offset);
  res.json({ total, rows: rows.map((p) => stripCost(req, p)) });
});

r.get('/products/meta', (req, res) => {
  const sid = req.store.id;
  res.json({
    categories: q.all('SELECT * FROM categories WHERE store_id = ? ORDER BY sort, name', sid),
    sizeSets: q.all('SELECT * FROM size_sets WHERE store_id = ? ORDER BY id', sid),
    suppliers: q.all('SELECT id, name FROM suppliers WHERE store_id = ? AND active = 1 ORDER BY name', sid),
    brands: q.all('SELECT DISTINCT brand FROM products WHERE store_id = ? AND brand IS NOT NULL ORDER BY brand', sid).map((x) => x.brand),
    seasons: q.all('SELECT DISTINCT season FROM products WHERE store_id = ? AND season IS NOT NULL ORDER BY season DESC', sid).map((x) => x.season),
    colors: q.all("SELECT color, COUNT(*) n FROM variants WHERE store_id = ? AND color != '' GROUP BY color ORDER BY n DESC LIMIT 60", sid).map((x) => x.color),
  });
});

r.get('/products/:id', (req, res) => {
  const p = ownRow('products', req.params.id, req.store.id, 'Ürün bulunamadı');
  p.category_name = p.category_id ? q.val('SELECT name FROM categories WHERE id = ?', p.category_id) : null;
  p.supplier_name = p.supplier_id ? q.val('SELECT name FROM suppliers WHERE id = ?', p.supplier_id) : null;
  p.variants = q.all(`SELECT v.*,
      (SELECT COALESCE(SUM(si.qty),0) FROM sale_items si WHERE si.variant_id = v.id) AS sold_total
    FROM variants v WHERE v.product_id = ? AND v.active = 1 ORDER BY v.sort, v.color, v.id`, p.id);
  const stats = q.get(`SELECT COALESCE(SUM(qty),0) AS sold, COALESCE(SUM(total),0) AS revenue,
      COALESCE(SUM(total - unit_cost * qty),0) AS profit, MAX(created_at) AS last_sale
    FROM sale_items WHERE product_id = ? AND store_id = ?`, p.id, req.store.id);
  p.stats = isManager(req) ? stats : { sold: stats.sold, last_sale: stats.last_sale };
  res.json(stripCost(req, p));
});

r.post('/products', mgr, (req, res) => {
  const b = req.body || {};
  const data = readProduct(b, req);
  const now = localNow(req.store.timezone);
  const variants = Array.isArray(b.variants) && b.variants.length ? b.variants : [{ size: '', color: '' }];
  if (variants.length > 500) throw bad('Bir üründe en fazla 500 varyant olabilir');
  const id = tx(() => {
    const pid = insert('products', { store_id: req.store.id, ...data, created_at: now, updated_at: now });
    variants.forEach((v, i) => addVariant(req, pid, { ...v, sort: i }, now));
    return pid;
  });
  log(req, 'Ürün eklendi', data.name);
  res.json({ id });
});

r.put('/products/:id', mgr, (req, res) => {
  const p = ownRow('products', req.params.id, req.store.id, 'Ürün bulunamadı');
  const data = readProduct(req.body || {}, req);
  update('products', p.id, req.store.id, { ...data, active: req.body.active === 0 || req.body.active === false ? 0 : 1, updated_at: localNow(req.store.timezone) });
  log(req, 'Ürün güncellendi', data.name);
  res.json({ ok: true });
});

r.delete('/products/:id', mgr, (req, res) => {
  const p = ownRow('products', req.params.id, req.store.id, 'Ürün bulunamadı');
  const used = q.get('SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1', p.id)
    || q.get('SELECT 1 FROM purchase_items pi JOIN variants v ON v.id = pi.variant_id WHERE v.product_id = ? LIMIT 1', p.id);
  if (used) {
    q.run('UPDATE products SET active = 0 WHERE id = ?', p.id);
    log(req, 'Ürün pasife alındı', p.name);
    return res.json({ ok: true, archived: true });
  }
  tx(() => {
    q.run('DELETE FROM stock_movements WHERE variant_id IN (SELECT id FROM variants WHERE product_id = ?)', p.id);
    q.run('DELETE FROM variants WHERE product_id = ?', p.id);
    q.run('DELETE FROM products WHERE id = ?', p.id);
  });
  log(req, 'Ürün silindi', p.name);
  res.json({ ok: true, deleted: true });
});

// Toplu fiyat / indirim işlemi (sezon sonu indirimi vb.)
r.post('/products/bulk', mgr, (req, res) => {
  const b = req.body || {};
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('Ürün seçilmedi');
  const action = b.action;
  const now = localNow(req.store.timezone);
  let n = 0;
  tx(() => {
    for (const id of ids) {
      const p = q.get('SELECT * FROM products WHERE id = ? AND store_id = ?', id, req.store.id);
      if (!p) continue;
      const round = (k) => (b.round ? Math.max(100, Math.round(k / 100 / 5) * 5 * 100 - (b.round === '90' ? 10 : 0)) : Math.round(k));
      if (action === 'discount') {
        const pct = Number(b.value);
        if (!(pct > 0 && pct < 100)) throw bad('İndirim oranı 1 ile 99 arasında olmalıdır');
        const dp = round(p.sale_price * (1 - pct / 100));
        q.run('UPDATE products SET discount_price = ?, updated_at = ? WHERE id = ?', dp < p.sale_price ? dp : null, now, id);
      } else if (action === 'clear_discount') {
        q.run('UPDATE products SET discount_price = NULL, updated_at = ? WHERE id = ?', now, id);
      } else if (action === 'increase') {
        const pct = Number(b.value);
        if (!(pct > -100 && pct <= 500 && pct !== 0)) throw bad('Oran geçersiz');
        q.run('UPDATE products SET sale_price = ?, discount_price = NULL, updated_at = ? WHERE id = ?', round(p.sale_price * (1 + pct / 100)), now, id);
      } else if (action === 'category') {
        const cid = int(b.value, { min: 1, name: 'Kategori' });
        ownRow('categories', cid, req.store.id, 'Kategori bulunamadı');
        q.run('UPDATE products SET category_id = ?, updated_at = ? WHERE id = ?', cid, now, id);
      } else if (action === 'season') {
        q.run('UPDATE products SET season = ?, updated_at = ? WHERE id = ?', str(b.value, { max: 50 }), now, id);
      } else if (action === 'passive' || action === 'active') {
        q.run('UPDATE products SET active = ?, updated_at = ? WHERE id = ?', action === 'active' ? 1 : 0, now, id);
      } else throw bad('Geçersiz toplu işlem');
      n++;
    }
  });
  log(req, 'Toplu ürün işlemi', `${action} (${n} ürün)`);
  res.json({ ok: true, count: n });
});

// Varyantlar
r.post('/products/:id/variants', mgr, (req, res) => {
  const p = ownRow('products', req.params.id, req.store.id, 'Ürün bulunamadı');
  const list = Array.isArray(req.body?.variants) ? req.body.variants : [req.body];
  const now = localNow(req.store.timezone);
  const maxSort = q.val('SELECT COALESCE(MAX(sort),0) FROM variants WHERE product_id = ?', p.id);
  const ids = tx(() => list.map((v, i) => addVariant(req, p.id, { ...v, sort: maxSort + i + 1 }, now)));
  res.json({ ids });
});

r.put('/variants/:id', mgr, (req, res) => {
  const v = ownRow('variants', req.params.id, req.store.id, 'Varyant bulunamadı');
  const b = req.body || {};
  const barcode = str(b.barcode ?? v.barcode, { required: true, max: 40, name: 'Barkod' });
  if (barcode !== v.barcode && q.get('SELECT 1 FROM variants WHERE store_id = ? AND barcode = ? AND id != ?', req.store.id, barcode, v.id)) {
    throw bad('Bu barkod başka bir üründe kullanılıyor');
  }
  const size = b.size !== undefined ? (str(b.size, { max: 20 }) || '') : v.size;
  const color = b.color !== undefined ? (str(b.color, { max: 40 }) || '') : v.color;
  if ((size !== v.size || color !== v.color) && q.get('SELECT 1 FROM variants WHERE product_id = ? AND size = ? AND color = ? AND active = 1 AND id != ?', v.product_id, size, color, v.id)) {
    throw bad('Bu beden/renk kombinasyonu zaten var');
  }
  update('variants', v.id, req.store.id, {
    barcode, size, color,
    min_stock: int(b.min_stock ?? v.min_stock, { min: 0, max: 100000, name: 'Kritik stok' }),
    sale_price: b.sale_price === null || b.sale_price === '' ? null : (b.sale_price === undefined ? v.sale_price : money(b.sale_price)),
  });
  res.json({ ok: true });
});

r.delete('/variants/:id', mgr, (req, res) => {
  const v = ownRow('variants', req.params.id, req.store.id, 'Varyant bulunamadı');
  const used = q.get('SELECT 1 FROM sale_items WHERE variant_id = ? LIMIT 1', v.id) || q.get('SELECT 1 FROM purchase_items WHERE variant_id = ? LIMIT 1', v.id);
  if (used) {
    if (v.stock !== 0) throw bad('Stoğu olan ve hareket görmüş varyant kaldırılamaz. Önce stoğu sıfırlayın.');
    q.run('UPDATE variants SET active = 0 WHERE id = ?', v.id);
  } else {
    tx(() => {
      q.run('DELETE FROM stock_movements WHERE variant_id = ?', v.id);
      q.run('DELETE FROM variants WHERE id = ?', v.id);
    });
  }
  res.json({ ok: true });
});

// Stok düzeltme (tek varyant)
r.post('/variants/:id/adjust', mgr, (req, res) => {
  const v = ownRow('variants', req.params.id, req.store.id, 'Varyant bulunamadı');
  const b = req.body || {};
  let qty;
  if (b.new_stock !== undefined && b.new_stock !== '') qty = int(b.new_stock, { min: -100000, max: 1000000, name: 'Yeni stok' }) - v.stock;
  else qty = int(b.qty, { min: -100000, max: 100000, name: 'Miktar', required: true });
  if (!qty) return res.json({ ok: true, stock: v.stock });
  const note = str(b.note, { max: 200 }) || 'Manuel düzeltme';
  tx(() => moveStock({ storeId: req.store.id, variantId: v.id, qty, type: 'adjust', note, userId: req.user.id, now: localNow(req.store.timezone) }));
  log(req, 'Stok düzeltildi', `${v.barcode}: ${qty > 0 ? '+' : ''}${qty} (${note})`);
  res.json({ ok: true, stock: v.stock + qty });
});

// Stok sayımı (toplu) — sayılan miktarları sisteme işler, farkları kaydeder
r.post('/stock/count', mgr, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) throw bad('Sayım listesi boş');
  const now = localNow(req.store.timezone);
  const note = str(req.body.note, { max: 200 }) || 'Stok sayımı';
  let changed = 0; let diffTotal = 0;
  tx(() => {
    for (const it of items) {
      const v = ownRow('variants', it.variant_id, req.store.id, 'Varyant bulunamadı');
      const counted = int(it.counted, { min: 0, max: 1000000, name: 'Sayılan miktar' });
      const diff = counted - v.stock;
      if (diff) {
        moveStock({ storeId: req.store.id, variantId: v.id, qty: diff, type: 'count', note, userId: req.user.id, now });
        changed++; diffTotal += diff;
      }
    }
  });
  log(req, 'Stok sayımı yapıldı', `${items.length} kalem, ${changed} farklı, net ${diffTotal}`);
  res.json({ ok: true, changed, diffTotal });
});

r.get('/products/:id/movements', (req, res) => {
  const p = ownRow('products', req.params.id, req.store.id, 'Ürün bulunamadı');
  res.json(q.all(`SELECT m.*, v.size, v.color, v.barcode, u.name AS user_name FROM stock_movements m
    JOIN variants v ON v.id = m.variant_id LEFT JOIN users u ON u.id = m.user_id
    WHERE v.product_id = ? ORDER BY m.id DESC LIMIT 300`, p.id));
});

// Kasa / alış ekranları için varyant arama
const variantSelect = `SELECT v.id, v.product_id, v.size, v.color, v.barcode, v.stock, v.min_stock, v.sale_price AS v_price,
    p.name, p.code, p.brand, p.sale_price, p.discount_price, p.buy_price, p.vat_rate, p.active, c.name AS category_name
  FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN categories c ON c.id = p.category_id`;

function shapeVariant(req, row) {
  const price = effPrice({ sale_price: row.sale_price, discount_price: row.discount_price }, { sale_price: row.v_price });
  const list = row.v_price != null ? row.v_price : row.sale_price;
  const out = { ...row, price, list_price: list };
  delete out.v_price;
  if (!isManager(req)) delete out.buy_price;
  return out;
}

r.get('/variants/lookup', (req, res) => {
  const code = String(req.query.code || '').trim();
  const row = code && q.get(`${variantSelect} WHERE v.store_id = ? AND v.barcode = ? AND v.active = 1`, req.store.id, code);
  if (!row) return res.json(null);
  res.json(shapeVariant(req, row));
});

r.get('/variants/search', (req, res) => {
  const s = String(req.query.q || '').trim();
  if (!s) return res.json([]);
  const l = like(s);
  const rows = q.all(`${variantSelect} WHERE v.store_id = ? AND v.active = 1 AND p.active = 1 AND
    (p.name LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR v.barcode LIKE ? ESCAPE '\\' OR v.color LIKE ? ESCAPE '\\')
    ORDER BY p.name COLLATE NOCASE, v.sort, v.id LIMIT 60`, req.store.id, l, l, l, l, l);
  res.json(rows.map((x) => shapeVariant(req, x)));
});

r.get('/variants/by-ids', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 500);
  if (!ids.length) return res.json([]);
  const rows = q.all(`${variantSelect} WHERE v.store_id = ? AND v.id IN (${ids.map(() => '?').join(',')})`, req.store.id, ...ids);
  res.json(rows.map((x) => shapeVariant(req, x)));
});

// Kategori & beden seti yönetimi
r.post('/categories', mgr, (req, res) => {
  const name = str(req.body?.name, { required: true, max: 60, name: 'Kategori adı' });
  if (q.get('SELECT 1 FROM categories WHERE store_id = ? AND name = ? COLLATE NOCASE', req.store.id, name)) throw bad('Bu kategori zaten var');
  const sort = q.val('SELECT COALESCE(MAX(sort),0)+1 FROM categories WHERE store_id = ?', req.store.id);
  res.json({ id: insert('categories', { store_id: req.store.id, name, sort }) });
});
r.put('/categories/:id', mgr, (req, res) => {
  const c = ownRow('categories', req.params.id, req.store.id);
  update('categories', c.id, req.store.id, { name: str(req.body?.name, { required: true, max: 60, name: 'Kategori adı' }) });
  res.json({ ok: true });
});
r.delete('/categories/:id', mgr, (req, res) => {
  const c = ownRow('categories', req.params.id, req.store.id);
  q.run('UPDATE products SET category_id = NULL WHERE category_id = ? AND store_id = ?', c.id, req.store.id);
  q.run('DELETE FROM categories WHERE id = ?', c.id);
  res.json({ ok: true });
});
function readSizes(v) {
  const sizes = String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!sizes.length) throw bad('En az bir beden girin');
  if (new Set(sizes).size !== sizes.length) throw bad('Aynı beden iki kez yazılmış');
  return sizes.join(',');
}
r.post('/size-sets', mgr, (req, res) => {
  const name = str(req.body?.name, { required: true, max: 60, name: 'Set adı' });
  res.json({ id: insert('size_sets', { store_id: req.store.id, name, sizes: readSizes(req.body?.sizes) }) });
});
r.put('/size-sets/:id', mgr, (req, res) => {
  const s = ownRow('size_sets', req.params.id, req.store.id);
  update('size_sets', s.id, req.store.id, { name: str(req.body?.name, { required: true, max: 60, name: 'Set adı' }), sizes: readSizes(req.body?.sizes) });
  res.json({ ok: true });
});
r.delete('/size-sets/:id', mgr, (req, res) => {
  const s = ownRow('size_sets', req.params.id, req.store.id);
  q.run('DELETE FROM size_sets WHERE id = ?', s.id);
  res.json({ ok: true });
});

export default r;
