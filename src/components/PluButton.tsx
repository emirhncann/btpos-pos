import { useEffect, useRef, useState } from 'react'

interface PluButtonProps {
  name:         string
  price:        number
  code?:        string
  barcode?:     string
  showPrice:    boolean
  showCode:     boolean
  showBarcode:  boolean
  activeColor:  string
  activeSoft:   string
  baseFontSize: number
  onClick:      () => void
}

export function PluButton({
  name, price, code, barcode,
  showPrice, showCode, showBarcode,
  activeColor, activeSoft, baseFontSize,
  onClick,
}: PluButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const nameRef      = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(baseFontSize)

  useEffect(() => {
    const container = containerRef.current
    const nameEl    = nameRef.current
    if (!container || !nameEl) return

    const calculate = () => {
      const containerH = container.clientHeight
      const containerW = container.clientWidth
      if (containerH < 10 || containerW < 10) return

      const padV = 10
      let lo = 7
      let hi = baseFontSize
      let best = 7

      const fits = (fs: number): boolean => {
        const priceH = showPrice ? Math.ceil(fs * 1.35) + 4 : 0
        const codeH  = (showCode || showBarcode) ? 13 : 0
        const gap    = priceH > 0 || codeH > 0 ? 4 : 0
        const availH = containerH - priceH - codeH - gap - padV
        if (availH < fs * 1.25) return false

        nameEl.style.cssText = `
          font-size: ${fs}px;
          line-height: 1.25;
          word-break: break-word;
          overflow-wrap: break-word;
          width: ${containerW - 8}px;
          display: block;
          position: absolute;
          visibility: hidden;
        `
        nameEl.textContent = name
        const nameH = nameEl.scrollHeight
        nameEl.style.cssText = ''
        nameEl.textContent = ''
        return nameH <= availH
      }

      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (fits(mid)) { best = mid; lo = mid + 1 }
        else           { hi = mid - 1 }
      }

      setFontSize(best)
    }

    calculate()

    const ro = new ResizeObserver(calculate)
    ro.observe(container)
    return () => ro.disconnect()
  }, [name, baseFontSize, showPrice, showCode, showBarcode])

  const priceFontSize = Math.max(Math.round(fontSize * 0.95), 8)

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      style={{
        borderRadius:   8,
        padding:        '5px 4px',
        cursor:         'pointer',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            2,
        border:         '2px solid transparent',
        background:     activeSoft,
        transition:     'border-color 0.15s',
        overflow:       'hidden',
        minHeight:      0,
        minWidth:       0,
        width:          '100%',
        height:         '100%',
        boxSizing:      'border-box',
        position:       'relative',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = activeColor
        el.style.transform   = 'scale(1.02)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = 'transparent'
        el.style.transform   = 'scale(1)'
      }}
      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(0.95)' }}
      onMouseUp={e   => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
    >
      <div ref={nameRef} style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }} />

      <div style={{
        fontSize:     fontSize,
        fontWeight:   600,
        color:        '#374151',
        textAlign:    'center',
        lineHeight:   1.25,
        wordBreak:    'break-word',
        overflowWrap: 'break-word',
        overflow:     'hidden',
        width:        '100%',
        display:      'block',
        flexShrink:   0,
      }}>
        {name}
      </div>

      {(showCode || showBarcode) && fontSize >= 10 && (
        <div style={{
          fontSize:     9,
          color:        '#9ca3af',
          textAlign:    'center',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
          width:        '100%',
          flexShrink:   0,
        }}>
          {showCode    && code}
          {showBarcode && barcode}
        </div>
      )}

      {showPrice && (
        <div style={{
          fontSize:   priceFontSize,
          fontWeight: 700,
          color:      activeColor,
          flexShrink: 0,
          textAlign:  'center',
        }}>
          {price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
        </div>
      )}
    </div>
  )
}
