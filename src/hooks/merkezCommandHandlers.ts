import { api, fetchPluGroupsFromServer } from '../lib/api'
import type { CommandHandlers, SyncMode } from './useCommandPoller'

async function getWorkplaceId(): Promise<string | null> {
  try {
    const val = await window.electron.store.get('workplace_id')
    return (typeof val === 'string' && val) ? val : null
  } catch {
    return null
  }
}

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

export function pluGroupsToCacheRows(
  groups: PluGroup[],
  companyId: string,
  workplaceId: string | null,
  terminalId?: string | null,
  cashierId?: string | null,
): PluGroupCacheRow[] {
  return groups.map((g, gi) => ({
    id:          g.id,
    companyId,
    workplaceId: workplaceId ?? undefined,
    terminalId:  terminalId  ?? undefined,
    cashierId:   cashierId   ?? undefined,
    name:        g.name,
    color:       g.color || '#90CAF9',
    sortOrder:   g.sort_order ?? gi,
    plu_items:   (g.plu_items ?? []).map((it, idx) => ({
      id:           String(it.id ?? '').length > 0 ? String(it.id) : `plu-${g.id}-${idx}-${it.product_code}`,
      product_code: it.product_code,
      sort_order:   it.sort_order ?? idx,
    })),
  }))
}

export interface MerkezCommandHandlerDeps {
  companyId:            string
  terminalId:           string
  getCashierId:         () => string | null
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

/**
 * PLU sync yardımcısı.
 * pluMode=cashier  -> SQLite'taki tüm kasiyerlerin PLU'larını ayrı ayrı çek ve yaz.
 *                    Giriş yapan kasiyerin PLU'sunu ekrana yansıt.
 * pluMode=terminal -> cashierId göndermeden terminal/firma bazlı çek ve yaz.
 */
async function syncPlu(
  companyId: string,
  workplaceId: string | null,
  terminalId: string,
  loggedInCashierId: string | null,
  mode: SyncMode,
): Promise<SyncResult> {
  const terminalSettings = await window.electron.db.getPosSettings()
  const pluMode = terminalSettings.pluMode

  if (pluMode === 'cashier') {
    const allCashiers = await window.electron.db.getAllCashiers()
    let anySuccess = false

    for (const cashier of allCashiers) {
      try {
        const groups = await fetchPluGroupsFromServer(companyId, workplaceId, terminalId, cashier.id)
        if (groups.length === 0) continue
        const cacheRows = pluGroupsToCacheRows(groups, companyId, workplaceId, terminalId, cashier.id)
        const result = await window.electron.db.syncPluGroupsAcid(cacheRows, mode)
        if (result.success) anySuccess = true
      } catch (e) {
        console.warn(`[syncPlu] kasiyer ${cashier.fullName} hatası:`, e)
      }
    }

    return { success: anySuccess, inserted: 0, updated: 0, deleted: 0 }
  }

  const groups = await fetchPluGroupsFromServer(companyId, workplaceId, terminalId, null)
  if (groups.length === 0) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş PLU listesi' }
  }
  const cacheRows = pluGroupsToCacheRows(groups, companyId, workplaceId, terminalId, null)
  return window.electron.db.syncPluGroupsAcid(cacheRows, mode)
}

async function refreshPluDisplay(
  companyId: string,
  workplaceId: string | null,
  loggedInCashierId: string | null,
  onPluUpdated: (groups: PluGroupCacheRow[]) => void,
): Promise<void> {
  const terminalSettings = await window.electron.db.getPosSettings()
  const cashierIdForDisplay = terminalSettings.pluMode === 'cashier' ? loggedInCashierId : null
  const cached = await window.electron.db.getPluGroups(companyId, workplaceId ?? undefined, cashierIdForDisplay)
  onPluUpdated(cached)
}

async function syncSettings(
  companyId: string,
  workplaceId: string | null,
  terminalId: string,
  cashierId: string | null,
  onSettingsUpdated: (s: PosSettingsRow) => void,
): Promise<SyncResult> {
  const terminalSettings = await api.getPosSettings(companyId, workplaceId, terminalId, null)
  const tResult = await window.electron.db.savePosSettings(terminalSettings, undefined)
  if (!tResult.success) return tResult

  if (cashierId) {
    const cashierSettings = await api.getPosSettings(companyId, workplaceId, terminalId, cashierId)
    await window.electron.db.savePosSettings(cashierSettings, cashierId)
    onSettingsUpdated(cashierSettings)
  } else {
    onSettingsUpdated(terminalSettings)
  }

  return { success: true, inserted: 1, updated: 0, deleted: 0 }
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
          const workplaceId = await getWorkplaceId()
          const loggedInCashierId = d.getCashierId()
          results.plu = await syncPlu(d.companyId, workplaceId, d.terminalId, loggedInCashierId, mode)
          await refreshPluDisplay(d.companyId, workplaceId, loggedInCashierId, d.onPluUpdated)
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
          const workplaceId = await getWorkplaceId()
          const cashierId   = d.getCashierId()
          results.settings = await syncSettings(
            d.companyId, workplaceId, d.terminalId, cashierId, d.onSettingsUpdated
          )
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
      const data     = await api.getProducts(d.companyId)
      const rawList  = data?.data?.data ?? []
      const local    = await window.electron.db.getProducts()
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
            syncedAt: new Date().toISOString(),
          }
        })

      if (changed.length > 0) {
        const merged = local.map((lp: ProductRow) => {
          const upd = changed.find((c: ProductRow) => c.id === lp.id)
          return upd ? { ...lp, ...upd } : lp
        })
        const result = await window.electron.db.syncProductsAcid(merged, 'diff')
        if (!result.success) throw new Error(result.error)
        d.showToast(`${changed.length} fiyat güncellendi`)
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
      const workplaceId       = await getWorkplaceId()
      const loggedInCashierId = d.getCashierId()
      const result = await syncPlu(d.companyId, workplaceId, d.terminalId, loggedInCashierId, mode)
      if (!result.success) throw new Error(result.error ?? 'PLU sync başarısız')
      await refreshPluDisplay(d.companyId, workplaceId, loggedInCashierId, d.onPluUpdated)
      d.showToast('PLU güncellendi')
    },

    onSyncCustomers: async (mode: SyncMode = 'full') => {
      const customers = await api.getCustomers(d.companyId)
      const result = await window.electron.db.syncCustomersAcid(customers, d.companyId, mode)
      if (!result.success) throw new Error(result.error ?? 'Cari sync hatası')
      d.showToast(`${result.inserted + result.updated} cari güncellendi`)
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
      const workplaceId = await getWorkplaceId()
      const cashierId   = d.getCashierId()
      const result = await syncSettings(
        d.companyId, workplaceId, d.terminalId, cashierId, d.onSettingsUpdated
      )
      if (!result.success) throw new Error(result.error)
      d.showToast('Ayarlar güncellendi')
    },
  }
}
