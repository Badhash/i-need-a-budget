// Classification et nettoyage des libelles bancaires bruts (affichage
// uniquement : le label brut reste la source de verite, stocke tel quel).
// Module pur, zero dependance.

export type BankLabelKind =
  | 'virement_recu'
  | 'virement_emis'
  | 'prelevement'
  | 'carte'
  | 'retrait'
  | 'versement'
  | 'pret'
  | 'reglement'
  | 'cotisation'
  | 'interets'
  | 'cheque'
  | 'solde'
  | 'autre'

export interface ParsedLabel {
  kind: BankLabelKind
  short: string
}

const MAX_SHORT = 48

// -- Normalisation -----------------------------------------------------------

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// Version majuscule sans accents, pour la detection de motifs.
function upperNoAccents(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
}

// -- Detection du kind -------------------------------------------------------

interface KindRule {
  kind: BankLabelKind
  re: RegExp
}

// L'ordre compte : les motifs specifiques (carte, retrait) avant les generiques
// (prelevement, virement).
const KIND_RULES: KindRule[] = [
  { kind: 'solde', re: /^SOLDE D'?OUVERTURE/ },
  { kind: 'carte', re: /CARTE DEPENSES|DEPENSES CARTE|PRELEVEMENT CARTE/ },
  { kind: 'retrait', re: /^RETRAIT (AU DISTRIBUTEUR|DAB)/ },
  { kind: 'versement', re: /^VERSEMENT/ },
  { kind: 'virement_recu', re: /VIREMENT EN VOTRE FAVEUR|VIR RECU/ },
  { kind: 'virement_emis', re: /^VIREMENT EMIS/ },
  { kind: 'pret', re: /REMBOURSEMENT DE PRET/ },
  { kind: 'reglement', re: /^REGLEMENT/ },
  { kind: 'cotisation', re: /^(COTISATION|FRAIS|COMMISSION)/ },
  { kind: 'interets', re: /INTERETS/ },
  { kind: 'cheque', re: /REMISE (DE )?CHEQUES?|CHEQUE/ },
  { kind: 'prelevement', re: /^PRELEVEMENT/ },
]

function detectKind(u: string): BankLabelKind {
  for (const rule of KIND_RULES) {
    if (rule.re.test(u)) return rule.kind
  }
  return 'autre'
}

// -- Marchands connus (match sur le libelle majuscule, prioritaire) ----------

const MERCHANTS: Array<{ res: RegExp[]; name: string }> = [
  { res: [/PAYPAL/], name: 'PayPal' },
  { res: [/TOTALENERGIES/], name: 'TotalEnergies' },
  { res: [/BOUYGUES TELECOM/], name: 'Bouygues Telecom' },
  { res: [/ORANGE SA/], name: 'Orange' },
  { res: [/NAVIGO/, /COMUTIT/], name: 'Navigo' },
  { res: [/HOMESERVE/], name: 'HomeServe' },
  { res: [/PAPERNEST/], name: 'Papernest energie' },
  { res: [/FITNESS PARK/, /ACTIV SAINT MAUR/], name: 'Fitness Park' },
  { res: [/PACIFICA/, /ASSURANCE HABITATION/], name: 'Assurance habitation' },
  { res: [/\bCAAE\b/], name: 'Assurance emprunteur' },
  { res: [/AVANSSUR/, /DIRECT ASSURANCE/], name: 'Direct Assurance' },
  { res: [/WEMIND/, /\bCPMS\b/], name: 'Wemind' },
  { res: [/REECHO/], name: 'Reecho' },
]

function findMerchant(u: string): string | null {
  for (const m of MERCHANTS) {
    if (m.res.some((re) => re.test(u))) return m.name
  }
  return null
}

// -- Filtrage des jetons de bruit --------------------------------------------

const NOISE_PREFIXES = ['SCTINST', 'RUM', 'PAGP', 'EPCB', 'DEMP', 'TRX-', 'PPN-', 'YYW', 'BT1']
const CONNECTORS = new Set(['VIR', 'INST', 'DE', 'VERS', 'WEB'])

function isNoiseToken(uTok: string): boolean {
  if (!uTok) return true
  // Ponctuation orpheline
  if (/^[-–—\/.,:;+*']+$/.test(uTok)) return true
  // Suites de >= 6 chiffres
  if (/\d{6,}/.test(uTok)) return true
  // Identifiants SEPA (ICS/IBAN-like) et jetons contenant ZZZ
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{3,}$/.test(uTok)) return true
  if (/ZZZ/.test(uTok)) return true
  // Refs melangees alphanum >= 9 caracteres contenant chiffres ET lettres
  if (uTok.length >= 9 && /\d/.test(uTok) && /[A-Z]/.test(uTok) && /^[A-Z0-9\/\-]+$/.test(uTok))
    return true
  // Prefixes de refs techniques
  if (NOISE_PREFIXES.some((p) => uTok.startsWith(p))) return true
  // Dates JJ/MM(/AA(AA)) et heures
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(uTok)) return true
  if (/^\d{1,2}H\d{2}$/.test(uTok)) return true
  // Jetons composes uniquement de chiffres et ponctuation (refs, echeances)
  if (/^[\d\/\-.]{5,}$/.test(uTok)) return true
  return false
}

interface Token {
  raw: string
  u: string
}

function tokenize(s: string): Token[] {
  return squash(s)
    .split(' ')
    .filter(Boolean)
    .map((raw) => ({ raw, u: upperNoAccents(raw) }))
}

// Retire prefixe detecte, connecteurs de tete, bruit et doublons consecutifs.
function cleanTokens(tokens: Token[]): Token[] {
  const out: Token[] = []
  let prevU = ''
  for (const t of tokens) {
    if (isNoiseToken(t.u)) continue
    if (t.u === prevU) continue // doublons consecutifs
    out.push(t)
    prevU = t.u
  }
  return out
}

function stripLeadingConnectors(tokens: Token[]): Token[] {
  let i = 0
  while (i < tokens.length && CONNECTORS.has(tokens[i].u)) i++
  return tokens.slice(i)
}

// Retire le prefixe qui a declenche la detection du kind.
function stripKindPrefix(label: string, kind: BankLabelKind): string {
  const u = upperNoAccents(label)
  const PREFIX_RES: Partial<Record<BankLabelKind, RegExp>> = {
    virement_recu: /VIREMENT EN VOTRE FAVEUR|VIR RECU/,
    virement_emis: /VIREMENT EMIS/,
    prelevement: /PRELEVEMENT/,
    retrait: /RETRAIT (AU DISTRIBUTEUR|DAB)/,
    versement: /VERSEMENT (D'?ESPECES)?/,
    reglement: /REGLEMENT/,
    cheque: /REMISE (DE )?CHEQUES?|CHEQUE/,
  }
  const re = PREFIX_RES[kind]
  if (!re) return label
  const m = re.exec(u)
  if (!m || m.index !== 0) {
    // Prefixe non situe en tete : on cherche sa position et on coupe apres.
    if (m) return label.slice(m.index + m[0].length)
    return label
  }
  return label.slice(m[0].length)
}

// -- Casse titre douce --------------------------------------------------------

const LOWER_WORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'ou',
  'au', 'aux', 'en', 'sur', 'sous', 'pour', 'chez', 'a',
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'aout', 'septembre', 'octobre', 'novembre', 'decembre',
])

function titleWord(raw: string, isFirst: boolean): string {
  const lower = raw.toLowerCase()
  // Mots de liaison et mois en minuscules (sauf en premiere position)
  if (!isFirst && LOWER_WORDS.has(upperNoAccents(raw).toLowerCase())) return lower
  // Acronymes <= 4 lettres deja tout en majuscules : conserves
  if (/^[A-Z]{1,4}\.?$/.test(raw)) return raw
  // Apostrophe de liaison : d'Ar, l'Atelier
  const ap = raw.match(/^([dDlL])['’](.+)$/)
  if (ap) {
    const rest = ap[2].toLowerCase()
    return ap[1].toLowerCase() + "'" + rest.charAt(0).toUpperCase() + rest.slice(1)
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function softTitleCase(s: string): string {
  return squash(s)
    .split(' ')
    .map((w, i) => titleWord(w, i === 0))
    .join(' ')
}

function truncateAtWord(s: string, max = MAX_SHORT): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:—–-]+$/, '') + '…'
}

// -- Cas virements : separation tiers / memo ---------------------------------

const HONORIFICS = new Set(['M.', 'M', 'MR', 'MME', 'MLLE'])

function buildTransferShort(tokens: Token[], merchant: string | null): string {
  // Heuristique : les jetons tout en majuscules (dans le brut) forment le
  // tiers ; le premier jeton en casse mixte demarre le memo.
  let memoStart = tokens.length
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i].raw
    if (/[a-z]/.test(raw)) {
      memoStart = i
      break
    }
  }
  let partyTokens = tokens.slice(0, memoStart)
  let memoTokens = tokens.slice(memoStart)

  // Tronque le tiers a la civilite (M. HASSAN NADER -> retire)
  const hIdx = partyTokens.findIndex((t) => HONORIFICS.has(t.u))
  if (hIdx > 0) partyTokens = partyTokens.slice(0, hIdx)

  // Retire du memo les jetons redondants ('Virement loyer' -> 'loyer')
  memoTokens = memoTokens.filter((t) => t.u !== 'VIREMENT' && t.u !== 'VIR')

  const party = merchant ?? softTitleCase(partyTokens.map((t) => t.raw).join(' '))
  const memo = softTitleCase(memoTokens.map((t) => t.raw).join(' '))
  if (party && memo) return `${party} — ${memo}`
  return party || memo
}

// -- Parseur principal --------------------------------------------------------

export function parseBankLabel(label: string): ParsedLabel {
  const raw = squash(label ?? '')
  const u = upperNoAccents(raw)
  const kind = detectKind(u)

  const fallback = () => truncateAtWord(raw) || '—'

  const finish = (short: string): ParsedLabel => ({
    kind,
    short: truncateAtWord(squash(short)) || fallback(),
  })

  switch (kind) {
    case 'solde':
      return finish("Solde d'ouverture")
    case 'interets':
      return finish('Interets crediteurs')
    case 'pret':
      return finish(/CAPITAL/.test(u) ? 'Echeance de pret (capital)' : 'Echeance de pret')
    case 'carte': {
      const m = u.match(/X\d{4}/)
      return finish(m ? `Releve carte ${m[0]}` : 'Releve carte')
    }
    case 'retrait': {
      const rest = stripKindPrefix(raw, kind)
      const tokens = cleanTokens(tokenize(rest)).filter(
        (t) => !/^X\d{4}$/.test(t.u) && t.u !== 'AU',
      )
      const place = softTitleCase(tokens.map((t) => t.raw).join(' '))
      return finish(place ? `DAB ${place}` : 'Retrait DAB')
    }
    case 'versement': {
      const rest = stripKindPrefix(raw, kind)
      const tokens = cleanTokens(tokenize(rest)).filter((t) => t.u !== 'AU')
      const place = softTitleCase(tokens.map((t) => t.raw).join(' '))
      return finish(place ? `Versement especes — ${place}` : 'Versement especes')
    }
    case 'virement_recu':
    case 'virement_emis': {
      const merchant = findMerchant(u)
      const rest = stripKindPrefix(raw, kind)
      const tokens = stripLeadingConnectors(cleanTokens(tokenize(rest)))
      const short = buildTransferShort(tokens, merchant)
      return finish(short || fallback())
    }
    case 'cotisation': {
      // On garde le mot d'entete (Cotisation/Frais/Commission) dans le short.
      const tokens = cleanTokens(tokenize(raw))
      return finish(softTitleCase(tokens.map((t) => t.raw).join(' ')))
    }
    case 'prelevement':
    case 'reglement':
    case 'cheque': {
      const merchant = findMerchant(u)
      if (merchant) return finish(merchant)
      const rest = stripKindPrefix(raw, kind)
      const tokens = stripLeadingConnectors(cleanTokens(tokenize(rest)))
      const short = softTitleCase(tokens.map((t) => t.raw).join(' '))
      return finish(short || fallback())
    }
    default: {
      const merchant = findMerchant(u)
      if (merchant) return finish(merchant)
      const tokens = cleanTokens(tokenize(raw))
      const short = softTitleCase(tokens.map((t) => t.raw).join(' '))
      return finish(short || fallback())
    }
  }
}
