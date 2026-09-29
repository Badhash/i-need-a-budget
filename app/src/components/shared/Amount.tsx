import { cn } from '@/lib/utils'
import { fmtEUR, fmtEURSigned } from '@/lib/format'
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber'

export type AmountSize = 'sm' | 'md' | 'lg' | 'xl' | 'hero'

interface AmountProps {
  cents: number
  className?: string
  /** colore le montant : rouge si negatif, vert si positif */
  colored?: boolean
  /** force l'affichage du signe + */
  signed?: boolean
  /**
   * Taille typographique predefinie. Sans elle, la taille vient de className
   * (compatibilite des appels existants). hero = 36 a 44px, chiffres serres.
   */
  size?: AmountSize
  /** Interpole la valeur (compteur) a chaque changement ; respecte le mouvement reduit. */
  animate?: boolean
  /** Centimes et symbole attenues (defaut : oui en taille hero). */
  subtleDecimals?: boolean
}

const SIZES: Record<AmountSize, string> = {
  sm: 'text-[13px]',
  md: 'text-[15px]',
  lg: 'text-[19px] font-semibold tracking-tight',
  xl: 'text-[26px] font-semibold tracking-[-0.015em]',
  hero: 'num-hero',
}

const eurParts = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const eurSignedParts = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  signDisplay: 'always',
})

/** '-1 234,56 €' -> { main: '-1 234', rest: ',56 €' } (partie entiere / centimes + symbole). */
function splitAmount(cents: number, signed: boolean): { main: string; rest: string } {
  const value = (signed ? cents : cents === 0 ? 0 : cents) / 100
  let main = ''
  let rest = ''
  let afterDecimal = false
  for (const part of (signed ? eurSignedParts : eurParts).formatToParts(value)) {
    if (part.type === 'decimal') afterDecimal = true
    if (afterDecimal) rest += part.value
    else main += part.value
  }
  return { main, rest }
}

function AmountView({ cents, className, colored, signed, size, subtleDecimals }: Omit<AmountProps, 'animate'>) {
  const subtle = subtleDecimals ?? size === 'hero'
  const classes = cn(
    'tnum',
    size && SIZES[size],
    colored && cents < 0 && 'text-danger',
    colored && cents > 0 && 'text-success',
    className,
  )
  if (!subtle) {
    return <span className={classes}>{signed ? fmtEURSigned(cents) : fmtEUR(cents)}</span>
  }
  const { main, rest } = splitAmount(cents, Boolean(signed))
  return (
    <span className={classes}>
      {main}
      <span className="text-[0.62em] font-medium tracking-normal opacity-60">{rest}</span>
    </span>
  )
}

function AnimatedAmount(props: Omit<AmountProps, 'animate'>) {
  const value = useAnimatedNumber(props.cents)
  return <AmountView {...props} cents={value} />
}

export function Amount({ animate, ...props }: AmountProps) {
  // Composant distinct : seuls les montants animes paient la boucle rAF.
  return animate ? <AnimatedAmount {...props} /> : <AmountView {...props} />
}
