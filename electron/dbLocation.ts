import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const CONFIG = () => path.join(app.getPath('userData'), 'db-location.json')
export const DB_FILE_NAME = 'btpos.db'

export type DbLocationSource = 'db-location.json' | 'varsayılan'

export function defaultDbDir() {
  return app.getPath('userData')
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

/** electron-store `db_path` bir kez json'a taşınır. */
export function resolveDbFile(legacyDir?: string | null): { file: string; source: DbLocationSource; migrated: boolean } {
  if (fs.existsSync(CONFIG())) {
    return { file: getDbFilePath(), source: 'db-location.json', migrated: false }
  }
  const legacy = legacyDir?.trim()
  if (legacy && fs.existsSync(legacy)) {
    setDbDir(legacy)
    console.log('[db] eski db_path taşındı:', legacy)
    return { file: path.join(legacy, DB_FILE_NAME), source: 'db-location.json', migrated: true }
  }
  return { file: path.join(defaultDbDir(), DB_FILE_NAME), source: 'varsayılan', migrated: false }
}
