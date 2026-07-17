/// <reference types="vite/client" />

declare module '*.gif' {
  const src: string
  export default src
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.wav' {
  const src: string
  export default src
}

declare module '*.mp3' {
  const src: string
  export default src
}

interface Window {
  __btpos_exit_check?: () =>
    | { canExit: boolean; heldCount: number }
    | Promise<{ canExit: boolean; heldCount: number }>
}
