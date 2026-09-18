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
}

export function SignedAmountInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  autoFocus,
}: SignedAmountInputProps) {
  const negative = value.trim().startsWith('-')
  const toggle = () => {
    const trimmed = value.trim()
    if (negative) onChange(trimmed.replace(/^-\s*/, ''))
    else onChange('-' + trimmed.replace(/^\+\s*/, ''))
  }
  return (
    <div className={cn('flex gap-2', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={negative ? 'Rendre le montant positif' : 'Rendre le montant négatif'}
        title={negative ? 'Montant négatif (toucher pour positif)' : 'Montant positif (toucher pour négatif)'}
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-[15px] font-semibold transition-colors lg:h-10 lg:w-10',
          negative
            ? 'border-danger/40 bg-danger/10 text-danger'
            : 'border-line bg-surface text-soft hover:text-ink',
        )}
      >
        {negative ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </button>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        autoFocus={autoFocus}
        className={cn('flex-1 text-right tnum', inputClassName)}
      />
    </div>
  )
}
