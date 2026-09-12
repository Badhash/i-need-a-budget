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

export function payeeKey(label: string): string {
  const base = label
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
  return words.join(' ').slice(0, MAX_KEY).trim()
}
