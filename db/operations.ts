import { getDB } from './index'
import { products, sales, saleItems, cashiers, heldDocuments, pluGroupsCache, pluItemsCache, posSettingsCache, commandHistory } from './schema'
import { eq, gte, lte, and, asc, desc } from 'drizzle-orm'
import { randomUUID } from 'crypto'

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
}

export interface SaleItem {
  productId?: string
  productName: string
  quantity: number
  unitPrice: number
  vatRate: number
  lineTotal: number
}

export interface SaleRow {
  receiptNo: string
  totalAmount: number
  paymentType: 'cash' | 'card' | 'mixed'
  cashAmount: number
  cardAmount: number
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

export function saveSale(sale: SaleRow, items: SaleItem[]): string {
  const db = getDB()
  const saleId = randomUUID()
  const now = new Date().toISOString()

  db.insert(sales).values({
    id: saleId,
    receiptNo: sale.receiptNo,
    totalAmount: sale.totalAmount,
    paymentType: sale.paymentType,
    cashAmount: sale.cashAmount,
    cardAmount: sale.cardAmount,
    createdAt: now,
    synced: false,
  }).run()

  for (const item of items) {
    db.insert(saleItems).values({
      id: randomUUID(),
      saleId,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      lineTotal: item.lineTotal,
    }).run()
  }

  return saleId
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

export interface CashierRow {
  id: string
  fullName: string
  cashierCode: string
  password: string
  role: string
  isActive: boolean
}

export function saveCashiers(items: CashierRow[]): number {
  const db = getDB()
  db.delete(cashiers).run()

  const now = new Date().toISOString()
  for (const item of items) {
    db.insert(cashiers).values({
      id:          item.id,
      fullName:    item.fullName,
      cashierCode: item.cashierCode,
      password:    item.password,
      role:        item.role ?? 'cashier',
      isActive:    item.isActive ?? true,
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

export function getAllCashiers(): CashierRow[] {
  const db = getDB()
  return db.select().from(cashiers)
    .where(eq(cashiers.isActive, true))
    .all() as CashierRow[]
}

export interface HeldCartLine {
  id:        string
  code:      string
  name:      string
  category:  string
  price:     number
  vatRate:   number
  unit:      string
  quantity:  number
  lineTotal: number
}

export interface HeldDoc {
  id:          string
  companyId:   string
  label?:      string
  items:       HeldCartLine[]
  totalAmount: number
  createdAt:   string
}

export function holdDocument(doc: Omit<HeldDoc, 'id' | 'createdAt'>): string {
  const db  = getDB()
  const id  = randomUUID()
  const now = new Date().toISOString()
  db.insert(heldDocuments).values({
    id,
    companyId:   doc.companyId,
    label:       doc.label ?? null,
    items:       JSON.stringify(doc.items),
    totalAmount: doc.totalAmount,
    createdAt:   now,
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
    id:          r.id,
    companyId:   r.companyId,
    label:       r.label ?? undefined,
    items:       JSON.parse(r.items) as HeldCartLine[],
    totalAmount: r.totalAmount ?? 0,
    createdAt:   r.createdAt,
  }))
}

export function deleteHeldDocument(id: string): void {
  const db = getDB()
  db.delete(heldDocuments).where(eq(heldDocuments.id, id)).run()
}

export interface PluGroupCacheRow {
  id:          string
  companyId:   string
  workplaceId?: string
  name:        string
  color:       string
  sortOrder:   number
  plu_items:   Array<{ id: string; product_code: string; sort_order: number }>
}

export interface PosSettingsRow {
  showPrice:   boolean
  showCode:    boolean
  showBarcode: boolean
  source:      string
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

export function getPluGroups(companyId: string, workplaceId?: string | null): PluGroupCacheRow[] {
  const db = getDB()

  let groups = workplaceId
    ? db.select().from(pluGroupsCache)
      .where(and(
        eq(pluGroupsCache.companyId, companyId),
        eq(pluGroupsCache.workplaceId, workplaceId)
      ))
      .orderBy(asc(pluGroupsCache.sortOrder))
      .all()
    : []

  if (groups.length === 0) {
    groups = db.select().from(pluGroupsCache)
      .where(eq(pluGroupsCache.companyId, companyId))
      .orderBy(asc(pluGroupsCache.sortOrder))
      .all()
  }

  return groups.map(g => {
    const items = db.select().from(pluItemsCache)
      .where(eq(pluItemsCache.groupId, g.id))
      .orderBy(asc(pluItemsCache.sortOrder))
      .all()
    return {
      id:          g.id,
      companyId:   g.companyId,
      workplaceId: g.workplaceId ?? undefined,
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

export function savePosSettings(settings: PosSettingsRow): void {
  const db = getDB()
  const now = new Date().toISOString()
  db.insert(posSettingsCache).values({
    id:          'local',
    showPrice:   settings.showPrice,
    showCode:    settings.showCode,
    showBarcode: settings.showBarcode,
    source:      settings.source,
    syncedAt:    now,
  }).onConflictDoUpdate({
    target: posSettingsCache.id,
    set: {
      showPrice:   settings.showPrice,
      showCode:    settings.showCode,
      showBarcode: settings.showBarcode,
      source:      settings.source,
      syncedAt:    now,
    },
  }).run()
}

export function getPosSettings(): PosSettingsRow {
  const db  = getDB()
  const row = db.select().from(posSettingsCache)
    .where(eq(posSettingsCache.id, 'local'))
    .get()
  return {
    showPrice:   row?.showPrice   ?? true,
    showCode:    row?.showCode    ?? true,
    showBarcode: row?.showBarcode ?? false,
    source:      row?.source      ?? 'default',
  }
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
  const db = getDB()
  db.insert(commandHistory).values({
    id:         row.id,
    command:    row.command,
    payload:    JSON.stringify(row.payload ?? {}),
    status:     row.status,
    receivedAt: row.receivedAt,
    doneAt:     row.doneAt ?? null,
  }).run()
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
