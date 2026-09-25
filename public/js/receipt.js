// Satış fişi (80mm termal yazıcı uyumlu) ve ürün etiketi yazdırma
import { h, tl, fdt, METHOD, printHTML, api } from './core.js';
import { barcodeSVG } from './components.js';

export function receiptNode(s) {
  const st = s.store || {};
  const pos = s.items.filter((i) => i.qty > 0);
  const neg = s.items.filter((i) => i.qty < 0);
  const line = (a, b, bold) => h('div', { class: 'ln', style: bold ? { fontWeight: 700 } : null }, h('span', null, a), h('span', null, b));
  const discount = s.line_discount + s.cart_discount;
  return h('div', { class: 'receipt' },
    h('h3', null, st.name || ''),
    st.address ? h('div', { class: 'c' }, [st.address, st.city].filter(Boolean).join(' / ')) : null,
    st.phone ? h('div', { class: 'c' }, `Tel: ${st.phone}`) : null,
    st.tax_no ? h('div', { class: 'c' }, `${st.tax_office || ''} V.D. ${st.tax_no}`) : null,
    h('hr'),
    line(`Fiş: ${s.no}`, fdt(s.created_at)),
    s.customer ? h('div', null, `Müşteri: ${s.customer.name}`) : null,
    s.staff_name ? h('div', null, `Satış Danışmanı: ${s.staff_name}`) : null,
    h('hr'),
    pos.map((i) => [
      h('div', null, `${i.name}${i.size || i.color ? ` (${[i.size, i.color].filter(Boolean).join('/')})` : ''}`),
      line(`  ${i.qty} x ${tl(i.unit_price)}`, tl(i.qty * i.unit_price)),
      i.discount ? line('  İndirim', `-${tl(i.discount)}`) : null,
    ]),
    neg.length ? [h('div', { style: { marginTop: '4px', fontWeight: 700 } }, 'İADE EDİLENLER'), neg.map((i) => [
      h('div', null, `${i.name}${i.size ? ` (${i.size})` : ''}${i.return_of_no ? ` — ${i.return_of_no}` : ''}`),
      line(`  ${-i.qty} adet`, tl(i.total)),
    ])] : null,
    h('hr'),
    discount ? line('Ara Toplam', tl(s.subtotal)) : null,
    s.cart_discount ? line('Sepet İndirimi', `-${tl(s.cart_discount)}`) : null,
    discount ? line('Toplam İndirim', `-${tl(discount)}`) : null,
    line(s.total < 0 ? 'İADE TOPLAMI' : 'TOPLAM', tl(s.total), true),
    (s.vat || []).map((v) => line(`  KDV %${v.rate} dahil`, tl(v.vat))),
    h('hr'),
    s.payments.map((p) => line(METHOD[p.method] || p.method, tl(p.amount))),
    s.customer && s.customer.balance ? line('Güncel Bakiye', tl(s.customer.balance)) : null,
    h('hr'),
    st.receipt_footer ? h('div', { class: 'c' }, st.receipt_footer) : null,
    h('div', { class: 'c', style: { marginTop: '6px' } }, barcodeSVG(s.no, { height: 30 })),
    h('div', { class: 'c', style: { fontSize: '10px', marginTop: '4px' } }, 'Bu belge bilgi fişidir, mali değeri yoktur.'));
}

export async function printReceipt(saleOrId) {
  const s = typeof saleOrId === 'object' ? saleOrId : await api.get(`/sales/${saleOrId}`);
  printHTML(receiptNode(s));
}

/** Etiket yazdır. items: [{name, code, size, color, barcode, price, list_price, count}] */
export function printLabels(items, storeName) {
  const labels = [];
  for (const it of items) {
    for (let i = 0; i < (it.count || 1); i++) {
      labels.push(h('div', { class: 'label' },
        h('div', { class: 'ln1' }, it.name),
        h('div', { class: 'ln2' }, h('span', null, [it.code, it.size, it.color].filter(Boolean).join(' · ')), h('span', null, storeName || '')),
        h('div', { class: 'ln2', style: { alignItems: 'baseline' } },
          it.list_price && it.list_price > it.price ? h('span', { style: { textDecoration: 'line-through' } }, tl(it.list_price)) : h('span'),
          h('span', { class: 'pr' }, tl(it.price))),
        barcodeSVG(it.barcode, { height: 34 })));
    }
  }
  printHTML(h('div', { class: 'labels' }, labels));
}
