import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import type { Transaction } from '@/types/domain'
import { countsAsUncategorized, patchAccountBalances, patchUncategorizedCount, useAccountsList } from '@/lib/data'
import { apiCall } from '@/lib/api'
import { scheduleBudgetRefetch } from '@/lib/categorize'
import { useUiStore } from '@/stores/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { TxRow } from '@/components/transactions/txRow'

// Menu discret par ligne : conversion transaction <-> virement entre comptes.
export function RowMenu({ row, className }: { row: TxRow; className?: string }) {
  const queryClient = useQueryClient()
  const accounts = useAccountsList()
  const setEditTx = useUiStore((s) => s.setEditTx)
  const [error, setError] = useState<string | null>(null)
  const isTransfer = Boolean(row.tx.transferGroupId)
  const targets = accounts.filter((a) => a.id !== row.tx.accountId)

  const convert = useMutation({
    mutationFn: (targetAccountId: string) =>
      apiCall('convertToTransfer', { transactionId: row.tx.id, targetAccountId }),
    // Pas de mise a jour optimiste ici : on rafraichit la seule liste des
    // transactions pour un retour visuel prompt. Le budget/les rapports/le
    // bootstrap sont reconcilies en fond par le signal Realtime coalesce (pas
    // de rechargement de la table entiere a chaque conversion).
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      // Conversion rare : un rafraichissement du bootstrap remet le compteur
      // « À catégoriser » du badge d'aplomb (le transfert sort du decompte).
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      // Une depense categorisee devenue virement sort de son enveloppe.
      scheduleBudgetRefetch(queryClient)
    },
    onError: (err) => showError(err),
  })
  const revert = useMutation({
    mutationFn: () => apiCall('convertTransferToNormal', { transactionId: row.tx.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      scheduleBudgetRefetch(queryClient)
    },
    onError: (err) => showError(err),
  })
  // Suppression optimiste : la ligne disparait immediatement, rollback si echec.
  const remove = useMutation({
    mutationFn: () => apiCall('deleteTransaction', { transactionId: row.tx.id }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] })
      const snapshot = queryClient.getQueryData<Transaction[]>(['transactions'])
      // Si la ligne supprimee comptait dans le badge, on decremente en optimiste.
      const countDelta = countsAsUncategorized(queryClient, row.tx) ? -1 : 0
      patchUncategorizedCount(queryClient, countDelta)
      queryClient.setQueryData<Transaction[]>(['transactions'], (old) =>
        old?.filter((t) => t.id !== row.tx.id),
      )
      // Solde du compte : la ligne part avec son montant (le miroir d'un
      // virement est inconnu ici, le bootstrap est refetche au succes).
      if (!isTransfer) patchAccountBalances(queryClient, [{ accountId: row.tx.accountId, delta: -row.tx.amount }])
      return { snapshot, countDelta }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['transactions'], ctx.snapshot)
      if (ctx?.countDelta) patchUncategorizedCount(queryClient, -ctx.countDelta)
      if (!isTransfer) patchAccountBalances(queryClient, [{ accountId: row.tx.accountId, delta: row.tx.amount }])
      showError(err)
    },
    // Suppression deja refletee de facon optimiste dans la liste ; le budget
    // (activite de l'enveloppe, Pret a assigner), les soldes et les rapports
    // sont relus de facon ciblee et coalescee. EXCEPTION virement : le serveur
    // supprime ou delie aussi le MIROIR (autre compte) que le patch optimiste
    // ne connait pas — sans refetch il resterait affiche comme un virement
    // orphelin.
    onSuccess: () => {
      if (isTransfer) {
        void queryClient.invalidateQueries({ queryKey: ['transactions'] })
        void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      }
      scheduleBudgetRefetch(queryClient)
    },
  })
  // Confirmation en deux temps dans le menu : premier clic arme, second supprime.
  const [confirmDelete, setConfirmDelete] = useState(false)

  function showError(err: unknown) {
    setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    window.setTimeout(() => setError(null), 4000)
  }

  return (
    <div className={cn('relative', className)}>
      <DropdownMenu onOpenChange={(open) => !open && setConfirmDelete(false)}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Actions sur la transaction"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-soft transition-colors hover:bg-surface2 hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Un transfert ne se modifie pas ici : annuler le virement d'abord. */}
          {!isTransfer && (
            <DropdownMenuItem onSelect={() => setEditTx(row.tx)}>Modifier</DropdownMenuItem>
          )}
          {isTransfer ? (
            <DropdownMenuItem onSelect={() => revert.mutate()}>
              Annuler le virement
            </DropdownMenuItem>
          ) : targets.length > 0 ? (
            <>
              <DropdownMenuLabel>Convertir en virement vers…</DropdownMenuLabel>
              {targets.map((acc) => (
                <DropdownMenuItem key={acc.id} onSelect={() => convert.mutate(acc.id)}>
                  {acc.name}
                </DropdownMenuItem>
              ))}
            </>
          ) : (
            <DropdownMenuLabel>Aucun autre compte</DropdownMenuLabel>
          )}
          <DropdownMenuItem
            className="text-danger"
            onSelect={(e) => {
              if (!confirmDelete) {
                // Garde le menu ouvert pour le second clic de confirmation.
                e.preventDefault()
                setConfirmDelete(true)
              } else {
                setConfirmDelete(false)
                remove.mutate()
              }
            }}
          >
            {confirmDelete ? 'Confirmer la suppression' : 'Supprimer la transaction'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p
          role="status"
          className="absolute right-0 top-full z-10 mt-1 max-w-[220px] whitespace-normal rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-[12px] text-danger shadow-card"
        >
          {error}
        </p>
      )}
    </div>
  )
}
