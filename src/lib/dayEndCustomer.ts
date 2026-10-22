import {
  cariMissingProblem,
  hasIsbasiId,
  torbaMissingProblem,
} from './dayEndPrecheck'
import {
  QueueCustomerError,
  customerRowToInvoicePayload,
  inferCustomerRef,
} from './queueCustomer'
import { customerErpNumber } from './queueCustomerPatch'

/** Gün sonu gövdesine güncel torba veya cari yazar. Deneme sayısını değiştirmez. */
export async function refreshDayEndCustomer(
  companyId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ref = inferCustomerRef(payload)
  if (ref.type === 'customer') {
    const row = await window.electron.db.getCustomerById(companyId, ref.id)
    if (!hasIsbasiId(row)) {
      const problem = cariMissingProblem(
        String(payload.receipt_no ?? ''),
        String(payload.customer_name ?? row?.name ?? ''),
      )
      throw new QueueCustomerError(problem.code, problem.message)
    }
    return {
      ...payload,
      customer: customerRowToInvoicePayload(row!),
      customer_erp_id: customerErpNumber(row!),
      customer_ref: { type: 'customer', id: row!.id },
      customer_name: row!.name,
    }
  }

  const settings = await window.electron.db.getTerminalSettings()
  const code = settings.torbaCariId?.trim() ?? ''
  const found = code ? await window.electron.db.getCustomerByCode(companyId, code) : null
  if (!hasIsbasiId(found)) {
    const problem = torbaMissingProblem(code)
    throw new QueueCustomerError(problem.code, problem.message)
  }
  return {
    ...payload,
    customer: customerRowToInvoicePayload(found!),
    customer_erp_id: customerErpNumber(found!),
    customer_ref: { type: 'torba' },
  }
}
