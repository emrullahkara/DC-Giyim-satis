// KASA — barkodla hızlı satış, iade, değişim, parçalı ödeme, veresiye, sipariş teslimi
import {
  h, mount, api, tl, toast, run, modal, confirmBox, parseTL, toInput, state, METHOD, fdt, fdate, isManager, waLink, formModal, today, addDays,
} from '../core.js';
import { icon } from '../icons.js';
import { picker, badge, colorSwatch, empty } from '../components.js';
import { printReceipt } from '../receipt.js';

// Sepet modül düzeyinde tutulur: başka sayfaya geçip dönünce kaybolmaz
const cart = newCart();
function newCart() {
  return { lines: [], returns: [], customer: null, staffId: null, cartDiscount: 0, note: '', order: null, dueDate: '' };
}
function resetCart() { Object.assign(cart, newCart()); }

let staffList = [];
let els = {};
let lineSeq = 1;

export default async function pos(root, { query }) {
  staffList = (await api.get('/staff')).rows.filter((s) => s.active);
  if (cart.staffId === null) cart.staffId = state.user.staff_id || '';

  const scan = picker({
    placeholder: 'Barkod okutun veya ürün adı / model kodu yazın…',
    big: true,
    autofocus: true,
    search: (qv) => api.get('/variants/search', { q: qv }),
    render: (v) => [h('span', { class: 'grow' }, h('div', { class: 'ellipsis' }, h('b', null, v.name), ' ', h('span', { class: 'muted' }, [v.size, v.color].filter(Boolean).join(' / '))),
      h('div', { class: 'tiny faint' }, [v.code, v.brand, v.barcode].filter(Boolean).join(' · '))),
    stockBadge(v.stock), h('b', { class: 'num' }, tl(v.price))],
    onSelect: (v, input) => { addVariant(v); input.value = ''; },
    onEnterRaw: async (code, input) => {
      if (!code) return false;
      const v = await api.get('/variants/lookup', { code }).catch(() => null);
      if (v) { addVariant(v); input.value = ''; return true; }
      if (/^\d{8,14}$/.test(code)) { toast(`"${code}" barkodlu ürün bulunamadı`, 'err'); input.select(); return true; }
      return false;
    },
  });
  scan.classList.add('pos-scan-box');
  els.scanInput = scan.querySelector('input');

  els.lines = h('div');
  els.side = h('div', { class: 'pos-side' });

  root.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Kasa'), h('div', { class: 'sub' }, 'Barkod okutun, ürünü sepete ekleyin, ödemeyi alın.')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: returnDialog }, icon('undo'), 'İade / Değişim'),
        h('button', { class: 'btn', onclick: freeLineDialog }, icon('plus'), 'Serbest Ürün'),
        h('button', { class: 'btn ghost danger', onclick: async () => { if (!cartEmpty() && await confirmBox('Sepetteki tüm ürünler silinsin mi?', { ok: 'Sepeti temizle', danger: true })) { resetCart(); cart.staffId = state.user.staff_id || ''; paint(); } } }, icon('trash'), 'Temizle'))),
    h('div', { class: 'pos-grid' },
      h('div', { class: 'stack' }, h('div', { class: 'pos-scan' }, h('div', { class: 'grow', style: { position: 'relative' } }, scan)), h('div', { class: 'card' }, els.lines)),
      els.side));

  if (query.siparis) await loadOrder(Number(query.siparis));
  if (query.iade) await returnDialog(query.iade);
  paint();

  const onKey = (e) => {
    if (document.querySelector('.modal-bg')) return;
    if (e.key === 'F4') { e.preventDefault(); checkout('cash'); }
    if (e.key === 'F8') { e.preventDefault(); checkout('card'); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

const cartEmpty = () => !cart.lines.length && !cart.returns.length;
const stockBadge = (s) => (s <= 0 ? badge('Stok yok', 'bad') : s <= 2 ? badge(`Son ${s}`, 'warn') : badge(`Stok ${s}`));

function addVariant(v, qty = 1, unitPrice) {
  const existing = cart.lines.find((l) => l.variant && l.variant.id === v.id && unitPrice === undefined);
  if (existing) existing.qty += qty;
  else cart.lines.push({ key: lineSeq++, variant: v, name: v.name, qty, unit_price: unitPrice ?? v.price, list_price: v.list_price, discount: 0 });
  const inCart = cart.lines.filter((l) => l.variant?.id === v.id).reduce((s, l) => s + l.qty, 0);
  if (v.stock - inCart < 0) toast(`${v.name} (${v.size || '-'}) stokta görünmüyor — satış yine de yapılabilir`, 'err');
  paint();
  els.scanInput?.focus();
}

function totals() {
  const gross = cart.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const lineDisc = cart.lines.reduce((s, l) => s + l.discount, 0);
  const net = gross - lineDisc;
  const cartDisc = Math.min(cart.cartDiscount, net);
  const ret = cart.returns.reduce((s, r) => s + r.amount, 0);
  const listSave = cart.lines.reduce((s, l) => s + Math.max(0, (l.list_price || l.unit_price) - l.unit_price) * l.qty, 0);
  const total = net - cartDisc - ret;
  const deposit = cart.order ? Math.min(cart.order.deposit, Math.max(0, total)) : 0;
  return { gross, lineDisc, net, cartDisc, ret, total, deposit, due: total - deposit, listSave, items: cart.lines.reduce((s, l) => s + l.qty, 0) };
}

function paint() {
  // --- Sepet satırları ---
  if (cartEmpty()) {
    mount(els.lines, h('div', { class: 'empty', style: { padding: '56px 16px' } }, icon('scan'), h('b', null, 'Sepet boş'),
      h('div', null, 'Barkod okutun veya yukarıdan ürün arayın.'),
      h('div', { class: 'small faint', style: { marginTop: '10px' } }, h('span', { class: 'kbd' }, 'F4'), ' nakit  ', h('span', { class: 'kbd' }, 'F8'), ' kart  ', h('span', { class: 'kbd' }, 'F2'), ' kasa')));
  } else {
    mount(els.lines,
      cart.order ? h('div', { class: 'alert info', style: { margin: '12px' } }, icon('clipboard'), h('div', { class: 't-body grow' }, h('b', null, `Sipariş teslimi: ${cart.order.no}`), h('div', { class: 'small' }, `Alınan kapora ${tl(cart.order.deposit)} otomatik düşülecek.`)),
        h('button', { class: 'btn xs', onclick: () => { cart.order = null; paint(); } }, 'Kaldır')) : null,
      cart.lines.map((l) => {
        const v = l.variant;
        const lineTotal = l.qty * l.unit_price - l.discount;
        return h('div', { class: 'cart-line' },
          h('div', { class: 'nm' }, h('b', { class: 'ellipsis' }, l.name),
            h('div', { class: 'small muted row', style: { gap: '6px' } },
              v ? [colorSwatch(v.color), [v.size, v.color].filter(Boolean).join(' / ') || 'Tek beden', h('span', { class: 'faint mono' }, v.barcode)] : [badge('Serbest ürün'), [l.size, l.color].filter(Boolean).join(' / ')],
              l.discount ? badge(`-${tl(l.discount)} indirim`, 'ok') : null,
              l.unit_price < (l.list_price || 0) ? badge('İndirimli', 'ok') : null,
              v && v.stock - l.qty < 0 ? badge('Stok yetersiz', 'bad') : null)),
          h('div', { class: 'qty' },
            h('button', { 'aria-label': 'Azalt', onclick: () => { l.qty > 1 ? l.qty-- : cart.lines.splice(cart.lines.indexOf(l), 1); l.discount = Math.min(l.discount, l.qty * l.unit_price); paint(); } }, '−'),
            h('span', null, String(l.qty)),
            h('button', { 'aria-label': 'Arttır', onclick: () => { l.qty++; paint(); } }, '+')),
          h('button', { class: 'btn ghost sm', title: 'Fiyat / indirim düzenle', onclick: () => editLine(l) },
            h('span', { class: 'num right', style: { minWidth: '90px' } }, l.discount ? h('div', { class: 'tiny strike' }, tl(l.qty * l.unit_price)) : null, h('b', null, tl(lineTotal)))),
          h('button', { class: 'btn ghost icon sm', 'aria-label': 'Sil', onclick: () => { cart.lines.splice(cart.lines.indexOf(l), 1); paint(); } }, icon('x')));
      }),
      cart.returns.map((r) => h('div', { class: 'cart-line ret' },
        h('div', { class: 'nm' }, h('b', null, `İADE: ${r.item.name}`), h('div', { class: 'small muted' }, `${[r.item.size, r.item.color].filter(Boolean).join(' / ')} · Fiş ${r.saleNo} · ${fdate(r.saleDate)}`)),
        h('div', { class: 'qty' },
          h('button', { onclick: () => { if (r.qty > 1) { r.qty--; r.amount = retAmount(r.item, r.qty); } else cart.returns.splice(cart.returns.indexOf(r), 1); paint(); } }, '−'),
          h('span', null, String(r.qty)),
          h('button', { onclick: () => { if (r.qty < r.item.qty - r.item.returned_qty) { r.qty++; r.amount = retAmount(r.item, r.qty); paint(); } } }, '+')),
        h('b', { class: 'num neg', style: { minWidth: '90px', textAlign: 'right' } }, `-${tl(r.amount)}`),
        h('button', { class: 'btn ghost icon sm', 'aria-label': 'Sil', onclick: () => { cart.returns.splice(cart.returns.indexOf(r), 1); paint(); } }, icon('x')))));
  }

  // --- Sağ panel ---
  const t = totals();
  const customerBox = cart.customer
    ? h('div', { class: 'row' }, h('span', { class: 'avatar' }, cart.customer.name[0]), h('div', { class: 'grow' }, h('b', null, cart.customer.name), h('div', { class: 'small muted' }, cart.customer.phone || '', cart.customer.balance > 0 ? h('span', { class: 'neg' }, ` · Borç ${tl(cart.customer.balance)}`) : null, cart.customer.sizes_note ? h('div', { class: 'tiny' }, `Beden: ${cart.customer.sizes_note}`) : null)),
      h('button', { class: 'btn ghost icon sm', 'aria-label': 'Müşteriyi kaldır', onclick: () => { cart.customer = null; paint(); } }, icon('x')))
    : h('div', { class: 'row' }, h('div', { class: 'grow' }, picker({
      placeholder: 'Müşteri ara (ad / telefon)…', minChars: 2,
      search: async (qv) => (await api.get('/customers', { q: qv, limit: 8 })).rows,
      render: (c) => [h('span', { class: 'grow' }, h('div', null, c.name), h('div', { class: 'tiny faint' }, c.phone || '')), c.balance > 0 ? h('span', { class: 'small neg num' }, tl(c.balance)) : null],
      onSelect: (c) => { cart.customer = c; paint(); },
    })), h('button', { class: 'btn icon', title: 'Yeni müşteri', 'aria-label': 'Yeni müşteri', onclick: quickCustomer }, icon('plus')));

  const staffSel = h('select', { onchange: (e) => { cart.staffId = e.target.value; } },
    h('option', { value: '' }, 'Satış danışmanı seçin'),
    staffList.map((s) => h('option', { value: s.id, selected: String(s.id) === String(cart.staffId) }, s.name)));

  const noItems = cartEmpty();
  const payBtn = (m, ico, label, key) => h('button', { class: 'pay-btn', disabled: noItems, onclick: () => checkout(m) }, icon(ico), label, key ? h('span', { class: 'kbd' }, key) : null);

  mount(els.side,
    h('div', { class: 'card card-b', style: { paddingTop: '14px' } }, h('div', { class: 'stack', style: { gap: '10px' } },
      h('div', { class: 'field' }, h('label', null, 'Müşteri'), customerBox),
      staffList.length ? h('div', { class: 'field' }, h('label', null, 'Satış danışmanı (prim için)'), staffSel) : null)),
    h('div', { class: 'card card-b totals', style: { paddingTop: '14px' } },
      h('div', { class: 'tr' }, h('span', { class: 'muted' }, `Ara toplam (${t.items} ürün)`), h('span', { class: 'num' }, tl(t.gross))),
      t.lineDisc ? h('div', { class: 'tr' }, h('span', { class: 'muted' }, 'Ürün indirimleri'), h('span', { class: 'num pos' }, `-${tl(t.lineDisc)}`)) : null,
      h('div', { class: 'tr' }, h('button', { class: 'btn xs', disabled: !cart.lines.length, onclick: cartDiscountDialog }, icon('percent'), cart.cartDiscount ? 'Sepet indirimini değiştir' : 'Sepet indirimi'), t.cartDisc ? h('span', { class: 'num pos' }, `-${tl(t.cartDisc)}`) : null),
      t.ret ? h('div', { class: 'tr' }, h('span', { class: 'muted' }, 'İade edilen'), h('span', { class: 'num neg' }, `-${tl(t.ret)}`)) : null,
      t.deposit ? h('div', { class: 'tr' }, h('span', { class: 'muted' }, 'Alınan kapora'), h('span', { class: 'num pos' }, `-${tl(t.deposit)}`)) : null,
      h('div', { class: 'tr grand' }, h('span', null, t.due < 0 ? 'İade edilecek' : 'Ödenecek'), h('span', { class: `num ${t.due < 0 ? 'neg' : ''}` }, tl(Math.abs(t.due)))),
      t.listSave + t.lineDisc + t.cartDisc > 0 ? h('div', { class: 'small pos', style: { textAlign: 'right' } }, `Müşteri kazancı: ${tl(t.listSave + t.lineDisc + t.cartDisc)}`) : null),
    t.due < 0
      ? h('button', { class: 'btn danger solid lg', disabled: noItems, onclick: () => checkout('refund') }, icon('undo'), 'Para İadesi Yap')
      : t.due === 0 && !noItems
        ? h('button', { class: 'btn primary lg', onclick: () => checkout('even') }, icon('check'), 'Değişimi Tamamla')
        : h('div', { class: 'pay-methods' },
          payBtn('cash', 'cash', 'Nakit', 'F4'), payBtn('card', 'card', 'Kredi Kartı', 'F8'),
          payBtn('transfer', 'bank', 'Havale/EFT'), payBtn('credit', 'book', 'Veresiye'),
          h('button', { class: 'pay-btn', style: { gridColumn: 'span 2', flexDirection: 'row', justifyContent: 'center' }, disabled: noItems, onclick: () => checkout('split') }, icon('layers'), 'Parçalı ödeme (nakit + kart…)')),
    h('input', { placeholder: 'Fiş notu (isteğe bağlı)', value: cart.note, oninput: (e) => { cart.note = e.target.value; } }));
}

function retAmount(item, qty) {
  const remaining = item.qty - item.returned_qty;
  if (qty === remaining) return item.total - (item.refunded || 0);
  return Math.round((item.total * qty) / item.qty);
}

// --- Satır düzenleme: pazarlık fiyatı, % veya TL indirim ---
function editLine(l) {
  const price = h('input', { class: 'money-in big', inputmode: 'decimal', value: toInput(l.unit_price) });
  const qty = h('input', { type: 'number', min: 1, value: l.qty, class: 'big' });
  const disc = h('input', { class: 'money-in', inputmode: 'decimal', value: toInput(l.discount), placeholder: '0' });
  const pctBtns = [5, 10, 15, 20, 25, 30, 50].map((p) => h('button', { class: 'btn sm', type: 'button', onclick: () => {
    const u = parseTL(price.value); const q = Number(qty.value) || 1;
    disc.value = toInput(Math.round((u * q * p) / 100));
  } }, `%${p}`));
  const m = modal({
    title: l.name,
    body: h('div', { class: 'stack' },
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', null, 'Birim fiyat'), price, l.list_price && l.list_price !== l.unit_price ? h('span', { class: 'hint' }, `Etiket fiyatı: ${tl(l.list_price)}`) : null),
        h('div', { class: 'field' }, h('label', null, 'Adet'), qty)),
      h('div', { class: 'field' }, h('label', null, 'Satır indirimi (TL)'), disc, h('div', { class: 'row wrap', style: { marginTop: '6px' } }, pctBtns))),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Vazgeç'), h('button', { class: 'btn primary', onclick: () => {
      const u = parseTL(price.value); const q = Math.floor(Number(qty.value)); const d = parseTL(disc.value || '0');
      if (Number.isNaN(u) || u < 0) return toast('Fiyat geçersiz', 'err');
      if (!(q >= 1)) return toast('Adet en az 1 olmalı', 'err');
      if (Number.isNaN(d) || d < 0 || d > u * q) return toast('İndirim, satır tutarını aşamaz', 'err');
      Object.assign(l, { unit_price: u, qty: q, discount: d });
      m.close(); paint();
    } }, 'Uygula')],
  });
}

function cartDiscountDialog() {
  const t = totals();
  const amt = h('input', { class: 'money-in big', inputmode: 'decimal', value: toInput(cart.cartDiscount || '') , placeholder: '0' });
  const m = modal({
    title: 'Sepet indirimi',
    body: h('div', { class: 'stack' },
      h('div', { class: 'muted' }, `İndirim öncesi tutar: ${tl(t.net)}`),
      h('div', { class: 'field' }, h('label', null, 'İndirim tutarı (TL)'), amt),
      h('div', { class: 'row wrap' }, [5, 10, 15, 20, 25, 30].map((p) => h('button', { class: 'btn sm', onclick: () => { amt.value = toInput(Math.round((t.net * p) / 100)); } }, `%${p}`)),
        h('button', { class: 'btn sm', title: 'Küsuratı sil', onclick: () => { amt.value = toInput(t.net % 1000); } }, 'Küsuratı at'))),
    footer: [
      h('button', { class: 'btn', onclick: () => { cart.cartDiscount = 0; m.close(); paint(); } }, 'İndirimi kaldır'),
      h('button', { class: 'btn primary', onclick: () => {
        const v = parseTL(amt.value || '0');
        if (Number.isNaN(v) || v < 0 || v > t.net) return toast('İndirim geçersiz', 'err');
        cart.cartDiscount = v; m.close(); paint();
      } }, 'Uygula')],
  });
}

function freeLineDialog() {
  formModal({
    title: 'Serbest ürün / hizmet ekle',
    intro: h('p', { class: 'muted', style: { marginTop: 0 } }, 'Sistemde kayıtlı olmayan ürün veya tadilat gibi hizmetler için. Stok düşülmez.'),
    fields: [
      { name: 'name', label: 'Açıklama', required: true, span: 'span-all', placeholder: 'Örn: Paça tadilatı', autofocus: true },
      { name: 'unit_price', label: 'Fiyat', type: 'money', required: true },
      { name: 'qty', label: 'Adet', type: 'number', min: 1 },
      { name: 'size', label: 'Beden (isteğe bağlı)' },
    ],
    values: { qty: 1 },
    submit: 'Sepete ekle',
    onSubmit: (v) => {
      if (!v.unit_price) throw new Error('Fiyat girin');
      cart.lines.push({ key: lineSeq++, variant: null, name: v.name, size: v.size, qty: Math.max(1, Math.floor(v.qty || 1)), unit_price: v.unit_price, list_price: v.unit_price, discount: 0 });
      paint();
      return true;
    },
  });
}

function quickCustomer() {
  formModal({
    title: 'Yeni müşteri',
    fields: [
      { name: 'name', label: 'Ad soyad', required: true, autofocus: true },
      { name: 'phone', label: 'Telefon', type: 'tel' },
      { name: 'birthday', label: 'Doğum tarihi', type: 'date', hint: 'Doğum günü kutlaması için' },
      { name: 'sizes_note', label: 'Beden bilgisi', placeholder: 'Örn: Üst M, alt 38' },
    ],
    onSubmit: async (v) => {
      const r = await api.post('/customers', v);
      cart.customer = { id: r.id, ...v, balance: 0 };
      toast('Müşteri kaydedildi', 'ok');
      paint();
      return true;
    },
  });
}

// --- İade / değişim ---
async function returnDialog(initialNo) {
  const body = h('div', { class: 'stack' });
  const result = h('div');
  const noInput = h('input', { placeholder: 'Fiş numarası (örn: S000123 veya 123)', value: typeof initialNo === 'string' ? initialNo : '', class: 'big' });
  const bcInput = h('input', { placeholder: 'Ürün barkodunu okutun', class: 'big' });
  let mode = 'fis';
  const modeBtns = h('div', { class: 'btn-group' });
  const paintMode = () => {
    mount(modeBtns,
      h('button', { class: `btn sm ${mode === 'fis' ? 'on' : ''}`, onclick: () => { mode = 'fis'; paintMode(); } }, 'Fiş numarası ile'),
      h('button', { class: `btn sm ${mode === 'barkod' ? 'on' : ''}`, onclick: () => { mode = 'barkod'; paintMode(); } }, 'Fişsiz (barkod ile)'),
      cart.customer ? h('button', { class: `btn sm ${mode === 'musteri' ? 'on' : ''}`, onclick: () => { mode = 'musteri'; paintMode(); findByCustomer(); } }, 'Müşterinin alışverişleri') : null);
    noInput.parentElement?.classList.toggle('hidden', mode !== 'fis');
    bcInput.parentElement?.classList.toggle('hidden', mode !== 'barkod');
    (mode === 'fis' ? noInput : bcInput).focus();
    if (mode !== 'musteri') result.replaceChildren();
  };
  const showItems = (items, header) => {
    const rows = items.filter((i) => i.qty > 0 && !i.return_of);
    if (!rows.length) { mount(result, empty('İade edilebilir ürün bulunamadı')); return; }
    const inCart = (id) => cart.returns.find((r) => r.item.id === id)?.qty || 0;
    mount(result, header, h('div', { class: 'list' }, rows.map((i) => {
      const remaining = i.qty - i.returned_qty - inCart(i.id);
      const qSel = h('input', { type: 'number', min: 1, max: Math.max(1, remaining), value: 1, style: { width: '70px' }, disabled: remaining <= 0 });
      return h('div', { class: 'li' },
        h('div', { class: 'grow' }, h('b', null, i.name), h('div', { class: 'small muted' }, [i.size, i.color].filter(Boolean).join(' / '), ` · ${i.qty} adet × ${tl(i.unit_price)} · ödenen ${tl(i.total)}`, i.no ? ` · Fiş ${i.no} (${fdate(i.sale_date)})` : ''),
          i.returned_qty ? h('div', { class: 'tiny neg' }, `${i.returned_qty} adedi daha önce iade edildi`) : null),
        remaining > 0 ? [qSel, h('button', { class: 'btn sm primary', onclick: () => addReturn(i, Number(qSel.value)) }, 'İade al')] : badge('İade edildi', 'bad'));
    })));
  };
  let lastSale = null;
  const addReturn = (i, q) => {
    const item = { ...i };
    const remaining = item.qty - item.returned_qty;
    const already = cart.returns.find((r) => r.item.id === item.id);
    const nq = (already?.qty || 0) + q;
    if (!(q >= 1) || nq > remaining) return toast('İade adedi, kalan adetten fazla olamaz', 'err');
    if (already) { already.qty = nq; already.amount = retAmount(already.item, nq); }
    else cart.returns.push({ item, qty: q, amount: retAmount(item, q), saleNo: item.no || lastSale?.no, saleDate: item.sale_date || lastSale?.created_at });
    if (!cart.customer && lastSale?.customer) cart.customer = lastSale.customer;
    toast('İade sepete eklendi. Değişim için yeni ürünü okutun.', 'ok');
    m.close();
    paint();
  };
  const findByNo = () => run(async () => {
    const s = await api.get('/sales/find', { no: noInput.value.trim() });
    if (!s) { mount(result, empty('Fiş bulunamadı', 'Numarayı kontrol edin.')); return; }
    lastSale = s;
    s.items.forEach((it) => { it.no = s.no; it.sale_date = s.created_at; });
    const old = s.store?.return_days ? s.created_at.slice(0, 10) < addDays(today(), -s.store.return_days) : false;
    showItems(s.items, h('div', { class: 'stack', style: { gap: '8px', marginBottom: '8px' } },
      h('div', { class: 'row between' }, h('b', null, `Fiş ${s.no}`), h('span', { class: 'muted' }, `${fdt(s.created_at)} · ${s.customer?.name || 'Perakende'} · ${tl(s.total)}`)),
      old ? h('div', { class: 'alert warn' }, icon('alert'), h('div', { class: 't-body' }, `Bu fiş ${s.store.return_days} günlük iade süresini geçmiş.${isManager() ? ' Yönetici olarak yine de iade alabilirsiniz.' : ' İade için yönetici onayı gerekir.'}`)) : null));
  });
  const findByBarcode = () => run(async () => {
    const rows = await api.get('/sales/returnable', { barcode: bcInput.value.trim() });
    lastSale = null;
    showItems(rows, h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Bu barkodla yapılmış satışlar (en yeni üstte). Müşterinin ödediği tutar kadar iade yapılır.'));
  });
  const findByCustomer = () => run(async () => {
    const rows = await api.get('/sales/returnable', { customer_id: cart.customer.id });
    lastSale = null;
    showItems(rows, h('div', { class: 'muted small', style: { marginBottom: '6px' } }, `${cart.customer.name} — iade edilebilir alışverişler`));
  });
  noInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') findByNo(); });
  bcInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') findByBarcode(); });
  body.append(modeBtns,
    h('div', { class: 'input-group' }, noInput, h('button', { class: 'btn primary', onclick: findByNo }, 'Bul')),
    h('div', { class: 'input-group hidden' }, bcInput, h('button', { class: 'btn primary', onclick: findByBarcode }, 'Bul')),
    result);
  const m = modal({ title: 'İade / Değişim', body, size: 'wide' });
  paintMode();
  if (initialNo && typeof initialNo === 'string') findByNo();
}

// --- Sipariş teslimi ---
async function loadOrder(id) {
  const o = await api.get(`/orders/${id}`).catch((e) => { toast(e.message, 'err'); return null; });
  if (!o) return;
  if (['delivered', 'cancelled'].includes(o.status)) { toast('Bu sipariş kapanmış', 'err'); return; }
  resetCart();
  cart.staffId = o.staff_id || state.user.staff_id || '';
  cart.order = o;
  if (o.customer_id) cart.customer = await api.get(`/customers/${o.customer_id}`).catch(() => null);
  const ids = o.items.filter((i) => i.variant_id).map((i) => i.variant_id);
  const vs = ids.length ? await api.get('/variants/by-ids', { ids: ids.join(',') }) : [];
  for (const it of o.items) {
    const v = vs.find((x) => x.id === it.variant_id);
    if (v) cart.lines.push({ key: lineSeq++, variant: v, name: v.name, qty: it.qty, unit_price: it.unit_price, list_price: v.list_price, discount: 0 });
    else cart.lines.push({ key: lineSeq++, variant: null, name: it.description, size: it.size, color: it.color, qty: it.qty, unit_price: it.unit_price, list_price: it.unit_price, discount: 0 });
  }
  history.replaceState(null, '', '#/kasa');
}

// --- Ödeme ---
function buildPayload(payments) {
  const t = totals();
  return {
    items: cart.lines.map((l) => (l.variant
      ? { variant_id: l.variant.id, qty: l.qty, unit_price: l.unit_price, discount: l.discount }
      : { name: l.name, size: l.size, color: l.color, qty: l.qty, unit_price: l.unit_price, discount: l.discount })),
    returns: cart.returns.map((r) => ({ sale_item_id: r.item.id, qty: r.qty })),
    cart_discount: t.cartDisc,
    customer_id: cart.customer?.id,
    staff_id: cart.staffId || undefined,
    order_id: cart.order?.id,
    note: cart.note || undefined,
    due_date: cart.dueDate || undefined,
    payments: [...(t.deposit ? [{ method: 'deposit', amount: t.deposit }] : []), ...payments],
  };
}

async function submit(payments, { btn, extra = {}, change = 0, dialog } = {}) {
  const payload = { ...buildPayload(payments), ...extra };
  const r = await run(() => api.post('/sales', payload), btn);
  if (!r) return false;
  dialog?.close();
  const snapshotCustomer = cart.customer;
  resetCart();
  cart.staffId = state.user.staff_id || '';
  paint();
  done({ ...r, change }, snapshotCustomer);
  return true;
}

function done(r, customer) {
  const change = r.change;
  const m = modal({
    title: r.total < 0 ? 'İade tamamlandı' : 'Satış tamamlandı',
    body: h('div', { class: 'stack center' },
      h('div', { style: { fontSize: '44px', color: 'var(--ok)' } }, icon('check', { sw: 2.5 })),
      h('div', null, h('b', { style: { fontSize: '26px' } }, tl(Math.abs(r.total))), h('div', { class: 'muted' }, `Fiş no: ${r.no}`)),
      change ? h('div', { class: 'alert ok', style: { justifyContent: 'center', fontSize: '18px' } }, h('span', { class: 't-body' }, 'Para üstü: ', h('b', null, tl(change)))) : null),
    footer: [
      customer?.phone ? h('a', { class: 'btn', target: '_blank', rel: 'noopener', href: waLink(customer.phone, `Merhaba ${customer.name}, ${state.user.store.name} alışverişiniz için teşekkür ederiz. Fiş no: ${r.no}, tutar: ${tl(r.total)}.`) }, icon('message'), 'WhatsApp') : null,
      h('button', { class: 'btn', onclick: () => printReceipt(r.id) }, icon('print'), 'Fiş yazdır'),
      h('button', { class: 'btn primary', autofocus: true, onclick: () => m.close() }, 'Yeni satış (Enter)')],
    onClose: () => els.scanInput?.focus(),
  });
  m.box.querySelector('.btn.primary')?.focus();
}

async function checkout(method) {
  if (cartEmpty()) return;
  const t = totals();
  if (method === 'refund' || t.due < 0) return refundDialog(t);
  if (method === 'even' || t.due === 0) {
    if (await confirmBox('Değişim tutarları eşit. İşlem tamamlansın mı?', { ok: 'Tamamla' })) submit([]);
    return;
  }
  if (method === 'credit' && !cart.customer) { toast('Veresiye için önce müşteri seçin', 'err'); return; }
  if (method === 'cash') return cashDialog(t);
  if (method === 'split') return splitDialog(t);
  if (method === 'credit') return creditDialog(t);
  const ok = await confirmBox(h('span', null, `${METHOD[method]} ile `, h('b', null, tl(t.due)), ' tahsil edildi mi?'), { title: 'Ödeme onayı', ok: 'Evet, tamamla' });
  if (ok) submit([{ method, amount: t.due }]);
}

function cashDialog(t) {
  const input = h('input', { class: 'money-in big', inputmode: 'decimal', placeholder: toInput(t.due), autofocus: true });
  const changeEl = h('div', { class: 'alert', style: { fontSize: '18px', justifyContent: 'space-between' } });
  const upd = () => {
    const got = input.value ? parseTL(input.value) : t.due;
    const ch = got - t.due;
    changeEl.className = `alert ${Number.isNaN(got) || ch < 0 ? 'bad' : 'ok'}`;
    mount(changeEl, h('span', { class: 't-body' }, ch < 0 ? 'Eksik' : 'Para üstü'), h('b', { class: 'num t-body' }, Number.isNaN(got) ? '—' : tl(Math.abs(ch))));
  };
  input.addEventListener('input', upd);
  const suggestions = [...new Set([t.due, ...[5000, 10000, 20000, 50000, 100000, 200000].map((b) => Math.ceil(t.due / b) * b)])].filter((x) => x >= t.due).sort((a, b) => a - b).slice(0, 6);
  const btn = h('button', { class: 'btn primary lg' }, icon('check'), 'Satışı tamamla');
  const go = async () => {
    const got = input.value ? parseTL(input.value) : t.due;
    if (Number.isNaN(got) || got < t.due) return toast('Alınan tutar, ödenecek tutardan az olamaz. Eksikse parçalı ödeme kullanın.', 'err');
    await submit([{ method: 'cash', amount: t.due }], { btn, change: got - t.due, dialog: m });
  };
  btn.onclick = go;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const m = modal({
    title: `Nakit ödeme — ${tl(t.due)}`,
    body: h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', null, 'Müşteriden alınan'), input),
      h('div', { class: 'quick-cash' }, suggestions.map((s) => h('button', { class: 'btn', onclick: () => { input.value = toInput(s); upd(); input.focus(); } }, tl(s)))),
      changeEl),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Vazgeç'), btn],
  });
  upd();
}

function splitDialog(t) {
  const methods = ['cash', 'card', 'transfer', ...(cart.customer ? ['credit'] : [])];
  const inputs = Object.fromEntries(methods.map((mt) => [mt, h('input', { class: 'money-in', inputmode: 'decimal', placeholder: '0' })]));
  const rest = h('div', { class: 'alert' });
  const read = () => Object.fromEntries(methods.map((mt) => [mt, inputs[mt].value ? parseTL(inputs[mt].value) : 0]));
  const upd = () => {
    const v = read();
    const sum = Object.values(v).reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);
    const left = t.due - sum;
    rest.className = `alert ${left === 0 ? 'ok' : left < 0 ? 'bad' : 'warn'}`;
    mount(rest, h('span', { class: 't-body grow' }, left === 0 ? 'Tutar tamam' : left > 0 ? 'Kalan' : 'Fazla girildi'), h('b', { class: 'num t-body' }, tl(Math.abs(left))));
  };
  Object.values(inputs).forEach((i) => i.addEventListener('input', upd));
  const fill = (mt) => { inputs[mt].value = ''; const v = read(); const sum = Object.values(v).reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0); inputs[mt].value = toInput(Math.max(0, t.due - sum)); upd(); };
  const btn = h('button', { class: 'btn primary' }, 'Satışı tamamla');
  btn.onclick = async () => {
    const v = read();
    if (Object.values(v).some((x) => Number.isNaN(x) || x < 0)) return toast('Tutarları kontrol edin', 'err');
    const sum = Object.values(v).reduce((a, b) => a + b, 0);
    if (sum !== t.due) return toast(`Ödemeler toplamı ${tl(t.due)} olmalı`, 'err');
    await submit(methods.filter((mt) => v[mt] > 0).map((mt) => ({ method: mt, amount: v[mt] })), { btn, dialog: m });
  };
  const m = modal({
    title: `Parçalı ödeme — ${tl(t.due)}`,
    body: h('div', { class: 'stack' }, methods.map((mt) => h('div', { class: 'row' }, h('label', { style: { width: '110px', fontWeight: 600 } }, METHOD[mt]), inputs[mt], h('button', { class: 'btn sm', onclick: () => fill(mt) }, 'Kalanı yaz'))), rest),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Vazgeç'), btn],
  });
  upd();
}

function creditDialog(t) {
  const c = cart.customer;
  const due = h('input', { type: 'date' });
  const newBal = (c.balance || 0) + t.due;
  const over = c.credit_limit && newBal > c.credit_limit;
  const force = h('input', { type: 'checkbox' });
  const btn = h('button', { class: 'btn primary' }, 'Veresiye yaz');
  btn.onclick = async () => {
    cart.dueDate = due.value;
    await submit([{ method: 'credit', amount: t.due }], { btn, extra: over && force.checked ? { force_credit: true } : {}, dialog: m });
  };
  const m = modal({
    title: 'Veresiye satış',
    body: h('div', { class: 'stack' },
      h('div', null, h('b', null, c.name), ' hesabına ', h('b', null, tl(t.due)), ' borç yazılacak.'),
      h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Mevcut borç'), h('b', { class: 'num' }, tl(c.balance || 0))),
      h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Yeni borç'), h('b', { class: 'num neg' }, tl(newBal))),
      over ? h('div', { class: 'alert warn' }, icon('alert'), h('div', { class: 't-body' }, `Veresiye limiti (${tl(c.credit_limit)}) aşılıyor.`, isManager() ? h('label', { class: 'check', style: { marginTop: '6px' } }, force, 'Limiti aşmaya izin ver') : ' Yönetici onayı gerekir.')) : null,
      h('div', { class: 'field' }, h('label', null, 'Ödeme sözü tarihi (isteğe bağlı)'), due)),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Vazgeç'), btn],
  });
}

function refundDialog(t) {
  const amount = -t.due;
  const opts = [['cash', 'cash', 'Nakit iade'], ['card', 'card', 'Karta iade'], ['transfer', 'bank', 'Havale ile iade']];
  if (cart.customer) opts.push(['credit', 'book', 'Borcundan düş / hesaba alacak yaz']);
  const m = modal({
    title: `Müşteriye iade: ${tl(amount)}`,
    body: h('div', { class: 'stack' },
      h('div', { class: 'muted' }, 'İade tutarını müşteriye nasıl ödüyorsunuz?'),
      h('div', { class: 'pay-methods' }, opts.map(([mt, ico, label]) => h('button', { class: 'pay-btn', onclick: async (e) => {
        await submit([{ method: mt, amount: -amount }], { btn: e.currentTarget, dialog: m });
      } }, icon(ico), label)))),
  });
}
