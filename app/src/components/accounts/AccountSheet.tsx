// Feuille d'un compte : details (solde, courbe, derniere operation) et toutes
// ses actions, en vues successives dans UNE feuille (mobile : feuille basse
// ouverte au toucher de la carte ; desktop : modale ouverte directement sur
// l'action choisie). Chaque validation est optimiste : la feuille se ferme
// aussitot et le changement est deja visible derriere.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Info,
  Landmark,
  Pencil,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import {
  ADJUSTMENT_LABEL,
  buildAdjustment,
  closedToastId,
  inclusionEffectFromCaches,
  latestAccountId,
  openingIncomeCategory,
  sparkSampleDates,
  useAdjustBalance,
  useDeleteAccount,
  useSetAccountFlags,
  useUpdateAccount,
  type AccountStats,
} from '@/lib/accounts'
import { useAccountsList, useCategoriesList, useTransactions, type AccountWithBalance } from '@/lib/data'
import { fmtDateShort, fmtEUR, fmtEURSigned } from '@/lib/format'
import { isTempId } from '@/lib/mutationQueue'
import { toast } from '@/lib/toast'
import { haptic } from '@/lib/haptics'
import { useUiStore } from '@/stores/ui'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'
import { Amount } from '@/components/shared/Amount'
import { Aura } from '@/components/shared/Aura'
import { SignedAmountInput } from '@/components/shared/SignedAmountInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  AccountFields,
  emptyDraft,
  parseSignedEuros,
  validateDraft,
  type AccountDraft,
  type DraftField,
} from './AccountFields'
import { balanceClass, LinkBadge, type AccountActions, type LinkStatus, type SheetView } from './AccountCard'
import { KIND_META, KindPill, fmtLastActivity, quoted } from './accountKinds'
import { Sparkline } from './Sparkline'
import { SwitchTrack } from './Switch'

export interface SheetTarget {
  accountId: string
  view: SheetView
}

interface AccountSheetProps {
  target: SheetTarget | null
  onClose: () => void
  stats: Map<string, AccountStats> | null
  linkOf: (accountId: string) => LinkStatus | undefined
  flags: boolean
  actions: AccountActions
}

/**
 * Feuille d'un compte, pilotee par la page (compte + vue initiale). Le compte
 * est relu dans le cache a chaque rendu : solde et nom restent vivants, un id
 * temporaire est suivi jusqu'a son id serveur, et un compte disparu ferme la
 * feuille.
 */
export function AccountSheet({ target, onClose, stats, linkOf, flags, actions }: AccountSheetProps) {
  const accounts = useAccountsList()
  const account = target ? accounts.find((a) => a.id === latestAccountId(target.accountId)) : undefined
  // Derniers contenus affiches : la feuille garde son contenu pendant son
  // animation de sortie (compte supprime, feuille fermee).
  const last = useRef<{ account: AccountWithBalance; target: SheetTarget } | null>(null)
  if (account && target) last.current = { account, target }

  useEffect(() => {
    if (target && accounts.length > 0 && !account) onClose()
  }, [target, account, accounts.length, onClose])

  const shown = last.current
  const open = target !== null && account !== undefined
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {shown && (
          <SheetBody
            // Nouvelle ouverture = etat neuf (vue, saisies).
            key={`${shown.target.accountId}:${shown.target.view}`}
            account={shown.account}
            initialView={shown.target.view}
            stats={stats?.get(shown.account.id)}
            link={linkOf(shown.account.id)}
            flags={flags}
            actions={actions}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface BodyProps {
  account: AccountWithBalance
  initialView: SheetView
  stats: AccountStats | undefined
  link: LinkStatus | undefined
  flags: boolean
  actions: AccountActions
  onClose: () => void
}

function SheetBody({ account, initialView, stats, link, flags, actions, onClose }: BodyProps) {
  const [view, setView] = useState<SheetView>(initialView)
  // Retour possible seulement depuis le menu (parcours mobile) ; ouverte
  // directement sur une action (desktop), la feuille se ferme a l'annulation.
  const back = initialView === 'menu' && view !== 'menu' ? () => setView('menu') : undefined
  const cancel = back ?? onClose
  // Cloture : immediate a solde nul (feuille fermee, toast avec Annuler),
  // sinon explication dans la feuille (ajuster a 0 ou virer le reste).
  const requestClose = () => {
    if (account.balance !== 0) {
      setView('close')
      return
    }
    onClose()
    actions.close(account)
  }

  return (
    <div key={view} className="flex min-h-0 flex-1 animate-fade-up flex-col">
      {view === 'menu' && (
        <MenuView
          account={account}
          stats={stats}
          link={link}
          flags={flags}
          actions={actions}
          onView={setView}
          onClose={onClose}
          onRequestClose={requestClose}
        />
      )}
      {view === 'adjust' && <AdjustView account={account} onBack={back} onCancel={cancel} onDone={onClose} />}
      {view === 'edit' && <EditView account={account} onBack={back} onCancel={cancel} onDone={onClose} />}
      {view === 'budget' && flags && <BudgetView account={account} onBack={back} onCancel={cancel} onDone={onClose} />}
      {view === 'close' && flags && <CloseView account={account} onBack={back} onCancel={cancel} onDone={onClose} />}
      {view === 'delete' && (
        <DeleteView
          account={account}
          flags={flags}
          onRequestClose={requestClose}
          onBack={back}
          onCancel={cancel}
          onDone={onClose}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------

function SheetHeader({
  title,
  description,
  onBack,
}: {
  title: ReactNode
  description: ReactNode
  onBack?: () => void
}) {
  return (
    <DialogHeader className="pr-14">
      <div className="flex items-start gap-1.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="relative -ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-soft transition-[background-color,color,transform] duration-150 ease-spring after:absolute after:-inset-1.5 after:content-[''] hover:bg-surface2 hover:text-ink active:scale-90"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <DialogTitle className="leading-8">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
      </div>
    </DialogHeader>
  )
}

function ActionRow({
  icon: Icon,
  title,
  description,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: LucideIcon
  title: string
  description?: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[60px] w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-ink/[0.03] active:bg-ink/[0.06] disabled:pointer-events-none disabled:opacity-45"
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          danger ? 'bg-danger/10 text-danger' : 'bg-surface2 text-ink',
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[15px] font-medium leading-snug', danger ? 'text-danger' : 'text-ink')}>
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-[12.5px] leading-snug text-soft">{description}</span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-soft/70" />
    </button>
  )
}

/** Tuile d'effet (apercu d'une action sur le Pret a assigner ou le solde). */
function EffectTile({
  tone,
  icon: Icon,
  label,
  amount,
  signed = true,
  children,
}: {
  tone: 'success' | 'danger' | 'neutral'
  icon: LucideIcon
  label: string
  amount: number
  signed?: boolean
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-2xl border p-4',
        tone === 'success' && 'border-success/20 bg-success/[0.06]',
        tone === 'danger' && 'border-danger/20 bg-danger/[0.06]',
        tone === 'neutral' && 'border-edge bg-surface2/60',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            tone === 'success' && 'bg-success/15 text-success',
            tone === 'danger' && 'bg-danger/15 text-danger',
            tone === 'neutral' && 'bg-ink/[0.06] text-soft',
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="label-caps">{label}</p>
          <Amount
            cents={amount}
            signed={signed && amount !== 0}
            animate
            className={cn(
              'mt-0.5 block text-[22px] font-semibold tracking-tight',
              tone === 'success' && 'text-success',
              tone === 'danger' && 'text-danger',
              tone === 'neutral' && 'text-ink',
            )}
          />
        </div>
      </div>
      {children && <div className="mt-3 text-[13.5px] leading-relaxed text-ink/85">{children}</div>}
    </div>
  )
}

function Bullets({ items }: { items: ReactNode[] }) {
  const shown = items.filter(Boolean)
  if (shown.length === 0) return null
  return (
    <ul className="space-y-2">
      {shown.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug text-soft">
          <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-soft/50" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function useTransactionCount(accountId: string): number {
  const { data } = useTransactions()
  return useMemo(() => (data ? data.filter((t) => t.accountId === accountId).length : 0), [data, accountId])
}

// ---------------------------------------------------------------------------
// Vue « menu » : details + actions (mobile)
// ---------------------------------------------------------------------------

function MenuView({
  account,
  stats,
  link,
  flags,
  actions,
  onView,
  onClose,
  onRequestClose,
}: {
  account: AccountWithBalance
  stats: AccountStats | undefined
  link: LinkStatus | undefined
  flags: boolean
  actions: AccountActions
  onView: (view: SheetView) => void
  onClose: () => void
  onRequestClose: () => void
}) {
  const navigate = useNavigate()
  const meta = KIND_META[account.kind]
  const pending = isTempId(account.id)
  const closed = account.closed === true
  const firstSample = sparkSampleDates()[0]!

  return (
    <>
      <DialogHeader className="pb-3 pr-14">
        <div className="flex items-center gap-3.5">
          <KindPill kind={account.kind} size="lg" muted={closed} />
          <div className="min-w-0">
            <DialogTitle className="truncate">{account.name}</DialogTitle>
            <DialogDescription className="truncate">
              {account.institution} · {meta.label}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        <div className="relative isolate overflow-hidden rounded-2xl border border-edge bg-surface p-4 shadow-card">
          <Aura tone={account.balance < 0 ? 'danger' : account.onBudget ? 'accent' : 'neutral'} intensity="soft" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label-caps">Solde</p>
              <Amount
                cents={account.balance}
                size="xl"
                animate
                className={cn('mt-0.5 block', balanceClass(account.balance))}
              />
              <p className="mt-1 text-[12.5px] text-soft">
                {pending
                  ? 'Création en cours…'
                  : stats?.lastActivity
                    ? `Dernière opération : ${fmtLastActivity(stats.lastActivity).toLowerCase()}`
                    : 'Aucune opération'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5 pt-0.5">
              <Badge variant={closed ? 'outline' : account.onBudget ? 'accent' : 'neutral'} size="sm">
                {closed ? 'Clôturé' : account.onBudget ? 'Budget' : 'Suivi'}
              </Badge>
              <LinkBadge status={link} />
            </div>
          </div>
          {stats && (
            <>
              <Sparkline
                values={stats.series}
                tone={account.onBudget ? 'accent' : 'aura'}
                className="mt-4 h-16 w-full"
              />
              <div className="mt-2 flex justify-between text-[12px] text-soft">
                <span>{fmtDateShort(firstSample)}</span>
                <span>Aujourd'hui</span>
              </div>
            </>
          )}
        </div>

        <div className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-edge bg-surface shadow-card">
          <ActionRow
            icon={ArrowUpRight}
            title="Voir les transactions"
            description={pending ? 'Disponible dès la création du compte' : undefined}
            disabled={pending}
            onClick={() => {
              onClose()
              void navigate({ to: '/transactions', search: { compte: account.id } })
            }}
          />
          {!closed && (
            <>
              <ActionRow
                icon={SlidersHorizontal}
                title="Ajuster le solde"
                description="L'aligner sur le solde réel de la banque"
                onClick={() => onView('adjust')}
              />
              <ActionRow
                icon={Pencil}
                title="Modifier"
                description="Nom, banque, type"
                onClick={() => onView('edit')}
              />
            </>
          )}
          {flags && !closed && (
            <button
              type="button"
              role="switch"
              aria-checked={account.onBudget}
              onClick={() => onView('budget')}
              className="flex min-h-[60px] w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-ink/[0.03] active:bg-ink/[0.06]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface2 text-ink">
                <Landmark className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-snug text-ink">Inclus dans le budget</span>
                <span className="mt-0.5 block truncate text-[12.5px] leading-snug text-soft">
                  {account.onBudget ? 'Il alimente les enveloppes' : 'Compte de suivi, hors budget'}
                </span>
              </span>
              <SwitchTrack checked={account.onBudget} />
            </button>
          )}
          {flags && !closed && (
            <ActionRow
              icon={Archive}
              title="Clôturer le compte"
              description={
                account.balance === 0 ? 'Le ranger dans les comptes clôturés' : "Son solde doit d'abord revenir à 0"
              }
              onClick={onRequestClose}
            />
          )}
          {flags && closed && (
            <ActionRow
              icon={ArchiveRestore}
              title="Rouvrir le compte"
              description="Le remettre parmi les comptes actifs"
              onClick={() => {
                onClose()
                actions.reopen(account)
              }}
            />
          )}
          <ActionRow icon={Trash2} title="Supprimer le compte" danger onClick={() => onView('delete')} />
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Vue « ajuster le solde »
// ---------------------------------------------------------------------------

function AdjustView({
  account,
  onBack,
  onCancel,
  onDone,
  presetZero = false,
  closeAfter = false,
}: {
  account: AccountWithBalance
  onBack?: () => void
  onCancel: () => void
  onDone: () => void
  presetZero?: boolean
  /** « Ajuster à 0 et clôturer » : la cloture suit l'ajustement (meme tache). */
  closeAfter?: boolean
}) {
  const queryClient = useQueryClient()
  const categories = useCategoriesList()
  const adjust = useAdjustBalance()
  const inset = useSheetKeyboardInset()
  const [raw, setRaw] = useState(presetZero ? '0' : '')
  const [touched, setTouched] = useState(false)

  const target = raw.trim() ? parseSignedEuros(raw) : null
  const invalid = raw.trim() !== '' && target === null
  const delta = target === null ? null : target - account.balance
  const income = account.onBudget ? openingIncomeCategory(categories) : undefined

  const submit = () => {
    setTouched(true)
    if (target === null) return
    const vars = buildAdjustment(queryClient, account.id, target)
    if (!vars) {
      onDone()
      return
    }
    haptic(10)
    adjust.mutate({ ...vars, closeAfter })
    const amount = fmtEUR(Math.abs(vars.delta))
    const effect = !account.onBudget
      ? 'écart enregistré hors budget (compte de suivi).'
      : !vars.categoryId
        ? 'écart enregistré, à catégoriser.'
        : vars.delta > 0
          ? `${amount} ajoutés au Prêt à assigner.`
          : `${amount} retirés du Prêt à assigner.`
    toast(
      closeAfter
        ? {
            id: closedToastId(account.id),
            message: `${quoted(account.name)} clôturé`,
            description: `Solde ajusté à 0 : ${effect}`,
            tone: 'success',
          }
        : { message: 'Solde ajusté', description: effect.charAt(0).toUpperCase() + effect.slice(1), tone: 'success' },
    )
    onDone()
  }

  let effect: ReactNode = null
  if (delta !== null && delta !== 0) {
    const toRta = account.onBudget && income !== undefined
    effect = (
      <EffectTile
        tone={toRta ? (delta > 0 ? 'success' : 'danger') : 'neutral'}
        icon={delta > 0 ? TrendingUp : TrendingDown}
        label="Écart"
        amount={delta}
      >
        {toRta
          ? delta > 0
            ? "L'écart est ajouté au Prêt à assigner."
            : "L'écart est retiré du Prêt à assigner."
          : account.onBudget
            ? "L'écart sera à catégoriser."
            : "Compte de suivi : l'écart reste hors budget."}{' '}
        <span className="text-soft">Une transaction {quoted(ADJUSTMENT_LABEL)} est créée aujourd'hui.</span>
      </EffectTile>
    )
  } else if (delta === 0) {
    effect = (
      <p className="flex items-center gap-2 rounded-2xl bg-surface2/70 px-4 py-3 text-[13.5px] text-soft">
        <Info className="h-4 w-4 shrink-0" />
        Le solde est déjà juste : rien à ajuster.
      </p>
    )
  }

  return (
    <>
      <SheetHeader
        title="Ajuster le solde"
        description={`${quoted(account.name)} : saisissez le solde réel.`}
        onBack={onBack}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-2 pt-2">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <span className="label-caps">Solde actuel</span>
          <Amount
            cents={account.balance}
            animate
            className={cn('text-[15px] font-semibold', balanceClass(account.balance))}
          />
        </div>
        <SignedAmountInput
          size="lg"
          value={raw}
          onChange={setRaw}
          onEnter={submit}
          placeholder={fmtEUR(account.balance).replace(/\s?€/, '')}
          invalid={invalid && touched}
          autoFocus
          aria-label="Solde réel"
        />
        {account.balance !== 0 && raw.trim() !== '0' && (
          <button
            type="button"
            onClick={() => setRaw('0')}
            className="relative inline-flex h-9 items-center rounded-full border border-line px-3.5 text-[13px] font-medium text-soft transition-colors after:absolute after:-inset-1 after:content-[''] hover:border-soft/40 hover:text-ink"
          >
            Solde à 0
          </button>
        )}
        {invalid && touched && (
          <p className="text-[13px] font-medium text-danger">Saisissez un montant valide, par exemple -1234,56.</p>
        )}
        {effect}
      </div>
      <DialogFooter style={inset ? { paddingBottom: inset + 20 } : undefined}>
        <Button variant="ghost" onClick={onCancel}>
          {onBack ? 'Retour' : 'Annuler'}
        </Button>
        <Button onClick={submit} disabled={target === null || delta === 0}>
          {closeAfter ? 'Ajuster et clôturer' : 'Ajuster le solde'}
        </Button>
      </DialogFooter>
    </>
  )
}

// ---------------------------------------------------------------------------
// Vue « modifier »
// ---------------------------------------------------------------------------

function EditView({
  account,
  onBack,
  onCancel,
  onDone,
}: {
  account: AccountWithBalance
  onBack?: () => void
  onCancel: () => void
  onDone: () => void
}) {
  const update = useUpdateAccount()
  const inset = useSheetKeyboardInset()
  const [draft, setDraft] = useState<AccountDraft>(() =>
    emptyDraft({ kind: account.kind, name: account.name, institution: account.institution }),
  )
  const [error, setError] = useState<{ message: string; field?: DraftField } | null>(null)

  const submit = () => {
    const check = validateDraft(draft, false)
    if (check.error) {
      setError({ message: check.error, field: check.field })
      return
    }
    const name = draft.name.trim()
    const institution = draft.institution.trim()
    if (name !== account.name || institution !== account.institution || draft.kind !== account.kind) {
      update.mutate({ accountId: account.id, name, institution, kind: draft.kind })
    }
    onDone()
  }

  return (
    <>
      <SheetHeader
        title="Modifier le compte"
        description={`Nom, banque et type. Le solde se corrige avec ${quoted('Ajuster le solde')}.`}
        onBack={onBack}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-2">
        <AccountFields
          draft={draft}
          onChange={(next) => {
            setDraft(next)
            if (error) setError(null)
          }}
          withOpening={false}
          invalidField={error?.field}
          onSubmit={submit}
        />
        {error && <p className="mt-3 text-[13px] font-medium text-danger">{error.message}</p>}
      </div>
      <DialogFooter style={inset ? { paddingBottom: inset + 20 } : undefined}>
        <Button variant="ghost" onClick={onCancel}>
          {onBack ? 'Retour' : 'Annuler'}
        </Button>
        <Button onClick={submit}>Enregistrer</Button>
      </DialogFooter>
    </>
  )
}

// ---------------------------------------------------------------------------
// Vue « inclure dans le budget / passer en suivi » (accountFlags)
// ---------------------------------------------------------------------------

function BudgetView({
  account,
  onBack,
  onCancel,
  onDone,
}: {
  account: AccountWithBalance
  onBack?: () => void
  onCancel: () => void
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const month = useUiStore((s) => s.month)
  const setFlags = useSetAccountFlags()
  const toTracking = account.onBudget
  const next = !account.onBudget
  // Apercu fige a l'ouverture (les caches ne bougent pas pendant la lecture).
  const effect = useMemo(
    () => inclusionEffectFromCaches(queryClient, account.id, next, month),
    [queryClient, account.id, next, month],
  )

  const confirm = () => {
    setFlags.mutate({ accountId: account.id, onBudget: next })
    haptic(10)
    toast({
      message: toTracking ? `${quoted(account.name)} passé en suivi` : `${quoted(account.name)} inclus dans le budget`,
      description: toTracking
        ? 'Ses transactions sont sorties du budget.'
        : 'Ses transactions comptent désormais dans le budget.',
      tone: 'success',
    })
    onDone()
  }

  const rta = effect?.rtaDelta ?? 0
  const verb = toTracking ? 'sortiront du' : 'entreront dans le'
  const lead =
    rta === 0
      ? `Ses transactions ${verb} budget, sans effet sur le Prêt à assigner.`
      : `Ses transactions ${verb} budget : le Prêt à assigner va ${rta < 0 ? 'baisser' : 'monter'} de ${fmtEUR(Math.abs(rta))}.`
  const uncat = effect?.uncategorizedDelta ?? 0
  const envelopes = effect?.envelopeActivity ?? 0

  return (
    <>
      <SheetHeader
        title={toTracking ? 'Passer en suivi ?' : 'Inclure dans le budget ?'}
        description={`${quoted(account.name)} · ${toTracking ? 'compte budget' : 'compte de suivi'}`}
        onBack={onBack}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-2 pt-2">
        <EffectTile
          tone={rta > 0 ? 'success' : rta < 0 ? 'danger' : 'neutral'}
          icon={rta >= 0 ? TrendingUp : TrendingDown}
          label="Prêt à assigner"
          amount={rta}
        >
          {lead}
        </EffectTile>
        <Bullets
          items={[
            envelopes !== 0 &&
              (toTracking
                ? `Ses opérations catégorisées (${fmtEURSigned(envelopes)}) quitteront leurs enveloppes.`
                : `Ses opérations déjà catégorisées (${fmtEURSigned(envelopes)}) compteront dans leurs enveloppes.`),
            uncat > 0 &&
              `${uncat} transaction${uncat > 1 ? 's' : ''} sans catégorie ${uncat > 1 ? 'seront' : 'sera'} à catégoriser.`,
            uncat < 0 &&
              `${-uncat} transaction${uncat < -1 ? 's' : ''} ne ${uncat < -1 ? 'seront' : 'sera'} plus à catégoriser.`,
            toTracking
              ? 'Son solde reste compté dans la valeur nette.'
              : 'Pour que son argent rejoigne le Prêt à assigner, catégorisez ses entrées en revenus.',
            'Réversible à tout moment.',
          ]}
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {onBack ? 'Retour' : 'Annuler'}
        </Button>
        <Button onClick={confirm}>{toTracking ? 'Passer en suivi' : 'Inclure dans le budget'}</Button>
      </DialogFooter>
    </>
  )
}

// ---------------------------------------------------------------------------
// Vue « clôturer » (solde non nul, accountFlags)
// ---------------------------------------------------------------------------

function CloseView({
  account,
  onBack,
  onCancel,
  onDone,
}: {
  account: AccountWithBalance
  onBack?: () => void
  onCancel: () => void
  onDone: () => void
}) {
  const navigate = useNavigate()
  const categories = useCategoriesList()
  const setFlags = useSetAccountFlags()
  const [adjusting, setAdjusting] = useState(false)
  const income = account.onBudget ? openingIncomeCategory(categories) : undefined

  const closeNow = () => {
    setFlags.mutate({ accountId: account.id, closed: true })
    toast({
      message: `${quoted(account.name)} clôturé`,
      description: 'Rangé dans les comptes clôturés.',
      tone: 'success',
    })
  }

  // Solde revenu a 0 pendant la lecture : la cloture directe devient possible.
  if (account.balance === 0 && !adjusting) {
    return (
      <>
        <SheetHeader
          title="Clôturer le compte"
          description={`${quoted(account.name)} a un solde nul.`}
          onBack={onBack}
        />
        <div className="min-h-0 flex-1 px-5 pb-2 pt-2">
          <p className="text-[14px] leading-relaxed text-soft">
            Il sera rangé dans les comptes clôturés, hors des listes et des sélecteurs. Vous pourrez le rouvrir à tout
            moment.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {onBack ? 'Retour' : 'Annuler'}
          </Button>
          <Button
            onClick={() => {
              closeNow()
              onDone()
            }}
          >
            Clôturer
          </Button>
        </DialogFooter>
      </>
    )
  }

  if (adjusting) {
    return (
      <AdjustView
        account={account}
        presetZero
        onBack={() => setAdjusting(false)}
        onCancel={() => setAdjusting(false)}
        onDone={onDone}
        closeAfter
      />
    )
  }

  const positive = account.balance > 0
  return (
    <>
      <SheetHeader title="Clôturer le compte" description="Son solde doit d'abord revenir à 0." onBack={onBack} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-2 pt-2">
        <EffectTile tone="neutral" icon={Archive} label="Solde actuel" amount={account.balance} signed={false}>
          Ramenez-le à 0 : ajustez le solde à 0, ou virez le reste vers un autre compte.
        </EffectTile>
        <Bullets
          items={[
            income &&
              `L'ajustement ${positive ? 'retire' : 'ajoute'} ${fmtEUR(Math.abs(account.balance))} ${positive ? 'du' : 'au'} Prêt à assigner.`,
            `Pour virer le reste : saisissez la sortie sur ce compte, puis ${quoted('Convertir en virement vers…')}.`,
          ]}
        />
      </div>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => {
            onDone()
            void navigate({ to: '/transactions', search: { compte: account.id } })
          }}
          disabled={isTempId(account.id)}
        >
          Voir les transactions
        </Button>
        <Button onClick={() => setAdjusting(true)}>Ajuster à 0 et clôturer</Button>
      </DialogFooter>
    </>
  )
}

// ---------------------------------------------------------------------------
// Vue « supprimer »
// ---------------------------------------------------------------------------

function DeleteView({
  account,
  flags,
  onRequestClose,
  onBack,
  onCancel,
  onDone,
}: {
  account: AccountWithBalance
  flags: boolean
  onRequestClose: () => void
  onBack?: () => void
  onCancel: () => void
  onDone: () => void
}) {
  const remove = useDeleteAccount()
  const count = useTransactionCount(account.id)

  const confirm = () => {
    remove.mutate({ accountId: account.id })
    haptic([10, 40, 10])
    toast({
      message: `${quoted(account.name)} supprimé`,
      description: `${count} transaction${count > 1 ? 's' : ''} supprimée${count > 1 ? 's' : ''}.`,
    })
    onDone()
  }

  return (
    <>
      <SheetHeader
        title={`Supprimer ${quoted(account.name)}\u00a0?`}
        description="Cette action est définitive."
        onBack={onBack}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-2 pt-2">
        <div className="flex gap-3.5 rounded-2xl border border-danger/20 bg-danger/[0.06] p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
            <Trash2 className="h-5 w-5" />
          </span>
          <p className="text-[14px] leading-relaxed text-ink/90">
            Le compte et {count === 0 ? 'son historique' : `ses ${count} transaction${count > 1 ? 's' : ''}`} seront
            supprimés définitivement. Les virements liés sur d'autres comptes sont conservés, déliés (à recatégoriser).
          </p>
        </div>
        {flags && !account.closed && (
          <button
            type="button"
            onClick={onRequestClose}
            className="flex w-full items-center gap-3 rounded-2xl bg-surface2/70 px-4 py-3 text-left transition-colors hover:bg-surface2"
          >
            <Archive className="h-4 w-4 shrink-0 text-soft" />
            <span className="flex-1 text-[13.5px] text-soft">
              Pour garder l'historique, <span className="font-medium text-ink">clôturez-le plutôt</span>.
            </span>
            <ChevronRight className="h-4 w-4 text-soft/70" />
          </button>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {onBack ? 'Retour' : 'Annuler'}
        </Button>
        <Button variant="danger" onClick={confirm}>
          Supprimer définitivement
        </Button>
      </DialogFooter>
    </>
  )
}
