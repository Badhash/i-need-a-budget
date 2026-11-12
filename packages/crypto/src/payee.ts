// Cle de tiers (payee) derivee d'un libelle bancaire : sert de cle de memoire
// « tiers -> categorie » (table payee_memory) cote serveur ET de cle de
// recherche des suggestions cote front. Module pur, zero dependance, importe
// par /api, sync-bank et l'app (chemin relatif) : UNE seule implementation.
//
// Principe : on retire tout ce qui varie d'une occurrence a l'autre chez un
// meme marchand (dates, montants, numeros de carte/reference, heures) pour ne
// garder que les mots stables, en minuscules sans accents, tronques.

const MAX_KEY = 40

const NOISE_WORDS = new Set([
  'carte',
  'cb',
  'paiement',
  'achat',
  'prelevement',
  'prlv',
  'sepa',
  'virement',
  'vir',
  'emis',
  'recu',
  'de',
  'du',
  'le',
  'la',
  'les',
  'en',
  'votre',
  'faveur',
  'x',
])

// Mots qui ne designent jamais un tiers a eux seuls : une cle reduite a ces
// mots regrouperait des tiers differents (tous les cheques, tous les virements
// instantanes, tous les prets) sous une seule categorie apprise. Elle est donc
// vide (pas de memoire) ; les regles restent le moyen de les categoriser.
const GENERIC_WORDS = new Set([
  'cheque',
  'chq',
  'remise',
  'ref',
  'reference',
  'inst',
  'instantane',
  'permanent',
  'sct',
  'sdd',
  'echeance',
  'mensualite',
  'pret',
  'facture',
  'paris',
  'france',
  'fr',
  'eu',
  'eur',
  'sa',
  'sas',
  'sarl',
])

export function payeeKey(label: string): string {
  const base = label
    // ligatures que NFD ne decompose pas (CŒUR -> coeur, pas « c ur »)
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    // sigles a esperluette (H&M, C&A, M & S) : une seule lettre de chaque cote
    // serait sinon ecartee et le sigle perdu (H&M -> cle vide)
    .replace(/\b([A-Za-z]) ?& ?([A-Za-z])\b/g, '$1$2')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // dates 12/03, 12/03/24, 2024-03-12, heures 12:34
    .replace(/\b\d{1,4}[/.:-]\d{1,2}([/.:-]\d{2,4})?\b/g, ' ')
    // tout groupe contenant un chiffre (montants, numeros, references)
    .replace(/\S*\d\S*/g, ' ')
    // ponctuation residuelle
    .replace(/[^a-z\s]/g, ' ')
  const words = base
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE_WORDS.has(w))
  if (words.every((w) => GENERIC_WORDS.has(w))) return ''
  return words.join(' ').slice(0, MAX_KEY).trim()
}
