import { API_URL, api, fetchPluGroupsFromServer } from '../lib/api'
import { parseBarcodeFormatsResponse } from '../lib/barcodeFormat'
import { trCount, type CommandAckResult } from '../lib/commandResult'
import { decideUpdateCommand } from '../lib/updateCommand'
import { parseSettingsBundle } from '../lib/settingsModel'
import { enqueuePaymentDeviceBackup } from '../lib/localSettings'
import { refreshPosReady } from '../store/posReady'
import type { CommandHandlers, SyncMode } from './useCommandPoller'
import { postDailySummary, postDayEndStatus } from '../lib/dayEndApi'

async function getWorkplaceId(): Promise<string | null> {
  try {
    const val = await window.electron.store.get('workplace_id')
    return (typeof val === 'string' && val) ? val : null
  } catch {
    return null
  }
}

export const noopCommandHandlers: CommandHandlers = {
  onSyncAll:            async () => {},
  onSyncPrices:         async () => {},
  onSyncCashiers:       async () => {},
  onSyncPlu:            async () => {},
  onSyncCustomers:      async () => {},
  onSyncProducts:       async () => {},
  onSyncSettings:       async () => {},
  onSyncTemplates:      async () => {},
  onSyncPaymentBrands:  async () => {},
  onPairPavo:           async () => {},
  onLogout:             () => {},
  onMessage:            () => {},
  onRestart:            () => {},
  onLock:               () => {},
  onUpdateApp:          async () => {},
  onDayEndRun:          async () => {},
  onDayEndRetry:        async () => {},
  onDayEndRelease:      async () => {},
}

export function pluGroupsToCacheRows(
  groups: PluGroup[],
  companyId: string,
  workplaceId: string | null,
  _terminalId?: string | null,
  cashierId?: string | null,
): PluGroupCacheRow[] {
  return groups.map((g, gi) => ({
    id:          g.id,
    companyId,
    workplaceId: workplaceId ?? undefined,
    // terminal_id artık kullanılmıyor — kasiyer bazlı PLU
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
  onSettingsUpdated:    () => void
  onLock:               (reason?: string) => void
  showToast:            (msg: string) => void
  onPluUpdated:         (groups: PluGroupCacheRow[]) => void
  onEnabledBrandsUpdated?: (brands: PaymentProviderBrand[]) => void
  onBarcodeFormatsUpdated?: (formats: BarcodeFormatRow[]) => void
  onAdminUpdate?:       () => void
}

function failResult(msg: string): SyncResult {
  return { success: false, inserted: 0, updated: 0, deleted: 0, error: msg }
}

/**
 * PLU sync yardımcısı — kasiyer bazlı.
 * SQLite'taki tüm kasiyerlerin PLU'larını ayrı ayrı çek ve yaz.
 */
async function syncPlu(
  companyId: string,
  workplaceId: string | null,
  terminalId: string,
  _loggedInCashierId: string | null,
  _mode: SyncMode,
): Promise<SyncResult> {
  /** Merkez `diff` gönderse bile PLU tam liste kabul edilir; diff dalı eski grupları silmediği için her zaman full senkron. */
  const pluSyncMode: SyncMode = 'full'
  const allCashiers = await window.electron.db.getAllCashiers()
  let anySuccess = false
  let groupCount = 0
  let keyCount = 0

  for (const cashier of allCashiers) {
    try {
      const groups = await fetchPluGroupsFromServer(
        companyId, workplaceId, terminalId, cashier.id,
      )
      if (groups.length === 0) continue
      const cacheRows = pluGroupsToCacheRows(
        groups, companyId, workplaceId, terminalId, cashier.id,
      )
      const result = await window.electron.db.syncPluGroupsAcid(cacheRows, pluSyncMode)
      if (result.success) {
        anySuccess = true
        groupCount += groups.length
        keyCount += groups.reduce((sum, g) => sum + (g.plu_items?.length ?? 0), 0)
      }
    } catch (e) {
      console.warn(`[syncPlu] kasiyer ${cashier.fullName} hatası:`, e)
    }
  }

  return {
    success: anySuccess,
    inserted: groupCount,
    updated: keyCount,
    deleted: 0,
    error: anySuccess ? undefined : 'Boş PLU listesi — sync iptal',
  }
}

async function refreshPluDisplay(
  companyId: string,
  workplaceId: string | null,
  loggedInCashierId: string | null,
  onPluUpdated: (groups: PluGroupCacheRow[]) => void,
): Promise<void> {
  const cashierIdForDisplay = loggedInCashierId
  const cached = await window.electron.db.getPluGroups(companyId, workplaceId ?? undefined, cashierIdForDisplay)
  onPluUpdated(cached)
}

export async function syncCashierPluOnLogin(
  companyId:   string,
  workplaceId: string | null,
  terminalId:  string,
  cashierId:   string,
): Promise<PluGroupCacheRow[]> {
  try {
    const groups = await Promise.race([
      fetchPluGroupsFromServer(companyId, workplaceId, terminalId, cashierId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PLU yükleme zaman aşımı')), 8000),
      ),
    ])

    if (groups.length > 0) {
      await window.electron.db.deleteCashierPluForTerminal(terminalId)
      const cacheRows = pluGroupsToCacheRows(
        groups, companyId, workplaceId, terminalId, cashierId,
      )
      await window.electron.db.syncPluGroupsAcid(cacheRows, 'full')
    } else {
      console.warn('[login] Kasiyer için PLU bulunamadı, eski cache kullanılacak:', cashierId)
    }
  } catch (e) {
    console.warn('[login] PLU API hatası, eski cache kullanılacak:', e)
  }

  return window.electron.db.getPluGroups(companyId, workplaceId ?? undefined, cashierId)
}

async function syncSettings(
  companyId: string,
  _workplaceId: string | null,
  terminalId: string,
  _cashierId: string | null,
  onSettingsUpdated: () => void,
  onBarcodeFormatsUpdated?: (formats: BarcodeFormatRow[]) => void,
): Promise<SyncResult> {
  const url = `${API_URL}/pos/settings/${terminalId}`
  console.log('[sync_settings] url:', url)
  const http = await fetch(url)
  if (!http.ok) {
    const body = await http.text().catch(() => '')
    throw new Error(`Ayar sync HTTP ${http.status}: ${body.slice(0, 200)}`)
  }
  const res = await http.json() as Record<string, unknown>
  const payload = res.data && typeof res.data === 'object' && !Array.isArray(res.data)
    && ((res.data as Record<string, unknown>).terminal || (res.data as Record<string, unknown>).terminal_info)
    ? res.data as Record<string, unknown>
    : res
  console.log(
    '[sync_settings] terminal:', JSON.stringify(payload.terminal),
    'info:', JSON.stringify(payload.terminal_info),
  )
  const bundle = parseSettingsBundle(res)
  const tResult = await window.electron.db.syncSettingsBundle(bundle, terminalId)
  if (!tResult.success) throw new Error(tResult.error || 'Ayarlar terminal_settings_cache tablosuna yazılamadı')
  const saved = await window.electron.db.getTerminalSettings()
  console.log('[sync_settings] SQLite:', saved)
  await window.electron.display.apply(Boolean(saved.customerDisplay))
  await window.electron.devtools.refresh()
  onSettingsUpdated()
  if (bundle.barcodeFormats) {
    onBarcodeFormatsUpdated?.(parseBarcodeFormatsResponse(bundle.barcodeFormats))
  }

  const localPavo = await window.electron.db.hasLocalPaymentDevice('pavo')
  if (!localPavo) {
    const paymentDevices = await api.getPaymentDeviceSettings(companyId, terminalId)
    if (paymentDevices && paymentDevices.length > 0) {
      for (const device of paymentDevices) {
        await window.electron.db.upsertPaymentDeviceSettings({
          id:              device.id,
          companyId:       device.company_id,
          terminalId:      device.terminal_id,
          provider:        device.provider,
          ipAddress:       device.ip_address ?? null,
          port:            device.port ?? 9100,
          serialNo:        device.serial_no ?? null,
          cardReadTimeout: device.card_read_timeout ?? 30,
          printWidth:      device.print_width ?? '80mm',
          isActive:        device.is_active ?? true,
          syncedAt:        new Date().toISOString(),
        })
      }
    }
  } else {
    const local = await window.electron.db.getPaymentDeviceSettings('pavo')
    const cloud = await api.getPaymentDeviceSettings(companyId, terminalId).catch(() => [])
    const cloudHas = Array.isArray(cloud) && cloud.some(d => d?.ip_address)
    if (local?.ipAddress && local.isActive && !cloudHas) {
      await enqueuePaymentDeviceBackup({
        provider: 'pavo',
        ip_address: local.ipAddress,
        port: local.port,
        serial_no: local.serialNo,
        card_read_timeout: local.cardReadTimeout,
        print_width: local.printWidth,
        updated_from: 'pos',
        last_paired_at: local.lastPairedAt ?? null,
        is_active: true,
      })
    }
  }

  try {
    const unitMappings = await fetch(
      `${API_URL}/unit-mappings/${companyId}`,
    ).then(r => r.json()) as Array<{ unit_name: string; pavo_code: string }>

    for (const m of unitMappings) {
      await window.electron.db.upsertUnitMapping({
        companyId,
        unitName: m.unit_name,
        pavoCode: m.pavo_code,
      })
    }
  } catch (e) {
    console.warn('[sync_settings] unit mapping hatası:', e)
  }

  if (saved.torbaCariId?.trim()) {
    try {
      const retried = await window.electron.db.retryOperationsByErrorPrefix(
        companyId,
        'TORBA_CARI_YOK',
      )
      if (retried > 0) {
        console.log(`[sync_settings] ${retried} TORBA_CARI_YOK kaydı yeniden kuyruğa alındı`)
      }
    } catch (e) {
      console.warn('[sync_settings] torba kuyruk retry:', e)
    }
  }

  await refreshPosReady()

  return { success: true, inserted: 1, updated: 0, deleted: 0 }
}

async function sendReleasedSummaries(companyId: string, terminalId: string, days: string[]): Promise<void> {
  for (const day of days) {
    const summary = await window.electron.db.buildDailySummary(day)
    if (!summary) continue
    await postDailySummary({ ...summary, company_id: companyId, terminal_id: terminalId })
  }
}

export function buildMerkezCommandHandlers(d: MerkezCommandHandlerDeps): CommandHandlers {
  return {
    onSyncAll: async (mode: SyncMode = 'full') => {
      d.setCommandSyncing(true)
      try {
        const results: Record<string, SyncResult> = {
          products:       failResult(''),
          plu:            failResult(''),
          cashiers:       failResult(''),
          settings:       failResult(''),
          paymentBrands:  failResult(''),
          barcodeFormats: failResult(''),
        }

        try {
          const data = await api.getProducts(d.companyId)
          const rawList = data?.data?.data ?? []
          const items: ProductRow[] = rawList.map((p: Record<string, unknown>) => {
            const cat = p.category as Record<string, unknown> | null
            return {
              id: String(p.id ?? ''), code: String(p.code ?? ''), name: String(p.name ?? ''),
              barcode:          String(p.barcode ?? ''),
              price:            Number(p.salesPriceTaxIncluded ?? 0),
              vatRate:          Number(p.vatRate ?? 20),
              unit:             String(p.mainUnitName ?? 'Adet'),
              stock: Number(p.stock ?? 0), category: String(cat?.name ?? 'Diğer'),
              modificationDate: p.modificationDate != null ? String(p.modificationDate) : null,
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
            d.companyId, workplaceId, d.terminalId, cashierId, d.onSettingsUpdated,
            d.onBarcodeFormatsUpdated,
          )
        } catch (e) {
          console.warn('[sync_all] settings hatası:', e)
          results.settings = failResult(String(e))
        }

        try {
          const token = await window.electron.store.get('token').catch(() => null) as string | null
          const r = await fetch(`${API_URL}/payment-provider-brands/enabled/${d.terminalId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
          if (r.ok) {
            const brands = await r.json() as PaymentProviderBrand[]
            const list = Array.isArray(brands) ? brands : []
            await window.electron.db.saveEnabledBrands(d.terminalId, list)
            d.onEnabledBrandsUpdated?.(list)
            results.paymentBrands = { success: true, inserted: list.length, updated: 0, deleted: 0 }
          }
        } catch (e) {
          console.warn('[sync_all] payment brands hatası:', e)
          results.paymentBrands = failResult(String(e))
        }

        try {
          const token = await window.electron.store.get('token').catch(() => null) as string | null
          const r = await fetch(`${API_URL}/barcode-formats/${d.terminalId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
          if (r.ok) {
            const list = parseBarcodeFormatsResponse(await r.json())
            await window.electron.db.saveBarcodeFormats(d.terminalId, list)
            d.onBarcodeFormatsUpdated?.(list)
            results.barcodeFormats = { success: true, inserted: list.length, updated: 0, deleted: 0 }
          }
        } catch (e) {
          console.warn('[sync_all] barkod format hatası:', e)
          results.barcodeFormats = failResult(String(e))
        }

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
            barcode:          String(p.barcode ?? ''),
            price:            Number(p.salesPriceTaxIncluded ?? 0),
            vatRate:          Number(p.vatRate ?? 20),
            unit:             String(p.mainUnitName ?? 'Adet'),
            stock: Number(p.stock ?? 0), category: String(cat?.name ?? 'Diğer'),
            modificationDate: p.modificationDate != null ? String(p.modificationDate) : null,
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
      }
      return { count: changed.length, message: `${trCount(changed.length)} fiyat güncellendi` }
    },

    onSyncCashiers: async (mode: SyncMode = 'full') => {
      const cashiers = await api.getCashiers(d.companyId)
      const result = await window.electron.db.syncCashiersAcid(cashiers, d.companyId, mode)
      if (!result.success) throw new Error(result.error)
      return { count: cashiers.length, message: `${trCount(cashiers.length)} kasiyer` }
    },

    onLogout: () => d.onLogout(),

    onMessage: (text) => {
      d.onShowMessage(text)
      return { message: 'Kasiyere gösterildi' }
    },

    onRestart: () => window.electron.app.restart(),

    onLock: (reason) => d.onLock(reason),

    onSyncPlu: async (mode: SyncMode = 'full') => {
      const workplaceId       = await getWorkplaceId()
      const loggedInCashierId = d.getCashierId()
      const result = await syncPlu(d.companyId, workplaceId, d.terminalId, loggedInCashierId, mode)
      if (!result.success) throw new Error(result.error ?? 'PLU sync başarısız')
      await refreshPluDisplay(d.companyId, workplaceId, loggedInCashierId, d.onPluUpdated)
      return {
        count: result.inserted,
        message: `${trCount(result.inserted)} grup, ${trCount(result.updated)} tuş`,
      }
    },

    onSyncCustomers: async (mode: SyncMode = 'full') => {
      const customers = await api.getCustomers(d.companyId)
      const result = await window.electron.db.syncCustomersAcid(customers, d.companyId, mode)
      if (!result.success) throw new Error(result.error ?? 'Cari sync hatası')
      return { count: customers.length, message: `${trCount(customers.length)} cari güncellendi` }
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
            barcode:          String(p.barcode ?? ''),
            price:            Number(p.salesPriceTaxIncluded ?? 0),
            vatRate:          Number(p.vatRate ?? 20),
            unit:             String(p.mainUnitName ?? 'Adet'),
            stock: Number(p.stock ?? 0), category: String(cat?.name ?? 'Diğer'),
            modificationDate: p.modificationDate != null ? String(p.modificationDate) : null,
          }
        })
        const result = await window.electron.db.syncProductsAcid(items, mode)
        if (!result.success) throw new Error(result.error)
        return { count: items.length, message: `${trCount(items.length)} ürün güncellendi` }
      } finally {
        d.setCommandSyncing(false)
      }
    },

    onSyncSettings: async () => {
      const workplaceId = await getWorkplaceId()
      const cashierId   = d.getCashierId()
      await syncSettings(
        d.companyId, workplaceId, d.terminalId, cashierId, d.onSettingsUpdated,
        d.onBarcodeFormatsUpdated,
      )
      return { message: 'Ayarlar uygulandı' }
    },

    onSyncPaymentBrands: async () => {
      const token = await window.electron.store.get('token').catch(() => null) as string | null
      const r = await fetch(`${API_URL}/payment-provider-brands/enabled/${d.terminalId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!r.ok) throw new Error(`ERP bağlantısı yok`)
      const brands = await r.json() as PaymentProviderBrand[]
      const list = Array.isArray(brands) ? brands : []
      await window.electron.db.saveEnabledBrands(d.terminalId, list)
      d.onEnabledBrandsUpdated?.(list)
      return { count: list.length, message: `${trCount(list.length)} ödeme tipi` }
    },

    onSyncTemplates: async () => {
      console.log('[sync_templates] başladı, companyId:', d.companyId)
      try {
        const templates = await api.getTemplates(d.companyId)
        console.log('[sync_templates] API yanıtı, adet:', templates.length)
        const saveResult = await window.electron.templates.save(templates)
        console.log(`[sync_templates] ${saveResult.count} şablon kasada`)
        const summary: CommandAckResult = {
          count: saveResult.count,
          message: `${trCount(saveResult.count)} şablon (${trCount(saveResult.deleted ?? 0)} silindi)`,
        }
        return summary
      } catch (e) {
        console.error('[sync_templates] hata:', e)
        throw e
      }
    },

    onPairPavo: async () => {
      console.log('[pair_pavo] Pavo eşleştirmesi artık kasadan yapılıyor')
    },

    onUpdateApp: async (payload, ctx) => {
      const version = String(payload.version ?? '')
      const baseUrl = String(payload.base_url ?? '')
      const releaseId = String(payload.release_id ?? '')
      if (!version || !baseUrl || !releaseId) throw new Error('Güncelleme komutu eksik')
      const current = await window.electron.update.getVersion()
      const rawMap = await window.electron.store.get('versionInstalledAt')
      const map = rawMap && typeof rawMap === 'object' ? rawMap as Record<string, string> : {}
      const installedAt = typeof map[current] === 'string' ? map[current] : null
      const decision = decideUpdateCommand({
        version,
        current,
        installedAt,
        createdAt: ctx.createdAt,
        targetId: ctx.targetId,
        batch: ctx.batch,
      })
      if (decision.action === 'done') return { message: decision.message }
      const mode = payload.mode === 'on_close' ? 'on_close' : 'prompt'
      await window.electron.store.set('pendingAdminUpdate', {
        release_id: releaseId,
        version,
        base_url: baseUrl,
        schema_version: payload.schema_version != null ? Number(payload.schema_version) : undefined,
        mode,
        is_mandatory: payload.is_mandatory === true || payload.is_mandatory === 1 || payload.is_mandatory === '1',
        created_at: ctx.createdAt || undefined,
        requested_name: ctx.requestedName,
      })
      d.onAdminUpdate?.()
      window.dispatchEvent(new Event('btpos-admin-update'))
    },

    onDayEndRun: async (payload) => {
      const runId = String(payload.run_id ?? '').trim()
      if (!runId) throw new Error('Gün sonu komutunda run_id yok')
      const prior = await window.electron.db.dayEndRunStatus(runId)
      if (prior === 'completed' || prior === 'released' || prior === 'failed') {
        return { message: 'Bu gün sonu zaten sonuçlanmış' }
      }
      const rangeStart = String(payload.range_start ?? '')
      const rangeEnd = String(payload.range_end ?? '')
      if (!rangeStart || !rangeEnd) throw new Error('Gün sonu aralığı yok')
      const input = {
        companyId: d.companyId,
        terminalId: d.terminalId,
        runId,
        rangeStart,
        rangeEnd,
        rangeLabel: String(payload.range_label ?? ''),
        invoiceMode: payload.invoice_mode != null ? String(payload.invoice_mode) : undefined,
        terminalNo: payload.terminal_no != null ? String(payload.terminal_no) : undefined,
      }
      const probe = await window.electron.db.applyDayEndRun(input)
      if (probe.rejected) {
        await postDayEndStatus(runId, { status: 'rejected', problems: probe.problems })
        await window.electron.db.markDayEndRunStatus(runId, 'rejected')
        return {
          message: 'Gönderilmedi',
          historyStatus: 'rejected',
          problems: probe.problems,
        }
      }
      if (probe.empty) {
        await postDayEndStatus(runId, { status: 'completed_empty' })
        await window.electron.db.markDayEndRunStatus(runId, 'completed_empty')
        return { message: 'Bu aralıkta gönderilecek satış yok' }
      }
      await postDayEndStatus(runId, { status: 'processing', docs_total: probe.docsTotal, docs_sent: 0 })
      await window.electron.db.markDayEndProgress(runId, probe.docsTotal, 0)
      window.dispatchEvent(new Event('btpos-process-queue'))
      return {
        count: probe.saleCount + probe.refundCount,
        message: `${probe.saleCount} satış, ${probe.refundCount} iade kuyruğa alındı`,
      }
    },

    onDayEndRetry: async (payload) => {
      const runId = String(payload.run_id ?? '').trim()
      if (!runId) throw new Error('Gün sonu yeniden denemesinde run_id yok')
      const result = await window.electron.db.rebuildDayEndRetry(d.companyId, runId)
      if (!result.ok) {
        const error = result.problems.map(problem => problem.message).join('\n')
        await postDayEndStatus(runId, { status: 'failed', error, problems: result.problems })
        await window.electron.db.markDayEndRunStatus(runId, 'failed')
        return { message: error || 'Gün sonu yeniden kurulamadı' }
      }
      if (result.pending === 0) {
        window.dispatchEvent(new Event('btpos-process-queue'))
        return { message: 'Yeniden denenecek satır yok' }
      }
      const snap = await window.electron.db.dayEndProgress(runId)
      await postDayEndStatus(runId, {
        status: 'processing',
        docs_total: snap.docsTotal,
        docs_sent: snap.docsSent,
      })
      await window.electron.db.markDayEndProgress(runId, snap.docsTotal, snap.docsSent)
      window.dispatchEvent(new Event('btpos-process-queue'))
      return { message: 'Gün sonu yeniden kuyruğa alındı', count: result.pending }
    },

    onDayEndRelease: async (payload) => {
      const runId = String(payload.run_id ?? '').trim()
      if (!runId) throw new Error('Gün sonu iptalinde run_id yok')
      const prior = await window.electron.db.dayEndRunStatus(runId)
      if (prior === 'released') {
        await sendReleasedSummaries(d.companyId, d.terminalId, await window.electron.db.dayEndSummaryDays(runId))
        return { message: 'Satışlar zaten serbest' }
      }
      const started = Date.now()
      while (Date.now() - started < 60_000) {
        const busy = await window.electron.db.countDayEndProcessing(runId)
        if (busy === 0) break
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      const busy = await window.electron.db.countDayEndProcessing(runId)
      if (busy > 0) throw new Error('Gün sonu belgesi hâlâ gönderiliyor')
      const released = await window.electron.db.releaseDayEndRun(runId)
      await postDayEndStatus(runId, { status: 'released' })
      await sendReleasedSummaries(d.companyId, d.terminalId, released.days)
      return { message: 'Satışlar yeniden gün sonuna alınabilir' }
    },
  }
}
