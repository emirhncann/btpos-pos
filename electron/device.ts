import * as os from 'os'
import * as crypto from 'crypto'

export function getDeviceUID(): string {
  const mac = getPrimaryMac()
  const raw = `${os.hostname()}-${mac}-${os.platform()}-${os.arch()}`
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32)
}

export function getPrimaryMac(): string {
  const interfaces = os.networkInterfaces()
  return (
    Object.values(interfaces)
      .flat()
      .find((i) => i && !i.internal && i.mac !== '00:00:00:00:00:00')?.mac ?? 'unknown'
  )
}

export function getDeviceInfo() {
  return {
    device_name: os.hostname(),
    mac_address: getPrimaryMac(),
    os_info:     `${os.type()} ${os.release()} (${os.arch()})`,
    device_uid:  getDeviceUID(),
  }
}
