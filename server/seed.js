// Demo mağaza verisi oluşturur: `npm run seed`  (yeniden oluşturmak için: `npm run seed -- --force`)
// Tüm kayıtlar gerçek API üzerinden, iş kurallarından geçerek oluşturulur; geçmiş tarihler için saat simüle edilir.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, q, tx } from './db.js';
import { createApp } from './app.js';
import { setFakeNow } from './util.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'dcgiyim.db');
const DEMO_EMAIL = 'demo@dcgiyim.com';
const DAYS = Number(process.env.SEED_DAYS) || 120;

initDb(DB_FILE);

// Tekrarlanabilir rastgelelik
let seed = 20260925;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const TL = (x) => Math.round(x * 100);
const round10 = (x) => Math.round(x / 10) * 10;

function removeStore(storeId) {
  tx(() => {
    for (const t of ['purchase_items']) q.run(`DELETE FROM ${t} WHERE purchase_id IN (SELECT id FROM purchases WHERE store_id = ?)`, storeId);
    q.run('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE store_id = ?)', storeId);
    q.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE store_id = ?)', storeId);
    for (const t of ['activity', 'day_closings', 'tasks', 'orders', 'purchases', 'transactions', 'payments', 'sale_items', 'sales', 'staff',
      'supplier_ledger', 'customer_ledger', 'customers', 'stock_movements', 'variants', 'products', 'suppliers', 'size_sets', 'categories', 'counters', 'users']) {
      q.run(`DELETE FROM ${t} WHERE store_id = ?`, storeId);
    }
    q.run('DELETE FROM stores WHERE id = ?', storeId);
  });
}

const existing = q.get('SELECT * FROM users WHERE email = ?', DEMO_EMAIL);
if (existing) {
  if (!process.argv.includes('--force')) {
    console.log('Demo mağaza zaten var. Yeniden oluşturmak için: npm run seed -- --force');
    process.exit(0);
  }
  removeStore(existing.store_id);
  console.log('Eski demo mağaza silindi.');
}

const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-DC-Istek': '1', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${url}: ${data.error}`);
    return data;
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b) };
}

// Tarih yardımcıları (İstanbul saati, UTC+3)
const todayIst = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const dayStr = (offset) => { const d = new Date(`${todayIst}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const at = (ymd, hh, mm = 0) => setFakeNow(new Date(`${ymd}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ri(0, 59)).padStart(2, '0')}+03:00`));
const plusDays = (ymd, n) => { const x = new Date(`${ymd}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nowIst = new Date(Date.now() + 3 * 3600e3);
const nowHour = nowIst.getUTCHours();

const api = client();
const start = dayStr(-DAYS);
at(start, 9);
await api.post('/api/auth/register', { storeName: 'DC Giyim Moda Evi', name: 'Demet Cansever', email: DEMO_EMAIL, password: 'demo123', phone: '05321234567' });
await api.put('/api/settings/store', {
  name: 'DC Giyim Moda Evi', phone: '0212 555 44 33', email: 'info@dcgiyim.com', address: 'Bağdat Caddesi No: 214', city: 'Kadıköy / İstanbul',
  tax_office: 'Göztepe', tax_no: '1234567890', receipt_footer: 'Bizi tercih ettiğiniz için teşekkür ederiz. Ürün değişim süresi 14 gündür; etiketi sökülmemiş ürünlerde fiş ile geçerlidir.',
  return_days: 14, default_vat: 10, timezone: 'Europe/Istanbul', low_stock_default: 2, dead_stock_days: 60, allow_negative_stock: true,
});
const meta = await api.get('/api/products/meta');
const cat = Object.fromEntries(meta.categories.map((c) => [c.name, c.id]));

// ---- Personel ve kullanıcılar ----
const staffDefs = [
  ['Selin Kaya', 'Mağaza Müdürü', 38000, 1, '05331112233'],
  ['Elif Yıldız', 'Satış Danışmanı', 26000, 2, '05442223344'],
  ['Burak Demir', 'Satış Danışmanı', 26000, 2, '05553334455'],
  ['Zehra Aksoy', 'Terzi / Tadilat', 24000, 0, '05364445566'],
];
const staff = [];
for (const [name, position, salary, rate, phone] of staffDefs) {
  const r = await api.post('/api/staff', { name, position, salary: TL(salary), commission_rate: rate, phone, start_date: dayStr(-DAYS - ri(30, 700)) });
  staff.push({ id: r.id, name, salary: TL(salary) });
}
await api.post('/api/users', { name: 'Selin Kaya', email: 'mudur@dcgiyim.com', password: 'demo123', role: 'manager', staff_id: staff[0].id });
await api.post('/api/users', { name: 'Elif Yıldız', email: 'kasa@dcgiyim.com', password: 'demo123', role: 'cashier', staff_id: staff[1].id });
const sellers = [staff[0], staff[1], staff[1], staff[2], staff[2]];

// ---- Tedarikçiler ----
const supDefs = [
  ['Merter Tekstil Ltd.', 'Hakan Bey', '02126421010'], ['Laleli Abiye Toptan', 'Nur Hanım', '02125185050'], ['Osmanbey Moda A.Ş.', 'Kerem Bey', '02122471212'],
  ['Bursa Örme Sanayi', 'Mustafa Bey', '02243634040'], ['İzmir Denim Co.', 'Ayla Hanım', '02324578080'], ['Nişantaşı Aksesuar', 'Derya Hanım', '02122303030'],
];
const sup = [];
for (const [name, contact, phone] of supDefs) sup.push((await api.post('/api/suppliers', { name, contact, phone, iban: 'TR00 0000 0000 0000 0000 0000 00' })).id);

// ---- Ürünler ----
const LETTER = ['S', 'M', 'L', 'XL'];
const LETTER5 = ['XS', 'S', 'M', 'L', 'XL'];
const WOMEN = ['36', '38', '40', '42', '44'];
const WAIST = ['28', '29', '30', '31', '32', '34'];
const SHOES = ['36', '37', '38', '39', '40'];
const productDefs = [
  // [ad, kod, kategori, marka, tedarikçi, alış, satış, bedenler, renkler, sezon, cinsiyet, kumaş]
  ['Saten Midi Elbise', 'EL-2401', 'Elbise', 'DC Collection', 0, 780, 1890, WOMEN, ['Siyah', 'Bordo', 'Zümrüt'], '2026 Sonbahar-Kış', 'Kadın', 'Saten'],
  ['Kruvaze Yaka Triko Elbise', 'EL-2402', 'Elbise', 'DC Collection', 3, 690, 1590, LETTER, ['Camel', 'Siyah', 'Ekru'], '2026 Sonbahar-Kış', 'Kadın', 'Triko'],
  ['Çiçek Desenli Şifon Elbise', 'EL-2311', 'Elbise', 'Moda Nova', 2, 520, 1290, WOMEN, ['Pudra', 'Mavi'], '2026 İlkbahar-Yaz', 'Kadın', 'Şifon'],
  ['Keten Gömlek Elbise', 'EL-2315', 'Elbise', 'Moda Nova', 0, 610, 1450, LETTER, ['Bej', 'Beyaz', 'Haki'], '2026 İlkbahar-Yaz', 'Kadın', 'Keten'],
  ['Pullu Uzun Abiye', 'AB-1001', 'Abiye', 'Laleli Gece', 1, 2400, 5900, WOMEN, ['Gümüş', 'Lacivert', 'Siyah'], '2026 Sonbahar-Kış', 'Kadın', 'Tül/Pul'],
  ['Kadife Balık Abiye', 'AB-1002', 'Abiye', 'Laleli Gece', 1, 2900, 6900, WOMEN, ['Bordo', 'Zümrüt', 'Siyah'], '2026 Sonbahar-Kış', 'Kadın', 'Kadife'],
  ['Saten Drapeli Nişan Elbisesi', 'AB-1010', 'Abiye', 'Laleli Gece', 1, 3600, 8900, ['36', '38', '40', '42'], ['Lila', 'Pudra', 'Beyaz'], 'Tüm Sezon', 'Kadın', 'Saten'],
  ['Tesettür Abiye', 'AB-1020', 'Abiye', 'Laleli Gece', 1, 2100, 4900, ['38', '40', '42', '44', '46'], ['Vizon', 'Lacivert'], 'Tüm Sezon', 'Kadın', 'Krep'],
  ['Prenses Kesim Gelinlik', 'GL-001', 'Gelinlik', 'Beyaz Rüya', 1, 14000, 34900, ['36', '38', '40'], ['Beyaz', 'Ekru'], 'Tüm Sezon', 'Kadın', 'Tül/Dantel'],
  ['Sade Saten Gelinlik', 'GL-002', 'Gelinlik', 'Beyaz Rüya', 1, 11000, 27900, ['36', '38', '40', '42'], ['Beyaz'], 'Tüm Sezon', 'Kadın', 'Saten'],
  ['Slim Fit Takım Elbise', 'TK-501', 'Takım Elbise', 'Kent Erkek', 2, 3400, 7900, ['46', '48', '50', '52', '54'], ['Lacivert', 'Antrasit', 'Siyah'], 'Tüm Sezon', 'Erkek', 'Yün Karışım'],
  ['Damatlık Smokin', 'TK-510', 'Takım Elbise', 'Kent Erkek', 2, 5200, 11900, ['48', '50', '52'], ['Siyah', 'Lacivert'], 'Tüm Sezon', 'Erkek', 'Yün'],
  ['Oversize Blazer Ceket', 'CK-301', 'Ceket & Blazer', 'DC Collection', 0, 1150, 2690, LETTER5, ['Siyah', 'Bej', 'Ekru'], '2026 Sonbahar-Kış', 'Kadın', 'Krep'],
  ['Tüvit Ceket', 'CK-305', 'Ceket & Blazer', 'Moda Nova', 2, 1450, 3290, LETTER, ['Ekru', 'Pembe'], '2026 Sonbahar-Kış', 'Kadın', 'Tüvit'],
  ['Pamuklu Basic Gömlek', 'GM-101', 'Gömlek', 'Kent Erkek', 2, 380, 890, ['S', 'M', 'L', 'XL', 'XXL'], ['Beyaz', 'Açık Mavi', 'Siyah'], 'Tüm Sezon', 'Erkek', 'Pamuk'],
  ['Saten Gömlek', 'GM-110', 'Gömlek', 'DC Collection', 0, 450, 1090, LETTER, ['Şampanya', 'Siyah', 'Zümrüt'], 'Tüm Sezon', 'Kadın', 'Saten'],
  ['Fırfırlı Bluz', 'BL-201', 'Bluz', 'Moda Nova', 0, 330, 790, LETTER, ['Beyaz', 'Pudra', 'Siyah'], '2026 İlkbahar-Yaz', 'Kadın', 'Viskon'],
  ['Dantel Detaylı Bluz', 'BL-205', 'Bluz', 'DC Collection', 0, 390, 950, LETTER, ['Ekru', 'Siyah'], 'Tüm Sezon', 'Kadın', 'Dantel'],
  ['Basic Tişört', 'TS-001', 'Tişört', 'DC Basic', 3, 140, 349, LETTER5, ['Beyaz', 'Siyah', 'Gri', 'Lacivert'], 'Tüm Sezon', 'Unisex', 'Pamuk'],
  ['Baskılı Oversize Tişört', 'TS-010', 'Tişört', 'DC Basic', 3, 190, 499, LETTER, ['Beyaz', 'Siyah', 'Haki'], '2026 İlkbahar-Yaz', 'Unisex', 'Pamuk'],
  ['Palazzo Pantolon', 'PN-401', 'Pantolon', 'DC Collection', 0, 420, 990, WOMEN, ['Siyah', 'Bej', 'Lacivert'], 'Tüm Sezon', 'Kadın', 'Krep'],
  ['Kumaş Pantolon', 'PN-410', 'Pantolon', 'Kent Erkek', 2, 520, 1190, WAIST, ['Lacivert', 'Antrasit', 'Bej'], 'Tüm Sezon', 'Erkek', 'Gabardin'],
  ['Mom Jean', 'KT-601', 'Kot', 'Denim Lab', 4, 480, 1149, WAIST, ['Açık Mavi', 'Koyu Mavi'], 'Tüm Sezon', 'Kadın', 'Denim'],
  ['Slim Fit Erkek Kot', 'KT-610', 'Kot', 'Denim Lab', 4, 520, 1249, WAIST, ['Koyu Mavi', 'Siyah'], 'Tüm Sezon', 'Erkek', 'Denim'],
  ['Pileli Midi Etek', 'ET-701', 'Etek', 'Moda Nova', 0, 360, 890, LETTER, ['Siyah', 'Camel', 'Zümrüt'], '2026 Sonbahar-Kış', 'Kadın', 'Saten'],
  ['Deri Görünümlü Mini Etek', 'ET-705', 'Etek', 'DC Collection', 0, 390, 950, LETTER, ['Siyah', 'Kahverengi'], '2026 Sonbahar-Kış', 'Kadın', 'Suni Deri'],
  ['Balıkçı Yaka Kazak', 'KZ-801', 'Kazak & Hırka', 'DC Basic', 3, 420, 990, LETTER, ['Ekru', 'Siyah', 'Camel', 'Gri'], '2026 Sonbahar-Kış', 'Unisex', 'Yün Karışım'],
  ['Uzun Triko Hırka', 'KZ-810', 'Kazak & Hırka', 'DC Collection', 3, 560, 1290, LETTER, ['Vizon', 'Ekru'], '2026 Sonbahar-Kış', 'Kadın', 'Triko'],
  ['Kaşe Kaban', 'MT-901', 'Mont & Kaban', 'DC Collection', 0, 2100, 4890, LETTER, ['Camel', 'Siyah', 'Antrasit'], '2026 Sonbahar-Kış', 'Kadın', 'Kaşe'],
  ['Şişme Mont', 'MT-910', 'Mont & Kaban', 'Kent Erkek', 2, 1600, 3690, ['M', 'L', 'XL', 'XXL'], ['Siyah', 'Lacivert', 'Haki'], '2026 Sonbahar-Kış', 'Erkek', 'Polyester'],
  ['Trençkot', 'MT-920', 'Mont & Kaban', 'Moda Nova', 2, 1750, 3990, LETTER, ['Bej', 'Siyah'], '2026 İlkbahar-Yaz', 'Kadın', 'Gabardin'],
  ['Viskon Tunik', 'TN-301', 'Tunik', 'Moda Nova', 0, 340, 790, ['38', '40', '42', '44', '46'], ['Lacivert', 'Vizon', 'Mint'], 'Tüm Sezon', 'Kadın', 'Viskon'],
  ['Eşofman Takımı', 'ES-101', 'Eşofman & Spor', 'DC Basic', 3, 620, 1390, LETTER5, ['Gri', 'Siyah', 'Lacivert'], 'Tüm Sezon', 'Unisex', 'Pamuk'],
  ['İpek Eşarp', 'AK-001', 'Aksesuar', 'Nişantaşı', 5, 190, 490, ['STD'], ['Bordo', 'Lacivert', 'Pudra', 'Zümrüt'], 'Tüm Sezon', 'Kadın', 'İpek'],
  ['Deri Kemer', 'AK-010', 'Aksesuar', 'Nişantaşı', 5, 210, 550, ['S', 'M', 'L'], ['Siyah', 'Taba'], 'Tüm Sezon', 'Unisex', 'Deri'],
  ['Gelin Duvağı', 'AK-020', 'Aksesuar', 'Beyaz Rüya', 1, 450, 1290, ['STD'], ['Beyaz', 'Ekru'], 'Tüm Sezon', 'Kadın', 'Tül'],
  ['Zincir Askılı Çanta', 'CN-001', 'Çanta', 'Nişantaşı', 5, 520, 1290, ['STD'], ['Siyah', 'Bej', 'Bordo'], 'Tüm Sezon', 'Kadın', 'Suni Deri'],
  ['Abiye Clutch Çanta', 'CN-010', 'Çanta', 'Laleli Gece', 1, 360, 890, ['STD'], ['Gümüş', 'Altın', 'Siyah'], 'Tüm Sezon', 'Kadın', 'Saten'],
  ['Stiletto Topuklu', 'AY-001', 'Ayakkabı', 'Step', 5, 780, 1790, SHOES, ['Siyah', 'Ten', 'Gümüş'], 'Tüm Sezon', 'Kadın', 'Rugan'],
  ['Deri Loafer', 'AY-010', 'Ayakkabı', 'Step', 5, 890, 1990, ['40', '41', '42', '43', '44'], ['Siyah', 'Taba'], 'Tüm Sezon', 'Erkek', 'Deri'],
  ['Geçen Sezon Keten Şort', 'SR-001', 'Pantolon', 'DC Basic', 3, 260, 690, LETTER, ['Bej', 'Beyaz'], '2025 İlkbahar-Yaz', 'Kadın', 'Keten'],
  ['Geçen Sezon Çizgili Tişört', 'TS-099', 'Tişört', 'DC Basic', 3, 150, 399, LETTER, ['Lacivert', 'Kırmızı'], '2025 İlkbahar-Yaz', 'Unisex', 'Pamuk'],
];

const products = [];
for (const [name, code, catName, brand, supIdx, buy, sell, sizes, colors, season, gender, material] of productDefs) {
  const variants = [];
  for (const color of colors) for (const size of sizes) variants.push({ size, color, stock: 0, min_stock: sell > 4000 ? 1 : 2 });
  const r = await api.post('/api/products', {
    name, code, category_id: cat[catName], brand, supplier_id: sup[supIdx], season, gender, material,
    buy_price: TL(buy), sale_price: TL(sell), vat_rate: 10, variants,
  });
  const p = await api.get(`/api/products/${r.id}`);
  const pop = catName === 'Gelinlik' || sell > 9000 ? 0.15 : catName === 'Abiye' ? 0.6 : ['Tişört', 'Kot', 'Aksesuar', 'Elbise', 'Gömlek'].includes(catName) ? 1.6 : 1;
  products.push({ ...p, buy: TL(buy), sell: TL(sell), supIdx, pop: season.startsWith('2025') ? 0.08 : pop, sizes, expensive: sell > 4000 });
}

// Beden dağılımı: orta bedenler daha çok satılır ve daha çok alınır
const sizeWeight = (p, size) => {
  const i = p.sizes.indexOf(size);
  const mid = (p.sizes.length - 1) / 2;
  return Math.max(0.25, 1.4 - Math.abs(i - mid) * 0.45);
};

async function purchaseFor(list, date, invoice, payRatio = 0.5) {
  const bySup = new Map();
  for (const p of list) {
    for (const v of p.variants) {
      const base = p.expensive ? ri(1, 2) : ri(3, 6);
      const qty = Math.max(1, Math.round(base * sizeWeight(p, v.size)));
      if (!bySup.has(p.supIdx)) bySup.set(p.supIdx, []);
      bySup.get(p.supIdx).push({ variant_id: v.id, qty, unit_cost: Math.round(p.buy * (0.95 + rnd() * 0.1)) });
    }
  }
  let n = 0;
  for (const [si, items] of bySup) {
    const total = items.reduce((s, x) => s + x.qty * x.unit_cost, 0);
    const paid = Math.round((total * payRatio) / 10000) * 10000;
    await api.post('/api/purchases', {
      supplier_id: sup[si], invoice_no: `${invoice}-${++n}`, date, items, paid_amount: paid, paid_method: 'transfer', due_date: plusDays(date, 30),
    });
  }
}

at(start, 10);
await purchaseFor(products, start, 'ACL', 0.6);
await api.post('/api/transactions', { kind: 'income', category: 'Kasa Açılış', amount: TL(5000), method: 'cash', description: 'Kasa açılış bakiyesi' });

// ---- Müşteriler ----
const first = ['Ayşe', 'Fatma', 'Zeynep', 'Elif', 'Merve', 'Esra', 'Büşra', 'Deniz', 'Ece', 'Gizem', 'Seda', 'Hülya', 'Sevgi', 'Derya', 'Nazlı', 'Ceren', 'İrem', 'Pınar', 'Aslı', 'Burcu', 'Tuğba', 'Gül', 'Özlem', 'Emine', 'Hatice', 'Mehmet', 'Ahmet', 'Mustafa', 'Emre', 'Can', 'Kerem', 'Murat', 'Oğuz', 'Serkan', 'Tolga'];
const last = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Öztürk', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Koç', 'Kurt', 'Özdemir', 'Polat', 'Erdoğan', 'Güneş', 'Aksoy', 'Tekin', 'Bulut', 'Karaca', 'Uçar'];
const customers = [];
for (let i = 0; i < 85; i++) {
  const fn = pick(first); const ln = pick(last);
  const joined = -ri(0, DAYS);
  at(dayStr(joined), 11);
  let birthday;
  if (i < 3) birthday = `${1980 + ri(0, 20)}-${dayStr(i).slice(5)}`; // yaklaşan doğum günleri
  else if (chance(0.6)) birthday = `${1965 + ri(0, 38)}-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`;
  const phone = `05${pick(['32', '33', '42', '43', '44', '53', '54', '55', '05', '06'])}${String(ri(1000000, 9999999))}`;
  try {
    const r = await api.post('/api/customers', {
      name: `${fn} ${ln}`, phone, birthday, gender: ['Mehmet', 'Ahmet', 'Mustafa', 'Emre', 'Can', 'Kerem', 'Murat', 'Oğuz', 'Serkan', 'Tolga'].includes(fn) ? 'Erkek' : 'Kadın',
      city: pick(['Kadıköy', 'Üsküdar', 'Ataşehir', 'Maltepe', 'Beşiktaş', 'Kartal']),
      sizes_note: chance(0.5) ? `Üst ${pick(['S', 'M', 'L'])}, alt ${pick(['36', '38', '40', '42'])}` : null,
      credit_limit: chance(0.3) ? TL(pick([5000, 10000, 20000])) : null,
    });
    customers.push({ id: r.id, joined, phone });
  } catch { /* tekrar eden telefon — atla */ }
}

// ---- Günlük akış ----
const stockOf = (vid) => q.val('SELECT stock FROM variants WHERE id = ?', vid);
const saleIds = [];
const weekdayFactor = [1.5, 0.75, 0.8, 0.85, 0.9, 1.15, 1.7]; // Pazar..Cumartesi
let orderCount = 0;

function choosePV() {
  const totalPop = products.reduce((s, p) => s + p.pop, 0);
  let r = rnd() * totalPop;
  let p = products[0];
  for (const x of products) { r -= x.pop; if (r <= 0) { p = x; break; } }
  const avail = p.variants.filter((v) => stockOf(v.id) > 0);
  if (!avail.length) return null;
  const weights = avail.map((v) => sizeWeight(p, v.size));
  let w = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < avail.length; i++) { w -= weights[i]; if (w <= 0) return { p, v: avail[i] }; }
  return { p, v: avail[0] };
}

for (let d = -DAYS + 1; d <= 0; d++) {
  const ymd = dayStr(d);
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  const isToday = d === 0;
  const closeHour = isToday ? Math.min(21, Math.max(10, nowHour)) : 21;
  const season = d > -45 ? 1.25 : 1; // sonbahar sezonu açılışı
  let n = Math.round((ri(5, 11) * weekdayFactor[dow] * season));
  if (isToday) n = Math.round(n * Math.min(1, (closeHour - 10) / 11));

  // Aylık giderler (ayın 1'i ve 5'i)
  const dom = Number(ymd.slice(8, 10));
  if (dom === 1) {
    at(ymd, 10);
    await api.post('/api/transactions', { kind: 'expense', category: 'Kira', amount: TL(45000), method: 'transfer', date: ymd, description: 'Mağaza kirası' });
    await api.post('/api/transactions', { kind: 'expense', category: 'Muhasebe', amount: TL(3500), method: 'transfer', date: ymd, description: 'Mali müşavir' });
    await api.post('/api/transactions', { kind: 'expense', category: 'Reklam', amount: TL(ri(4, 9) * 1000), method: 'card', date: ymd, description: 'Instagram reklamları' });
  }
  if (dom === 5) {
    at(ymd, 11);
    for (const s of staff) await api.post(`/api/staff/${s.id}/pay`, { category: 'Maaş', amount: s.salary, method: 'transfer', note: 'Aylık maaş' });
    await api.post('/api/transactions', { kind: 'expense', category: 'SGK & Vergi', amount: TL(ri(26, 31) * 1000), method: 'transfer', date: ymd, description: 'SGK primleri ve muhtasar' });
  }
  if (dom === 12) {
    at(ymd, 12);
    await api.post('/api/transactions', { kind: 'expense', category: 'Elektrik', amount: TL(ri(2800, 4200)), method: 'transfer', date: ymd, description: 'Elektrik faturası' });
    await api.post('/api/transactions', { kind: 'expense', category: 'İnternet & Telefon', amount: TL(890), method: 'card', date: ymd, description: 'Fiber internet' });
    await api.post('/api/transactions', { kind: 'expense', category: 'Su', amount: TL(ri(300, 600)), method: 'transfer', date: ymd });
  }
  if (dom === 20 && !isToday) {
    at(ymd, 16);
    await api.post(`/api/staff/${pick(staff).id}/pay`, { category: 'Avans', amount: TL(pick([2000, 3000, 5000])), method: 'cash', note: 'Maaş avansı' });
  }
  if (chance(0.25)) { at(ymd, 13); await api.post('/api/transactions', { kind: 'expense', category: pick(['Yemek', 'Temizlik', 'Ambalaj & Poşet', 'Kargo', 'Ulaşım']), amount: TL(ri(150, 1200)), method: 'cash', date: ymd }); }

  // Yeniden stok (her 3 haftada bir çok satanlar + sonbahar koleksiyonu girişi)
  if (d === -45) { at(ymd, 10); await purchaseFor(products.filter((p) => p.season.includes('Sonbahar')), ymd, 'SNB', 0.4); }
  if ((d + DAYS) % 21 === 0 && d < -2) {
    const low = products.filter((p) => p.variants.some((v) => stockOf(v.id) <= 1) && !p.season.startsWith('2025'));
    if (low.length) { at(ymd, 10, 30); await purchaseFor(low.slice(0, 12), ymd, 'YNL', 0.5); }
  }

  // Satışlar
  for (let i = 0; i < n; i++) {
    const hh = ri(10, Math.max(10, closeHour - 1));
    at(ymd, hh, ri(0, 59));
    const lines = [];
    const k = chance(0.55) ? 1 : chance(0.7) ? 2 : 3;
    for (let j = 0; j < k; j++) {
      const c = choosePV();
      if (!c || lines.some((l) => l.variant_id === c.v.id)) continue;
      const price = q.get('SELECT sale_price, discount_price FROM products WHERE id = ?', c.p.id);
      const unit = price.discount_price ?? price.sale_price;
      const disc = chance(0.12) ? round10((unit * pick([5, 10, 15])) / 100 / 100) * 100 : 0;
      lines.push({ variant_id: c.v.id, qty: 1, discount: disc, _t: unit - disc });
    }
    if (!lines.length) continue;
    const net = lines.reduce((s, l) => s + l._t, 0);
    lines.forEach((l) => delete l._t);
    const cart_discount = net > TL(3000) && chance(0.2) ? (net % 10000) : 0;
    const total = net - cart_discount;
    const eligible = customers.filter((c) => c.joined <= d);
    const withCustomer = eligible.length && (chance(0.35) || total > TL(5000));
    const customer = withCustomer ? pick(eligible) : null;
    let payments;
    const r = rnd();
    if (customer && r < 0.1) payments = [{ method: 'credit', amount: total }];
    else if (r < 0.42) payments = [{ method: 'cash', amount: total }];
    else if (r < 0.93) payments = [{ method: 'card', amount: total }];
    else if (r < 0.97) payments = [{ method: 'transfer', amount: total }];
    else { const cash = Math.min(total, Math.round(total / 2 / 10000) * 10000); payments = [{ method: 'cash', amount: cash }, { method: 'card', amount: total - cash }].filter((p) => p.amount > 0); }
    const seller = pick(sellers);
    const s = await api.post('/api/sales', { items: lines, cart_discount, customer_id: customer?.id, staff_id: seller.id, payments, force_credit: true });
    saleIds.push({ id: s.id, d, customer: customer?.id });
  }

  // İadeler / değişimler (~%4)
  if (chance(0.35) && saleIds.length > 20) {
    const cand = saleIds.filter((x) => x.d >= d - 12 && x.d < d);
    if (cand.length) {
      const target = pick(cand);
      const det = await api.get(`/api/sales/${target.id}`);
      const item = det.items.find((x) => x.qty > 0 && x.returned_qty < x.qty && x.variant_id);
      if (item) {
        at(ymd, ri(11, Math.max(11, closeHour - 1)));
        if (chance(0.55)) {
          // değişim: farklı beden
          const alt = q.get('SELECT id FROM variants WHERE product_id = ? AND id != ? AND stock > 0 LIMIT 1', item.product_id, item.variant_id);
          if (alt) {
            const price = q.get('SELECT COALESCE(p.discount_price, p.sale_price) AS pr FROM products p WHERE id = ?', item.product_id).pr;
            const diff = price - item.total;
            await api.post('/api/sales', {
              items: [{ variant_id: alt.id, qty: 1, unit_price: price, discount: diff > 0 ? diff : 0 }], returns: [{ sale_item_id: item.id, qty: 1 }], customer_id: target.customer || undefined,
              staff_id: pick(sellers).id, payments: diff < 0 ? [{ method: 'cash', amount: diff }] : [], note: 'Beden değişimi',
            });
          }
        } else {
          const refundMethod = det.payments[0]?.method === 'credit' ? 'credit' : det.payments[0]?.method === 'card' ? 'card' : 'cash';
          await api.post('/api/sales', { returns: [{ sale_item_id: item.id, qty: 1 }], customer_id: target.customer || undefined, payments: [{ method: refundMethod, amount: -item.total }], note: 'Müşteri beğenmedi' });
        }
      }
    }
  }

  // Veresiye tahsilatları
  if (chance(0.3)) {
    const debtor = q.get(`SELECT customer_id, SUM(amount) b FROM customer_ledger l JOIN customers c ON c.id = l.customer_id WHERE c.store_id = (SELECT store_id FROM users WHERE email = ?)
      GROUP BY customer_id HAVING b > 0 ORDER BY RANDOM() LIMIT 1`, DEMO_EMAIL);
    if (debtor) {
      at(ymd, ri(12, 19));
      const amt = Math.min(debtor.b, Math.round((debtor.b * pick([0.3, 0.5, 1])) / 10000) * 10000 || debtor.b);
      await api.post(`/api/customers/${debtor.customer_id}/collect`, { amount: amt, method: pick(['cash', 'cash', 'card', 'transfer']) });
    }
  }

  // Tedarikçi ödemeleri
  if (dom === 15 || dom === 28) {
    at(ymd, 15);
    for (const sid of sup) {
      const bal = q.val('SELECT COALESCE(SUM(amount),0) FROM supplier_ledger WHERE supplier_id = ?', sid);
      if (bal > TL(5000) && chance(0.6)) await api.post(`/api/suppliers/${sid}/pay`, { amount: Math.round((bal * 0.4) / 100000) * 100000 || bal, method: 'transfer', note: 'Cari ödeme' });
    }
  }

  // Siparişler
  if (chance(0.13) && customers.length) {
    at(ymd, ri(11, 18));
    const c = pick(customers.filter((x) => x.joined <= d) || customers);
    if (c) {
      const p = pick(products.filter((x) => ['Abiye', 'Gelinlik', 'Takım Elbise', 'Elbise'].includes(q.val('SELECT name FROM categories WHERE id = ?', x.category_id))));
      const v = pick(p.variants);
      const price = p.sell;
      const o = await api.post('/api/orders', {
        customer_id: c.id, due_date: dayStr(d + ri(4, 20)), deposit: Math.round((price * pick([0.2, 0.3, 0.5])) / 10000) * 10000, deposit_method: pick(['cash', 'card']),
        staff_id: pick(sellers).id, note: pick(['Bedeni stokta yok, merkezden istenecek', 'Tadilatlı teslim — boy kısaltılacak', 'Farklı renk istendi', 'Nişan için acil']),
        items: [{ description: `${p.name} ${v.color}`, size: v.size, color: v.color, qty: 1, unit_price: price, variant_id: v.id }],
      });
      orderCount++;
      const age = -d;
      if (age > 20) {
        if (chance(0.85)) {
          at(dayStr(Math.min(0, d + ri(5, 15))), ri(12, 18));
          await api.post(`/api/orders/${o.id}/status`, { status: 'arrived' });
          const det = await api.get(`/api/orders/${o.id}`);
          await api.post('/api/sales', {
            order_id: o.id, customer_id: c.id, staff_id: det.staff_id, items: [{ variant_id: v.id, qty: 1, unit_price: price }],
            payments: [{ method: 'deposit', amount: det.deposit }, { method: 'card', amount: price - det.deposit }],
          });
        } else {
          await api.post(`/api/orders/${o.id}/status`, { status: 'cancelled', refund_deposit: true, refund_method: 'cash' });
        }
      } else if (age > 6) {
        await api.post(`/api/orders/${o.id}/status`, { status: pick(['ordered', 'arrived', 'notified']) });
      }
    }
  }

  // Gün sonu
  if (!isToday) {
    at(ymd, 21, 5);
    const c = await api.get('/api/cash');
    const diff = chance(0.8) ? 0 : pick([-5000, -2000, 1000, 2000]);
    await api.post('/api/cash/close', { counted_cash: Math.max(0, c.expected_cash + diff), note: diff ? 'Sayım farkı' : null });
    // Kasada fazla nakit biriktiyse bankaya yatır
    if (c.expected_cash > TL(40000) && chance(0.5)) {
      at(ymd, 21, 20);
      await api.post('/api/transactions', { kind: 'expense', category: 'Bankaya Yatan', amount: Math.round((c.expected_cash - TL(8000)) / 100000) * 100000, method: 'cash', date: ymd, description: 'Nakit bankaya yatırıldı' });
    }
  }
  if ((d + DAYS) % 20 === 0) process.stdout.write(`  ${ymd} tamam\n`);
}

// Kampanya: geçen sezon ürünlerine %40 indirim
at(todayIst, 9);
const oldIds = products.filter((p) => p.season.startsWith('2025')).map((p) => p.id);
await api.post('/api/products/bulk', { ids: oldIds, action: 'discount', value: 40, round: '90' });
await api.post('/api/tasks', { title: 'Sonbahar vitrinini yenile', due_date: dayStr(1) });
await api.post('/api/tasks', { title: 'Merter Tekstil ile yeni sezon siparişini görüş', due_date: dayStr(3) });
await api.post('/api/tasks', { title: 'Kasım ayı kampanya afişlerini hazırla', due_date: dayStr(10) });

setFakeNow(null);
server.close();
const store = q.get('SELECT s.* FROM stores s JOIN users u ON u.store_id = s.id WHERE u.email = ?', DEMO_EMAIL);
const cnt = (t) => q.val(`SELECT COUNT(*) FROM ${t} WHERE store_id = ?`, store.id);
console.log(`\nDemo mağaza hazır: ${store.name}`);
console.log(`  ${cnt('products')} ürün, ${cnt('variants')} varyant, ${cnt('customers')} müşteri, ${cnt('sales')} fiş, ${orderCount} sipariş`);
console.log('  Giriş: demo@dcgiyim.com / demo123   (mağaza sahibi)');
console.log('         mudur@dcgiyim.com / demo123  (müdür)');
console.log('         kasa@dcgiyim.com / demo123   (satış danışmanı)');
