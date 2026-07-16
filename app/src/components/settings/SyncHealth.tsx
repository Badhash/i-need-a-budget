import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { bankSync, useSyncLogs, type SyncLog } from '@/lib/bank'
import { fmtDateTimeParis, fmtRelativeTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// Une ligne d'historique : icone de statut, horodatage Paris, resultat (nombre
// importe ou message d'erreur).
function SyncLogRow({ log }: { log: SyncLog }) {
  const when = fmtDateTimeParis(log.runAt)
  const ok = log.status === 'ok'
  return (
    <li className="flex items-center gap-2.5 text-[13px]">
      <span className={ok ? 'shrink-0 text-success' : 'shrink-0 text-danger'}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      </span>
      <span className="shrink-0 tnum text-soft">{when ?? '—'}</span>
      <span className={`min-w-0 flex-1 truncate text-right ${ok ? 'text-soft' : 'text-danger'}`}>
        {ok
          ? log.importedCount > 0
            ? `${log.importedCount} transaction${log.importedCount > 1 ? 's' : ''} importée${log.importedCount > 1 ? 's' : ''}`
            : 'À jour'
          : (log.error ?? 'Échec')}
      </span>
    </li>
  )
}

/**
 * Indicateur de sante de la synchronisation : derniere synchro en relatif,
 * badge d'echec, bouton « Synchroniser maintenant » (chargement non bloquant) et,
 * en option, l'historique des 10 derniers runs. Le declenchement manuel reutilise
 * l'action `sync` de l'Edge Function sync-bank (meme chemin que le cron).
 */
export function SyncHealth({ showHistory = false }: { showHistory?: boolean }) {
  const queryClient = useQueryClient()
  const { data: logs, isLoading } = useSyncLogs()
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSync() {
    // Garde anti double-clic : un run est deja en vol.
    if (syncing) return
    setMessage(null)
    setSyncing(true)
    try {
      const { imported, linked } = await bankSync()
      setMessage(
        linked === 0
          ? "Associe d'abord un compte bancaire à un compte local, puis synchronise."
          : imported > 0
            ? `${imported} transaction${imported > 1 ? 's' : ''} importée${imported > 1 ? 's' : ''}.`
            : 'Aucune nouvelle transaction depuis la dernière synchronisation.',
      )
      // Rafraichit les donnees affectees par une sync (soldes, transactions,
      // budget, rapports) ET l'historique des runs — scope au lieu d'un
      // invalidateQueries() global qui rechargerait aussi targets/rules/aspsps.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
        queryClient.invalidateQueries({ queryKey: ['syncLogs'] }),
      ])
    } catch {
      setMessage('Synchronisation indisponible pour le moment.')
    } finally {
      setSyncing(false)
    }
  }

  if (isLoading) return <Skeleton className="h-16 w-full" />

  const last = logs?.[0] ?? null
  const lastFailed = last?.status === 'error'
  const relative = last ? fmtRelativeTime(last.runAt) : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="label-caps">Synchronisation</p>
          {last ? (
            <p className="text-[13px] text-soft">
              Dernière synchro {relative ?? '—'}
            </p>
          ) : (
            <p className="text-[13px] text-soft">Aucune synchronisation pour le moment.</p>
          )}
        </div>
        {lastFailed && <Badge variant="danger">Échec</Badge>}
        <Button variant="secondary" onClick={() => void handleSync()} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Synchroniser maintenant
        </Button>
      </div>

      {lastFailed && last?.error && <p className="text-[12.5px] text-danger">{last.error}</p>}
      {message && <p className="text-[13px] text-soft">{message}</p>}

      {showHistory && logs && logs.length > 0 && (
        <ul className="space-y-2 border-t border-line pt-3">
          {logs.map((log) => (
            <SyncLogRow key={log.id} log={log} />
          ))}
        </ul>
      )}
    </div>
  )
}
