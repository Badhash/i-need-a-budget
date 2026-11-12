// Variantes d'un meme libelle bancaire. Certaines banques (Boursorama) renvoient
// une operation DEJA comptabilisee quelques jours plus tard avec un libelle
// complete ("VIR Virement de JEAN DUPONT" -> "VIR Virement de JEAN DUPONT
// DUPONT JEAN Ref : SCT...") ou tronque autrement ("CARTE 14/04/26 PAYPAL
// *STREAMING SU" -> "CARTE 14/04/26 PAYPAL *STREA CB*1234"). Le tx_hash depend
// du libelle : sync-bank s'appuie sur ce test pour ne pas reimporter
// l'operation en double. Module pur, zero dependance.

// Longueur minimale du libelle le plus court : en dessous ("VIR", "CARTE X"),
// un prefixe commun ne prouve rien.
const MIN_CORE = 12

// Libelle compare : minuscules sans accents, espaces normalises, sans le
// suffixe de carte " cb*1234" que la banque ajoute ou retire selon le moment.
function labelCore(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*cb\*\d{4}$/, '')
    .trim()
}

// Prefixe carte « carte 14/04/26 » : commun a tous les achats carte d'un jour,
// il ne distingue rien et ne compte pas dans la longueur minimale.
const CARD_PREFIX_RE = /^carte \d{2}\/\d{2}(\/\d{2,4})? /

/**
 * Vrai si deux libelles designent vraisemblablement la meme operation : une
 * fois retire le suffixe carte, l'un est un prefixe de l'autre, avec au moins
 * 12 caracteres hors prefixe carte (sinon « CARTE 14/04/26 SNCF » absorberait
 * « CARTE 14/04/26 SNCF INTERNET »). Ne compare que les libelles : l'appelant
 * verifie lui-meme compte, montant et date (identiques).
 */
export function isLabelVariant(a: string, b: string): boolean {
  const x = labelCore(a)
  const y = labelCore(b)
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.replace(CARD_PREFIX_RE, '').length >= MIN_CORE && long.startsWith(short)
}
