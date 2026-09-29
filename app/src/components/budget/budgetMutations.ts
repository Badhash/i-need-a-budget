import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { BudgetGroupBlock, BudgetMonth, BudgetRow } from '@/lib/budget'
import { apiSetAssigned } from '@/lib/data'
import { enqueue, resolveId } from '@/lib/mutationQueue'
import type {
  MovePayload,
  MoveTarget,
} from '@/components/budget/CategoryActionSheet'
import { useBudgetHistory } from '@/stores/budgetHistory'

// Une enveloppe est "vide" quand ses trois colonnes sont a 0 : rien d'assigne,
// aucune activite, aucun disponible reporte. Des qu'UNE colonne est non nulle,
// la ligne reste visible.
export function isEmptyRow(row: BudgetRow): boolean {
  return row.assigned === 0 && row.activity === 0 && row.available === 0
}

export function useAssignMutation(month: string) {
  const queryClient = useQueryClient()
  const record = useBudgetHistory((s) => s.record)
  const key = ['budget', month] as const
  return useMutation({
    // Serialise derriere une eventuelle creation de categorie en vol : le
    // categoryId est resolu temp -> real au moment de l'envoi (assigner sur une
    // enveloppe tout juste creee ne part plus avec un id 'temp-*').
    mutationFn: (input: { categoryId: string; amount: number; skipHistory?: boolean }) =>
      enqueue(
        () => apiSetAssigned({ categoryId: resolveId(input.categoryId), amount: input.amount, month }),
        { deps: [input.categoryId] },
      ),
    // Mise a jour OPTIMISTE : la valeur assignee, le Disponible de la ligne, les
    // totaux du groupe et le Pret a assigner changent INSTANTANEMENT dans le cache.
    // Le POST /api part en arriere-plan ; la reconciliation serveur (signal
    // Realtime) est silencieuse car elle renvoie les memes chiffres. Aucune valeur
    // ne "saute" apres un aller-retour reseau (voir CLAUDE.md, reactivite percue).
    onMutate: async ({ categoryId, amount, skipHistory }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BudgetMonth>(key)
      // Enregistre l'action pour l'undo/redo (sauf les replays undo/redo eux-memes).
      // prev = montant assigne actuel lu dans le cache avant application.
      if (!skipHistory && previous) {
        let prev = 0
        for (const g of previous.groups)
          for (const r of g.rows) if (r.category.id === categoryId) prev = r.assigned
        if (prev !== amount) record({ categoryId, month, prev, next: amount })
      }
      queryClient.setQueryData<BudgetMonth>(key, (old) => {
        if (!old) return old
        // delta = nouveau montant - ancien montant. available = rollover +
        // assigned + activity -> il varie du meme delta. RTA baisse du delta.
        let delta = 0
        const groups = old.groups.map((group) => {
          let groupDelta = 0
          const rows = group.rows.map((row) => {
            if (row.category.id !== categoryId) return row
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
      })
      // La cle est CAPTUREE ici : si l'utilisateur change de mois pendant le
      // POST, le rollback doit viser le mois de l'assignation, pas celui affiche.
      return { previous, key }
    },
    // Rollback discret si le reseau echoue : on restaure l'etat d'avant, PUIS
    // on refetch la cle du mois : en rafale (Financer les objectifs, Couvrir les
    // depassements), ce snapshot peut ecraser les patchs d'autres mutations deja
    // commitees cote serveur — le refetch scope remet la verite sans attendre la
    // reconciliation Realtime (jusqu'a 30 s).
    onError: (_err, _input, context) => {
      const k = context?.key ?? key
      if (context?.previous) queryClient.setQueryData(k, context.previous)
      void queryClient.invalidateQueries({ queryKey: k })
    },
    // Pas de refetch du mois assigne (deja exact en optimiste). Les AUTRES mois
    // en cache, eux, sont perimes : une assignation en M pese sur le Pret a
    // assigner de M-1 et sur le report de M+1. On les marque perimes ; etant
    // inactifs, ils ne sont refetches qu'a leur prochain affichage.
    onSuccess: (_data, _input, context) => {
      const m = context?.key[1] ?? month
      void queryClient.invalidateQueries({
        queryKey: ['budget'],
        predicate: (q) => q.queryKey[1] !== m,
      })
    },
  })
}

// Applique une nouvelle valeur assignee a une categorie DANS le cache budget :
// ajuste l'assigne et le disponible de la ligne, les totaux du groupe, les
// totaux du mois et le Pret a assigner. Fonction pure reutilisee pour les deux
// cotes d'un deplacement d'argent (source et destination).
function applyAssignToCache(old: BudgetMonth, categoryId: string, amount: number): BudgetMonth {
  let delta = 0
  const groups = old.groups.map((group) => {
    let groupDelta = 0
    const rows = group.rows.map((row) => {
      if (row.category.id !== categoryId) return row
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

// Deplacement d'argent entre deux enveloppes (couvrir un depassement / deplacer
// un excedent) : deux setAssigned coherents. La mise a jour du cache applique
// les DEUX cotes en une seule passe optimiste ; en cas d'echec reseau, les deux
// sont annules ensemble (restauration du snapshot). Cote serveur, on tente une
// compensation si le second POST echoue apres un premier reussi, pour ne pas
// laisser un etat incoherent (la reconciliation Realtime tranche ensuite).
// Le total assigne (from - X puis to + X) est conserve : le RTA revient a
// l'identique une fois les deux deltas appliques.
export function useMoveMutation(month: string) {
  const queryClient = useQueryClient()
  const key = ['budget', month] as const
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
    onMutate: async ({ fromId, toId, fromAssigned, toAssigned, amount }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BudgetMonth>(key)
      // On applique EXACTEMENT les memes valeurs absolues que les POST serveur
      // (snapshot du moment de l'ouverture de la feuille) pour qu'aucun chiffre
      // ne "saute" a la reconciliation Realtime.
      queryClient.setQueryData<BudgetMonth>(key, (old) => {
        if (!old) return old
        const step1 = applyAssignToCache(old, fromId, fromAssigned - amount)
        return applyAssignToCache(step1, toId, toAssigned + amount)
      })
      return { previous, key }
    },
    // Meme discipline que useAssignMutation : rollback sur la cle capturee puis
    // refetch scope (le snapshot peut ecraser d'autres patchs deja commites).
    onError: (_err, _input, context) => {
      const k = context?.key ?? key
      if (context?.previous) queryClient.setQueryData(k, context.previous)
      void queryClient.invalidateQueries({ queryKey: k })
    },
    onSuccess: (_data, _input, context) => {
      const m = context?.key[1] ?? month
      void queryClient.invalidateQueries({
        queryKey: ['budget'],
        predicate: (q) => q.queryKey[1] !== m,
      })
    },
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
