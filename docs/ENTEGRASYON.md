# DC Giyim Satış — Dış Sistem Entegrasyon Rehberi

Bu belge, DC Giyim Satış'a (Express + `node:sqlite`, vanilla JS arayüz) dış sistemlerin **nasıl bağlanacağını** adım adım anlatır: yazar kasa (ÖKC), e-Arşiv/e-Fatura, kart ödemesi, SMS, WhatsApp, e-posta, pazaryerleri, muhasebe yazılımları, barkod/etiket yazıcı, kargo ve banka.

> **Önemli:** Bu depoda bugün **hiçbir dış sistem entegrasyonu yoktur**. Aşağıda "Mevcut durum" bölümü kodda gerçekten var olanı dosya/satır referansıyla listeler. Diğer tüm dosya adları, tablolar, uç noktalar ve ortam değişkenleri **öneridir** ve metinde **(henüz yok)** diye işaretlenmiştir. Mevzuat konularında (ÖKC, e-Arşiv, İYS, KVKK) son söz mali müşavirinize, entegratörünüze ve GİB'in güncel düzenlemelerine aittir; bu belge teknik yol haritasıdır, hukuki görüş değildir.

---

## İçindekiler

1. [Genel mimari](#1-genel-mimari)
2. [Mevcut durum (kodda ne var?)](#2-mevcut-durum-kodda-ne-var)
3. [Ortak altyapı: önce bunu kurun](#3-ortak-altyapı-önce-bunu-kurun)
4. [ÖKC / Yeni nesil yazar kasa](#41-ökc--yeni-nesil-yazar-kasa)
5. [e-Arşiv Fatura / e-Fatura (özel entegratör)](#42-e-arşiv-fatura--e-fatura-özel-entegratör)
6. [Kart ödemesi: fiziki POS, ÖKC-POS ve online ödeme linki](#43-kart-ödemesi-fiziki-pos-ökc-pos-ve-online-ödeme-linki)
7. [SMS ve İYS](#44-sms-ve-iys)
8. [WhatsApp Business (Cloud API)](#45-whatsapp-business-cloud-api)
9. [E-posta](#46-e-posta)
10. [Pazaryerleri (Trendyol, Hepsiburada)](#47-pazaryerleri-trendyol-hepsiburada)
11. [Muhasebe yazılımları (Logo, Mikro, Luca, Paraşüt)](#48-muhasebe-yazılımları-logo-mikro-luca-paraşüt)
12. [Barkod okuyucu ve etiket yazıcı](#49-barkod-okuyucu-ve-etiket-yazıcı)
13. [Kargo (isteğe bağlı)](#410-kargo-isteğe-bağlı)
14. [Banka (isteğe bağlı)](#411-banka-isteğe-bağlı)
15. [Yeni sağlayıcı ekleme rehberi](#5-yeni-sağlayıcı-ekleme-rehberi)
16. [Canlıya geçiş kontrol listesi](#6-canlıya-geçiş-kontrol-listesi)
17. [Genel sorun giderme](#7-genel-sorun-giderme)

---

## 1. Genel mimari

Uygulama tek bir Node.js sürecidir: `server/index.js` veritabanını açar (`initDb`) ve `server/app.js` içindeki Express uygulamasını dinlemeye başlar. Tüm iş kuralları senkron `node:sqlite` çağrılarıyla ve `tx()` (SAVEPOINT tabanlı işlem) içinde yürür.

Dış sistemler **yavaş, hataya açık ve asenkron**dur. Bu yüzden önerilen mimari "işlemsel giden kutusu" (transactional outbox) desenidir:

```
 ┌─────────────┐   POST /api/sales     ┌──────────────────────────────────────────┐
 │ Kasa ekranı │ ────────────────────▶ │ Express (server/routes/sales.js)          │
 │ (tarayıcı)  │                       │  tx(() => {                               │
 └─────────────┘                       │    insert sales / sale_items / payments   │
        ▲                              │    moveStock(...)                         │
        │ fiş / etiket                 │    enqueue('sale.created', …)  ◀─ (henüz yok)
        │ (window.print)               │  })                                       │
        │                              └───────────────┬──────────────────────────┘
        │                                              │ aynı SQLite dosyası
        │                              ┌───────────────▼──────────────────────────┐
        │                              │ outbox tablosu (henüz yok)               │
        │                              └───────────────┬──────────────────────────┘
        │                                              │ setInterval ile okunur
        │                              ┌───────────────▼──────────────────────────┐
        │                              │ server/integrations/worker.js (henüz yok)│
        │                              │  → sağlayıcı adaptörleri (HTTP, fetch)   │
        │                              └──┬─────────┬─────────┬─────────┬─────────┘
        │                                 │         │         │         │
        │                           e-Arşiv    SMS/WA   Pazaryeri   Muhasebe
        │
 ┌──────┴────────────────┐   GET/POST /api/devices/*  (cihaz belirteci ile, henüz yok)
 │ Kasa Köprüsü (yerel   │ ◀─────────────────────────── sunucudaki ÖKC/etiket işleri
 │ ajan, kasa bilgisayarı│ ──▶ ÖKC (GMP-3 / üretici SDK), Zebra/TSC etiket yazıcı
 └───────────────────────┘
```

Temel ilkeler:

1. **Satış asla dış sisteme bağımlı olmaz.** Satış kaydı ve kuyruğa yazma aynı `tx()` içinde olur; entegratör kapalı olsa bile kasa çalışmaya devam eder, iş sonradan gönderilir.
2. **Tek yazma noktası.** Stok değişikliği zaten tek yerden geçiyor: `server/stock.js` → `moveStock()`. Pazaryeri senkronizasyonu buraya bağlanır.
3. **Her iş en az bir kez gönderilir, sağlayıcı tarafı tekrarı önler.** Her kuyruk kaydının `dedupe_key`'i ve belgenin sağlayıcıya giden benzersiz kimliği (ör. e-Arşiv ETTN/UUID) olur; yeniden denemede aynı kimlik kullanılır.
4. **Çok mağazalılık.** Tek sunucuda birden çok mağaza çalışır (`stores` tablosu, her tabloda `store_id`). Her mağazanın entegratör/SMS/pazaryeri hesabı **farklıdır**, bu yüzden mağaza bazlı kimlik bilgileri veritabanında şifreli saklanır; platform çapındaki anahtarlar ortam değişkenindedir.
5. **Tarayıcı dış sisteme doğrudan bağlanmaz.** CSP (`server/app.js:25-26`, `connect-src 'self'`) buna zaten izin vermez; tüm çağrılar sunucudan veya yerel köprüden yapılır.

---

## 2. Mevcut durum (kodda ne var?)

| Konu | Durum | Nerede |
|---|---|---|
| Dış sisteme giden HTTP çağrısı | **Yok** | — |
| Kuyruk / outbox / arka plan işçisi | **Yok** | — |
| Entegrasyon ayarları / sır saklama | **Yok** | — |
| Yapılandırma modülü | **Yok** — yalnızca 3 ortam değişkeni okunur | `server/index.js:7-9` → `DB_FILE`, `PORT`, `HOST`; `server/seed.js:10-12` → `DB_FILE`, `SEED_DAYS` |
| Şema yönetimi | `CREATE TABLE IF NOT EXISTS` ile tek seferlik şema; **göç (migration) sistemi yok** | `server/db.js:10` (`SCHEMA`), `initDb()` |
| Fiş yazdırma | Tarayıcıdan 80 mm termal fiş; alt satırda "Bu belge bilgi fişidir, mali değeri yoktur." yazar → **ÖKC/e-Arşiv yok** | `public/js/receipt.js` → `receiptNode()`, `printReceipt()`; `public/js/core.js` → `printHTML()` |
| Etiket yazdırma | Tarayıcıdan HTML/SVG etiket (`window.print`), ham ZPL/TSPL yok | `public/js/receipt.js` → `printLabels()`; `public/js/components.js` → `barcodeSVG()` |
| Barkod üretimi | Mağaza içi EAN-13 (2 ile başlar), kontrol haneli | `server/stock.js` → `generateBarcode()`, `ean13Check()` |
| Barkod okuma | Klavye gibi davranan (HID/"keyboard wedge") okuyucu ile çalışır | `GET /api/variants/lookup?code=` (`server/routes/products.js`) |
| WhatsApp | Yalnızca `wa.me` bağlantısı (kullanıcı elle gönderir, API yok) | `public/js/core.js` → `waLink()`; kullanımlar: `public/js/pages/pos.js` (satış sonrası teşekkür), `public/js/pages/dashboard.js` (sipariş hazır, veresiye hatırlatma, doğum günü) |
| Ödeme yöntemleri | Sabit liste; kart tutarı kasiyer tarafından elle girilir, POS'a bağlı değil | `server/util.js` → `PAY_METHODS = ['cash','card','transfer','credit','deposit']`, `CASH_METHODS`, `METHOD_LABELS`; arayüzde `public/js/core.js` → `METHOD` |
| Vergi alanları | Mağaza: `stores.tax_office`, `stores.tax_no`; müşteri: `customers.tax_no` ("TC/Vergi no"); ürün: `products.vat_rate`; satır: `sale_items.vat_rate` | `server/db.js` şeması; KDV dökümü `server/routes/sales.js` → `saleDetail()` içinde `sale.vat` |
| Veri dışa aktarım | Mağaza verisinin tamamı JSON (yalnızca sahip) ve arayüzde CSV indirme | `GET /api/backup` (`server/routes/settings.js`); `public/js/core.js` → `downloadCSV()`, `csvMoney()` |
| Oturum/kimlik | Yalnızca çerez oturumu (`dc_oturum`); makine-makine (API anahtarı/cihaz belirteci) **yok** | `server/auth.js` → `authenticate`, `requireAuth` |
| CSRF | Değişiklik yapan her `/api` isteğinde `X-DC-Istek: 1` başlığı zorunlu | `server/app.js:32-37` |

**Para ve KDV kuralları** (her entegrasyonda geçerli):

- Tüm tutarlar **kuruş cinsinden tam sayı**dır (`12500` = 125,00 ₺). Satış fiyatları **KDV dahildir**.
- Bir satırın tahsil edilen tutarı `sale_items.total`'dır (satır indirimi ve sepet indirimi payı düşülmüş). İade satırlarında `qty` ve `total` negatiftir, `return_of` asıl satırı gösterir.
- Satır KDV'si, sistemin fişte kullandığı formülle aynı hesaplanmalıdır (`server/routes/sales.js`, `saleDetail`): `kdv = Math.round(total * oran / (100 + oran))`, `matrah = total - kdv`.
- Tarih/saat alanları mağazanın saat dilimine göre yerel metindir (`'YYYY-MM-DD HH:MM:SS'`, `server/util.js` → `localNow()`); dış sisteme ISO-8601 ve `+03:00` ile gönderin.

---

## 3. Ortak altyapı: önce bunu kurun

Aşağıdaki parçalar tüm entegrasyonların ortak temelidir. Bir kez kurulur; sonra her sağlayıcı yalnızca bir "adaptör" dosyası ekler.

### 3.1 Önerilen klasör yapısı (henüz yok)

```
server/
  config.js                     # ortam değişkenlerini tek yerden okur
  integrations/
    outbox.js                   # enqueue(), claim(), markDone(), markFailed()
    worker.js                   # setInterval döngüsü, olay → işleyici eşlemesi
    secrets.js                  # AES-256-GCM ile mağaza sırlarını şifreler/çözer
    accounts.js                 # integration_accounts okuma/yazma
    http.js                     # zaman aşımı + yeniden deneme sınıflandırmalı fetch
    mask.js                     # loglarda telefon/TCKN/IBAN maskeleme
    money.js                    # kuruş → "125.00", KDV ayrıştırma
    providers/
      earsiv/  (entegrator-x.js, fake.js)
      okc/     (jobs.js)        # köprü ajanı için iş üretimi
      sms/     (netgsm.js, fake.js)
      whatsapp/(cloud-api.js, fake.js)
      marketplace/ (trendyol.js, hepsiburada.js, fake.js)
      accounting/  (csv-export.js, parasut.js)
      labels/  (zpl.js, tspl.js)
  routes/
    integrations.js             # sahip için ayar uç noktaları
    devices.js                  # köprü ajanı uç noktaları (çerez değil, cihaz belirteci)
tests/
  integrations.test.js
```

### 3.2 Yapılandırma (`server/config.js`, henüz yok)

Bugün yalnızca `DB_FILE`, `PORT`, `HOST` (ve seed için `SEED_DAYS`) okunur. Entegrasyon için önerilen **yeni** ortam değişkenleri — hiçbiri kodda henüz yoktur:

| Önerilen değişken | Açıklama | Örnek |
|---|---|---|
| `INTEGRATIONS_MODE` | `off` (hiç gönderme), `sandbox` (sağlayıcıların test ortamı), `live` | `sandbox` |
| `INTEGRATION_SECRET_KEY` | Mağaza bazlı sırları şifrelemek için 32 baytlık anahtar (base64). **Kaybedilirse kayıtlı sırlar çözülemez.** | `openssl rand -base64 32` |
| `OUTBOX_POLL_MS` | İşçinin kuyruğu yoklama aralığı | `3000` |
| `OUTBOX_MAX_ATTEMPTS` | Bir iş kaç kez denendikten sonra "dead" olur | `12` |
| `PUBLIC_BASE_URL` | Sağlayıcıların geri çağıracağı (webhook) dış adres | `https://kasa.magazam.com` |

```js
// server/config.js  (öneri)
const mode = process.env.INTEGRATIONS_MODE || 'off';
if (!['off', 'sandbox', 'live'].includes(mode)) throw new Error('INTEGRATIONS_MODE geçersiz (off | sandbox | live)');

export const config = {
  integrationsMode: mode,
  secretKey: process.env.INTEGRATION_SECRET_KEY || null,
  pollMs: Number(process.env.OUTBOX_POLL_MS) || 3000,
  maxAttempts: Number(process.env.OUTBOX_MAX_ATTEMPTS) || 12,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
};

if (config.integrationsMode !== 'off' && !config.secretKey) {
  throw new Error('INTEGRATION_SECRET_KEY tanımlanmadan entegrasyonlar açılamaz');
}
```

Bu depoda bir `.env` okuyucu yoktur; değişkenleri servis yöneticisi (systemd `Environment=`, pm2 `env`, Docker `environment:`) ile verin. Node 22'de `node --env-file=.env server/index.js` de kullanılabilir. `.env` zaten `.gitignore`'dadır; **örnek değerler için `.env.example` ekleyin, gerçek sırları asla depoya koymayın.**

### 3.3 Şema ekleri (henüz yok)

`server/db.js` içindeki `SCHEMA` dizesine eklenecek tablolar. `CREATE TABLE IF NOT EXISTS` sayesinde mevcut veritabanlarında da ilk açılışta oluşur:

```sql
-- Giden kutusu: dış sisteme gidecek her iş
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  topic TEXT NOT NULL,                 -- 'sale.created', 'stock.changed', 'sms.send' …
  provider TEXT,                       -- NULL: mağazada açık tüm uygun sağlayıcılar
  payload TEXT NOT NULL,               -- JSON; kişisel veri yerine mümkünse kayıt kimliği
  dedupe_key TEXT,                     -- aynı işin iki kez kuyruğa girmesini engeller
  status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | dead
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0, -- epoch ms
  locked_until INTEGER,
  last_error TEXT,
  created_at TEXT,
  done_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_outbox_dedupe ON outbox(store_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS ix_outbox_due ON outbox(status, next_attempt_at);

-- Mağaza bazlı sağlayıcı hesapları
CREATE TABLE IF NOT EXISTS integration_accounts (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                  -- 'earsiv' | 'okc' | 'sms' | 'whatsapp' | 'marketplace' | 'accounting' …
  provider TEXT NOT NULL,              -- 'fake' | 'netgsm' | 'trendyol' …
  enabled INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}', -- gizli olmayan ayarlar (JSON)
  secret_enc TEXT,                     -- şifreli sırlar (secrets.js)
  created_at TEXT, updated_at TEXT,
  UNIQUE (store_id, kind, provider)
);

-- Kayıt ↔ dış belge eşlemesi (e-Arşiv ETTN, ÖKC fiş no, pazaryeri sipariş no…)
CREATE TABLE IF NOT EXISTS external_refs (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  ref_type TEXT NOT NULL,              -- 'sale' | 'variant' | 'customer' …
  ref_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT,                    -- ETTN, fiş no, pazaryeri ürün id …
  status TEXT,                         -- 'issued' | 'cancelled' | 'error' …
  data TEXT,                           -- sağlayıcı yanıtından saklanması gereken alanlar (JSON)
  created_at TEXT, updated_at TEXT,
  UNIQUE (store_id, ref_type, ref_id, provider)
);

-- Makine-makine kimliği (Kasa Köprüsü)
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,     -- sha256; düz belirteç yalnızca bir kez gösterilir
  kinds TEXT NOT NULL DEFAULT 'okc,label',
  last_seen TEXT, active INTEGER DEFAULT 1, created_at TEXT
);
```

**Mevcut tablolara yeni sütun** eklemek (ör. müşteri izinleri) için `CREATE TABLE IF NOT EXISTS` yetmez; eski veritabanlarında sütun oluşmaz. `initDb()` sonunda küçük, tekrar çalıştırılabilir bir göç adımı ekleyin:

```js
// server/db.js — initDb() içinde db.exec(SCHEMA) satırından sonra (öneri)
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('customers', 'sms_consent', 'INTEGER DEFAULT 0');       // ticari ileti izni
addColumn('customers', 'consent_at', 'TEXT');
addColumn('customers', 'consent_source', 'TEXT');                // 'kasa', 'form', 'iys'
```

### 3.4 Kuyruğa yazma: `enqueue()` (henüz yok)

```js
// server/integrations/outbox.js  (öneri)
import { q, insert } from '../db.js';
import { localNow } from '../util.js';

/**
 * Dış sisteme gidecek işi kuyruğa yazar. MUTLAKA iş kaydıyla aynı tx() içinde çağrılmalıdır;
 * böylece satış geri alınırsa kuyruk kaydı da geri alınır.
 */
export function enqueue(storeId, topic, payload, { provider = null, dedupeKey = null, delayMs = 0, tz } = {}) {
  if (dedupeKey && q.get(`SELECT 1 FROM outbox WHERE store_id = ? AND dedupe_key = ? AND status IN ('pending','processing')`, storeId, dedupeKey)) {
    return null; // aynı iş zaten bekliyor (ör. aynı varyantın stok güncellemesi)
  }
  return insert('outbox', {
    store_id: storeId, topic, provider, payload: JSON.stringify(payload), dedupe_key: dedupeKey,
    status: 'pending', attempts: 0, next_attempt_at: Date.now() + delayMs, created_at: localNow(tz),
  });
}

/** İşçi için: zamanı gelmiş işleri atomik olarak sahiplenir (tek süreç varsayımı + kilit süresi). */
export function claim(limit = 20, lockMs = 60_000) {
  const now = Date.now();
  const rows = q.all(`SELECT * FROM outbox WHERE status IN ('pending','processing')
      AND next_attempt_at <= ? AND (locked_until IS NULL OR locked_until < ?) ORDER BY id LIMIT ?`, now, now, limit);
  for (const r of rows) q.run(`UPDATE outbox SET status = 'processing', locked_until = ? WHERE id = ?`, now + lockMs, r.id);
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

export function markDone(id) {
  q.run(`UPDATE outbox SET status = 'done', locked_until = NULL, last_error = NULL, done_at = ? WHERE id = ?`, localNow(), id);
}

export function markFailed(job, err, maxAttempts) {
  const attempts = job.attempts + 1;
  const permanent = err?.permanent === true || attempts >= maxAttempts;
  // Üstel geri çekilme: 30 sn, 1 dk, 2 dk … en fazla 6 saat; ± %20 rastgelelik
  const base = Math.min(30_000 * 2 ** (attempts - 1), 6 * 3600_000);
  const next = Date.now() + Math.round(base * (0.8 + Math.random() * 0.4));
  q.run(`UPDATE outbox SET status = ?, attempts = ?, next_attempt_at = ?, locked_until = NULL, last_error = ? WHERE id = ?`,
    permanent ? 'dead' : 'pending', attempts, next, String(err?.message || err).slice(0, 500), job.id);
}
```

Çağrı noktası örneği — `server/routes/sales.js` içinde `POST /sales` işleyicisinin `tx(() => { … })` bloğunun sonunda, `return { id: saleId, no, total };` satırından hemen önce:

```js
// server/routes/sales.js  (öneri — tx() bloğunun içinde)
import { enqueue } from '../integrations/outbox.js';
// …
    enqueue(sid, 'sale.created', { sale_id: saleId }, { dedupeKey: `sale:${saleId}`, tz: req.store.timezone });
    return { id: saleId, no, total };
```

Stok değişimleri için tek nokta `server/stock.js` → `moveStock()`'tur (satış, iade, alış, düzeltme, sayım, açılış stoğu, fiş iptali hepsi buradan geçer). Pazaryeri senkronizasyonu açıksa buraya eklenir:

```js
// server/stock.js — moveStock() sonunda (öneri)
import { enqueue } from './integrations/outbox.js';
// …
  insert('stock_movements', { … });
  // Aynı varyant için bekleyen iş varsa yenisi eklenmez; işçi gönderim anında GÜNCEL stoğu okur.
  enqueue(storeId, 'stock.changed', { variant_id: variantId }, { dedupeKey: `stock:${variantId}`, delayMs: 5000 });
```

> Not: `server/routes/products.js` içinde hiç hareket görmemiş ürün/varyant silinirken `variants` satırları doğrudan silinir (`DELETE /products/:id`, `DELETE /variants/:id`) ve toplu fiyat değişikliği (`POST /products/bulk`) `moveStock`'a uğramaz. Pazaryeri senkronu kurarken bu üç yere de `variant.removed` / `price.changed` olayları ekleyin.

### 3.5 İşçi: `server/integrations/worker.js` (henüz yok)

`node:sqlite` senkron çalışır; dış çağrılar asenkrondur. Kural: **veritabanı işlemi (tx) açıkken `await` yapılmaz.** Önce iş sahiplenilir, sonra HTTP çağrısı yapılır, sonra sonuç kısa bir yazma ile kaydedilir.

```js
// server/integrations/worker.js  (öneri)
import { config } from '../config.js';
import { claim, markDone, markFailed } from './outbox.js';
import { handlers } from './handlers.js'; // { 'sale.created': async (job) => {…}, … }

let timer = null;
let busy = false;

export function startWorker(log = console) {
  if (config.integrationsMode === 'off') { log.log('[entegrasyon] kapalı (INTEGRATIONS_MODE=off)'); return; }
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const job of claim()) {
        const handler = handlers[job.topic];
        try {
          if (!handler) throw Object.assign(new Error(`İşleyici yok: ${job.topic}`), { permanent: true });
          await handler(job);
          markDone(job.id);
        } catch (err) {
          markFailed(job, err, config.maxAttempts);
          log.error(`[entegrasyon] #${job.id} ${job.topic} başarısız (deneme ${job.attempts + 1}): ${err.message}`);
        }
      }
    } finally { busy = false; }
  }, config.pollMs);
  timer.unref();
}

export function stopWorker() { if (timer) clearInterval(timer); }
```

`server/index.js`'te `app.listen(...)` sonrasına `startWorker()` ekleyin ve `shutdown` fonksiyonunda `stopWorker()` çağırın. Testler `createApp()`'i doğrudan kullandığı için (`tests/api.test.js`) işçi testlerde **kendiliğinden çalışmaz**; bu istenen davranıştır.

> Uygulama tek süreç olarak tasarlandı (SQLite + bellek içi oran sınırlayıcı). Birden fazla Node süreci (pm2 cluster vb.) çalıştıracaksanız işçiyi yalnızca birinde açın (ör. `WORKER=1` benzeri bir değişkenle) — `claim()` içindeki kilit süresi tek süreç varsayımıyla yazılmıştır.

### 3.6 Hata sınıflandırma ve HTTP yardımcısı

```js
// server/integrations/http.js  (öneri) — Node 22'nin yerleşik fetch'i kullanılır, ek bağımlılık gerekmez
export class ProviderError extends Error {
  constructor(message, { permanent = false, status = null, code = null } = {}) {
    super(message); this.permanent = permanent; this.status = status; this.code = code;
  }
}

export async function callJson(url, { method = 'POST', headers = {}, body, timeoutMs = 15_000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ProviderError(`Bağlantı hatası: ${e.name === 'TimeoutError' ? 'zaman aşımı' : e.message}`); // geçici
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (res.ok) return data;
  // 4xx (408/429 hariç) genelde veri/kimlik hatasıdır → tekrar denemek işe yaramaz
  const permanent = res.status >= 400 && res.status < 500 && ![408, 409, 425, 429].includes(res.status);
  throw new ProviderError(`Sağlayıcı ${res.status}: ${(data && (data.message || data.error)) || text.slice(0, 200)}`, { permanent, status: res.status });
}

const safeJson = (t) => { try { return JSON.parse(t); } catch { return { raw: t.slice(0, 500) }; } };
```

| Hata türü | Örnek | Davranış |
|---|---|---|
| Geçici | zaman aşımı, 5xx, 429, bağlantı koptu | Üstel geri çekilmeyle yeniden dene |
| Kalıcı (veri) | 400 "VKN geçersiz", zorunlu alan eksik | `dead` yap, arayüzde "Entegrasyon hataları" listesinde göster, kullanıcı düzeltince "yeniden gönder" |
| Kalıcı (kimlik) | 401/403 | `dead` + mağaza sahibine uyarı; hesap `enabled = 0` yapılabilir |
| Belirsiz | istek gitti, yanıt gelmedi | Sağlayıcıda aynı benzersiz kimlikle **sorgula**, sonra karar ver (özellikle e-Arşiv) |

### 3.7 Sırların saklanması: `server/integrations/secrets.js` (henüz yok)

```js
// server/integrations/secrets.js  (öneri) — node:crypto, AES-256-GCM
import crypto from 'node:crypto';
import { config } from '../config.js';

const key = () => {
  const k = Buffer.from(config.secretKey || '', 'base64');
  if (k.length !== 32) throw new Error('INTEGRATION_SECRET_KEY 32 bayt (base64) olmalıdır');
  return k;
};

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function open(sealed) {
  if (!sealed) return {};
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1') throw new Error('Bilinmeyen sır biçimi');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
}
```

Kurallar:

- API şifreleri, belirteçler, istemci sırları **yalnızca** `integration_accounts.secret_enc`'de (şifreli) veya ortam değişkeninde durur. `settings` sütununa sır yazılmaz.
- `GET` uç noktaları sırları **asla** döndürmez; yalnızca `has_secret: true` gibi bir bayrak döner.
- `GET /api/backup` (`server/routes/settings.js`) `BACKUP_TABLES` listesine `integration_accounts` ve `devices` **eklenmemelidir**.
- Loglarda telefon, TCKN/VKN, IBAN, e-posta maskelenir (`mask.js`), istek/yanıt gövdesi ham olarak yazılmaz.

### 3.8 Ayar uç noktaları (henüz yok)

Mevcut desen: `server/routes/settings.js` içinde `const owner = requireRole('owner');` ile korunan rotalar ve `log(req, …)` ile işlem geçmişi. Aynı deseni izleyin; her sorguda `store_id = req.store.id` koşulu şarttır:

```js
// server/routes/integrations.js  (öneri)
import { Router } from 'express';
import { q, insert } from '../db.js';
import { requireRole } from '../auth.js';
import { bad, str, oneOf, localNow, log } from '../util.js';
import { seal } from '../integrations/secrets.js';

const r = Router();
const owner = requireRole('owner');
const KINDS = ['earsiv', 'okc', 'sms', 'whatsapp', 'email', 'marketplace', 'accounting', 'payment', 'cargo'];

r.get('/integrations', owner, (req, res) => {
  const rows = q.all('SELECT id, kind, provider, enabled, settings, secret_enc IS NOT NULL AS has_secret, updated_at FROM integration_accounts WHERE store_id = ?', req.store.id);
  const errors = q.all(`SELECT id, topic, provider, attempts, last_error, created_at FROM outbox
    WHERE store_id = ? AND status = 'dead' ORDER BY id DESC LIMIT 100`, req.store.id);
  res.json({ accounts: rows.map((x) => ({ ...x, settings: JSON.parse(x.settings) })), errors });
});

r.put('/integrations/:kind/:provider', owner, (req, res) => {
  const kind = oneOf(req.params.kind, KINDS, 'Entegrasyon türü');
  const provider = str(req.params.provider, { required: true, max: 40, name: 'Sağlayıcı' });
  const b = req.body || {};
  const settings = JSON.stringify(b.settings || {});
  if (settings.length > 5000) throw bad('Ayarlar çok uzun');
  const now = localNow(req.store.timezone);
  const existing = q.get('SELECT id FROM integration_accounts WHERE store_id = ? AND kind = ? AND provider = ?', req.store.id, kind, provider);
  const secret = b.secrets && Object.keys(b.secrets).length ? seal(b.secrets) : undefined; // boş gelirse eski sır korunur
  if (existing) {
    q.run(`UPDATE integration_accounts SET enabled = ?, settings = ?, secret_enc = COALESCE(?, secret_enc), updated_at = ? WHERE id = ?`,
      b.enabled ? 1 : 0, settings, secret ?? null, now, existing.id);
  } else {
    insert('integration_accounts', { store_id: req.store.id, kind, provider, enabled: b.enabled ? 1 : 0, settings, secret_enc: secret ?? null, created_at: now, updated_at: now });
  }
  log(req, 'Entegrasyon ayarı değişti', `${kind}/${provider} ${b.enabled ? 'açık' : 'kapalı'}`); // sır loglanmaz
  res.json({ ok: true });
});

r.post('/integrations/outbox/:id/retry', owner, (req, res) => {
  const n = q.run(`UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL
    WHERE id = ? AND store_id = ? AND status = 'dead'`, Number(req.params.id) || 0, req.store.id).changes;
  if (!n) throw bad('Yeniden gönderilecek kayıt bulunamadı');
  res.json({ ok: true });
});

export default r;
```

`server/app.js` satır 41'deki `app.use('/api', requireAuth, products, sales, …, settings)` listesine `integrations` eklenir. Arayüzde `public/js/pages/settings.js` içindeki sekmelere (`store`, `categories`, `sizes`) bir **"Entegrasyonlar"** sekmesi eklenir; sır alanları `type="password"` olur ve kayıttan sonra boş gösterilir.

### 3.9 Test ve sandbox stratejisi

- `INTEGRATIONS_MODE=off`: kuyruk dolar ama hiçbir şey gönderilmez (geliştirme ve demo verisi için varsayılan). `npm run seed` ile üretilen yüzlerce demo satış **asla** gerçek entegratöre gitmemelidir.
- `INTEGRATIONS_MODE=sandbox`: adaptörler sağlayıcının test ortamı adresini kullanır (her adaptör `mode === 'live' ? CANLI_URL : TEST_URL` seçer).
- Her tür için bir `fake` sağlayıcı yazın: çağrıları bellekte biriktirir, `external_refs`'e sahte kimlik yazar. Birim testleri (`node --test`, `initDb(':memory:')`) bununla koşar:

```js
// tests/integrations.test.js  (öneri — mevcut tests/api.test.js desenine uygun)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, q } from '../server/db.js';
import { enqueue, claim, markFailed } from '../server/integrations/outbox.js';

test('aynı dedupe anahtarı iki kez kuyruğa girmez, hata sonrası geri çekilir', () => {
  initDb(':memory:');
  q.run("INSERT INTO stores (id, name) VALUES (1, 'Test')");
  assert.ok(enqueue(1, 'stock.changed', { variant_id: 5 }, { dedupeKey: 'stock:5' }));
  assert.equal(enqueue(1, 'stock.changed', { variant_id: 5 }, { dedupeKey: 'stock:5' }), null);
  const [job] = claim();
  markFailed(job, new Error('503'), 5);
  const row = q.get('SELECT status, attempts, next_attempt_at FROM outbox WHERE id = ?', job.id);
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.ok(row.next_attempt_at > Date.now());
});
```

### 3.10 Makine-makine kimlik: cihaz belirteci (Kasa Köprüsü için, henüz yok)

`server/auth.js` → `authenticate` yalnızca çerezle çalışır. Kasa bilgisayarındaki köprü ajanının çerezle oturum açması yerine, sahip panelinden üretilen bir **cihaz belirteci** kullanın:

```js
// server/routes/devices.js  (öneri)
import { Router } from 'express';
import crypto from 'node:crypto';
import { q } from '../db.js';
import { HttpError, localNow } from '../util.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function deviceAuth(req, _res, next) {
  const token = String(req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const d = token && q.get('SELECT * FROM devices WHERE token_hash = ? AND active = 1', sha(token));
  if (!d) return next(new HttpError(401, 'Cihaz tanınmadı. Belirteci Ayarlar > Entegrasyonlar ekranından yenileyin.'));
  req.device = d;
  req.store = q.get('SELECT * FROM stores WHERE id = ?', d.store_id);
  q.run('UPDATE devices SET last_seen = ? WHERE id = ?', localNow(req.store.timezone), d.id);
  next();
}

const r = Router();
r.use(deviceAuth);
// GET /api/devices/jobs, POST /api/devices/jobs/:id/result → bkz. 4.1 ve 4.9
export default r;
```

`server/app.js`'te bu yönlendirici `registerAuthRoutes(app)` satırından sonra, `requireAuth` içeren satırdan **önce** `app.use('/api/devices', devices)` ile bağlanmalıdır. CSRF kontrolü (`X-DC-Istek: 1`) tüm `/api` için geçerli olduğundan köprü ajanı bu başlığı da göndermelidir. Belirteç yalnızca oluşturulduğu anda bir kez gösterilir; veritabanında sadece `sha256` özeti saklanır (oturum belirteçleriyle aynı yöntem, `server/auth.js` → `sha`).

---

## 4. Entegrasyonlar

Her başlık aynı sırayı izler: ne işe yarar → önkoşullar → kurulum → kod → veri akışı → hata yönetimi → test → güvenlik/KVKK → sorun giderme.

### 4.1 ÖKC / Yeni nesil yazar kasa

**Ne işe yarar.** Perakende satışta mali belge (ÖKC fişi) düzenlenmesi yasal zorunluluktur. Bugün uygulama yalnızca "bilgi fişi" basar (`public/js/receipt.js`, son satır: *"Bu belge bilgi fişidir, mali değeri yoktur."*). Entegrasyonla kasiyer satışı bir kez girer; sepet, KDV oranları ve ödeme tipleri ÖKC'ye aktarılır, mali fiş ÖKC'den çıkar, fiş/Z numarası sisteme geri yazılır. Çift giriş ve "kasa ile sistem tutmuyor" sorunu ortadan kalkar.

**Önkoşullar.**
- GİB onaylı, **harici uygulama/bilgisayar ile eşleşmeyi (GMP-3 protokolü veya üreticinin entegrasyon SDK'sı)** destekleyen bir yeni nesil ÖKC (Android ÖKC-POS'larda genellikle "harici uygulama entegrasyonu" API'si bulunur).
- Üreticiden/bayiden: entegrasyon SDK'sı ve dokümanı, eşleşme (pairing) prosedürü, test cihazı veya test modu, desteklenen **ödeme tipleri** ve **KDV departman** eşlemesi.
- Mali müşavirden: veresiye (`credit`), kapora (`deposit`) ve havale (`transfer`) satışlarının ÖKC'de hangi ödeme tipine işleneceği; iade/değişimde gider pusulası/iade faturası uygulaması.

**Mimari seçim.** ÖKC, kasadaki bilgisayara USB/seri/ethernet ile bağlıdır; sunucu buluttadır. İki seçenek vardır:

| Seçenek | Nasıl | Artı | Eksi |
|---|---|---|---|
| **A) Yoklamalı köprü (önerilen)** | Kasa bilgisayarında küçük bir "Kasa Köprüsü" servisi sunucuya `GET /api/devices/jobs` ile iş sorar, ÖKC'ye gönderir, sonucu `POST` eder | NAT/güvenlik duvarı sorunu yok; CSP değişmez; iş kuyrukta kaybolmaz | Birkaç saniyelik gecikme (uzun yoklama ile azaltılabilir) |
| B) Tarayıcı → yerel ajan | Kasa ekranı `http://127.0.0.1:PORT`'a doğrudan istek atar | Anlık | `server/app.js`'teki CSP `connect-src 'self'` değiştirilmeli; tarayıcıların özel ağ erişimi kısıtlamaları; sekme kapanırsa iş kaybolur |

**Kurulum adımları (A seçeneği).**
1. Ortak altyapıyı (bölüm 3) kurun; `devices` tablosu ve `server/routes/devices.js` hazır olsun.
2. Ayarlar > Entegrasyonlar'da "Kasa Köprüsü ekle" → cihaz adı → belirteç bir kez gösterilir.
3. Köprü ajanını kasa bilgisayarına kurun (üretici SDK'sı genelde Windows kütüphanesi olduğundan ajan çoğunlukla Windows servisi olarak yazılır; dil serbesttir). Ajan yapılandırması: sunucu adresi, cihaz belirteci, ÖKC bağlantı noktası.
4. ÖKC ile eşleşmeyi üreticinin prosedürüyle yapın (genellikle ÖKC menüsünden eşleşme kodu).
5. `integration_accounts`'a `kind='okc'` kaydı açın; `settings` içinde KDV oranı → departman eşlemesi ve ödeme tipi eşlemesi tutulur:

```json
{ "vatDepartments": { "0": 1, "1": 2, "10": 3, "20": 4 },
  "paymentMap": { "cash": "NAKIT", "card": "KREDI_KARTI", "transfer": "DIGER", "credit": "DIGER", "deposit": "DIGER" } }
```

**Kodda nereye/nasıl.**

```js
// server/integrations/handlers.js — 'sale.created' içinde ÖKC işi üretimi (öneri)
import { q } from '../db.js';

export function buildOkcJob(storeId, saleId) {
  const sale = q.get('SELECT * FROM sales WHERE id = ? AND store_id = ?', saleId, storeId);
  const items = q.all('SELECT name, size, color, barcode, qty, unit_price, discount, cart_discount_share, total, vat_rate, return_of FROM sale_items WHERE sale_id = ? ORDER BY id', saleId);
  const pays = q.all('SELECT method, amount FROM payments WHERE sale_id = ? ORDER BY id', saleId);
  return {
    type: sale.total < 0 ? 'refund' : 'sale',
    sale_no: sale.no,
    lines: items.filter((i) => i.qty > 0).map((i) => ({
      name: [i.name, i.size, i.color].filter(Boolean).join(' ').slice(0, 40), // ÖKC satır uzunluğu sınırlıdır
      barcode: i.barcode, qty: i.qty, vat_rate: i.vat_rate,
      gross_kurus: i.qty * i.unit_price, discount_kurus: i.discount + i.cart_discount_share, total_kurus: i.total,
    })),
    returns: items.filter((i) => i.qty < 0).map((i) => ({ name: i.name, qty: -i.qty, vat_rate: i.vat_rate, total_kurus: -i.total, return_of: i.return_of })),
    payments: pays,
  };
}
```

```js
// server/routes/devices.js — köprü uç noktaları (öneri, deviceAuth'tan sonra)
r.get('/jobs', (req, res) => {
  const jobs = q.all(`SELECT id, topic, payload FROM outbox WHERE store_id = ? AND provider = 'okc-bridge'
    AND status = 'pending' ORDER BY id LIMIT 5`, req.store.id);
  for (const j of jobs) q.run(`UPDATE outbox SET status = 'processing', locked_until = ? WHERE id = ?`, Date.now() + 120_000, j.id);
  res.json(jobs.map((j) => ({ id: j.id, topic: j.topic, ...JSON.parse(j.payload) })));
});

r.post('/jobs/:id/result', (req, res) => {
  const job = q.get(`SELECT * FROM outbox WHERE id = ? AND store_id = ? AND provider = 'okc-bridge'`, Number(req.params.id) || 0, req.store.id);
  if (!job) throw new HttpError(404, 'İş bulunamadı');
  const b = req.body || {};
  if (b.ok) {
    // fiş no, Z no, EKÜ no gibi alanlar external_refs.data'ya yazılır
    q.run(`INSERT INTO external_refs (store_id, ref_type, ref_id, provider, external_id, status, data, created_at)
      VALUES (?, 'sale', ?, 'okc', ?, 'issued', ?, ?) ON CONFLICT (store_id, ref_type, ref_id, provider)
      DO UPDATE SET external_id = excluded.external_id, status = 'issued', data = excluded.data`,
    req.store.id, JSON.parse(job.payload).sale_id, String(b.receipt_no || ''), JSON.stringify({ z_no: b.z_no, eku_no: b.eku_no }), localNow(req.store.timezone));
    markDone(job.id);
  } else {
    markFailed(job, Object.assign(new Error(String(b.error || 'ÖKC hatası').slice(0, 300)), { permanent: !!b.permanent }), config.maxAttempts);
  }
  res.json({ ok: true });
});
```

`POST /sales` içinde ÖKC hesabı açık mağazalar için `enqueue(sid, 'okc.print', { sale_id: saleId, ...buildOkcJob(sid, saleId) }, { provider: 'okc-bridge', dedupeKey: \`okc:${saleId}\` })` çağrılır. Kasa ekranı (`public/js/pages/pos.js`, satış sonrası ekran) "Mali fiş bekleniyor…" durumunu `GET /api/sales/:id` yanıtına eklenecek `fiscal` alanından (`external_refs` birleşimi) okur.

**Veri akışı.** Kasa → `POST /api/sales` → (tx) satış + `okc.print` işi → köprü ajanı `GET /api/devices/jobs` → ÖKC'ye satış → ÖKC fişi basılır → ajan `POST /api/devices/jobs/:id/result` → `external_refs` (fiş no/Z no) → kasa ekranı "Mali fiş kesildi".

**Hata yönetimi.**
- ÖKC kağıdı bitti/kapak açık: ajan `ok:false, permanent:false` döner → iş yeniden denenir; kasa ekranında uyarı.
- Satış ÖKC'de kısmen işlendi (bağlantı koptu): ajan, ÖKC'nin "son işlem durumu" sorgusuyla işlemin tamamlanıp tamamlanmadığını kontrol etmeden **yeniden göndermemelidir** (çift fiş riski).
- **Fiş iptali:** `DELETE /api/sales/:id` (`server/routes/sales.js`) bugün satışı tamamen siler. ÖKC fişi kesilmiş bir satış için bu uç nokta engellenmeli, yerine iade akışı kullanılmalıdır:

```js
// server/routes/sales.js — r.delete('/sales/:id', …) başında (öneri)
if (q.get(`SELECT 1 FROM external_refs WHERE store_id = ? AND ref_type = 'sale' AND ref_id = ? AND status = 'issued'`, req.store.id, sale.id)) {
  throw bad('Bu satış için mali belge düzenlenmiş. Fişi silmek yerine iade işlemi yapın.');
}
```

**Test.** Üreticinin test modu/test cihazıyla; `fake` köprü (iş alıp rastgele fiş no döndüren küçük bir betik) ile sunucu tarafı uçtan uca test edilir.

**Güvenlik & KVKK.** Cihaz belirteci yalnızca `sha256` olarak saklanır; ajan yapılandırma dosyası yalnızca servis kullanıcısınca okunabilir olmalı. Köprüye müşteri adı/telefonu gönderilmez (ÖKC fişine gerekmez).

**Sorun giderme.** "Cihaz tanınmadı" → belirteç yenilendi mi / cihaz pasif mi; iş hiç alınmıyor → ajan saat/proxy ayarı, `X-DC-Istek: 1` başlığı; KDV hatası → `vatDepartments` eşlemesinde ürünün `vat_rate`'i var mı.

---

### 4.2 e-Arşiv Fatura / e-Fatura (özel entegratör)

**Ne işe yarar.** Fatura isteyen müşteriye (kurumsal ya da bireysel), toptan/kurumsal satışlara ve mevzuatın fatura gerektirdiği durumlara elektronik fatura düzenler. Alıcı **e-Fatura mükellefiyse e-Fatura**, değilse **e-Arşiv Fatura** kesilir; bu kontrolü entegratörün "mükellef sorgulama" servisi yapar.

**Önkoşullar.**
- İşletmenin e-Arşiv (ve gerekiyorsa e-Fatura) başvurusu tamamlanmış ve bir **GİB özel entegratörü** ile sözleşmesi olmalı.
- Entegratörden: API kullanıcı adı/şifresi veya API anahtarı, test (sandbox) ve canlı uç noktaları, fatura seri/ön eki, XSLT şablonu (logo, banka bilgisi), mükellef sorgulama servisi, iptal/itiraz kuralları.
- Mağaza bilgileri eksiksiz olmalı: `stores.name`, `address`, `city`, `tax_office`, `tax_no` (Ayarlar > Mağaza; `PUT /api/settings/store`).
- Müşteri tarafında: `customers.tax_no` (TCKN 11 hane / VKN 10 hane), ad/unvan, adres. Kurumsal müşteride vergi dairesi alanı bugün **yok** — `customers` tablosuna `tax_office` sütunu eklenmesi gerekir (bölüm 3.3'teki `addColumn` ile).

**Kurulum adımları.**
1. Ortak altyapı (bölüm 3).
2. `integration_accounts`: `kind='earsiv'`, `provider='<entegrator-adi>'`, `settings`: `{ "series": "DCG", "sendEmail": true, "autoForCustomers": false }`, `secrets`: `{ "username": "...", "password": "..." }`.
3. Karar verin: **her satışa otomatik** mi (ÖKC yoksa), yoksa **yalnızca kasiyer "Fatura kes" dediğinde** mi? Öneri: ÖKC varsa e-Arşiv yalnızca talep üzerine; ÖKC yoksa mali müşavirin yönlendirmesine göre.
4. Kasa ekranına (`public/js/pages/pos.js`) ödeme adımında "Fatura istiyor" seçeneği ve müşteri seçimi zorunluluğu eklenir; `POST /api/sales` gövdesine `invoice: true` alanı eklenir.

**Kodda nereye/nasıl.**

```js
// server/integrations/money.js  (öneri) — sistemdeki fiş KDV formülüyle birebir aynı
export const vatOf = (totalKurus, rate) => Math.round((totalKurus * rate) / (100 + rate));
export const tl = (kurus) => (kurus / 100).toFixed(2); // "125.00" — UBL'de nokta ondalık ayırıcıdır
```

```js
// server/integrations/providers/earsiv/mapper.js  (öneri) — satış → entegratörden bağımsız ara model
import { q } from '../../../db.js';
import { vatOf } from '../../money.js';

export function saleToInvoice(storeId, saleId) {
  const store = q.get('SELECT * FROM stores WHERE id = ?', storeId);
  const sale = q.get('SELECT * FROM sales WHERE id = ? AND store_id = ?', saleId, storeId);
  const c = sale.customer_id ? q.get('SELECT * FROM customers WHERE id = ? AND store_id = ?', sale.customer_id, storeId) : null;
  const items = q.all('SELECT * FROM sale_items WHERE sale_id = ? AND qty > 0 ORDER BY id', saleId);
  if (!store.tax_no) throw Object.assign(new Error('Mağaza vergi numarası eksik (Ayarlar > Mağaza)'), { permanent: true });
  const lines = items.map((i) => {
    const vat = vatOf(i.total, i.vat_rate);
    return {
      name: [i.name, i.size, i.color].filter(Boolean).join(' '), qty: i.qty, unit: 'C62', // adet
      vat_rate: i.vat_rate, total_incl_kurus: i.total, vat_kurus: vat, net_kurus: i.total - vat,
    };
  });
  return {
    uuid: null,                       // ilk gönderimde üretilip external_refs'e yazılır, yeniden denemede AYNI kullanılır
    issue_at: sale.created_at,        // yerel saat; gönderirken +03:00 eklenir
    currency: 'TRY',
    seller: { name: store.name, tax_no: store.tax_no, tax_office: store.tax_office, address: store.address, city: store.city },
    buyer: c
      ? { name: c.name, id_no: c.tax_no || null, address: c.address, city: c.city, email: c.email }
      : { name: 'Nihai Tüketici', id_no: null },
    lines,
    totals: {
      net_kurus: lines.reduce((s, l) => s + l.net_kurus, 0),
      vat_kurus: lines.reduce((s, l) => s + l.vat_kurus, 0),
      payable_kurus: lines.reduce((s, l) => s + l.total_incl_kurus, 0),
    },
    ref: { sale_no: sale.no },
  };
}
```

```js
// server/integrations/providers/earsiv/entegrator-x.js  (öneri — iskelet; alan adları entegratörün dokümanından alınır)
import crypto from 'node:crypto';
import { q, insert } from '../../../db.js';
import { callJson, ProviderError } from '../../http.js';
import { saleToInvoice } from './mapper.js';

export async function issueForSale(job, account, secrets, mode) {
  const { sale_id } = job.payload;
  const storeId = job.store_id;
  let ref = q.get(`SELECT * FROM external_refs WHERE store_id = ? AND ref_type = 'sale' AND ref_id = ? AND provider = ?`, storeId, sale_id, account.provider);
  if (ref?.status === 'issued') return; // zaten kesilmiş: idempotent
  if (!ref) {
    const id = insert('external_refs', { store_id: storeId, ref_type: 'sale', ref_id: sale_id, provider: account.provider, external_id: crypto.randomUUID(), status: 'pending' });
    ref = q.get('SELECT * FROM external_refs WHERE id = ?', id);
  }
  const inv = { ...saleToInvoice(storeId, sale_id), uuid: ref.external_id };
  const base = mode === 'live' ? 'https://<canli-adres>' : 'https://<test-adres>';
  // 1) Belirsizlik durumunda önce sorgula: belge önceki denemede oluşmuş olabilir
  const existing = await callJson(`${base}/invoices/${inv.uuid}`, { method: 'GET', headers: auth(secrets) }).catch(() => null);
  const result = existing || await callJson(`${base}/invoices`, { headers: auth(secrets), body: toProviderFormat(inv, account.settings) });
  if (!result?.uuid) throw new ProviderError('Entegratör yanıtında ETTN yok');
  q.run(`UPDATE external_refs SET status = 'issued', data = ? WHERE id = ?`, JSON.stringify({ number: result.number, pdf: result.pdfUrl ?? null }), ref.id);
}

const auth = (s) => ({ Authorization: `Basic ${Buffer.from(`${s.username}:${s.password}`).toString('base64')}` });
function toProviderFormat(inv, settings) { /* ara modeli entegratörün JSON/UBL-TR biçimine çevirin */ return { ...inv, series: settings.series }; }
```

**Veri akışı.** Kasa (fatura istendi) → `POST /api/sales` (tx: satış + `enqueue('invoice.issue', {sale_id})`) → işçi → `saleToInvoice` → entegratör → ETTN/fatura no → `external_refs` → fiş ekranında "e-Arşiv: DCG2026000000123" ve PDF bağlantısı; `sendEmail` açıksa entegratör faturayı müşterinin e-postasına iletir.

**İade ve iptal.** Sistemde iade, negatif satırlı yeni bir satış kaydıdır (`sale_items.return_of`). Faturası kesilmiş bir satışın iadesinde mevzuata uygun belge (alıcı mükellefse iade faturası; bireyselde gider pusulası veya entegratörün e-Arşiv iptal kuralları) mali müşavirle belirlenip `invoice.return` olayı olarak eklenmelidir. Fatura kesilmiş satışta `DELETE /api/sales/:id` 4.1'deki kontrolle engellenmelidir.

**Hata yönetimi.** Eksik mağaza VKN'si, geçersiz TCKN/VKN, boş adres gibi veri hataları `permanent` → `dead`; kullanıcı müşteri kaydını düzeltip "yeniden gönder"e basar (aynı ETTN ile). 5xx/zaman aşımında aynı ETTN ile sorgula → yoksa yeniden gönder.

**Test.** Entegratörün test hesabıyla: nihai tüketici, TCKN'li bireysel, VKN'li kurumsal (e-Fatura mükellefi ve değil), çok KDV oranlı sepet, sepet indirimi, kısmi iade senaryoları. Kuruş yuvarlaması: satır KDV'lerinin toplamı ile toplam KDV'nin entegratör doğrulamasından geçtiğini kontrol edin.

**Güvenlik & KVKK.** TCKN ve adres kişisel veridir: kuyruk `payload`'ına **yalnızca `sale_id`** yazın, kişisel veriyi işçi gönderim anında okusun. Loglarda TCKN maskelenir (`12*******34`). Entegratörle veri işleyen sözleşmesi (KVKK) yapılmalıdır.

**Sorun giderme.** "Satıcı VKN hatalı" → Ayarlar > Mağaza'daki `tax_no`; "Alıcı e-Fatura mükellefi" hatası → e-Arşiv yerine e-Fatura senaryosuna geçin (mükellef sorgusu yapılmıyorsa ekleyin); aynı faturanın iki kez kesilmesi → ETTN'in yeniden denemede değiştirilip değiştirilmediğini kontrol edin.

---

### 4.3 Kart ödemesi: fiziki POS, ÖKC-POS ve online ödeme linki

**Mevcut durum.** `card` ödemesi yalnızca bir etikettir; kasiyer tutarı banka POS'una ayrıca elle girer. Gün sonunda `POST /api/cash/close` (`server/routes/finance.js`) `card_total`'ı hesaplar ama banka slip toplamıyla otomatik karşılaştırma yoktur.

**Seçenekler.**

| Senaryo | Öneri |
|---|---|
| Ayrı banka POS'u | Entegrasyon gerekmez. Gün sonu ekranına "POS slip toplamı" alanı ekleyip `card_total` ile farkı gösterin. POS komisyonu gider kategorisi zaten var (`server/defaults.js` → `EXPENSE_CATEGORIES` içinde `'POS Komisyonu'`). |
| ÖKC-POS (yazar kasa + POS tek cihaz) | 4.1'deki köprü/iş modeline "kart tahsilatı" adımı eklenir: ajan tutarı cihaza gönderir, onay/ret ve provizyon kodu döner; satış ancak onaydan sonra kesinleşir (satış taslağı → onay → `POST /api/sales`). |
| Uzaktan kapora / sipariş ödemesi (online) | Sanal POS sağlayıcısının (ör. iyzico, PayTR vb.) **ödeme linki** servisi. `orders` için kapora linki üretilir; ödeme bildirimi webhook ile gelir ve mevcut `POST /api/orders/:id/deposit` mantığıyla kapora işlenir. |

**Online ödeme linki — önkoşullar.** Sağlayıcıyla üye işyeri sözleşmesi; API anahtarı/sırrı (veya merchant id/key/salt); test kartları; webhook doğrulama yöntemi (imza/HMAC); `PUBLIC_BASE_URL` (öneri) ve HTTPS.

**Kod iskeleti.**

```js
// server/routes/payments.js  (öneri) — webhook: çerez oturumu YOK, CSRF başlığı YOK → /api dışında bağlanmalı
import express, { Router } from 'express';
import crypto from 'node:crypto';
import { q, tx, insert } from '../db.js';
import { localNow } from '../util.js';
import { open } from '../integrations/secrets.js';

const r = Router();
// İmza, ham gövde üzerinden doğrulanır
r.post('/hooks/payment/:provider', express.raw({ type: '*/*', limit: '100kb' }), (req, res) => {
  const evt = JSON.parse(req.body.toString('utf8'));
  const link = q.get(`SELECT * FROM external_refs WHERE provider = ? AND external_id = ? AND ref_type = 'order'`, req.params.provider, String(evt.linkId || ''));
  if (!link) return res.status(404).end();
  const acc = q.get(`SELECT * FROM integration_accounts WHERE store_id = ? AND kind = 'payment' AND provider = ? AND enabled = 1`, link.store_id, req.params.provider);
  const { webhookSecret } = open(acc?.secret_enc);
  const expected = crypto.createHmac('sha256', webhookSecret || '').update(req.body).digest('hex');
  const given = String(req.get('X-Signature') || '');
  if (!webhookSecret || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return res.status(401).end();
  if (evt.status !== 'SUCCESS' || link.status === 'paid') return res.json({ ok: true }); // tekrar gelen bildirim: idempotent
  tx(() => {
    const o = q.get('SELECT * FROM orders WHERE id = ? AND store_id = ?', link.ref_id, link.store_id);
    const store = q.get('SELECT timezone FROM stores WHERE id = ?', link.store_id);
    const now = localNow(store.timezone);
    q.run('UPDATE orders SET deposit = deposit + ?, updated_at = ? WHERE id = ?', evt.amountKurus, now, o.id);
    // Yöntem 'card': kasayı (nakit) etkilemez, kart akışına girer — CASH_METHODS ile uyumlu
    insert('transactions', { store_id: o.store_id, kind: 'income', category: 'Sipariş Kaporası', amount: evt.amountKurus, method: 'card',
      date: now.slice(0, 10), description: `${o.no} — online ödeme`, pl: 0, ref_type: 'order', ref_id: o.id, customer_id: o.customer_id, created_at: now });
    q.run(`UPDATE external_refs SET status = 'paid' WHERE id = ?`, link.id);
  });
  res.json({ ok: true });
});
export default r;
```

`server/app.js`'te bu yönlendirici `app.use('/api', express.json(...))` satırından **önce** ve `/api` dışında bir yola (`app.use(payments)` → `/hooks/...`) bağlanmalıdır; aksi hâlde CSRF kontrolü (`X-DC-Istek`) ve JSON gövde ayrıştırıcı imza doğrulamasını bozar. Tutar, sağlayıcının sorgu servisinden de teyit edilmelidir (yalnızca webhook gövdesine güvenmeyin).

**Güvenlik.** Kart verisi (PAN, CVV) bu uygulamaya **hiç** girmemelidir; ödeme sağlayıcının barındırdığı sayfada alınır (PCI-DSS kapsamı dışında kalmak için). Webhook imzası doğrulanmadan hiçbir kayıt değişmez.

**Sorun giderme.** Webhook gelmiyor → `PUBLIC_BASE_URL` HTTPS ve dışarıdan erişilebilir mi, ters vekil `/hooks` yolunu iletiyor mu; imza hatası → gövde JSON ayrıştırıcıdan geçip bozulmuş olabilir (ham gövde şart).

---

### 4.4 SMS ve İYS

**Ne işe yarar.** Sipariş hazır bildirimi, veresiye hatırlatma, satış sonrası teşekkür (bugün `wa.me` ile elle yapılıyor, `public/js/pages/dashboard.js`, `pos.js`) ve kampanya mesajlarını otomatik gönderir.

**Mevzuat ayrımı (önemli).**
- **Bilgilendirme** mesajları (sipariş hazır, borç bakiyesi hatırlatma, fiş bilgisi) genellikle ticari ileti sayılmaz.
- **Ticari elektronik ileti** (kampanya, indirim, "doğum gününüze özel indirim") için alıcının onayı gerekir ve onay **İYS (İleti Yönetim Sistemi)** üzerinden kontrol edilmelidir. Bugünkü doğum günü mesajı şablonu (`dashboard.js`: "Size özel indiriminiz sizi mağazamızda bekliyor") ticari iletidir.
- Mesajın hangi sınıfta olduğunu mali müşavir/hukuk danışmanıyla netleştirin.

**Önkoşullar.** SMS sağlayıcı hesabı (ör. Netgsm, İleti Merkezi, Mutlucell…), onaylı **başlık (originator)**, API kullanıcı adı/şifresi veya anahtarı, İYS'ye kayıtlı marka kodu (ticari ileti için; birçok SMS sağlayıcısı İYS sorgusunu kendi API'sinde sunar), test için düşük bakiye veya test modu.

**Kurulum.**
1. `customers` tablosuna izin sütunları (bölüm 3.3: `sms_consent`, `consent_at`, `consent_source`) ve müşteri formuna (`public/js/pages/customers.js`) "Kampanya SMS'i almak istiyor" onay kutusu eklenir; onay metni ve tarihi saklanır.
2. `integration_accounts`: `kind='sms'`, `provider='netgsm'` (örnek), `settings`: `{ "header": "DCGIYIM", "iysBrandCode": "..." }`, `secrets`: `{ "username": "...", "password": "..." }`.
3. Şablonlar: mesajlar koddan değil, mağaza ayarından gelmeli (bugün `dashboard.js`'te sabit metin). Öneri: `integration_accounts.settings.templates` içinde `{ "order_ready": "Merhaba {ad}, {magaza} olarak siparişiniz ({no}) hazır." }`.

**Kod iskeleti.**

```js
// server/integrations/providers/sms/netgsm.js  (öneri — uç nokta ve alan adlarını sağlayıcının güncel dokümanından doğrulayın)
import { callJson, ProviderError } from '../../http.js';

export async function sendSms({ to, text, commercial }, account, secrets, mode) {
  if (mode !== 'live') return { id: `sandbox-${Date.now()}` };
  const phone = normalizeTr(to);
  if (!phone) throw new ProviderError('Telefon numarası geçersiz', { permanent: true });
  const res = await callJson('<saglayici-gonderim-adresi>', {
    headers: { Authorization: `Basic ${Buffer.from(`${secrets.username}:${secrets.password}`).toString('base64')}` },
    body: { msgheader: account.settings.header, messages: [{ msg: text, no: phone }], iysfilter: commercial ? '11' : '0' },
  });
  return { id: res?.jobid ?? null };
}

// server/routes/parties.js'teki normPhone ile uyumlu: 05xx… → 905xx…
const normalizeTr = (p) => { const s = String(p || '').replace(/\D/g, ''); return s.length === 11 && s.startsWith('0') ? `9${s}` : (s.length === 12 && s.startsWith('90') ? s : null); };
```

```js
// Kuyruğa yazma örneği — sipariş durumu 'arrived' olduğunda (server/routes/business.js, POST /orders/:id/status içinde, tx() bloğunda)
if (status === 'arrived' && o.phone) {
  enqueue(req.store.id, 'sms.send', { template: 'order_ready', order_id: o.id }, { dedupeKey: `sms:order_ready:${o.id}` });
}
```

İşçi, ticari şablonlarda (`commercial: true`) müşterinin `sms_consent = 1` olduğunu **gönderim anında** tekrar kontrol eder; izin yoksa işi `done` yapar ve atlandığını kaydeder.

**Hata yönetimi.** Yetersiz bakiye / başlık onaysız → `permanent` + sahibe uyarı; geçersiz numara → `permanent`; 5xx → yeniden dene. Gece saatlerinde (ör. 21:00–09:00) kampanya gönderimini `delayMs` ile ertelemek iyi uygulamadır.

**KVKK.** Telefon numarası kişisel veridir: kuyruğa `order_id`/`customer_id` yazın, numarayı gönderim anında okuyun; loglarda `0532***4567` biçiminde maskeleyin. Müşteri silindiğinde (`DELETE /api/customers/:id` → pasif) bekleyen SMS işleri iptal edilmelidir.

**Sorun giderme.** "Başlık tanımsız" → sağlayıcı panelinde başlık onayı; ticari mesaj gitmiyor → İYS'de onay yok (beklenen davranış); Türkçe karakterler bozuk → sağlayıcının Türkçe karakter/kodlama parametresi.

---

### 4.5 WhatsApp Business (Cloud API)

**Mevcut durum.** `public/js/core.js` → `waLink()` yalnızca `https://wa.me/<numara>?text=…` bağlantısı üretir; mesajı kasiyer kendi telefonundan elle gönderir. Maliyetsizdir ve onay gerektirmez; küçük mağazalar için yeterli olabilir.

**Ne zaman API gerekir?** Otomatik (insan dokunmadan) sipariş hazır / borç hatırlatma bildirimleri, mağaza adına tek numaradan gönderim ve gelen mesajların sisteme düşmesi istendiğinde.

**Önkoşullar.** Meta Business hesabı ve doğrulama, WhatsApp Business Platform'da bir telefon numarası (**Phone Number ID**), kalıcı **erişim belirteci** (System User token), onaylı **mesaj şablonları** (24 saatlik müşteri hizmeti penceresi dışında yalnızca şablon mesajı gönderilebilir), webhook için doğrulama belirteci ve uygulama sırrı.

**Kod iskeleti.**

```js
// server/integrations/providers/whatsapp/cloud-api.js  (öneri)
import { callJson, ProviderError } from '../../http.js';

export async function sendTemplate({ to, template, lang = 'tr', params = [] }, account, secrets, mode) {
  if (mode !== 'live') return { id: `sandbox-${Date.now()}` };
  if (!/^90\d{10}$/.test(to)) throw new ProviderError('WhatsApp numarası 90XXXXXXXXXX biçiminde olmalı', { permanent: true });
  const url = `https://graph.facebook.com/${account.settings.apiVersion}/${account.settings.phoneNumberId}/messages`;
  const res = await callJson(url, {
    headers: { Authorization: `Bearer ${secrets.accessToken}` },
    body: {
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: template, language: { code: lang }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] },
    },
  });
  return { id: res?.messages?.[0]?.id ?? null };
}
```

Webhook (teslim/okundu durumları ve gelen mesajlar) 4.3'teki gibi `/api` dışında, ham gövde ve `X-Hub-Signature-256` (uygulama sırrıyla HMAC-SHA256) doğrulamasıyla alınır. Arayüzdeki `waLink` düğmeleri API kapalıyken aynen kalabilir; API açıkken "Otomatik gönder" seçeneği eklenir.

**KVKK/İzin.** WhatsApp üzerinden ileti için de müşterinin açık izni alınmalı, kampanya içerikleri 4.4'teki ticari ileti kurallarına tabidir. Gelen mesajlar müşteri kaydıyla eşleştirilecekse saklama süresi belirlenmelidir.

**Sorun giderme.** `template not found` → şablon adı/dili ve onay durumu; `(#131047)` gibi pencere hataları → 24 saat dışı serbest metin gönderilmeye çalışılıyor; belirteç süresi dolmuş → System User kalıcı belirteci kullanın.

---

### 4.6 E-posta

**Kullanım alanları.** Gün sonu (kasa kapanışı) özetinin sahibe gönderilmesi (`POST /api/cash/close` → `server/routes/finance.js`), e-Arşiv faturasının müşteriye iletilmesi (genelde entegratör yapar), haftalık yedek (`GET /api/backup` çıktısı — **dikkat: tüm mağaza verisi ve kişisel veriler içerir**, şifresiz e-postayla gönderilmemeli).

**Önkoşullar.** Kurumsal SMTP (veya işlemsel e-posta servisi) bilgileri; gönderici alan adı için SPF/DKIM/DMARC kayıtları.

**Uygulama.** Node'un yerleşik SMTP istemcisi yoktur; `nodemailer` gibi bir bağımlılık eklenir ya da HTTP API'si olan bir işlemsel e-posta servisi `callJson` ile kullanılır. Platform çapında tek SMTP hesabı kullanılacaksa bilgiler ortam değişkenlerinde (öneri: `SMTP_URL`, `MAIL_FROM` — henüz yok), mağaza bazlıysa `integration_accounts` (`kind='email'`) içinde saklanır.

```js
// 'cash.closed' işleyicisi (öneri) — POST /cash/close içinde tx() bloğunda enqueue edilir
async function onCashClosed(job) {
  const c = q.get('SELECT * FROM day_closings WHERE id = ? AND store_id = ?', job.payload.closing_id, job.store_id);
  const owner = q.get(`SELECT email FROM users WHERE store_id = ? AND role = 'owner' AND active = 1 ORDER BY id LIMIT 1`, job.store_id);
  await mailer.send({
    to: owner.email,
    subject: `Gün sonu — beklenen ${tl(c.expected_cash)} ₺, sayılan ${tl(c.counted_cash)} ₺`,
    text: `Fark: ${tl(c.diff)} ₺\nKart: ${tl(c.card_total)} ₺\nHavale: ${tl(c.transfer_total)} ₺\nSatış: ${c.sales_count} fiş, ${tl(c.sales_total)} ₺`,
  });
}
```

---

### 4.7 Pazaryerleri (Trendyol, Hepsiburada)

README'deki yol haritasında "E-Ticaret bağlantısı — online satış senkronizasyonu" maddesi vardır; bu bölüm onun uygulama planıdır.

**Ne işe yarar.** (1) Mağaza stoğunun ve fiyatının pazaryerine otomatik yansıması (fazla satışı önler), (2) pazaryeri siparişlerinin sisteme çekilip stoktan düşülmesi, (3) iade ve iptallerin işlenmesi.

**Önkoşullar.**
- Trendyol: satıcı (supplier/seller) ID, API anahtarı ve sırrı (satıcı panelindeki entegrasyon bilgileri), `User-Agent` kuralı, test ortamı erişimi.
- Hepsiburada: merchant ID, API kullanıcı adı/şifresi, test ortamı.
- Ürün eşleşmesi: pazaryerindeki her ürünün **barkodu**, sistemdeki `variants.barcode` ile aynı olmalıdır. Sistem mağaza içi barkodlarını `2` ile başlayan EAN-13 olarak üretir (`server/stock.js` → `generateBarcode`); pazaryerinin bu barkodları kabul edip etmediğini ya da üretici/GS1 barkodu mu istediğini doğrulayın. Varyant bazında pazaryeri ürün kimliği `external_refs` (`ref_type='variant'`) içinde tutulur.
- Fiyat politikası: pazaryeri fiyatı mağaza fiyatından farklı olabilir (komisyon). Öneri: `integration_accounts.settings` içinde `{ "priceMarkupPct": 15, "round": "90" }` (mevcut toplu fiyat yuvarlama mantığına benzer, `server/routes/products.js` → `/products/bulk`).

**Kurulum.**
1. Ortak altyapı + `stock.changed`, `price.changed`, `variant.removed` olayları (bölüm 3.4 notu).
2. `integration_accounts`: `kind='marketplace'`, `provider='trendyol'` / `'hepsiburada'`.
3. İlk eşleştirme ekranı: pazaryerindeki ürün listesini çek, barkoda göre `variants` ile eşle, eşleşmeyenleri raporla.
4. İlk tam senkron (tüm eşleşmiş varyantların stok/fiyatı), sonra olay bazlı artımlı senkron.

**Stok gönderimi — kod iskeleti.**

```js
// server/integrations/providers/marketplace/trendyol.js  (öneri — uç nokta yollarını Trendyol'un güncel dokümanından alın)
import { q } from '../../../db.js';
import { callJson } from '../../http.js';

export async function pushStock(job, account, secrets, mode) {
  const { variant_id } = job.payload;
  // Gönderim anındaki GÜNCEL durum okunur (arada birikmiş değişiklikler tek istekte gider)
  const v = q.get(`SELECT v.barcode, v.stock, v.active, COALESCE(v.sale_price, p.discount_price, p.sale_price) AS price, p.sale_price AS list_price, p.active AS p_active
    FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.store_id = ?`, variant_id, job.store_id);
  if (!v) return; // silinmiş varyant: 'variant.removed' işleyicisi stoğu 0'a çeker
  const map = q.get(`SELECT external_id FROM external_refs WHERE store_id = ? AND ref_type = 'variant' AND ref_id = ? AND provider = 'trendyol'`, job.store_id, variant_id);
  if (!map) return; // pazaryerinde eşleşmesi olmayan ürün
  const sellable = v.active && v.p_active ? Math.max(0, v.stock - (account.settings.safetyStock ?? 0)) : 0; // negatif stok pazaryerine 0 gider
  const base = mode === 'live' ? '<canli-api-kok>' : '<test-api-kok>';
  await callJson(`${base}/<price-and-inventory-yolu>`, {
    headers: { Authorization: `Basic ${Buffer.from(`${secrets.apiKey}:${secrets.apiSecret}`).toString('base64')}`, 'User-Agent': `${account.settings.sellerId} - DCGiyimSatis` },
    body: { items: [{ barcode: v.barcode, quantity: sellable, salePrice: price(v.price, account.settings), listPrice: price(v.list_price, account.settings) }] },
  });
}
const price = (kurus, s) => Math.round(kurus * (1 + (s.priceMarkupPct || 0) / 100)) / 100;
```

Pazaryerleri toplu güncellemeyi genellikle **asenkron** işler ve bir "batch request id" döndürür; bu kimlik `external_refs`'e yazılıp ayrı bir `marketplace.batch.check` işiyle sonucu sorgulanmalıdır (bazı satırlar reddedilmiş olabilir).

**Sipariş çekme.**
- Zamanlanmış iş (ör. 5 dakikada bir) yeni siparişleri çeker; her sipariş pazaryeri sipariş numarasıyla `external_refs` (`ref_type='sale'`) üzerinden tekilleştirilir.
- Siparişi sisteme işlemek için satış mantığının yeniden kullanılabilir olması gerekir. Bugün tüm satış kuralları `server/routes/sales.js` içindeki `r.post('/sales', …)` işleyicisinin gövdesindedir. Önce bunu bir servis fonksiyonuna taşıyın (öneri: `server/services/sales.js` → `createSale({ store, user, body })`), rota ve pazaryeri işçisi aynı fonksiyonu çağırsın.
- Ödeme yöntemi: pazaryeri tahsilatı kasaya girmez. `server/util.js` → `PAY_METHODS` listesine `'marketplace'` eklenmeli (`CASH_METHODS`'a **eklenmemeli**, böylece gün sonu kasa hesabını etkilemez), `METHOD_LABELS` ve arayüzdeki `METHOD` (`public/js/core.js`) güncellenmelidir.
- Satış kullanıcısı: işçi bir insan oturumu değildir; mağazada "Entegrasyon" adlı pasif bir sistem kullanıcısı (`users.active = 0`, giriş yapamaz) oluşturup `user_id` olarak onu kullanın.

**Hata yönetimi.** Aynı varyant için sık değişimler `dedupeKey: stock:<id>` ile birleştirilir. 429'da geri çekilme. Pazaryerinin reddettiği satırlar (`batch.check`) arayüzde "Pazaryeri hataları" listesinde gösterilir. Stok farkı şüphesinde gece bir **tam mutabakat** işi çalıştırın.

**Test.** Pazaryerlerinin test ortamı; fake sağlayıcıyla birim testleri: satış → `stock.changed` kuyruğa girdi mi; aynı varyant için ikinci değişiklik yeni iş açmadı mı; negatif stok 0 olarak gitti mi.

**Güvenlik/KVKK.** Pazaryeri siparişleri alıcı adı, adresi ve telefonu içerir; yalnızca teslimat/fatura için gerekli alanları saklayın ve saklama süresi belirleyin.

**Sorun giderme.** Stok gitmiyor → varyantın `external_refs` eşlemesi var mı, `INTEGRATIONS_MODE` ve hesap `enabled`; "barcode not found" → barkod pazaryerindeki ürünle aynı mı; fiyat reddedildi → liste fiyatı satış fiyatından küçük olamaz kuralı.

---

### 4.8 Muhasebe yazılımları (Logo, Mikro, Luca, Paraşüt)

README yol haritasında "Muhasebe eksporu — Luca, Mali, vs" maddesi vardır.

**Ne işe yarar.** Mali müşavirin satışları, KDV dökümünü, tahsilatları, tedarikçi alışlarını ve giderleri tekrar yazmadan muhasebe programına alması.

**Yaklaşım (aşamalı).**
1. **Dosya ile aktarım (her programla çalışır, önerilen ilk adım).** Tarih aralığına göre CSV/Excel: günlük satış özeti (KDV oranı × ödeme yöntemi), iadeler, veresiye tahsilatları, alış faturaları (`purchases`, `purchase_items`), giderler (`transactions` içinde `pl = 1`), tedarikçi ödemeleri. Logo, Mikro ve Luca'nın içe aktarım şablonlarına sütun eşlemesi mali müşavirle yapılır.
2. **API ile aktarım (programa göre).** Paraşüt'ün herkese açık REST API'si (OAuth2) vardır: satış faturası, cari (müşteri/tedarikçi) ve tahsilat kayıtları oluşturulabilir. Logo ve Mikro için ürün sürümüne göre REST/servis katmanları veya XML içe aktarım kullanılır; bayinizden sürümünüze uygun entegrasyon yöntemini isteyin.

**Kod — dışa aktarım uç noktası (öneri).**

```js
// server/routes/reports.js'e eklenebilir (öneri) — yalnızca yönetici
r.get('/export/accounting.csv', mgr, (req, res) => {
  const { fromTs, toTs, from, to } = range(req, 30);
  const rows = q.all(`SELECT substr(si.created_at,1,10) AS gun, si.vat_rate AS kdv_orani,
      SUM(CASE WHEN si.qty > 0 THEN si.total ELSE 0 END) AS satis_kdv_dahil,
      SUM(CASE WHEN si.qty < 0 THEN -si.total ELSE 0 END) AS iade_kdv_dahil
    FROM sale_items si WHERE si.store_id = ? AND si.created_at BETWEEN ? AND ?
    GROUP BY gun, si.vat_rate ORDER BY gun, si.vat_rate`, req.store.id, fromTs, toTs);
  const tr = (k) => (k / 100).toFixed(2).replace('.', ',');           // public/js/core.js → csvMoney ile aynı biçim
  const vat = (k, r) => Math.round((k * r) / (100 + r));
  const lines = ['Tarih;KDV %;Satış (KDV dahil);Satış KDV;İade (KDV dahil);İade KDV;Net Matrah'];
  for (const x of rows) {
    const sv = vat(x.satis_kdv_dahil, x.kdv_orani); const iv = vat(x.iade_kdv_dahil, x.kdv_orani);
    lines.push([x.gun, x.kdv_orani, tr(x.satis_kdv_dahil), tr(sv), tr(x.iade_kdv_dahil), tr(iv),
      tr(x.satis_kdv_dahil - sv - (x.iade_kdv_dahil - iv))].join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="muhasebe-${from}-${to}.csv"`);
  res.send(`﻿${lines.join('\r\n')}`); // BOM: Türkçe Excel uyumu
});
```

Ödeme yöntemi kırılımı `payments` tablosundan (`method`, `amount`), veresiye hareketleri `customer_ledger`'dan, tedarikçi hareketleri `supplier_ledger`'dan aynı desenle üretilir. Satış dışı gelir/giderlerde `transactions.pl` alanı kâr/zarara giren (1) ve yalnızca para hareketi olan (0) kayıtları ayırır (`server/routes/finance.js` → `NON_PL`).

**Dikkat.** Satış satırlarının KDV'si, fişte gösterilen KDV ile aynı formülle hesaplanmalıdır; farklı yuvarlama muhasebe ile sistem arasında kuruş farkları doğurur. Fiş iptalinde (`DELETE /api/sales/:id`) kayıt fiziksel olarak silindiğinden, daha önce dışa aktarılmış bir dönem yeniden aktarıldığında rakam değişebilir — aktarılmış dönemleri "kilitleme" veya iptalleri ayrı bir tabloda tutma ihtiyacını mali müşavirle değerlendirin.

**KVKK.** Muhasebeye yalnızca gerekli alanlar gider; müşteri bazlı aktarımda TCKN yalnızca fatura kesilen müşteriler için gönderilir.

---

### 4.9 Barkod okuyucu ve etiket yazıcı

**Barkod okuyucu — mevcut durum çalışır.** Klavye gibi davranan (USB HID) okuyucular ek geliştirme gerektirmez: kasa ekranı okunan kodu `GET /api/variants/lookup?code=` ile arar (`server/routes/products.js`). Okuyucunun **Enter son eki** gönderecek şekilde ayarlanması yeterlidir. Kamera ile okuma (telefon/tablet) istenirse tarayıcıdaki `BarcodeDetector` API'si veya bir JS kütüphanesi eklenir; CSP nedeniyle kütüphane `public/` altına kopyalanmalıdır (`script-src 'self'`).

**Etiket yazıcı — mevcut durum.** `public/js/receipt.js` → `printLabels()` etiketleri HTML + SVG barkod olarak tarayıcı yazdırma penceresine gönderir. Termal etiket yazıcılarda (Zebra, TSC, Argox…) bu yöntem sürücü ayarına bağlıdır, hizalama kayabilir ve toplu basım yavaştır.

**Önerilen: ham ZPL/TSPL ile basım.**
- Sunucu, etiket içeriğini yazıcı diline çevirir; köprü ajanı (4.1'deki `devices` altyapısı, `kinds` içinde `label`) veya üreticinin tarayıcı yazdırma aracı ham veriyi yazıcıya iletir.
- Etiket boyutu, DPI ve yazıcı dili mağaza ayarıdır: `integration_accounts` (`kind='label'`), `settings`: `{ "lang": "zpl", "dpi": 203, "widthMm": 40, "heightMm": 30 }`.

```js
// server/integrations/providers/labels/zpl.js  (öneri) — 203 dpi, 40x30 mm etiket
const esc = (s) => String(s ?? '').replace(/[\^~\\]/g, ' ').slice(0, 40); // ZPL kontrol karakterlerini ayıkla

export function variantLabelZpl(v, storeName, copies = 1) {
  const price = `${(v.price / 100).toFixed(2).replace('.', ',')} TL`;
  return [
    '^XA', '^CI28',                                  // UTF-8 (Türkçe karakterler)
    '^PW320', '^LL240',                              // 40 mm x 30 mm @ 203 dpi
    `^FO10,10^A0N,24,24^FD${esc(v.name)}^FS`,
    `^FO10,40^A0N,20,20^FD${esc([v.code, v.size, v.color].filter(Boolean).join(' / '))}^FS`,
    `^FO10,70^BY2^BEN,60,Y,N^FD${v.barcode.slice(0, 12)}^FS`, // EAN-13: 12 hane, kontrol hanesini yazıcı hesaplar
    `^FO200,160^A0N,32,32^FD${esc(price)}^FS`,
    `^FO10,205^A0N,18,18^FD${esc(storeName)}^FS`,
    `^PQ${Math.max(1, Math.min(copies, 999))}`,
    '^XZ',
  ].join('\n');
}
```

Bu fonksiyonu kullanan uç nokta (öneri: `POST /api/labels/print`, gövde: `[{ variant_id, count }]`) varyantları `store_id` ile doğrular (`ownRow('variants', …)`, `server/util.js`), ZPL'i üretir ve `enqueue(storeId, 'label.print', { zpl }, { provider: 'okc-bridge' })` ile köprü ajanına iletir. Barkod verisi `generateBarcode()`'un ürettiği geçerli EAN-13 olduğu için `^BE` (EAN-13) doğrudan kullanılabilir; elle girilmiş, EAN-13 olmayan barkodlarda `^BC` (Code 128) seçilmelidir.

**Sorun giderme.** Türkçe karakterler bozuk → `^CI28` ve yazıcı font desteği; barkod okunmuyor → `^BY` modül genişliği/etiket boyutu; kayma → yazıcıda etiket kalibrasyonu (medya algılama).

---

### 4.10 Kargo (isteğe bağlı)

Mağaza, sipariş (`orders`) veya pazaryeri ürünlerini kargoyla gönderiyorsa: kargo firmasının (ör. Yurtiçi, Aras, MNG, Sürat vb.) API'siyle gönderi oluşturma, barkod/etiket alma ve takip numarasını siparişe yazma. Pazaryeri siparişlerinde kargo çoğunlukla pazaryerinin anlaşmalı firması ve etiketiyle yürüdüğünden ayrı entegrasyon gerekmeyebilir.

Uygulama deseni: `orders` tablosuna `cargo_provider`, `tracking_no` sütunları (henüz yok) → `enqueue('cargo.create', { order_id })` → işçi gönderiyi oluşturur → takip numarası ve kargo etiketi (ZPL/PDF) döner → etiket 4.9'daki köprüyle basılır → müşteriye 4.4/4.5 ile takip bilgisi gönderilir. Alıcı adres/telefonu kargo firmasına aktarıldığı için KVKK aydınlatma metninde belirtilmelidir.

---

### 4.11 Banka (isteğe bağlı)

- **Havale/EFT eşleştirme:** Bankaların kurumsal internet şubesi hesap hareketi dosyaları (CSV/Excel, bazı bankalarda MT940) veya banka API'leri üzerinden gelen havaleler, müşterinin veresiye borcuyla eşleştirilip `POST /api/customers/:id/collect` mantığıyla (`method: 'transfer'`) tahsilat olarak işlenebilir. İlk aşamada otomatik değil, "öneri + onay" ekranı yapın (açıklama alanındaki ad/telefon/fiş no eşleşmesi).
- **Tedarikçi ödemeleri:** `suppliers.iban` alanı mevcuttur; toplu ödeme talimatı dosyası (bankanın formatında) `supplier_ledger` bakiyelerinden üretilebilir. Ödemenin kendisi bankada onaylanır; sistem yalnızca dosya üretir.
- IBAN ve hesap hareketleri hassas finansal veridir; dosyalar sunucuda kalıcı saklanmamalı, işlendikten sonra silinmelidir.

---

## 5. Yeni sağlayıcı ekleme rehberi

1. **Türü belirleyin** (`earsiv`, `sms`, `marketplace` …). Tür yoksa `server/routes/integrations.js` → `KINDS` listesine ekleyin.
2. **Adaptör dosyası** oluşturun: `server/integrations/providers/<tur>/<saglayici>.js`. Aynı türdeki diğer adaptörlerle **aynı fonksiyon imzasını** uygulayın (ör. SMS için `sendSms(msg, account, secrets, mode)`), böylece işçi sağlayıcıdan bağımsız kalır.
3. **Mod ayrımı:** `mode === 'live'` değilse test adresini kullanın ya da hiçbir şey göndermeyin.
4. **İdempotensi:** Sağlayıcıya giden benzersiz kimliği ilk denemede üretip `external_refs`'e yazın; yeniden denemede aynısını kullanın. Sağlayıcı destekliyorsa "idempotency key" başlığı gönderin.
5. **Hata sınıflandırma:** `ProviderError` ile `permanent` bayrağını doğru verin (veri/kimlik hatası kalıcı, ağ/5xx/429 geçici).
6. **Sırlar:** yalnızca `secrets` nesnesinden okuyun; asla loglamayın, hata mesajına koymayın.
7. **Kayıt:** `server/integrations/handlers.js` içindeki olay → işleyici eşlemesine sağlayıcıyı ekleyin (ör. `providers.sms[account.provider]`).
8. **Fake sağlayıcı ve test:** `tests/integrations.test.js`'e en az "başarılı gönderim", "geçici hata sonrası yeniden deneme", "kalıcı hata → dead" testlerini ekleyin. `npm test` geçmeden birleştirmeyin.
9. **Arayüz:** Ayarlar > Entegrasyonlar sekmesine sağlayıcının ayar alanlarını ekleyin (sır alanları `type="password"`, kayıttan sonra boş).
10. **Belgeleyin:** bu dosyaya sağlayıcıya özel önkoşulları ve sorun giderme notlarını ekleyin.

---

## 6. Canlıya geçiş kontrol listesi

**Altyapı**
- [ ] Node.js **22.13 veya üzeri** (`package.json` → `engines`; `node:sqlite` bunu gerektirir).
- [ ] Uygulama HTTPS arkasında (ters vekil); `server/app.js`'teki `trust proxy` ayarı vekilin adresine göre düzenlendi (bugün `'loopback'`).
- [ ] `INTEGRATION_SECRET_KEY` üretildi, **yedeklendi** (kaybolursa kayıtlı sırlar çözülemez), depoda değil.
- [ ] `INTEGRATIONS_MODE=live` yalnızca canlı sunucuda; demo verisi (`npm run seed`) canlı veritabanında **yok**.
- [ ] Veritabanı dosyası (`DB_FILE`, varsayılan `data/dcgiyim.db`) ve WAL dosyaları düzenli yedekleniyor; yedek dosyası sunucu dışına kopyalanıyor.
- [ ] Tek Node süreci (veya işçi yalnızca bir süreçte açık).

**Mevzuat**
- [ ] ÖKC/e-Arşiv senaryosu (hangi satışta hangi belge) mali müşavirle yazılı olarak netleşti.
- [ ] Ödeme tipi ve KDV departman eşlemeleri ÖKC üzerinde test edildi.
- [ ] İade/değişim/iptal akışlarının belge karşılıkları belirlendi; mali belgesi olan satışta fiş silme engellendi.
- [ ] Ticari ileti gönderimi için İYS kaydı ve müşteri izin toplama akışı hazır.
- [ ] KVKK: aydınlatma metni entegratör, SMS, WhatsApp, pazaryeri ve kargo aktarımlarını kapsıyor; veri işleyen sözleşmeleri imzalandı.

**Uygulama**
- [ ] Mağaza vergi bilgileri (`tax_office`, `tax_no`), adres ve KDV oranları eksiksiz.
- [ ] Her entegrasyon önce `sandbox` modunda uçtan uca test edildi (satış, çok KDV'li sepet, sepet indirimi, kısmi iade, değişim, veresiye, kapora).
- [ ] "Entegrasyon hataları" (dead işler) ekranı sahibe görünüyor; yeniden gönder çalışıyor.
- [ ] Loglarda sır, TCKN, tam telefon numarası geçmediği kontrol edildi.
- [ ] `GET /api/backup` çıktısında `integration_accounts`/`devices` yok.
- [ ] Pazaryeri için ilk tam stok mutabakatı yapıldı; güvenlik stoğu ayarlandı.
- [ ] Geri dönüş planı: bir sağlayıcı sorun çıkarırsa `enabled = 0` ile kapatılıp kasanın çalışmaya devam ettiği doğrulandı.

---

## 7. Genel sorun giderme

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Hiçbir iş gönderilmiyor | `INTEGRATIONS_MODE=off` veya işçi başlatılmadı | Ortam değişkeni; `server/index.js`'te `startWorker()` çağrısı |
| İşler `processing`'de takılı | Süreç iş sırasında yeniden başladı | `locked_until` dolunca iş yeniden alınır; süre çok uzunsa kısaltın |
| Aynı belge iki kez oluştu | Yeniden denemede yeni kimlik üretildi | `external_refs` kimliği ilk denemede üretilip saklanmalı; önce sorgula-sonra gönder |
| `dead` işler birikiyor | Kalıcı veri/kimlik hatası | "Entegrasyon hataları" ekranındaki mesaja göre kaydı düzeltip yeniden gönderin |
| `INTEGRATION_SECRET_KEY 32 bayt olmalıdır` | Anahtar yanlış biçimde | `openssl rand -base64 32` çıktısını olduğu gibi kullanın |
| `Unsupported state or unable to authenticate data` | Anahtar değişti, eski sırlar çözülemiyor | Eski anahtarı geri koyun ya da sırları yeniden girin |
| Köprü "Geçersiz istek kaynağı" alıyor | `X-DC-Istek: 1` başlığı eksik | Ajanın her POST isteğine başlığı ekleyin (`server/app.js:33`) |
| Webhook 403/401 | Yönlendirici `/api` altında (CSRF) veya imza ham gövdeden hesaplanmıyor | Bölüm 4.3'teki bağlama sırasına uyun |
| Kuruş farkları | Farklı KDV yuvarlaması | `server/integrations/money.js` → `vatOf` her yerde aynı formül |
