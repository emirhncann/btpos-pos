/** İmleç konumuna yazma ve barkod patlaması. Türkçe klavye dönüşümü yok. */

export type ScreenKeyboardMode = 'auto' | 'always' | 'off'

const MODE_KEY = 'btpos.screenKeyboard'

export function readScreenKeyboardMode(): ScreenKeyboardMode {
  try {
    const raw = localStorage.getItem(MODE_KEY)
    if (raw === 'always' || raw === 'off' || raw === 'auto') return raw
  } catch { /* yok */ }
  return 'auto'
}

export function writeScreenKeyboardMode(mode: ScreenKeyboardMode): void {
  localStorage.setItem(MODE_KEY, mode)
}

export function isEditableField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false
  if (target.disabled || target.readOnly) return false
  const type = target instanceof HTMLInputElement ? target.type : 'text'
  return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'file' && type !== 'submit'
}

function nativeSet(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function insertIntoField(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  const next = el.value.slice(0, start) + text + el.value.slice(end)
  if (el.maxLength > 0 && next.length > el.maxLength) return
  nativeSet(el, next)
  const caret = start + text.length
  el.setSelectionRange(caret, caret)
}

export function deleteBackward(el: HTMLInputElement | HTMLTextAreaElement): void {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  if (start !== end) {
    insertIntoField(el, '')
    return
  }
  if (start <= 0) return
  const next = el.value.slice(0, start - 1) + el.value.slice(end)
  nativeSet(el, next)
  el.setSelectionRange(start - 1, start - 1)
}

export function moveCaret(el: HTMLInputElement | HTMLTextAreaElement, dir: -1 | 1): void {
  const start = el.selectionStart ?? el.value.length
  const next = Math.max(0, Math.min(el.value.length, start + dir))
  el.setSelectionRange(next, next)
}

export function trUpper(ch: string): string {
  return ch.toLocaleUpperCase('tr-TR')
}

/** Art arda tuşlar ≤ 35 ms ve Enter ile biten, en az 4 karakter. */
export function isBarcodeBurst(gapsMs: number[], length: number): boolean {
  if (length < 4) return false
  return gapsMs.every(gap => gap <= 35)
}
