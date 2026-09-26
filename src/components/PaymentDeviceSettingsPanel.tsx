import { useEffect, useState } from 'react'
import { pavoPair, pavoTestConnection } from '../lib/pavoService'
import { enqueuePaymentDeviceBackup } from '../lib/localSettings'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #E0E0E0',
  fontSize: 13,
  boxSizing: 'border-box',
}

interface Props {
  companyId: string
  terminalId: string
  saleLocked: boolean
}

function isIpv4(value: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value.trim())
  if (!m) return false
  return m.slice(1).every(n => Number(n) <= 255)
}

export default function PaymentDeviceSettingsPanel({ companyId, terminalId, saleLocked }: Props) {
  const [ip, setIp] = useState('')
  const [port, setPort] = useState(9100)
  const [serial, setSerial] = useState('')
  const [timeout, setTimeoutSec] = useState(30)
  const [width, setWidth] = useState<'58mm' | '80mm'>('80mm')
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [lastPairedAt, setLastPairedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState<'test' | 'pair' | 'save' | 'remove' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [heldLock, setHeldLock] = useState(false)

  const locked = saleLocked || heldLock

  useEffect(() => {
    void (async () => {
      const device = await window.electron.db.getPaymentDeviceSettings('pavo').catch(() => undefined)
      if (device) {
        setDeviceId(device.id)
        setIp(device.ipAddress ?? '')
        setPort(device.port || 9100)
        setSerial(device.serialNo ?? '')
        setTimeoutSec(device.cardReadTimeout || 30)
        setWidth(device.printWidth === '58mm' ? '58mm' : '80mm')
        setLastPairedAt(device.lastPairedAt ?? null)
      }
      const order = await window.electron.store.get('last_pavo_order_no').catch(() => null)
      const held = await window.electron.db.getHeldDocuments(companyId).catch(() => [])
      setHeldLock(Boolean(order) || held.length > 0)
    })()
  }, [companyId])

  function validate(): string | null {
    if (!isIpv4(ip)) return 'Geçerli bir IP adresi girin.'
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port 1–65535 arasında olmalı.'
    if (!serial.trim()) return 'Seri no boş olamaz.'
    return null
  }

  function settingsFromForm() {
    return {
      ipAddress: ip.trim(),
      port,
      serialNo: serial.trim(),
      cardReadTimeout: timeout,
      printWidth: width,
    }
  }

  async function persist(active: boolean, pairedAt: string | null) {
    const id = deviceId ?? crypto.randomUUID()
    await window.electron.db.upsertPaymentDeviceSettings({
      id,
      companyId,
      terminalId,
      provider: 'pavo',
      ipAddress: ip.trim(),
      port,
      serialNo: serial.trim(),
      cardReadTimeout: timeout,
      printWidth: width,
      isActive: active,
      syncedAt: new Date().toISOString(),
      lastPairedAt: pairedAt,
    })
    setDeviceId(id)
    await enqueuePaymentDeviceBackup({
      provider: 'pavo',
      ip_address: ip.trim(),
      port,
      serial_no: serial.trim(),
      card_read_timeout: timeout,
      print_width: width,
      updated_from: 'pos',
      last_paired_at: pairedAt,
      is_active: active,
    })
  }

  async function handleTest() {
    const err = validate()
    if (err) { setMsg({ ok: false, text: err }); return }
    setBusy('test')
    setMsg(null)
    try {
      const res = await pavoTestConnection(settingsFromForm())
      setMsg({ ok: res.success, text: res.message })
    } finally {
      setBusy(null)
    }
  }

  async function handlePair() {
    const err = validate()
    if (err) { setMsg({ ok: false, text: err }); return }
    setBusy('pair')
    setMsg(null)
    try {
      const seq = await window.electron.db.nextPavoSequence()
      const res = await pavoPair(settingsFromForm(), seq)
      if (res.success) {
        const now = new Date().toISOString()
        setLastPairedAt(now)
        if (deviceId) await persist(true, now)
        setMsg({ ok: true, text: 'Eşleştirme başarılı' })
      } else {
        setMsg({ ok: false, text: res.message ?? 'Eşleştirme başarısız' })
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleSave() {
    if (locked) {
      setMsg({ ok: false, text: 'Satış açıkken veya askıda belge varken Pavo ayarı kaydedilemez.' })
      return
    }
    const err = validate()
    if (err) { setMsg({ ok: false, text: err }); return }
    setBusy('save')
    setMsg(null)
    try {
      await persist(true, lastPairedAt)
      setMsg({ ok: true, text: 'Kaydedildi. Buluta gönderim kuyruğa alındı.' })
    } catch (e) {
      setMsg({ ok: false, text: String(e) })
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove() {
    if (locked) {
      setMsg({ ok: false, text: 'Satış açıkken cihaz kaldırılamaz.' })
      return
    }
    if (!window.confirm('Pavo cihaz kaydı kaldırılsın mı?')) return
    setBusy('remove')
    setMsg(null)
    try {
      await window.electron.db.deactivatePaymentDevice('pavo')
      await enqueuePaymentDeviceBackup({
        provider: 'pavo',
        ip_address: ip.trim(),
        port,
        serial_no: serial.trim(),
        card_read_timeout: timeout,
        print_width: width,
        updated_from: 'pos',
        last_paired_at: lastPairedAt,
        is_active: false,
      })
      setMsg({ ok: true, text: 'Cihaz pasif yapıldı.' })
    } catch (e) {
      setMsg({ ok: false, text: String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1565C0' }}>Pavo ödeme cihazı</div>
      {locked && (
        <div style={{ fontSize: 12, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 10px' }}>
          Sepet dolu veya askıda satış var. Kayıt satış bitene kadar kapalı.
        </div>
      )}
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>
        IP adresi
        <input style={{ ...inputStyle, marginTop: 4 }} value={ip} onChange={e => setIp(e.target.value)} placeholder="192.168.1.10" />
      </label>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>
        Port
        <input style={{ ...inputStyle, marginTop: 4 }} type="number" value={port} onChange={e => setPort(Number(e.target.value))} />
      </label>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>
        Seri no
        <input style={{ ...inputStyle, marginTop: 4 }} value={serial} onChange={e => setSerial(e.target.value)} placeholder="PAV…" />
      </label>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>
        Kart okuma süresi (sn)
        <input style={{ ...inputStyle, marginTop: 4 }} type="number" value={timeout} onChange={e => setTimeoutSec(Number(e.target.value) || 30)} />
      </label>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>
        Fiş genişliği
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {(['58mm', '80mm'] as const).map(w => (
            <button
              key={w}
              type="button"
              onClick={() => setWidth(w)}
              style={{
                padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                border: width === w ? '1px solid #1565C0' : '1px solid #E0E0E0',
                background: width === w ? '#E3F2FD' : 'white',
                color: width === w ? '#1565C0' : '#374151',
              }}
            >{w}</button>
          ))}
        </div>
      </div>
      {lastPairedAt && (
        <div style={{ fontSize: 11, color: '#6B7280' }}>
          Son eşleştirme: {new Date(lastPairedAt).toLocaleString('tr-TR')}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" disabled={busy != null} onClick={() => void handleTest()} style={btn('#1565C0')}>Bağlantıyı Test Et</button>
        <button type="button" disabled={busy != null} onClick={() => void handlePair()} style={btn('#2E7D32')}>Eşleştir</button>
        <button type="button" disabled={busy != null || locked} onClick={() => void handleSave()} style={btn('#111827')}>Kaydet</button>
        <button type="button" disabled={busy != null || locked} onClick={() => void handleRemove()} style={btn('#C62828')}>Cihazı Kaldır</button>
      </div>
      {msg && (
        <div style={{ fontSize: 12, color: msg.ok ? '#166534' : '#B91C1C' }}>{msg.ok ? '✓' : '✕'} {msg.text}</div>
      )}
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return {
    padding: '8px 12px', borderRadius: 8, border: 'none', background: color,
    color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }
}
