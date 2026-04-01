import { describe, it, expect, beforeEach } from 'vitest'
import type { BetterSqliteShim } from '../betterSqliteShim'
import { getTestDb } from '../setup'

function makeSyncCashiers(db: BetterSqliteShim) {
  return function syncCashiersAcid(cashiers: any[], companyId: string, mode: 'full' | 'diff' = 'full') {
    if (cashiers.length === 0) {
      return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş kasiyer listesi' }
    }
    const now = new Date().toISOString()
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM cashiers_temp').run()
      const ins = db.prepare(`
        INSERT INTO cashiers_temp (id, company_id, full_name, cashier_code, password, role, is_active, synced_at)
        VALUES (@id, @companyId, @fullName, @cashierCode, @password, @role, @isActive, @syncedAt)
      `)
      for (const c of cashiers) {
        ins.run({
          id: c.id,
          companyId,
          fullName: c.fullName,
          cashierCode: c.cashierCode,
          password: c.password,
          role: c.role ?? 'cashier',
          isActive: c.isActive ? 1 : 0,
          syncedAt: now,
        })
      }
      const count = (db.prepare('SELECT COUNT(*) as c FROM cashiers_temp').get() as any).c
      if (count === 0) throw new Error('Temp boş')
      if (mode === 'full') {
        db.prepare('DELETE FROM cashiers WHERE company_id = ?').run(companyId)
        db.prepare(`
          INSERT INTO cashiers (id, company_id, full_name, cashier_code, password, role, is_active, synced_at)
          SELECT id, company_id, full_name, cashier_code, password, role, is_active, synced_at FROM cashiers_temp
        `).run()
      } else {
        db.prepare(`
          INSERT OR REPLACE INTO cashiers (id, company_id, full_name, cashier_code, password, role, is_active, synced_at)
          SELECT id, company_id, full_name, cashier_code, password, role, is_active, synced_at FROM cashiers_temp
        `).run()
      }
      db.prepare('DELETE FROM cashiers_temp').run()
    })
    try {
      txn()
      return { success: true, inserted: cashiers.length, updated: 0, deleted: 0 }
    } catch (e) {
      return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
    }
  }
}

describe('syncCashiersAcid', () => {
  let db: BetterSqliteShim
  let syncCashiers: ReturnType<typeof makeSyncCashiers>

  const mockCashiers = [
    { id: 'cas1', fullName: 'Ali Veli', cashierCode: '001', password: 'pass1', role: 'cashier', isActive: true },
    { id: 'cas2', fullName: 'Ayşe Fatma', cashierCode: '002', password: 'pass2', role: 'manager', isActive: true },
  ]

  beforeEach(() => {
    db = getTestDb()
    syncCashiers = makeSyncCashiers(db)
  })

  it('kasiyerleri başarıyla yazar', () => {
    const result = syncCashiers(mockCashiers, 'c1', 'full')
    expect(result.success).toBe(true)
    const rows = db.prepare('SELECT * FROM cashiers').all()
    expect(rows).toHaveLength(2)
  })

  it('boş liste gelince mevcut kasiyerler korunur', () => {
    syncCashiers(mockCashiers, 'c1', 'full')
    const result = syncCashiers([], 'c1', 'full')
    expect(result.success).toBe(false)
    const rows = db.prepare('SELECT * FROM cashiers').all()
    expect(rows).toHaveLength(2)
  })

  it('full mode: eski kasiyerleri siler', () => {
    syncCashiers(mockCashiers, 'c1', 'full')
    const newCashiers = [{ id: 'cas3', fullName: 'Mehmet', cashierCode: '003', password: 'p3', role: 'cashier', isActive: true }]
    syncCashiers(newCashiers, 'c1', 'full')
    const rows = db.prepare('SELECT * FROM cashiers WHERE company_id = ?').all('c1') as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].full_name).toBe('Mehmet')
  })

  it('temp tablo sync sonrası temizlenir', () => {
    syncCashiers(mockCashiers, 'c1', 'full')
    const count = (db.prepare('SELECT COUNT(*) as c FROM cashiers_temp').get() as any).c
    expect(count).toBe(0)
  })
})
