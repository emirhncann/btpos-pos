import { useState, useCallback } from 'react'
import type { KeyboardType } from '../components/TouchKeyboard'

interface OpenOpts {
  title?:    string
  initial?:  string
  type?:     KeyboardType
  onConfirm: (value: string) => void
}

export function useTouchKeyboard(enabled: boolean) {
  const [state, setState] = useState<{
    open:      boolean
    title?:    string
    value:     string
    type:      KeyboardType
    onConfirm: (v: string) => void
  }>({ open: false, value: '', type: 'qwerty', onConfirm: () => {} })

  const openKeyboard = useCallback((opts: OpenOpts) => {
    if (!enabled) return false
    setState({
      open:      true,
      title:     opts.title,
      value:     opts.initial ?? '',
      type:      opts.type ?? 'qwerty',
      onConfirm: opts.onConfirm,
    })
    return true
  }, [enabled])

  const closeKeyboard = useCallback(() => {
    setState(s => ({ ...s, open: false }))
  }, [])

  const keyboardProps = {
    open:     state.open,
    title:    state.title,
    value:    state.value,
    type:     state.type,
    onChange: (v: string) => setState(s => ({ ...s, value: v })),
    onConfirm:(v: string) => { state.onConfirm(v); closeKeyboard() },
    onClose:  closeKeyboard,
  }

  return { openKeyboard, closeKeyboard, keyboardProps }
}
