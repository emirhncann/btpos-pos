import { app, BrowserWindow } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.allowDowngrade = true
autoUpdater.allowPrerelease = true

export async function prepareUpdate(baseUrl: string, targetVersion: string): Promise<UpdateInfo> {
  if (!app.isPackaged) {
    throw new Error('Geliştirme modunda kurulum paketi yok. Güncelleme yalnızca kurulu programda çalışır.')
  }
  autoUpdater.setFeedURL({ provider: 'generic', url: baseUrl })
  const result = await autoUpdater.checkForUpdates()
  const found = result?.updateInfo?.version
  if (found !== targetVersion) {
    throw new Error(`Klasördeki sürüm (${found ?? 'yok'}) hedefle (${targetVersion}) uyuşmuyor`)
  }
  return result!.updateInfo
}

export function downloadUpdate(win: BrowserWindow): Promise<void> {
  autoUpdater.removeAllListeners('download-progress')
  autoUpdater.removeAllListeners('error')
  autoUpdater.on('download-progress', p => {
    if (!win.isDestroyed()) win.webContents.send('update:progress', Math.round(p.percent))
  })
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    const cleanup = () => {
      autoUpdater.removeListener('error', onError)
    }
    autoUpdater.once('error', onError)
    autoUpdater.downloadUpdate().then(() => {
      cleanup()
      resolve()
    }).catch(err => {
      cleanup()
      reject(err)
    })
  })
}

export function installNow(): void {
  autoUpdater.quitAndInstall(true, true)
}
