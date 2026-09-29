import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, Lock, StickyNote } from 'lucide-react'
import { useAccountsList, useCategoriesList, useGroupsList } from '@/lib/data'
import { evalAmountCents, fmtDateNumeric, fmtEUR, MIN_MONTH, today } from '@/lib/format'
import { defaultTxAccountId, type TxKind } from '@/lib/transactions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { SegmentedControl } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'

const MIN_DATE = `${MIN_MONTH}-01`

export type { TxKind }

// Valeurs normalisees remontees a l'appelant : montant signe en centimes,
// note vide -> null.
export interface TxFormResult {
  accountId: string
  date: string
  label: string
  categoryId: string | null
  amount: number
  note: string | null
  kind: TxKind
}

export interface TxFormInitial {
  kind: TxKind
  amount: string
  label: string
  date: string
  accountId: string
  categoryId: string
  note: string
}

export function emptyTxForm(accountId: string, kind: TxKind = 'expense'): TxFormInitial {
  return { kind, amount: '', label: '', date: today(), accountId, categoryId: '', note: '' }
}

// Prepare l'etat du formulaire a partir d'une transaction existante : le signe
// du montant determine le sens, le montant est affiche en valeur absolue.
export function txFormFrom(tx: {
  accountId: string
  date: string
  label: string
  categoryId: string | null
  amount: number
  note?: string | null
}): TxFormInitial {
  return {
    kind: tx.amount >= 0 ? 'income' : 'expense',
    amount: (Math.abs(tx.amount) / 100).toFixed(2).replace('.', ','),
    label: tx.label,
    date: tx.date,
    accountId: tx.accountId,
    categoryId: tx.categoryId ?? '',
    note: tx.note ?? '',
  }
}

const KIND_OPTIONS = [
  { value: 'expense' as const, label: 'Dépense' },
  { value: 'income' as const, label: 'Revenu' },
]

/** Montant « 1 234,56 » (sans symbole) : forme canonique d'une saisie. */
const plainAmount = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type AmountState =
  | { status: 'empty' }
  | { status: 'valid'; cents: number; preview: string | null }
  | { status: 'invalid'; message: string; incomplete: boolean }

/**
 * Lecture d'une saisie de montant (parser strict partage, evalAmountCents) :
 * « 1.234,56 » est REJETE au lieu d'etre tronque, une expression (« 12+3,50 »)
 * passe. Apercu « = 15,50 € » quand la saisie est une expression ou n'est pas
 * sous sa forme canonique ; message explicite quand elle est invalide.
 */
export function readAmount(raw: string): AmountState {
  const compact = raw.replace(/\s/g, '')
  if (!compact) return { status: 'empty' }
  const cents = evalAmountCents(raw)
  if (cents === null) {
    return /[+\-*/(]$/.test(compact)
      ? { status: 'invalid', message: 'Expression incomplète.', incomplete: true }
      : { status: 'invalid', message: 'Montant invalide. Exemples : 12,50 ou 20+4,90', incomplete: false }
  }
  if (cents <= 0) {
    return {
      status: 'invalid',
      message: 'Saisis un montant positif : le sens se choisit avec Dépense / Revenu.',
      incomplete: false,
    }
  }
  const canonical = plainAmount.format(cents / 100).replace(/\s/g, '')
  const isInteger = /^\d+$/.test(compact)
  const preview = !isInteger && compact !== canonical ? `= ${fmtEUR(cents)}` : null
  return { status: 'valid', cents, preview }
}

export function TransactionForm({
  initial,
  submitLabel,
  submittingLabel,
  submitting,
  autoFocusAmount = false,
  keyboardInset = 0,
  lockedReason = null,
  onSubmit,
  onCancel,
}: {
  initial: TxFormInitial
  submitLabel: string
  submittingLabel: string
  submitting: boolean
  autoFocusAmount?: boolean
  keyboardInset?: number
  /** Moitie de virement : seuls categorie, libelle et note se modifient (montant,
   * date et compte suivent le virement). Texte d'explication affiche. */
  lockedReason?: string | null
  onSubmit: (result: TxFormResult) => void
  onCancel: () => void
}) {
  const accounts = useAccountsList()
  const categories = useCategoriesList()
  const groups = useGroupsList()
  const isDesktop = useIsDesktop()
  const locked = lockedReason !== null

  // Edition d'une transaction ANTERIEURE a MIN_DATE (historique YNAB, import
  // bancaire profond) : sa propre date elargit la borne basse, sinon toute
  // sauvegarde serait impossible ("date invalide" sans issue).
  const minDate = initial.date && initial.date < MIN_DATE ? initial.date : MIN_DATE

  const [kind, setKind] = useState<TxKind>(initial.kind)
  const [amount, setAmount] = useState(initial.amount)
  const [label, setLabel] = useState(initial.label)
  const [date, setDate] = useState(initial.date)
  const [accountId, setAccountId] = useState(initial.accountId)
  const [categoryId, setCategoryId] = useState<string>(initial.categoryId)
  const [note, setNote] = useState(initial.note)
  const [error, setError] = useState<string | null>(null)
  // Une expression en cours de frappe (« 12+ ») n'est signalee en rouge qu'en
  // quittant le champ (ou a l'envoi) ; une saisie invalide l'est tout de suite.
  const [amountTouched, setAmountTouched] = useState(false)
  // Mobile : date et note repliees sous « Plus d'options » (saisie rapide,
  // montant d'abord). Depliees d'office si la valeur initiale n'est pas celle
  // par defaut (edition d'une transaction datee ou annotee).
  const [moreOpen, setMoreOpen] = useState(initial.date !== today() || initial.note.trim() !== '')

  // Filet : compte par defaut si aucun n'est defini (taxonomie pas encore
  // chargee a l'ouverture) ; jamais un compte de suivi ni un compte clos.
  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      const fallback = defaultTxAccountId(accounts)
      if (fallback) setAccountId(fallback)
    }
  }, [accountId, accounts])

  const amountState = useMemo(() => readAmount(amount), [amount])
  const showAmountError = amountState.status === 'invalid' && (amountTouched || !amountState.incomplete)

  const submit = () => {
    if (amountState.status !== 'valid') {
      setAmountTouched(true)
      setError(amountState.status === 'empty' ? 'Saisis un montant, par exemple 12,50.' : amountState.message)
      return
    }
    if (!label.trim()) {
      setError('Le libellé est obligatoire.')
      return
    }
    if (!accountId) {
      setError('Choisis un compte.')
      return
    }
    if (!date || date < minDate || date > today()) {
      setError("La date doit être antérieure ou égale à aujourd'hui.")
      return
    }
    setError(null)
    onSubmit({
      accountId,
      date,
      label: label.trim(),
      categoryId: categoryId || null,
      amount: kind === 'expense' ? -amountState.cents : amountState.cents,
      note: note.trim() ? note.trim() : null,
      kind,
    })
  }

  const wantIncome = kind === 'income'
  // Compte de suivi (hors budget) : pas de categorie, ses mouvements n'entrent
  // ni dans les enveloppes ni dans le Pret a assigner.
  const account = accounts.find((a) => a.id === accountId)
  const isTracking = account?.onBudget === false
  useEffect(() => {
    if (isTracking && categoryId) setCategoryId('')
  }, [isTracking, categoryId])

  // Categories proposees : ni masquees ni d'un groupe masque, sauf la valeur
  // actuelle. Depense : enveloppes seulement. Entree d'argent : revenus
  // d'abord, puis les enveloppes (un remboursement est une entree SUR une
  // enveloppe de depense).
  const categoryOptions = useMemo<ComboboxOption[]>(() => {
    const hiddenGroups = new Set(groups.filter((g) => g.hidden).map((g) => g.id))
    const visible = categories.filter(
      (c) =>
        (wantIncome || !c.isIncome) &&
        (c.id === initial.categoryId || (!c.hidden && !hiddenGroups.has(c.groupId))),
    )
    const isIncomeGroup = (groupId: string) => visible.some((c) => c.groupId === groupId && c.isIncome)
    const opts: ComboboxOption[] = [{ value: '', label: 'À catégoriser' }]
    for (const group of groups
      .filter((g) => visible.some((c) => c.groupId === g.id))
      .sort((a, b) => Number(isIncomeGroup(b.id)) - Number(isIncomeGroup(a.id)) || a.sortOrder - b.sortOrder)) {
      for (const cat of visible.filter((c) => c.groupId === group.id).sort((a, b) => a.sortOrder - b.sortOrder)) {
        opts.push({ value: cat.id, label: cat.name, group: group.name, colorVar: `cat-${group.color}-fg` })
      }
    }
    return opts
  }, [groups, categories, wantIncome, initial.categoryId])

  // Comptes proposes : ouverts (budget puis suivi) ; un compte clos ne reste
  // que s'il est la valeur actuelle (edition d'une ancienne transaction).
  const accountOptions = useMemo<ComboboxOption[]>(() => {
    const listed = accounts.filter((a) => !a.closed || a.id === initial.accountId)
    return [
      ...listed
        .filter((a) => a.onBudget)
        .map((a) => ({ value: a.id, label: a.closed ? `${a.name} (clôturé)` : a.name, group: 'Budget' })),
      ...listed
        .filter((a) => !a.onBudget)
        .map((a) => ({ value: a.id, label: a.closed ? `${a.name} (clôturé)` : a.name, group: 'Suivi (hors budget)' })),
    ]
  }, [accounts, initial.accountId])

  // Sens change : une categorie qui n'est plus proposee (revenu sur une
  // depense) est desselectionnee plutot que conservee invisible.
  useEffect(() => {
    if (categoryId && !categoryOptions.some((o) => o.value === categoryId)) setCategoryId('')
  }, [categoryId, categoryOptions])

  const amountField = locked ? (
    <div className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-surface2 text-[30px] font-semibold tracking-tight text-soft tnum">
      <Lock className="h-4 w-4 shrink-0" />
      {fmtEUR(kind === 'expense' ? -(evalAmountCents(amount) ?? 0) : evalAmountCents(amount) ?? 0)}
    </div>
  ) : (
    <div>
      <div
        className={cn(
          'relative flex items-center rounded-2xl bg-surface2 ring-1 ring-inset transition-[box-shadow] duration-150 focus-within:ring-2',
          showAmountError ? 'ring-danger/60 focus-within:ring-danger/60' : 'ring-edge focus-within:ring-accent/60',
        )}
      >
        <input
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            if (error) setError(null)
          }}
          onBlur={() => setAmountTouched(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="0,00"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocusAmount}
          aria-label="Montant"
          aria-invalid={showAmountError || undefined}
          aria-describedby="tx-amount-hint"
          className={cn(
            'h-16 w-full rounded-2xl bg-transparent pl-5 pr-12 text-center text-[32px] font-semibold tracking-tight outline-none tnum placeholder:text-soft/50 focus-visible:ring-0 focus-visible:ring-offset-0 lg:h-14 lg:text-[28px]',
            wantIncome ? 'text-success' : 'text-ink',
          )}
        />
        <span className="pointer-events-none absolute right-5 text-[20px] font-medium text-soft">€</span>
      </div>
      <p
        id="tx-amount-hint"
        aria-live="polite"
        className={cn(
          'mt-1.5 min-h-[18px] text-center text-[12.5px] tnum',
          showAmountError ? 'font-medium text-danger' : 'text-soft',
        )}
      >
        {amountState.status === 'invalid'
          ? amountState.message
          : amountState.status === 'valid' && amountState.preview
            ? amountState.preview
            : ''}
      </p>
    </div>
  )

  const kindField = (
    <SegmentedControl
      options={KIND_OPTIONS}
      value={kind}
      onChange={(v) => {
        if (locked) return
        setKind(v)
      }}
      block
      aria-label="Sens de la transaction"
      className={cn(locked && 'pointer-events-none opacity-60')}
    />
  )

  const labelField = (
    <div>
      <label className="label-caps mb-1.5 block" htmlFor="tx-label">
        Libellé
      </label>
      <Input
        id="tx-label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={kind === 'expense' ? 'Boulangerie du marché' : 'Remboursement de Lucas'}
        autoComplete="off"
        maxLength={200}
      />
    </div>
  )

  const accountField = (
    <div>
      <label className="label-caps mb-1.5 block">Compte</label>
      <Combobox
        options={accountOptions}
        value={accountId}
        onChange={setAccountId}
        placeholder="Choisir un compte"
        searchPlaceholder="Rechercher un compte…"
        aria-label="Compte"
        disabled={locked}
      />
    </div>
  )

  const categoryField = isTracking ? (
    <p className="rounded-xl bg-surface2 px-3.5 py-2.5 text-[13px] leading-snug text-soft">
      Compte hors budget : ce mouvement n'a pas de catégorie, il ne touche ni les enveloppes ni le Prêt à
      assigner.
    </p>
  ) : (
    <div>
      <label className="label-caps mb-1.5 block">Catégorie</label>
      <Combobox
        options={categoryOptions}
        value={categoryId}
        onChange={setCategoryId}
        placeholder="À catégoriser"
        searchPlaceholder="Rechercher une catégorie…"
        aria-label="Catégorie"
      />
    </div>
  )

  const dateField = (
    <div>
      <label className="label-caps mb-1.5 block" htmlFor="tx-date">
        Date
      </label>
      <Input
        id="tx-date"
        type="date"
        value={date}
        min={minDate}
        max={today()}
        disabled={locked}
        onChange={(e) => setDate(e.target.value)}
      />
    </div>
  )

  const noteField = (
    <div>
      <label className="label-caps mb-1.5 block" htmlFor="tx-note">
        Note
      </label>
      <textarea
        id="tx-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optionnel"
        rows={2}
        maxLength={500}
        className="flex w-full resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[16px] text-ink shadow-[inset_0_1px_2px_rgb(var(--ink)/0.03)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-soft/70 hover:border-soft/40 focus:border-accent/70 focus:ring-4 focus:ring-accent/15 lg:text-[14px]"
      />
    </div>
  )

  const lockedNotice = locked && (
    <p className="flex items-start gap-2 rounded-xl bg-surface2 px-3.5 py-2.5 text-[13px] leading-snug text-soft">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{lockedReason}</span>
    </p>
  )

  // Pied de formulaire (boutons au-dessus du clavier iOS).
  const footer = (
    <div
      className="flex gap-3 border-t border-edge p-5"
      style={keyboardInset ? { paddingBottom: keyboardInset + 20 } : undefined}
    >
      <Button variant="secondary" className="flex-1" onClick={onCancel}>
        Annuler
      </Button>
      <Button className="flex-1" onClick={submit} disabled={submitting}>
        {submitting ? submittingLabel : submitLabel}
      </Button>
    </div>
  )

  const errorLine = error && (
    <p role="alert" className="text-[13px] font-medium text-danger">
      {error}
    </p>
  )

  // Mobile (< lg) : saisie rapide, montant en premier et en grand, sens en
  // selecteur segmente, puis libelle, compte, categorie ; date et note sous un
  // depliant.
  if (!isDesktop) {
    return (
      <>
        <div className="flex-1 space-y-4 overflow-y-auto p-5 pt-2">
          {kindField}
          {amountField}
          {lockedNotice}
          {labelField}
          {accountField}
          {categoryField}

          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-1 text-[14px] font-medium text-soft transition-colors hover:text-ink"
          >
            <span className="flex-1 text-left">{moreOpen ? 'Moins d’options' : 'Plus d’options'}</span>
            {!moreOpen && (
              <span className="flex items-center gap-2 text-[13px] tnum">
                <CalendarDays className="h-3.5 w-3.5" />
                {date === today() ? "Aujourd'hui" : fmtDateNumeric(date)}
                {note.trim() && <StickyNote className="h-3.5 w-3.5" />}
              </span>
            )}
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-200 ease-spring', moreOpen && 'rotate-180')} />
          </button>

          {moreOpen && (
            <div className="space-y-4 animate-fade-up">
              {dateField}
              {noteField}
            </div>
          )}

          {errorLine}
        </div>
        {footer}
      </>
    )
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-5 pt-2">
        {kindField}
        {amountField}
        {lockedNotice}
        {labelField}
        <div className="grid grid-cols-2 gap-3">
          {dateField}
          {accountField}
        </div>
        {categoryField}
        {noteField}
        {errorLine}
      </div>
      {footer}
    </>
  )
}

/**
 * Echap dans une feuille de saisie : un champ texte actif (liste deroulante
 * d'un combobox, recherche du selecteur de categorie) est d'abord quitte, la
 * feuille reste ouverte ; un second Echap la ferme. Radix ecoute Echap en
 * capture sur le document : sans cette garde, refermer une liste fermait toute
 * la feuille et la saisie etait perdue. A passer a DialogContent.onEscapeKeyDown.
 */
export function keepSheetOnFieldEscape(event: KeyboardEvent): void {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    event.preventDefault()
    // Apres les gestionnaires du champ (fermeture de sa liste).
    window.setTimeout(() => active.blur(), 0)
  }
}

/**
 * Formulaire pose dans une feuille : la hauteur du clavier iOS (qui recouvrait
 * le pied Ajouter / Annuler) n'est mesuree que tant que la feuille est
 * ouverte. Monte dans les dialogues toujours presents (ajout, edition), la
 * mesure (relevee toutes les 250 ms et a chaque changement de focus, avec un
 * recalcul de mise en page) tournait sinon en permanence dans toute l'app.
 */
export function SheetForm(props: Omit<Parameters<typeof TransactionForm>[0], 'keyboardInset'>) {
  const keyboardInset = useSheetKeyboardInset()
  return <TransactionForm {...props} keyboardInset={keyboardInset} />
}
