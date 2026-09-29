import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { BudgetGroupBlock, BudgetMonth, BudgetRow } from '@/lib/budget'
import { apiSetAssigned } from '@/lib/data'
import { enqueue, resolveId } from '@/lib/mutationQueue'
import { fmtEUR } from '@/lib/format'
import { toast } from '@/lib/toast'
import type {
  MovePayload,
  MoveTarget,
} from '@/components/budget/CategoryActionSheet'
import { useBudgetHistory, type AssignChange, type HistoryStep } from '@/stores/budgetHistory'

// Une enveloppe est "vide" quand ses trois colonnes sont a 0 : rien d'assigne,
// aucune activite, aucun disponible reporte. Des qu'UNE colonne est non nulle,
// la ligne reste visible.
export function isEmptyRow(row: BudgetRow): boolean {
  return row.assigned === 0 && row.activity === 0 && row.available === 0
}

/** Nouvelle valeur ASSIGNEE (absolue) d'une enveloppe pour le mois. */
export interface AssignTarget {
  categoryId: string
  amount: number
}

/** Ligne du cache budget d'une enveloppe (toutes les lignes, masquees comprises). */
export function findRow(budget: BudgetMonth | undefined, categoryId: string): BudgetRow | undefined {
  if (!budget) return undefined
  for (const group of budget.groups) {
    for (const row of group.rows) if (row.category.id === categoryId) return row
  }
  return undefined
}

// Applique une nouvelle valeur assignee a une categorie DANS le cache budget :
// ajuste l'assigne et le disponible de la ligne, les totaux du groupe, les
// totaux du mois et le Pret a assigner. Fonction pure reutilisee par toutes
// les mutations d'assignation (saisie, lot, deplacement, annulation).
function applyAssignToCache(old: BudgetMonth, categoryId: string, amount: number): BudgetMonth {
  let delta = 0
  const groups = old.groups.map((group) => {
    let groupDelta = 0
    const rows = group.rows.map((row) => {
      if (row.category.id !== categoryId) return row
      // delta = nouveau montant - ancien montant. available = rollover +
      // assigned + activity -> il varie du meme delta. RTA baisse du delta.
      delta = amount - row.assigned
      groupDelta = delta
      return { ...row, assigned: amount, available: row.available + delta }
    })
    if (groupDelta === 0) return group
    return {
      ...group,
      rows,
      totals: {
        ...group.totals,
        assigned: group.totals.assigned + groupDelta,
        available: group.totals.available + groupDelta,
      },
    }
  })
  if (delta === 0) return old
  return {
    ...old,
    groups,
    rta: old.rta - delta,
    totals: {
      ...old.totals,
      assigned: old.totals.assigned + delta,
      available: old.totals.available + delta,
    },
  }
}

function applyAllToCache(old: BudgetMonth, changes: AssignTarget[]): BudgetMonth {
  return changes.reduce((acc, c) => applyAssignToCache(acc, c.categoryId, c.amount), old)
}

// Etape d'historique d'un lot : valeurs AVANT lues dans le cache (avant
// application), enveloppes inchangees ignorees.
function describeChanges(previous: BudgetMonth, changes: AssignTarget[]): AssignChange[] {
  const out: AssignChange[] = []
  for (const c of changes) {
    const row = findRow(previous, c.categoryId)
    const prev = row?.assigned ?? 0
    if (prev === c.amount) continue
    out.push({ categoryId: c.categoryId, name: row?.category.name ?? 'Enveloppe', prev, next: c.amount })
  }
  return out
}

// Envoi reseau d'un lot : un setAssigned par enveloppe (pas d'action groupee
// cote serveur), serialise dans la file globale. Arret au premier echec : la
// relecture du mois qui suit lit un etat stable (plus aucune ecriture en vol).
async function sendAssignments(month: string, changes: AssignTarget[]): Promise<void> {
  for (const c of changes) {
    await enqueue(
      () => apiSetAssigned({ categoryId: resolveId(c.categoryId), amount: c.amount, month }),
      { deps: [c.categoryId] },
    )
  }
}

interface AssignContext {
  previous: BudgetMonth | undefined
  key: readonly ['budget', string]
  stepId: number | null
}

// Mise a jour OPTIMISTE partagee : la valeur assignee, le Disponible des
// lignes, les totaux des groupes et le Pret a assigner changent INSTANTANEMENT
// dans le cache. Le POST /api part en arriere-plan ; la reconciliation serveur
// (signal Realtime) est silencieuse car elle renvoie les memes chiffres. Aucune
// valeur ne "saute" apres un aller-retour reseau (voir CLAUDE.md, reactivite
// percue). L'etape d'historique est enregistree ici, avant application.
async function optimisticAssign(
  queryClient: QueryClient,
  month: string,
  changes: AssignTarget[],
  history: { record: boolean; label?: string },
): Promise<AssignContext> {
  const key = ['budget', month] as const
  await queryClient.cancelQueries({ queryKey: key })
  const previous = queryClient.getQueryData<BudgetMonth>(key)
  let stepId: number | null = null
  if (history.record && previous) {
    const recorded = describeChanges(previous, changes)
    if (recorded.length > 0) {
      stepId = useBudgetHistory.getState().record({ month, changes: recorded, label: history.label })
    }
  }
  queryClient.setQueryData<BudgetMonth>(key, (old) => (old ? applyAllToCache(old, changes) : old))
  // La cle est CAPTUREE ici : si l'utilisateur change de mois pendant le
  // POST, le rollback doit viser le mois de l'assignation, pas celui affiche.
  return { previous, key, stepId }
}

// Rollback discret si le reseau echoue : on restaure l'etat d'avant, PUIS on
// refetch la cle du mois (le snapshot peut ecraser les patchs d'autres
// mutations deja commitees cote serveur — le refetch scope remet la verite
// sans attendre la reconciliation Realtime, jusqu'a 30 s). L'etape
// d'historique de l'action echouee n'a plus rien a annuler : retiree.
function rollbackAssign(queryClient: QueryClient, month: string, context: AssignContext | undefined): void {
  const k = context?.key ?? (['budget', month] as const)
  if (context?.previous) queryClient.setQueryData(k, context.previous)
  if (context?.stepId != null) useBudgetHistory.getState().discard(context.stepId)
  void queryClient.invalidateQueries({ queryKey: k })
}

// Pas de refetch du mois assigne (deja exact en optimiste). Les AUTRES mois en
// cache, eux, sont perimes : une assignation en M pese sur le Pret a assigner
// de M-1 et sur le report de M+1. On les marque perimes ; etant inactifs, ils
// ne sont refetches qu'a leur prochain affichage.
function invalidateOtherMonths(queryClient: QueryClient, month: string, context: AssignContext | undefined): void {
  const m = context?.key[1] ?? month
  void queryClient.invalidateQueries({
    queryKey: ['budget'],
    predicate: (q) => q.queryKey[1] !== m,
  })
}

/** Saisie d'UNE enveloppe (feuille mobile, edition inline desktop, « Vider »). */
export function useAssignMutation(month: string) {
  const queryClient = useQueryClient()
  return useMutation({
    // Serialise derriere une eventuelle creation de categorie en vol : le
    // categoryId est resolu temp -> real au moment de l'envoi (assigner sur une
    // enveloppe tout juste creee ne part plus avec un id 'temp-*').
    mutationFn: (input: { categoryId: string; amount: number; skipHistory?: boolean }) =>
      sendAssignments(month, [input]),
    onMutate: ({ categoryId, amount, skipHistory }) =>
      optimisticAssign(queryClient, month, [{ categoryId, amount }], { record: !skipHistory }),
    onError: (_err, _input, context) => rollbackAssign(queryClient, month, context),
    onSuccess: (_data, _input, context) => invalidateOtherMonths(queryClient, month, context),
  })
}

/**
 * Assignation GROUPEE (« Financer les objectifs », « Couvrir les dépassements »,
 * annuler / refaire) : une seule mise a jour optimiste, UNE etape d'historique
 * (sauf record: false, pour les replays), un seul rollback et une seule
 * notification d'erreur si le lot echoue.
 */
export function useAssignBatchMutation(month: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { changes: AssignTarget[]; record?: boolean; label?: string }) =>
      sendAssignments(month, input.changes),
    onMutate: ({ changes, record = true, label }) =>
      optimisticAssign(queryClient, month, changes, { record, label }),
    onError: (_err, _input, context) => rollbackAssign(queryClient, month, context),
    onSuccess: (_data, _input, context) => invalidateOtherMonths(queryClient, month, context),
  })
}

// Deplacement d'argent entre deux enveloppes (couvrir un depassement / deplacer
// un excedent) : deux setAssigned coherents. La mise a jour du cache applique
// les DEUX cotes en une seule passe optimiste et UNE etape d'historique ; en cas
// d'echec reseau, les deux sont annules ensemble (restauration du snapshot).
// Cote serveur, on tente une compensation si le second POST echoue apres un
// premier reussi, pour ne pas laisser un etat incoherent (la reconciliation
// Realtime tranche ensuite). Le total assigne (from - X puis to + X) est
// conserve : le RTA revient a l'identique une fois les deux deltas appliques.
// Utilise par la feuille d'actions mobile ET le popover desktop : les deux
// beneficient de l'annulation en une etape.
export function useMoveMutation(month: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ fromId, toId, fromAssigned, toAssigned, amount }: MovePayload) => {
      // Comme useAssignMutation : on passe par la file (serialisation FIFO) et on
      // resout temp -> real au moment de l'envoi. Les deux enveloppes deviennent
      // des dependances : si l'une porte encore un id 'temp-*' non resolu, la
      // tache est annulee avant d'atteindre /api.
      const deps = [fromId, toId]
      await enqueue(
        () => apiSetAssigned({ categoryId: resolveId(fromId), amount: fromAssigned - amount, month }),
        { deps },
      )
      try {
        await enqueue(
          () => apiSetAssigned({ categoryId: resolveId(toId), amount: toAssigned + amount, month }),
          { deps },
        )
      } catch (err) {
        // Compensation best-effort : on restaure l'assigne de la source pour
        // eviter un demi-transfert cote serveur. Si elle echoue aussi, la
        // reconciliation Realtime ramenera la verite.
        try {
          await enqueue(
            () => apiSetAssigned({ categoryId: resolveId(fromId), amount: fromAssigned, month }),
            { deps },
          )
        } catch {
          // ignore : le refetch de reconciliation corrigera l'ecart.
        }
        throw err
      }
    },
    // On applique EXACTEMENT les memes valeurs absolues que les POST serveur
    // (snapshot du moment de l'ouverture de la feuille) pour qu'aucun chiffre
    // ne "saute" a la reconciliation Realtime.
    onMutate: ({ fromId, toId, fromAssigned, toAssigned, amount }) =>
      optimisticAssign(
        queryClient,
        month,
        [
          { categoryId: fromId, amount: fromAssigned - amount },
          { categoryId: toId, amount: toAssigned + amount },
        ],
        { record: true, label: `Déplacement de ${fmtEUR(amount)}` },
      ),
    // Meme discipline que useAssignMutation : rollback sur la cle capturee puis
    // refetch scope (le snapshot peut ecraser d'autres patchs deja commites).
    onError: (_err, _input, context) => rollbackAssign(queryClient, month, context),
    onSuccess: (_data, _input, context) => invalidateOtherMonths(queryClient, month, context),
  })
}

// Aplati toutes les enveloppes du mois (hors celle visee) en candidates de
// transfert, en conservant leur groupe pour l'affichage (pastille + couleur).
export function moveTargetsFor(groups: BudgetGroupBlock[], excludeId: string | undefined): MoveTarget[] {
  const targets: MoveTarget[] = []
  for (const block of groups) {
    for (const row of block.rows) {
      if (row.category.id === excludeId) continue
      targets.push({ row, group: block.group })
    }
  }
  return targets
}

// ---------------------------------------------------------------------------
// Annuler / refaire (page Budget)
// ---------------------------------------------------------------------------

function stepSubject(step: HistoryStep): string {
  return step.changes.length === 1 ? step.changes[0]!.name : `${step.changes.length} enveloppes`
}

function stepDescription(step: HistoryStep, direction: 'undo' | 'redo'): string | undefined {
  if (step.label) return step.label
  const only = step.changes.length === 1 ? step.changes[0]! : null
  if (!only) return undefined
  return direction === 'undo' ? `Assigné ramené à ${fmtEUR(only.prev)}` : `Assigné remis à ${fmtEUR(only.next)}`
}

/**
 * Annuler / refaire une ETAPE entiere (toutes ses enveloppes) en une seule
 * mise a jour optimiste, avec un toast qui propose l'operation inverse
 * (« Annulé : 3 enveloppes » -> Rétablir). Le toast garde un identifiant fixe :
 * des annulations successives le remplacent au lieu de s'empiler.
 */
export function useBudgetUndo(month: string) {
  const batch = useAssignBatchMutation(month)
  const canUndo = useBudgetHistory((s) => s.past.length > 0)
  const canRedo = useBudgetHistory((s) => s.future.length > 0)
  // Le toast peut survivre au rendu qui l'a cree : il appelle toujours la
  // derniere mutation connue.
  const mutateRef = useRef(batch.mutate)
  useEffect(() => {
    mutateRef.current = batch.mutate
  }, [batch.mutate])

  const replay = useCallback((direction: 'undo' | 'redo', onlyLabel?: string) => {
    const history = useBudgetHistory.getState()
    // Annulation ciblee (« Annuler » d'un recapitulatif) : seulement si l'etape
    // du dessus est bien celle de l'action (elle a pu echouer et etre retiree).
    if (onlyLabel !== undefined) {
      const top = direction === 'undo' ? history.past[history.past.length - 1] : history.future[0]
      if (!top || top.label !== onlyLabel) return
    }
    const step = direction === 'undo' ? history.undo() : history.redo()
    if (!step) return
    mutateRef.current({
      changes: step.changes.map((c) => ({ categoryId: c.categoryId, amount: direction === 'undo' ? c.prev : c.next })),
      record: false,
    })
    toast({
      id: 'budget-history',
      message: `${direction === 'undo' ? 'Annulé' : 'Rétabli'} : ${stepSubject(step)}`,
      description: stepDescription(step, direction),
      action: {
        label: direction === 'undo' ? 'Rétablir' : 'Annuler',
        onClick: () => replay(direction === 'undo' ? 'redo' : 'undo'),
      },
    })
  }, [])

  const undo = useCallback(() => replay('undo'), [replay])
  const redo = useCallback(() => replay('redo'), [replay])
  /** Annule la derniere etape SI c'est l'action `label` (toast ou recapitulatif). */
  const undoLast = useCallback((label: string) => replay('undo', label), [replay])
  return { undo, redo, undoLast, canUndo, canRedo }
}
