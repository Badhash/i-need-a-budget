import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Mode, ThemeId } from '@/styles/themes'
import type { Transaction } from '@/types/domain'
import { addMonths, currentMonth, maxMonth, MIN_MONTH } from '@/lib/format'

interface UiState {
  theme: ThemeId
  mode: Mode
  month: string
  addTxOpen: boolean
  editTx: Transaction | null
  // Groupes de budget replies. Record<id, true> plutot qu'un Set : zustand
  // persist (JSON) ne serialise pas les Set. Absence de cle = groupe deplie.
  collapsedGroups: Record<string, true>
  // Masque les lignes d'enveloppes entierement vides (assigne, activite et
  // disponible tous a 0). Persiste pour survivre au refresh.
  hideEmptyRows: boolean
  // Une nouvelle version de l'app est deployee (service worker mis a jour
  // alors que cette page tourne encore sur l'ancien bundle). Non persiste.
  updateAvailable: boolean
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
  setHideEmptyRows: (hide: boolean) => void
  setUpdateAvailable: (available: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'nuit',
      mode: 'system',
      month: currentMonth(),
      addTxOpen: false,
      editTx: null,
      collapsedGroups: {},
      hideEmptyRows: false,
      updateAvailable: false,
      setTheme: (theme) => set({ theme }),
      setMode: (mode) => set({ mode }),
      setMonth: (month) => {
        if (month >= MIN_MONTH && month <= maxMonth()) set({ month })
      },
      shiftMonth: (delta) => {
        const next = addMonths(get().month, delta)
        if (next >= MIN_MONTH && next <= maxMonth()) set({ month: next })
      },
      resetMonth: () => set({ month: currentMonth() }),
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
      setHideEmptyRows: (hideEmptyRows) => set({ hideEmptyRows }),
      setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
    }),
    {
      name: 'inab-ui',
      partialize: (s) => ({
        theme: s.theme,
        mode: s.mode,
        collapsedGroups: s.collapsedGroups,
        hideEmptyRows: s.hideEmptyRows,
      }),
    },
  ),
)

export function resolveDark(mode: Mode): boolean {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return mode === 'dark'
}
