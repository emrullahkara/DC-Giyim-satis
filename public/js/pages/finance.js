// Gelir-gider yönetimi ve gün sonu kasa kapanışı
import { h, api, tl, fdt, rel, state, toast, modal, formModal, localToday } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, badge, dateRange } from '../components.js';

export default async function Finance(root, { params, query }) {
  const tab = query.tab || 'transactions';
  return renderFinancePage(root, tab, query);
}

async function renderFinancePage(root, tab, query) {
  const { mount } = await import('../core.js');

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Gelir-Gider & Kasa'),
      h('div', { class: 'btn-group' },
        h('a', { class: `btn sm ${tab === 'transactions' ? 'active' : ''}`, href: '#/finans?tab=transactions' }, 'İşlemler'),
        h('a', { class: `btn sm ${tab === 'closing' ? 'active' : ''}`, href: '#/finans?tab=closing' }, 'Gün Sonu Kapanış'))));

  if (tab === 'transactions') {
    await showTransactions(view, query);
  } else if (tab === 'closing') {
    await showClosing(view, query);
  }

  mount(root, view);
}

async function showTransactions(view, query) {
  const { from, to } = dateRange(query, { defDays: 30 });
  let transactions = [];
  let categories = [];
  try {
    const [tdata, cdata] = await Promise.all([
      api.get('/transactions', { from, to, limit: 100 }),
      api.get('/expense-categories')
    ]);
    transactions = tdata.rows || [];
    categories = cdata || [];
  } catch (e) { toast(e.message, 'bad'); }

  const toolbar = h('div', { class: 'toolbar-actions' },
    h('div', { class: 'btn-group' },
      h('a', { class: 'btn sm', href: '#/finans?tab=transactions' }, 'Tümü'),
      h('a', { class: 'btn sm', href: `#/finans?tab=transactions&from=${from}&to=${to}`, style: { whiteSpace: 'nowrap' } }, `${from} → ${to}`)),
    h('button', { class: 'btn primary', onclick: newTransaction }, icon('plus'), 'Gelir/Gider Kayıt'));
  view.appendChild(toolbar);

  if (transactions.length === 0) {
    view.appendChild(empty('İşlem bulunamadı'));
    return;
  }

  const totals = { income: 0, expense: 0 };
  for (const t of transactions) {
    if (t.amount > 0) totals.income += t.amount;
    else totals.expense += -t.amount;
  }

  view.appendChild(card(
    h('div', { class: 'row wrap' },
      h('div', null, h('div', { class: 'tiny faint' }, 'Toplam Gelir'), h('b', { class: 'ok' }, tl(totals.income))),
      h('div', null, h('div', { class: 'tiny faint' }, 'Toplam Gider'), h('b', { class: 'bad' }, tl(totals.expense))),
      h('div', null, h('div', { class: 'tiny faint' }, 'Net'), h('b', null, tl(totals.income - totals.expense)))
    )));

  const cols = [
    { key: 'date', label: 'Tarih', render: (t) => t.date },
    { key: 'category_name', label: 'Kategori', render: (t) => t.category_name },
    { key: 'description', label: 'Açıklama', render: (t) => t.description || '-' },
    { key: 'amount', label: 'Tutar', align: 'right', render: (t) => h('span', { class: t.amount > 0 ? 'ok' : 'bad' }, tl(Math.abs(t.amount))) },
  ];

  view.appendChild(table({ cols, rows: transactions }));

  function newTransaction() {
    formModal({
      title: 'Gelir/Gider Kayıt',
      fields: [
        { name: 'type', label: 'Tip', type: 'select', value: 'expense', required: true },
        { name: 'category_id', label: 'Kategori', type: 'select', required: true },
        { name: 'amount', label: 'Tutar (₺)', type: 'number', step: 0.01, required: true },
        { name: 'description', label: 'Açıklama', span: 'span-all' },
      ],
      onSubmit: async (v) => {
        try {
          await api.post('/transactions', {
            type: v.type,
            category_id: v.category_id,
            amount: v.type === 'income' ? Math.round(v.amount * 100) : -Math.round(v.amount * 100),
            description: v.description,
            date: localToday(state.user.store.timezone)
          }, { headers: { 'X-DC-Istek': 'true' } });
          toast('İşlem kaydedildi', 'ok');
          location.hash = '#/finans?tab=transactions';
          return true;
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    });
  }
}

async function showClosing(view, query) {
  let closings = [];
  let lastClosing = null;
  try {
    const r = await api.get('/day-closings', { limit: 30 });
    closings = r.rows || [];
    if (closings.length > 0) lastClosing = closings[0];
  } catch (e) { toast(e.message, 'bad'); }

  const today = localToday(state.user.store.timezone);
  const canClose = !lastClosing || lastClosing.closing_date < today;

  const toolbar = h('div', { class: 'toolbar-actions' });
  if (canClose) {
    toolbar.appendChild(h('button', { class: 'btn primary', onclick: performClosing }, icon('check'), 'Bugünü Kapat'));
  }
  view.appendChild(toolbar);

  if (lastClosing) {
    view.appendChild(card(
      h('div', null,
        h('h3', null, 'Son Kapanış'),
        h('div', { class: 'row wrap' },
          h('div', null, h('div', { class: 'tiny faint' }, 'Tarih'), h('b', null, lastClosing.closing_date)),
          h('div', null, h('div', { class: 'tiny faint' }, 'Satışlar'), h('b', null, tl(lastClosing.total_sales))),
          h('div', null, h('div', { class: 'tiny faint' }, 'Gelir-Gider'), h('b', null, tl(lastClosing.net_transactions))),
          h('div', null, h('div', { class: 'tiny faint' }, 'Kasa Tahmini'), h('b', null, tl(lastClosing.expected_cash)))
        ))));
  }

  if (closings.length > 0) {
    view.appendChild(h('h3', null, 'Kapanış Geçmişi'));
    const cols = [
      { key: 'closing_date', label: 'Tarih', render: (c) => c.closing_date },
      { key: 'total_sales', label: 'Satışlar', align: 'right', render: (c) => tl(c.total_sales) },
      { key: 'net_transactions', label: 'Net İşlemler', align: 'right', render: (c) => tl(c.net_transactions) },
      { key: 'expected_cash', label: 'Kasa Tahmini', align: 'right', render: (c) => tl(c.expected_cash) },
    ];
    view.appendChild(table({ cols, rows: closings }));
  }

  async function performClosing() {
    const ok = await confirmBox('Gün sonu kapanışı yapmak istiyor musunuz?');
    if (!ok) return;
    try {
      await api.post('/day-closings', {}, { headers: { 'X-DC-Istek': 'true' } });
      toast('Gün sonu kapanışı tamamlandı', 'ok');
      location.hash = '#/finans?tab=closing';
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
}

function confirmBox(msg) {
  return new Promise((res) => {
    const m = modal({
      title: 'Onay',
      body: msg,
      actions: [
        { label: 'Vazgeç', onclick: () => { m.close(); res(false); } },
        { label: 'Evet', class: 'primary', onclick: () => { m.close(); res(true); } },
      ],
    });
  });
}
