// Tum odeme cihazlari icin normalize sonuc tipi
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

export function parsePavoResult(data: Record<string, unknown>): PaymentDeviceResult {
  const d = data.Data as Record<string, unknown> | undefined
  const payments = Array.isArray(d?.AddedPayments)
    ? (d?.AddedPayments as Record<string, unknown>[])
    : []
  const successPay = payments.find(p => Number(p.StatusId ?? 0) === 2) as Record<string, unknown> | undefined
  const online = successPay?.OnlinePayment as Record<string, unknown> | undefined
  const addData = parseAdditionalData(online?.AdditionalData)

  return {
    success: data.HasError !== true,
    provider: 'pavo',
    errorCode: data.ErrorCode as number | string | undefined,
    message: data.Message as string | undefined,
    authCode: online?.AuthorizationCode as string | undefined,
    cardNo: online?.CardNo as string | undefined,
    cardBrand: addData.CardBrandText as string | undefined,
    cardType: addData.CardTypeText as string | undefined,
    acquirer: online?.AcquirerName as string | undefined,
    batchNo: online?.BatchNo as string | undefined,
    isOffline: Boolean(d?.IsOffline),
    receiptUrl: d?.SaleInquieryLink as string | undefined,
    raw: data,
  }
}
