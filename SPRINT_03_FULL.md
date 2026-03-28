# BTPOS — Sprint 3
## Claude Code Görev Paketi (Slim API + Electron)

> **Bu Sprint Kapsamı:**
> 1. Supabase'e `cashiers` tablosu ekle
> 2. Slim API — kasiyer login endpoint'i + aktivasyona cihaz bilgisi
> 3. Electron — cihaz bilgisi toplama, kasiyerleri SQLite'a çekme, giriş ekranı

---

# BÖLÜM A — SUPABASE

## A1. Supabase SQL Editöründe Çalıştır

```sql
-- Kasiyer tablosu
CREATE TABLE IF NOT EXISTS public.cashiers (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  full_name    text NOT NULL,
  cashier_code text NOT NULL,           -- 6 haneli benzersiz kod (şirket içinde)
  password     text NOT NULL,           -- hash'siz, düz metin
  role         text NOT NULL DEFAULT 'cashier' CHECK (role IN ('cashier', 'manager')),
  is_active    boolean DEFAULT true,
  created_at   timestamp with time zone DEFAULT now(),
  updated_at   timestamp with time zone DEFAULT now(),
  CONSTRAINT cashiers_pkey PRIMARY KEY (id),
  CONSTRAINT cashiers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT cashiers_code_company_unique UNIQUE (company_id, cashier_code)
);

CREATE INDEX IF NOT EXISTS idx_cashiers_company_id ON public.cashiers(company_id);
CREATE INDEX IF NOT EXISTS idx_cashiers_code ON public.cashiers(cashier_code);

-- terminals tablosuna cihaz bilgisi kolonları ekle (Sprint 3 notu)
ALTER TABLE public.terminals
  ADD COLUMN IF NOT EXISTS device_name  text,
  ADD COLUMN IF NOT EXISTS mac_address  text,
  ADD COLUMN IF NOT EXISTS os_info      text;
```

---

# BÖLÜM B — SLIM API

## B1. Yeni Dosya: `routes/cashiers.php`

```php
<?php
// routes/cashiers.php
// Kasiyer yönetimi ve POS giriş endpoint'leri

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Routing\RouteCollectorProxy;

return function ($app) {

    $app->group('/cashiers', function (RouteCollectorProxy $group) {

        /**
         * 1. KASİYERLERİ LİSTELE (Electron açılışında çeker)
         *
         * URL: GET /cashiers/{company_id}
         * Electron bu listeyi SQLite'a yazar, sonra local'den okur.
         */
        $group->get('/{company_id}[/]', function (Request $request, Response $response, array $args) {
            try {
                $companyId = $args['company_id'];

                $cashiers = Supabase::request(
                    'GET',
                    "/cashiers?company_id=eq.{$companyId}&is_active=eq.true&select=id,full_name,cashier_code,password,role,is_active&order=full_name.asc"
                );

                $response->getBody()->write(json_encode($cashiers ?? [], JSON_UNESCAPED_UNICODE));
                return $response->withHeader('Content-Type', 'application/json');

            } catch (Exception $e) {
                $response->getBody()->write(json_encode(['message' => $e->getMessage()]));
                return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
            }
        });

        /**
         * 2. KASİYER GİRİŞİ (Electron local doğrulama için referans)
         *
         * URL: POST /cashiers/login
         * Body: { company_id, cashier_code, password }
         *
         * NOT: Electron önce SQLite'tan doğrular.
         * Bu endpoint sadece SQLite boşsa veya fallback gerekirse kullanılır.
         */
        $group->post('/login[/]', function (Request $request, Response $response) {
            try {
                $data        = json_decode((string)$request->getBody(), true);
                $companyId   = trim($data['company_id']   ?? '');
                $cashierCode = trim($data['cashier_code'] ?? '');
                $password    = $data['password']           ?? '';

                if (empty($companyId) || empty($cashierCode) || empty($password)) {
                    $response->getBody()->write(json_encode(['message' => 'company_id, cashier_code ve password zorunludur.']));
                    return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                }

                $result = Supabase::request(
                    'GET',
                    "/cashiers?company_id=eq.{$companyId}&cashier_code=eq.{$cashierCode}&is_active=eq.true&select=id,full_name,cashier_code,role"
                );

                if (empty($result)) {
                    $response->getBody()->write(json_encode(['message' => 'Kasiyer bulunamadı veya pasif.']));
                    return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
                }

                $cashier = $result[0];

                // Düz metin karşılaştırma (hash yok)
                $storedPassword = Supabase::request(
                    'GET',
                    "/cashiers?id=eq.{$cashier['id']}&select=password"
                );

                if (empty($storedPassword) || $storedPassword[0]['password'] !== $password) {
                    $response->getBody()->write(json_encode(['message' => 'Hatalı şifre.']));
                    return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
                }

                $response->getBody()->write(json_encode([
                    'success'      => true,
                    'cashier_id'   => $cashier['id'],
                    'full_name'    => $cashier['full_name'],
                    'cashier_code' => $cashier['cashier_code'],
                    'role'         => $cashier['role'],
                ], JSON_UNESCAPED_UNICODE));

                return $response->withHeader('Content-Type', 'application/json')->withStatus(200);

            } catch (Exception $e) {
                $response->getBody()->write(json_encode(['message' => $e->getMessage()]));
                return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
            }
        });

        /**
         * 3. YÖNETİCİ — KASİYER EKLE
         *
         * URL: POST /cashiers/add
         * Body: { company_id, full_name, cashier_code, password, role }
         * Management panelinden çağrılır.
         */
        $group->post('/add[/]', function (Request $request, Response $response) {
            try {
                $data = json_decode((string)$request->getBody(), true);

                $companyId   = trim($data['company_id']   ?? '');
                $fullName    = trim($data['full_name']     ?? '');
                $cashierCode = trim($data['cashier_code']  ?? '');
                $password    = $data['password']            ?? '';
                $role        = $data['role']                ?? 'cashier';

                if (empty($companyId) || empty($fullName) || empty($cashierCode) || empty($password)) {
                    $response->getBody()->write(json_encode(['message' => 'Tüm alanlar zorunludur.']));
                    return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                }

                if (!preg_match('/^\d{6}$/', $cashierCode)) {
                    $response->getBody()->write(json_encode(['message' => 'Kasiyer kodu tam 6 rakam olmalıdır.']));
                    return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                }

                $payload = [
                    'company_id'   => $companyId,
                    'full_name'    => $fullName,
                    'cashier_code' => $cashierCode,
                    'password'     => $password,
                    'role'         => in_array($role, ['cashier', 'manager']) ? $role : 'cashier',
                    'is_active'    => true,
                    'created_at'   => date('c'),
                    'updated_at'   => date('c'),
                ];

                $result = Supabase::request('POST', '/cashiers', $payload);

                $response->getBody()->write(json_encode([
                    'success' => true,
                    'message' => 'Kasiyer başarıyla oluşturuldu.',
                    'data'    => $result
                ], JSON_UNESCAPED_UNICODE));

                return $response->withStatus(201)->withHeader('Content-Type', 'application/json');

            } catch (Exception $e) {
                $response->getBody()->write(json_encode(['message' => $e->getMessage()]));
                return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
            }
        });

    });
};
```

## B2. `routes/management_licenses.php` — activate endpoint'ini güncelle

Mevcut activate endpoint'inde `// --- 5. Tüm kontroller geçildi — Aktivasyonu tamamla ---` bloğunu bul ve şununla değiştir:

```php
// --- 5. Tüm kontroller geçildi — Aktivasyonu tamamla ---
Supabase::request('PATCH', "/terminals?id=eq.{$licenseKey}", [
    'is_installed' => true,
    'device_uid'   => $deviceUid,
    'device_name'  => $data['device_name']  ?? null,
    'mac_address'  => $data['mac_address']  ?? null,
    'os_info'      => $data['os_info']      ?? null,
    'installed_at' => date('c')
]);
```

## B3. `index.php` — yeni route'u bağla

`$posSalesRoutes` satırından sonra şunu ekle:

```php
// Kasiyer endpoint'leri
$cashierRoutes = require __DIR__ . '/routes/cashiers.php';
$cashierRoutes($app);
```

---

# BÖLÜM C — ELECTRON

## C1. `db/schema.ts` — cashiers tablosunu ekle

Mevcut dosyada `saleItems` tablosundan sonra şunu ekle:

```typescript
// Kasiyerler (Supabase'den çekilip yerel cache olarak saklanır)
export const cashiers = sqliteTable('cashiers', {
  id:          text('id').primaryKey(),
  fullName:    text('full_name').notNull(),
  cashierCode: text('cashier_code').notNull(),
  password:    text('password').notNull(),
  role:        text('role').default('cashier'),
  isActive:    integer('is_active', { mode: 'boolean' }).default(true),
  syncedAt:    text('synced_at'),
})
```

## C2. `db/index.ts` — cashiers tablosunu CREATE'e ekle

Mevcut `sqlite.exec(...)` bloğunun içine, `sale_items` CREATE'inden sonra şunu ekle:

```sql
CREATE TABLE IF NOT EXISTS cashiers (
  id           TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  cashier_code TEXT NOT NULL,
  password     TEXT NOT NULL,
  role         TEXT DEFAULT 'cashier',
  is_active    INTEGER DEFAULT 1,
  synced_at    TEXT
);
```

## C3. `db/operations.ts` — kasiyer operasyonlarını ekle

Dosyanın sonuna şunları ekle:

```typescript
export interface CashierRow {
  id: string
  fullName: string
  cashierCode: string
  password: string
  role: string
  isActive: boolean
}

// Kasiyerleri toplu kaydet
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

// Kasiyer kodu + şifre ile doğrula (local)
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

// Tüm aktif kasiyerleri getir
export function getAllCashiers(): CashierRow[] {
  const db = getDB()
  return db.select().from(cashiers)
    .where(eq(cashiers.isActive, true))
    .all() as CashierRow[]
}
```

> **Not:** `cashiers` import'unu `db/operations.ts` başına ekle:
> ```typescript
> import { products, sales, saleItems, cashiers } from './schema'
> ```

## C4. `electron/device.ts` — MAC ve cihaz adı ekle (dosyayı tamamen değiştir)

```typescript
import * as os from 'os'
import * as crypto from 'crypto'

export function getDeviceUID(): string {
  const mac = getPrimaryMac()
  const raw = `${os.hostname()}-${mac}-${os.platform()}-${os.arch()}`
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32)
}

export function getPrimaryMac(): string {
  const interfaces = os.networkInterfaces()
  return (
    Object.values(interfaces)
      .flat()
      .find((i) => i && !i.internal && i.mac !== '00:00:00:00:00:00')?.mac ?? 'unknown'
  )
}

export function getDeviceInfo() {
  return {
    device_name: os.hostname(),
    mac_address: getPrimaryMac(),
    os_info:     `${os.type()} ${os.release()} (${os.arch()})`,
    device_uid:  getDeviceUID(),
  }
}
```

## C5. `electron/main.ts` — yeni IPC handler'ları ekle

Mevcut IPC bloğuna şunları ekle:

```typescript
ipcMain.handle('device:info', () => {
  const { getDeviceInfo } = require('./device')
  return getDeviceInfo()
})

ipcMain.handle('db:saveCashiers', async (_e, cashiers) => {
  const { saveCashiers } = await import('../db/operations')
  return saveCashiers(cashiers)
})

ipcMain.handle('db:verifyCashier', async (_e, code, password) => {
  const { verifyCashier } = await import('../db/operations')
  return verifyCashier(code, password)
})

ipcMain.handle('db:getCashiers', async () => {
  const { getAllCashiers } = await import('../db/operations')
  return getAllCashiers()
})
```

## C6. `electron/preload.ts` — yeni metodları ekle (dosyayı tamamen değiştir)

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  device: {
    uid:  () => ipcRenderer.invoke('device:uid'),
    info: () => ipcRenderer.invoke('device:info'),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
  db: {
    saveProducts:   (products: unknown[])                    => ipcRenderer.invoke('db:saveProducts', products),
    getProducts:    ()                                       => ipcRenderer.invoke('db:getProducts'),
    saveSale:       (sale: unknown, items: unknown[])        => ipcRenderer.invoke('db:saveSale', sale, items),
    getSales:       (dateFrom?: string, dateTo?: string)     => ipcRenderer.invoke('db:getSales', dateFrom, dateTo),
    saveCashiers:   (cashiers: unknown[])                    => ipcRenderer.invoke('db:saveCashiers', cashiers),
    verifyCashier:  (code: string, password: string)         => ipcRenderer.invoke('db:verifyCashier', code, password),
    getCashiers:    ()                                       => ipcRenderer.invoke('db:getCashiers'),
  },
})
```

## C7. `src/electron.d.ts` — tip tanımlarını güncelle (dosyayı tamamen değiştir)

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
        uid:  () => Promise<string>
        info: () => Promise<DeviceInfo>
      }
      app: {
        version: () => Promise<string>
      }
      db: {
        saveProducts:  (products: unknown[]) => Promise<number>
        getProducts:   () => Promise<ProductRow[]>
        saveSale:      (sale: SaleRow, items: SaleItem[]) => Promise<string>
        getSales:      (dateFrom?: string, dateTo?: string) => Promise<SaleRecord[]>
        saveCashiers:  (cashiers: unknown[]) => Promise<number>
        verifyCashier: (code: string, password: string) => Promise<CashierRow | null>
        getCashiers:   () => Promise<CashierRow[]>
      }
    }
  }

  interface DeviceInfo {
    device_name: string
    mac_address: string
    os_info:     string
    device_uid:  string
  }

  interface CashierRow {
    id:          string
    fullName:    string
    cashierCode: string
    password:    string
    role:        string
    isActive:    boolean
  }

  interface ProductRow {
    id:       string
    code?:    string
    name:     string
    barcode?: string
    price:    number
    vatRate:  number
    unit:     string
    stock:    number
    category?: string
    syncedAt?: string
  }

  interface SaleItem {
    productId?:  string
    productName: string
    quantity:    number
    unitPrice:   number
    vatRate:     number
    lineTotal:   number
  }

  interface SaleRow {
    receiptNo:   string
    totalAmount: number
    paymentType: 'cash' | 'card' | 'mixed'
    cashAmount:  number
    cardAmount:  number
  }

  interface SaleRecord {
    id:          string
    receiptNo:   string
    totalAmount: number
    paymentType: string
    createdAt:   string
  }
}
```

## C8. `src/lib/api.ts` — kasiyer ve cihaz metodlarını ekle

Mevcut `api` objesine şunları ekle:

```typescript
// Kasiyerleri Supabase'den çek
async getCashiers(companyId: string): Promise<CashierRow[]> {
  const res = await fetch(`${API_URL}/cashiers/${companyId}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  // Supabase snake_case → camelCase dönüşümü
  return data.map((c: Record<string, unknown>) => ({
    id:          String(c.id),
    fullName:    String(c.full_name),
    cashierCode: String(c.cashier_code),
    password:    String(c.password),
    role:        String(c.role ?? 'cashier'),
    isActive:    Boolean(c.is_active ?? true),
  }))
},

// activate metodunu güncelle — device info ekle
async activate(licenseKey: string, deviceUid: string, email: string, deviceInfo: DeviceInfo) {
  const res = await fetch(`${API_URL}/management/licenses/terminals/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      license_key:  licenseKey,
      device_uid:   deviceUid,
      email,
      device_name:  deviceInfo.device_name,
      mac_address:  deviceInfo.mac_address,
      os_info:      deviceInfo.os_info,
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
},
```

> **Not:** Eski `activate` metodunu sil, yenisiyle değiştir.

## C9. `src/screens/ActivationScreen.tsx` — device info ekle

`handleActivate` fonksiyonunda şu satırı bul:
```typescript
const deviceUid = await window.electron.device.uid()
const result = await api.activate(licenseKey.trim(), deviceUid, email.trim())
```

Şununla değiştir:
```typescript
const deviceInfo = await window.electron.device.info()
const result = await api.activate(licenseKey.trim(), deviceInfo.device_uid, email.trim(), deviceInfo)
```

Ayrıca store'a kayıt bloğuna şunu ekle:
```typescript
await window.electron.store.set('device_name', deviceInfo.device_name)
await window.electron.store.set('mac_address', deviceInfo.mac_address)
```

## C10. `src/screens/CashierLoginScreen.tsx` — YENİ DOSYA OLUŞTUR

```tsx
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

interface Props {
  companyId: string
  onLogin: (cashier: CashierRow) => void
}

export default function CashierLoginScreen({ companyId, onLogin }: Props) {
  const [code, setCode]         = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [syncing, setSyncing]   = useState(false)
  const codeRef                 = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Açılışta kasiyerleri Supabase'den çekip SQLite'a yaz
    syncCashiers()
    codeRef.current?.focus()
  }, [])

  async function syncCashiers() {
    setSyncing(true)
    try {
      const cashiers = await api.getCashiers(companyId)
      await window.electron.db.saveCashiers(cashiers)
    } catch {
      // API'ye ulaşılamazsa SQLite'taki eski liste kullanılır — sorun değil
    } finally {
      setSyncing(false)
    }
  }

  async function handleLogin() {
    if (!code.trim() || !password.trim()) {
      setError('Kasiyer kodu ve şifre zorunludur.')
      return
    }

    if (!/^\d{6}$/.test(code.trim())) {
      setError('Kasiyer kodu 6 rakam olmalıdır.')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Önce SQLite'tan doğrula (çevrimdışı da çalışsın)
      const cashier = await window.electron.db.verifyCashier(code.trim(), password.trim())

      if (!cashier) {
        setError('Kasiyer kodu veya şifre hatalı.')
        setCode('')
        setPassword('')
        codeRef.current?.focus()
        return
      }

      onLogin(cashier)
    } catch (e) {
      setError('Giriş sırasında hata oluştu: ' + (e instanceof Error ? e.message : 'Bilinmeyen hata'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-8 shadow-2xl border border-gray-800">

        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            BT<span className="text-blue-500">POS</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">Kasiyer Girişi</p>
          {syncing && (
            <p className="text-gray-600 text-xs mt-1 animate-pulse">Kasiyer listesi güncelleniyor...</p>
          )}
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Kasiyer Kodu</label>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && password ? handleLogin() : document.getElementById('cashier-pw')?.focus()}
              placeholder="000000"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-center text-2xl font-mono tracking-widest focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1 block">Şifre</label>
            <input
              id="cashier-pw"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="••••••"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading || syncing}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Doğrulanıyor...' : 'Giriş Yap'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

## C11. `src/App.tsx` — kasiyer girişini akışa ekle (dosyayı tamamen değiştir)

```tsx
import { useEffect, useState } from 'react'
import ActivationScreen    from './screens/ActivationScreen'
import CashierLoginScreen  from './screens/CashierLoginScreen'
import ProductsScreen      from './screens/ProductsScreen'
import POSScreen           from './screens/POSScreen'

type AppState = 'loading' | 'activation' | 'cashier_login' | 'products' | 'pos'

export default function App() {
  const [state, setState]           = useState<AppState>('loading')
  const [companyId, setCompanyId]   = useState<string | null>(null)
  const [cashier, setCashier]       = useState<CashierRow | null>(null)
  const [allProducts, setAllProducts] = useState<ProductRow[]>([])

  useEffect(() => {
    checkActivation()
  }, [])

  async function checkActivation() {
    const activated      = await window.electron.store.get('activated')
    const storedCompanyId = await window.electron.store.get('company_id')

    if (activated && storedCompanyId) {
      setCompanyId(storedCompanyId as string)
      setState('cashier_login')   // Aktivasyon varsa → kasiyer girişine git
    } else {
      setState('activation')
    }
  }

  function handleActivated(cId: string) {
    setCompanyId(cId)
    setState('cashier_login')
  }

  function handleCashierLogin(c: CashierRow) {
    setCashier(c)
    setState('products')
  }

  function handleStartSale(products: ProductRow[]) {
    setAllProducts(products)
    setState('pos')
  }

  function handleLogout() {
    setCashier(null)
    setState('cashier_login')
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

  if (state === 'cashier_login') {
    return <CashierLoginScreen companyId={companyId!} onLogin={handleCashierLogin} />
  }

  if (state === 'pos') {
    return (
      <POSScreen
        companyId={companyId!}
        cashier={cashier!}
        allProducts={allProducts}
        onBack={() => setState('products')}
        onLogout={handleLogout}
      />
    )
  }

  return (
    <ProductsScreen
      companyId={companyId!}
      cashier={cashier!}
      onStartSale={handleStartSale}
      onLogout={handleLogout}
    />
  )
}
```

## C12. `src/screens/ProductsScreen.tsx` — cashier prop + logout butonu ekle

`interface Props` bloğunu şununla değiştir:
```tsx
interface Props {
  companyId: string
  cashier: CashierRow
  onStartSale: (products: ProductRow[]) => void
  onLogout: () => void
}
```

Fonksiyon imzasını güncelle:
```tsx
export default function ProductsScreen({ companyId, cashier, onStartSale, onLogout }: Props) {
```

Header'daki `<div className="flex items-center gap-3">` (logo kısmı) içine kasiyer adını ekle:
```tsx
<div className="flex items-center gap-3">
  <h1 className="text-xl font-bold">BT<span className="text-blue-500">POS</span></h1>
  <span className="text-xs text-gray-500 border border-gray-700 rounded-full px-2 py-0.5">
    {cashier.fullName}
  </span>
  {isOffline && (
    <span className="text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-1 rounded-full">
      Çevrimdışı
    </span>
  )}
</div>
```

Sağ taraftaki buton grubuna logout ekle:
```tsx
<button
  onClick={onLogout}
  className="text-gray-500 hover:text-red-400 text-sm px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
>
  Çıkış
</button>
```

## C13. `src/screens/POSScreen.tsx` — cashier prop + logout ekle

`interface Props` bloğunu şununla değiştir:
```tsx
interface Props {
  companyId: string
  cashier: CashierRow
  allProducts: ProductRow[]
  onBack: () => void
  onLogout: () => void
}
```

Fonksiyon imzasını güncelle:
```tsx
export default function POSScreen({ companyId, cashier, allProducts, onBack, onLogout }: Props) {
```

Header'da kasiyer adını ve logout butonunu göster. `← Ürünler` butonunun yanına:
```tsx
<span className="text-xs text-gray-500">
  Kasiyer: <span className="text-gray-300">{cashier.fullName}</span>
</span>
<button
  onClick={onLogout}
  className="ml-auto text-gray-500 hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-gray-800 transition-colors"
>
  Çıkış
</button>
```

---

# Sprint 3 Teslim Kriterleri

**Supabase:**
- [ ] `cashiers` tablosu oluştu
- [ ] `terminals` tablosuna `device_name`, `mac_address`, `os_info` kolonları eklendi

**Slim API:**
- [ ] `GET /cashiers/{company_id}` → aktif kasiyerleri döndürüyor
- [ ] `POST /cashiers/login` → doğrulama çalışıyor
- [ ] `POST /cashiers/add` → 6 haneli kod zorunluluğu kontrol ediliyor
- [ ] `POST /management/licenses/terminals/activate` → device_name, mac_address, os_info Supabase'e yazılıyor

**Electron:**
- [ ] Aktivasyon ekranında cihaz bilgileri toplanıyor ve API'ye gönderiliyor
- [ ] Uygulama açılışında kasiyer giriş ekranı geliyor
- [ ] Kasiyerler Supabase'den çekilip SQLite'a yazılıyor
- [ ] 6 haneli kod + şifre ile SQLite'tan doğrulama yapılıyor
- [ ] Hatalı girişte hata mesajı gösteriyor, alanlar temizleniyor
- [ ] Ürünler ve satış ekranında kasiyer adı görünüyor
- [ ] Çıkış butonu kasiyer giriş ekranına dönüyor
- [ ] Çevrimdışıysa SQLite'taki eski kasiyer listesiyle çalışıyor

---

# Sprint 4 Önizlemesi

| Konu |
|------|
| Günsonu ekranı (SQLite'tan günlük özet) |
| Fiş yazdırma (ESC/POS) |
| Management paneline kasiyer yönetimi sayfası |
