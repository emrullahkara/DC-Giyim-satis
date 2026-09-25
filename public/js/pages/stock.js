// Stok yönetimi ve mal kabul (alış)
import { h, api, tl, fdt, state, toast, modal, formModal, run } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, badge } from '../components.js';

export default async function Stock(root, { params, query }) {
  const tab = query.tab || 'status';
  return renderStockPage(root, tab);
}

async function renderStockPage(root, tab) {
  const { mount } = await import('../core.js');

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Stok & Mal Kabul'),
      h('div', { class: 'btn-group' },
        h('a', { class: `btn sm ${tab === 'status' ? 'active' : ''}`, href: '#/stok?tab=status' }, 'Stok Durumu'),
        h('a', { class: `btn sm ${tab === 'moves' ? 'active' : ''}`, href: '#/stok?tab=moves' }, 'Stok Hareketleri'),
        h('a', { class: `btn sm ${tab === 'purchase' ? 'active' : ''}`, href: '#/stok?tab=purchase' }, 'Mal Alımı'))));

  if (tab === 'status') {
    await showStockStatus(view);
  } else if (tab === 'moves') {
    await showStockMoves(view);
  } else if (tab === 'purchase') {
    await showPurchase(view);
  }

  mount(root, view);
}

async function showStockStatus(view) {
  let variants = [];
  try {
    const r = await api.get('/variants');
    variants = r.rows || [];
  } catch (e) { toast(e.message, 'bad'); }

  if (variants.length === 0) {
    view.appendChild(empty('Varyant bulunamadı'));
    return;
  }

  const cols = [
    { key: 'barcode', label: 'Barkod', render: (v) => h('code', null, v.barcode) },
    { key: 'name', label: 'Ürün', render: (v) => v.name },
    { key: 'size', label: 'Beden', render: (v) => v.size || '-' },
    { key: 'color', label: 'Renk', render: (v) => v.color || '-' },
    { key: 'stock', label: 'Stok', align: 'right', render: (v) => badge(v.stock, v.stock > 10 ? 'ok' : v.stock > 0 ? 'warn' : 'bad') },
    { key: 'price', label: 'Satış', align: 'right', render: (v) => tl(v.price) },
  ];

  const sorted = variants.sort((a, b) => a.stock - b.stock);
  view.appendChild(table({ cols, rows: sorted }));
}

async function showStockMoves(view) {
  let moves = [];
  try {
    const r = await api.get('/stock-moves', { limit: 100 });
    moves = r.rows || [];
  } catch (e) { toast(e.message, 'bad'); }

  if (moves.length === 0) {
    view.appendChild(empty('Stok hareketi bulunamadı'));
    return;
  }

  const cols = [
    { key: 'created_at', label: 'Tarih', render: (m) => fdt(m.created_at) },
    { key: 'variant_name', label: 'Ürün', render: (m) => m.variant_name },
    { key: 'type', label: 'Tip', render: (m) => badge(m.type, { in: 'ok', out: 'bad', adj: 'info' }) },
    { key: 'qty', label: 'Miktar', align: 'right', render: (m) => h('span', { class: m.qty > 0 ? 'ok' : 'bad' }, m.qty > 0 ? `+${m.qty}` : m.qty) },
    { key: 'balance_after', label: 'Bakiye', align: 'right', render: (m) => badge(m.balance_after) },
    { key: 'reason', label: 'Neden', render: (m) => m.reason || '-' },
  ];

  view.appendChild(table({ cols, rows: moves }));
}

async function showPurchase(view) {
  let suppliers = [];
  try {
    const r = await api.get('/suppliers');
    suppliers = r || [];
  } catch (e) { toast(e.message, 'bad'); }

  const btn = h('button', { class: 'btn primary', style: { marginBottom: '16px' }, onclick: newPurchase }, icon('plus'), 'Mal Alımı (Alış Faturası)');
  view.appendChild(btn);

  async function newPurchase() {
    const lines = [];
    const form = formModal({
      title: 'Mal Alımı',
      fields: [
        { name: 'supplier_id', label: 'Tedarikçi', type: 'select', required: true },
        { name: 'invoice_no', label: 'Fatura No', required: true },
        { name: 'invoice_date', label: 'Fatura Tarihi', type: 'date', required: true },
      ],
      onSubmit: async (v) => {
        if (lines.length === 0) { toast('En az 1 ürün ekleyin', 'warn'); return; }
        try {
          const r = await api.post('/purchases', {
            supplier_id: v.supplier_id,
            invoice_no: v.invoice_no,
            invoice_date: v.invoice_date,
            items: lines,
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Mal alımı kaydedildi', 'ok');
          location.hash = '#/stok?tab=purchase';
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }
}
