// Import YNAB et restauration de sauvegarde -> INAB : parser CSV maison (zero
// dependance), plan de remplacement et orchestrateur REPRENABLE.
//
// Deux fichiers du "Export budget" YNAB (decompresses par l'utilisateur) :
//   - Register.csv (obligatoire) : une ligne par transaction, porte les comptes.
//   - Budget.csv  (optionnel)    : une ligne par (mois, categorie) budgetee.
//
// Le parser produit une structure NORMALISEE avec des `key` client (chaines).
// Un PLAN de remplacement (ImportPlan, commun a l'import YNAB et a la
// restauration d'une sauvegarde JSON, cf. components/settings/data) en est
// derive : cles courtes (a1, g1, c1...) qui servent a construire, cote serveur,
// les tables de correspondance key -> id serveur, lignes pretes a l'envoi.
// L'orchestrateur execute le plan etape par etape (importReplaceBegin, puis
// lots de transactions et d'assignations bornes en lignes ET en octets) et
// garde sa progression en memoire : un lot en echec apres l'effacement se
// REPREND la ou il s'est arrete, sans effacer a nouveau.
//
// Rappel securite : ce module manipule des donnees en clair EN MEMOIRE et les
// envoie a l'Edge Function /api (qui chiffre). On ne LOGGE jamais leur contenu
// et rien n'est ecrit dans le stockage du navigateur.

import { create } from 'zustand'
import type { QueryClient } from '@tanstack/react-query'
import { ApiError, apiCall } from '@/lib/api'
import { currentMonth, addMonths } from '@/lib/format'
import type { AccountKind, GroupIcon } from '@/types/domain'
import type { CatColor } from '@/styles/themes'

// ---------------------------------------------------------------------------
// Structure normalisee (YNAB)
// ---------------------------------------------------------------------------

export interface ParsedAccount {
  key: string
  name: string
  /**
   * Compte budget (vs suivi) deduit du registre : YNAB ne categorise jamais
   * les transactions d'un compte de suivi, un compte dont AUCUNE ligne n'a de
   * categorie (pas meme le solde initial « Ready to Assign ») est donc
   * propose en suivi. L'utilisateur peut corriger dans l'apercu.
   */
  onBudget: boolean
}
interface ParsedGroup {
  key: string
  name: string
  hidden: boolean
}
interface ParsedCategory {
  key: string
  groupKey: string
  name: string
  isIncome: boolean
  hidden: boolean
}
interface ParsedTransaction {
  accountKey: string
  categoryKey: string | null // null = a categoriser ; '__income__' = revenus
  date: string // YYYY-MM-DD
  amount: number // centimes signes (negatif = depense)
  label: string
  counterparty: string | null
  notes: string | null
  /** Compte cible d'un virement YNAB (tiers « Transfer : <compte> »), sinon null. */
  transferTo: string | null
}
interface ParsedAssignment {
  categoryKey: string
  month: string // YYYY-MM
  amount: number // centimes (negatif = retrait d'enveloppe YNAB)
}

type DateConvention = 'DMY' | 'MDY' | 'ISO'

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
    /** Lignes de virement YNAB (tiers « Transfer : <compte> »). */
    transferRows: number
  }
}

const INCOME_KEY = '__income__'
const INCOME_NAME = 'Revenus'
const FALLBACK_LABEL = '(sans libellé)'
const NO_GROUP = 'Sans groupe'
// Groupe YNAB des categories masquees : importe hidden=true (ne pas jeter).
const HIDDEN_GROUP_MARKER = 'hidden categories'
// Tiers d'un virement YNAB : « Transfer : Livret A » (export anglais) ou
// « Virement : Livret A » (interface francaise).
const TRANSFER_PAYEE = /^(?:transfer|virement|transfert)\s*:\s*(.+)$/i

// ---------------------------------------------------------------------------
// Decodage des fichiers YNAB : UTF-8 avec reparation CESU-8
// ---------------------------------------------------------------------------
//
// Bug d'export YNAB constate sur fichiers reels : certains emojis anciens sont
// encodes en CESU-8 (paire de substituts UTF-16 encodee en deux sequences de
// 3 octets ED xx xx), invalide en UTF-8 strict. file.text() les remplacerait
// par U+FFFD et le nom de categorie ne correspondrait plus a celui du Plan
// (ex. "(?)Restaurant" vs "🍴Restaurant" -> categorie dupliquee). On repare
// les paires avant decodage.

export function decodeYnabCsv(buffer: ArrayBuffer): string {
  const src = new Uint8Array(buffer)
  const out = new Uint8Array(src.length)
  let w = 0
  for (let i = 0; i < src.length; i++) {
    // Substitut haut CESU-8 : ED A0-AF xx suivi du substitut bas ED B0-BF xx.
    if (
      src[i] === 0xed &&
      i + 5 < src.length &&
      src[i + 1] >= 0xa0 &&
      src[i + 1] <= 0xaf &&
      src[i + 3] === 0xed &&
      src[i + 4] >= 0xb0 &&
      src[i + 4] <= 0xbf
    ) {
      const hi = 0xd800 + ((src[i + 1] - 0xa0) << 6) + (src[i + 2] & 0x3f)
      const lo = 0xdc00 + ((src[i + 4] - 0xb0) << 6) + (src[i + 5] & 0x3f)
      const cp = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00)
      // Reencodage UTF-8 4 octets du point de code repare.
      out[w++] = 0xf0 | (cp >> 18)
      out[w++] = 0x80 | ((cp >> 12) & 0x3f)
      out[w++] = 0x80 | ((cp >> 6) & 0x3f)
      out[w++] = 0x80 | (cp & 0x3f)
      i += 5
    } else {
      out[w++] = src[i]
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(out.subarray(0, w))
}

// ---------------------------------------------------------------------------
// Parseur CSV robuste (guillemets, virgules internes, CRLF, "" echappe)
// ---------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
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
  // Guillemet ouvert jamais referme : le reste du fichier a ete aspire dans un
  // seul champ -> donnees corrompues. On refuse plutot que d'importer faux.
  if (inQuotes) {
    throw new Error('CSV malformé : un guillemet reste ouvert (fichier corrompu ou tronqué).')
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

function parseAmountToCents(raw: string): number {
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

function parseMonth(raw: string): string | null {
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
    // Le groupe systeme de YNAB prend un nom francais lisible.
    acc.groups.set(groupKey, { key: groupKey, name: hidden ? 'Catégories masquées' : groupName.slice(0, 80), hidden })
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
    // Ignore 0 (rien de budgete). Les NEGATIFS sont CONSERVES : dans YNAB,
    // retirer de l'argent d'une enveloppe = "Assigned" negatif sur le mois.
    // Les ignorer gonfle la somme des assignes et effondre le Ready to Assign
    // (constate sur donnees reelles : -57 000 EUR d'ecart).
    if (amount === 0) continue
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
  // Comptes ayant au moins une ligne categorisee (revenus compris) : budget.
  const categorized = new Set<string>()
  const transactions: ParsedTransaction[] = []
  let ignored = regIgnored
  let transferRows = 0
  let minDate: string | null = null
  let maxDate: string | null = null

  for (const r of rows) {
    const iso = partsToIso(r.parts, conv)
    if (!iso) {
      ignored++
      continue
    }
    if (!accounts.has(r.accountKey)) {
      accounts.set(r.accountKey, { key: r.accountKey, name: r.accountName.slice(0, 80) || 'Compte', onBudget: false })
    }

    // On se fie a la colonne Category : categorie presente -> resolue ;
    // revenus/RTA -> categorie de revenus ; vide / "Uncategorized" -> null.
    // Un virement YNAB (tiers « Transfer : X ») garde sa categorie : dans YNAB,
    // seule la moitie budget d'un virement vers un compte de suivi en porte une.
    const cls = classifyCategory(r.group, r.category)
    let categoryKey: string | null
    if (cls === 'income') categoryKey = ensureIncome(acc)
    else if (cls === 'uncat') categoryKey = null
    else categoryKey = ensureCategory(acc, r.group, r.category)
    if (categoryKey !== null) categorized.add(r.accountKey)

    const transfer = TRANSFER_PAYEE.exec(r.payee)
    const transferTo = transfer ? transfer[1].trim() || null : null
    if (transferTo) transferRows++

    const label = r.payee || r.memo || FALLBACK_LABEL
    transactions.push({
      accountKey: r.accountKey,
      categoryKey,
      date: iso,
      amount: r.amount,
      label: clip(label, 200),
      counterparty: r.payee ? clip(r.payee, 200) : null,
      notes: r.memo ? clip(r.memo, 500) : null,
      transferTo,
    })
    if (!minDate || iso < minDate) minDate = iso
    if (!maxDate || iso > maxDate) maxDate = iso
  }
  for (const a of accounts.values()) a.onBudget = categorized.has(a.key)

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
      transferRows,
    },
  }
}

// ---------------------------------------------------------------------------
// Aides partagees (plan YNAB et plan de sauvegarde)
// ---------------------------------------------------------------------------

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Tronque une chaine sans couper un caractere hors BMP (paire de substituts). */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s
  let out = s.slice(0, max)
  const last = out.charCodeAt(out.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
  return out
}

/** Texte obligatoire (1..max caracteres, jamais blanc), repli si vide. */
export function requiredText(value: unknown, max: number, fallback: string): string {
  const s = typeof value === 'string' ? clip(value.trim(), max) : ''
  return s || fallback
}

/** Texte optionnel : null si absent ou blanc. */
export function optionalText(value: unknown, max: number): string | null {
  const s = typeof value === 'string' ? clip(value.trim(), max) : ''
  return s || null
}

/** UUID v4 (identifiants de paires de virements). */
export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const encoder = new TextEncoder()
export const byteLength = (s: string): number => encoder.encode(s).length

// ---------------------------------------------------------------------------
// Plan de remplacement (commun a l'import YNAB et a la restauration)
// ---------------------------------------------------------------------------

export interface PlanAccount {
  key: string
  name: string
  institution?: string
  kind?: AccountKind
  onBudget: boolean
}
export interface PlanGroup {
  key: string
  name: string
  color?: CatColor
  icon?: GroupIcon
  hidden: boolean
}
export interface PlanCategory {
  key: string
  groupKey: string
  name: string
  isIncome: boolean
  hidden: boolean
}
export interface PlanTransaction {
  accountKey: string
  categoryKey: string | null
  date: string
  amount: number
  label: string
  counterparty: string | null
  notes: string | null
  /** Paire de virement (fonctionnalite serveur importTransfers), sinon null. */
  transferGroupId: string | null
}
export interface PlanAssignment {
  categoryKey: string
  month: string
  amount: number
}
export interface PlanTarget {
  categoryKey: string
  type: 'monthly' | 'byDate' | 'refill'
  amount: number
  dueMonth: string | null
}
export interface PlanRule {
  categoryKey: string
  op: 'contains' | 'equals' | 'startsWith'
  value: string
  priority: number
}
export interface PlanBankLink {
  accountKey: string
  connectionId: string
  providerAccountUid: string
}

export interface ImportPlan {
  source: 'ynab' | 'backup'
  accounts: PlanAccount[]
  groups: PlanGroup[]
  categories: PlanCategory[]
  transactions: PlanTransaction[]
  assignments: PlanAssignment[]
  /** Mois de depart du budget a reposer (sauvegarde), sinon null. */
  startMonth: string | null
  targets: PlanTarget[]
  rules: PlanRule[]
  /** Comptes a archiver apres l'import (fonctionnalite accountFlags). */
  closeAccounts: string[]
  /** Associations bancaires a retablir (connexions toujours presentes). */
  bankLinks: PlanBankLink[]
  /** Paires de virements envoyees avec un transferGroupId commun. */
  transferPairs: number
  /** Lignes illisibles ou ecartees par la construction du plan. */
  ignored: number
  /** Ce qui ne sera pas importe tel quel (textes affiches, apercu et bilan). */
  notes: string[]
}

// Limites de importReplaceBegin (serveur).
const MAX_ACCOUNTS = 50
const MAX_GROUPS = 200
const MAX_CATEGORIES = 1000
// Le serveur refuse tout corps de plus de 64 000 octets.
const MAX_BODY_BYTES = 60_000

function beginPayload(plan: ImportPlan) {
  return {
    accounts: plan.accounts.map(({ key, name, institution, kind, onBudget }) => ({
      key,
      name,
      institution,
      kind,
      onBudget,
    })),
    groups: plan.groups.map(({ key, name, color, icon, hidden }) => ({ key, name, color, icon, hidden })),
    categories: plan.categories.map(({ key, groupKey, name, isIncome, hidden }) => ({
      key,
      groupKey,
      name,
      isIncome,
      hidden,
    })),
  }
}

const isText = (s: unknown, max: number): s is string => typeof s === 'string' && s.trim() !== '' && s.length <= max

/**
 * Regles de forme IDENTIQUES a celles du serveur (requireDate / requireMonth /
 * requireAmount / requireText / requireUuid), verifiees AVANT tout effacement :
 * un plan non conforme abandonne l'import sans rien detruire.
 */
export function validatePlan(plan: ImportPlan): string | null {
  if (plan.accounts.length === 0) return 'aucun compte à importer'
  if (plan.accounts.length > MAX_ACCOUNTS) return `trop de comptes (${plan.accounts.length}, maximum ${MAX_ACCOUNTS})`
  if (plan.groups.length > MAX_GROUPS) return `trop de groupes (${plan.groups.length}, maximum ${MAX_GROUPS})`
  if (plan.categories.length > MAX_CATEGORIES) {
    return `trop de catégories (${plan.categories.length}, maximum ${MAX_CATEGORIES})`
  }
  const accountKeys = new Set(plan.accounts.map((a) => a.key))
  const groupKeys = new Set(plan.groups.map((g) => g.key))
  const categoryKeys = new Set(plan.categories.map((c) => c.key))
  const incomeKeys = new Set(plan.categories.filter((c) => c.isIncome).map((c) => c.key))
  categoryKeys.add(INCOME_KEY)
  incomeKeys.add(INCOME_KEY)
  for (const a of plan.accounts) {
    if (!isText(a.name, 80) || !isText(a.key, 200)) return 'nom de compte invalide'
    if (a.institution !== undefined && !isText(a.institution, 80)) return 'établissement de compte invalide'
  }
  for (const g of plan.groups) if (!isText(g.name, 80) || !isText(g.key, 200)) return 'nom de groupe invalide'
  for (const c of plan.categories) {
    if (!isText(c.name, 80) || !isText(c.key, 200)) return 'nom de catégorie invalide'
    if (!groupKeys.has(c.groupKey)) return 'catégorie sans groupe'
  }
  for (const t of plan.transactions) {
    if (!accountKeys.has(t.accountKey)) return 'transaction sans compte'
    if (!DATE_RE.test(t.date)) return `date invalide (${t.date})`
    if (!Number.isSafeInteger(t.amount)) return `montant invalide (${t.amount})`
    if (!isText(t.label, 200)) return 'libellé de transaction invalide'
    if (t.counterparty !== null && !isText(t.counterparty, 200)) return 'contrepartie invalide'
    if (t.notes !== null && !isText(t.notes, 500)) return 'note invalide'
    if (t.categoryKey !== null && !categoryKeys.has(t.categoryKey)) return 'catégorie de transaction inconnue'
    if (t.transferGroupId !== null && !UUID_RE.test(t.transferGroupId)) return 'identifiant de virement invalide'
  }
  for (const a of plan.assignments) {
    if (!MONTH_RE.test(a.month)) return `mois d’assignation invalide (${a.month})`
    // Negatif autorise (retrait d'enveloppe YNAB), seul un non-entier est refuse.
    if (!Number.isSafeInteger(a.amount)) return 'montant assigné invalide'
    if (!categoryKeys.has(a.categoryKey) || incomeKeys.has(a.categoryKey)) return 'catégorie d’assignation invalide'
  }
  const size = byteLength(JSON.stringify({ action: 'importReplaceBegin', params: beginPayload(plan) }))
  if (size > MAX_BODY_BYTES) return 'structure trop volumineuse pour un seul envoi (trop de catégories)'
  return null
}

// ---------------------------------------------------------------------------
// Plan YNAB : comptes choisis, paires de virements, couleurs des groupes
// ---------------------------------------------------------------------------

export interface YnabAccountChoice {
  selected: boolean
  onBudget: boolean
}

const COLOR_CYCLE: CatColor[] = ['blue', 'green', 'amber', 'pink', 'purple', 'teal']
const ICON_HINTS: [RegExp, GroupIcon][] = [
  [/(logement|loyer|maison|habitat|immobili|home|housing|rent)/, 'home'],
  [/(transport|voiture|auto|vehicule|mobilite|carburant|car\b|travel)/, 'car'],
  [/(abonnement|subscription|facture|bill|recurr|mensuel)/, 'repeat'],
  [/(epargne|saving|objectif|goal|projet|investi|retraite|fonds|fund)/, 'piggy'],
  [/(revenu|income|salaire|inflow)/, 'banknote'],
]

/** Couleur (cycle de la palette) et icone (mots-cles du nom) d'un groupe YNAB. */
function styleForGroup(name: string, index: number): { color: CatColor; icon: GroupIcon } {
  const n = normalizeHeader(name)
  const icon = ICON_HINTS.find(([re]) => re.test(n))?.[1] ?? 'sparkles'
  return { color: COLOR_CYCLE[index % COLOR_CYCLE.length], icon }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

/**
 * Construit le plan d'un import YNAB. `choices` : comptes retenus et leur
 * nature (budget / suivi). `withTransfers` (serveur importTransfers) : les
 * lignes « Transfer : X » sont appariees (meme date, montants opposes, les deux
 * comptes) et partagent un transferGroupId ; sans le drapeau, elles restent des
 * transactions ordinaires (comportement historique).
 */
export function buildYnabPlan(
  parsed: ParsedImport,
  choices: Map<string, YnabAccountChoice>,
  withTransfers: boolean,
): ImportPlan {
  const chosen = parsed.accounts.filter((a) => choices.get(a.key)?.selected ?? true)
  const accountKey = new Map<string, string>()
  const onBudget = new Map<string, boolean>()
  const accounts: PlanAccount[] = chosen.map((a, i) => {
    const key = `a${i + 1}`
    const budget = choices.get(a.key)?.onBudget ?? a.onBudget
    accountKey.set(a.key, key)
    onBudget.set(a.key, budget)
    return { key, name: a.name, institution: 'Import YNAB', onBudget: budget }
  })

  // Cles courtes (corps de requete compact) ; la categorie de revenus garde sa
  // cle speciale (repli serveur incomeFallbackId).
  const groupKey = new Map<string, string>()
  const groups: PlanGroup[] = parsed.groups.map((g, i) => {
    const key = g.key === INCOME_KEY ? INCOME_KEY : `g${i + 1}`
    groupKey.set(g.key, key)
    const style =
      g.key === INCOME_KEY ? { color: 'teal' as CatColor, icon: 'banknote' as GroupIcon } : styleForGroup(g.name, i)
    return { key, name: g.name, hidden: g.hidden, ...style }
  })
  const categoryKey = new Map<string, string>()
  const categories: PlanCategory[] = parsed.categories.map((c, i) => {
    const key = c.key === INCOME_KEY ? INCOME_KEY : `c${i + 1}`
    categoryKey.set(c.key, key)
    return {
      key,
      groupKey: groupKey.get(c.groupKey) ?? INCOME_KEY,
      name: c.name,
      isIncome: c.isIncome,
      hidden: c.hidden,
    }
  })

  const byName = new Map(parsed.accounts.map((a) => [normalizeHeader(a.key), a.key]))
  const txs = parsed.transactions.filter((t) => accountKey.has(t.accountKey))
  const partnerOf = (t: ParsedTransaction) => (t.transferTo ? byName.get(normalizeHeader(t.transferTo)) : undefined)

  // Appariement des virements : la moitie en attente d'un compte X vers Y (date
  // d, montant m) rencontre la moitie de Y vers X (date d, montant -m).
  const pairIds: (string | null)[] = txs.map(() => null)
  let transferPairs = 0
  const transferLines = txs.filter((t) => t.transferTo !== null).length
  if (withTransfers) {
    const waiting = new Map<string, number[]>()
    txs.forEach((t, i) => {
      const partner = partnerOf(t)
      if (!partner || partner === t.accountKey || !accountKey.has(partner)) return
      const own = [t.accountKey, partner, t.date, t.amount].join('\u0000')
      const counterpart = [partner, t.accountKey, t.date, -t.amount].join('\u0000')
      const queue = waiting.get(counterpart)
      if (queue && queue.length > 0) {
        const j = queue.shift()!
        const id = newUuid()
        pairIds[i] = id
        pairIds[j] = id
        transferPairs++
      } else {
        waiting.set(own, [...(waiting.get(own) ?? []), i])
      }
    })
  }

  const transactions: PlanTransaction[] = txs.map((t, i) => {
    let catKey = t.categoryKey === null ? null : (categoryKey.get(t.categoryKey) ?? null)
    const pairId = pairIds[i]
    if (pairId) {
      // Entre deux comptes budget (ou deux comptes de suivi) : virement neutre,
      // sans categorie. Budget <-> suivi : la moitie budget garde sa categorie
      // YNAB (l'argent sort du budget), la moitie suivi n'en porte jamais.
      const partner = partnerOf(t)!
      const crossOut = onBudget.get(t.accountKey) === true && onBudget.get(partner) === false
      if (!crossOut) catKey = null
    }
    return {
      accountKey: accountKey.get(t.accountKey)!,
      categoryKey: catKey,
      date: t.date,
      amount: t.amount,
      label: t.label,
      counterparty: t.counterparty,
      notes: t.notes,
      transferGroupId: pairId,
    }
  })

  const assignments: PlanAssignment[] = parsed.assignments
    .filter((a) => a.categoryKey !== INCOME_KEY && categoryKey.has(a.categoryKey))
    .map((a) => ({ categoryKey: categoryKey.get(a.categoryKey)!, month: a.month, amount: a.amount }))

  const notes: string[] = []
  if (transferLines > 0 && !withTransfers) {
    notes.push(
      `${plural(transferLines, 'ligne de virement importée', 'lignes de virement importées')} comme des transactions ordinaires : le serveur déployé ne sait pas encore relier les deux moitiés d’un virement. Celles sans catégorie apparaîtront dans « À catégoriser ».`,
    )
  }
  const unpaired = transferLines - transferPairs * 2
  if (withTransfers && unpaired > 0) {
    notes.push(
      `${plural(unpaired, 'ligne de virement sans contrepartie', 'lignes de virement sans contrepartie')} (compte non importé, date ou montant différents) : ${unpaired > 1 ? 'importées' : 'importée'} comme ${unpaired > 1 ? 'des transactions ordinaires' : 'une transaction ordinaire'}.`,
    )
  }

  return {
    source: 'ynab',
    accounts,
    groups,
    categories,
    transactions,
    assignments,
    startMonth: null,
    targets: [],
    rules: [],
    closeAccounts: [],
    bankLinks: [],
    transferPairs,
    ignored: parsed.summary.ignoredCount,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Orchestrateur reprenable : begin (destructif) -> transactions -> budget ->
// objectifs -> regles -> comptes archives -> associations bancaires
// ---------------------------------------------------------------------------

export type ImportStep =
  | 'begin'
  | 'startMonth'
  | 'transactions'
  | 'assignments'
  | 'targets'
  | 'rules'
  | 'accounts'
  | 'links'
  | 'done'

interface BeginResult {
  accountMap: Record<string, string>
  categoryMap: Record<string, string>
  incomeFallbackId?: string
}

interface TxRow {
  accountId: string
  categoryId: string | null
  date: string
  amount: number
  label: string
  counterparty: string | null
  notes: string | null
  transferGroupId?: string
}

interface AsgRow {
  categoryId: string
  month: string
  amount: number
}

/** Etat d'un import, garde en memoire pour la reprise apres un echec. */
export interface ImportRun {
  plan: ImportPlan
  step: ImportStep
  begin: BeginResult | null
  txBatches: TxRow[][]
  asgBatches: AsgRow[][]
  /** Position dans l'etape courante (lot ou element). */
  cursor: number
  insertedTx: number
  upsertedAsg: number
  targetsSet: number
  rulesCreated: number
  accountsClosed: number
  linksRestored: number
  /** Transactions confirmees par mois (verification de reprise). */
  insertedByMonth: Record<string, number>
  lostCategorizations: number
  lostAssignments: number
  droppedTx: number
  skippedTargets: number
  skippedRules: number
  skipped: string[]
  /** Dernier envoi en echec ambigu (reseau, 5xx) : verifier avant de renvoyer. */
  verify: boolean
}

export interface ImportProgress {
  step: ImportStep
  pct: number
  done: number
  total: number
}

export interface ImportResult {
  source: 'ynab' | 'backup'
  accounts: number
  groups: number
  categories: number
  transactions: number
  assignments: number
  targets: number
  rules: number
  transferPairs: number
  ignored: number
  lostCategorizations: number
  lostAssignments: number
  notes: string[]
}

const MAX_TX_ROWS = 200
const MAX_ASG_ROWS = 500
// Marge sous la limite serveur de 64 000 octets : enveloppe JSON, caracteres
// multi-octets et evolution des champs.
const MAX_BATCH_BYTES = 45_000
// {"action":"importReplaceTransactions","params":{"transactions":[ ... ]}}
const ENVELOPE_BYTES = 80

/** Decoupe en lots d'au plus `maxRows` lignes ET ~45 Ko de JSON. */
export function batchBySize<T>(rows: T[], maxRows: number, maxBytes = MAX_BATCH_BYTES): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let size = ENVELOPE_BYTES
  for (const row of rows) {
    const rowSize = byteLength(JSON.stringify(row)) + 1
    if (current.length > 0 && (current.length >= maxRows || size + rowSize > maxBytes)) {
      out.push(current)
      current = []
      size = ENVELOPE_BYTES
    }
    current.push(row)
    size += rowSize
  }
  if (current.length > 0) out.push(current)
  return out
}

function resolveCategory(run: ImportRun, key: string | null): string | null {
  const begin = run.begin
  if (key === null || !begin) return null
  if (key === INCOME_KEY) return begin.categoryMap[INCOME_KEY] ?? begin.incomeFallbackId ?? null
  return begin.categoryMap[key] ?? null
}

/** Apres begin : cles -> ids serveur, lignes triees par date puis decoupees. */
function prepareBatches(run: ImportRun): void {
  const begin = run.begin!
  const plan = run.plan
  const incomeKeys = new Set(plan.categories.filter((c) => c.isIncome).map((c) => c.key))
  incomeKeys.add(INCOME_KEY)
  const txRows: TxRow[] = []
  for (const t of plan.transactions) {
    const accountId = begin.accountMap[t.accountKey]
    if (!accountId) {
      run.droppedTx++
      continue
    }
    const categoryId = resolveCategory(run, t.categoryKey)
    // Categorie attendue mais non resolue : la transaction est importee sans
    // categorie et la perte est COMPTEE (jamais silencieuse).
    if (t.categoryKey !== null && categoryId === null) run.lostCategorizations++
    const row: TxRow = {
      accountId,
      categoryId,
      date: t.date,
      amount: t.amount,
      label: t.label,
      counterparty: t.counterparty,
      notes: t.notes,
    }
    if (t.transferGroupId) row.transferGroupId = t.transferGroupId
    txRows.push(row)
  }
  // Par date : un lot couvre peu de mois (verification de reprise bornee) et
  // les deux moities d'un virement voyagent le plus souvent ensemble.
  txRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  run.txBatches = batchBySize(txRows, MAX_TX_ROWS)

  const asgRows: AsgRow[] = []
  for (const a of plan.assignments) {
    const categoryId = incomeKeys.has(a.categoryKey) ? null : resolveCategory(run, a.categoryKey)
    if (!categoryId) {
      run.lostAssignments++
      continue
    }
    asgRows.push({ categoryId, month: a.month, amount: a.amount })
  }
  run.asgBatches = batchBySize(asgRows, MAX_ASG_ROWS)
}

/** Refus explicite du serveur (validation, element inconnu) : l'envoi n'a rien ecrit. */
function isRefusal(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 400 || err.status === 404 || err.status === 409)
}

/** Echec dont on ignore s'il a ete applique (reseau coupe, erreur serveur). */
function isAmbiguous(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500
}

const monthOfDate = (date: string) => date.slice(0, 7)

/**
 * Reprise apres un echec ambigu : le lot a-t-il ete ecrit malgre tout ? Apres
 * l'effacement, un mois ne contient que les lignes de cet import (comptes
 * encore sans association bancaire) : on compare, mois par mois, le nombre de
 * transactions lues au nombre confirme avant ce lot. Evite les doublons.
 */
async function batchAlreadyCommitted(run: ImportRun, batch: TxRow[]): Promise<boolean> {
  const perMonth = new Map<string, number>()
  for (const row of batch) perMonth.set(monthOfDate(row.date), (perMonth.get(monthOfDate(row.date)) ?? 0) + 1)
  for (const [month, count] of perMonth) {
    const { transactions } = await apiCall<{ transactions: unknown[] }>('getTransactions', { month })
    if (transactions.length < (run.insertedByMonth[month] ?? 0) + count) return false
  }
  return true
}

function commitTxBatch(run: ImportRun, batch: TxRow[], inserted: number): void {
  run.insertedTx += inserted
  for (const row of batch) {
    const m = monthOfDate(row.date)
    run.insertedByMonth[m] = (run.insertedByMonth[m] ?? 0) + 1
  }
  run.cursor++
}

function progressOf(run: ImportRun): ImportProgress {
  const plan = run.plan
  const totalTx = run.txBatches.reduce((s, b) => s + b.length, 0)
  const totalAsg = run.asgBatches.reduce((s, b) => s + b.length, 0)
  const finishing = plan.targets.length + plan.rules.length + plan.closeAccounts.length + plan.bankLinks.length
  const finishedBefore = (step: ImportStep) =>
    step === 'targets'
      ? 0
      : step === 'rules'
        ? plan.targets.length
        : step === 'accounts'
          ? plan.targets.length + plan.rules.length
          : plan.targets.length + plan.rules.length + plan.closeAccounts.length
  switch (run.step) {
    case 'begin':
      return { step: 'begin', pct: 2, done: 0, total: 0 }
    case 'startMonth':
      return { step: 'startMonth', pct: 6, done: 0, total: 0 }
    case 'transactions': {
      const done = run.txBatches.slice(0, run.cursor).reduce((s, b) => s + b.length, 0)
      return { step: 'transactions', pct: Math.round(6 + (totalTx ? done / totalTx : 1) * 74), done, total: totalTx }
    }
    case 'assignments': {
      const done = run.asgBatches.slice(0, run.cursor).reduce((s, b) => s + b.length, 0)
      return { step: 'assignments', pct: Math.round(80 + (totalAsg ? done / totalAsg : 1) * 12), done, total: totalAsg }
    }
    case 'targets':
    case 'rules':
    case 'accounts':
    case 'links': {
      const done = finishedBefore(run.step) + run.cursor
      return { step: run.step, pct: Math.round(92 + (finishing ? done / finishing : 1) * 7), done, total: finishing }
    }
    case 'done':
      return { step: 'done', pct: 100, done: 0, total: 0 }
  }
}

const RULE_SIG = (categoryId: string, op: string, value: string) =>
  `${categoryId}\u0000${op}\u0000${value.trim().toLowerCase()}`

/** Execute le plan a partir de l'etape et de la position memorisees. */
async function execute(run: ImportRun, report: (p: ImportProgress) => void): Promise<void> {
  const plan = run.plan
  for (;;) {
    report(progressOf(run))
    switch (run.step) {
      case 'begin': {
        run.begin = await apiCall<BeginResult>('importReplaceBegin', beginPayload(plan))
        prepareBatches(run)
        run.step = plan.startMonth ? 'startMonth' : 'transactions'
        run.cursor = 0
        break
      }
      case 'startMonth': {
        try {
          await apiCall('newBudget', { month: plan.startMonth })
        } catch (err) {
          if (!(err instanceof ApiError) || (err.status !== 503 && !isRefusal(err))) throw err
          run.skipped.push('Le mois de départ du budget n’a pas pu être rétabli : le budget repart de l’origine.')
        }
        run.step = 'transactions'
        run.cursor = 0
        break
      }
      case 'transactions': {
        while (run.cursor < run.txBatches.length) {
          const batch = run.txBatches[run.cursor]
          if (run.verify) {
            const committed = await batchAlreadyCommitted(run, batch)
            run.verify = false
            if (committed) {
              commitTxBatch(run, batch, batch.length)
              report(progressOf(run))
              continue
            }
          }
          try {
            const res = await apiCall<{ inserted: number }>('importReplaceTransactions', { transactions: batch })
            commitTxBatch(run, batch, res.inserted)
          } catch (err) {
            run.verify = isAmbiguous(err)
            throw err
          }
          report(progressOf(run))
        }
        run.step = 'assignments'
        run.cursor = 0
        break
      }
      case 'assignments': {
        // Upsert (categorie, mois) : renvoyer un lot deja ecrit est sans effet.
        while (run.cursor < run.asgBatches.length) {
          const res = await apiCall<{ upserted: number }>('importReplaceAssignments', {
            assignments: run.asgBatches[run.cursor],
          })
          run.upsertedAsg += res.upserted
          run.cursor++
          report(progressOf(run))
        }
        run.step = 'targets'
        run.cursor = 0
        break
      }
      case 'targets': {
        // setTarget est un upsert par categorie : la reprise est sans doublon.
        while (run.cursor < plan.targets.length) {
          const t = plan.targets[run.cursor]
          const categoryId = resolveCategory(run, t.categoryKey)
          if (categoryId) {
            try {
              await apiCall('setTarget', { categoryId, type: t.type, amount: t.amount, dueMonth: t.dueMonth })
              run.targetsSet++
            } catch (err) {
              if (!isRefusal(err)) throw err
              run.skippedTargets++
            }
          } else {
            run.skippedTargets++
          }
          run.cursor++
          report(progressOf(run))
        }
        run.step = 'rules'
        run.cursor = 0
        break
      }
      case 'rules': {
        // createRule n'est pas idempotent : apres un echec ambigu, les regles
        // deja presentes (meme categorie, operateur et valeur) sont sautees.
        let existing: Set<string> | null = null
        if (run.verify && plan.rules.length > 0) {
          const { rules } = await apiCall<{ rules: { categoryId: string; matcher: { op: string; value: string } }[] }>(
            'listRules',
          )
          existing = new Set(rules.map((r) => RULE_SIG(r.categoryId, r.matcher.op, r.matcher.value)))
        }
        run.verify = false
        while (run.cursor < plan.rules.length) {
          const r = plan.rules[run.cursor]
          const categoryId = resolveCategory(run, r.categoryKey)
          if (!categoryId) {
            run.skippedRules++
          } else if (!existing?.has(RULE_SIG(categoryId, r.op, r.value))) {
            try {
              await apiCall('createRule', {
                matcher: { field: 'label', op: r.op, value: r.value },
                categoryId,
                priority: r.priority,
              })
              run.rulesCreated++
            } catch (err) {
              if (!isRefusal(err)) {
                run.verify = isAmbiguous(err)
                throw err
              }
              run.skippedRules++
            }
          }
          run.cursor++
          report(progressOf(run))
        }
        run.step = 'accounts'
        run.cursor = 0
        break
      }
      case 'accounts': {
        while (run.cursor < plan.closeAccounts.length) {
          const accountId = run.begin?.accountMap[plan.closeAccounts[run.cursor]]
          if (accountId) {
            try {
              await apiCall('updateAccount', { accountId, closed: true })
              run.accountsClosed++
            } catch (err) {
              if (!isRefusal(err)) throw err
              run.skipped.push('Un compte clos n’a pas pu être archivé (solde non nul) : il reste ouvert.')
            }
          }
          run.cursor++
          report(progressOf(run))
        }
        run.step = 'links'
        run.cursor = 0
        break
      }
      case 'links': {
        while (run.cursor < plan.bankLinks.length) {
          const link = plan.bankLinks[run.cursor]
          const accountId = run.begin?.accountMap[link.accountKey]
          if (accountId) {
            try {
              await apiCall('linkBankAccount', {
                connectionId: link.connectionId,
                providerAccountUid: link.providerAccountUid,
                accountId,
              })
              run.linksRestored++
            } catch (err) {
              if (!isRefusal(err)) throw err
            }
          }
          run.cursor++
          report(progressOf(run))
        }
        run.step = 'done'
        run.cursor = 0
        break
      }
      case 'done':
        return
    }
  }
}

function summarize(run: ImportRun): ImportResult {
  const plan = run.plan
  const notes = [...plan.notes, ...run.skipped]
  if (plan.bankLinks.length > 0 && run.linksRestored < plan.bankLinks.length) {
    notes.push('Certaines associations bancaires n’ont pas pu être rétablies : refais-les dans « Banque ».')
  }
  if (run.skippedTargets > 0) {
    notes.push(`${plural(run.skippedTargets, 'objectif non restauré', 'objectifs non restaurés')}.`)
  }
  if (run.skippedRules > 0) notes.push(`${plural(run.skippedRules, 'règle non restaurée', 'règles non restaurées')}.`)
  return {
    source: plan.source,
    accounts: Object.keys(run.begin?.accountMap ?? {}).length,
    groups: plan.groups.length,
    categories: Object.keys(run.begin?.categoryMap ?? {}).length,
    transactions: run.insertedTx,
    assignments: run.upsertedAsg,
    targets: run.targetsSet,
    rules: run.rulesCreated,
    transferPairs: plan.transferPairs,
    ignored: plan.ignored + run.droppedTx,
    lostCategorizations: run.lostCategorizations,
    lostAssignments: run.lostAssignments,
    notes,
  }
}

/** Message lisible d'un echec d'envoi (jamais le contenu des donnees). */
export function describeImportError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'La connexion a été interrompue.'
  if (err.status === 401) return 'Ta session a expiré : reconnecte-toi puis reprends l’import.'
  if (err.status === 413) return 'Un envoi était trop volumineux pour le serveur.'
  if (err.status >= 500) return `Le serveur n’a pas pu terminer l’envoi (${err.message}).`
  return `Le serveur a refusé l’envoi (${err.message}).`
}

// ---------------------------------------------------------------------------
// Store de l'import en cours (survit a la navigation dans l'app)
// ---------------------------------------------------------------------------

export interface SavedFile {
  blob: Blob
  filename: string
}

export type ImportPhase = 'idle' | 'running' | 'failed' | 'done'

interface ImportState {
  phase: ImportPhase
  /** Origine de l'import en cours ou du dernier bilan affiche. */
  source: 'ynab' | 'backup' | null
  run: ImportRun | null
  progress: ImportProgress | null
  error: string | null
  result: ImportResult | null
  /** Sauvegarde de securite prise avant l'effacement, re-telechargeable. */
  backup: SavedFile | null
}

const IDLE: ImportState = {
  phase: 'idle',
  source: null,
  run: null,
  progress: null,
  error: null,
  result: null,
  backup: null,
}

export const useImportStore = create<ImportState>(() => IDLE)

// Requetes touchees par un remplacement complet (tout sauf la liste des
// banques Enable Banking et l'historique de synchronisation, inchanges).
const REPLACED_KEYS = ['bootstrap', 'transactions', 'budget', 'reports', 'targets', 'rules', 'bankConnections']

function invalidateReplaced(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(REPLACED_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
}

function preventUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
  e.returnValue = ''
}

async function loop(queryClient: QueryClient): Promise<void> {
  const { run, phase } = useImportStore.getState()
  if (!run || phase === 'running') return
  useImportStore.setState({ phase: 'running', error: null })
  // Quitter la page pendant l'envoi perdrait la reprise : le navigateur demande.
  window.addEventListener('beforeunload', preventUnload)
  try {
    await execute(run, (progress) => useImportStore.setState({ progress }))
    useImportStore.setState({ phase: 'done', result: summarize(run), progress: progressOf(run) })
    await invalidateReplaced(queryClient)
  } catch (err) {
    useImportStore.setState({ phase: 'failed', error: describeImportError(err), progress: progressOf(run) })
    // Donnees deja effacees : les caches de l'app ne refletent plus rien.
    if (run.begin) void invalidateReplaced(queryClient)
  } finally {
    window.removeEventListener('beforeunload', preventUnload)
  }
}

/** Lance un remplacement complet (le plan doit avoir passe validatePlan). */
export function startImport(queryClient: QueryClient, plan: ImportPlan, backup: SavedFile | null): Promise<void> {
  if (useImportStore.getState().phase === 'running') return Promise.resolve()
  const invalid = validatePlan(plan)
  if (invalid) {
    useImportStore.setState({
      ...IDLE,
      source: plan.source,
      backup,
      phase: 'failed',
      error: `Import annulé avant tout effacement : ${invalid}.`,
    })
    return Promise.resolve()
  }
  const run: ImportRun = {
    plan,
    step: 'begin',
    begin: null,
    txBatches: [],
    asgBatches: [],
    cursor: 0,
    insertedTx: 0,
    upsertedAsg: 0,
    targetsSet: 0,
    rulesCreated: 0,
    accountsClosed: 0,
    linksRestored: 0,
    insertedByMonth: {},
    lostCategorizations: 0,
    lostAssignments: 0,
    droppedTx: 0,
    skippedTargets: 0,
    skippedRules: 0,
    skipped: [],
    verify: false,
  }
  useImportStore.setState({ ...IDLE, source: plan.source, backup, run, progress: progressOf(run) })
  return loop(queryClient)
}

/**
 * Reprend l'import echoue a l'etape et au lot memorises (jamais de nouvel
 * effacement une fois begin confirme ; begin lui-meme se rejoue sans risque).
 */
export function resumeImport(queryClient: QueryClient): Promise<void> {
  return loop(queryClient)
}

/** Oublie l'import termine ou abandonne (sans effet pendant un envoi). */
export function resetImport(): void {
  if (useImportStore.getState().phase !== 'running') useImportStore.setState(IDLE)
}

/** Mois de depart restaurable : le serveur refuse au-dela du mois prochain. */
export function isRestorableStartMonth(month: string): boolean {
  return MONTH_RE.test(month) && month >= '2000-01' && month <= addMonths(currentMonth(), 1)
}
