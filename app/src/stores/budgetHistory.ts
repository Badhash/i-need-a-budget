import { create } from 'zustand'

// Historique d'annulation LOCAL et VOLONTAIREMENT LIMITE, dedie a la SEULE page
// Budget : il ne memorise que les assignations d'enveloppe (setAssigned). Aucune
// autre action de l'app n'y touche. En memoire (pas de persistance) : "quelques
// dernieres actions", remis a zero au changement de mois affiche.

interface AssignChange {
  categoryId: string
  month: string
  prev: number // montant assigne AVANT l'action
  next: number // montant assigne APRES l'action
}

interface BudgetHistoryState {
  past: AssignChange[]
  future: AssignChange[]
  record: (change: AssignChange) => void
  undo: () => AssignChange | null
  redo: () => AssignChange | null
  clear: () => void
}

const LIMIT = 25 // on ne garde que les 25 dernieres actions

export const useBudgetHistory = create<BudgetHistoryState>((set, get) => ({
  past: [],
  future: [],
  // Nouvelle action utilisateur : empile dans le passe, ecrase le futur (comme
  // tout undo/redo : refaire une action apres un retour arriere coupe la branche).
  record: (change) => set((s) => ({ past: [...s.past, change].slice(-LIMIT), future: [] })),
  undo: () => {
    const { past } = get()
    if (past.length === 0) return null
    const change = past[past.length - 1]!
    set((s) => ({ past: s.past.slice(0, -1), future: [change, ...s.future].slice(0, LIMIT) }))
    return change
  },
  redo: () => {
    const { future } = get()
    if (future.length === 0) return null
    const change = future[0]!
    set((s) => ({ future: s.future.slice(1), past: [...s.past, change].slice(-LIMIT) }))
    return change
  },
  clear: () => set({ past: [], future: [] }),
}))
