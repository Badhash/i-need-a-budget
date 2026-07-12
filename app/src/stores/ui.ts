import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Mode, ThemeId } from '@/styles/themes'
import { addMonths, CURRENT_MONTH, MAX_MONTH, MIN_MONTH } from '@/lib/format'

interface UiState {
  theme: ThemeId
  mode: Mode
  month: string
  addTxOpen: boolean
  setTheme: (theme: ThemeId) => void
  setMode: (mode: Mode) => void
  setMonth: (month: string) => void
  shiftMonth: (delta: 1 | -1) => void
  resetMonth: () => void
  setAddTxOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'nuit',
      mode: 'system',
      month: CURRENT_MONTH,
      addTxOpen: false,
      setTheme: (theme) => set({ theme }),
      setMode: (mode) => set({ mode }),
      setMonth: (month) => {
        if (month >= MIN_MONTH && month <= MAX_MONTH) set({ month })
      },
      shiftMonth: (delta) => {
        const next = addMonths(get().month, delta)
        if (next >= MIN_MONTH && next <= MAX_MONTH) set({ month: next })
      },
      resetMonth: () => set({ month: CURRENT_MONTH }),
      setAddTxOpen: (addTxOpen) => set({ addTxOpen }),
    }),
    {
      name: 'inab-ui',
      partialize: (s) => ({ theme: s.theme, mode: s.mode }),
    },
  ),
)

export function resolveDark(mode: Mode): boolean {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return mode === 'dark'
}
