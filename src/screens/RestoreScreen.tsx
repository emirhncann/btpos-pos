import { useState } from 'react'
import { API_URL, api } from '../lib/api'
import { applyLocalSettings, type LocalSettings } from '../lib/localSettings'
import { buildMerkezCommandHandlers } from '../hooks/merkezCommandHandlers'
import { pavoTestConnection } from '../lib/pavoService'
import AppLogo from '../components/AppLogo'

interface Props {
  companyId: string
  terminalId: string
  onDone: () => void
  onSettings: (s: PosSettingsRow) => void
}

type StepState = 'wait' | 'run' | 'ok' | 'warn' | 'fail'

interface Step {
  id: string
  label: string
  state: StepState
  detail?: string
}

const INITIAL: Step[] = [
  { id: 'bundle', label: 'Kasa bilgileri', state: 'wait' },
  { id: 'pos', label: 'POS ayarları', state: 'wait' },
  { id: 'local', label: 'Kasa ayarları', state: 'wait' },
  { id: 'pay', label: 'Ödeme cihazı', state: 'wait' },
  { id: 'catalog', label: 'Kasiyerler / PLU / ürünler / ödeme tipleri', state: 'wait' },
  { id: 'pavo', label: 'Pavo bağlantı testi', state: 'wait' },
  { id: 'printer', label: 'Yazıcılar', state: 'wait' },
]

export default function RestoreScreen({ companyId, terminalId, onDone, onSettings }: Props) {
  const [steps, setSteps] = useState<Step[]>(INITIAL)
  const [running, setRunning] = useState(false)
  const [choice, setChoice] = useState<'ask' | 'replace' | 'keep' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)

  function patch(id: string, state: StepState, detail?: string) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, state, detail } : s))
  }

  async function detectLocalData(): Promise<boolean> {
    const products = await window.electron.db.getProducts().catch(() => [])
    const device = await window.electron.db.hasLocalPaymentDevice('pavo').catch(() => false)
    return products.length > 0 || device
  }

  async function run(mode: 'replace' | 'keep') {
    setRunning(true)
    setFinished(false)
    setSteps(INITIAL.map(s => ({ ...s, state: 'wait', detail: undefined })))
    setNote(null)

    let bundle: Record<string, unknown> = {}
    patch('bundle', 'run')
    try {
      const res = await fetch(`${API_URL}/terminals/${terminalId}/restore-bundle`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      bundle = await res.json() as Record<string, unknown>
      const meta = (bundle.local_settings_meta ?? bundle.meta ?? null) as { machine_name?: string; updated_at?: string } | null
      if (meta?.machine_name) {
        const here = await window.electron.app.hostname().catch(() => '')
        if (here && meta.machine_name !== here) {
          const when = meta.updated_at ? new Date(meta.updated_at).toLocaleString('tr-TR') : ''
          setNote(`Ayarlar ${meta.machine_name} bilgisayarından geri yüklendi${when ? ` (${when})` : ''}.`)
        }
      }
      patch('bundle', 'ok')
    } catch (e) {
      patch('bundle', 'fail', String(e))
    }

    if (mode === 'replace') {
      patch('pos', 'run')
      try {
        const raw = bundle.pos_settings
        if (raw && typeof raw === 'object') {
          const workplaceId = await window.electron.store.get('workplace_id').catch(() => null) as string | null
          const mapped = raw && 'show_price' in (raw as object)
            ? await api.getPosSettings(companyId, workplaceId, terminalId, null)
            : raw as PosSettingsRow
          await window.electron.db.savePosSettings(mapped)
          onSettings(mapped)
        }
        patch('pos', 'ok')
      } catch (e) {
        patch('pos', 'fail', String(e))
      }

      patch('local', 'run')
      try {
        const local = (bundle.local_settings ?? null) as LocalSettings | null
        if (local && typeof local === 'object') await applyLocalSettings(local)
        patch('local', 'ok')
      } catch (e) {
        patch('local', 'fail', String(e))
      }

      patch('pay', 'run')
      try {
        const devices = Array.isArray(bundle.payment_devices) ? bundle.payment_devices as Array<Record<string, unknown>> : []
        for (const device of devices) {
          await window.electron.db.upsertPaymentDeviceSettings({
            id: String(device.id ?? crypto.randomUUID()),
            companyId: String(device.company_id ?? companyId),
            terminalId: String(device.terminal_id ?? terminalId),
            provider: (device.provider === 'ingenico' || device.provider === 'pax') ? device.provider : 'pavo',
            ipAddress: device.ip_address != null ? String(device.ip_address) : null,
            port: Number(device.port ?? 9100),
            serialNo: device.serial_no != null ? String(device.serial_no) : null,
            cardReadTimeout: Number(device.card_read_timeout ?? 30),
            printWidth: String(device.print_width ?? '').includes('58') ? '58mm' : '80mm',
            isActive: device.is_active !== false && device.is_active !== 0,
            syncedAt: new Date().toISOString(),
            lastPairedAt: device.last_paired_at != null ? String(device.last_paired_at) : null,
          })
        }
        patch('pay', devices.length ? 'ok' : 'warn', devices.length ? undefined : 'Bulutta ödeme cihazı yok')
      } catch (e) {
        patch('pay', 'fail', String(e))
      }
    } else {
      patch('pos', 'ok', 'Mevcut ayarlar korundu')
      patch('local', 'ok', 'Mevcut ayarlar korundu')
      patch('pay', 'ok', 'Mevcut cihaz korundu')
    }

    patch('catalog', 'run')
    try {
      const handlers = buildMerkezCommandHandlers({
        companyId,
        terminalId,
        getCashierId: () => null,
        setCommandSyncing: () => {},
        onLogout: () => {},
        onShowMessage: () => {},
        onSettingsUpdated: onSettings,
        onLock: () => {},
        showToast: () => {},
        onPluUpdated: () => {},
      })
      await handlers.onSyncAll('full')
      patch('catalog', 'ok')
    } catch (e) {
      patch('catalog', 'fail', String(e))
    }

    patch('pavo', 'run')
    try {
      const device = await window.electron.db.getPaymentDeviceSettings('pavo')
      if (!device?.ipAddress || !device.serialNo) {
        patch('pavo', 'warn', 'Pavo ayarı yok')
      } else {
        const test = await pavoTestConnection({
          ipAddress: device.ipAddress,
          port: device.port,
          serialNo: device.serialNo,
          cardReadTimeout: device.cardReadTimeout,
          printWidth: device.printWidth,
        })
        patch('pavo', test.success ? 'ok' : 'warn', test.success ? undefined : test.message)
      }
    } catch (e) {
      patch('pavo', 'warn', String(e))
    }

    patch('printer', 'run')
    try {
      const warnings: string[] = []
      const cfg = await window.electron.printer.getSettings()
      const name = cfg?.printer_name ? String(cfg.printer_name).trim() : ''
      if (name && (cfg?.printer_type ?? 'usb') !== 'network') {
        const list = await window.electron.printer.list()
        if (!list.some(p => p.name === name)) {
          warnings.push(`Fiş yazıcısı bulunamadı: ${name} — Ayarlar'dan seçin`)
        }
      }
      const scale = await window.electron.scale.getSettings()
      const com = scale?.port_path ? String(scale.port_path).trim() : ''
      if (com) {
        const ports = await window.electron.scale.listPorts().catch(() => [] as string[])
        if (!ports.includes(com)) {
          warnings.push(`Terazi portu bulunamadı: ${com} — Ayarlar'dan seçin`)
        }
      }
      patch('printer', warnings.length ? 'warn' : 'ok', warnings.join(' · ') || undefined)
    } catch (e) {
      patch('printer', 'warn', String(e))
    }

    setRunning(false)
    setFinished(true)
  }

  async function begin() {
    const has = await detectLocalData()
    if (has) setChoice('ask')
    else {
      setChoice('replace')
      void run('replace')
    }
  }

  const mark = (s: StepState) => s === 'ok' ? '✓' : s === 'warn' ? '⚠' : s === 'fail' ? '✕' : s === 'run' ? '…' : '○'

  return (
    <div style={{ minHeight: '100vh', background: '#F0F2F5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'white', borderRadius: 16, width: 520, padding: 24, border: '1px solid #E5E7EB' }}>
        <AppLogo height={36} />
        <div style={{ fontSize: 18, fontWeight: 700, margin: '16px 0 8px' }}>Kurulum geri yükleniyor…</div>
        {note && <div style={{ fontSize: 12, color: '#1565C0', marginBottom: 12 }}>{note}</div>}
        {choice === 'ask' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>Bu kasada yerel veri var. Buluttaki ayarlarla değiştirilsin mi?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => { setChoice('replace'); void run('replace') }} style={action}>Buluttaki ayarlarla değiştir</button>
              <button type="button" onClick={() => { setChoice('keep'); void run('keep') }} style={action}>Mevcutları koru</button>
            </div>
          </div>
        )}
        {choice == null && (
          <button type="button" onClick={() => void begin()} style={action}>Geri yüklemeyi başlat</button>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {steps.map(s => (
            <div key={s.id} style={{ fontSize: 13 }}>
              <span style={{ width: 18, display: 'inline-block' }}>{mark(s.state)}</span>
              {s.label}
              {s.detail && <div style={{ marginLeft: 18, fontSize: 11, color: '#6B7280' }}>{s.detail}</div>}
            </div>
          ))}
        </div>
        {finished && (
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button type="button" disabled={running} onClick={() => void run(choice === 'keep' ? 'keep' : 'replace')} style={action}>Tekrar dene</button>
            <button type="button" onClick={onDone} style={{ ...action, background: '#1565C0', color: 'white' }}>Kasaya geç</button>
          </div>
        )}
      </div>
    </div>
  )
}

const action: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', background: 'white', cursor: 'pointer', fontSize: 13,
}
