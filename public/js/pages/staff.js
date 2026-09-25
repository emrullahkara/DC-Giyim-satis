// Personel yönetimi (maaş, avans, prim)
import { h, api, tl, fdt, state, toast, modal, formModal, confirmBox } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, badge } from '../components.js';

export default async function Staff(root, { params, query }) {
  const staffId = params[0];
  if (staffId) return showStaff(root, staffId);
  return listStaff(root, query);
}

async function listStaff(root, query) {
  let staff = [];
  try {
    const r = await api.get('/staff');
    staff = r || [];
  } catch (e) { toast(e.message, 'bad'); }

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Personel'),
      h('div', { class: 'toolbar-actions' },
        h('button', { class: 'btn primary', onclick: newStaff }, icon('plus'), 'Personel Ekle'))));

  if (staff.length === 0) {
    view.appendChild(empty('Personel bulunamadı'));
    const { mount } = await import('../core.js');
    mount(root, view);
    return;
  }

  const cols = [
    { key: 'name', label: 'Adı', render: (s) => h('a', { href: `#/personel/${s.id}`, style: { fontWeight: 600 } }, s.name) },
    { key: 'phone', label: 'Telefon', render: (s) => s.phone || '-' },
    { key: 'role', label: 'Pozisyon', render: (s) => s.role },
    { key: 'salary', label: 'Maaş', align: 'right', render: (s) => tl(s.salary) },
    { key: 'ytd_commission', label: 'YTD Prim', align: 'right', render: (s) => tl(s.ytd_commission) },
  ];

  view.appendChild(table({ cols, rows: staff, onRow: (s) => ({ onclick: () => location.hash = `#/personel/${s.id}` }) }));

  const { mount } = await import('../core.js');
  mount(root, view);
}

async function showStaff(root, staffId) {
  let person = null;
  let payments = [];
  let commissions = [];
  try {
    [person, payments, commissions] = await Promise.all([
      api.get(`/staff/${staffId}`),
      api.get(`/staff/${staffId}/payments`),
      api.get(`/staff/${staffId}/commissions`)
    ]);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'alert bad' }, icon('alert'), `Personel yüklenemedi: ${e.message}`));
    return;
  }

  const { mount } = await import('../core.js');

  const view = h('div', { class: 'staff-detail stack' },
    h('div', { class: 'row align-center' },
      h('a', { href: '#/personel', class: 'btn ghost icon', 'aria-label': 'Geri' }, icon('back')),
      h('h2', null, person.name),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: editStaff }, icon('edit'), 'Düzenle')));

  const info = card(
    h('div', { class: 'row wrap' },
      h('div', null, h('div', { class: 'tiny faint' }, 'Telefon'), h('b', null, person.phone || '-')),
      h('div', null, h('div', { class: 'tiny faint' }, 'Pozisyon'), h('b', null, person.role)),
      h('div', null, h('div', { class: 'tiny faint' }, 'Maaş'), h('b', null, tl(person.salary))),
      h('div', null, h('div', { class: 'tiny faint' }, 'YTD Prim'), h('b', null, tl(person.ytd_commission)))
    ));
  view.appendChild(info);

  const actions = h('div', { class: 'row wrap', style: { marginBottom: '16px' } },
    h('button', { class: 'btn', onclick: paySalary }, icon('check'), 'Maaş Öde'),
    h('button', { class: 'btn', onclick: recordAdvance }, icon('plus'), 'Avans Ver')
  );
  view.appendChild(actions);

  if (payments.length > 0) {
    view.appendChild(h('h3', null, 'Maaş & Avans Ödemeleri'));
    const cols = [
      { key: 'payment_date', label: 'Tarih', render: (p) => fdt(p.payment_date) },
      { key: 'type', label: 'Tip', render: (p) => badge(p.type, { salary: 'info', advance: 'warn' }) },
      { key: 'amount', label: 'Tutar', align: 'right', render: (p) => tl(p.amount) },
    ];
    view.appendChild(table({ cols, rows: payments }));
  }

  if (commissions.length > 0) {
    view.appendChild(h('h3', null, 'Primleri'));
    const cols = [
      { key: 'period', label: 'Dönem', render: (c) => c.period },
      { key: 'amount', label: 'Tutar', align: 'right', render: (c) => tl(c.amount) },
    ];
    view.appendChild(table({ cols, rows: commissions }));
  }

  function editStaff() {
    formModal({
      title: `${person.name} Düzenle`,
      fields: [
        { name: 'name', label: 'Adı', value: person.name, required: true, span: 'span-all' },
        { name: 'phone', label: 'Telefon', value: person.phone || '' },
        { name: 'role', label: 'Pozisyon', value: person.role },
        { name: 'salary', label: 'Maaş (₺)', type: 'number', step: 0.01, value: person.salary / 100 },
      ],
      onSubmit: async (v) => {
        try {
          await api.put(`/staff/${staffId}`, {
            name: v.name, phone: v.phone, role: v.role,
            salary: Math.round(v.salary * 100)
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Personel güncellendi', 'ok');
          location.hash = `#/personel/${staffId}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  function paySalary() {
    formModal({
      title: 'Maaş Öde',
      fields: [
        { name: 'amount', label: 'Tutar (₺)', type: 'number', step: 0.01, value: person.salary / 100, required: true },
        { name: 'method', label: 'Ödeme Yöntemi', type: 'select', required: true, value: 'cash' },
      ],
      onSubmit: async (v) => {
        try {
          await api.post(`/staff/${staffId}/pay`, {
            amount: Math.round(v.amount * 100),
            type: 'salary',
            method: v.method
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Maaş ödendi', 'ok');
          location.hash = `#/personel/${staffId}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  function recordAdvance() {
    formModal({
      title: 'Avans Ver',
      fields: [
        { name: 'amount', label: 'Tutar (₺)', type: 'number', step: 0.01, required: true },
        { name: 'method', label: 'Ödeme Yöntemi', type: 'select', required: true, value: 'cash' },
      ],
      onSubmit: async (v) => {
        try {
          await api.post(`/staff/${staffId}/pay`, {
            amount: Math.round(v.amount * 100),
            type: 'advance',
            method: v.method
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Avans kaydedildi', 'ok');
          location.hash = `#/personel/${staffId}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  function newStaff() {
    formModal({
      title: 'Yeni Personel',
      fields: [
        { name: 'name', label: 'Adı', required: true, span: 'span-all' },
        { name: 'phone', label: 'Telefon' },
        { name: 'role', label: 'Pozisyon', required: true },
        { name: 'salary', label: 'Maaş (₺)', type: 'number', step: 0.01, required: true },
      ],
      onSubmit: async (v) => {
        try {
          const r = await api.post('/staff', {
            name: v.name, phone: v.phone, role: v.role,
            salary: Math.round(v.salary * 100)
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Personel eklendi', 'ok');
          location.hash = `#/personel/${r.id}`;
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  mount(root, view);
}
