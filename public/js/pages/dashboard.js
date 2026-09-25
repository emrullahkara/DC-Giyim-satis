import { h, api, tl, num, fdate, rel, isManager, state, METHOD, waLink, toast, run, addDays, today, ORDER_STATUS } from '../core.js';
import { icon } from '../icons.js';
import { kpi, delta, card, barChart, hbars, fillDays, dayLabel, badge, empty } from '../components.js';

export default async function dashboard(root) {
  const d = await api.get('/dashboard');
  const mgr = isManager();
  const hour = Number(d.now.slice(11, 13));
  const greet = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  const t = d.now.slice(0, 10);

  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, `${greet}, ${state.user.name.split(' ')[0]}`), h('div', { class: 'sub' }, `${fdate(t)} · ${state.user.store.name}`)),
    h('div', { class: 'actions' },
      h('a', { class: 'btn', href: '#/siparisler?yeni=1' }, icon('clipboard'), 'Sipariş Al'),
      mgr ? h('a', { class: 'btn', href: '#/finans?gider=1' }, icon('wallet'), 'Gider Ekle') : null,
      h('a', { class: 'btn primary', href: '#/kasa' }, icon('pos'), 'Satış Yap')));

  const avg = d.today.count ? Math.round(d.today.total / d.today.count) : 0;
  const kpis = h('div', { class: 'grid g4' },
    kpi('Bugünkü ciro', tl(d.today.total), { cls: 'accent', ico: 'trendUp', sub: [delta(d.today.total, d.lastWeekSameDay.total), ' geçen hafta aynı saate göre'] }),
    kpi('Satış adedi', `${num(d.today.count)} fiş · ${num(d.today.items)} ürün`, { ico: 'receipt', sub: `Ortalama sepet ${tl(avg)}` }),
    mgr
      ? kpi('Bugünkü brüt kâr', tl(d.today.profit), { ico: 'percent', sub: d.today.total ? `Kâr marjı %${Math.round((d.today.profit / d.today.total) * 100)}` : 'Henüz satış yok' })
      : kpi('Dünkü ciro', tl(d.yesterday.total), { ico: 'clock' }),
    kpi('Bu ay ciro', tl(d.month.total), { ico: 'calendar', sub: [delta(d.month.total, d.prevMonthToDate.total), ' geçen ayın aynı dönemine göre'] }));

  // Son 30 gün grafiği
  const series = fillDays(d.series, addDays(t, -29), t, ['total', 'profit', 'n']);
  const chart = card('Son 30 gün satış', barChart(series.map((x) => ({
    label: dayLabel(x.d), values: [x.total], tip: fdate(x.d), hl: x.d === t, extra: `${x.n || 0} fiş${mgr && x.profit !== undefined ? ` · kâr ${tl(x.profit)}` : ''}`,
  })), { height: 230 }), { actions: mgr ? h('a', { class: 'btn sm ghost', href: '#/raporlar' }, 'Raporlar', icon('chevron')) : null });

  // Uyarılar
  const alerts = [];
  if (d.lowStock.count) alerts.push(alertRow('warn', 'box', `${d.lowStock.count} üründe stok kritik seviyede`, 'Tükenmek üzere olanları sipariş edin', '#/stok?tab=kritik'));
  if (d.lowStock.negative) alerts.push(alertRow('bad', 'alert', `${d.lowStock.negative} varyantın stoğu eksiye düşmüş`, 'Mal kabul veya sayım yapılmamış olabilir', '#/stok?tab=sayim'));
  if (d.orders.arrived) alerts.push(alertRow('brand', 'clipboard', `${d.orders.arrived} sipariş mağazaya geldi`, 'Müşteriye haber verin', '#/siparisler'));
  const overdue = d.orders.due.filter((o) => o.due_date && o.due_date < t);
  if (overdue.length) alerts.push(alertRow('bad', 'clock', `${overdue.length} siparişin teslim tarihi geçti`, overdue.map((o) => o.customer_name).join(', '), '#/siparisler'));
  if (mgr && d.payables?.due.length) alerts.push(alertRow('warn', 'factory', `${d.payables.due.length} tedarikçi ödemesi yaklaşıyor`, d.payables.due.map((x) => `${x.name} (${fdate(x.due_date, { year: false })})`).join(', '), '#/tedarikciler'));
  if (mgr && d.cash && d.cash.last_closing && d.cash.last_closing.slice(0, 10) < addDays(t, -1)) {
    alerts.push(alertRow('info', 'wallet', 'Dünün gün sonu alınmamış', `Son kasa kapanışı: ${fdate(d.cash.last_closing)}`, '#/finans?tab=kasa'));
  }
  if (d.birthdays.some((b) => b.birthday.slice(5) === t.slice(5))) {
    const names = d.birthdays.filter((b) => b.birthday.slice(5) === t.slice(5)).map((b) => b.name);
    alerts.push(alertRow('ok', 'gift', `Bugün ${names.length} müşterinizin doğum günü`, names.join(', '), '#/musteriler?filter=birthday'));
  }
  const alertsCard = card('Dikkat edilecekler', alerts.length ? h('div', { class: 'stack', style: { gap: '8px' } }, alerts)
    : h('div', { class: 'alert ok' }, icon('check'), h('div', { class: 't-body' }, 'Her şey yolunda. Bekleyen acil bir iş yok.')));

  // Sağ sütun: kasa & ödeme dağılımı
  const payTotal = d.todayPayments.reduce((s, p) => s + Math.max(0, p.total), 0);
  const cashCard = card('Bugünkü tahsilat', h('div', { class: 'stack', style: { gap: '10px' } },
    d.todayPayments.length ? hbars(d.todayPayments.filter((p) => p.total > 0).map((p) => ({ label: METHOD[p.method], value: p.total })), { max: payTotal }) : empty('Bugün henüz satış yok'),
    mgr && d.cash ? h('div', { class: 'alert' }, icon('cash'), h('div', { class: 'grow' }, h('div', { class: 'small muted' }, 'Kasada olması gereken nakit'), h('b', { class: 'num', style: { fontSize: '18px' } }, tl(d.cash.expected))),
      h('a', { class: 'btn sm', href: '#/finans?tab=kasa' }, 'Gün sonu')) : null));

  const top = card('Bu haftanın çok satanları', d.topProducts.length ? h('div', { class: 'list' }, d.topProducts.map((p, i) => h('a', { class: 'li click', href: `#/urunler/${p.product_id}`, style: { color: 'inherit', textDecoration: 'none' } },
    h('span', { class: `ico ${i === 0 ? 'brand' : ''}` }, i === 0 ? icon('star') : h('b', null, String(i + 1))),
    h('span', { class: 'grow ellipsis' }, p.name), h('span', { class: 'num muted small' }, `${num(p.qty)} adet`), h('b', { class: 'num' }, tl(p.total))))) : empty('Henüz satış yok'));

  const staff = card('Personel — bu ay', d.staffBoard.length ? hbars(d.staffBoard.map((s) => ({ label: s.name, value: s.total, sub: `${s.n} fiş` })), { sub: true }) : empty('Personel eklenmemiş', null, mgr ? h('a', { class: 'btn sm', href: '#/personel' }, 'Personel ekle') : null));

  const recent = card('Son satışlar', d.recentSales.length ? h('div', { class: 'list' }, d.recentSales.map((s) => h('a', { class: 'li click', href: `#/satislar/${s.id}`, style: { color: 'inherit', textDecoration: 'none' } },
    h('span', { class: `ico ${s.total < 0 ? 'bad' : 'ok'}` }, icon(s.total < 0 ? 'undo' : 'receipt')),
    h('span', { class: 'grow' }, h('div', null, h('b', null, s.no), ' ', h('span', { class: 'muted' }, s.customer_name || 'Perakende')), h('div', { class: 'tiny faint' }, `${rel(s.created_at)} · ${s.item_count} ürün${s.staff_name ? ` · ${s.staff_name}` : ''}`)),
    h('b', { class: `num ${s.total < 0 ? 'neg' : ''}` }, tl(s.total))))) : empty('Henüz satış yok', 'İlk satışınızı Kasa ekranından yapın.', h('a', { class: 'btn primary sm', href: '#/kasa' }, 'Kasaya git')),
  { actions: h('a', { class: 'btn sm ghost', href: '#/satislar' }, 'Tümü', icon('chevron')) });

  const orders = card('Yaklaşan siparişler', d.orders.due.length ? h('div', { class: 'list' }, d.orders.due.map((o) => h('div', { class: 'li' },
    h('span', { class: `ico ${o.due_date && o.due_date < t ? 'bad' : 'info'}` }, icon('clipboard')),
    h('a', { class: 'grow', href: `#/siparisler/${o.id}`, style: { color: 'inherit' } }, h('div', null, h('b', null, o.customer_name), ' ', badge(ORDER_STATUS[o.status][0], ORDER_STATUS[o.status][1])), h('div', { class: 'tiny faint' }, `${o.no} · Teslim ${o.due_date ? fdate(o.due_date, { year: false }) : 'belirsiz'} · Kalan ${tl(o.total - o.deposit)}`)),
    o.phone ? h('a', { class: 'btn xs', target: '_blank', rel: 'noopener', href: waLink(o.phone, `Merhaba ${o.customer_name}, ${state.user.store.name} olarak siparişiniz (${o.no}) hazır. Uygun olduğunuzda mağazamıza bekleriz.`) }, icon('message'), 'Haber ver') : null)))
    : h('div', { class: 'muted small' }, `Açık sipariş: ${d.orders.open}. Önümüzdeki 3 günde teslim edilecek sipariş yok.`),
  { actions: h('a', { class: 'btn sm ghost', href: '#/siparisler' }, 'Tümü', icon('chevron')) });

  const debts = card('Veresiye alacakları', d.receivables.top.length ? h('div', null,
    h('div', { class: 'row between', style: { marginBottom: '6px' } }, h('span', { class: 'muted small' }, 'Toplam alacak'), h('b', { class: 'num' }, tl(d.receivables.total))),
    h('div', { class: 'list' }, d.receivables.top.map((c) => h('div', { class: 'li' },
      h('a', { class: 'grow', href: `#/musteriler/${c.id}`, style: { color: 'inherit' } }, h('div', null, c.name), h('div', { class: 'tiny faint' }, c.last_payment ? `Son ödeme ${rel(c.last_payment)}` : 'Hiç ödeme yapmadı')),
      h('b', { class: 'num neg' }, tl(c.balance)),
      c.phone ? h('a', { class: 'btn xs ghost', title: 'WhatsApp ile hatırlat', target: '_blank', rel: 'noopener', href: waLink(c.phone, `Merhaba ${c.name}, ${state.user.store.name} olarak hatırlatmak isteriz: güncel hesap bakiyeniz ${tl(c.balance)}. İyi günler dileriz.`) }, icon('message')) : null)))) : h('div', { class: 'muted small' }, 'Tahsil edilecek veresiye yok.'));

  const bdays = d.birthdays.length ? card('Yaklaşan doğum günleri', h('div', { class: 'list' }, d.birthdays.map((c) => h('div', { class: 'li' },
    h('span', { class: 'ico ok' }, icon('gift')),
    h('a', { class: 'grow', href: `#/musteriler/${c.id}`, style: { color: 'inherit' } }, c.name, h('div', { class: 'tiny faint' }, c.birthday.slice(5) === t.slice(5) ? 'Bugün!' : fdate(`2000-${c.birthday.slice(5)}`, { year: false }))),
    c.phone ? h('a', { class: 'btn xs', target: '_blank', rel: 'noopener', href: waLink(c.phone, `İyi ki doğdunuz ${c.name}! ${state.user.store.name} ailesi olarak yeni yaşınızı kutlarız. Size özel indiriminiz sizi mağazamızda bekliyor.`) }, icon('message'), 'Kutla') : null)))) : null;

  const tasks = tasksCard(d.tasks);

  const stockInfo = mgr && d.stockValue ? card('Stok değeri', h('div', { class: 'stack', style: { gap: '6px' } },
    h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Maliyet'), h('b', { class: 'num' }, tl(d.stockValue.cost))),
    h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Satış değeri'), h('b', { class: 'num' }, tl(d.stockValue.sale))),
    h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Toplam ürün'), h('b', { class: 'num' }, `${num(d.stockValue.units)} adet`)),
    h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Bu ayki giderler'), h('b', { class: 'num' }, tl(d.monthExpenses))),
    d.payables ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Tedarikçi borcu'), h('b', { class: 'num neg' }, tl(d.payables.total))) : null)) : null;

  root.append(head, kpis,
    h('div', { class: 'grid g-main', style: { marginTop: '16px' } },
      h('div', { class: 'stack' }, chart, h('div', { class: 'grid g2' }, top, staff), recent),
      h('div', { class: 'stack' }, alertsCard, cashCard, orders, debts, bdays, tasks, stockInfo)));
}

function alertRow(type, ico, title, text, href) {
  const cls = type === 'brand' ? 'info' : type;
  return h('a', { class: `alert ${cls}`, href, style: { textDecoration: 'none' } }, icon(ico), h('div', { class: 'grow t-body' }, h('b', null, title), text ? h('div', { class: 'small muted ellipsis' }, text) : null), icon('chevron'));
}

function tasksCard(initial) {
  let tasks = initial;
  const list = h('div', { class: 'list' });
  const input = h('input', { placeholder: 'Yeni hatırlatma ekle ve Enter’a bas…' });
  const due = h('input', { type: 'date', style: { width: '150px' }, title: 'Son tarih (isteğe bağlı)' });
  const paint = () => {
    list.replaceChildren(...(tasks.length ? tasks.map((tk) => h('div', { class: 'li' },
      h('label', { class: 'check grow' }, h('input', { type: 'checkbox', checked: !!tk.done, onchange: (e) => run(async () => {
        await api.put(`/tasks/${tk.id}`, { done: e.target.checked });
        tasks = tasks.filter((x) => x.id !== tk.id);
        paint();
        toast('Görev tamamlandı', 'ok');
      }) }), h('span', null, tk.title, tk.due_date ? h('span', { class: `tiny ${tk.due_date < today() ? 'neg' : 'faint'}`, style: { marginLeft: '6px' } }, fdate(tk.due_date, { year: false })) : null)),
      h('button', { class: 'btn xs ghost', 'aria-label': 'Sil', onclick: () => run(async () => { await api.del(`/tasks/${tk.id}`); tasks = tasks.filter((x) => x.id !== tk.id); paint(); }) }, icon('x'))))
      : [h('div', { class: 'muted small', style: { padding: '6px 0' } }, 'Yapılacak iş yok.')]));
  };
  const add = () => run(async () => {
    if (!input.value.trim()) return;
    const r = await api.post('/tasks', { title: input.value.trim(), due_date: due.value || null });
    tasks.push({ id: r.id, title: input.value.trim(), due_date: due.value || null, done: 0 });
    input.value = ''; due.value = '';
    paint();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  paint();
  return card('Yapılacaklar', h('div', { class: 'stack', style: { gap: '8px' } }, list, h('div', { class: 'row' }, input, due, h('button', { class: 'btn icon', 'aria-label': 'Ekle', onclick: add }, icon('plus')))));
}
