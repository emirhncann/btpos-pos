import { useEffect, useRef, useState } from 'react'
import {
  deleteBackward,
  insertIntoField,
  isEditableField,
  moveCaret,
  readScreenKeyboardMode,
  type ScreenKeyboardMode,
} from '../lib/keyboardInput'

type Layout = 'text' | 'number' | 'decimal' | 'phone' | 'email' | 'symbol'
type Caps = 'off' | 'caps'

const LOWER_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'ı', 'o', 'p', 'ğ', 'ü'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ş', 'i'],
  ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'ö', 'ç', 'back'],
]
const UPPER_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'Ğ', 'Ü'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ş', 'İ'],
  ['shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Ö', 'Ç', 'back'],
]

function fieldLayout(el: HTMLElement | null): Layout {
  const kb = el?.getAttribute('data-kb')
  if (kb === 'number' || kb === 'decimal' || kb === 'phone' || kb === 'email') return kb
  if (el instanceof HTMLInputElement && el.type === 'email') return 'email'
  if (el instanceof HTMLInputElement && (el.type === 'tel' || kb === 'phone')) return 'phone'
  if (el instanceof HTMLInputElement && el.type === 'number') return 'number'
  return 'text'
}

function startsLower(el: HTMLElement): boolean {
  if (el.getAttribute('data-kb') === 'email') return true
  return el instanceof HTMLInputElement && (el.type === 'email' || el.type === 'password')
}

function skipKeyboard(el: HTMLElement | null): boolean {
  if (!el) return true
  if (el.getAttribute('data-pos-barcode') != null) return true
  if (el.getAttribute('data-kb') === 'none') return true
  return false
}

function fieldLabel(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label')?.trim()
  if (aria) return aria.replace(/\*$/, '')
  const id = el.id
  if (id) {
    const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`)
    const text = lab?.textContent?.trim()
    if (text) return text.replace(/\*$/, '')
  }
  const parent = el.closest('label')
  if (parent) {
    const clone = parent.cloneNode(true) as HTMLElement
    clone.querySelectorAll('input, textarea, select, button').forEach(n => n.remove())
    const text = clone.textContent?.replace(/\s+/g, ' ').trim()
    if (text) return text.replace(/\*$/, '')
  }
  return el.getAttribute('placeholder')?.trim() || 'Alan'
}

function reveal(el: HTMLElement) {
  requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}

export function ScreenKeyboardHost() {
  const [mode, setMode] = useState<ScreenKeyboardMode>('auto')
  const [open, setOpen] = useState(false)
  const [layout, setLayout] = useState<Layout>('text')
  const [shift, setShift] = useState<Caps>('caps')
  const [symbols, setSymbols] = useState(false)
  const [pressed, setPressed] = useState<string | null>(null)
  const [preview, setPreview] = useState({ label: '', before: '', after: '' })
  const targetRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const suppressRef = useRef<WeakSet<HTMLElement>>(new WeakSet())
  const armedRef = useRef<EventTarget | null>(null)
  const openRef = useRef(false)
  const repeatRef = useRef<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => { openRef.current = open }, [open])

  useEffect(() => {
    const sync = () => setMode(readScreenKeyboardMode())
    sync()
    window.addEventListener('btpos-keyboard-mode', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('btpos-keyboard-mode', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (mode === 'off' || !open) {
      root.style.setProperty('--osk-h', '0px')
      return
    }
    const el = panelRef.current
    if (!el) return
    const write = () => root.style.setProperty('--osk-h', `${el.offsetHeight}px`)
    const ro = new ResizeObserver(write)
    ro.observe(el)
    write()
    return () => {
      ro.disconnect()
      root.style.setProperty('--osk-h', '0px')
    }
  }, [mode, open, layout, symbols, shift])

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof HTMLElement && (t.closest('input, textarea') || t.matches('input, textarea'))) {
        armedRef.current = t.closest('input, textarea')
        const field = armedRef.current as HTMLElement
        suppressRef.current.delete(field)
      }
    }
    const onFocus = (e: FocusEvent) => {
      const el = e.target
      if (!isEditableField(el) || skipKeyboard(el)) {
        setOpen(false)
        return
      }
      if (mode === 'off') { setOpen(false); return }
      const touched = armedRef.current === el
      if (mode === 'always' || (mode === 'auto' && touched && !suppressRef.current.has(el))) {
        targetRef.current = el
        setLayout(fieldLayout(el))
        setSymbols(false)
        if (!openRef.current) setShift(startsLower(el) ? 'off' : 'caps')
        setOpen(true)
        reveal(el)
      } else {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R' || e.key === 'w' || e.key === 'W'))) {
        e.preventDefault()
      }
      if (mode !== 'auto') return
      if (e.key.length !== 1 && e.key !== 'Backspace') return
      const el = document.activeElement
      if (!isEditableField(el)) return
      suppressRef.current.add(el)
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('focusin', onFocus)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('focusin', onFocus)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [mode])

  function field(): HTMLInputElement | HTMLTextAreaElement | null {
    const el = targetRef.current
    if (el && document.contains(el)) return el
    const active = document.activeElement
    return isEditableField(active) ? active : null
  }

  useEffect(() => {
    if (!open) return
    const sync = () => {
      const el = field()
      if (!el) return
      const pass = el instanceof HTMLInputElement && el.type === 'password'
      const raw = pass ? '•'.repeat(el.value.length) : el.value.replace(/\n/g, ' ')
      const caret = Math.min(el.selectionStart ?? raw.length, raw.length)
      const before = raw.slice(0, caret)
      setPreview({
        label: fieldLabel(el),
        before: before.length > 60 ? before.slice(-60) : before,
        after: raw.slice(caret, caret + 24),
      })
    }
    sync()
    document.addEventListener('selectionchange', sync)
    document.addEventListener('focusin', sync)
    document.addEventListener('input', sync, true)
    return () => {
      document.removeEventListener('selectionchange', sync)
      document.removeEventListener('focusin', sync)
      document.removeEventListener('input', sync, true)
    }
  }, [open, layout, shift, symbols])

  useEffect(() => {
    if (!open) return
    const el = field()
    if (el) reveal(el)
  }, [open, layout, symbols])

  function typeChar(ch: string) {
    const el = field()
    if (!el) return
    el.focus()
    if (layout === 'decimal') {
      if (ch === ',' && el.value.includes(',')) return
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      const next = el.value.slice(0, start) + ch + el.value.slice(end)
      const dec = next.split(',')[1]
      if (dec && dec.length > 2) return
    }
    insertIntoField(el, ch)
  }

  function pressKey(key: string) {
    setPressed(key)
    window.setTimeout(() => setPressed(cur => cur === key ? null : cur), 90)
    const el = field()
    if (key === 'done') {
      el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      setOpen(false)
      return
    }
    if (key === 'close') { setOpen(false); return }
    if (!el) return
    if (key === 'back') { deleteBackward(el); return }
    if (key === 'left') { moveCaret(el, -1); return }
    if (key === 'right') { moveCaret(el, 1); return }
    if (key === 'space') { typeChar(' '); return }
    if (key === 'clear') {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, '')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.setSelectionRange(0, 0)
      return
    }
    if (key === '123') { setSymbols(true); return }
    if (key === 'abc') { setSymbols(false); return }
    if (key === 'shift') {
      setShift(cur => cur === 'caps' ? 'off' : 'caps')
      return
    }
    typeChar(key)
  }

  function holdBack(down: boolean) {
    if (repeatRef.current != null) {
      window.clearTimeout(repeatRef.current)
      repeatRef.current = null
    }
    if (!down) return
    const tick = () => {
      const el = field()
      if (el) deleteBackward(el)
      repeatRef.current = window.setTimeout(tick, 60)
    }
    repeatRef.current = window.setTimeout(tick, 400)
  }

  if (mode === 'off' || !open) return null

  const showText = !symbols && (layout === 'text' || layout === 'email')
  const rows = shift === 'caps' ? UPPER_ROWS : LOWER_ROWS
  const symbolRow = ['1','2','3','4','5','6','7','8','9','0','-','/']
  const symbolRow2 = [':',';','(',')','&','@','"','\'','!','?','+','%']

  return (
    <div
      ref={panelRef}
      data-pos-keyboard
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10050,
        background: 'var(--pos-surface)',
        borderTop: '1px solid var(--pos-border)',
        padding: 8,
        display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      <div
        onPointerDown={e => e.preventDefault()}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          minHeight: 40, padding: '4px 8px', borderRadius: 8,
          background: 'var(--pos-surface-alt)', color: 'var(--pos-text)',
        }}
      >
        <span style={{ fontWeight: 700, flexShrink: 0 }}>{preview.label}:</span>
        <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textAlign: 'right', fontSize: 16 }}>
          {preview.before}
          <span style={{ borderLeft: '2px solid var(--pos-primary)', margin: '0 1px' }} />
          {preview.after}
        </span>
        <button
          type="button"
          aria-label="Klavyeyi kapat"
          onPointerDown={e => { e.preventDefault(); e.stopPropagation(); pressKey('close') }}
          style={{ background: 'none', border: 'none', color: 'var(--pos-text)', fontSize: 18, cursor: 'pointer', minHeight: 32, minWidth: 32 }}
        >✕</button>
      </div>
      {showText && rows.map((row, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`, gap: 6 }}>
          {row.map(key => (
            <Key
              key={key}
              label={key === 'shift' ? (shift === 'caps' ? 'ABC' : 'abc') : key === 'back' ? '⌫' : key}
              special={(key === 'shift' && shift !== 'caps') || key === 'back'}
              primary={key === 'shift' && shift === 'caps'}
              pressed={pressed === key}
              onPress={() => pressKey(key)}
              onHold={key === 'back' ? holdBack : undefined}
            />
          ))}
        </div>
      ))}
      {showText && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 3fr 1fr 1fr 1.4fr', gap: 6 }}>
          <Key label="123" special pressed={pressed === '123'} onPress={() => pressKey('123')} />
          <Key label="," pressed={pressed === ','} onPress={() => pressKey(',')} />
          <Key label="boşluk" pressed={pressed === 'space'} onPress={() => pressKey('space')} />
          <Key label="." pressed={pressed === '.'} onPress={() => pressKey('.')} />
          <Key label="←" special pressed={pressed === 'left'} onPress={() => pressKey('left')} />
          <Key label="→" special pressed={pressed === 'right'} onPress={() => pressKey('right')} />
        </div>
      )}
      {showText && layout === 'email' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {['@', '.', '.com', '_', '-'].map(k => (
            <Key key={k} label={k} pressed={pressed === k} onPress={() => pressKey(k)} />
          ))}
        </div>
      )}
      {(symbols || layout === 'number' || layout === 'decimal' || layout === 'phone') && !showText && (
        <NumberPad layout={symbols ? 'symbol' : layout} symbolRow={symbolRow} symbolRow2={symbolRow2} pressed={pressed} onPress={pressKey} onHold={holdBack} />
      )}
      <Key label="Tamam" primary pressed={pressed === 'done'} onPress={() => pressKey('done')} />
    </div>
  )
}

function Key({
  label, onPress, special, primary, pressed, onHold,
}: {
  label: string
  onPress: () => void
  special?: boolean
  primary?: boolean
  pressed?: boolean
  onHold?: (down: boolean) => void
}) {
  return (
    <button
      type="button"
      onPointerDown={e => {
        e.preventDefault()
        onPress()
        onHold?.(true)
      }}
      onPointerUp={() => onHold?.(false)}
      onPointerLeave={() => onHold?.(false)}
      style={{
        position: 'relative',
        minHeight: 64,
        borderRadius: 10,
        border: '1px solid var(--pos-key-border)',
        background: primary
          ? 'var(--pos-primary)'
          : pressed
            ? 'var(--pos-key-active-bg, var(--pos-primary))'
            : special
              ? 'var(--pos-surface-alt)'
              : 'var(--pos-key-bg)',
        color: primary ? 'var(--pos-primary-text)' : 'var(--pos-key-text)',
        fontSize: 18,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function NumberPad({
  layout, symbolRow, symbolRow2, pressed, onPress, onHold,
}: {
  layout: Layout | 'symbol'
  symbolRow: string[]
  symbolRow2: string[]
  pressed: string | null
  onPress: (key: string) => void
  onHold: (down: boolean) => void
}) {
  if (layout === 'symbol') {
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 6 }}>
          {symbolRow.map(k => <Key key={k} label={k} pressed={pressed === k} onPress={() => onPress(k)} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 6 }}>
          {symbolRow2.map(k => <Key key={k} label={k} pressed={pressed === k} onPress={() => onPress(k)} />)}
        </div>
        <Key label="ABC" special pressed={pressed === 'abc'} onPress={() => onPress('abc')} />
      </>
    )
  }
  const rows = [['7','8','9'],['4','5','6'],['1','2','3']]
  const last = layout === 'phone' ? ['+','0','space'] : layout === 'decimal' ? [',','0','back'] : ['00','0','back']
  return (
    <>
      {rows.map(row => (
        <div key={row.join()} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {row.map(k => <Key key={k} label={k} pressed={pressed === k} onPress={() => onPress(k)} />)}
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {last.map(k => (
          <Key
            key={k}
            label={k === 'back' ? '⌫' : k === 'space' ? 'boşluk' : k}
            special={k === 'back'}
            pressed={pressed === k}
            onPress={() => onPress(k === 'back' ? 'back' : k === 'space' ? 'space' : k)}
            onHold={k === 'back' ? onHold : undefined}
          />
        ))}
      </div>
      {layout !== 'decimal' && <Key label="Temizle" special pressed={pressed === 'clear'} onPress={() => onPress('clear')} />}
    </>
  )
}
