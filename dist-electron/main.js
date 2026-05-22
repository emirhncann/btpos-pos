"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const electron = require("electron");
const child_process = require("child_process");
const fs = require("fs");
const path = require("path");
const Store = require("electron-store");
const os = require("os");
const crypto = require("crypto");
const net = require("net");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
const crypto__namespace = /* @__PURE__ */ _interopNamespaceDefault(crypto);
function getDeviceUID() {
  const mac = getPrimaryMac();
  const raw = `${os__namespace.hostname()}-${mac}-${os__namespace.platform()}-${os__namespace.arch()}`;
  return crypto__namespace.createHash("sha256").update(raw).digest("hex").substring(0, 32);
}
function getPrimaryMac() {
  var _a;
  const interfaces = os__namespace.networkInterfaces();
  return ((_a = Object.values(interfaces).flat().find((i) => i && !i.internal && i.mac !== "00:00:00:00:00:00")) == null ? void 0 : _a.mac) ?? "unknown";
}
function getDeviceInfo() {
  return {
    device_name: os__namespace.hostname(),
    mac_address: getPrimaryMac(),
    os_info: `${os__namespace.type()} ${os__namespace.release()} (${os__namespace.arch()})`,
    device_uid: getDeviceUID()
  };
}
const ESC = 27;
const GS = 29;
const TR_MAP = {
  "ş": 159,
  "Ş": 158,
  "ı": 141,
  "İ": 152,
  "ğ": 166,
  "Ğ": 167,
  "ü": 129,
  "Ü": 154,
  "ö": 148,
  "Ö": 153,
  "ç": 135,
  "Ç": 128
};
function encodeText(s) {
  const bytes = [];
  for (const ch of s) {
    const code = TR_MAP[ch];
    if (code !== void 0) {
      bytes.push(code);
    } else {
      const c = ch.charCodeAt(0);
      bytes.push(c < 256 ? c : 63);
    }
  }
  bytes.push(10);
  return Buffer.from(bytes);
}
function init() {
  return Buffer.from([
    ESC,
    64,
    // initialize
    ESC,
    116,
    4
    // code page CP857 (Türkçe)
  ]);
}
function cut() {
  return Buffer.from([GS, 86, 65, 3]);
}
function bold(on) {
  return Buffer.from([ESC, 69, on ? 1 : 0]);
}
function align(a) {
  return Buffer.from([ESC, 97, a === "left" ? 0 : a === "center" ? 1 : 2]);
}
function feed(n = 1) {
  return Buffer.from([ESC, 100, n]);
}
function fontSmall(on) {
  return Buffer.from([ESC, 77, on ? 1 : 0]);
}
function text(s) {
  return encodeText(s);
}
class Receipt {
  constructor() {
    __publicField(this, "buf", []);
  }
  init() {
    this.buf.push(init());
    return this;
  }
  cut() {
    this.buf.push(cut());
    return this;
  }
  build() {
    return Buffer.concat(this.buf);
  }
  add(b) {
    this.buf.push(b);
    return this;
  }
  br(n = 1) {
    this.buf.push(feed(n));
    return this;
  }
  div(w = 42) {
    return this.add(text("─".repeat(w)));
  }
  center(s) {
    return this.add(align("center")).add(text(s));
  }
  left(s) {
    return this.add(align("left")).add(text(s));
  }
}
let nodePrinter = null;
function loadNodePrinter() {
  if (nodePrinter) return nodePrinter;
  try {
    nodePrinter = require("@thiagoelg/node-printer");
    return nodePrinter;
  } catch (e) {
    console.warn("[printer] node-printer yüklenemedi:", e);
    return null;
  }
}
function sendToNetwork(ip, port, data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(5e3);
    socket.connect(port, ip, () => {
      socket.write(data, () => {
        socket.destroy();
        resolve();
      });
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Yazıcı zaman aşımı"));
    });
  });
}
function printUsb(printerName, data) {
  const pr = loadNodePrinter();
  if (!pr) {
    throw new Error("USB yazıcı modülü kullanılamıyor (node-printer derlenmemiş olabilir)");
  }
  return new Promise((resolve, reject) => {
    pr.printDirect({
      data,
      printer: printerName,
      type: "RAW",
      success: () => resolve(),
      error: (err) => reject(err)
    });
  });
}
function listPrinters() {
  try {
    const pr = loadNodePrinter();
    if (!pr) return [];
    return pr.getPrinters().map((p) => ({
      name: p.name,
      isDefault: Boolean(p.isDefault)
    }));
  } catch {
    return [];
  }
}
function settingsRowToConfig(row) {
  return {
    type: row.printer_type === "network" ? "network" : "usb",
    printerName: row.printer_name ? String(row.printer_name) : void 0,
    ip: row.printer_ip ? String(row.printer_ip) : void 0,
    port: Number(row.printer_port ?? 9100),
    paperWidth: Number(row.paper_width ?? 80)
  };
}
function isPrinterActive(row) {
  var _a, _b;
  if (!row) return false;
  if (row.is_active === false || row.is_active === 0) return false;
  const type = row.printer_type === "network" ? "network" : "usb";
  if (type === "network") return Boolean((_a = row.printer_ip) == null ? void 0 : _a.toString().trim());
  return Boolean((_b = row.printer_name) == null ? void 0 : _b.toString().trim());
}
async function printReceipt(config, data) {
  if (config.type === "network" && config.ip) {
    await sendToNetwork(config.ip, config.port ?? 9100, data);
    return;
  }
  if (config.type === "usb" && config.printerName) {
    await printUsb(config.printerName, data);
    return;
  }
  throw new Error("Yazıcı ayarı eksik");
}
const LOGO_ASCII = [
  "  ____  _____  ____   ___  ____ ",
  " | __ )_   _||  _ \\ / _ \\/ ___|",
  " |  _ \\ | |  | |_) | | | \\___ \\",
  " | |_) || |  |  __/| |_| |___) |",
  " |____/ |_|  |_|    \\___/|____/ "
];
function buildPaymentReceipt(opts) {
  var _a;
  const w = opts.paperWidth === 58 ? 32 : 42;
  const label = opts.processType === "tahsilat" ? "TAHSİLAT" : "ÖDEME";
  const amt = opts.amount.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + " TL";
  const col = (l, r2) => {
    const pad = w - l.length - r2.length;
    return l + " ".repeat(Math.max(1, pad)) + r2;
  };
  const r = new Receipt().init();
  r.br();
  r.center("=".repeat(w));
  if (w >= 42) {
    r.add(align("center"));
    r.add(bold(true));
    r.add(text("       BTPOS"));
    r.add(bold(false));
    r.add(fontSmall(true));
    for (const line of LOGO_ASCII) {
      r.add(text(line));
    }
    r.add(fontSmall(false));
  } else {
    r.center("** BTPOS **");
    r.center("Satış Noktası Sistemi");
  }
  r.center("=".repeat(w));
  r.br();
  r.add(align("center"));
  r.add(bold(true));
  r.add(text(label));
  r.add(bold(false));
  r.center("=".repeat(w));
  r.br();
  r.add(align("left"));
  r.add(text(col("Kasa    :", opts.terminalName)));
  r.add(text(col("Kasiyer :", opts.cashierName)));
  r.add(text(col("Tarih   :", opts.date)));
  r.add(text("-".repeat(w)));
  r.add(bold(true));
  r.add(text(col("Müşteri :", opts.customerName)));
  r.add(bold(false));
  r.add(text(col("Kod     :", opts.customerCode)));
  r.add(text("=".repeat(w)));
  r.add(bold(true));
  r.add(text(col("TUTAR   :", amt)));
  r.add(bold(false));
  r.add(text("=".repeat(w)));
  if ((_a = opts.description) == null ? void 0 : _a.trim()) {
    r.add(text(col("Açıklama:", opts.description.trim())));
    r.add(text("-".repeat(w)));
  }
  r.br();
  r.center("Teşekkür ederiz");
  r.center("www.btpos.com.tr");
  r.br(3);
  r.cut();
  return r.build();
}
async function printPaymentReceiptFromSettings(settings, opts) {
  if (!isPrinterActive(settings)) {
    throw new Error("Yazıcı ayarı yok");
  }
  const paperWidth = Number(settings.paper_width ?? 80);
  const data = buildPaymentReceipt({ ...opts, paperWidth });
  await printReceipt(settingsRowToConfig(settings), data);
}
function registerPrinterIpc(ipcMain, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS printer_settings (
      id           TEXT PRIMARY KEY,
      terminal_id  TEXT,
      printer_type TEXT DEFAULT 'usb',
      printer_name TEXT,
      printer_ip   TEXT,
      printer_port INTEGER DEFAULT 9100,
      paper_width  INTEGER DEFAULT 80,
      is_active    INTEGER DEFAULT 1,
      updated_at   TEXT
    )
  `);
  ipcMain.handle("printer:list", () => listPrinters());
  ipcMain.handle("printer:printRaw", async (_e, config, dataBase64) => {
    try {
      await printReceipt(
        {
          type: config.type,
          printerName: config.printerName,
          ip: config.ip,
          port: config.port ?? 9100
        },
        Buffer.from(dataBase64, "base64")
      );
      return { success: true };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  });
  ipcMain.handle("printer:print", async (_e, printerName, dataBase64) => {
    try {
      await printReceipt(
        { type: "usb", printerName },
        Buffer.from(dataBase64, "base64")
      );
      return { success: true };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  });
  ipcMain.handle("printer:getSettings", () => {
    return db.prepare("SELECT * FROM printer_settings LIMIT 1").get();
  });
  ipcMain.handle("printer:saveSettings", (_e, settings) => {
    const existing = db.prepare("SELECT id FROM printer_settings LIMIT 1").get();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const isActive = settings.is_active === false || settings.is_active === 0 ? 0 : 1;
    if (existing) {
      db.prepare(`
        UPDATE printer_settings SET
          printer_type = ?, printer_name = ?, printer_ip = ?,
          printer_port = ?, paper_width = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        settings.printer_type ?? "usb",
        settings.printer_name ?? null,
        settings.printer_ip ?? null,
        settings.printer_port ?? 9100,
        settings.paper_width ?? 80,
        isActive,
        now,
        existing.id
      );
    } else {
      db.prepare(`
        INSERT INTO printer_settings (
          id, printer_type, printer_name, printer_ip, printer_port, paper_width, is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        settings.printer_type ?? "usb",
        settings.printer_name ?? null,
        settings.printer_ip ?? null,
        settings.printer_port ?? 9100,
        settings.paper_width ?? 80,
        isActive,
        now
      );
    }
    return { success: true };
  });
  ipcMain.handle("printer:printPaymentReceipt", async (_e, opts) => {
    try {
      const settings = db.prepare("SELECT * FROM printer_settings LIMIT 1").get();
      if (!settings || !isPrinterActive(settings)) {
        return { success: false, message: "Yazıcı ayarı yok" };
      }
      await printPaymentReceiptFromSettings(settings, opts);
      return { success: true };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  });
  ipcMain.handle("printer:testPrint", async (_e, settings) => {
    try {
      const row = {
        printer_type: settings.printer_type,
        printer_name: settings.printer_name,
        printer_ip: settings.printer_ip,
        printer_port: Number(settings.printer_port ?? 9100),
        paper_width: Number(settings.paper_width ?? 80),
        is_active: 1
      };
      if (!isPrinterActive(row)) {
        return { success: false, message: "Yazıcı seçilmedi" };
      }
      const data = buildPaymentReceipt({
        terminalName: "Test Kasa",
        cashierName: "Test Kasiyer",
        date: (/* @__PURE__ */ new Date()).toLocaleString("tr-TR"),
        customerName: "TEST MÜŞTERİ",
        customerCode: "TEST001",
        processType: "tahsilat",
        amount: 99.99,
        description: "Test fişi",
        paperWidth: row.paper_width
      });
      await printReceipt(settingsRowToConfig(row), data);
      return { success: true };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  });
}
const DEFAULT_PRINT_BEHAVIOR = {
  satis: "ask",
  tahsilat: "ask",
  odeme: "ask",
  iade: "ask",
  gunsonu: "default",
  etiket: "none",
  manuel: "none"
};
function normalizePrintBehavior(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PRINT_BEHAVIOR };
  const o = raw;
  const out = { ...DEFAULT_PRINT_BEHAVIOR };
  for (const key of Object.keys(DEFAULT_PRINT_BEHAVIOR)) {
    const v = o[key];
    if (v === "default" || v === "ask" || v === "none") {
      out[key] = v;
    }
  }
  return out;
}
function parseTemplateSchema(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
function resolveVar(key, data) {
  var _a;
  if (!key) return "";
  const [table, col] = key.split(".");
  const val = (_a = data[table]) == null ? void 0 : _a[col];
  if (val === null || val === void 0) return "";
  if (typeof val === "number") {
    return val.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(val);
}
function renderThermal(schema, data, widthMm) {
  const charWidth = widthMm === 58 ? 32 : 42;
  const r = new Receipt();
  r.init();
  for (const block of schema) {
    switch (block.type) {
      case "text": {
        if (block.bold) r.add(bold(true));
        r.add(align(block.align ?? "left"));
        r.add(text(block.value ?? ""));
        if (block.bold) r.add(bold(false));
        break;
      }
      case "variable": {
        const val = resolveVar(block.key ?? "", data);
        const label = block.label ? block.label + ": " : "";
        const content = label + val;
        if (block.bold) r.add(bold(true));
        r.add(align(block.align ?? "left"));
        r.add(text(content));
        if (block.bold) r.add(bold(false));
        break;
      }
      case "divider": {
        r.add(align("left"));
        r.add(text((block.char ?? "=").repeat(charWidth)));
        break;
      }
      case "space": {
        r.add(feed(1));
        break;
      }
      case "logo": {
        r.add(align("center"));
        r.add(bold(true));
        r.add(text(block.value ?? "BTPOS"));
        r.add(bold(false));
        break;
      }
      case "barcode": {
        const val = resolveVar(block.key ?? "", data);
        if (val) {
          const payload = Buffer.from(val, "ascii");
          r.add(align("center"));
          r.add(Buffer.from([
            29,
            72,
            2,
            29,
            104,
            80,
            29,
            119,
            2,
            29,
            107,
            73,
            payload.length,
            ...payload
          ]));
        }
        break;
      }
    }
  }
  r.add(feed(4));
  r.add(cut());
  return r.build();
}
function renderHtml(schema, data, widthMm, heightMm) {
  const bodyLines = [];
  for (const block of schema) {
    const alignCss = `text-align:${block.align ?? "left"}`;
    const boldCss = block.bold ? "font-weight:700" : "";
    switch (block.type) {
      case "text":
        bodyLines.push(`<div style="${alignCss};${boldCss}">${escapeHtml(block.value ?? "")}</div>`);
        break;
      case "variable": {
        const val = escapeHtml(resolveVar(block.key ?? "", data));
        const label = block.label ? `<span style="color:#6B7280">${escapeHtml(block.label)}: </span>` : "";
        bodyLines.push(`<div style="${alignCss};${boldCss}">${label}${val}</div>`);
        break;
      }
      case "divider":
        bodyLines.push(`<div style="font-family:monospace;color:#9CA3AF">${escapeHtml((block.char ?? "=").repeat(50))}</div>`);
        break;
      case "space":
        bodyLines.push('<div style="height:8px"></div>');
        break;
      case "logo":
        bodyLines.push(`<div style="text-align:center;font-size:16px;font-weight:700;letter-spacing:2px">${escapeHtml(block.value ?? "BTPOS")}</div>`);
        break;
      case "barcode": {
        const val = escapeHtml(resolveVar(block.key ?? "", data));
        bodyLines.push(`<div style="text-align:center;font-family:monospace;font-size:10px">${val}</div>`);
        break;
      }
    }
  }
  const pageH = heightMm ? `${heightMm}mm` : "auto";
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { margin: 4mm; size: ${widthMm}mm ${pageH}; }
  body { font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.5; margin: 0; padding: 0; }
  div { margin-bottom: 1px; }
</style></head><body>${bodyLines.join("\n")}</body></html>`;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function getPrintBehavior(db) {
  const row = db.prepare(
    `SELECT print_behavior FROM pos_settings_cache WHERE id = 'local'`
  ).get();
  if (!(row == null ? void 0 : row.print_behavior)) return { ...DEFAULT_PRINT_BEHAVIOR };
  try {
    return normalizePrintBehavior(JSON.parse(row.print_behavior));
  } catch {
    return { ...DEFAULT_PRINT_BEHAVIOR };
  }
}
function getDefaultTemplateIds(db) {
  const row = db.prepare(
    `SELECT default_template_ids FROM pos_settings_cache WHERE id = 'local'`
  ).get();
  if (!(row == null ? void 0 : row.default_template_ids)) return {};
  try {
    const parsed = JSON.parse(row.default_template_ids);
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v != null && String(v).trim()) out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}
async function doPrint(db, templateId, data) {
  const tpl = db.prepare("SELECT * FROM receipt_templates WHERE id = ?").get(templateId);
  if (!tpl) return { success: false, message: "Şablon bulunamadı" };
  const schema = parseTemplateSchema(tpl.schema);
  const paperW = Number(tpl.paper_width_mm ?? 80);
  const paperH = tpl.paper_height_mm != null ? Number(tpl.paper_height_mm) : null;
  const tplType = String(tpl.template_type ?? "thermal");
  const printerCfg = getPrinterRow(db);
  if (!printerCfg || !isPrinterActive(printerCfg)) {
    return { success: false, message: "Yazıcı ayarı yok" };
  }
  if (tplType === "thermal") {
    const buf = renderThermal(schema, data, paperW);
    await printRawBuffer(db, buf);
  } else {
    const html = renderHtml(schema, data, paperW, paperH);
    const pdfBuf = await renderPdfBuffer(html, paperW, paperH);
    await printPdfBuffer(db, pdfBuf, printerCfg);
  }
  return { success: true };
}
function getPrinterRow(db) {
  return db.prepare("SELECT * FROM printer_settings LIMIT 1").get();
}
async function printRawBuffer(db, buf) {
  const printerCfg = getPrinterRow(db);
  if (!printerCfg || !isPrinterActive(printerCfg)) {
    throw new Error("Yazıcı ayarı yok");
  }
  await printReceipt(settingsRowToConfig(printerCfg), buf);
}
async function renderPdfBuffer(html, widthMm, heightMm) {
  const win = new electron.BrowserWindow({
    show: false,
    webPreferences: { offscreen: true }
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const h = heightMm ?? 297;
    const pdfBuf = await win.webContents.printToPDF({
      pageSize: {
        width: widthMm / 25.4 * 72,
        height: h / 25.4 * 72
      },
      printBackground: true
    });
    return Buffer.from(pdfBuf);
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}
async function printPdfBuffer(db, pdfBuf, printerCfg) {
  const win = new electron.BrowserWindow({ show: false });
  const tmpPath = path.join(os.tmpdir(), `btpos-receipt-${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, pdfBuf);
  try {
    await win.loadURL(`file://${tmpPath.replace(/\\/g, "/")}`);
    await new Promise((resolve, reject) => {
      const deviceName = printerCfg.printer_name ? String(printerCfg.printer_name) : void 0;
      win.webContents.print(
        { silent: true, printBackground: true, deviceName },
        (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(failureReason ?? "PDF yazdırılamadı"));
        }
      );
    });
  } finally {
    if (!win.isDestroyed()) win.close();
    try {
      fs.unlinkSync(tmpPath);
    } catch {
    }
  }
}
function normalizeTemplateRow(t) {
  return {
    id: String(t.id ?? ""),
    name: String(t.name ?? ""),
    trigger_type: String(t.trigger_type ?? t.triggerType ?? ""),
    template_type: String(t.template_type ?? t.templateType ?? "thermal"),
    paper_width_mm: Number(t.paper_width_mm ?? t.paperWidthMm ?? 80),
    paper_height_mm: t.paper_height_mm != null || t.paperHeightMm != null ? Number(t.paper_height_mm ?? t.paperHeightMm) : null,
    schema: typeof t.schema === "string" ? t.schema : JSON.stringify(t.schema ?? []),
    is_default: t.is_default === true || t.is_default === 1 || t.isDefault === true ? 1 : 0
  };
}
function registerTemplatesIpc(ipcMain, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipt_templates (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      trigger_type     TEXT NOT NULL,
      template_type    TEXT NOT NULL DEFAULT 'thermal',
      paper_width_mm   INTEGER NOT NULL DEFAULT 80,
      paper_height_mm  INTEGER,
      schema           TEXT NOT NULL DEFAULT '[]',
      is_default       INTEGER DEFAULT 0,
      synced_at        TEXT
    )
  `);
  const posCols = db.prepare("PRAGMA table_info(pos_settings_cache)").all().map((c) => c.name);
  if (!posCols.includes("print_behavior")) {
    db.exec(`ALTER TABLE pos_settings_cache ADD COLUMN print_behavior TEXT DEFAULT NULL`);
  }
  const posTempCols = db.prepare("PRAGMA table_info(pos_settings_temp)").all().map((c) => c.name);
  if (!posTempCols.includes("print_behavior")) {
    db.exec(`ALTER TABLE pos_settings_temp ADD COLUMN print_behavior TEXT DEFAULT NULL`);
  }
  if (!posCols.includes("default_template_ids")) {
    db.exec(`ALTER TABLE pos_settings_cache ADD COLUMN default_template_ids TEXT DEFAULT NULL`);
  }
  if (!posTempCols.includes("default_template_ids")) {
    db.exec(`ALTER TABLE pos_settings_temp ADD COLUMN default_template_ids TEXT DEFAULT NULL`);
  }
  ipcMain.handle("templates:getAll", () => {
    return db.prepare(
      "SELECT * FROM receipt_templates ORDER BY trigger_type, name"
    ).all();
  });
  ipcMain.handle("templates:getByTrigger", (_e, triggerType) => {
    return db.prepare(`
      SELECT * FROM receipt_templates
      WHERE trigger_type = ?
      ORDER BY is_default DESC, name
    `).all(triggerType);
  });
  ipcMain.handle("templates:getDefault", (_e, triggerType) => {
    return db.prepare(`
      SELECT * FROM receipt_templates
      WHERE trigger_type = ? AND is_default = 1
      LIMIT 1
    `).get(triggerType);
  });
  ipcMain.handle("templates:save", (_e, templates) => {
    const stmt = db.prepare(`
      INSERT INTO receipt_templates
        (id, name, trigger_type, template_type, paper_width_mm, paper_height_mm, schema, is_default, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name            = excluded.name,
        trigger_type    = excluded.trigger_type,
        template_type   = excluded.template_type,
        paper_width_mm  = excluded.paper_width_mm,
        paper_height_mm = excluded.paper_height_mm,
        schema          = excluded.schema,
        is_default      = excluded.is_default,
        synced_at       = excluded.synced_at
    `);
    const syncedAt = (/* @__PURE__ */ new Date()).toISOString();
    const upsertMany = db.transaction((rows) => {
      for (const raw of rows) {
        const t = normalizeTemplateRow(raw);
        stmt.run(
          t.id,
          t.name,
          t.trigger_type,
          t.template_type,
          t.paper_width_mm,
          t.paper_height_mm,
          t.schema,
          t.is_default,
          syncedAt
        );
      }
    });
    upsertMany(templates);
    return { success: true, count: templates.length };
  });
  ipcMain.handle("templates:printThermal", async (_e, opts) => {
    try {
      const tpl = db.prepare(`
        SELECT * FROM receipt_templates
        WHERE trigger_type = ? AND is_default = 1 AND template_type = 'thermal'
        LIMIT 1
      `).get(opts.triggerType);
      if (!tpl) return { success: false, message: "Şablon bulunamadı" };
      const schema = parseTemplateSchema(tpl.schema);
      const escBuf = renderThermal(schema, opts.data, Number(tpl.paper_width_mm ?? 80));
      await printRawBuffer(db, escBuf);
      return { success: true };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  });
  ipcMain.handle("templates:printPdf", async (_e, opts) => {
    try {
      const tpl = db.prepare(`
        SELECT * FROM receipt_templates
        WHERE trigger_type = ? AND is_default = 1 AND template_type = 'pdf'
        LIMIT 1
      `).get(opts.triggerType);
      if (!tpl) return { success: false, message: "Şablon bulunamadı" };
      const schema = parseTemplateSchema(tpl.schema);
      const paperW = Number(tpl.paper_width_mm ?? 80);
      const paperH = tpl.paper_height_mm != null ? Number(tpl.paper_height_mm) : null;
      const html = renderHtml(schema, opts.data, paperW, paperH);
      const pdfBuf = await renderPdfBuffer(html, paperW, paperH);
      const printerCfg = getPrinterRow(db);
      if (!printerCfg || !isPrinterActive(printerCfg)) {
        return { success: false, message: "Yazıcı ayarı yok" };
      }
      await printPdfBuffer(db, pdfBuf, printerCfg);
      return { success: true };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  });
  ipcMain.handle("templates:printWithBehavior", async (_e, opts) => {
    try {
      const pb = getPrintBehavior(db);
      const behavior = pb[opts.triggerType] ?? "none";
      if (behavior === "none") {
        return { success: true, skipped: true };
      }
      const templates = db.prepare(`
        SELECT id, name, template_type, is_default
        FROM receipt_templates
        WHERE trigger_type = ?
        ORDER BY is_default DESC, name
      `).all(opts.triggerType);
      if (!templates.length) {
        return { success: false, message: "Şablon bulunamadı" };
      }
      if (opts.templateId) {
        const tpl = templates.find((t) => String(t.id) === opts.templateId);
        if (!tpl) return { success: false, message: "Şablon bulunamadı" };
        return await doPrint(db, tpl.id, opts.data);
      }
      if (templates.length === 1) {
        return await doPrint(db, String(templates[0].id), opts.data);
      }
      if (behavior === "default") {
        const defaultIds = getDefaultTemplateIds(db);
        const configuredId = defaultIds[opts.triggerType];
        const def = (configuredId ? templates.find((t) => String(t.id) === configuredId) : void 0) ?? templates.find((t) => t.is_default === 1) ?? templates[0];
        return await doPrint(db, String(def.id), opts.data);
      }
      if (behavior === "ask") {
        return {
          success: true,
          needsSelection: true,
          templates: templates.map((t) => ({
            id: String(t.id),
            name: String(t.name),
            template_type: String(t.template_type),
            is_default: t.is_default === 1
          })),
          data: opts.data
        };
      }
      return { success: true, skipped: true };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  });
}
const store = new Store();
const DEFAULT_CART_SETTINGS = {
  showBarkod: false,
  showBirim: false,
  showKdv: true,
  showFiyat: true,
  showIskonto: false,
  fsUrunAdi: 13,
  fsUrunKod: 10,
  fsMiktar: 13,
  fsTutar: 13,
  fsTutarSub: 10,
  fsPill: 10
};
function mergeCartSettings(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  return {
    showBarkod: Boolean(o.showBarkod ?? DEFAULT_CART_SETTINGS.showBarkod),
    showBirim: Boolean(o.showBirim ?? DEFAULT_CART_SETTINGS.showBirim),
    showKdv: Boolean(o.showKdv ?? DEFAULT_CART_SETTINGS.showKdv),
    showFiyat: Boolean(o.showFiyat ?? DEFAULT_CART_SETTINGS.showFiyat),
    showIskonto: Boolean(o.showIskonto ?? DEFAULT_CART_SETTINGS.showIskonto),
    fsUrunAdi: Math.max(11, Math.min(18, Number(o.fsUrunAdi) || DEFAULT_CART_SETTINGS.fsUrunAdi)),
    fsUrunKod: Math.max(9, Math.min(14, Number(o.fsUrunKod) || DEFAULT_CART_SETTINGS.fsUrunKod)),
    fsMiktar: Math.max(11, Math.min(18, Number(o.fsMiktar) || DEFAULT_CART_SETTINGS.fsMiktar)),
    fsTutar: Math.max(11, Math.min(18, Number(o.fsTutar) || DEFAULT_CART_SETTINGS.fsTutar)),
    fsTutarSub: Math.max(9, Math.min(13, Number(o.fsTutarSub) || DEFAULT_CART_SETTINGS.fsTutarSub)),
    fsPill: Math.max(9, Math.min(12, Number(o.fsPill) || DEFAULT_CART_SETTINGS.fsPill))
  };
}
let mainWindow = null;
let customerWindow = null;
let latestSecondScreenPayload = null;
const isDev = !!process.env.VITE_DEV_SERVER_URL;
function toggleDevTools() {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  if (wc.isDevToolsOpened()) {
    wc.closeDevTools();
  } else {
    wc.openDevTools({ mode: "detach" });
  }
}
function resolveAppIconPath() {
  if (electron.app.isPackaged) {
    const p = path.join(process.resourcesPath, "logo_bt.png");
    return fs.existsSync(p) ? p : void 0;
  }
  const devPath = path.join(__dirname, "..", "src", "assets", "logo_bt.png");
  return fs.existsSync(devPath) ? devPath : void 0;
}
function createWindow() {
  const icon = resolveAppIconPath();
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    ...icon ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    kiosk: !isDev,
    // Production'da kiosk
    fullscreen: !isDev,
    // Production'da tam ekran
    frame: isDev,
    // Geliştirmede çerçeve göster
    show: false
  });
  electron.Menu.setApplicationMenu(null);
  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  mainWindow.once("ready-to-show", () => mainWindow == null ? void 0 : mainWindow.show());
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") {
      event.preventDefault();
      toggleDevTools();
      return;
    }
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (mod && input.shift && input.key.toLowerCase() === "i") {
      event.preventDefault();
      toggleDevTools();
    }
  });
  electron.globalShortcut.register("F11", () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
}
function getCustomerDisplayUrl() {
  return {
    devUrl: process.env.VITE_DEV_SERVER_URL,
    filePath: path.join(__dirname, "../dist/index.html"),
    query: { screen: "customer" }
  };
}
async function openCustomerWindow() {
  const displays = electron.screen.getAllDisplays();
  const primary = electron.screen.getPrimaryDisplay();
  const external = displays.find(
    (d) => d.id !== primary.id || d.bounds.x !== primary.bounds.x || d.bounds.y !== primary.bounds.y || d.bounds.width !== primary.bounds.width || d.bounds.height !== primary.bounds.height
  ) ?? null;
  const targetBounds = external == null ? void 0 : external.bounds;
  if (customerWindow && !customerWindow.isDestroyed()) {
    if (external && targetBounds) {
      customerWindow.setBounds(targetBounds);
      customerWindow.setFullScreen(true);
      customerWindow.setKiosk(true);
      customerWindow.setAlwaysOnTop(true, "screen-saver");
    } else {
      customerWindow.maximize();
    }
    customerWindow.show();
    customerWindow.focus();
    return;
  }
  const icon = resolveAppIconPath();
  customerWindow = new electron.BrowserWindow({
    x: targetBounds == null ? void 0 : targetBounds.x,
    y: targetBounds == null ? void 0 : targetBounds.y,
    width: (targetBounds == null ? void 0 : targetBounds.width) ?? 1024,
    height: (targetBounds == null ? void 0 : targetBounds.height) ?? 768,
    autoHideMenuBar: true,
    fullscreen: Boolean(external),
    kiosk: Boolean(external),
    frame: external ? false : isDev,
    show: false,
    alwaysOnTop: Boolean(external),
    resizable: !external,
    minimizable: !external,
    maximizable: !external,
    ...icon ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const target = getCustomerDisplayUrl();
  if (isDev && target.devUrl) {
    const url = new URL(target.devUrl);
    url.searchParams.set("screen", "customer");
    await customerWindow.loadURL(url.toString());
  } else if (target.filePath) {
    await customerWindow.loadFile(target.filePath, { query: target.query });
  }
  customerWindow.once("ready-to-show", () => {
    if (!customerWindow) return;
    if (external && targetBounds) {
      customerWindow.setBounds(targetBounds);
      customerWindow.setFullScreen(true);
      customerWindow.setKiosk(true);
      customerWindow.setAlwaysOnTop(true, "screen-saver");
    } else {
      customerWindow.maximize();
    }
    customerWindow.show();
  });
  customerWindow.on("closed", () => {
    customerWindow = null;
  });
  customerWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}
function pushSecondScreenPayload(payload) {
  latestSecondScreenPayload = payload;
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.webContents.send("secondScreen:data", payload);
  }
}
if (process.platform === "win32") {
  electron.app.setAppUserModelId("tr.bolutekno.btpos");
}
electron.app.whenReady().then(async () => {
  var _a;
  const savedDbDir = (_a = store.get("db_path")) == null ? void 0 : _a.trim();
  const dbDir = savedDbDir && savedDbDir.length > 0 ? savedDbDir : electron.app.getPath("userData");
  const { initDatabase, getSqlite } = await Promise.resolve().then(() => require("./index-Cab2v56X.js")).then((n) => n.index);
  initDatabase(path.join(dbDir, "btpos.db"));
  const db = getSqlite();
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_device_settings (
      id                TEXT PRIMARY KEY,
      company_id        TEXT NOT NULL,
      terminal_id       TEXT NOT NULL,
      provider          TEXT NOT NULL DEFAULT 'pavo',
      ip_address        TEXT,
      port              INTEGER DEFAULT 9100,
      serial_no         TEXT,
      card_read_timeout INTEGER DEFAULT 30,
      print_width       TEXT DEFAULT '80mm',
      is_active         INTEGER DEFAULT 1,
      synced_at         TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS unit_mappings (
      id          TEXT PRIMARY KEY,
      company_id  TEXT NOT NULL,
      unit_name   TEXT NOT NULL,
      pavo_code   TEXT NOT NULL DEFAULT 'C62',
      UNIQUE(company_id, unit_name)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pavo_sequence (
      id  INTEGER PRIMARY KEY,
      seq INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.prepare("INSERT OR IGNORE INTO pavo_sequence (id, seq) VALUES (1, 0)").run();
  const salesCols = db.prepare("PRAGMA table_info(sales)").all().map((c) => c.name);
  if (!salesCols.includes("card_acquirer_id")) db.exec(`ALTER TABLE sales ADD COLUMN card_acquirer_id TEXT`);
  if (!salesCols.includes("payment_provider")) db.exec(`ALTER TABLE sales ADD COLUMN payment_provider TEXT`);
  if (!salesCols.includes("payment_device_data")) db.exec(`ALTER TABLE sales ADD COLUMN payment_device_data TEXT`);
  if (!salesCols.includes("cashier_id")) db.exec(`ALTER TABLE sales ADD COLUMN cashier_id TEXT`);
  if (!salesCols.includes("cashier_name")) db.exec(`ALTER TABLE sales ADD COLUMN cashier_name TEXT`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_payments (
      id            TEXT PRIMARY KEY,
      sale_id       TEXT NOT NULL,
      method        TEXT NOT NULL,
      amount        REAL NOT NULL,
      mediator      INTEGER,
      acquirer_id   TEXT,
      acquirer_name TEXT,
      cashier_id    TEXT,
      cashier_name  TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `);
  const spCols = db.prepare("PRAGMA table_info(sale_payments)").all().map((c) => c.name);
  if (!spCols.includes("cashier_id")) db.exec(`ALTER TABLE sale_payments ADD COLUMN cashier_id TEXT`);
  if (!spCols.includes("cashier_name")) db.exec(`ALTER TABLE sale_payments ADD COLUMN cashier_name TEXT`);
  const custCols = db.prepare("PRAGMA table_info(customers)").all().map((c) => c.name);
  if (!custCols.includes("email")) db.exec(`ALTER TABLE customers ADD COLUMN email TEXT`);
  const custTempCols = db.prepare("PRAGMA table_info(customers_temp)").all().map((c) => c.name);
  if (!custTempCols.includes("email")) db.exec(`ALTER TABLE customers_temp ADD COLUMN email TEXT`);
  const posCols = db.prepare("PRAGMA table_info(pos_settings_cache)").all().map((c) => c.name);
  if (!posCols.includes("touch_keyboard")) {
    db.run("ALTER TABLE pos_settings_cache ADD COLUMN touch_keyboard INTEGER DEFAULT 1");
  }
  const posTempCols = db.prepare("PRAGMA table_info(pos_settings_temp)").all().map((c) => c.name);
  if (!posTempCols.includes("touch_keyboard")) {
    db.run("ALTER TABLE pos_settings_temp ADD COLUMN touch_keyboard INTEGER DEFAULT 1");
  }
  if (!posCols.includes("customer_display")) {
    db.run("ALTER TABLE pos_settings_cache ADD COLUMN customer_display INTEGER DEFAULT 1");
  }
  if (!posTempCols.includes("customer_display")) {
    db.run("ALTER TABLE pos_settings_temp ADD COLUMN customer_display INTEGER DEFAULT 1");
  }
  registerPrinterIpc(electron.ipcMain, db);
  registerTemplatesIpc(electron.ipcMain, db);
  createWindow();
  electron.ipcMain.handle("app:selectFolder", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Veritabanı Klasörü Seç"
    });
    return result.canceled ? null : result.filePaths[0];
  });
  electron.ipcMain.handle("app:reinitDb", async (_e, newPath) => {
    try {
      const { reinitDatabase } = await Promise.resolve().then(() => require("./index-Cab2v56X.js")).then((n) => n.index);
      reinitDatabase((newPath == null ? void 0 : newPath.trim()) || void 0);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  electron.ipcMain.handle("store:getCartSettings", () => mergeCartSettings(store.get("cart_settings")));
  electron.ipcMain.handle("store:setCartSettings", (_e, s) => {
    const merged = mergeCartSettings(s);
    store.set("cart_settings", merged);
    return { success: true };
  });
  electron.ipcMain.handle("app:restart", () => {
    electron.app.relaunch();
    electron.app.exit(0);
  });
  electron.ipcMain.handle("window:isFullscreen", () => (mainWindow == null ? void 0 : mainWindow.isFullScreen()) ?? false);
  electron.ipcMain.handle("window:toggleFullscreen", () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  electron.ipcMain.handle("window:toggleDevTools", () => {
    toggleDevTools();
  });
  electron.ipcMain.handle("secondScreen:open", async () => {
    try {
      await openCustomerWindow();
      if (latestSecondScreenPayload && customerWindow && !customerWindow.isDestroyed()) {
        customerWindow.webContents.send("secondScreen:data", latestSecondScreenPayload);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("secondScreen:update", async (_e, payload) => {
    try {
      pushSecondScreenPayload(payload);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("secondScreen:close", () => {
    try {
      if (customerWindow && !customerWindow.isDestroyed()) {
        customerWindow.close();
      }
      customerWindow = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("secondScreen:getLatest", () => latestSecondScreenPayload);
  electron.ipcMain.handle("store:get", (_e, key) => store.get(key));
  electron.ipcMain.handle("store:set", (_e, key, value) => store.set(key, value));
  electron.ipcMain.handle("device:uid", () => getDeviceUID());
  electron.ipcMain.handle("app:version", () => electron.app.getVersion());
  electron.ipcMain.handle("db:saveProducts", async (_e, prods) => {
    const { saveProducts } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return saveProducts(prods);
  });
  electron.ipcMain.handle("db:getProducts", async () => {
    const { getAllProducts } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getAllProducts();
  });
  electron.ipcMain.handle("db:saveSale", async (_e, sale, items, device) => {
    const { saveSale } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return saveSale(sale, items, device);
  });
  electron.ipcMain.handle("db:getSales", async (_e, dateFrom, dateTo) => {
    const { getSales } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getSales(dateFrom, dateTo);
  });
  electron.ipcMain.handle("device:info", () => {
    return getDeviceInfo();
  });
  electron.ipcMain.handle("db:saveCashiers", async (_e, cashierList) => {
    const { saveCashiers } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return saveCashiers(cashierList);
  });
  electron.ipcMain.handle("db:verifyCashier", async (_e, code, password) => {
    const { verifyCashier } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return verifyCashier(code, password);
  });
  electron.ipcMain.handle("db:verifyCashierByCard", async (_e, cardNumber) => {
    const { verifyCashierByCard } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return verifyCashierByCard(cardNumber);
  });
  electron.ipcMain.handle("db:getCashiers", async () => {
    const { getAllCashiers } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getAllCashiers();
  });
  electron.ipcMain.handle("db:getAllCashiers", async () => {
    const { getAllCashiers } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getAllCashiers();
  });
  electron.ipcMain.handle("app:openKeyboard", () => {
    if (process.platform !== "win32") return;
    child_process.exec("C:\\Windows\\System32\\osk.exe", (err) => {
      if (err) {
        child_process.exec("C:\\Program Files\\Common Files\\microsoft shared\\ink\\TabTip.exe");
      }
    });
  });
  electron.ipcMain.handle("db:holdDocument", async (_e, doc) => {
    const { holdDocument } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return holdDocument(doc);
  });
  electron.ipcMain.handle("db:getHeldDocuments", async (_e, companyId) => {
    const { getHeldDocuments } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getHeldDocuments(companyId);
  });
  electron.ipcMain.handle("db:deleteHeldDocument", async (_e, id) => {
    const { deleteHeldDocument } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return deleteHeldDocument(id);
  });
  electron.ipcMain.handle("db:savePluGroups", async (_e, groups) => {
    const { savePluGroups } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    savePluGroups(groups);
  });
  electron.ipcMain.handle("db:getPluGroups", async (_e, companyId, wpId, cashierId) => {
    const { getPluGroups } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getPluGroups(companyId, wpId, cashierId);
  });
  electron.ipcMain.handle("db:savePosSettings", async (_e, settings, cashierId) => {
    const { syncPosSettingsAcid } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return syncPosSettingsAcid({
      ...settings,
      cashierId: cashierId ?? null
    });
  });
  electron.ipcMain.handle("db:getPosSettings", async (_e, cashierId) => {
    const { getPosSettings } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getPosSettings(cashierId ?? null);
  });
  electron.ipcMain.handle("db:saveCommandHistory", async (_e, row) => {
    const { saveCommandHistory } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    saveCommandHistory(row);
  });
  electron.ipcMain.handle("db:getCommandHistory", async (_e, limit) => {
    const { getCommandHistory } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getCommandHistory(limit ?? 20);
  });
  electron.ipcMain.handle("db:syncProductsAcid", async (_e, items, mode) => {
    const { syncProductsAcid } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return syncProductsAcid(items, mode === "diff" ? "diff" : "full");
  });
  electron.ipcMain.handle("db:syncPluGroupsAcid", async (_e, groups, mode) => {
    const { syncPluGroupsAcid } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return syncPluGroupsAcid(groups, mode === "diff" ? "diff" : "full");
  });
  electron.ipcMain.handle("db:syncCashiersAcid", async (_e, cashierList, companyId, mode) => {
    const { syncCashiersAcid } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return syncCashiersAcid(cashierList, companyId, mode === "diff" ? "diff" : "full");
  });
  electron.ipcMain.handle("db:syncCustomersAcid", async (_e, items, companyId, mode) => {
    const { syncCustomersAcid } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return syncCustomersAcid(items, companyId, mode === "diff" ? "diff" : "full");
  });
  electron.ipcMain.handle("db:getCustomers", async (_e, companyId, query) => {
    const { getCustomers } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getCustomers(companyId, query);
  });
  electron.ipcMain.handle("db:getCustomerById", async (_e, companyId, id) => {
    const { getCustomerById } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getCustomerById(companyId, id);
  });
  electron.ipcMain.handle("db:getPendingInvoices", async (_e, onlyAnonymous = false) => {
    const { getPendingInvoices } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getPendingInvoices(onlyAnonymous);
  });
  electron.ipcMain.handle("db:markInvoiceSent", async (_e, saleId, invoiceId) => {
    const { markInvoiceSent } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    markInvoiceSent(saleId, invoiceId);
  });
  electron.ipcMain.handle("db:markInvoiceError", async (_e, saleId, error) => {
    const { markInvoiceError } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    markInvoiceError(saleId, error);
  });
  electron.ipcMain.handle("db:getSaleItems", async (_e, saleId) => {
    const { getSaleItems } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getSaleItems(saleId);
  });
  electron.ipcMain.handle("db:saveSalePayments", async (_e, payments) => {
    const { saveSalePayments } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    saveSalePayments(db, payments);
  });
  electron.ipcMain.handle("db:getSalePayments", async (_e, saleId) => {
    const { getSalePayments } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getSalePayments(db, saleId);
  });
  electron.ipcMain.handle("db:getCardTotalsByBank", async (_e, saleIds) => {
    const { getCardTotalsByBank } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getCardTotalsByBank(db, saleIds);
  });
  electron.ipcMain.handle("db:getCashTotal", async (_e, saleIds) => {
    const { getCashTotal } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getCashTotal(db, saleIds);
  });
  electron.ipcMain.handle("db:getProductByCode", async (_e, code) => {
    const { getProductByCode } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getProductByCode(code);
  });
  electron.ipcMain.handle("db:getProductIdByCode", async (_e, code) => {
    const { getProductIdByCode } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getProductIdByCode(code);
  });
  electron.ipcMain.handle("db:upsertCustomer", async (_e, row) => {
    const { upsertCustomer } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    upsertCustomer(row);
  });
  electron.ipcMain.handle("db:enqueueOperation", async (_e, params) => {
    const { enqueueOperation } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    enqueueOperation(params);
  });
  electron.ipcMain.handle("db:getPendingOperations", async (_e, companyId) => {
    const { getPendingOperations } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getPendingOperations(companyId);
  });
  electron.ipcMain.handle("db:getAllOperations", async (_e, companyId, limit) => {
    const { getAllOperations } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getAllOperations(companyId, limit ?? 100);
  });
  electron.ipcMain.handle("db:markOperationProcessing", async (_e, id) => {
    const { markOperationProcessing } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    markOperationProcessing(id);
  });
  electron.ipcMain.handle("db:markOperationSuccess", async (_e, id) => {
    const { markOperationSuccess } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    markOperationSuccess(id);
  });
  electron.ipcMain.handle("db:markOperationFailed", async (_e, id, error) => {
    const { markOperationFailed } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    markOperationFailed(id, error);
  });
  electron.ipcMain.handle("db:retryOperation", async (_e, id) => {
    const { retryOperation } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    retryOperation(id);
  });
  electron.ipcMain.handle("db:deleteOperation", async (_e, id) => {
    const { deleteOperation } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    deleteOperation(id);
  });
  electron.ipcMain.handle("db:getPaymentDeviceSettings", async (_e, provider) => {
    const { getPaymentDeviceSettings } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getPaymentDeviceSettings(provider ?? "pavo");
  });
  electron.ipcMain.handle("db:upsertPaymentDeviceSettings", async (_e, row) => {
    const { upsertPaymentDeviceSettings } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    upsertPaymentDeviceSettings(row);
  });
  electron.ipcMain.handle("db:nextPavoSequence", async () => {
    const { nextPavoSequence } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return nextPavoSequence();
  });
  electron.ipcMain.handle("db:updatePavoSequence", async (_e, seq) => {
    const { updatePavoSequence } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    updatePavoSequence(seq);
  });
  electron.ipcMain.handle("db:getUnitPavoCode", async (_e, unitName) => {
    const { getUnitPavoCode } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getUnitPavoCode(db, unitName);
  });
  electron.ipcMain.handle("db:upsertUnitMapping", async (_e, row) => {
    const { upsertUnitMapping } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    upsertUnitMapping(db, row);
  });
  electron.ipcMain.handle("db:getAllUnitMappings", async (_e, companyId) => {
    const { getAllUnitMappings } = await Promise.resolve().then(() => require("./operations-ByQP2WMb.js"));
    return getAllUnitMappings(db, companyId);
  });
});
electron.app.on("window-all-closed", () => {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.close();
  }
  electron.globalShortcut.unregisterAll();
  if (process.platform !== "darwin") electron.app.quit();
});
