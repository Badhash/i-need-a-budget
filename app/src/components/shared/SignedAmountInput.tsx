// Champ de montant signe pour mobile : le clavier decimal d'iOS n'a pas de
// touche « moins ». Un bouton bascule le signe (prefixe « - » dans la valeur
// texte, que parseEuros comprend deja). Sur desktop le clavier physique suffit
// mais le bouton reste utile et coherent.

import { Minus, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SignedAmountInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  autoFocus?: boolean
  /** md = champ standard ; lg = saisie mise en avant (ajustement, solde d'ouverture). */
  size?: 'md' | 'lg'
  /** Saisie refusee : bordure et halo d'erreur, aria-invalid. */
  invalid?: boolean
  /** Touche Entree : valide le formulaire parent. */
  onEnter?: () => void
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

export function SignedAmountInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  autoFocus,
  size = 'md',
  invalid = false,
  onEnter,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: SignedAmountInputProps) {
  const negative = value.trim().startsWith('-')
  const lg = size === 'lg'
  const toggle = () => {
    const trimmed = value.trim()
    if (negative) onChange(trimmed.replace(/^-\s*/, ''))
    else onChange('-' + trimmed.replace(/^\+\s*/, ''))
  }
  const SignIcon = negative ? Minus : Plus
  return (
    <div className={cn('flex gap-2', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={negative ? 'Rendre le montant positif' : 'Rendre le montant négatif'}
        title={negative ? 'Montant négatif (toucher pour positif)' : 'Montant positif (toucher pour négatif)'}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xl border font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-spring active:scale-95',
          lg ? 'h-14 w-14 text-[17px]' : 'h-11 w-11 text-[15px] lg:h-10 lg:w-10',
          negative ? 'border-danger/40 bg-danger/10 text-danger' : 'border-line bg-surface text-soft hover:text-ink',
        )}
      >
        <SignIcon className={lg ? 'h-5 w-5' : 'h-4 w-4'} />
      </button>
      <div className="relative min-w-0 flex-1">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault()
              onEnter()
            }
          }}
          placeholder={placeholder}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            'text-right tnum',
            lg && 'h-14 pr-9 text-[26px] font-semibold tracking-tight lg:h-14 lg:text-[26px]',
            negative && lg && 'text-danger',
            invalid && 'border-danger/60 hover:border-danger/60 focus:border-danger/70 focus:ring-danger/15',
            inputClassName,
          )}
        />
        {lg && (
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[18px] font-medium text-soft">
            €
          </span>
        )}
      </div>
    </div>
  )
}
