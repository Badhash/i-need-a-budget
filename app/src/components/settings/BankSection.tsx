import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Landmark, Loader2, RefreshCw } from 'lucide-react'
import {
  useBankConnections,
  useAspsps,
  bankStartAuth,
  bankSync,
  apiLinkBankAccount,
  type BankConnection,
} from '@/lib/bank'
import { useAccountsList } from '@/lib/data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { BankCombobox, BankLogo } from '@/components/settings/BankCombobox'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const STATUS_META: Record<BankConnection['status'], { label: string; variant: BadgeProps['variant'] }> = {
  active: { label: 'Connectee', variant: 'success' },
  expiring: { label: 'Expire bientot', variant: 'warning' },
  expired: { label: 'Expiree', variant: 'danger' },
  pending: { label: 'En attente', variant: 'neutral' },
}

function fmtValidUntil(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

// IBAN masque : garde le pays et les 4 derniers chiffres (FR76 •••• 1234).
function maskIban(iban: string): string {
  const clean = iban.replace(/\s+/g, '')
  if (clean.length <= 8) return clean
  return `${clean.slice(0, 4)} •••• ${clean.slice(-4)}`
}

export function BankSection() {
  const queryClient = useQueryClient()
  const { data: connections, isLoading } = useBankConnections()
  const { data: aspsps, isLoading: aspspsLoading, isError: aspspsError } = useAspsps()
  const localAccounts = useAccountsList()
  const logoByName = new Map((aspsps ?? []).map((a) => [a.name, a.logo]))
  const [selectedBank, setSelectedBank] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [connectMessage, setConnectMessage] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const list = connections ?? []
  const hasConnections = list.length > 0
  const needsReconnect = list.some((c) => c.status === 'expiring' || c.status === 'expired')
  const isExpired = list.some((c) => c.status === 'expired')

  // Redirige vers le consentement PSD2 de la banque choisie (aspspName).
  async function handleConnect(aspspName: string) {
    if (!aspspName) return
    setConnectMessage(null)
    setConnecting(true)
    try {
      const { url } = await bankStartAuth(window.location.origin + window.location.pathname, aspspName)
      window.location.assign(url)
    } catch (err) {
      setConnectMessage(err instanceof Error ? err.message : 'Connexion bancaire indisponible.')
      setConnecting(false)
    }
  }

  async function handleSync() {
    setSyncMessage(null)
    setSyncing(true)
    try {
      const { imported } = await bankSync()
      setSyncMessage(
        imported > 0
          ? `${imported} transaction${imported > 1 ? 's' : ''} importee${imported > 1 ? 's' : ''}.`
          : 'Aucune nouvelle transaction.',
      )
      await queryClient.invalidateQueries()
    } catch {
      setSyncMessage('Synchronisation indisponible pour le moment.')
    } finally {
      setSyncing(false)
    }
  }

  // Associe (ou detache) un compte bancaire EB a un compte local, puis rafraichit.
  async function handleLink(connectionId: string, providerAccountUid: string, accountId: string | null) {
    try {
      await apiLinkBankAccount({ connectionId, providerAccountUid, accountId })
      await queryClient.invalidateQueries()
    } catch {
      // silencieux : l'utilisateur peut reessayer
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connexion bancaire</CardTitle>
        <p className="text-[13px] text-soft">
          Synchronisation automatique via Enable Banking (PSD2), trois fois par jour.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Skeleton className="h-20 w-full" />}

        {!isLoading && needsReconnect && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
              <AlertTriangle className="h-[18px] w-[18px]" />
            </span>
            <p className="min-w-0 flex-1 text-[13px] text-ink">
              {isExpired
                ? 'Ta connexion bancaire a expire. Reconnecte-toi pour reprendre la synchronisation.'
                : 'Ta connexion bancaire expire dans moins de 14 jours. Reconnecte-toi pour ne pas interrompre la synchronisation.'}
            </p>
            <Button
              variant="outline"
              onClick={() => void handleConnect(list[0]?.institution ?? '')}
              disabled={connecting}
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reconnecter'}
            </Button>
          </div>
        )}

        {!isLoading && hasConnections && (
          <div className="space-y-2">
            {list.map((c) => {
              const meta = STATUS_META[c.status]
              const until = fmtValidUntil(c.validUntil)
              const noneLinked = c.accounts.length > 0 && !c.accounts.some((a) => a.linkedAccountId)
              return (
                <div key={c.id} className="space-y-3 rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <BankLogo logo={logoByName.get(c.institution) ?? null} className="h-11 w-11" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{c.institution}</p>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </div>
                      <p className="text-[12.5px] text-soft">
                        {until ? `Consentement valide jusqu'au ${until}.` : 'Consentement actif.'}
                      </p>
                    </div>
                  </div>

                  {c.accounts.length > 0 && (
                    <div className="space-y-2 border-t border-line/60 pt-3">
                      <p className="label-caps">Comptes à associer</p>
                      {c.accounts.map((acc) => (
                        <div key={acc.uid} className="flex flex-wrap items-center gap-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-medium">
                              {acc.product ?? acc.name ?? 'Compte bancaire'}
                            </p>
                            <p className="truncate text-[11.5px] text-soft tnum">
                              {acc.iban ? maskIban(acc.iban) : (acc.name ?? acc.uid)}
                            </p>
                          </div>
                          <Select
                            value={acc.linkedAccountId ?? ''}
                            onChange={(e) => void handleLink(c.id, acc.uid, e.target.value || null)}
                            className="min-w-[170px]"
                            aria-label="Associer a un compte local"
                          >
                            <option value="">Non associé</option>
                            {localAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                      ))}
                      {noneLinked && (
                        <p className="text-[12px] text-warning">
                          Associe au moins un compte pour que la synchronisation importe tes transactions.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="secondary" onClick={() => void handleSync()} disabled={syncing}>
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Synchroniser maintenant
              </Button>
              {syncMessage && <p className="text-[13px] text-soft">{syncMessage}</p>}
            </div>
          </div>
        )}

        {!isLoading && !hasConnections && (
          <div className="space-y-3">
            <div className="space-y-3 rounded-xl border border-line p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface2 text-soft">
                  <Landmark className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">Connecter ta banque</p>
                  <p className="text-[12.5px] text-soft">
                    Choisis ta banque puis autorise l'acces en lecture seule.
                  </p>
                </div>
              </div>

              {aspspsError ? (
                <p className="text-[13px] text-soft">
                  La liste des banques n'est pas encore disponible (configuration Enable Banking en attente).
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2.5">
                  <BankCombobox
                    aspsps={aspsps ?? []}
                    value={selectedBank}
                    onSelect={setSelectedBank}
                    loading={aspspsLoading}
                  />
                  <Button onClick={() => void handleConnect(selectedBank)} disabled={connecting || !selectedBank}>
                    {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connecter'}
                  </Button>
                </div>
              )}

              {connectMessage && <p className="text-[13px] text-soft">{connectMessage}</p>}
            </div>
            <p className="text-[12.5px] text-soft">
              Apres avoir autorise l'acces chez ta banque, tu seras redirige vers l'application pour finaliser la connexion.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
