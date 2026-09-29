import { useEffect, useRef, useState, type ReactNode } from 'react'
import { evalAmountCents, fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Couche optionnelle rendue sous le champ pendant l'edition (valeurs rapides). */
export interface AssignOverlayApi {
  /** Champ de saisie : ancre de la couche. */
  anchor: HTMLInputElement
  /** Brouillon evalue en centimes, null si l'expression est invalide. */
  draftCents: number | null
  /** Le brouillon modifie est une expression (« 200+35,5 ») : on montre son resultat. */
  isExpression: boolean
  /** Pose et valide une valeur (puce), puis quitte l'edition. */
  commitValue: (cents: number) => void
}

interface AssignedEditorProps {
  /** Montant assigne courant (centimes). */
  value: number
  /** Mode edition pilote par la grille (une seule ligne a la fois). */
  editing: boolean
  /** Nom de l'enveloppe : libelles accessibles. */
  label: string
  /** Cle de la ligne (id de categorie), portee par le bouton (data-assign-key). */
  navKey: string
  onStartEdit: () => void
  onCommit: (cents: number) => void
  /** Passe l'edition a la ligne VISIBLE suivante (1) ou precedente (-1) ; false en bout de grille. */
  onNavigate: (direction: 1 | -1) => boolean
  /** Hors edition : deplace le focus sur le bouton de la ligne voisine. */
  onFocusMove: (direction: 1 | -1) => void
  /** Quitte le mode edition (Echap, clic ailleurs, Entree en fin de grille). */
  onExit: () => void
  /** Apercu du brouillon valide (centimes), null hors saisie. */
  onPreview?: (cents: number | null) => void
  renderOverlay?: (api: AssignOverlayApi) => ReactNode
  className?: string
}

// Operateur present hors signe initial : le brouillon est une expression.
const EXPRESSION = /[+*/()]|.-/
// Touches qui amorcent la saisie depuis le bouton (tableur) : chiffres,
// separateurs, operateurs.
const TYPE_TO_EDIT = /^[0-9+\-*/(,.]$/

function toDraft(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Montant assigne editable inline de la grille desktop, pense pour la boucle
 * clavier YNAB :
 *   - bouton : Entree / F2 / clic -> edition ; un chiffre tape -> edition
 *     amorcee avec ce chiffre ; fleches haut/bas -> ligne voisine ;
 *   - champ : Entree / Tab valident et passent a la ligne VISIBLE suivante
 *     (Maj = precedente) ; Echap restaure la valeur d'origine ; fleches
 *     haut/bas changent de ligne tant que le montant n'est pas modifie.
 * Les expressions sont acceptees (« 200+35,5 »), un negatif retire de
 * l'enveloppe vers le Pret a assigner. Expression invalide + Entree : on reste
 * en edition, champ signale. Seul un brouillon MODIFIE est valide : une valeur
 * changee entre-temps par la reconciliation n'est jamais ecrasee.
 */
export function AssignedEditor({
  value,
  editing,
  label,
  navKey,
  onStartEdit,
  onCommit,
  onNavigate,
  onFocusMove,
  onExit,
  onPreview,
  renderOverlay,
  className,
}: AssignedEditorProps) {
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [invalid, setInvalid] = useState(false)
  // Saisie amorcee depuis le bouton (chiffre tape, retour arriere), consommee
  // a l'entree en edition.
  const [pendingDraft, setPendingDraft] = useState<string | null>(null)
  // Etat derive : detecte l'entree en edition PENDANT le rendu, pour que le
  // premier rendu du champ porte deja le bon brouillon (pas de valeur fantome).
  const [wasEditing, setWasEditing] = useState(editing)
  const [input, setInput] = useState<HTMLInputElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Sortie deja traitee (Entree, Echap, puce) : le blur qui suit est ignore.
  const settledRef = useRef(false)
  // Rendre le focus au bouton apres une sortie au clavier.
  const refocusRef = useRef(false)
  // Entree en edition : tout selectionner (remplacer d'un geste) ou curseur en fin.
  const selectAllRef = useRef(true)

  if (editing !== wasEditing) {
    setWasEditing(editing)
    if (editing) {
      setDraft(pendingDraft ?? toDraft(value))
      setDirty(pendingDraft !== null)
      setInvalid(false)
      setPendingDraft(null)
    }
  }

  // Focus du champ a l'entree en edition, puis selection au frame suivant
  // (iOS ignore parfois select() au montage). Le defilement garde la ligne
  // visible sous l'en-tete collant (scroll-margin du champ).
  useEffect(() => {
    if (!editing || !input) return
    settledRef.current = false
    input.focus({ preventScroll: true })
    input.scrollIntoView({ block: 'nearest' })
    const selectAll = selectAllRef.current
    selectAllRef.current = true
    const raf = requestAnimationFrame(() => {
      try {
        const end = input.value.length
        input.setSelectionRange(selectAll ? 0 : end, end)
      } catch {
        input.select()
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [editing, input])

  // Sortie au clavier : le focus revient sur le bouton de la ligne.
  useEffect(() => {
    if (editing || !refocusRef.current) return
    refocusRef.current = false
    buttonRef.current?.focus({ preventScroll: true })
  }, [editing])

  // Apercu du disponible pendant la saisie (brouillon modifie et valide).
  useEffect(() => {
    onPreview?.(editing && dirty ? evalAmountCents(draft) : null)
  }, [editing, dirty, draft, onPreview])

  const settle = (commit: boolean) => {
    settledRef.current = true
    if (!commit || !dirty) return
    const cents = evalAmountCents(draft)
    if (cents !== null && cents !== value) onCommit(cents)
  }

  const commitValue = (cents: number) => {
    settledRef.current = true
    if (cents !== value) onCommit(cents)
    refocusRef.current = true
    onExit()
  }

  if (editing) {
    const draftCents = evalAmountCents(draft)
    return (
      <>
        <input
          ref={setInput}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setDirty(true)
            setInvalid(false)
          }}
          onBlur={() => {
            // Clic ailleurs : valide un brouillon correct, abandonne sinon.
            if (settledRef.current) return
            settle(true)
            onExit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              if (dirty && draftCents === null) {
                // Expression invalide : on reste en edition, champ signale.
                e.preventDefault()
                setInvalid(true)
                return
              }
              settle(true)
              if (onNavigate(e.shiftKey ? -1 : 1)) {
                e.preventDefault()
                return
              }
              // Bout de grille : Entree rend le focus au bouton, Tab laisse
              // le navigateur avancer normalement.
              if (e.key === 'Enter') {
                e.preventDefault()
                refocusRef.current = true
              }
              onExit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              settle(false)
              refocusRef.current = true
              onExit()
            } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !dirty) {
              e.preventDefault()
              settledRef.current = true
              if (!onNavigate(e.key === 'ArrowDown' ? 1 : -1)) settledRef.current = false
            }
          }}
          inputMode="decimal"
          enterKeyHint="next"
          autoComplete="off"
          spellCheck={false}
          placeholder="0,00"
          aria-label={`Montant assigné à ${label}`}
          aria-invalid={invalid || undefined}
          title="Entrée : valider et passer à l'enveloppe suivante · Échap : annuler"
          className={cn(
            'h-9 w-[112px] xl:w-[124px] scroll-mb-16 scroll-mt-40 rounded-xl border bg-surface px-3 text-right text-[14px] font-semibold text-ink tnum shadow-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-normal placeholder:text-soft/60 [@media(pointer:coarse)]:text-[16px]',
            invalid
              ? 'border-danger/80 ring-4 ring-danger/15'
              : 'border-accent/70 ring-4 ring-accent/15',
            className,
          )}
        />
        {input &&
          renderOverlay?.({
            anchor: input,
            draftCents,
            isExpression: dirty && EXPRESSION.test(draft.trim()),
            commitValue,
          })}
      </>
    )
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      data-assign-key={navKey}
      onClick={() => {
        selectAllRef.current = true
        onStartEdit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault()
          selectAllRef.current = true
          onStartEdit()
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          onFocusMove(e.key === 'ArrowDown' ? 1 : -1)
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          setPendingDraft('')
          selectAllRef.current = false
          onStartEdit()
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey && TYPE_TO_EDIT.test(e.key)) {
          e.preventDefault()
          setPendingDraft(e.key)
          selectAllRef.current = false
          onStartEdit()
        }
      }}
      aria-label={`Montant assigné à ${label} : ${fmtEUR(value)}`}
      title="Modifier le montant assigné (Entrée, ou tapez un montant)"
      className={cn(
        'relative inline-flex h-9 min-w-[108px] scroll-mb-16 scroll-mt-40 items-center justify-end rounded-xl px-3 text-[14px] font-medium tnum transition-[background-color,box-shadow,color] duration-150 xl:min-w-[124px]',
        'hover:bg-surface hover:shadow-[inset_0_0_0_1px_rgb(var(--line))] focus-visible:ring-offset-surface',
        value === 0 ? 'text-soft/70' : 'text-ink',
        className,
      )}
    >
      {fmtEUR(value)}
    </button>
  )
}
