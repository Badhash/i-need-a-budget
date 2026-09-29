import { create } from 'zustand'

// Historique d'annulation LOCAL et VOLONTAIREMENT LIMITE, dedie a la SEULE page
// Budget : il ne memorise que les assignations d'enveloppe (setAssigned). Aucune
// autre action de l'app n'y touche. En memoire (pas de persistance) : "quelques
// dernieres actions", remis a zero au changement de mois affiche.
//
// Une ETAPE regroupe toutes les enveloppes modifiees par UNE action utilisateur :
// une saisie (1 enveloppe), un deplacement d'argent (2 enveloppes), « Financer
// les objectifs » ou « Couvrir les depassements » (N enveloppes). Annuler ou
// refaire rejoue l'etape entiere en une fois.

export interface AssignChange {
  categoryId: string
  /** Nom de l'enveloppe au moment de l'action (message du toast d'annulation). */
  name: string
  prev: number // montant assigne AVANT l'action
  next: number // montant assigne APRES l'action
}

export interface HistoryStep {
  id: number
  month: string
  changes: AssignChange[]
  /** Libelle de l'action groupee (« Financer les objectifs »...), sinon absent. */
  label?: string
}

interface BudgetHistoryState {
  past: HistoryStep[]
  future: HistoryStep[]
  /** Empile une nouvelle etape et renvoie son identifiant. */
  record: (step: Omit<HistoryStep, 'id'>) => number
  /** Retire une etape (action echouee : elle n'a plus rien a annuler). */
  discard: (id: number) => void
  undo: () => HistoryStep | null
  redo: () => HistoryStep | null
  clear: () => void
}

const LIMIT = 25 // on ne garde que les 25 dernieres actions

let seq = 0

export const useBudgetHistory = create<BudgetHistoryState>((set, get) => ({
  past: [],
  future: [],
  // Nouvelle action utilisateur : empile dans le passe, ecrase le futur (comme
  // tout undo/redo : refaire une action apres un retour arriere coupe la branche).
  record: (step) => {
    const id = ++seq
    set((s) => ({ past: [...s.past, { ...step, id }].slice(-LIMIT), future: [] }))
    return id
  },
  discard: (id) =>
    set((s) => ({ past: s.past.filter((step) => step.id !== id), future: s.future.filter((step) => step.id !== id) })),
  undo: () => {
    const { past } = get()
    if (past.length === 0) return null
    const step = past[past.length - 1]!
    set((s) => ({ past: s.past.slice(0, -1), future: [step, ...s.future].slice(0, LIMIT) }))
    return step
  },
  redo: () => {
    const { future } = get()
    if (future.length === 0) return null
    const step = future[0]!
    set((s) => ({ future: s.future.slice(1), past: [...s.past, step].slice(-LIMIT) }))
    return step
  },
  clear: () => set({ past: [], future: [] }),
}))
