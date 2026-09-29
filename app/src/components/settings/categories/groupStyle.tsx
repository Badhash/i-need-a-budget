// Couleurs et icones autorisees pour les groupes de categories (memes valeurs
// que le serveur : requireGroupColor / requireGroupIcon) et selecteurs
// associes, partages par la creation d'un groupe et la feuille « Apparence du
// groupe ». Couleurs lues dans les tokens (--cat-*), jamais en dur.

import { Banknote, Car, Check, Home, Repeat, Sparkles, Sprout, type LucideIcon } from 'lucide-react'
import type { GroupIcon } from '@/types/domain'
import type { CatColor } from '@/styles/themes'
import { cn } from '@/lib/utils'

export const GROUP_COLORS: { value: CatColor; label: string }[] = [
  { value: 'blue', label: 'Bleu' },
  { value: 'green', label: 'Vert' },
  { value: 'amber', label: 'Ambre' },
  { value: 'pink', label: 'Rose' },
  { value: 'purple', label: 'Violet' },
  { value: 'teal', label: 'Turquoise' },
]

export const GROUP_ICONS: { value: GroupIcon; label: string; Icon: LucideIcon }[] = [
  { value: 'home', label: 'Maison', Icon: Home },
  { value: 'car', label: 'Transport', Icon: Car },
  { value: 'sparkles', label: 'Plaisirs', Icon: Sparkles },
  { value: 'repeat', label: 'Abonnements', Icon: Repeat },
  // Cle historique 'piggy' (payloads chiffres existants) : rendue en pousse.
  { value: 'piggy', label: 'Épargne', Icon: Sprout },
  { value: 'banknote', label: 'Revenus', Icon: Banknote },
]

/** Pastilles de couleur (radio) : 44px de cible, anneau accent sur la valeur. */
export function ColorSwatches({ value, onChange }: { value: CatColor; onChange: (color: CatColor) => void }) {
  return (
    <div role="radiogroup" aria-label="Couleur du groupe" className="flex flex-wrap gap-2.5">
      {GROUP_COLORS.map(({ value: c, label }) => {
        const active = value === c
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(c)}
            className={cn(
              'relative flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-inset ring-ink/[0.06] transition-[transform,box-shadow] duration-150 ease-spring active:scale-90 lg:h-10 lg:w-10',
              active && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
            )}
            style={{ backgroundColor: `var(--cat-${c}-bg)` }}
          >
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-full shadow-highlight"
              style={{ backgroundColor: `var(--cat-${c}-fg)` }}
            >
              {active && <Check className="h-3.5 w-3.5 text-surface" strokeWidth={3} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Choix d'icone (radio) rendu dans la couleur courante du groupe. */
export function IconChoices({
  value,
  color,
  onChange,
}: {
  value: GroupIcon
  color: CatColor
  onChange: (icon: GroupIcon) => void
}) {
  return (
    <div role="radiogroup" aria-label="Icône du groupe" className="flex flex-wrap gap-2.5">
      {GROUP_ICONS.map(({ value: v, label, Icon }) => {
        const active = value === v
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(v)}
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-full shadow-highlight ring-1 ring-inset ring-ink/[0.05] transition-[transform,box-shadow,opacity] duration-150 ease-spring active:scale-90 lg:h-10 lg:w-10',
              active ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'opacity-70 hover:opacity-100',
            )}
            style={{ backgroundColor: `var(--cat-${color}-bg)`, color: `var(--cat-${color}-fg)` }}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
          </button>
        )
      })}
    </div>
  )
}
