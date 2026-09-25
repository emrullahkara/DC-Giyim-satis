// Raporlar: satış, stok, kâr analizi
import { h, api, tl, state, toast, isManager } from '../core.js';
import { icon } from '../icons.js';
import { empty, card, table, badge, dateRange, barChart } from '../components.js';

export default async function Reports(root, { params, query }) {
  const tab = query.tab || 'sales';
  return renderReportsPage(root, tab, query);
}

async function renderReportsPage(root, tab, query) {
  const { mount } = await import('../core.js');

  const view = h('div', { class: 'list-view' },
    h('div', { class: 'toolbar' },
      h('h2', null, 'Raporlar'),
      h('div', { class: 'btn-group' },
        h('a', { class: `btn sm ${tab === 'sales' ? 'active' : ''}`, href: '#/raporlar?tab=sales' }, 'Satış Analizi'),
        h('a', { class: `btn sm ${tab === 'stock' ? 'active' : ''}`, href: '#/raporlar?tab=stock' }, 'Stok Analizi'),
        isManager() ? h('a', { class: `btn sm ${tab === 'profit' ? 'active' : ''}`, href: '#/raporlar?tab=profit' }, 'Kâr Analizi') : null
      )));

  if (tab === 'sales') {
    await showSalesReport(view, query);
  } else if (tab === 'stock') {
    await showStockReport(view, query);
  } else if (tab === 'profit') {
    await showProfitReport(view, query);
  }

  mount(root, view);
}

async function showSalesReport(view, query) {
  const { from, to } = dateRange(query, { defDays: 90 });
  let report = null;
  try {
    report = await api.get('/reports/sales', { from, to });
  } catch (e) {
    toast(e.message, 'bad');
    return;
  }

  const filterbar = h('div', { class: 'toolbar-actions' },
    h('div', { class: 'btn-group' },
      h('a', { class: 'btn sm', href: '#/raporlar?tab=sales' }, 'Tümü'),
      h('a', { class: 'btn sm', href: `#/raporlar?tab=sales&from=${from}&to=${to}`, style: { whiteSpace: 'nowrap' } }, `${from} → ${to}`)));
  view.appendChild(filterbar);

  if (!report) {
    view.appendChild(empty('Satış bulunamadı'));
    return;
  }

  // Summary cards
  const summary = card(
    h('div', { class: 'row wrap' },
      h('div', null, h('div', { class: 'tiny faint' }, 'Toplam Satış'), h('b', null, report.total_sales ? tl(report.total_sales) : '0')),
      h('div', null, h('div', { class: 'tiny faint' }, 'Satış Sayısı'), h('b', null, report.sale_count || 0)),
      h('div', null, h('div', { class: 'tiny faint' }, 'Ortalama Fiş'), h('b', null, tl((report.total_sales || 0) / (report.sale_count || 1)))),
      h('div', null, h('div', { class: 'tiny faint' }, 'İadeler'), h('b', { class: 'bad' }, tl(report.return_amount || 0)))
    ));
  view.appendChild(summary);

  // Category breakdown
  if (report.by_category && report.by_category.length > 0) {
    view.appendChild(h('h3', null, 'Kategori Analizi'));
    const cols = [
      { key: 'category', label: 'Kategori', render: (r) => r.category },
      { key: 'sales', label: 'Satış', align: 'right', render: (r) => tl(r.sales) },
      { key: 'count', label: 'Adet', align: 'right', render: (r) => r.count },
      { key: 'avg', label: 'Ortalama', align: 'right', render: (r) => tl(r.sales / r.count) },
    ];
    view.appendChild(table({ cols, rows: report.by_category }));
  }

  // Top products
  if (report.top_products && report.top_products.length > 0) {
    view.appendChild(h('h3', null, 'En Çok Satan Ürünler'));
    const cols = [
      { key: 'name', label: 'Ürün', render: (r) => r.name },
      { key: 'sales', label: 'Satış', align: 'right', render: (r) => tl(r.sales) },
      { key: 'count', label: 'Adet', align: 'right', render: (r) => r.count },
    ];
    view.appendChild(table({ cols, rows: report.top_products }));
  }

  // Hourly breakdown
  if (report.by_hour && report.by_hour.length > 0) {
    view.appendChild(h('h3', null, 'Saatlik Satışlar'));
    const chart = barChart(
      report.by_hour.map((r) => ({ label: `${r.hour}:00`, value: r.sales })),
      { yMin: 0 }
    );
    view.appendChild(chart);
  }
}

async function showStockReport(view, query) {
  let report = null;
  try {
    report = await api.get('/reports/stock');
  } catch (e) {
    toast(e.message, 'bad');
    return;
  }

  if (!report) {
    view.appendChild(empty('Stok verileri bulunamadı'));
    return;
  }

  // Summary
  const summary = card(
    h('div', { class: 'row wrap' },
      h('div', null, h('div', { class: 'tiny faint' }, 'Toplam Stok Değeri'), h('b', null, tl(report.total_value || 0))),
      h('div', null, h('div', { class: 'tiny faint' }, 'Toplam Varyant'), h('b', null, report.total_variants || 0)),
      h('div', null, h('div', { class: 'tiny faint' }, 'Negatif Stok'), h('b', { class: 'bad' }, report.negative_count || 0)),
      h('div', null, h('div', { class: 'tiny faint' }, 'Kritik Stok'), h('b', { class: 'warn' }, report.critical_count || 0))
    ));
  view.appendChild(summary);

  // Dead stock (slow movers)
  if (report.dead_stock && report.dead_stock.length > 0) {
    view.appendChild(h('h3', null, 'Hareketli Olmayan Stok (90+ gün)'));
    const cols = [
      { key: 'name', label: 'Ürün', render: (r) => r.name },
      { key: 'size', label: 'Beden', render: (r) => r.size || '-' },
      { key: 'color', label: 'Renk', render: (r) => r.color || '-' },
      { key: 'stock', label: 'Stok', align: 'right', render: (r) => r.stock },
      { key: 'last_sold', label: 'Son Satış', render: (r) => r.last_sold || 'Asla' },
    ];
    view.appendChild(table({ cols, rows: report.dead_stock.slice(0, 20) }));
  }

  // Negative stock
  if (report.negative_stock && report.negative_stock.length > 0) {
    view.appendChild(h('h3', null, 'Negatif Stok'));
    const cols = [
      { key: 'name', label: 'Ürün', render: (r) => r.name },
      { key: 'stock', label: 'Stok', align: 'right', render: (r) => h('span', { class: 'bad' }, r.stock) },
    ];
    view.appendChild(table({ cols, rows: report.negative_stock }));
  }

  // Critical stock
  if (report.critical_stock && report.critical_stock.length > 0) {
    view.appendChild(h('h3', null, 'Kritik Stok (< 5 adet)'));
    const cols = [
      { key: 'name', label: 'Ürün', render: (r) => r.name },
      { key: 'stock', label: 'Stok', align: 'right', render: (r) => badge(r.stock, 'warn') },
    ];
    view.appendChild(table({ cols, rows: report.critical_stock }));
  }
}

async function showProfitReport(view, query) {
  const { from, to } = dateRange(query, { defDays: 90 });
  let report = null;
  try {
    report = await api.get('/reports/profit', { from, to });
  } catch (e) {
    toast(e.message, 'bad');
    return;
  }

  const filterbar = h('div', { class: 'toolbar-actions' },
    h('div', { class: 'btn-group' },
      h('a', { class: 'btn sm', href: '#/raporlar?tab=profit' }, 'Tümü'),
      h('a', { class: 'btn sm', href: `#/raporlar?tab=profit&from=${from}&to=${to}`, style: { whiteSpace: 'nowrap' } }, `${from} → ${to}`)));
  view.appendChild(filterbar);

  if (!report) {
    view.appendChild(empty('Kâr verileri bulunamadı'));
    return;
  }

  // P&L summary
  const summary = card(
    h('div', { class: 'row wrap' },
      h('div', null, h('div', { class: 'tiny faint' }, 'Satışlar'), h('b', null, tl(report.total_revenue || 0))),
      h('div', null, h('div', { class: 'tiny faint' }, 'Maliyet'), h('b', null, tl(report.total_cost || 0))),
      h('div', null, h('div', { class: 'tiny faint' }, 'Brüt Kâr'), h('b', { class: 'ok' }, tl((report.total_revenue || 0) - (report.total_cost || 0)))),
      h('div', null, h('div', { class: 'tiny faint' }, 'Kâr %'), h('b', null, ((report.total_revenue || 0) > 0 ? (100 * ((report.total_revenue - report.total_cost) / report.total_revenue)).toFixed(1) : 0) + '%'))
    ));
  view.appendChild(summary);

  // Monthly breakdown
  if (report.by_month && report.by_month.length > 0) {
    view.appendChild(h('h3', null, 'Aylık Kâr Trendi'));
    const cols = [
      { key: 'month', label: 'Ay', render: (r) => r.month },
      { key: 'revenue', label: 'Satışlar', align: 'right', render: (r) => tl(r.revenue) },
      { key: 'cost', label: 'Maliyet', align: 'right', render: (r) => tl(r.cost) },
      { key: 'profit', label: 'Kâr', align: 'right', render: (r) => h('span', { class: r.profit >= 0 ? 'ok' : 'bad' }, tl(r.profit)) },
    ];
    view.appendChild(table({ cols, rows: report.by_month }));

    const chart = barChart(
      report.by_month.map((r) => ({ label: r.month.slice(5), value: r.profit })),
      { yMin: 0 }
    );
    view.appendChild(chart);
  }

  // Category profitability
  if (report.by_category && report.by_category.length > 0) {
    view.appendChild(h('h3', null, 'Kategori Kârlılığı'));
    const cols = [
      { key: 'category', label: 'Kategori', render: (r) => r.category },
      { key: 'revenue', label: 'Satışlar', align: 'right', render: (r) => tl(r.revenue) },
      { key: 'cost', label: 'Maliyet', align: 'right', render: (r) => tl(r.cost) },
      { key: 'profit', label: 'Kâr', align: 'right', render: (r) => h('span', { class: r.profit >= 0 ? 'ok' : 'bad' }, tl(r.profit)) },
      { key: 'margin', label: 'Marj %', align: 'right', render: (r) => (r.revenue > 0 ? (100 * (r.profit / r.revenue)).toFixed(1) : 0) + '%' },
    ];
    view.appendChild(table({ cols, rows: report.by_category }));
  }
}
