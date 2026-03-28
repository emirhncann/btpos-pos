import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import * as schema from './schema'

let db: ReturnType<typeof drizzle>

export function initDB() {
  const dbPath = join(app.getPath('userData'), 'btpos.db')
  const sqlite = new Database(dbPath)

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
      line_total REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS cashiers (
      id           TEXT PRIMARY KEY,
      full_name    TEXT NOT NULL,
      cashier_code TEXT NOT NULL,
      password     TEXT NOT NULL,
      role         TEXT DEFAULT 'cashier',
      is_active    INTEGER DEFAULT 1,
      synced_at    TEXT
    );
  `)

  return db
}

export function getDB() {
  if (!db) throw new Error('DB henüz başlatılmadı')
  return db
}
