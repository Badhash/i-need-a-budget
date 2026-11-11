// Prelevement mensuel d'une carte a debit differe, partage par /api et
// sync-bank : les deux doivent reconnaitre la meme ligne (sync-bank ne la
// categorise pas a l'import et la relie en virement ; /api ne la categorise pas
// non plus quand il applique les regles).

// Libelles typiques du prelevement de reglement d'une carte a debit differe
// (ex. "CARTE DEPENSES", "DEPENSES CARTE", "CARTE X1234 AU 05/07"). Applique au
// libelle passe par normalizeLabel (accents retires, espaces normalises).
export const CARD_SETTLEMENT_RE =
  /CARTE\s+DEPENSES|DEPENSES\s+CARTE|CARTE\s+X?\d{4}\s+AU\s+\d{2}\/\d{2}/i
