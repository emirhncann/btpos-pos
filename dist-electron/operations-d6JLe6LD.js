"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const main = require("./main-BLCuc2i2.js");
const crypto = require("crypto");
function saveProducts(items) {
  const db = main.getDB();
  db.delete(main.products).run();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const item of items) {
    db.insert(main.products).values({
      id: item.id || crypto.randomUUID(),
      code: item.code ?? "",
      name: item.name,
      barcode: item.barcode ?? "",
      price: item.price ?? 0,
      vatRate: item.vatRate ?? 18,
      unit: item.unit ?? "Adet",
      stock: item.stock ?? 0,
      category: item.category ?? "",
      syncedAt: now
    }).run();
  }
  return items.length;
}
function getAllProducts() {
  const db = main.getDB();
  return db.select().from(main.products).all();
}
function saveSale(sale, items) {
  const db = main.getDB();
  const saleId = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.insert(main.sales).values({
    id: saleId,
    receiptNo: sale.receiptNo,
    totalAmount: sale.totalAmount,
    paymentType: sale.paymentType,
    cashAmount: sale.cashAmount,
    cardAmount: sale.cardAmount,
    createdAt: now,
    synced: false
  }).run();
  for (const item of items) {
    db.insert(main.saleItems).values({
      id: crypto.randomUUID(),
      saleId,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      lineTotal: item.lineTotal
    }).run();
  }
  return saleId;
}
function getSales(dateFrom, dateTo) {
  const db = main.getDB();
  if (dateFrom && dateTo) {
    return db.select().from(main.sales).where(main.and(main.gte(main.sales.createdAt, dateFrom), main.lte(main.sales.createdAt, dateTo))).all();
  }
  return db.select().from(main.sales).all();
}
exports.getAllProducts = getAllProducts;
exports.getSales = getSales;
exports.saveProducts = saveProducts;
exports.saveSale = saveSale;
