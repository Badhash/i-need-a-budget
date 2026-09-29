import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
import {
  isPendingRule,
  opLabel,
  ruleRenderKey,
  swapPriorityChanges,
  useDeleteRule,
  useReorderRules,
  type Rule,
} from '@/lib/rules'
import { useRuleCounts, type RuleCounts } from '@/lib/ruleInsights'
import { haptic } from '@/lib/haptics'
import { RuleSentence } from '@/components/rules/RuleSentence'
import { countLabel } from '@/components/rules/RulePreviewPanel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const FLIP_MS = 280
const DISARM_MS = 4000

interface RulesListProps {
  /** Regles triees (ordre d'evaluation du serveur). */
  rules: Rule[]
  onEdit: (rule: Rule) => void
  /** Regle a mettre en evidence (ex. celle qui capte le libelle teste). */
  highlightId?: string | null
}

/**
 * Liste des regles dans leur ordre d'evaluation : rang, phrase en pastilles,
 * transactions captees (les plus prioritaires d'abord), reordonnancement
 * optimiste (Monter / Descendre, anime), suppression en deux temps. Toucher
 * la phrase ouvre l'edition.
 */
export function RulesList({ rules, onEdit, highlightId }: RulesListProps) {
  const counts = useRuleCounts()
  const reorder = useReorderRules()
  const remove = useDeleteRule()

  // Suppression en deux temps (premier appui arme, second supprime) : une
  // regle supprimee par megarde ne se retrouve pas.
  const [armed, setArmed] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(null), DISARM_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  const move = (index: number, direction: -1 | 1) => {
    const changes = swapPriorityChanges(rules, index, index + direction)
    if (changes.length === 0) return
    haptic(6)
    reorder.mutate({ changes })
  }

  const requestDelete = (rule: Rule) => {
    if (armed === rule.id) {
      setArmed(null)
      haptic(12)
      remove.mutate({ rule })
    } else {
      setArmed(rule.id)
    }
  }

  // FLIP : chaque ligne glisse de son ancienne position vers la nouvelle
  // (Web Animations, coupe sous prefers-reduced-motion).
  const listRef = useRef<HTMLOListElement>(null)
  const positions = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    // Liste masquee (onglet mobile inactif) : aucune position fiable, on
    // repart de zero a son affichage plutot que d'animer depuis le haut.
    if (list.offsetParent === null) {
      positions.current = new Map()
      return
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, number>()
    list.querySelectorAll<HTMLElement>('[data-rule-key]').forEach((el) => {
      const key = el.dataset.ruleKey!
      const top = el.offsetTop
      next.set(key, top)
      const before = positions.current.get(key)
      if (!reduce && before !== undefined && before !== top && typeof el.animate === 'function') {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], {
          duration: FLIP_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        })
      }
    })
    positions.current = next
  })

  return (
    <ol ref={listRef} className="stagger relative divide-y divide-line/60">
      {rules.map((rule, index) => (
        <RuleRow
          key={ruleRenderKey(rule)}
          renderKey={ruleRenderKey(rule)}
          rule={rule}
          rank={index + 1}
          first={index === 0}
          last={index === rules.length - 1}
          counts={counts.get(rule.id)}
          highlighted={highlightId === rule.id}
          confirming={armed === rule.id}
          onMove={(direction) => move(index, direction)}
          onEdit={() => onEdit(rule)}
          onDelete={() => requestDelete(rule)}
        />
      ))}
    </ol>
  )
}

interface RuleRowProps {
  renderKey: string
  rule: Rule
  rank: number
  first: boolean
  last: boolean
  counts: RuleCounts | undefined
  highlighted: boolean
  confirming: boolean
  onMove: (direction: -1 | 1) => void
  onEdit: () => void
  onDelete: () => void
}

function RuleRow({
  renderKey,
  rule,
  rank,
  first,
  last,
  counts,
  highlighted,
  confirming,
  onMove,
  onEdit,
  onDelete,
}: RuleRowProps) {
  const pending = isPendingRule(rule)
  const hidden = counts ? counts.matched - counts.effective : 0
  return (
    <li
      data-rule-key={renderKey}
      className={cn(
        'relative flex items-center gap-1 bg-surface py-2 pl-1 pr-2 transition-colors duration-200 sm:pl-2 sm:pr-3',
        highlighted && 'bg-accent/[0.07]',
      )}
    >
      {highlighted && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand" />}
      <div className="flex shrink-0 flex-col items-center">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={first || pending}
          aria-label="Monter la règle (plus prioritaire)"
          className="flex h-10 w-11 items-center justify-center rounded-lg text-soft transition-colors disabled:pointer-events-none [@media(hover:hover)]:hover:bg-surface2 [@media(hover:hover)]:hover:text-ink disabled:opacity-25 lg:h-7 lg:w-8"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={last || pending}
          aria-label="Descendre la règle (moins prioritaire)"
          className="flex h-10 w-11 items-center justify-center rounded-lg text-soft transition-colors disabled:pointer-events-none [@media(hover:hover)]:hover:bg-surface2 [@media(hover:hover)]:hover:text-ink disabled:opacity-25 lg:h-7 lg:w-8"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={onEdit}
        disabled={pending}
        className="group flex min-w-0 flex-1 items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors active:bg-surface2/60 disabled:cursor-default [@media(hover:hover)]:hover:bg-surface2/60"
        aria-label={`Modifier la règle ${rank} : ${opLabel(rule.matcher.op)} « ${rule.matcher.value} »`}
      >
        <span
          className={cn(
            'mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[12px] font-semibold tnum',
            rank === 1 ? 'bg-brand text-accentfg shadow-button' : 'bg-surface2 text-soft ring-1 ring-inset ring-edge',
          )}
        >
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <RuleSentence matcher={rule.matcher} categoryId={rule.categoryId} />
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-soft tnum">
            {counts === undefined ? (
              <span>…</span>
            ) : counts.effective === 0 ? (
              <span>{hidden === 0 ? "Aucune transaction captée pour l'instant" : 'Aucune transaction captée'}</span>
            ) : (
              <span>{countLabel(counts.effective, 'transaction captée', 'transactions captées')}</span>
            )}
            {hidden > 0 && (
              <span>
                · {hidden} {hidden > 1 ? 'prises' : 'prise'} par une règle au-dessus
              </span>
            )}
            {counts && counts.uncategorized > 0 && (
              <span className="font-medium text-warning">· {counts.uncategorized} à catégoriser</span>
            )}
          </span>
        </span>
        <Pencil
          aria-hidden
          className="mt-1 hidden h-4 w-4 shrink-0 text-soft opacity-0 transition-opacity group-hover:opacity-100 lg:block"
        />
      </button>

      <div className="flex shrink-0 items-center">
        {confirming ? (
          <span className="animate-scale-in">
            <Button
              variant="ghost"
              onClick={onDelete}
              aria-label="Confirmer la suppression de la règle"
              className="h-11 bg-danger/10 px-3 text-[13px] font-semibold text-danger hover:bg-danger/15 hover:text-danger lg:h-9"
            >
              Supprimer ?
            </Button>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={pending}
            aria-label="Supprimer la règle"
            className="text-soft hover:text-danger"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </Button>
        )}
      </div>
    </li>
  )
}
