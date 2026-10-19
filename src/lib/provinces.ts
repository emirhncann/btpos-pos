import raw from '../data/il-ilce.json'

const IL_ILCE = raw as Record<string, string[]>

export const PROVINCES: string[] = Object.keys(IL_ILCE).sort((a, b) => a.localeCompare(b, 'tr'))

export function districtsOf(city: string): string[] {
  const key = matchProvince(city)
  if (!key) return []
  return [...(IL_ILCE[key] ?? [])].sort((a, b) => a.localeCompare(b, 'tr'))
}

export function matchProvince(name: string): string {
  const n = name.trim().toLocaleLowerCase('tr-TR')
  if (!n) return ''
  return PROVINCES.find(p => p.toLocaleLowerCase('tr-TR') === n) ?? ''
}

export function filterPlaces(list: string[], query: string): string[] {
  const q = query.trim().toLocaleLowerCase('tr-TR')
  if (!q) return list
  return list.filter(item => item.toLocaleLowerCase('tr-TR').includes(q))
}
