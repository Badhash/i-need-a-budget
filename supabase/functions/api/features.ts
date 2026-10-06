// Fonctionnalites serveur optionnelles, annoncees au front dans les reponses
// bootstrap / bootstrapFull (`features: string[]`).
//
// Pages (front) et Edge Functions se deploient separement : le front masque
// toute interface qui depend d'un comportement serveur NOUVEAU tant que le
// serveur deploye ne l'annonce pas (app/src/lib/features.ts, noms IDENTIQUES).
// Un serveur ancien n'envoie pas `features` : le front garde son comportement
// historique. Ajouter un nom ici des que le comportement correspondant existe.
export const SERVER_FEATURES = [
  // Virement budget <-> suivi : la moitie cote budget se categorise (regle YNAB).
  'crossBudgetTransfers',
  // updateAccount accepte onBudget (bascule budget/suivi) et closed (archivage).
  'accountFlags',
  // setTarget accepte le type 'refill' (« recharger jusqu'a », report compris).
  'refillTargets',
  // importReplaceTransactions accepte transferGroupId (paires de virements YNAB).
  'importTransfers',
  // Actions push* : notifications Web Push (abonnement, preferences, test).
  'pushNotifications',
] as const
