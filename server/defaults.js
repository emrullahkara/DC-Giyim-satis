import { insert } from './db.js';

export const DEFAULT_CATEGORIES = [
  'Elbise', 'Abiye', 'Gelinlik', 'Takım Elbise', 'Ceket & Blazer', 'Gömlek', 'Bluz', 'Tişört',
  'Pantolon', 'Kot', 'Etek', 'Kazak & Hırka', 'Mont & Kaban', 'Tunik', 'Eşofman & Spor',
  'İç Giyim', 'Aksesuar', 'Ayakkabı', 'Çanta',
];

export const DEFAULT_SIZE_SETS = [
  ['Harf Beden', 'XS,S,M,L,XL,XXL,3XL'],
  ['Kadın Beden (34-50)', '34,36,38,40,42,44,46,48,50'],
  ['Erkek Takım (44-60)', '44,46,48,50,52,54,56,58,60'],
  ['Pantolon Bel', '28,29,30,31,32,33,34,36,38,40'],
  ['Ayakkabı', '35,36,37,38,39,40,41,42,43,44,45'],
  ['Çocuk Yaş', '2-3,3-4,4-5,5-6,6-7,7-8,9-10,11-12,13-14'],
  ['Standart', 'STD'],
];

export const EXPENSE_CATEGORIES = [
  'Kira', 'Elektrik', 'Su', 'Doğalgaz', 'İnternet & Telefon', 'Maaş', 'Avans', 'Prim', 'SGK & Vergi',
  'Muhasebe', 'Kargo', 'Reklam', 'Temizlik', 'Bakım & Onarım', 'Tadilat/Terzi', 'Ambalaj & Poşet',
  'POS Komisyonu', 'Yemek', 'Ulaşım', 'Diğer',
];

export const INCOME_CATEGORIES = ['Diğer Gelir', 'Kasa Açılış', 'Tadilat Ücreti', 'Faiz/İade'];

export function seedStoreDefaults(storeId, now) {
  DEFAULT_CATEGORIES.forEach((name, i) => insert('categories', { store_id: storeId, name, sort: i }));
  DEFAULT_SIZE_SETS.forEach(([name, sizes]) => insert('size_sets', { store_id: storeId, name, sizes }));
  insert('tasks', { store_id: storeId, title: 'Mağaza bilgilerini ve fiş alt yazısını Ayarlar\'dan düzenleyin', created_at: now });
  insert('tasks', { store_id: storeId, title: 'İlk ürünlerinizi ekleyin (beden/renk tablosu ile)', created_at: now });
  insert('tasks', { store_id: storeId, title: 'Personelinizi ekleyip kullanıcı hesabı açın', created_at: now });
}
