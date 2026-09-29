import { useMemo } from 'react'
import { computeAccountStats, type AccountStats } from '@/lib/accounts'
import { useTransactions } from '@/lib/queries'
import type { AccountWithBalance } from '@/lib/data'

/**
 * Courbes de solde, derniere operation et variation du mois de chaque compte,
 * derivees du cache des transactions (aucun appel reseau). null tant que la
 * liste n'est pas chargee.
 */
export function useAccountStats(accounts: AccountWithBalance[] | undefined): Map<string, AccountStats> | null {
  const { data: transactions } = useTransactions()
  return useMemo(
    () => (accounts && transactions ? computeAccountStats(accounts, transactions) : null),
    [accounts, transactions],
  )
}
