import { describe, it, expect, beforeEach } from 'vitest'
import type { BetterSqliteShim } from '../betterSqliteShim'
import { getTestDb } from '../setup'

function makeSyncPlu(db: BetterSqliteShim) {
  return function syncPluGroupsAcid(groups: any[], mode: 'full' | 'diff' = 'full') {
    const now = new Date().toISOString()
    if (groups.length === 0) {
      return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş PLU listesi' }
    }
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM plu_groups_temp').run()
      db.prepare('DELETE FROM plu_items_temp').run()
      const insGrp = db.prepare(`
        INSERT INTO plu_groups_temp (id, company_id, workplace_id, name, color, sort_order, synced_at)
        VALUES (@id, @companyId, @workplaceId, @name, @color, @sortOrder, @syncedAt)
      `)
      const insItem = db.prepare(`
        INSERT INTO plu_items_temp (id, group_id, product_code, sort_order)
        VALUES (@id, @groupId, @productCode, @sortOrder)
      `)
      for (const g of groups) {
        insGrp.run({ id: g.id, companyId: g.companyId, workplaceId: g.workplaceId ?? null, name: g.name, color: g.color, sortOrder: g.sortOrder ?? 0, syncedAt: now })
        for (const item of (g.plu_items ?? [])) {
          insItem.run({ id: item.id, groupId: g.id, productCode: item.product_code, sortOrder: item.sort_order ?? 0 })
        }
      }
      const count = (db.prepare('SELECT COUNT(*) as c FROM plu_groups_temp').get() as any).c
      if (count === 0) throw new Error('PLU temp boş')
      if (mode === 'full') {
        const cId = groups[0].companyId
        const ids = (db.prepare('SELECT id FROM plu_groups_cache WHERE company_id = ?').all(cId) as any[]).map((r: any) => r.id)
        if (ids.length > 0) db.prepare(`DELETE FROM plu_items_cache WHERE group_id IN (${ids.map(() => '?').join(',')})`).run(...ids)
        db.prepare('DELETE FROM plu_groups_cache WHERE company_id = ?').run(cId)
        db.prepare('INSERT INTO plu_groups_cache SELECT * FROM plu_groups_temp').run()
        db.prepare('INSERT INTO plu_items_cache SELECT * FROM plu_items_temp').run()
      } else {
        db.prepare('INSERT OR REPLACE INTO plu_groups_cache SELECT * FROM plu_groups_temp').run()
        db.prepare('INSERT OR REPLACE INTO plu_items_cache SELECT * FROM plu_items_temp').run()
      }
      db.prepare('DELETE FROM plu_groups_temp').run()
      db.prepare('DELETE FROM plu_items_temp').run()
    })
    try {
      txn()
      return { success: true, inserted: groups.length, updated: 0, deleted: 0 }
    } catch (e) {
      return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
    }
  }
}

describe('syncPluGroupsAcid', () => {
  let db: BetterSqliteShim
  let syncPlu: ReturnType<typeof makeSyncPlu>

  const mockGroups = [
    {
      id: 'g1', companyId: 'c1', workplaceId: null,
      name: 'İçecekler', color: '#0077b6', sortOrder: 0,
      plu_items: [
        { id: 'i1', product_code: 'KOL001', sort_order: 0 },
        { id: 'i2', product_code: 'AYR001', sort_order: 1 },
      ],
    },
    {
      id: 'g2', companyId: 'c1', workplaceId: null,
      name: 'Ekmek', color: '#fca311', sortOrder: 1,
      plu_items: [],
    },
  ]

  beforeEach(() => {
    db = getTestDb()
    syncPlu = makeSyncPlu(db)
  })

  it('full mode: grupları ve item\'ları yazar', () => {
    const result = syncPlu(mockGroups, 'full')
    expect(result.success).toBe(true)
    const grps = db.prepare('SELECT * FROM plu_groups_cache').all()
    const items = db.prepare('SELECT * FROM plu_items_cache').all()
    expect(grps).toHaveLength(2)
    expect(items).toHaveLength(2)
  })

  it('full mode: eski grupları ve item\'ları siler', () => {
    syncPlu(mockGroups, 'full')
    const newGroups = [{ id: 'g3', companyId: 'c1', workplaceId: null, name: 'Yeni', color: '#000', sortOrder: 0, plu_items: [] }]
    syncPlu(newGroups, 'full')
    const grps = db.prepare('SELECT * FROM plu_groups_cache WHERE company_id = ?').all('c1') as any[]
    expect(grps).toHaveLength(1)
    expect(grps[0].name).toBe('Yeni')
    const items = db.prepare('SELECT * FROM plu_items_cache').all()
    expect(items).toHaveLength(0)
  })

  it('boş liste gelince sync iptal eder', () => {
    syncPlu(mockGroups, 'full')
    const result = syncPlu([], 'full')
    expect(result.success).toBe(false)
    const grps = db.prepare('SELECT * FROM plu_groups_cache').all()
    expect(grps).toHaveLength(2)
  })

  it('temp tablolar sync sonrası temizlenir', () => {
    syncPlu(mockGroups, 'full')
    const tempGrps = (db.prepare('SELECT COUNT(*) as c FROM plu_groups_temp').get() as any).c
    const tempItems = (db.prepare('SELECT COUNT(*) as c FROM plu_items_temp').get() as any).c
    expect(tempGrps).toBe(0)
    expect(tempItems).toBe(0)
  })

  it('diff mode: grup adı güncellenir', () => {
    syncPlu(mockGroups, 'full')
    const updated = [{ ...mockGroups[0], name: 'İçecekler Güncellendi' }, mockGroups[1]]
    syncPlu(updated, 'diff')
    const g1 = db.prepare('SELECT name FROM plu_groups_cache WHERE id = ?').get('g1') as any
    expect(g1.name).toBe('İçecekler Güncellendi')
  })
})
