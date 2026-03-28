import { getDB } from './index'
import { products, sales, saleItems, cashiers } from './schema'
import { eq, gte, lte, and } from 'drizzle-orm'
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
