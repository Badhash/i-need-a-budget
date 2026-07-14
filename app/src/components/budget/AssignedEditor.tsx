import { useEffect, useRef, useState } from 'react'
import { fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AssignedEditorProps {
  value: number // centimes
  onCommit: (cents: number) => void
  className?: string
}

/**
 * Montant assigne editable inline : clic -> input, Entree valide, Echap annule.
 * iOS : police 16px sur mobile (empeche le zoom automatique de Safari au
 * focus), cible tactile 40px, clavier decimal avec touche OK, contenu
 * pre-selectionne pour remplacer d'un geste.
 */
export function AssignedEditor({ value, onCommit, className }: AssignedEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    if (editing) {
      const input = inputRef.current
      input?.focus()
      // iOS ignore parfois select() au montage : re-selectionne au frame suivant.
      requestAnimationFrame(() => {
        try {
          input?.setSelectionRange(0, input.value.length)
        } catch {
          input?.select()
        }
      })
    }
  }, [editing])

  const start = () => {
    cancelled.current = false
    setDraft(value === 0 ? '' : (value / 100).toFixed(2).replace('.', ','))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (cancelled.current) return
    const raw = draft.trim()
    // Un montant negatif est accepte : il retire de l'argent de l'enveloppe
    // vers le Pret a assigner (parite YNAB).
    const parsed = raw === '' || raw === '-' ? 0 : Number.parseFloat(raw.replace(/\s/g, '').replace(',', '.'))
    if (Number.isNaN(parsed)) return
    const cents = Math.round(parsed * 100)
    if (cents !== value) onCommit(cents)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Sur iOS, blur() referme le clavier ; commit part via onBlur.
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            cancelled.current = true
            setEditing(false)
          }
        }}
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        placeholder="0,00"
        className={cn(
          'h-10 w-28 rounded-lg border border-accent/60 bg-surface px-2 text-right text-[16px] tnum outline-none placeholder:text-soft/60 lg:h-8 lg:text-[14px]',
          className,
        )}
      />
    )
  }

  return (
    <button
      onClick={start}
      className={cn(
        // Mobile : bordure discrete pour signaler que le montant est editable.
        'h-10 rounded-lg border border-line/70 bg-surface px-2.5 text-right text-[15px] tnum transition-colors active:bg-surface2',
        'lg:h-8 lg:border-transparent lg:bg-transparent lg:px-2 lg:text-[14px] lg:hover:bg-surface2 lg:hover:ring-1 lg:hover:ring-line',
        value === 0 && 'text-soft',
        className,
      )}
      title="Modifier le montant assigné"
    >
      {fmtEUR(value)}
    </button>
  )
}
