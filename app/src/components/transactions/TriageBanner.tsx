import { Link } from '@tanstack/react-router'
import { ArrowRight, CircleAlert, Inbox, PartyPopper, Wand2 } from 'lucide-react'
import { Aura } from '@/components/shared/Aura'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TriageBannerProps {
  uncatCount: number
  ruleCount: number
  applying: boolean
  /** Resultat de la derniere categorisation automatique (null : pas lancee). */
  applied: number | null
  applyError: string | null
  onApplyRules: () => void
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * Point d'entree du tri en tete de liste : « N transactions à catégoriser »,
 * « Trier maintenant » (mode Tri, une transaction a la fois) et, s'il existe
 * des regles, la categorisation automatique. Apres une categorisation
 * automatique, la banniere en donne le resultat.
 */
export function TriageBanner({ uncatCount, ruleCount, applying, applied, applyError, onApplyRules }: TriageBannerProps) {
  if (uncatCount === 0 && applied === null && !applyError) return null

  const tone = applyError ? 'danger' : uncatCount === 0 ? 'success' : 'warning'
  const Icon = applyError ? CircleAlert : uncatCount === 0 ? PartyPopper : Inbox

  const title = applyError
    ? 'La catégorisation automatique a échoué'
    : applied !== null && applied > 0
      ? `${applied} ${plural(applied, 'transaction catégorisée', 'transactions catégorisées')} automatiquement`
      : `${uncatCount} ${plural(uncatCount, 'transaction à catégoriser', 'transactions à catégoriser')}`

  const subtitle = applyError
    ? applyError
    : uncatCount === 0
      ? 'Tout est trié : ton budget est à jour.'
      : applied === 0
        ? 'Aucune ne correspond à tes règles : trie-les en quelques gestes.'
        : applied !== null
          ? `Il en reste ${uncatCount} : trie-les en quelques gestes.`
          : 'Une à une, en quelques gestes : ton budget reste juste.'

  return (
    <div
      className={cn(
        'relative isolate flex flex-col gap-3.5 overflow-hidden rounded-2xl border bg-surface px-4 py-3.5 shadow-card animate-fade-up sm:flex-row sm:items-center',
        tone === 'warning' && 'border-warning/25',
        tone === 'success' && 'border-success/25',
        tone === 'danger' && 'border-danger/25',
      )}
    >
      <Aura tone={tone} intensity="soft" />
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-highlight ring-1 ring-inset',
            tone === 'warning' && 'bg-warning/10 text-warning ring-warning/20',
            tone === 'success' && 'bg-success/10 text-success ring-success/20',
            tone === 'danger' && 'bg-danger/10 text-danger ring-danger/20',
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={2.1} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-snug tracking-tight text-ink">{title}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-soft">{subtitle}</p>
        </div>
      </div>
      {uncatCount > 0 && (
        <div className="flex shrink-0 gap-2">
          {ruleCount > 0 && (
            <Button
              variant="soft"
              onClick={onApplyRules}
              disabled={applying}
              aria-label={`Appliquer mes ${ruleCount} ${plural(ruleCount, 'règle', 'règles')}`}
              title={`${ruleCount} ${plural(ruleCount, 'règle active', 'règles actives')}, évaluées par ordre de priorité`}
              className="w-11 shrink-0 px-0 sm:w-auto sm:px-4"
            >
              <Wand2 className="h-4 w-4" />
              <span className="hidden sm:inline">{applying ? 'Catégorisation…' : 'Appliquer les règles'}</span>
            </Button>
          )}
          <Link to="/trier" className={cn(buttonVariants(), 'flex-1 sm:flex-none')}>
            Trier maintenant
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  )
}
