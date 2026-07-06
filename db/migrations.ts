import type Database from 'better-sqlite3'

/** sales.receipt_no TEXT → INTEGER + order_no 3. kolon migration */
export function migrateSalesReceiptNo(sqlite: Database.Database): void {
  const saleColInfo = sqlite.prepare('PRAGMA table_info(sales)').all() as { name: string; type: string }[]
  if (saleColInfo.length === 0) return

  const saleCols = saleColInfo.map(c => c.name)
  const receiptNoCol = saleColInfo.find(c => c.name === 'receipt_no')

  if (saleCols.includes('order_no') && receiptNoCol?.type?.toUpperCase() !== 'TEXT') {
    return
  }

  // FOREIGN KEY (sale_items.sale_id → sales.id) yüzünden tabloyu silerken FK hatası alıyoruz.
  // Migration süresince foreign_keys'i geçici olarak kapatıp sonra geri açıyoruz.
  const fkPragma = sqlite.pragma('foreign_keys', { simple: true }) as unknown as { foreign_keys: 0 | 1 }
  const wasFkOn = typeof fkPragma === 'object' && fkPragma !== null
    ? (fkPragma as { foreign_keys: 0 | 1 }).foreign_keys === 1
    : Boolean(fkPragma)

  sqlite.exec('PRAGMA foreign_keys = OFF;')

  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sales_backup AS SELECT * FROM sales;
      DROP TABLE IF EXISTS sales;

      CREATE TABLE sales (
        id                  TEXT    PRIMARY KEY,
        receipt_no          INTEGER,
        order_no            TEXT,
        total_amount        REAL    NOT NULL DEFAULT 0,
        discount_rate       REAL    DEFAULT 0,
        discount_amount     REAL    DEFAULT 0,
        net_amount          REAL    NOT NULL DEFAULT 0,
        payment_type        TEXT    NOT NULL DEFAULT 'cash',
        cash_amount         REAL    DEFAULT 0,
        card_amount         REAL    DEFAULT 0,
        created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
        synced              INTEGER DEFAULT 0,
        customer_id         TEXT,
        customer_name       TEXT,
        customer_code       TEXT,
        cashier_id          TEXT,
        cashier_name        TEXT,
        invoice_sent        INTEGER NOT NULL DEFAULT 0,
        invoice_id          TEXT,
        invoice_error       TEXT,
        invoice_at          TEXT,
        card_acquirer_id    TEXT,
        payment_provider    TEXT,
        payment_device_data TEXT,
        is_return           INTEGER DEFAULT 0
      );
    `)

  const backupCols = (sqlite.prepare('PRAGMA table_info(sales_backup)').all() as { name: string }[])
    .map(c => c.name)
  const pick = (col: string, alt = 'NULL') => (backupCols.includes(col) ? col : alt)

  sqlite.exec(`
    INSERT INTO sales (
      id, receipt_no, order_no,
      total_amount, discount_rate, discount_amount, net_amount,
      payment_type, cash_amount, card_amount,
      created_at, synced,
      customer_id, customer_name, customer_code,
      cashier_id, cashier_name,
      invoice_sent, invoice_id, invoice_error, invoice_at,
      card_acquirer_id, payment_provider, payment_device_data, is_return
    )
    SELECT
      id,
      CAST(REPLACE(receipt_no, 'FIS-', '') AS INTEGER),
      ${pick('order_no')},
      total_amount,
      ${pick('discount_rate', '0')},
      ${pick('discount_amount', '0')},
      ${pick('net_amount', 'total_amount')},
      payment_type,
      ${pick('cash_amount', '0')},
      ${pick('card_amount', '0')},
      created_at,
      ${pick('synced', '0')},
      ${pick('customer_id')},
      ${pick('customer_name')},
      ${pick('customer_code')},
      ${pick('cashier_id')},
      ${pick('cashier_name')},
      ${pick('invoice_sent', '0')},
      ${pick('invoice_id')},
      ${pick('invoice_error')},
      ${pick('invoice_at')},
      ${pick('card_acquirer_id')},
      ${pick('payment_provider')},
      ${pick('payment_device_data')},
      ${pick('is_return', '0')}
    FROM sales_backup;

      DROP TABLE IF EXISTS sales_backup;
    `)
  } finally {
    if (wasFkOn) {
      sqlite.exec('PRAGMA foreign_keys = ON;')
    }
  }
}
