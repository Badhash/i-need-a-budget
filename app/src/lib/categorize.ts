// Categorisation des transactions : mutation optimiste partagee (page
// Transactions, mode Tri rapide, dialogues) et suggestions de categories
// (memoire de tiers calculee serveur + usage recent lu dans le cache).
// Aucune lecture reseau supplementaire : tout vient du cache TanStack.

import { useMemo } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Transaction } from '@/types/domain'
import {
  apiCategorize,
  apiSetPayeeCategory,
  BOOTSTRAP_KEY,
  countsAsUncategorized,
  patchUncategorizedCount,
  useBootstrap,
  useCategoriesList,
  useGroupsList,
  type Bootstrap,
  type PayeeDefault,
} from '@/lib/data'
import { useTransactions } from '@/lib/queries'
import { enqueue, resolveId } from '@/lib/mutationQueue'
import { payeeKey } from '../../../packages/crypto/src/payee'

export { payeeKey }

// Une categorisation deplace de l'activite entre enveloppes (et peut toucher
// le Pret a assigner : revenus, depassement d'un mois passe). Le cache budget
// n'est pas patchable en optimiste sans rejouer le moteur, on refetch donc la
// SEULE cle budget (agregats, quelques Ko) apres un court debounce : une rafale
// de tris (mode Tri rapide) ne coute qu'un appel. Le signal Realtime, lui, est
// coalesce sur 30 s et peut ne jamais arriver sur iOS (websocket coupee en
// arriere-plan) : sans ce refetch cible, le Pret a assigner restait fige.
const BUDGET_REFETCH_DEBOUNCE_MS = 1200
let budgetRefetchTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleBudgetRefetch(queryClient: QueryClient): void {
  if (budgetRefetchTimer) clearTimeout(budgetRefetchTimer)
  budgetRefetchTimer = setTimeout(() => {
    budgetRefetchTimer = null
    // Serialise derriere les ecritures encore en file : la lecture part apres
    // leur commit. Sinon une reponse anterieure a une assignation en vol
    // ecraserait sa valeur optimiste (« valeur qui saute »).
    void enqueue(async () => {
      void queryClient.invalidateQueries({ queryKey: ['budget'] })
      // Soldes de comptes et compteur « À catégoriser » vivent dans bootstrap
      // (agregats, quelques Ko). Les rapports ne sont refetches que s'ils sont
      // affiches ; sinon ils sont juste marques perimes pour leur prochain
      // affichage (zero egress maintenant).
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
    })
  }, BUDGET_REFETCH_DEBOUNCE_MS)
}

// ---------------------------------------------------------------------------
// Memoire de tiers optimiste
// ---------------------------------------------------------------------------
//
// Le serveur apprend chaque categorisation manuelle (compte budget, categorie
// hors revenus, hors virement) et fait du PREMIER choix le defaut d'un tiers
// inconnu. On l'anticipe : la suggestion « tiers » apparait des la prochaine
// transaction du meme marchand, sans attendre la relecture de bootstrap.

/** Cle du tiers appris par cette categorisation (si le serveur l'apprend), sinon null. */
function learnableKey(queryClient: QueryClient, tx: Transaction, categoryId: string | null): string | null {
  if (!categoryId || tx.transferGroupId) return null
  const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
  if (!boot) return null
  const account = boot.accounts.find((a) => a.id === tx.accountId)
  const category = boot.categories.find((c) => c.id === categoryId)
  if (!account?.onBudget || !category || category.isIncome) return null
  return payeeKey(tx.label) || null
}

/**
 * Ajoute en optimiste le defaut d'un tiers encore inconnu. Renvoie la cle
 * ajoutee (a retirer si la categorisation echoue), null sinon.
 */
export function learnPayeeOptimistic(
  queryClient: QueryClient,
  tx: Transaction,
  categoryId: string | null,
): string | null {
  const key = learnableKey(queryClient, tx, categoryId)
  if (!key || !categoryId) return null
  const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
  if (!boot || boot.payees.some((p) => p.key === key)) return null
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) =>
    old ? { ...old, payees: [...old.payees, { key, categoryId }] } : old,
  )
  return key
}

/** Retire une entree ajoutee en optimiste (echec de la categorisation). */
export function forgetPayeeOptimistic(queryClient: QueryClient, key: string): void {
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) =>
    old ? { ...old, payees: old.payees.filter((p) => p.key !== key) } : old,
  )
}

/** Defaut memorise pour le tiers d'un libelle (bootstrap.payees). */
export function payeeDefaultOf(queryClient: QueryClient, label: string): PayeeDefault | undefined {
  const key = payeeKey(label)
  if (!key) return undefined
  return queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)?.payees.find((p) => p.key === key)
}

/**
 * « Annuler » une categorisation apprise : le choix annule ne doit pas rester
 * le defaut du tiers (sinon, regle « 2 des 3 », il faudrait deux corrections
 * pour s'en defaire). On remet la memoire dans l'etat d'avant : defaut
 * precedent force, ou tiers oublie s'il etait inconnu. Best-effort, silencieux.
 */
export function restorePayeeMemory(
  queryClient: QueryClient,
  tx: Transaction,
  learnedCategoryId: string | null,
  previous: PayeeDefault | undefined,
): void {
  const key = learnableKey(queryClient, tx, learnedCategoryId)
  if (!key) return
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => {
    if (!old) return old
    const rest = old.payees.filter((p) => p.key !== key)
    return { ...old, payees: previous ? [...rest, previous] : rest }
  })
  const label = tx.label
  void enqueue(() => apiSetPayeeCategory(label, previous ? resolveId(previous.categoryId) : null)).catch(
    () => undefined,
  )
}

// ---------------------------------------------------------------------------
// Categorisation optimiste
// ---------------------------------------------------------------------------

export interface CategorizeVars {
  txId: string
  categoryId: string | null
}

/** Ce qu'une categorisation optimiste a change (retour cible en cas d'echec). */
export interface CategorizeContext {
  txId: string
  /** Categorie avant l'action ; undefined si la ligne etait absente du cache. */
  previous: string | null | undefined
  next: string | null
  countDelta: number
  /** Entree de memoire de tiers ajoutee en optimiste. */
  payeeKeyAdded: string | null
}

/**
 * Applique des categorisations en optimiste sur le cache (liste, badge,
 * memoire de tiers) en UNE ecriture de la liste. Renvoie un contexte par
 * ligne pour un retour cible.
 */
export function applyCategorizeManyOptimistic(
  queryClient: QueryClient,
  txIds: string[],
  categoryId: string | null,
): CategorizeContext[] {
  const list = queryClient.getQueryData<Transaction[]>(['transactions'])
  const byId = new Map((list ?? []).map((t) => [t.id, t]))
  const contexts: CategorizeContext[] = []
  let countTotal = 0
  for (const txId of txIds) {
    const prev = byId.get(txId)
    if (!prev) {
      contexts.push({ txId, previous: undefined, next: categoryId, countDelta: 0, payeeKeyAdded: null })
      continue
    }
    const before = countsAsUncategorized(queryClient, prev)
    const after = countsAsUncategorized(queryClient, { ...prev, categoryId })
    const countDelta = (after ? 1 : 0) - (before ? 1 : 0)
    countTotal += countDelta
    // Un seul ajout par tiers (le premier choix fait le defaut).
    const payeeKeyAdded = learnPayeeOptimistic(queryClient, prev, categoryId)
    contexts.push({ txId, previous: prev.categoryId, next: categoryId, countDelta, payeeKeyAdded })
  }
  const targets = new Set(txIds)
  queryClient.setQueryData<Transaction[]>(['transactions'], (old) =>
    old?.map((t) => (targets.has(t.id) && t.categoryId !== categoryId ? { ...t, categoryId } : t)),
  )
  patchUncategorizedCount(queryClient, countTotal)
  return contexts
}

/** Applique UNE categorisation en optimiste (cf. applyCategorizeManyOptimistic). */
export function applyCategorizeOptimistic(
  queryClient: QueryClient,
  { txId, categoryId }: CategorizeVars,
): CategorizeContext {
  return applyCategorizeManyOptimistic(queryClient, [txId], categoryId)[0]!
}

/**
 * Retour cible apres un echec : seule la categorie posee par CETTE action est
 * retiree (une categorisation plus recente de la meme ligne est conservee).
 * Ligne disparue entre-temps (creation annulee) : seul le compteur est rendu.
 */
export function revertCategorizeOptimistic(queryClient: QueryClient, contexts: CategorizeContext[]): void {
  const list = queryClient.getQueryData<Transaction[]>(['transactions'])
  const present = new Map((list ?? []).map((t) => [t.id, t]))
  const revert = new Map<string, string | null>()
  let count = 0
  for (const ctx of contexts) {
    if (ctx.previous === undefined) continue
    const current = present.get(ctx.txId)
    if (!current) {
      count -= ctx.countDelta
    } else if (current.categoryId === ctx.next) {
      revert.set(ctx.txId, ctx.previous)
      count -= ctx.countDelta
    }
    if (ctx.payeeKeyAdded) forgetPayeeOptimistic(queryClient, ctx.payeeKeyAdded)
  }
  if (revert.size > 0) {
    queryClient.setQueryData<Transaction[]>(['transactions'], (old) =>
      old?.map((t) => (revert.has(t.id) ? { ...t, categoryId: revert.get(t.id) ?? null } : t)),
    )
  }
  patchUncategorizedCount(queryClient, count)
}

// Categorisation optimiste : le cache TanStack est mis a jour immediatement,
// l'appel reseau part en arriere-plan, rollback discret en cas d'echec.
export function useCategorize() {
  const queryClient = useQueryClient()
  return useMutation({
    // Serialise derriere une eventuelle creation en vol (categorie tout juste
    // creee, transaction tout juste saisie) : les ids sont resolus temp -> real
    // au moment de l'envoi, la tache est annulee si la creation a echoue.
    mutationFn: ({ txId, categoryId }: CategorizeVars) =>
      enqueue(() => apiCategorize(resolveId(txId), categoryId === null ? null : resolveId(categoryId)), {
        deps: categoryId === null ? [txId] : [txId, categoryId],
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] })
      return applyCategorizeOptimistic(queryClient, vars)
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) revertCategorizeOptimistic(queryClient, [ctx])
    },
    // Liste et badge sont deja exacts (optimiste) ; seul le budget du mois est
    // refetche, de facon ciblee et coalescee (cf. scheduleBudgetRefetch).
    onSuccess: () => scheduleBudgetRefetch(queryClient),
  })
}

export type SuggestionReason = 'payee' | 'recent' | 'frequent'

export interface CategorySuggestion {
  categoryId: string
  reason: SuggestionReason
}

const MAX_SUGGESTIONS = 4

/**
 * Suggestions pour un libelle : 1) la categorie memorisee pour ce tiers
 * (bootstrap.payees, calculee serveur), 2) les categories les plus utilisees
 * sur les 90 derniers jours (cache transactions), en excluant les revenus et
 * les categories masquees. Ordre stable, sans doublon, au plus MAX_SUGGESTIONS.
 */
export function useCategorySuggestions(label: string | null | undefined): CategorySuggestion[] {
  const boot = useBootstrap().data
  const { data: txs } = useTransactions()
  const categories = useCategoriesList()
  const groups = useGroupsList()
  const key = label ? payeeKey(label) : ''

  return useMemo(() => {
    const hiddenGroups = new Set(groups.filter((g) => g.hidden).map((g) => g.id))
    const valid = new Set(
      categories.filter((c) => !c.isIncome && !c.hidden && !hiddenGroups.has(c.groupId)).map((c) => c.id),
    )
    const out: CategorySuggestion[] = []
    const seen = new Set<string>()
    const push = (categoryId: string | null | undefined, reason: SuggestionReason) => {
      if (!categoryId || seen.has(categoryId) || !valid.has(categoryId)) return
      seen.add(categoryId)
      out.push({ categoryId, reason })
    }

    if (key) push(boot?.payees.find((p) => p.key === key)?.categoryId, 'payee')

    if (txs) {
      const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
      const counts = new Map<string, number>()
      let recent: string | null = null
      let recentDate = ''
      for (const t of txs) {
        if (!t.categoryId || t.transferGroupId || t.date < cutoff) continue
        counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1)
        if (t.date > recentDate) {
          recentDate = t.date
          recent = t.categoryId
        }
      }
      push(recent, 'recent')
      for (const [id] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        if (out.length >= MAX_SUGGESTIONS) break
        push(id, 'frequent')
      }
    }
    return out.slice(0, MAX_SUGGESTIONS)
  }, [boot?.payees, txs, categories, groups, key])
}
