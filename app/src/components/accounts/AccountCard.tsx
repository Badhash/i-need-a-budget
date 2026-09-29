// Cartes de compte : ligne compacte (mobile, ouvre la feuille d'actions),
// tuile riche (desktop, actions en ligne) et ligne de compte cloture.

import { Link } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  ArrowUpRight,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type { AccountStats } from '@/lib/accounts'
import type { BankConnection } from '@/lib/bank'
import type { AccountWithBalance } from '@/lib/data'
import { isTempId } from '@/lib/mutationQueue'
import { Amount } from '@/components/shared/Amount'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { KIND_META, KindPill, fmtLastActivity } from './accountKinds'
import { Sparkline } from './Sparkline'

export type LinkStatus = BankConnection['status']

/** Vues de la feuille d'un compte (cf. AccountSheet). */
export type SheetView = 'menu' | 'adjust' | 'edit' | 'budget' | 'close' | 'delete'

/** Couleur semantique d'un solde : negatif en rouge, nul attenue. */
export function balanceClass(cents: number): string {
  return cents < 0 ? 'text-danger' : cents === 0 ? 'text-soft' : 'text-ink'
}

/**
 * Synchronisation bancaire d'un compte lie : simple marque (icone) quand tout
 * va bien, pastille d'alerte quand le consentement expire ou a expire.
 */
export function LinkBadge({ status, className }: { status: LinkStatus | undefined; className?: string }) {
  if (!status) return null
  const warn = status === 'expired' || status === 'expiring'
  if (!warn && status !== 'pending') {
    return (
      <span className={cn('inline-flex shrink-0 items-center text-success', className)} title="Synchronisé avec la banque">
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
        <span className="sr-only">Synchronisé avec la banque</span>
      </span>
    )
  }
  const label =
    status === 'expired'
      ? 'À reconnecter'
      : status === 'expiring'
        ? 'À renouveler'
        : status === 'pending'
          ? 'En attente'
          : 'Synchronisé'
  const Icon = warn ? TriangleAlert : RefreshCw
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[11px] font-medium ring-1 ring-inset',
        warn ? 'bg-warning/10 text-warning ring-warning/20' : 'bg-surface2 text-soft ring-line/60',
        className,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.2} />
      {label}
    </span>
  )
}

export interface AccountActions {
  /** Ouvre la feuille du compte sur une vue. */
  open: (account: AccountWithBalance, view: SheetView) => void
  /** Cloture (solde nul) ou explication (solde non nul). */
  close: (account: AccountWithBalance) => void
  reopen: (account: AccountWithBalance) => void
}

interface CardProps {
  account: AccountWithBalance
  stats: AccountStats | undefined
  link: LinkStatus | undefined
  /** Serveur recent : bascule budget/suivi et cloture proposees. */
  flags: boolean
  actions: AccountActions
}

function trendTone(account: AccountWithBalance) {
  return account.onBudget ? ('accent' as const) : ('aura' as const)
}

/**
 * Ligne mobile : toute la carte ouvre la feuille du compte (details et
 * actions). Montant aligne a droite, mini-courbe sous le montant.
 */
export function AccountRow({ account, stats, link, actions }: CardProps) {
  const pending = isTempId(account.id)
  return (
    <button
      type="button"
      onClick={() => actions.open(account, 'menu')}
      aria-label={`${account.name}, ${KIND_META[account.kind].label}`}
      className={cn(
        'flex w-full items-center gap-3.5 rounded-2xl border border-edge bg-surface px-4 py-3.5 text-left shadow-card transition-[transform,box-shadow] duration-200 ease-spring active:scale-[0.985]',
        pending && 'opacity-80',
      )}
    >
      <KindPill kind={account.kind} size="md" />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15.5px] font-semibold leading-snug tracking-tight text-ink">{account.name}</span>
          {link === 'active' && <LinkBadge status={link} />}
        </p>
        <p className="mt-0.5 truncate text-[13px] leading-snug text-soft">
          {account.institution}
          <span aria-hidden> · </span>
          {pending ? 'Création…' : fmtLastActivity(stats?.lastActivity ?? null)}
        </p>
        {link && link !== 'active' && <LinkBadge status={link} className="mt-1.5" />}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Amount cents={account.balance} animate className={cn('text-[17px] font-semibold tracking-tight', balanceClass(account.balance))} />
        {stats && <Sparkline values={stats.series} tone={trendTone(account)} className="h-6 w-[72px]" />}
      </div>
    </button>
  )
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button variant="ghost" size="iconSm" aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  )
}

/** Menu « Plus » d'un compte (desktop) : actions moins frequentes. */
function MoreMenu({ account, flags, actions }: Pick<CardProps, 'account' | 'flags' | 'actions'>) {
  const pending = isTempId(account.id)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="iconSm" aria-label={`Plus d'actions pour ${account.name}`} title="Plus d'actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {!pending && (
          <DropdownMenuItem asChild>
            <Link to="/transactions" search={{ compte: account.id }}>
              <ArrowUpRight className="h-4 w-4 text-soft" />
              Voir les transactions
            </Link>
          </DropdownMenuItem>
        )}
        {account.closed ? (
          flags && (
            <DropdownMenuItem onSelect={() => actions.reopen(account)}>
              <ArchiveRestore className="h-4 w-4 text-soft" />
              Rouvrir le compte
            </DropdownMenuItem>
          )
        ) : (
          <>
            <DropdownMenuItem onSelect={() => actions.open(account, 'adjust')}>
              <SlidersHorizontal className="h-4 w-4 text-soft" />
              Ajuster le solde
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.open(account, 'edit')}>
              <Pencil className="h-4 w-4 text-soft" />
              Modifier
            </DropdownMenuItem>
            {flags && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => actions.open(account, 'budget')}>
                  <ArrowLeftRight className="h-4 w-4 text-soft" />
                  {account.onBudget ? 'Passer en suivi' : 'Inclure dans le budget'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.close(account)}>
                  <Archive className="h-4 w-4 text-soft" />
                  Clôturer le compte
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => actions.open(account, 'delete')}
          className="text-danger data-[highlighted]:bg-danger/10"
        >
          <Trash2 className="h-4 w-4" />
          Supprimer…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Tuile desktop : la carte entiere mene aux transactions du compte (lien
 * etire), les actions frequentes restent a portee en haut a droite.
 */
export function AccountTile({ account, stats, link, flags, actions }: CardProps) {
  const pending = isTempId(account.id)
  const meta = KIND_META[account.kind]
  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-2xl border border-edge bg-surface p-5 shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-spring [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:shadow-raised',
        pending && 'opacity-80',
      )}
    >
      <div className="flex items-start gap-3.5">
        <KindPill kind={account.kind} size="lg" />
        <div className="min-w-0 flex-1 pt-0.5">
          {pending ? (
            <p className="truncate text-[16px] font-semibold tracking-tight text-ink">{account.name}</p>
          ) : (
            <Link
              to="/transactions"
              search={{ compte: account.id }}
              aria-label={`Voir les transactions de ${account.name}`}
              className="block truncate rounded-md text-[16px] font-semibold tracking-tight text-ink outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:after:ring-2 focus-visible:after:ring-accent/60"
            >
              {account.name}
            </Link>
          )}
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] text-soft">
            <span className="truncate">
              {account.institution} · {meta.label}
            </span>
            <LinkBadge status={link} />
          </p>
        </div>
        <div className="relative z-10 -mr-1.5 -mt-1 flex shrink-0 items-center opacity-60 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <IconAction label={`Ajuster le solde de ${account.name}`} onClick={() => actions.open(account, 'adjust')}>
            <SlidersHorizontal className="h-4 w-4" />
          </IconAction>
          <IconAction label={`Modifier ${account.name}`} onClick={() => actions.open(account, 'edit')}>
            <Pencil className="h-4 w-4" />
          </IconAction>
          <MoreMenu account={account} flags={flags} actions={actions} />
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <Amount cents={account.balance} size="xl" animate className={cn('block', balanceClass(account.balance))} />
          <p className="mt-1 text-[12.5px] text-soft">
            {pending
              ? 'Création en cours…'
              : stats?.lastActivity
                ? `Dernière opération : ${fmtLastActivity(stats.lastActivity).toLowerCase()}`
                : 'Aucune opération'}
          </p>
        </div>
        {stats && (
          <Sparkline values={stats.series} tone={trendTone(account)} className="mb-1.5 h-12 w-[42%] max-w-[180px] shrink-0" />
        )}
      </div>
    </div>
  )
}

/**
 * Ligne d'un compte cloture (section repliee) : nom et banque, « Rouvrir » en
 * un geste (serveur recent), le reste des actions dans la feuille (mobile) ou
 * le menu (desktop). Le solde n'apparait que s'il n'est pas nul (anomalie).
 */
export function ClosedAccountRow({ account, flags, actions, desktop }: Omit<CardProps, 'stats' | 'link'> & { desktop: boolean }) {
  const content = (
    <>
      <KindPill kind={account.kind} size="sm" muted />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium text-ink/80">{account.name}</span>
        <span className="block truncate text-[12.5px] text-soft">
          {account.institution}
          {account.balance !== 0 && (
            <>
              <span aria-hidden> · </span>
              <Amount cents={account.balance} className={balanceClass(account.balance)} />
            </>
          )}
        </span>
      </span>
    </>
  )
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      {desktop ? (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5">{content}</div>
      ) : (
        <button
          type="button"
          onClick={() => actions.open(account, 'menu')}
          aria-label={`${account.name}, compte clôturé`}
          className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left transition-colors active:bg-ink/[0.04]"
        >
          {content}
        </button>
      )}
      {flags && (
        <Button variant="soft" onClick={() => actions.reopen(account)} className="shrink-0 px-3.5">
          <ArchiveRestore className="h-4 w-4" />
          Rouvrir
        </Button>
      )}
      {desktop && <MoreMenu account={account} flags={flags} actions={actions} />}
    </div>
  )
}
