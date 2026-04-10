import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import * as fs from 'fs'
import * as schema from './schema'

let db: ReturnType<typeof drizzle> | undefined
let rawSqlite: Database.Database | null = null

export function getSqlite(): Database.Database {
  if (!rawSqlite) throw new Error('DB henüz başlatılmadı')
  return rawSqlite
}

export function initDatabase(dbFile: string): ReturnType<typeof drizzle> {
  const sqlite = new Database(dbFile)
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
      synced INTEGER DEFAULT 0,
      customer_id TEXT,
      customer_name TEXT,
      customer_code TEXT,
      invoice_sent INTEGER NOT NULL DEFAULT 0,
      invoice_id TEXT,
      invoice_error TEXT,
      invoice_at TEXT
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
      card_number  TEXT,
      synced_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS products_temp (
      id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL,
      barcode TEXT, price REAL DEFAULT 0, vat_rate REAL DEFAULT 18,
      unit TEXT DEFAULT 'Adet', stock REAL DEFAULT 0,
      category TEXT, synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS plu_groups_temp (
      id           TEXT PRIMARY KEY,
      company_id   TEXT NOT NULL,
      workplace_id TEXT,
      terminal_id  TEXT,
      cashier_id   TEXT,
      name         TEXT NOT NULL,
      color        TEXT NOT NULL DEFAULT '#90CAF9',
      sort_order   INTEGER DEFAULT 0,
      synced_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plu_items_temp (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL,
      product_code TEXT NOT NULL, sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cashiers_temp (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
      full_name TEXT NOT NULL, cashier_code TEXT NOT NULL,
      password TEXT NOT NULL, role TEXT DEFAULT 'cashier',
      is_active INTEGER DEFAULT 1, card_number TEXT, synced_at TEXT
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
      terminal_id  TEXT,
      cashier_id   TEXT,
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
      id                    TEXT PRIMARY KEY DEFAULT 'local',
      cashier_id            TEXT,
      show_price            INTEGER DEFAULT 1,
      show_code             INTEGER DEFAULT 1,
      show_barcode          INTEGER DEFAULT 0,
      duplicate_item_action TEXT DEFAULT 'increase_qty',
      min_qty_per_line      INTEGER DEFAULT 1,
      allow_line_discount   INTEGER DEFAULT 1,
      allow_doc_discount    INTEGER DEFAULT 1,
      max_line_discount_pct REAL DEFAULT 100,
      max_doc_discount_pct  REAL DEFAULT 100,
      plu_cols              INTEGER DEFAULT 4,
      plu_rows              INTEGER DEFAULT 3,
      font_size_name        INTEGER DEFAULT 12,
      font_size_price       INTEGER DEFAULT 13,
      font_size_code        INTEGER DEFAULT 9,
      source                TEXT DEFAULT 'default',
      plu_mode              TEXT DEFAULT 'terminal',
      login_with_code       INTEGER DEFAULT 1,
      login_with_card       INTEGER DEFAULT 1,
      synced_at             TEXT
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

  migrateCashiersCompanyId(sqlite)
  migratePosDiscountAndSettings(sqlite)

  sqlite.exec(`
    INSERT OR IGNORE INTO pos_settings_cache (id, show_price, show_code, show_barcode, duplicate_item_action, min_qty_per_line, allow_line_discount, allow_doc_discount, max_line_discount_pct, max_doc_discount_pct, plu_cols, plu_rows, font_size_name, font_size_price, font_size_code, source)
    VALUES ('local', 1, 1, 0, 'increase_qty', 1, 1, 1, 100, 100, 4, 3, 12, 13, 9, 'default');

    CREATE TABLE IF NOT EXISTS pos_settings_temp (
      id                    TEXT PRIMARY KEY,
      cashier_id            TEXT,
      show_price            INTEGER DEFAULT 1,
      show_code             INTEGER DEFAULT 1,
      show_barcode          INTEGER DEFAULT 0,
      duplicate_item_action TEXT DEFAULT 'increase_qty',
      min_qty_per_line      INTEGER DEFAULT 1,
      allow_line_discount   INTEGER DEFAULT 1,
      allow_doc_discount    INTEGER DEFAULT 1,
      max_line_discount_pct REAL DEFAULT 100,
      max_doc_discount_pct  REAL DEFAULT 100,
      plu_cols              INTEGER DEFAULT 4,
      plu_rows              INTEGER DEFAULT 3,
      font_size_name        INTEGER DEFAULT 12,
      font_size_price       INTEGER DEFAULT 13,
      font_size_code        INTEGER DEFAULT 9,
      source                TEXT DEFAULT 'default',
      plu_mode              TEXT DEFAULT 'terminal',
      login_with_code       INTEGER DEFAULT 1,
      login_with_card       INTEGER DEFAULT 0,
      synced_at             TEXT
    );
  `)

  return db
}

/** @deprecated Ana süreçte doğrudan {@link initDatabase} kullanın. */
export function initDB(): ReturnType<typeof drizzle> {
  return initDatabase(join(app.getPath('userData'), 'btpos.db'))
}

export function reinitDatabase(customPath?: string): void {
  try {
    rawSqlite?.close()
  } catch {
    /* yok say */
  }
  rawSqlite = null
  db = undefined

  const dbDir = customPath?.trim() ? customPath.trim() : app.getPath('userData')
  const dbFile = join(dbDir, 'btpos.db')
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  initDatabase(dbFile)
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
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'plu_cols', 'plu_cols INTEGER DEFAULT 4')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'plu_rows', 'plu_rows INTEGER DEFAULT 3')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'font_size_name', 'font_size_name INTEGER DEFAULT 12')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'font_size_price', 'font_size_price INTEGER DEFAULT 13')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'font_size_code', 'font_size_code INTEGER DEFAULT 9')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'plu_mode', `plu_mode TEXT DEFAULT 'terminal'`)
  addColumnIfMissing(sqlite, 'plu_groups_cache', 'terminal_id', 'terminal_id TEXT')
  addColumnIfMissing(sqlite, 'plu_groups_cache', 'cashier_id', 'cashier_id TEXT')
  addColumnIfMissing(sqlite, 'plu_groups_temp', 'terminal_id', 'terminal_id TEXT')
  addColumnIfMissing(sqlite, 'plu_groups_temp', 'cashier_id', 'cashier_id TEXT')
  addColumnIfMissing(sqlite, 'cashiers', 'card_number', 'card_number TEXT')
  addColumnIfMissing(sqlite, 'cashiers_temp', 'card_number', 'card_number TEXT')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'login_with_code', 'login_with_code INTEGER DEFAULT 1')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'login_with_card', 'login_with_card INTEGER DEFAULT 0')
  addColumnIfMissing(sqlite, 'pos_settings_temp', 'login_with_code', 'login_with_code INTEGER DEFAULT 1')
  addColumnIfMissing(sqlite, 'pos_settings_temp', 'login_with_card', 'login_with_card INTEGER DEFAULT 0')

  addColumnIfMissing(sqlite, 'pos_settings_cache', 'torba_cari_id', 'torba_cari_id TEXT')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'torba_cari_name', 'torba_cari_name TEXT')
  addColumnIfMissing(sqlite, 'pos_settings_temp', 'torba_cari_id', 'torba_cari_id TEXT')
  addColumnIfMissing(sqlite, 'pos_settings_temp', 'torba_cari_name', 'torba_cari_name TEXT')

  addColumnIfMissing(sqlite, 'sale_items', 'discount_rate', 'discount_rate REAL DEFAULT 0')
  addColumnIfMissing(sqlite, 'sale_items', 'discount_amount', 'discount_amount REAL DEFAULT 0')
  addColumnIfMissing(sqlite, 'sale_items', 'applied_by', 'applied_by TEXT')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id          TEXT PRIMARY KEY,
      company_id  TEXT NOT NULL,
      code        TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL,
      phone       TEXT NOT NULL DEFAULT '',
      tax_no      TEXT NOT NULL DEFAULT '',
      address     TEXT NOT NULL DEFAULT '',
      balance     REAL NOT NULL DEFAULT 0,
      is_person   INTEGER NOT NULL DEFAULT 1,
      first_name  TEXT NOT NULL DEFAULT '',
      last_name   TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      city        TEXT NOT NULL DEFAULT '',
      district    TEXT NOT NULL DEFAULT '',
      synced_at   TEXT NOT NULL
    )
  `)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS customers_temp (
      id          TEXT PRIMARY KEY,
      company_id  TEXT NOT NULL,
      code        TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL,
      phone       TEXT NOT NULL DEFAULT '',
      tax_no      TEXT NOT NULL DEFAULT '',
      address     TEXT NOT NULL DEFAULT '',
      balance     REAL NOT NULL DEFAULT 0,
      is_person   INTEGER NOT NULL DEFAULT 1,
      first_name  TEXT NOT NULL DEFAULT '',
      last_name   TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      city        TEXT NOT NULL DEFAULT '',
      district    TEXT NOT NULL DEFAULT '',
      synced_at   TEXT NOT NULL
    )
  `)

  addColumnIfMissing(sqlite, 'customers',      'is_person',  'is_person  INTEGER NOT NULL DEFAULT 1')
  addColumnIfMissing(sqlite, 'customers',      'first_name', 'first_name TEXT NOT NULL DEFAULT \'\'')
  addColumnIfMissing(sqlite, 'customers',      'last_name',  'last_name  TEXT NOT NULL DEFAULT \'\'')
  addColumnIfMissing(sqlite, 'customers_temp', 'is_person',  'is_person  INTEGER NOT NULL DEFAULT 1')
  addColumnIfMissing(sqlite, 'customers_temp', 'first_name', 'first_name TEXT NOT NULL DEFAULT \'\'')
  addColumnIfMissing(sqlite, 'customers_temp', 'last_name',  'last_name  TEXT NOT NULL DEFAULT \'\'')

  addColumnIfMissing(sqlite, 'customers',      'postal_code', 'postal_code TEXT NOT NULL DEFAULT \'\'')
  addColumnIfMissing(sqlite, 'customers',      'city',        'city        TEXT NOT NULL DEFAULT \'\'')
  addColumnIfMissing(sqlite, 'customers',      'district',    'district    TEXT NOT NULL DEFAULT \'\'')
  addColumnIfMissing(sqlite, 'customers_temp', 'postal_code', 'postal_code TEXT NOT NULL DEFAULT \'\'')
  addColumnIfMissing(sqlite, 'customers_temp', 'city',        'city        TEXT NOT NULL DEFAULT \'\'')
  addColumnIfMissing(sqlite, 'customers_temp', 'district',    'district    TEXT NOT NULL DEFAULT \'\'')

  addColumnIfMissing(sqlite, 'sales', 'customer_id', 'customer_id TEXT')
  addColumnIfMissing(sqlite, 'sales', 'customer_name', 'customer_name TEXT')
  addColumnIfMissing(sqlite, 'sales', 'customer_code', 'customer_code TEXT')
  addColumnIfMissing(sqlite, 'sales', 'invoice_sent', 'invoice_sent INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(sqlite, 'sales', 'invoice_id', 'invoice_id TEXT')
  addColumnIfMissing(sqlite, 'sales', 'invoice_error', 'invoice_error TEXT')
  addColumnIfMissing(sqlite, 'sales', 'invoice_at', 'invoice_at TEXT')

  addColumnIfMissing(sqlite, 'sales', 'discount_rate', 'discount_rate REAL DEFAULT 0')
  addColumnIfMissing(sqlite, 'sales', 'discount_amount', 'discount_amount REAL DEFAULT 0')
  addColumnIfMissing(sqlite, 'sales', 'net_amount', 'net_amount REAL DEFAULT 0')
  addColumnIfMissing(sqlite, 'pos_settings_cache', 'cashier_id', 'cashier_id TEXT')
  try {
    sqlite.exec(`UPDATE sales SET net_amount = total_amount WHERE net_amount IS NULL OR net_amount = 0`)
  } catch {
    /* yok say */
  }

  // Sprint 24 — pos_settings_cache kolon sırası düzeltmesi
  // cashier_id migration ile sona eklenmişti, fiziksel sıra yanlıştı.
  // Tabloyu yeniden oluşturarak kolon sırasını düzelt.
  try {
    const cols = sqlite.prepare('PRAGMA table_info(pos_settings_cache)').all() as { name: string; cid: number }[]
    const cashierCol = cols.find(c => c.name === 'cashier_id')

    // cashier_id 2. sırada değilse (cid=1) tablo yeniden oluşturulmalı
    if (cashierCol && cashierCol.cid !== 1) {
      sqlite.exec(`
        -- Mevcut veriyi yedekle
        CREATE TABLE IF NOT EXISTS pos_settings_cache_backup AS
          SELECT * FROM pos_settings_cache;

        -- Eski tabloyu sil
        DROP TABLE pos_settings_cache;

        -- Doğru sırayla yeniden oluştur
        CREATE TABLE pos_settings_cache (
          id                    TEXT PRIMARY KEY DEFAULT 'local',
          cashier_id            TEXT,
          show_price            INTEGER DEFAULT 1,
          show_code             INTEGER DEFAULT 1,
          show_barcode          INTEGER DEFAULT 0,
          duplicate_item_action TEXT DEFAULT 'increase_qty',
          min_qty_per_line      INTEGER DEFAULT 1,
          allow_line_discount   INTEGER DEFAULT 1,
          allow_doc_discount    INTEGER DEFAULT 1,
          max_line_discount_pct REAL DEFAULT 100,
          max_doc_discount_pct  REAL DEFAULT 100,
          plu_cols              INTEGER DEFAULT 4,
          plu_rows              INTEGER DEFAULT 3,
          font_size_name        INTEGER DEFAULT 12,
          font_size_price       INTEGER DEFAULT 13,
          font_size_code        INTEGER DEFAULT 9,
          source                TEXT DEFAULT 'default',
          plu_mode              TEXT DEFAULT 'terminal',
          login_with_code       INTEGER DEFAULT 1,
          login_with_card       INTEGER DEFAULT 0,
          synced_at             TEXT,
          torba_cari_id         TEXT,
          torba_cari_name       TEXT
        );

        -- Veriyi açık kolon listesiyle geri yaz (kolon adı bazlı, sıra bağımsız)
        INSERT INTO pos_settings_cache (
          id, cashier_id, show_price, show_code, show_barcode,
          duplicate_item_action, min_qty_per_line,
          allow_line_discount, allow_doc_discount,
          max_line_discount_pct, max_doc_discount_pct,
          plu_cols, plu_rows, font_size_name, font_size_price, font_size_code,
          source, plu_mode, login_with_code, login_with_card, synced_at,
          torba_cari_id, torba_cari_name
        )
        SELECT
          id, cashier_id, show_price, show_code, show_barcode,
          duplicate_item_action, min_qty_per_line,
          allow_line_discount, allow_doc_discount,
          max_line_discount_pct, max_doc_discount_pct,
          plu_cols, plu_rows, font_size_name, font_size_price, font_size_code,
          source, plu_mode, login_with_code, login_with_card, synced_at,
          torba_cari_id, torba_cari_name
        FROM pos_settings_cache_backup;

        -- Yedek tabloyu sil
        DROP TABLE pos_settings_cache_backup;
      `)
    }
  } catch (e) {
    console.warn('[migration] pos_settings_cache yeniden oluşturma hatası:', e)
  }
}

export function getDB() {
  if (!db) throw new Error('DB henüz başlatılmadı')
  return db
}
