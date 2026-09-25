import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let server; let base;

before(async () => {
  initDb(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, url, body, { raw = false } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-DC-Istek': '1', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    const data = await res.json();
    if (!res.ok) { const e = new Error(data.error); e.status = res.status; throw e; }
    return data;
  };
  return {
    get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b),
    del: (u) => call('DELETE', u), raw: call,
  };
}

const owner = client();
const ctx = {};

test('kayıt ve oturum', async () => {
  const r = await owner.post('/api/auth/register', { storeName: 'Test Butik', name: 'Ayşe Sahip', email: 'ayse@test.com', password: 'gizli123' });
  assert.equal(r.user.role, 'owner');
  const me = await owner.get('/api/auth/me');
  assert.equal(me.user.store.name, 'Test Butik');
  const meta = await owner.get('/api/products/meta');
  assert.ok(meta.categories.length > 10);
  assert.ok(meta.sizeSets.find((s) => s.name === 'Harf Beden'));
  ctx.catId = meta.categories.find((c) => c.name === 'Elbise').id;
});

test('CSRF başlığı olmadan değişiklik reddedilir', async () => {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('hatalı şifre reddedilir, aynı e-posta ikinci kez kaydedilemez', async () => {
  await assert.rejects(client().post('/api/auth/login', { email: 'ayse@test.com', password: 'yanlis' }), /hatalı/);
  await assert.rejects(client().post('/api/auth/register', { storeName: 'X', name: 'Y', email: 'AYSE@test.com', password: '123456' }), /zaten/);
});

test('ürün + beden/renk varyantları + açılış stoğu', async () => {
  const r = await owner.post('/api/products', {
    name: 'Saten Elbise', code: 'EL-100', category_id: ctx.catId, brand: 'DC', buy_price: 40000, sale_price: 100000,
    variants: [
      { size: 'S', color: 'Siyah', stock: 5 }, { size: 'M', color: 'Siyah', stock: 3 }, { size: 'L', color: 'Kırmızı', stock: 1 },
    ],
  });
  const p = await owner.get(`/api/products/${r.id}`);
  assert.equal(p.variants.length, 3);
  assert.ok(p.variants.every((v) => /^2\d{12}$/.test(v.barcode)));
  ctx.product = p;
  ctx.vS = p.variants.find((v) => v.size === 'S');
  ctx.vM = p.variants.find((v) => v.size === 'M');
  const look = await owner.get(`/api/variants/lookup?code=${ctx.vS.barcode}`);
  assert.equal(look.price, 100000);
  await assert.rejects(owner.post(`/api/products/${r.id}/variants`, { size: 'S', color: 'Siyah' }), /zaten var/);
  const list = await owner.get('/api/products?q=saten');
  assert.equal(list.total, 1);
  assert.equal(list.rows[0].total_stock, 9);
});

test('veresiye + nakit parçalı satış, sepet indirimi dağıtımı', async () => {
  const c = await owner.post('/api/customers', { name: 'Fatma Müşteri', phone: '0532 111 22 33', birthday: '1990-05-10' });
  ctx.customerId = c.id;
  const sale = await owner.post('/api/sales', {
    customer_id: c.id,
    items: [{ variant_id: ctx.vS.id, qty: 2 }, { variant_id: ctx.vM.id, qty: 1, discount: 10000 }],
    cart_discount: 5001,
    payments: [{ method: 'cash', amount: 100000 }, { method: 'credit', amount: 184999 }],
  });
  assert.equal(sale.total, 284999);
  const d = await owner.get(`/api/sales/${sale.id}`);
  assert.equal(d.items.reduce((s, i) => s + i.total, 0), 284999);
  assert.equal(d.items.reduce((s, i) => s + i.cart_discount_share, 0), 5001);
  ctx.sale = d;
  const cust = await owner.get(`/api/customers/${c.id}`);
  assert.equal(cust.balance, 184999);
  const p = await owner.get(`/api/products/${ctx.product.id}`);
  assert.equal(p.variants.find((v) => v.size === 'S').stock, 3);
});

test('ödeme toplamı tutmazsa satış reddedilir, veresiye için müşteri gerekir', async () => {
  await assert.rejects(owner.post('/api/sales', { items: [{ variant_id: ctx.vS.id, qty: 1 }], payments: [{ method: 'cash', amount: 5 }] }), /eşit değil/);
  await assert.rejects(owner.post('/api/sales', { items: [{ variant_id: ctx.vS.id, qty: 1 }], payments: [{ method: 'credit', amount: 100000 }] }), /müşteri/);
});

test('kısmi iade (nakit geri ödeme) ve fazla iade engeli', async () => {
  const lineS = ctx.sale.items.find((i) => i.size === 'S');
  const perUnit = Math.round(lineS.total / 2);
  const ret = await owner.post('/api/sales', { returns: [{ sale_item_id: lineS.id, qty: 1 }], payments: [{ method: 'cash', amount: -perUnit }] });
  assert.equal(ret.total, -perUnit);
  // kalan 1 adet iade edilince toplam kuruşu kuruşuna eşit olmalı
  const ret2 = await owner.post('/api/sales', { returns: [{ sale_item_id: lineS.id, qty: 1 }], payments: [{ method: 'cash', amount: -(lineS.total - perUnit) }] });
  assert.equal(ret.total + ret2.total, -lineS.total);
  await assert.rejects(owner.post('/api/sales', { returns: [{ sale_item_id: lineS.id, qty: 1 }], payments: [] }), /tamamen iade/);
  const p = await owner.get(`/api/products/${ctx.product.id}`);
  assert.equal(p.variants.find((v) => v.size === 'S').stock, 5);
});

test('değişim: iade + yeni ürün, fark tahsil edilir', async () => {
  const lineM = ctx.sale.items.find((i) => i.size === 'M');
  const ex = await owner.post('/api/sales', {
    items: [{ variant_id: ctx.vS.id, qty: 1 }],
    returns: [{ sale_item_id: lineM.id, qty: 1 }],
    payments: [{ method: 'card', amount: 100000 - lineM.total }],
  });
  assert.equal(ex.total, 100000 - lineM.total);
});

test('tahsilat müşteri borcunu düşürür, kâra yansımaz', async () => {
  const r = await owner.post(`/api/customers/${ctx.customerId}/collect`, { amount: 84999, method: 'cash' });
  assert.equal(r.balance, 100000);
  const t = await owner.get('/api/transactions');
  const row = t.rows.find((x) => x.category === 'Veresiye Tahsilatı');
  assert.equal(row.pl, 0);
});

test('mal alımı: stok girişi, tedarikçi borcu ve ağırlıklı ortalama maliyet', async () => {
  const s = await owner.post('/api/suppliers', { name: 'Merter Tekstil' });
  ctx.supplierId = s.id;
  const stockBefore = (await owner.get(`/api/products/${ctx.product.id}`)).variants.reduce((a, v) => a + v.stock, 0);
  await owner.post('/api/purchases', {
    supplier_id: s.id, invoice_no: 'A-1', items: [{ variant_id: ctx.vM.id, qty: 10, unit_cost: 50000 }], paid_amount: 200000, paid_method: 'transfer',
  });
  const p = await owner.get(`/api/products/${ctx.product.id}`);
  assert.equal(p.variants.find((v) => v.size === 'M').stock, 13);
  assert.equal(p.buy_price, Math.round((stockBefore * 40000 + 500000) / (stockBefore + 10)));
  const sup = await owner.get(`/api/suppliers/${s.id}`);
  assert.equal(sup.balance, 300000);
});

test('sipariş + kapora + teslimatta satışa dönüşme', async () => {
  const o = await owner.post('/api/orders', {
    customer_id: ctx.customerId, due_date: '2030-01-01', deposit: 30000, deposit_method: 'cash',
    items: [{ description: 'Özel dikim abiye', size: '38', qty: 1, unit_price: 150000, variant_id: ctx.vM.id }],
  });
  await owner.post(`/api/orders/${o.id}/status`, { status: 'arrived' });
  const sale = await owner.post('/api/sales', {
    order_id: o.id, customer_id: ctx.customerId, items: [{ variant_id: ctx.vM.id, qty: 1, unit_price: 150000 }],
    payments: [{ method: 'deposit', amount: 30000 }, { method: 'cash', amount: 120000 }],
  });
  const od = await owner.get(`/api/orders/${o.id}`);
  assert.equal(od.status, 'delivered');
  assert.equal(od.sale_id, sale.id);
  await assert.rejects(owner.post(`/api/orders/${o.id}/status`, { status: 'new' }), /Teslim/);
});

test('kasa özeti ve gün sonu', async () => {
  const c = await owner.get('/api/cash');
  // nakit: satış 100000 - iade (2 satır) + tahsilat 84999 + kapora 30000 + teslimat 120000
  const lineS = ctx.sale.items.find((i) => i.size === 'S');
  assert.equal(c.expected_cash, 100000 - lineS.total + 84999 + 30000 + 120000);
  const close = await owner.post('/api/cash/close', { counted_cash: c.expected_cash - 500 });
  assert.equal(close.diff, -500);
  const c2 = await owner.get('/api/cash');
  assert.equal(c2.expected_cash, c.expected_cash - 500);
  await owner.post('/api/transactions', { kind: 'expense', category: 'Kira', amount: 1000, method: 'cash' });
  assert.equal((await owner.get('/api/cash')).expected_cash, c.expected_cash - 1500);
});

test('raporlar ve gösterge paneli çalışır', async () => {
  const d = await owner.get('/api/dashboard');
  assert.ok(d.today.total > 0);
  const s = await owner.get('/api/reports/sales');
  assert.equal(s.summary.net, d.today.total);
  assert.ok(s.bySize.length > 0);
  const st = await owner.get('/api/reports/stock');
  assert.ok(st.totals.units > 0);
  const f = await owner.get('/api/reports/finance');
  assert.equal(f.revenue, s.summary.net);
  assert.equal(f.expTotal, 1000);
});

test('kasiyer yetkileri: maliyet göremez, rapor/ayar açamaz', async () => {
  const staff = await owner.post('/api/staff', { name: 'Zeynep Kasiyer', commission_rate: 2 });
  await owner.post('/api/users', { name: 'Zeynep', email: 'zeynep@test.com', password: '123456', role: 'cashier', staff_id: staff.id });
  const cashier = client();
  await cashier.post('/api/auth/login', { email: 'zeynep@test.com', password: '123456' });
  const p = await cashier.get(`/api/products/${ctx.product.id}`);
  assert.equal(p.buy_price, undefined);
  await assert.rejects(cashier.get('/api/reports/sales'), /yetki/);
  await assert.rejects(cashier.post('/api/products', { name: 'X', sale_price: 1 }), /yetki/);
  const sale = await cashier.post('/api/sales', { items: [{ variant_id: ctx.vS.id, qty: 1 }], payments: [{ method: 'cash', amount: 100000 }] });
  const d = await owner.get(`/api/sales/${sale.id}`);
  assert.equal(d.staff_name, 'Zeynep Kasiyer');
});

test('mağazalar birbirinin verisini göremez', async () => {
  const other = client();
  await other.post('/api/auth/register', { storeName: 'Rakip', name: 'B', email: 'b@test.com', password: '123456' });
  await assert.rejects(other.get(`/api/products/${ctx.product.id}`), /bulunamadı/);
  await assert.rejects(other.get(`/api/customers/${ctx.customerId}`), /bulunamadı/);
  await assert.rejects(other.post('/api/sales', { items: [{ variant_id: ctx.vS.id, qty: 1 }], payments: [{ method: 'cash', amount: 100000 }] }), /bulunamadı/);
  const l = await other.get('/api/products');
  assert.equal(l.total, 0);
  assert.equal(await other.get(`/api/variants/lookup?code=${ctx.vS.barcode}`), null);
});

test('fiş iptali stoğu ve veresiyeyi geri alır', async () => {
  const before = (await owner.get(`/api/products/${ctx.product.id}`)).variants.find((v) => v.size === 'S').stock;
  const sale = await owner.post('/api/sales', { customer_id: ctx.customerId, items: [{ variant_id: ctx.vS.id, qty: 2 }], payments: [{ method: 'credit', amount: 200000 }] });
  const bal = (await owner.get(`/api/customers/${ctx.customerId}`)).balance;
  await owner.del(`/api/sales/${sale.id}`);
  const after = (await owner.get(`/api/products/${ctx.product.id}`)).variants.find((v) => v.size === 'S').stock;
  assert.equal(after, before);
  assert.equal((await owner.get(`/api/customers/${ctx.customerId}`)).balance, bal - 200000);
});

test('toplu indirim ve stok sayımı', async () => {
  await owner.post('/api/products/bulk', { ids: [ctx.product.id], action: 'discount', value: 30 });
  const look = await owner.get(`/api/variants/lookup?code=${ctx.vS.barcode}`);
  assert.equal(look.price, 70000);
  await owner.post('/api/stock/count', { items: [{ variant_id: ctx.vS.id, counted: 7 }] });
  const p = await owner.get(`/api/products/${ctx.product.id}`);
  assert.equal(p.variants.find((v) => v.size === 'S').stock, 7);
  const mv = await owner.get(`/api/products/${ctx.product.id}/movements`);
  assert.ok(mv.some((m) => m.type === 'count'));
});

test('serbest satır (stoksuz ürün/hizmet) satılabilir ve iade edilebilir', async () => {
  const s = await owner.post('/api/sales', { items: [{ name: 'Paça tadilatı', qty: 1, unit_price: 15000 }], payments: [{ method: 'cash', amount: 15000 }] });
  const d = await owner.get(`/api/sales/${s.id}`);
  assert.equal(d.items[0].variant_id, null);
  const r = await owner.post('/api/sales', { returns: [{ sale_item_id: d.items[0].id, qty: 1 }], payments: [{ method: 'cash', amount: -15000 }] });
  assert.equal(r.total, -15000);
  await assert.rejects(owner.post('/api/sales', { items: [{ qty: 1, unit_price: 100 }], payments: [{ method: 'cash', amount: 100 }] }), /Ürün adı/);
});
