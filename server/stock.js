// Stok hareketleri ve barkod üretimi — tüm stok değişiklikleri buradan geçer ve kayıt altına alınır.
import { q, insert } from './db.js';

export function moveStock({ storeId, variantId, qty, type, refType = null, refId = null, note = null, userId = null, now }) {
  if (!qty) return;
  q.run('UPDATE variants SET stock = stock + ? WHERE id = ? AND store_id = ?', qty, variantId, storeId);
  const balance = q.val('SELECT stock FROM variants WHERE id = ?', variantId);
  insert('stock_movements', {
    store_id: storeId, variant_id: variantId, qty, balance_after: balance, type,
    ref_type: refType, ref_id: refId, note, user_id: userId, created_at: now,
  });
}

function ean13Check(d12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d12[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** Mağaza içi EAN-13 barkod üretir (2 ile başlayan kodlar mağaza içi kullanım için ayrılmıştır). */
export function generateBarcode(storeId) {
  for (let tries = 0; tries < 50; tries++) {
    const body = '2' + String(storeId % 100).padStart(2, '0') + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const code = body + ean13Check(body);
    if (!q.get('SELECT 1 FROM variants WHERE store_id = ? AND barcode = ?', storeId, code)) return code;
  }
  throw new Error('Barkod üretilemedi');
}

export const MOVE_LABELS = {
  sale: 'Satış', return: 'İade', purchase: 'Mal Alımı', adjust: 'Stok Düzeltme', count: 'Sayım', initial: 'Açılış Stoğu',
};
