import { useEffect, useRef, useState } from 'react'
import { fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AssignedEditorProps {
  value: number // centimes
  onCommit: (cents: number) => void
  className?: string
}

/** Montant assigne editable inline : clic -> input, Entree valide, Echap annule. */
export function AssignedEditor({ value, onCommit, className }: AssignedEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const start = () => {
    cancelled.current = false
    setDraft((value / 100).toFixed(2).replace('.', ','))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (cancelled.current) return
    const parsed = Number.parseFloat(draft.replace(/\s/g, '').replace(',', '.'))
    if (Number.isNaN(parsed) || parsed < 0) return
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
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            cancelled.current = true
            setEditing(false)
          }
        }}
        inputMode="decimal"
        className={cn(
          'h-8 w-28 rounded-lg border border-accent/60 bg-surface px-2 text-right text-[14px] tnum outline-none',
          className,
        )}
      />
    )
  }

  return (
    <button
      onClick={start}
      className={cn(
        'h-8 rounded-lg px-2 text-right text-[14px] tnum transition-colors hover:bg-surface2 hover:ring-1 hover:ring-line',
        value === 0 && 'text-soft',
        className,
      )}
      title="Modifier le montant assigné"
    >
      {fmtEUR(value)}
    </button>
  )
}
