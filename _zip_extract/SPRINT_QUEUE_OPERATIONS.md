# Sprint — Operation Queue: DB Operations
**Dosya:** `db/operations.ts`

## Yeni fonksiyonlar ekle

```ts
// ─── OPERATION QUEUE ──────────────────────────────────────────

/** Kuyruğa yeni işlem ekle */
export function enqueueOperation(db: BetterSqlite3.Database, params: {
  id:        string
  companyId: string
  type:      'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice'
  payload:   Record<string, unknown>
  label?:    string
}) {
  db.prepare(`
    INSERT INTO operation_queue (id, company_id, type, payload, status, attempts, created_at, label)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(
    params.id,
    params.companyId,
    params.type,
    JSON.stringify(params.payload),
    new Date().toISOString(),
    params.label ?? null,
  )
}

/** Bekleyen işlemleri getir */
export function getPendingOperations(db: BetterSqlite3.Database, companyId: string) {
  return db.prepare(`
    SELECT * FROM operation_queue
    WHERE company_id = ? AND status = 'pending' AND attempts < max_attempts
    ORDER BY created_at ASC
  `).all(companyId) as OperationQueueRow[]
}

/** Tüm işlemleri getir (Belge Aktarım ekranı için) */
export function getAllOperations(db: BetterSqlite3.Database, companyId: string, limit = 100) {
  return db.prepare(`
    SELECT * FROM operation_queue
    WHERE company_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(companyId, limit) as OperationQueueRow[]
}

/** İşlemi processing'e al */
export function markOperationProcessing(db: BetterSqlite3.Database, id: string) {
  db.prepare(`
    UPDATE operation_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ?
  `).run(id)
}

/** İşlem başarılı */
export function markOperationSuccess(db: BetterSqlite3.Database, id: string) {
  db.prepare(`
    UPDATE operation_queue SET status = 'success', sent_at = ?, error = NULL WHERE id = ?
  `).run(new Date().toISOString(), id)
}

/** İşlem başarısız */
export function markOperationFailed(db: BetterSqlite3.Database, id: string, error: string) {
  db.prepare(`
    UPDATE operation_queue
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        error = ?
    WHERE id = ?
  `).run(error, id)
}

/** Başarısız işlemi tekrar kuyruğa al */
export function retryOperation(db: BetterSqlite3.Database, id: string) {
  db.prepare(`
    UPDATE operation_queue SET status = 'pending', attempts = 0, error = NULL WHERE id = ?
  `).run(id)
}

/** İşlemi sil */
export function deleteOperation(db: BetterSqlite3.Database, id: string) {
  db.prepare(`DELETE FROM operation_queue WHERE id = ?`).run(id)
}
```

## Type tanımı ekle

```ts
export interface OperationQueueRow {
  id:          string
  companyId:   string
  type:        'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice'
  payload:     string   // JSON
  status:      'pending' | 'processing' | 'success' | 'failed'
  attempts:    number
  maxAttempts: number
  error:       string | null
  createdAt:   string
  sentAt:      string | null
  label:       string | null
}
```

## IPC handler'ları — `electron/main.ts`'e ekle

```ts
ipcMain.handle('db:enqueueOperation', (_, params) =>
  enqueueOperation(db, params))

ipcMain.handle('db:getPendingOperations', (_, companyId) =>
  getPendingOperations(db, companyId))

ipcMain.handle('db:getAllOperations', (_, companyId, limit) =>
  getAllOperations(db, companyId, limit))

ipcMain.handle('db:markOperationProcessing', (_, id) =>
  markOperationProcessing(db, id))

ipcMain.handle('db:markOperationSuccess', (_, id) =>
  markOperationSuccess(db, id))

ipcMain.handle('db:markOperationFailed', (_, id, error) =>
  markOperationFailed(db, id, error))

ipcMain.handle('db:retryOperation', (_, id) =>
  retryOperation(db, id))

ipcMain.handle('db:deleteOperation', (_, id) =>
  deleteOperation(db, id))
```

## electron.d.ts'e ekle

```ts
db: {
  // ... mevcut metodlar ...
  enqueueOperation(params: {
    id: string; companyId: string;
    type: 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice';
    payload: Record<string, unknown>; label?: string
  }): Promise<void>
  getPendingOperations(companyId: string): Promise<OperationQueueRow[]>
  getAllOperations(companyId: string, limit?: number): Promise<OperationQueueRow[]>
  markOperationProcessing(id: string): Promise<void>
  markOperationSuccess(id: string): Promise<void>
  markOperationFailed(id: string, error: string): Promise<void>
  retryOperation(id: string): Promise<void>
  deleteOperation(id: string): Promise<void>
}
```
