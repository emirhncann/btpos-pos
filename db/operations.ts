import { getDB, getSqlite } from './index'
import { products, sales, saleItems, cashiers, heldDocuments, pluGroupsCache, pluItemsCache, commandHistory } from './schema'
import {
  applySettingsBundle,
  dropLegacySettingsTables,
  matchPaymentAccounts,
  readCashierSettings,
  readTerminalSettings,
  type SqliteLike,
} from './settingsCache'
import type { CashierSettings, PaymentAccountCache, SettingsBundle, TerminalSettings } from '../src/lib/settingsModel'
import {
  aggregateReconciliation,
  catalogFromDefs,
  type ReconCatalogItem,
  type ReconSnapshot,
} from '../src/lib/cashReconciliation'
import { eq, gte, lte, and, asc, desc, inArray, or, isNull } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { planCustomerSyncRepair } from '../src/lib/customerSyncRepair'
import {
  parseInvoiceMode,
} from '../src/lib/invoiceMode'
import { applyCustomerPatch } from '../src/lib/queueCustomerPatch'
import type BetterSqlite3 from 'better-sqlite3'

export interface ProductRow {
  id: string
  code?: string
  name: string
  barcode?: string
  price: number
  vatRate: number
  unit: string
  stock: number
  category?: string
  syncedAt: string
  modificationDate?: string | null
}

export interface SaleItem {
  productId?: string
  productCode?: string
  productName: string
  quantity: number
  unitPrice: number
  vatRate: number
  discountRate?: number
  discountAmount?: number
  lineTotal: number
  appliedBy?: string
  /** KDV dahil liste birim fiyatı */
  unitPriceGross?: number
  grossAmount?: number
  lineDiscount?: number
  docDiscountShare?: number
  netAmount?: number
}

export interface SalePaymentRow {
  id:            string
  saleId:        string
  method:        'cash' | 'card' | 'meal_card' | 'other'
  amount:        number
  mediator?:     number | null
  acquirerId?:   string | null
  acquirerName?: string | null
  cashierId?:    string | null
  cashierName?:  string | null
  createdAt?:    string | null
}

export interface SaleRow {
  receiptNo?: string
  orderNo?: string | null
  totalAmount: number
  discountRate?: number
  discountAmount?: number
  netAmount: number
  paymentType: 'cash' | 'card' | 'mixed'
  cashAmount: number
  cardAmount: number
  cardAcquirerId?: string | null
  cashierId?:   string | null
  cashierName?: string | null
  customerId?:   string | null
  customerName?: string | null
  customerCode?: string | null
  isReturn?:    boolean
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
  invoiceNo?: string | null
  documentUuid?: string | null
  saleUid?: string | null
  inquiryLink?: string | null
  saleNumber?: string | null
  payments?: Array<{ mediator: number; brand?: number; amount: number }>
  raw: Record<string, unknown>
}

export function saveProducts(items: ProductRow[]): number {
  const db = getDB()
  db.delete(products).run()

  const now = new Date().toISOString()

  for (const item of items) {
    db.insert(products).values({
      id: item.id || randomUUID(),
      code: item.code ?? '',
      name: item.name,
      barcode: item.barcode ?? '',
      price: item.price ?? 0,
      vatRate: item.vatRate ?? 18,
      unit: item.unit ?? 'Adet',
      stock: item.stock ?? 0,
      category: item.category ?? '',
      syncedAt: now,
      modificationDate: item.modificationDate ?? null,
    }).run()
  }

  return items.length
}

export function getAllProducts(): ProductRow[] {
  const db = getDB()
  return db.select().from(products).all() as ProductRow[]
}

export function findByBarcode(barcode: string): ProductRow | null {
  const db = getDB()
  const result = db.select().from(products).where(eq(products.barcode, barcode)).get()
  return result as ProductRow | null
}

export interface SaveSaleResult {
  saleId:      string
  receiptNo:   string
  invoiceMode: 'z_single' | 'per_sale'
}

export function saveSale(sale: SaleRow, items: SaleItem[], device?: PaymentDeviceResult): SaveSaleResult {
  const db = getDB()
  const sqlite = getSqlite()
  const saleId = randomUUID()
  const now = new Date().toISOString()
  const invoiceMode = parseInvoiceMode(getTerminalSettings().invoiceMode)
  // Pavo belge alanları her zaman yazılır (nakitle kapanan askı satışında da e-belge barkodu için)
  const paymentDeviceData = device ? JSON.stringify({
    authCode:    device.authCode ?? null,
    cardNo:      device.cardNo ?? null,
    cardBrand:   device.cardBrand ?? null,
    cardType:    device.cardType ?? null,
    acquirer:    device.acquirer ?? null,
    batchNo:     device.batchNo ?? null,
    isOffline:   device.isOffline ?? false,
    receiptUrl:  device.receiptUrl ?? device.inquiryLink ?? null,
    invoiceNo:   device.invoiceNo ?? null,
    documentUuid: device.documentUuid ?? null,
    saleUid:     device.saleUid ?? null,
    inquiryLink: device.inquiryLink ?? device.receiptUrl ?? null,
    saleNumber:  device.saleNumber ?? null,
    payments:    device.payments ?? null,
    pavo_invoice_no:   device.invoiceNo ?? null,
    pavo_sale_uid:     device.saleUid ?? null,
    pavo_inquiry_link: device.inquiryLink ?? device.receiptUrl ?? null,
    pavo_sale_number:  device.saleNumber ?? null,
    pavo_auth_code:    device.authCode ?? null,
    pavo_card_no:      device.cardNo ?? null,
    pavo_is_offline:   device.isOffline ?? false,
    raw:         device.raw,
  }) : null

  sqlite.prepare(`
    INSERT INTO sales (
      id, receipt_no, order_no,
      total_amount, discount_rate, discount_amount, net_amount,
      payment_type, cash_amount, card_amount,
      created_at, synced,
      customer_id, customer_name, customer_code,
      cashier_id, cashier_name,
      invoice_sent, invoice_id, invoice_error, invoice_at,
      card_acquirer_id, payment_provider, payment_device_data, is_return, invoice_mode
    ) VALUES (
      ?,
      (SELECT COALESCE(MAX(receipt_no), 0) + 1 FROM sales),
      ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, 0,
      ?, ?, ?,
      ?, ?,
      0, NULL, NULL, NULL,
      ?, ?, ?, ?,
      ?
    )
  `).run(
    saleId,
    sale.orderNo ?? null,
    sale.totalAmount,
    sale.discountRate ?? 0,
    sale.discountAmount ?? 0,
    sale.netAmount,
    sale.paymentType,
    sale.cashAmount,
    sale.cardAmount,
    now,
    sale.customerId ?? null,
    sale.customerName ?? null,
    sale.customerCode ?? null,
    sale.cashierId ?? null,
    sale.cashierName ?? null,
    sale.cardAcquirerId ?? null,
    device?.provider ?? null,
    paymentDeviceData,
    sale.isReturn ? 1 : 0,
    invoiceMode,
  )

  for (const item of items) {
    const productRow = item.productCode
      ? sqlite.prepare(
        'SELECT id FROM products WHERE code = ? LIMIT 1',
      ).get(item.productCode) as { id: string } | undefined
      : undefined

    const unitPriceGross = item.unitPriceGross ?? item.unitPrice
    const qtyAbs = Math.abs(item.quantity)
    const grossAmount = item.grossAmount ?? Number((unitPriceGross * qtyAbs).toFixed(2))
    const lineDiscount = item.lineDiscount ?? item.discountAmount ?? 0
    const docDiscountShare = item.docDiscountShare ?? 0
    const netAmount = item.netAmount
      ?? Number((grossAmount - lineDiscount - docDiscountShare).toFixed(2))
    const totalDiscount = Number((lineDiscount + docDiscountShare).toFixed(2))

    db.insert(saleItems).values({
      id: randomUUID(),
      saleId,
      productId: productRow?.id ?? null,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      discountRate: item.discountRate ?? 0,
      discountAmount: totalDiscount,
      lineTotal: item.lineTotal ?? netAmount,
      appliedBy: item.appliedBy ?? null,
      unitPriceGross,
      grossAmount,
      lineDiscount,
      docDiscountShare,
      netAmount,
    }).run()
  }

  const inserted = sqlite.prepare(
    'SELECT receipt_no FROM sales WHERE id = ?',
  ).get(saleId) as { receipt_no: number }

  return { saleId, receiptNo: String(inserted.receipt_no), invoiceMode }
}

/** Bekleyen veya hatalı (yeniden denenecek) fatura kayıtları */
export function getPendingInvoices(onlyAnonymous = false): (typeof sales.$inferSelect)[] {
  const db = getDB()
  if (onlyAnonymous) {
    return db.select().from(sales)
      .where(and(
        eq(sales.invoiceSent, 0),
        isNull(sales.dayEndQueueId),
        or(isNull(sales.customerId), eq(sales.customerId, '')),
        or(isNull(sales.isReturn), eq(sales.isReturn, 0)),
      ))
      .orderBy(asc(sales.createdAt))
      .limit(200)
      .all()
  }
  return db.select().from(sales)
    .where(and(
      inArray(sales.invoiceSent, [0, 2]),
      or(isNull(sales.isReturn), eq(sales.isReturn, 0)),
    ))
    .orderBy(asc(sales.createdAt))
    .limit(50)
    .all()
}

export function markInvoiceSent(saleId: string, invoiceId: string, invoiceNumber?: string | null): void {
  const number = String(invoiceNumber ?? '').trim()
  getSqlite().prepare(`
    UPDATE sales
    SET invoice_sent = 1, invoice_id = ?, invoice_number = COALESCE(NULLIF(?, ''), invoice_number),
        invoice_error = NULL, invoice_at = ?
    WHERE id = ?
  `).run(invoiceId, number, new Date().toISOString(), saleId)
}

export function markInvoiceError(saleId: string, error: string): void {
  const db = getDB()
  const at = new Date().toISOString()
  db.update(sales)
    .set({ invoiceSent: 2, invoiceError: error, invoiceAt: at })
    .where(eq(sales.id, saleId))
    .run()
}

/** ERP faturası için satır verisi (ürün kodu/birim products ile zenginleştirilir) */
export interface SaleItemInvoiceRow {
  productId:         string | null
  productCode:       string
  productName:       string
  quantity:          number
  /** @deprecated unitPriceGross kullan */
  price:             number
  vatRate:           number
  unit:              string
  unitPriceGross:    number
  grossAmount:       number
  lineDiscount:      number
  docDiscountShare:  number
  /** line_discount + doc_discount_share (KDV dahil) */
  discountAmount:    number
  netAmount:         number
}

export function getSaleItems(saleId: string): SaleItemInvoiceRow[] {
  const sqlite = getSqlite()
  const rows = sqlite.prepare(`
    SELECT
      si.product_id          AS product_id,
      si.product_name        AS product_name,
      si.quantity            AS quantity,
      si.unit_price          AS unit_price,
      si.vat_rate            AS vat_rate,
      si.discount_rate       AS discount_rate,
      si.discount_amount     AS discount_amount,
      si.line_total          AS line_total,
      si.unit_price_gross    AS unit_price_gross,
      si.gross_amount        AS gross_amount,
      si.line_discount       AS line_discount,
      si.doc_discount_share  AS doc_discount_share,
      si.net_amount          AS net_amount,
      p.code                 AS p_code,
      p.unit                 AS p_unit
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ?
  `).all(saleId) as Array<{
    product_id:         string | null
    product_name:       string
    quantity:           number
    unit_price:         number
    vat_rate:           number | null
    discount_rate:      number | null
    discount_amount:    number | null
    line_total:         number | null
    unit_price_gross:   number | null
    gross_amount:       number | null
    line_discount:      number | null
    doc_discount_share: number | null
    net_amount:         number | null
    p_code:             string | null
    p_unit:             string | null
  }>

  return rows.map(r => {
    const qtyAbs = Math.abs(Number(r.quantity) || 0)
    const unitPriceGross = r.unit_price_gross != null
      ? Number(r.unit_price_gross)
      : Number(r.unit_price)
    const grossAmount = r.gross_amount != null
      ? Number(r.gross_amount)
      : Number((unitPriceGross * qtyAbs).toFixed(2))
    const lineDiscount = r.line_discount != null
      ? Number(r.line_discount)
      : (r.doc_discount_share == null ? Number(r.discount_amount ?? 0) : 0)
    const docDiscountShare = Number(r.doc_discount_share ?? 0)
    const discountAmount = Number((lineDiscount + docDiscountShare).toFixed(2))
      || Number(r.discount_amount ?? 0)
    const netAmount = r.net_amount != null
      ? Number(r.net_amount)
      : (r.line_total != null
        ? Number(r.line_total)
        : Number((grossAmount - discountAmount).toFixed(2)))
    return {
      productId:        r.product_id ?? null,
      productCode:      r.p_code || '',
      productName:      r.product_name,
      quantity:         r.quantity,
      price:            unitPriceGross,
      vatRate:          r.vat_rate == null ? Number.NaN : Number(r.vat_rate),
      unit:             r.p_unit?.trim() ? r.p_unit : 'Adet',
      unitPriceGross,
      grossAmount,
      lineDiscount,
      docDiscountShare,
      discountAmount,
      netAmount,
    }
  })
}

export function getSaleByReceiptNo(receiptNo: string): { id: string; receiptNo: string } | null {
  const sqlite = getSqlite()
  return sqlite.prepare(
    'SELECT id, receipt_no AS receiptNo FROM sales WHERE receipt_no = ? LIMIT 1',
  ).get(receiptNo) as { id: string; receiptNo: string } | null
}

export function getSaleByOrderNo(orderNo: string): { id: string; orderNo: string } | null {
  const sqlite = getSqlite()
  return sqlite.prepare(
    'SELECT id, order_no AS orderNo FROM sales WHERE order_no = ? LIMIT 1',
  ).get(orderNo) as { id: string; orderNo: string } | null
}

export function saveSalePayments(
  db: BetterSqlite3.Database,
  payments: SalePaymentRow[],
): void {
  const stmt = db.prepare(`
    INSERT INTO sale_payments (id, sale_id, method, amount, mediator, acquirer_id, acquirer_name, cashier_id, cashier_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const p of payments) {
    stmt.run(
      p.id,
      p.saleId,
      p.method,
      p.amount,
      p.mediator ?? null,
      p.acquirerId ?? null,
      p.acquirerName ?? null,
      p.cashierId ?? null,
      p.cashierName ?? null,
      p.createdAt ?? new Date().toISOString(),
    )
  }
}

export function getSalePayments(
  db: BetterSqlite3.Database,
  saleId: string,
): SalePaymentRow[] {
  return db.prepare(`
    SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY created_at
  `).all(saleId) as SalePaymentRow[]
}

export function getCardTotalsByBank(
  db: BetterSqlite3.Database,
  saleIds: string[],
): Record<string, { amount: number; acquirerName: string }> {
  if (saleIds.length === 0) return {}
  const placeholders = saleIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT COALESCE(acquirer_id, 'unknown') AS acquirer_id,
           MAX(acquirer_name) AS acquirer_name,
           SUM(amount) AS total
    FROM sale_payments
    WHERE sale_id IN (${placeholders})
      AND method = 'card'
    GROUP BY COALESCE(acquirer_id, 'unknown')
  `).all(...saleIds) as Array<{ acquirer_id: string; acquirer_name: string | null; total: number }>

  const result: Record<string, { amount: number; acquirerName: string }> = {}
  for (const r of rows) {
    result[r.acquirer_id] = {
      amount: Number(r.total ?? 0),
      acquirerName: r.acquirer_name ?? '',
    }
  }
  return result
}

export function getCashTotal(
  db: BetterSqlite3.Database,
  saleIds: string[],
): number {
  if (saleIds.length === 0) return 0
  const placeholders = saleIds.map(() => '?').join(',')
  const row = db.prepare(`
    SELECT SUM(amount) as total
    FROM sale_payments
    WHERE sale_id IN (${placeholders})
      AND method = 'cash'
  `).get(...saleIds) as { total: number | null } | undefined
  return Number(row?.total ?? 0)
}

export function getSales(dateFrom?: string, dateTo?: string) {
  const db = getDB()

  if (dateFrom && dateTo) {
    return db.select().from(sales)
      .where(and(gte(sales.createdAt, dateFrom), lte(sales.createdAt, dateTo)))
      .all()
  }

  return db.select().from(sales).all()
}

export interface LastSaleRow {
  receiptNo:       string
  pavoSaleNumber:  string | null
  orderNo:         string | null
}

export interface RecentSaleRow {
  id:             string
  receiptNo:      string
  pavoSaleNumber: string | null
  orderNo:        string | null
  netAmount:      number
  createdAt:      string
  customerName:   string | null
  cashierName:    string | null
}

function parsePavoFromPaymentData(paymentDeviceData: string | null | undefined): {
  pavoSaleNumber: string | null
  orderNo:        string | null
} {
  let pavoSaleNumber: string | null = null
  let orderNo: string | null = null
  if (!paymentDeviceData) return { pavoSaleNumber, orderNo }
  try {
    const pd = JSON.parse(paymentDeviceData) as Record<string, unknown>
    const raw = (pd.raw ?? pd) as Record<string, unknown>
    const data = raw.Data as Record<string, unknown> | undefined
    const sale = data?.Sale as Record<string, unknown> | undefined
    const saleNum = data?.SaleNumber ?? sale?.SaleNumber
    if (saleNum != null && String(saleNum).trim()) {
      pavoSaleNumber = String(saleNum).trim()
    }
    const ord = data?.OrderNo ?? sale?.OrderNo
    if (ord != null && String(ord).trim()) {
      orderNo = String(ord).trim()
    }
  } catch {
    // payment_device_data parse hatası — receiptNo kullanılır
  }
  return { pavoSaleNumber, orderNo }
}

/** Son satışlar — hızlı iade listesi (iade olmayan, yeniden eskiye) */
export interface GetRecentSalesOpts {
  limit?:    number
  dateFrom?: string
  dateTo?:   string
  timeFrom?: string
  timeTo?:   string
}

export function getRecentSales(opts: GetRecentSalesOpts = {}): RecentSaleRow[] {
  const db = getSqlite()
  const limit = opts.limit ?? 20
  const conditions = ['is_return = 0']
  const params: unknown[] = []

  if (opts.dateFrom) {
    conditions.push('date(created_at) >= ?')
    params.push(opts.dateFrom)
  }
  if (opts.dateTo) {
    conditions.push('date(created_at) <= ?')
    params.push(opts.dateTo)
  }
  if (opts.timeFrom) {
    conditions.push(`strftime('%H:%M', datetime(created_at)) >= ?`)
    params.push(opts.timeFrom)
  }
  if (opts.timeTo) {
    conditions.push(`strftime('%H:%M', datetime(created_at)) <= ?`)
    params.push(opts.timeTo)
  }

  const rows = db.prepare(`
    SELECT * FROM sales
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, limit) as Record<string, unknown>[]

  return rows.map(row => {
    const { pavoSaleNumber, orderNo: pavoOrderNo } = parsePavoFromPaymentData(
      row.payment_device_data as string | null | undefined,
    )
    return {
      id:             String(row.id),
      receiptNo:      String(row.receipt_no),
      pavoSaleNumber,
      orderNo:        row.order_no != null ? String(row.order_no) : pavoOrderNo,
      netAmount:      Number(row.net_amount),
      createdAt:      String(row.created_at),
      customerName:   row.customer_name != null ? String(row.customer_name) : null,
      cashierName:    row.cashier_name  != null ? String(row.cashier_name)  : null,
    }
  })
}

/** Son satış — hızlı iade için Pavo satış numarası varsa döner */
export function getLastSale(): LastSaleRow | null {
  const recent = getRecentSales({ limit: 1 })[0]
  if (!recent) return null
  return {
    receiptNo:      recent.receiptNo,
    pavoSaleNumber: recent.pavoSaleNumber,
    orderNo:        recent.orderNo,
  }
}

export interface CashierRow {
  id:           string
  companyId?:   string
  fullName:     string
  cashierCode:  string
  password:     string
  role:         string
  isActive:     boolean
  cardNumber?:  string | null
}

export function saveCashiers(items: CashierRow[]): number {
  const db = getDB()
  db.delete(cashiers).run()

  const now = new Date().toISOString()
  for (const item of items) {
    db.insert(cashiers).values({
      id:          item.id,
      companyId:   item.companyId ?? '',
      fullName:    item.fullName,
      cashierCode: item.cashierCode,
      password:    item.password,
      role:        item.role ?? 'cashier',
      isActive:    item.isActive ?? true,
      cardNumber:  item.cardNumber ?? null,
      syncedAt:    now,
    }).run()
  }
  return items.length
}

export function verifyCashier(code: string, password: string): CashierRow | null {
  const db = getDB()
  const result = db.select().from(cashiers)
    .where(and(
      eq(cashiers.cashierCode, code),
      eq(cashiers.password, password),
      eq(cashiers.isActive, true)
    ))
    .get()
  return result as CashierRow | null
}

/**
 * Kart numarası (barkod/RFID) ile kasiyer doğrula.
 * Şifre gerekmez — kart sahipliği yeterli.
 */
export function verifyCashierByCard(cardNumber: string): CashierRow | null {
  if (!cardNumber.trim()) return null
  const db     = getDB()
  const result = db.select().from(cashiers)
    .where(and(
      eq(cashiers.cardNumber, cardNumber.trim()),
      eq(cashiers.isActive, true)
    ))
    .get()
  return result ? {
    id:          result.id,
    companyId:   result.companyId,
    fullName:    result.fullName,
    cashierCode: result.cashierCode,
    password:    result.password,
    role:        result.role ?? 'cashier',
    isActive:    result.isActive ?? true,
    cardNumber:  result.cardNumber ?? null,
  } : null
}

export function getAllCashiers(): CashierRow[] {
  const db = getDB()
  return db.select().from(cashiers)
    .where(eq(cashiers.isActive, true))
    .all()
    .map(r => ({
      id:          r.id,
      companyId:   r.companyId,
      fullName:    r.fullName,
      cashierCode: r.cashierCode,
      password:    r.password,
      role:        r.role ?? 'cashier',
      isActive:    r.isActive ?? true,
      cardNumber:  r.cardNumber ?? null,
    }))
}

export interface HeldCartLine {
  id:             string
  code:           string
  name:           string
  category:       string
  price:          number
  vatRate:        number
  unit:           string
  quantity:       number
  lineTotal:      number
  discountRate?:  number
  discountAmount?: number
  netTotal?:      number
}

export interface HeldDoc {
  id:           string
  companyId:    string
  receiptNo?:   string
  orderNo?:     string
  label?:       string
  items:        HeldCartLine[]
  totalAmount:  number
  customerName?: string
  cashierName?:  string
  customer?:     unknown
  createdAt:    string
}

export function holdDocument(doc: Omit<HeldDoc, 'id' | 'createdAt'>): string {
  const db  = getDB()
  const id  = randomUUID()
  const now = new Date().toISOString()
  db.insert(heldDocuments).values({
    id,
    companyId:    doc.companyId,
    receiptNo:    doc.receiptNo ?? null,
    orderNo:      doc.orderNo ?? null,
    label:        doc.label ?? null,
    items:        JSON.stringify(doc.items),
    totalAmount:  doc.totalAmount,
    customerName: doc.customerName ?? null,
    cashierName:  doc.cashierName ?? null,
    customer:     doc.customer != null ? JSON.stringify(doc.customer) : null,
    createdAt:    now,
  }).run()
  return id
}

export function getHeldDocuments(companyId: string): HeldDoc[] {
  const db = getDB()
  const rows = db.select().from(heldDocuments)
    .where(eq(heldDocuments.companyId, companyId))
    .orderBy(asc(heldDocuments.createdAt))
    .all()
  return rows.map(r => ({
    id:           r.id,
    companyId:    r.companyId,
    receiptNo:    r.receiptNo ?? undefined,
    orderNo:      r.orderNo ?? undefined,
    label:        r.label ?? undefined,
    items:        JSON.parse(r.items) as HeldCartLine[],
    totalAmount:  r.totalAmount ?? 0,
    customerName: r.customerName ?? undefined,
    cashierName:  r.cashierName ?? undefined,
    customer:     r.customer ? JSON.parse(r.customer) as unknown : undefined,
    createdAt:    r.createdAt,
  }))
}

export function deleteHeldDocument(id: string): void {
  const db = getDB()
  db.delete(heldDocuments).where(eq(heldDocuments.id, id)).run()
}

export function updateHeldDocumentLabel(id: string, label: string): void {
  const db = getDB()
  db.update(heldDocuments)
    .set({ label: label || null })
    .where(eq(heldDocuments.id, id))
    .run()
}

export interface PluGroupCacheRow {
  id:           string
  companyId:    string
  workplaceId?: string
  terminalId?:  string
  cashierId?:   string
  name:         string
  color:        string
  sortOrder:    number
  plu_items:    Array<{ id: string; product_code: string; sort_order: number }>
}

export interface PaymentDeviceRow {
  id:              string
  companyId:       string
  terminalId:      string
  provider:        'pavo' | 'ingenico' | 'pax'
  ipAddress:       string | null
  port:            number
  serialNo:        string | null
  cardReadTimeout: number
  printWidth:      '58mm' | '80mm'
  isActive:        boolean
  syncedAt:        string | null
  lastPairedAt?:   string | null
}

function normalizePrintWidth(width: unknown): '58mm' | '80mm' {
  const raw = String(width ?? '').toLowerCase().trim()
  if (raw === '58' || raw === '58mm' || raw.includes('58')) return '58mm'
  return '80mm'
}

export function savePluGroups(groups: PluGroupCacheRow[]): void {
  const db  = getDB()
  const now = new Date().toISOString()

  if (groups.length === 0) return

  const companyId = groups[0].companyId

  const existingGroups = db.select({ id: pluGroupsCache.id })
    .from(pluGroupsCache)
    .where(eq(pluGroupsCache.companyId, companyId))
    .all()

  for (const g of existingGroups) {
    db.delete(pluItemsCache).where(eq(pluItemsCache.groupId, g.id)).run()
  }
  db.delete(pluGroupsCache).where(eq(pluGroupsCache.companyId, companyId)).run()

  for (const group of groups) {
    db.insert(pluGroupsCache).values({
      id:          group.id,
      companyId:   group.companyId,
      workplaceId: group.workplaceId ?? null,
      terminalId:  group.terminalId ?? null,
      cashierId:   group.cashierId ?? null,
      name:        group.name,
      color:       group.color,
      sortOrder:   group.sortOrder ?? 0,
      syncedAt:    now,
    }).run()

    for (const item of (group.plu_items ?? [])) {
      db.insert(pluItemsCache).values({
        id:          item.id && item.id.length > 0 ? item.id : randomUUID(),
        groupId:     group.id,
        productCode: item.product_code,
        sortOrder:   item.sort_order ?? 0,
      }).run()
    }
  }
}

function mapPluGroups(
  db: ReturnType<typeof getDB>,
  groups: typeof pluGroupsCache.$inferSelect[]
): PluGroupCacheRow[] {
  return groups.map(g => {
    const items = db.select().from(pluItemsCache)
      .where(eq(pluItemsCache.groupId, g.id))
      .orderBy(asc(pluItemsCache.sortOrder))
      .all()
    return {
      id:          g.id,
      companyId:   g.companyId,
      workplaceId: g.workplaceId ?? undefined,
      terminalId:  g.terminalId ?? undefined,
      cashierId:   g.cashierId ?? undefined,
      name:        g.name,
      color:       g.color,
      sortOrder:   g.sortOrder ?? 0,
      plu_items:   items.map(i => ({
        id:           i.id,
        product_code: i.productCode,
        sort_order:   i.sortOrder ?? 0,
      })),
    }
  })
}

export function deleteCashierPluForTerminal(terminalId: string): void {
  const sqlite = getSqlite()

  const groupIds = sqlite.prepare(`
    SELECT id FROM plu_groups_cache
    WHERE terminal_id = ? AND cashier_id IS NOT NULL
  `).all(terminalId) as { id: string }[]

  if (groupIds.length === 0) return

  const ids = groupIds.map(g => g.id)
  const placeholders = ids.map(() => '?').join(',')

  sqlite.prepare(`
    DELETE FROM plu_items_cache WHERE group_id IN (${placeholders})
  `).run(...ids)

  sqlite.prepare(`
    DELETE FROM plu_groups_cache WHERE id IN (${placeholders})
  `).run(...ids)

  console.log(`[plu] ${ids.length} kasiyer bazlı grup temizlendi (terminal: ${terminalId})`)
}

export function getPluGroups(
  companyId: string,
  workplaceId?: string | null,
  cashierId?: string | null,
): PluGroupCacheRow[] {
  const db     = getDB()
  const sqlite = getSqlite()

  // 1. Kasiyer bazlı — cashierId verilmişse sadece o kasiyerin grupları
  if (cashierId) {
    const groups = db.select().from(pluGroupsCache)
      .where(and(
        eq(pluGroupsCache.companyId, companyId),
        eq(pluGroupsCache.cashierId, cashierId),
      ))
      .orderBy(asc(pluGroupsCache.sortOrder))
      .all()
    if (groups.length > 0) return mapPluGroups(db, groups)
  }

  // 2. İşyeri bazlı — cashier_id IS NULL zorunlu (kasiyer grupları karışmasın)
  if (workplaceId) {
    const rows = sqlite.prepare(`
      SELECT * FROM plu_groups_cache
      WHERE company_id = ? AND workplace_id = ? AND cashier_id IS NULL
      ORDER BY sort_order
    `).all(companyId, workplaceId) as typeof pluGroupsCache.$inferSelect[]
    if (rows.length > 0) return mapPluGroups(db, rows)
  }

  // 3. Şirket geneli — cashier_id IS NULL ve terminal_id IS NULL
  const rows = sqlite.prepare(`
    SELECT * FROM plu_groups_cache
    WHERE company_id = ? AND cashier_id IS NULL AND terminal_id IS NULL
    ORDER BY sort_order
  `).all(companyId) as typeof pluGroupsCache.$inferSelect[]
  return mapPluGroups(db, rows)
}

export type { CashierSettings, PaymentAccountCache, SettingsBundle, TerminalSettings }

function sqlite(): SqliteLike {
  return getSqlite() as unknown as SqliteLike
}

export function getTerminalSettings(): TerminalSettings {
  return readTerminalSettings(sqlite())
}

export function getCashierSettings(cashierId?: string | null): CashierSettings {
  return readCashierSettings(sqlite(), cashierId)
}

export interface ActivationRow {
  terminalId: string
  companyId: string
  deviceUid: string
  activatedAt: string
  planName: string | null
  expiryDate: string | null
  licenseKey: string | null
}

/** Tek satır (id = 1). Aktivasyon sonrası lisans anahtarı buraya yazılır. */
export function saveActivation(row: {
  terminalId: string
  companyId: string
  deviceUid: string
  planName?: string | null
  expiryDate?: string | null
  licenseKey?: string | null
}): void {
  const db = getSqlite()
  db.prepare(`
    INSERT OR REPLACE INTO activation (
      id, terminal_id, company_id, device_uid, activated_at,
      plan_name, expiry_date, license_key
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.terminalId,
    row.companyId,
    row.deviceUid,
    new Date().toISOString(),
    row.planName ?? null,
    row.expiryDate ?? null,
    row.licenseKey ?? null,
  )
}

export function getActivation(): ActivationRow | null {
  const db = getSqlite()
  const row = db.prepare(`SELECT * FROM activation WHERE id = 1`).get() as
    | {
        terminal_id?: string
        company_id?: string
        device_uid?: string
        activated_at?: string
        plan_name?: string | null
        expiry_date?: string | null
        license_key?: string | null
      }
    | undefined
  if (!row?.terminal_id) return null
  return {
    terminalId: String(row.terminal_id),
    companyId: String(row.company_id ?? ''),
    deviceUid: String(row.device_uid ?? ''),
    activatedAt: String(row.activated_at ?? ''),
    planName: row.plan_name != null ? String(row.plan_name) : null,
    expiryDate: row.expiry_date != null ? String(row.expiry_date) : null,
    licenseKey: row.license_key != null && String(row.license_key).trim()
      ? String(row.license_key).trim()
      : null,
  }
}

export function syncSettingsBundle(bundle: SettingsBundle, terminalId: string): SyncResult {
  const db = sqlite()
  try {
    applySettingsBundle(db, bundle, terminalId)
    try {
      dropLegacySettingsTables(db)
    } catch (e) {
      console.warn('[settings] eski ayar tablosu silinemedi:', e)
    }
    return { success: true, inserted: 1, updated: bundle.cashiers.length, deleted: 0 }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

export function matchPaymentAccountsForQueue(opts: {
  cashAmount?: number
  cardAmount?: number
  cardAcquirerId?: string | null
  cardByBank?: Record<string, { amount?: number; acquirerName?: string }>
}) {
  return matchPaymentAccounts(sqlite(), opts)
}

// Odeme cihazi ayarlarini getir
export function getPaymentDeviceSettings(provider = 'pavo'): PaymentDeviceRow | undefined {
  const db = getSqlite()
    const row = db.prepare(`
    SELECT * FROM payment_device_settings
    WHERE provider = ? AND is_active = 1
    LIMIT 1
  `).get(provider) as Record<string, unknown> | undefined
  if (!row) return undefined
  return mapPaymentDeviceRow(row)
}

function mapPaymentDeviceRow(row: Record<string, unknown>): PaymentDeviceRow {
  return {
    id:              String(row.id ?? ''),
    companyId:       String(row.company_id ?? ''),
    terminalId:      String(row.terminal_id ?? ''),
    provider:        String(row.provider ?? 'pavo') as PaymentDeviceRow['provider'],
    ipAddress:       row.ip_address != null ? String(row.ip_address) : null,
    port:            Number(row.port ?? 9100),
    serialNo:        row.serial_no != null ? String(row.serial_no) : null,
    cardReadTimeout: Number(row.card_read_timeout ?? 30),
    printWidth:      normalizePrintWidth(row.print_width),
    isActive:        Number(row.is_active ?? 1) === 1,
    syncedAt:        row.synced_at != null ? String(row.synced_at) : null,
    lastPairedAt:    row.last_paired_at != null ? String(row.last_paired_at) : null,
  }
}

export function getAllPaymentDeviceSettings(): PaymentDeviceRow[] {
  const db = getSqlite()
  const rows = db.prepare(`SELECT * FROM payment_device_settings`).all() as Record<string, unknown>[]
  return rows.map(mapPaymentDeviceRow)
}

export function hasLocalPaymentDevice(provider = 'pavo'): boolean {
  const db = getSqlite()
  const row = db.prepare(`
    SELECT id FROM payment_device_settings WHERE provider = ? LIMIT 1
  `).get(provider)
  return row != null
}

export function deactivatePaymentDevice(provider = 'pavo'): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE payment_device_settings SET is_active = 0 WHERE provider = ?
  `).run(provider)
}

export function upsertPaymentDeviceSettings(row: PaymentDeviceRow): void {
  const db = getSqlite()
  const printWidth = normalizePrintWidth(row.printWidth)
  db.prepare(`
    INSERT INTO payment_device_settings
      (id, company_id, terminal_id, provider, ip_address, port, serial_no,
       card_read_timeout, print_width, is_active, synced_at, last_paired_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id=excluded.company_id,
      terminal_id=excluded.terminal_id,
      provider=excluded.provider,
      ip_address=excluded.ip_address,
      port=excluded.port,
      serial_no=excluded.serial_no,
      card_read_timeout=excluded.card_read_timeout,
      print_width=excluded.print_width,
      is_active=excluded.is_active,
      synced_at=excluded.synced_at,
      last_paired_at=COALESCE(excluded.last_paired_at, payment_device_settings.last_paired_at)
  `).run(
    row.id,
    row.companyId,
    row.terminalId,
    row.provider,
    row.ipAddress,
    row.port,
    row.serialNo,
    row.cardReadTimeout,
    printWidth,
    row.isActive ? 1 : 0,
    row.syncedAt,
    row.lastPairedAt ?? null,
  )
}

export function getUnitPavoCode(db: BetterSqlite3.Database, unitName: string): string {
  const row = db.prepare(`
    SELECT pavo_code FROM unit_mappings WHERE unit_name = ? LIMIT 1
  `).get(unitName) as { pavo_code: string } | undefined
  return row?.pavo_code ?? 'C62'
}

export function upsertUnitMapping(
  db: BetterSqlite3.Database,
  row: { companyId: string; unitName: string; pavoCode: string },
): void {
  db.prepare(`
    INSERT INTO unit_mappings (id, company_id, unit_name, pavo_code)
    VALUES (lower(hex(randomblob(16))), ?, ?, ?)
    ON CONFLICT(company_id, unit_name) DO UPDATE SET pavo_code = excluded.pavo_code
  `).run(row.companyId, row.unitName, row.pavoCode)
}

export function getAllUnitMappings(db: BetterSqlite3.Database, companyId: string) {
  return db.prepare(`SELECT * FROM unit_mappings WHERE company_id = ?`).all(companyId)
}

export function getProductByCode(code: string): ProductRow | null {
  const db = getDB()
  const result = db.select().from(products).where(eq(products.code, code)).get()
  return (result as ProductRow | undefined) ?? null
}

export function getProductIdByCode(code: string): string | null {
  const sqlite = getSqlite()
  const row = sqlite.prepare(
    'SELECT id FROM products WHERE code = ? LIMIT 1',
  ).get(code) as { id: string } | undefined
  return row?.id ?? null
}

export function getProductByName(name: string): {
  id:      string
  code:    string
  name:    string
  vatRate: number
  unit:    string
} | null {
  const sqlite = getSqlite()

  const mapRow = (row: {
    id:       string
    code:     string
    name:     string
    vat_rate: number | null
    unit:     string | null
  }) => ({
    id:      row.id,
    code:    row.code ?? '',
    name:    row.name,
    vatRate: row.vat_rate ?? 20,
    unit:    row.unit?.trim() || 'Adet',
  })

  const exact = sqlite.prepare(
    'SELECT id, code, name, vat_rate, unit FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1',
  ).get(name) as {
    id: string; code: string; name: string; vat_rate: number | null; unit: string | null
  } | undefined
  if (exact) return mapRow(exact)

  const like = sqlite.prepare(
    'SELECT id, code, name, vat_rate, unit FROM products WHERE LOWER(name) LIKE LOWER(?) LIMIT 1',
  ).get(`%${name.trim()}%`) as {
    id: string; code: string; name: string; vat_rate: number | null; unit: string | null
  } | undefined

  return like ? mapRow(like) : null
}

// Pavo sequence — her islemde +1
export function nextPavoSequence(): number {
  const db = getSqlite()
  db.prepare('UPDATE pavo_sequence SET seq = seq + 1 WHERE id = 1').run()
  const row = db.prepare('SELECT seq FROM pavo_sequence WHERE id = 1').get() as { seq: number } | undefined
  return Number(row?.seq ?? 0)
}

export function updatePavoSequence(seq: number): void {
  const db = getSqlite()
  const safeSeq = Number.isFinite(seq) ? Math.max(0, Math.floor(seq)) : 0
  db.prepare('UPDATE pavo_sequence SET seq = ? WHERE id = 1').run(safeSeq)
}

export interface CommandHistoryRow {
  id:         string
  command:    string
  payload:    Record<string, unknown>
  status:     string
  receivedAt: string
  doneAt?:    string
}

export function saveCommandHistory(row: CommandHistoryRow): void {
  const sqlite = getSqlite()
  sqlite.prepare(`
    INSERT OR IGNORE INTO command_history (id, command, payload, status, received_at, done_at)
    VALUES (@id, @command, @payload, @status, @receivedAt, @doneAt)
  `).run({
    id:         row.id,
    command:    row.command,
    payload:    JSON.stringify(row.payload ?? {}),
    status:     row.status,
    receivedAt: row.receivedAt,
    doneAt:     row.doneAt ?? null,
  })
}

export function getCommandHistory(limit = 20): CommandHistoryRow[] {
  const db   = getDB()
  const rows = db.select().from(commandHistory)
    .orderBy(desc(commandHistory.receivedAt))
    .limit(limit)
    .all()
  return rows.map(r => ({
    id:         r.id,
    command:    r.command,
    payload:    JSON.parse(r.payload ?? '{}'),
    status:     r.status,
    receivedAt: r.receivedAt,
    doneAt:     r.doneAt ?? undefined,
  }))
}

export type SyncMode = 'full' | 'diff'

export interface SyncResult {
  success:  boolean
  inserted: number
  updated:  number
  deleted:  number
  error?:   string
}

/* ─────────────── PRODUCTS ─────────────── */

export function syncProductsAcid(items: ProductRow[], mode: SyncMode = 'full'): SyncResult {
  const db  = getSqlite()
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0
  let deleted = 0

  if (items.length === 0) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş liste — sync iptal' }
  }

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM products_temp').run()

    const insertTemp = db.prepare(`
      INSERT OR IGNORE INTO products_temp (id, code, name, barcode, price, vat_rate, unit, stock, category, synced_at, modification_date)
      VALUES (@id, @code, @name, @barcode, @price, @vatRate, @unit, @stock, @category, @syncedAt, @modificationDate)
    `)
    for (const item of items) {
      insertTemp.run({
        id: item.id,
        code: item.code ?? '',
        name: item.name,
        barcode: item.barcode ?? '',
        price: item.price ?? 0,
        vatRate: item.vatRate ?? 18,
        unit: item.unit ?? 'Adet',
        stock: item.stock ?? 0,
        category: item.category ?? '',
        syncedAt: now,
        modificationDate: item.modificationDate ?? null,
      })
    }

    const countRow = db.prepare('SELECT COUNT(*) as c FROM products_temp').get() as { c: number }
    if (countRow.c === 0) throw new Error('Temp tablo boş — rollback')

    if (mode === 'full') {
      const prevRow = db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }
      deleted = prevRow.c
      db.prepare('DELETE FROM products').run()
      db.prepare('INSERT INTO products SELECT * FROM products_temp').run()
      inserted = items.length
    } else {
      inserted = 0
      updated = 0
      const existing = new Map(
        (db.prepare('SELECT id, price, name FROM products').all() as { id: string; price: number; name: string }[])
          .map(r => [r.id, r])
      )
      const insertMain = db.prepare(`
        INSERT OR REPLACE INTO products (id, code, name, barcode, price, vat_rate, unit, stock, category, synced_at, modification_date)
        VALUES (@id, @code, @name, @barcode, @price, @vatRate, @unit, @stock, @category, @syncedAt, @modificationDate)
      `)
      for (const item of items) {
        const ex = existing.get(item.id)
        if (!ex || ex.price !== item.price || ex.name !== item.name) {
          insertMain.run({
            id: item.id,
            code: item.code ?? '',
            name: item.name,
            barcode: item.barcode ?? '',
            price: item.price ?? 0,
            vatRate: item.vatRate ?? 18,
            unit: item.unit ?? 'Adet',
            stock: item.stock ?? 0,
            category: item.category ?? '',
            syncedAt: now,
            modificationDate: item.modificationDate ?? null,
          })
          if (ex) updated++
          else inserted++
        }
      }
    }

    db.prepare('DELETE FROM products_temp').run()
  })

  try {
    txn()
    return { success: true, inserted, updated, deleted }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

/* ─────────────── PLU GROUPS ─────────────── */

export function syncPluGroupsAcid(groups: PluGroupCacheRow[], mode: SyncMode = 'full'): SyncResult {
  const db  = getSqlite()
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0
  let deleted = 0

  if (groups.length === 0) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş PLU listesi — sync iptal' }
  }

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM plu_groups_temp').run()
    db.prepare('DELETE FROM plu_items_temp').run()

    const insertGrp = db.prepare(`
      INSERT INTO plu_groups_temp (id, company_id, workplace_id, terminal_id, cashier_id, name, color, sort_order, synced_at)
      VALUES (@id, @companyId, @workplaceId, @terminalId, @cashierId, @name, @color, @sortOrder, @syncedAt)
    `)
    const insertItem = db.prepare(`
      INSERT INTO plu_items_temp (id, group_id, product_code, sort_order)
      VALUES (@id, @groupId, @productCode, @sortOrder)
    `)

    for (const g of groups) {
      insertGrp.run({
        id:          g.id,
        companyId:   g.companyId,
        workplaceId: g.workplaceId ?? null,
        terminalId:  g.terminalId ?? null,
        cashierId:   g.cashierId ?? null,
        name:        g.name,
        color:       g.color,
        sortOrder:   g.sortOrder ?? 0,
        syncedAt:    now,
      })
      inserted++
      for (const item of (g.plu_items ?? [])) {
        insertItem.run({
          id: item.id,
          groupId: g.id,
          productCode: item.product_code,
          sortOrder: item.sort_order ?? 0,
        })
      }
    }

    const grpCount = (db.prepare('SELECT COUNT(*) as c FROM plu_groups_temp').get() as { c: number }).c
    if (grpCount === 0) throw new Error('PLU temp boş — rollback')

    if (mode === 'full') {
      const companyId  = groups[0].companyId
      const cashierId  = groups[0].cashierId ?? null
      const terminalId = groups[0].terminalId ?? null

      // Scope'a göre sadece ilgili kayıtları sil
      let scopeWhere: string
      let scopeParams: unknown[]

      if (cashierId) {
        scopeWhere  = 'company_id = ? AND cashier_id = ?'
        scopeParams = [companyId, cashierId]
      } else if (terminalId) {
        scopeWhere  = 'company_id = ? AND terminal_id = ? AND cashier_id IS NULL'
        scopeParams = [companyId, terminalId]
      } else {
        scopeWhere  = 'company_id = ? AND terminal_id IS NULL AND cashier_id IS NULL'
        scopeParams = [companyId]
      }

      const existingIds = (
        db.prepare(`SELECT id FROM plu_groups_cache WHERE ${scopeWhere}`)
          .all(...scopeParams) as { id: string }[]
      ).map(r => r.id)

      deleted = existingIds.length

      if (existingIds.length > 0) {
        const ph = existingIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM plu_items_cache WHERE group_id IN (${ph})`).run(...existingIds)
        db.prepare(`DELETE FROM plu_groups_cache WHERE ${scopeWhere}`).run(...scopeParams)
      }

      db.prepare('INSERT INTO plu_groups_cache SELECT * FROM plu_groups_temp').run()
      db.prepare('INSERT INTO plu_items_cache SELECT * FROM plu_items_temp').run()
    } else {
      db.prepare(`
        INSERT OR REPLACE INTO plu_groups_cache
        SELECT * FROM plu_groups_temp
      `).run()
      db.prepare(`
        INSERT OR REPLACE INTO plu_items_cache
        SELECT * FROM plu_items_temp
      `).run()
      updated = inserted
      inserted = 0
    }

    db.prepare('DELETE FROM plu_groups_temp').run()
    db.prepare('DELETE FROM plu_items_temp').run()
  })

  try {
    txn()
    return { success: true, inserted, updated, deleted }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

/* ─────────────── CASHIERS ─────────────── */

export function syncCashiersAcid(cashierList: CashierRow[], companyId: string, mode: SyncMode = 'full'): SyncResult {
  const db = getSqlite()
  const now = new Date().toISOString()
  let inserted = 0
  let deleted = 0

  if (cashierList.length === 0) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş kasiyer listesi — sync iptal' }
  }

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM cashiers_temp').run()

    const ins = db.prepare(`
      INSERT INTO cashiers_temp (id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at)
      VALUES (@id, @companyId, @fullName, @cashierCode, @password, @role, @isActive, @cardNumber, @syncedAt)
    `)
    for (const c of cashierList) {
      ins.run({
        id:          c.id,
        companyId,
        fullName:    c.fullName,
        cashierCode: c.cashierCode,
        password:    c.password,
        role:        c.role ?? 'cashier',
        isActive:    c.isActive ? 1 : 0,
        cardNumber:  c.cardNumber ?? null,
        syncedAt:    now,
      })
      inserted++
    }

    const count = (db.prepare('SELECT COUNT(*) as c FROM cashiers_temp').get() as { c: number }).c
    if (count === 0) throw new Error('Kasiyer temp boş — rollback')

    // Aynı id başka company_id ile (ör. migration öncesi '') duruyorsa UNIQUE çakışır; önce bu id'leri temizle
    const delById = db.prepare('DELETE FROM cashiers WHERE id IN (SELECT id FROM cashiers_temp)').run() as { changes: number }

    if (mode === 'full') {
      const delByCompany = db.prepare('DELETE FROM cashiers WHERE company_id = ?').run(companyId) as { changes: number }
      deleted = delById.changes + delByCompany.changes
      db.prepare(`
        INSERT INTO cashiers (id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at)
        SELECT id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at FROM cashiers_temp
      `).run()
    } else {
      db.prepare(`
        INSERT INTO cashiers (id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at)
        SELECT id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at FROM cashiers_temp
      `).run()
      deleted = delById.changes
    }

    db.prepare('DELETE FROM cashiers_temp').run()
  })

  try {
    txn()
    return { success: true, inserted, updated: 0, deleted }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

export interface CustomerRow {
  id:        string
  /** İşbaşı firma id. Boşsa kasa satırı henüz bağlanmamıştır. */
  erpId?:    string
  /** upsert sırasında eski yerel PK. Tablo kolonu değildir. */
  previousId?: string
  companyId: string
  code:      string
  name:      string
  phone:     string
  taxNo:     string
  address:   string
  balance:   number
  /** false: API bu satırda bakiye göndermedi; yerel bakiye korunur */
  balanceKnown?: boolean
  balanceUpdatedAt?: string | null
  isPerson:  boolean
  firstName: string
  lastName:  string
  postalCode: string
  city:       string
  district:   string
  email:      string
  taxOffice?: string
  /** Slim: individual | corporate. Yerel kayıtta yoksa boş kalır. */
  type?: 'individual' | 'corporate' | string
  syncedAt?: string
}

function mapCustomerRow(r: Record<string, unknown>): CustomerRow {
  const stored = String(r.customer_type ?? '')
  const type = stored === 'individual' || stored === 'corporate' ? stored : undefined
  const ip = r.is_person
  const isPerson = type === 'corporate' ? false : type === 'individual' ? true : !(ip === 0 || ip === false || ip === '0')
  return {
    id:        String(r.id ?? ''),
    erpId:     String(r.erp_id ?? ''),
    companyId: String(r.company_id ?? ''),
    code:      String(r.code ?? ''),
    name:      String(r.name ?? ''),
    phone:     String(r.phone ?? ''),
    taxNo:     String(r.tax_no ?? ''),
    address:   String(r.address ?? ''),
    balance:   Number(r.balance ?? 0),
    balanceUpdatedAt: r.balance_updated_at != null && String(r.balance_updated_at).trim()
      ? String(r.balance_updated_at)
      : null,
    isPerson,
    firstName: String(r.first_name ?? ''),
    lastName:  String(r.last_name ?? ''),
    postalCode: String(r.postal_code ?? ''),
    city:       String(r.city ?? ''),
    district:   String(r.district ?? ''),
    email:      String(r.email ?? ''),
    taxOffice:  String(r.tax_office ?? ''),
    type,
    syncedAt:  r.synced_at != null ? String(r.synced_at) : undefined,
  }
}

export function syncCustomersAcid(
  items: CustomerRow[],
  companyId: string,
  mode: SyncMode = 'full',
): SyncResult {
  const db  = getSqlite()
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0
  let deleted = 0

  if (items.length === 0) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş müşteri listesi' }
  }

  for (const c of items) {
    const explicit = String(c.erpId ?? '').trim()
    const remoteId = String(c.id ?? '').trim()
    c.erpId = explicit || remoteId
    if (!c.id) c.id = c.erpId
  }

  const txn = db.transaction(() => {
    const localKeys = db.prepare(
      `SELECT id, tax_no, erp_id FROM customers WHERE company_id = ?`,
    ).all(companyId) as { id: string; tax_no: string | null; erp_id: string | null }[]
    const repair = planCustomerSyncRepair(
      localKeys.map(r => ({ id: String(r.id), taxNo: String(r.tax_no ?? ''), erpId: String(r.erp_id ?? '') })),
      items.map(c => ({ id: String(c.id), taxNo: String(c.taxNo ?? ''), erpId: String(c.erpId ?? '') })),
    )
    const dropLocal = db.prepare(`DELETE FROM customers WHERE company_id = ? AND id = ?`)
    for (const id of repair.deleteIds) dropLocal.run(companyId, id)
    const fixErp = db.prepare(`UPDATE customers SET erp_id = ? WHERE company_id = ? AND id = ?`)
    for (const upd of repair.erpUpdates) fixErp.run(upd.erpId, companyId, upd.id)

    const prevRows = db.prepare(
      `SELECT id, balance, balance_updated_at, tax_office, customer_type, erp_id FROM customers WHERE company_id = ?`,
    ).all(companyId) as { id: string; balance: number | null; balance_updated_at: string | null; tax_office: string | null; customer_type: string | null; erp_id: string | null }[]
    const prev = new Map(prevRows.map(r => [String(r.id), r]))

    db.prepare('DELETE FROM customers_temp').run()

    const ins = db.prepare(`
      INSERT INTO customers_temp (id, company_id, code, name, phone, tax_no, address, balance,
        is_person, first_name, last_name, postal_code, city, district, email, tax_office, customer_type, erp_id, balance_updated_at, synced_at)
      VALUES (@id, @companyId, @code, @name, @phone, @taxNo, @address, @balance,
        @isPerson, @firstName, @lastName, @postalCode, @city, @district, @email, @taxOffice, @customerType, @erpId, @balanceUpdatedAt, @syncedAt)
    `)

    for (const c of items) {
      const old = prev.get(String(c.id))
      const known = c.balanceKnown !== false
      ins.run({
        id:        c.id,
        companyId,
        code:      c.code    ?? '',
        name:      c.name    ?? '',
        phone:     c.phone   ?? '',
        taxNo:     c.taxNo   ?? '',
        address:   c.address ?? '',
        balance:   known ? (c.balance ?? 0) : Number(old?.balance ?? 0),
        balanceUpdatedAt: known ? now : (old?.balance_updated_at ?? null),
        isPerson:  c.type === 'corporate' ? 0 : c.type === 'individual' ? 1 : (c.isPerson ? 1 : 0),
        firstName: c.firstName ?? '',
        lastName:  c.lastName  ?? '',
        postalCode: c.postalCode ?? '',
        city:       c.city       ?? '',
        district:   c.district   ?? '',
        email:      c.email      ?? '',
        taxOffice:  (c.taxOffice && c.taxOffice.trim()) ? c.taxOffice : String(old?.tax_office ?? ''),
        customerType: c.type === 'individual' || c.type === 'corporate' ? c.type : String(old?.customer_type ?? ''),
        erpId: String(c.erpId ?? '').trim() || String(old?.erp_id ?? ''),
        syncedAt:  now,
      })
      inserted++
    }

    const cnt = (db.prepare('SELECT COUNT(*) as c FROM customers_temp').get() as { c: number }).c
    if (cnt === 0) throw new Error('customers_temp boş — rollback')

    if (mode === 'full') {
      deleted = (db.prepare('SELECT COUNT(*) as c FROM customers WHERE company_id = ?').get(companyId) as { c: number }).c
      db.prepare('DELETE FROM customers WHERE company_id = ?').run(companyId)
      db.prepare('INSERT INTO customers SELECT * FROM customers_temp').run()
      inserted = items.length
    } else {
      db.prepare('INSERT OR REPLACE INTO customers SELECT * FROM customers_temp').run()
      updated = inserted
      inserted = 0
    }

    db.prepare('DELETE FROM customers_temp').run()
  })

  try {
    txn()
    return { success: true, inserted, updated, deleted }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

/** Yalnızca bakiye kolonları. Diğer cari alanlarına dokunmaz. */
export function updateCustomerBalance(customerId: string, balance: number, asOf: string | null): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE customers SET balance = ?, balance_updated_at = ? WHERE id = ?
  `).run(balance, asOf, customerId)
}

/** Fatura ile tahsilat ayrı kuyruk işi. Etki yalnız başarıyla gönderilmiş olanlardan. */
export function getSaleErpEffect(key: string): { invoiceSent: boolean; paymentsSentTotal: number } {
  const sqlite = getSqlite()
  const sale = sqlite.prepare(`
    SELECT invoice_sent, invoice_id FROM sales
    WHERE id = ? OR order_no = ? OR receipt_no = ?
    LIMIT 1
  `).get(key, key, key) as { invoice_sent?: number; invoice_id?: string | null } | undefined
  if (!sale || Number(sale.invoice_sent) !== 1 || !sale.invoice_id) {
    return { invoiceSent: Number(sale?.invoice_sent) === 1, paymentsSentTotal: 0 }
  }
  const rows = sqlite.prepare(`
    SELECT payload FROM operation_queue WHERE type = 'payment' AND status = 'success'
  `).all() as { payload: string }[]
  let total = 0
  for (const row of rows) {
    try {
      const p = JSON.parse(row.payload) as { invoice_id?: unknown; cash_amount?: unknown; card_amount?: unknown }
      if (String(p.invoice_id ?? '') !== String(sale.invoice_id)) continue
      total += Number(p.cash_amount ?? 0) + Number(p.card_amount ?? 0)
    } catch {
      /* bozuk satır bakiyeyi bozmasın */
    }
  }
  return { invoiceSent: true, paymentsSentTotal: parseFloat(total.toFixed(2)) }
}

export function getCustomerById(companyId: string, id: string): CustomerRow | null {
  if (!id.trim()) return null
  const db = getSqlite()
  const r = db.prepare(`
    SELECT * FROM customers WHERE company_id = ? AND id = ?
  `).get(companyId, id.trim()) as Record<string, unknown> | undefined
  if (!r) return null
  return mapCustomerRow(r)
}

export function getCustomerByCode(companyId: string, code: string): CustomerRow | null {
  const trimmed = code.trim()
  if (!trimmed) return null
  const db = getSqlite()
  const r = db.prepare(`
    SELECT * FROM customers WHERE company_id = ? AND code = ?
  `).get(companyId, trimmed) as Record<string, unknown> | undefined
  if (!r) return null
  return mapCustomerRow(r)
}

export function getCustomers(companyId: string, query?: string): CustomerRow[] {
  const db = getSqlite()
  if (query && query.trim()) {
    const q = `%${query.trim().toLowerCase()}%`
    const rows = db.prepare(`
      SELECT * FROM customers
      WHERE company_id = ?
        AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(tax_no) LIKE ? OR LOWER(IFNULL(email,'')) LIKE ?)
      ORDER BY name
      LIMIT 100
    `).all(companyId, q, q, q, q, q) as Record<string, unknown>[]
    return rows.map(mapCustomerRow)
  }
  const rows = db.prepare(`
    SELECT * FROM customers WHERE company_id = ? ORDER BY name LIMIT 500
  `).all(companyId) as Record<string, unknown>[]
  return rows.map(mapCustomerRow)
}

export type OperationQueueType =
  | 'invoice'
  | 'return_invoice'
  | 'customer'
  | 'day_end_invoice'
  | 'payment'
  | 'terminal_local_settings'
  | 'payment_device'
  | 'app_report'
  | 'cash_reconciliation'

export interface OperationQueueRow {
  id:          string
  companyId:   string
  type:        OperationQueueType
  payload:     string
  status:      'pending' | 'pending_dayend' | 'processing' | 'success' | 'failed' | 'done'
  attempts:    number
  maxAttempts: number
  error:       string | null
  createdAt:   string
  sentAt:      string | null
  label:       string | null
  invoiceNumber: string | null
}

function mapOperationQueueRow(r: Record<string, unknown>): OperationQueueRow {
  const st = String(r.status ?? 'pending')
  const status: OperationQueueRow['status'] =
    st === 'pending_dayend' || st === 'processing' || st === 'success' || st === 'failed' || st === 'done'
      ? st
      : 'pending'
  const tp = String(r.type ?? '')
  const type = ([
    'invoice', 'return_invoice', 'customer', 'day_end_invoice', 'payment',
    'terminal_local_settings', 'payment_device', 'app_report', 'cash_reconciliation',
  ].includes(tp) ? tp : 'invoice') as OperationQueueType
  return {
    id:          String(r.id ?? ''),
    companyId:   String(r.company_id ?? ''),
    type,
    payload:     String(r.payload ?? '{}'),
    status,
    attempts:    Number(r.attempts ?? 0),
    maxAttempts: Number(r.max_attempts ?? 3),
    error:       r.error != null ? String(r.error) : null,
    createdAt:   String(r.created_at ?? ''),
    sentAt:      r.sent_at != null ? String(r.sent_at) : null,
    label:       r.label != null ? String(r.label) : null,
    invoiceNumber: r.invoice_number != null && String(r.invoice_number).trim()
      ? String(r.invoice_number).trim()
      : null,
  }
}

export function upsertCustomer(row: CustomerRow): void {
  const db = getSqlite()
  const synced = row.syncedAt ?? new Date().toISOString()
  const erpId = String(row.erpId ?? '').trim()
  if (!erpId) return
  const id = String(row.id || erpId).trim()
  const previousId = String(row.previousId ?? '').trim()
  if (previousId && previousId !== id) {
    const target = db.prepare(`SELECT id FROM customers WHERE id = ?`).get(id) as { id: string } | undefined
    if (target) db.prepare(`DELETE FROM customers WHERE id = ?`).run(previousId)
    else db.prepare(`UPDATE customers SET id = ? WHERE id = ?`).run(id, previousId)
  }
  db.prepare(`
    INSERT INTO customers (id, company_id, code, name, phone, tax_no, address, balance,
      is_person, first_name, last_name, postal_code, city, district, email, tax_office, customer_type, erp_id, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      code=excluded.code,
      name=excluded.name, phone=excluded.phone, tax_no=excluded.tax_no,
      address=excluded.address, city=excluded.city, district=excluded.district,
      email=excluded.email, tax_office=excluded.tax_office,
      customer_type=excluded.customer_type,
      erp_id=excluded.erp_id,
      is_person=excluded.is_person, first_name=excluded.first_name, last_name=excluded.last_name,
      postal_code=excluded.postal_code,
      synced_at=excluded.synced_at
  `).run(
    id,
    row.companyId,
    row.code,
    row.name,
    row.phone,
    row.taxNo,
    row.address,
    row.balance,
    row.type === 'corporate' ? 0 : row.type === 'individual' ? 1 : (row.isPerson ? 1 : 0),
    row.firstName,
    row.lastName,
    row.postalCode,
    row.city,
    row.district,
    row.email ?? '',
    row.taxOffice ?? '',
    row.type === 'individual' || row.type === 'corporate' ? row.type : '',
    erpId,
    synced,
  )
}

export function enqueueOperation(params: {
  id:        string
  companyId: string
  type:      OperationQueueType
  payload:   Record<string, unknown>
  label?:    string
  status?:   'pending' | 'pending_dayend'
}): { inserted: boolean } {
  const db = getSqlite()
  const status = params.status ?? 'pending'
  const run = db.transaction(() => {
    if (params.type === 'payment') {
      const invoiceId = String(params.payload.invoice_id ?? '').trim()
      if (invoiceId) {
        const dup = db.prepare(`
          SELECT id FROM operation_queue
          WHERE type = 'payment'
            AND json_extract(payload, '$.invoice_id') = ?
          LIMIT 1
        `).get(invoiceId)
        if (dup) return false
      }
    }
    if (params.type === 'invoice') {
      const saleId = String(params.payload.sale_id ?? '').trim()
      if (saleId) {
        const dup = db.prepare(`
          SELECT id FROM operation_queue
          WHERE type = 'invoice'
            AND json_extract(payload, '$.sale_id') = ?
          LIMIT 1
        `).get(saleId)
        if (dup) return false
      }
    }
    if (params.type === 'terminal_local_settings' || params.type === 'payment_device' || params.type === 'app_report') {
      db.prepare(`
        DELETE FROM operation_queue
        WHERE company_id = ? AND type = ? AND status = 'pending'
      `).run(params.companyId, params.type)
    }
    db.prepare(`
      INSERT INTO operation_queue (id, company_id, type, payload, status, attempts, created_at, label)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      params.id,
      params.companyId,
      params.type,
      JSON.stringify(params.payload),
      status,
      new Date().toISOString(),
      params.label ?? null,
    )
    return true
  })
  return { inserted: run() }
}

export function markOperationDone(id: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue SET status = 'done', sent_at = ? WHERE id = ?
  `).run(new Date().toISOString(), id)
}

export function getPendingReturnInvoices(companyId: string): OperationQueueRow[] {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT * FROM operation_queue
    WHERE company_id = ?
      AND type = 'return_invoice'
      AND status = 'pending_dayend'
    ORDER BY created_at ASC
  `).all(companyId) as Record<string, unknown>[]
  return rows.map(mapOperationQueueRow)
}

export function getPendingOperations(companyId: string): OperationQueueRow[] {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT * FROM operation_queue
    WHERE company_id = ? AND status = 'pending' AND attempts < max_attempts
    ORDER BY created_at ASC
  `).all(companyId) as Record<string, unknown>[]
  return rows.map(mapOperationQueueRow)
}

export function getAllOperations(companyId: string, limit = 100): OperationQueueRow[] {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT * FROM operation_queue
    WHERE company_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(companyId, limit) as Record<string, unknown>[]
  return rows.map(mapOperationQueueRow)
}

export function markOperationProcessing(id: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ?
  `).run(id)
}

export function markOperationSuccess(id: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue SET status = 'success', sent_at = ?, error = NULL WHERE id = ?
  `).run(new Date().toISOString(), id)
}

export function markOperationFailed(id: string, error: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        error = ?
    WHERE id = ?
  `).run(error, id)
}

export function retryOperation(id: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue SET status = 'pending', attempts = 0, error = NULL WHERE id = ?
  `).run(id)
}

export function retryOperationsByErrorPrefix(companyId: string, errorPrefix: string): number {
  const db = getSqlite()
  const pattern = `${errorPrefix}%`
  const result = db.prepare(`
    UPDATE operation_queue
    SET status = 'pending', attempts = 0, error = NULL
    WHERE company_id = ? AND status = 'failed' AND error LIKE ?
  `).run(companyId, pattern)
  return result.changes
}

export function updateOperationPayload(id: string, payload: Record<string, unknown>): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue SET payload = ? WHERE id = ?
  `).run(JSON.stringify(payload), id)
}

/** Bekleyen veya hatalı kuyruk satırında yalnızca cari alanlarını yeniler. */
export function refreshOperationCustomer(
  id: string,
  next: {
    ref: { type: 'torba' } | { type: 'customer'; id: string }
    customer: Record<string, unknown>
    customerErpId: number
    customerName?: string
    touchName: boolean
  },
  previousCode: string,
): boolean {
  const db = getSqlite()
  let changed = false
  const run = db.transaction(() => {
    const row = db.prepare(`SELECT payload, status FROM operation_queue WHERE id = ?`).get(id) as {
      payload: string
      status: string
    } | undefined
    if (!row || (row.status !== 'pending' && row.status !== 'failed')) return
    const payload = JSON.parse(row.payload) as Record<string, unknown>
    const patched = applyCustomerPatch(payload, next, previousCode, new Date().toISOString())
    db.prepare(`
      UPDATE operation_queue
      SET payload = ?, status = 'pending', attempts = 0, error = NULL
      WHERE id = ?
    `).run(JSON.stringify(patched), id)
    changed = true
  })
  run()
  return changed
}

export function markOperationConfigFailed(id: string, error: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue
    SET status = 'failed', error = ?, attempts = max_attempts
    WHERE id = ?
  `).run(error, id)
}

export function markOperationManuallySent(id: string, note: string): void {
  const db = getSqlite()
  const at = new Date().toISOString()
  console.log(`[operation_queue] manual sent id=${id} note=${note}`)
  db.prepare(`
    UPDATE operation_queue SET status = 'success', sent_at = ?, error = NULL WHERE id = ?
  `).run(at, id)
}

export function deleteOperation(id: string): void {
  const db = getSqlite()
  const run = db.transaction(() => {
    const row = db.prepare(`
      SELECT type FROM operation_queue WHERE id = ?
    `).get(id) as { type: string } | undefined
    db.prepare(`DELETE FROM operation_queue WHERE id = ?`).run(id)
    if (row?.type === 'day_end_invoice') {
      db.prepare(`
        UPDATE sales
        SET day_end_queue_id = NULL
        WHERE day_end_queue_id = ?
          AND invoice_sent = 0
      `).run(id)
    }
  })
  run()
}

export interface SalesReportRow {
  id:           string
  receiptNo:    string
  orderNo:      string | null
  type:         'sale' | 'return' | 'payment'
  netAmount:    number
  cashAmount:   number
  cardAmount:   number
  customerName: string | null
  cashierName:  string | null
  createdAt:    string
  invoiceSent:  number
  invoiceId:    string | null
  invoiceNumber: string | null
  invoiceError: string | null
  dayEndRunId:  string | null
  isReturn:     number
  payments: Array<{
    method:       string
    amount:       number
    acquirerName: string | null
  }>
}

export function getSalesReport(opts: {
  dateFrom: string
  dateTo:   string
}): SalesReportRow[] {
  const db = getSqlite()

  const rows = db.prepare(`
    SELECT
      s.id, s.receipt_no, s.order_no, s.net_amount, s.cash_amount, s.card_amount,
      s.customer_name, s.cashier_name, s.created_at,
      s.invoice_sent, s.invoice_id, s.invoice_number, s.invoice_error, s.day_end_run_id, s.is_return
    FROM sales s
    WHERE date(s.created_at) >= ? AND date(s.created_at) <= ?
    ORDER BY s.created_at DESC
  `).all(opts.dateFrom, opts.dateTo) as Record<string, unknown>[]

  const payStmt = db.prepare(`
    SELECT method, amount, acquirer_name
    FROM sale_payments WHERE sale_id = ?
  `)

  return rows.map(s => {
    const payments = payStmt.all(String(s.id)) as {
      method: string
      amount: number
      acquirer_name: string | null
    }[]

    return {
      id:           String(s.id),
      receiptNo:    String(s.receipt_no),
      orderNo:      s.order_no != null ? String(s.order_no) : null,
      type:         s.is_return ? 'return' as const : 'sale' as const,
      netAmount:    Number(s.net_amount),
      cashAmount:   Number(s.cash_amount ?? 0),
      cardAmount:   Number(s.card_amount ?? 0),
      customerName: s.customer_name ? String(s.customer_name) : null,
      cashierName:  s.cashier_name  ? String(s.cashier_name)  : null,
      createdAt:    String(s.created_at),
      invoiceSent:  Number(s.invoice_sent ?? 0),
      invoiceId:    s.invoice_id    ? String(s.invoice_id)    : null,
      invoiceNumber: s.invoice_number ? String(s.invoice_number) : null,
      invoiceError: s.invoice_error ? String(s.invoice_error) : null,
      dayEndRunId:  s.day_end_run_id ? String(s.day_end_run_id) : null,
      isReturn:     Number(s.is_return ?? 0),
      payments: payments.map(p => ({
        method:       p.method,
        amount:       p.amount,
        acquirerName: p.acquirer_name,
      })),
    }
  })
}

export function getDayEndReport(opts: {
  dateFrom: string
  dateTo:   string
}): Array<{
  id: string
  label: string | null
  status: string
  created_at: string
  sent_at: string | null
  error: string | null
}> {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT id, label, status, created_at, sent_at, error
    FROM operation_queue
    WHERE type = 'day_end_invoice'
      AND date(created_at) >= ? AND date(created_at) <= ?
    ORDER BY created_at DESC
  `).all(opts.dateFrom, opts.dateTo) as Record<string, unknown>[]

  return rows.map(r => ({
    id:         String(r.id),
    label:      r.label != null ? String(r.label) : null,
    status:     String(r.status),
    created_at: String(r.created_at),
    sent_at:    r.sent_at != null ? String(r.sent_at) : null,
    error:      r.error != null ? String(r.error) : null,
  }))
}

export interface CariPaymentSaveRow {
  id:           string
  companyId:    string
  type:         'tahsilat' | 'odeme'
  amount:       number
  customerId?:  string
  customerName?: string
  customerCode?: string
  cashierId?:   string
  cashierName?: string
  description?: string
  createdAt:    string
  method?:      'cash' | 'card' | null
}

export interface CariPaymentReportRow {
  id:            string
  type:          'tahsilat' | 'odeme'
  amount:        number
  customer_name: string | null
  customer_code: string | null
  cashier_name:  string | null
  description:   string | null
  created_at:    string
}

export function saveCariPayment(row: CariPaymentSaveRow): void {
  const db = getSqlite()
  const method = row.method ?? null
  if (row.type === 'odeme' && method !== 'cash') {
    console.warn('[cari-odeme] blocked non-cash', { id: row.id, method })
    throw new Error('Cari ödeme yalnızca nakit olabilir')
  }
  db.prepare(`
    INSERT INTO cari_payments
      (id, company_id, type, amount, customer_id, customer_name,
       customer_code, cashier_id, cashier_name, description, created_at, method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.companyId, row.type, row.amount,
    row.customerId ?? null, row.customerName ?? null,
    row.customerCode ?? null, row.cashierId ?? null,
    row.cashierName ?? null, row.description ?? null,
    row.createdAt, method,
  )
}

export function getCariPayments(opts: {
  dateFrom:  string
  dateTo:    string
  companyId: string
}): CariPaymentReportRow[] {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT * FROM cari_payments
    WHERE company_id = ?
      AND date(created_at) >= ?
      AND date(created_at) <= ?
    ORDER BY created_at DESC
  `).all(opts.companyId, opts.dateFrom, opts.dateTo) as Record<string, unknown>[]

  return rows.map(r => ({
    id:            String(r.id),
    type:          String(r.type) as 'tahsilat' | 'odeme',
    amount:        Number(r.amount),
    customer_name: r.customer_name != null ? String(r.customer_name) : null,
    customer_code: r.customer_code != null ? String(r.customer_code) : null,
    cashier_name:  r.cashier_name  != null ? String(r.cashier_name)  : null,
    description:   r.description   != null ? String(r.description)   : null,
    created_at:    String(r.created_at),
  }))
}

export function saveEnabledBrands(
  terminalId: string,
  brands: Array<{ payment_provider_brand_id: number; payment_provider_brand_nm: string; payment_mediator: number }>
): void {
  const db = getSqlite()
  db.prepare(`DELETE FROM enabled_payment_brands WHERE terminal_id = ?`).run(terminalId)
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO enabled_payment_brands
      (terminal_id, payment_provider_brand_id, payment_provider_brand_nm, payment_mediator, synced_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  for (const b of brands) {
    stmt.run(terminalId, b.payment_provider_brand_id, b.payment_provider_brand_nm, b.payment_mediator, new Date().toISOString())
  }
}

export function getEnabledBrands(terminalId: string): Array<{
  payment_provider_brand_id: number
  payment_provider_brand_nm: string
  payment_mediator:          number
}> {
  return getSqlite().prepare(
    `SELECT payment_provider_brand_id, payment_provider_brand_nm, payment_mediator
     FROM enabled_payment_brands WHERE terminal_id = ? ORDER BY payment_provider_brand_id ASC`
  ).all(terminalId) as Array<{ payment_provider_brand_id: number; payment_provider_brand_nm: string; payment_mediator: number }>
}

export interface BarcodeFormatRow {
  id:                  string
  company_id:          string
  terminal_id:         string
  flag_code:           number
  type:                'weighted' | 'counted'
  integer_length:      number
  decimal_length:      number
  decimal_multiplier:  number
  minimum_value:       number
  is_active:           boolean
  label:               string | null
}

export function saveBarcodeFormats(
  terminalId: string,
  formats: BarcodeFormatRow[]
): void {
  const db = getSqlite()
  db.prepare(`DELETE FROM barcode_formats_cache WHERE terminal_id = ?`).run(terminalId)
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO barcode_formats_cache
      (id, company_id, terminal_id, flag_code, type,
       integer_length, decimal_length, decimal_multiplier,
       minimum_value, is_active, label, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const f of formats) {
    stmt.run(
      f.id, f.company_id, f.terminal_id, f.flag_code, f.type,
      f.integer_length, f.decimal_length, f.decimal_multiplier,
      f.minimum_value, f.is_active ? 1 : 0, f.label,
      new Date().toISOString(),
    )
  }
}

export function getBarcodeFormats(terminalId: string): BarcodeFormatRow[] {
  return getSqlite().prepare(`
    SELECT * FROM barcode_formats_cache
    WHERE terminal_id = ? AND is_active = 1
    ORDER BY flag_code ASC
  `).all(terminalId) as BarcodeFormatRow[]
}

export interface CashReconciliationRow {
  id: string
  terminalId: string
  cashierId: string | null
  filterCashierId: string | null
  periodStart: string
  periodEnd: string
  periodOverridden: number
  entered: string
  lockedAt: string
  lines: string
  cashDetail: string
  info: string
  totalDiff: number
  note: string | null
  createdAt: string
  synced: number
  cashierName: string | null
}

function mapReconciliation(r: Record<string, unknown>): CashReconciliationRow {
  return {
    id: String(r.id ?? ''),
    terminalId: String(r.terminal_id ?? ''),
    cashierId: r.cashier_id != null ? String(r.cashier_id) : null,
    filterCashierId: r.filter_cashier_id != null ? String(r.filter_cashier_id) : null,
    periodStart: String(r.period_start ?? ''),
    periodEnd: String(r.period_end ?? ''),
    periodOverridden: Number(r.period_overridden ?? 0),
    entered: String(r.entered ?? '{}'),
    lockedAt: String(r.locked_at ?? ''),
    lines: String(r.lines ?? '[]'),
    cashDetail: String(r.cash_detail ?? '{}'),
    info: String(r.info ?? '{}'),
    totalDiff: Number(r.total_diff ?? 0),
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
    synced: Number(r.synced ?? 0),
    cashierName: r.cashier_name != null ? String(r.cashier_name) : null,
  }
}

/** Son başarılı gün sonu gönderimi. Ayrı Z saati tablosu yok. */
export function getLastDayEndAt(): string | null {
  const row = getSqlite().prepare(`
    SELECT COALESCE(sent_at, created_at) AS ts
    FROM operation_queue
    WHERE type = 'day_end_invoice' AND status IN ('success', 'done')
    ORDER BY ts DESC
    LIMIT 1
  `).get() as { ts?: string } | undefined
  const ts = row?.ts?.trim()
  return ts ? ts : null
}

export function getLastCountedCash(terminalId: string): number | null {
  const row = getSqlite().prepare(`
    SELECT cash_detail FROM cash_reconciliations
    WHERE terminal_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(terminalId) as { cash_detail?: string } | undefined
  if (!row?.cash_detail) return null
  try {
    const detail = JSON.parse(row.cash_detail) as { carry_over?: unknown; counted?: unknown }
    const carry = Number(detail.carry_over)
    if (Number.isFinite(carry)) return carry
    const counted = Number(detail.counted)
    return Number.isFinite(counted) ? counted : null
  } catch {
    return null
  }
}

function loadReconDefs(terminalId: string): {
  banks: Array<{ acquirerId: string; label: string }>
  brands: Array<{ brandId: number; mediator: number; label: string }>
} {
  const db = getSqlite()
  const accounts = db.prepare(`
    SELECT payment_type, pavo_acquirer_id, isbasi_account_name
    FROM payment_accounts_cache
    WHERE pavo_acquirer_id IS NOT NULL AND TRIM(pavo_acquirer_id) != ''
  `).all() as Array<Record<string, unknown>>
  const brands = db.prepare(`
    SELECT payment_provider_brand_id, payment_provider_brand_nm, payment_mediator
    FROM enabled_payment_brands
    WHERE terminal_id = ?
    ORDER BY payment_provider_brand_id ASC
  `).all(terminalId) as Array<Record<string, unknown>>
  return {
    banks: accounts
      .filter(r => String(r.payment_type ?? '') !== 'cash')
      .map(r => ({
        acquirerId: String(r.pavo_acquirer_id),
        label: String(r.isbasi_account_name || r.pavo_acquirer_id),
      })),
    brands: brands.map(r => ({
      brandId: Number(r.payment_provider_brand_id ?? 0),
      mediator: Number(r.payment_mediator ?? 0),
      label: String(r.payment_provider_brand_nm ?? ''),
    })),
  }
}

export function listReconCatalog(terminalId: string): {
  banks: ReconCatalogItem[]
  others: ReconCatalogItem[]
} {
  const defs = loadReconDefs(terminalId)
  return catalogFromDefs(defs.banks, defs.brands)
}

export function computeCashReconciliation(opts: {
  companyId: string
  terminalId: string
  startIso: string
  endIso: string
  cashierId: string | null
}): ReconSnapshot {
  const db = getSqlite()
  const cashier = opts.cashierId ?? ''
  const sales = db.prepare(`
    SELECT id, is_return, net_amount, discount_amount, cash_amount, card_amount
    FROM sales
    WHERE created_at >= ? AND created_at <= ?
      AND (? = '' OR cashier_id = ?)
  `).all(opts.startIso, opts.endIso, cashier, cashier) as Array<Record<string, unknown>>

  const payments = db.prepare(`
    SELECT sp.sale_id, sp.method, sp.amount, sp.mediator, sp.acquirer_id, sp.acquirer_name, s.is_return
    FROM sale_payments sp
    JOIN sales s ON s.id = sp.sale_id
    WHERE s.created_at >= ? AND s.created_at <= ?
      AND (? = '' OR s.cashier_id = ?)
  `).all(opts.startIso, opts.endIso, cashier, cashier) as Array<Record<string, unknown>>

  const collections = db.prepare(`
    SELECT amount, method
    FROM cari_payments
    WHERE company_id = ?
      AND type = 'tahsilat'
      AND created_at >= ? AND created_at <= ?
      AND (? = '' OR cashier_id = ?)
  `).all(opts.companyId, opts.startIso, opts.endIso, cashier, cashier) as Array<Record<string, unknown>>

  const disbursements = db.prepare(`
    SELECT amount, method
    FROM cari_payments
    WHERE company_id = ?
      AND type = 'odeme'
      AND created_at >= ? AND created_at <= ?
      AND (? = '' OR cashier_id = ?)
  `).all(opts.companyId, opts.startIso, opts.endIso, cashier, cashier) as Array<Record<string, unknown>>

  const defs = loadReconDefs(opts.terminalId)

  return aggregateReconciliation({
    sales: sales.map(r => ({
      id: String(r.id),
      isReturn: Number(r.is_return ?? 0) === 1,
      netAmount: Number(r.net_amount ?? 0),
      discountAmount: Number(r.discount_amount ?? 0),
      cashAmount: Number(r.cash_amount ?? 0),
      cardAmount: Number(r.card_amount ?? 0),
    })),
    payments: payments.map(r => ({
      saleId: String(r.sale_id),
      method: String(r.method ?? ''),
      amount: Number(r.amount ?? 0),
      mediator: r.mediator == null ? null : Number(r.mediator),
      acquirerId: r.acquirer_id != null ? String(r.acquirer_id) : null,
      acquirerName: r.acquirer_name != null ? String(r.acquirer_name) : null,
      isReturn: Number(r.is_return ?? 0) === 1,
    })),
    collections: collections.map(r => ({
      amount: Number(r.amount ?? 0),
      method: r.method != null ? String(r.method) : null,
    })),
    disbursements: disbursements.map(r => ({
      amount: Number(r.amount ?? 0),
      method: r.method != null ? String(r.method) : null,
    })),
    banks: defs.banks,
    brands: defs.brands,
  })
}

export function saveCashReconciliation(row: {
  id: string
  terminalId: string
  cashierId: string | null
  filterCashierId: string | null
  periodStart: string
  periodEnd: string
  periodOverridden: number
  entered: string
  lockedAt: string
  lines: string
  cashDetail: string
  info: string
  totalDiff: number
  note: string | null
  createdAt: string
}): void {
  getSqlite().prepare(`
    INSERT INTO cash_reconciliations (
      id, terminal_id, cashier_id, filter_cashier_id,
      period_start, period_end, period_overridden, entered, locked_at,
      lines, cash_detail, info, total_diff, note, created_at, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    row.id,
    row.terminalId,
    row.cashierId,
    row.filterCashierId,
    row.periodStart,
    row.periodEnd,
    row.periodOverridden ? 1 : 0,
    row.entered,
    row.lockedAt,
    row.lines,
    row.cashDetail,
    row.info,
    row.totalDiff,
    row.note,
    row.createdAt,
  )
}

export function finalizeCashReconciliation(row: {
  id: string
  note: string | null
  cashDetail: string
}): void {
  getSqlite().prepare(`
    UPDATE cash_reconciliations
    SET note = ?, cash_detail = ?
    WHERE id = ?
  `).run(row.note, row.cashDetail, row.id)
}

export function listCashReconciliations(terminalId: string, limit = 30): CashReconciliationRow[] {
  const rows = getSqlite().prepare(`
    SELECT r.*, c.full_name AS cashier_name
    FROM cash_reconciliations r
    LEFT JOIN cashiers c ON c.id = r.cashier_id
    WHERE r.terminal_id = ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(terminalId, limit) as Record<string, unknown>[]
  return rows.map(mapReconciliation)
}

export function markCashReconciliationSynced(id: string): void {
  getSqlite().prepare(`UPDATE cash_reconciliations SET synced = 1 WHERE id = ?`).run(id)
}
