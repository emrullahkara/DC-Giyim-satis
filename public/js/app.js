// Uygulama kabuğu: giriş ekranı, menü, yönlendirme, genel arama
import { h, mount, api, state, toast, run, tl, initials, ROLE, isManager, modal, formModal } from './core.js';
import { icon } from './icons.js';
import { picker } from './components.js';

const NAV = [
  { sec: 'Günlük' },
  { path: 'panel', label: 'Genel Bakış', ico: 'home' },
  { path: 'kasa', label: 'Kasa (Satış)', ico: 'pos', key: 'F2' },
  { path: 'satislar', label: 'Satışlar & İadeler', ico: 'receipt' },
  { path: 'siparisler', label: 'Siparişler', ico: 'clipboard' },
  { path: 'musteriler', label: 'Müşteriler', ico: 'users' },
  { sec: 'Ürün & Stok' },
  { path: 'urunler', label: 'Ürünler', ico: 'tag' },
  { path: 'stok', label: 'Stok & Mal Kabul', ico: 'box', mgr: true },
  { path: 'tedarikciler', label: 'Tedarikçiler', ico: 'factory', mgr: true },
  { sec: 'Yönetim', mgr: true },
  { path: 'personel', label: 'Personel', ico: 'badge', mgr: true },
  { path: 'finans', label: 'Gelir-Gider & Kasa', ico: 'wallet', mgr: true },
  { path: 'raporlar', label: 'Raporlar', ico: 'chart', mgr: true },
  { path: 'ayarlar', label: 'Ayarlar', ico: 'settings' },
];

const PAGES = {
  panel: () => import('./pages/dashboard.js'),
  kasa: () => import('./pages/pos.js'),
  satislar: () => import('./pages/sales.js'),
  urunler: () => import('./pages/products.js'),
  stok: () => import('./pages/stock.js'),
  siparisler: () => import('./pages/orders.js'),
  musteriler: () => import('./pages/customers.js'),
  tedarikciler: () => import('./pages/suppliers.js'),
  personel: () => import('./pages/staff.js'),
  finans: () => import('./pages/finance.js'),
  raporlar: () => import('./pages/reports.js'),
  ayarlar: () => import('./pages/settings.js'),
};

let cleanup = null;
let shellEl = null;
let pageEl = null;
let navEl = null;
let routeSeq = 0;

export function go(path) {
  location.hash = `#/${path}`;
}

function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [pathPart, qs = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  return { page: parts[0] || 'panel', params: parts.slice(1), query: Object.fromEntries(new URLSearchParams(qs)) };
}

async function route() {
  const { page, params, query } = parseHash();
  if (!state.user) {
    if (page !== 'kayit') return renderAuth(false);
    return renderAuth(true);
  }
  if (page === 'giris' || page === 'kayit') return go('panel');
  if (!shellEl) renderShell();
  const nav = NAV.find((n) => n.path === page);
  const loader = PAGES[page];
  if (cleanup) { try { cleanup(); } catch { /* yoksay */ } cleanup = null; }
  navEl.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.path === page));
  shellEl.classList.remove('nav-open');
  if (!loader || (nav?.mgr && !isManager())) {
    mount(pageEl, h('div', { class: 'empty', style: { marginTop: '60px' } }, icon('lock'), h('b', null, loader ? 'Bu sayfa için yetkiniz yok' : 'Sayfa bulunamadı'), h('a', { href: '#/panel' }, 'Genel bakışa dön')));
    return;
  }
  const my = ++routeSeq;
  mount(pageEl, h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  try {
    const mod = await loader();
    if (my !== routeSeq) return;
    const root = h('div', { class: 'page' });
    mount(pageEl, root);
    document.title = `${nav?.label || 'DC Giyim'} · DC Giyim Satış`;
    const c = await mod.default(root, { params, query });
    if (my !== routeSeq) { if (typeof c === 'function') c(); return; }
    cleanup = typeof c === 'function' ? c : null;
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (my === routeSeq) mount(pageEl, h('div', { class: 'page' }, h('div', { class: 'alert bad' }, icon('alert'), h('div', null, h('b', null, 'Sayfa yüklenemedi. '), e.message || ''), h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: route }, 'Tekrar dene'))));
  }
}

// ---------- Giriş / Kayıt ----------
function renderAuth(register) {
  shellEl = null;
  const feats = [
    ['pos', 'Barkodlu hızlı kasa, parçalı ödeme'], ['swap', 'Fişli/fişsiz iade ve değişim'], ['layers', 'Beden × renk stok tablosu'],
    ['book', 'Veresiye defteri ve tahsilat'], ['clipboard', 'Sipariş ve kapora takibi'], ['badge', 'Personel satış primi'],
    ['wallet', 'Gelir-gider, gün sonu kasa'], ['chart', 'Kâr, beden ve ölü stok analizi'],
  ];
  const form = register ? registerForm() : loginForm();
  mount(document.getElementById('app'), h('div', { class: 'auth' },
    h('div', { class: 'auth-hero' },
      h('div', { class: 'brand', style: { padding: 0 } }, h('img', { src: '/img/logo.svg', alt: '' }), h('div', null, h('b', null, 'DC Giyim Satış'), h('small', null, 'Mağaza Yönetim Sistemi'))),
      h('div', null,
        h('h1', null, 'Mağazanızın tüm işi tek ekranda.'),
        h('p', null, 'Butik, abiye, gelinlik, erkek giyim, çocuk… Kasadan stoğa, veresiyeden personel primine kadar her şey kontrolünüzde.'),
        h('div', { class: 'auth-feats' }, feats.map(([i, t]) => h('div', null, icon(i), t)))),
      h('div', { class: 'small', style: { color: '#8b8694' } }, '© DC Giyim Satış')),
    h('div', { class: 'auth-form' }, form)));
}

function loginForm() {
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', autofocus: true, placeholder: 'ornek@magaza.com' });
  const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password', placeholder: '••••••' });
  const btn = h('button', { class: 'btn primary lg', type: 'submit', style: { width: '100%' } }, 'Giriş Yap');
  return h('form', { class: 'auth-box stack', onsubmit: (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post('/auth/login', { email: email.value, password: pw.value });
      state.user = r.user;
      shellEl = null;
      go('panel');
      route();
    }, btn);
  } },
  h('div', null, h('h2', null, 'Hoş geldiniz'), h('div', { class: 'muted' }, 'Mağaza hesabınızla giriş yapın.')),
  h('div', { class: 'field' }, h('label', null, 'E-posta'), email),
  h('div', { class: 'field' }, h('label', null, 'Şifre'), pw),
  btn,
  h('div', { class: 'center muted' }, 'Hesabınız yok mu? ', h('a', { href: '#/kayit' }, 'Ücretsiz mağaza hesabı açın')),
  h('div', { class: 'alert info small' }, icon('info'), h('div', { class: 't-body' }, 'Demo mağaza: ', h('b', null, 'demo@dcgiyim.com'), ' / ', h('b', null, 'demo123'), h('div', { class: 'faint' }, '(npm run seed ile oluşturulur)'))));
}

function registerForm() {
  const f = {
    storeName: h('input', { required: true, autofocus: true, placeholder: 'Örn: Işıl Butik' }),
    name: h('input', { required: true, placeholder: 'Adınız soyadınız' }),
    phone: h('input', { type: 'tel', placeholder: '05xx xxx xx xx' }),
    email: h('input', { type: 'email', required: true, autocomplete: 'username' }),
    password: h('input', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password', placeholder: 'En az 6 karakter' }),
  };
  const btn = h('button', { class: 'btn primary lg', type: 'submit', style: { width: '100%' } }, 'Mağazamı Oluştur');
  return h('form', { class: 'auth-box stack', onsubmit: (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post('/auth/register', Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])));
      state.user = r.user;
      shellEl = null;
      toast('Mağazanız oluşturuldu. Hayırlı işler!', 'ok');
      go('panel');
      route();
    }, btn);
  } },
  h('div', null, h('h2', null, 'Mağaza hesabı açın'), h('div', { class: 'muted' }, '1 dakikada kurulum. Kategoriler ve beden setleri hazır gelir.')),
  h('div', { class: 'field' }, h('label', null, 'Mağaza adı'), f.storeName),
  h('div', { class: 'field' }, h('label', null, 'Ad soyad'), f.name),
  h('div', { class: 'field' }, h('label', null, 'Telefon'), f.phone),
  h('div', { class: 'field' }, h('label', null, 'E-posta'), f.email),
  h('div', { class: 'field' }, h('label', null, 'Şifre'), f.password),
  btn,
  h('div', { class: 'center muted' }, 'Zaten hesabınız var mı? ', h('a', { href: '#/giris' }, 'Giriş yapın')));
}

// ---------- Kabuk ----------
function renderShell() {
  const u = state.user;
  navEl = h('nav', { class: 'nav' }, NAV.filter((n) => !n.mgr || isManager()).map((n) => (n.sec
    ? h('div', { class: 'nav-sec' }, n.sec)
    : h('a', { href: `#/${n.path}`, dataset: { path: n.path } }, icon(n.ico), n.label, n.key ? h('span', { class: 'badge-count' }, n.key) : null))));
  const side = h('aside', { class: 'side' },
    h('a', { class: 'brand', href: '#/panel', style: { textDecoration: 'none' } }, h('img', { src: '/img/logo.svg', alt: '' }), h('div', null, h('b', null, 'DC Giyim Satış'), h('small', null, u.store.name))),
    navEl,
    h('div', { class: 'side-foot' }, h('button', { class: 'user-chip', onclick: userMenu },
      h('span', { class: 'avatar' }, initials(u.name)), h('span', { class: 'grow' }, h('b', { class: 'ellipsis', style: { display: 'block' } }, u.name), h('small', null, ROLE[u.role])))));
  const search = picker({
    placeholder: 'Ürün, barkod, müşteri veya fiş no ara…  ( / )',
    minChars: 2,
    search: globalSearch,
    render: (it) => [h('span', { class: 'li', style: { border: 0, padding: 0 } }, h('span', { class: `ico ${it.cls || ''}` }, icon(it.ico))), h('span', { class: 'grow' }, h('div', { class: 'ellipsis' }, it.title), h('div', { class: 'tiny faint ellipsis' }, it.sub)), it.right ? h('span', { class: 'num small' }, it.right) : null],
    onSelect: (it, input) => { input.value = ''; input.blur(); go(it.go); },
  });
  search.id = 'global-search';
  const main = h('div', { class: 'main' },
    h('header', { class: 'topbar' },
      h('button', { class: 'btn ghost icon menu-btn', 'aria-label': 'Menü', onclick: () => shellEl.classList.toggle('nav-open') }, icon('menu')),
      search,
      h('div', { class: 'top-actions' },
        h('button', { class: 'btn ghost icon', title: 'Tema değiştir', 'aria-label': 'Tema değiştir', onclick: toggleTheme }, icon('moon')),
        h('a', { class: 'btn primary', href: '#/kasa' }, icon('pos'), h('span', { class: 'hide-sm' }, 'Satış Yap')))),
    pageEl = h('main', null));
  shellEl = h('div', { class: 'shell', onclick: (e) => { if (e.target === shellEl) shellEl.classList.remove('nav-open'); } }, side, main);
  mount(document.getElementById('app'), shellEl);
}

async function globalSearch(qv) {
  const [variants, customers, sale] = await Promise.all([
    api.get('/variants/search', { q: qv }).catch(() => []),
    api.get('/customers', { q: qv, limit: 5 }).catch(() => ({ rows: [] })),
    /^s?\d{1,7}$/i.test(qv) ? api.get('/sales/find', { no: qv.replace(/^s/i, '') }).catch(() => null) : null,
  ]);
  const out = [];
  if (sale) out.push({ ico: 'receipt', title: `Fiş ${sale.no}`, sub: `${sale.created_at} · ${sale.customer?.name || 'Perakende'}`, right: tl(sale.total), go: `satislar/${sale.id}`, cls: 'info' });
  const seen = new Set();
  for (const v of variants) {
    if (seen.has(v.product_id)) continue;
    seen.add(v.product_id);
    out.push({ ico: 'tag', title: v.name, sub: [v.code, v.brand, v.category_name].filter(Boolean).join(' · '), right: tl(v.price), go: `urunler/${v.product_id}`, cls: 'brand' });
    if (seen.size >= 6) break;
  }
  for (const c of customers.rows) out.push({ ico: 'users', title: c.name, sub: [c.phone, c.balance > 0 ? `Borç: ${tl(c.balance)}` : null].filter(Boolean).join(' · '), go: `musteriler/${c.id}`, cls: 'ok' });
  return out;
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('dc-tema', next); } catch { /* yoksay */ }
}

function userMenu() {
  const m = modal({
    title: state.user.name,
    body: h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('span', { class: 'avatar lg' }, initials(state.user.name)), h('div', null, h('b', null, state.user.name), h('div', { class: 'muted' }, state.user.email), h('div', { class: 'faint small' }, `${ROLE[state.user.role]} · ${state.user.store.name}`))),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => { m.close(); changePassword(); } }, icon('lock'), 'Şifre değiştir'),
        h('button', { class: 'btn', onclick: () => { m.close(); showShortcuts(); } }, icon('info'), 'Klavye kısayolları'),
        h('button', { class: 'btn danger', onclick: logout }, icon('logout'), 'Çıkış yap'))),
  });
}

function changePassword() {
  formModal({
    title: 'Şifre değiştir',
    fields: [{ name: 'current', label: 'Mevcut şifre', type: 'password', required: true, span: 'span-all' }, { name: 'next', label: 'Yeni şifre', type: 'password', required: true, span: 'span-all', hint: 'En az 6 karakter' }],
    onSubmit: async (v) => { await api.post('/auth/password', v); toast('Şifreniz değiştirildi', 'ok'); return true; },
  });
}

function showShortcuts() {
  const rows = [['F2', 'Kasa ekranını aç'], ['/', 'Genel aramaya odaklan'], ['F4', 'Kasada: ödemeyi al (nakit)'], ['F8', 'Kasada: kartla öde'], ['Esc', 'Pencereyi kapat']];
  modal({ title: 'Klavye kısayolları', body: h('div', { class: 'list' }, rows.map(([k, t]) => h('div', { class: 'li' }, h('span', { class: 'kbd' }, k), t))) });
}

async function logout() {
  await api.post('/auth/logout').catch(() => {});
  state.user = null;
  state.meta = null;
  shellEl = null;
  document.querySelectorAll('.modal-bg').forEach((m) => m.remove());
  go('giris');
}

document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === 'F2') { e.preventDefault(); go('kasa'); }
  else if (e.key === '/' && !typing && !document.querySelector('.modal-bg')) {
    e.preventDefault();
    document.querySelector('#global-search input')?.focus();
  }
});

window.addEventListener('hashchange', route);

(async function boot() {
  try {
    const r = await api.get('/auth/me');
    state.user = r.user;
  } catch { state.user = null; }
  route();
}());
