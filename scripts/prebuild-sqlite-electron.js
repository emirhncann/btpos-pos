/**
 * better-sqlite3 ön derlemesini Electron ABI'sine indirir (VS gerekmez).
 * npm install / postinstall sonrası çalışır.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const sqliteDir = path.join(__dirname, '..', 'node_modules', 'better-sqlite3')
if (!fs.existsSync(sqliteDir)) {
  console.log('[prebuild-sqlite] better-sqlite3 yok, atlanıyor.')
  process.exit(0)
}

let electronVersion = process.env.npm_config_target
if (!electronVersion) {
  try {
    electronVersion = require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json')).version
  } catch {
    electronVersion = '28.3.3'
  }
}

const env = { ...process.env }
delete env.npm_config_build_from_source
delete env.npm_config_runtime
delete env.npm_config_target
delete env.npm_config_disturl

console.log(`[prebuild-sqlite] Electron ${electronVersion} için better-sqlite3 indiriliyor...`)

try {
  execSync(`npx prebuild-install -r electron -t ${electronVersion}`, {
    cwd: sqliteDir,
    stdio: 'inherit',
    env,
  })
  console.log('[prebuild-sqlite] Tamam.')
} catch (e) {
  console.warn('[prebuild-sqlite] Prebuild başarısız — electron-rebuild veya VS C++ gerekebilir.')
  console.warn(String(e.message ?? e))
  process.exit(0)
}
