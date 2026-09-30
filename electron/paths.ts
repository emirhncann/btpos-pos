import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/** Kurulum kökü: ...\BTPOS  (exe ...\BTPOS\program\BTPOS.exe) */
export function getRootDir(): string {
  if (!app.isPackaged) return path.join(app.getAppPath(), '.btpos-dev')
  const exeDir = path.dirname(process.execPath)
  return path.basename(exeDir).toLowerCase() === 'program' ? path.dirname(exeDir) : exeDir
}

function ensure(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const getDefaultDbDir = () => ensure(path.join(getRootDir(), 'db'))
export const getLogDir = () => ensure(path.join(getRootDir(), 'log'))
export const getBackupDir = (dbDir: string) => ensure(path.join(dbDir, 'backups'))

const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export function pruneOldLogs(): void {
  const dir = getLogDir()
  const cutoff = Date.now() - LOG_MAX_AGE_MS
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const file = path.join(dir, name)
    try {
      const stat = fs.statSync(file)
      if (!stat.isFile()) continue
      if (stat.mtimeMs < cutoff) fs.unlinkSync(file)
    } catch {
      /* kilitli dosyayı atla */
    }
  }
}

export function dailyLogPath(prefix: 'btpos' | 'pavo'): string {
  const dir = getLogDir()
  const date = new Date().toISOString().slice(0, 10)
  const ext = prefix === 'pavo' ? 'txt' : 'log'
  return path.join(dir, `${prefix}_${date}.${ext}`)
}

export function appendDailyLog(prefix: 'btpos' | 'pavo', line: string): string {
  const file = dailyLogPath(prefix)
  fs.appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`)
  return file
}
