"use strict";
const electron = require("electron");
const child_process = require("child_process");
const fs = require("fs");
const path = require("path");
const Store = require("electron-store");
const os = require("os");
const crypto = require("crypto");
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
if (process.platform === "win32") {
  electron.app.setAppUserModelId("tr.bolutekno.btpos");
}
electron.app.whenReady().then(async () => {
  var _a;
  const savedDbDir = (_a = store.get("db_path")) == null ? void 0 : _a.trim();
  const dbDir = savedDbDir && savedDbDir.length > 0 ? savedDbDir : electron.app.getPath("userData");
  const { initDatabase } = await Promise.resolve().then(() => require("./index-DqtvqxKT.js")).then((n) => n.index);
  initDatabase(path.join(dbDir, "btpos.db"));
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
      const { reinitDatabase } = await Promise.resolve().then(() => require("./index-DqtvqxKT.js")).then((n) => n.index);
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
  electron.ipcMain.handle("store:get", (_e, key) => store.get(key));
  electron.ipcMain.handle("store:set", (_e, key, value) => store.set(key, value));
  electron.ipcMain.handle("device:uid", () => getDeviceUID());
  electron.ipcMain.handle("app:version", () => electron.app.getVersion());
  electron.ipcMain.handle("db:saveProducts", async (_e, prods) => {
    const { saveProducts } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return saveProducts(prods);
  });
  electron.ipcMain.handle("db:getProducts", async () => {
    const { getAllProducts } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getAllProducts();
  });
  electron.ipcMain.handle("db:saveSale", async (_e, sale, items) => {
    const { saveSale } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return saveSale(sale, items);
  });
  electron.ipcMain.handle("db:getSales", async (_e, dateFrom, dateTo) => {
    const { getSales } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getSales(dateFrom, dateTo);
  });
  electron.ipcMain.handle("device:info", () => {
    return getDeviceInfo();
  });
  electron.ipcMain.handle("db:saveCashiers", async (_e, cashierList) => {
    const { saveCashiers } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return saveCashiers(cashierList);
  });
  electron.ipcMain.handle("db:verifyCashier", async (_e, code, password) => {
    const { verifyCashier } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return verifyCashier(code, password);
  });
  electron.ipcMain.handle("db:verifyCashierByCard", async (_e, cardNumber) => {
    const { verifyCashierByCard } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return verifyCashierByCard(cardNumber);
  });
  electron.ipcMain.handle("db:getCashiers", async () => {
    const { getAllCashiers } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getAllCashiers();
  });
  electron.ipcMain.handle("db:getAllCashiers", async () => {
    const { getAllCashiers } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
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
    const { holdDocument } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return holdDocument(doc);
  });
  electron.ipcMain.handle("db:getHeldDocuments", async (_e, companyId) => {
    const { getHeldDocuments } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getHeldDocuments(companyId);
  });
  electron.ipcMain.handle("db:deleteHeldDocument", async (_e, id) => {
    const { deleteHeldDocument } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return deleteHeldDocument(id);
  });
  electron.ipcMain.handle("db:savePluGroups", async (_e, groups) => {
    const { savePluGroups } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    savePluGroups(groups);
  });
  electron.ipcMain.handle("db:getPluGroups", async (_e, companyId, wpId, cashierId) => {
    const { getPluGroups } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getPluGroups(companyId, wpId, cashierId);
  });
  electron.ipcMain.handle("db:savePosSettings", async (_e, settings, cashierId) => {
    const { syncPosSettingsAcid } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return syncPosSettingsAcid({
      ...settings,
      cashierId: cashierId ?? null
    });
  });
  electron.ipcMain.handle("db:getPosSettings", async (_e, cashierId) => {
    const { getPosSettings } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getPosSettings(cashierId ?? null);
  });
  electron.ipcMain.handle("db:saveCommandHistory", async (_e, row) => {
    const { saveCommandHistory } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    saveCommandHistory(row);
  });
  electron.ipcMain.handle("db:getCommandHistory", async (_e, limit) => {
    const { getCommandHistory } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getCommandHistory(limit ?? 20);
  });
  electron.ipcMain.handle("db:syncProductsAcid", async (_e, items, mode) => {
    const { syncProductsAcid } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return syncProductsAcid(items, mode === "diff" ? "diff" : "full");
  });
  electron.ipcMain.handle("db:syncPluGroupsAcid", async (_e, groups, mode) => {
    const { syncPluGroupsAcid } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return syncPluGroupsAcid(groups, mode === "diff" ? "diff" : "full");
  });
  electron.ipcMain.handle("db:syncCashiersAcid", async (_e, cashierList, companyId, mode) => {
    const { syncCashiersAcid } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return syncCashiersAcid(cashierList, companyId, mode === "diff" ? "diff" : "full");
  });
  electron.ipcMain.handle("db:syncCustomersAcid", async (_e, items, companyId, mode) => {
    const { syncCustomersAcid } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return syncCustomersAcid(items, companyId, mode === "diff" ? "diff" : "full");
  });
  electron.ipcMain.handle("db:getCustomers", async (_e, companyId, query) => {
    const { getCustomers } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getCustomers(companyId, query);
  });
  electron.ipcMain.handle("db:getCustomerById", async (_e, companyId, id) => {
    const { getCustomerById } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getCustomerById(companyId, id);
  });
  electron.ipcMain.handle("db:getPendingInvoices", async (_e, onlyAnonymous = false) => {
    const { getPendingInvoices } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getPendingInvoices(onlyAnonymous);
  });
  electron.ipcMain.handle("db:markInvoiceSent", async (_e, saleId, invoiceId) => {
    const { markInvoiceSent } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    markInvoiceSent(saleId, invoiceId);
  });
  electron.ipcMain.handle("db:markInvoiceError", async (_e, saleId, error) => {
    const { markInvoiceError } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    markInvoiceError(saleId, error);
  });
  electron.ipcMain.handle("db:getSaleItems", async (_e, saleId) => {
    const { getSaleItems } = await Promise.resolve().then(() => require("./operations-Dk2AC8J3.js"));
    return getSaleItems(saleId);
  });
});
electron.app.on("window-all-closed", () => {
  electron.globalShortcut.unregisterAll();
  if (process.platform !== "darwin") electron.app.quit();
});
