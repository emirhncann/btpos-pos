import path from 'path'
import fs from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { app, BrowserWindow } from 'electron'
import { generate } from '@pdfme/generator'
import type { Template } from '@pdfme/common'
import {
  text as textPlugin,
  multiVariableText,
  image,
  table as tablePlugin,
  line as linePlugin,
  rectangle,
  barcodes,
} from '@pdfme/schemas'
import { Jimp, intToRGBA } from 'jimp'
import { init, cut, feed, align, bold, text } from './escpos'
import {
  buildPdfmeInputs,
  resolveTemplateVariables,
  templateNeedsPdfPipeline,
  type RenderData,
} from '../src/lib/templateEngine'

const THERMAL_DPI = 203
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg);base64,/i

/** pdfme generate() için plugin kaydı — şablondaki type ile eşleşmeli */
const PDFME_PLUGINS = {
  text: textPlugin,
  multiVariableText,
  image,
  table: tablePlugin,
  line: linePlugin,
  rectangle,
  qrcode: barcodes.qrcode,
}

/** Termal spacer vb. — PDF üretiminde yok; ESC/POS tarafında işlenir */
const SKIP_IN_PDF_GENERATE = new Set(['spacer'])

type ProductListColumn = {
  key: string
  label: string
  widthPct?: number
  visible?: boolean
  align?: 'left' | 'center' | 'right'
}

const TABLE_BOX_DIM = { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 }
const TABLE_PADDING = { top: 2, right: 2, bottom: 2, left: 2 }

function defaultTableCellStyles(fontSize = 8) {
  return {
    fontName: undefined,
    alignment: 'left' as const,
    verticalAlignment: 'middle' as const,
    fontSize,
    lineHeight: 1,
    characterSpacing: 0,
    fontColor: '#000000',
    backgroundColor: '',
    borderColor: '#888888',
    borderWidth: TABLE_BOX_DIM,
    padding: TABLE_PADDING,
  }
}

/** product-list → table (pdfme table eklentisi zorunlu stilleri) */
function adaptProductListSchemas(t: Template): Template {
  t.schemas = t.schemas.map(page =>
    page.map(field => {
      if (String(field.type) !== 'product-list') return field
      const f = field as typeof field & {
        columns?: ProductListColumn[]
        showHead?: boolean
        fontSize?: number
      }
      const visible = (f.columns ?? []).filter(c => c.visible !== false)
      const fontSize = f.fontSize ?? 8
      const cell = defaultTableCellStyles(fontSize)

      const columnAlignment: Record<number, 'left' | 'center' | 'right'> = {}
      visible.forEach((col, i) => {
        if (col.align) columnAlignment[i] = col.align
      })

      return {
        ...field,
        type: 'table',
        head: visible.map(c => c.label),
        headWidthPercentages: visible.map(c => c.widthPct ?? Math.floor(100 / Math.max(visible.length, 1))),
        showHead: f.showHead ?? true,
        repeatHead: false,
        tableStyles: {
          borderColor: '#000000',
          borderWidth: 0.3,
        },
        headStyles: {
          ...cell,
          backgroundColor: '',
          borderColor: '',
          borderWidth: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        bodyStyles: {
          ...cell,
          alternateBackgroundColor: '',
        },
        columnStyles: {
          alignment: columnAlignment,
        },
      }
    }),
  ) as Template['schemas']
  return t
}

function prepareTemplateForGenerate(templateJson: unknown): Template {
  const t = JSON.parse(JSON.stringify(templateJson)) as Template
  t.schemas = t.schemas.map(page =>
    page.filter(f => !SKIP_IN_PDF_GENERATE.has(String(f.type))),
  ) as Template['schemas']
  return adaptProductListSchemas(t)
}

function getFontData(): Buffer | null {
  const candidates = [
    path.join(process.resourcesPath, 'fonts', 'Roboto-Regular.ttf'),
    path.join(app.getAppPath(), 'resources', 'fonts', 'Roboto-Regular.ttf'),
    path.join(app.getAppPath(), 'electron', 'fonts', 'Roboto-Regular.ttf'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p)
  }
  console.warn('[pdfme] Font bulunamadı, sistem fontu kullanılacak')
  return null
}

function getPdfJsDir(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'pdfjs'),
    path.join(app.getAppPath(), 'resources', 'pdfjs'),
    path.join(app.getAppPath(), 'node_modules', 'pdfjs-dist', 'build'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'pdf.min.js'))) return p
  }
  return null
}

function resolveContent(content: string, data: RenderData): string {
  return resolveTemplateVariables(content, data)
}

export function isPdfmeTemplate(templateJson: unknown): boolean {
  const t = templateJson as { schemas?: unknown; basePdf?: unknown }
  if (!t.schemas) return false
  const bp = t.basePdf
  if (typeof bp === 'string') return bp.length > 0
  if (bp && typeof bp === 'object') return true
  return false
}

/** Termal kağıt genişliği (mm) → yazıcı dot genişliği */
export function thermalPaperWidthPx(paperWidthMm: number): number {
  const mm = Number(paperWidthMm)
  if (!Number.isFinite(mm) || mm <= 0) return Math.round((80 / 25.4) * THERMAL_DPI)
  return Math.round((mm / 25.4) * THERMAL_DPI)
}

interface PdfmeField {
  name: string
  type: string
  content?: string
  position?: { x: number; y: number }
  width?: number
  height?: number
  fontSize?: number
  alignment?: 'left' | 'center' | 'right'
  fontStyle?: string
  borderWidth?: { top: number; right: number; bottom: number; left: number }
}

const TEXT_FIELD_TYPES = new Set(['text', 'multiVariableText'])

function fontSizeCmd(fontSize: number): Buffer {
  if (fontSize >= 24) return Buffer.from([0x1D, 0x21, 0x11])
  if (fontSize >= 18) return Buffer.from([0x1D, 0x21, 0x10])
  if (fontSize >= 16) return Buffer.from([0x1D, 0x21, 0x01])
  return Buffer.from([0x1D, 0x21, 0x00])
}

function renderSingleField(
  field: PdfmeField,
  data: RenderData,
  charWidth: number,
): Buffer[] {
  if (!TEXT_FIELD_TYPES.has(field.type)) return []

  const content = resolveContent(field.content ?? '', data)
  if (!content.trim()) return []

  const bufs: Buffer[] = []
  const al = field.alignment === 'center' ? 'center'
    : field.alignment === 'right' ? 'right' : 'left'

  bufs.push(align(al))
  bufs.push(fontSizeCmd(field.fontSize ?? 12))

  const isBold = field.fontStyle === 'bold' || (field.fontSize ?? 0) >= 16
  if (isBold) bufs.push(bold(true))

  bufs.push(text(content))

  if (isBold) bufs.push(bold(false))
  if ((field.fontSize ?? 12) >= 16) bufs.push(fontSizeCmd(12))

  return bufs
}

function renderMultiField(
  fields: PdfmeField[],
  data: RenderData,
  charWidth: number,
  paperWidthMm: number,
): Buffer[] {
  const sorted = [...fields].sort(
    (a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0),
  )

  const line = Array<string>(charWidth).fill(' ')

  for (const f of sorted) {
    if (!TEXT_FIELD_TYPES.has(f.type)) continue

    const content = resolveContent(f.content ?? '', data)
    if (!content.trim()) continue

    const xRatio = (f.position?.x ?? 0) / paperWidthMm
    let charPos = Math.round(xRatio * charWidth)

    if (f.alignment === 'right') {
      const fieldWidthRatio = (f.width ?? 20) / paperWidthMm
      const fieldEndChar = Math.round((xRatio + fieldWidthRatio) * charWidth)
      charPos = Math.max(0, fieldEndChar - content.length)
    }

    if (f.alignment === 'center') {
      const fieldWidthRatio = (f.width ?? 20) / paperWidthMm
      const fieldStartChar = charPos
      const fieldWidthChar = Math.round(fieldWidthRatio * charWidth)
      charPos = fieldStartChar + Math.floor((fieldWidthChar - content.length) / 2)
    }

    charPos = Math.max(0, charPos)

    for (let i = 0; i < content.length; i++) {
      const pos = charPos + i
      if (pos < charWidth) line[pos] = content[i]
    }
  }

  const hasBold = fields.some(
    f => f.fontStyle === 'bold' || (f.fontSize ?? 0) >= 16,
  )
  const maxFontSize = Math.max(...fields.map(f => f.fontSize ?? 12))

  const bufs: Buffer[] = []
  bufs.push(align('left'))
  bufs.push(fontSizeCmd(maxFontSize))
  if (hasBold) bufs.push(bold(true))
  bufs.push(text(line.join('')))
  if (hasBold) bufs.push(bold(false))
  if (maxFontSize >= 16) bufs.push(fontSizeCmd(12))

  return bufs
}

/** pdfme JSON → ESC/POS metin (görsel yok; hızlı yol) */
export function pdfmeToEscPos(
  templateJson: unknown,
  data: RenderData,
  paperW: number,
): Buffer {
  const template = templateJson as {
    schemas: PdfmeField[][]
    basePdf: { width?: number } | string
  }

  if (!template.schemas?.[0]) {
    throw new Error('Geçersiz şablon — schemas[0] yok')
  }

  const charWidth = paperW <= 58 ? 32 : 42
  const paperWidthMm = typeof template.basePdf === 'object' && template.basePdf?.width
    ? template.basePdf.width
    : paperW
  const fields = template.schemas[0]

  const sorted = [...fields].sort(
    (a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0),
  )

  const Y_TOLERANCE = 3
  const rows: PdfmeField[][] = []

  for (const field of sorted) {
    const fy = field.position?.y ?? 0

    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1]
      const lastRowY = lastRow[0].position?.y ?? 0
      if (Math.abs(fy - lastRowY) <= Y_TOLERANCE) {
        lastRow.push(field)
        continue
      }
    }

    rows.push([field])
  }

  const bufs: Buffer[] = [init()]
  const MM_PER_LINE = 4
  let currentMm = 0

  for (const row of rows) {
    const rowY = row[0].position?.y ?? 0
    const gapMm = rowY - currentMm

    if (gapMm > MM_PER_LINE * 1.5) {
      const extraLines = Math.floor(gapMm / MM_PER_LINE) - 1
      if (extraLines > 0) bufs.push(feed(Math.min(extraLines, 5)))
    }

    if (row.length === 1 && row[0].type === 'spacer') {
      const h = row[0].height ?? MM_PER_LINE
      const lines = Math.max(1, Math.round(h / MM_PER_LINE))
      bufs.push(feed(lines))
      currentMm = rowY + h
      continue
    }

    if (
      row.length === 1 &&
      (
        row[0].type === 'line' ||
        ((row[0].borderWidth?.top ?? 0) > 0 && !resolveContent(row[0].content ?? '', data).trim())
      )
    ) {
      bufs.push(align('left'))
      bufs.push(text('─'.repeat(charWidth)))
      currentMm = rowY + (row[0].height ?? MM_PER_LINE)
      continue
    }

    if (row.some(f => f.type === 'image')) continue

    const rowBufs = row.length === 1
      ? renderSingleField(row[0], data, charWidth)
      : renderMultiField(row, data, charWidth, paperWidthMm)

    if (rowBufs.length > 0) bufs.push(...rowBufs)

    const rowHeight = Math.max(...row.map(f => f.height ?? MM_PER_LINE))
    currentMm = rowY + rowHeight
  }

  bufs.push(fontSizeCmd(12))
  bufs.push(bold(false))
  bufs.push(feed(4))
  bufs.push(cut())

  return Buffer.concat(bufs)
}

export async function renderPdfme(
  templateJson: unknown,
  data: RenderData,
): Promise<Buffer> {
  if (!isPdfmeTemplate(templateJson)) {
    throw new Error('Geçersiz pdfme şablonu — schemas veya basePdf eksik')
  }

  const template = prepareTemplateForGenerate(templateJson)
  const schema = template.schemas[0] ?? []
  const inputs: Record<string, unknown>[] = [
    buildPdfmeInputs(data, schema as { name: string; content?: string; type?: string }[]),
  ]

  const fontData = getFontData()
  const font = fontData
    ? { Roboto: { data: new Uint8Array(fontData), fallback: true } }
    : undefined

  const pdfBytes = await generate({
    template,
    inputs,
    plugins: PDFME_PLUGINS,
    ...(font ? { options: { font } } : {}),
  })

  return Buffer.from(pdfBytes)
}

export async function pdfToPng(
  pdfBuf: Buffer,
  paperWidthMm = 80,
): Promise<Buffer> {
  const captureWidthPx = thermalPaperWidthPx(paperWidthMm)
  const pdfJsDir = getPdfJsDir()
  if (!pdfJsDir) {
    throw new Error('pdf.js dosyaları bulunamadı (resources/pdfjs)')
  }

  const pdfJsUrl = pathToFileURL(path.join(pdfJsDir, 'pdf.min.js')).href
  const workerUrl = pathToFileURL(path.join(pdfJsDir, 'pdf.worker.min.js')).href
  const b64 = pdfBuf.toString('base64')

  const html = `<!DOCTYPE html>
<html>
<head>
<script src="${pdfJsUrl}"></script>
</head>
<body style="margin:0;padding:0;overflow:hidden;background:white;">
<canvas id="c"></canvas>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc = '${workerUrl}';
const TARGET_W = ${captureWidthPx};
const data = atob('${b64}');
const arr = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) arr[i] = data.charCodeAt(i);
pdfjsLib.getDocument({ data: arr }).promise.then(pdf => pdf.getPage(1)).then(page => {
  const vp1 = page.getViewport({ scale: 1 });
  const scale = TARGET_W / vp1.width;
  const vp = page.getViewport({ scale });
  const c = document.getElementById('c');
  c.width = TARGET_W;
  c.height = Math.round(vp.height);
  page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(() => {
    document.title = 'READY:' + c.height;
  });
});
</script>
</body>
</html>`

  const tmpHtml = path.join(tmpdir(), `btpos_${Date.now()}.html`)
  fs.writeFileSync(tmpHtml, html)

  const win = new BrowserWindow({
    show: false,
    width: captureWidthPx,
    height: 1400,
    webPreferences: { contextIsolation: false, webSecurity: false },
  })

  try {
    await win.loadFile(tmpHtml)

    const height = await new Promise<number>((resolve, reject) => {
      const start = Date.now()
      const check = async () => {
        if (win.isDestroyed()) {
          reject(new Error('Pencere kapandı'))
          return
        }
        try {
          const title = String(await win.webContents.executeJavaScript('document.title || ""'))
          if (title.startsWith('READY:')) {
            resolve(parseInt(title.replace('READY:', ''), 10))
            return
          }
        } catch {
          /* pdf.js henüz hazır değil */
        }
        if (Date.now() - start > 15000) {
          reject(new Error('PDF render timeout'))
          return
        }
        setTimeout(check, 300)
      }
      setTimeout(check, 1000)
    })

    await new Promise(r => setTimeout(r, 500))

    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: captureWidthPx,
      height,
    })
    return image.toPNG()
  } finally {
    if (!win.isDestroyed()) win.close()
    try {
      fs.unlinkSync(tmpHtml)
    } catch {
      /* yok say */
    }
  }
}

export async function pngToEscPos(
  pngBuf: Buffer,
  paperWidthMm = 80,
): Promise<Buffer> {
  const targetWidth = thermalPaperWidthPx(paperWidthMm)
  const img = await Jimp.read(pngBuf)
  img.greyscale()

  if (img.bitmap.width !== targetWidth) {
    img.resize({ w: targetWidth })
  }

  const width = img.bitmap.width
  const height = img.bitmap.height
  const bytesPerRow = Math.ceil(width / 8)
  const bufs: Buffer[] = [align('center')]

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(bytesPerRow)
    for (let x = 0; x < width; x++) {
      const { r, g, b, a } = intToRGBA(img.getPixelColor(x, y))
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      if (a > 128 && lum < 128) {
        const byteIndex = Math.floor(x / 8)
        row[byteIndex] |= 0x80 >> (x % 8)
      }
    }
    const header = Buffer.from([
      0x1d, 0x76, 0x30, 0x00,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      0x01, 0x00,
    ])
    bufs.push(Buffer.concat([header, Buffer.from(row)]))
  }

  return Buffer.concat(bufs)
}

/** Termal: gömülü görsel varsa PDF→PNG→ESC/POS, yoksa doğrudan metin */
export async function renderThermalReceipt(
  templateJson: unknown,
  data: RenderData,
  paperW: number,
): Promise<Buffer> {
  if (templateNeedsPdfPipeline(templateJson)) {
    const pdfBuf = await renderPdfme(templateJson, data)
    const pngBuf = await pdfToPng(pdfBuf, paperW)
    const raster = await pngToEscPos(pngBuf, paperW)
    return Buffer.concat([init(), raster, feed(4), cut()])
  }
  return pdfmeToEscPos(templateJson, data, paperW)
}
