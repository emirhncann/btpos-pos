# BTPOS Slim API — Sprint 2
## Claude Code Görev Paketi (Sunucu Tarafı)

> **Kural:** Tüm değişiklikler `/home/claude/...` değil, **sunucudaki gerçek dosyalara** uygulanacak.
> **Dizin:** `api.btpos.com.tr/routes/`
> **Yöntem:** Mevcut dosyaları düzenle + yeni dosya ekle + index.php'ye bağla.

---

## DEĞİŞİKLİK 1 — Terminal Aktivasyonuna E-posta Doğrulaması Ekle

**Dosya:** `routes/management_licenses.php`

Mevcut `terminals/activate` endpoint'ini (7. blok) aşağıdaki ile **tamamen değiştir.**

Eski kod:
```php
/**
 * 7. TERMİNAL AKTİVASYONU (Flutter Tarafı)
 */
$group->post('/terminals/activate[/]', function (Request $request, Response $response) {
    try {
        $data = json_decode((string)$request->getBody(), true);
        $licenseKey = $data['license_key']; // Terminal UUID
        $deviceUid  = $data['device_uid']; 

        $terminal = Supabase::request('GET', "/terminals?id=eq.{$licenseKey}&select=*,licenses(*)");
        if (empty($terminal)) {
            $response->getBody()->write(json_encode(['message' => 'Geçersiz anahtar.']));
            return $response->withStatus(404);
        }

        $terminalData = $terminal[0];
        if ($terminalData['is_installed']) {
            $response->getBody()->write(json_encode(['message' => 'Cihaz zaten aktif.']));
            return $response->withStatus(403);
        }

        Supabase::request('PATCH', "/terminals?id=eq.{$licenseKey}", [
            'is_installed' => true,
            'device_uid'   => $deviceUid,
            'installed_at' => date('c')
        ]);

        $response->getBody()->write(json_encode([
            'success' => true, 
            'company_id' => $terminalData['company_id']
        ], JSON_UNESCAPED_UNICODE));
        return $response->withHeader('Content-Type', 'application/json');
    } catch (Exception $e) {
        $response->getBody()->write(json_encode(['message' => $e->getMessage()]));
        return $response->withStatus(500);
    }
});
```

Yeni kod (tamamını yapıştır):
```php
/**
 * 7. TERMİNAL AKTİVASYONU — E-posta + Lisans Anahtarı Doğrulamalı
 * 
 * İstek: POST /management/licenses/terminals/activate
 * Body: { license_key: "terminal-uuid", device_uid: "...", email: "dealer@email.com" }
 * 
 * Doğrulama zinciri:
 *   1. Terminal UUID geçerli mi?
 *   2. Terminal zaten kurulu mu?
 *   3. Terminale bağlı şirketin dealer'ı var mı?
 *   4. Dealer'ın e-postası gönderilen e-posta ile eşleşiyor mu?
 */
$group->post('/terminals/activate[/]', function (Request $request, Response $response) {
    try {
        $data       = json_decode((string)$request->getBody(), true);
        $licenseKey = trim($data['license_key'] ?? '');
        $deviceUid  = trim($data['device_uid']  ?? '');
        $email      = strtolower(trim($data['email'] ?? ''));

        // --- Temel Validasyon ---
        if (empty($licenseKey) || empty($deviceUid) || empty($email)) {
            $response->getBody()->write(json_encode([
                'message' => 'Lisans anahtarı, cihaz kimliği ve e-posta zorunludur.'
            ]));
            return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
        }

        // --- 1. Terminal'i bul (şirket ve lisans bilgisiyle birlikte) ---
        $terminal = Supabase::request(
            'GET',
            "/terminals?id=eq.{$licenseKey}&select=*,licenses(*),companies(id,dealer_id)"
        );

        if (empty($terminal)) {
            $response->getBody()->write(json_encode(['message' => 'Geçersiz lisans anahtarı.']));
            return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
        }

        $terminalData = $terminal[0];

        // --- 2. Zaten kurulu mu? ---
        if ($terminalData['is_installed'] === true) {
            $response->getBody()->write(json_encode(['message' => 'Bu kasa zaten başka bir cihaza atanmış.']));
            return $response->withStatus(403)->withHeader('Content-Type', 'application/json');
        }

        // --- 3. Şirketin dealer'ını bul ---
        $dealerId = $terminalData['companies']['dealer_id'] ?? null;

        if (empty($dealerId)) {
            $response->getBody()->write(json_encode(['message' => 'Bu şirkete bağlı bir bayi bulunamadı.']));
            return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
        }

        // --- 4. Dealer'ın e-postasını Supabase'den çek ve karşılaştır ---
        $dealer = Supabase::request('GET', "/dealer?id=eq.{$dealerId}&select=email,name");

        if (empty($dealer) || empty($dealer[0]['email'])) {
            $response->getBody()->write(json_encode(['message' => 'Bayi e-posta bilgisi bulunamadı.']));
            return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
        }

        $dealerEmail = strtolower(trim($dealer[0]['email']));

        if ($dealerEmail !== $email) {
            $response->getBody()->write(json_encode([
                'message' => 'E-posta adresi bu lisansla eşleşmiyor. Lütfen bayinizin e-posta adresini girin.'
            ]));
            return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
        }

        // --- 5. Tüm kontroller geçildi — Aktivasyonu tamamla ---
        Supabase::request('PATCH', "/terminals?id=eq.{$licenseKey}", [
            'is_installed' => true,
            'device_uid'   => $deviceUid,
            'installed_at' => date('c')
        ]);

        $response->getBody()->write(json_encode([
            'success'      => true,
            'company_id'   => $terminalData['company_id'],
            'dealer_name'  => $dealer[0]['name'] ?? '',
            'terminal_name'=> $terminalData['terminal_name'] ?? 'Kasa'
        ], JSON_UNESCAPED_UNICODE));

        return $response->withHeader('Content-Type', 'application/json')->withStatus(200);

    } catch (Exception $e) {
        $response->getBody()->write(json_encode(['message' => 'Sistem hatası: ' . $e->getMessage()]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
});
```

---

## DEĞİŞİKLİK 2 — Yeni Dosya: Satış Endpoint'i

**Dosya:** `routes/pos_sales.php` — YENİ DOSYA OLUŞTUR

```php
<?php
// routes/pos_sales.php
// POS Kasa → Satış kayıt ve sorgulama endpoint'leri

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Routing\RouteCollectorProxy;

return function ($app) {

    $app->group('/pos', function (RouteCollectorProxy $group) {

        /**
         * 1. SATIŞ KAYDET
         * 
         * Electron kasası satışı önce SQLite'a yazar,
         * ardından bu endpoint'e göndererek merkezi kayıt oluşturur.
         * 
         * URL: POST /pos/sales
         * Body: {
         *   company_id, terminal_id, receipt_no,
         *   total_amount, payment_type,
         *   cash_amount, card_amount,
         *   items: [{ product_id?, product_name, quantity, unit_price, vat_rate, line_total }]
         * }
         */
        $group->post('/sales[/]', function (Request $request, Response $response) {
            try {
                $data = json_decode((string)$request->getBody(), true);

                // Zorunlu alanlar
                $companyId  = $data['company_id']  ?? null;
                $terminalId = $data['terminal_id']  ?? null;
                $receiptNo  = $data['receipt_no']   ?? null;
                $items      = $data['items']         ?? [];

                if (!$companyId || !$receiptNo || empty($items)) {
                    $response->getBody()->write(json_encode([
                        'message' => 'company_id, receipt_no ve items zorunludur.'
                    ]));
                    return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
                }

                // --- Şirkete ait aktif lisansı doğrula ---
                $license = Supabase::request(
                    'GET',
                    "/licenses?company_id=eq.{$companyId}&is_active=eq.true&select=id,end_date"
                );

                if (empty($license)) {
                    $response->getBody()->write(json_encode(['message' => 'Aktif lisans bulunamadı.']));
                    return $response->withStatus(403)->withHeader('Content-Type', 'application/json');
                }

                // Lisans süresi dolmuş mu?
                $endDate = new DateTime($license[0]['end_date']);
                if ($endDate < new DateTime()) {
                    $response->getBody()->write(json_encode(['message' => 'Lisans süresi dolmuş.']));
                    return $response->withStatus(403)->withHeader('Content-Type', 'application/json');
                }

                // --- Satış ana kaydını oluştur ---
                $salePayload = [
                    'company_id'   => $companyId,
                    'terminal_id'  => $terminalId,
                    'receipt_no'   => $receiptNo,
                    'total_amount' => (float)($data['total_amount'] ?? 0),
                    'payment_type' => $data['payment_type'] ?? 'cash',
                    'cash_amount'  => (float)($data['cash_amount'] ?? 0),
                    'card_amount'  => (float)($data['card_amount'] ?? 0),
                    'created_at'   => $data['created_at'] ?? date('c'),
                    'synced'       => true
                ];

                $saleResult = Supabase::request('POST', '/sales', $salePayload);

                if (empty($saleResult)) {
                    throw new Exception('Satış ana kaydı oluşturulamadı.');
                }

                $saleId = $saleResult[0]['id'];

                // --- Satış kalemlerini kaydet ---
                $itemPayloads = [];
                foreach ($items as $item) {
                    $itemPayloads[] = [
                        'sale_id'      => $saleId,
                        'product_id'   => $item['product_id']   ?? null,
                        'product_name' => $item['product_name'] ?? 'Bilinmeyen Ürün',
                        'quantity'     => (float)($item['quantity']   ?? 1),
                        'unit_price'   => (float)($item['unit_price']  ?? 0),
                        'vat_rate'     => (float)($item['vat_rate']    ?? 18),
                        'line_total'   => (float)($item['line_total']  ?? 0),
                    ];
                }

                Supabase::request('POST', '/sale_items', $itemPayloads);

                $response->getBody()->write(json_encode([
                    'success'    => true,
                    'sale_id'    => $saleId,
                    'receipt_no' => $receiptNo
                ], JSON_UNESCAPED_UNICODE));

                return $response->withStatus(201)->withHeader('Content-Type', 'application/json');

            } catch (Exception $e) {
                $response->getBody()->write(json_encode(['message' => $e->getMessage()]));
                return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
            }
        });

        /**
         * 2. GÜNLÜK SATIŞ ÖZETİ
         * 
         * URL: GET /pos/sales/summary/{company_id}?date=2026-03-27
         * Tarihi belirtmezsen bugünü alır.
         */
        $group->get('/sales/summary/{company_id}[/]', function (Request $request, Response $response, array $args) {
            try {
                $companyId = $args['company_id'];
                $params    = $request->getQueryParams();
                $date      = $params['date'] ?? date('Y-m-d');

                $dateFrom = $date . 'T00:00:00';
                $dateTo   = $date . 'T23:59:59';

                $salesData = Supabase::request(
                    'GET',
                    "/sales?company_id=eq.{$companyId}&created_at=gte.{$dateFrom}&created_at=lte.{$dateTo}&select=*"
                );

                $totalCash  = 0;
                $totalCard  = 0;
                $totalSales = 0;
                $saleCount  = count($salesData ?? []);

                foreach (($salesData ?? []) as $sale) {
                    $totalCash  += (float)$sale['cash_amount'];
                    $totalCard  += (float)$sale['card_amount'];
                    $totalSales += (float)$sale['total_amount'];
                }

                $response->getBody()->write(json_encode([
                    'date'        => $date,
                    'sale_count'  => $saleCount,
                    'total_sales' => $totalSales,
                    'total_cash'  => $totalCash,
                    'total_card'  => $totalCard,
                    'sales'       => $salesData ?? []
                ], JSON_UNESCAPED_UNICODE));

                return $response->withHeader('Content-Type', 'application/json');

            } catch (Exception $e) {
                $response->getBody()->write(json_encode(['message' => $e->getMessage()]));
                return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
            }
        });

        /**
         * 3. SENKRONIZE EDILMEMIŞ SATIŞLARI SORGULA
         * 
         * Electron bu endpoint'i çağırarak hangi satışların
         * sunucuya iletilmediğini kontrol edebilir.
         * 
         * URL: GET /pos/sales/unsynced/{company_id}
         */
        $group->get('/sales/unsynced/{company_id}[/]', function (Request $request, Response $response, array $args) {
            try {
                $sales = Supabase::request(
                    'GET',
                    "/sales?company_id=eq.{$args['company_id']}&synced=eq.false&select=id,receipt_no,total_amount,created_at"
                );

                $response->getBody()->write(json_encode($sales ?? [], JSON_UNESCAPED_UNICODE));
                return $response->withHeader('Content-Type', 'application/json');

            } catch (Exception $e) {
                $response->getBody()->write(json_encode(['message' => $e->getMessage()]));
                return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
            }
        });

    });
};
```

---

## DEĞİŞİKLİK 3 — Supabase'e `sales` ve `sale_items` Tabloları Ekle

Supabase SQL editöründe şunu çalıştır:

```sql
-- Satışlar tablosu
CREATE TABLE IF NOT EXISTS public.sales (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  terminal_id  uuid,
  receipt_no   text NOT NULL,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  payment_type text NOT NULL DEFAULT 'cash' CHECK (payment_type IN ('cash','card','mixed')),
  cash_amount  numeric(10,2) DEFAULT 0,
  card_amount  numeric(10,2) DEFAULT 0,
  created_at   timestamp with time zone DEFAULT now(),
  synced       boolean DEFAULT true,
  CONSTRAINT sales_pkey PRIMARY KEY (id),
  CONSTRAINT sales_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

-- Satış kalemleri tablosu
CREATE TABLE IF NOT EXISTS public.sale_items (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id      uuid NOT NULL,
  product_id   text,
  product_name text NOT NULL,
  quantity     numeric(10,3) NOT NULL DEFAULT 1,
  unit_price   numeric(10,2) NOT NULL DEFAULT 0,
  vat_rate     numeric(5,2) DEFAULT 18,
  line_total   numeric(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT sale_items_pkey PRIMARY KEY (id),
  CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE
);

-- İndeksler (sorgu hızı için)
CREATE INDEX IF NOT EXISTS idx_sales_company_id ON public.sales(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON public.sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_synced ON public.sales(synced);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items(sale_id);
```

---

## DEĞİŞİKLİK 4 — index.php'ye Yeni Route'u Bağla

`index.php` dosyasında, `$integrationRoutes` satırından **sonrasına** şunu ekle:

```php
// POS Satış Endpoint'leri
$posSalesRoutes = require __DIR__ . '/routes/pos_sales.php';
$posSalesRoutes($app);
```

---

## DEĞİŞİKLİK 5 — Electron `api.ts` Güncelle

`src/lib/api.ts` dosyasına şu metodları ekle:

```typescript
// Satışı sunucuya kaydet (çevrimiçiyse)
async syncSale(sale: {
  company_id: string
  terminal_id: string
  receipt_no: string
  total_amount: number
  payment_type: string
  cash_amount: number
  card_amount: number
  created_at: string
  items: SaleItem[]
}) {
  const res = await fetch(`${API_URL}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sale),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
},

// Günlük özet
async getDailySummary(companyId: string, date?: string) {
  const query = date ? `?date=${date}` : ''
  const res = await fetch(`${API_URL}/pos/sales/summary/${companyId}${query}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
},
```

Aktivasyon metodunu da güncelle — artık `email` de gönderiyor:

```typescript
// Eski:
async activate(licenseKey: string, deviceUid: string) {
  ...
  body: JSON.stringify({ license_key: licenseKey, device_uid: deviceUid }),
  ...
}

// Yeni (dosyada bul ve değiştir):
async activate(licenseKey: string, deviceUid: string, email: string) {
  const res = await fetch(`${API_URL}/management/licenses/terminals/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_key: licenseKey, device_uid: deviceUid, email }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
},
```

---

## DEĞİŞİKLİK 6 — Electron `ActivationScreen.tsx` Güncelle

E-posta alanını forma ekle. `ActivationScreen.tsx`'i güncelle:

```tsx
// State'e ekle:
const [email, setEmail] = useState('')

// handleActivate içinde değiştir:
const result = await api.activate(licenseKey.trim(), deviceUid, email.trim())

// Form'a e-posta alanını ekle (lisans anahtarı input'undan ÖNCE):
<div>
  <label className="text-sm text-gray-400 mb-1 block">Bayi E-posta Adresi</label>
  <input
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    placeholder="bayi@email.com"
    className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
  />
</div>

// Validasyona ekle (licenseKey kontrolünün yanına):
if (!email.trim() || !email.includes('@')) {
  setError('Geçerli bir e-posta adresi girin.')
  return
}
```

---

## Sprint 2 API Teslim Kriterleri (Definition of Done)

**Slim API:**
- [ ] `POST /management/licenses/terminals/activate` — e-posta yanlışsa 401 dönüyor
- [ ] `POST /management/licenses/terminals/activate` — e-posta doğruysa `company_id` ve `dealer_name` dönüyor
- [ ] Zaten kurulu terminal için 403 dönüyor
- [ ] `POST /pos/sales` — satış kaydediliyor, `sale_id` dönüyor
- [ ] `POST /pos/sales` — süresi dolmuş lisansta 403 dönüyor
- [ ] `GET /pos/sales/summary/{company_id}` — günlük özet dönüyor
- [ ] Supabase'de `sales` ve `sale_items` tabloları oluştu

**Electron:**
- [ ] Aktivasyon ekranında e-posta alanı var
- [ ] E-posta yanlışsa hata mesajı gösteriyor
- [ ] Satış tamamlandığında arka planda `api.syncSale()` çağrılıyor (hata olursa sessizce geçiyor — SQLite'ta zaten var)

---

## Endpoint Özeti

| Method | URL | Açıklama |
|--------|-----|----------|
| POST | `/management/licenses/terminals/activate` | Güncellenmiş — e-posta doğrulamalı |
| POST | `/pos/sales` | Satış kaydet |
| GET | `/pos/sales/summary/{company_id}` | Günlük özet |
| GET | `/pos/sales/unsynced/{company_id}` | Senkronize edilmemiş satışlar |
