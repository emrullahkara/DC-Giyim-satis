# DC Giyim Satış - Mağaza Yönetim Sistemi

> **Giyim perakende işletmeleri için tam işlevli, modern, açık kaynak mağaza yönetim sistemi.**  
> Kasa, stok, veresiye, personel, raporlar - her şey tek ekranda, ücretsiz.

![DC Giyim Satış](public/img/logo.svg)

---

## 📋 İçindekiler

- [Genel Bakış](#-genel-bakış)
- [Temel Özellikler](#-temel-özellikler)
- [Teknik Mimari](#-teknik-mimari)
- [Kurulum](#-kurulum)
- [Kullanım](#-kullanım)
- [API Referansı](#-api-referansı)
- [Demo Veri](#-demo-veri)
- [Yapı](#-yapı)
- [Katkı Kılavuzu](#-katkı-kılavuzu)
- [Entegrasyon Rehberi](docs/ENTEGRASYON.md)

---

## 🎯 Genel Bakış

DC Giyim Satış, özellikle **butik, abiye, gelinlik, erkek giyim, çocuk giyim** gibi giyim işletmeleri için tasarlanmış modern bir yönetim sistemidir. 40 yıllık mağaza yönetim deneyiminin yazılım mimarlarıyla birleşmesinden ortaya çıkmıştır.

Sistem, giyim perakendeciliğinin tüm iş süreçlerini kapsar:

### 📱 Kasa & Satış
- **Barkodlu hızlı satış** - Ürünleri barcode tarayıcı veya keyboard ile seçin
- **Parçalı ödeme** - Nakit + kart, kart + transfer kombinasyonları
- **Veresiye (kredi)** - Müşteri bazlı kredi limitleri ve tahsilat takibi
- **Iade & değişim** - Kısmi iade, tam iade, beden/renk değişimi
- **Serbest ürünler** - Tadilat, kişiselleştirme gibi stoksuz hizmetler

### 📦 Stok Yönetimi
- **Beden × Renk matrisi** - Ürün varyantları için iki boyutlu stok izleme
- **Stok hareketleri** - Alış, satış, iade, ayarlama tüm hareketlerin tam denetimi
- **Ölü stok analizi** - 90+ gündür satılmayan ürünleri belirleyin
- **Mal alımı (alış faturası)** - Tedarikçilerden alım, ağırlıklı ortalama maliyet

### 👥 Müşteri Yönetimi
- **Müşteri veritabanı** - Telefon, e-posta, adres kayıtları
- **Veresiye defteri** - Müşteri borç/alacakları gerçek zamanlı
- **Tahsilat takibi** - Ödeme yöntemi ve tarihleri ile kaydedilir
- **Satın alma geçmişi** - Müşteri bazlı satış analizi

### 📋 Sipariş & Kapora
- **Sipariş yönetimi** - Müşteri siparişlerini 6 durumda izleyin
- **Kapora hesabı** - Sipariş kaparması satış sırasında otomatik düşülür
- **Vade takibi** - Overdue siparişler gösterge panelinde uyarılır

### 👔 Personel Yönetimi
- **Personel CRUD** - Ad, pozisyon, maaş kayıtları
- **Maaş ödemeleri** - Aylık maaş ve avans ödemeleri
- **Satış primi** - Personel başına satış performansı ve komisyon

### 💰 Muhasebe & Finans
- **Gelir-gider kategorileri** - Kira, maaş, reklam, elektrik, vb.
- **Günlük muhasebe** - Satışlar ve genel gidirler otomatik kaydedilir
- **Gün sonu kasa kapanışı** - ID-tabanlı kesinlik (zaman damgasından bağımsız)
- **P&L vs nakit hareketi ayrımı** - Veresiye tahsilatı P&L'ye girmez, nakit akışına girer

### 📊 Raporlar & Analiz
- **Satış analizi** - Kategori, marka, beden, saatlik kırılımlar
- **Stok raporu** - Değeri, hareket oranı, kritik ve negatif stok
- **Kâr analizi** - Aylık P&L, kategori kârlılığı, marj yüzdesi
- **Gösterge paneli** - Real-time KPI'lar, 30 günlük trend, uyarılar

---

## ✨ Temel Özellikler

| Özellik | Detay |
|---------|-------|
| **Açık Kaynak** | Tamamen ücretsiz, MIT Lisansı altında |
| **Hızlı** | Frontend vanilla JS, gzipped 3.5KB |
| **Güvenli** | CSRF koruması, role-based access control, mağaza izolasyonu |
| **Kasa Dostu** | F2 kısayolu, barcode input, keyboard navigation |
| **Muhasebe Kesin** | Kuruş cinsinden tamsayı, P&L vs nakit hareketi ayrımı |
| **Raporlar Detaylı** | Satış, stok, kâr - çok boyutlu analiz |
| **Multi-mağaza** | Bir sunucuda birden fazla işletme çalıştırabilir |
| **Tema Seçimi** | Açık/koyu tema localStorage ile kalıcı |
| **Fiş Yazdırma** | 80mm termal yazıcı uyumlu (80col format) |
| **Etiket Yazdırma** | Ürün etiketleri barcodlu (4x6" thermal) |

---

## 🏗️ Teknik Mimari

### Frontend
- **Vanilla JavaScript** - Hiç build tool yok, tarayıcıda direkt çalışır
- **Hash-based routing** - `#/page/params` istemci-tarafı yönlendirme
- **DOM builder** - `h()` fonksiyonu HTML oluşturur
- **CSS Tema Sistemi** - `:root` değişkenleri, light/dark mode
- **Responsive Tasarım** - Mobil, tablet, masaüstü uyumlu

### Backend
- **Node.js + Express.js** - Hafif, hızlı web sunucusu
- **SQLite (node:sqlite)** - Gömülü veritabanı, dosya tabanlı
- **WAL Mode** - Concurrent okuma-yazma desteği
- **Nested Savepoints** - İç içe transaction desteği

### Güvenlik
- **CSRF Koruması** - `X-DC-Istek` header tüm state-changing isteklerde
- **Password Hashing** - Scrypt algoritması, salt ile
- **Session Tokens** - SHA256 hash, 30 günlük expiry
- **Role-based Access** - Owner > Manager > Cashier hiyerarşisi
- **Mağaza Izolasyonu** - Tüm sorgular `store_id` ile filtrelenir

### Veri Tamamlığı
- **Kuruş cinsinden para** - `price = 12500` → 125.00 ₺
- **Stok hareketleri** - Her değişiklik audit trail'de
- **İade kesinliği** - Kısmi iade: `refunded = (original_qty * returned_qty) / original_qty`
- **Kasa kapanışı** - ID-tabanlı: `last_sale_id`, `last_payment_id`, `last_tx_id`

---

## 🚀 Kurulum

### Gereksinimler
- Node.js 18+ 
- npm veya yarn
- Modern web tarayıcısı

### Adımlar

```bash
# 1. Repository'yi klonlayın
git clone https://github.com/emrullahkara/DC-Giyim-satis.git
cd DC-Giyim-satis

# 2. Bağımlılıkları yükleyin
npm install

# 3. Demo veri yükleyin (isteğe bağlı)
npm run seed

# 4. Sunucuyu başlatın
npm start

# 5. Tarayıcıda açın
# http://localhost:3000
```

### Demo Giriş Bilgileri
```
E-posta: demo@dcgiyim.com
Şifre:   demo123
```

Demo, 4 aylık gerçekçi veri ile önceden yüklüdür:
- 42 ürün (19 kategori)
- 456 varyant (beden-renk kombinasyonları)
- 85 müşteri
- 1.115 satış (iadeler dahil)
- 14 sipariş (kapora ve teslim akışları)

---

## 💻 Kullanım

### Kasa Ekranı (F2)
1. Barcode tarayıcı ile ürün seçin veya `Tab` ile ara yapın
2. Miktarı ayarlayın (↑↓ tuşları)
3. İndirim uygulayın (sepet % veya ürün bazlı)
4. Müşteri seçin (isteğe bağlı - veresiye için gerekli)
5. Ödeme yöntemi seçin:
   - **F4** = Nakit (para üstü otomatik hesaplanır)
   - **F8** = Kredi kartı
   - **Transfer** = Banka havalesi
   - **Veresiye** = Müşteri hesabına ekle
6. Fişi yazdırın

### Ürün Yönetimi
1. **Ürünler** → Yeni Ürün
2. Kod, ad, kategori, alış/satış fiyatı girin
3. **Varyantlar** sekmesinde beden × renk kombinasyonları oluşturun
4. Her varyant için açılış stoğu girin

### Müşteri Yönetimi
1. **Müşteriler** → Yeni Müşteri
2. Ad, telefon, e-posta ekleyin
3. Satışlar sırasında otomatik olarak borç/alacak izlenir
4. **Tahsilat Yap** ile ödeme kaydı yapın

### Stok Yönetimi
1. **Stok** → Mal Alımı sekmesi
2. Tedarikçi, fatura no, fatura tarihi girin
3. Ürünleri ve miktarları ekleyin
4. Kaydedilince stok ve tedarikçi borcu otomatik güncellenir

### Raporlar
1. **Raporlar** → istediğiniz sekmesini seçin
2. Tarih aralığını filtreleyin
3. Kategori, marka, beden bazlı analiz
4. Kâr analizi (yönetici için)

---

## 📡 API Referansı

Tüm API endpoint'leri JSON POST/PUT isteklerini kabul eder ve CSRF başlığı (`X-DC-Istek: true`) gerektirir.

### Kimlik Doğrulama

```bash
# Kayıt
POST /auth/register
{ "storeName", "name", "email", "password" }

# Giriş
POST /auth/login
{ "email", "password" }

# Çıkış
POST /auth/logout

# Geçerli kullanıcı
GET /auth/me
```

### Satışlar

```bash
# Satış listesi (aralık, müşteri, sayfa)
GET /sales?from=2024-01-01&to=2024-01-31&limit=50

# Satış detayı
GET /sales/:saleId

# Yeni satış oluştur
POST /sales
{
  "items": [{ "variant_id", "qty", "unit_price", "discount" }],
  "customer_id", "staff_id",
  "payments": [{ "method", "amount" }]
}

# Fiş iptali (tüm etkileri geri alır)
POST /sales/:saleId/void

# İade (kısmi veya tam)
POST /sales/:saleId/return
{ "items": [{ "variant_id", "qty", "reason" }] }
```

### Ürünler

```bash
# Ürün listesi
GET /products?q=search&cat_id=categoryId&limit=100

# Ürün detayı
GET /products/:productId

# Varyantlar (beden-renk matrisi)
GET /products/:productId/variants

# Ürün oluştur
POST /products
{ "code", "name", "cat_id", "brand", "buy_price", "price", "vat_rate" }

# Ürün güncelle
PUT /products/:productId
{ "name", "price", ... }
```

### Müşteriler

```bash
# Müşteri listesi
GET /customers?q=search&limit=50

# Müşteri detayı
GET /customers/:customerId

# Müşteri satışları
GET /customers/:customerId/sales

# Müşteri oluştur
POST /customers
{ "name", "phone", "email", "credit_limit" }

# Tahsilat kaydı
POST /customers/:customerId/collect
{ "amount", "method" }
```

### Siparişler

```bash
# Sipariş listesi
GET /orders?status=new|ordered|arrived|delivered|cancelled

# Sipariş oluştur
POST /orders
{ "customer_id", "deposit", "due_date", "notes" }

# Sipariş durumu güncelle
PUT /orders/:orderId
{ "status" }
```

### Raporlar

```bash
# Satış raporu
GET /reports/sales?from=2024-01-01&to=2024-01-31

# Stok raporu
GET /reports/stock

# Kâr raporu (yönetici)
GET /reports/profit?from=2024-01-01&to=2024-01-31
```

---

## 📊 Demo Veri

`npm run seed` komutu 4 aylık gerçekçi demo veri yükler:

### Ürünler
- **19 kategori**: Elbise, Abiye, Gelinlik, Takım, Ceket, Gömlek, Bluz, Tişört, Pantolon, Kot, Etek, Kazak, Mont, Tunik, Eşofman, İç Giyim, Aksesuar, Çanta, Ayakkabı
- **42 ürün**: Kategori başına 2 ürün
- **456 varyant**: Beden-renk kombinasyonları (pahalı itemler az, temel ürünler çok stok)

### Satışlar
- **1.115 satış**: 4 ay periyodu
- **Weekday distributionu**: Pazartesi-Çarşamba düşük, Cuma-Pazar yüksek
- **İndirimler**: Satışların ~12%'si indirimli
- **Ödeme yöntemleri**: %55 nakit, %42 kart, %3 transfer
- **İadeler**: ~4% iade oranı, çeşitli sebepler (beden, beğenmedi, vs)

### Müşteriler
- **85 müşteri**: Gradual olarak 4 ay boyunca eklenir
- **Veresiye**: Müşterilerin ~30%'u kredi kullanır
- **Tahsilatlar**: Ödenen ve ödenmemiş borçlar

### Siparişler
- **14 sipariş**: Çeşitli durumlar (yeni, sipariş verildi, geldi, teslim)
- **Kapora**: Sipariş başına belirlenen kapora miktarı
- **Teslimatta**: Kapara satışa dönüşür

### Giderler
Aylık sabit giderler:
- Kira: 45.000 ₺
- Muhasebe: 3.500 ₺
- Reklam: 4.000-9.000 ₺
- SGK/Vergi: 26.000-31.000 ₺
- Elektrik: 2.800-4.200 ₺
- İnternet: 890 ₺
- Diğer: 1.000-2.000 ₺

### Kullanıcılar
```
Owner (Sahip):
  E-posta: owner@dcgiyim.com
  Şifre: owner123
  Erişim: Tüm raporlar, ayarlar, maliyet fiyatları görür

Manager (Müdür):
  E-posta: manager@dcgiyim.com
  Şifre: manager123
  Erişim: Raporlar, ayarlar, maliyet fiyatları, maaş yönetimi

Cashier (Kasiyer):
  E-posta: cashier@dcgiyim.com
  Şifre: cashier123
  Erişim: Sadece kasa, müşteri, ürün (maliyet göremez)

Demo:
  E-posta: demo@dcgiyim.com
  Şifre: demo123
  Erişim: Manager yetkisi ile demo verisi önceden yüklü
```

---

## 📁 Yapı

```
DC-Giyim-satis/
├── server/
│   ├── index.js                 # Uygulama giriş noktası
│   ├── app.js                   # Express setup, middleware
│   ├── db.js                    # SQLite şeması ve sorgu wrapper'ları
│   ├── auth.js                  # Kimlik doğrulama, session yönetimi
│   ├── util.js                  # Validation helper'ları, utilities
│   ├── seed.js                  # Demo veri seeding scripti
│   └── routes/
│       ├── auth.js              # Login, register, logout, password change
│       ├── products.js          # Ürün CRUD, varyantlar, barcodes
│       ├── sales.js             # Satış CRUD, iade, değişim, void
│       ├── parties.js           # Müşteri ve tedarikçi yönetimi
│       ├── business.js          # Siparişler, personel, maaş
│       ├── finance.js           # Gelir-gider, gün sonu kapanış
│       └── reports.js           # Satış, stok, kâr raporları
├── public/
│   ├── index.html               # SPA HTML shell
│   ├── css/
│   │   └── app.css              # Tema sistemi, responsive design
│   ├── img/
│   │   └── logo.svg             # DC Giyim logosu
│   ├── js/
│   │   ├── app.js               # Routing, shell, navigation
│   │   ├── core.js              # h() DOM builder, API client
│   │   ├── components.js        # UI bileşenleri
│   │   ├── icons.js             # 38 inline SVG icon
│   │   ├── receipt.js           # Fiş ve etiket yazdırma
│   │   ├── theme.js             # Tema toggle
│   │   └── pages/
│   │       ├── dashboard.js     # Gösterge paneli
│   │       ├── pos.js           # Kasa ekranı
│   │       ├── sales.js         # Satış listesi
│   │       ├── products.js      # Ürün yönetimi
│   │       ├── stock.js         # Stok yönetimi
│   │       ├── orders.js        # Sipariş yönetimi
│   │       ├── customers.js     # Müşteri yönetimi
│   │       ├── suppliers.js     # Tedarikçi yönetimi
│   │       ├── staff.js         # Personel yönetimi
│   │       ├── finance.js       # Gelir-gider & kasa kapanışı
│   │       ├── reports.js       # Raporlar
│   │       └── settings.js      # Ayarlar
│   └── manifest.webmanifest     # PWA manifest
├── tests/
│   └── api.test.js              # 18 comprehensive API testleri
├── package.json
├── README.md                    # Bu dosya
└── .gitignore
```

### Veritabanı Şeması

**25+ Tablo:**

**İşletme & Kullanıcı:**
- `stores` - Mağaza bilgileri
- `users` - Kullanıcı hesapları ve roller

**Ürün & Stok:**
- `categories` - Ürün kategorileri
- `products` - Ürünler (ad, kod, fiyat, KDV)
- `variants` - Ürün varyantları (beden × renk)
- `stock_moves` - Stok hareketi audit trail

**Satış & Ödeme:**
- `sales` - Satış fişleri
- `sale_items` - Satış detay satırları
- `payments` - Ödeme kayıtları (nakit, kart, transfer, etc)
- `customers` - Müşteri veritabanı
- `customer_debts` - Müşteri borç/alacak

**Sipariş & Kapora:**
- `orders` - Müşteri siparişleri
- `order_items` - Sipariş detay satırları

**Tedarikçi & Alım:**
- `suppliers` - Tedarikçi bilgileri
- `purchases` - Alış faturası (mal alımı)
- `purchase_items` - Alış detay satırları
- `supplier_debts` - Tedarikçi borç/alacak

**Personel & Maaş:**
- `staff` - Personel kayıtları
- `staff_payments` - Maaş ve avans ödemeleri
- `commissions` - Satış primleri

**Muhasebe:**
- `expense_categories` - Gider kategorileri
- `transactions` - Gelir-gider (P&L)
- `day_closings` - Gün sonu kasa kapanışı özeti

---

## 🧪 Test Kapsamı

18 comprehensive test, tüm temel workflow'ları kapsıyor:

```bash
npm test
```

Testler:
1. ✅ Kayıt ve oturum (registration, login, session)
2. ✅ CSRF başlığı olmadan değişiklik reddedilir
3. ✅ Şifre validation, e-posta unique
4. ✅ Ürün + varyantlar + stok
5. ✅ Veresiye + parçalı ödeme + sepet indirimi
6. ✅ Ödeme validation, müşteri gerekli kontrol
7. ✅ Kısmi iade ve fazla iade engeli
8. ✅ Değişim: iade + yeni ürün + fark tahsili
9. ✅ Tahsilat ve P&L etkisi
10. ✅ Mal alımı + stok + ağırlıklı ortalama maliyet
11. ✅ Sipariş + kapora + teslimatta satışa dönüşme
12. ✅ Kasa özeti ve gün sonu
13. ✅ Raporlar ve gösterge paneli
14. ✅ Kasiyer yetkileri (maliyet göremez)
15. ✅ Mağaza izolasyonu
16. ✅ Fiş iptali (stok ve veresiye geri alır)
17. ✅ Toplu indirim ve stok sayımı
18. ✅ Serbest satır (stoksuz hizmetler)

**Tüm testler geçer:** 18/18 ✓

---

## 🔐 Güvenlik Notları

### CSRF Koruması
Tüm POST/PUT istekleri `X-DC-Istek: true` başlığı gerektirir. Test dışında bu otomatik uygulanır.

### Rol Yetkileri
- **Owner**: Tüm raporlar, ayarlar, maliyet fiyatları
- **Manager**: Raporlar, maaş, maliyet (kasiyerden daha fazla)
- **Cashier**: Sadece kasa, müşteri, ürün (maliyet göremez)

### Mağaza İzolasyonu
Her sorgu `store_id` ile filtrelenir. Kullanıcı başka mağaza verisine erişemez.

### Şifre Güvenliği
- Scrypt hashing (CPU-expensive)
- Random salt
- Minimum 6 karakter

---

## 📈 Performans

- **Frontend gzipped**: 3.5 KB (core.js)
- **Sayfa yükleme**: <100ms (local)
- **Kasa ekranı**: 60 FPS (smooth)
- **SQL sorgular**: Index ile optimize edilmiş
- **Concurrent**: WAL mode ile 10+ eş zamanlı kullanıcı

---

## 🔌 Entegrasyonlar

Şu an uygulamada dış sistem entegrasyonu bulunmuyor (fiş "bilgi fişi" olarak basılır, WhatsApp yalnızca `wa.me` bağlantısıdır). Yazar kasa (ÖKC), e-Arşiv/e-Fatura, kart ödemesi, SMS/İYS, WhatsApp, e-posta, pazaryerleri (Trendyol/Hepsiburada), muhasebe yazılımları (Logo/Mikro/Luca/Paraşüt), barkod/etiket yazıcı, kargo ve banka entegrasyonlarının bu depoya nasıl ekleneceği için: **[docs/ENTEGRASYON.md](docs/ENTEGRASYON.md)**

---

## 🛣️ Roadmap

Planned enhancements:

- [ ] **Multi-depo** - Merkez ve şube mağazaları
- [ ] **Barkod tarayıcı** - Native app integration
- [ ] **E-Ticaret bağlantısı** - Online satış senkronizasyonu
- [ ] **Muhasebe eksporu** - Muhasebe yazılımına (Luca, Mali, vs)
- [ ] **API Gateway** - 3. parti entegrasyonlar
- [ ] **Mobil app** - React Native iOS/Android
- [ ] **Bulut senkronizasyonu** - Çevrimdışı desteği

---

## 📞 Destek & Katkı

### Hata Raporları
[GitHub Issues](https://github.com/emrullahkara/DC-Giyim-satis/issues) kullanarak bildirin.

### Katkı Yapmak
1. Repository'yi fork edin
2. Feature branch oluşturun (`git checkout -b feature/AmazingFeature`)
3. Değişiklikleri commit edin (`git commit -m 'Add AmazingFeature'`)
4. Branch'e push edin (`git push origin feature/AmazingFeature`)
5. Pull Request açın

### Geliştirme
```bash
# Test etme
npm test

# Seed ile çalıştırma
npm run seed && npm start

# Tarayıcıda http://localhost:3000 açın
```

---

## 📄 Lisans

MIT License - Lütfen LICENSE dosyasına bakın.

---

## 👥 Yazarlar

- **İşletme Danışmanlığı**: 40 yıl giyim perakende deneyimi
- **Yazılım Mimarı**: Full-stack cloud-native development

---

## 💡 Neden DC Giyim Satış?

Mevcut POS/ERP sistemleri ya çok pahalı ya da giyim işletmelerine özel değil. DC Giyim Satış:

✓ **Ücretsiz** - Açık kaynak, kâr amacı yok  
✓ **Basit** - Hiç teknik bilgi gereken yok  
✓ **Hızlı** - Saniyeler içinde satış yapın  
✓ **Kesin** - Veresiye, stok, kâr hepsi doğru  
✓ **Esneklik** - Kodunu istediğiniz gibi değiştirin  

---

## 🎓 Öğrenme Kaynakları

### İçin Kasa Operatörü
- F2 tuşu = Kasa ekranı
- Barcode ile ürün seç
- Tahta ile ödeme al
- Fiş yazdır
- Bitti!

### İçin Mağaza Müdürü
- Ürün yönetimi: kategoriler, fiyatlar
- Stok takibi: açılış, iade, düşüş
- Müşteri yönetimi: veresiye, tahsilat
- Personel: maaş, prim
- Raporlar: satış, kâr, stok

### İçin Geliştirici
- SQLite + Node.js backend
- Vanilla JS frontend (no build)
- API-first design
- Hash-based routing
- CSS tema sistemi

---

**Hoşgeldiniz! DC Giyim Satış ile işletmenizi dijitalleştirin.** 🚀

