// Müşteri yönetimi (veresiye, alacaklar)
import { h, api, tl, fdt, state, toast, modal, formModal, confirmBox, isManager } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, badge } from '../components.js';

export default async function Customers(root, { params, query }) {
  const customerId = params[0];
  if (customerId) return showCustomer(root, customerId);
  return listCustomers(root, query);
}

async function listCustomers(root, query) {
  const q = query.q || '';
  let customers = [];
  let total = 0;
  try {
    const r = await api.get('/customers', { q, limit: 100 });
    customers = r.rows || [];
    total = r.total || 0;
  } catch (e) { toast(e.message, 'bad'); }

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Müşteriler'),
      h('div', { class: 'toolbar-actions' },
        h('input', {
          type: 'search', placeholder: 'Ad, telefon ara…', value: q,
          onchange: (e) => { const v = e.target.value; location.hash = v ? `#/musteriler?q=${encodeURIComponent(v)}` : '#/musteriler'; }
        }),
        h('button', { class: 'btn primary', onclick: newCustomer }, icon('plus'), 'Yeni Müşteri'))));

  if (customers.length === 0) {
    view.appendChild(empty('Müşteri bulunamadı'));
    const { mount } = await import('../core.js');
    mount(root, view);
    return;
  }

  const cols = [
    { key: 'name', label: 'Adı', render: (c) => h('a', { href: `#/musteriler/${c.id}`, style: { fontWeight: 600 } }, c.name) },
    { key: 'phone', label: 'Telefon', render: (c) => c.phone || '-' },
    { key: 'email', label: 'E-posta', render: (c) => c.email || '-' },
    { key: 'balance', label: 'Bakiye', align: 'right', render: (c) => h('span', { class: c.balance > 0 ? 'bad' : 'ok' }, tl(c.balance)) },
    { key: 'total_spent', label: 'Toplam Satın Alma', align: 'right', render: (c) => tl(c.total_spent) },
  ];

  view.appendChild(table({ cols, rows: customers, onRow: (c) => ({ onclick: () => location.hash = `#/musteriler/${c.id}` }) }));

  const { mount } = await import('../core.js');
  mount(root, view);
}

async function showCustomer(root, customerId) {
  let customer = null;
  let sales = [];
  let debts = [];
  try {
    [customer, sales] = await Promise.all([
      api.get(`/customers/${customerId}`),
      api.get(`/customers/${customerId}/sales`)
    ]);
    debts = customer.debts || [];
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'alert bad' }, icon('alert'), `Müşteri yüklenemedi: ${e.message}`));
    return;
  }

  const { mount } = await import('../core.js');

  const view = h('div', { class: 'customer-detail stack' },
    h('div', { class: 'row align-center' },
      h('a', { href: '#/musteriler', class: 'btn ghost icon', 'aria-label': 'Geri' }, icon('back')),
      h('h2', null, customer.name),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: editCustomer }, icon('edit'), 'Düzenle')));

  const info = card(
    h('div', { class: 'row wrap' },
      h('div', null, h('div', { class: 'tiny faint' }, 'Telefon'), h('b', null, customer.phone || '-')),
      h('div', null, h('div', { class: 'tiny faint' }, 'E-posta'), h('b', null, customer.email || '-')),
      h('div', null, h('div', { class: 'tiny faint' }, 'Bakiye'), h('b', { class: customer.balance > 0 ? 'bad' : 'ok' }, tl(customer.balance))),
      isManager() ? h('div', null, h('div', { class: 'tiny faint' }, 'Kredi Limiti'), h('b', null, tl(customer.credit_limit))) : null,
      h('div', null, h('div', { class: 'tiny faint' }, 'Toplam Satın Alma'), h('b', null, tl(customer.total_spent)))
    ));
  view.appendChild(info);

  if (customer.balance > 0) {
    view.appendChild(h('div', { class: 'row' },
      h('h3', { style: { flex: 1 } }, 'Borç Detayı'),
      h('button', { class: 'btn sm', onclick: collectPayment }, icon('check'), 'Tahsilat Yap')));

    if (debts.length > 0) {
      const cols = [
        { key: 'created_at', label: 'Tarih', render: (d) => fdt(d.created_at) },
        { key: 'amount', label: 'Tutar', align: 'right', render: (d) => tl(d.amount) },
        { key: 'reason', label: 'Neden', render: (d) => d.reason || '-' },
      ];
      view.appendChild(table({ cols, rows: debts }));
    }
  }

  if (sales.length > 0) {
    view.appendChild(h('h3', null, 'Son Satışlar'));
    const cols = [
      { key: 'no', label: 'Fiş No', render: (s) => s.no },
      { key: 'created_at', label: 'Tarih', render: (s) => fdt(s.created_at) },
      { key: 'total', label: 'Tutar', align: 'right', render: (s) => tl(s.total) },
    ];
    view.appendChild(table({ cols, rows: sales }));
  }

  function editCustomer() {
    formModal({
      title: `${customer.name} Düzenle`,
      fields: [
        { name: 'name', label: 'Adı', value: customer.name, required: true, span: 'span-all' },
        { name: 'phone', label: 'Telefon', value: customer.phone || '' },
        { name: 'email', label: 'E-posta', value: customer.email || '' },
        isManager() ? { name: 'credit_limit', label: 'Kredi Limiti (₺)', type: 'number', step: 0.01, value: customer.credit_limit / 100 } : null,
      ].filter(Boolean),
      onSubmit: async (v) => {
        try {
          await api.put(`/customers/${customerId}`, {
            name: v.name, phone: v.phone, email: v.email,
            credit_limit: v.credit_limit ? Math.round(v.credit_limit * 100) : undefined
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Müşteri güncellendi', 'ok');
          location.hash = `#/musteriler/${customerId}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  function collectPayment() {
    formModal({
      title: 'Tahsilat Yap',
      fields: [
        { name: 'amount', label: 'Tutar (₺)', type: 'number', step: 0.01, required: true },
        { name: 'method', label: 'Ödeme Yöntemi', type: 'select', required: true, value: 'cash' },
      ],
      onSubmit: async (v) => {
        try {
          await api.post(`/customers/${customerId}/collect`, {
            amount: Math.round(v.amount * 100),
            method: v.method
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Tahsilat kaydedildi', 'ok');
          location.hash = `#/musteriler/${customerId}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  function newCustomer() {
    formModal({
      title: 'Yeni Müşteri',
      fields: [
        { name: 'name', label: 'Adı', required: true, span: 'span-all' },
        { name: 'phone', label: 'Telefon' },
        { name: 'email', label: 'E-posta' },
      ],
      onSubmit: async (v) => {
        try {
          const r = await api.post('/customers', v, { headers: { 'X-DC-Istek': 'true' } });
          toast('Müşteri oluşturuldu', 'ok');
          location.hash = `#/musteriler/${r.id}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  mount(root, view);
}
