import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { bankSync, useSyncLogs, type BankConnection } from '@/lib/bank'
import { fmtRelativeTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Bandeau compact de synchronisation bancaire (page Comptes) : derniere
 * synchro, echec eventuel, consentement a renouveler, et declenchement
 * manuel. Le detail (historique, liaisons) reste dans les Reglages.
 */
export function SyncStrip({ connections }: { connections: BankConnection[] }) {
  const queryClient = useQueryClient()
  const { data: logs } = useSyncLogs()
  const [syncing, setSyncing] = useState(false)

  const last = logs?.[0] ?? null
  const failed = last?.status === 'error'
  const relative = last ? fmtRelativeTime(last.runAt) : null
  const expired = connections.some((c) => c.status === 'expired')
  const expiring = connections.some((c) => c.status === 'expiring')
  const warn = failed || expired || expiring
  const banks = [...new Set(connections.map((c) => c.institution))].join(', ')

  const status = expired
    ? 'Consentement expiré : reconnectez la banque'
    : expiring
      ? 'Consentement à renouveler bientôt'
      : failed
        ? `Échec de la dernière synchro${relative ? ` (${relative})` : ''}`
        : last
          ? `Synchronisé ${relative ?? ''}`.trim()
          : 'Pas encore synchronisé'

  async function sync() {
    if (syncing) return
    setSyncing(true)
    try {
      const { imported, linked } = await bankSync()
      toast({
        message:
          linked === 0
            ? 'Aucun compte bancaire associé'
            : imported > 0
              ? `${imported} transaction${imported > 1 ? 's' : ''} importée${imported > 1 ? 's' : ''}`
              : 'Tout est à jour',
        description: linked === 0 ? 'Associez un compte dans les Réglages, puis synchronisez.' : undefined,
        tone: linked === 0 ? 'warning' : 'success',
      })
      // Une synchro peut toucher soldes, transactions, budget et rapports :
      // relectures ciblees (jamais d'invalidation globale).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
        queryClient.invalidateQueries({ queryKey: ['syncLogs'] }),
      ])
    } catch {
      toast({ message: 'Synchronisation indisponible pour le moment', tone: 'danger' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-edge bg-surface px-4 py-3 shadow-card">
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          warn ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success',
        )}
      >
        {warn ? <TriangleAlert className="h-[18px] w-[18px]" /> : <RefreshCw className="h-[18px] w-[18px]" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{banks || 'Synchronisation bancaire'}</p>
        <p className={cn('truncate text-[12.5px]', warn ? 'text-warning' : 'text-soft')}>{status}</p>
      </div>
      {expired || expiring ? (
        <Link to="/reglages" className={buttonVariants({ variant: 'soft', className: 'shrink-0 px-3.5' })}>
          Reconnecter
        </Link>
      ) : (
        <Button
          variant="secondary"
          onClick={() => void sync()}
          disabled={syncing}
          aria-label="Synchroniser maintenant"
          className="w-11 shrink-0 px-0 sm:w-auto sm:px-3.5"
        >
          <RefreshCw className="h-4 w-4" />
          <span className="hidden sm:inline">{syncing ? 'Synchro…' : 'Synchroniser'}</span>
        </Button>
      )}
    </div>
  )
}
