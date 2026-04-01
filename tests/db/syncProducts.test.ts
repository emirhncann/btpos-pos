import { describe, it, expect, beforeEach } from 'vitest'
import type { BetterSqliteShim } from '../betterSqliteShim'
import { getTestDb } from '../setup'

function makeSyncProducts(db: BetterSqliteShim) {
  return function syncProductsAcid(items: any[], mode: 'full' | 'diff' = 'full') {
    const now = new Date().toISOString()
    let inserted = 0, updated = 0, deleted = 0

    if (items.length === 0) {
      return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş liste — sync iptal' }
    }

    const txn = db.transaction(() => {
      db.prepare('DELETE FROM products_temp').run()
      const ins = db.prepare(`
        INSERT INTO products_temp (id, code, name, barcode, price, vat_rate, unit, stock, category, synced_at)
        VALUES (@id, @code, @name, @barcode, @price, @vatRate, @unit, @stock, @category, @syncedAt)
      `)
      for (const item of items) {
        ins.run({ ...item, syncedAt: now })
        inserted++
      }
      const count = (db.prepare('SELECT COUNT(*) as c FROM products_temp').get() as any).c
      if (count === 0) throw new Error('Temp boş')

      if (mode === 'full') {
        deleted = (db.prepare('SELECT COUNT(*) as c FROM products').get() as any).c
        db.prepare('DELETE FROM products').run()
        db.prepare('INSERT INTO products SELECT * FROM products_temp').run()
      } else {
        const existing = new Map(
          (db.prepare('SELECT id, price, name FROM products').all() as any[]).map((r: any) => [r.id, r])
        )
        const upsert = db.prepare(`
          INSERT OR REPLACE INTO products (id, code, name, barcode, price, vat_rate, unit, stock, category, synced_at)
          VALUES (@id, @code, @name, @barcode, @price, @vatRate, @unit, @stock, @category, @syncedAt)
        `)
        inserted = 0
        for (const item of items) {
          const ex = existing.get(item.id)
          if (!ex || ex.price !== item.price || ex.name !== item.name) {
            upsert.run({ ...item, syncedAt: now })
            ex ? updated++ : inserted++
          }
        }
      }
      db.prepare('DELETE FROM products_temp').run()
    })

    try {
      txn()
      return { success: true, inserted, updated, deleted }
    } catch (e) {
      return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
    }
  }
}

describe('syncProductsAcid', () => {
  let db: BetterSqliteShim
  let syncProducts: ReturnType<typeof makeSyncProducts>

  const mockProducts = [
    { id: 'p1', code: 'KOD001', name: 'Ürün 1', barcode: '111', price: 10, vatRate: 18, unit: 'Adet', stock: 100, category: 'Genel' },
    { id: 'p2', code: 'KOD002', name: 'Ürün 2', barcode: '222', price: 20, vatRate: 18, unit: 'Adet', stock: 50, category: 'Genel' },
  ]

  beforeEach(() => {
    db = getTestDb()
    syncProducts = makeSyncProducts(db)
  })

  it('full mode: ürünleri başarıyla yazar', () => {
    const result = syncProducts(mockProducts, 'full')
    expect(result.success).toBe(true)
    expect(result.inserted).toBe(2)
    const rows = db.prepare('SELECT * FROM products').all()
    expect(rows).toHaveLength(2)
  })

  it('full mode: eski kayıtları siler', () => {
    db.prepare(`INSERT INTO products (id, code, name, price, vat_rate, unit, stock) VALUES ('old', 'ESK', 'Eski Ürün', 5, 18, 'Adet', 1)`).run()
    const result = syncProducts(mockProducts, 'full')
    expect(result.success).toBe(true)
    expect(result.deleted).toBe(1)
    const rows = db.prepare('SELECT * FROM products').all() as any[]
    expect(rows.find((r: any) => r.id === 'old')).toBeUndefined()
  })

  it('boş liste gelince sync iptal eder', () => {
    const result = syncProducts([], 'full')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Boş liste')
  })

  it('diff mode: sadece değişen fiyatı günceller', () => {
    syncProducts(mockProducts, 'full')
    const updated = [
      { ...mockProducts[0], price: 15 },
      mockProducts[1],
    ]
    const result = syncProducts(updated, 'diff')
    expect(result.success).toBe(true)
    const p1 = db.prepare('SELECT price FROM products WHERE id = ?').get('p1') as any
    expect(p1.price).toBe(15)
  })

  it('hata durumunda ana tablo bozulmaz (rollback)', () => {
    syncProducts(mockProducts, 'full')
    const before = db.prepare('SELECT COUNT(*) as c FROM products').get() as any

    const badItems = [{ id: 'bad', code: 'B', name: null, price: 0, vatRate: 18, unit: 'Adet', stock: 0, category: '' }]
    const result = syncProducts(badItems as any, 'full')

    const after = db.prepare('SELECT COUNT(*) as c FROM products').get() as any
    expect(after.c).toBe(before.c)
    expect(result.success).toBe(false)
  })

  it('temp tablo sync sonrası temizlenir', () => {
    syncProducts(mockProducts, 'full')
    const tempCount = (db.prepare('SELECT COUNT(*) as c FROM products_temp').get() as any).c
    expect(tempCount).toBe(0)
  })
})
