import { useEffect } from 'react'
import { initClickSound, playClickSound } from '../lib/clickSound'

const CLICK_SOUND_SELECTOR = [
  'button:not(:disabled)',
  'input[type="button"]:not(:disabled)',
  'input[type="submit"]:not(:disabled)',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="switch"]:not([aria-disabled="true"])',
  '[data-click-sound]',
].join(', ')

export function useGlobalClickSound(): void {
  useEffect(() => {
    initClickSound()

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[data-no-click-sound]')) return

      const clickable = target.closest(CLICK_SOUND_SELECTOR)
      if (!clickable) return

      playClickSound()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])
}
