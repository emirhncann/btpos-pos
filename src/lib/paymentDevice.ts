// Tum odeme cihazlari icin normalize sonuc tipi

/** Pavo'dan dönen başarılı ödeme satırı (normalize) */
export interface PavoFinalPayment {
  mediator: number
  brand?:   number
  amount:   number
}

/** GetSaleResult / CompleteSale cevabının normalize hali */
export interface PavoFinalSale {
  statusId:      number | null
  invoiceNo:     string | null
  documentUuid:  string | null
  saleUid:       string | null
  saleNumber:    string | null
  inquiryLink:   string | null
  authCode:      string | null
  cardNo:        string | null
  acquirer:      string | null
  acquirerId:    string | null
  batchNo:       string | null
  isOffline:     boolean
  payments:      PavoFinalPayment[]
  raw:           Record<string, unknown>
}

export interface PaymentDeviceResult {
  success: boolean
  provider: 'pavo' | 'ingenico' | 'pax' | string
  errorCode?: number | string
  message?: string
  authCode?: string
  cardNo?: string
  cardBrand?: string
  cardType?: string
  acquirer?: string
  batchNo?: string
  isOffline?: boolean
  receiptUrl?: string
  /** E-belge / fiş barkodu alanları */
  invoiceNo?: string | null
  documentUuid?: string | null
  saleUid?: string | null
  inquiryLink?: string | null
  saleNumber?: string | null
  /** SADECE başarılı Pavo ödemeleri */
  payments?: PavoFinalPayment[]
  raw: Record<string, unknown>
}

function parseAdditionalData(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function pick<T = unknown>(obj: unknown, ...paths: string[]): T | undefined {
  for (const p of paths) {
    const v = p.split('.').reduce((o: unknown, k: string) => {
      if (o == null || typeof o !== 'object') return undefined
      return (o as Record<string, unknown>)[k]
    }, obj)
    if (v !== undefined && v !== null && v !== '') return v as T
  }
  return undefined
}

/** Pavo AddedPayments: StatusId 1 = WaitingPayment (sayılmaz), 2 = Tamamlandı */
export function isSuccessfulPavoPayment(p: unknown, _isOfflineSale = false): boolean {
  void _isOfflineSale // StatusId 1 asla başarılı sayılmaz (offline dahil)
  const row = (p ?? {}) as Record<string, unknown>
  if (Number(row.StatusId) !== 2) return false
  if (row.OperationTypeId != null && Number(row.OperationTypeId) !== 1) return false
  if (row.IsCancelled === true || row.IsVoid === true || row.IsRefunded === true) return false
  return Number(row.PaymentAmount ?? row.Amount ?? 0) > 0
}

/**
 * GetSaleResult / CompleteSale / CompleteUncompletedSale cevabını tek yapıya indirger.
 * Canlı log (23.09): InvoiceNo → FinancialDocuments[0], kart → AddedPayments.OnlinePayment
 */
export function normalizePavoSaleResult(data: unknown): PavoFinalSale {
  const d = (data ?? {}) as Record<string, unknown>
  const sale =
    pick<Record<string, unknown>>(d, 'Data.Sale', 'Sale', 'Data', 'Result.Sale') ?? d

  const isOffline = Boolean(
    pick(sale, 'IsOffline') ?? pick(d, 'Data.IsOffline', 'IsOffline'),
  )

  // AddedPayments ilk sırada (GetSaleResult / CompleteSale gerçek alan adı)
  const rawPayments: unknown[] =
    pick<unknown[]>(sale, 'AddedPayments', 'PaymentInformations', 'Payments', 'SalePayments') ??
    pick<unknown[]>(d, 'Data.AddedPayments', 'Data.PaymentInformations', 'AddedPayments', 'PaymentInformations') ??
    []

  const successful = rawPayments.filter(p => isSuccessfulPavoPayment(p))
  const firstCard = successful.find(p => {
    const row = p as Record<string, unknown>
    return row.OnlinePayment != null && typeof row.OnlinePayment === 'object'
  }) as Record<string, unknown> | undefined

  const docs =
    pick<Record<string, unknown>[]>(sale, 'FinancialDocuments') ??
    pick<Record<string, unknown>[]>(d, 'Data.FinancialDocuments') ??
    []
  const firstDoc = (Array.isArray(docs) && docs[0]) ? docs[0] : {}

  const invoiceNo =
    pick<string>(firstDoc, 'InvoiceNo') ??
    pick<string>(sale, 'InvoiceNo', 'DocumentNo', 'EDocumentNo', 'Invoice.InvoiceNo') ??
    pick<string>(d, 'Data.InvoiceNo', 'Data.DocumentNo') ??
    null
  const documentUuid =
    pick<string>(firstDoc, 'DocumentNo') ??
    null
  const saleUid =
    pick<string>(sale, 'SaleUid', 'UUID', 'Uuid', 'Invoice.Uuid') ??
    pick<string>(d, 'Data.SaleUid', 'Data.UUID') ??
    (documentUuid != null ? String(documentUuid) : null)
  const inquiryLink =
    pick<string>(sale, 'SaleInquieryLink', 'InquiryLink', 'EDocumentLink', 'Invoice.InquiryLink') ??
    pick<string>(d, 'Data.SaleInquieryLink', 'Data.InquiryLink', 'Data.EDocumentLink') ??
    null
  const saleNumber =
    pick<string>(sale, 'SaleNumber') ??
    pick<string>(d, 'Data.SaleNumber') ??
    null
  const statusId =
    pick<number>(sale, 'StatusId', 'Status', 'SaleStatusId') ??
    pick<number>(d, 'Data.StatusId', 'Data.SaleStatusId', 'StatusId') ??
    null

  const authCode =
    pick<string>(firstCard ?? {}, 'OnlinePayment.AuthorizationCode', 'ReservedText', 'AuthCode', 'AuthorizationCode') ??
    null
  const cardNo =
    pick<string>(firstCard ?? {}, 'OnlinePayment.CardNo', 'CardNo', 'MaskedPan') ??
    null
  const acquirer =
    pick<string>(firstCard ?? {}, 'OnlinePayment.AcquirerName') ??
    null
  const acquirerIdRaw =
    pick(firstCard ?? {}, 'OnlinePayment.AcquirerId')
  const acquirerId = acquirerIdRaw != null && acquirerIdRaw !== '' ? String(acquirerIdRaw) : null
  const batchNo =
    pick<string>(firstCard ?? {}, 'OnlinePayment.BatchNo') ??
    null

  return {
    statusId: statusId != null ? Number(statusId) : null,
    invoiceNo: invoiceNo != null ? String(invoiceNo) : null,
    documentUuid: documentUuid != null ? String(documentUuid) : null,
    saleUid: saleUid != null ? String(saleUid) : null,
    saleNumber: saleNumber != null ? String(saleNumber) : null,
    inquiryLink: inquiryLink != null ? String(inquiryLink) : null,
    authCode: authCode != null ? String(authCode) : null,
    cardNo: cardNo != null ? String(cardNo) : null,
    acquirer: acquirer != null ? String(acquirer) : null,
    acquirerId,
    batchNo: batchNo != null ? String(batchNo) : null,
    isOffline,
    payments: successful.map(p => {
      const row = p as Record<string, unknown>
      const brandRaw = row.Brand ?? row.BrandId
      return {
        mediator: Number(row.PaymentMediatorId ?? row.Mediator ?? 0),
        brand: brandRaw != null && brandRaw !== '' ? Number(brandRaw) : undefined,
        amount: Number(row.PaymentAmount ?? row.Amount ?? 0),
      }
    }).filter(p => p.amount > 0),
    raw: d,
  }
}

function ensurePavoRawShape(data: Record<string, unknown>): Record<string, unknown> {
  if (data.Data != null || data.HasError != null) return data
  return { HasError: false, Data: data }
}

export function parsePavoResult(data: Record<string, unknown>): PaymentDeviceResult {
  const wrapped = ensurePavoRawShape(data)
  const d = wrapped.Data as Record<string, unknown> | undefined
  const norm = normalizePavoSaleResult(wrapped)

  const payments = Array.isArray(d?.AddedPayments)
    ? (d?.AddedPayments as Record<string, unknown>[])
    : []
  const successPay = payments.find(p => isSuccessfulPavoPayment(p)) as Record<string, unknown> | undefined
  const online = successPay?.OnlinePayment as Record<string, unknown> | undefined
  const addData = parseAdditionalData(online?.AdditionalData)

  // StatusId: 4 = satış tamamlandı. Vazgeç (ör. 23 askıda) HasError:false döner ama tamamlanmamıştır.
  // Pairing gibi StatusId içermeyen yanıtlarda sadece HasError kontrol edilir.
  const hasSaleStatus = d != null && (d.StatusId != null || d.SaleStatusId != null)
  const statusId = Number(d?.StatusId ?? d?.SaleStatusId ?? norm.statusId ?? 0)
  const saleCompleted = hasSaleStatus ? (statusId === 4 || statusId === 8) : true

  return {
    success: wrapped.HasError !== true && saleCompleted,
    provider: 'pavo',
    errorCode: wrapped.ErrorCode as number | string | undefined,
    message: wrapped.HasError === true
      ? wrapped.Message as string | undefined
      : hasSaleStatus && !saleCompleted
        ? 'Ödeme tamamlanmadı — satıştan vazgeçildi'
        : (wrapped.Message as string | undefined),
    authCode: (norm.authCode ?? online?.AuthorizationCode) as string | undefined,
    cardNo: (norm.cardNo ?? online?.CardNo) as string | undefined,
    cardBrand: addData.CardBrandText as string | undefined,
    cardType: addData.CardTypeText as string | undefined,
    acquirer: (norm.acquirer ?? online?.AcquirerName) as string | undefined,
    batchNo: (norm.batchNo ?? online?.BatchNo) as string | undefined,
    isOffline: norm.isOffline,
    receiptUrl: (norm.inquiryLink ?? d?.SaleInquieryLink) as string | undefined,
    invoiceNo: norm.invoiceNo,
    documentUuid: norm.documentUuid,
    saleUid: norm.saleUid,
    inquiryLink: norm.inquiryLink,
    saleNumber: norm.saleNumber,
    payments: norm.payments,
    raw: wrapped,
  }
}

/** Ham Pavo cevabını PaymentDeviceResult'a çevir (GetSaleResult / CompleteUncompletedSale). */
export function deviceResultFromNormalizedPavo(data: unknown): PaymentDeviceResult {
  const raw = (data ?? {}) as Record<string, unknown>
  return parsePavoResult(
    raw.Data != null || raw.HasError != null
      ? raw
      : { HasError: false, Data: raw },
  )
}
