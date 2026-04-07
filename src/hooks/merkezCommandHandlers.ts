import { api, fetchPluGroupsFromServer } from '../lib/api'
import type { CommandHandlers, SyncMode } from './useCommandPoller'

export const noopCommandHandlers: CommandHandlers = {
  onSyncAll:        async () => {},
  onSyncPrices:     async () => {},
  onSyncCashiers:   async () => {},
  onSyncPlu:        async () => {},
  onSyncCustomers:  async () => {},
  onSyncProducts:   async () => {},
  onSyncSettings:   async () => {},
  onLogout:         () => {},
  onMessage:        () => {},
  onRestart:        () => {},
  onLock:           () => {},
}

export function pluGroupsToCacheRows(groups: PluGroup[], companyId: string, workplaceId: string | null): PluGroupCacheRow[] {
  return groups.map((g, gi) => ({
    id: g.id,
    companyId,
    workplaceId: workplaceId ?? undefined,
    name: g.name,
    color: g.color || '#90CAF9',
    sortOrder: g.sort_order ?? gi,
    plu_items: (g.plu_items ?? []).map((it, idx) => ({
      id: String(it.id ?? '').length > 0 ? String(it.id) : `plu-${g.id}-${idx}-${it.product_code}`,
      product_code: it.product_code,
      sort_order: it.sort_order ?? idx,
    })),
  }))
}

export interface MerkezCommandHandlerDeps {
  companyId:            string
  terminalId:           string
  setCommandSyncing:    (v: boolean) => void
  onLogout:             () => void
  onShowMessage:        (text: string) => void
  onSettingsUpdated:    (s: PosSettingsRow) => void
  onLock:               (reason?: string) => void
  showToast:            (msg: string) => void
  onPluUpdated:         (groups: PluGroupCacheRow[]) => void
}

function failResult(msg: string): SyncResult {
  return { success: false, inserted: 0, updated: 0, deleted: 0, error: msg }
}

export function buildMerkezCommandHandlers(d: MerkezCommandHandlerDeps): CommandHandlers {
  return {
    onSyncAll: async (mode: SyncMode = 'full') => {
      d.setCommandSyncing(true)
      try {
        const results: Record<string, SyncResult> = {
          products: failResult(''),
          plu:      failResult(''),
          cashiers: failResult(''),
          settings: failResult(''),
        }

        try {
          const data = await api.getProducts(d.companyId)
          const rawList = data?.data?.data ?? []
          const items: ProductRow[] = rawList.map((p: Record<string, unknown>) => {
            const cat = p.category as Record<string, unknown> | null
            return {
              id: String(p.id ?? ''), code: String(p.code ?? ''), name: String(p.name ?? ''),
              barcode: String(p.barcode ?? ''), price: Number(p.salesPriceTaxIncluded ?? 0),
              vatRate: Number(p.vatRate ?? 20), unit: String(p.mainUnitName ?? 'Adet'),
              stock: Number(p.stock ?? 0), category: String(cat?.name ?? 'Diğer'),
            }
          })
          results.products = await window.electron.db.syncProductsAcid(items, mode)
        } catch (e) {
          console.warn('[sync_all] ürün hatası:', e)
          results.products = failResult(String(e))
        }

        try {
          const workplaceId = localStorage.getItem('workplace_id') || null
          const groups = await fetchPluGroupsFromServer(d.companyId, workplaceId)
          const cacheRows = pluGroupsToCacheRows(groups, d.companyId, workplaceId)
          results.plu = await window.electron.db.syncPluGroupsAcid(cacheRows, mode)
          if (results.plu.success) {
            const cached = await window.electron.db.getPluGroups(d.companyId, workplaceId ?? undefined)
            d.onPluUpdated(cached)
          }
        } catch (e) {
          console.warn('[sync_all] PLU hatası:', e)
          results.plu = failResult(String(e))
        }

        try {
          const cashiers = await api.getCashiers(d.companyId)
          results.cashiers = await window.electron.db.syncCashiersAcid(cashiers, d.companyId, mode)
        } catch (e) {
          console.warn('[sync_all] kasiyer hatası:', e)
          results.cashiers = failResult(String(e))
        }

        try {
          const workplaceId = localStorage.getItem('workplace_id') || null
          const settings = await api.getPosSettings(d.companyId, workplaceId, d.terminalId)
          await window.electron.db.savePosSettings(settings)
          d.onSettingsUpdated(settings)
          results.settings = { success: true, inserted: 1, updated: 0, deleted: 0 }
        } catch (e) {
          console.warn('[sync_all] settings hatası:', e)
          results.settings = failResult(String(e))
        }

        const vals = Object.values(results)
        const successCount = vals.filter(r => r.success).length
        d.showToast(`Güncelleme tamamlandı (${successCount}/${vals.length} başarılı)`)
      } finally {
        d.setCommandSyncing(false)
      }
    },

    onSyncPrices: async () => {
      const data    = await api.getProducts(d.companyId)
      const rawList = data?.data?.data ?? []
      const local   = await window.electron.db.getProducts()
      const localMap = new Map(local.map(p => [p.id, p]))
      const changed = rawList
        .filter((p: Record<string, unknown>) => {
          const lp = localMap.get(String(p.id))
          return lp && lp.price !== Number(p.salesPriceTaxIncluded ?? 0)
        })
        .map((p: Record<string, unknown>) => {
          const cat = p.category as Record<string, unknown> | null
          return {
            id: String(p.id), code: String(p.code ?? ''), name: String(p.name ?? ''),
            barcode: String(p.barcode ?? ''), price: Number(p.salesPriceTaxIncluded ?? 0),
            vatRate: Number(p.vatRate ?? 20), unit: String(p.mainUnitName ?? 'Adet'),
            stock: Number(p.stock ?? 0), category: String(cat?.name ?? 'Diğer'),
          }
        })
      if (changed.length > 0) {
        const all = local.map(lp => changed.find((c: ProductRow) => c.id === lp.id) ?? lp)
        await window.electron.db.saveProducts(all)
      }
    },

    onSyncCashiers: async (mode: SyncMode = 'full') => {
      const cashiers = await api.getCashiers(d.companyId)
      const result = await window.electron.db.syncCashiersAcid(cashiers, d.companyId, mode)
      if (!result.success) throw new Error(result.error)
      d.showToast(`${result.inserted} kasiyer güncellendi`)
    },

    onLogout: () => d.onLogout(),

    onMessage: (text) => d.onShowMessage(text),

    onRestart: () => window.electron.app.restart(),

    onLock: (reason) => d.onLock(reason),

    onSyncPlu: async (mode: SyncMode = 'full') => {
      const workplaceId = localStorage.getItem('workplace_id') || null
      const groups = await fetchPluGroupsFromServer(d.companyId, workplaceId)
      const cacheRows = pluGroupsToCacheRows(groups, d.companyId, workplaceId)

      const result = await window.electron.db.syncPluGroupsAcid(cacheRows, mode)
      if (!result.success) throw new Error(result.error)

      const cached = await window.electron.db.getPluGroups(d.companyId, workplaceId ?? undefined)
      d.onPluUpdated(cached)
      d.showToast(`PLU güncellendi (${mode === 'full' ? 'tam' : 'fark'})`)
    },

    onSyncCustomers: async () => {
      const customers = await api.getCustomers(d.companyId)
      d.showToast(`${customers.length} cari güncellendi`)
    },

    onSyncProducts: async (mode: SyncMode = 'full') => {
      d.setCommandSyncing(true)
      try {
        const data    = await api.getProducts(d.companyId)
        const rawList = data?.data?.data ?? []
        const items: ProductRow[] = rawList.map((p: Record<string, unknown>) => {
          const cat = p.category as Record<string, unknown> | null
          return {
            id: String(p.id ?? ''), code: String(p.code ?? ''), name: String(p.name ?? ''),
            barcode: String(p.barcode ?? ''), price: Number(p.salesPriceTaxIncluded ?? 0),
            vatRate: Number(p.vatRate ?? 20), unit: String(p.mainUnitName ?? 'Adet'),
            stock: Number(p.stock ?? 0), category: String(cat?.name ?? 'Diğer'),
          }
        })
        const result = await window.electron.db.syncProductsAcid(items, mode)
        if (!result.success) throw new Error(result.error)
        d.showToast(`${result.inserted + result.updated} ürün güncellendi`)
      } finally {
        d.setCommandSyncing(false)
      }
    },

    onSyncSettings: async () => {
      const workplaceId = localStorage.getItem('workplace_id') || null
      const settings = await api.getPosSettings(d.companyId, workplaceId, d.terminalId)
      await window.electron.db.savePosSettings(settings)
      d.onSettingsUpdated(settings)
      d.showToast('Ayarlar güncellendi')
    },
  }
}
