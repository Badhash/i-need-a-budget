// Types de comptes : icone, libelles et pastille pastel (tokens --cat-*), plus
// les petits formats d'affichage partages par la page Comptes et l'onboarding.

import { CreditCard, Sprout, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
import type { AccountKind } from '@/types/domain'
import type { CatColor } from '@/styles/themes'
import { daysBetween } from '@/lib/accounts'
import { fmtDateShort, today } from '@/lib/format'
import { cn } from '@/lib/utils'

export const ACCOUNT_KINDS: AccountKind[] = ['checking', 'savings', 'investment', 'card_deferred']

interface KindMeta {
  icon: LucideIcon
  label: string
  /** Libelle court (tuiles du selecteur). */
  short: string
  color: CatColor
  /** Nom propose dans le formulaire de creation. */
  placeholder: string
  /** Suivi (hors budget) conseille par defaut a la creation. */
  trackingByDefault: boolean
}

// Epargne = pousse (jamais de tirelire), comme les groupes « Épargne ».
export const KIND_META: Record<AccountKind, KindMeta> = {
  checking: {
    icon: Wallet,
    label: 'Compte courant',
    short: 'Courant',
    color: 'blue',
    placeholder: 'Compte courant',
    trackingByDefault: false,
  },
  savings: {
    icon: Sprout,
    label: 'Épargne',
    short: 'Épargne',
    color: 'green',
    placeholder: 'Livret A',
    trackingByDefault: false,
  },
  investment: {
    icon: TrendingUp,
    label: 'Investissement',
    short: 'Placement',
    color: 'purple',
    placeholder: 'PEA',
    trackingByDefault: true,
  },
  card_deferred: {
    icon: CreditCard,
    label: 'Carte à débit différé',
    short: 'Carte différée',
    color: 'amber',
    placeholder: 'Carte Visa',
    trackingByDefault: false,
  },
}

const PILL_SIZES = {
  sm: 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]',
  lg: 'h-12 w-12 [&_svg]:h-[22px] [&_svg]:w-[22px]',
}

/**
 * Pastille ronde du type de compte (meme facture que GroupPill : fond pastel
 * du theme, filet interieur, reflet haut). `muted` = compte cloture.
 */
export function KindPill({
  kind,
  size = 'md',
  muted = false,
  className,
}: {
  kind: AccountKind
  size?: keyof typeof PILL_SIZES
  muted?: boolean
  className?: string
}) {
  const meta = KIND_META[kind]
  const Icon = meta.icon
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full shadow-highlight ring-1 ring-inset ring-ink/[0.05]',
        muted && 'bg-surface2 text-soft',
        PILL_SIZES[size],
        className,
      )}
      style={
        muted ? undefined : { backgroundColor: `var(--cat-${meta.color}-bg)`, color: `var(--cat-${meta.color}-fg)` }
      }
    >
      <Icon strokeWidth={2.1} />
    </span>
  )
}

/** « Aujourd'hui », « Hier », « Il y a 3 jours », puis « 12 sept. ». */
export function fmtLastActivity(date: string | null, now: string = today()): string {
  if (!date) return 'Aucune opération'
  const days = daysBetween(date, now)
  if (days <= 0) return "Aujourd'hui"
  if (days === 1) return 'Hier'
  if (days < 7) return `Il y a ${days} jours`
  return fmtDateShort(date)
}

/** Nom entre guillemets francais insecables : « Livret A » ne se coupe jamais. */
export function quoted(name: string): string {
  return `\u00ab\u00a0${name}\u00a0\u00bb`
}

/** « 1 compte », « 3 comptes ». */
export function fmtAccountCount(n: number): string {
  return `${n} compte${n > 1 ? 's' : ''}`
}
