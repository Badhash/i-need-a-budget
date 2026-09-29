// Section Reglages > Banque : cartes d'etat des connexions Enable Banking
// (consentement PSD2 et jours restants, comptes associes), synchronisation,
// outils d'historique et de soldes, ajout d'une banque. Sur l'app installee
// (ecran d'accueil), le consentement s'ouvre hors de l'app : on le dit, et on
// relit les connexions au retour.

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronDown,
  Download,
  Landmark,
  Link2,
  Plus,
  RefreshCw,
  Scale,
  Smartphone,
  X,
} from 'lucide-react'
import {
  useBankConnections,
  useAspsps,
  bankStartAuth,
  bankSync,
  bankReconcile,
  apiLinkBankAccount,
  standaloneConsent,
  type BankConnection,
  type EbAccountLink,
} from '@/lib/bank'
import { fmtEUR, today } from '@/lib/format'
import { apiCreateAccount, useAccountsList } from '@/lib/data'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ProgressBar, type ProgressTone } from '@/components/shared/ProgressBar'
import { BankCombobox, BankLogo } from '@/components/settings/BankCombobox'
import { SyncHealth } from '@/components/settings/SyncHealth'
import { Medallion } from '@/components/settings/shared/SettingsCard'
import { cn } from '@/lib/utils'

const STATUS_META: Record<BankConnection['status'], { label: string; variant: BadgeProps['variant'] }> = {
  active: { label: 'Connectée', variant: 'success' },
  expiring: { label: 'Expire bientôt', variant: 'warning' },
  expired: { label: 'Expirée', variant: 'danger' },
  pending: { label: 'En attente', variant: 'neutral' },
}

// Duree d'une session Enable Banking (consentement PSD2).
const CONSENT_DAYS = 180
const DAY = 86_400_000

function fmtValidUntil(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - Date.now()) / DAY))
}

// Marqueur d'un consentement lance depuis l'app installee : au retour dans
// l'app (page de nouveau visible), les connexions sont relues une fois.
const CONSENT_PENDING = 'inab-bank-consent'

function markConsentPending(): void {
  try {
    sessionStorage.setItem(CONSENT_PENDING, String(Date.now()))
  } catch {
    // Stockage indisponible : la relecture se fera au prochain chargement.
  }
}

function takeConsentPending(): boolean {
  try {
    const at = Number(sessionStorage.getItem(CONSENT_PENDING) ?? 0)
    sessionStorage.removeItem(CONSENT_PENDING)
    return at > 0 && Date.now() - at < 60 * 60 * 1000
  } catch {
    return false
  }
}

/** Avertissement de l'app installee : le consentement s'ouvre hors de l'app. */
function StandaloneNotice({ kind }: { kind: 'ios' | 'other' }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-accent/[0.07] px-4 py-3 ring-1 ring-inset ring-accent/15">
      <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-accent-ink dark:text-accent" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-[13.5px] font-medium text-ink">
          {kind === 'ios'
            ? 'Sur l’app installée, l’autorisation de ta banque s’ouvre dans Safari'
            : 'Sur l’app installée, l’autorisation de ta banque s’ouvre dans ton navigateur'}
        </p>
        <p className="text-[12.5px] leading-relaxed text-soft">
          Une fois l’accès accordé, reviens dans l’app depuis l’écran d’accueil : ta connexion apparaîtra ici. Si{' '}
          {kind === 'ios' ? 'Safari' : 'le navigateur'} te demande de te connecter, utilise les mêmes identifiants.
        </p>
      </div>
    </div>
  )
}

function ConsentGauge({ connection }: { connection: BankConnection }) {
  const left = daysLeft(connection.validUntil)
  if (left === null) return null
  const tone: ProgressTone =
    connection.status === 'expired' ? 'danger' : connection.status === 'expiring' ? 'warning' : 'success'
  return (
    <div className="space-y-1.5">
      <ProgressBar value={left / CONSENT_DAYS} tone={tone} size="sm" label="Durée restante du consentement" />
      <p className="flex justify-between gap-2 text-[12px] text-soft">
        <span>Consentement PSD2</span>
        <span className="tnum">
          {connection.status === 'expired'
            ? 'Expiré'
            : `${left} jour${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}`}
        </span>
      </p>
    </div>
  )
}

export function BankSection() {
  const queryClient = useQueryClient()
  const { data: connections, isLoading } = useBankConnections()
  const { data: aspsps, isLoading: aspspsLoading, isError: aspspsError } = useAspsps()
  const localAccounts = useAccountsList()
  const logoByName = new Map((aspsps ?? []).map((a) => [a.name, a.logo]))
  const standalone = standaloneConsent()
  const [selectedBank, setSelectedBank] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectMessage, setConnectMessage] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [importDays, setImportDays] = useState('90')
  // Import cible sur UNE banque : evite de re-toucher (et re-dupliquer) les
  // autres comptes deja synchronises, ex. un CA importe depuis YNAB.
  const [importConnId, setImportConnId] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)

  const list = connections ?? []
  const hasConnections = list.length > 0
  const stale = list.find((c) => c.status === 'expired') ?? list.find((c) => c.status === 'expiring')

  // Retour dans l'app installee apres un consentement ouvert hors de l'app :
  // bouton libere et connexions relues (le retour de redirection a pu se
  // finaliser dans le navigateur).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      setConnecting(false)
      if (takeConsentPending()) void queryClient.invalidateQueries({ queryKey: ['bankConnections'] })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [queryClient])

  // Redirige vers le consentement PSD2 de la banque choisie (aspspName).
  async function handleConnect(aspspName: string) {
    if (!aspspName) return
    setConnectMessage(null)
    setConnecting(true)
    try {
      const { url } = await bankStartAuth(window.location.origin + window.location.pathname, aspspName)
      if (standalone) markConsentPending()
      window.location.assign(url)
    } catch (err) {
      setConnectMessage(err instanceof Error ? err.message : 'Connexion bancaire indisponible.')
      setConnecting(false)
    }
  }

  // Invalidation scopee apres un import / une reconciliation : seules les
  // donnees reellement affectees (soldes, transactions, budget, rapports,
  // connexions, journaux) sont rechargees — pas un invalidateQueries() global.
  const invalidateBankData = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['budget'] }),
      queryClient.invalidateQueries({ queryKey: ['reports'] }),
      queryClient.invalidateQueries({ queryKey: ['bankConnections'] }),
      queryClient.invalidateQueries({ queryKey: ['syncLogs'] }),
    ])

  // Importe l'historique bancaire (sinceDays), puis reconcilie les soldes
  // d'ouverture pour coller au solde bancaire reel.
  async function handleImportHistory() {
    const connId = importConnId || list[0]?.id
    if (!connId) return
    setImportMessage(null)
    setImporting(true)
    try {
      const sync = await bankSync(Number(importDays), connId)
      // Un import d'historique reconcilie deja les soldes cote serveur : on ne
      // relance la reconciliation que si le resultat ne la contient pas (sinon
      // la seconde passe trouvait un ecart nul et affichait « solde déjà
      // exact » alors que le solde venait d'etre ajuste).
      const adjusted = sync.adjusted ?? (await bankReconcile()).adjusted
      const totalDelta = adjusted.reduce((s, a) => s + a.delta, 0)
      const importedPart = `${sync.imported} transaction${sync.imported > 1 ? 's' : ''} importée${sync.imported > 1 ? 's' : ''}`
      const deltaPart = totalDelta === 0 ? 'solde déjà exact' : `solde ajusté de ${fmtEUR(totalDelta)}`
      const errorPart = sync.errors && sync.errors.length > 0 ? ` Attention : ${sync.errors[0]}` : ''
      setImportMessage(`${importedPart}, ${deltaPart}.${errorPart}`)
      await invalidateBankData()
    } catch {
      setImportMessage('Import de l’historique indisponible pour le moment.')
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
        const parts = adjusted.map((a) => `${a.accountName} : ${fmtEUR(a.newBalance)} (ajusté de ${fmtEUR(a.delta)})`)
        setImportMessage(`Soldes mis à jour — ${parts.join(' · ')}.`)
      }
      await invalidateBankData()
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
      await queryClient.invalidateQueries({ queryKey: ['bankConnections'] })
    } catch {
      setSyncMessage('Association du compte impossible pour le moment. Réessaie dans un instant.')
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
        openingDate: today(),
      })
      await apiLinkBankAccount({ connectionId: c.id, providerAccountUid: acc.uid, accountId: id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['bankConnections'] }),
      ])
      setSyncMessage(
        `Compte « ${acc.product ?? acc.name ?? 'Compte bancaire'} » créé et associé. Lance « Importer l’historique » pour récupérer les transactions et caler le solde.`,
      )
    } catch {
      setSyncMessage('Création du compte impossible pour le moment.')
    }
  }

  // Selecteur de banque + bouton « Connecter », partage entre la premiere
  // connexion et l'ajout d'une banque supplementaire.
  function renderConnectForm() {
    if (aspspsError) {
      return (
        <p className="text-[13px] text-soft">
          La liste des banques n’est pas encore disponible (configuration Enable Banking en attente).
        </p>
      )
    }
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <BankCombobox aspsps={aspsps ?? []} value={selectedBank} onSelect={setSelectedBank} loading={aspspsLoading} />
        <Button
          onClick={() => void handleConnect(selectedBank)}
          disabled={connecting || !selectedBank}
          className="w-full sm:w-auto"
        >
          <Link2 className="h-4 w-4" />
          {connecting ? 'Ouverture…' : 'Connecter'}
        </Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </Card>
    )
  }

  if (!hasConnections) {
    return (
      <Card variant="hero" className="p-5 lg:p-6">
        <div className="space-y-4">
          <div className="flex items-start gap-3.5">
            <Medallion icon={Landmark} tone="accent" size="lg" />
            <div className="min-w-0">
              <p className="text-[16px] font-semibold tracking-tight">Connecte ta banque</p>
              <p className="text-[13px] leading-relaxed text-soft">
                Accès en lecture seule via Enable Banking (PSD2) : tes transactions arrivent seules, deux fois par jour.
              </p>
            </div>
          </div>
          {standalone && <StandaloneNotice kind={standalone} />}
          {renderConnectForm()}
          {connectMessage && <p className="text-[13px] text-danger">{connectMessage}</p>}
          <p className="text-[12.5px] text-soft">
            Après avoir autorisé l’accès chez ta banque, tu reviens dans l’app pour finaliser la connexion.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {stale && (
        <Card className="flex flex-wrap items-center gap-3 border-warning/30 bg-warning/[0.07] p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <AlertTriangle className="h-[18px] w-[18px]" />
          </span>
          <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-ink">
            {stale.status === 'expired'
              ? `L’accès à ${stale.institution} a expiré : reconnecte-toi pour reprendre la synchronisation.`
              : `L’accès à ${stale.institution} expire dans moins de 14 jours : reconnecte-toi pour ne rien interrompre.`}
          </p>
          <Button
            variant="outline"
            // Reconnecte la connexion QUI EXPIRE (pas la premiere de la liste :
            // avec deux banques, le flow partait vers la mauvaise).
            onClick={() => void handleConnect(stale.institution)}
            disabled={connecting}
            className="w-full sm:w-auto"
          >
            {connecting ? 'Ouverture…' : 'Reconnecter'}
          </Button>
        </Card>
      )}

      {standalone && <StandaloneNotice kind={standalone} />}

      {list.map((c) => {
        const meta = STATUS_META[c.status]
        const until = fmtValidUntil(c.validUntil)
        const noneLinked = c.accounts.length > 0 && !c.accounts.some((a) => a.linkedAccountId)
        return (
          <Card key={c.id} className="overflow-hidden">
            <div className="space-y-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-3">
                <BankLogo logo={logoByName.get(c.institution) ?? null} className="h-12 w-12 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[16px] font-semibold tracking-tight">{c.institution}</p>
                    <Badge variant={meta.variant} dot>
                      {meta.label}
                    </Badge>
                  </div>
                  <p className="text-[12.5px] text-soft">
                    {until ? `Accès valide jusqu’au ${until}` : 'Consentement en cours de finalisation.'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleConnect(c.institution)}
                  disabled={connecting}
                  className="hidden sm:inline-flex"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reconnecter
                </Button>
              </div>
              <ConsentGauge connection={c} />
              <Button
                variant="outline"
                onClick={() => void handleConnect(c.institution)}
                disabled={connecting}
                className="w-full sm:hidden"
              >
                <RefreshCw className="h-4 w-4" />
                {connecting ? 'Ouverture…' : 'Reconnecter'}
              </Button>
            </div>

            {c.accounts.length > 0 && (
              <div className="space-y-2.5 border-t border-line/70 bg-surface2/30 p-4 sm:p-5">
                <p className="label-caps">Comptes de la banque</p>
                {c.accounts.map((acc) => (
                  <div key={acc.uid} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate text-[14px] font-medium">{acc.product ?? acc.name ?? 'Compte bancaire'}</p>
                      <p className="truncate text-[12px] text-soft tnum">{acc.iban ?? acc.name ?? acc.uid}</p>
                    </div>
                    <Combobox
                      options={[
                        { value: '', label: 'Non associé' },
                        ...localAccounts
                          .filter((a) => !a.closed || a.id === acc.linkedAccountId)
                          .map((a) => ({ value: a.id, label: a.name })),
                        { value: '__create__', label: '+ Créer un compte pour ce compte bancaire' },
                      ]}
                      value={acc.linkedAccountId ?? ''}
                      onChange={(v) => {
                        if (v === '__create__') void handleCreateAndLink(c, acc)
                        else void handleLink(c.id, acc.uid, v || null)
                      }}
                      placeholder="Non associé"
                      searchPlaceholder="Rechercher un compte…"
                      className="w-full sm:w-64"
                      aria-label={`Associer ${acc.product ?? acc.name ?? 'ce compte bancaire'} à un compte de l’app`}
                    />
                  </div>
                ))}
                {noneLinked && (
                  <p className="text-[12.5px] text-warning">
                    Associe au moins un compte pour que la synchronisation importe tes transactions.
                  </p>
                )}
              </div>
            )}
          </Card>
        )
      })}

      <Card className="p-4 sm:p-5">
        <SyncHealth showHistory />
        {syncMessage && <p className="mt-3 text-[13px] text-soft">{syncMessage}</p>}
      </Card>

      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setToolsOpen((o) => !o)}
          aria-expanded={toolsOpen}
          className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink/[0.02] sm:px-5"
        >
          <Medallion icon={Scale} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-medium">Historique et soldes</span>
            <span className="block text-[12.5px] text-soft">Importer des transactions passées, recaler les soldes</span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-soft transition-transform duration-200 ease-spring',
              toolsOpen && 'rotate-180',
            )}
          />
        </button>
        {toolsOpen && (
          <div className="animate-fade-up space-y-3 border-t border-line/70 p-4 sm:p-5">
            <p className="text-[12.5px] leading-relaxed text-soft">
              L’import ne concerne QUE la banque choisie. Évite-le sur un compte déjà rempli autrement (import YNAB), au
              risque de créer des doublons. Il recale ensuite le solde d’ouverture sur le solde bancaire réel.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Select
                value={importConnId || list[0]?.id || ''}
                onChange={(e) => setImportConnId(e.target.value)}
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
                aria-label="Profondeur d'import de l'historique"
              >
                <option value="30">30 jours</option>
                <option value="90">90 jours</option>
                <option value="180">180 jours</option>
                <option value="365">365 jours</option>
              </Select>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => void handleImportHistory()} disabled={importing}>
                <Download className="h-4 w-4" />
                {importing ? 'En cours…' : 'Importer l’historique'}
              </Button>
              <Button variant="outline" onClick={() => void handleReconcile()} disabled={importing}>
                <Scale className="h-4 w-4" />
                Recalculer les soldes
              </Button>
            </div>
            {importMessage && (
              <p className="rounded-xl bg-surface2/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
                {importMessage}
              </p>
            )}
          </div>
        )}
      </Card>

      {adding ? (
        <Card className="animate-fade-up space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">Ajouter une banque</p>
              <p className="text-[12.5px] text-soft">Choisis-la, puis autorise l’accès en lecture seule.</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setAdding(false)
                setSelectedBank('')
                setConnectMessage(null)
              }}
              aria-label="Annuler l’ajout d’une banque"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {renderConnectForm()}
          {connectMessage && <p className="text-[13px] text-danger">{connectMessage}</p>}
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true)
            setConnectMessage(null)
          }}
          className="pressable flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-[14px] font-medium text-soft transition-colors hover:border-accent/50 hover:text-accent-ink"
        >
          <Plus className="h-4 w-4" />
          Ajouter une banque
        </button>
      )}
    </div>
  )
}
