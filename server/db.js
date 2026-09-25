// Veritabanı katmanı: Node.js'in yerleşik SQLite motoru (node:sqlite) kullanılır.
// Tüm para alanları KURUŞ cinsinden tam sayı (INTEGER) olarak saklanır; yuvarlama hatası olmaz.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

let db = null;
let depth = 0;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT, email TEXT, address TEXT, city TEXT,
  tax_office TEXT, tax_no TEXT,
  receipt_footer TEXT DEFAULT 'Bizi tercih ettiğiniz için teşekkür ederiz. Değişim süresi fiş tarihinden itibaren 14 gündür.',
  return_days INTEGER DEFAULT 14,
  default_vat INTEGER DEFAULT 10,
  timezone TEXT DEFAULT 'Europe/Istanbul',
  low_stock_default INTEGER DEFAULT 2,
  dead_stock_days INTEGER DEFAULT 90,
  allow_negative_stock INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  staff_id INTEGER,
  active INTEGER DEFAULT 1,
  last_login TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, name)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS size_sets (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sizes TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  contact TEXT, phone TEXT, email TEXT, address TEXT,
  tax_office TEXT, tax_no TEXT, iban TEXT, notes TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  category_id INTEGER,
  brand TEXT, supplier_id INTEGER, season TEXT, gender TEXT, material TEXT, description TEXT,
  buy_price INTEGER NOT NULL DEFAULT 0,
  sale_price INTEGER NOT NULL DEFAULT 0,
  discount_price INTEGER,
  vat_rate INTEGER NOT NULL DEFAULT 10,
  active INTEGER DEFAULT 1,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_products_store ON products(store_id, active);

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  size TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  sale_price INTEGER,
  sort INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  UNIQUE (store_id, barcode)
);
CREATE INDEX IF NOT EXISTS ix_variants_product ON variants(product_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  balance_after INTEGER,
  type TEXT NOT NULL,
  ref_type TEXT, ref_id INTEGER,
  note TEXT,
  user_id INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_moves_variant ON stock_movements(variant_id, id);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT, email TEXT, birthday TEXT, gender TEXT, city TEXT, address TEXT,
  tax_no TEXT, sizes_note TEXT, notes TEXT,
  credit_limit INTEGER,
  active INTEGER DEFAULT 1,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_customers_store ON customers(store_id);

CREATE TABLE IF NOT EXISTS customer_ledger (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  ref_type TEXT, ref_id INTEGER,
  method TEXT, due_date TEXT, note TEXT,
  user_id INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_cledger ON customer_ledger(customer_id);

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  ref_type TEXT, ref_id INTEGER,
  method TEXT, due_date TEXT, note TEXT,
  user_id INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_sledger ON supplier_ledger(supplier_id);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT, email TEXT, position TEXT, tc_no TEXT, iban TEXT,
  start_date TEXT, end_date TEXT,
  salary INTEGER DEFAULT 0,
  commission_rate REAL DEFAULT 0,
  notes TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  no TEXT NOT NULL,
  customer_id INTEGER, staff_id INTEGER, user_id INTEGER, order_id INTEGER,
  subtotal INTEGER NOT NULL DEFAULT 0,
  line_discount INTEGER NOT NULL DEFAULT 0,
  cart_discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  has_return INTEGER DEFAULT 0,
  note TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_sales_store_date ON sales(store_id, created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  variant_id INTEGER, product_id INTEGER,
  name TEXT, size TEXT, color TEXT, barcode TEXT,
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  cart_discount_share INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  vat_rate INTEGER DEFAULT 10,
  returned_qty INTEGER NOT NULL DEFAULT 0,
  return_of INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_sitems_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS ix_sitems_store_date ON sale_items(store_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  sale_id INTEGER NOT NULL,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_payments_store_date ON payments(store_id, created_at);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  date TEXT NOT NULL,
  description TEXT,
  pl INTEGER NOT NULL DEFAULT 1,
  ref_type TEXT, ref_id INTEGER,
  staff_id INTEGER, supplier_id INTEGER, customer_id INTEGER,
  user_id INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_tx_store_date ON transactions(store_id, date);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  supplier_id INTEGER,
  invoice_no TEXT,
  date TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  user_id INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  variant_id INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  no TEXT NOT NULL,
  customer_id INTEGER,
  customer_name TEXT, phone TEXT,
  staff_id INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  due_date TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  deposit INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  sale_id INTEGER,
  user_id INTEGER,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  variant_id INTEGER,
  description TEXT NOT NULL,
  size TEXT, color TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER DEFAULT 0,
  done_at TEXT,
  user_id INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS day_closings (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  expected_cash INTEGER NOT NULL,
  counted_cash INTEGER NOT NULL,
  diff INTEGER NOT NULL,
  cash_in INTEGER, cash_out INTEGER, card_total INTEGER, transfer_total INTEGER, sales_total INTEGER, sales_count INTEGER,
  last_payment_id INTEGER NOT NULL DEFAULT 0, last_tx_id INTEGER NOT NULL DEFAULT 0, last_sale_id INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  user_id INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_activity_store ON activity(store_id, id);
`;

export function initDb(file) {
  if (db) db.close();
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!db) throw new Error('Veritabanı başlatılmadı');
  return db;
}

export const q = {
  get: (sql, ...p) => getDb().prepare(sql).get(...p),
  all: (sql, ...p) => getDb().prepare(sql).all(...p),
  run: (sql, ...p) => getDb().prepare(sql).run(...p),
  val: (sql, ...p) => {
    const row = getDb().prepare(sql).get(...p);
    return row ? Object.values(row)[0] : undefined;
  },
};

/** İç içe çağrılabilen, hata olursa tamamen geri alınan işlem (transaction). */
export function tx(fn) {
  const sp = `sp${depth++}`;
  getDb().exec(`SAVEPOINT ${sp}`);
  try {
    const r = fn();
    getDb().exec(`RELEASE ${sp}`);
    return r;
  } catch (e) {
    getDb().exec(`ROLLBACK TO ${sp}`);
    getDb().exec(`RELEASE ${sp}`);
    throw e;
  } finally {
    depth--;
  }
}

export function insert(table, obj) {
  const keys = Object.keys(obj);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const r = getDb().prepare(sql).run(...keys.map((k) => obj[k] ?? null));
  return Number(r.lastInsertRowid);
}

export function update(table, id, storeId, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND store_id = ?`;
  getDb().prepare(sql).run(...keys.map((k) => obj[k] ?? null), id, storeId);
}

export function nextCounter(storeId, name) {
  q.run('INSERT INTO counters (store_id, name, value) VALUES (?, ?, 0) ON CONFLICT DO NOTHING', storeId, name);
  q.run('UPDATE counters SET value = value + 1 WHERE store_id = ? AND name = ?', storeId, name);
  return q.val('SELECT value FROM counters WHERE store_id = ? AND name = ?', storeId, name);
}
