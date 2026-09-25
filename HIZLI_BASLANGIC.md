# 🚀 HIZLI BAŞLANGIÇ KILAVUZU

*5 dakikada DC Giyim Satış'ı kurabilir ve ilk satışınızı yapabilirsiniz.*

---

## ADIM 1: Kurulum (2 dakika)

### Gereksinimler
- Bilgisayar (Windows, Mac, Linux)
- Node.js 18+ ([node.js.org](https://nodejs.org))
- Internet tarayıcısı

### Kurulum Adımları

```bash
# 1. Repository'yi indir
git clone https://github.com/emrullahkara/DC-Giyim-satis.git
cd DC-Giyim-satis

# 2. Bağımlılıkları yükle
npm install

# 3. Demo veri yükle (isteğe bağlı ama öneriliyor)
npm run seed

# 4. Sunucuyu başlat
npm start
```

**✓ Bitti!** Tarayıcıyı aç: http://localhost:3000

---

## ADIM 2: Giriş Yap (30 saniye)

### Demo Hesabı ile Giriş

```
E-posta: demo@dcgiyim.com
Şifre:   demo123
```

**Eğer demo data yüklediyseniz, yukarıdaki bilgiler çalışır.**

Canlı mağaza açmak için: [Yeni Mağaza Hesabı](http://localhost:3000/#/kayit)

---

## ADIM 3: İlk Satış (2 dakika)

### 1. Kasa Ekranını Aç
```
Menüden: Kasa (Satış)  
VEYA: F2 tuşuna bas
```

### 2. Ürün Seç
```
Barcode tarayıcı kullan VEYA
Ürün ara (Tab tuşu, yazı gir)
```

### 3. Miktar Gir
```
↑ ↓ tuşları ile miktarı artır/azalt
ENTER ile onayla
```

### 4. Ödeme Al
```
F4 = Nakit (para üstü otomatik)
F8 = Kredi Kartı
Tab = Transfer
V = Veresiye
```

### 5. Fiş Yazdır
```
"Yazdır" butonuna tıkla VEYA
Otomatik yazdır seçeneği aç (Ayarlar)
```

**✓ İlk satışın bitti!** 🎉

---

## TEMEL ÖZELLİKLER

### Kasa (F2)
- Barkod ile hızlı satış
- Parçalı ödeme (nakit + kart)
- Veresiye müşteri kredisi
- İade/değişim
- Fiş yazdırma

### Müşteriler
- Müşteri listesi
- Borç/alacak takibi
- Tahsilat
- Satın alma geçmişi

### Ürünler
- Yeni ürün ekleme
- Fiyat güncelleme
- Beden-renk varyantları
- Barcode yönetimi

### Stok
- Stok durumu (beden × renk matrisi)
- Mal alımı (alış faturası)
- Stok hareketleri

### Raporlar
- Satış analizi (kategori, marka, beden)
- Stok raporu (ölü stok, kritik stok)
- Kâr analizi (marj, kategori kârlılığı)

### Ayarlar
- Mağaza bilgileri
- Kategoriler
- Bedenler

---

## KIŞAYOLLAR (Hızlı İş)

| Kısayol | Fonksiyon |
|---------|-----------|
| **F2** | Kasa ekranını aç |
| **F4** | Kasada: Nakit ödeme |
| **F8** | Kasada: Kart ödeme |
| **/** | Global arama |
| **Esc** | Pencereyi kapat |
| **Tab** | Ürün ara / Değer gir |
| **Enter** | Onayla |
| **↑ ↓** | Miktarı artır/azalt |

---

## SIKI SORULAR & CEVAPLAR

### S: Eğer internet keserse?
**C:** Local kullanıyorsanız (localhost:3000) internet gerekli değil. Buluta yüklediyseniz, geçici veritabanı cache'i kullanılır (V2'de offline mode gelecek).

### S: Veritabanı nerede?
**C:** Sunucu yanında `store.db` dosyası. Yedek için bu dosyayı kopyala.

### S: Kaç mağazayı yönetebilir?
**C:** Aynı sunucuda sınırsız mağaza. Her mağaza ayrı hesap + kendi verisı.

### S: Fiş yazdırması çalışmıyor?
**C:** Chrome: Ayarlar → Sayfayı yazdır → Yazıcıyı seç. Bazı yazıcılarda sürücü güncelle gerekebilir.

### S: Mobilde çalışır mı?
**C:** Evet! Tablet/telefon tarayıcıda responsive design çalışır. Barcode tarayıcı Bluetooth ise tablet'te kullanılabilir.

### S: Sunucuya yükleyebilir miyim?
**C:** Evet! AWS, Azure, DigitalOcean vb. Linux sunuculara kurabilir, https ile sertifika ekleyebilir.

### S: Başka birinin yazılımından import edilebilir mi?
**C:** Manuel import yapılabilir. Taban API'ye POST çağrısı yaparak veri girilebilir. Yazılı rehber için [API Referansı](README.md#-api-referansı) bölümüne bak.

### S: Yazılım malı mı? Virüs mü?
**C:** Açık kaynak. GitHub'da tüm kod görülebilir. MIT Lisansı altında tamamen ücretsiz.

---

## SORUN GİDERME

### Sorun: "npm: command not found"
**Çözüm:** Node.js kurulmamış. [nodejs.org](https://nodejs.org) adresinden indir ve kur.

### Sorun: "Port 3000 already in use"
**Çözüm:** Başka bir uygulamada o port kullanılıyor. Ya kapatıp yeniden başlat ya da:
```bash
PORT=3001 npm start
# Sonra http://localhost:3001 aç
```

### Sorun: "Database is locked"
**Çözüm:** İki sunucu örneği aynı anda çalıştırma. Kapıp yeniden başla:
```bash
Ctrl+C
npm start
```

### Sorun: Fiş yazdırması boş çıkıyor
**Çözüm:** Yazıcı ayarlarını kontrol et. Chrome → Ayarlar → Yazıcı → Paper size kontrol et.

### Sorun: Sayfa yavaş yükleniyor
**Çözüm:** 
- Tarayıcı cache'ini temizle (Ctrl+Shift+Delete)
- Başka sekmeler aç (bellek boş tutmak için)
- Veritabanı büyürse (1 yıl sonra) optimize et

---

## DAHA FAZLA YARDIM

- **README**: Tam dokümantasyon → `README.md`
- **Sunum**: İş & teknik detayları → `SUNRUM.md`
- **API**: API endpoint'leri → `README.md#-api-referansı`
- **GitHub Issues**: Sorun bildir → [Issues](https://github.com/emrullahkara/DC-Giyim-satis/issues)

---

## TEST VERILERI (Demo Kurulumda)

Demo kurulumda hemen test edebileceğin veriler:
- ✓ 42 ürün (19 kategori)
- ✓ 85 müşteri (bazı veresiye)
- ✓ 1.115 satış (1000+ line items)
- ✓ 14 sipariş
- ✓ Aylık giderler

Hepsi gerçekçi ve 4 ay boyunca dağıtılmış. Raporlarda anlamlı sonuçlar göreceksin.

---

**Hepsi bu kadar! 5 dakikada hazırız.** ✨

Herhangi sorun veya soru? [GitHub Issues](https://github.com/emrullahkara/DC-Giyim-satis/issues) adresine mesaj bırak.

👉 **Şimdi Başla**: `npm start`

---

*DC Giyim Satış - Giyim Perakendecileri İçin Yazılım* 👕
