export type LocalCustomerKey = { id: string; taxNo: string; erpId: string }
export type IncomingCustomerKey = { id: string; taxNo: string; erpId: string }

export type CustomerSyncRepair = {
  deleteIds: string[]
  erpUpdates: { id: string; erpId: string }[]
}

function digits(s: string): string {
  return s.replace(/\D/g, '')
}

/**
 * Vergi no ile eşleşen yerel satırın erp_id'si düzeltilir.
 * Eşleşmeyen ve erp_id'si boş yerel satırlar silinir.
 * Eşleşen ama PK'si İşbaşı id'sinden farklı satır da silinir (çift satır kalmasın).
 */
export function planCustomerSyncRepair(
  locals: LocalCustomerKey[],
  incoming: IncomingCustomerKey[],
): CustomerSyncRepair {
  const byTax = new Map<string, { id: string; erpId: string }>()
  for (const row of incoming) {
    const tax = digits(row.taxNo)
    const erpId = row.erpId.trim()
    if (tax.length >= 10 && erpId) byTax.set(tax, { id: row.id, erpId })
  }
  const deleteIds: string[] = []
  const erpUpdates: { id: string; erpId: string }[] = []
  for (const local of locals) {
    const tax = digits(local.taxNo)
    const hit = tax.length >= 10 ? byTax.get(tax) : undefined
    const erpId = local.erpId.trim()
    if (hit) {
      if (local.id !== hit.id) deleteIds.push(local.id)
      else if (erpId !== hit.erpId) erpUpdates.push({ id: local.id, erpId: hit.erpId })
    } else if (!erpId) {
      deleteIds.push(local.id)
    }
  }
  return { deleteIds, erpUpdates }
}
