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

    const measure = () => {
      let lo = 7
      let hi = baseFontSize
      let best = 7

      const fits = (fs: number): boolean => {
        nameEl.style.fontSize = fs + 'px'
        const priceH = showPrice ? Math.round(fs * 1.3 + 4) : 0
        const codeH  = (showCode || showBarcode) ? 12 : 0
        const padV   = 10
        const availH = container.clientHeight - priceH - codeH - padV
        const nameH  = nameEl.scrollHeight
        return nameH <= availH
      }

      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (fits(mid)) {
          best = mid
          lo   = mid + 1
        } else {
          hi   = mid - 1
        }
      }

      nameEl.style.fontSize = ''
      setFontSize(best)
    }

    measure()

    const ro = new ResizeObserver(measure)
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
        border:         '2px solid transparent',
        background:     activeSoft,
        transition:     'border-color 0.15s',
        overflow:       'hidden',
        minHeight:      0,
        minWidth:       0,
        width:          '100%',
        height:         '100%',
        boxSizing:      'border-box',
        gap:            2,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = activeColor }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent' }}
    >
      <div
        ref={nameRef}
        style={{
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
        }}
      >
        {name}
      </div>

      {(showCode || showBarcode) && (
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
