import { Receipt, align, bold, text, feed, init, cut } from './escpos'
import type { RenderData, TemplateBlock } from '../src/lib/templateEngine'

export type { TemplateBlock, RenderData }

export function resolveVar(key: string, data: RenderData): string {
  if (!key) return ''
  const [table, col] = key.split('.')
  const val = data[table]?.[col]
  if (val === null || val === undefined) return ''
  if (typeof val === 'number') {
    return val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return String(val)
}

export function renderThermal(
  schema: TemplateBlock[],
  data: RenderData,
  widthMm: number,
): Buffer {
  const charWidth = widthMm === 58 ? 32 : 42
  const r = new Receipt()
  r.init()

  for (const block of schema) {
    switch (block.type) {
      case 'text': {
        if (block.bold) r.add(bold(true))
        r.add(align(block.align ?? 'left'))
        r.add(text(block.value ?? ''))
        if (block.bold) r.add(bold(false))
        break
      }
      case 'variable': {
        const val     = resolveVar(block.key ?? '', data)
        const label   = block.label ? block.label + ': ' : ''
        const content = label + val
        if (block.bold) r.add(bold(true))
        r.add(align(block.align ?? 'left'))
        r.add(text(content))
        if (block.bold) r.add(bold(false))
        break
      }
      case 'divider': {
        r.add(align('left'))
        r.add(text((block.char ?? '=').repeat(charWidth)))
        break
      }
      case 'space': {
        r.add(feed(1))
        break
      }
      case 'logo': {
        r.add(align('center'))
        r.add(bold(true))
        r.add(text(block.value ?? 'BTPOS'))
        r.add(bold(false))
        break
      }
      case 'barcode': {
        const val = resolveVar(block.key ?? '', data)
        if (val) {
          const payload = Buffer.from(val, 'ascii')
          r.add(align('center'))
          r.add(Buffer.from([
            0x1D, 0x48, 0x02,
            0x1D, 0x68, 0x50,
            0x1D, 0x77, 0x02,
            0x1D, 0x6B, 0x49,
            payload.length,
            ...payload,
          ]))
        }
        break
      }
      default:
        break
    }
  }

  r.add(feed(4))
  r.add(cut())
  return r.build()
}

export function renderHtml(
  schema: TemplateBlock[],
  data: RenderData,
  widthMm: number,
  heightMm: number | null,
): string {
  const bodyLines: string[] = []

  for (const block of schema) {
    const alignCss = `text-align:${block.align ?? 'left'}`
    const boldCss  = block.bold ? 'font-weight:700' : ''

    switch (block.type) {
      case 'text':
        bodyLines.push(`<div style="${alignCss};${boldCss}">${escapeHtml(block.value ?? '')}</div>`)
        break
      case 'variable': {
        const val   = escapeHtml(resolveVar(block.key ?? '', data))
        const label = block.label
          ? `<span style="color:#6B7280">${escapeHtml(block.label)}: </span>`
          : ''
        bodyLines.push(`<div style="${alignCss};${boldCss}">${label}${val}</div>`)
        break
      }
      case 'divider':
        bodyLines.push(`<div style="font-family:monospace;color:#9CA3AF">${escapeHtml((block.char ?? '=').repeat(50))}</div>`)
        break
      case 'space':
        bodyLines.push('<div style="height:8px"></div>')
        break
      case 'logo':
        bodyLines.push(`<div style="text-align:center;font-size:16px;font-weight:700;letter-spacing:2px">${escapeHtml(block.value ?? 'BTPOS')}</div>`)
        break
      case 'barcode': {
        const val = escapeHtml(resolveVar(block.key ?? '', data))
        bodyLines.push(`<div style="text-align:center;font-family:monospace;font-size:10px">${val}</div>`)
        break
      }
      default:
        break
    }
  }

  const pageH = heightMm ? `${heightMm}mm` : 'auto'
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { margin: 4mm; size: ${widthMm}mm ${pageH}; }
  body { font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.5; margin: 0; padding: 0; }
  div { margin-bottom: 1px; }
</style></head><body>${bodyLines.join('\n')}</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
