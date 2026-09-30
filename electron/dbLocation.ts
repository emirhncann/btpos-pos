import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { getDefaultDbDir } from './paths'

const CONFIG = () => path.join(app.getPath('userData'), 'db-location.json')
export const DB_FILE_NAME = 'btpos.db'

export type DbLocationSource = 'db-location.json' | 'kurulum klasörü' | 'eski konumdan taşındı'

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
  fs.writeFileSync(
    CONFIG(),
    JSON.stringify({ dir, updatedAt: new Date().toISOString() }, null, 2),
  )
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
}

/** db-location.json yoksa kurulum kökünü, yoksa eski AppData kaydını kullanır. Eski dosya silinmez. */
export function resolveDbFile(legacyDir?: string | null): { file: string; source: DbLocationSource; migrated: boolean } {
  if (fs.existsSync(CONFIG())) {
    return { file: getDbFilePath(), source: 'db-location.json', migrated: false }
  }

  const rootFile = path.join(getDefaultDbDir(), DB_FILE_NAME)
  if (fs.existsSync(rootFile)) {
    return { file: rootFile, source: 'kurulum klasörü', migrated: false }
  }

  const candidates = [
    legacyDir?.trim() ? path.join(legacyDir.trim(), DB_FILE_NAME) : '',
    path.join(app.getPath('userData'), DB_FILE_NAME),
  ].filter(Boolean)

  for (const src of candidates) {
    if (path.resolve(src) === path.resolve(rootFile)) continue
    if (!fs.existsSync(src)) continue
    try {
      copySqliteDb(src, rootFile)
      return { file: rootFile, source: 'eski konumdan taşındı', migrated: true }
    } catch (e) {
      console.error('[db] eski konum kopyalanamadı, eski dosya açılacak:', e)
      return { file: src, source: 'eski konumdan taşındı', migrated: false }
    }
  }

  return { file: rootFile, source: 'kurulum klasörü', migrated: false }
}
