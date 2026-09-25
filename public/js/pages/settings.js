// Ayarlar: mağaza bilgileri, kategoriler, beden setleri
import { h, api, state, toast, formModal } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, badge } from '../components.js';

export default async function Settings(root, { params, query }) {
  const tab = query.tab || 'store';
  return renderSettingsPage(root, tab);
}

async function renderSettingsPage(root, tab) {
  const { mount } = await import('../core.js');

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Ayarlar'),
      h('div', { class: 'btn-group' },
        h('a', { class: `btn sm ${tab === 'store' ? 'active' : ''}`, href: '#/ayarlar?tab=store' }, 'Mağaza'),
        h('a', { class: `btn sm ${tab === 'categories' ? 'active' : ''}`, href: '#/ayarlar?tab=categories' }, 'Kategoriler'),
        h('a', { class: `btn sm ${tab === 'sizes' ? 'active' : ''}`, href: '#/ayarlar?tab=sizes' }, 'Bedenler'))));

  if (tab === 'store') {
    await showStoreSettings(view);
  } else if (tab === 'categories') {
    await showCategories(view);
  } else if (tab === 'sizes') {
    await showSizes(view);
  }

  mount(root, view);
}

async function showStoreSettings(view) {
  const st = state.user.store;

  const info = card(
    h('div', { class: 'stack' },
      h('h3', null, 'Mağaza Bilgileri'),
      h('div', { class: 'row wrap' },
        h('div', null, h('div', { class: 'tiny faint' }, 'Adı'), h('b', null, st.name)),
        h('div', null, h('div', { class: 'tiny faint' }, 'Saat Dilimi'), h('b', null, st.timezone)),
        h('div', null, h('div', { class: 'tiny faint' }, 'Şehir'), h('b', null, st.city || '-')),
        h('div', null, h('div', { class: 'tiny faint' }, 'Vergi No'), h('b', null, st.tax_no || '-')))
    ));
  view.appendChild(info);

  const btn = h('button', { class: 'btn', onclick: editStore }, icon('edit'), 'Bilgileri Düzenle');
  view.appendChild(btn);

  function editStore() {
    formModal({
      title: 'Mağaza Bilgileri',
      fields: [
        { name: 'name', label: 'Adı', value: st.name, required: true, span: 'span-all' },
        { name: 'address', label: 'Adresi', value: st.address || '' },
        { name: 'city', label: 'Şehir', value: st.city || '' },
        { name: 'phone', label: 'Telefon', value: st.phone || '' },
        { name: 'email', label: 'E-posta', value: st.email || '' },
        { name: 'tax_no', label: 'Vergi No', value: st.tax_no || '' },
        { name: 'tax_office', label: 'Vergi Dairesi', value: st.tax_office || '' },
        { name: 'receipt_footer', label: 'Fiş Altı Yazı', value: st.receipt_footer || '', type: 'textarea' },
      ],
      onSubmit: async (v) => {
        try {
          await api.put(`/stores/${st.id}`, v, { headers: { 'X-DC-Istek': 'true' } });
          toast('Mağaza bilgileri güncellendi', 'ok');
          // Refresh user data
          const r = await api.get('/auth/me');
          state.user = r.user;
          location.hash = '#/ayarlar?tab=store';
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }
}

async function showCategories(view) {
  let categories = [];
  try {
    const r = await api.get('/categories');
    categories = r || [];
  } catch (e) { toast(e.message, 'bad'); }

  const btn = h('button', { class: 'btn primary', style: { marginBottom: '16px' }, onclick: newCategory }, icon('plus'), 'Kategori Ekle');
  view.appendChild(btn);

  if (categories.length === 0) {
    view.appendChild(empty('Kategori bulunamadı'));
    return;
  }

  const cols = [
    { key: 'name', label: 'Adı', render: (c) => h('span', { style: { fontWeight: 600 } }, c.name) },
    { key: 'product_count', label: 'Ürün Sayısı', align: 'right', render: (c) => c.product_count || 0 },
    { key: 'actions', label: '', align: 'center', render: (c) => h('button', { class: 'btn sm danger', onclick: () => deleteCategory(c.id) }, icon('x')) },
  ];

  view.appendChild(table({ cols, rows: categories }));

  function newCategory() {
    formModal({
      title: 'Yeni Kategori',
      fields: [
        { name: 'name', label: 'Adı', required: true, span: 'span-all' },
      ],
      onSubmit: async (v) => {
        try {
          await api.post('/categories', v, { headers: { 'X-DC-Istek': 'true' } });
          toast('Kategori oluşturuldu', 'ok');
          location.hash = '#/ayarlar?tab=categories';
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  async function deleteCategory(catId) {
    const ok = await confirmBox('Bu kategoriyi silmek istiyor musunuz?');
    if (!ok) return;
    try {
      await api.delete(`/categories/${catId}`, { headers: { 'X-DC-Istek': 'true' } });
      toast('Kategori silindi', 'ok');
      location.hash = '#/ayarlar?tab=categories';
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
}

async function showSizes(view) {
  let sizes = [];
  try {
    const r = await api.get('/sizes');
    sizes = r || [];
  } catch (e) { toast(e.message, 'bad'); }

  const btn = h('button', { class: 'btn primary', style: { marginBottom: '16px' }, onclick: newSize }, icon('plus'), 'Beden Ekle');
  view.appendChild(btn);

  if (sizes.length === 0) {
    view.appendChild(empty('Beden bulunamadı'));
    return;
  }

  const cols = [
    { key: 'name', label: 'Adı', render: (s) => h('span', { style: { fontWeight: 600 } }, s.name) },
    { key: 'order', label: 'Sıra', align: 'right', render: (s) => s.order || '-' },
    { key: 'actions', label: '', align: 'center', render: (s) => h('button', { class: 'btn sm danger', onclick: () => deleteSize(s.id) }, icon('x')) },
  ];

  view.appendChild(table({ cols, rows: sizes }));

  function newSize() {
    formModal({
      title: 'Yeni Beden',
      fields: [
        { name: 'name', label: 'Adı', required: true },
        { name: 'order', label: 'Sıra', type: 'number', value: sizes.length + 1 },
      ],
      onSubmit: async (v) => {
        try {
          await api.post('/sizes', { name: v.name, order: Number(v.order) }, { headers: { 'X-DC-Istek': 'true' } });
          toast('Beden oluşturuldu', 'ok');
          location.hash = '#/ayarlar?tab=sizes';
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }

  async function deleteSize(sizeId) {
    const ok = await confirmBox('Bu bedeni silmek istiyor musunuz?');
    if (!ok) return;
    try {
      await api.delete(`/sizes/${sizeId}`, { headers: { 'X-DC-Istek': 'true' } });
      toast('Beden silindi', 'ok');
      location.hash = '#/ayarlar?tab=sizes';
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
}

function confirmBox(msg) {
  return new Promise((res) => {
    const { modal } = require('../core.js');
    const m = modal({
      title: 'Onay',
      body: msg,
      actions: [
        { label: 'Vazgeç', onclick: () => { m.close(); res(false); } },
        { label: 'Evet', class: 'danger', onclick: () => { m.close(); res(true); } },
      ],
    });
  });
}
