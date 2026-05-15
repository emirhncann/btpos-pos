import { useState, useCallback, useRef } from 'react'
import type { KeyboardType } from '../components/TouchKeyboard'

export interface OpenOpts {
  title?:          string
  initial?:        string
  type?:           KeyboardType
  onConfirm:       (value: string) => void
  onSearch?:       (query: string) => Promise<CustomerRow[]>
  onSelectResult?: (c: CustomerRow) => void
}

export function useTouchKeyboard(enabled: boolean) {
  const [state, setState] = useState<{
    open:      boolean
    title?:    string
    value:     string
    type:      KeyboardType
    onConfirm: (v: string) => void
  }>({ open: false, value: '', type: 'qwerty', onConfirm: () => {} })

  const [searchResults, setSearchResults] = useState<CustomerRow[]>([])
  const [searching, setSearching] = useState(false)
  const searchOptsRef = useRef<OpenOpts | null>(null)

  const closeKeyboard = useCallback(() => {
    setState(s => ({ ...s, open: false }))
    setSearchResults([])
    searchOptsRef.current = null
  }, [])

  const handleChange = useCallback(async (v: string) => {
    setState(s => ({ ...s, value: v }))
    const opts = searchOptsRef.current
    if (opts?.onSearch && v.length >= 2) {
      setSearching(true)
      try {
        const results = await opts.onSearch(v)
        setSearchResults(results)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    } else {
      setSearchResults([])
    }
  }, [])

  const openKeyboard = useCallback((opts: OpenOpts) => {
    if (!enabled) return false
    searchOptsRef.current = opts
    setSearchResults([])
    setSearching(false)
    setState({
      open:      true,
      title:     opts.title,
      value:     opts.initial ?? '',
      type:      opts.type ?? 'qwerty',
      onConfirm: opts.onConfirm,
    })
    const initial = opts.initial ?? ''
    if (opts.onSearch && initial.length >= 2) {
      setSearching(true)
      void opts.onSearch(initial).then(results => {
        if (searchOptsRef.current === opts) setSearchResults(results)
      }).catch(() => {
        if (searchOptsRef.current === opts) setSearchResults([])
      }).finally(() => {
        if (searchOptsRef.current === opts) setSearching(false)
      })
    }
    return true
  }, [enabled])

  const keyboardProps = {
    open:     state.open,
    title:    state.title,
    value:    state.value,
    type:     state.type,
    onChange: handleChange,
    onConfirm: (v: string) => {
      searchOptsRef.current?.onConfirm(v)
      closeKeyboard()
    },
    onClose:  closeKeyboard,
    searchResults,
    onSelectResult: (c: CustomerRow) => {
      searchOptsRef.current?.onSelectResult?.(c)
      closeKeyboard()
    },
    searching,
  }

  return { openKeyboard, closeKeyboard, keyboardProps }
}
