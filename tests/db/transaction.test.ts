import { describe, it, expect, beforeEach } from 'vitest'
import type { BetterSqliteShim } from '../betterSqliteShim'
import { getTestDb } from '../setup'

describe('SQLite Transaction Rollback', () => {
  let db: BetterSqliteShim

  beforeEach(() => {
    db = getTestDb()
  })

  it('hata durumunda transaction rollback yapar', () => {
    db.prepare(`INSERT INTO products (id, code, name, price, vat_rate, unit, stock) VALUES ('p1', 'K1', 'Ürün 1', 10, 18, 'Adet', 5)`).run()

    const before = (db.prepare('SELECT COUNT(*) as c FROM products').get() as any).c

    const txn = db.transaction(() => {
      db.prepare('DELETE FROM products').run()
      throw new Error('Kasıtlı hata')
    })

    try {
      txn()
    } catch {
      /* yut */
    }

    const after = (db.prepare('SELECT COUNT(*) as c FROM products').get() as any).c
    expect(after).toBe(before)
  })

  it('başarılı transaction commit yapar', () => {
    const txn = db.transaction(() => {
      db.prepare(`INSERT INTO products (id, code, name, price, vat_rate, unit, stock) VALUES ('p2', 'K2', 'Ürün 2', 20, 18, 'Adet', 3)`).run()
    })
    txn()
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get('p2')
    expect(row).toBeTruthy()
  })

  it('nested transaction (savepoint) destekler', () => {
    db.prepare(`INSERT INTO products (id, code, name, price, vat_rate, unit, stock) VALUES ('p3', 'K3', 'Ürün 3', 30, 18, 'Adet', 1)`).run()

    const outer = db.transaction(() => {
      db.prepare(`INSERT INTO products (id, code, name, price, vat_rate, unit, stock) VALUES ('p4', 'K4', 'Ürün 4', 40, 18, 'Adet', 2)`).run()
      try {
        const inner = db.transaction(() => {
          db.prepare('DELETE FROM products').run()
          throw new Error('İç hata')
        })
        inner()
      } catch {
        /* iç rollback */
      }
    })
    outer()

    const count = (db.prepare('SELECT COUNT(*) as c FROM products').get() as any).c
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
