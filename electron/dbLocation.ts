import { app, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { getDefaultDbDir } from './paths'

const CONFIG = () => path.join(app.getPath('userData'), 'db-location.json')
export const DB_FILE_NAME = 'btpos.db'

export type DbLocationSource =
  | 'db-location.json'
  | 'kurulum klasörü'
  | `eski DB aktarıldı: ${string}`
  | `yeni oluşturuldu, eski DB reddedildi: ${string}`

export function defaultDbDir() {
  return getDefaultDbDir()
}

export function getDbDir(): string {
  try {
    const { dir } = JSON.parse(fs.readFileSync(CONFIG(), 'utf8')) as { dir?: string }
    if (dir && fs.existsSync(dir)) return dir
  } catch {
    /* yoksa varsayılan */
  }
  return defaultDbDir()
}

export function getDbFilePath(): string {
  return path.join(getDbDir(), DB_FILE_NAME)
}

export function setDbDir(dir: string) {
  const prev = readConfig()
  fs.writeFileSync(
    CONFIG(),
    JSON.stringify({ ...prev, dir, updatedAt: new Date().toISOString() }, null, 2),
  )
}

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeDecision(dir: string, migratedFrom?: string) {
  const body: Record<string, unknown> = { dir, decidedAt: new Date().toISOString() }
  if (migratedFrom) body.migratedFrom = migratedFrom
  fs.mkdirSync(path.dirname(CONFIG()), { recursive: true })
  fs.writeFileSync(CONFIG(), JSON.stringify(body, null, 2))
}

function findOldDb(extraDirs: Array<string | null | undefined>, rootFile: string): string | null {
  const candidates = [
    path.join(app.getPath('userData'), DB_FILE_NAME),
    ...extraDirs.filter((d): d is string => Boolean(d?.trim())).map(d => path.join(d.trim(), DB_FILE_NAME)),
  ]
  for (const src of candidates) {
    if (!src || path.resolve(src) === path.resolve(rootFile)) continue
    if (fs.existsSync(src)) return src
  }
  return null
}

function describeOldDb(src: string): { headline: string; stats?: string } {
  const stat = fs.statSync(src)
  const when = new Date(stat.mtimeMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${pad(when.getDate())}.${pad(when.getMonth() + 1)}.${when.getFullYear()} ${pad(when.getHours())}:${pad(when.getMinutes())}`
  const sizeMb = stat.size / (1024 * 1024)
  const size = `${sizeMb.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
  const headline = `Konum: ${src}\nSon değişiklik: ${stamp}\nBoyut: ${size}`
  try {
    const sqlite = new Database(src, { readonly: true, fileMustExist: true })
    try {
      const count = sqlite.prepare('SELECT count(*) AS c FROM sales').get() as { c: number }
      const last = sqlite.prepare('SELECT max(receipt_no) AS r FROM sales').get() as { r: string | number | null }
      const receipt = last?.r != null && String(last.r).trim() ? String(last.r) : '—'
      return { headline, stats: `Satış: ${Number(count.c).toLocaleString('tr-TR')}   ·  Son fiş: ${receipt}` }
    } finally {
      sqlite.close()
    }
  } catch {
    return { headline }
  }
}

function copySqliteDb(src: string, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  try {
    const sqlite = new Database(src)
    sqlite.pragma('wal_checkpoint(TRUNCATE)')
    sqlite.close()
  } catch (e) {
    console.warn('[db] eski dosya checkpoint edilemedi, kopyalanıyor:', e)
  }
  fs.copyFileSync(src, dest)
  for (const ext of ['-wal', '-shm']) {
    const side = src + ext
    if (fs.existsSync(side)) fs.copyFileSync(side, dest + ext)
  }
}

/**
 * db-location.json varsa onu kullanır.
 * Yoksa kurulum db'si varsa onu açar.
 * Eski DB bulunursa aktarım sorusu sorulur; kapatmak aktarmayı kabul eder.
 * Eski dosya hiç silinmez.
 */
export async function resolveDbFile(extraDirs: Array<string | null | undefined> = []): Promise<{ file: string; source: DbLocationSource }> {
  if (fs.existsSync(CONFIG())) {
    return { file: getDbFilePath(), source: 'db-location.json' }
  }

  const rootDir = getDefaultDbDir()
  const rootFile = path.join(rootDir, DB_FILE_NAME)
  if (fs.existsSync(rootFile)) {
    return { file: rootFile, source: 'kurulum klasörü' }
  }

  const oldFile = findOldDb(extraDirs, rootFile)
  if (!oldFile) {
    return { file: rootFile, source: 'kurulum klasörü' }
  }

  const info = describeOldDb(oldFile)
  while (true) {
    const choice = await dialog.showMessageBox({
      type: 'question',
      title: 'BTPOS',
      message: 'Önceki kurulumdan veritabanı bulundu',
      detail: [
        info.headline,
        info.stats,
        '',
        'Bu veritabanını yeni kuruluma aktarmak ister misiniz?',
      ].filter(line => line != null).join('\n'),
      buttons: ['Evet, eski verilerle devam et', 'Hayır, yeni başla'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (choice.response === 0) {
      copySqliteDb(oldFile, rootFile)
      writeDecision(rootDir, oldFile)
      return { file: rootFile, source: `eski DB aktarıldı: ${oldFile}` }
    }

    const confirm = await dialog.showMessageBox({
      type: 'warning',
      title: 'BTPOS',
      message: 'Eski satış ve ayar verileri yeni kurulumda görünmeyecek. Emin misiniz?',
      buttons: ['Vazgeç', 'Evet, yeni başla'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (confirm.response === 1) {
      writeDecision(rootDir)
      return { file: rootFile, source: `yeni oluşturuldu, eski DB reddedildi: ${oldFile}` }
    }
  }
}
