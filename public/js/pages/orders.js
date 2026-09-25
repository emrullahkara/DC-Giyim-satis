// Sipariş yönetimi
import { h, api, tl, fdt, state, toast, modal, formModal, confirmBox, run } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, badge, statusBadge } from '../components.js';

const ORDER_STATUS = { new: 'Yeni', ordered: 'Sipariş Verildi', arrived: 'Geldi', delivered: 'Teslim Edildi', cancelled: 'İptal' };

export default async function Orders(root, { params, query }) {
  const orderId = params[0];
  if (orderId) return showOrder(root, orderId);
  return listOrders(root, query);
}

async function listOrders(root, query) {
  const status = query.status || 'all';
  let orders = [];
  try {
    const r = await api.get('/orders', { status: status === 'all' ? undefined : status });
    orders = r || [];
  } catch (e) { toast(e.message, 'bad'); }

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Siparişler'),
      h('div', { class: 'toolbar-actions' },
        h('div', { class: 'btn-group' },
          h('a', { class: `btn sm ${status === 'all' ? 'active' : ''}`, href: '#/siparisler' }, 'Tümü'),
          h('a', { class: `btn sm ${status === 'new' ? 'active' : ''}`, href: '#/siparisler?status=new' }, 'Yeni'),
          h('a', { class: `btn sm ${status === 'arrived' ? 'active' : ''}`, href: '#/siparisler?status=arrived' }, 'Geldi')),
        h('button', { class: 'btn primary', onclick: newOrder }, icon('plus'), 'Yeni Sipariş'))));

  if (orders.length === 0) {
    view.appendChild(empty('Sipariş bulunamadı'));
    const { mount } = await import('../core.js');
    mount(root, view);
    return;
  }

  const cols = [
    { key: 'id', label: 'Sipariş No', render: (o) => h('a', { href: `#/siparisler/${o.id}`, style: { fontWeight: 600 } }, `#${o.id}`) },
    { key: 'customer_name', label: 'Müşteri', render: (o) => o.customer_name },
    { key: 'deposit', label: 'Kapora', align: 'right', render: (o) => tl(o.deposit) },
    { key: 'status', label: 'Durum', render: (o) => statusBadge(o.status, ORDER_STATUS) },
    { key: 'due_date', label: 'Vade', render: (o) => o.due_date },
  ];

  view.appendChild(table({ cols, rows: orders, onRow: (o) => ({ onclick: () => location.hash = `#/siparisler/${o.id}` }) }));

  const { mount } = await import('../core.js');
  mount(root, view);
}

async function showOrder(root, orderId) {
  let order = null;
  try {
    order = await api.get(`/orders/${orderId}`);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'alert bad' }, icon('alert'), `Sipariş yüklenemedi: ${e.message}`));
    return;
  }

  const { mount } = await import('../core.js');

  const actions = h('div', { class: 'row wrap' });
  if (order.status === 'new') actions.appendChild(h('button', { class: 'btn', onclick: () => updateStatus('ordered') }, 'Sipariş Ver'));
  if (order.status === 'ordered') actions.appendChild(h('button', { class: 'btn', onclick: () => updateStatus('arrived') }, 'Geldi Kaydı'));
  if (order.status === 'arrived') actions.appendChild(h('button', { class: 'btn', onclick: () => updateStatus('delivered') }, 'Teslim Edildi'));
  if (order.status !== 'cancelled') actions.appendChild(h('button', { class: 'btn danger', onclick: () => updateStatus('cancelled') }, 'İptal'));

  const view = h('div', { class: 'order-detail stack' },
    h('div', { class: 'row align-center' },
      h('a', { href: '#/siparisler', class: 'btn ghost icon', 'aria-label': 'Geri' }, icon('back')),
      h('h2', null, `Sipariş #${order.id}`),
      h('div', { class: 'grow' }),
      h('span', { class: 'badge' }, ORDER_STATUS[order.status])),
    card(
      h('div', { class: 'row wrap' },
        h('div', null, h('div', { class: 'tiny faint' }, 'Müşteri'), h('b', null, order.customer_name)),
        h('div', null, h('div', { class: 'tiny faint' }, 'Kapora'), h('b', null, tl(order.deposit))),
        h('div', null, h('div', { class: 'tiny faint' }, 'Vade'), h('b', null, order.due_date || '-')),
        h('div', null, h('div', { class: 'tiny faint' }, 'Oluşturma'), h('b', null, fdt(order.created_at))))),
    order.notes ? h('div', null, h('b', null, 'Notlar'), h('p', null, order.notes)) : null,
    actions);

  async function updateStatus(st) {
    try {
      await api.put(`/orders/${orderId}`, { status: st }, { headers: { 'X-DC-Istek': 'true' } });
      toast('Sipariş güncellendi', 'ok');
      location.hash = `#/siparisler/${orderId}`;
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  function newOrder() {
    formModal({
      title: 'Yeni Sipariş',
      fields: [
        { name: 'customer_id', label: 'Müşteri', type: 'select', required: true },
        { name: 'deposit', label: 'Kapora (₺)', type: 'number', step: 0.01 },
        { name: 'due_date', label: 'Vade Tarihi', type: 'date' },
        { name: 'notes', label: 'Notlar', type: 'textarea', span: 'span-all' },
      ],
      onSubmit: async (v) => {
        try {
          const r = await api.post('/orders', {
            customer_id: v.customer_id,
            deposit: Math.round(v.deposit * 100),
            due_date: v.due_date,
            notes: v.notes,
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Sipariş oluşturuldu', 'ok');
          location.hash = `#/siparisler/${r.id}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  mount(root, view);
}
