import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Mode, ThemeId } from '@/styles/themes'
import type { Transaction } from '@/mocks/data'
import { addMonths, CURRENT_MONTH, MAX_MONTH, MIN_MONTH } from '@/lib/format'

interface UiState {
  theme: ThemeId
  mode: Mode
  month: string
  addTxOpen: boolean
  editTx: Transaction | null
  // Groupes de budget replies. Record<id, true> plutot qu'un Set : zustand
  // persist (JSON) ne serialise pas les Set. Absence de cle = groupe deplie.
  collapsedGroups: Record<string, true>
  setTheme: (theme: ThemeId) => void
  setMode: (mode: Mode) => void
  setMonth: (month: string) => void
  shiftMonth: (delta: 1 | -1) => void
  resetMonth: () => void
  setAddTxOpen: (open: boolean) => void
  setEditTx: (tx: Transaction | null) => void
  toggleGroupCollapsed: (groupId: string) => void
  // Remplace l'ensemble des groupes replies (tout replier / tout deplier).
  setCollapsedGroups: (collapsed: Record<string, true>) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'nuit',
      mode: 'system',
      month: CURRENT_MONTH,
      addTxOpen: false,
      editTx: null,
      collapsedGroups: {},
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
      setEditTx: (editTx) => set({ editTx }),
      toggleGroupCollapsed: (groupId) =>
        set((state) => {
          const next = { ...state.collapsedGroups }
          if (next[groupId]) delete next[groupId]
          else next[groupId] = true
          return { collapsedGroups: next }
        }),
      setCollapsedGroups: (collapsed) => set({ collapsedGroups: collapsed }),
    }),
    {
      name: 'inab-ui',
      partialize: (s) => ({ theme: s.theme, mode: s.mode, collapsedGroups: s.collapsedGroups }),
    },
  ),
)

export function resolveDark(mode: Mode): boolean {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return mode === 'dark'
}
