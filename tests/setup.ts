import { beforeEach, afterEach } from 'vitest'
import { createBetterSqliteShim, type BetterSqliteShim } from './betterSqliteShim'

let testDb: BetterSqliteShim | undefined

export function getTestDb(): BetterSqliteShim {
  if (!testDb) throw new Error('testDb yok')
  return testDb
}

beforeEach(() => {
  testDb = createBetterSqliteShim()
  initTestSchema(testDb)
})

afterEach(() => {
  try {
    testDb?.close()
  } catch {
    /* yut */
  }
  testDb = undefined
})

function initTestSchema(db: BetterSqliteShim) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL,
      barcode TEXT, price REAL DEFAULT 0, vat_rate REAL DEFAULT 18,
      unit TEXT DEFAULT 'Adet', stock REAL DEFAULT 0,
      category TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS products_temp (
      id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL,
      barcode TEXT, price REAL DEFAULT 0, vat_rate REAL DEFAULT 18,
      unit TEXT DEFAULT 'Adet', stock REAL DEFAULT 0,
      category TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS plu_groups_cache (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
      workplace_id TEXT, name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#90CAF9',
      sort_order INTEGER DEFAULT 0, synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plu_groups_temp (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
      workplace_id TEXT, name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#90CAF9',
      sort_order INTEGER DEFAULT 0, synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plu_items_cache (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL,
      product_code TEXT NOT NULL, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS plu_items_temp (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL,
      product_code TEXT NOT NULL, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cashiers (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
      full_name TEXT NOT NULL, cashier_code TEXT NOT NULL,
      password TEXT NOT NULL, role TEXT DEFAULT 'cashier',
      is_active INTEGER DEFAULT 1, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS cashiers_temp (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
      full_name TEXT NOT NULL, cashier_code TEXT NOT NULL,
      password TEXT NOT NULL, role TEXT DEFAULT 'cashier',
      is_active INTEGER DEFAULT 1, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pos_settings_cache (
      id TEXT PRIMARY KEY DEFAULT 'local',
      show_price INTEGER DEFAULT 1,
      show_code INTEGER DEFAULT 1,
      show_barcode INTEGER DEFAULT 0,
      source TEXT DEFAULT 'default',
      synced_at TEXT
    );
    INSERT OR IGNORE INTO pos_settings_cache (id) VALUES ('local');
  `)
}
