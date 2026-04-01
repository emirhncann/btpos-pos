import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import * as schema from './schema'

let db: ReturnType<typeof drizzle>
let rawSqlite: Database.Database | null = null

export function getSqlite(): Database.Database {
  if (!rawSqlite) throw new Error('DB henüz başlatılmadı')
  return rawSqlite
}

export function initDB() {
  const dbPath = join(app.getPath('userData'), 'btpos.db')
  const sqlite = new Database(dbPath)
  rawSqlite = sqlite

  sqlite.pragma('journal_mode = WAL')

  db = drizzle(sqlite, { schema })

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS activation (
      id INTEGER PRIMARY KEY,
      terminal_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      device_uid TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      plan_name TEXT,
      expiry_date TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT NOT NULL,
      barcode TEXT,
      price REAL DEFAULT 0,
      vat_rate REAL DEFAULT 18,
      unit TEXT DEFAULT 'Adet',
      stock REAL DEFAULT 0,
      category TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      receipt_no TEXT NOT NULL,
      total_amount REAL NOT NULL,
      discount_rate REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      net_amount REAL NOT NULL,
      payment_type TEXT NOT NULL,
      cash_amount REAL DEFAULT 0,
      card_amount REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      vat_rate REAL DEFAULT 18,
      discount_rate REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      line_total REAL NOT NULL,
      applied_by TEXT,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS cashiers (
      id           TEXT PRIMARY KEY,
      company_id   TEXT NOT NULL DEFAULT '',
      full_name    TEXT NOT NULL,
      cashier_code TEXT NOT NULL,
      password     TEXT NOT NULL,
      role         TEXT DEFAULT 'cashier',
      is_active    INTEGER DEFAULT 1,
      synced_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS products_temp (
      id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL,
      barcode TEXT, price REAL DEFAULT 0, vat_rate REAL DEFAULT 18,
      unit TEXT DEFAULT 'Adet', stock REAL DEFAULT 0,
      category TEXT, synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS plu_groups_temp (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
      workplace_id TEXT, name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#90CAF9',
      sort_order INTEGER DEFAULT 0, synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plu_items_temp (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL,
      product_code TEXT NOT NULL, sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cashiers_temp (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
      full_name TEXT NOT NULL, cashier_code TEXT NOT NULL,
      password TEXT NOT NULL, role TEXT DEFAULT 'cashier',
      is_active INTEGER DEFAULT 1, synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS held_documents (
      id           TEXT PRIMARY KEY,
      company_id   TEXT NOT NULL,
      label        TEXT,
      items        TEXT NOT NULL,
      total_amount REAL DEFAULT 0,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plu_groups_cache (
      id           TEXT PRIMARY KEY,
      company_id   TEXT NOT NULL,
      workplace_id TEXT,
      name         TEXT NOT NULL,
      color        TEXT NOT NULL DEFAULT '#90CAF9',
      sort_order   INTEGER DEFAULT 0,
      synced_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plu_items_cache (
      id           TEXT PRIMARY KEY,
      group_id     TEXT NOT NULL,
      product_code TEXT NOT NULL,
      sort_order   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pos_settings_cache (
      id           TEXT PRIMARY KEY DEFAULT 'local',
      show_price   INTEGER DEFAULT 1,
      show_code    INTEGER DEFAULT 1,
      show_barcode INTEGER DEFAULT 0,
      duplicate_item_action TEXT DEFAULT 'increase_qty',
      min_qty_per_line INTEGER DEFAULT 1,
      allow_line_discount INTEGER DEFAULT 1,
      allow_doc_discount INTEGER DEFAULT 1,
      max_line_discount_pct REAL DEFAULT 100,
      max_doc_discount_pct REAL DEFAULT 100,
      source       TEXT DEFAULT 'default',
      synced_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS command_history (
      id          TEXT PRIMARY KEY,
      command     TEXT NOT NULL,
      payload     TEXT DEFAULT '{}',
      status      TEXT NOT NULL,
      received_at TEXT NOT NULL,
      done_at     TEXT
    );
  `)

  /* Eski btpos.db: tablolar CREATE IF NOT EXISTS ile genişlemez; önce sütun migrasyonu, sonra varsayılan satır */
  migrateCashiersCompanyId(sqlite)
  migratePosDiscountAndSettings(sqlite)

  sqlite.exec(`
    INSERT OR IGNORE INTO pos_settings_cache (id, show_price, show_code, show_barcode, duplicate_item_action, min_qty_per_line, allow_line_discount, allow_doc_discount, max_line_discount_pct, max_doc_discount_pct, source)
    VALUES ('local', 1, 1, 0, 'increase_qty', 1, 1, 1, 100, 100, 'default');
  `)

  return db
}

function migrateCashiersCompanyId(sqlite: Database.Database) {
  const cols = sqlite.prepare('PRAGMA table_info(cashiers)').all() as { name: string }[]
  if (!cols.some(c => c.name === 'company_id')) {
    try {
      sqlite.exec(`ALTER TABLE cashiers ADD COLUMN company_id TEXT NOT NULL DEFAULT ''`)
    } catch {
      // yok say
    }
  }
}

function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some(c => c.name === column)) {
    try {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
    } catch {
      /* yok say */
    }
  }
}

/** Eski btpos.db — iskonto ve POS ayar sütunları */
function migratePosDiscountAndSettings(sqlite: Database.Database) {
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'duplicate_item_action', `duplicate_item_action TEXT DEFAULT 'increase_qty'`)
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'min_qty_per_line', 'min_qty_per_line INTEGER DEFAULT 1')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'allow_line_discount', 'allow_line_discount INTEGER DEFAULT 1')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'allow_doc_discount', 'allow_doc_discount INTEGER DEFAULT 1')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'max_line_discount_pct', 'max_line_discount_pct REAL DEFAULT 100')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'max_doc_discount_pct', 'max_doc_discount_pct REAL DEFAULT 100')

  addColumnIfMissing(sqlite, 'sale_items', 'discount_rate', 'discount_rate REAL DEFAULT 0')
  addColumnIfMissing(sqlite, 'sale_items', 'discount_amount', 'discount_amount REAL DEFAULT 0')
  addColumnIfMissing(sqlite, 'sale_items', 'applied_by', 'applied_by TEXT')

  addColumnIfMissing(sqlite, 'sales', 'discount_rate', 'discount_rate REAL DEFAULT 0')
  addColumnIfMissing(sqlite, 'sales', 'discount_amount', 'discount_amount REAL DEFAULT 0')
  addColumnIfMissing(sqlite, 'sales', 'net_amount', 'net_amount REAL DEFAULT 0')
  try {
    sqlite.exec(`UPDATE sales SET net_amount = total_amount WHERE net_amount IS NULL OR net_amount = 0`)
  } catch {
    /* yok say */
  }
}

export function getDB() {
  if (!db) throw new Error('DB henüz başlatılmadı')
  return db
}
