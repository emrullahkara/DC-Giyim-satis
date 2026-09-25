// Satışlar & İadeler listesi, detayları, fiş iptali
import { h, api, tl, fdt, rel, state, toast, modal, confirmBox, picker, isManager } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, dateRange, badge, statusBadge, barChart } from '../components.js';
import { receiptNode, printReceipt } from '../receipt.js';

export default async function Sales(root, { params, query }) {
  const saleId = params[0];
  if (saleId) return showSale(root, saleId);
  return listSales(root, query);
}

async function listSales(root, query) {
  const q = query.q || '';
  const { from, to } = dateRange(query, { defDays: 30 });
  const page = Math.max(0, Number(query.page) || 0);
  let sales = [];
  let total = 0;
  try {
    const r = await api.get('/sales', { from, to, q, limit: 50, offset: page * 50 });
    sales = r.rows || [];
    total = r.total || 0;
  } catch (e) { toast(e.message, 'bad'); }

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Satışlar & İadeler'),
      h('div', { class: 'toolbar-actions' },
        h('input', {
          type: 'search', placeholder: 'Müşteri, tel, fiş no ara…', value: q,
          onchange: (e) => { const v = e.target.value; location.hash = v ? `#/satislar?q=${encodeURIComponent(v)}` : '#/satislar'; }
        }),
        h('div', { class: 'btn-group' },
          h('a', { class: 'btn sm', href: '#/satislar' }, 'Tümü'),
          h('a', { class: 'btn sm', href: `#/satislar?from=${from}&to=${to}`, style: { whiteSpace: 'nowrap' } }, `${from} → ${to}`)))))
  );

  if (sales.length === 0) {
    view.appendChild(empty('Satış bulunamadı'));
    mount(root, view);
    return;
  }

  const cols = [
    { key: 'no', label: 'Fiş No', sort: true, render: (r) => h('a', { href: `#/satislar/${r.id}`, style: { fontWeight: 600 } }, r.no) },
    { key: 'created_at', label: 'Tarih & Saat', sort: true, render: (r) => fdt(r.created_at) },
    { key: 'customer_name', label: 'Müşteri', render: (r) => r.customer_name || 'Perakende' },
    { key: 'total', label: 'Tutar', sort: true, align: 'right', render: (r) => h('span', { class: r.total < 0 ? 'bad' : 'ok' }, tl(r.total)) },
    { key: 'status', label: 'Durum', render: (r) => statusBadge(r.status, { ok: 'Satış', void: 'İptal' }) },
  ];

  if (isManager()) {
    cols.push({ key: 'cost', label: 'Maliyet', align: 'right', render: (r) => tl(r.cost) });
    cols.push({ key: 'profit', label: 'Kâr', align: 'right', render: (r) => h('span', { class: r.profit >= 0 ? 'ok' : 'bad' }, tl(r.profit)) });
  }

  view.appendChild(table({ cols, rows: sales, onRow: (r) => ({ onclick: () => location.hash = `#/satislar/${r.id}` }) }));

  if (total > sales.length) {
    view.appendChild(h('div', { class: 'center', style: { padding: '16px' } },
      h('button', { class: 'btn', onclick: () => location.hash = `#/satislar?page=${page + 1}&from=${from}&to=${to}&q=${q}` }, 'Daha fazla yükle'),
      h('div', { class: 'tiny muted', style: { marginTop: '8px' } }, `${sales.length} / ${total}`)));
  }

  const { mount } = await import('../core.js');
  mount(root, view);
}

async function showSale(root, saleId) {
  let sale = null;
  try {
    sale = await api.get(`/sales/${saleId}`);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'alert bad' }, icon('alert'), `Satış yüklenemedi: ${e.message}`));
    return;
  }

  const canVoid = sale.status === 'ok' && state.user.role !== 'kasiyyer';
  const { mount } = await import('../core.js');

  const view = h('div', { class: 'sale-detail stack' },
    h('div', { class: 'row align-center' },
      h('a', { href: '#/satislar', class: 'btn ghost icon', 'aria-label': 'Geri' }, icon('back')),
      h('h2', null, `Fiş #${sale.no}`),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => printReceipt(sale) }, icon('receipt'), 'Yazdır')),
    receiptNode(sale),
    canVoid ? h('button', { class: 'btn danger', style: { marginTop: '16px' }, onclick: voidSale }, icon('x'), 'Fişi İptal Et') : null);

  async function voidSale() {
    const ok = await confirmBox('Fişi iptal etmek istiyor musunuz? Tüm etkileri geri alınacak.');
    if (!ok) return;
    try {
      await api.post(`/sales/${saleId}/void`, {}, { headers: { 'X-DC-Istek': 'true' } });
      toast('Fiş iptal edildi', 'ok');
      location.hash = '#/satislar';
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  mount(root, view);
}
