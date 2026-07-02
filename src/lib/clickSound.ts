import clickPopMp3 from '../assets/click_pop.mp3'

let audio: HTMLAudioElement | null = null

export function initClickSound(): void {
  if (audio) return
  audio = new Audio(clickPopMp3)
  audio.preload = 'auto'
  audio.load()
}

export function playClickSound(): void {
  if (!audio) initClickSound()
  if (!audio) return
  audio.currentTime = 0
  void audio.play().catch(() => {})
}
