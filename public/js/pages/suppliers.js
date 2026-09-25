// Tedarikçi yönetimi
import { h, api, tl, fdt, state, toast, modal, formModal, confirmBox, isManager } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, badge } from '../components.js';

export default async function Suppliers(root, { params, query }) {
  const supplierId = params[0];
  if (supplierId) return showSupplier(root, supplierId);
  return listSuppliers(root, query);
}

async function listSuppliers(root, query) {
  const q = query.q || '';
  let suppliers = [];
  try {
    const r = await api.get('/suppliers', { q });
    suppliers = r || [];
  } catch (e) { toast(e.message, 'bad'); }

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Tedarikçiler'),
      h('div', { class: 'toolbar-actions' },
        h('input', {
          type: 'search', placeholder: 'Tedarikçi, telefon ara…', value: q,
          onchange: (e) => { const v = e.target.value; location.hash = v ? `#/tedarikciler?q=${encodeURIComponent(v)}` : '#/tedarikciler'; }
        }),
        h('button', { class: 'btn primary', onclick: newSupplier }, icon('plus'), 'Yeni Tedarikçi'))));

  if (suppliers.length === 0) {
    view.appendChild(empty('Tedarikçi bulunamadı'));
    const { mount } = await import('../core.js');
    mount(root, view);
    return;
  }

  const cols = [
    { key: 'name', label: 'Adı', render: (s) => h('a', { href: `#/tedarikciler/${s.id}`, style: { fontWeight: 600 } }, s.name) },
    { key: 'contact_person', label: 'İlgili Kişi', render: (s) => s.contact_person || '-' },
    { key: 'phone', label: 'Telefon', render: (s) => s.phone || '-' },
    { key: 'balance', label: 'Bakiye', align: 'right', render: (s) => h('span', { class: s.balance > 0 ? 'ok' : 'bad' }, tl(s.balance)) },
    { key: 'total_purchased', label: 'Toplam Alım', align: 'right', render: (s) => tl(s.total_purchased) },
  ];

  view.appendChild(table({ cols, rows: suppliers, onRow: (s) => ({ onclick: () => location.hash = `#/tedarikciler/${s.id}` }) }));

  const { mount } = await import('../core.js');
  mount(root, view);
}

async function showSupplier(root, supplierId) {
  let supplier = null;
  let purchases = [];
  try {
    [supplier, purchases] = await Promise.all([
      api.get(`/suppliers/${supplierId}`),
      api.get(`/suppliers/${supplierId}/purchases`)
    ]);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'alert bad' }, icon('alert'), `Tedarikçi yüklenemedi: ${e.message}`));
    return;
  }

  const { mount } = await import('../core.js');

  const view = h('div', { class: 'supplier-detail stack' },
    h('div', { class: 'row align-center' },
      h('a', { href: '#/tedarikciler', class: 'btn ghost icon', 'aria-label': 'Geri' }, icon('back')),
      h('h2', null, supplier.name),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: editSupplier }, icon('edit'), 'Düzenle')));

  const info = card(
    h('div', { class: 'row wrap' },
      h('div', null, h('div', { class: 'tiny faint' }, 'İlgili Kişi'), h('b', null, supplier.contact_person || '-')),
      h('div', null, h('div', { class: 'tiny faint' }, 'Telefon'), h('b', null, supplier.phone || '-')),
      h('div', null, h('div', { class: 'tiny faint' }, 'E-posta'), h('b', null, supplier.email || '-')),
      h('div', null, h('div', { class: 'tiny faint' }, 'Bakiye'), h('b', { class: supplier.balance > 0 ? 'ok' : 'bad' }, tl(supplier.balance))),
      h('div', null, h('div', { class: 'tiny faint' }, 'Toplam Alım'), h('b', null, tl(supplier.total_purchased)))
    ));
  view.appendChild(info);

  if (supplier.balance > 0) {
    view.appendChild(h('div', { class: 'row' },
      h('h3', { style: { flex: 1 } }, 'Ödeme Gerekli'),
      h('button', { class: 'btn sm', onclick: recordPayment }, icon('check'), 'Ödeme Yap')));
  }

  if (purchases.length > 0) {
    view.appendChild(h('h3', null, 'Son Alımlar'));
    const cols = [
      { key: 'invoice_no', label: 'Fatura No', render: (p) => p.invoice_no },
      { key: 'invoice_date', label: 'Tarih', render: (p) => p.invoice_date },
      { key: 'total_amount', label: 'Tutar', align: 'right', render: (p) => tl(p.total_amount) },
      { key: 'items_count', label: 'Ürün', align: 'right', render: (p) => p.items_count },
    ];
    view.appendChild(table({ cols, rows: purchases }));
  }

  function editSupplier() {
    formModal({
      title: `${supplier.name} Düzenle`,
      fields: [
        { name: 'name', label: 'Adı', value: supplier.name, required: true, span: 'span-all' },
        { name: 'contact_person', label: 'İlgili Kişi', value: supplier.contact_person || '' },
        { name: 'phone', label: 'Telefon', value: supplier.phone || '' },
        { name: 'email', label: 'E-posta', value: supplier.email || '' },
      ],
      onSubmit: async (v) => {
        try {
          await api.put(`/suppliers/${supplierId}`, v, { headers: { 'X-DC-Istek': 'true' } });
          toast('Tedarikçi güncellendi', 'ok');
          location.hash = `#/tedarikciler/${supplierId}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  function recordPayment() {
    formModal({
      title: 'Ödeme Yap',
      fields: [
        { name: 'amount', label: 'Tutar (₺)', type: 'number', step: 0.01, required: true },
        { name: 'method', label: 'Ödeme Yöntemi', type: 'select', required: true, value: 'transfer' },
      ],
      onSubmit: async (v) => {
        try {
          await api.post(`/suppliers/${supplierId}/pay`, {
            amount: Math.round(v.amount * 100),
            method: v.method
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Ödeme kaydedildi', 'ok');
          location.hash = `#/tedarikciler/${supplierId}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  function newSupplier() {
    formModal({
      title: 'Yeni Tedarikçi',
      fields: [
        { name: 'name', label: 'Adı', required: true, span: 'span-all' },
        { name: 'contact_person', label: 'İlgili Kişi' },
        { name: 'phone', label: 'Telefon' },
        { name: 'email', label: 'E-posta' },
      ],
      onSubmit: async (v) => {
        try {
          const r = await api.post('/suppliers', v, { headers: { 'X-DC-Istek': 'true' } });
          toast('Tedarikçi oluşturuldu', 'ok');
          location.hash = `#/tedarikciler/${r.id}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  mount(root, view);
}
