import path from 'path'
import fs from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { app, BrowserWindow } from 'electron'
import { generate } from '@pdfme/generator'
import type { Font, Template } from '@pdfme/common'
import { btposPlugins } from '@pdfme/schemas'
import { init, cut, feed } from './escpos'
import {
  buildPdfmeInputs,
  type RenderData,
} from '../src/lib/templateEngine'

/** 203 dpi termal yazıcı: 8 nokta/mm */
const DOTS_PER_MM = 8

/** Kağıt genişliği → yazıcının basabildiği genişlik (mm) */
export function printableWidthMm(paperWidthMm: number): number {
  const w = Number(paperWidthMm)
  if (w <= 58) return 48
  return 72
}

/** Eşik: 0–255. Büyüdükçe yazı kalınlaşır. Gri tonlar eşiğin altındaysa siyah basılır. */
const THRESHOLD = 160

/** Editör ve Mağaza Paneli ile AYNI adlar — değiştirme */
const BTPOS_FONTS = [
  { name: 'Roboto',                file: 'Roboto-Regular.ttf',          fallback: true  },
  { name: 'Roboto Bold',           file: 'Roboto-Bold.ttf',             fallback: false },
  { name: 'Roboto Condensed',      file: 'RobotoCondensed-Regular.ttf', fallback: false },
  { name: 'Roboto Condensed Bold', file: 'RobotoCondensed-Bold.ttf',    fallback: false },
] as const

let fontCache: Font | null | undefined

/** resources/fonts altındaki 4 fontu bir kez okur. Hiçbiri yoksa undefined (pdfme varsayılanı). */
function getFonts(): Font | undefined {
  if (fontCache !== undefined) return fontCache ?? undefined
  const dirs = [
    path.join(process.resourcesPath, 'fonts'),
    path.join(app.getAppPath(), 'resources', 'fonts'),
    path.join(app.getAppPath(), 'electron', 'fonts'),
  ]
  const dir = dirs.find(d => fs.existsSync(path.join(d, 'Roboto-Regular.ttf')))
  if (!dir) {
    console.warn('[pdfme] Font klasörü bulunamadı, pdfme varsayılan fontu kullanılacak')
    fontCache = null
    return undefined
  }
  const font: Font = {}
  for (const f of BTPOS_FONTS) {
    const p = path.join(dir, f.file)
    if (fs.existsSync(p)) {
      font[f.name] = { data: new Uint8Array(fs.readFileSync(p)), fallback: f.fallback }
    } else {
      console.warn('[pdfme] Font eksik:', p)
    }
  }
  fontCache = font
  return font
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

export function isPdfmeTemplate(templateJson: unknown): boolean {
  const t = templateJson as { schemas?: unknown; basePdf?: unknown }
  if (!t.schemas) return false
  const bp = t.basePdf
  if (typeof bp === 'string') return bp.length > 0
  if (bp && typeof bp === 'object') return true
  return false
}

export async function renderPdfme(templateJson: unknown, data: RenderData): Promise<Buffer> {
  if (!isPdfmeTemplate(templateJson)) throw new Error('Geçersiz pdfme şablonu — schemas veya basePdf eksik')
  const template = JSON.parse(JSON.stringify(templateJson)) as Template
  const schema = template.schemas[0] ?? []
  const bp = template.basePdf as { width?: number; height?: number } | string
  const isRoll = typeof bp === 'object' && (bp.width ?? 0) <= 80 && (bp.height ?? 0) >= 100

  const font = getFonts()
  const pdfBytes = await generate({
    template,
    inputs: [buildPdfmeInputs(data, schema as { name: string; content?: string; type?: string }[])],
    plugins: btposPlugins,
    options: {
      ...(font ? { font } : {}),
      dynamicHeight: isRoll,
    },
  })
  return Buffer.from(pdfBytes)
}

type GrayImage = { width: number; height: number; data: Uint8Array }

/**
 * PDF'in sayfalarını tam 8 nokta/mm ölçekte gri tonlu piksellere çevirir.
 * Gizli pencerede pdf.js + canvas; capturePage kullanılmaz.
 */
export async function pdfToGray(pdfBuf: Buffer): Promise<GrayImage> {
  const pdfJsDir = getPdfJsDir()
  if (!pdfJsDir) throw new Error('pdf.js dosyaları bulunamadı (resources/pdfjs)')

  const pdfJsUrl  = pathToFileURL(path.join(pdfJsDir, 'pdf.min.js')).href
  const workerUrl = pathToFileURL(path.join(pdfJsDir, 'pdf.worker.min.js')).href
  const scale     = (DOTS_PER_MM * 25.4) / 72

  const html = `<!DOCTYPE html><html><head><script src="${pdfJsUrl}"></script></head>
<body style="margin:0;background:#fff"><canvas id="c"></canvas><script>
pdfjsLib.GlobalWorkerOptions.workerSrc = '${workerUrl}';
window.__render = async (b64) => {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const pdf = await pdfjsLib.getDocument({ data: arr }).promise;
  const c = document.getElementById('c');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const parts = []; let width = 0, height = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp   = page.getViewport({ scale: ${scale} });
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
    const gray = new Uint8Array(c.width * c.height);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
      gray[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    }
    width = c.width; height += c.height; parts.push(gray);
  }
  const all = new Uint8Array(width * height); let off = 0;
  for (const g of parts) { all.set(g.subarray(0, Math.min(g.length, all.length - off)), off); off += g.length; }
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < all.length; i += CH) s += String.fromCharCode.apply(null, all.subarray(i, i + CH));
  return { width, height, b64: btoa(s) };
};
document.title = 'READY';
</script></body></html>`

  const tmpHtml = path.join(tmpdir(), `btpos_raster_${Date.now()}.html`)
  fs.writeFileSync(tmpHtml, html)
  const win = new BrowserWindow({
    show: false, width: 400, height: 400,
    webPreferences: { contextIsolation: false, webSecurity: false, offscreen: true },
  })
  try {
    await win.loadFile(tmpHtml)
    const res = await win.webContents.executeJavaScript(
      `window.__render(${JSON.stringify(pdfBuf.toString('base64'))})`,
    ) as { width: number; height: number; b64: string }
    return { width: res.width, height: res.height, data: new Uint8Array(Buffer.from(res.b64, 'base64')) }
  } finally {
    if (!win.isDestroyed()) win.close()
    try { fs.unlinkSync(tmpHtml) } catch { /* yok say */ }
  }
}

/**
 * Gri görüntü → ESC/POS (GS v 0).
 * Yanlardaki basılamayan şeridi kırpar, eşikler, alttaki boşluğu keser.
 */
export function grayToEscPos(img: GrayImage, paperWidthMm: number, threshold = THRESHOLD): Buffer {
  const printMm = printableWidthMm(paperWidthMm)
  const outW    = printMm * DOTS_PER_MM
  const bpr     = outW / 8
  const cropX   = Math.max(0, Math.round((img.width - outW) / 2))

  const rows: Buffer[] = []
  let lastInk = -1
  for (let y = 0; y < img.height; y++) {
    const row = Buffer.alloc(bpr)
    let ink = false
    const base = y * img.width
    for (let x = 0; x < outW; x++) {
      const sx = x + cropX
      const v  = sx < img.width ? img.data[base + sx] : 255
      if (v < threshold) { row[x >> 3] |= 0x80 >> (x & 7); ink = true }
    }
    if (ink) lastInk = y
    rows.push(row)
  }
  const outH = Math.min(img.height, lastInk + 1 + 2 * DOTS_PER_MM)

  const parts: Buffer[] = []
  const BAND = 128
  for (let y = 0; y < outH; y += BAND) {
    const h = Math.min(BAND, outH - y)
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bpr & 0xff, bpr >> 8, h & 0xff, h >> 8]))
    parts.push(...rows.slice(y, y + h))
  }
  return Buffer.concat(parts)
}

/** Şablondaki tüm öğeler basılabilir alanın içinde mi? (0,5 mm tolerans) */
export function fitsPrintableArea(templateJson: unknown, paperWidthMm: number): boolean {
  const side = (paperWidthMm - printableWidthMm(paperWidthMm)) / 2
  const t = templateJson as { schemas?: Array<Array<{ position?: { x: number }; width?: number }>> }
  for (const page of t.schemas ?? []) {
    for (const f of page) {
      const x = f.position?.x ?? 0, w = f.width ?? 0
      if (x < side - 0.5 || x + w > paperWidthMm - side + 0.5) return false
    }
  }
  return true
}

/** Gri görüntüyü hedef genişliğe küçültür (kutu ortalaması) */
export function scaleGray(img: GrayImage, outW: number): GrayImage {
  const f = img.width / outW
  const outH = Math.max(1, Math.round(img.height / f))
  const data = new Uint8Array(outW * outH)
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * f), y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * f)))
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * f), x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * f)))
      let sum = 0, n = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { sum += img.data[yy * img.width + xx]; n++ }
      data[y * outW + x] = n > 0 ? sum / n : 255
    }
  }
  return { width: outW, height: outH, data }
}

/** Termal fiş her zaman görüntü yolundan basılır. */
export async function renderThermalReceipt(
  templateJson: unknown,
  data: RenderData,
  paperW: number,
): Promise<Buffer> {
  const t0 = Date.now()
  const pdfBuf = await renderPdfme(templateJson, data)
  const t1 = Date.now()
  let gray = await pdfToGray(pdfBuf)
  const dots = printableWidthMm(paperW) * DOTS_PER_MM
  console.log(`[termal] renderPdfme ${t1 - t0} ms, pdfToGray ${Date.now() - t1} ms, genişlik ${dots} nokta (${paperW} mm kağıt, görüntü ${gray.width}x${gray.height})`)
  if (!fitsPrintableArea(templateJson, paperW)) {
    console.warn('[termal] Şablon kenara taşıyor → %90 küçültülerek basılıyor. Editörde kenar şeridine çekin.')
    gray = scaleGray(gray, dots)
  }
  const raster = grayToEscPos(gray, paperW)
  return Buffer.concat([init(), raster, feed(4), cut()])
}
