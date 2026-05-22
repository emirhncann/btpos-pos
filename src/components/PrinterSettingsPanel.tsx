import { useState, useEffect } from 'react'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #E0E0E0',
  fontSize: 13,
  boxSizing: 'border-box',
}

function lbl(text: string) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>
      {text}
    </div>
  )
}

export default function PrinterSettingsPanel() {
  const [printerType, setPrinterType] = useState<'usb' | 'network'>('usb')
  const [printerName, setPrinterName] = useState('')
  const [printerIp, setPrinterIp] = useState('')
  const [printerPort, setPrinterPort] = useState(9100)
  const [paperWidth, setPaperWidth] = useState(80)
  const [printerList, setPrinterList] = useState<{ name: string; isDefault: boolean }[]>([])
  const [savingPrinter, setSavingPrinter] = useState(false)
  const [printerTestResult, setPrinterTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  async function loadPrinters() {
    const list = await window.electron.printer.list()
    setPrinterList(list)
  }

  async function loadPrinterSettings() {
    const res = await window.electron.printer.getSettings()
    if (res) {
      setPrinterType((res.printer_type as 'usb' | 'network') ?? 'usb')
      setPrinterName(String(res.printer_name ?? ''))
      setPrinterIp(String(res.printer_ip ?? ''))
      setPrinterPort(Number(res.printer_port ?? 9100))
      setPaperWidth(Number(res.paper_width ?? 80))
    }
    if ((res?.printer_type ?? 'usb') === 'usb') void loadPrinters()
  }

  useEffect(() => {
    void loadPrinterSettings()
  }, [])

  async function savePrinterSettings() {
    setSavingPrinter(true)
    try {
      await window.electron.printer.saveSettings({
        printer_type: printerType,
        printer_name: printerName || null,
        printer_ip:   printerIp || null,
        printer_port: printerPort,
        paper_width:  paperWidth,
        is_active:    true,
      })
      setPrinterTestResult({ ok: true, msg: 'Ayarlar kaydedildi' })
    } finally {
      setSavingPrinter(false)
    }
  }

  async function testPrint() {
    setPrinterTestResult(null)
    try {
      const res = await window.electron.printer.testPrint({
        printer_type: printerType,
        printer_name: printerName || null,
        printer_ip:   printerIp || null,
        printer_port: printerPort,
        paper_width:  paperWidth,
      })
      if (res.success) {
        setPrinterTestResult({ ok: true, msg: 'Yazıcı çalışıyor' })
      } else {
        setPrinterTestResult({ ok: false, msg: res.message ?? 'Yazdırma hatası' })
      }
    } catch (e) {
      setPrinterTestResult({ ok: false, msg: String(e) })
    }
  }

  return (
    <div style={{
      padding: '16px 20px',
      background: '#F8FFF8',
      border: '1px solid #C8E6C9',
      borderRadius: 12,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#2E7D32', marginBottom: 16 }}>
        🖨️ Fiş Yazıcı
      </div>
      <p style={{ fontSize: 11, color: '#6B7280', margin: '0 0 12px' }}>
        Yazıcı ayarları yalnızca bu kasada (SQLite) saklanır; merkez senkronuna dahil değildir.
      </p>

      <div style={{ marginBottom: 12 }}>
        {lbl('Bağlantı Tipi')}
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { v: 'usb' as const,     l: '🔌 USB' },
            { v: 'network' as const, l: '🌐 Ağ (IP)' },
          ]).map(({ v, l }) => (
            <button key={v} type="button"
              onClick={() => setPrinterType(v)}
              style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1.5px solid',
                borderColor: printerType === v ? '#2E7D32' : '#E0E0E0',
                background:  printerType === v ? '#E8F5E9' : 'white',
                color:       printerType === v ? '#2E7D32' : '#6B7280',
                fontWeight:  printerType === v ? 600 : 400,
                fontSize: 13, cursor: 'pointer' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {printerType === 'usb' && (
        <div style={{ marginBottom: 12 }}>
          {lbl('Yazıcı')}
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={printerName}
              onChange={e => setPrinterName(e.target.value)}
              style={{ flex: 1, ...inputStyle }}>
              <option value="">Yazıcı seçin...</option>
              {printerList.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.isDefault ? ' (Varsayılan)' : ''}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void loadPrinters()}
              style={{ padding: '8px 12px', borderRadius: 8,
                border: '1px solid #E0E0E0', background: '#F9FAFB',
                cursor: 'pointer', fontSize: 12 }}>
              🔄 Yenile
            </button>
          </div>
        </div>
      )}

      {printerType === 'network' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            {lbl('IP Adresi')}
            <input value={printerIp} onChange={e => setPrinterIp(e.target.value)}
              placeholder="192.168.1.200" style={inputStyle} />
          </div>
          <div>
            {lbl('Port')}
            <input type="number" value={printerPort} onChange={e => setPrinterPort(Number(e.target.value))}
              placeholder="9100" style={inputStyle} />
          </div>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        {lbl('Kağıt Genişliği')}
        <div style={{ display: 'flex', gap: 8 }}>
          {[58, 80].map(w => (
            <button key={w} type="button"
              onClick={() => setPaperWidth(w)}
              style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1.5px solid',
                borderColor: paperWidth === w ? '#2E7D32' : '#E0E0E0',
                background:  paperWidth === w ? '#E8F5E9' : 'white',
                color:       paperWidth === w ? '#2E7D32' : '#6B7280',
                fontWeight:  paperWidth === w ? 600 : 400,
                fontSize: 13, cursor: 'pointer' }}>
              {w} mm
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void savePrinterSettings()}
          disabled={savingPrinter}
          style={{ background: '#2E7D32', color: 'white', border: 'none',
            borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600,
            cursor: savingPrinter ? 'wait' : 'pointer', opacity: savingPrinter ? 0.7 : 1 }}>
          {savingPrinter ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
        <button type="button" onClick={() => void testPrint()}
          style={{ padding: '9px 16px', borderRadius: 8,
            border: '1px solid #C8E6C9', background: '#F1F8F1',
            color: '#2E7D32', fontSize: 13, cursor: 'pointer' }}>
          🖨️ Test Yazdır
        </button>
        {printerTestResult && (
          <span style={{ fontSize: 12,
            color: printerTestResult.ok ? '#2E7D32' : '#C62828' }}>
            {printerTestResult.ok ? '✓ ' : '✗ '}{printerTestResult.msg}
          </span>
        )}
      </div>
    </div>
  )
}
