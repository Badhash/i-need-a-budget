// Memoire de tiers (REF N) cote front : liste bootstrap.payees (cle payeeKey ->
// categorie par defaut, calculee serveur), libelle a transmettre a
// setPayeeCategory pour viser une cle, et mutation optimiste « changer /
// oublier le defaut d'un tiers » avec rollback cible sur la seule cle touchee.

import { useMemo } from 'react'
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { Transaction } from '@/types/domain'
import { apiSetPayeeCategory, BOOTSTRAP_KEY, type Bootstrap } from '@/lib/data'
import { useTransactions } from '@/lib/queries'
import { enqueue, resolveId } from '@/lib/mutationQueue'
import { payeeKeyOf } from '@/lib/ruleInsights'
import { payeeKey } from '../../../packages/crypto/src/payee'

/**
 * Libelle a envoyer a setPayeeCategory pour viser la cle `key` : le serveur
 * re-derive payeeKey(libelle). La cle elle-meme convient quand elle est stable
 * (payeeKey(cle) === cle) ; une cle tronquee a 40 caracteres peut finir sur un
 * mot coupe (une lettre, un mot de bruit) que payeeKey retirerait : on prend
 * alors le libelle d'une transaction du cache qui produit cette cle. Null si
 * aucun libelle ne la produit (tiers non modifiable depuis cette liste).
 */
export function payeeLabelFor(key: string, transactions: readonly Transaction[] | undefined): string | null {
  if (!key) return null
  if (payeeKey(key) === key) return key
  const source = transactions?.find((t) => payeeKeyOf(t) === key)
  return source ? source.label : null
}

/** Nombre de transactions par cle de tiers (tout le cache). */
export function usePayeeCounts(): Map<string, number> {
  const { data: transactions } = useTransactions()
  return useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of transactions ?? []) {
      const key = payeeKeyOf(t)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [transactions])
}

export interface PayeeChange {
  /** Cle de tiers visee (celle du cache bootstrap.payees). */
  key: string
  /** Libelle transmis au serveur (payeeKey(label) === key). */
  label: string
  /** Nouvelle categorie par defaut, ou null pour oublier le tiers. */
  categoryId: string | null
}

interface PayeeContext {
  previous: string | null
}

function patchPayee(queryClient: QueryClient, key: string, categoryId: string | null): void {
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => {
    if (!old) return old
    const rest = old.payees.filter((p) => p.key !== key)
    return { ...old, payees: categoryId === null ? rest : [...rest, { key, categoryId }] }
  })
}

/**
 * Change (ou oublie, categoryId null) le defaut memorise d'un tiers. Optimiste
 * sur bootstrap.payees, rollback de la seule cle en cas d'echec. Serialise
 * dans la file de mutations : une categorisation en vol (qui apprend le tiers)
 * part avant, un « Annuler » part apres. Si le serveur a vise une autre cle
 * que prevu, bootstrap est relu (resynchronisation ciblee).
 */
export function usePayeeDefault(): UseMutationResult<{ ok: true; key: string }, Error, PayeeChange, PayeeContext> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ label, categoryId }: PayeeChange) =>
      enqueue(() => apiSetPayeeCategory(label, categoryId === null ? null : resolveId(categoryId)), {
        deps: categoryId === null ? [] : [categoryId],
      }),
    onMutate: async ({ key, categoryId }) => {
      await queryClient.cancelQueries({ queryKey: BOOTSTRAP_KEY })
      const previous =
        queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)?.payees.find((p) => p.key === key)?.categoryId ?? null
      patchPayee(queryClient, key, categoryId)
      return { previous }
    },
    onError: (_err, { key }, ctx) => {
      if (ctx) patchPayee(queryClient, key, ctx.previous)
    },
    onSuccess: (res, { key }) => {
      if (res.key !== key) void queryClient.invalidateQueries({ queryKey: BOOTSTRAP_KEY })
    },
  })
}
