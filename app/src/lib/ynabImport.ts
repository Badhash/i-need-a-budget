// Import YNAB -> INAB : parser CSV maison (zero dependance) + orchestrateur.
//
// Deux fichiers du "Export budget" YNAB (decompresses par l'utilisateur) :
//   - Register.csv (obligatoire) : une ligne par transaction, porte les comptes.
//   - Budget.csv  (optionnel)    : une ligne par (mois, categorie) budgetee.
//
// Le parser produit une structure NORMALISEE avec des `key` client (chaines)
// qui servent a construire, cote serveur, les tables de correspondance
// key -> id serveur. L'orchestrateur appelle ensuite les 3 actions d'import.
//
// Rappel securite : ce module manipule des donnees en clair EN MEMOIRE et les
// envoie a l'Edge Function /api (qui chiffre). On ne LOGGE jamais leur contenu.

import { apiCall } from '@/lib/api'

// ---------------------------------------------------------------------------
// Structure normalisee
// ---------------------------------------------------------------------------

export interface ParsedAccount {
  key: string
  name: string
}
export interface ParsedGroup {
  key: string
  name: string
  hidden: boolean
}
export interface ParsedCategory {
  key: string
  groupKey: string
  name: string
  isIncome: boolean
  hidden: boolean
}
export interface ParsedTransaction {
  accountKey: string
  categoryKey: string | null // null = a categoriser ; '__income__' = revenus
  date: string // YYYY-MM-DD
  amount: number // centimes signes (negatif = depense)
  label: string
  counterparty: string | null
  notes: string | null
}
export interface ParsedAssignment {
  categoryKey: string
  month: string // YYYY-MM
  amount: number // centimes >= 0
}

export type DateConvention = 'DMY' | 'MDY' | 'ISO'

export interface ParsedImport {
  accounts: ParsedAccount[]
  groups: ParsedGroup[]
  categories: ParsedCategory[]
  transactions: ParsedTransaction[]
  assignments: ParsedAssignment[]
  summary: {
    dateConvention: DateConvention
    ignoredCount: number
    dateRange: { min: string; max: string } | null
    hasBudget: boolean
  }
}

const INCOME_KEY = '__income__'
const INCOME_NAME = 'Revenus'
const FALLBACK_LABEL = '(sans libellé)'
const NO_GROUP = 'Sans groupe'
// Groupe YNAB des categories masquees : importe hidden=true (ne pas jeter).
const HIDDEN_GROUP_MARKER = 'hidden categories'

// ---------------------------------------------------------------------------
// Parseur CSV robuste (guillemets, virgules internes, CRLF, "" echappe)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  // Retire un BOM UTF-8 eventuel en tete de fichier.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\r') {
      // ignore : le \n suivant clot la ligne (CRLF)
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  // Derniere ligne sans saut final.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Retire les lignes totalement vides.
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// ---------------------------------------------------------------------------
// Recherche de colonnes (en-tetes tolerants EN/FR, insensibles casse/accents)
// ---------------------------------------------------------------------------

function normalizeHeader(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

function findCol(headers: string[], candidates: string[]): number {
  const norm = headers.map(normalizeHeader)
  for (const cand of candidates) {
    const idx = norm.indexOf(normalizeHeader(cand))
    if (idx !== -1) return idx
  }
  return -1
}

// ---------------------------------------------------------------------------
// Montants -> centimes entiers (locale-robuste)
// ---------------------------------------------------------------------------

export function parseAmountToCents(raw: string): number {
  if (!raw) return 0
  let s = raw.replace(/ /g, ' ').trim()
  if (!s) return 0
  const negative = s.startsWith('-') || /^\(.*\)$/.test(s)
  // Ne garde que chiffres et separateurs.
  s = s.replace(/[^0-9.,]/g, '')
  if (!s) return 0
  // Separateur decimal = dernier '.' ou ',' suivi de 1 ou 2 chiffres en fin.
  const dec = s.match(/[.,](\d{1,2})$/)
  let cents: number
  if (dec) {
    const decDigits = dec[1].length === 1 ? dec[1] + '0' : dec[1]
    const intPart = s.slice(0, s.length - dec[1].length - 1).replace(/[.,]/g, '')
    cents = parseInt(intPart || '0', 10) * 100 + parseInt(decDigits, 10)
  } else {
    // Aucune partie decimale : tous les separateurs sont des milliers.
    cents = parseInt(s.replace(/[.,]/g, '') || '0', 10) * 100
  }
  if (!Number.isFinite(cents)) return 0
  return negative ? -cents : cents
}

// ---------------------------------------------------------------------------
// Dates -> YYYY-MM-DD (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD)
// ---------------------------------------------------------------------------

interface RawDateParts {
  iso: string | null // rempli directement si deja ISO
  a: number // premier champ numerique
  b: number // deuxieme champ
  y: number // annee
}

function splitDate(raw: string): RawDateParts | null {
  const s = raw.trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, a: 0, b: 0, y: Number(iso[1]) }
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/)
  if (m) return { iso: null, a: Number(m[1]), b: Number(m[2]), y: Number(m[3]) }
  return null
}

// Detecte la convention en cherchant une date qui leve l'ambiguite :
// premier champ > 12 => DMY ; deuxieme champ > 12 => MDY. Defaut FR : DMY.
function detectDateConvention(parts: RawDateParts[]): DateConvention {
  let sawNonIso = false
  for (const p of parts) {
    if (p.iso) continue
    sawNonIso = true
    if (p.a > 12) return 'DMY'
    if (p.b > 12) return 'MDY'
  }
  return sawNonIso ? 'DMY' : 'ISO'
}

function partsToIso(p: RawDateParts, conv: DateConvention): string | null {
  if (p.iso) return p.iso
  let day: number
  let month: number
  if (conv === 'MDY') {
    month = p.a
    day = p.b
  } else {
    day = p.a
    month = p.b
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${p.y}-${mm}-${dd}`
}

// ---------------------------------------------------------------------------
// Mois (Budget.csv) : YYYY-MM(-DD), "MMM YYYY" (EN + FR)
// ---------------------------------------------------------------------------

const MONTH_ABBR: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  // FR (accents retires, tronque a 4 : "fevr", "juil", "sept", "aout")
  janv: '01', fevr: '02', mars: '03', avr: '04', mai: '05', juin: '06',
  juil: '07', aout: '08', sept: '09',
}

export function parseMonth(raw: string): string | null {
  const s = raw.trim()
  const iso = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (iso) {
    const mm = Number(iso[2])
    if (mm >= 1 && mm <= 12) return `${iso[1]}-${iso[2]}`
    return null
  }
  // "Jan 2024", "janv. 2024", "September 2024"
  const named = s.match(/^([A-Za-zÀ-ÿ.]+)\s+(\d{4})$/)
  if (named) {
    const key = normalizeHeader(named[1]).replace(/\./g, '').slice(0, 4)
    const mm = MONTH_ABBR[key] ?? MONTH_ABBR[key.slice(0, 3)]
    if (mm) return `${named[2]}-${mm}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Classification des categories YNAB
// ---------------------------------------------------------------------------

const INCOME_MARKERS = new Set([
  'ready to assign',
  'inflow: ready to assign',
  'inflow: to be budgeted',
  'to be budgeted',
  'pret a assigner',
  'entree: pret a assigner',
  'entree : pret a assigner',
  'inflow : ready to assign',
])

const UNCAT_MARKERS = new Set(['', 'uncategorized', 'non categorise', 'non categorisee'])

function classifyCategory(group: string, category: string): 'income' | 'uncat' | 'normal' {
  const g = normalizeHeader(group)
  const c = normalizeHeader(category)
  if (INCOME_MARKERS.has(c) || INCOME_MARKERS.has(`${g}: ${c}`) || g === 'inflow' || g === 'entree') {
    return 'income'
  }
  if (UNCAT_MARKERS.has(c)) return 'uncat'
  return 'normal'
}

// ---------------------------------------------------------------------------
// Assemblage : accumulateur de taxonomie partagee entre les deux fichiers
// ---------------------------------------------------------------------------

interface Accumulator {
  groups: Map<string, ParsedGroup>
  categories: Map<string, ParsedCategory>
  incomeEnsured: boolean
}

function ensureIncome(acc: Accumulator): string {
  if (!acc.incomeEnsured) {
    acc.groups.set(INCOME_KEY, { key: INCOME_KEY, name: INCOME_NAME, hidden: false })
    acc.categories.set(INCOME_KEY, {
      key: INCOME_KEY,
      groupKey: INCOME_KEY,
      name: INCOME_NAME,
      isIncome: true,
      hidden: false,
    })
    acc.incomeEnsured = true
  }
  return INCOME_KEY
}

// Enregistre (si besoin) un groupe + une categorie normale et renvoie sa key.
// Le groupe "Hidden Categories" de YNAB (et ses categories) est importe masque.
function ensureCategory(acc: Accumulator, group: string, category: string): string {
  // Les clefs preservent le nom COMPLET (concordance register/budget) ; seuls
  // les noms envoyes au serveur sont tronques a 80 (limite requireText), pour ne
  // pas faire echouer l'import (validation cote serveur AVANT effacement).
  const groupName = group.trim() || NO_GROUP
  const groupKey = groupName
  const hidden = normalizeHeader(groupName) === HIDDEN_GROUP_MARKER
  if (!acc.groups.has(groupKey)) {
    acc.groups.set(groupKey, { key: groupKey, name: groupName.slice(0, 80), hidden })
  }
  const catName = category.trim()
  const catKey = `${groupKey}||${catName}`
  if (!acc.categories.has(catKey)) {
    acc.categories.set(catKey, {
      key: catKey,
      groupKey,
      name: catName.slice(0, 80) || '(sans nom)',
      isIncome: false,
      hidden,
    })
  }
  return catKey
}

// ---------------------------------------------------------------------------
// Parsing du Register.csv
// ---------------------------------------------------------------------------

interface RegisterRow {
  accountKey: string
  accountName: string
  rawDate: string
  parts: RawDateParts
  payee: string
  group: string
  category: string
  memo: string
  amount: number
}

function parseRegister(text: string): { rows: RegisterRow[]; ignored: number } {
  const table = parseCsv(text)
  if (table.length < 2) return { rows: [], ignored: 0 }
  const headers = table[0]
  const iAccount = findCol(headers, ['Account', 'Compte'])
  const iDate = findCol(headers, ['Date'])
  const iPayee = findCol(headers, ['Payee', 'Bénéficiaire', 'Beneficiaire'])
  const iGroup = findCol(headers, ['Category Group', 'Groupe de catégories', 'Groupe de categories'])
  const iCategory = findCol(headers, ['Category', 'Catégorie', 'Categorie'])
  const iMemo = findCol(headers, ['Memo', 'Mémo', 'Memo'])
  const iOutflow = findCol(headers, ['Outflow', 'Sortie'])
  const iInflow = findCol(headers, ['Inflow', 'Entrée', 'Entree'])

  if (iAccount === -1 || iDate === -1) {
    throw new Error('Register.csv : colonnes Compte / Date introuvables.')
  }

  const at = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i] : '')
  const rows: RegisterRow[] = []
  let ignored = 0
  for (let i = 1; i < table.length; i++) {
    const r = table[i]
    const accountName = at(r, iAccount).trim()
    const rawDate = at(r, iDate).trim()
    const parts = splitDate(rawDate)
    if (!accountName || !parts) {
      ignored++
      continue
    }
    const outflow = parseAmountToCents(at(r, iOutflow))
    const inflow = parseAmountToCents(at(r, iInflow))
    // Outflow/Inflow sont deux colonnes de valeurs positives ; on les rend
    // signees (abs, au cas ou une valeur porterait deja un signe).
    const amount = Math.abs(inflow) - Math.abs(outflow)
    rows.push({
      accountKey: accountName,
      accountName,
      rawDate,
      parts,
      payee: at(r, iPayee).trim(),
      group: at(r, iGroup).trim(),
      category: at(r, iCategory).trim(),
      memo: at(r, iMemo).trim(),
      amount,
    })
  }
  return { rows, ignored }
}

// ---------------------------------------------------------------------------
// Parsing du Budget.csv
// ---------------------------------------------------------------------------

function parseBudget(
  text: string,
  acc: Accumulator,
): { assignments: ParsedAssignment[]; ignored: number } {
  const table = parseCsv(text)
  if (table.length < 2) return { assignments: [], ignored: 0 }
  const headers = table[0]
  const iMonth = findCol(headers, ['Month', 'Mois'])
  const iGroup = findCol(headers, ['Category Group', 'Groupe de catégories', 'Groupe de categories'])
  const iCategory = findCol(headers, ['Category', 'Catégorie', 'Categorie'])
  // Le fichier reel nomme la colonne "Assigned" ; on tolere aussi les libelles
  // plus anciens / FR ("Budgeted", "Budgété", "Assigné").
  const iBudgeted = findCol(headers, ['Assigned', 'Budgeted', 'Assigné', 'Assigne', 'Budgété', 'Budgete'])
  if (iMonth === -1 || iCategory === -1 || iBudgeted === -1) {
    throw new Error('Budget.csv : colonnes Mois / Catégorie / Assigned introuvables.')
  }

  const at = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i] : '')
  // Une seule assignation par (mois, categorie) : dedup, derniere valeur gagne.
  const byKey = new Map<string, ParsedAssignment>()
  let ignored = 0
  for (let i = 1; i < table.length; i++) {
    const r = table[i]
    const month = parseMonth(at(r, iMonth))
    const category = at(r, iCategory).trim()
    const group = at(r, iGroup).trim()
    if (!month || !category) {
      ignored++
      continue
    }
    // Les lignes de revenus / "Ready to Assign" ne portent pas d'assignation.
    if (classifyCategory(group, category) !== 'normal') continue
    const amount = parseAmountToCents(at(r, iBudgeted))
    // Ignore 0 (rien de budgete) et negatifs (non representables cote INAB).
    if (amount <= 0) continue
    const catKey = ensureCategory(acc, group, category)
    byKey.set(`${month}||${catKey}`, { categoryKey: catKey, month, amount })
  }
  return { assignments: [...byKey.values()], ignored }
}

// ---------------------------------------------------------------------------
// Point d'entree du parsing
// ---------------------------------------------------------------------------

export function parseYnabExport(registerText: string, budgetText?: string): ParsedImport {
  const acc: Accumulator = { groups: new Map(), categories: new Map(), incomeEnsured: false }
  const { rows, ignored: regIgnored } = parseRegister(registerText)

  // Detection de la convention de date sur l'ensemble du registre.
  const conv = detectDateConvention(rows.map((r) => r.parts))

  const accounts = new Map<string, ParsedAccount>()
  const transactions: ParsedTransaction[] = []
  let ignored = regIgnored
  let minDate: string | null = null
  let maxDate: string | null = null

  for (const r of rows) {
    const iso = partsToIso(r.parts, conv)
    if (!iso) {
      ignored++
      continue
    }
    accounts.set(r.accountKey, { key: r.accountKey, name: r.accountName.slice(0, 80) || 'Compte' })

    // On se fie SIMPLEMENT a la colonne Category (pas de traitement special des
    // "Transfer : X" : dans ce budget le cote sortant porte une vraie categorie).
    // Categorie presente -> resolue ; revenus/RTA -> categorie de revenus ;
    // vide / "Uncategorized" -> categoryId null.
    const cls = classifyCategory(r.group, r.category)
    let categoryKey: string | null
    if (cls === 'income') categoryKey = ensureIncome(acc)
    else if (cls === 'uncat') categoryKey = null
    else categoryKey = ensureCategory(acc, r.group, r.category)

    const label = r.payee || r.memo || FALLBACK_LABEL
    transactions.push({
      accountKey: r.accountKey,
      categoryKey,
      date: iso,
      amount: r.amount,
      label: label.slice(0, 200),
      counterparty: r.payee ? r.payee.slice(0, 200) : null,
      notes: r.memo ? r.memo.slice(0, 500) : null,
    })
    if (!minDate || iso < minDate) minDate = iso
    if (!maxDate || iso > maxDate) maxDate = iso
  }

  let assignments: ParsedAssignment[] = []
  let hasBudget = false
  if (budgetText && budgetText.trim()) {
    const res = parseBudget(budgetText, acc)
    assignments = res.assignments
    ignored += res.ignored
    hasBudget = true
  }

  return {
    accounts: [...accounts.values()],
    groups: [...acc.groups.values()],
    categories: [...acc.categories.values()],
    transactions,
    assignments,
    summary: {
      dateConvention: conv,
      ignoredCount: ignored,
      dateRange: minDate && maxDate ? { min: minDate, max: maxDate } : null,
      hasBudget,
    },
  }
}

// ---------------------------------------------------------------------------
// Orchestrateur : begin (destructif) -> transactions (lots 200) -> assignations (lots 500)
// ---------------------------------------------------------------------------

export interface ImportSummary {
  comptes: number
  groupes: number
  categories: number
  transactions: number
  assignations: number
  lignesIgnorees: number
}

interface BeginResult {
  accountMap: Record<string, string>
  categoryMap: Record<string, string>
  incomeFallbackId?: string
}

const TX_BATCH = 200
const ASG_BATCH = 500

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function runYnabImport(
  parsed: ParsedImport,
  onProgress: (pct: number, text: string) => void,
): Promise<ImportSummary> {
  onProgress(0, 'Effacement des donnees actuelles et creation de la structure...')

  const begin = await apiCall<BeginResult>('importReplaceBegin', {
    accounts: parsed.accounts.map((a) => ({ key: a.key, name: a.name })),
    groups: parsed.groups.map((g) => ({ key: g.key, name: g.name, hidden: g.hidden })),
    categories: parsed.categories.map((c) => ({
      key: c.key,
      groupKey: c.groupKey,
      name: c.name,
      isIncome: c.isIncome,
      hidden: c.hidden,
    })),
  })

  const resolveCat = (key: string | null): string | null => {
    if (key === null) return null
    if (key === INCOME_KEY) return begin.categoryMap[INCOME_KEY] ?? begin.incomeFallbackId ?? null
    return begin.categoryMap[key] ?? null
  }

  // Transactions : resolution key -> id serveur. Une transaction dont le compte
  // n'est pas resolu est ecartee (ne devrait pas arriver, les comptes viennent
  // du meme registre) ; une categorie non resolue retombe sur null.
  let droppedTx = 0
  const txRows = parsed.transactions
    .map((t) => {
      const accountId = begin.accountMap[t.accountKey]
      if (!accountId) {
        droppedTx++
        return null
      }
      return {
        accountId,
        categoryId: resolveCat(t.categoryKey),
        date: t.date,
        amount: t.amount,
        label: t.label,
        counterparty: t.counterparty,
        notes: t.notes,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  // Assignations : categorie normale obligatoire (income exclu, null exclu).
  const asgRows = parsed.assignments
    .filter((a) => a.categoryKey !== INCOME_KEY)
    .map((a) => ({ categoryId: resolveCat(a.categoryKey), month: a.month, amount: a.amount }))
    .filter((r): r is { categoryId: string; month: string; amount: number } => r.categoryId !== null)

  const txBatches = chunk(txRows, TX_BATCH)
  const asgBatches = chunk(asgRows, ASG_BATCH)
  const totalBatches = txBatches.length + asgBatches.length
  let done = 0
  const bump = () => {
    done++
    // 10 % pour le begin deja fait, 90 % repartis sur les lots.
    const pct = totalBatches === 0 ? 100 : Math.round(10 + (done / totalBatches) * 90)
    return pct
  }

  let insertedTx = 0
  for (let i = 0; i < txBatches.length; i++) {
    const res = await apiCall<{ inserted: number }>('importReplaceTransactions', {
      transactions: txBatches[i],
    })
    insertedTx += res.inserted
    onProgress(bump(), `Import des transactions (${insertedTx}/${txRows.length})...`)
  }

  let upsertedAsg = 0
  for (let i = 0; i < asgBatches.length; i++) {
    const res = await apiCall<{ upserted: number }>('importReplaceAssignments', {
      assignments: asgBatches[i],
    })
    upsertedAsg += res.upserted
    onProgress(bump(), `Import du budget (${upsertedAsg}/${asgRows.length})...`)
  }

  onProgress(100, 'Import termine.')

  return {
    comptes: Object.keys(begin.accountMap).length,
    groupes: parsed.groups.length,
    categories: Object.keys(begin.categoryMap).length,
    transactions: insertedTx,
    assignations: upsertedAsg,
    lignesIgnorees: parsed.summary.ignoredCount + droppedTx,
  }
}
