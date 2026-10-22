import { isbasiIdOf } from './queueCustomerPatch'

export type DayEndProblemCode =
  | 'TORBA_CARI_YOK'
  | 'CARI_ERP_EKSIK'
  | 'NAKIT_HESAP_YOK'
  | 'BANKA_HESAP_YOK'
  | 'ODEME_HESAP_YOK'
  | 'KALEM_EKSIK'

export interface DayEndProblem {
  code: DayEndProblemCode
  message: string
}

export interface PrecheckSale {
  receiptNo: string
  customerName: string
  customerId: string | null
  hasErp: boolean
}

export interface PrecheckTender {
  method: string
  acquirerId: string | null
  acquirerName: string
  accountMatched: boolean
}

export interface PrecheckLine {
  receiptNo: string
  name: string
  productCode: string
  unit: string
  vatRate: number | null
}

export function fisLabel(receiptNo: string): string {
  const raw = String(receiptNo ?? '').trim()
  if (/^\d+$/.test(raw)) return raw.padStart(4, '0')
  return raw || '—'
}

export function hasIsbasiId(row: { id?: string | null; erpId?: string | null } | null | undefined): boolean {
  return isbasiIdOf(row ?? {}) !== ''
}

export function torbaMissingProblem(code: string): DayEndProblem {
  const shown = code.trim() || '—'
  return {
    code: 'TORBA_CARI_YOK',
    message: `Torba cari (${shown}) kasada yok. Yönetim panelinden müşteri listesini kasaya gönderin.`,
  }
}

export function cariMissingProblem(receiptNo: string, name: string): DayEndProblem {
  const who = name.trim() || 'Cari'
  return {
    code: 'CARI_ERP_EKSIK',
    message: `Fiş ${fisLabel(receiptNo)}: ${who} carisinin ERP kaydı yok.`,
  }
}

export function cashAccountProblem(): DayEndProblem {
  return { code: 'NAKIT_HESAP_YOK', message: 'Nakit kasa hesabı eşlenmemiş.' }
}

export function bankAccountProblem(name: string, acquirerId: string): DayEndProblem {
  const label = name.trim() || 'Banka'
  const id = acquirerId.trim() || '—'
  return { code: 'BANKA_HESAP_YOK', message: `${label} (${id}) için banka hesabı eşlenmemiş.` }
}

export function otherAccountProblem(name: string): DayEndProblem {
  const label = name.trim() || 'Ödeme'
  return { code: 'ODEME_HESAP_YOK', message: `${label} için hesap eşlenmemiş.` }
}

export function lineMissingProblem(receiptNo: string, productName: string, kind: 'code' | 'unit' | 'vat'): DayEndProblem {
  const name = productName.trim() || 'Ürün'
  const tail = kind === 'code' ? 'ürün kodu yok' : kind === 'unit' ? 'birimi yok' : 'KDV oranı yok'
  return { code: 'KALEM_EKSIK', message: `Fiş ${fisLabel(receiptNo)}: '${name}' ${tail}.` }
}

/** Satış bağlanmadan önce toplanan sorunlar. Aynı mesaj bir kez yazılır. */
export function collectDayEndProblems(input: {
  needsTorba: boolean
  torbaCode: string
  torbaReady: boolean
  sales: PrecheckSale[]
  tenders: PrecheckTender[]
  lines: PrecheckLine[]
}): DayEndProblem[] {
  const problems: DayEndProblem[] = []
  const seen = new Set<string>()
  const add = (problem: DayEndProblem) => {
    if (seen.has(problem.message)) return
    seen.add(problem.message)
    problems.push(problem)
  }

  if (input.needsTorba && !input.torbaReady) add(torbaMissingProblem(input.torbaCode))

  for (const sale of input.sales) {
    if (!sale.customerId) continue
    if (!sale.hasErp) add(cariMissingProblem(sale.receiptNo, sale.customerName))
  }

  let cashMissing = false
  for (const tender of input.tenders) {
    if (tender.accountMatched) continue
    if (tender.method === 'cash') {
      cashMissing = true
      continue
    }
    if (tender.method === 'card') {
      add(bankAccountProblem(tender.acquirerName, tender.acquirerId ?? ''))
      continue
    }
    add(otherAccountProblem(tender.acquirerName || tender.method))
  }
  if (cashMissing) add(cashAccountProblem())

  for (const line of input.lines) {
    if (!line.productCode.trim()) add(lineMissingProblem(line.receiptNo, line.name, 'code'))
    if (!line.unit.trim()) add(lineMissingProblem(line.receiptNo, line.name, 'unit'))
    if (line.vatRate == null || !Number.isFinite(line.vatRate)) add(lineMissingProblem(line.receiptNo, line.name, 'vat'))
  }

  return problems
}

/** Aralık etiketinden ilk gün: 21.10.2026 */
export function dayEndDayLabel(rangeLabel: string): string {
  const match = rangeLabel.match(/\d{2}\.\d{2}\.\d{4}/)
  return match?.[0] ?? ''
}

export function dayEndProgressCaption(rangeLabel: string, sent: number, total: number): string {
  const day = dayEndDayLabel(rangeLabel)
  const head = day ? `Gün sonu ${day}` : 'Gün sonu'
  return `${head} · ${sent}/${total} gönderildi`
}
