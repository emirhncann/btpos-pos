import { useMemo } from 'react'
import {
  resolveButtonColor,
  safeParseButtonColors,
  type ButtonColorKey,
} from '../theme/buttonColors'
import { useSettings } from './useSettings'

export function useButtonColor(key: ButtonColorKey) {
  const { cashier } = useSettings()
  const overrides = useMemo(
    () => safeParseButtonColors(cashier?.buttonColors),
    [cashier?.buttonColors],
  )
  return resolveButtonColor(key, overrides, cashier?.theme)
}
