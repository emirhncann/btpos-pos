import { useState, useCallback, type CSSProperties } from 'react'

export type KeyboardType = 'qwerty' | 'numeric'

interface TouchKeyboardProps {
  title?:     string
  value:      string
  onChange:   (v: string) => void
  onConfirm:  (v: string) => void
  onClose:    () => void
  type?:      KeyboardType
}

export function TouchKeyboard({
  title, value, onChange, onConfirm, onClose, type = 'qwerty'
}: TouchKeyboardProps) {
  const [tab,   setTab]   = useState<'abc' | '123'>(type === 'numeric' ? '123' : 'abc')
  const [shift, setShift] = useState(false)

  const press = useCallback((key: string) => {
    if (key === '⌫')    { onChange(value.slice(0, -1)); return }
    if (key === 'SPACE') { onChange(value + ' ');        return }
    if (key === 'ABC')   { setTab('abc');                return }
    if (key === '123')   { setTab('123');                return }
    const ch = shift ? key.toUpperCase() : key
    onChange(value + ch)
    if (shift) setShift(false)
  }, [value, shift, onChange])

  const keyStyle = (extra?: CSSProperties): CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'clamp(10px,2vw,16px) 0',
    fontSize: 'clamp(14px,1.6vw,18px)', fontWeight: 400,
    borderRadius: 8, border: '0.5px solid #D1D5DB',
    background: 'white', cursor: 'pointer', userSelect: 'none',
    color: '#111827', ...extra,
  })

  const rows_abc = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['z','x','c','v','b','n','m'],
  ]

  const rows_123_1 = ['1','2','3','4','5','6','7','8','9','0']
  const rows_123_2 = ['!','@','#','$','%','&','-','+','=','/']

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.45)', display: 'flex',
      alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 16, padding: 20,
          width: 'min(560px, 96vw)', display: 'flex', flexDirection: 'column', gap: 10 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {title && <span style={{ fontSize: 13, color: '#6B7280' }}>{title}</span>}
            <div style={{ display: 'flex', gap: 4 }}>
              {(['abc','123'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6,
                    border: '0.5px solid',
                    borderColor: tab === t ? '#1565C0' : '#E5E7EB',
                    background: tab === t ? '#EFF6FF' : '#F9FAFB',
                    color: tab === t ? '#1565C0' : '#6B7280', cursor: 'pointer' }}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: '#9CA3AF', fontSize: 18, padding: 0, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '10px 14px', fontSize: 16, fontWeight: 500,
          borderRadius: 8, border: '0.5px solid #E5E7EB',
          background: '#F9FAFB', minHeight: 44, color: '#111',
          letterSpacing: 0.5, wordBreak: 'break-all' }}>
          {value || <span style={{ color: '#D1D5DB' }}>—</span>}
        </div>

        {tab === 'abc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {rows_abc.map((row, ri) => (
              <div key={ri} style={{ display: 'flex', gap: 4, justifyContent: 'center',
                padding: ri === 1 ? '0 4%' : ri === 2 ? '0 8%' : '0' }}>
                {row.map(k => (
                  <button key={k} type="button" onMouseDown={e => { e.preventDefault(); press(k) }}
                    style={{ ...keyStyle(), flex: 1, maxWidth: 52 }}>
                    {shift ? k.toUpperCase() : k}
                  </button>
                ))}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" onMouseDown={e => { e.preventDefault(); setShift(s => !s) }}
                style={{ ...keyStyle({ flex: 1.5, background: shift ? '#EFF6FF' : 'white',
                  color: shift ? '#1565C0' : '#374151' }), fontSize: 16 }}>
                ⇧
              </button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('123') }}
                style={{ ...keyStyle({ flex: 1.5, color: '#6B7280', fontSize: 12 }) }}>
                123
              </button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('@') }}
                style={{ ...keyStyle({ flex: 1, color: '#E65100', borderColor: '#FED7AA', background: '#FFF7ED' }) }}>
                @
              </button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('SPACE') }}
                style={{ ...keyStyle({ flex: 4 }), fontSize: 12, color: '#9CA3AF' }}>
                boşluk
              </button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('.') }}
                style={keyStyle({ flex: 1 })}>.</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('_') }}
                style={keyStyle({ flex: 1 })}>_</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('⌫') }}
                style={{ ...keyStyle({ flex: 1.5, color: '#EF4444', borderColor: '#FECACA', background: '#FFF5F5' }), fontSize: 16 }}>
                ⌫
              </button>
            </div>
          </div>
        )}

        {tab === '123' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10,1fr)', gap: 4 }}>
              {rows_123_1.map(k => (
                <button key={k} type="button" onMouseDown={e => { e.preventDefault(); press(k) }}
                  style={{ ...keyStyle(), background: '#F9FAFB' }}>{k}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10,1fr)', gap: 4 }}>
              {rows_123_2.map(k => (
                <button key={k} type="button" onMouseDown={e => { e.preventDefault(); press(k) }}
                  style={keyStyle()}>{k}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('ABC') }}
                style={{ ...keyStyle({ flex: 1.5, color: '#6B7280', fontSize: 12 }) }}>ABC</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('(') }}
                style={keyStyle({ flex: 1 })}>(</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press(')') }}
                style={keyStyle({ flex: 1 })}>)</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('SPACE') }}
                style={{ ...keyStyle({ flex: 3 }), fontSize: 12, color: '#9CA3AF' }}>boşluk</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press(',') }}
                style={keyStyle({ flex: 1 })}>,</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('.') }}
                style={keyStyle({ flex: 1 })}>.</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); press('⌫') }}
                style={{ ...keyStyle({ flex: 1.5, color: '#EF4444', borderColor: '#FECACA', background: '#FFF5F5' }), fontSize: 16 }}>⌫</button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={() => onChange('')}
            style={{ padding: '12px 0', fontSize: 14, borderRadius: 10,
              border: '0.5px solid #E5E7EB', background: '#F9FAFB',
              cursor: 'pointer', color: '#374151' }}>
            Temizle
          </button>
          <button type="button" onClick={() => onConfirm(value)}
            style={{ padding: '12px 0', fontSize: 14, fontWeight: 500,
              borderRadius: 10, border: 'none',
              background: '#1565C0', color: 'white', cursor: 'pointer' }}>
            Onayla
          </button>
        </div>

      </div>
    </div>
  )
}
