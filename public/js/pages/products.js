// Ürünler listesi ve detayları
import { h, api, tl, state, toast, modal, formModal, isManager, run } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, badge } from '../components.js';

export default async function Products(root, { params, query }) {
  const productId = params[0];
  if (productId) return showProduct(root, productId);
  return listProducts(root, query);
}

async function listProducts(root, query) {
  const q = query.q || '';
  const cid = query.cat || '';
  let products = [];
  let cats = [];
  let total = 0;
  try {
    const [pdata, cdata] = await Promise.all([
      api.get('/products', { q, cat_id: cid || undefined, limit: 100 }),
      api.get('/categories'),
    ]);
    products = pdata.rows || [];
    total = pdata.total || 0;
    cats = cdata || [];
  } catch (e) { toast(e.message, 'bad'); }

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Ürünler'),
      h('div', { class: 'toolbar-actions' },
        h('input', {
          type: 'search', placeholder: 'Ürün adı, kod, marka ara…', value: q,
          onchange: (e) => { const v = e.target.value; location.hash = v ? `#/urunler?q=${encodeURIComponent(v)}` : '#/urunler'; }
        }),
        h('select', {
          value: cid,
          onchange: (e) => location.hash = e.target.value ? `#/urunler?cat=${e.target.value}` : '#/urunler'
        }, h('option', { value: '' }, 'Tüm kategoriler'), cats.map((c) => h('option', { value: c.id }, c.name))),
        h('button', { class: 'btn primary', onclick: addProduct }, icon('plus'), 'Yeni Ürün'),
      )));

  if (products.length === 0) {
    view.appendChild(empty('Ürün bulunamadı'));
    const { mount } = await import('../core.js');
    mount(root, view);
    return;
  }

  const cols = [
    { key: 'code', label: 'Kod', render: (r) => h('a', { href: `#/urunler/${r.id}`, style: { fontWeight: 600 } }, r.code) },
    { key: 'name', label: 'Adı', render: (r) => r.name },
    { key: 'category_name', label: 'Kategori', render: (r) => r.category_name },
    { key: 'brand', label: 'Marka', render: (r) => r.brand || '-' },
    { key: 'variants_count', label: 'Varyantlar', align: 'right', render: (r) => badge(r.variants_count, 'info') },
  ];

  if (isManager()) {
    cols.push({ key: 'buy_price', label: 'Alış', align: 'right', render: (r) => tl(r.buy_price) });
    cols.push({ key: 'price', label: 'Satış', align: 'right', render: (r) => tl(r.price) });
  }

  view.appendChild(table({ cols, rows: products, onRow: (r) => ({ onclick: () => location.hash = `#/urunler/${r.id}` }) }));

  const { mount } = await import('../core.js');
  mount(root, view);
}

async function showProduct(root, productId) {
  let product = null;
  let variants = [];
  try {
    [product, variants] = await Promise.all([
      api.get(`/products/${productId}`),
      api.get(`/products/${productId}/variants`)
    ]);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'alert bad' }, icon('alert'), `Ürün yüklenemedi: ${e.message}`));
    return;
  }

  const { mount } = await import('../core.js');

  const view = h('div', { class: 'product-detail stack' },
    h('div', { class: 'row align-center' },
      h('a', { href: '#/urunler', class: 'btn ghost icon', 'aria-label': 'Geri' }, icon('back')),
      h('h2', null, product.name),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: editProduct }, icon('edit'), 'Düzenle')));

  const info = card(
    h('div', { class: 'row wrap' },
      h('div', null, h('div', { class: 'tiny faint' }, 'Kod'), h('b', null, product.code)),
      h('div', null, h('div', { class: 'tiny faint' }, 'Kategori'), h('b', null, product.category_name)),
      h('div', null, h('div', { class: 'tiny faint' }, 'Marka'), h('b', null, product.brand || '-')),
      isManager() ? h('div', null, h('div', { class: 'tiny faint' }, 'Alış'), h('b', null, tl(product.buy_price))) : null,
      h('div', null, h('div', { class: 'tiny faint' }, 'Satış'), h('b', null, tl(product.price))),
      h('div', null, h('div', { class: 'tiny faint' }, 'KDV'), h('b', null, product.vat_rate + '%')),
    ));
  view.appendChild(info);

  if (variants.length > 0) {
    view.appendChild(h('h3', null, 'Varyantlar'));
    const cols = [
      { key: 'code', label: 'Barkod', render: (v) => h('code', null, v.barcode) },
      { key: 'size', label: 'Beden', render: (v) => v.size || '-' },
      { key: 'color', label: 'Renk', render: (v) => v.color || '-' },
      { key: 'stock', label: 'Stok', align: 'right', render: (v) => badge(v.stock, v.stock > 0 ? 'ok' : v.stock < 0 ? 'bad' : 'muted') },
    ];
    view.appendChild(table({ cols, rows: variants }));
  }

  function editProduct() {
    formModal({
      title: `${product.name} Düzenle`,
      fields: [
        { name: 'code', label: 'Kod', value: product.code, required: true },
        { name: 'name', label: 'Adı', value: product.name, required: true },
        { name: 'brand', label: 'Marka', value: product.brand || '' },
        { name: 'buy_price', label: 'Alış (₺)', type: 'number', value: product.buy_price / 100, step: 0.01, required: isManager() },
        { name: 'price', label: 'Satış (₺)', type: 'number', value: product.price / 100, step: 0.01, required: true },
        { name: 'vat_rate', label: 'KDV (%)', type: 'number', value: product.vat_rate, min: 0, max: 100 },
      ],
      onSubmit: async (v) => {
        try {
          await api.put(`/products/${productId}`, {
            code: v.code, name: v.name, brand: v.brand,
            buy_price: Math.round(v.buy_price * 100),
            price: Math.round(v.price * 100),
            vat_rate: Number(v.vat_rate),
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Ürün güncellendi', 'ok');
          location.hash = `#/urunler/${productId}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  function addProduct() {
    formModal({
      title: 'Yeni Ürün',
      fields: [
        { name: 'code', label: 'Kod', required: true, span: 'span-all' },
        { name: 'name', label: 'Adı', required: true, span: 'span-all' },
        { name: 'cat_id', label: 'Kategori', type: 'select', value: '' },
        { name: 'brand', label: 'Marka', span: 'span-all' },
        { name: 'buy_price', label: 'Alış (₺)', type: 'number', step: 0.01 },
        { name: 'price', label: 'Satış (₺)', type: 'number', step: 0.01, required: true },
        { name: 'vat_rate', label: 'KDV (%)', type: 'number', value: 8, min: 0, max: 100 },
      ],
      onSubmit: async (v) => {
        try {
          const r = await api.post('/products', {
            code: v.code, name: v.name, cat_id: v.cat_id,
            brand: v.brand,
            buy_price: Math.round(v.buy_price * 100),
            price: Math.round(v.price * 100),
            vat_rate: Number(v.vat_rate),
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Ürün oluşturuldu', 'ok');
          location.hash = `#/urunler/${r.id}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  mount(root, view);
}
