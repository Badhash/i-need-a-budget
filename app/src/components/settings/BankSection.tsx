import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Download, Landmark, Loader2, Plus, Scale, X } from 'lucide-react'
import {
  useBankConnections,
  useAspsps,
  bankStartAuth,
  bankSync,
  bankReconcile,
  apiLinkBankAccount,
  type BankConnection,
} from '@/lib/bank'
import { fmtEUR, TODAY } from '@/lib/format'
import { apiCreateAccount, useAccountsList } from '@/lib/data'
import type { EbAccountLink } from '@/lib/bank'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { BankCombobox, BankLogo } from '@/components/settings/BankCombobox'
import { SyncHealth } from '@/components/settings/SyncHealth'
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

export function BankSection() {
  const queryClient = useQueryClient()
  const { data: connections, isLoading } = useBankConnections()
  const { data: aspsps, isLoading: aspspsLoading, isError: aspspsError } = useAspsps()
  const localAccounts = useAccountsList()
  const logoByName = new Map((aspsps ?? []).map((a) => [a.name, a.logo]))
  const [selectedBank, setSelectedBank] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectMessage, setConnectMessage] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [importDays, setImportDays] = useState('90')
  // Import cible sur UNE banque : evite de re-toucher (et re-dupliquer) les
  // autres comptes deja synchronises, ex. un CA importe depuis YNAB.
  const [importConnId, setImportConnId] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)

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

  // Selecteur de banque + bouton « Connecter », partage entre l'onboarding
  // (aucune connexion) et l'ajout d'une banque supplementaire.
  function renderConnectForm() {
    if (aspspsError) {
      return (
        <p className="text-[13px] text-soft">
          La liste des banques n'est pas encore disponible (configuration Enable Banking en attente).
        </p>
      )
    }
    return (
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
    )
  }

  // Importe l'historique bancaire (sinceDays), puis reconcilie les soldes
  // d'ouverture pour coller au solde bancaire reel.
  async function handleImportHistory() {
    const connId = importConnId || list[0]?.id
    if (!connId) return
    setImportMessage(null)
    setImporting(true)
    try {
      const { imported } = await bankSync(Number(importDays), connId)
      const { adjusted } = await bankReconcile()
      const totalDelta = adjusted.reduce((s, a) => s + a.delta, 0)
      const importedPart = `${imported} transaction${imported > 1 ? 's' : ''} importée${imported > 1 ? 's' : ''}`
      const deltaPart =
        totalDelta === 0 ? 'solde déjà exact' : `solde ajusté de ${fmtEUR(totalDelta)}`
      setImportMessage(`${importedPart}, ${deltaPart}.`)
      await queryClient.invalidateQueries()
    } catch {
      setImportMessage("Import de l'historique indisponible pour le moment.")
    } finally {
      setImporting(false)
    }
  }

  // Reconciliation seule : recale le solde de chaque compte associe sur le
  // solde bancaire reel (l'ecart est absorbe dans le solde d'ouverture).
  async function handleReconcile() {
    setImportMessage(null)
    setImporting(true)
    try {
      const { adjusted } = await bankReconcile()
      if (adjusted.length === 0) {
        setImportMessage('Les soldes sont déjà exacts.')
      } else {
        // On affiche le NOUVEAU solde (le solde bancaire reel), avec l'ajustement
        // applique entre parentheses — plus clair que le seul delta.
        const parts = adjusted.map(
          (a) => `${a.accountName} : ${fmtEUR(a.newBalance)} (ajusté de ${fmtEUR(a.delta)})`,
        )
        setImportMessage(`Soldes mis à jour — ${parts.join(' · ')}.`)
      }
      await queryClient.invalidateQueries()
    } catch {
      setImportMessage('Recalcul des soldes indisponible pour le moment.')
    } finally {
      setImporting(false)
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

  // Cree le compte local qui correspond au compte bancaire (type deduit du
  // libelle produit : carte a debit differe si ca ressemble a une carte),
  // l'associe, puis laisse la reconciliation d'import fixer le solde.
  async function handleCreateAndLink(c: BankConnection, acc: EbAccountLink) {
    const label = `${acc.product ?? ''} ${acc.name ?? ''}`.toUpperCase()
    const isCard = /\bDD\b|DEBIT DIFFERE|WORLD ELITE|CARTE|CARD|VISA|MASTERCARD|GOLD/.test(label)
    try {
      const { id } = await apiCreateAccount({
        name: acc.product ?? acc.name ?? 'Compte bancaire',
        institution: c.institution,
        kind: isCard ? 'card_deferred' : 'checking',
        onBudget: true,
        openingBalance: 0,
        openingDate: TODAY,
      })
      await apiLinkBankAccount({ connectionId: c.id, providerAccountUid: acc.uid, accountId: id })
      await queryClient.invalidateQueries()
      setSyncMessage(
        `Compte « ${acc.product ?? acc.name ?? 'Compte bancaire'} » créé et associé. Lance « Importer l'historique » pour récupérer les transactions et caler le solde.`,
      )
    } catch {
      setSyncMessage('Création du compte impossible pour le moment.')
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
                    <Button
                      variant="outline"
                      onClick={() => void handleConnect(c.institution)}
                      disabled={connecting}
                      className="h-9 px-3 text-[13px]"
                    >
                      {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reconnecter'}
                    </Button>
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
                              {acc.iban ?? acc.name ?? acc.uid}
                            </p>
                          </div>
                          <Select
                            value={acc.linkedAccountId ?? ''}
                            onChange={(e) => {
                              if (e.target.value === '__create__') {
                                void handleCreateAndLink(c, acc)
                              } else {
                                void handleLink(c.id, acc.uid, e.target.value || null)
                              }
                            }}
                            className="min-w-[170px]"
                            aria-label="Associer a un compte local"
                          >
                            <option value="">Non associé</option>
                            {localAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                            <option value="__create__">+ Créer un compte pour ce compte bancaire</option>
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

            <div className="rounded-xl border border-line p-4">
              <SyncHealth showHistory />
              {syncMessage && <p className="mt-3 text-[13px] text-soft">{syncMessage}</p>}
            </div>

            <div className="space-y-2 rounded-xl border border-line p-4">
              <p className="label-caps">Importer l'historique</p>
              <p className="text-[12.5px] text-soft">
                Choisis la banque : l'import ne concerne QUE celle-ci. Évite de l'utiliser sur un
                compte déjà rempli autrement (ex. import YNAB), au risque de créer des doublons.
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <Select
                  value={importConnId || list[0]?.id || ''}
                  onChange={(e) => setImportConnId(e.target.value)}
                  className="min-w-[170px]"
                  aria-label="Banque à importer"
                >
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.institution}
                    </option>
                  ))}
                </Select>
                <Select
                  value={importDays}
                  onChange={(e) => setImportDays(e.target.value)}
                  className="min-w-[140px]"
                  aria-label="Profondeur d'import de l'historique"
                >
                  <option value="30">30 jours</option>
                  <option value="90">90 jours</option>
                  <option value="180">180 jours</option>
                  <option value="365">365 jours</option>
                </Select>
                <Button
                  variant="outline"
                  onClick={() => void handleImportHistory()}
                  disabled={importing}
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Importer
                </Button>
                <Button variant="outline" onClick={() => void handleReconcile()} disabled={importing}>
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
                  Recalculer les soldes
                </Button>
                {importMessage && <p className="text-[13px] text-soft">{importMessage}</p>}
              </div>
              <p className="text-[12px] text-soft">
                L'import ajuste automatiquement le solde d'ouverture de chaque compte associé
                pour correspondre au solde bancaire réel. « Recalculer les soldes » fait ce
                recalage seul, sans réimporter de transactions.
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-line p-4">
              {adding ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">Ajouter une banque</p>
                      <p className="text-[12.5px] text-soft">
                        Choisis une autre banque puis autorise l'acces en lecture seule.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAdding(false)
                        setSelectedBank('')
                        setConnectMessage(null)
                      }}
                      className="h-11 w-11 shrink-0 p-0"
                      aria-label="Annuler l'ajout d'une banque"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {renderConnectForm()}
                  {connectMessage && <p className="text-[13px] text-soft">{connectMessage}</p>}
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setAdding(true)
                    setConnectMessage(null)
                  }}
                  className="min-h-11"
                >
                  <Plus className="h-4 w-4" />
                  Ajouter une banque
                </Button>
              )}
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

              {renderConnectForm()}

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
