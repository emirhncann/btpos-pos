# BTPOS Electron POS — Sprint 1
## Claude Code Görev Paketi

> **Amaç:** Çalışan bir Electron uygulaması kur. Aktivasyon ekranı API'ye bağlansın, ürün listesi İşbaşı'dan çekilsin, veriler SQLite'a yazılsın.
> **Stack:** Electron 28 + React 18 + Vite + Tailwind + shadcn/ui + Drizzle ORM + better-sqlite3 + electron-store

---

## ADIM 0 — Proje İskeleti Oluştur

Aşağıdaki komutları sırayla çalıştır:

```bash
mkdir btpos-pos && cd btpos-pos
npm init -y
```

### package.json — TAM İÇERİK (mevcut dosyayı tamamen değiştir)

```json
{
  "name": "btpos-pos",
  "version": "1.0.0",
  "description": "BTPOS POS Kasa Yazılımı",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "concurrently -k \"vite\" \"electron .\"",
    "build": "vite build && electron-builder",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node scripts/migrate.js"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "concurrently": "^8.2.2",
    "drizzle-kit": "^0.20.14",
    "electron": "^28.2.0",
    "electron-builder": "^24.9.1",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3",
    "vite": "^5.1.0",
    "vite-plugin-electron": "^0.28.4",
    "vite-plugin-electron-renderer": "^0.14.5"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-label": "^2.0.2",
    "@radix-ui/react-slot": "^1.0.2",
    "better-sqlite3": "^9.4.3",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "drizzle-orm": "^0.29.4",
    "electron-store": "^8.2.0",
    "lucide-react": "^0.321.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "tailwind-merge": "^2.2.1"
  },
  "build": {
    "appId": "tr.bolutekno.btpos",
    "productName": "BTPOS Kasa",
    "directories": { "output": "release" },
    "win": { "target": "nsis" },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true }
  }
}
```

```bash
npm install
```

---

## ADIM 1 — Klasör Yapısını Oluştur

```bash
mkdir -p src/components/ui
mkdir -p src/screens
mkdir -p src/lib
mkdir -p src/hooks
mkdir -p electron
mkdir -p db
mkdir -p scripts
```

---

## ADIM 2 — Electron Ana Process

### `electron/main.ts`

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { initDB } from '../db/index'
import { getDeviceUID } from './device'

const store = new Store()

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hidden',
    show: false,
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
}

app.whenReady().then(async () => {
  // SQLite DB başlat
  await initDB()

  createWindow()

  // IPC Handlers
  ipcMain.handle('store:get', (_e, key) => store.get(key))
  ipcMain.handle('store:set', (_e, key, value) => store.set(key, value))
  ipcMain.handle('device:uid', () => getDeviceUID())
  ipcMain.handle('app:version', () => app.getVersion())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

### `electron/device.ts`

```typescript
import * as os from 'os'
import * as crypto from 'crypto'

export function getDeviceUID(): string {
  const interfaces = os.networkInterfaces()
  const mac = Object.values(interfaces)
    .flat()
    .find((i) => i && !i.internal && i.mac !== '00:00:00:00:00:00')?.mac || 'unknown'

  const raw = `${os.hostname()}-${mac}-${os.platform()}-${os.arch()}`
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32)
}
```

### `electron/preload.ts`

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  device: {
    uid: () => ipcRenderer.invoke('device:uid'),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
})
```

---

## ADIM 3 — Drizzle Şeması & DB Başlatma

### `db/schema.ts`

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// Aktivasyon bilgisi
export const activation = sqliteTable('activation', {
  id: integer('id').primaryKey(),
  terminalId: text('terminal_id').notNull(),
  companyId: text('company_id').notNull(),
  deviceUid: text('device_uid').notNull(),
  activatedAt: text('activated_at').notNull(),
  planName: text('plan_name'),
  expiryDate: text('expiry_date'),
})

// ERP'den çekilen ürünler
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),             // ERP'den gelen ID
  code: text('code'),
  name: text('name').notNull(),
  barcode: text('barcode'),
  price: real('price').default(0),
  vatRate: real('vat_rate').default(18),
  unit: text('unit').default('Adet'),
  stock: real('stock').default(0),
  category: text('category'),
  syncedAt: text('synced_at'),
})

// Satışlar (çevrimdışı mod için)
export const sales = sqliteTable('sales', {
  id: text('id').primaryKey(),
  receiptNo: text('receipt_no').notNull(),
  totalAmount: real('total_amount').notNull(),
  paymentType: text('payment_type').notNull(), // 'cash' | 'card' | 'mixed'
  cashAmount: real('cash_amount').default(0),
  cardAmount: real('card_amount').default(0),
  createdAt: text('created_at').notNull(),
  synced: integer('synced', { mode: 'boolean' }).default(false),
})

// Satış kalemleri
export const saleItems = sqliteTable('sale_items', {
  id: text('id').primaryKey(),
  saleId: text('sale_id').notNull().references(() => sales.id),
  productId: text('product_id'),
  productName: text('product_name').notNull(),
  quantity: real('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
  vatRate: real('vat_rate').default(18),
  lineTotal: real('line_total').notNull(),
})
```

### `db/index.ts`

```typescript
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import * as schema from './schema'

let db: ReturnType<typeof drizzle>

export function initDB() {
  const dbPath = join(app.getPath('userData'), 'btpos.db')
  const sqlite = new Database(dbPath)

  // WAL modu — performans için
  sqlite.pragma('journal_mode = WAL')

  db = drizzle(sqlite, { schema })

  // Tabloları oluştur (migration yerine basit create)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS activation (
      id INTEGER PRIMARY KEY,
      terminal_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      device_uid TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      plan_name TEXT,
      expiry_date TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT NOT NULL,
      barcode TEXT,
      price REAL DEFAULT 0,
      vat_rate REAL DEFAULT 18,
      unit TEXT DEFAULT 'Adet',
      stock REAL DEFAULT 0,
      category TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      receipt_no TEXT NOT NULL,
      total_amount REAL NOT NULL,
      payment_type TEXT NOT NULL,
      cash_amount REAL DEFAULT 0,
      card_amount REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      vat_rate REAL DEFAULT 18,
      line_total REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );
  `)

  return db
}

export function getDB() {
  if (!db) throw new Error('DB henüz başlatılmadı')
  return db
}
```

---

## ADIM 4 — API Servisi

### `src/lib/api.ts`

```typescript
const API_URL = 'https://api.btpos.com.tr'

export const api = {
  // Terminal aktivasyonu
  async activate(licenseKey: string, deviceUid: string) {
    const res = await fetch(`${API_URL}/management/licenses/terminals/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey, device_uid: deviceUid }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  // Lisans durumu kontrolü
  async checkLicense(companyId: string) {
    const res = await fetch(`${API_URL}/management/licenses/check/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  // ERP ürün listesi
  async getProducts(companyId: string) {
    const res = await fetch(`${API_URL}/integration/products/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
}
```

---

## ADIM 5 — React Arayüzü

### `src/main.tsx`

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### `src/App.tsx`

```tsx
import { useEffect, useState } from 'react'
import ActivationScreen from './screens/ActivationScreen'
import ProductsScreen from './screens/ProductsScreen'

type AppState = 'loading' | 'activation' | 'pos'

export default function App() {
  const [state, setState] = useState<AppState>('loading')
  const [companyId, setCompanyId] = useState<string | null>(null)

  useEffect(() => {
    checkActivation()
  }, [])

  async function checkActivation() {
    const activated = await window.electron.store.get('activated')
    const storedCompanyId = await window.electron.store.get('company_id')

    if (activated && storedCompanyId) {
      setCompanyId(storedCompanyId as string)
      setState('pos')
    } else {
      setState('activation')
    }
  }

  function handleActivated(cId: string) {
    setCompanyId(cId)
    setState('pos')
  }

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="text-white text-lg animate-pulse">BTPOS Yükleniyor...</div>
      </div>
    )
  }

  if (state === 'activation') {
    return <ActivationScreen onActivated={handleActivated} />
  }

  return <ProductsScreen companyId={companyId!} />
}
```

### `src/screens/ActivationScreen.tsx`

```tsx
import { useState } from 'react'
import { api } from '../lib/api'

interface Props {
  onActivated: (companyId: string) => void
}

export default function ActivationScreen({ onActivated }: Props) {
  const [licenseKey, setLicenseKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleActivate() {
    if (!licenseKey.trim()) {
      setError('Lisans anahtarı boş olamaz.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const deviceUid = await window.electron.device.uid()
      const result = await api.activate(licenseKey.trim(), deviceUid)

      if (!result.success) {
        setError(result.message || 'Aktivasyon başarısız.')
        return
      }

      const companyId = result.company_id

      // Config'e yaz
      await window.electron.store.set('activated', true)
      await window.electron.store.set('company_id', companyId)
      await window.electron.store.set('terminal_id', licenseKey.trim())
      await window.electron.store.set('device_uid', deviceUid)

      onActivated(companyId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Bağlantı hatası.'
      setError('Sunucuya ulaşılamadı: ' + msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-md bg-gray-900 rounded-2xl p-8 shadow-2xl border border-gray-800">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">BT<span className="text-blue-500">POS</span></h1>
          <p className="text-gray-400 text-sm mt-1">Kasa Aktivasyonu</p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Lisans Anahtarı</label>
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleActivate}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Doğrulanıyor...' : 'Aktivasyonu Tamamla'}
          </button>
        </div>

        {/* Alt bilgi */}
        <p className="text-center text-gray-600 text-xs mt-6">
          Lisans anahtarınızı yönetici panelinizden alabilirsiniz.
        </p>
      </div>
    </div>
  )
}
```

### `src/screens/ProductsScreen.tsx`

```tsx
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Product {
  id: string
  code?: string
  name: string
  barcode?: string
  price?: number
  unit?: string
  stock?: number
}

interface Props {
  companyId: string
}

export default function ProductsScreen({ companyId }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    syncProducts()
  }, [])

  async function syncProducts() {
    setLoading(true)
    setError('')
    try {
      const data = await api.getProducts(companyId)

      // İşbaşı response yapısı: data.data.items
      const items: Product[] = (data?.data?.items ?? data?.items ?? data ?? []).map((p: Record<string, unknown>) => ({
        id: String(p.id ?? p.Id ?? ''),
        code: String(p.code ?? p.Code ?? ''),
        name: String(p.name ?? p.Name ?? p.description ?? ''),
        barcode: String(p.barcode ?? p.Barcode ?? ''),
        price: Number(p.price ?? p.Price ?? p.salesPrice ?? 0),
        unit: String(p.unit ?? p.Unit ?? 'Adet'),
        stock: Number(p.stock ?? p.Stock ?? 0),
      }))

      setProducts(items)
      setLastSync(new Date().toLocaleTimeString('tr-TR'))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Bilinmeyen hata'
      setError('Ürünler çekilemedi: ' + msg)
    } finally {
      setLoading(false)
    }
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.code ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.barcode ?? '').includes(search)
  )

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-800">
        <h1 className="text-xl font-bold">BT<span className="text-blue-500">POS</span> <span className="text-gray-400 font-normal text-sm ml-2">Ürün Listesi</span></h1>
        <div className="flex items-center gap-4">
          {lastSync && <span className="text-xs text-gray-500">Son sync: {lastSync}</span>}
          <button
            onClick={syncProducts}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? 'Senkronize ediliyor...' : '↻ Senkronize Et'}
          </button>
        </div>
      </div>

      {/* Arama */}
      <div className="px-6 py-3 bg-gray-900 border-b border-gray-800">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Ürün adı, kodu veya barkod ile ara..."
          className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* İçerik */}
      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm mb-4">
            {error}
          </div>
        )}

        {loading && products.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-400 animate-pulse">Ürünler yükleniyor...</div>
          </div>
        ) : (
          <>
            <p className="text-gray-500 text-xs mb-3">{filtered.length} ürün</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map(product => (
                <div
                  key={product.id}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-blue-500/50 cursor-pointer transition-colors"
                >
                  <p className="text-xs text-gray-500 font-mono mb-1">{product.code}</p>
                  <p className="text-sm font-medium text-white leading-tight mb-2">{product.name}</p>
                  <p className="text-lg font-bold text-blue-400">
                    {product.price?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </p>
                  <p className="text-xs text-gray-600 mt-1">Stok: {product.stock} {product.unit}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

---

## ADIM 6 — Vite & Tailwind Konfigürasyonu

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['better-sqlite3', 'electron-store'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
    renderer(),
  ],
})
```

### `tailwind.config.js`

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
```

### `postcss.config.js`

```javascript
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
```

### `src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Inter, system-ui, sans-serif; }
```

### `index.html`

```html
<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BTPOS Kasa</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src", "electron"]
}
```

### `src/electron.d.ts` (TypeScript tip tanımı)

```typescript
export {}

declare global {
  interface Window {
    electron: {
      store: {
        get: (key: string) => Promise<unknown>
        set: (key: string, value: unknown) => Promise<void>
      }
      device: {
        uid: () => Promise<string>
      }
      app: {
        version: () => Promise<string>
      }
    }
  }
}
```

---

## ADIM 7 — Uygulamayı Başlat

```bash
npm run dev
```

Uygulama açıldığında:
1. **İlk çalıştırma** → Aktivasyon ekranı gelecek
2. Management panelinden kopyaladığın terminal UUID'sini gir
3. "Aktivasyonu Tamamla" → API'ye istek gider
4. Başarılıysa → Ürün ekranı açılır, İşbaşı'dan ürünler çekilir

---

## Sprint 1 Teslim Kriterleri (Definition of Done)

- [ ] `npm run dev` hatasız açılıyor
- [ ] Aktivasyon ekranı görünüyor (daha önce aktive edilmemişse)
- [ ] Geçersiz lisans anahtarında hata mesajı gösteriyor
- [ ] Geçerli lisans anahtarıyla aktivasyon tamamlanıyor
- [ ] Aktivasyon sonrası ürün ekranına geçiyor
- [ ] İşbaşı'dan ürünler çekiliyor ve grid'de gösteriliyor
- [ ] Arama kutusu çalışıyor
- [ ] "Senkronize Et" butonu yeniden çekiyor
- [ ] Uygulama tekrar açıldığında aktivasyon ekranı gelmiyor (store'dan okuyunca)

---

## Bilinen Sınırlamalar (Sprint 2'ye bırakılan)

- Ürünler henüz SQLite'a yazılmıyor (sadece state'te tutuluyor) → Sprint 2
- Ana satış ekranı / sepet yok → Sprint 2
- Fiş yazdırma yok → Sprint 3
- Lisans bitiş tarihi kontrolü yok → Sprint 2

---

## Sonraki Sprint Önizlemesi (Sprint 2)

| Görev |
|-------|
| SQLite'a ürün yazma + okuma (çevrimdışı mod) |
| Ana satış ekranı: ürün seç → sepet → ödeme |
| Barkod okuyucu desteği |
| Lisans bitiş tarihi kontrolü ve uyarısı |
| Basit günlük rapor (satış özeti) |
