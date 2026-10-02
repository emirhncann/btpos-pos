import { parseSettingsBundle, type SettingsBundle } from './settingsModel'

export const API_URL = 'https://api.btpos.com.tr'

export const api = {

  async activate(licenseKey: string, deviceUid: string, email: string, deviceInfo: DeviceInfo, appVersion: string) {
    const res = await fetch(`${API_URL}/management/licenses/terminals/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: licenseKey,
        device_uid:  deviceUid,
        email,
        device_name: deviceInfo.device_name,
        mac_address: deviceInfo.mac_address,
        os_info:     deviceInfo.os_info,
        app_version: appVersion,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async checkLicense(companyId: string) {
    const res = await fetch(`${API_URL}/management/licenses/check/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getProducts(companyId: string) {
    const res = await fetch(`${API_URL}/integration/products/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getCustomers(companyId: string): Promise<CustomerRow[]> {
    const res = await fetch(`${API_URL}/integration/customers/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const list = data?.data?.data ?? data?.data?.items ?? data?.items ?? data ?? []
    return list.map((c: Record<string, unknown>) => {
      const isPersonRaw = c.isPerson
      const isPerson =
        isPersonRaw === false || isPersonRaw === 0 || isPersonRaw === '0' ? false : true
      return {
        id:        String(c.id ?? ''),
        companyId,
        code:      String(c.code ?? c.Code ?? ''),
        name:      String(c.name ?? c.Name ?? c.title ?? ''),
        phone:     String(c.phone ?? c.Phone ?? c.gsm ?? ''),
        taxNo:     String(c.taxNo ?? c.vkn ?? ''),
        address:   String(c.address ?? c.Address ?? ''),
        balance:   Number(c.balance ?? c.Balance ?? 0),
        isPerson,
        firstName: String(c.firstName ?? ''),
        lastName:  String(c.lastName ?? ''),
        postalCode: String(c.postalCode ?? c.postal_code ?? ''),
        city:       String(c.city ?? ''),
        district:   String(c.district ?? ''),
        email:      String(c.emailAddress ?? c.email ?? c.Email ?? ''),
      }
    })
  },

  async getCashiers(companyId: string): Promise<CashierRow[]> {
    const res = await fetch(`${API_URL}/cashiers/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data.map((c: Record<string, unknown>) => ({
      id:          String(c.id),
      fullName:    String(c.full_name),
      cashierCode: String(c.cashier_code),
      password:    String(c.password),
      role:        String(c.role ?? 'cashier'),
      isActive:    Boolean(c.is_active ?? true),
      cardNumber:  c.card_number ? String(c.card_number) : null,
    }))
  },

  /** Kasiyer girişi — terminal erişim kontrolü dahil */
  async loginCashier(
    cashierCode: string,
    password: string,
    companyId: string,
    terminalId: string,
  ): Promise<{
    ok: boolean
    status: number
    success?: boolean
    code?: string
    message?: string
    error?: string
    cashier_id?: string
    full_name?: string
    cashier_code?: string
    role?: string
    cashier?: Record<string, unknown>
  }> {
    const res = await fetch(`${API_URL}/cashiers/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cashier_code: cashierCode,
        password,
        company_id: companyId,
        terminal_id: terminalId,
      }),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, ...data }
  },

  // Komutları dinle (poll)
  async pollCommands(terminalId: string) {
    const res = await fetch(`${API_URL}/pos/commands/poll/${terminalId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<{
      success:       boolean
      poll_interval: number
      is_locked:     boolean
      lock_reason:   string | null
      commands: Array<{
        target_id:  string
        command_id: string
        command:    string
        payload:    Record<string, unknown>
        created_at: string
      }>
    }>
  },

  // Komutu tamamlandı/hata olarak işaretle
  async ackCommand(targetId: string, status: 'done' | 'failed', error?: string) {
    const res = await fetch(`${API_URL}/pos/commands/ack/${targetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, error }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getDailySummary(companyId: string, date?: string) {
    const query = date ? `?date=${date}` : ''
    const res   = await fetch(`${API_URL}/pos/sales/summary/${companyId}${query}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getSettingsBundle(terminalId: string): Promise<SettingsBundle> {
    const res = await fetch(`${API_URL}/pos/settings/${terminalId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseSettingsBundle(await res.json())
  },

  async getTemplates(companyId: string): Promise<Record<string, unknown>[]> {
    const url = `${API_URL}/templates/${companyId}`
    console.log('[api.getTemplates] GET', url)
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`getTemplates HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.data)) return data.data
    if (Array.isArray(data?.templates)) return data.templates
    if (Array.isArray(data?.data?.templates)) return data.data.templates
    console.warn('[api.getTemplates] beklenmeyen JSON yapısı:', Object.keys(data ?? {}))
    return []
  },

  async getPaymentDeviceSettings(companyId: string, terminalId: string) {
    const res = await fetch(`${API_URL}/payment-devices/${companyId}/${terminalId}`)
    if (!res.ok) return []
    return res.json() as Promise<Array<{
      id: string
      company_id: string
      terminal_id: string
      provider: 'pavo' | 'ingenico' | 'pax'
      ip_address: string | null
      port: number | null
      serial_no: string | null
      card_read_timeout: number | null
      print_width: '58mm' | '80mm' | null
      is_active: boolean | null
    }>>
  },

  async sendInvoiceToErp(
    companyId: string,
    payload: {
      sale_id:      string
      customer:     {
        code?:      string
        name:       string
        firstName?: string
        lastName?:  string
        taxNo?:     string
        address?:    string
        phone?:      string
        isPerson?:   boolean
        postalCode?: string
        city?:       string
        district?:   string
      }
      items:        { product_code: string; name: string; quantity: number; price: number; vatRate: number; unit: string; discountRate?: number }[]
      invoice_date: string
      description?: string
      endpoint?: string
    },
  ): Promise<{ success: boolean; invoice_id?: string; invoice_number?: string; message?: string }> {
    const endpoint = payload.endpoint && payload.endpoint.trim().length > 0
      ? payload.endpoint
      : `/integration/invoice/${companyId}`
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
}

/** Sunucudan PLU listesi — yalnızca sync_plu (veya benzeri komut) işlenirken; POS doğrudan SQLite okur. */
export async function fetchPluGroupsFromServer(
  companyId: string,
  _workplaceId?: string | null,
  _terminalId?: string | null,
  cashierId?: string | null,
): Promise<PluGroup[]> {
  const params = new URLSearchParams()
  params.append('cashier_id', cashierId ?? '')

  const res = await fetch(
    `${API_URL}/plu/groups/${companyId}?${params.toString()}`,
  )
  if (!res.ok) throw new Error(`PLU fetch failed: ${res.status}`)
  return res.json()
}
