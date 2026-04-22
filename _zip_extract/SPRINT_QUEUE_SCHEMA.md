# Sprint — Operation Queue: SQLite Şema
**Dosya:** `db/schema.ts`

## Yeni tablo ekle

```ts
// Buluta gidecek işlemler kuyruğu
export const operationQueue = sqliteTable('operation_queue', {
  id:          text('id').primaryKey(),          // uuid
  companyId:   text('company_id').notNull(),
  type:        text('type').notNull(),            // 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice'
  payload:     text('payload').notNull(),         // JSON string
  status:      text('status').notNull().default('pending'), // 'pending' | 'processing' | 'success' | 'failed'
  attempts:    integer('attempts').default(0),
  maxAttempts: integer('max_attempts').default(3),
  error:       text('error'),
  createdAt:   text('created_at').notNull(),
  sentAt:      text('sent_at'),
  label:       text('label'),                     // gösterim için — "EMİR TORBA CARİ faturası"
})
```

## Migration — `electron/main.ts` içindeki db.run bloğuna ekle

```ts
db.run(`
  CREATE TABLE IF NOT EXISTS operation_queue (
    id           TEXT PRIMARY KEY,
    company_id   TEXT NOT NULL,
    type         TEXT NOT NULL,
    payload      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    attempts     INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error        TEXT,
    created_at   TEXT NOT NULL,
    sent_at      TEXT,
    label        TEXT
  )
`)
```
