import { useState, useEffect, useRef } from 'react'

export default function ScaleSettings() {
  const [ports, setPorts] = useState<string[]>([])
  const [portPath, setPortPath] = useState('')
  const [baudRate, setBaudRate] = useState(9600)
  const [enabled, setEnabled] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testValue, setTestValue] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const testCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    void window.electron.scale.getSettings().then(s => {
      if (!s) return
      setPortPath(s.port_path ?? '')
      setBaudRate(s.baud_rate ?? 9600)
      setEnabled(!!s.enabled)
    })
    void window.electron.scale.listPorts().then(setPorts).catch(() => setPorts([]))

    return () => {
      testCleanupRef.current?.()
      testCleanupRef.current = null
    }
  }, [])

  async function handleTest() {
    testCleanupRef.current?.()
    setTesting(true)
    setTestValue(null)
    let received = false
    let sawRaw = false

    const result = await window.electron.scale.connect({ portPath, baudRate })
    if (!result.success) {
      setTestValue(`Bağlantı hatası: ${result.error ?? 'bilinmiyor'}`)
      setTesting(false)
      return
    }

    const cleanupData = window.electron.scale.onData(r => {
      if (received) return
      received = true
      setTestValue(`${r.stable ? '✓' : '~'} ${(r.weight / 1000).toFixed(3)} kg (${r.raw})`)
      cleanupAll()
      setTesting(false)
    })

    const cleanupRaw = window.electron.scale.onRaw(raw => {
      sawRaw = true
      if (received) return
      // Parse henüz olmadıysa ham veriyi göster — bağlantı çalışıyor demektir
      setTestValue(`Ham veri: ${raw}`)
    })

    function cleanupAll() {
      cleanupData()
      cleanupRaw()
      testCleanupRef.current = null
    }

    testCleanupRef.current = cleanupAll

    setTimeout(() => {
      if (received) return
      cleanupAll()
      if (sawRaw) {
        setTestValue('Ham veri geldi ama format tanınmadı — konsoldaki [scale] satırına bakın')
      } else {
        setTestValue(
          'Veri alınamadı — Serial Monitörü kapatıp tekrar deneyin (COM port aynı anda tek programda açık olabilir)',
        )
      }
      setTesting(false)
    }, 8000)
  }

  async function handleSave() {
    await window.electron.scale.saveSettings({ portPath, baudRate, enabled })
    if (enabled) {
      const r = await window.electron.scale.connect({ portPath, baudRate })
      if (!r.success) {
        setTestValue(`Bağlantı hatası: ${r.error ?? 'bilinmiyor'}`)
        return
      }
    } else {
      await window.electron.scale.disconnect()
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ padding: 16, border: '1px solid #E5E7EB', borderRadius: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
        Terazi Ayarları (CAS RS232)
      </div>

      <div style={{
        fontSize: 11, color: '#92400E', background: '#FFFBEB',
        border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 10px', marginBottom: 14,
      }}>
        Test ederken Serial Monitör / başka seri programı kapatın. Windows’ta COM port
        aynı anda yalnızca bir uygulama tarafından açılabilir.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <label style={{ fontSize: 13, color: '#374151' }}>Terazi Aktif</label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>COM Port</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={portPath}
            onChange={e => setPortPath(e.target.value)}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: 8,
              border: '1px solid #E5E7EB', fontSize: 13,
            }}
          >
            <option value="">Port seçin</option>
            {ports.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void window.electron.scale.listPorts().then(setPorts)}
            style={{
              padding: '8px 12px', borderRadius: 8, border: '1px solid #E5E7EB',
              background: '#F9FAFB', fontSize: 12, cursor: 'pointer',
            }}
          >
            Yenile
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Baud Rate</div>
        <select
          value={baudRate}
          onChange={e => setBaudRate(Number(e.target.value))}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 8,
            border: '1px solid #E5E7EB', fontSize: 13,
          }}
        >
          {[1200, 2400, 4800, 9600, 19200, 38400].map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {testValue && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, marginBottom: 10,
          background: testValue.startsWith('✓') || testValue.startsWith('~') || testValue.startsWith('Ham')
            ? '#E8F5E9'
            : '#FEF2F2',
          color: testValue.startsWith('✓') || testValue.startsWith('~') || testValue.startsWith('Ham')
            ? '#2E7D32'
            : '#DC2626',
          fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {testValue}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={!portPath || testing}
          style={{
            flex: 1, padding: '10px', borderRadius: 8,
            border: '1px solid #E5E7EB', background: '#F9FAFB',
            fontSize: 13, cursor: 'pointer',
            opacity: (!portPath || testing) ? 0.5 : 1,
          }}
        >
          {testing ? 'Test ediliyor...' : 'Test Et'}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!portPath && enabled}
          style={{
            flex: 2, padding: '10px', borderRadius: 8,
            border: 'none', background: '#111827', color: 'white',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            opacity: (!portPath && enabled) ? 0.5 : 1,
          }}
        >
          {saved ? 'Kaydedildi' : 'Kaydet'}
        </button>
      </div>
    </div>
  )
}
